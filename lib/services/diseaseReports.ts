// =====================================================
// DISEASE REPORTS SERVICE
// =====================================================
import { supabase, describeSubmitError, describeRequestError } from '../supabase';
import { DiseaseReport, DiseaseReportInput, ReportStatus, ApiResponse } from '../../types';
import NetInfo from '@react-native-community/netinfo';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';
import { sanitizeSearchTerm } from './searchSanitize';
import { track, events } from './analytics';
import { offlineCache, CachedApiResponse, ReadThroughOptions } from '../offlineCache';

/**
 * Cache namespace for this service (INC-05b). Every read below is written to
 * the per-user offline cache; a read is only ANSWERED from it when the caller
 * passes `{ offlineFallback: true }`, which is its promise to render the
 * returned `asOf` stamp. Any write invalidates the whole namespace.
 */
const CACHE_NS = 'disease:';

/** Stable, compact cache name for a filtered page. */
const listCacheName = (options?: Record<string, unknown>): string => {
  const parts = Object.entries(options ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${CACHE_NS}all:${parts.join('&') || 'default'}`;
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
  // A stalled socket or a fired deadline must never reach a field worker as
  // 'RequestTimeoutError: Request timed out after 30s' — which is exactly what
  // this function used to hand the submit modal, verbatim, because the raw
  // .message fell through. describeSubmitError also refuses to claim nothing
  // was sent (the row may have committed and only the response been lost), and
  // only promises "sending again will not file it twice" when a stable
  // client_idempotency_key was actually used.
  //
  // It returns null for anything NOT transport-shaped, so a real answer from
  // the server keeps its own specific message below.
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
  }, cache?: ReadThroughOptions): Promise<CachedApiResponse<DiseaseReport[]>> {
    return offlineCache.readThrough<DiseaseReport[]>(listCacheName(options), async () => {
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

      return { data: data as DiseaseReport[], count: count || 0 };
    }, { fallbackMessage: 'Could not load reports.', ...cache });
  },

  // Get single report by ID
  async getById(id: string, cache?: ReadThroughOptions): Promise<CachedApiResponse<DiseaseReport>> {
    return offlineCache.readThrough<DiseaseReport>(`${CACHE_NS}one:${id}`, async () => {
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

      return { data: data as DiseaseReport };
    }, { fallbackMessage: 'Could not load this report.', ...cache });
  },

  // Create new disease report (offline-first)
  async create(reportData: DiseaseReportInput): Promise<ApiResponse<DiseaseReport> & { queued?: boolean; localId?: string }> {
    // Declared out here so the catch can tell the worker whether resending is
    // safe — see normalizeSubmitErrorMessage.
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
        track(events.REPORT_QUEUED, { kind: 'disease' });
        // Her report now exists on this phone and in none of the cached lists.
        // Dropping the namespace here means the next successful online read
        // rebuilds from a server that already holds the synced row, instead of
        // re-serving a list assembled before she filed — a list whose one
        // missing row would be hers.
        await offlineCache.invalidate(CACHE_NS);
        return { data: null, error: null, queued: true, localId };
      }

      // Online: prefer idempotent upsert, then fallback to plain insert for legacy schemas.
      // Honour a caller-supplied key; only mint one as a last resort.
      //
      // This used to be unconditionally `dr_${user.id}_${Date.now()}`, minted
      // fresh on every call and spread OVER the payload — so onConflict could
      // never match a previous attempt and the upsert deduplicated nothing.
      // The whole idempotency mechanism was decorative.
      //
      // It matters most on exactly the connection this app is for: the request
      // goes out, the row COMMITS server-side, the response is lost, the client
      // sees a failure and keeps the draft. She restores it, sends again, and a
      // second disease_reports row lands — a duplicated case count in the
      // surveillance signal this product exists to produce. Two independent
      // reviews found this by different routes.
      //
      // A form that passes a key stable across retries (see the forms' draft
      // snapshot) now genuinely collides with the row already inserted, and
      // ignoreDuplicates turns the resend into a no-op.
      const idempotencyKey = suppliedKey ?? `dr_${user.id}_${Date.now()}`;
      const withIdempotency = { ...payload, client_idempotency_key: idempotencyKey };

      // maybeSingle(), not single(). `ignoreDuplicates` is ON CONFLICT DO
      // NOTHING, and PostgREST's representation of that is ZERO rows — so the
      // moment the key actually started colliding (which is the entire point
      // of the idempotency fix), single() turned the safe resend into a
      // PGRST116 "multiple (or no) rows returned" in the worker's face. The
      // report was filed and she was shown an error. maybeSingle() folds that
      // 406 into `{ data: null, error: null }` (PostgrestBuilder.js:148-152),
      // which is reconciled below.
      let { data, error } = await supabase
        .from('disease_reports')
        .upsert(withIdempotency, { onConflict: 'client_idempotency_key', ignoreDuplicates: true })
        .select()
        .maybeSingle();

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

      if (!data) {
        // Nothing inserted = this key is already filed. That is a SUCCESS —
        // the report she is trying to send is on the server. Read it back so
        // the caller gets the row rather than an empty answer it has to guess
        // about.
        const existing = await supabase
          .from('disease_reports')
          .select('*')
          .eq('client_idempotency_key', idempotencyKey)
          .maybeSingle();
        if (existing.error) throw existing.error;

        await offlineCache.invalidate(CACHE_NS);
        // A null row here means the insert was ignored but SELECT cannot see
        // the row (an approval-scoped RLS policy would do that). Still a
        // success — reporting a failure would be the lie that gets a second
        // copy filed. The forms build their confirmation from local state.
        return { data: (existing.data ?? null) as DiseaseReport | null, error: null, queued: false };
      }

      // Fire-and-forget analytics — district + kind only, never health details.
      track(events.REPORT_SUBMITTED, { kind: 'disease', district: reportData.district });

      // The user's own action has just contradicted every cached list.
      await offlineCache.invalidate(CACHE_NS);

      return { data: data as DiseaseReport, error: null, queued: false };
    } catch (error: any) {
      console.error('Error creating disease report:', error);
      return {
        data: null,
        error: normalizeSubmitErrorMessage(error, { idempotent: suppliedKey !== null }),
      };
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

      await offlineCache.invalidate(CACHE_NS);

      return { data: data as DiseaseReport, error: null };
    } catch (error: any) {
      console.error('Error updating disease report:', error);
      // Transport failures get human copy; a real server answer (RLS, a
      // constraint) keeps its own message. Same reasoning as
      // normalizeSubmitErrorMessage above — a raw
      // 'RequestTimeoutError: …' is not a sentence anyone can act on.
      return { data: null, error: describeRequestError(error, 'Could not update this report.') };
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

      await offlineCache.invalidate(CACHE_NS);

      return { data: data as DiseaseReport, error: null };
    } catch (error: any) {
      console.error('Error verifying disease report:', error);
      return { data: null, error: describeRequestError(error, 'Could not verify this report.') };
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

      await offlineCache.invalidate(CACHE_NS);

      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error deleting disease report:', error);
      return { data: null, error: describeRequestError(error, 'Could not delete this report.') };
    }
  },

  // Get reports by reporter — "My Submissions". Cached per user: the cache key
  // carries BOTH the signed-in owner (offlineCache) and the reporter asked
  // for, so a shared handset can never answer one worker with another's list.
  async getByReporter(
    reporterId: string,
    cache?: ReadThroughOptions,
  ): Promise<CachedApiResponse<DiseaseReport[]>> {
    return offlineCache.readThrough<DiseaseReport[]>(
      `${CACHE_NS}byReporter:${reporterId}`,
      async () => {
        const { data, error } = await supabase
          .from('disease_reports')
          .select('*')
          .eq('reporter_id', reporterId)
          .order('created_at', { ascending: false });

        if (error) throw error;

        return { data: data as DiseaseReport[] };
      },
      { fallbackMessage: 'Could not load your reports.', ...cache },
    );
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

      // Rethrow the ACTUAL failure, not a generic stand-in: 'Error fetching
      // statistics' erased whether the query was refused, timed out or never
      // left the phone, and describeRequestError below can only be honest
      // about a failure it can still see.
      const failure = [totalError, activeError, criticalError, pendingError].find(Boolean);
      if (failure) throw failure;

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
      return { data: null, error: describeRequestError(error, 'Could not load report statistics.') };
    }
  },

  // Nearby recent reports — cluster/duplicate awareness at report entry
  // (ROADMAP item 4). One cheap query, aggregation on the client. The result
  // INFORMS the reporter before she saves — it never gates submission.
  // Counts approved OR pending reports (rejected ones are noise, not signal).
  // DELIBERATELY NOT CACHED (INC-05b): this answers "is a cluster forming
  // right now?" at the instant she is deciding. A cached "3 similar reports
  // this week" would still be shown as awareness while being hours old, and
  // the caller stays silent on failure — silence is the honest degradation
  // here, a stale number is not.
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
  async getRecent(
    limit: number = 5,
    cache?: ReadThroughOptions,
  ): Promise<CachedApiResponse<DiseaseReport[]>> {
    return offlineCache.readThrough<DiseaseReport[]>(
      `${CACHE_NS}recent:${limit}`,
      async () => {
        const { data, error } = await supabase
          .from('disease_reports')
          .select(`
          *,
          reporter:profiles!reporter_id(id, full_name)
        `)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        return { data: data as DiseaseReport[] };
      },
      { fallbackMessage: 'Could not load recent reports.', ...cache },
    );
  },
};

export default diseaseReportsService;
