// =====================================================
// APPROVAL QUEUE SCREEN ("Prakash" design)
// Pending disease / water / campaign / alert approvals.
// Flat headerBg band + Role Ribbon, flat data rows with
// hairline dividers, token-driven status pills, 4-state
// data region, One-Hand Action Bar on the detail modal.
// =====================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, ActivityIndicator, RefreshControl,
  ScrollView, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import {
  ROLE_ACCENT, SkeletonBlock, ErrorCard, EmptyState,
  getSeverityColor, getWaterQualityColor,
} from '../dashboards/DashboardShared';
import {
  reporterTrackRecord, reporterNames, feedsSignalBatch,
  FeedsSignalResult, ReporterName, ReporterTrackRecord,
} from '../../lib/services/approvalMeta';

interface Props { profile: Profile; onBack: () => void; initialTab?: QueueTab }

type QueueTab = 'disease' | 'water' | 'campaigns' | 'alerts';

interface DiseaseReport {
  id: string; disease_name: string; disease_type: string; severity: string;
  cases_count: number; deaths_count?: number; location_name: string; district: string; state: string;
  symptoms: string; age_group: string; gender: string; treatment_status: string;
  latitude?: number; longitude?: number;
  reporter_id: string; status: string; approval_status?: string; created_at: string;
}
interface WaterReport {
  id: string; source_name: string; source_type: string; location_name: string;
  district: string; state: string; overall_quality: string; contamination_type: string;
  ph_level?: number; turbidity?: number; latitude?: number; longitude?: number;
  reporter_id: string; status: string; approval_status?: string; notes: string; created_at: string;
}
interface Campaign {
  id: string;
  name?: string;
  campaign_name?: string;
  title?: string;
  campaign_type: string;
  district: string;
  state: string;
  start_date: string;
  end_date: string;
  status: string;
  target_population: number;
  volunteers_needed: number;
  approval_status?: string;
  created_at: string;
}
interface HealthAlert {
  id: string; title: string; description: string; alert_type: string;
  urgency_level: string; location_name: string; district: string; state: string;
  status: string; created_by: string; approval_status?: string;
  affected_population?: number; cases_reported?: number; disease_or_issue?: string;
  immediate_actions?: string; precautionary_measures?: string; created_at: string;
}

type QueueItem = DiseaseReport | WaterReport | Campaign | HealthAlert;

/**
 * One network page. Twenty-five rows fill roughly three screens on a 412 dp
 * phone — an officer clears the top of the queue long before page two, and a
 * district with a real backlog no longer parses the whole table to open this
 * screen.
 */
const PAGE_SIZE = 25;

const TABLES: Record<QueueTab, string> = {
  disease:   'disease_reports',
  water:     'water_quality_reports',
  campaigns: 'health_campaigns',
  alerts:    'health_alerts',
};

/**
 * Exactly the columns the row and the detail modal render — never `*`.
 * `select('*')` on the two report tables also drags down `location_geo`, a
 * PostGIS geography blob no screen has ever shown, on every queue open and
 * again after every approve/reject.
 *
 * The campaigns list is shorter than the `Campaign` interface on purpose:
 * `title`, `name`, `target_population` and `volunteers_needed` are NOT columns
 * on `health_campaigns` (verified against the live schema), so naming them
 * would 42703 the entire query. They came back undefined under `select('*')`
 * too — nothing on screen changes.
 */
const COLUMNS: Record<QueueTab, string> = {
  disease:
    'id,disease_name,disease_type,severity,cases_count,deaths_count,location_name,district,state,' +
    'symptoms,age_group,gender,treatment_status,latitude,longitude,reporter_id,status,approval_status,created_at',
  water:
    'id,source_name,source_type,location_name,district,state,overall_quality,contamination_type,' +
    'ph_level,turbidity,latitude,longitude,reporter_id,status,approval_status,notes,created_at',
  campaigns:
    'id,campaign_name,campaign_type,district,state,start_date,end_date,status,approval_status,created_at',
  alerts:
    'id,title,description,alert_type,urgency_level,location_name,district,state,status,created_by,' +
    'approval_status,affected_population,cases_reported,disease_or_issue,immediate_actions,' +
    'precautionary_measures,created_at',
};

/** How far a tab has been paged / how many rows sit behind it, per stream. */
type TabCursor = { pending: number; decided: number };
type TabCursors = Record<QueueTab, TabCursor>;
const zeroCursors = (): TabCursors => ({
  disease:   { pending: 0, decided: 0 },
  water:     { pending: 0, decided: 0 },
  campaigns: { pending: 0, decided: 0 },
  alerts:    { pending: 0, decided: 0 },
});

/** Legacy disease-severity vocab → severity token key */
const severityKey = (s: string): string => {
  switch (s?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'severe':
    case 'high':     return 'high';
    case 'moderate':
    case 'medium':   return 'medium';
    case 'mild':
    case 'low':      return 'low';
    default:         return '';
  }
};

/** Short role word for the reporter evidence line ("ASHA Sunita Devi"). */
const ROLE_LABEL: Record<string, string> = {
  asha_worker: 'ASHA',
  volunteer: 'Volunteer',
  clinic: 'Clinic',
  district_officer: 'District Officer',
  health_admin: 'Health Admin',
  super_admin: 'Admin',
};

/**
 * C·03 common-reason templates. Tapping a chip FILLS the note box with an
 * editable sentence — the reporter reads these words exactly as written.
 */
const REJECT_TEMPLATES: { id: string; label: string; text: string }[] = [
  { id: 'duplicate', label: 'Duplicate',        text: 'This looks like a duplicate of an earlier report for the same place and dates. Refile only if this is a separate incident.' },
  { id: 'more_info', label: 'Needs more info',  text: 'There is not enough detail to accept this yet. Please add the symptoms, dates, and exact location, then submit again.' },
  { id: 'wrong_area', label: 'Wrong area',      text: 'The location does not match the area this report covers. Please correct the village and district, then submit again.' },
  { id: 'numbers',   label: 'Numbers look off', text: 'The counts do not match what we would expect here. Please recheck the numbers, then submit again.' },
];

/** Waiting age from created_at — the honest metric of triage health. */
const waitingAge = (iso: string): { label: string; hours: number } => {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  const hours = ms / 3_600_000;
  const label = hours < 1
    ? `waiting ${Math.max(1, Math.round(ms / 60_000))}m`
    : hours < 48
    ? `waiting ${Math.round(hours)}h`
    : `waiting ${Math.round(hours / 24)}d`;
  return { label, hours };
};

// ─────────────────────────────────────────────────────────────────────────────

export const ApprovalQueueScreen: React.FC<Props> = ({ profile, onBack, initialTab }) => {
  const { colors, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? colors.primary;

  const isClinic = profile.role === 'clinic';
  const isDistrictOfficer = profile.role === 'district_officer';
  const isAdmin = profile.role === 'super_admin' || profile.role === 'health_admin';
  const canVerifyReports = isAdmin || isClinic || isDistrictOfficer;
  const canApproveReports = isAdmin || isClinic || isDistrictOfficer;
  const canApproveCampaigns = isAdmin || isDistrictOfficer;
  const canApproveAlerts = isAdmin;
  const canReReviewReports = isAdmin || isClinic;
  const canReReviewCampaigns = isAdmin;
  const canReReviewAlerts = isAdmin;

  const [tab, setTab] = useState<QueueTab>(initialTab ?? 'disease');
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]       = useState('');

  // Rows loaded SO FAR, already in queue order. Not the whole table any more.
  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports]     = useState<WaterReport[]>([]);
  const [campaigns, setCampaigns]           = useState<Campaign[]>([]);
  const [alerts, setAlerts]                 = useState<HealthAlert[]>([]);
  // Paging truth: how much is on the phone, and how much exists behind it.
  const [loadedCounts, setLoadedCounts] = useState<TabCursors>(zeroCursors);
  const [totalCounts, setTotalCounts]   = useState<TabCursors>(zeroCursors);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [moreError, setMoreError]       = useState<string | null>(null);
  // Every load() invalidates whatever page fetch is still in flight. Without
  // this, a page that lands after an approve-triggered reload appends itself
  // onto a list that no longer matches its cursor — and the rows the cursor
  // then skips are pending items nobody ever sees.
  const loadGen = useRef(0);

  // Badges and the "PENDING · n" header read a head:true COUNT of the whole
  // filtered table, never the length of whichever page happens to be down.
  // A paged list that counted its own rows would under-report the backlog.
  const pendingCounts = {
    disease:   totalCounts.disease.pending,
    water:     totalCounts.water.pending,
    campaigns: totalCounts.campaigns.pending,
    alerts:    totalCounts.alerts.pending,
  };
  const loadedOfTab = loadedCounts[tab].pending + loadedCounts[tab].decided;
  const totalOfTab  = totalCounts[tab].pending + totalCounts[tab].decided;
  const hasMore     = loadedOfTab < totalOfTab;

  // C·02 evidence meta — supplementary; the card never blocks on these.
  const [reporterStats, setReporterStats] = useState<Map<string, ReporterTrackRecord>>(new Map());
  const [reporterInfo, setReporterInfo]   = useState<Map<string, ReporterName>>(new Map());
  const [signalMeta, setSignalMeta]       = useState<Map<string, FeedsSignalResult>>(new Map());

  const [selectedItem, setSelectedItem]   = useState<QueueItem | null>(null);
  const [selectedType, setSelectedType]   = useState<QueueTab>('disease');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [rejectReason, setRejectReason]   = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  // Confirm-delete modal (replaces Alert.alert — needed for web)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: QueueTab } | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackType, setFeedbackType] = useState<'success' | 'error' | 'warning'>('success');

  const showFeedback = (title: string, message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setFeedbackTitle(title);
    setFeedbackMessage(message);
    setFeedbackType(type);
    setShowFeedbackModal(true);
  };

  // ── Tabs based on role ───────────────────────────────────────────────────
  const allTabs: { id: QueueTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'disease',   label: 'Disease',   icon: 'medkit-outline' },
    { id: 'water',     label: 'Water',     icon: 'water-outline' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone-outline' },
    { id: 'alerts',    label: 'Alerts',    icon: 'alert-circle-outline' },
  ];
  // Admins see all; district_officer sees disease/water/campaigns; clinic sees disease/water only
  const visibleTabs = isAdmin
    ? allTabs
    : isDistrictOfficer
    ? allTabs.filter(t => ['disease','water','campaigns'].includes(t.id))
    : isClinic
    ? allTabs.filter(t => ['disease','water'].includes(t.id))
    : allTabs;

  // ── Load ─────────────────────────────────────────────────────────────────
  // Scoping is unchanged: only a district_officer with a district actually set
  // is narrowed, and only on the three district-carrying tables. Alerts stay
  // national, as before (and only admins ever load that tab).
  const scopeToDistrict = (t: QueueTab): boolean =>
    t !== 'alerts' && isDistrictOfficer && !!profile.district && profile.district.trim() !== '';

  // Same role gates as before: clinics don't approve campaigns, only admins
  // approve alerts.
  const tabLoads = (t: QueueTab): boolean =>
    t === 'campaigns' ? !isClinic : t === 'alerts' ? isAdmin : true;

  /**
   * The queue is two streams. `pending` waits on a human; `decided` is
   * everything else — NULL `approval_status` included, so a legacy row with no
   * status can never fall out of BOTH filters and vanish from the screen.
   */
  const queueQuery = (t: QueueTab, stream: 'pending' | 'decided', columns: string, countOnly = false) => {
    let q: any = supabase
      .from(TABLES[t])
      .select(columns, countOnly ? { count: 'exact', head: true } : undefined);
    q = stream === 'pending'
      ? q.eq('approval_status', 'pending_approval')
      : q.or('approval_status.neq.pending_approval,approval_status.is.null');
    if (scopeToDistrict(t)) q = q.eq('district', profile.district);
    return q;
  };

  /** head:true — the server counts, no rows cross the wire. */
  const countStream = async (t: QueueTab, stream: 'pending' | 'decided'): Promise<number> => {
    const { count, error } = await queueQuery(t, stream, 'id', true);
    if (error) throw error;
    return count ?? 0;
  };

  const fetchStream = async (t: QueueTab, stream: 'pending' | 'decided', from: number, take: number): Promise<any[]> => {
    const asc = stream === 'pending';
    const { data, error } = await queueQuery(t, stream, COLUMNS[t])
      .order('created_at', { ascending: asc })
      // Stable tiebreak — without it two rows sharing a created_at can repeat
      // or skip across page boundaries.
      .order('id', { ascending: asc })
      .range(from, from + take - 1);
    if (error) throw error;
    return data ?? [];
  };

  /**
   * One page, in the order the screen actually shows: the pending block
   * oldest-first — the triage order the "OLDEST FIRST ↓" header promises —
   * then decided history newest-first. Paging the two streams separately is
   * what makes the cap honest: a single newest-first page would cut off
   * exactly the oldest pending rows the officer opened this screen to clear.
   */
  const fetchPage = async (t: QueueTab, from: TabCursor, totals: TabCursor) => {
    const rows: any[] = [];
    const next: TabCursor = { ...from };

    const takePending = Math.min(PAGE_SIZE, Math.max(0, totals.pending - from.pending));
    if (takePending > 0) {
      const got = await fetchStream(t, 'pending', from.pending, takePending);
      rows.push(...got);
      next.pending = from.pending + got.length;
    }
    // Only once the pending block is exhausted does a page start spending
    // itself on history.
    const takeDecided = Math.min(PAGE_SIZE - rows.length, Math.max(0, totals.decided - from.decided));
    if (takeDecided > 0) {
      const got = await fetchStream(t, 'decided', from.decided, takeDecided);
      rows.push(...got);
      next.decided = from.decided + got.length;
    }
    return { rows, next };
  };

  /** Rows land in the tab's own array; `append` is the "Load more" path.
   *  De-duped by id because a row another admin decides mid-page could
   *  otherwise arrive in both streams. */
  const setRowsFor = (t: QueueTab, rows: any[], append: boolean) => {
    const merge = <T extends { id: string }>(prev: T[]): T[] => {
      if (!append) return rows as T[];
      const seen = new Set(prev.map(r => r.id));
      return [...prev, ...(rows as T[]).filter(r => !seen.has(r.id))];
    };
    if (t === 'disease')        setDiseaseReports(merge);
    else if (t === 'water')     setWaterReports(merge);
    else if (t === 'campaigns') setCampaigns(merge);
    else                        setAlerts(merge);
  };

  /**
   * Full reset to page one. Also runs after every approve/reject/delete, when
   * the pending/decided split has just moved underneath the cursors — anything
   * loaded past page one is deliberately dropped rather than left stale.
   */
  const load = async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setLoadingMore(false);
    setMoreError(null);
    try {
      const tabs = allTabs.map(t => t.id).filter(tabLoads);
      const pages = await Promise.all(tabs.map(async t => {
        const [pending, decided] = await Promise.all([countStream(t, 'pending'), countStream(t, 'decided')]);
        const totals: TabCursor = { pending, decided };
        return { t, totals, page: await fetchPage(t, { pending: 0, decided: 0 }, totals) };
      }));
      if (gen !== loadGen.current) return; // a newer load already owns the list
      pages.forEach(p => setRowsFor(p.t, p.page.rows, false));
      setTotalCounts(prev => {
        const next = { ...prev };
        pages.forEach(p => { next[p.t] = p.totals; });
        return next;
      });
      setLoadedCounts(prev => {
        const next = { ...prev };
        pages.forEach(p => { next[p.t] = p.page.next; });
        return next;
      });
      setFetchError(null);
    } catch {
      if (gen === loadGen.current) setFetchError("Couldn't load the queue — check connection");
    } finally {
      if (gen === loadGen.current) { setLoading(false); setRefreshing(false); }
    }
  };

  /**
   * "Load more" pages the CURRENT tab only, and only on a tap — never on
   * scroll. On a metered one-bar connection the officer decides when to spend
   * the next page. Its four states live in the list footer: skeleton while
   * fetching, an error card with Retry when the page fails, the button while
   * rows remain, and a quiet closing line at the end.
   */
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const t = tab;
    const gen = loadGen.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchPage(t, loadedCounts[t], totalCounts[t]);
      if (gen !== loadGen.current) return; // the list was reset under us
      setRowsFor(t, page.rows, true);
      setLoadedCounts(prev => ({ ...prev, [t]: page.next }));
      // The counts were taken moments ago. An empty page means the backlog
      // they promised has since been decided or deleted by someone else —
      // snap the totals to what actually exists so the button can't sit there
      // offering rows that will never arrive.
      if (page.rows.length === 0) setTotalCounts(prev => ({ ...prev, [t]: { ...page.next } }));
    } catch {
      if (gen === loadGen.current) setMoreError("Couldn't load more — check connection");
    } finally { setLoadingMore(false); }
  };

  useEffect(() => { load(); }, []);

  // ── C·02 evidence meta — batch-loaded AFTER the lists render.
  // Meta is supplementary: a failure only omits the evidence line,
  // it never blocks or errors the queue (graceful absence by design).
  useEffect(() => {
    const pendingDisease = diseaseReports.filter(r => r.approval_status === 'pending_approval');
    const pendingWater   = waterReports.filter(r => r.approval_status === 'pending_approval');
    const reporterIds = [...pendingDisease, ...pendingWater].map(r => r.reporter_id).filter(Boolean);

    if (reporterIds.length > 0) {
      reporterTrackRecord(reporterIds)
        .then(setReporterStats)
        .catch(e => console.warn('approval meta: track record unavailable', e?.message ?? e));
      reporterNames(reporterIds)
        .then(setReporterInfo)
        .catch(e => console.warn('approval meta: reporter names unavailable', e?.message ?? e));
    }

    if (pendingDisease.length > 0) {
      feedsSignalBatch(pendingDisease)
        .then(results => {
          const next = new Map<string, FeedsSignalResult>();
          pendingDisease.forEach((r, i) => {
            const res = results[i];
            if (res?.feeds) next.set(r.id, res);
          });
          setSignalMeta(next);
        })
        .catch(e => console.warn('approval meta: signal check unavailable', e?.message ?? e));
    } else {
      setSignalMeta(new Map());
    }
  }, [diseaseReports, waterReports]);

  // ── Delete (reports/campaigns/alerts — records without a soft-delete flag) ─
  const deleteItem = (id: string, type: QueueTab) => {
    // Use a custom Modal instead of Alert.alert (Alert.alert is no-op on web)
    setDeleteTarget({ id, type });
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setShowDeleteConfirm(false);
    setActionLoading(true);
    try {
      const { error } = await supabase.from(TABLES[deleteTarget.type]).delete().eq('id', deleteTarget.id);
      if (error) throw error;
      setShowDetailModal(false);
      load();
    } catch (e: any) { showFeedback('Error', e?.message ?? 'Failed to delete item.', 'error'); }
    finally { setActionLoading(false); setDeleteTarget(null); }
  };

  // ── Verify / Unverify ────────────────────────────────────────────────────
  const verifyItem = async (id: string, type: QueueTab, newStatus: 'verified' | 'reported') => {
    setActionLoading(true);
    try {
      const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';
      const { error } = await supabase.from(table).update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setSelectedItem(prev => prev ? { ...prev, status: newStatus } : prev);
      load();
    } catch (e: any) { showFeedback('Error', e?.message ?? 'Failed to update verification.', 'error'); }
    finally { setActionLoading(false); }
  };

  // ── Approve / Reject ─────────────────────────────────────────────────────
  const approve = async (id: string, type: QueueTab) => {
    setActionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from(TABLES[type])
        .update({ approval_status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      setShowDetailModal(false);
      setShowRejectInput(false);
      setRejectReason('');
      showFeedback('Approved', 'Item approved successfully.', 'success');
      load();
    } catch (e: any) { showFeedback('Error', e?.message ?? 'Failed to approve item.', 'error'); }
    finally { setActionLoading(false); }
  };

  const reject = async (id: string, type: QueueTab, reason: string) => {
    setActionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from(TABLES[type])
        .update({ approval_status: 'rejected', approved_by: user?.id, approved_at: new Date().toISOString(), rejection_reason: reason || 'Rejected by admin' })
        .eq('id', id);
      if (error) throw error;
      setShowDetailModal(false);
      setShowRejectInput(false);
      setRejectReason('');
      showFeedback('Rejected', 'Item has been rejected.', 'warning');
      load();
    } catch (e: any) { showFeedback('Error', e?.message ?? 'Failed to reject item.', 'error'); }
    finally { setActionLoading(false); }
  };

  const feedbackVisual: { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string } =
    feedbackType === 'error'
      ? { icon: 'alert-circle-outline', color: colors.danger, bg: colors.dangerBg }
      : feedbackType === 'warning'
      ? { icon: 'warning-outline', color: colors.warning, bg: colors.warningBg }
      : { icon: 'checkmark-circle-outline', color: colors.success, bg: colors.successBg };

  // ── Status pill — dot + UPPERCASE label on *Bg token ─────────────────────
  const statusPill = (s?: string) => {
    const fg = s === 'approved' ? colors.success
      : s === 'pending_approval' ? colors.warning
      : s === 'rejected' ? colors.danger
      : colors.textSecondary;
    const bg = s === 'approved' ? colors.successBg
      : s === 'pending_approval' ? colors.warningBg
      : s === 'rejected' ? colors.dangerBg
      : colors.surfaceVariant;
    const label = s === 'pending_approval' ? 'PENDING' : s === 'approved' ? 'APPROVED' : s === 'rejected' ? 'REJECTED' : 'UNKNOWN';
    return (
      <View style={[qst.pill, { backgroundColor: bg }]} accessibilityLabel={`Status: ${label.toLowerCase()}`}>
        <View style={[qst.pillDot, { backgroundColor: fg }]} />
        <Text style={[qst.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>{label}</Text>
      </View>
    );
  };

  // ── Filtered lists ────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const fDisease   = diseaseReports.filter(r => !q || r.disease_name?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));
  const fWater     = waterReports.filter(r => !q || r.source_name?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));
  const fCampaigns = campaigns.filter(r => {
    const campaignTitle = r.campaign_name || r.title || r.name || '';
    return !q || campaignTitle.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q);
  });
  const fAlerts    = alerts.filter(r => !q || r.title?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));

  // ── Flat row renderer — surface bg, hairline divider ─────────────────────
  // Pending rows carry the C·02 evidence a 30-second decision needs:
  // waiting age, reporter + track record, GPS, snippet, feeds-signal.
  const renderRow = (item: QueueItem, type: QueueTab) => {
    let iconColor: string = colors.textSecondary;
    let iconName: keyof typeof Ionicons.glyphMap = 'document-text-outline';
    let titleText = '';
    let subtitleText = '';
    let reporterId: string | undefined;
    let snippetText = '';
    let hasGps = false;

    switch (type) {
      case 'disease': {
        const diseaseItem = item as DiseaseReport;
        iconColor = getSeverityColor(severityKey(diseaseItem.severity), colors);
        iconName = 'medkit-outline';
        titleText = diseaseItem.disease_name ?? 'Unknown Disease';
        const deaths = diseaseItem.deaths_count ?? 0;
        subtitleText = `Cases: ${diseaseItem.cases_count ?? 0}${deaths > 0 ? ` · Deaths: ${deaths}` : ''} · ${diseaseItem.district}, ${diseaseItem.state}`;
        reporterId = diseaseItem.reporter_id;
        snippetText = diseaseItem.symptoms ? `symptoms: ${diseaseItem.symptoms}` : '';
        hasGps = diseaseItem.latitude != null && diseaseItem.longitude != null;
        break;
      }
      case 'water': {
        const waterItem = item as WaterReport;
        iconColor = getWaterQualityColor(waterItem.overall_quality, colors);
        iconName = 'water-outline';
        titleText = waterItem.source_name ?? 'Unknown Source';
        subtitleText = `${waterItem.source_type} · ${waterItem.district}, ${waterItem.state}`;
        reporterId = waterItem.reporter_id;
        const readings = [
          waterItem.turbidity != null ? `turbidity ${waterItem.turbidity} NTU` : '',
          waterItem.ph_level != null ? `pH ${waterItem.ph_level}` : '',
        ].filter(Boolean).join(', ');
        snippetText = readings || (waterItem.notes ? `note: "${waterItem.notes}"` : '');
        hasGps = waterItem.latitude != null && waterItem.longitude != null;
        break;
      }
      case 'campaigns': {
        const campaignItem = item as Campaign;
        iconColor = colors.primary;
        iconName = 'megaphone-outline';
        titleText = campaignItem.campaign_name || campaignItem.title || campaignItem.name || 'Unnamed Campaign';
        subtitleText = `${campaignItem.campaign_type} · ${campaignItem.district}, ${campaignItem.state}`;
        break;
      }
      case 'alerts': {
        const alertItem = item as HealthAlert;
        iconColor = getSeverityColor(alertItem.urgency_level, colors);
        iconName = 'alert-circle-outline';
        titleText = alertItem.title ?? 'Untitled Alert';
        subtitleText = `${alertItem.alert_type ?? ''} · ${alertItem.district}, ${alertItem.state}`;
        break;
      }
    }

    const isPending = item.approval_status === 'pending_approval';

    // Evidence meta — every piece renders only when available (graceful absence).
    const reporter = reporterId ? reporterInfo.get(reporterId) : undefined;
    const track = reporterId ? reporterStats.get(reporterId) : undefined;
    const reporterLine = reporter
      ? `${reporter.role && ROLE_LABEL[reporter.role] ? `${ROLE_LABEL[reporter.role]} ` : ''}${reporter.fullName}${
          track ? ` · ${track.approved > 0 ? `${track.approved} approved before` : 'first report'}` : ''
        }`
      : '';
    const signal = type === 'disease' ? signalMeta.get(item.id) : undefined;
    const age = item.created_at ? waitingAge(item.created_at) : null;
    const ageOverdue = (age?.hours ?? 0) > 6;
    const ageColor = ageOverdue ? colors.warning : colors.textSecondary;

    return (
      <Pressable
        key={item.id}
        style={({ pressed }) => [
          qst.row,
          {
            backgroundColor: pressed ? colors.cardHover : colors.surface,
            borderBottomColor: colors.borderLight,
          },
        ]}
        onPress={() => { setSelectedItem(item); setSelectedType(type); setShowDetailModal(true); }}
        accessibilityRole="button"
        accessibilityLabel={`${titleText}, status ${isPending ? 'pending' : item.approval_status ?? 'unknown'}${isPending && age ? `, ${age.label}` : ''}`}
      >
        <View style={[qst.iconWrap, { backgroundColor: iconColor + '14' }]}>
          <Ionicons name={iconName} size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[qst.rowTitle, { color: colors.text }]} numberOfLines={1}>{titleText}</Text>
          <Text style={[qst.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>{subtitleText}</Text>
          {isPending && reporterLine !== '' && (
            <Text style={[qst.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {reporterLine}
            </Text>
          )}
          {isPending && snippetText !== '' && (
            <Text style={[qst.rowSnippet, { color: colors.textSecondary }]} numberOfLines={1}>
              {snippetText}
            </Text>
          )}
          {isPending && signal?.feeds && signal.label && (
            <View style={qst.signalRow}>
              <Ionicons name="pulse-outline" size={12} color={colors.info} />
              <Text style={[qst.signalText, { color: colors.info }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {signal.label}
              </Text>
            </View>
          )}
          <View style={qst.metaRow}>
            {isPending && age && (
              <View style={[qst.metaChip, { backgroundColor: ageOverdue ? colors.warningBg : colors.surfaceVariant }]}>
                <Ionicons name="time-outline" size={12} color={ageColor} />
                <Text style={[qst.metaChipText, { color: ageColor }]} maxFontSizeMultiplier={1.3}>{age.label}</Text>
              </View>
            )}
            {isPending && hasGps && (
              <View
                style={[qst.metaChip, { backgroundColor: colors.successBg }]}
                accessibilityLabel="GPS location attached"
              >
                <Ionicons name="location-outline" size={12} color={colors.success} />
                <Text style={[qst.metaChipText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>GPS ✓</Text>
              </View>
            )}
            <Text style={[qst.rowDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              {item.created_at ? format(new Date(item.created_at), 'd MMM yyyy') : ''}
            </Text>
          </View>
        </View>
        {statusPill(item.approval_status)}
      </Pressable>
    );
  };

  // Default sort "Oldest first ↓" (C·02): pending items rise to the top,
  // waiting-longest first — the honest triage order. Decided items follow
  // as history, newest first.
  const byQueueOrder = (a: QueueItem, b: QueueItem): number => {
    const aPending = a.approval_status === 'pending_approval';
    const bPending = b.approval_status === 'pending_approval';
    if (aPending !== bPending) return aPending ? -1 : 1;
    const aT = new Date(a.created_at).getTime();
    const bT = new Date(b.created_at).getTime();
    return aPending ? aT - bT : bT - aT;
  };
  const currentData: QueueItem[] =
    [...(tab === 'disease' ? fDisease : tab === 'water' ? fWater : tab === 'campaigns' ? fCampaigns : fAlerts)]
      .sort(byQueueOrder);
  const pendingOfTab  = tab === 'disease' ? pendingCounts.disease : tab === 'water' ? pendingCounts.water : tab === 'campaigns' ? pendingCounts.campaigns : pendingCounts.alerts;
  const totalPending  = pendingCounts.disease + pendingCounts.water + pendingCounts.campaigns + pendingCounts.alerts;

  const isDiseaseItem = (item: QueueItem): item is DiseaseReport =>
    selectedType === 'disease' && 'disease_name' in item;
  const isWaterItem = (item: QueueItem): item is WaterReport =>
    selectedType === 'water' && 'source_name' in item;
  const isCampaignItem = (item: QueueItem): item is Campaign =>
    selectedType === 'campaigns' && 'campaign_type' in item;
  const isAlertItem = (item: QueueItem): item is HealthAlert =>
    selectedType === 'alerts' && 'alert_type' in item && 'title' in item;

  const canApproveSelected =
    selectedType === 'campaigns'
      ? canApproveCampaigns
      : selectedType === 'alerts'
      ? canApproveAlerts
      : canApproveReports;

  const canReReviewSelected =
    selectedType === 'campaigns'
      ? canReReviewCampaigns
      : selectedType === 'alerts'
      ? canReReviewAlerts
      : canReReviewReports;

  const getSelectedTitle = (item: QueueItem): string => {
    if (isDiseaseItem(item)) return item.disease_name ?? 'Detail';
    if (isWaterItem(item)) return item.source_name ?? 'Detail';
    if (isCampaignItem(item)) return item.campaign_name || item.title || item.name || 'Detail';
    if (isAlertItem(item)) return item.title ?? 'Detail';
    return 'Detail';
  };

  // ── Detail modal fields ───────────────────────────────────────────────────
  const DetailRow = ({ label, value }: { label: string; value?: string|number }) => (
    value !== undefined && value !== null && value !== '' && value !== 0
      ? <View style={[qst.detailRow, { borderBottomColor: colors.borderLight }]}>
          <Text style={[qst.detailLabel, { color: colors.textSecondary }]}>{label}</Text>
          <Text style={[qst.detailValue, { color: colors.text }]}>{String(value)}</Text>
        </View>
      : null
  );

  const showApproveBar = !!selectedItem && canApproveSelected &&
    (selectedItem.approval_status === 'pending_approval' || canReReviewSelected);

  // C·03 — whose words are these? The rejection note goes to this person.
  const reporterIdOf = (item: QueueItem | null): string | undefined => {
    if (!item) return undefined;
    if ('reporter_id' in item && item.reporter_id) return item.reporter_id;
    if ('created_by' in item && item.created_by) return item.created_by;
    return undefined;
  };
  const rejectRecipientId = reporterIdOf(selectedItem);
  const rejectRecipientName = rejectRecipientId ? reporterInfo.get(rejectRecipientId)?.fullName : undefined;
  const rejectRecipientFirst = rejectRecipientName ? rejectRecipientName.split(/\s+/)[0] : null;
  const rejectNoteEmpty = !rejectReason.trim();

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers read correctly in BOTH modes.
  // textInverse here would be white-on-paper — invisible — and is banned.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  return (
    <View style={[qst.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg surface, separated by a 1px hairline in both modes */}
      <View
        style={[
          qst.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={qst.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[qst.headerTitle, { color: headerText }]}>Approval Queue</Text>
          <Text style={[qst.headerSub, { color: headerSub }]} maxFontSizeMultiplier={1.3}>
            {totalPending} pending review{totalPending !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
      {/* Role Ribbon */}
      <View style={[qst.roleRibbon, { backgroundColor: accent }]} />

      {/* Tab bar */}
      <View style={[qst.tabBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {visibleTabs.map(t => {
          const active = tab === t.id;
          const count  = { disease: pendingCounts.disease, water: pendingCounts.water, campaigns: pendingCounts.campaigns, alerts: pendingCounts.alerts }[t.id];
          return (
            <TouchableOpacity
              key={t.id}
              style={qst.tabItem}
              // A failed "Load more" belongs to the tab it happened on.
              onPress={() => { setTab(t.id); setMoreError(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={count > 0 ? `${t.label}, ${count} pending` : t.label}
            >
              <Ionicons name={t.icon} size={18} color={active ? colors.primary : colors.textSecondary} />
              <Text
                style={[
                  qst.tabLabel,
                  { color: active ? colors.primary : colors.textSecondary, fontWeight: active ? '700' : '600' },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {t.label}
              </Text>
              {count > 0 && (
                <View style={[qst.tabBadge, { backgroundColor: colors.danger }]}>
                  <Text style={[qst.tabBadgeText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>{count}</Text>
                </View>
              )}
              {active && <View style={[qst.tabUnderline, { backgroundColor: colors.primary }]} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search */}
      <View style={[qst.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[qst.searchInput, { color: colors.text }]}
          placeholder="Search..."
          placeholderTextColor={colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Column-header eyebrow row */}
      <View style={[qst.tableHead, { backgroundColor: colors.surfaceVariant, borderBottomColor: colors.border }]}>
        {/* The count says which number it is. Search filters only what has
            been paged in, so while more rows exist it must not read as a
            count of the whole tab. */}
        <Text style={[qst.tableHeadText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
          OLDEST FIRST ↓
          <Text style={{ fontVariant: ['tabular-nums'] }}>
            {search
              ? ` · ${currentData.length} of ${loadedOfTab} loaded`
              : hasMore
              ? ` · ${loadedOfTab} of ${totalOfTab}`
              : ` · ${currentData.length}`}
          </Text>
        </Text>
        <Text style={[qst.tableHeadText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
          PENDING
          <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${pendingOfTab}`}</Text>
        </Text>
      </View>

      {/* Data region — skeleton / error / quiet-zero / content */}
      {fetchError && !loading && (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <ErrorCard message={fetchError} onRetry={load} />
        </View>
      )}
      {loading ? (
        <View style={qst.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
        </View>
      ) : (
        <FlatList
          data={currentData}
          keyExtractor={item => item.id}
          renderItem={({ item }) => renderRow(item, tab)}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            fetchError ? null : (
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
                {/* Search runs over the pages already on the phone. Saying
                    "no items match" while unread pages exist would be a lie. */}
                <EmptyState
                  icon={search ? 'search-outline' : 'checkmark-circle-outline'}
                  color={search ? colors.textSecondary : colors.success}
                  title={search
                    ? (hasMore
                        ? `No match in the ${loadedOfTab} loaded so far.`
                        : 'No items match — try a different search.')
                    : 'Queue clear — nothing waiting for review.'}
                  subtitle={search && hasMore ? 'Load more below to keep looking.' : undefined}
                />
              </View>
            )
          }
          /* Four states for the next page: error-with-retry, skeleton,
             the affordance itself, then a quiet close. */
          ListFooterComponent={
            moreError ? (
              <View style={qst.footerWrap}>
                <ErrorCard message={moreError} onRetry={loadMore} />
              </View>
            ) : loadingMore ? (
              <View style={qst.footerWrap} accessibilityElementsHidden>
                <SkeletonBlock height={64} radius={radii.sm} />
                <SkeletonBlock height={64} radius={radii.sm} />
              </View>
            ) : hasMore ? (
              <View style={qst.footerWrap}>
                <Pressable
                  onPress={loadMore}
                  style={({ pressed }) => [
                    qst.loadMoreBtn,
                    { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Load more, ${totalOfTab - loadedOfTab} still to load`}
                >
                  <Ionicons name="arrow-down-circle-outline" size={18} color={colors.primary} />
                  <Text style={[qst.loadMoreText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                    {`Load more · ${totalOfTab - loadedOfTab} left`}
                  </Text>
                </Pressable>
              </View>
            ) : loadedOfTab > 0 ? (
              <Text style={[qst.footerEnd, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {`All ${loadedOfTab} loaded`}
              </Text>
            ) : null
          }
        />
      )}

      {/* ── Detail / Approve Modal — One-Hand Action Bar ────────────────── */}
      <Modal
        visible={showDetailModal}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        onRequestClose={() => { setShowDetailModal(false); setShowRejectInput(false); setRejectReason(''); }}
      >
        <View style={[qst.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => { setShowDetailModal(false); setShowRejectInput(false); setRejectReason(''); }}
            accessibilityLabel="Close details"
          />
          {selectedItem && (
            <View style={[qst.sheet, { backgroundColor: colors.card }]}>
              {/* Modal header */}
              <View style={[qst.modalHeader, { borderBottomColor: colors.borderLight }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[qst.modalTitle, { color: colors.text }]} numberOfLines={2}>
                    {getSelectedTitle(selectedItem)}
                  </Text>
                  <Text style={[qst.modalSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {selectedItem.district}, {selectedItem.state}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => { setShowDetailModal(false); setShowRejectInput(false); setRejectReason(''); }}
                  style={[qst.closeBtn, { backgroundColor: colors.surfaceVariant }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ paddingHorizontal: spacing.lg }}>
                {/* Approval + verification pills */}
                <View style={qst.statusRow}>
                  {statusPill(selectedItem.approval_status)}
                  {(selectedType === 'disease' || selectedType === 'water') && selectedItem.status && (
                    <View style={[qst.pill, { backgroundColor: selectedItem.status === 'verified' ? colors.successBg : colors.infoBg }]}>
                      <View style={[qst.pillDot, { backgroundColor: selectedItem.status === 'verified' ? colors.success : colors.info }]} />
                      <Text style={[qst.pillText, { color: selectedItem.status === 'verified' ? colors.success : colors.info }]} maxFontSizeMultiplier={1.3}>
                        {selectedItem.status === 'verified' ? 'VERIFIED' : 'REPORTED'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Fields based on type */}
                {isDiseaseItem(selectedItem) && <>
                  <DetailRow label="Disease" value={selectedItem.disease_name} />
                  <DetailRow label="Type" value={selectedItem.disease_type} />
                  <DetailRow label="Severity" value={selectedItem.severity} />
                  <DetailRow label="Cases" value={selectedItem.cases_count} />
                  <DetailRow label="Age Group" value={selectedItem.age_group} />
                  <DetailRow label="Gender" value={selectedItem.gender} />
                  <DetailRow label="Symptoms" value={selectedItem.symptoms} />
                  <DetailRow label="Treatment" value={selectedItem.treatment_status} />
                  <DetailRow label="Location" value={`${selectedItem.location_name}, ${selectedItem.district}, ${selectedItem.state}`} />
                </>}
                {isWaterItem(selectedItem) && <>
                  <DetailRow label="Source" value={selectedItem.source_name} />
                  <DetailRow label="Type" value={selectedItem.source_type} />
                  <DetailRow label="Quality" value={selectedItem.overall_quality} />
                  <DetailRow label="Contamination" value={selectedItem.contamination_type} />
                  <DetailRow label="Location" value={`${selectedItem.location_name}, ${selectedItem.district}, ${selectedItem.state}`} />
                  <DetailRow label="Notes" value={selectedItem.notes} />
                </>}
                {isCampaignItem(selectedItem) && <>
                  <DetailRow label="Name" value={selectedItem.campaign_name || selectedItem.title || selectedItem.name} />
                  <DetailRow label="Type" value={selectedItem.campaign_type} />
                  <DetailRow label="Status" value={selectedItem.status} />
                  <DetailRow label="Start" value={selectedItem.start_date ? format(new Date(selectedItem.start_date), 'd MMM yyyy') : ''} />
                  <DetailRow label="End" value={selectedItem.end_date ? format(new Date(selectedItem.end_date), 'd MMM yyyy') : ''} />
                  <DetailRow label="Target Pop." value={selectedItem.target_population} />
                  <DetailRow label="Volunteers" value={selectedItem.volunteers_needed} />
                  <DetailRow label="Location" value={`${selectedItem.district}, ${selectedItem.state}`} />
                </>}
                {isAlertItem(selectedItem) && <>
                  <DetailRow label="Title" value={selectedItem.title} />
                  <DetailRow label="Type" value={selectedItem.alert_type} />
                  <DetailRow label="Urgency" value={selectedItem.urgency_level} />
                  <DetailRow label="Disease / Issue" value={selectedItem.disease_or_issue} />
                  <DetailRow label="Description" value={selectedItem.description} />
                  <DetailRow label="Cases Reported" value={selectedItem.cases_reported} />
                  <DetailRow label="Affected Population" value={selectedItem.affected_population} />
                  <DetailRow label="Immediate Actions" value={selectedItem.immediate_actions} />
                  <DetailRow label="Precautions" value={selectedItem.precautionary_measures} />
                  <DetailRow label="Location" value={`${selectedItem.location_name ?? ''}, ${selectedItem.district}, ${selectedItem.state}`} />
                </>}

                {/* C·03 — Reject with a reason. Templates FILL the note box
                    with an editable sentence; the note itself is required. */}
                {showRejectInput && (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={[qst.rejectWhoReads, { color: colors.text }]}>
                      {rejectRecipientFirst ?? 'The reporter'} will read your words exactly as written.
                    </Text>
                    <Text style={[qst.rejectLabel, { color: colors.textSecondary }]}>COMMON REASONS</Text>
                    <View style={qst.templateRow}>
                      {REJECT_TEMPLATES.map(t => {
                        const active = rejectReason === t.text;
                        return (
                          <Pressable
                            key={t.id}
                            style={({ pressed }) => [
                              qst.templateChip,
                              active
                                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                : { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.border },
                            ]}
                            onPress={() => setRejectReason(t.text)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`Fill note with template: ${t.label}`}
                          >
                            {active && <Ionicons name="checkmark" size={14} color={colors.onPrimary} />}
                            <Text
                              style={[qst.templateChipText, { color: active ? colors.onPrimary : colors.text }]}
                              maxFontSizeMultiplier={1.3}
                            >
                              {t.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={[qst.rejectLabel, { color: colors.textSecondary }]}>YOUR NOTE · REQUIRED</Text>
                    <TextInput
                      style={[qst.rejectInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputErrorBorder, color: colors.text }]}
                      placeholder="Why this can't be accepted — they will read this."
                      placeholderTextColor={colors.placeholder}
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      multiline
                      numberOfLines={3}
                    />
                    <Text style={[qst.rejectCaption, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                      Templates fill this box — edit before sending. Logged to the audit trail.
                    </Text>
                  </View>
                )}

                {/* Verify / Unverify — disease + water only, for admins and clinics */}
                {canVerifyReports && (selectedType === 'disease' || selectedType === 'water') && (
                  <Pressable
                    style={({ pressed }) => [
                      qst.secondaryBtn,
                      {
                        backgroundColor: pressed ? colors.cardHover : colors.card,
                        borderColor: colors.inputBorder,
                      },
                    ]}
                    onPress={() => verifyItem(
                      selectedItem.id,
                      selectedType,
                      selectedItem.status === 'verified' ? 'reported' : 'verified'
                    )}
                    disabled={actionLoading}
                    accessibilityRole="button"
                    accessibilityLabel={selectedItem.status === 'verified' ? 'Unverify report' : 'Mark report verified'}
                  >
                    <Ionicons
                      name={selectedItem.status === 'verified' ? 'close-circle-outline' : 'checkmark-done-circle-outline'}
                      size={18} color={colors.text}
                    />
                    <Text style={[qst.secondaryBtnText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {selectedItem.status === 'verified' ? 'Unverify' : 'Mark Verified'}
                    </Text>
                  </Pressable>
                )}

                {/* Delete — super_admin and health_admin only (NOT clinic) */}
                {isAdmin && (
                  <Pressable
                    style={({ pressed }) => [
                      qst.secondaryBtn,
                      {
                        backgroundColor: pressed ? colors.cardHover : colors.card,
                        borderColor: colors.danger,
                      },
                    ]}
                    onPress={() => deleteItem(selectedItem.id, selectedType)}
                    disabled={actionLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Delete record permanently"
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    <Text style={[qst.secondaryBtnText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                      Delete Permanently
                    </Text>
                  </Pressable>
                )}
                <View style={{ height: spacing.xl }} />
              </ScrollView>

              {/* One-Hand Action Bar — Approve / Reject docked at bottom */}
              {showApproveBar && (
                <View style={[qst.actionBar, { borderTopColor: colors.borderLight, backgroundColor: colors.card }]}>
                  {!showRejectInput
                    ? <>
                        <Pressable
                          style={({ pressed }) => [
                            qst.actionBtn,
                            {
                              backgroundColor: pressed ? colors.cardHover : colors.card,
                              borderWidth: 1.5, borderColor: colors.danger,
                            },
                          ]}
                          onPress={() => setShowRejectInput(true)}
                          accessibilityRole="button"
                          accessibilityLabel="Reject, opens the reason sheet"
                        >
                          <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                          <Text style={[qst.actionBtnText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>Reject…</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [
                            qst.actionBtn,
                            { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                            actionLoading && { opacity: 0.4 },
                          ]}
                          onPress={() => approve(selectedItem.id, selectedType)}
                          disabled={actionLoading}
                          accessibilityRole="button"
                          accessibilityLabel="Approve"
                        >
                          {actionLoading
                            ? <ActivityIndicator size={18} color={colors.onPrimary} />
                            : <Ionicons name="checkmark-circle-outline" size={18} color={colors.onPrimary} />
                          }
                          <Text style={[qst.actionBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>Approve</Text>
                        </Pressable>
                      </>
                    : <>
                        <Pressable
                          style={({ pressed }) => [
                            qst.actionBtn,
                            {
                              backgroundColor: pressed ? colors.cardHover : colors.card,
                              borderWidth: 1.5, borderColor: colors.inputBorder,
                            },
                          ]}
                          onPress={() => { setShowRejectInput(false); setRejectReason(''); }}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel rejection"
                        >
                          <Text style={[qst.actionBtnText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [
                            qst.actionBtn,
                            { backgroundColor: colors.danger },
                            (pressed || actionLoading || rejectNoteEmpty) && { opacity: 0.4 },
                          ]}
                          onPress={() => reject(selectedItem.id, selectedType, rejectReason)}
                          disabled={actionLoading || rejectNoteEmpty}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: actionLoading || rejectNoteEmpty }}
                          accessibilityLabel={rejectNoteEmpty ? 'Reject and send reason, write a note first' : 'Reject and send reason'}
                        >
                          {actionLoading
                            ? <ActivityIndicator size={18} color={colors.textInverse} />
                            : <Ionicons name="close-circle-outline" size={18} color={colors.textInverse} />
                          }
                          <Text style={[qst.actionBtnText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>Reject & send reason</Text>
                        </Pressable>
                      </>
                  }
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>

      {/* ── Delete Confirm Modal (web-compatible) ───────────────────────── */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <View style={[qst.centerOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[qst.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[qst.confirmIconWrap, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="trash-outline" size={28} color={colors.danger} />
            </View>
            <Text style={[qst.confirmTitle, { color: colors.text }]}>Delete Permanently?</Text>
            <Text style={[qst.confirmSub, { color: colors.textSecondary }]}>
              This action cannot be undone. The record will be permanently removed from the database.
            </Text>
            <View style={qst.confirmBtnRow}>
              <Pressable
                style={({ pressed }) => [
                  qst.confirmBtn,
                  {
                    backgroundColor: pressed ? colors.cardHover : colors.card,
                    borderWidth: 1.5, borderColor: colors.inputBorder,
                  },
                ]}
                onPress={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                accessibilityRole="button"
                accessibilityLabel="Cancel delete"
              >
                <Text style={[qst.confirmBtnText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  qst.confirmBtn,
                  { backgroundColor: colors.danger },
                  (pressed || actionLoading) && { opacity: 0.4 },
                ]}
                onPress={confirmDelete}
                disabled={actionLoading}
                accessibilityRole="button"
                accessibilityLabel="Delete permanently"
              >
                {actionLoading
                  ? <ActivityIndicator size="small" color={colors.textInverse} />
                  : <Text style={[qst.confirmBtnText, { color: colors.textInverse }]}>Delete</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Feedback Modal (web-compatible) ─────────────────────────────── */}
      <Modal
        visible={showFeedbackModal}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setShowFeedbackModal(false)}
      >
        <View style={[qst.centerOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[qst.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[qst.confirmIconWrap, { backgroundColor: feedbackVisual.bg }]}>
              <Ionicons name={feedbackVisual.icon} size={28} color={feedbackVisual.color} />
            </View>
            <Text style={[qst.confirmTitle, { color: colors.text }]}>{feedbackTitle}</Text>
            <Text style={[qst.confirmSub, { color: colors.textSecondary }]}>{feedbackMessage}</Text>
            <Pressable
              style={({ pressed }) => [
                qst.confirmBtn,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary, alignSelf: 'stretch' },
              ]}
              onPress={() => setShowFeedbackModal(false)}
              accessibilityRole="button"
              accessibilityLabel="OK"
            >
              <Text style={[qst.confirmBtnText, { color: colors.onPrimary }]}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const qst = StyleSheet.create({
  container: { flex: 1 },
  /* Header */
  /* No status-bar inset here — MainApp already wraps this route in a SafeAreaView. */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2, fontVariant: ['tabular-nums'] },
  roleRibbon: { height: 4, width: '100%' },
  /* Tabs */
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, gap: 2, position: 'relative', minHeight: 48, justifyContent: 'center' },
  tabLabel: { fontSize: 12, lineHeight: 16 },
  tabBadge: { position: 'absolute', top: 6, right: spacing.xs, minWidth: 18, height: 18, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tabUnderline: { position: 'absolute', bottom: 0, left: spacing.sm, right: spacing.sm, height: 2, borderRadius: 1 },
  /* Search */
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, minHeight: 48,
    borderRadius: radii.md, borderWidth: 1.5, gap: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  /* Table head */
  tableHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHeadText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  /* Flat data rows */
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  rowDate: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  /* C·02 evidence — pending rows only */
  rowSnippet: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontStyle: 'italic' },
  signalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 2 },
  signalText: { fontSize: 12, lineHeight: 16, fontWeight: '600', flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radii.pill,
  },
  metaChipText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  /* Pills */
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  /* Skeleton */
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  /* Load-more footer */
  footerWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5,
  },
  loadMoreText: { fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  footerEnd: { fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'center', paddingVertical: spacing.lg, fontVariant: ['tabular-nums'] },
  /* Detail modal */
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '92%', overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1 },
  modalTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  modalSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  closeBtn: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: spacing.md, borderBottomWidth: 1, gap: spacing.md },
  detailLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700', flex: 1 },
  detailValue: { fontSize: 15, lineHeight: 22, fontWeight: '500', flex: 2, textAlign: 'right', fontVariant: ['tabular-nums'] },
  rejectLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.xs },
  rejectInput: { borderWidth: 2, borderRadius: radii.md, padding: spacing.md, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  /* C·03 reject sheet */
  rejectWhoReads: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: spacing.md },
  templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  templateChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, paddingHorizontal: spacing.lg,
    borderRadius: radii.pill, borderWidth: 1.5,
  },
  templateChipText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  rejectCaption: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: spacing.xs },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5,
    marginTop: spacing.md,
  },
  secondaryBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  /* One-Hand Action Bar */
  actionBar: {
    flexDirection: 'row', gap: spacing.md,
    padding: spacing.lg, paddingBottom: spacing.xl,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 56, borderRadius: radii.md,
  },
  actionBtnText: { fontWeight: '700', fontSize: 15 },
  /* Confirm / feedback modals */
  centerOverlay: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  confirmCard: { borderRadius: radii.lg, borderWidth: 1, padding: spacing.xl, alignItems: 'center' },
  confirmIconWrap: { width: 56, height: 56, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  confirmTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm },
  confirmSub: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: spacing.xl },
  confirmBtnRow: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },
  confirmBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56, borderRadius: radii.md },
  confirmBtnText: { fontWeight: '700', fontSize: 15 },
});

export default ApprovalQueueScreen;
