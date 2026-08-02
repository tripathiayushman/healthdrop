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

const mapEscalationLevel = (pendingHours: number): number => {
  if (pendingHours >= 72) return 3;
  if (pendingHours >= 36) return 2;
  if (pendingHours >= 18) return 1;
  return 0;
};

const reportTypeLabel = (table: string): string => {
  switch (table) {
    case 'disease_reports':
      return 'disease';
    case 'water_quality_reports':
      return 'water';
    case 'health_campaigns':
      return 'campaign';
    case 'health_alerts':
      return 'alert';
    default:
      return 'report';
  }
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

const mapEscalationRow = (row: GenericRow, fallbackType: string): EscalationRecord => {
  const createdAt = getStringField(row, ['created_at']) ?? new Date().toISOString();
  const lastUpdated = getStringField(row, ['last_updated_at', 'updated_at']);

  const createdMs = toDateMs(createdAt) ?? Date.now();
  const nowMs = Date.now();
  const pendingHours = Math.max(0, (nowMs - createdMs) / (1000 * 60 * 60));
  const escalationLevel = toNumber(row.escalation_level, mapEscalationLevel(pendingHours));

  return {
    report_id: getStringField(row, ['report_id', 'id']) ?? '',
    report_type: getStringField(row, ['report_type']) ?? fallbackType,
    district: getStringField(row, ['district']),
    state: getStringField(row, ['state']),
    location_name: getStringField(row, ['location_name']),
    status: getStringField(row, ['status']),
    approval_status: getStringField(row, ['approval_status']),
    escalation_level: escalationLevel,
    created_at: createdAt,
    last_updated_at: lastUpdated,
    pending_hours: Number(pendingHours.toFixed(1)),
    is_overdue: pendingHours >= 24,
  };
};

export async function getEscalationMonitoring(profile: Profile): Promise<EscalationRecord[]> {
  // Probed vw_escalation_monitoring, escalation_monitoring and
  // vw_pending_escalations here. None of the three exists in this database,
  // so the screen paid for three 404s on every open and then did the real
  // work below regardless.
  const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const tables = [
    {
      name: 'disease_reports',
      select: [
        'id,district,state,location_name,status,approval_status,created_at,updated_at',
        'id,district,state,location_name,status,created_at,updated_at',
      ],
    },
    {
      name: 'water_quality_reports',
      select: [
        'id,district,state,location_name,status,approval_status,created_at,updated_at',
        'id,district,state,location_name,status,created_at,updated_at',
      ],
    },
    {
      name: 'health_campaigns',
      select: [
        'id,district,state,location_name,status,approval_status,created_at,updated_at',
        'id,district,state,location_name,status,created_at,updated_at',
      ],
    },
    {
      name: 'health_alerts',
      select: [
        'id,district,state,location_name,status,approval_status,created_at,updated_at',
        'id,district,state,location_name,status,created_at,updated_at',
      ],
    },
  ];

  const rowsByTable = await Promise.all(
    tables.map(async (table) => ({
      table: table.name,
      rows: await selectFirstSuccessful(table.name, table.select, (query) =>
        query.gte('created_at', cutoffIso).order('created_at', { ascending: false }).limit(1500)
      ),
    }))
  );

  const records: EscalationRecord[] = [];

  rowsByTable.forEach(({ table, rows }) => {
    const fallbackType = reportTypeLabel(table);

    rows.forEach((row) => {
      const approvalStatus = normalizeWord(row.approval_status);
      const status = normalizeWord(row.status);
      const pendingApproval =
        approvalStatus === 'pending_approval' ||
        approvalStatus === 'pending' ||
        status === 'reported' ||
        status === 'pending';

      if (!pendingApproval) return;

      const mapped = mapEscalationRow(row, fallbackType);
      if (!isAllowedDistrict(mapped.district, profile)) return;

      records.push(mapped);
    });
  });

  return records
    .filter((record) => record.report_id.length > 0)
    .sort((a, b) => toNumber(b.pending_hours, 0) - toNumber(a.pending_hours, 0));
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
