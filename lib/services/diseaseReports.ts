// =====================================================
// DISEASE REPORTS SERVICE
// =====================================================
import { supabase } from '../supabase';
import { DiseaseReport, DiseaseReportInput, ReportStatus, ApiResponse } from '../../types';
import NetInfo from '@react-native-community/netinfo';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';

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
        query = query.or(`disease_name.ilike.%${searchQuery}%,location_name.ilike.%${searchQuery}%`);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const payload = {
        ...reportData,
        reporter_id: user.id,
        status: 'reported',
      };

      // Check connectivity
      const net = await NetInfo.fetch();
      const isOnline = net.isConnected && net.isInternetReachable;

      if (!isOnline) {
        // Queue for later sync
        const localId = await syncQueue.enqueue('disease_report', payload);
        return { data: null, error: null, queued: true, localId };
      }

      // Online: upsert with idempotency key to prevent duplicates on retry
      const idempotencyKey = `dr_${user.id}_${Date.now()}`;
      const { data, error } = await supabase
        .from('disease_reports')
        .upsert(
          { ...payload, client_idempotency_key: idempotencyKey },
          { onConflict: 'client_idempotency_key', ignoreDuplicates: true }
        )
        .select()
        .single();

      if (error) throw error;

      return { data: data as DiseaseReport, error: null, queued: false };
    } catch (error: any) {
      console.error('Error creating disease report:', error);
      return { data: null, error: error.message };
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
