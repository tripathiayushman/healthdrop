// =====================================================
// APPROVAL META SERVICE (Bharosa C·02)
// The evidence a 30-second queue decision needs:
//  - reporterTrackRecord: "n approved before" per reporter,
//    batch-counted across disease + water reports
//  - reporterNames: batch reporter display names + roles
//  - feedsSignal / feedsSignalBatch: does approving this
//    report feed an open outbreak signal, or count toward
//    a threshold rule that would fire one?
// Every lookup here is SUPPLEMENTARY evidence — callers
// must render the queue card even when these fail. Errors
// throw so the caller can decide; the queue catches and
// simply omits the meta line (graceful absence).
// =====================================================
import { supabase } from '../supabase';

export interface ReporterTrackRecord {
  /** How many disease + water reports by this reporter were approved before. */
  approved: number;
}

export interface ReporterName {
  fullName: string;
  role?: string;
}

export interface FeedsSignalResult {
  feeds: boolean;
  /** Info-blue caption for the queue card, present when feeds is true. */
  label?: string;
}

/** Cap the id list so a huge backlog can't fan into unbounded IN() clauses. */
const REPORTER_CAP = 50;
/** Cap rows scanned per table — counts read "50+" territory, not exact history. */
const ROW_CAP = 2000;

const uniqueIds = (ids: string[]): string[] =>
  Array.from(new Set(ids.filter(Boolean))).slice(0, REPORTER_CAP);

const norm = (s?: string | null): string => (s ?? '').trim().toLowerCase();

/**
 * Batch track record: approved disease + water report counts per reporter.
 * Two grouped queries (one per table), aggregated client-side — Supabase JS
 * has no GROUP BY, and per-reporter count queries would be N round trips.
 * Reporters with zero prior approvals get an explicit { approved: 0 } entry
 * so callers can honestly say "first report".
 */
export async function reporterTrackRecord(
  reporterIds: string[],
): Promise<Map<string, ReporterTrackRecord>> {
  const map = new Map<string, ReporterTrackRecord>();
  const ids = uniqueIds(reporterIds);
  if (ids.length === 0) return map;

  const [disease, water] = await Promise.all([
    supabase
      .from('disease_reports')
      .select('reporter_id')
      .eq('approval_status', 'approved')
      .in('reporter_id', ids)
      .limit(ROW_CAP),
    supabase
      .from('water_quality_reports')
      .select('reporter_id')
      .eq('approval_status', 'approved')
      .in('reporter_id', ids)
      .limit(ROW_CAP),
  ]);
  if (disease.error) throw disease.error;
  if (water.error) throw water.error;

  const tally = (rows: { reporter_id: string | null }[] | null) => {
    for (const row of rows ?? []) {
      if (!row.reporter_id) continue;
      const prev = map.get(row.reporter_id);
      map.set(row.reporter_id, { approved: (prev?.approved ?? 0) + 1 });
    }
  };
  tally(disease.data);
  tally(water.data);

  for (const id of ids) if (!map.has(id)) map.set(id, { approved: 0 });
  return map;
}

/** Batch reporter display names + roles for the card's reporter line. */
export async function reporterNames(
  reporterIds: string[],
): Promise<Map<string, ReporterName>> {
  const map = new Map<string, ReporterName>();
  const ids = uniqueIds(reporterIds);
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('id', ids)
    .limit(REPORTER_CAP);
  if (error) throw error;

  for (const p of data ?? []) {
    if (p.id && p.full_name) map.set(p.id, { fullName: p.full_name, role: p.role ?? undefined });
  }
  return map;
}

/**
 * Batch feeds-signal check for a list of reports. One fetch of open
 * outbreaks (active/monitoring) + threshold rules covers the whole list.
 * Results align by index with the input array.
 *  - Open outbreak, same disease + district → "Feeds the {district}
 *    {disease} signal if approved"
 *  - Otherwise a threshold rule for the disease → "Counts toward the
 *    {disease} threshold — {n}+ cases in {m} days fires a signal"
 */
export async function feedsSignalBatch(
  reports: { disease_name?: string | null; district?: string | null }[],
): Promise<FeedsSignalResult[]> {
  if (reports.length === 0) return [];

  const [outbreaksRes, thresholdsRes] = await Promise.all([
    supabase
      .from('outbreaks')
      .select('disease_name, district, status')
      .in('status', ['active', 'monitoring'])
      .limit(200),
    supabase
      .from('outbreak_thresholds')
      .select('disease_name, case_threshold, window_days')
      .limit(200),
  ]);
  if (outbreaksRes.error) throw outbreaksRes.error;
  if (thresholdsRes.error) throw thresholdsRes.error;

  const open = outbreaksRes.data ?? [];
  const rules = thresholdsRes.data ?? [];

  return reports.map(report => {
    const disease = norm(report.disease_name);
    const district = norm(report.district);
    if (!disease) return { feeds: false };

    const outbreak = open.find(
      o => norm(o.disease_name) === disease && !!district && norm(o.district) === district,
    );
    if (outbreak) {
      return {
        feeds: true,
        label: `Feeds the ${report.district} ${report.disease_name} signal if approved`,
      };
    }

    const rule = rules.find(t => norm(t.disease_name) === disease);
    if (rule) {
      return {
        feeds: true,
        label: `Counts toward the ${report.disease_name} threshold — ${rule.case_threshold}+ cases in ${rule.window_days} days fires a signal`,
      };
    }
    return { feeds: false };
  });
}

/** Single-report variant of feedsSignalBatch. */
export async function feedsSignal(report: {
  disease_name?: string | null;
  district?: string | null;
}): Promise<FeedsSignalResult> {
  const [result] = await feedsSignalBatch([report]);
  return result ?? { feeds: false };
}

export const approvalMetaService = {
  reporterTrackRecord,
  reporterNames,
  feedsSignal,
  feedsSignalBatch,
};

export default approvalMetaService;
