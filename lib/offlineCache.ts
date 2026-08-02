// =====================================================
// OFFLINE READ CACHE — INC-05b
//
// The app is offline-first for WRITING (SyncQueue) and was
// online-only for READING: an ASHA worker on a bus with one
// bar could not re-read the alert she saw an hour ago, nor
// check which well was flagged. This is the read half.
//
// THREE RULES, in priority order:
//
// 1. SCOPED PER USER. Field handsets are shared. The same
//    query returns different rows to different accounts —
//    verified 2 Aug 2026 on the live database: `select * from
//    disease_reports` returns 2 rows (Chengalpattu,
//    Moolacheri) for asha_worker 7c635394 and 4 rows
//    (…, Kovilancheri, Shimla) for volunteer 8f4b467c. An
//    unscoped cache would hand one worker the other's rows.
//    So the owner id is BOTH in the storage key AND inside
//    the envelope, and a read whose envelope owner does not
//    match the signed-in user is discarded, not returned.
//
// 2. NEVER PRESENTED AS LIVE. A cached answer always comes
//    back with fromCache/cachedAt/asOf. Stale data shown as
//    current is a lie; stale data labelled as stale is a
//    service. Because the label can only be drawn by the
//    screen, substitution is OPT-IN: a caller asks for
//    `offlineFallback: true` to declare it will render the
//    stamp. Callers that do not ask keep their honest
//    error-with-retry state. The cache is still WRITTEN for
//    everyone, so the answer is on disk the moment a screen
//    adopts it.
//
// 3. ONLY TRANSPORT FAILURES ARE SUBSTITUTED. An RLS denial,
//    a 400 or a validation error is a real answer from the
//    server and must reach the user. Only "the request never
//    got through" may be answered from disk.
//
// A cache miss is silent by design: nothing here can turn a
// failed query into an empty success — the fetcher's error is
// returned untouched when no cached answer stands in.
//
// ── ADOPTION STATUS, stated plainly ─────────────────
// This module is MACHINERY. As of this change no screen has
// opted in, so nothing below is yet visible to a worker.
// Written down because "the app now works offline" would be
// a lie, and because the next person needs the exact list:
//
//   WRAPPED AND CALLED (cache is being WRITTEN today):
//     waterSources.list / getById / reportsForSource
//       ← components/screens/WaterSourcesScreen.tsx
//     waterQuality.getById, waterSources.getById
//       ← components/forms/WaterQualityReportForm.tsx
//     diseaseReports.getById
//       ← components/forms/DiseaseReportForm.tsx
//   WRAPPED, ZERO CALL SITES (write path never runs):
//     diseaseReports.getAll / getByReporter / getRecent,
//     waterQuality.getAll / getRecent / getByQuality,
//     waterSources.flagged
//   NOT WRAPPED AT ALL: health alerts (lib/services/alerts.ts)
//     — the first thing INC-05 names and the thing a worker
//     most needs to re-read on a bus. That file is owned by
//     another change; the wrapping is three lines and is
//     spelled out in the INC-05 report.
//
// To ADOPT on a screen, two things must both happen — the
// call passes `{ offlineFallback: true }` AND the screen
// renders `res.asOf` (t('common.asOf', { when: res.asOf })).
// One without the other is exactly the lie rule 2 forbids.
// =====================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  describeRequestError,
  isCancelledError,
  isOfflineError,
  readPersistedUserId,
} from './supabase';
import { formatDateTime, formatTime } from './format';
import { log } from './logger';
import { ApiResponse } from '../types';

/** Bump the version segment whenever the envelope shape changes. */
export const CACHE_PREFIX = 'healthdrop:rcache:v1:';

/** Older than this and the entry is not worth showing at all. */
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Refuse to store anything larger than this. AsyncStorage on Android is one
 * SQLite row per key; a runaway list must never crowd out the sync queue,
 * which holds unsent field reports.
 */
const MAX_ENTRY_CHARS = 192 * 1024;

/**
 * Which cache namespaces a SyncQueue item type contradicts once it lands on
 * the server.
 *
 * A report filed with no signal is enqueued, not written — so the service that
 * enqueued it cannot invalidate anything at the moment the row actually
 * appears, hours later, from OfflineSyncService. Without this the cache could
 * be serving a list assembled BEFORE her own report existed, and the one row
 * missing from it would be hers. "Where did my report go" is the worst
 * possible stale-cache symptom in a surveillance app.
 *
 * The map lives here rather than in the sync service because these strings are
 * the CACHE_NS constants of lib/services/* — they belong next to the cache
 * they name. Keys mirror TABLE_MAP in
 * src/services/offlineSync/OfflineSyncService.ts.
 */
export const SYNC_TYPE_CACHE_NAMESPACES: Readonly<Record<string, readonly string[]>> = {
  // a water reading upserts water_sources through a DB trigger, so it
  // contradicts the source caches too
  water_quality_report: ['water:', 'wsrc:'],
  disease_report: ['disease:'],
  campaign: [],
  health_alert: [],
  feedback: [],
};

/** What travels back with every cached-capable read. */
export interface CacheStamp {
  /** True when this payload came off the disk instead of the network. */
  fromCache: boolean;
  /** ISO timestamp of the fetch that produced this payload. */
  cachedAt: string | null;
  /**
   * The same instant rendered for a human — "14:32" today, "14 Jul 09:32"
   * otherwise. Screens draw it as t('common.asOf', { when: res.asOf }).
   */
  asOf: string | null;
}

/** ApiResponse plus the stamp. Structurally still an ApiResponse. */
export type CachedApiResponse<T> = ApiResponse<T> & CacheStamp;

export interface ReadThroughOptions {
  /**
   * Serve the last successful result when the request cannot get through.
   * OFF by default: passing true is the caller's promise that it renders
   * `asOf`. See rule 2 above.
   */
  offlineFallback?: boolean;
  /** Entries older than this are treated as a miss. Default 7 days. */
  maxAgeMs?: number;
  /** Message to fall back to when the failure is not a recognised one. */
  fallbackMessage?: string;
}

interface Envelope<T> {
  /** Envelope version. */
  v: 1;
  /** profile / auth user id this payload belongs to. */
  owner: string;
  /** ISO timestamp of the successful fetch. */
  at: string;
  /** The cached payload. */
  d: T;
  /** PostgREST exact count, when the query asked for one. */
  c?: number | null;
}

const NOOP_STAMP: CacheStamp = { fromCache: false, cachedAt: null, asOf: null };

// ── Pure helpers (exported for verification) ─────────

/** Storage key for one owner + logical name. Owner ids are uuids — no colons. */
export const cacheKeyFor = (ownerId: string, name: string): string =>
  `${CACHE_PREFIX}${ownerId}:${name}`;

/**
 * Render a fetch instant honestly: the clock alone only when it is still the
 * same calendar day, otherwise the date too — "as of 09:32" on a stamp from
 * last Tuesday would read as this morning.
 */
export const formatAsOf = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? formatTime(at) : formatDateTime(at);
};

/**
 * Validate a raw stored blob. Returns null for anything that is not a live,
 * in-date envelope belonging to `ownerId` — corrupt, foreign and expired all
 * collapse to "miss", never to a wrong answer.
 */
export const parseEnvelope = <T>(
  raw: string | null,
  ownerId: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Envelope<T> | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as Partial<Envelope<T>>;
  if (env.v !== 1) return null;
  // Defence in depth: the key is already owner-scoped, but a stale or
  // hand-edited key must never be able to hand over another account's rows.
  if (typeof env.owner !== 'string' || env.owner !== ownerId) return null;
  if (typeof env.at !== 'string') return null;
  const at = new Date(env.at).getTime();
  if (Number.isNaN(at)) return null;
  if (nowMs - at > maxAgeMs) return null;
  if (env.d === undefined) return null;
  return env as Envelope<T>;
};

// ── Owner resolution ─────────────────────────────────

/**
 * The signed-in user id.
 *
 * This used to call supabase.auth.getSession(), and that was fatal to the
 * whole feature. getSession() does not simply read storage: once the access
 * token is within 90 s of expiry (EXPIRY_MARGIN_MS) it tries a NETWORK
 * refresh, and offline that refresh fails and it hands back `session: null`
 * (GoTrueClient.js:1019-1051, auth-js 2.71.1). An access token lives one hour.
 * So roughly an hour into being offline the owner went null, and the cache
 * stopped serving AND stopped storing — in exactly the situation it exists
 * for. Nothing caught it because the identity source was the thing being
 * stubbed in verification.
 *
 * readPersistedUserId() reads the persisted session blob instead. It survives
 * an expired token because auth-js keeps the blob on a retryable fetch failure
 * (GoTrueClient.js:1745-1749), and because who the rows belong to is not a
 * function of whether the token is still fresh.
 *
 * Null still means "no signed-in user" — sign-out really does delete the blob
 * — and then nothing is cached and nothing is served, because a payload with
 * no owner cannot be scoped.
 */
async function ownerId(): Promise<string | null> {
  try {
    return await readPersistedUserId();
  } catch (err) {
    log.warn('OfflineCache', 'could not read session blob for cache scoping', err);
    return null;
  }
}

async function keysForOwner(owner: string): Promise<string[]> {
  const all = await AsyncStorage.getAllKeys();
  const prefix = `${CACHE_PREFIX}${owner}:`;
  return Array.from(all).filter((k) => k.startsWith(prefix));
}

// ── Core ─────────────────────────────────────────────

async function readEntry<T>(
  name: string,
  maxAgeMs: number,
): Promise<{ data: T; count: number | null; fetchedAt: string } | null> {
  const owner = await ownerId();
  if (!owner) return null;
  const key = cacheKeyFor(owner, name);
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (err) {
    log.warn('OfflineCache', `read failed for ${name}`, err);
    return null;
  }
  const env = parseEnvelope<T>(raw, owner, Date.now(), maxAgeMs);
  if (!env) {
    // Corrupt / foreign / expired: reclaim the space rather than keep lying
    // around. Best-effort — a failed delete is not worth surfacing.
    if (raw) AsyncStorage.removeItem(key).catch(() => undefined);
    return null;
  }
  return { data: env.d, count: env.c ?? null, fetchedAt: env.at };
}

async function writeEntry<T>(
  name: string,
  data: T,
  count: number | null,
  at: string,
): Promise<void> {
  const owner = await ownerId();
  if (!owner) return; // nothing to attribute the payload to — do not store it
  const key = cacheKeyFor(owner, name);
  const envelope: Envelope<T> = { v: 1, owner, at, d: data, c: count };

  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch (err) {
    log.warn('OfflineCache', `payload for ${name} is not serializable`, err);
    return;
  }
  if (serialized.length > MAX_ENTRY_CHARS) {
    log.warn(
      'OfflineCache',
      `skipped caching ${name} — ${Math.round(serialized.length / 1024)} KB exceeds the ${MAX_ENTRY_CHARS / 1024} KB entry cap`,
    );
    return;
  }

  try {
    await AsyncStorage.setItem(key, serialized);
  } catch (firstErr) {
    // Storage is full or broken. The cache is disposable and the sync queue's
    // unsent reports are not — drop this owner's other cached reads and try
    // once more, then give up quietly.
    try {
      const others = (await keysForOwner(owner)).filter((k) => k !== key);
      if (others.length > 0) await AsyncStorage.multiRemove(others);
      await AsyncStorage.setItem(key, serialized);
    } catch (retryErr) {
      log.warn('OfflineCache', `could not cache ${name} — storage may be full`, retryErr);
    }
    void firstErr;
  }
}

export const offlineCache = {
  /**
   * Fetch, cache the success, and — only when the caller opts in and only for
   * a transport failure — answer from the last successful fetch instead.
   *
   * The fetcher THROWS on failure (the services already do `if (error) throw
   * error`). Its resolved `count` is preserved so paginated callers keep
   * their total.
   */
  async readThrough<T>(
    name: string,
    fetcher: () => Promise<{ data: T; count?: number | null }>,
    options?: ReadThroughOptions,
  ): Promise<CachedApiResponse<T>> {
    try {
      const fresh = await fetcher();
      const at = new Date().toISOString();
      const count = fresh.count ?? null;
      // Awaited, not fire-and-forget: an unhandled rejection in a background
      // write is exactly the kind of silence this codebase keeps paying for.
      await writeEntry(name, fresh.data, count, at);
      return {
        data: fresh.data,
        error: null,
        ...(count !== null ? { count } : {}),
        fromCache: false,
        cachedAt: at,
        asOf: formatAsOf(at),
      };
    } catch (err) {
      // An RLS denial or a 400 is a real answer — never paper over it.
      if (options?.offlineFallback && isOfflineError(err)) {
        const hit = await readEntry<T>(name, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
        if (hit) {
          log.info('OfflineCache', `served ${name} from cache`, { cachedAt: hit.fetchedAt });
          return {
            data: hit.data,
            error: null,
            ...(hit.count !== null ? { count: hit.count } : {}),
            fromCache: true,
            cachedAt: hit.fetchedAt,
            asOf: formatAsOf(hit.fetchedAt),
          };
        }
      }
      // Diagnostic trail. Split on purpose: only log.error is persisted to
      // 'healthdrop:lastErrors' (logger.ts:121), and that store holds 50
      // entries. A worker with no signal generates a transport failure on
      // every screen she opens, so persisting those would evict the real
      // faults within minutes — they stay in the 300-entry ring buffer, which
      // getRecentLogs() reads. Anything NOT transport-shaped is unexpected and
      // does earn a persisted record.
      const transport = isOfflineError(err) || isCancelledError(err);
      if (transport) {
        log.warn('OfflineCache', `read failed for ${name}`, err);
      } else {
        log.error('OfflineCache', `read failed for ${name}`, err);
      }
      return {
        data: null,
        error: describeRequestError(err, options?.fallbackMessage),
        ...NOOP_STAMP,
      };
    }
  },

  /** The last successful result for `name`, or null. Never throws. */
  async peek<T>(
    name: string,
    maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  ): Promise<{ data: T; fetchedAt: string; asOf: string } | null> {
    const hit = await readEntry<T>(name, maxAgeMs);
    if (!hit) return null;
    return { data: hit.data, fetchedAt: hit.fetchedAt, asOf: formatAsOf(hit.fetchedAt) };
  },

  /**
   * Drop every cached read whose name starts with `prefix`, for the signed-in
   * user. Called after a write so the next read cannot serve a copy that the
   * user's own action has already contradicted.
   */
  async invalidate(prefix: string): Promise<void> {
    try {
      const owner = await ownerId();
      if (!owner) return;
      const doomed = (await keysForOwner(owner)).filter((k) =>
        k.startsWith(`${cacheKeyFor(owner, prefix)}`),
      );
      if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
    } catch (err) {
      log.warn('OfflineCache', `invalidate('${prefix}') failed`, err);
    }
  },

  /**
   * Drop the cached reads a just-SYNCED queue item contradicts.
   *
   * NOT YET WIRED — and that is a real gap, not a nicety. The service that
   * owns the moment a queued report lands on the server
   * (src/services/offlineSync/OfflineSyncService.ts, syncItem() line ~323) is
   * outside this change's file ownership, so this function currently has zero
   * callers. Until it is called, a report filed with no signal and synced an
   * hour later leaves the cache holding a list assembled BEFORE her report
   * existed — and the one row missing from it would be hers.
   *
   * The two lines it needs, at the point the item is marked 'synced':
   *
   *   import { offlineCache } from '../../../lib/offlineCache';
   *   await syncQueue.updateItem(fresh.localId, { status: 'synced' });
   *   await offlineCache.invalidateForSyncedType(fresh.type);   // ← add
   *
   * Unknown types and types that own no cache namespace are a silent no-op, so
   * adding a queue type never breaks this, and it never throws — a failed
   * invalidation must not turn a successful sync into a failed one.
   */
  async invalidateForSyncedType(queueItemType: string): Promise<void> {
    const namespaces = SYNC_TYPE_CACHE_NAMESPACES[queueItemType];
    if (!namespaces || namespaces.length === 0) return;
    for (const ns of namespaces) {
      await this.invalidate(ns);
    }
  },

  /**
   * Purge one user's cached reads — call on sign-out so a shared handset
   * carries nothing forward. Reads are owner-checked anyway (rule 1), so a
   * missed purge cannot leak; it only wastes space.
   */
  async clearForUser(userId: string): Promise<void> {
    try {
      const doomed = await keysForOwner(userId);
      if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
    } catch (err) {
      log.warn('OfflineCache', 'clearForUser failed', err);
    }
  },

  /** Purge every cached read for every user on this device. */
  async clearAll(): Promise<void> {
    try {
      const all = await AsyncStorage.getAllKeys();
      const doomed = Array.from(all).filter((k) => k.startsWith(CACHE_PREFIX));
      if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
    } catch (err) {
      log.warn('OfflineCache', 'clearAll failed', err);
    }
  },
};

export default offlineCache;
