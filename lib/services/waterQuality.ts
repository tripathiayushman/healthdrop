// =====================================================
// WATER QUALITY REPORTS SERVICE
// =====================================================
import { supabase, describeRequestError, describeSubmitError } from '../supabase';
import { WaterQualityReport, WaterQualityReportInput, WaterReportStatus, ApiResponse } from '../../types';
import NetInfo from '@react-native-community/netinfo';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';
import { sanitizeSearchTerm } from './searchSanitize';
import { track, events } from './analytics';
import { offlineCache, CachedApiResponse, ReadThroughOptions } from '../offlineCache';

/**
 * Cache namespace for this service (INC-05b). Reads are always written to the
 * per-user offline cache; they are only ANSWERED from it when the caller
 * passes `{ offlineFallback: true }` — its promise to render `asOf`.
 */
const CACHE_NS = 'water:';

/**
 * A water reading upserts public.water_sources through a DB trigger, so a
 * successful write invalidates the water-SOURCE caches too, not just this
 * service's own.
 */
const WATER_SOURCE_NS = 'wsrc:';

/** Stable, compact cache name for a filtered page. */
const listCacheName = (options?: Record<string, unknown>): string => {
  const parts = Object.entries(options ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${CACHE_NS}all:${parts.join('&') || 'default'}`;
};

const invalidateWaterCaches = async (): Promise<void> => {
  await offlineCache.invalidate(CACHE_NS);
  await offlineCache.invalidate(WATER_SOURCE_NS);
};

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

const normalizeSubmitErrorMessage = (
  error: unknown,
  options?: { idempotent?: boolean },
): string => {
  // Same defect and same fix as diseaseReports.normalizeSubmitErrorMessage:
  // the raw '.message' fell through, so a fired deadline reached the submit
  // modal as 'RequestTimeoutError: Request timed out after 30s'.
  // describeSubmitError returns null for anything that is not transport-shaped,
  // so a real server answer keeps its own specific message below.
  const transport = describeSubmitError(error, options);
  if (transport) return transport;

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
  }, cache?: ReadThroughOptions): Promise<CachedApiResponse<WaterQualityReport[]>> {
    return offlineCache.readThrough<WaterQualityReport[]>(listCacheName(options), async () => {
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
        const term = sanitizeSearchTerm(searchQuery);
        if (term) {
          query = query.or(`source_name.ilike.%${term}%,location_name.ilike.%${term}%`);
        }
      }
      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');

      const { data, error, count } = await query;

      if (error) throw error;

      return { data: data as WaterQualityReport[], count: count || 0 };
    }, { fallbackMessage: 'Could not load water reports.', ...cache });
  },

  // Get single report by ID
  async getById(id: string, cache?: ReadThroughOptions): Promise<CachedApiResponse<WaterQualityReport>> {
    return offlineCache.readThrough<WaterQualityReport>(`${CACHE_NS}one:${id}`, async () => {
      const { data, error } = await supabase
        .from('water_quality_reports')
        .select(`
          *,
          reporter:profiles!reporter_id(id, full_name, email, role, phone)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      return { data: data as WaterQualityReport };
    }, { fallbackMessage: 'Could not load this water report.', ...cache });
  },

  // Create new water quality report (offline-first)
  async create(reportData: WaterQualityReportInput): Promise<ApiResponse<WaterQualityReport> & { queued?: boolean; localId?: string }> {
    // Out here so the catch can tell the worker whether resending is safe.
    const suppliedKey =
      typeof (reportData as any)?.client_idempotency_key === 'string' &&
      (reportData as any).client_idempotency_key.trim()
        ? String((reportData as any).client_idempotency_key).trim()
        : null;
    try {
      // Resolve the user from the locally cached session first — getSession()
      // reads local storage (no network), so the offline sync-queue path below
      // stays reachable. Fall back to the network getUser() only when online
      // and no cached session exists.
      const { data: { session } } = await supabase.auth.getSession();
      let user = session?.user ?? null;

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
        const localId = await syncQueue.enqueue('water_quality_report', payload);
        track(events.REPORT_QUEUED, { kind: 'water' });
        // The reading exists on this phone and in none of the cached lists —
        // and once it syncs, the DB trigger will restate the source's status
        // too. Drop both namespaces so the next successful online read
        // rebuilds from a server that already holds it.
        await invalidateWaterCaches();
        return { data: null, error: null, queued: true, localId };
      }

      // Honour a caller-supplied key; only mint one as a last resort.
      // Same defect and same reasoning as diseaseReports.create — the minted
      // key was spread over the payload, so onConflict never matched a prior
      // attempt and a resend after a lost response filed a duplicate report.
      const idempotencyKey = suppliedKey ?? `wq_${user.id}_${Date.now()}`;
      const withIdempotency = { ...payload, client_idempotency_key: idempotencyKey };

      // maybeSingle(), not single() — ON CONFLICT DO NOTHING returns zero rows,
      // and single() turned the now-working safe resend into a PGRST116 error
      // shown to a worker whose reading had in fact been filed. See the fuller
      // note in diseaseReports.create.
      let { data, error } = await supabase
        .from('water_quality_reports')
        .upsert(withIdempotency, { onConflict: 'client_idempotency_key', ignoreDuplicates: true })
        .select()
        .maybeSingle();

      if (error && isLegacySchemaConflict(String(error.message ?? ''))) {
        const fallback = await supabase
          .from('water_quality_reports')
          .insert(payload)
          .select()
          .single();

        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;

      if (!data) {
        // Nothing inserted = already filed under this key. A success, not a
        // failure — read the row back so the caller gets it.
        const existing = await supabase
          .from('water_quality_reports')
          .select('*')
          .eq('client_idempotency_key', idempotencyKey)
          .maybeSingle();
        if (existing.error) throw existing.error;

        await invalidateWaterCaches();
        return {
          data: (existing.data ?? null) as WaterQualityReport | null,
          error: null,
          queued: false,
        };
      }

      // Fire-and-forget analytics — district + kind only, never readings.
      track(events.REPORT_SUBMITTED, { kind: 'water', district: reportData.district });

      // This reading has just changed the source's status through the DB
      // trigger — every cached water read is now contradicted.
      await invalidateWaterCaches();

      return { data: data as WaterQualityReport, error: null, queued: false };
    } catch (error: any) {
      console.error('Error creating water quality report:', error);
      return {
        data: null,
        error: normalizeSubmitErrorMessage(error, { idempotent: suppliedKey !== null }),
      };
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

      await invalidateWaterCaches();

      return { data: data as WaterQualityReport, error: null };
    } catch (error: any) {
      console.error('Error updating water quality report:', error);
      // Transport failures get human copy; a real server answer keeps its own
      // message. See diseaseReports.update for the fuller note.
      return { data: null, error: describeRequestError(error, 'Could not update this reading.') };
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

      await invalidateWaterCaches();

      return { data: data as WaterQualityReport, error: null };
    } catch (error: any) {
      console.error('Error verifying water quality report:', error);
      return { data: null, error: describeRequestError(error, 'Could not verify this reading.') };
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

      await invalidateWaterCaches();

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error deleting water quality report:', error);
      return { data: null, error: describeRequestError(error, 'Could not delete this reading.') };
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
      // Every count is checked for its own error before it is read. The old
      // shape read `count || 0` with no error check at all, so a failed query
      // rendered as a confident "0 unsafe sources" — a query that never ran
      // and a district with clean water looked identical. With a request
      // deadline now in force (lib/supabase.ts) that path became reachable in
      // seconds rather than hanging, so it is closed here.
      const totalRes = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true });

      const safeRes = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .eq('overall_quality', 'safe');

      const unsafeRes = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .in('overall_quality', ['unsafe', 'moderate']);

      const criticalRes = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .eq('overall_quality', 'critical');

      const pendingRes = await supabase
        .from('water_quality_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'reported');

      const failure = [totalRes, safeRes, unsafeRes, criticalRes, pendingRes]
        .find((res) => res.error);
      if (failure?.error) throw failure.error;

      return {
        data: {
          totalSources: totalRes.count ?? 0,
          safeSources: safeRes.count ?? 0,
          unsafeSources: unsafeRes.count ?? 0,
          criticalSources: criticalRes.count ?? 0,
          pendingVerifications: pendingRes.count ?? 0,
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error fetching water statistics:', error);
      return { data: null, error: describeRequestError(error, 'Could not load water statistics.') };
    }
  },

  // Get recent reports
  async getRecent(
    limit: number = 5,
    cache?: ReadThroughOptions,
  ): Promise<CachedApiResponse<WaterQualityReport[]>> {
    return offlineCache.readThrough<WaterQualityReport[]>(
      `${CACHE_NS}recent:${limit}`,
      async () => {
        const { data, error } = await supabase
          .from('water_quality_reports')
          .select(`
          *,
          reporter:profiles!reporter_id(id, full_name)
        `)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        return { data: data as WaterQualityReport[] };
      },
      { fallbackMessage: 'Could not load recent water reports.', ...cache },
    );
  },

  // Get reports by quality level
  async getByQuality(
    quality: string,
    cache?: ReadThroughOptions,
  ): Promise<CachedApiResponse<WaterQualityReport[]>> {
    return offlineCache.readThrough<WaterQualityReport[]>(
      `${CACHE_NS}quality:${quality}`,
      async () => {
        const { data, error } = await supabase
          .from('water_quality_reports')
          .select(`
          *,
          reporter:profiles!reporter_id(id, full_name)
        `)
          .eq('overall_quality', quality)
          .order('created_at', { ascending: false });

        if (error) throw error;

        return { data: data as WaterQualityReport[] };
      },
      { fallbackMessage: 'Could not load water reports.', ...cache },
    );
  },
};

export default waterQualityService;
