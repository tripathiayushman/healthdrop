// =====================================================
// WATER SOURCES SERVICE — the Bharosa water promise
// A flagged well is a promise: someone will come back
// and test it again (E·01–E·03). Rows in
// public.water_sources are upserted by a DB trigger on
// every water_quality_reports insert; unsafe/critical
// readings flag a source, but a safe reading NEVER
// auto-reopens it — reopening is a human action that
// writes reopened_at / reopened_by / reopen_note.
// RLS: all authenticated may SELECT; UPDATE is limited
// to super_admin / health_admin / district_officer /
// clinic — the UI role-gates to match.
// =====================================================
import { supabase, readPersistedUserId, describeRequestError } from '../supabase';
import { ApiResponse, WaterQualityReport } from '../../types';
import { offlineCache, CachedApiResponse, ReadThroughOptions } from '../offlineCache';

/**
 * Cache namespace for this service (INC-05b). A flagged well is the single
 * most useful thing to be able to read with no signal — she is standing next
 * to it. Reads are always written to the per-user offline cache; they are
 * only ANSWERED from it when the caller passes `{ offlineFallback: true }`,
 * which is its promise to render the returned `asOf` stamp. Anything that
 * changes a source invalidates the namespace.
 */
const CACHE_NS = 'wsrc:';

export type WaterSourceStatus = 'safe' | 'moderate' | 'unsafe' | 'critical';

export interface WaterSourcePerson {
  id: string;
  full_name: string | null;
  role?: string | null;
}

export interface WaterSourceRecord {
  id: string;
  source_name: string;
  location_name: string | null;
  district: string;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  current_status: WaterSourceStatus;
  last_ph: number | null;
  last_turbidity: number | null;
  last_report_id: string | null;
  last_reported_at: string | null;
  flagged_at: string | null;
  treatment_note: string | null;
  /** DATE column — 'YYYY-MM-DD' */
  retest_due_date: string | null;
  retest_assigned_to: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_note: string | null;
  created_at: string;
  updated_at: string | null;
  // Joined data
  assignee?: WaterSourcePerson | null;
  reopener?: WaterSourcePerson | null;
}

/** water_quality_reports rows carry approval_status in the live schema. */
export type WaterSourceReport = WaterQualityReport & { approval_status?: string | null };

// Multiple FKs point at profiles, so every embed needs its column hint.
const SOURCE_SELECT = `
  *,
  assignee:profiles!retest_assigned_to(id, full_name, role),
  reopener:profiles!reopened_by(id, full_name, role)
`;

/**
 * Resolve the signed-in user from the persisted session blob first. NOT
 * getSession(): near token expiry getSession() makes a network refresh call
 * and returns null when it fails (GoTrueClient.js:1019-1051), so on bad signal
 * this used to fall through to a SECOND network call, getUser(), to learn
 * something already written on the disk. Reopening a source is an online-only
 * action either way — the write needs a live token — but the identity lookup
 * has no business costing two round-trips before the write is even attempted.
 * getUser() stays as the fallback for a device with no blob at all.
 */
async function currentUserId(): Promise<string> {
  const persisted = await readPersistedUserId();
  if (persisted) return persisted;
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('User not authenticated');
  return data.user.id;
}

export const waterSourcesService = {
  /** All tracked sources, A→Z; optionally scoped to a district or status. */
  async list(options?: {
    district?: string;
    status?: WaterSourceStatus;
  }, cache?: ReadThroughOptions): Promise<CachedApiResponse<WaterSourceRecord[]>> {
    const name = `${CACHE_NS}list:${options?.district ?? 'all'}:${options?.status ?? 'all'}`;
    return offlineCache.readThrough<WaterSourceRecord[]>(name, async () => {
      let query = supabase
        .from('water_sources')
        .select(SOURCE_SELECT)
        .order('source_name', { ascending: true });
      if (options?.district) query = query.eq('district', options.district);
      if (options?.status) query = query.eq('current_status', options.status);
      const { data, error } = await query;
      if (error) throw error;
      return { data: (data ?? []) as unknown as WaterSourceRecord[] };
    }, { fallbackMessage: 'Could not load water sources.', ...cache });
  },

  async getById(id: string, cache?: ReadThroughOptions): Promise<CachedApiResponse<WaterSourceRecord>> {
    return offlineCache.readThrough<WaterSourceRecord>(`${CACHE_NS}one:${id}`, async () => {
      const { data, error } = await supabase
        .from('water_sources')
        .select(SOURCE_SELECT)
        .eq('id', id)
        .single();
      if (error) throw error;
      return { data: data as unknown as WaterSourceRecord };
    }, { fallbackMessage: 'Could not load this water source.', ...cache });
  },

  /** Flagged sources (unsafe + critical), longest-waiting first. */
  async flagged(
    district?: string,
    cache?: ReadThroughOptions,
  ): Promise<CachedApiResponse<WaterSourceRecord[]>> {
    return offlineCache.readThrough<WaterSourceRecord[]>(
      `${CACHE_NS}flagged:${district ?? 'all'}`,
      async () => {
        let query = supabase
          .from('water_sources')
          .select(SOURCE_SELECT)
          .in('current_status', ['unsafe', 'critical'])
          .order('flagged_at', { ascending: true, nullsFirst: false });
        if (district) query = query.eq('district', district);
        const { data, error } = await query;
        if (error) throw error;
        return { data: (data ?? []) as unknown as WaterSourceRecord[] };
      },
      { fallbackMessage: 'Could not load flagged water sources.', ...cache },
    );
  },

  /** The retest is an assignment with an owner and a date, not a hope. */
  async assignRetest(
    id: string,
    options: { assignedTo: string; dueDate: string },
  ): Promise<ApiResponse<WaterSourceRecord>> {
    try {
      if (!options.assignedTo) throw new Error('Pick who will retest this source');
      if (!options.dueDate) throw new Error('Pick a due date for the retest');
      const { data, error } = await supabase
        .from('water_sources')
        .update({
          retest_assigned_to: options.assignedTo,
          retest_due_date: options.dueDate,
        })
        .eq('id', id)
        .select(SOURCE_SELECT)
        .single();
      if (error) throw error;
      await offlineCache.invalidate(CACHE_NS);
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error assigning water source retest:', error);
      // These three actions are the ONLY writes in this service and all three
      // land in WaterSourcesScreen's sheet as `res.error`, drawn verbatim. A
      // fired deadline therefore reached an officer as
      // 'RequestTimeoutError: Request timed out after 30s' — the same defect
      // P3 found on the submit path, on a different screen.
      // describeRequestError only replaces TRANSPORT failures, so the two
      // validation messages thrown above ("Pick who will retest this
      // source", "Pick a due date…") and any RLS refusal keep their own words.
      // "Tap retry" is honest here: every one of these updates sets fixed
      // values, so re-sending it cannot do anything a second time.
      return { data: null, error: describeRequestError(error, 'Could not assign the retest.') };
    }
  },

  /** Record what was done to the source (chlorination, repair…). */
  async logTreatment(id: string, note: string): Promise<ApiResponse<WaterSourceRecord>> {
    try {
      const text = note?.trim();
      if (!text) throw new Error('A treatment note is required');
      const { data, error } = await supabase
        .from('water_sources')
        .update({ treatment_note: text })
        .eq('id', id)
        .select(SOURCE_SELECT)
        .single();
      if (error) throw error;
      await offlineCache.invalidate(CACHE_NS);
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error logging water source treatment:', error);
      return { data: null, error: describeRequestError(error, 'Could not save the treatment note.') };
    }
  },

  /**
   * Close the loop — a HUMAN decision with a REQUIRED note.
   * Safe readings never auto-reopen a source; this writes the
   * official's name, time and reason next to current_status='safe'.
   */
  async reopen(id: string, note: string): Promise<ApiResponse<WaterSourceRecord>> {
    try {
      const text = note?.trim();
      if (!text) throw new Error('A note is required to reopen a source');
      const userId = await currentUserId();
      const { data, error } = await supabase
        .from('water_sources')
        .update({
          current_status: 'safe',
          reopened_at: new Date().toISOString(),
          reopened_by: userId,
          reopen_note: text,
        })
        .eq('id', id)
        .select(SOURCE_SELECT)
        .single();
      if (error) throw error;
      await offlineCache.invalidate(CACHE_NS);
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error reopening water source:', error);
      return { data: null, error: describeRequestError(error, 'Could not reopen this source.') };
    }
  },

  /** Every reading ever filed for this source, newest first. */
  async reportsForSource(
    source: Pick<WaterSourceRecord, 'district' | 'source_name'>,
    cache?: ReadThroughOptions,
  ): Promise<CachedApiResponse<WaterSourceReport[]>> {
    return offlineCache.readThrough<WaterSourceReport[]>(
      `${CACHE_NS}history:${source.district}|${source.source_name}`,
      async () => {
        const { data, error } = await supabase
          .from('water_quality_reports')
          .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, role)
        `)
          .eq('district', source.district)
          .eq('source_name', source.source_name)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return { data: (data ?? []) as unknown as WaterSourceReport[] };
      },
      { fallbackMessage: 'Could not load this source’s readings.', ...cache },
    );
  },
};

export default waterSourcesService;
