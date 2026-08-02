import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import i18next from './i18n';

// Supabase configuration - uses environment variables with fallback
// EXPO_PUBLIC_SUPABASE_KEY is the modern publishable key (sb_publishable_...);
// EXPO_PUBLIC_SUPABASE_ANON_KEY is the legacy JWT anon key kept as fallback.
//
// Exported because a SECOND client exists (lib/services/authRecovery.ts, which
// needs its own in-memory session). That file used to re-declare these two
// constants; two copies of a project URL is one copy too many, and the drift
// showed up as the recovery client silently missing the request deadline.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ekfdimdlxifatsaubvbh.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_pne9mF-cDQ_IPKJKn8a3AQ_Vm4Aa5x0';

const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = SUPABASE_ANON_KEY;

/**
 * The AsyncStorage/localStorage key GoTrue persists the session blob under.
 *
 * supabase-js derives this itself as `sb-${hostname.split('.')[0]}-auth-token`
 * (SupabaseClient.js:52, supabase-js 2.57.4). It is computed here and passed
 * back IN as `auth.storageKey` so the value cannot drift from what the client
 * actually uses — readPersistedUserId() below reads that exact blob, and a
 * silent mismatch there would mean the offline cache never finds an owner.
 */
export const AUTH_STORAGE_KEY = (() => {
  let ref: string;
  try {
    ref = new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    ref = supabaseUrl.replace(/^https?:\/\//, '').split(/[.:/]/)[0];
  }
  return `sb-${ref}-auth-token`;
})();

// Use AsyncStorage for native, localStorage wrapper for web
const storage = Platform.OS === 'web' ? {
  getItem: (key: string) => {
    try {
      const value = localStorage.getItem(key);
      return Promise.resolve(value);
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
      return Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  },
} : AsyncStorage;

// =====================================================
// REQUEST TIMEOUTS (INC-05a)
//
// A half-open 2G socket never rejects: without a deadline
// the promise stays pending forever, the screen sits in
// its skeleton, and "still working" is indistinguishable
// from "dead". Requests therefore carry an abort deadline,
// and an abort is raised as a NAMED error so it reaches the
// caller as a retryable failure — never as an empty result.
//
// SCOPE — stated precisely, because "every request" was
// claimed here and was not true:
//   COVERED: every request made through a Supabase client
//     that is given this fetch. That is BOTH clients — the
//     app client below and the recovery client in
//     lib/services/authRecovery.ts — and within each one it
//     covers PostgREST, /auth/v1, storage and /functions/v1
//     (SupabaseClient.js:63, 73, 78-80, 91).
//   NOT COVERED: realtime (a WebSocket — no fetch involved),
//     and any BARE `fetch()` a component makes on its own.
//     `global.fetch` is deliberately NOT monkey-patched, so
//     the two Nominatim reverse-geocode calls
//     (components/AuthScreen.tsx:104, src/hooks/useLocation.ts:112)
//     are still unbounded. Both need their own controller;
//     see the INC-05 report.
//
// Hermes has no AbortSignal.timeout (React Native ships the
// whatwg `abort-controller` polyfill, which implements only
// AbortController/AbortSignal), so the deadline is an
// AbortController plus a timer. Any signal the caller passed
// in is chained, so supabase-js's own .abortSignal() keeps
// working — and a cancellation raised THAT way is reported
// as a cancellation, not as a network failure, so it can
// never be mistaken for "offline" and answered from cache.
//
// Budgets differ by request class because the cost of giving
// up differs:
//   read      15 s — a lost read costs one retry tap. The
//                    live DB's own statement_timeout is 8 s
//                    for `authenticated` and 3 s for `anon`
//                    (pg_roles.rolconfig, verified 2 Aug
//                    2026), so a reachable server always
//                    answers or errors well inside 15 s;
//                    15 s only ever fires on a stalled
//                    transport. RPCs are POSTs but are reads
//                    here (get_audit_trail, get_deleted_records,
//                    get_approval_audit_log, get_user_audit_log)
//                    and none of them is queued for sync, so
//                    they take the read budget too.
//   mutation  30 s — an aborted upload burns one of the sync
//                    queue's 3 attempts (OfflineSyncService
//                    MAX_ATTEMPTS), and 3 burnt attempts park
//                    a field report in 'failed' until the
//                    worker taps "Sync now". Writes get more
//                    rope than reads for that reason.
//   function  60 s — /functions/v1/ carries the LLM proxy;
//                    a completion routinely outlives 15 s.
//   auth      15 s — small requests, and nothing retry-shaped
//                    depends on them.
// =====================================================

/** Deadline for GET/HEAD REST reads and all /auth/v1 traffic. */
export const READ_TIMEOUT_MS = 15_000;
/** Deadline for writes — longer, because an abort costs a sync attempt. */
export const MUTATION_TIMEOUT_MS = 30_000;
/** Deadline for edge functions (LLM completions live here). */
export const FUNCTION_TIMEOUT_MS = 60_000;

/**
 * Raised when our own deadline fires. supabase-js does not rethrow fetch
 * rejections — PostgrestBuilder converts them into
 * `{ error: { message: `${err.name}: ${err.message}`, code: err.code } }`
 * (postgrest-js 1.21.4, PostgrestBuilder.js:166-181) — so the NAME and the
 * CODE are the only things that survive to the caller. Both are set here on
 * purpose, and isTimeoutError() below matches on them.
 */
export class RequestTimeoutError extends Error {
  /** Surfaces as PostgrestError.code — see the note above. */
  readonly code = 'ETIMEDOUT';
  /** Always true: a deadline says nothing about whether the request is valid. */
  readonly retryable = true;
  readonly timeoutMs: number;
  readonly url: string;

  constructor(timeoutMs: number, url: string) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

/**
 * Raised when the CALLER cancelled — a `.abortSignal()` whose controller the
 * caller aborted (HealthMapComponent.tsx:1402 is the live example: a screen
 * that walks away from its own probe).
 *
 * It exists because the whatwg AbortError this used to surface as classifies
 * as a network failure — 'aborterror' is a timeout token — so a deliberate
 * cancellation looked identical to a dead socket. Downstream that meant a
 * cancelled read could be answered from the offline cache and stamped as a
 * real answer. A cancellation is neither retryable nor offline: it is the
 * app's own decision, and the classifiers below return false for it.
 */
export class RequestCancelledError extends Error {
  /** Surfaces as PostgrestError.code — see RequestTimeoutError's note. */
  readonly code = 'ECANCELED';
  /** The caller stopped this on purpose; retrying is the caller's call. */
  readonly retryable = false;
  readonly url: string;

  constructor(url: string) {
    super('Request cancelled');
    this.name = 'RequestCancelledError';
    this.url = url;
  }
}

type FetchArgs = Parameters<typeof fetch>;

const requestUrl = (input: FetchArgs[0]): string => {
  if (typeof input === 'string') return input;
  const candidate = input as { url?: unknown };
  if (candidate && typeof candidate.url === 'string') return candidate.url;
  try {
    return String(input);
  } catch {
    return '';
  }
};

const requestMethod = (input: FetchArgs[0], init?: FetchArgs[1]): string => {
  const fromInit = init?.method;
  const fromRequest = (input as { method?: unknown })?.method;
  const method = typeof fromInit === 'string' ? fromInit
    : typeof fromRequest === 'string' ? fromRequest
      : 'GET';
  return method.toUpperCase();
};

/** Exported for verification: which budget a given request gets. */
export const timeoutForRequest = (url: string, method: string): number => {
  if (url.includes('/functions/v1')) return FUNCTION_TIMEOUT_MS;
  if (url.includes('/auth/v1')) return READ_TIMEOUT_MS;
  // PostgREST RPCs are POSTs, so the method alone would hand every one of them
  // the write budget. Every RPC in this app is a read (get_audit_trail,
  // get_deleted_records, get_approval_audit_log, get_user_audit_log) except
  // claim_push_token, and none of them is a sync-queue item — so none of them
  // pays the price the 30 s budget exists to avoid. Read budget it is.
  if (url.includes('/rest/v1/rpc/')) return READ_TIMEOUT_MS;
  if (method === 'GET' || method === 'HEAD') return READ_TIMEOUT_MS;
  return MUTATION_TIMEOUT_MS;
};

/**
 * fetch with a deadline. Handed to BOTH Supabase clients as their
 * `global.fetch` option, so it covers PostgREST, auth, storage and edge
 * functions on each (SupabaseClient.js:63, 73, 78-80, 91). `globalThis.fetch`
 * is intentionally left alone — see the SCOPE note above for what that means.
 *
 * Exported so the deadline can be exercised directly in verification.
 */
export const timeoutFetch = async (...args: FetchArgs): Promise<Response> => {
  const [input, init] = args;
  const url = requestUrl(input);
  const timeoutMs = timeoutForRequest(url, requestMethod(input, init));

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;

  // Chain any caller-supplied signal so .abortSignal() still aborts — and
  // remember that it was the CALLER, so the failure is not mislabelled as a
  // network fault.
  const upstream = init?.signal ?? null;
  const detachUpstream = () => {
    if (upstream && typeof upstream.removeEventListener === 'function') {
      upstream.removeEventListener('abort', onUpstreamAbort);
    }
  };
  function onUpstreamAbort() {
    cancelled = true;
    controller.abort();
  }
  if (upstream) {
    if (upstream.aborted) {
      cancelled = true;
      controller.abort();
    } else if (typeof upstream.addEventListener === 'function') {
      upstream.addEventListener('abort', onUpstreamAbort);
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    detachUpstream();
  }, timeoutMs);

  const settle = () => {
    clearTimeout(timer);
    detachUpstream();
  };

  try {
    const response = await fetch(input, { ...(init ?? {}), signal: controller.signal });
    // React Native's fetch resolves only once the whole body has been buffered,
    // so by here the deadline has already covered everything and the timer is
    // spent. On WEB the body is still an unread stream: disarming here would
    // leave response.json() unbounded — the exact hang this exists to stop. So
    // on web the timer stays armed and the SAME controller keeps governing the
    // stream; a stalled body then aborts and surfaces as AbortError, and once
    // the body has been read the abort is a no-op. The timer detaches the
    // upstream listener itself when it fires, so nothing is left hanging.
    if (Platform.OS !== 'web') settle();
    return response;
  } catch (err) {
    settle();
    // Our deadline, the caller's cancellation, or something else — say which.
    if (timedOut) throw new RequestTimeoutError(timeoutMs, url);
    if (cancelled) throw new RequestCancelledError(url);
    throw err;
  }
};

// ── Error classification ─────────────────────────────
// Callers receive either our thrown Error or the flattened
// PostgrestError object, so every predicate reads both.

const errorText = (err: unknown): string => {
  if (err == null) return '';
  if (typeof err === 'string') return err.toLowerCase();
  const e = err as { name?: unknown; message?: unknown; code?: unknown };
  return [e.name, e.message, e.code]
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase();
};

// Deliberately narrow. A bare 'abort'/'aborted' would also match Postgres's
// "current transaction is aborted", which is a different failure entirely.
const TIMEOUT_TOKENS = [
  'requesttimeouterror',
  'etimedout',
  'timed out',
  'aborterror',
  'operation was aborted',
  'aborted a request',
] as const;

const SERVER_TIMEOUT_TOKENS = [
  'canceling statement due to statement timeout',
  '57014',
] as const;

/** The caller pulled the plug on purpose. Checked FIRST, everywhere. */
const CANCEL_TOKENS = ['requestcancellederror', 'ecanceled'] as const;

const NETWORK_TOKENS = [
  'network request failed',
  'failed to fetch',
  'fetcherror',
  'networkerror',
  'econnreset',
  'econnaborted',
  'enotfound',
  'socket hang up',
  'load failed',
] as const;

/**
 * True when the app itself cancelled the request. Never a failure to report,
 * never a reason to serve a cached answer.
 */
export const isCancelledError = (err: unknown): boolean => {
  const text = errorText(err);
  return CANCEL_TOKENS.some((token) => text.includes(token));
};

/** True when the request never got an answer inside its deadline. */
export const isTimeoutError = (err: unknown): boolean => {
  if (isCancelledError(err)) return false;
  const text = errorText(err);
  return TIMEOUT_TOKENS.some((token) => text.includes(token));
};

/** True when the SERVER gave up (statement_timeout), not the transport. */
export const isServerTimeoutError = (err: unknown): boolean => {
  const text = errorText(err);
  return SERVER_TIMEOUT_TOKENS.some((token) => text.includes(token));
};

/**
 * True for any transport-level failure — stalled or unreachable.
 * These are the failures a cached answer may stand in for; anything else
 * (RLS, validation, a 4xx) is a real answer and must never be papered over,
 * and a cancellation is not a failure at all.
 */
export const isOfflineError = (err: unknown): boolean => {
  if (isCancelledError(err)) return false;
  if (isTimeoutError(err)) return true;
  const text = errorText(err);
  return NETWORK_TOKENS.some((token) => text.includes(token));
};

/** True when retrying the exact same request could plausibly succeed. */
export const isRetryableError = (err: unknown): boolean =>
  isOfflineError(err) || isServerTimeoutError(err);

/**
 * Resolve app copy through i18next, with the English text as the defaultValue.
 *
 * These sentences render on screens that can be in Hindi, and a service has no
 * hook to call — so t() is reached through the i18next singleton (the same
 * route lib/services/gemini.ts already uses). Guarded on isInitialized and
 * wrapped, because a translation lookup must never be the reason an error path
 * throws: the English sentence is always the floor.
 */
const tr = (key: string, en: string): string => {
  try {
    if (!i18next.isInitialized) return en;
    const out = i18next.t(key, { defaultValue: en });
    return typeof out === 'string' && out && out !== key ? out : en;
  } catch {
    return en;
  }
};

/**
 * Human, honest copy for a failed READ. Never invents success and never
 * flattens an unknown failure into a network story — an unrecognised error
 * keeps its own message.
 */
export const describeRequestError = (err: unknown, fallback?: string): string => {
  if (isCancelledError(err)) {
    return tr('request.cancelled', 'That check was stopped. Tap retry to run it again.');
  }
  if (isTimeoutError(err)) {
    return tr(
      'request.stalled',
      'The network stalled — nothing came back in time. Tap retry when you have signal.',
    );
  }
  if (isServerTimeoutError(err)) {
    return tr('request.serverSlow', 'The server took too long to answer. Tap retry.');
  }
  if (isOfflineError(err)) {
    return tr('request.offline', 'No usable connection. Tap retry when you have signal.');
  }
  const message = typeof err === 'string'
    ? err
    : String((err as { message?: unknown })?.message ?? '').trim();
  return message || fallback || tr('request.unknown', 'Something went wrong. Tap retry.');
};

/**
 * Honest copy for a failed WRITE — a different story from a failed read, and
 * the reason 'RequestTimeoutError: Request timed out after 30s' used to land
 * in a field worker's submit modal verbatim.
 *
 * Two things a read never has to say:
 *   • A deadline on a submit does NOT mean nothing was sent. The row may have
 *     committed server-side and only the response been lost, so this copy
 *     never claims the report was not filed.
 *   • Whether "send it again" is safe depends on the caller. With a stable
 *     client_idempotency_key the second copy collides with the first (both
 *     tables carry a full UNIQUE constraint on that column — verified on the
 *     live database 3 Aug 2026) and is ignored, so the promise can be made.
 *     Without one, it cannot, and this must not pretend otherwise.
 *
 * Returns null when the failure is not transport-shaped, so the caller keeps
 * its own more specific message (RLS, trigger mismatch, validation).
 */
export const describeSubmitError = (
  err: unknown,
  options?: { idempotent?: boolean },
): string | null => {
  const safeResend = options?.idempotent === true;
  if (isCancelledError(err)) {
    return tr('submit.cancelled', 'Sending was stopped before it finished. Tap retry to send it.');
  }
  if (isTimeoutError(err) || isServerTimeoutError(err)) {
    return safeResend
      ? tr(
        'submit.stalledSafe',
        'The network stalled before this was confirmed. Your report is still on this phone — tap retry. If it did reach the server, sending again will not file it twice.',
      )
      : tr(
        'submit.stalled',
        'The network stalled before this was confirmed. Your report is still on this phone — tap retry when you have signal.',
      );
  }
  if (isOfflineError(err)) {
    return safeResend
      ? tr(
        'submit.offlineSafe',
        'No usable connection. Your report is still on this phone — tap retry when you have signal. Sending again will not file it twice.',
      )
      : tr(
        'submit.offline',
        'No usable connection. Your report is still on this phone — tap retry when you have signal.',
      );
  }
  return null;
};

/**
 * The signed-in user's id, read STRAIGHT from the persisted GoTrue session
 * blob. Deliberately not supabase.auth.getSession().
 *
 * getSession() treats a session within EXPIRY_MARGIN_MS (90 s) of expiry as
 * expired and attempts a network refresh (GoTrueClient.js:1019-1051,
 * auth-js 2.71.1). Offline that refresh fails and getSession() returns
 * `session: null` — so anything that scopes itself by getSession() goes blind
 * roughly an hour into a trip, which is precisely when an offline cache is
 * supposed to start earning its keep.
 *
 * The blob is still there: a retryable fetch failure does NOT clear it
 * (GoTrueClient.js:1745-1749, `if (!isAuthRetryableFetchError(error)) await
 * this._removeSession()`), and our own RequestTimeoutError reaches auth-js
 * already wrapped as AuthRetryableFetchError (lib/fetch.js:23). An expired
 * ACCESS TOKEN says nothing about WHO the rows on this phone belong to, so
 * identity is read from the blob and never from the token's validity.
 *
 * Null means there genuinely is no persisted session — signed out, or a fresh
 * install. That is the only case in which nothing may be served.
 */
export const readPersistedUserId = async (): Promise<string | null> => {
  try {
    const raw = await storage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      user?: { id?: unknown };
      // gotrue-js v1 nested the session; read it too so an upgraded install is
      // not mistaken for a signed-out one.
      currentSession?: { user?: { id?: unknown } };
    } | null;
    const id = parsed?.user?.id ?? parsed?.currentSession?.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    // Unreadable or corrupt storage: treat as "no signed-in user". Serving a
    // guess here would be serving another account's rows.
    return null;
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storage,
    // Passed explicitly rather than left to supabase-js's default derivation,
    // so readPersistedUserId() above and the client are provably reading and
    // writing the same key.
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    fetch: timeoutFetch as unknown as typeof fetch,
  },
});
