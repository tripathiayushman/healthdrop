// =====================================================
// STRUCTURED LOGGER — zero new dependencies, no network.
// log.debug/info/warn/error(tag, message, extra?):
//   • mirrors to console.* in dev builds (__DEV__) only
//   • ALWAYS appends to an in-memory ring buffer of the
//     last 300 entries, readable via getRecentLogs()
//   • errors are additionally persisted best-effort to
//     AsyncStorage ('healthdrop:lastErrors', capped 50)
//     so field failures survive an app restart
// Logging must never throw — every path is fail-soft.
// =====================================================
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    /** ISO timestamp of when the entry was recorded. */
    ts: string;
    level: LogLevel;
    /** Subsystem tag, e.g. 'SyncQueue', 'OfflineSync'. */
    tag: string;
    message: string;
    /** JSON-safe snapshot of the extra argument, when one was given. */
    extra?: unknown;
}

const RING_CAPACITY = 300;
const ERRORS_KEY = 'healthdrop:lastErrors';
const MAX_PERSISTED_ERRORS = 50;
const MAX_STACK_CHARS = 1200;

// __DEV__ is defined by Metro/Hermes and by Expo web bundles; the typeof
// guard keeps unusual hosts (node scripts, test runners) on the safe path.
const IS_DEV: boolean = typeof __DEV__ !== 'undefined' && !!__DEV__;

const ring: LogEntry[] = [];

/** The last 300 log entries, oldest first. Returns a copy. */
export function getRecentLogs(): LogEntry[] {
    return [...ring];
}

/** Reduce arbitrary extras (Errors, objects, cycles) to a JSON-safe value. */
function toSafeExtra(extra: unknown): unknown {
    if (extra === undefined) return undefined;
    if (extra === null) return null;
    if (extra instanceof Error) {
        return {
            name: extra.name,
            message: extra.message,
            stack:
                typeof extra.stack === 'string'
                    ? extra.stack.slice(0, MAX_STACK_CHARS)
                    : undefined,
        };
    }
    const kind = typeof extra;
    if (kind === 'string' || kind === 'number' || kind === 'boolean') return extra;
    try {
        // Round-trip strips functions and rejects circular structures.
        return JSON.parse(JSON.stringify(extra));
    } catch {
        try {
            return String(extra);
        } catch {
            return '[unserializable extra]';
        }
    }
}

// Error persistence is serialized through a promise chain so two rapid
// log.error calls cannot interleave their read-modify-write cycles.
let persistChain: Promise<void> = Promise.resolve();

function persistError(entry: LogEntry): void {
    persistChain = persistChain
        .then(async () => {
            let history: LogEntry[] = [];
            try {
                const raw = await AsyncStorage.getItem(ERRORS_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as unknown;
                    if (Array.isArray(parsed)) history = parsed as LogEntry[];
                }
            } catch {
                // Unreadable history — start a fresh list rather than fail.
            }
            const next = [...history, entry].slice(-MAX_PERSISTED_ERRORS);
            await AsyncStorage.setItem(ERRORS_KEY, JSON.stringify(next));
        })
        .catch(() => {
            // Fail-soft: persistence is best-effort; logging never throws.
        });
}

function record(level: LogLevel, tag: string, message: string, extra?: unknown): void {
    const entry: LogEntry = {
        ts: new Date().toISOString(),
        level,
        tag: String(tag),
        message: String(message),
    };
    const safeExtra = toSafeExtra(extra);
    if (safeExtra !== undefined) entry.extra = safeExtra;

    ring.push(entry);
    if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);

    if (IS_DEV) {
        const line = `[${entry.tag}] ${entry.message}`;
        const emit =
            level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        try {
            if (safeExtra !== undefined) emit(line, safeExtra);
            else emit(line);
        } catch {
            // A broken console must never break the app.
        }
    }

    if (level === 'error') persistError(entry);
}

export const log = {
    debug: (tag: string, message: string, extra?: unknown): void =>
        record('debug', tag, message, extra),
    info: (tag: string, message: string, extra?: unknown): void =>
        record('info', tag, message, extra),
    warn: (tag: string, message: string, extra?: unknown): void =>
        record('warn', tag, message, extra),
    error: (tag: string, message: string, extra?: unknown): void =>
        record('error', tag, message, extra),
};

export default log;
