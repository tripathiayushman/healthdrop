// =====================================================
// CANONICAL DISTRICT REGISTRY — client for public.districts
// (id uuid, district text, state text, UNIQUE(district,state);
//  SELECT open to authenticated.)
//
// The registry is a SUGGESTION source, never a gate: free text
// stays valid everywhere (soft launch). This client's job is to
// steer users toward canonical names so outbreak joins and
// officer scoping stop fragmenting ("Shimla"/"shimla "/"Simla").
//
// Contract: the plain functions degrade SILENTLY to an empty
// result on any failure — suggestions are an enhancement, never a
// blocker, so none of them throws.
//
// EXCEPTION (added for BRK-12): a caller that uses the registry as
// a PICKER, not a suggestion, cannot live with that contract — a
// dead lookup and a genuinely empty registry both arrive as [], so
// the screen has to guess, and guessing "error" renders an empty
// registry as a failed fetch (and guessing "empty" hides a real
// failure). `districtsForChecked` therefore reports the outcome
// instead of flattening it. Nothing else about this module changed;
// listAll / search / statesFor / districtsFor still never throw.
// =====================================================
import { supabase } from '../supabase';

export interface DistrictEntry {
  id: string;
  district: string;
  state: string;
}

/**
 * Outcome of a registry read that REFUSES to hide failure.
 * `{ status: 'ok', districts: [] }` means the registry is genuinely
 * empty; `{ status: 'error' }` means the lookup never completed.
 * A caller must render those two as different states.
 */
export type DistrictListResult =
  | { status: 'ok'; districts: string[] }
  | { status: 'error'; message: string };

// ── In-module cache (5 min TTL, single-flight) ───────────────
const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache: DistrictEntry[] | null = null;
let _cacheAt = 0;
let _inflight: Promise<DistrictEntry[]> | null = null;

/** Lowercase, collapse runs of whitespace, trim — "Shimla " ≡ "shimla". */
function normalizePlace(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fully space-stripped form, so "newdelhi" still matches "New Delhi". */
function squash(value: string): string {
  return value.replace(/ /g, '');
}

async function fetchAll(): Promise<DistrictEntry[]> {
  const { data, error } = await supabase
    .from('districts')
    .select('id,district,state')
    .order('district', { ascending: true })
    .limit(2000);
  if (error) throw error;

  // Keep only usable rows; trim display strings; drop rows that are
  // case/space-duplicates of one we already kept (the DB UNIQUE is
  // exact-match, so "Shimla" and "shimla " could both exist).
  const seen = new Set<string>();
  const rows: DistrictEntry[] = [];
  for (const raw of data ?? []) {
    const district = String(raw?.district ?? '').trim();
    const state = String(raw?.state ?? '').trim();
    if (!district || !state) continue;
    const key = `${normalizePlace(district)}|${normalizePlace(state)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: String(raw.id), district, state });
  }
  return rows;
}

/**
 * Cache-aware registry read that PROPAGATES failure. `listAll` wraps this
 * with the silent degrade the module contract promises; `districtsForChecked`
 * lets it through so a picker can tell "empty" from "broken".
 * Single-flight is shared between both — a silent caller and a checked
 * caller in flight together each handle the same settled promise their
 * own way.
 */
async function loadAll(): Promise<DistrictEntry[]> {
  const fresh = _cache !== null && Date.now() - _cacheAt < CACHE_TTL_MS;
  if (_cache !== null && fresh) return _cache;

  if (!_inflight) {
    _inflight = fetchAll()
      .then((rows) => {
        _cache = rows;
        _cacheAt = Date.now();
        return rows;
      })
      .finally(() => {
        _inflight = null;
      });
  }
  return _inflight;
}

/** Unique, sorted district names from `entries`, optionally scoped to one state. */
function pickDistricts(entries: DistrictEntry[], state?: string): string[] {
  const q = normalizePlace(state);
  const districts = new Set<string>();
  for (const entry of entries) {
    if (!q || normalizePlace(entry.state) === q) districts.add(entry.district);
  }
  return [...districts].sort((a, b) => a.localeCompare(b));
}

export const districtsService = {
  /**
   * All registry entries, cached in-module for 5 minutes.
   * Single-flight: concurrent callers share one request. On failure
   * returns the stale cache if one exists, else [] — never throws.
   * Treat the returned array as read-only.
   */
  async listAll(): Promise<DistrictEntry[]> {
    try {
      return await loadAll();
    } catch {
      // Silent degrade: stale suggestions beat no suggestions,
      // and no suggestions beat a visible error.
      return _cache ?? [];
    }
  },

  /**
   * Case/space-insensitive substring search over district AND state
   * names. Ranked: district-prefix matches, then state-prefix, then
   * substring hits; alphabetical within each tier. Empty term or any
   * failure → []. Callers slice to taste (the UI shows up to 6).
   */
  async search(term: string): Promise<DistrictEntry[]> {
    const q = normalizePlace(term);
    if (!q) return [];
    const qs = squash(q);

    const all = await districtsService.listAll();
    const tiered = all
      .map((entry) => {
        const d = normalizePlace(entry.district);
        const s = normalizePlace(entry.state);
        const hit =
          d.includes(q) || s.includes(q) ||
          squash(d).includes(qs) || squash(s).includes(qs);
        if (!hit) return null;
        const tier = d.startsWith(q) ? 0 : s.startsWith(q) ? 1 : 2;
        return { entry, tier };
      })
      .filter((x): x is { entry: DistrictEntry; tier: number } => x !== null);

    tiered.sort(
      (a, b) =>
        a.tier - b.tier ||
        a.entry.district.localeCompare(b.entry.district) ||
        a.entry.state.localeCompare(b.entry.state),
    );
    return tiered.map((x) => x.entry);
  },

  /**
   * Canonical state names a district belongs to (a name can exist in
   * several states — "Bilaspur" is in HP and Chhattisgarh). Exact
   * case/space-insensitive district match; sorted; [] on failure.
   */
  async statesFor(district: string): Promise<string[]> {
    const q = normalizePlace(district);
    if (!q) return [];
    const all = await districtsService.listAll();
    const states = new Set<string>();
    for (const entry of all) {
      if (normalizePlace(entry.district) === q) states.add(entry.state);
    }
    return [...states].sort((a, b) => a.localeCompare(b));
  },

  /**
   * Canonical district names, optionally scoped to one state
   * (case/space-insensitive). No argument → every district in the
   * registry. Unique, sorted; [] on failure.
   */
  async districtsFor(state?: string): Promise<string[]> {
    return pickDistricts(await districtsService.listAll(), state);
  },

  /**
   * `districtsFor` for callers that MUST tell an empty registry from a
   * dead lookup — a picker, where "nothing to choose" and "we couldn't
   * ask" need different words and only one of them deserves a Retry.
   * This is the one function in this module that reports failure.
   */
  async districtsForChecked(state?: string): Promise<DistrictListResult> {
    try {
      return { status: 'ok', districts: pickDistricts(await loadAll(), state) };
    } catch (error: any) {
      console.error('[districts] registry lookup failed:', error);
      return {
        status: 'error',
        message: error?.message ?? 'Could not read the district registry.',
      };
    }
  },
};

export default districtsService;
