// =====================================================
// OUTBREAKS SERVICE
// Rows in public.outbreaks are auto-created by a DB
// trigger when approved case counts cross a threshold
// (outbreak_thresholds). This service is the officer's
// side of that loop: review the signal, run the response
// console, and keep an append-only audit log in
// response_notes. Every appended entry is stamped:
//   [ISO-timestamp] Author Name — text
// =====================================================
import { supabase } from '../supabase';
import { ApiResponse, DiseaseReport } from '../../types';

export type OutbreakStatus = 'active' | 'monitoring' | 'resolved';

export interface Outbreak {
  id: string;
  disease_name: string;
  district: string;
  state?: string | null;
  total_cases: number;
  total_deaths: number;
  report_count: number;
  max_severity?: string | null;
  window_start: string;
  window_end: string;
  status: OutbreakStatus;
  triggered_by_report_id?: string | null;
  detected_by_trigger?: boolean | null;
  /**
   * "A public alert exists for this outbreak" — and NOTHING ELSE may set it.
   *
   * The raw DB column does not mean that. `detect_outbreak_after_report()`
   * runs `UPDATE outbreaks SET alert_sent = TRUE` immediately after inserting
   * in-app notification rows for officials — before any human decides
   * anything, and without creating a `health_alerts` row. Rows that leave
   * this service therefore carry the RECOMPUTED value: true only when a
   * specific approved alert row is genuinely linked (see `alert_link`).
   * The raw column is preserved as `officials_notified`.
   */
  alert_sent?: boolean | null;
  /** The raw trigger flag, honestly named: officials got an in-app notice. */
  officials_notified?: boolean | null;
  /** Result of this service's linked-alert check. Never guessed. */
  alert_link?: AlertLink;
  /** Set by the BRK-10 migration; absent on the live schema today. */
  linked_alert_id?: string | null;
  response_notes?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

/** The alert row an outbreak points at — enough to name it and date it. */
export interface LinkedAlert {
  id: string;
  title: string;
  district?: string | null;
  status?: string | null;
  approval_status?: string | null;
  approved_at?: string | null;
  created_at: string;
}

/**
 * Whether a public alert is attached to an outbreak. Three states, because
 * "we checked and there is none" and "we could not check" are different
 * facts and a screen must never render them the same way.
 */
export type AlertLink =
  | { kind: 'none' }
  | { kind: 'linked'; alert: LinkedAlert }
  | { kind: 'unknown' };

export interface OutbreakThreshold {
  disease_name: string;
  case_threshold: number;
  window_days: number;
}

export interface OutbreakNoteEntry {
  /** ISO timestamp of the entry, null for legacy free-text notes */
  at: string | null;
  /** Author full name, null for legacy free-text notes */
  author: string | null;
  text: string;
}

/**
 * Marker text written into response_notes when an officer confirms
 * a signal. Confirmation is a human decision recorded in the audit
 * log — the row's status alone can't distinguish "auto-detected,
 * unreviewed" from "human-confirmed".
 */
export const OUTBREAK_CONFIRM_MARKER = 'Confirmed outbreak';

export const isOutbreakConfirmed = (outbreak: Pick<Outbreak, 'response_notes'>): boolean =>
  (outbreak.response_notes ?? '').includes(OUTBREAK_CONFIRM_MARKER);

// ─────────────────────────────────────────────────────
//  Alert linkage — what "alert_sent" is allowed to mean
//
//  Only two things count as a link between an outbreak and
//  a public alert:
//    1. outbreaks.linked_alert_id                (once the column exists)
//    2. health_alerts.metadata->>'outbreak_id'   (works on today's schema)
//  Nothing else. Matching on disease name or district is a
//  guess, and the response console used to guess: with no
//  alert naming the disease it fell back to the newest alert
//  in the district and reported THAT alert's acknowledgement
//  rate as this outbreak's reach. An officer read a five-month
//  old typhoid notice's numbers as today's cholera response.
// ─────────────────────────────────────────────────────

const LINKED_ALERT_COLUMNS = 'id, title, district, status, approval_status, approved_at, created_at';

/** An alert only warned the public once a human approved it. */
export const isAlertPubliclyIssued = (link?: AlertLink | null): boolean =>
  link?.kind === 'linked' && link.alert.approval_status === 'approved';

/**
 * Resolve the alert link for a batch of outbreaks in at most two queries.
 * Any failure marks EVERY row 'unknown' — an unreachable alerts table must
 * not be reported as "no alert was issued".
 */
async function fetchAlertLinks(rows: Outbreak[]): Promise<Map<string, AlertLink>> {
  const links = new Map<string, AlertLink>();
  if (rows.length === 0) return links;
  try {
    const alertsById = new Map<string, LinkedAlert>();
    const outbreakIdByAlertId = new Map<string, string>();

    // (2) Alerts that name the outbreak in their metadata. Verified against
    // the live project: `metadata->>outbreak_id=in.(…)` is a valid filter.
    const { data: tagged, error: taggedError } = await supabase
      .from('health_alerts')
      .select(`${LINKED_ALERT_COLUMNS}, metadata`)
      .in('metadata->>outbreak_id', rows.map((r) => r.id));
    if (taggedError) throw taggedError;
    (tagged ?? []).forEach((row: any) => {
      const outbreakId = String(row?.metadata?.outbreak_id ?? '');
      if (!outbreakId) return;
      alertsById.set(row.id, row as LinkedAlert);
      outbreakIdByAlertId.set(row.id, outbreakId);
    });

    // (1) The explicit column wins where it exists.
    const explicitIds = Array.from(
      new Set(rows.map((r) => r.linked_alert_id).filter((id): id is string => !!id)),
    );
    if (explicitIds.length > 0) {
      const { data: explicit, error: explicitError } = await supabase
        .from('health_alerts')
        .select(LINKED_ALERT_COLUMNS)
        .in('id', explicitIds);
      if (explicitError) throw explicitError;
      (explicit ?? []).forEach((row: any) => alertsById.set(row.id, row as LinkedAlert));
    }

    const taggedByOutbreak = new Map<string, LinkedAlert>();
    outbreakIdByAlertId.forEach((outbreakId, alertId) => {
      const alert = alertsById.get(alertId);
      // Newest link wins if an outbreak somehow carries two.
      const current = taggedByOutbreak.get(outbreakId);
      if (alert && (!current || alert.created_at > current.created_at)) {
        taggedByOutbreak.set(outbreakId, alert);
      }
    });

    rows.forEach((row) => {
      if (row.linked_alert_id) {
        const alert = alertsById.get(row.linked_alert_id);
        // A link pointing at a row we cannot see is a question, not a "no".
        links.set(row.id, alert ? { kind: 'linked', alert } : { kind: 'unknown' });
        return;
      }
      const tagged = taggedByOutbreak.get(row.id);
      links.set(row.id, tagged ? { kind: 'linked', alert: tagged } : { kind: 'none' });
    });
    return links;
  } catch (error: any) {
    console.error('Error resolving outbreak alert links:', error);
    rows.forEach((row) => links.set(row.id, { kind: 'unknown' }));
    return links;
  }
}

/**
 * Rewrite `alert_sent` so it means what the UI says it means. Every read
 * path in this service goes through here — including the rows returned by
 * updates, so adding a note cannot flip a banner back to the raw flag.
 * Exported for the screens that query `outbreaks` directly: pass the rows
 * through here rather than reading the raw column.
 */
export async function withHonestAlertState(rows: Outbreak[]): Promise<Outbreak[]> {
  const links = await fetchAlertLinks(rows);
  return rows.map((row) => {
    const link = links.get(row.id) ?? { kind: 'unknown' as const };
    return {
      ...row,
      officials_notified: row.alert_sent === true,
      alert_link: link,
      // 'unknown' resolves to false: under-claiming sends the officer to
      // check the alert; over-claiming makes them stop chasing it.
      alert_sent: isAlertPubliclyIssued(link),
    };
  });
}

// ─────────────────────────────────────────────────────
//  Response-notes audit log helpers
// ─────────────────────────────────────────────────────

const NOTE_ENTRY_RE = /^\[([^\]]+)\]\s+(.*?)\s+—\s+([\s\S]*)$/;

/**
 * Parse the append-only response_notes text into entries.
 * Lines that start with "[<timestamp>] Author — text" open a new
 * entry; continuation lines attach to the previous entry. Legacy
 * free text (no stamp) becomes an entry with null author/time.
 */
export function parseResponseNotes(notes?: string | null): OutbreakNoteEntry[] {
  if (!notes || !notes.trim()) return [];
  const entries: OutbreakNoteEntry[] = [];
  for (const rawLine of notes.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const match = NOTE_ENTRY_RE.exec(line);
    if (match && !Number.isNaN(new Date(match[1]).getTime())) {
      entries.push({ at: match[1], author: match[2] || null, text: match[3] });
    } else if (entries.length > 0) {
      // Continuation of a multi-line note
      entries[entries.length - 1].text += `\n${line.trim()}`;
    } else {
      entries.push({ at: null, author: null, text: line.trim() });
    }
  }
  return entries;
}

/** Resolve the signed-in user's display name for audit stamping. */
async function currentAuthorName(): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    let user = session?.user ?? null;
    if (!user) {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    }
    if (!user) return 'Unknown user';
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    return profile?.full_name || user.email || 'Unknown user';
  } catch {
    return 'Unknown user';
  }
}

const formatNoteEntry = (author: string, text: string): string =>
  `[${new Date().toISOString()}] ${author} — ${text.trim()}`;

/** Append an audit-stamped entry to an outbreak's response_notes. */
async function appendedNotes(outbreakId: string, text: string): Promise<string> {
  const author = await currentAuthorName();
  const entry = formatNoteEntry(author, text);
  const { data, error } = await supabase
    .from('outbreaks')
    .select('response_notes')
    .eq('id', outbreakId)
    .single();
  if (error) throw error;
  const existing = (data?.response_notes ?? '').trim();
  return existing ? `${existing}\n${entry}` : entry;
}

// ─────────────────────────────────────────────────────
//  Service
// ─────────────────────────────────────────────────────
export const outbreaksService = {
  /** Open signals: active + monitoring outbreaks, newest first. */
  async getActive(district?: string): Promise<ApiResponse<Outbreak[]>> {
    try {
      let query = supabase
        .from('outbreaks')
        .select('*')
        .in('status', ['active', 'monitoring'])
        .order('created_at', { ascending: false });
      if (district) query = query.eq('district', district);
      const { data, error } = await query;
      if (error) throw error;
      return { data: await withHonestAlertState((data ?? []) as Outbreak[]), error: null };
    } catch (error: any) {
      console.error('Error fetching active outbreaks:', error);
      return { data: null, error: error.message };
    }
  },

  async getById(id: string): Promise<ApiResponse<Outbreak>> {
    try {
      const { data, error } = await supabase
        .from('outbreaks')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      const [outbreak] = await withHonestAlertState([data as Outbreak]);
      return { data: outbreak, error: null };
    } catch (error: any) {
      console.error('Error fetching outbreak:', error);
      return { data: null, error: error.message };
    }
  },

  async list(options?: {
    statuses?: OutbreakStatus[];
    district?: string;
    limit?: number;
  }): Promise<ApiResponse<Outbreak[]>> {
    try {
      const { statuses, district, limit = 50 } = options ?? {};
      let query = supabase
        .from('outbreaks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (statuses && statuses.length > 0) query = query.in('status', statuses);
      if (district) query = query.eq('district', district);
      const { data, error } = await query;
      if (error) throw error;
      return { data: await withHonestAlertState((data ?? []) as Outbreak[]), error: null };
    } catch (error: any) {
      console.error('Error listing outbreaks:', error);
      return { data: null, error: error.message };
    }
  },

  /**
   * The human-approved disease reports that fed this signal:
   * same disease + district, inside the detection window.
   * For a still-open outbreak the window extends to now, so
   * today's approvals (and honest deltas) are included.
   */
  async contributingReports(
    outbreak: Pick<Outbreak, 'disease_name' | 'district' | 'window_start' | 'window_end' | 'status'>,
  ): Promise<ApiResponse<DiseaseReport[]>> {
    try {
      const windowEnd =
        outbreak.status === 'resolved' && outbreak.window_end
          ? outbreak.window_end
          : new Date().toISOString();
      const { data, error } = await supabase
        .from('disease_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, role)
        `)
        .eq('approval_status', 'approved')
        .eq('district', outbreak.district)
        .ilike('disease_name', outbreak.disease_name)
        .gte('created_at', outbreak.window_start)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return { data: (data ?? []) as DiseaseReport[], error: null };
    } catch (error: any) {
      console.error('Error fetching contributing reports:', error);
      return { data: null, error: error.message };
    }
  },

  /** The rule that fired this signal, e.g. "5 cases in 7 days". */
  async getThreshold(diseaseName: string): Promise<ApiResponse<OutbreakThreshold | null>> {
    try {
      const { data, error } = await supabase
        .from('outbreak_thresholds')
        .select('disease_name, case_threshold, window_days')
        .ilike('disease_name', diseaseName)
        .limit(1);
      if (error) throw error;
      return { data: (data?.[0] as OutbreakThreshold) ?? null, error: null };
    } catch (error: any) {
      console.error('Error fetching outbreak threshold:', error);
      return { data: null, error: error.message };
    }
  },

  /** Append an audit-stamped response note without changing status. */
  async addNote(id: string, note: string): Promise<ApiResponse<Outbreak>> {
    try {
      const text = note.trim();
      if (!text) throw new Error('Note text is required');
      const response_notes = await appendedNotes(id, text);
      const { data, error } = await supabase
        .from('outbreaks')
        .update({ response_notes })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const [outbreak] = await withHonestAlertState([data as Outbreak]);
      return { data: outbreak, error: null };
    } catch (error: any) {
      console.error('Error adding outbreak note:', error);
      return { data: null, error: error.message };
    }
  },

  /**
   * Change status and append an audit-stamped note. Moving to
   * 'resolved' stamps resolved_by / resolved_at; moving away
   * from 'resolved' clears them (an honest reopen).
   */
  async updateStatus(
    id: string,
    status: OutbreakStatus,
    note?: string,
  ): Promise<ApiResponse<Outbreak>> {
    try {
      const text = note?.trim() || `Status changed to ${status}.`;
      const response_notes = await appendedNotes(id, text);

      const updates: Record<string, unknown> = { status, response_notes };
      if (status === 'resolved') {
        const { data: { session } } = await supabase.auth.getSession();
        updates.resolved_by = session?.user?.id ?? null;
        updates.resolved_at = new Date().toISOString();
      } else {
        updates.resolved_by = null;
        updates.resolved_at = null;
      }

      const { data, error } = await supabase
        .from('outbreaks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      const [outbreak] = await withHonestAlertState([data as Outbreak]);
      return { data: outbreak, error: null };
    } catch (error: any) {
      console.error('Error updating outbreak status:', error);
      return { data: null, error: error.message };
    }
  },

  /** Resolve with a REQUIRED closing note — the audit log's last word. */
  async resolve(id: string, closingNote: string): Promise<ApiResponse<Outbreak>> {
    const text = closingNote?.trim();
    if (!text) {
      return { data: null, error: 'A closing note is required to resolve an outbreak.' };
    }
    return this.updateStatus(id, 'resolved', text);
  },
};

export default outbreaksService;
