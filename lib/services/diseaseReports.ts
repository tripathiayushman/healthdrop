// =====================================================
// DISEASE REPORTS SERVICE
// =====================================================
import { supabase } from '../supabase';
import { DiseaseReport, DiseaseReportInput, ReportStatus, ApiResponse } from '../../types';
import NetInfo from '@react-native-community/netinfo';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';
import { sanitizeSearchTerm } from './searchSanitize';

const LEGACY_SCHEMA_FALLBACK_PATTERNS = [
  'client_idempotency_key',
  'on conflict',
  'no unique or exclusion constraint',
  'constraint matching the on conflict specification',
] as const;

const isLegacySchemaConflict = (message: string): boolean => {
  const lower = message.toLowerCase();
  return LEGACY_SCHEMA_FALLBACK_PATTERNS.some((token) => lower.includes(token));
};

const normalizeSubmitErrorMessage = (error: unknown): string => {
  const message = String((error as any)?.message ?? error ?? '').trim();
  const lower = message.toLowerCase();

  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'You do not have permission to submit reports yet. Please ask admin to run database_structure/FIX_REPORT_SUBMISSION_RLS.sql in Supabase SQL Editor.';
  }

  if (lower.includes('created_by')) {
    return 'Database trigger mismatch detected (created_by vs reporter_id). Please run database_structure/FIX_REPORT_SUBMISSION_RLS.sql in Supabase SQL Editor.';
  }

  return message || 'Failed to submit report. Please try again.';
};

export const diseaseReportsService = {
  // Get all disease reports with pagination and filters
  async getAll(options?: {
    page?: number;
    pageSize?: number;
    status?: ReportStatus;
    district?: string;
    severity?: string;
    searchQuery?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<ApiResponse<DiseaseReport[]>> {
    try {
      const { page = 1, pageSize = 20, status, district, severity, searchQuery, dateFrom, dateTo } = options || {};
      const offset = (page - 1) * pageSize;

      let query = supabase
        .from('disease_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, email, role),
          verifier:profiles!verified_by(id, full_name)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (status) query = query.eq('status', status);
      if (district) query = query.eq('district', district);
      if (severity) query = query.eq('severity', severity);
      if (searchQuery) {
        const term = sanitizeSearchTerm(searchQuery);
        if (term) {
          query = query.or(`disease_name.ilike.%${term}%,location_name.ilike.%${term}%`);
        }
      }
      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');

      const { data, error, count } = await query;

      if (error) throw error;

      return { data: data as DiseaseReport[], error: null, count: count || 0 };
    } catch (error: any) {
      console.error('Error fetching disease reports:', error);
      return { data: null, error: error.message };
    }
  },

  // Get single report by ID
  async getById(id: string): Promise<ApiResponse<DiseaseReport>> {
    try {
      const { data, error } = await supabase
        .from('disease_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, email, role, phone, district),
          verifier:profiles!verified_by(id, full_name)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      return { data: data as DiseaseReport, error: null };
    } catch (error: any) {
      console.error('Error fetching disease report:', error);
      return { data: null, error: error.message };
    }
  },

  // Create new disease report (offline-first)
  async create(reportData: DiseaseReportInput): Promise<ApiResponse<DiseaseReport> & { queued?: boolean; localId?: string }> {
    try {
      // Resolve the user from the locally cached session first — getSession()
      // reads local storage (no network), so the offline sync-queue path below
      // stays reachable. Fall back to the network getUser() only when online
      // and no cached session exists.
      const { data: { session } } = await supabase.auth.getSession();
      let user = session?.user ?? null;

      // Check connectivity
      const net = await NetInfo.fetch();
      const isOnline = net.isConnected === true && net.isInternetReachable !== false;

      if (!user && isOnline) {
        const { data: userData } = await supabase.auth.getUser();
        user = userData.user;
      }
      if (!user) throw new Error('User not authenticated');

      const payload = {
        ...reportData,
        reporter_id: user.id,
        status: 'reported',
      };

      if (!isOnline) {
        // Queue for later sync
        const localId = await syncQueue.enqueue('disease_report', payload);
        return { data: null, error: null, queued: true, localId };
      }

      // Online: prefer idempotent upsert, then fallback to plain insert for legacy schemas.
      const idempotencyKey = `dr_${user.id}_${Date.now()}`;
      const withIdempotency = { ...payload, client_idempotency_key: idempotencyKey };

      let { data, error } = await supabase
        .from('disease_reports')
        .upsert(withIdempotency, { onConflict: 'client_idempotency_key', ignoreDuplicates: true })
        .select()
        .single();

      if (error && isLegacySchemaConflict(String(error.message ?? ''))) {
        const fallback = await supabase
          .from('disease_reports')
          .insert(payload)
          .select()
          .single();

        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;

      return { data: data as DiseaseReport, error: null, queued: false };
    } catch (error: any) {
      console.error('Error creating disease report:', error);
      return { data: null, error: normalizeSubmitErrorMessage(error) };
    }
  },

  // Update disease report
  async update(id: string, updates: Partial<DiseaseReport>): Promise<ApiResponse<DiseaseReport>> {
    try {
      const { data, error } = await supabase
        .from('disease_reports')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as DiseaseReport, error: null };
    } catch (error: any) {
      console.error('Error updating disease report:', error);
      return { data: null, error: error.message };
    }
  },

  // Verify a report (Admin/Clinic only)
  async verify(id: string): Promise<ApiResponse<DiseaseReport>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('disease_reports')
        .update({
          status: 'verified',
          verified_by: user.id,
          verified_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as DiseaseReport, error: null };
    } catch (error: any) {
      console.error('Error verifying disease report:', error);
      return { data: null, error: error.message };
    }
  },

  // Update report status
  async updateStatus(id: string, status: ReportStatus): Promise<ApiResponse<DiseaseReport>> {
    return this.update(id, { status });
  },

  // Delete report (Admin only)
  async delete(id: string): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from('disease_reports')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error deleting disease report:', error);
      return { data: null, error: error.message };
    }
  },

  // Get reports by reporter
  async getByReporter(reporterId: string): Promise<ApiResponse<DiseaseReport[]>> {
    try {
      const { data, error } = await supabase
        .from('disease_reports')
        .select('*')
        .eq('reporter_id', reporterId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { data: data as DiseaseReport[], error: null };
    } catch (error: any) {
      console.error('Error fetching reporter disease reports:', error);
      return { data: null, error: error.message };
    }
  },

  // Get statistics
  async getStatistics(): Promise<ApiResponse<{
    totalReports: number;
    activeOutbreaks: number;
    criticalCases: number;
    pendingVerifications: number;
  }>> {
    try {
      const { data: totalData, error: totalError } = await supabase
        .from('disease_reports')
        .select('id', { count: 'exact' });

      const { data: activeData, error: activeError } = await supabase
        .from('disease_reports')
        .select('id', { count: 'exact' })
        .in('status', ['reported', 'verified', 'investigating']);

      const { data: criticalData, error: criticalError } = await supabase
        .from('disease_reports')
        .select('id', { count: 'exact' })
        .eq('severity', 'critical');

      const { data: pendingData, error: pendingError } = await supabase
        .from('disease_reports')
        .select('id', { count: 'exact' })
        .eq('status', 'reported');

      if (totalError || activeError || criticalError || pendingError) {
        throw new Error('Error fetching statistics');
      }

      return {
        data: {
          totalReports: totalData?.length || 0,
          activeOutbreaks: activeData?.length || 0,
          criticalCases: criticalData?.length || 0,
          pendingVerifications: pendingData?.length || 0,
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error fetching statistics:', error);
      return { data: null, error: error.message };
    }
  },

  // Nearby recent reports — cluster/duplicate awareness at report entry
  // (ROADMAP item 4). One cheap query, aggregation on the client. The result
  // INFORMS the reporter before she saves — it never gates submission.
  // Counts approved OR pending reports (rejected ones are noise, not signal).
  async nearbyRecentReports(params: {
    diseaseName: string;
    district: string;
    days?: number;
  }): Promise<ApiResponse<{
    count: number;
    totalCases: number;
    latestAt: string | null;
    sameReporterCount: number;
  }>> {
    try {
      const { diseaseName, district, days = 7 } = params;
      const disease = sanitizeSearchTerm(diseaseName);
      const districtTerm = district.trim();
      if (!disease || !districtTerm) {
        return {
          data: { count: 0, totalCases: 0, latestAt: null, sameReporterCount: 0 },
          error: null,
        };
      }

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // Reporter id from the locally cached session — no network round-trip.
      const { data: { session } } = await supabase.auth.getSession();
      const myId = session?.user?.id ?? null;

      // ilike without wildcards = case-insensitive match on the disease name.
      const { data, error } = await supabase
        .from('disease_reports')
        .select('cases_count, created_at, reporter_id')
        .ilike('disease_name', disease)
        .eq('district', districtTerm)
        .gte('created_at', since)
        .in('approval_status', ['approved', 'pending_approval'])
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = data ?? [];
      return {
        data: {
          count: rows.length,
          totalCases: rows.reduce((sum, r) => sum + (Number(r.cases_count) || 0), 0),
          latestAt: rows.length > 0 ? String(rows[0].created_at) : null,
          sameReporterCount: myId
            ? rows.filter((r) => r.reporter_id === myId).length
            : 0,
        },
        error: null,
      };
    } catch (error: any) {
      // Awareness feature only — callers are expected to stay silent on failure.
      return { data: null, error: error?.message ?? String(error) };
    }
  },

  // Get recent reports
  async getRecent(limit: number = 5): Promise<ApiResponse<DiseaseReport[]>> {
    try {
      const { data, error } = await supabase
        .from('disease_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return { data: data as DiseaseReport[], error: null };
    } catch (error: any) {
      console.error('Error fetching recent reports:', error);
      return { data: null, error: error.message };
    }
  },
};

export default diseaseReportsService;
