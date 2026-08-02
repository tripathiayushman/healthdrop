import {
  AIAlert,
  CampaignEffectiveness,
  DistrictHealthRanking,
  EscalationRecord,
  Profile,
} from '../../types';
import { supabase } from '../supabase';
import { filterAlertsForProfile } from './alertRadius';

const DISTRICT_SCOPED_ROLES = new Set<Profile['role']>([
  'district_officer',
  'clinic',
  'asha_worker',
  'volunteer',
]);

type GenericRow = Record<string, unknown>;

const WATER_QUALITY_SCORE: Record<string, number> = {
  safe: 95,
  moderate: 70,
  poor: 40,
  contaminated: 20,
  unsafe: 15,
  critical: 5,
};

const isDistrictScopedRole = (role: Profile['role']): boolean => DISTRICT_SCOPED_ROLES.has(role);

const normalizeDistrict = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeWord = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toOptionalNumber = (value: unknown): number | null => {
  const parsed = toNumber(value, Number.NaN);
  return Number.isNaN(parsed) ? null : parsed;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getStringField = (row: GenericRow, fields: string[]): string | null => {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const toDateMs = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const mapSeverity = (value: unknown): AIAlert['severity'] => {
  const normalized = normalizeWord(value);
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
};

const mapTrendStatus = (value: unknown, severity: AIAlert['severity']): AIAlert['trend_status'] => {
  const normalized = normalizeWord(value);
  if (normalized === 'stable' || normalized === 'rising' || normalized === 'anomaly') {
    return normalized;
  }

  if (severity === 'critical' || severity === 'high') {
    return 'anomaly';
  }

  if (severity === 'medium') {
    return 'rising';
  }

  return 'stable';
};

const mapCampaignStatus = (value: unknown): string => {
  const normalized = normalizeWord(value);
  if (!normalized) return 'planned';

  if (normalized === 'active') return 'ongoing';
  if (normalized === 'upcoming') return 'planned';

  return normalized;
};

const isAllowedDistrict = (district: string | null | undefined, profile: Profile): boolean => {
  if (!isDistrictScopedRole(profile.role)) return true;
  const userDistrict = normalizeDistrict(profile.district);
  if (!userDistrict) return false;
  return normalizeDistrict(district) === userDistrict;
};

const applyDistrictScope = <T extends { district?: string | null }>(rows: T[], profile: Profile): T[] => {
  if (!isDistrictScopedRole(profile.role)) return rows;
  return rows.filter((row) => isAllowedDistrict(row.district, profile));
};

// ── Session probe cache ───────────────────────────────────────────────────────
// Deployments differ in which analytics views/columns exist, so this module
// probes candidate relation names and select clauses. Probes that fail because
// the relation or column is missing will keep failing for the whole session,
// so they are remembered here and skipped on subsequent dashboard loads.
// Transient failures (network, timeouts) are NOT cached, so going offline
// never permanently disables a working view.

const deadProbeCache = new Set<string>();

const probeKey = (table: string, selectClause: string): string => `${table}::${selectClause}`;

const isMissingSchemaError = (error: unknown): boolean => {
  const code = String((error as any)?.code ?? '');
  // 42P01 undefined table, 42703 undefined column, PGRST2xx schema-cache misses.
  if (code === '42P01' || code === '42703' || code.startsWith('PGRST2')) return true;

  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('could not find')
  );
};

async function runSelect(
  table: string,
  selectClause: string,
  configure?: (query: any) => any
): Promise<GenericRow[] | null> {
  const key = probeKey(table, selectClause);
  if (deadProbeCache.has(key)) return null;

  try {
    let query = supabase.from(table).select(selectClause);
    if (configure) {
      query = configure(query);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      if (error && isMissingSchemaError(error)) {
        deadProbeCache.add(key);
      }
      return null;
    }

    return data as unknown as GenericRow[];
  } catch (error) {
    if (isMissingSchemaError(error)) {
      deadProbeCache.add(key);
    }
    return null;
  }
}

async function selectFirstSuccessful(
  table: string,
  selectVariants: string[],
  configure?: (query: any) => any
): Promise<GenericRow[]> {
  for (const selectClause of selectVariants) {
    const rows = await runSelect(table, selectClause, configure);
    if (rows) return rows;
  }

  return [];
}

async function selectFromFirstAvailableView(
  views: string[],
  selectClause: string,
  configure?: (query: any) => any
): Promise<GenericRow[]> {
  for (const viewName of views) {
    const rows = await runSelect(viewName, selectClause, configure);
    if (rows && rows.length > 0) {
      return rows;
    }
  }
  return [];
}

// parseHealthScoreRow lived here to map a precomputed ranking view into
// DistrictHealthRanking. No such view exists, so it was only ever reachable
// from a branch that could not be taken. Removed with the dead probes.

export async function getDistrictHealthRanking(profile: Profile): Promise<DistrictHealthRanking[]> {
  // This used to probe vw_district_health_ranking, district_health_scores and
  // vw_health_scores in turn. None of the three exists, so every open of the
  // District Health Score screen fired three guaranteed-404 requests before
  // doing the real work below.
  //
  // There is a real view — vw_district_health_score — but it is NOT a
  // substitute: it exposes raw aggregates (total_reports, total_cases,
  // active_outbreaks, avg_severity_score) and has neither health_score nor
  // risk_rank. Wiring it in would have satisfied the "view found" branch and
  // produced a ranking of zeroes. The score is computed here, from source
  // rows, and that is the only implementation.
  const cutoffIso = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

  const [diseaseRows, waterRows, outbreakRows] = await Promise.all([
    selectFirstSuccessful(
      'disease_reports',
      [
        // approved_at is what makes the response-time term real — see the
        // diseaseRows loop below.
        'district,cases_count,approval_status,created_at,approved_at',
        'district,cases_count,approval_status,created_at',
        'district,cases_count,created_at',
      ],
      (query) => query.gte('created_at', cutoffIso).limit(5000)
    ),
    selectFirstSuccessful(
      'water_quality_reports',
      [
        'district,overall_quality,approval_status,created_at',
        'district,overall_quality,created_at',
      ],
      (query) => query.gte('created_at', cutoffIso).limit(5000)
    ),
    selectFirstSuccessful(
      'outbreaks',
      [
        'district,status,window_end,created_at',
        'district,status,created_at',
      ],
      (query) => query.gte('created_at', cutoffIso).limit(5000)
    ),
    // A fourth query fetched health_alerts as 'district,created_at,resolved_at,
    // status' purely to derive response time. health_alerts has no resolved_at
    // column, so Postgres rejected it with 42703 on every single open of the
    // District Health Score screen — for all six roles — and the fallback
    // variant then returned rows with no resolution timestamp at all. The
    // metric could never be computed, so responseCount stayed 0 and every
    // district silently took the hardcoded 12-hour default below. Response
    // time now comes from disease_reports.approved_at, which is real data.
  ]);

  type DistrictMetrics = {
    district: string;
    activeCases: number;
    waterScoreTotal: number;
    waterScoreCount: number;
    outbreakCount: number;
    responseHoursTotal: number;
    responseCount: number;
  };

  const metrics = new Map<string, DistrictMetrics>();

  const ensureDistrict = (districtValue: string | null): DistrictMetrics | null => {
    if (!districtValue || !isAllowedDistrict(districtValue, profile)) return null;
    const districtKey = districtValue.trim();
    const existing = metrics.get(districtKey);
    if (existing) return existing;

    const seed: DistrictMetrics = {
      district: districtKey,
      activeCases: 0,
      waterScoreTotal: 0,
      waterScoreCount: 0,
      outbreakCount: 0,
      responseHoursTotal: 0,
      responseCount: 0,
    };
    metrics.set(districtKey, seed);
    return seed;
  };

  diseaseRows.forEach((row) => {
    const approvalStatus = normalizeWord(row.approval_status);
    if (approvalStatus === 'rejected') return;

    const district = getStringField(row, ['district']);
    const bucket = ensureDistrict(district);
    if (!bucket) return;

    const caseCount = Math.max(0, toNumber(row.cases_count, 1));
    bucket.activeCases += caseCount;

    // Officer response time: how long a report waited for a human decision.
    // Only approved reports have a decision timestamp to measure against.
    if (approvalStatus === 'approved') {
      const createdMs = toDateMs(row.created_at);
      const approvedMs = toDateMs(row.approved_at);
      if (createdMs !== null && approvedMs !== null && approvedMs >= createdMs) {
        const hours = (approvedMs - createdMs) / (1000 * 60 * 60);
        if (Number.isFinite(hours)) {
          bucket.responseHoursTotal += hours;
          bucket.responseCount += 1;
        }
      }
    }
  });

  waterRows.forEach((row) => {
    const approvalStatus = normalizeWord(row.approval_status);
    if (approvalStatus === 'rejected') return;

    const district = getStringField(row, ['district']);
    const bucket = ensureDistrict(district);
    if (!bucket) return;

    const qualityKey = normalizeWord(row.overall_quality);
    const qualityScore = WATER_QUALITY_SCORE[qualityKey] ?? 55;
    bucket.waterScoreTotal += qualityScore;
    bucket.waterScoreCount += 1;
  });

  outbreakRows.forEach((row) => {
    const district = getStringField(row, ['district']);
    const bucket = ensureDistrict(district);
    if (!bucket) return;

    const status = normalizeWord(row.status);
    if (!status || status === 'active' || status === 'monitoring') {
      bucket.outbreakCount += 1;
    }
  });

  const ranking = Array.from(metrics.values()).map((row) => {
    const avgWaterScore = row.waterScoreCount > 0 ? row.waterScoreTotal / row.waterScoreCount : 60;
    // No approvals in the window means no measured response time. Assume a
    // neutral 12h rather than rewarding a district for having decided nothing;
    // until this query was fixed, EVERY district silently took this branch.
    const avgResponse = row.responseCount > 0 ? row.responseHoursTotal / row.responseCount : 12;

    const healthScore = clamp(
      Math.round(
        100
          - Math.min(58, row.activeCases * 0.33)
          - row.outbreakCount * 11
          - Math.min(20, avgResponse * 0.75)
          + avgWaterScore * 0.35
      ),
      0,
      100
    );

    return {
      district: row.district,
      active_cases: row.activeCases,
      avg_water_score: Number(avgWaterScore.toFixed(1)),
      outbreak_count: row.outbreakCount,
      avg_response_time: Number(avgResponse.toFixed(1)),
      health_score: healthScore,
      risk_rank: 0,
    } as DistrictHealthRanking;
  });

  const sorted = ranking.sort((a, b) => a.health_score - b.health_score);
  return sorted.map((row, index) => ({
    ...row,
    risk_rank: index + 1,
  }));
}

const parseCampaignName = (row: GenericRow): string =>
  getStringField(row, ['campaign_name', 'title', 'name']) ?? 'Untitled campaign';

export async function getCampaignEffectiveness(profile: Profile): Promise<CampaignEffectiveness[]> {
  const viewRows = await selectFromFirstAvailableView(
    // Only vw_campaign_effectiveness exists (it does have success_score).
    // campaign_effectiveness and vw_campaign_performance never did, and each
    // open of Campaign Intelligence paid for two 404s to learn that again.
    ['vw_campaign_effectiveness'],
    '*',
    (query) => query.order('success_score', { ascending: false }).limit(300)
  );

  if (viewRows.length > 0) {
    const mapped = applyDistrictScope(
      viewRows.map((row) => ({
        campaign_id: getStringField(row, ['campaign_id', 'id']) ?? '',
        campaign_name: parseCampaignName(row),
        campaign_type: getStringField(row, ['campaign_type']),
        district: getStringField(row, ['district']),
        state: getStringField(row, ['state']),
        status: getStringField(row, ['status']),
        start_date: getStringField(row, ['start_date']),
        end_date: getStringField(row, ['end_date']),
        target_population: toOptionalNumber(row.target_population),
        reached_population: toOptionalNumber(row.reached_population),
        participant_count: toOptionalNumber(row.participant_count),
        cases_before: toOptionalNumber(row.cases_before),
        cases_after: toOptionalNumber(row.cases_after),
        success_score: toOptionalNumber(row.success_score),
        impact_score: toOptionalNumber(row.impact_score),
      })),
      profile
    );

    return mapped.filter((item) => item.campaign_id.length > 0);
  }

  // Both candidate lists used to select title, name, target_population and
  // reached_population. None of the four exists on health_campaigns, and
  // Postgres rejects a statement on its first unknown column (42703), so
  // BOTH candidates failed and getCampaignEffectiveness always returned [].
  // Campaign Intelligence therefore showed a quiet zero — not "no campaigns",
  // but "the query never worked" — for every role that can open it.
  const campaignRows = await selectFirstSuccessful(
    'health_campaigns',
    [
      'id,campaign_name,campaign_type,district,state,status,start_date,end_date,target_beneficiaries,current_participants,max_participants,created_at',
      'id,campaign_name,campaign_type,district,state,status,start_date,end_date,created_at',
    ],
    (query) => query.order('created_at', { ascending: false }).limit(500)
  );

  if (campaignRows.length === 0) {
    return [];
  }

  const participantRowsPrimary = await selectFirstSuccessful(
    'campaign_participants',
    ['campaign_id,status'],
    (query) => query.limit(5000)
  );

  const participantRowsSecondary = participantRowsPrimary.length > 0
    ? []
    : await selectFirstSuccessful('campaign_volunteers', ['campaign_id,status'], (query) => query.limit(5000));

  const participantRows = participantRowsPrimary.length > 0 ? participantRowsPrimary : participantRowsSecondary;

  const participantCountByCampaign = new Map<string, number>();
  participantRows.forEach((row) => {
    const campaignId = getStringField(row, ['campaign_id']);
    if (!campaignId) return;

    const status = normalizeWord(row.status);
    if (status === 'cancelled' || status === 'withdrawn' || status === 'absent') return;

    participantCountByCampaign.set(campaignId, (participantCountByCampaign.get(campaignId) ?? 0) + 1);
  });

  const mapped = applyDistrictScope(
    campaignRows.map((row) => {
      const campaignId = getStringField(row, ['id']) ?? '';
      const targetPopulation = toNumber(
        row.target_population ?? row.target_beneficiaries ?? row.max_participants,
        0
      );
      const reachedPopulation = toNumber(row.reached_population ?? row.current_participants, 0);
      const participants = Math.max(
        toNumber(row.current_participants, 0),
        participantCountByCampaign.get(campaignId) ?? 0
      );

      const reachRate = targetPopulation > 0 ? (reachedPopulation / targetPopulation) * 100 : participants * 8;
      const participationRate = targetPopulation > 0 ? (participants / targetPopulation) * 100 : participants * 6;

      const status = mapCampaignStatus(row.status);
      const statusBonus = status === 'completed' ? 8 : status === 'ongoing' ? 4 : status === 'cancelled' ? -10 : 0;
      const successScore = clamp(Math.round(reachRate * 0.72 + participationRate * 0.28), 0, 100);
      const impactScore = clamp(successScore + statusBonus, 0, 100);

      return {
        campaign_id: campaignId,
        campaign_name: parseCampaignName(row),
        campaign_type: getStringField(row, ['campaign_type']),
        district: getStringField(row, ['district']),
        state: getStringField(row, ['state']),
        status,
        start_date: getStringField(row, ['start_date']),
        end_date: getStringField(row, ['end_date']),
        target_population: targetPopulation,
        reached_population: reachedPopulation,
        participant_count: participants,
        cases_before: null,
        cases_after: null,
        success_score: successScore,
        impact_score: impactScore,
      } as CampaignEffectiveness;
    }),
    profile
  );

  return mapped
    .filter((row) => row.campaign_id.length > 0)
    .sort((a, b) => toNumber(b.success_score, 0) - toNumber(a.success_score, 0));
}

export async function getCampaignIntelligence(profile: Profile): Promise<string[]> {
  const effectiveness = await getCampaignEffectiveness(profile);

  if (effectiveness.length === 0) {
    return ['No campaign performance data is available yet for intelligence analysis.'];
  }

  const sorted = [...effectiveness].sort(
    (a, b) => toNumber(b.success_score, 0) - toNumber(a.success_score, 0)
  );
  const top = sorted[0];
  const lowPerformers = sorted.filter((row) => toNumber(row.success_score, 0) < 45);
  const lowReach = sorted.filter((row) => {
    const target = toNumber(row.target_population, 0);
    const reached = toNumber(row.reached_population, 0);
    return target > 0 && reached / target < 0.35;
  });
  const highImpact = sorted.filter((row) => toNumber(row.impact_score, 0) >= 70);

  const insights: string[] = [];

  insights.push(
    `Top campaign: ${top.campaign_name} with success score ${Math.round(toNumber(top.success_score, 0))}.`
  );

  if (highImpact.length > 1) {
    insights.push(`${highImpact.length} campaigns are currently in high-impact range (score >= 70).`);
  }

  if (lowPerformers.length > 0) {
    insights.push(
      `${lowPerformers.length} campaigns are underperforming. Prioritize these for targeted field mobilization.`
    );
  }

  if (lowReach.length > 0) {
    insights.push(
      `${lowReach.length} campaigns have reached less than 35% of target population. Re-plan channels and field execution.`
    );
  }

  const completedCount = sorted.filter((row) => normalizeWord(row.status) === 'completed').length;
  insights.push(
    `${completedCount} campaigns are completed. Replicate tactics from high performers into current active campaigns.`
  );

  return insights.slice(0, 5);
}

// ── Escalation SLA — the threshold is data, not a number in a function ────────
//
// It used to be `is_overdue: pendingHours >= 24` inside the row mapper, with a
// second hardcoded ladder (18 / 36 / 72 h) deciding the escalation level. One
// number for every report type, every severity and every district: a block that
// approves within two hours and a block that approves within two days got the
// same red badge, and neither could change it without a release.
//
// The threshold now lives in ONE tier table, keyed the way an SLA actually
// varies — report type, severity and district.
//
// `getEscalationSlaPolicy()` is the single seam and it READS THE DATABASE. The
// live project has no approval-SLA relation yet (checked 3 Aug 2026: the only
// candidate, `outbreak_thresholds`, holds disease_name / case_threshold /
// window_days — that is outbreak DETECTION, not approval latency, and it has
// no district, no report type and no hours). So today the read 404s, the
// built-in ladder below governs, and the screen says so in words. The moment
// `escalation_sla_thresholds` is created (migration in the BRK-19 hand-off)
// the same code path starts returning `source: 'database'` with no further
// edit — the alternative, leaving a hook that returns a constant, is how this
// project keeps shipping half-fixes that read as done.
//
// The one probe is remembered in `deadProbeCache`, so a database without the
// table pays ONE request per session, not one per screen open. That is
// DEL-09's complaint honoured without leaving the seam inert.

export type EscalationReportType = 'disease' | 'water' | 'campaign' | 'alert' | 'report';

/** One row of the SLA table. `severity: null` means "any severity of this type". */
export interface EscalationSlaTier {
  /** null = applies nationally; a district row overrides the national one. */
  district: string | null;
  report_type: EscalationReportType;
  severity: string | null;
  hours: number;
  label: string;
  /** Where this single row came from, so a merged policy can show which hours an official actually set. */
  origin: 'built-in' | 'database';
}

export interface EscalationSlaPolicy {
  /** 'database' only when at least one configured row is in force. */
  source: 'built-in' | 'database';
  /** True when this deployment CAN store thresholds — false while the ladder ships in the build. */
  editable: boolean;
  tiers: EscalationSlaTier[];
}

// Ordered most-specific first. Hours are the wait after which an item is
// OVERDUE — 2× is escalation level 2, 3× is level 3 (see escalationLevelFor).
const BUILT_IN_SLA_TIERS: Omit<EscalationSlaTier, 'origin'>[] = [
  // A public alert waiting on approval is a warning nobody has received yet.
  { district: null, report_type: 'alert', severity: 'critical', hours: 2, label: 'Alert · critical' },
  { district: null, report_type: 'alert', severity: 'high', hours: 4, label: 'Alert · high' },
  { district: null, report_type: 'alert', severity: 'medium', hours: 12, label: 'Alert · medium' },
  { district: null, report_type: 'alert', severity: 'low', hours: 24, label: 'Alert · low' },
  { district: null, report_type: 'alert', severity: null, hours: 12, label: 'Alert · other' },

  { district: null, report_type: 'disease', severity: 'critical', hours: 6, label: 'Disease · critical' },
  { district: null, report_type: 'disease', severity: 'high', hours: 12, label: 'Disease · high' },
  { district: null, report_type: 'disease', severity: 'medium', hours: 24, label: 'Disease · medium' },
  { district: null, report_type: 'disease', severity: 'low', hours: 48, label: 'Disease · low' },
  { district: null, report_type: 'disease', severity: null, hours: 24, label: 'Disease · other' },

  { district: null, report_type: 'water', severity: 'unsafe', hours: 12, label: 'Water · unsafe' },
  { district: null, report_type: 'water', severity: 'marginal', hours: 24, label: 'Water · marginal' },
  { district: null, report_type: 'water', severity: 'safe', hours: 48, label: 'Water · safe' },
  { district: null, report_type: 'water', severity: null, hours: 24, label: 'Water · other' },

  { district: null, report_type: 'campaign', severity: null, hours: 72, label: 'Campaign' },

  // Last resort. Deliberately the old 24 h, so an unrecognised type keeps the
  // behaviour this screen has always had instead of silently becoming lenient.
  { district: null, report_type: 'report', severity: null, hours: 24, label: 'Other' },
];

export const DEFAULT_ESCALATION_SLA_TIERS: EscalationSlaTier[] = BUILT_IN_SLA_TIERS.map((tier) => ({
  ...tier,
  origin: 'built-in' as const,
}));

const BUILT_IN_ESCALATION_SLA: EscalationSlaPolicy = {
  source: 'built-in',
  editable: false,
  tiers: DEFAULT_ESCALATION_SLA_TIERS,
};

// ── Reading the policy from the database ─────────────────────────────────────

const ESCALATION_SLA_TABLE = 'escalation_sla_thresholds';
const ESCALATION_SLA_SELECT = 'district,report_type,severity,hours,label';

const ESCALATION_REPORT_TYPES = new Set<string>(['disease', 'water', 'campaign', 'alert', 'report']);

const TYPE_TITLES: Record<EscalationReportType, string> = {
  disease: 'Disease',
  water: 'Water',
  campaign: 'Campaign',
  alert: 'Alert',
  report: 'Other',
};

/** A row with no label of its own still has to read as a sentence in the SLA table. */
const describeTier = (
  reportType: EscalationReportType,
  severity: string | null,
  district: string | null
): string => {
  const base = severity ? `${TYPE_TITLES[reportType]} · ${severity}` : TYPE_TITLES[reportType];
  return district ? `${base} (${district})` : base;
};

/** Identity of a threshold: one district + type + severity has exactly one number. */
const tierKey = (tier: EscalationSlaTier): string =>
  `${normalizeDistrict(tier.district)}|${tier.report_type}|${tier.severity ?? ''}`;

const parseSlaRow = (row: GenericRow): EscalationSlaTier | null => {
  const reportType = normalizeWord(row.report_type);
  if (!ESCALATION_REPORT_TYPES.has(reportType)) return null;

  // A zero or negative SLA would mark every item overdue the instant it was
  // filed, painting the whole queue red off one bad edit. Drop the row and let
  // the built-in tier underneath it govern instead.
  const hours = toNumber(row.hours, Number.NaN);
  if (!Number.isFinite(hours) || hours <= 0) return null;

  const district = getStringField(row, ['district']);
  const severityRaw = getStringField(row, ['severity']);
  const severity = severityRaw ? normalizeWord(severityRaw) : null;

  return {
    district,
    report_type: reportType as EscalationReportType,
    severity,
    hours,
    label: getStringField(row, ['label']) ?? describeTier(reportType as EscalationReportType, severity, district),
    origin: 'database',
  };
};

/**
 * Configured rows win; the built-in ladder fills every gap they leave.
 *
 * A district that sets only "alert · critical = 1h" must not lose the rule for
 * everything else — a partially configured table that silently made 14 other
 * kinds of item un-escalatable would be worse than the constant this replaced.
 * `resolveEscalationSla` takes the FIRST match at each specificity level, so
 * putting database rows ahead of built-ins is what makes them override.
 */
const mergeSlaTiers = (dbTiers: EscalationSlaTier[]): EscalationSlaTier[] => {
  const configured = new Set(dbTiers.map(tierKey));
  return [...dbTiers, ...DEFAULT_ESCALATION_SLA_TIERS.filter((tier) => !configured.has(tierKey(tier)))];
};

/**
 * The SLA policy in force for this profile.
 *
 * Three honest outcomes, and the screen says which one it got:
 *   - no such table   → built-in ladder, not editable (today's live project)
 *   - table, no rows  → built-in ladder, but editable — nobody has set one yet
 *   - table with rows → those hours, with built-ins filling the gaps
 */
export async function getEscalationSlaPolicy(_profile: Profile): Promise<EscalationSlaPolicy> {
  const key = probeKey(ESCALATION_SLA_TABLE, ESCALATION_SLA_SELECT);
  if (deadProbeCache.has(key)) return BUILT_IN_ESCALATION_SLA;

  const { data, error } = await supabase
    .from(ESCALATION_SLA_TABLE)
    .select(ESCALATION_SLA_SELECT)
    .order('report_type', { ascending: true })
    .order('hours', { ascending: true });

  if (error) {
    if (isMissingSchemaError(error)) {
      // Not a failure: this deployment has no SLA table, so the built-in
      // ladder IS the rule in force. Remembered so it costs one request per
      // session rather than one per open.
      deadProbeCache.add(key);
      return BUILT_IN_ESCALATION_SLA;
    }

    // The table exists and we could not read it. Falling back to the built-in
    // hours here would print a threshold that is NOT the one in force and mark
    // items overdue against it — a confident number standing in for a failed
    // query, which is this codebase's signature defect. Let the caller's error
    // state own it.
    throw new Error(`Escalation SLA policy could not be read: ${error.message}`);
  }

  const tiers = ((data ?? []) as unknown as GenericRow[])
    .map(parseSlaRow)
    .filter((tier): tier is EscalationSlaTier => tier !== null);

  if (tiers.length === 0) {
    return { source: 'built-in', editable: true, tiers: DEFAULT_ESCALATION_SLA_TIERS };
  }

  return { source: 'database', editable: true, tiers: mergeSlaTiers(tiers) };
}

/** Most-specific match wins: district+type+severity → type+severity → type → 'report'. */
export function resolveEscalationSla(
  policy: EscalationSlaPolicy,
  reportType: EscalationReportType,
  severityKey: string | null,
  district?: string | null
): EscalationSlaTier {
  const districtKey = normalizeDistrict(district);
  const severity = severityKey ? normalizeWord(severityKey) : null;

  const candidates: ((tier: EscalationSlaTier) => boolean)[] = [
    (tier) =>
      tier.report_type === reportType &&
      tier.severity === severity &&
      normalizeDistrict(tier.district) === districtKey &&
      districtKey.length > 0,
    (tier) =>
      tier.report_type === reportType && tier.severity === null &&
      normalizeDistrict(tier.district) === districtKey && districtKey.length > 0,
    (tier) => tier.report_type === reportType && tier.severity === severity && tier.district === null,
    (tier) => tier.report_type === reportType && tier.severity === null && tier.district === null,
    (tier) => tier.report_type === 'report' && tier.district === null,
  ];

  for (const matches of candidates) {
    const tier = policy.tiers.find(matches);
    if (tier && tier.hours > 0) return tier;
  }

  return DEFAULT_ESCALATION_SLA_TIERS[DEFAULT_ESCALATION_SLA_TIERS.length - 1];
}

/**
 * Level is now a ratio of the item's OWN SLA, so `is_overdue` and
 * `escalation_level >= 1` can never disagree — the screen's "Overdue" and
 * "High escalation" counts are the same arithmetic, not two constants.
 */
const escalationLevelFor = (pendingHours: number, slaHours: number): number => {
  if (slaHours <= 0) return 0;
  const ratio = pendingHours / slaHours;
  if (ratio >= 3) return 3;
  if (ratio >= 2) return 2;
  if (ratio >= 1) return 1;
  return 0;
};

/** disease_reports.severity / health_alerts.urgency_level — CHECK: low|medium|high|critical. */
const normalizeLadderSeverity = (value: unknown): string | null => {
  const key = normalizeWord(value);
  return key === 'low' || key === 'medium' || key === 'high' || key === 'critical' ? key : null;
};

/**
 * water_quality_reports.overall_quality — CHECK allows
 * safe|moderate|unsafe|critical|poor|contaminated. Collapsed to the three tiers
 * an approval SLA can meaningfully distinguish.
 */
const normalizeWaterSeverity = (value: unknown): string | null => {
  const key = normalizeWord(value);
  if (key === 'unsafe' || key === 'critical' || key === 'contaminated') return 'unsafe';
  if (key === 'poor' || key === 'moderate') return 'marginal';
  if (key === 'safe') return 'safe';
  return null;
};

/** What the record is, beyond its uuid — a 60-hour cholera row must not read like a routine one. */
export interface EscalationRecordWithSla extends EscalationRecord {
  sla_hours: number;
  sla_label: string;
  sla_source: EscalationSlaPolicy['source'];
  /** 0 when inside the SLA; hours past the threshold when not. */
  overdue_by_hours: number;
  severity_label: string | null;
  headline: string | null;
}

interface EscalationSource {
  table: string;
  reportType: EscalationReportType;
  select: string;
  severityField: string | null;
  severityOf: (value: unknown) => string | null;
  headlineField: string | null;
}

// Every column below was confirmed present on the live project on 3 Aug 2026,
// so there is no select-variant fallback: a failure here is a real failure and
// is raised, not swallowed into an empty list that reads as "queue clear".
const ESCALATION_SOURCES: EscalationSource[] = [
  {
    table: 'disease_reports',
    reportType: 'disease',
    select:
      'id,district,state,location_name,status,approval_status,created_at,updated_at,last_updated_at,severity,disease_name',
    severityField: 'severity',
    severityOf: normalizeLadderSeverity,
    headlineField: 'disease_name',
  },
  {
    table: 'water_quality_reports',
    reportType: 'water',
    select:
      'id,district,state,location_name,status,approval_status,created_at,updated_at,last_updated_at,overall_quality,source_name',
    severityField: 'overall_quality',
    severityOf: normalizeWaterSeverity,
    headlineField: 'source_name',
  },
  {
    table: 'health_campaigns',
    reportType: 'campaign',
    select: 'id,district,state,location_name,status,approval_status,created_at,updated_at,campaign_name',
    severityField: null,
    severityOf: () => null,
    headlineField: 'campaign_name',
  },
  {
    table: 'health_alerts',
    reportType: 'alert',
    select: 'id,district,state,location_name,status,approval_status,created_at,updated_at,urgency_level,title',
    severityField: 'urgency_level',
    severityOf: normalizeLadderSeverity,
    headlineField: 'title',
  },
];

// The one approval_status value that means "waiting for a human".
//
// Re-checked against the live project on 3 Aug 2026, and the earlier claim here
// that all four tables enforce it was WRONG. Three do:
//   disease_reports / water_quality_reports / health_campaigns
//     CHECK (approval_status = ANY (ARRAY['pending_approval','approved','rejected']))
// `health_alerts` has NO such constraint — the column is merely nullable with
// DEFAULT 'pending_approval'. It is correct in practice because
// auto_approve_alert_fn() writes literally 'pending_approval' on the non-admin
// branch, but nothing stops a NULL or a typo, and such a row would drop out of
// the equality filter below and leave this screen reading "Queue clear" over an
// alert nobody has approved. The CHECK that closes that hole is DDL and is
// reported in the BRK-19 hand-off rather than applied from here.
const PENDING_APPROVAL = 'pending_approval';

// Oldest-first, so if this cap is ever hit the rows that fall off are the
// NEWEST — the least overdue. Truncating the other way would drop exactly the
// items this screen exists to surface.
const ESCALATION_FETCH_LIMIT = 1000;

const mapEscalationRow = (
  row: GenericRow,
  source: EscalationSource,
  policy: EscalationSlaPolicy
): EscalationRecordWithSla => {
  const createdAt = getStringField(row, ['created_at']) ?? new Date().toISOString();
  const lastUpdated = getStringField(row, ['last_updated_at', 'updated_at']);

  const createdMs = toDateMs(createdAt) ?? Date.now();
  const pendingHours = Math.max(0, (Date.now() - createdMs) / (1000 * 60 * 60));

  const district = getStringField(row, ['district']);
  const severityKey = source.severityField ? source.severityOf(row[source.severityField]) : null;
  const tier = resolveEscalationSla(policy, source.reportType, severityKey, district);
  const overdueBy = Math.max(0, pendingHours - tier.hours);

  return {
    report_id: getStringField(row, ['id']) ?? '',
    report_type: source.reportType,
    district,
    state: getStringField(row, ['state']),
    location_name: getStringField(row, ['location_name']),
    status: getStringField(row, ['status']),
    approval_status: getStringField(row, ['approval_status']),
    escalation_level: escalationLevelFor(pendingHours, tier.hours),
    created_at: createdAt,
    last_updated_at: lastUpdated,
    pending_hours: Number(pendingHours.toFixed(1)),
    is_overdue: pendingHours >= tier.hours,
    sla_hours: tier.hours,
    sla_label: tier.label,
    sla_source: policy.source,
    overdue_by_hours: Number(overdueBy.toFixed(1)),
    severity_label: severityKey,
    headline: source.headlineField ? getStringField(row, [source.headlineField]) : null,
  };
};

export async function getEscalationMonitoring(profile: Profile): Promise<EscalationRecordWithSla[]> {
  // Probed vw_escalation_monitoring, escalation_monitoring and
  // vw_pending_escalations here. None of the three exists in this database,
  // so the screen paid for three 404s on every open and then did the real
  // work below regardless.
  //
  // Two things this used to get wrong, both confirmed against the live project:
  //
  // 1. It selected `created_at >= now() - 14 days`. A report pending for 15
  //    days — the single worst SLA breach possible — dropped off the screen
  //    and the queue read "Queue clear". The window is gone: the filter is
  //    `approval_status = 'pending_approval'`, which IS the pending queue and
  //    is bounded by it.
  // 2. It treated `status = 'reported'` as pending. `reported` is the INSERT
  //    default of disease_reports.status and is never advanced on approval, so
  //    two APPROVED reports (d0f30a8c Shimla, 82391218 Kovilancheri) matched
  //    the pending test. Approval lives in `approval_status`, nowhere else.
  const policy = await getEscalationSlaPolicy(profile);

  const rowsBySource = await Promise.all(
    ESCALATION_SOURCES.map(async (source) => {
      const { data, error } = await supabase
        .from(source.table)
        .select(source.select)
        .eq('approval_status', PENDING_APPROVAL)
        .order('created_at', { ascending: true })
        .limit(ESCALATION_FETCH_LIMIT);

      // No `?? []`, no `catch { return [] }`. A failed query must not be
      // indistinguishable from an empty approval queue on this of all screens.
      if (error) {
        throw new Error(`Escalation monitoring could not read ${source.table}: ${error.message}`);
      }

      return { source, rows: (data ?? []) as unknown as GenericRow[] };
    })
  );

  const records: EscalationRecordWithSla[] = [];

  rowsBySource.forEach(({ source, rows }) => {
    rows.forEach((row) => {
      const mapped = mapEscalationRow(row, source, policy);
      if (!mapped.report_id) return;
      if (!isAllowedDistrict(mapped.district, profile)) return;
      records.push(mapped);
    });
  });

  return records.sort((a, b) => {
    // Most-breached first: 3 h past a 2 h alert SLA outranks 40 h into a 72 h
    // campaign SLA. Raw age would have ranked them the other way round.
    const aRatio = toNumber(a.pending_hours, 0) / Math.max(1, a.sla_hours);
    const bRatio = toNumber(b.pending_hours, 0) / Math.max(1, b.sla_hours);
    if (bRatio !== aRatio) return bRatio - aRatio;
    return toNumber(b.pending_hours, 0) - toNumber(a.pending_hours, 0);
  });
}

const mapAIAlertRow = (row: GenericRow, source: 'generated' | 'recommendation'): AIAlert => {
  const district = getStringField(row, ['district']) ?? 'Unknown';
  const diseaseName = getStringField(row, ['disease_name', 'disease_or_issue']) ?? 'Potential health risk';
  const severity = mapSeverity(row.severity);
  const createdAt = getStringField(row, ['created_at']) ?? new Date().toISOString();
  const reportDate = getStringField(row, ['report_date']) ?? createdAt;

  const titleFallback = source === 'generated'
    ? `AI Signal: ${diseaseName}`
    : `AI Recommendation: ${diseaseName}`;

  return {
    id: getStringField(row, ['id']) ?? `${source}-${district}-${createdAt}`,
    district,
    disease_name: diseaseName,
    severity,
    title: getStringField(row, ['title']) ?? titleFallback,
    description: getStringField(row, ['description']) ?? 'No additional AI context was provided.',
    status: getStringField(row, ['status']) ?? 'active',
    created_at: createdAt,
    report_date: reportDate,
    trend_status: mapTrendStatus(row.trend_status, severity),
    state: getStringField(row, ['state']) ?? undefined,
    location_name: getStringField(row, ['location_name']) ?? undefined,
    confidence_score: (() => {
      const score = toNumber(row.confidence_score, Number.NaN);
      return Number.isNaN(score) ? undefined : score;
    })(),
    recommended_action: getStringField(row, ['recommended_action']) ?? undefined,
  };
};

export async function getAIAlerts(profile: Profile): Promise<AIAlert[]> {
  const generatedRows = await selectFirstSuccessful(
    'ai_generated_alerts',
    ['*'],
    (query) => query.order('created_at', { ascending: false }).limit(300)
  );

  let mapped = generatedRows.map((row) => mapAIAlertRow(row, 'generated'));

  // There was a second fallback to an `ai_alerts` table here. No such table
  // exists, so it 404'd on every dashboard load that had no AI alerts yet —
  // silent to the user, but a wasted round-trip and console noise on the
  // most-visited screen. The real table is ai_generated_alerts, queried above.

  if (mapped.length === 0) {
    const recommendationRows = await selectFirstSuccessful(
      'ai_recommendations',
      ['*'],
      (query) => query.eq('type', 'alert').order('created_at', { ascending: false }).limit(300)
    );

    mapped = recommendationRows.map((row) => mapAIAlertRow(row, 'recommendation'));
  }

  const scoped = filterAlertsForProfile(mapped, profile);

  return scoped.sort(
    (a, b) => (toDateMs(b.created_at) ?? 0) - (toDateMs(a.created_at) ?? 0)
  );
}
