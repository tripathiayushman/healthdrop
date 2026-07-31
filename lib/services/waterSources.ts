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
import { supabase } from '../supabase';
import { ApiResponse, WaterQualityReport } from '../../types';

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
 * Resolve the signed-in user from the locally cached session first —
 * getSession() reads local storage (no network); fall back to the
 * network getUser() only when no cached session exists.
 */
async function currentUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  let user = session?.user ?? null;
  if (!user) {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  }
  if (!user) throw new Error('User not authenticated');
  return user.id;
}

export const waterSourcesService = {
  /** All tracked sources, A→Z; optionally scoped to a district or status. */
  async list(options?: {
    district?: string;
    status?: WaterSourceStatus;
  }): Promise<ApiResponse<WaterSourceRecord[]>> {
    try {
      let query = supabase
        .from('water_sources')
        .select(SOURCE_SELECT)
        .order('source_name', { ascending: true });
      if (options?.district) query = query.eq('district', options.district);
      if (options?.status) query = query.eq('current_status', options.status);
      const { data, error } = await query;
      if (error) throw error;
      return { data: (data ?? []) as unknown as WaterSourceRecord[], error: null };
    } catch (error: any) {
      console.error('Error listing water sources:', error);
      return { data: null, error: error.message };
    }
  },

  async getById(id: string): Promise<ApiResponse<WaterSourceRecord>> {
    try {
      const { data, error } = await supabase
        .from('water_sources')
        .select(SOURCE_SELECT)
        .eq('id', id)
        .single();
      if (error) throw error;
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error fetching water source:', error);
      return { data: null, error: error.message };
    }
  },

  /** Flagged sources (unsafe + critical), longest-waiting first. */
  async flagged(district?: string): Promise<ApiResponse<WaterSourceRecord[]>> {
    try {
      let query = supabase
        .from('water_sources')
        .select(SOURCE_SELECT)
        .in('current_status', ['unsafe', 'critical'])
        .order('flagged_at', { ascending: true, nullsFirst: false });
      if (district) query = query.eq('district', district);
      const { data, error } = await query;
      if (error) throw error;
      return { data: (data ?? []) as unknown as WaterSourceRecord[], error: null };
    } catch (error: any) {
      console.error('Error fetching flagged water sources:', error);
      return { data: null, error: error.message };
    }
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
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error assigning water source retest:', error);
      return { data: null, error: error.message };
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
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error logging water source treatment:', error);
      return { data: null, error: error.message };
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
      return { data: data as unknown as WaterSourceRecord, error: null };
    } catch (error: any) {
      console.error('Error reopening water source:', error);
      return { data: null, error: error.message };
    }
  },

  /** Every reading ever filed for this source, newest first. */
  async reportsForSource(
    source: Pick<WaterSourceRecord, 'district' | 'source_name'>,
  ): Promise<ApiResponse<WaterSourceReport[]>> {
    try {
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
      return { data: (data ?? []) as unknown as WaterSourceReport[], error: null };
    } catch (error: any) {
      console.error('Error fetching reports for water source:', error);
      return { data: null, error: error.message };
    }
  },
};

export default waterSourcesService;
