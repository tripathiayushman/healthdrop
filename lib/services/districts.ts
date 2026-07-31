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
// Contract: every function degrades SILENTLY to an empty result
// on any failure — suggestions are an enhancement, never a
// blocker, so nothing here throws and nothing here surfaces an
// error state to the UI.
// =====================================================
import { supabase } from '../supabase';

export interface DistrictEntry {
  id: string;
  district: string;
  state: string;
}

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

export const districtsService = {
  /**
   * All registry entries, cached in-module for 5 minutes.
   * Single-flight: concurrent callers share one request. On failure
   * returns the stale cache if one exists, else [] — never throws.
   * Treat the returned array as read-only.
   */
  async listAll(): Promise<DistrictEntry[]> {
    const fresh = _cache !== null && Date.now() - _cacheAt < CACHE_TTL_MS;
    if (_cache !== null && fresh) return _cache;

    if (!_inflight) {
      _inflight = fetchAll()
        .then((rows) => {
          _cache = rows;
          _cacheAt = Date.now();
          return rows;
        })
        .catch(() => {
          // Silent degrade: stale suggestions beat no suggestions,
          // and no suggestions beat a visible error.
          return _cache ?? [];
        })
        .finally(() => {
          _inflight = null;
        });
    }
    return _inflight;
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
    const q = normalizePlace(state);
    const all = await districtsService.listAll();
    const districts = new Set<string>();
    for (const entry of all) {
      if (!q || normalizePlace(entry.state) === q) districts.add(entry.district);
    }
    return [...districts].sort((a, b) => a.localeCompare(b));
  },
};

export default districtsService;
