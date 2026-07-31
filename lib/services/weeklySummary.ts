// =====================================================
// WEEKLY DISTRICT SUMMARY SERVICE (Bharosa D·03)
// Builds the "HEALTHDROP WEEKLY · W{n}" figures for one
// district and one ISO week (Mon–Sun), plus the two
// artifacts that leave the app: a <500-char plain-text
// WhatsApp caption and a 1-page IDSP-style print HTML.
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
// =====================================================
import {
  addDays,
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from 'date-fns';
import { supabase } from '../supabase';

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

export function buildWhatsAppCaption(summary: WeeklySummary): string {
  const top =
    summary.topDiseases.length > 0
      ? summary.topDiseases.map((d) => `${d.name} ${d.count}`).join(' · ')
      : 'none';
  const outbreakDetail =
    summary.activeOutbreaks.count > 0
      ? ` (${summary.activeOutbreaks.items
          .slice(0, 2)
          .map((o) => `${o.shortId} day ${o.dayAge}`)
          .join(', ')}${
          summary.activeOutbreaks.count > 2 ? `, +${summary.activeOutbreaks.count - 2} more` : ''
        })`
      : '';
  const lines = [
    `HEALTHDROP WEEKLY · ${summary.weekTag}`,
    `${summary.rangeLabel} · ${summary.district}`,
    `New cases (approved): ${summary.newCasesApproved} (${formatCasesDelta(summary)})`,
    `Top: ${top}`,
    `Deaths: ${summary.deaths}`,
    `Active outbreaks: ${summary.activeOutbreaks.count}${outbreakDetail}`,
    `Water: ${summary.waterUnsafe} unsafe now · ${summary.waterRetestedSafe} retested safe`,
    `Alerts: ${summary.alertsIssued} issued · ack ${formatAckRate(summary)}`,
    `✓ VERIFIED — human-approved reports only`,
  ];
  const caption = lines.join('\n');
  return caption.length <= 500 ? caption : `${caption.slice(0, 497)}…`;
}

// ─────────────────────────────────────────────────────
//  Artifact 2 — 1-page IDSP-style print HTML
//  A PDF is a fixed-light paper document that leaves the
//  app; it cannot read useTheme(), so its palette is
//  pinned here: near-black ink on white, one green for
//  the VERIFIED stamp (print equivalents of the Bharosa
//  ink/success tokens).
// ─────────────────────────────────────────────────────

const PRINT_INK = '#111111';
const PRINT_INK_SOFT = '#555555';
const PRINT_RULE = '#cccccc';
const PRINT_STAMP_GREEN = '#157A3C';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function buildSummaryHtml(summary: WeeklySummary): string {
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
  const generated = format(new Date(summary.generatedAtIso), "d MMM yyyy, HH:mm");

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
      @page { size: A4; margin: 18mm; }
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        color: ${PRINT_INK};
        margin: 0;
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
        Generated by HealthDrop on ${escapeHtml(generated)} · Source-state figures (unsafe sources,
        outbreak day-age) reflect records as of generation time.
      </div>
    </div>
  </body>
  </html>`;
}
