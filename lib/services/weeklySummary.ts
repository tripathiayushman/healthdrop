// =====================================================
// WEEKLY DISTRICT SUMMARY SERVICE (Bharosa D·03)
// Builds the "HEALTHDROP WEEKLY · W{n}" figures for one
// district and one ISO week (Mon–Sun), plus the three
// artifacts that leave the app: a <500-char plain-text
// WhatsApp caption, a 1-page IDSP-style print sheet, and
// a big-type bilingual POSTER for handing round a village
// (NEW-07).
//
// THE GUARANTEE — VERIFIED DATA ONLY:
// every figure that has an approval concept is computed
// exclusively from human-approved rows
// (approval_status = 'approved'). Zeros are real zeros:
// the queries ran and found nothing.
//
// Point-in-time caveat (stated, never hidden): source
// state (waterUnsafe) and outbreak day-age are read from
// current rows — for past weeks they answer "as of now",
// because the tables keep no per-week state history.
//
// OFFLINE (NEW-10). loadWeeklySummary() is read-through:
// live figures are written to a small AsyncStorage cache
// owned entirely by this file, and a failed live read is
// answered from that cache with the fetch instant
// attached, so the screen can say "as of 14:32" instead
// of showing an empty page in the village with no signal.
// A cache MISS is never dressed up as a zero week — it
// rethrows and the screen renders error-with-retry.
//
// Deliberately NOT lib/offlineCache.ts: that module is
// under concurrent edit by another agent and its key
// namespace ('healthdrop:rcache:v1:') is swept by its own
// invalidate()/purge paths. This cache uses a disjoint
// prefix so neither can evict the other.
//
// EVERY ARTIFACT THAT LEAVES THE APP carries district,
// ISO week, the data instant and the export instant, and
// says in words that it is a snapshot rather than live
// data — once it is in a WhatsApp group it cannot be
// corrected. Nothing here sends anything: every artifact
// is produced only when a human presses a button, per the
// human-approval boundary (§2.3).
// =====================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDays,
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from 'date-fns';
import {
  describeRequestError,
  isOfflineError,
  readPersistedUserId,
  supabase,
} from '../supabase';

/** Week-nav cap: the screen may go at most this many ISO weeks back. */
export const MAX_WEEKS_BACK = 8;

/**
 * "Field staff" for the ack-rate denominator: the people an
 * approved alert reaches on the ground and who acknowledge it
 * ("I've seen this — I'll inform my area").
 */
export const FIELD_STAFF_ROLES = ['asha_worker', 'volunteer'] as const;

export interface TopDisease {
  name: string;
  count: number;
}

export interface OutbreakAgeItem {
  id: string;
  /** Short human tag derived from the uuid, e.g. "OB-3F2A". */
  shortId: string;
  disease: string;
  status: string;
  /** Whole days since the outbreak row was created, capped at the week end. */
  dayAge: number;
}

export interface WeeklySummary {
  district: string;
  isoWeek: number;
  isoYear: number;
  /** e.g. "W31" */
  weekTag: string;
  /** e.g. "W30" — the comparison week for the cases delta. */
  prevWeekTag: string;
  /** e.g. "27 Jul – 2 Aug 2026" */
  rangeLabel: string;
  /** e.g. "W31 · 27 Jul – 2 Aug 2026" */
  weekLabel: string;
  /** ISO instant of the week's Monday 00:00 (local). */
  weekStartIso: string;
  /** Exclusive ISO end bound (next Monday 00:00, local). */
  weekEndIso: string;
  /** Sum of cases_count over APPROVED disease reports created in the week. */
  newCasesApproved: number;
  /** Same figure for the previous ISO week. */
  prevWeekCases: number;
  /** newCasesApproved − prevWeekCases (positive = rising). */
  casesDelta: number;
  /** Top 3 diseases by approved case count this week. */
  topDiseases: TopDisease[];
  /** Sum of deaths_count over APPROVED disease reports created in the week. */
  deaths: number;
  /** Outbreaks that overlapped the week, with day-age (see caveat above). */
  activeOutbreaks: { count: number; items: OutbreakAgeItem[] };
  /** Water sources currently unsafe/critical in the district (as of now). */
  waterUnsafe: number;
  /** Water sources reopened (retested safe) during the week. */
  waterRetestedSafe: number;
  /** Health alerts APPROVED during the week (by approved_at). */
  alertsIssued: number;
  /** Distinct field users who acknowledged any of this week's alerts. */
  ackCount: number;
  /** Active field staff in the district, or null when unavailable. */
  fieldStaffCount: number | null;
  /**
   * ackCount ÷ fieldStaffCount, in 0..1.
   * null when there were no alerts to acknowledge, or when the staff
   * count is unavailable/zero — never a fabricated figure.
   */
  ackRate: number | null;
  generatedAtIso: string;
}

/** Where the figures on screen actually came from. */
export type SummarySource = 'live' | 'cache';

/** What loadWeeklySummary() hands the screen. */
export interface WeeklySummaryResult {
  summary: WeeklySummary;
  source: SummarySource;
  /**
   * ISO instant of the network read that produced these figures. Equal to
   * summary.generatedAtIso; kept separate because it stays true after the
   * payload has been sitting on the phone for a day.
   */
  fetchedAtIso: string;
  /**
   * Only when source === 'cache': the honest reason the live read failed,
   * already rendered as human copy. null on the live path.
   */
  staleReason: string | null;
  /** True when the live attempt failed for transport reasons (no signal / stalled). */
  offline: boolean;
}

/** Shared options for the three artifacts that leave the app. */
export interface ArtifactOptions {
  /**
   * The instant the human pressed share/save. Defaults to now. Distinct from
   * summary.generatedAtIso, which is when the FIGURES were read — sharing a
   * cached digest a day later must show both, not one pretending to be the other.
   */
  exportedAtIso?: string;
  /** True when the figures were served from this phone's cache. */
  fromCache?: boolean;
}

// ─────────────────────────────────────────────────────
//  Week math (ISO weeks, Monday–Sunday)
// ─────────────────────────────────────────────────────

export interface WeekWindow {
  start: Date;
  /** Exclusive end (next Monday 00:00). */
  end: Date;
  isoWeek: number;
  isoYear: number;
  weekTag: string;
  prevWeekTag: string;
  rangeLabel: string;
  weekLabel: string;
}

/** Resolve the ISO week window `weekOffset` weeks before the current one. */
export function getWeekWindow(weekOffset = 0, now: Date = new Date()): WeekWindow {
  const anchor = subWeeks(now, Math.max(0, weekOffset));
  const start = startOfISOWeek(anchor);
  const end = addWeeks(start, 1);
  const lastDay = addDays(start, 6);
  const isoWeek = getISOWeek(start);
  const isoYear = getISOWeekYear(start);
  const prevStart = subWeeks(start, 1);
  const sameMonth =
    start.getMonth() === lastDay.getMonth() && start.getFullYear() === lastDay.getFullYear();
  const rangeLabel = sameMonth
    ? `${format(start, 'd')} – ${format(lastDay, 'd MMM yyyy')}`
    : `${format(start, 'd MMM')} – ${format(lastDay, 'd MMM yyyy')}`;
  const weekTag = `W${isoWeek}`;
  return {
    start,
    end,
    isoWeek,
    isoYear,
    weekTag,
    prevWeekTag: `W${getISOWeek(prevStart)}`,
    rangeLabel,
    weekLabel: `${weekTag} · ${rangeLabel}`,
  };
}

// ─────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────

interface DiseaseRow {
  disease_name: string | null;
  cases_count: number | null;
  deaths_count: number | null;
}

const displayDiseaseName = (raw: string): string => {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Unknown';
};

/** Sum + top-3 aggregation over one week's approved disease rows. */
function aggregateDiseaseRows(rows: DiseaseRow[]): {
  cases: number;
  deaths: number;
  top: TopDisease[];
} {
  let cases = 0;
  let deaths = 0;
  const byName = new Map<string, TopDisease>();
  for (const row of rows) {
    const count = Math.max(0, row.cases_count ?? 0);
    cases += count;
    deaths += Math.max(0, row.deaths_count ?? 0);
    const key = (row.disease_name ?? 'unknown').trim().toLowerCase() || 'unknown';
    const existing = byName.get(key);
    if (existing) {
      existing.count += count;
    } else {
      byName.set(key, { name: displayDiseaseName(row.disease_name ?? 'Unknown'), count });
    }
  }
  const top = Array.from(byName.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return { cases, deaths, top };
}

/** Approved disease rows created inside [startIso, endIso). */
async function fetchApprovedDiseaseRows(
  district: string,
  startIso: string,
  endIso: string,
): Promise<DiseaseRow[]> {
  const { data, error } = await supabase
    .from('disease_reports')
    .select('disease_name, cases_count, deaths_count')
    .eq('district', district)
    .eq('approval_status', 'approved')
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) throw new Error(error.message);
  return (data ?? []) as DiseaseRow[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────
//  The builder
// ─────────────────────────────────────────────────────

/**
 * Build the D·03 weekly summary for a district.
 * @param district  exact district name as stored in the DB
 * @param weekOffset 0 = current ISO week, 1 = last week, … (max MAX_WEEKS_BACK)
 * @throws Error when any core query fails — callers render the error state;
 *         only the field-staff count degrades gracefully (ackRate: null).
 */
export async function buildWeeklySummary(
  district: string,
  weekOffset = 0,
): Promise<WeeklySummary> {
  const trimmedDistrict = district.trim();
  if (!trimmedDistrict) {
    throw new Error('A district is required to build a weekly summary.');
  }
  const offset = Math.min(Math.max(0, Math.floor(weekOffset)), MAX_WEEKS_BACK);

  const now = new Date();
  const week = getWeekWindow(offset, now);
  const prevWeek = getWeekWindow(offset + 1, now);
  const weekStartIso = week.start.toISOString();
  const weekEndIso = week.end.toISOString();

  const [thisWeekRows, prevWeekRows, outbreakRes, unsafeRes, reopenedRes, alertRes, staffRes] =
    await Promise.all([
      fetchApprovedDiseaseRows(trimmedDistrict, weekStartIso, weekEndIso),
      fetchApprovedDiseaseRows(
        trimmedDistrict,
        prevWeek.start.toISOString(),
        prevWeek.end.toISOString(),
      ),
      // Outbreaks that overlapped the week: created before the week ended
      // AND (still open now, or resolved on/after the week started).
      supabase
        .from('outbreaks')
        .select('id, disease_name, status, created_at, resolved_at')
        .eq('district', trimmedDistrict)
        .lt('created_at', weekEndIso)
        .or(`status.in.(active,monitoring),resolved_at.gte.${weekStartIso}`),
      // Currently unsafe sources — includes legacy vocab ('poor' ≙ unsafe,
      // 'contaminated' ≙ critical) per getWaterQualityColor().
      supabase
        .from('water_sources')
        .select('id', { count: 'exact', head: true })
        .eq('district', trimmedDistrict)
        .in('current_status', ['unsafe', 'critical', 'poor', 'contaminated']),
      // Sources whose flag→fix→retest loop closed during the week.
      supabase
        .from('water_sources')
        .select('id', { count: 'exact', head: true })
        .eq('district', trimmedDistrict)
        .gte('reopened_at', weekStartIso)
        .lt('reopened_at', weekEndIso),
      // Alerts a human approved during the week.
      supabase
        .from('health_alerts')
        .select('id')
        .eq('district', trimmedDistrict)
        .eq('approval_status', 'approved')
        .gte('approved_at', weekStartIso)
        .lt('approved_at', weekEndIso),
      // Denominator for ack rate — allowed to fail independently (→ null).
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('district', trimmedDistrict)
        .eq('is_active', true)
        .in('role', [...FIELD_STAFF_ROLES]),
    ]);

  if (outbreakRes.error) throw new Error(outbreakRes.error.message);
  if (unsafeRes.error) throw new Error(unsafeRes.error.message);
  if (reopenedRes.error) throw new Error(reopenedRes.error.message);
  if (alertRes.error) throw new Error(alertRes.error.message);

  const thisWeekAgg = aggregateDiseaseRows(thisWeekRows);
  const prevWeekAgg = aggregateDiseaseRows(prevWeekRows);

  // Day-age is measured to the earlier of "now" and the week's end so a
  // past week's summary doesn't inflate ages with time that came later.
  const ageCap = Math.min(now.getTime(), week.end.getTime());
  const outbreakItems: OutbreakAgeItem[] = ((outbreakRes.data ?? []) as Array<{
    id: string;
    disease_name: string | null;
    status: string | null;
    created_at: string;
  }>).map((row) => {
    const createdMs = new Date(row.created_at).getTime();
    const dayAge = Number.isFinite(createdMs)
      ? Math.max(1, Math.floor((ageCap - createdMs) / MS_PER_DAY) + 1)
      : 1;
    return {
      id: row.id,
      shortId: `OB-${row.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`,
      disease: displayDiseaseName(row.disease_name ?? 'Unknown'),
      status: row.status ?? 'active',
      dayAge,
    };
  });

  const alertIds = ((alertRes.data ?? []) as Array<{ id: string }>).map((row) => row.id);

  // Acks on this week's alerts — distinct field users who acknowledged.
  let ackCount = 0;
  if (alertIds.length > 0) {
    const { data: ackRows, error: ackError } = await supabase
      .from('alert_acknowledgements')
      .select('alert_id, user_id')
      .in('alert_id', alertIds);
    if (ackError) throw new Error(ackError.message);
    const distinctUsers = new Set(
      ((ackRows ?? []) as Array<{ user_id: string | null }>)
        .map((row) => row.user_id)
        .filter((id): id is string => !!id),
    );
    ackCount = distinctUsers.size;
  }

  // Staff count is the one honest degradation: if it failed we return
  // null and the UI shows "—" — a rate is never invented.
  const fieldStaffCount = staffRes.error ? null : staffRes.count ?? null;
  const ackRate =
    alertIds.length > 0 && fieldStaffCount !== null && fieldStaffCount > 0
      ? Math.min(1, ackCount / fieldStaffCount)
      : null;

  return {
    district: trimmedDistrict,
    isoWeek: week.isoWeek,
    isoYear: week.isoYear,
    weekTag: week.weekTag,
    prevWeekTag: week.prevWeekTag,
    rangeLabel: week.rangeLabel,
    weekLabel: week.weekLabel,
    weekStartIso,
    weekEndIso,
    newCasesApproved: thisWeekAgg.cases,
    prevWeekCases: prevWeekAgg.cases,
    casesDelta: thisWeekAgg.cases - prevWeekAgg.cases,
    topDiseases: thisWeekAgg.top,
    deaths: thisWeekAgg.deaths,
    activeOutbreaks: { count: outbreakItems.length, items: outbreakItems },
    waterUnsafe: unsafeRes.count ?? 0,
    waterRetestedSafe: reopenedRes.count ?? 0,
    alertsIssued: alertIds.length,
    ackCount,
    fieldStaffCount,
    ackRate,
    generatedAtIso: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────
//  Offline cache (NEW-10) — owned entirely by this file
//
//  One AsyncStorage row per (user, district, ISO week).
//  The payload is a few hundred bytes; eight weeks of
//  navigation costs well under 10 KB, so it can never
//  crowd out the sync queue that holds unsent reports.
// ─────────────────────────────────────────────────────

/** Disjoint from lib/offlineCache.ts's 'healthdrop:rcache:v1:' on purpose. */
const WEEKLY_CACHE_PREFIX = 'healthdrop:wsum:v1:';

/**
 * Past weeks are frozen history and stay useful for a long time; the current
 * week goes stale fast. One ceiling covers both because the fetch instant
 * travels with the payload and is always shown — the human judges, not us.
 */
const WEEKLY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A runaway outbreak list must not become a multi-megabyte AsyncStorage row. */
const MAX_CACHE_ENTRY_CHARS = 64 * 1024;

interface CacheEnvelope {
  v: 1;
  owner: string;
  district: string;
  isoYear: number;
  isoWeek: number;
  fetchedAt: string;
  summary: WeeklySummary;
}

/** District names differ only by case/spacing between rows; the key must not. */
const districtKey = (district: string): string =>
  district.trim().toLowerCase().replace(/\s+/g, '-') || 'unknown';

const weeklyCacheKey = (
  owner: string,
  district: string,
  isoYear: number,
  isoWeek: number,
): string =>
  `${WEEKLY_CACHE_PREFIX}${owner}:${districtKey(district)}:${isoYear}-W${String(isoWeek).padStart(2, '0')}`;

/**
 * Validate a stored blob. Corrupt, foreign-owner, wrong-week and expired all
 * collapse to null — that is a cache MISS, which the caller turns into an
 * error-with-retry. It is never turned into an empty week: "no data" and "the
 * read failed" must not look the same.
 */
function parseWeeklyEnvelope(
  raw: string | null,
  owner: string,
  district: string,
  isoYear: number,
  isoWeek: number,
  nowMs: number,
): CacheEnvelope | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const env = parsed as Partial<CacheEnvelope>;
  if (env.v !== 1) return null;
  if (env.owner !== owner) return null;
  if (districtKey(env.district ?? '') !== districtKey(district)) return null;
  if (env.isoYear !== isoYear || env.isoWeek !== isoWeek) return null;
  if (typeof env.fetchedAt !== 'string') return null;
  const fetchedMs = new Date(env.fetchedAt).getTime();
  if (!Number.isFinite(fetchedMs) || nowMs - fetchedMs > WEEKLY_CACHE_MAX_AGE_MS) return null;
  const summary = env.summary;
  // Shape check on the fields every artifact reads. A half-written row must
  // not reach a poster that then leaves the app.
  if (
    !summary ||
    typeof summary !== 'object' ||
    typeof summary.newCasesApproved !== 'number' ||
    typeof summary.deaths !== 'number' ||
    typeof summary.weekTag !== 'string' ||
    typeof summary.generatedAtIso !== 'string' ||
    !summary.activeOutbreaks ||
    typeof summary.activeOutbreaks.count !== 'number' ||
    !Array.isArray(summary.activeOutbreaks.items) ||
    !Array.isArray(summary.topDiseases)
  ) {
    return null;
  }
  return env as CacheEnvelope;
}

/**
 * Store one week's figures. Never throws and never reports failure upward:
 * a full disk must not turn a successful read into an error on screen.
 */
export async function cacheWeeklySummary(summary: WeeklySummary): Promise<void> {
  try {
    const owner = await readPersistedUserId();
    if (!owner) return; // signed out — nothing may be written under no owner
    const envelope: CacheEnvelope = {
      v: 1,
      owner,
      district: summary.district,
      isoYear: summary.isoYear,
      isoWeek: summary.isoWeek,
      fetchedAt: summary.generatedAtIso,
      summary,
    };
    const raw = JSON.stringify(envelope);
    if (raw.length > MAX_CACHE_ENTRY_CHARS) return;
    await AsyncStorage.setItem(
      weeklyCacheKey(owner, summary.district, summary.isoYear, summary.isoWeek),
      raw,
    );
  } catch {
    // Cache writes are best-effort by definition. Swallowing here hides
    // nothing from the user: the live figures they asked for are on screen.
  }
}

/**
 * The last good copy of one week, or null. Never throws.
 * Exported so a caller can pre-check offline availability without a fetch.
 */
export async function readCachedWeeklySummary(
  district: string,
  weekOffset = 0,
  now: Date = new Date(),
): Promise<{ summary: WeeklySummary; fetchedAtIso: string } | null> {
  try {
    const trimmed = district.trim();
    if (!trimmed) return null;
    const owner = await readPersistedUserId();
    if (!owner) return null;
    const offset = Math.min(Math.max(0, Math.floor(weekOffset)), MAX_WEEKS_BACK);
    const week = getWeekWindow(offset, now);
    const raw = await AsyncStorage.getItem(
      weeklyCacheKey(owner, trimmed, week.isoYear, week.isoWeek),
    );
    const env = parseWeeklyEnvelope(
      raw,
      owner,
      trimmed,
      week.isoYear,
      week.isoWeek,
      now.getTime(),
    );
    return env ? { summary: env.summary, fetchedAtIso: env.fetchedAt } : null;
  } catch {
    return null;
  }
}

/**
 * Read-through loader — what the screen calls.
 *
 * Live first (the figures are safety-relevant and a fresh answer is always
 * preferred). On failure, fall back to this phone's cached copy and hand back
 * the fetch instant plus the reason, so the screen shows the digest with an
 * "as of" stamp instead of an empty page.
 *
 * @throws when the live read failed AND there is no cached copy. That is the
 *         only honest outcome: the screen renders error-with-retry. It must
 *         never be flattened into a quiet zero week.
 */
export async function loadWeeklySummary(
  district: string,
  weekOffset = 0,
): Promise<WeeklySummaryResult> {
  try {
    const summary = await buildWeeklySummary(district, weekOffset);
    await cacheWeeklySummary(summary);
    return {
      summary,
      source: 'live',
      fetchedAtIso: summary.generatedAtIso,
      staleReason: null,
      offline: false,
    };
  } catch (err) {
    const cached = await readCachedWeeklySummary(district, weekOffset);
    if (!cached) throw new Error(describeRequestError(err));
    return {
      summary: cached.summary,
      source: 'cache',
      fetchedAtIso: cached.fetchedAtIso,
      staleReason: describeRequestError(err),
      offline: isOfflineError(err),
    };
  }
}

// ─────────────────────────────────────────────────────
//  Artifact 1 — plain-text WhatsApp caption (<500 chars)
//  "A text-only caption rides along so the numbers
//   survive even when the PDF is never downloaded."
// ─────────────────────────────────────────────────────

export function formatAckRate(summary: Pick<WeeklySummary, 'ackRate'>): string {
  return summary.ackRate === null ? '—' : `${Math.round(summary.ackRate * 100)}%`;
}

export function formatCasesDelta(
  summary: Pick<WeeklySummary, 'casesDelta' | 'prevWeekTag'>,
): string {
  if (summary.casesDelta > 0) return `▲ ${summary.casesDelta} vs ${summary.prevWeekTag}`;
  if (summary.casesDelta < 0) return `▼ ${Math.abs(summary.casesDelta)} vs ${summary.prevWeekTag}`;
  return `same as ${summary.prevWeekTag}`;
}

const MAX_CAPTION_CHARS = 500;

/** "3 Aug 2026, 14:32" — the one instant format every artifact uses. */
const formatInstant = (iso: string): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'unknown time' : format(at, 'd MMM yyyy, HH:mm');
};

/**
 * The provenance sentences every outbound artifact carries.
 *
 * A shared file cannot be recalled or corrected, so it states four things
 * without being asked: which district, which week, when the figures were read,
 * and that it is a snapshot rather than a live feed. `dataLine` differs from
 * `exportLine` on purpose — sharing a cached digest a day later must not let
 * the export time pass itself off as the data time.
 */
export function buildProvenanceLines(
  summary: WeeklySummary,
  options: ArtifactOptions = {},
): { dataLine: string; exportLine: string; snapshotLine: string; audienceLine: string } {
  const exportedAtIso = options.exportedAtIso ?? new Date().toISOString();
  const dataAt = formatInstant(summary.generatedAtIso);
  return {
    dataLine: options.fromCache
      ? `Figures read ${dataAt} (saved copy on the sender's phone).`
      : `Figures read ${dataAt}.`,
    exportLine: `Shared ${formatInstant(exportedAtIso)} · ${summary.district} · ${summary.weekTag}.`,
    snapshotLine: 'Snapshot of HealthDrop records — not live data.',
    audienceLine: 'For health staff. Not an official public notice.',
  };
}

/**
 * Plain-text caption for low-data recipients.
 *
 * Assembled as head + body + tail against a character budget so the
 * provenance tail can never be the part that gets truncated away — the old
 * implementation sliced the whole string at 497 chars, which on a district
 * with several outbreaks would have cut off the VERIFIED line and the
 * generated-at stamp and left only unattributed numbers travelling through
 * WhatsApp. Optional detail is dropped in order of least value instead.
 */
export function buildWhatsAppCaption(
  summary: WeeklySummary,
  options: ArtifactOptions = {},
): string {
  const provenance = buildProvenanceLines(summary, options);
  const head = [
    `HEALTHDROP WEEKLY · ${summary.weekTag}`,
    `${summary.rangeLabel} · ${summary.district}`,
  ];
  const tail = [
    '✓ VERIFIED — human-approved reports only',
    provenance.snapshotLine,
    provenance.dataLine,
  ];

  const outbreakDetail =
    summary.activeOutbreaks.count > 0
      ? ` (${summary.activeOutbreaks.items
          .slice(0, 2)
          .map((o) => `${o.shortId} day ${o.dayAge}`)
          .join(', ')}${
          summary.activeOutbreaks.count > 2 ? `, +${summary.activeOutbreaks.count - 2} more` : ''
        })`
      : '';

  const bodyFor = (topCount: number, withOutbreakDetail: boolean): string[] => [
    `New cases (approved): ${summary.newCasesApproved} (${formatCasesDelta(summary)})`,
    `Top: ${
      summary.topDiseases.length > 0
        ? summary.topDiseases
            .slice(0, topCount)
            .map((d) => `${d.name} ${d.count}`)
            .join(' · ')
        : 'none'
    }`,
    `Deaths: ${summary.deaths}`,
    `Active outbreaks: ${summary.activeOutbreaks.count}${withOutbreakDetail ? outbreakDetail : ''}`,
    `Water: ${summary.waterUnsafe} unsafe now · ${summary.waterRetestedSafe} retested safe`,
    `Alerts: ${summary.alertsIssued} issued · ack ${formatAckRate(summary)}`,
  ];

  // Degrade in order: full → drop outbreak ids → top 2 → top 1.
  const attempts: string[][] = [
    bodyFor(summary.topDiseases.length, true),
    bodyFor(summary.topDiseases.length, false),
    bodyFor(2, false),
    bodyFor(1, false),
  ];
  for (const body of attempts) {
    const caption = [...head, ...body, ...tail].join('\n');
    if (caption.length <= MAX_CAPTION_CHARS) return caption;
  }

  // Still over budget (a pathological disease name). Truncate the BODY only;
  // head and tail — which say what this is and where it came from — survive.
  const minimalBody = bodyFor(1, false);
  // The assembled string is head + ONE body block + tail, so it costs the
  // fixed lines, their separators, and one more separator for the block.
  const fixedText = [...head, ...tail].join('\n');
  const budget = Math.max(0, MAX_CAPTION_CHARS - fixedText.length - 1);
  const bodyText = minimalBody.join('\n');
  const trimmed =
    bodyText.length <= budget ? bodyText : `${bodyText.slice(0, Math.max(0, budget - 1))}…`;
  return [...head, trimmed, ...tail].join('\n');
}

// ─────────────────────────────────────────────────────
//  Artifacts 2 and 3 — print HTML
//
//  A PDF is a fixed-light paper document that leaves the
//  app; it cannot read useTheme(), so its palette is
//  pinned here: near-black ink on white, one green for
//  the VERIFIED stamp (print equivalents of the Bharosa
//  ink/success tokens).
//
//  These four constants are the ONLY hex literals this
//  feature owns, and they are in a service rather than a
//  component precisely because they describe ink on
//  paper, not the app's surface. Nothing on screen uses
//  them; the screen is 100% useTheme() tokens.
// ─────────────────────────────────────────────────────

const PRINT_INK = '#111111';
const PRINT_INK_SOFT = '#555555';
const PRINT_RULE = '#cccccc';
const PRINT_STAMP_GREEN = '#157A3C';

/**
 * A4 at 72 PPI, in the units expo-print's `width`/`height` options take.
 *
 * Read out of the INSTALLED module rather than assumed, because the previous
 * `@page { size: A4; margin: 18mm }` was decorative twice over:
 *
 *  • Paper size. Both platforms default to 612 × 792 — US LETTER, not A4
 *    (`android/.../PrintPDFRenderTask.kt:23-24` DEFAULT_MEDIA_WIDTH/HEIGHT,
 *    `ios/PrintOptions.swift:42` kLetterPaperSize). The renderer imposes the
 *    page box, so a CSS `@page size` cannot change the PDF's page. A district
 *    sheet meant for an Indian office was coming out on American paper.
 *
 *  • Margin. Both platforms default the printable inset to ZERO — Android
 *    builds its PrintAttributes with `Margins.NO_MARGINS`
 *    (`PrintPDFRenderTask.kt:78`), iOS returns `UIEdgeInsets.zero`
 *    (`PrintOptions.swift:61-72`) — and iOS renders through
 *    UIPrintPageRenderer/printableRect, which does not honour CSS `@page`
 *    margins at all. So the poster's 3px border could land hard against the
 *    paper edge, which is exactly where a physical printer clips it.
 *
 * The fix is to state the size to the module (below) and to make the margin
 * real `padding` on <body> in physical `mm`, which every renderer honours.
 */
export const PRINT_PAGE = { width: 595, height: 842 } as const;

/**
 * Shared page CSS for both artifacts.
 * `@page margin: 0` because the paper margin is now body padding — declaring it
 * in both places would double it on the one renderer that does honour `@page`.
 * `print-color-adjust` keeps the green VERIFIED stamp — the only meaningful
 * colour on the sheet — from being dropped by a colour-saving print path.
 */
const pageCss = (paddingMm: number): string => `
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body {
        padding: ${paddingMm}mm;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }`;

/**
 * Monochrome pictograms for the poster.
 *
 * Inline SVG, not emoji and not an icon font: the poster is rendered by the
 * platform WebView into a PDF that will be viewed on unknown devices and may
 * be printed in black and white at a panchayat office. SVG paths survive all
 * of that; a colour emoji does not render consistently in Android's
 * PrintedPdfDocument, and @expo/vector-icons is a React component library that
 * cannot be reached from an HTML string at all.
 *
 * Shapes are deliberately distinct (circle / square / triangle / droplet /
 * bell) so the rows are separable without colour and without reading — the
 * NEW-09 shape-ladder idea applied to paper.
 */
const POSTER_GLYPHS: Record<string, string> = {
  cases: '<circle cx="10" cy="10" r="7.5"/>',
  deaths: '<rect x="2.5" y="2.5" width="15" height="15" rx="2.5"/>',
  outbreak: '<path d="M10 1.8 L18.6 17.6 H1.4 Z"/>',
  water:
    '<path d="M10 1.4 C10 1.4 3.2 9.2 3.2 12.9 A6.8 6.8 0 0 0 16.8 12.9 C16.8 9.2 10 1.4 10 1.4 Z"/>',
  alert:
    '<path d="M10 1.8 a5.2 5.2 0 0 0-5.2 5.2 v3.3 L3 13.7 h14 L15.2 10.3 V7 A5.2 5.2 0 0 0 10 1.8 Z"/><path d="M7.9 15.1 a2.1 2.1 0 0 0 4.2 0 Z"/>',
};

const posterGlyph = (name: keyof typeof POSTER_GLYPHS | string): string =>
  `<svg class="glyph" viewBox="0 0 20 20" width="22" height="22" fill="${PRINT_INK}" role="presentation">${
    POSTER_GLYPHS[name] ?? POSTER_GLYPHS.cases
  }</svg>`;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function buildSummaryHtml(
  summary: WeeklySummary,
  options: ArtifactOptions = {},
): string {
  const provenance = buildProvenanceLines(summary, options);
  const district = escapeHtml(summary.district);
  const topNames =
    summary.topDiseases.length > 0
      ? summary.topDiseases.map((d) => escapeHtml(d.name)).join(' / ')
      : 'None';
  const topCounts =
    summary.topDiseases.length > 0
      ? summary.topDiseases.map((d) => String(d.count)).join(' / ')
      : '0';
  const outbreakValue =
    summary.activeOutbreaks.count > 0
      ? `${summary.activeOutbreaks.count} (${summary.activeOutbreaks.items
          .map((o) => `${escapeHtml(o.shortId)}, day ${o.dayAge}`)
          .join('; ')})`
      : '0';
  const ackDetail =
    summary.ackRate !== null && summary.fieldStaffCount !== null
      ? ` (${summary.ackCount} of ${summary.fieldStaffCount} field staff)`
      : '';
  const row = (label: string, value: string) => `
      <tr>
        <td class="label">${label}</td>
        <td class="value">${value}</td>
      </tr>`;

  return `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${pageCss(16)}
      body {
        font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: ${PRINT_INK};
        font-size: 12px;
        line-height: 1.5;
      }
      .sheet { border: 2px solid ${PRINT_INK}; padding: 20px 24px; }
      .eyebrow {
        font-size: 11px; font-weight: 700; letter-spacing: 2px;
        text-transform: uppercase;
      }
      h1 { font-size: 20px; margin: 2px 0 0; letter-spacing: 0.5px; }
      .meta { color: ${PRINT_INK_SOFT}; font-size: 12px; margin-top: 2px; }
      hr { border: 0; border-top: 1px solid ${PRINT_INK}; margin: 14px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 7px 0; border-bottom: 1px solid ${PRINT_RULE}; vertical-align: top; }
      td.label { font-weight: 600; padding-right: 16px; }
      td.value {
        text-align: right; font-weight: 700;
        font-variant-numeric: tabular-nums; white-space: nowrap;
      }
      .stamp {
        display: inline-block; margin-top: 18px; padding: 8px 14px;
        border: 2px solid ${PRINT_STAMP_GREEN}; color: ${PRINT_STAMP_GREEN};
        font-weight: 700; letter-spacing: 1px; font-size: 11px;
        text-transform: uppercase; transform: rotate(-1.2deg);
      }
      .stamp small {
        display: block; font-weight: 600; letter-spacing: 0.2px;
        text-transform: none; margin-top: 2px;
      }
      .footer { margin-top: 16px; color: ${PRINT_INK_SOFT}; font-size: 10px; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="eyebrow">Healthdrop Weekly · ${escapeHtml(summary.weekTag)} · IDSP format</div>
      <h1>Weekly District Health Summary</h1>
      <div class="meta">${escapeHtml(summary.rangeLabel)} · ${district}</div>
      <hr />
      <table>
        ${row('New cases (approved)', `${summary.newCasesApproved} · ${escapeHtml(formatCasesDelta(summary))}`)}
        ${row(`Top diseases — ${topNames}`, topCounts)}
        ${row('Deaths', String(summary.deaths))}
        ${row('Active outbreaks', outbreakValue)}
        ${row('Water: unsafe now / retested safe', `${summary.waterUnsafe} / ${summary.waterRetestedSafe}`)}
        ${row('Alerts issued / ack rate', `${summary.alertsIssued} / ${escapeHtml(formatAckRate(summary))}${ackDetail}`)}
      </table>
      <div class="stamp">
        ✓ Verified data
        <small>All figures from human-approved reports only</small>
      </div>
      <div class="footer">
        <strong>${escapeHtml(provenance.snapshotLine)}</strong>
        ${escapeHtml(provenance.dataLine)}
        ${escapeHtml(provenance.exportLine)}
        ${escapeHtml(provenance.audienceLine)}
        Source-state figures (unsafe sources, outbreak day-age) reflect records as of the read time.
      </div>
    </div>
  </body>
  </html>`;
}

// ─────────────────────────────────────────────────────
//  Artifact 3 — the POSTER (NEW-07)
//
//  The IDSP sheet above is a table for an officer's inbox.
//  This is the thing that gets forwarded into a village
//  WhatsApp group and read at arm's length: six numbers at
//  poster size, each with a pictogram and a bilingual
//  EN/हिन्दी label, and a footer that says what it is.
//
//  Bilingual by construction, NOT via t(): a poster is
//  read by whoever it reaches, so it must carry BOTH
//  languages at once. t() would resolve to exactly one.
// ─────────────────────────────────────────────────────

interface PosterStat {
  glyph: string;
  value: string;
  labelEn: string;
  labelHi: string;
  note?: string;
}

export function buildPosterHtml(summary: WeeklySummary, options: ArtifactOptions = {}): string {
  const provenance = buildProvenanceLines(summary, options);
  const topLine =
    summary.topDiseases.length > 0
      ? summary.topDiseases.map((d) => `${d.name} ${d.count}`).join(' · ')
      : 'No approved cases this week';

  const stats: PosterStat[] = [
    {
      glyph: 'cases',
      value: String(summary.newCasesApproved),
      labelEn: 'New cases (verified)',
      labelHi: 'नए मामले (सत्यापित)',
      note: formatCasesDelta(summary),
    },
    {
      glyph: 'deaths',
      value: String(summary.deaths),
      labelEn: 'Deaths',
      labelHi: 'मृत्यु',
    },
    {
      glyph: 'outbreak',
      value: String(summary.activeOutbreaks.count),
      labelEn: 'Active outbreaks',
      labelHi: 'सक्रिय प्रकोप',
      note:
        summary.activeOutbreaks.count > 0
          ? summary.activeOutbreaks.items
              .slice(0, 3)
              .map((o) => `${o.shortId} · day ${o.dayAge}`)
              .join('  ')
          : undefined,
    },
    {
      glyph: 'water',
      value: String(summary.waterUnsafe),
      labelEn: 'Water sources unsafe now',
      labelHi: 'अभी असुरक्षित जल स्रोत',
      note: `${summary.waterRetestedSafe} retested safe · ${summary.waterRetestedSafe} पुनः जाँच में सुरक्षित`,
    },
    {
      glyph: 'alert',
      value: String(summary.alertsIssued),
      labelEn: 'Alerts issued',
      labelHi: 'जारी अलर्ट',
      note:
        summary.ackRate !== null && summary.fieldStaffCount !== null
          ? `${summary.ackCount} of ${summary.fieldStaffCount} field staff acknowledged`
          : summary.alertsIssued > 0
            ? 'acknowledgement rate unavailable'
            : undefined,
    },
  ];

  const statCell = (s: PosterStat) => `
        <div class="stat">
          <div class="statTop">
            ${posterGlyph(s.glyph)}
            <span class="statValue">${escapeHtml(s.value)}</span>
          </div>
          <div class="statLabel">${escapeHtml(s.labelEn)}</div>
          <div class="statLabelHi">${escapeHtml(s.labelHi)}</div>
          ${s.note ? `<div class="statNote">${escapeHtml(s.note)}</div>` : ''}
        </div>`;

  return `
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${pageCss(13)}
      body {
        font-family: -apple-system, 'Segoe UI', Roboto, 'Noto Sans Devanagari', Helvetica, Arial, sans-serif;
        color: ${PRINT_INK};
        font-size: 13px;
        line-height: 1.45;
      }
      .poster { border: 3px solid ${PRINT_INK}; padding: 22px 24px; }
      .eyebrow {
        font-size: 13px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
      }
      h1 { font-size: 34px; line-height: 1.1; margin: 6px 0 0; letter-spacing: -0.5px; }
      h2 { font-size: 20px; line-height: 1.2; margin: 2px 0 0; font-weight: 700; }
      .where {
        margin-top: 10px; font-size: 17px; font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .whereSub { font-size: 14px; font-weight: 600; color: ${PRINT_INK_SOFT}; }
      hr { border: 0; border-top: 3px solid ${PRINT_INK}; margin: 14px 0 4px; }
      .grid { display: flex; flex-wrap: wrap; }
      .stat {
        width: 50%; padding: 12px 12px 12px 0; border-bottom: 1px solid ${PRINT_RULE};
      }
      .statTop { display: flex; align-items: center; }
      .glyph { margin-right: 10px; }
      .statValue {
        font-size: 40px; font-weight: 800; line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .statLabel { font-size: 14px; font-weight: 700; margin-top: 6px; }
      .statLabelHi { font-size: 14px; font-weight: 700; }
      .statNote {
        font-size: 12px; font-weight: 600; color: ${PRINT_INK_SOFT}; margin-top: 3px;
        font-variant-numeric: tabular-nums;
      }
      .top {
        margin-top: 14px; font-size: 15px; font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .topLabel { font-size: 13px; font-weight: 700; color: ${PRINT_INK_SOFT}; }
      .stamp {
        display: inline-block; margin-top: 18px; padding: 9px 15px;
        border: 3px solid ${PRINT_STAMP_GREEN}; color: ${PRINT_STAMP_GREEN};
        font-weight: 800; letter-spacing: 1px; font-size: 13px;
        text-transform: uppercase; transform: rotate(-1.2deg);
      }
      .stamp small {
        display: block; font-weight: 700; letter-spacing: 0.2px;
        text-transform: none; margin-top: 2px; font-size: 11px;
      }
      .footer {
        margin-top: 16px; padding-top: 10px; border-top: 1px solid ${PRINT_RULE};
        color: ${PRINT_INK_SOFT}; font-size: 11px; line-height: 1.6;
      }
      .footer strong { color: ${PRINT_INK}; display: block; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="poster">
      <div class="eyebrow">Healthdrop · ${escapeHtml(summary.weekTag)}</div>
      <h1>Weekly health summary</h1>
      <h2>साप्ताहिक स्वास्थ्य सारांश</h2>
      <div class="where">${escapeHtml(summary.district)} · ${escapeHtml(summary.rangeLabel)}</div>
      <div class="whereSub">ज़िला / District · सप्ताह / Week</div>
      <hr />
      <div class="grid">
        ${stats.map(statCell).join('')}
      </div>
      <div class="top">
        <span class="topLabel">Top diseases / प्रमुख बीमारियाँ:</span> ${escapeHtml(topLine)}
      </div>
      <div class="stamp">
        ✓ Verified data · सत्यापित आँकड़े
        <small>All figures from human-approved reports only · सभी आँकड़े केवल मानव-स्वीकृत रिपोर्टों से</small>
      </div>
      <div class="footer">
        <strong>${escapeHtml(provenance.snapshotLine)} · यह लाइव डेटा नहीं है।</strong>
        ${escapeHtml(provenance.dataLine)}
        ${escapeHtml(provenance.exportLine)}
        ${escapeHtml(provenance.audienceLine)} · स्वास्थ्य कर्मियों के लिए; यह आधिकारिक सार्वजनिक सूचना नहीं है।
      </div>
    </div>
  </body>
  </html>`;
}
