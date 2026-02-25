// =====================================================
// WATER QUALITY REPORTS SERVICE
// =====================================================
import { supabase } from '../supabase';
import { WaterQualityReport, WaterQualityReportInput, WaterReportStatus, ApiResponse } from '../../types';
import NetInfo from '@react-native-community/netinfo';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';

export const waterQualityService = {
  // Get all water quality reports
  async getAll(options?: {
    page?: number;
    pageSize?: number;
    status?: WaterReportStatus;
    district?: string;
    quality?: string;
    sourceType?: string;
    searchQuery?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<ApiResponse<WaterQualityReport[]>> {
    try {
      const { page = 1, pageSize = 20, status, district, quality, sourceType, searchQuery, dateFrom, dateTo } = options || {};
      const offset = (page - 1) * pageSize;

      let query = supabase
        .from('water_quality_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, email, role)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (status) query = query.eq('status', status);
      if (district) query = query.eq('district', district);
      if (quality) query = query.eq('overall_quality', quality);
      if (sourceType) query = query.eq('source_type', sourceType);
      if (searchQuery) {
        query = query.or(`source_name.ilike.%${searchQuery}%,location_name.ilike.%${searchQuery}%`);
      }
      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');

      const { data, error, count } = await query;

      if (error) throw error;

      return { data: data as WaterQualityReport[], error: null, count: count || 0 };
    } catch (error: any) {
      console.error('Error fetching water quality reports:', error);
      return { data: null, error: error.message };
    }
  },

  // Get single report by ID
  async getById(id: string): Promise<ApiResponse<WaterQualityReport>> {
    try {
      const { data, error } = await supabase
        .from('water_quality_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, email, role, phone)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      return { data: data as WaterQualityReport, error: null };
    } catch (error: any) {
      console.error('Error fetching water quality report:', error);
      return { data: null, error: error.message };
    }
  },

  // Create new water quality report (offline-first)
  async create(reportData: WaterQualityReportInput): Promise<ApiResponse<WaterQualityReport> & { queued?: boolean; localId?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const payload = {
        ...reportData,
        reporter_id: user.id,
        status: 'reported',
      };

      const net = await NetInfo.fetch();
      const isOnline = net.isConnected && net.isInternetReachable;

      if (!isOnline) {
        const localId = await syncQueue.enqueue('water_quality_report', payload);
        return { data: null, error: null, queued: true, localId };
      }

      const idempotencyKey = `wq_${user.id}_${Date.now()}`;
      const { data, error } = await supabase
        .from('water_quality_reports')
        .upsert(
          { ...payload, client_idempotency_key: idempotencyKey },
          { onConflict: 'client_idempotency_key', ignoreDuplicates: true }
        )
        .select()
        .single();

      if (error) throw error;

      return { data: data as WaterQualityReport, error: null, queued: false };
    } catch (error: any) {
      console.error('Error creating water quality report:', error);
      return { data: null, error: error.message };
    }
  },

  // Update water quality report
  async update(id: string, updates: Partial<WaterQualityReport>): Promise<ApiResponse<WaterQualityReport>> {
    try {
      const { data, error } = await supabase
        .from('water_quality_reports')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as WaterQualityReport, error: null };
    } catch (error: any) {
      console.error('Error updating water quality report:', error);
      return { data: null, error: error.message };
    }
  },

  // Verify a report
  async verify(id: string): Promise<ApiResponse<WaterQualityReport>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('water_quality_reports')
        .update({
          status: 'verified',
          verified_by: user.id,
          verified_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as WaterQualityReport, error: null };
    } catch (error: any) {
      console.error('Error verifying water quality report:', error);
      return { data: null, error: error.message };
    }
  },

  // Delete report
  async delete(id: string): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from('water_quality_reports')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error deleting water quality report:', error);
      return { data: null, error: error.message };
    }
  },

  // Get statistics
  async getStatistics(): Promise<ApiResponse<{
    totalSources: number;
    safeSources: number;
    unsafeSources: number;
    criticalSources: number;
    pendingVerifications: number;
  }>> {
    try {
      const { count: total } = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true });

      const { count: safe } = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .eq('overall_quality', 'safe');

      const { count: unsafe } = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .in('overall_quality', ['unsafe', 'moderate']);

      const { count: critical } = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .eq('overall_quality', 'critical');

      const { count: pending } = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'reported');

      return {
        data: {
          totalSources: total || 0,
          safeSources: safe || 0,
          unsafeSources: unsafe || 0,
          criticalSources: critical || 0,
          pendingVerifications: pending || 0,
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error fetching water statistics:', error);
      return { data: null, error: error.message };
    }
  },

  // Get recent reports
  async getRecent(limit: number = 5): Promise<ApiResponse<WaterQualityReport[]>> {
    try {
      const { data, error } = await supabase
        .from('water_quality_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return { data: data as WaterQualityReport[], error: null };
    } catch (error: any) {
      console.error('Error fetching recent water reports:', error);
      return { data: null, error: error.message };
    }
  },

  // Get reports by quality level
  async getByQuality(quality: string): Promise<ApiResponse<WaterQualityReport[]>> {
    try {
      const { data, error } = await supabase
        .from('water_quality_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name)
        `)
        .eq('overall_quality', quality)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { data: data as WaterQualityReport[], error: null };
    } catch (error: any) {
      console.error('Error fetching water reports by quality:', error);
      return { data: null, error: error.message };
    }
  },
};

export default waterQualityService;
