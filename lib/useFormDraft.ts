// =====================================================
// FORM DRAFT + DIRTY GUARD — BRK-14 / NEW-01
// One contract shared by all four create forms, so the
// answer to "did I just lose my report?" is the same
// everywhere:
//
//   dirty       — has she changed anything since the last
//                 pristine mark? (drives the discard guard)
//   offered     — a draft found on THIS phone for THIS
//                 user, waiting on her decision. Never
//                 applied silently.
//   autosave    — debounced write of the current snapshot,
//                 plus an immediate flush when the app goes
//                 to the background (the low-memory kill is
//                 the whole reason this exists).
//
// The forms keep their state as many individual useState
// hooks; they hand this hook one plain snapshot object and
// get the four answers back. Nothing here touches
// validation, submission, or the offline queue.
//
// Scoping: the key carries profile.id, so a shared field
// handset never shows one worker another worker's draft.
// No id (signed-out edge) ⇒ persistence is simply off; the
// dirty guard still works.
// =====================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_PREFIX = 'healthdrop:form-draft';
const DRAFT_VERSION = 1;
const DEFAULT_DEBOUNCE_MS = 700;

/**
 * What MainApp holds for whichever form is on screen. The form owns the
 * meaning of "back" — step back, close a sheet, ask before discarding, or
 * just leave — because only the form knows what is half-filled.
 */
export interface FormExitHandle {
  requestClose: () => void;
}

/**
 * What this phone's storage is doing to her work, when it is not doing it.
 *
 *   'read'  — we could not find out whether a draft exists. NOT the same fact
 *             as "there is no draft", and the form must never render the two
 *             the same way.
 *   'write' — nothing typed from here on is being kept. The low-memory kill
 *             that NEW-01 exists for would now lose everything.
 */
export type DraftStorageIssue = 'read' | 'write' | null;

export interface FormDraftController<T> {
  /** Snapshot differs from the last pristine mark. */
  dirty: boolean;
  /** A stored draft awaiting her decision — render the restore sheet. */
  offered: T | null;
  /** When that draft was last written, for honest sheet copy. */
  offeredAt: Date | null;
  /** Accept the offer: returns the values for the form to apply, then clears the offer. */
  restore: () => T | null;
  /** Reject the offer: deletes the stored draft. */
  dismiss: () => void;
  /** Re-arm the baseline — "what is on screen now counts as untouched". */
  markPristine: () => void;
  /** Delete the stored draft and re-arm (successful submit, explicit discard). */
  clear: () => void;
  /**
   * null while persistence is working (or switched off for want of a userId).
   * Non-null is a failure the form is REQUIRED to show — see DraftStorageNotice.
   */
  storageIssue: DraftStorageIssue;
  /** Re-attempt whichever side failed. Drives the retry on that notice. */
  retryStorage: () => void;
}

export interface UseFormDraftOptions<T> {
  /**
   * Identifies the form AND its context. Contexts get their own key so a
   * refile draft can never fight a fresh-form draft or a retest prefill —
   * e.g. 'disease-report' vs 'disease-report:refile:<id>'.
   */
  formKey: string;
  /** profile.id — persistence is disabled without it. */
  userId?: string | null;
  /** The current values, as a plain JSON-safe object. */
  values: T;
  /** False while an async prefill is still landing, or after a successful save. */
  enabled?: boolean;
  debounceMs?: number;
}

interface StoredDraft<T> {
  v: number;
  savedAt: string;
  values: T;
}

/**
 * Snapshots are plain objects of strings/numbers/booleans/arrays, so this
 * cannot realistically throw; the guard exists so a surprise value degrades
 * to "no draft" instead of taking the form down mid-report.
 */
const serialize = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch (error) {
    console.warn('[useFormDraft] snapshot is not serialisable', error);
    return '';
  }
};

/**
 * Formatted stamp for the restore sheet. No Intl.PluralRules — Hermes-safe.
 *
 * Pinned to 'en-IN' rather than the device locale (`[]`). This stamp is the
 * one thing that makes restoring day-old text into a health report a safe
 * decision, and everything else the app formats — every date on every
 * dashboard and report card — already uses 'en-IN'. Reading the device locale
 * here meant a handset set to another region rendered the draft's age in a
 * different format from the timestamps beside it, on the single screen where
 * the user has to compare "when did I write this" against "is it still true".
 */
export const formatDraftStamp = (when: Date | null): string => {
  if (!when || Number.isNaN(when.getTime())) return '';
  const time = when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const isToday = when.toDateString() === new Date().toDateString();
  if (isToday) return time;
  return `${when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${time}`;
};

export function useFormDraft<T>({
  formKey,
  userId,
  values,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseFormDraftOptions<T>): FormDraftController<T> {
  const storageKey = userId ? `${DRAFT_PREFIX}:${userId}:${formKey}` : null;

  const serialized = serialize(values);
  const serializedRef = useRef(serialized);
  serializedRef.current = serialized;

  // Lazy baseline: the form as it first rendered. Async prefills re-arm it
  // via markPristine() so a machine-filled field never reads as her typing.
  const baselineRef = useRef<string | null>(null);
  if (baselineRef.current === null) baselineRef.current = serialized;

  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  const [offered, setOffered] = useState<T | null>(null);
  const [offeredAt, setOfferedAt] = useState<Date | null>(null);
  const offeredRef = useRef<T | null>(null);
  offeredRef.current = offered;

  const [rearmTick, setRearmTick] = useState(0);
  const rearmSeenRef = useRef(0);

  // ── Persistence health ───────────────────────────────────────────────────
  // Both sides used to degrade to silence: a failed write logged a console
  // warning nobody in a village reads, and a failed read simply offered no
  // draft — which looks EXACTLY like "you have no unfinished report". That is
  // the banned default-that-hides-a-failure, on the one surface whose entire
  // job is not losing her work. Storage failure is now a state the form shows.
  const [storageIssue, setStorageIssue] = useState<DraftStorageIssue>(null);
  const storageIssueRef = useRef<DraftStorageIssue>(null);
  storageIssueRef.current = storageIssue;
  const [reloadTick, setReloadTick] = useState(0);

  const clearIssue = useCallback((side: Exclude<DraftStorageIssue, null>) => {
    setStorageIssue((prev) => (prev === side ? null : prev));
  }, []);

  // Every storage operation is queued on one chain so a late-firing autosave
  // can never land after — and resurrect — a discard. `gen` invalidates any
  // write that was scheduled before a clear/dismiss.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const genRef = useRef(0);
  const enqueue = useCallback((op: () => Promise<void>) => {
    chainRef.current = chainRef.current
      .catch(() => {})
      .then(op)
      .catch((error) => {
        console.warn('[useFormDraft] draft storage write failed', error);
        setStorageIssue('write');
      });
  }, []);

  const wipe = useCallback(() => {
    genRef.current += 1;
    if (!storageKey) return;
    enqueue(() => AsyncStorage.removeItem(storageKey));
  }, [storageKey, enqueue]);

  const buildPayload = useCallback(
    (snapshot: string) =>
      // Concatenated rather than re-stringified: `snapshot` is already valid JSON.
      `{"v":${DRAFT_VERSION},"savedAt":${JSON.stringify(new Date().toISOString())},"values":${snapshot}}`,
    []
  );

  // ── Offer any stored draft, once per key ─────────────────────────────────
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!storageKey || !enabled) return;
    if (loadedKeyRef.current === storageKey) return;
    loadedKeyRef.current = storageKey;

    let active = true;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!active) return;
        clearIssue('read');
        if (!raw) return;
        let parsed: StoredDraft<T> | null = null;
        try {
          parsed = JSON.parse(raw) as StoredDraft<T>;
        } catch {
          parsed = null;
        }
        if (!parsed || parsed.v !== DRAFT_VERSION || parsed.values == null) {
          wipe();
          return;
        }
        // Nothing worth offering if the draft is what the form already shows,
        // and no interrupting her if she started typing while the read ran.
        if (serialize(parsed.values) === baselineRef.current) return;
        if (serializedRef.current !== baselineRef.current) return;

        const when = new Date(parsed.savedAt);
        setOffered(parsed.values);
        setOfferedAt(Number.isNaN(when.getTime()) ? null : when);
      })
      .catch((error) => {
        console.warn('[useFormDraft] could not read draft', error);
        if (!active) return;
        // This used to degrade to "no draft offered", i.e. to a blank form and
        // silence — the NEW-01 scenario failing in exactly the way NEW-01 was
        // written to prevent. A read that FAILED and a phone that HAS no draft
        // are different facts and are now told apart.
        // Releasing the key lets retryStorage() (and any later dep change)
        // genuinely re-run the read rather than short-circuit on it.
        loadedKeyRef.current = null;
        setStorageIssue('read');
      });

    return () => {
      active = false;
    };
  }, [storageKey, enabled, wipe, reloadTick, clearIssue]);

  // ── Dirty tracking + debounced autosave ──────────────────────────────────
  useEffect(() => {
    // Re-arm first, and unconditionally: a prefill landing while persistence
    // is still disabled must still reset the baseline.
    if (rearmSeenRef.current !== rearmTick) {
      rearmSeenRef.current = rearmTick;
      baselineRef.current = serialized;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setDirty(false);
      }
      return;
    }

    const nextDirty = serialized !== baselineRef.current;
    if (nextDirty !== dirtyRef.current) {
      dirtyRef.current = nextDirty;
      setDirty(nextDirty);
    }

    if (!storageKey || !enabled || !nextDirty || offered !== null) return;

    const gen = genRef.current;
    const payload = buildPayload(serialized);
    const timer = setTimeout(() => {
      enqueue(async () => {
        if (gen !== genRef.current) return;
        await AsyncStorage.setItem(storageKey, payload);
        // Only a write that actually landed clears the warning — a stale-gen
        // no-op returns above without touching it.
        clearIssue('write');
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [serialized, rearmTick, storageKey, enabled, offered, debounceMs, enqueue, buildPayload, clearIssue]);

  // ── Flush on background — the low-memory kill happens here ───────────────
  useEffect(() => {
    if (!storageKey || !enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      if (!dirtyRef.current || offeredRef.current !== null) return;
      const gen = genRef.current;
      const payload = buildPayload(serializedRef.current);
      enqueue(async () => {
        if (gen !== genRef.current) return;
        await AsyncStorage.setItem(storageKey, payload);
        clearIssue('write');
      });
    });
    return () => sub.remove();
  }, [storageKey, enabled, enqueue, buildPayload, clearIssue]);

  /**
   * The retry behind the storage notice. Read failures re-run the load;
   * write failures re-attempt the current snapshot immediately instead of
   * waiting for the next keystroke to schedule one.
   */
  const retryStorage = useCallback(() => {
    const side = storageIssueRef.current;
    if (side === 'read') {
      loadedKeyRef.current = null;
      setReloadTick((tick) => tick + 1);
      return;
    }
    if (side === 'write' && storageKey && dirtyRef.current) {
      const gen = genRef.current;
      const payload = buildPayload(serializedRef.current);
      enqueue(async () => {
        if (gen !== genRef.current) return;
        await AsyncStorage.setItem(storageKey, payload);
        clearIssue('write');
      });
    }
  }, [storageKey, enqueue, buildPayload, clearIssue]);

  const restore = useCallback(() => {
    const value = offeredRef.current;
    setOffered(null);
    setOfferedAt(null);
    // Deliberately NOT re-armed: restored work is still unsaved work, so Back
    // keeps asking before it is thrown away.
    return value;
  }, []);

  const dismiss = useCallback(() => {
    setOffered(null);
    setOfferedAt(null);
    wipe();
  }, [wipe]);

  const markPristine = useCallback(() => {
    // A machine fill that lands AFTER she has already typed must not erase the
    // fact that she typed — that would turn work-in-progress into a form that
    // closes silently. Prefills therefore re-arm only an untouched form.
    if (dirtyRef.current) return;
    setRearmTick((tick) => tick + 1);
  }, []);

  const clear = useCallback(() => {
    wipe();
    setOffered(null);
    setOfferedAt(null);
    setRearmTick((tick) => tick + 1);
  }, [wipe]);

  return {
    dirty,
    offered,
    offeredAt,
    restore,
    dismiss,
    markPristine,
    clear,
    storageIssue,
    retryStorage,
  };
}

/**
 * Delete every saved draft on this device.
 *
 * Drafts are keyed per user, which stops one worker's half-filled form being
 * offered to the next — but nothing was ever deleting them. A disease-report
 * draft holds case counts, death counts, GPS coordinates, the village name and
 * free-text notes, and it sat in plaintext AsyncStorage indefinitely after
 * sign-out, then offered itself back weeks later as "continue where you left
 * off". On a shared field handset that is a stranger's half-written health
 * report about named people. Before drafts existed at all, that content died
 * with the process.
 *
 * Called on sign-out and on account deletion. Best-effort by design: a failure
 * here must never block someone from signing out, but it IS reported, because
 * a purge that silently did nothing is the worst of both worlds.
 */
export const purgeAllFormDrafts = async (): Promise<{ removed: number; ok: boolean }> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(`${DRAFT_PREFIX}:`));
    if (mine.length === 0) return { removed: 0, ok: true };
    await AsyncStorage.multiRemove(mine);
    return { removed: mine.length, ok: true };
  } catch (error) {
    console.warn('[useFormDraft] could not purge saved drafts:', error);
    return { removed: 0, ok: false };
  }
};

export default useFormDraft;
