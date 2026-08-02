// =====================================================
// ADMIN MANAGEMENT SCREEN ("Prakash" design)
// Comprehensive admin tools — flat headerBg band + Role
// Ribbon, flat data rows with hairline dividers, token-
// driven pills, 4-state data regions, One-Hand Action
// Bar on detail modals.
// Delete semantics for users: soft-delete only
// (is_active=false), surfaced as "Deactivate".
// =====================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import {
  ROLE_ACCENT, SkeletonBlock, ErrorCard, EmptyState, InfoBanner,
  getSeverityColor, getWaterQualityColor,
} from '../dashboards/DashboardShared';

// ==================== INTERFACES ====================
interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  phone: string;
  district: string;
  state: string;
  created_at: string;
  is_active: boolean;
}

interface DiseaseReport {
  id: string;
  disease_name: string;
  disease_type: string;
  severity: string;
  cases_count: number;
  location_name: string;
  district: string;
  state: string;
  symptoms: string;
  age_group: string;
  gender: string;
  treatment_status: string;
  reporter_id: string;
  status: string;
  verified_by: string;
  verified_at: string;
  created_at: string;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
}

interface WaterReport {
  id: string;
  source_name: string;
  source_type: string;
  location_name: string;
  district: string;
  state: string;
  overall_quality: string;
  contamination_type: string;
  reporter_id: string;
  status: string;
  verified_by: string;
  verified_at: string;
  notes: string;
  created_at: string;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
}

interface Campaign {
  id: string;
  name?: string;
  title?: string;
  campaign_name?: string;
  campaign_type: string;
  district: string;
  state: string;
  start_date: string;
  end_date: string;
  status: string;
  target_population: number;
  volunteers_needed: number;
  created_by: string;
  created_at: string;
  approval_status?: string;
  organizer_id?: string;
}

// ── Audit trail (INC-12) ──────────────────────────────
// Shapes mirror the RETURNS TABLE of the three reader RPCs verbatim.
// We call the RPCs, never audit_logs directly: the permission checks
// (is_admin() / self-only) live inside the functions.
interface ApprovalAuditRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  record_id: string | null;
  old_approval_status: string | null;
  new_approval_status: string | null;
  rejection_reason: string | null;
  created_at: string;
  /** added client-side — the RPC is called once per table */
  source_table: string;
}

interface DeletedAuditRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  table_name: string;
  record_id: string | null;
  deleted_record: Record<string, any> | null;
  created_at: string;
}

/** get_audit_trail(p_table_name, p_record_id) — one record's whole life */
interface RecordAuditRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action_type: string;
  changed_fields: string[] | null;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  created_at: string;
}

/** get_user_audit_log(p_user_id, p_days_back) — one person's actions */
interface UserAuditRow {
  id: string;
  action_type: string;
  table_name: string;
  record_id: string | null;
  changed_fields: string[] | null;
  created_at: string;
}

/**
 * Analytics totals. Held as a whole object or not at all: every number in it
 * is derived from the SAME four reads, so if one read failed the other nine
 * numbers are not a partial truth — they are a different question's answer
 * sitting under this question's labels.
 */
interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalDiseaseReports: number;
  pendingDiseaseReports: number;
  totalWaterReports: number;
  unsafeWaterSources: number;
  activeCampaigns: number;
  completedCampaigns: number;
}

interface AdminManagementScreenProps {
  profile: Profile;
  onBack: () => void;
}

type TabType = 'users' | 'disease' | 'water' | 'campaigns' | 'analytics' | 'audit';

type AuditView = 'approvals' | 'deletions';

/**
 * The approval-bearing tables the approvals view fans out over.
 *
 * Audit coverage as verified against pg_trigger on 3 Aug 2026
 *   select c.relname, pg_get_triggerdef(t.oid) from pg_trigger t
 *   join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
 *   where not t.tgisinternal and p.proname = 'audit_log_changes';
 * audit_log_changes() is attached to:
 *   disease_reports, water_quality_reports, health_campaigns, health_alerts
 *     — AFTER INSERT OR UPDATE OR DELETE, every column;
 *   profiles — AFTER INSERT, and AFTER UPDATE OF role, role_verified,
 *     is_active only. No DELETE trigger.
 * health_alerts gained its trigger after this screen was first written, so it
 * is IN the fan-out now: an alert reaching the public is the one approval this
 * project most needs a record of. profiles stays out of the approvals view —
 * it has no approval_status — and the banner names its partial coverage rather
 * than letting a short list read as an unblemished record.
 * COVERAGE CHANGES: re-run the query above and update the banner copy with it.
 */
const AUDITED_TABLES: string[] = [
  'disease_reports',
  'water_quality_reports',
  'health_campaigns',
  'health_alerts',
];

const AUDIT_WINDOWS: { days: number; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

const TABLE_LABEL: Record<string, string> = {
  disease_reports: 'Disease report',
  water_quality_reports: 'Water report',
  health_campaigns: 'Campaign',
  health_alerts: 'Health alert',
  profiles: 'User profile',
};

/** audit_logs.user_id is NULL when the write came from a trigger, the cron
 *  or the service role. Say that, never render a blank name. */
const ACTOR_UNKNOWN = 'Unattributed — system or service role';
const actorOf = (email: string | null | undefined) => email || ACTOR_UNKNOWN;

const shortId = (id: string | null | undefined) => (id ? `#${id.slice(0, 8)}` : 'unknown record');

const auditWhen = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 'Unknown time' : format(d, 'd MMM yyyy HH:mm');
};

/** Best-effort human name for a deleted row, without inventing one. */
const deletedRecordLabel = (row: DeletedAuditRow): string => {
  const r = row.deleted_record;
  const name =
    r?.disease_name || r?.source_name || r?.campaign_name || r?.title || r?.name || r?.full_name;
  return typeof name === 'string' && name.trim().length > 0
    ? name
    : `${TABLE_LABEL[row.table_name] ?? row.table_name} ${shortId(row.record_id)}`;
};

const approvalStatusLabel = (s: string | null | undefined) => {
  switch (s) {
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'pending_approval': return 'Pending approval';
    case null:
    case undefined: return 'Not set';
    default: return s;
  }
};

interface ConfirmAction {
  title: string;
  message: string;
  type: 'danger' | 'warning';
  /** Notice-style dialog: single OK button */
  notice?: boolean;
  onConfirm: () => Promise<void>;
}

const ROLE_ION_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  super_admin: 'shield-checkmark-outline',
  health_admin: 'medkit-outline',
  district_officer: 'business-outline',
  clinic: 'medical-outline',
  asha_worker: 'heart-outline',
  volunteer: 'hand-left-outline',
};

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

const ACTION_LABEL: Record<string, string> = {
  INSERT: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
};

/**
 * One line of an audit list: what happened, who did it, an optional detail,
 * and when. Declared at module scope on purpose — as a nested component it
 * was a NEW component type on every parent render, so React unmounted and
 * remounted the whole trail (and its skeleton animations) each time.
 */
const AuditEntry: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  fg: string;
  bg: string;
  title: string;
  who: string;
  detail?: string | null;
  when: string;
}> = ({ icon, fg, bg, title, who, detail, when }) => {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.auditRow, { backgroundColor: colors.surface, borderBottomColor: colors.borderLight }]}
      accessible
      accessibilityLabel={`${title}. ${who}.${detail ? ` ${detail}.` : ''} ${when}`}
    >
      <View style={[styles.auditIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={2}>{who}</Text>
        {detail ? (
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={3}>{detail}</Text>
        ) : null}
        <Text style={[styles.rowMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>{when}</Text>
      </View>
    </View>
  );
};

/** Small segmented control — selected = primaryContainer + teal ring.
 *  Ink on primaryContainer measures 16.61:1 light / 11.83:1 dark. */
const AuditSegment: React.FC<{
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  label: string;
}> = ({ options, value, onChange, label }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.auditSegRow} accessibilityLabel={label}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.auditSegBtn,
              active
                ? { backgroundColor: colors.primaryContainer, borderColor: colors.primary }
                : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => onChange(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}: ${opt.label}`}
          >
            {active && <Ionicons name="checkmark" size={14} color={colors.primary} />}
            <Text
              style={[styles.auditSegText, { color: colors.text }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const AdminManagementScreen: React.FC<AdminManagementScreenProps> = ({ profile, onBack }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? colors.primary;
  const isClinic = profile.role === 'clinic';
  // Mirrors the DB's is_admin(): super_admin | health_admin AND is_active.
  // get_audit_trail / get_user_audit_log / get_deleted_records RAISE for
  // anyone else, so the surface is hidden rather than shown-then-failing.
  const canAudit =
    (profile.role === 'super_admin' || profile.role === 'health_admin') && profile.is_active !== false;
  const [activeTab, setActiveTab] = useState<TabType>(isClinic ? 'disease' : 'users');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Data states
  const [users, setUsers] = useState<User[]>([]);
  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports] = useState<WaterReport[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  // Modal states
  const [showUserModal, setShowUserModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedReport, setSelectedReport] = useState<DiseaseReport | WaterReport | null>(null);
  const [reportType, setReportType] = useState<'disease' | 'water'>('disease');

  // Confirmation Modal states (for web compatibility)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const showNotice = (title: string, message: string, type: 'danger' | 'warning' = 'warning') => {
    setConfirmAction({ title, message, type, notice: true, onConfirm: async () => setShowConfirmModal(false) });
    setShowConfirmModal(true);
  };

  // Stats — `null` is NOT LOADED. It is never rendered as a zero: a zero here
  // is a statement about the district ("no unsafe water sources"), and a
  // failed read must not be allowed to make that statement.
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ── Audit trail state (INC-12) ──────────────────────
  // Three independent data regions, each with its own four states, because
  // each is a separate RPC that can fail on its own. `null` rows means
  // "not loaded / cleared after a failure" — it is never rendered as zero.
  const [auditView, setAuditView] = useState<AuditView>('approvals');
  const [auditDays, setAuditDays] = useState<number>(365);
  const [approvalRows, setApprovalRows] = useState<ApprovalAuditRow[] | null>(null);
  const [deletedRows, setDeletedRows] = useState<DeletedAuditRow[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  /**
   * Which (view, window) the rows — or the error — currently on screen were
   * actually fetched for. In an audit surface the window IS the claim, so no
   * copy is ever labelled from the segmented control: only from what came
   * back. If this does not match the current selection, the answer on screen
   * belongs to a different question and the skeleton is shown instead.
   */
  const [auditMeta, setAuditMeta] = useState<{ view: AuditView; days: number } | null>(null);
  /** Monotonic request token: on a flaky link the LAST response must not win,
   *  the LATEST REQUEST must. Anything older is dropped, not rendered. */
  const auditReqRef = useRef(0);

  const [trailRows, setTrailRows] = useState<RecordAuditRow[] | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);
  /** table:record_id the in-flight trail request belongs to. */
  const trailKeyRef = useRef('');

  const [userActivity, setUserActivity] = useState<UserAuditRow[] | null>(null);
  const [userActivityLoading, setUserActivityLoading] = useState(false);
  const [userActivityError, setUserActivityError] = useState<string | null>(null);
  /** user id the in-flight activity request belongs to. */
  const userActivityKeyRef = useRef('');

  useEffect(() => {
    // The audit tab reads only through the RPCs below. loadData() would fetch
    // four whole tables it never renders, on the low-bandwidth link this
    // project is built for.
    if (activeTab === 'audit') return;
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadStats(),
        activeTab === 'users' && loadUsers(),
        activeTab === 'disease' && loadDiseaseReports(),
        activeTab === 'water' && loadWaterReports(),
        activeTab === 'campaigns' && loadCampaigns(),
      ]);
      setLoadError(null);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoadError("Couldn't load — check connection");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Totals for the Analytics tab.
   *
   * This used to be allSettled + `r.status === 'fulfilled' ? r.value.data || []
   * : []` inside a try/catch that only logged — so a dropped connection painted
   * "Total Users 0" and "Unsafe 0" in confident 24px ink. That is the banned
   * shape: a failed read wearing the face of a clean district. Now every
   * settlement is inspected, ANY failure fails the whole region, and the
   * numbers are shown only when all four reads actually arrived.
   *
   * `count: 'exact'` was requested and never read; it is dropped rather than
   * making the server COUNT(*) four tables on every tab switch.
   */
  const loadStats = async () => {
    setStatsError(null);
    const settled = await Promise.allSettled([
      supabase.from('profiles').select('id, is_active'),
      supabase.from('disease_reports').select('id, status'),
      supabase.from('water_quality_reports').select('id, overall_quality'),
      supabase.from('health_campaigns').select('id, status'),
    ]);

    const fail = (message: string | undefined) => {
      setStats(null);
      setStatsError(message || "Couldn't load the totals — check connection.");
    };

    const rows: any[][] = [];
    for (const s of settled) {
      if (s.status === 'rejected') {
        console.error('Error loading stats:', s.reason);
        fail(s.reason?.message);
        return;
      }
      if (s.value.error) {
        console.error('Error loading stats:', s.value.error);
        fail(s.value.error.message);
        return;
      }
      // Only here — on a read that SUCCEEDED — may an absent array stand for
      // "no rows". PostgREST returns [] for an empty table; null cannot mean
      // failure at this point because the error branch above already returned.
      rows.push(s.value.data ?? []);
    }
    const [usersData, diseaseData, waterData, campaignsData] = rows;

    setStats({
      totalUsers: usersData.length,
      activeUsers: usersData.filter((u: any) => u.is_active !== false).length,
      totalDiseaseReports: diseaseData.length,
      pendingDiseaseReports: diseaseData.filter((r: any) => r.status === 'reported').length,
      totalWaterReports: waterData.length,
      unsafeWaterSources: waterData.filter((r: any) => r.overall_quality === 'unsafe' || r.overall_quality === 'critical').length,
      activeCampaigns: campaignsData.filter((c: any) => c.status === 'active' || c.status === 'upcoming').length,
      completedCampaigns: campaignsData.filter((c: any) => c.status === 'completed').length,
    });
  };

  const loadUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setUsers(data || []);
  };

  const loadDiseaseReports = async () => {
    const { data, error } = await supabase
      .from('disease_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setDiseaseReports(data || []);
  };

  const loadWaterReports = async () => {
    const { data, error } = await supabase
      .from('water_quality_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setWaterReports(data || []);
  };

  const loadCampaigns = async () => {
    const { data, error } = await supabase
      .from('health_campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setCampaigns(data || []);
  };

  // ==================== AUDIT TRAIL LOADERS (INC-12) ====================
  // Every one of these goes through an RPC, never `from('audit_logs')`:
  // the RPCs carry the permission checks and audit_logs itself is not a
  // surface we want the client picking columns from.
  //
  // The rule these obey, and the reason they are written this way: a call
  // that FAILED and a trail that is genuinely EMPTY must not produce the
  // same screen. So there is no `?? []` standing in for an error, no
  // `catch { return [] }`, and a partial failure of the fan-out below is
  // treated as a failure of the whole region — a short list presented as
  // complete would be worse than an error card.

  const asRows = <T,>(data: unknown, what: string): T[] => {
    if (!Array.isArray(data)) throw new Error(`${what} returned an unexpected shape.`);
    return data as T[];
  };

  const loadAudit = async () => {
    // Pin the question this request is asking. Everything below answers THIS
    // view and THIS window — never whatever the control happens to read when
    // the response lands.
    const token = ++auditReqRef.current;
    const view = auditView;
    const days = auditDays;
    const isCurrent = () => token === auditReqRef.current;

    setAuditLoading(true);
    setAuditError(null);
    try {
      if (view === 'approvals') {
        const results = await Promise.all(
          AUDITED_TABLES.map((table) =>
            supabase.rpc('get_approval_audit_log', { p_table_name: table, p_days_back: days })
          )
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;

        const merged = results.flatMap((r, i) =>
          asRows<Omit<ApprovalAuditRow, 'source_table'>>(r.data, 'get_approval_audit_log').map(
            (row) => ({ ...row, source_table: AUDITED_TABLES[i] })
          )
        );
        merged.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        if (!isCurrent()) return;
        setApprovalRows(merged);
      } else {
        const { data, error } = await supabase.rpc('get_deleted_records', {
          p_table_name: null,
          p_days_back: days,
        });
        if (error) throw error;
        const rows = asRows<DeletedAuditRow>(data, 'get_deleted_records');
        if (!isCurrent()) return;
        setDeletedRows(rows);
      }
      if (isCurrent()) setAuditMeta({ view, days });
    } catch (error: any) {
      // A superseded request must not paint an error over a newer answer.
      if (!isCurrent()) return;
      // Drop whatever was on screen — stale rows under an error card read as
      // "this is the trail", and half a trail is a lie in an audit context.
      setApprovalRows(null);
      setDeletedRows(null);
      setAuditError(error?.message || "Couldn't load the audit trail — check connection.");
      setAuditMeta({ view, days });
    } finally {
      if (isCurrent()) setAuditLoading(false);
    }
  };

  const loadRecordTrail = async (table: string, recordId: string) => {
    // A slow answer for the record you just closed must never land under the
    // record you just opened.
    const key = `${table}:${recordId}`;
    trailKeyRef.current = key;
    setTrailLoading(true);
    setTrailError(null);
    try {
      const { data, error } = await supabase.rpc('get_audit_trail', {
        p_table_name: table,
        p_record_id: recordId,
      });
      if (error) throw error;
      const rows = asRows<RecordAuditRow>(data, 'get_audit_trail');
      if (trailKeyRef.current !== key) return;
      setTrailRows(rows);
    } catch (error: any) {
      if (trailKeyRef.current !== key) return;
      setTrailRows(null);
      setTrailError(error?.message || "Couldn't load this record's history.");
    } finally {
      if (trailKeyRef.current === key) setTrailLoading(false);
    }
  };

  const loadUserActivity = async (userId: string) => {
    userActivityKeyRef.current = userId;
    setUserActivityLoading(true);
    setUserActivityError(null);
    try {
      const { data, error } = await supabase.rpc('get_user_audit_log', {
        p_user_id: userId,
        p_days_back: 365,
      });
      if (error) throw error;
      const rows = asRows<UserAuditRow>(data, 'get_user_audit_log');
      if (userActivityKeyRef.current !== userId) return;
      setUserActivity(rows);
    } catch (error: any) {
      if (userActivityKeyRef.current !== userId) return;
      setUserActivity(null);
      setUserActivityError(error?.message || "Couldn't load this user's activity.");
    } finally {
      if (userActivityKeyRef.current === userId) setUserActivityLoading(false);
    }
  };

  /**
   * Open handlers, not bare setState: the previous record's history has to be
   * cleared in the SAME event that selects the new one. The effects below run
   * after the commit that mounts the sheet, so without this one frame of
   * report A's RECORD HISTORY paints under report B's header.
   */
  const openReport = (item: DiseaseReport | WaterReport, type: 'disease' | 'water') => {
    setTrailRows(null);
    setTrailError(null);
    setSelectedReport(item);
    setReportType(type);
    setShowReportModal(true);
  };

  const openUser = (item: User) => {
    setUserActivity(null);
    setUserActivityError(null);
    setSelectedUser(item);
    setShowUserModal(true);
  };

  useEffect(() => {
    if (activeTab === 'audit' && canAudit) loadAudit();
  }, [activeTab, auditView, auditDays]);

  useEffect(() => {
    if (!showReportModal || !selectedReport || !canAudit) return;
    loadRecordTrail(
      reportType === 'disease' ? 'disease_reports' : 'water_quality_reports',
      selectedReport.id
    );
  }, [showReportModal, selectedReport?.id, reportType]);

  useEffect(() => {
    if (!showUserModal || !selectedUser || !canAudit) return;
    loadUserActivity(selectedUser.id);
  }, [showUserModal, selectedUser?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await (activeTab === 'audit' && canAudit ? loadAudit() : loadData());
    setRefreshing(false);
  };

  // ==================== USER MANAGEMENT FUNCTIONS ====================
  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    // Prevent users from changing their own role to avoid lockout.
    if (userId === profile.id && newRole !== profile.role) {
      showNotice('Not Allowed', 'You cannot change your own role. Ask another administrator to do this.');
      return;
    }

    setConfirmAction({
      title: 'Change Role',
      message: `Are you sure you want to change this user's role to ${newRole}?`,
      type: 'warning',
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({ role: newRole, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select();

          if (error) {
            console.error('Update role error:', error);
            throw error;
          }

          setShowConfirmModal(false);
          loadUsers();
          setShowUserModal(false);
        } catch (error: any) {
          console.error('Role update failed:', error);
          showNotice('Error', error.message || 'Failed to update role. Check RLS policies.', 'danger');
        }
      },
    });
    setShowConfirmModal(true);
  };

  // Single soft-delete path for users: is_active=false, always reversible.
  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    // Prevent admin from deactivating themselves
    if (userId === profile.id) {
      showNotice('Not Allowed', 'You cannot deactivate your own account.');
      return;
    }

    const newStatus = !currentStatus;
    setConfirmAction({
      title: newStatus ? 'Activate User' : 'Deactivate User',
      message: newStatus
        ? 'Activate this user? They will regain access to the system.'
        : 'Deactivate this user? The account will be marked inactive and can be reactivated later.',
      type: newStatus ? 'warning' : 'danger',
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({ is_active: newStatus, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select();

          if (error) {
            console.error('Toggle status error:', error);
            throw error;
          }

          setShowConfirmModal(false);
          loadUsers();
          setShowUserModal(false);
        } catch (error: any) {
          console.error('Status toggle failed:', error);
          showNotice('Error', error.message || 'Failed to update status. Check RLS policies.', 'danger');
        }
      },
    });
    setShowConfirmModal(true);
  };

  // ==================== REPORT MANAGEMENT FUNCTIONS ====================
  const handleVerifyReport = async (reportId: string, type: 'disease' | 'water') => {
    try {
      const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';
      const { error } = await supabase
        .from(table)
        .update({ status: 'verified', verified_by: profile.id, verified_at: new Date().toISOString() })
        .eq('id', reportId);

      if (error) throw error;
      type === 'disease' ? loadDiseaseReports() : loadWaterReports();
      setShowReportModal(false);
    } catch (error: any) {
      showNotice('Error', error.message || 'Failed to verify report.', 'danger');
    }
  };

  const handleDeleteReport = async (reportId: string, type: 'disease' | 'water') => {
    setConfirmAction({
      title: 'Delete Report',
      message: 'Are you sure you want to delete this report? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';
          const { error } = await supabase.from(table).delete().eq('id', reportId);

          if (error) throw error;
          setShowConfirmModal(false);
          type === 'disease' ? loadDiseaseReports() : loadWaterReports();
          setShowReportModal(false);
        } catch (error: any) {
          showNotice('Error', error.message || 'Failed to delete report.', 'danger');
        }
      },
    });
    setShowConfirmModal(true);
  };

  // ==================== APPROVAL FUNCTIONS ====================
  // Only disease/water reports are approved from this screen — campaigns and
  // alerts go through the Approval Queue screen.
  const handleApproveReport = async (reportId: string, type: 'disease' | 'water') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';

      const { error } = await supabase
        .from(table)
        .update({
          approval_status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) throw error;

      type === 'disease' ? loadDiseaseReports() : loadWaterReports();
      setShowReportModal(false);
      loadStats();
    } catch (error: any) {
      showNotice('Error', error.message || 'Failed to approve report.', 'danger');
    }
  };

  const handleRejectReport = async (reportId: string, type: 'disease' | 'water', reason?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';

      const { error } = await supabase
        .from(table)
        .update({
          approval_status: 'rejected',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          rejection_reason: reason || 'Rejected by admin',
        })
        .eq('id', reportId);

      if (error) throw error;

      type === 'disease' ? loadDiseaseReports() : loadWaterReports();
      setShowReportModal(false);
      loadStats();
    } catch (error: any) {
      showNotice('Error', error.message || 'Failed to reject report.', 'danger');
    }
  };

  const getApprovalStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'approved': return colors.success;
      case 'pending_approval': return colors.warning;
      case 'rejected': return colors.danger;
      default: return colors.textSecondary;
    }
  };

  const getApprovalStatusBg = (status: string | undefined) => {
    switch (status) {
      case 'approved': return colors.successBg;
      case 'pending_approval': return colors.warningBg;
      case 'rejected': return colors.dangerBg;
      default: return colors.surfaceVariant;
    }
  };

  const getApprovalStatusLabel = (status: string | undefined) => {
    switch (status) {
      case 'approved': return 'Approved';
      case 'pending_approval': return 'Pending Approval';
      case 'rejected': return 'Rejected';
      default: return 'Unknown';
    }
  };

  // ==================== CAMPAIGN MANAGEMENT FUNCTIONS ====================
  const handleUpdateCampaignStatus = async (campaignId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('health_campaigns')
        .update({ status: newStatus })
        .eq('id', campaignId);

      if (error) throw error;
      loadCampaigns();
    } catch (error: any) {
      showNotice('Error', error.message || 'Failed to update campaign status.', 'danger');
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    setConfirmAction({
      title: 'Delete Campaign',
      message: 'Are you sure you want to delete this campaign? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const { error } = await supabase.from('health_campaigns').delete().eq('id', campaignId);

          if (error) throw error;
          setShowConfirmModal(false);
          loadCampaigns();
        } catch (error: any) {
          showNotice('Error', error.message || 'Failed to delete campaign.', 'danger');
        }
      },
    });
    setShowConfirmModal(true);
  };

  // ==================== HELPER FUNCTIONS ====================
  const isVerified = (report: DiseaseReport | WaterReport): boolean => {
    return report.status === 'verified';
  };

  const roleColor = (role: string) => ROLE_ACCENT[role] ?? colors.textSecondary;
  const roleIcon = (role: string) => ROLE_ION_ICON[role] ?? 'person-outline';

  const severityColorOf = (severity: string) => getSeverityColor(severityKey(severity), colors);
  const severityBgOf = (severity: string) => {
    switch (severityKey(severity)) {
      case 'critical': return colors.dangerBg;
      case 'high':     return colors.offlineBg; // saffron family
      case 'medium':   return colors.warningBg;
      case 'low':      return colors.successBg;
      default:         return colors.surfaceVariant;
    }
  };

  const qualityColorOf = (quality: string) => getWaterQualityColor(quality, colors);
  const qualityBgOf = (quality: string) => {
    switch (quality?.toLowerCase()) {
      case 'safe':         return colors.successBg;
      case 'moderate':     return colors.warningBg;
      case 'poor':
      case 'unsafe':
      case 'contaminated':
      case 'critical':     return colors.dangerBg;
      default:             return colors.surfaceVariant;
    }
  };

  const campaignStatusColor = (status: string) => {
    switch (status) {
      case 'active': return colors.success;
      case 'upcoming': return colors.info;
      case 'completed': return colors.primary;
      case 'cancelled': return colors.danger;
      default: return colors.textSecondary;
    }
  };
  const campaignStatusBg = (status: string) => {
    switch (status) {
      case 'active': return colors.successBg;
      case 'upcoming': return colors.infoBg;
      case 'completed': return colors.primaryLight;
      case 'cancelled': return colors.dangerBg;
      default: return colors.surfaceVariant;
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.role?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDiseaseReports = diseaseReports.filter(
    (report) =>
      report.disease_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.location_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.district?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredWaterReports = waterReports.filter(
    (report) =>
      report.source_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.district?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCampaigns = campaigns.filter(
    (campaign) =>
      (campaign.campaign_name || campaign.title || campaign.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      campaign.district?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ==================== TAB CONFIG ====================
  // Filter tabs based on role - Clinic only sees reports, not users/analytics
  /**
   * Order matters more than it looks. Each tab is 32 dp of padding + a 20 dp
   * icon + an 8 dp gap + its label, i.e. ~96–125 dp; six of them are ~660 dp
   * against a 360 dp screen. Appended last, Audit sat ~570 dp in — past five
   * tabs, invisible on first paint, and the one tab nobody knew to look for.
   * It is second now, so on a 360 dp screen it is on screen before any
   * scrolling, and the tab clipped by the right edge is an ordinary one whose
   * partial visibility is itself the "there is more" cue.
   */
  const allTabs: { id: TabType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'users', label: 'Users', icon: 'people-outline' },
    { id: 'audit', label: 'Audit', icon: 'receipt-outline' },
    { id: 'disease', label: 'Disease', icon: 'medkit-outline' },
    { id: 'water', label: 'Water', icon: 'water-outline' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone-outline' },
    { id: 'analytics', label: 'Analytics', icon: 'stats-chart-outline' },
  ];

  const tabs = (isClinic
    ? allTabs.filter(tab => ['disease', 'water'].includes(tab.id))
    : allTabs
  ).filter(tab => tab.id !== 'audit' || canAudit);

  // ── Shared pill — dot + UPPERCASE label on *Bg token ──
  const Pill: React.FC<{ label: string; fg: string; bg: string }> = ({ label, fg, bg }) => (
    <View style={[styles.pill, { backgroundColor: bg }]} accessibilityLabel={label.toLowerCase()}>
      <View style={[styles.pillDot, { backgroundColor: fg }]} />
      <Text style={[styles.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>{label.toUpperCase()}</Text>
    </View>
  );

  // ==================== RENDER USER ROW ====================
  const renderUserItem = ({ item }: { item: User }) => (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.cardHover : colors.surface, borderBottomColor: colors.borderLight },
      ]}
      onPress={() => openUser(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.full_name || 'Unnamed user'}, role ${item.role}${item.is_active === false ? ', inactive' : ''}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: roleColor(item.role) + '14' }]}>
        <Ionicons name={roleIcon(item.role)} size={20} color={roleColor(item.role)} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.full_name || 'No Name'}
        </Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.email}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {item.district ? `${item.district}, ${item.state}` : 'No location'}
          {item.created_at ? ` · ${format(new Date(item.created_at), 'd MMM yyyy')}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <View style={[styles.pill, { backgroundColor: colors.surfaceVariant }]}>
          <View style={[styles.pillDot, { backgroundColor: roleColor(item.role) }]} />
          <Text style={[styles.pillText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            {item.role?.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
        {item.is_active === false && (
          <Pill label="Inactive" fg={colors.danger} bg={colors.dangerBg} />
        )}
      </View>
    </Pressable>
  );

  // ==================== RENDER DISEASE REPORT ROW ====================
  const renderDiseaseReportItem = ({ item }: { item: DiseaseReport }) => (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.cardHover : colors.surface, borderBottomColor: colors.borderLight },
      ]}
      onPress={() => openReport(item, 'disease')}
      accessibilityRole="button"
      accessibilityLabel={`Disease report ${item.disease_name || 'unknown'}, severity ${item.severity || 'unknown'}, ${isVerified(item) ? 'verified' : 'pending verification'}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: severityColorOf(item.severity) + '14' }]}>
        <Ionicons name="medkit-outline" size={20} color={severityColorOf(item.severity)} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.disease_name || 'Unknown Disease'}
        </Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          Cases: <Text style={{ fontVariant: ['tabular-nums'] }}>{item.cases_count}</Text> · {item.district}, {item.state}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {item.created_at ? format(new Date(item.created_at), 'd MMM yyyy HH:mm') : 'Unknown date'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Pill label={item.severity || 'unknown'} fg={severityColorOf(item.severity)} bg={severityBgOf(item.severity)} />
        <Pill
          label={isVerified(item) ? 'Verified' : 'Pending'}
          fg={isVerified(item) ? colors.success : colors.warning}
          bg={isVerified(item) ? colors.successBg : colors.warningBg}
        />
      </View>
    </Pressable>
  );

  // ==================== RENDER WATER REPORT ROW ====================
  const renderWaterReportItem = ({ item }: { item: WaterReport }) => (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.cardHover : colors.surface, borderBottomColor: colors.borderLight },
      ]}
      onPress={() => openReport(item, 'water')}
      accessibilityRole="button"
      accessibilityLabel={`Water report ${item.source_name || 'unknown source'}, quality ${item.overall_quality || 'unknown'}, ${isVerified(item) ? 'verified' : 'pending verification'}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: qualityColorOf(item.overall_quality) + '14' }]}>
        <Ionicons name="water-outline" size={20} color={qualityColorOf(item.overall_quality)} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.source_name || 'Unknown Source'}
        </Text>
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.source_type} · {item.district}, {item.state}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {item.created_at ? format(new Date(item.created_at), 'd MMM yyyy HH:mm') : 'Unknown date'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Pill label={item.overall_quality || 'unknown'} fg={qualityColorOf(item.overall_quality)} bg={qualityBgOf(item.overall_quality)} />
        <Pill
          label={isVerified(item) ? 'Verified' : 'Pending'}
          fg={isVerified(item) ? colors.success : colors.warning}
          bg={isVerified(item) ? colors.successBg : colors.warningBg}
        />
      </View>
    </Pressable>
  );

  // ==================== RENDER CAMPAIGN ROW ====================
  const renderCampaignItem = ({ item }: { item: Campaign }) => (
    <View style={[styles.campaignRow, { backgroundColor: colors.surface, borderBottomColor: colors.borderLight }]}>
      <View style={styles.campaignTop}>
        <View style={[styles.iconWrap, { backgroundColor: campaignStatusColor(item.status) + '14' }]}>
          <Ionicons name="megaphone-outline" size={20} color={campaignStatusColor(item.status)} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
            {item.campaign_name || item.title || item.name || 'Untitled Campaign'}
          </Text>
          <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.campaign_type} · {item.district}, {item.state}
          </Text>
          <Text style={[styles.rowMeta, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {item.start_date ? format(new Date(item.start_date), 'd MMM') : 'TBD'}
            {' – '}
            {item.end_date ? format(new Date(item.end_date), 'd MMM yyyy') : 'TBD'}
            {' · Target '}
            {/* An unset target is "not set", never a confident 0 — the row
                loaded fine; the number simply was never entered. */}
            {item.target_population != null ? (
              <Text style={{ fontVariant: ['tabular-nums'] }}>{item.target_population.toLocaleString()}</Text>
            ) : (
              'not set'
            )}
          </Text>
        </View>
        <Pill label={item.status || 'unknown'} fg={campaignStatusColor(item.status)} bg={campaignStatusBg(item.status)} />
      </View>
      <View style={styles.campaignActions}>
        {item.status !== 'completed' && item.status !== 'cancelled' && (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.campaignActionBtn,
                { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.success },
              ]}
              onPress={() => handleUpdateCampaignStatus(item.id, 'completed')}
              accessibilityRole="button"
              accessibilityLabel="Mark campaign completed"
            >
              <Ionicons name="checkmark-outline" size={16} color={colors.success} />
              <Text style={[styles.campaignActionText, { color: colors.success }]}>Complete</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.campaignActionBtn,
                { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.warning },
              ]}
              onPress={() => handleUpdateCampaignStatus(item.id, 'cancelled')}
              accessibilityRole="button"
              accessibilityLabel="Cancel campaign"
            >
              <Ionicons name="close-outline" size={16} color={colors.warning} />
              <Text style={[styles.campaignActionText, { color: colors.warning }]}>Cancel</Text>
            </Pressable>
          </>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.campaignActionBtn,
            { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.danger },
          ]}
          onPress={() => handleDeleteCampaign(item.id)}
          accessibilityRole="button"
          accessibilityLabel="Delete campaign"
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={[styles.campaignActionText, { color: colors.danger }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );

  // ==================== RENDER ANALYTICS ====================
  // Data numerals in ink, tabular-nums — never in category colors.
  // Four states, like every other data region here: skeleton / content /
  // quiet-zero / error-with-retry. A zero on this tab is a claim about the
  // district, so it may only ever come from a read that succeeded.
  const renderAnalytics = () => {
    if (statsError) {
      return (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <ErrorCard message={statsError} onRetry={loadStats} />
        </View>
      );
    }
    if (stats === null) {
      return (
        <View style={styles.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={128} radius={radii.md} />
          <SkeletonBlock height={128} radius={radii.md} />
          <SkeletonBlock height={128} radius={radii.md} />
        </View>
      );
    }
    const s = stats;
    if (
      s.totalUsers === 0 &&
      s.totalDiseaseReports === 0 &&
      s.totalWaterReports === 0 &&
      s.activeCampaigns + s.completedCampaigns === 0
    ) {
      return (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
          <EmptyState
            icon="document-outline"
            color={colors.textSecondary}
            title="Nothing has been recorded yet."
            subtitle="All four tables were read and all four are empty. This is what they hold — not a failure to read them."
          />
        </View>
      );
    }
    return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.analyticsContainer}>
        {[
          {
            icon: 'people-outline' as const,
            title: 'User Statistics',
            stats: [
              { value: s.totalUsers, label: 'Total Users' },
              { value: s.activeUsers, label: 'Active' },
              { value: s.totalUsers - s.activeUsers, label: 'Inactive' },
            ],
          },
          {
            icon: 'medkit-outline' as const,
            title: 'Disease Reports',
            stats: [
              { value: s.totalDiseaseReports, label: 'Total' },
              { value: s.pendingDiseaseReports, label: 'Pending' },
              { value: s.totalDiseaseReports - s.pendingDiseaseReports, label: 'Verified' },
            ],
          },
          {
            icon: 'water-outline' as const,
            title: 'Water Quality Reports',
            stats: [
              { value: s.totalWaterReports, label: 'Total' },
              { value: s.totalWaterReports - s.unsafeWaterSources, label: 'Safe' },
              { value: s.unsafeWaterSources, label: 'Unsafe' },
            ],
          },
          {
            icon: 'megaphone-outline' as const,
            title: 'Campaigns',
            stats: [
              { value: s.activeCampaigns + s.completedCampaigns, label: 'Total' },
              { value: s.activeCampaigns, label: 'Active' },
              { value: s.completedCampaigns, label: 'Completed' },
            ],
          },
        ].map((cardData, i) => (
          <View
            key={i}
            style={[
              styles.analyticsCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            <View style={styles.analyticsHeader}>
              <Ionicons name={cardData.icon} size={24} color={colors.textSecondary} />
              <Text style={[styles.analyticsTitle, { color: colors.text }]}>{cardData.title}</Text>
            </View>
            <View style={styles.analyticsStats}>
              {cardData.stats.map((stat, j) => (
                <View key={j} style={styles.analyticsStat} accessible accessibilityLabel={`${stat.label}: ${stat.value}`}>
                  <Text style={[styles.analyticsValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {stat.value}
                  </Text>
                  <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
    );
  };

  // ==================== RENDER AUDIT TRAIL (INC-12) ====================
  const actionVisual = (action: string): { icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string } => {
    switch (action) {
      case 'INSERT': return { icon: 'add-circle-outline', fg: colors.info, bg: colors.infoBg };
      case 'DELETE': return { icon: 'trash-outline', fg: colors.danger, bg: colors.dangerBg };
      case 'UPDATE': return { icon: 'create-outline', fg: colors.primary, bg: colors.primaryLight };
      default:       return { icon: 'ellipse-outline', fg: colors.textSecondary, bg: colors.surfaceVariant };
    }
  };

  const approvalVisual = (status: string | null): { icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string } => {
    switch (status) {
      case 'approved': return { icon: 'checkmark-circle-outline', fg: colors.success, bg: colors.successBg };
      case 'rejected': return { icon: 'close-circle-outline', fg: colors.danger, bg: colors.dangerBg };
      default:         return { icon: 'time-outline', fg: colors.warning, bg: colors.warningBg };
    }
  };

  const auditSkeleton = (n: number) => (
    <View style={styles.skeletonWrap} accessibilityElementsHidden>
      {Array.from({ length: n }).map((_, i) => (
        <SkeletonBlock key={i} height={76} radius={radii.sm} />
      ))}
    </View>
  );

  const renderAuditBody = () => {
    // Nothing on screen may outlive the question it answered. If the rows (or
    // the error) were fetched for another view or another window, they are not
    // an answer to what is being asked now.
    if (
      auditLoading ||
      auditMeta === null ||
      auditMeta.view !== auditView ||
      auditMeta.days !== auditDays
    ) {
      return auditSkeleton(4);
    }

    if (auditError) {
      return (
        <View style={styles.auditPad}>
          <ErrorCard message={auditError} onRetry={loadAudit} />
        </View>
      );
    }

    // Labelled from what came back, never from the control.
    const windowLabel =
      AUDIT_WINDOWS.find((w) => w.days === auditMeta.days)?.label ?? `${auditMeta.days} days`;

    if (auditView === 'approvals') {
      // null = not loaded yet. It is NOT an empty trail and must not read as one.
      if (approvalRows === null) return auditSkeleton(4);
      if (approvalRows.length === 0) {
        // Deliberately NOT a green tick. An empty approvals list is not good
        // news and it is not proof of a quiet month. Two ordinary causes leave
        // it empty while decisions were in fact made: an approval discarded by
        // resolve_conflict writes no audit row at all, and a record approved at
        // creation is never an approval TRANSITION (16 of the 28 approvals in
        // the live year are of that second kind). This screen exists to stop
        // silence reading as innocence, so the zero wears neutral ink and the
        // copy declines to claim what it cannot know.
        return (
          <View style={styles.auditPad}>
            <EmptyState
              icon="document-outline"
              color={colors.textSecondary}
              title={`No approval or rejection recorded in the last ${windowLabel}.`}
              subtitle="The trail loaded and returned nothing for this window. An empty list is not proof that nothing was decided — read it against what this trail does and does not record, above."
            />
          </View>
        );
      }
      return (
        <View>
          {approvalRows.map((row) => {
            const v = approvalVisual(row.new_approval_status);
            // rejection_reason is new_value->>'rejection_reason' — the state of
            // the COLUMN after this write, not the reason for THIS transition.
            // Approving never clears that column, so an approve-after-reject
            // still carries the old text and this line used to print
            // "Reason: …" underneath an Approved entry (2 of the 12 rows in
            // the live 1-year window do exactly that). A reason only ever
            // explains a rejection, so it is only ever shown on one.
            const reason =
              row.new_approval_status === 'rejected' && row.rejection_reason
                ? `Reason: ${row.rejection_reason}`
                : null;
            return (
              <AuditEntry
                key={row.id}
                icon={v.icon}
                fg={v.fg}
                bg={v.bg}
                title={`${TABLE_LABEL[row.source_table] ?? row.source_table} ${shortId(row.record_id)} — ${approvalStatusLabel(row.new_approval_status)}`}
                who={`${approvalStatusLabel(row.old_approval_status)} → ${approvalStatusLabel(row.new_approval_status)} · by ${actorOf(row.user_email)}`}
                detail={reason}
                when={auditWhen(row.created_at)}
              />
            );
          })}
        </View>
      );
    }

    if (deletedRows === null) return auditSkeleton(4);
    if (deletedRows.length === 0) {
      return (
        <View style={styles.auditPad}>
          {/* A deletion is the event; its absence is genuinely good news, so
              this zero keeps the success tick the approvals zero cannot. */}
          <EmptyState
            icon="checkmark-circle-outline"
            color={colors.success}
            title={`Nothing was deleted in the last ${windowLabel}.`}
            subtitle="The trail loaded and returned nothing for this window."
          />
        </View>
      );
    }
    return (
      <View>
        {deletedRows.map((row) => (
          <AuditEntry
            key={row.id}
            icon="trash-outline"
            fg={colors.danger}
            bg={colors.dangerBg}
            title={deletedRecordLabel(row)}
            who={`${TABLE_LABEL[row.table_name] ?? row.table_name} deleted by ${actorOf(row.user_email)}`}
            detail={shortId(row.record_id)}
            when={auditWhen(row.created_at)}
          />
        ))}
      </View>
    );
  };

  const renderAudit = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.listContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
      }
    >
      <View style={styles.auditControls}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>SHOW</Text>
        <AuditSegment
          label="Audit view"
          value={auditView}
          onChange={(k) => setAuditView(k as AuditView)}
          options={[
            { key: 'approvals', label: 'Approvals' },
            { key: 'deletions', label: 'Deletions' },
          ]}
        />
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: spacing.md }]}>PERIOD</Text>
        <AuditSegment
          label="Time window"
          value={String(auditDays)}
          onChange={(k) => setAuditDays(Number(k))}
          options={AUDIT_WINDOWS.map((w) => ({ key: String(w.days), label: w.label }))}
        />
      </View>

      {/* Coverage is stated, not implied. An audit screen that quietly omits a
          table teaches the reader that silence means innocence. Copy verified
          against pg_trigger on 3 Aug 2026 — see AUDITED_TABLES above for the
          query to re-run when coverage changes. */}
      <View style={styles.auditPad}>
        <InfoBanner
          icon="information-circle-outline"
          color={colors.warning}
          text="Covered: disease reports, water reports, campaigns and health alerts — every insert, update and delete. For profiles, only the creation of an account and changes to a role, verification or active status are recorded; no other profile edit, and no deleted profile, is recorded. The approvals list holds changes to an approval, so a record approved the moment it was created never appears in it."
        />
      </View>

      {renderAuditBody()}
    </ScrollView>
  );

  // ==================== RENDER TAB CONTENT ====================
  const renderTabContent = () => {
    // Audit owns its own four states — it must not share the screen-wide
    // `loading` / `loadError` that belong to the table tabs.
    if (activeTab === 'audit') {
      return canAudit ? (
        renderAudit()
      ) : (
        <View style={styles.auditPad}>
          <EmptyState
            icon="lock-closed-outline"
            color={colors.textSecondary}
            title="The audit trail is restricted."
            subtitle="Only a super administrator or health administrator can open it."
          />
        </View>
      );
    }

    if (loading) {
      return (
        <View style={styles.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
        </View>
      );
    }

    // Analytics is excluded because it owns its own error state (statsError)
    // and renders its own retry — not because a failure there is tolerable.
    if (loadError && activeTab !== 'analytics') {
      return (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <ErrorCard message={loadError} onRetry={loadData} />
        </View>
      );
    }

    const emptyState = (title: string) => (
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <EmptyState
          icon={searchQuery ? 'search-outline' : 'checkmark-circle-outline'}
          color={searchQuery ? colors.textSecondary : colors.success}
          title={searchQuery ? 'Nothing matches — try a different search.' : title}
        />
      </View>
    );

    switch (activeTab) {
      case 'users':
        return (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={renderUserItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={emptyState('No users registered yet.')}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
            }
          />
        );
      case 'disease':
        return (
          <FlatList
            data={filteredDiseaseReports}
            keyExtractor={(item) => item.id}
            renderItem={renderDiseaseReportItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={emptyState('No disease reports — district clear.')}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
            }
          />
        );
      case 'water':
        return (
          <FlatList
            data={filteredWaterReports}
            keyExtractor={(item) => item.id}
            renderItem={renderWaterReportItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={emptyState('No water quality reports yet.')}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
            }
          />
        );
      case 'campaigns':
        return (
          <FlatList
            data={filteredCampaigns}
            keyExtractor={(item) => item.id}
            renderItem={renderCampaignItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={emptyState('No campaigns yet.')}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />
            }
          />
        );
      case 'analytics':
        return renderAnalytics();
      default:
        return null;
    }
  };

  const roles = [
    { value: 'super_admin', label: 'Super Administrator' },
    { value: 'health_admin', label: 'Health Administrator' },
    { value: 'district_officer', label: 'District Officer' },
    { value: 'clinic', label: 'Clinic Staff' },
    { value: 'asha_worker', label: 'ASHA Worker' },
    { value: 'volunteer', label: 'Volunteer' },
  ];

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers read correctly in BOTH modes.
  // textInverse here would be white-on-paper — invisible — and is banned.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  const selectedUserActive = selectedUser?.is_active !== false;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg surface, separated by a 1px hairline in both modes */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: headerText }]}>{isClinic ? 'Report Approval' : 'Admin Management'}</Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]}>
            {isClinic ? 'Review & approve pending reports' : 'Manage users, reports & campaigns'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="refresh-outline" size={22} color={headerText} />
        </TouchableOpacity>
      </View>
      {/* Role Ribbon */}
      <View style={[styles.roleRibbon, { backgroundColor: accent }]} />

      {/* Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {/* The strip really does scroll, so it says so: the indicator is left
            on here (it is hidden on the content lists below, where the vertical
            scroll is obvious). */}
        <ScrollView horizontal contentContainerStyle={styles.tabsScroll}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.tab,
                  active && { borderBottomColor: colors.primary, borderBottomWidth: 3 },
                ]}
                onPress={() => setActiveTab(tab.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${tab.label} tab`}
              >
                <Ionicons
                  name={tab.icon}
                  size={20}
                  color={active ? colors.primary : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    { color: active ? colors.primary : colors.textSecondary },
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Search Bar — analytics and audit are not text-filtered */}
      {activeTab !== 'analytics' && activeTab !== 'audit' && (
        <View style={[styles.searchContainer, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
          <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={`Search ${activeTab}...`}
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content — skeleton / error / quiet-zero / content */}
      <View style={styles.content}>
        {renderTabContent()}
      </View>

      {/* ==================== USER DETAIL MODAL ==================== */}
      <Modal
        visible={showUserModal}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        onRequestClose={() => setShowUserModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>User Details</Text>
              <TouchableOpacity
                onPress={() => setShowUserModal(false)}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceVariant }]}
                accessibilityRole="button"
                accessibilityLabel="Close user details"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <>
                <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.lg }}>
                  {/* User Info — avatar ring in role accent */}
                  <View style={styles.modalUserHeader}>
                    <View style={[styles.modalAvatar, { borderColor: roleColor(selectedUser.role), backgroundColor: colors.surface }]}>
                      <Ionicons name={roleIcon(selectedUser.role)} size={32} color={roleColor(selectedUser.role)} />
                    </View>
                    <Text style={[styles.modalUserName, { color: colors.text }]}>{selectedUser.full_name || 'No Name'}</Text>
                    <Text style={[styles.modalUserEmail, { color: colors.textSecondary }]}>{selectedUser.email}</Text>
                    <View style={{ marginTop: spacing.sm }}>
                      <Pill
                        label={selectedUserActive ? 'Active' : 'Inactive'}
                        fg={selectedUserActive ? colors.success : colors.danger}
                        bg={selectedUserActive ? colors.successBg : colors.dangerBg}
                      />
                    </View>
                  </View>

                  {/* User Details */}
                  <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {[
                      { label: 'Phone', value: selectedUser.phone || 'Not set' },
                      { label: 'Location', value: selectedUser.district ? `${selectedUser.district}, ${selectedUser.state}` : 'Not set' },
                      { label: 'Joined', value: selectedUser.created_at ? format(new Date(selectedUser.created_at), 'd MMM yyyy') : 'Unknown' },
                    ].map((row, i, arr) => (
                      <View key={i} style={[styles.detailItem, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{row.label}</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Change Role */}
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>CHANGE ROLE</Text>
                  {selectedUser.id === profile.id && (
                    <View style={[styles.selfWarning, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
                      <Ionicons name="warning-outline" size={16} color={colors.warning} />
                      <Text style={[styles.selfWarningText, { color: colors.text }]}>
                        This is your account. Some actions are restricted.
                      </Text>
                    </View>
                  )}
                  {/* Selected = primaryContainer + teal ring + check glyph (the
                      §2.1 "selected chips" recipe). A role-accent flood-fill
                      would need textInverse on it, which only clears 4.5:1 in
                      light mode — ~3:1 in dark. Ink on the container is safe
                      in both. */}
                  <View style={styles.rolesGrid}>
                    {roles.map((role) => {
                      const active = selectedUser.role === role.value;
                      const disabled = active || (selectedUser.id === profile.id && role.value !== profile.role);
                      return (
                        <TouchableOpacity
                          key={role.value}
                          style={[
                            styles.roleOption,
                            active
                              ? { backgroundColor: colors.primaryContainer, borderColor: colors.primary }
                              : { backgroundColor: colors.card, borderColor: colors.border },
                            (selectedUser.id === profile.id && role.value !== profile.role) && { opacity: 0.4 },
                          ]}
                          onPress={() => handleUpdateUserRole(selectedUser.id, role.value)}
                          disabled={disabled}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active, disabled }}
                          accessibilityLabel={`Set role ${role.label}`}
                        >
                          {active && <Ionicons name="checkmark" size={14} color={colors.primary} />}
                          <Text
                            style={[styles.roleOptionText, { color: colors.text }]}
                            numberOfLines={1}
                            maxFontSizeMultiplier={1.3}
                          >
                            {role.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* ── Recent activity (INC-12, get_user_audit_log) ──
                      What this person DID. audit_logs.user_id is the actor
                      (auth.uid() at write time), so a role change made TO this
                      account appears in the administrator's list, not here.
                      The note below says that, and names what is still
                      unrecorded, rather than letting a short list imply an
                      unblemished record. */}
                  {canAudit && (
                    <>
                      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                        ACTIVITY BY THIS USER · LAST 365 DAYS
                      </Text>
                      {userActivityLoading ? (
                        <View style={styles.trailSkeleton} accessibilityElementsHidden>
                          <SkeletonBlock height={64} radius={radii.sm} />
                          <SkeletonBlock height={64} radius={radii.sm} />
                        </View>
                      ) : userActivityError ? (
                        <ErrorCard
                          message={userActivityError}
                          onRetry={() => loadUserActivity(selectedUser.id)}
                        />
                      ) : userActivity === null ? (
                        <View style={styles.trailSkeleton} accessibilityElementsHidden>
                          <SkeletonBlock height={64} radius={radii.sm} />
                        </View>
                      ) : userActivity.length === 0 ? (
                        <EmptyState
                          icon="document-outline"
                          color={colors.textSecondary}
                          title="No recorded activity in the last year."
                          subtitle="The log loaded and held nothing for this account."
                        />
                      ) : (
                        <View style={[styles.trailCard, { borderColor: colors.border }]}>
                          {userActivity.slice(0, 12).map((row) => {
                            const v = actionVisual(row.action_type);
                            return (
                              <AuditEntry
                                key={row.id}
                                icon={v.icon}
                                fg={v.fg}
                                bg={v.bg}
                                title={`${ACTION_LABEL[row.action_type] ?? row.action_type} · ${TABLE_LABEL[row.table_name] ?? row.table_name}`}
                                who={
                                  row.changed_fields && row.changed_fields.length > 0
                                    ? `Changed: ${row.changed_fields.join(', ')}`
                                    : shortId(row.record_id)
                                }
                                when={auditWhen(row.created_at)}
                              />
                            );
                          })}
                          {userActivity.length > 12 && (
                            <Text style={[styles.trailMore, { color: colors.textSecondary }]}>
                              Showing 12 of {userActivity.length} recorded actions.
                            </Text>
                          )}
                        </View>
                      )}
                      <Text style={[styles.trailNote, { color: colors.textSecondary }]}>
                        What this person did, not what was done to them. Covers disease reports,
                        water reports, campaigns, health alerts, the creation of an account, and
                        changes to a role, verification or active status. Ordinary profile edits
                        are not recorded.
                      </Text>
                    </>
                  )}

                  <View style={{ height: spacing.xl }} />
                </ScrollView>

                {/* One-Hand Action Bar — soft-delete only, labeled Deactivate */}
                {selectedUser.id !== profile.id && (
                  <View style={[styles.actionBar, { borderTopColor: colors.borderLight, backgroundColor: colors.card }]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtn,
                        selectedUserActive
                          ? {
                              backgroundColor: pressed ? colors.cardHover : colors.card,
                              borderWidth: 1.5,
                              borderColor: colors.danger,
                            }
                          : { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                      ]}
                      onPress={() => handleToggleUserStatus(selectedUser.id, selectedUserActive)}
                      accessibilityRole="button"
                      accessibilityLabel={selectedUserActive ? 'Deactivate user' : 'Activate user'}
                    >
                      <Ionicons
                        name={selectedUserActive ? 'person-remove-outline' : 'person-add-outline'}
                        size={18}
                        color={selectedUserActive ? colors.danger : colors.onPrimary}
                      />
                      <Text style={[styles.actionBtnText, { color: selectedUserActive ? colors.danger : colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                        {selectedUserActive ? 'Deactivate' : 'Activate'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== REPORT DETAIL MODAL ==================== */}
      <Modal
        visible={showReportModal}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {reportType === 'disease' ? 'Disease Report' : 'Water Quality Report'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowReportModal(false)}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceVariant }]}
                accessibilityRole="button"
                accessibilityLabel="Close report details"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedReport && (
              <>
                <ScrollView showsVerticalScrollIndicator={false} style={{ paddingHorizontal: spacing.lg }}>
                  {/* Status pills — approval + verification */}
                  <View style={styles.statusRow}>
                    <Pill
                      label={getApprovalStatusLabel(selectedReport.approval_status)}
                      fg={getApprovalStatusColor(selectedReport.approval_status)}
                      bg={getApprovalStatusBg(selectedReport.approval_status)}
                    />
                    <Pill
                      label={isVerified(selectedReport) ? 'Verified' : 'Unverified'}
                      fg={isVerified(selectedReport) ? colors.success : colors.warning}
                      bg={isVerified(selectedReport) ? colors.successBg : colors.warningBg}
                    />
                  </View>

                  <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    {(reportType === 'disease'
                      ? [
                          { label: 'Disease', value: (selectedReport as DiseaseReport).disease_name },
                          { label: 'Disease Type', value: (selectedReport as DiseaseReport).disease_type },
                          { label: 'Cases Count', value: String((selectedReport as DiseaseReport).cases_count) },
                          { label: 'Severity', value: (selectedReport as DiseaseReport).severity?.toUpperCase() },
                          { label: 'Age Group', value: (selectedReport as DiseaseReport).age_group || 'Not specified' },
                          { label: 'Symptoms', value: (selectedReport as DiseaseReport).symptoms || 'Not specified' },
                          { label: 'Treatment Status', value: (selectedReport as DiseaseReport).treatment_status?.replace('_', ' ') || 'Not set' },
                          { label: 'Location', value: `${(selectedReport as DiseaseReport).location_name}, ${(selectedReport as DiseaseReport).district}, ${(selectedReport as DiseaseReport).state}` },
                          { label: 'Reported On', value: selectedReport.created_at ? format(new Date(selectedReport.created_at), 'd MMM yyyy HH:mm') : 'Unknown' },
                        ]
                      : [
                          { label: 'Source Name', value: (selectedReport as WaterReport).source_name },
                          { label: 'Source Type', value: (selectedReport as WaterReport).source_type },
                          { label: 'Quality Status', value: (selectedReport as WaterReport).overall_quality?.toUpperCase() },
                          { label: 'Contamination', value: (selectedReport as WaterReport).contamination_type || 'Not specified' },
                          { label: 'Location', value: `${(selectedReport as WaterReport).location_name}, ${(selectedReport as WaterReport).district}, ${(selectedReport as WaterReport).state}` },
                          { label: 'Notes', value: (selectedReport as WaterReport).notes || 'No notes' },
                          { label: 'Reported On', value: selectedReport.created_at ? format(new Date(selectedReport.created_at), 'd MMM yyyy HH:mm') : 'Unknown' },
                        ]
                    ).map((row, i, arr) => (
                      <View key={i} style={[styles.detailItem, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{row.label}</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>

                  {/* ── Record history (INC-12, get_audit_trail) ──
                      Who touched this exact record, in order, oldest first —
                      the RPC returns ASC and we keep that reading order. */}
                  {canAudit && (
                    <>
                      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>RECORD HISTORY</Text>
                      {trailLoading ? (
                        <View style={styles.trailSkeleton} accessibilityElementsHidden>
                          <SkeletonBlock height={64} radius={radii.sm} />
                          <SkeletonBlock height={64} radius={radii.sm} />
                        </View>
                      ) : trailError ? (
                        <ErrorCard
                          message={trailError}
                          onRetry={() =>
                            loadRecordTrail(
                              reportType === 'disease' ? 'disease_reports' : 'water_quality_reports',
                              selectedReport.id
                            )
                          }
                        />
                      ) : trailRows === null ? (
                        <View style={styles.trailSkeleton} accessibilityElementsHidden>
                          <SkeletonBlock height={64} radius={radii.sm} />
                        </View>
                      ) : trailRows.length === 0 ? (
                        <EmptyState
                          icon="document-outline"
                          color={colors.textSecondary}
                          title="No history recorded for this report."
                          subtitle="The trail loaded and held nothing for this record."
                        />
                      ) : (
                        <View style={[styles.trailCard, { borderColor: colors.border }]}>
                          {trailRows.map((row) => {
                            const v = actionVisual(row.action_type);
                            return (
                              <AuditEntry
                                key={row.id}
                                icon={v.icon}
                                fg={v.fg}
                                bg={v.bg}
                                title={ACTION_LABEL[row.action_type] ?? row.action_type}
                                who={`By ${actorOf(row.user_email)}`}
                                detail={
                                  row.changed_fields && row.changed_fields.length > 0
                                    ? `Changed: ${row.changed_fields.join(', ')}`
                                    : null
                                }
                                when={auditWhen(row.created_at)}
                              />
                            );
                          })}
                        </View>
                      )}
                    </>
                  )}

                  {/* Secondary actions — verify / delete */}
                  {!isVerified(selectedReport) && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.inputBorder },
                      ]}
                      onPress={() => handleVerifyReport(selectedReport.id, reportType)}
                      accessibilityRole="button"
                      accessibilityLabel="Verify report"
                    >
                      <Ionicons name="checkmark-circle-outline" size={18} color={colors.text} />
                      <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Verify Report</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.danger },
                    ]}
                    onPress={() => handleDeleteReport(selectedReport.id, reportType)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete report permanently"
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    <Text style={[styles.secondaryBtnText, { color: colors.danger }]}>Delete Report</Text>
                  </Pressable>
                  <View style={{ height: spacing.xl }} />
                </ScrollView>

                {/* One-Hand Action Bar — approve / reject when pending */}
                {selectedReport.approval_status === 'pending_approval' && (
                  <View style={[styles.actionBarRow, { borderTopColor: colors.borderLight, backgroundColor: colors.card }]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtnHalf,
                        {
                          backgroundColor: pressed ? colors.cardHover : colors.card,
                          borderWidth: 1.5,
                          borderColor: colors.danger,
                        },
                      ]}
                      onPress={() => handleRejectReport(selectedReport.id, reportType)}
                      accessibilityRole="button"
                      accessibilityLabel="Reject report"
                    >
                      <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                      <Text style={[styles.actionBtnText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>Reject</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionBtnHalf,
                        { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                      ]}
                      onPress={() => handleApproveReport(selectedReport.id, reportType)}
                      accessibilityRole="button"
                      accessibilityLabel="Approve report"
                    >
                      <Ionicons name="checkmark-circle-outline" size={18} color={colors.onPrimary} />
                      <Text style={[styles.actionBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>Approve</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== CONFIRMATION MODAL (Web Compatible) ==================== */}
      <Modal
        visible={showConfirmModal}
        animationType={reduceMotion ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={[styles.confirmOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.confirmModalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.confirmIconContainer, {
              backgroundColor: confirmAction?.type === 'danger' ? colors.dangerBg : colors.warningBg,
            }]}>
              <Ionicons
                name={confirmAction?.type === 'danger' ? 'warning-outline' : 'alert-circle-outline'}
                size={32}
                color={confirmAction?.type === 'danger' ? colors.danger : colors.warning}
              />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.text }]}>
              {confirmAction?.title || 'Confirm'}
            </Text>
            <Text style={[styles.confirmMessage, { color: colors.textSecondary }]}>
              {confirmAction?.message || 'Are you sure?'}
            </Text>
            {confirmAction?.notice ? (
              <Pressable
                style={({ pressed }) => [
                  styles.confirmBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary, alignSelf: 'stretch' },
                ]}
                onPress={() => setShowConfirmModal(false)}
                accessibilityRole="button"
                accessibilityLabel="OK"
              >
                <Text style={[styles.confirmBtnText, { color: colors.onPrimary }]}>OK</Text>
              </Pressable>
            ) : (
              <View style={styles.confirmActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    {
                      backgroundColor: pressed ? colors.cardHover : colors.card,
                      borderWidth: 1.5,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  onPress={() => setShowConfirmModal(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.confirmBtnText, { color: colors.text }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    {
                      backgroundColor: confirmAction?.type === 'danger'
                        ? colors.danger
                        : pressed ? colors.primaryDark : colors.primary,
                    },
                    pressed && confirmAction?.type === 'danger' && { opacity: 0.4 },
                  ]}
                  onPress={confirmAction?.onConfirm}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm"
                >
                  <Text style={[styles.confirmBtnText, { color: confirmAction?.type === 'danger' ? colors.textInverse : colors.onPrimary }]}>
                    Confirm
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  /* Header — no status-bar inset: MainApp already wraps this route in a
     SafeAreaView, so the band only needs its own breathing room. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: {
    flex: 1,
    marginLeft: spacing.md,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  roleRibbon: { height: 4, width: '100%' },
  /* Tabs */
  tabsContainer: {
    borderBottomWidth: 1,
  },
  tabsScroll: {
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  tabLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  /* Search */
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
  content: {
    flex: 1,
  },
  listContainer: {
    paddingBottom: spacing.xxl,
  },
  /* Skeleton */
  skeletonWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    gap: spacing.md,
  },
  /* Flat data rows */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  rowMeta: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  /* Pills */
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  /* Campaign rows */
  campaignRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  campaignTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  campaignActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  campaignActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1.5,
  },
  campaignActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  /* Audit trail (INC-12) */
  auditControls: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  auditSegRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  auditSegBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  auditSegText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  auditPad: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  auditIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailSkeleton: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  trailCard: {
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  trailMore: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  trailNote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginBottom: spacing.lg,
  },
  /* Analytics — ink numerals, tabular */
  analyticsContainer: {
    padding: spacing.lg,
  },
  analyticsCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  analyticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  analyticsTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  analyticsStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  analyticsStat: {
    alignItems: 'center',
  },
  analyticsValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  analyticsLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  /* Modals */
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalUserHeader: {
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  modalAvatar: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalUserName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  modalUserEmail: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  detailsCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  detailLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    flex: 1,
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: spacing.md,
  },
  selfWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  selfWarningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  rolesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  roleOptionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1.5,
    marginTop: spacing.md,
  },
  secondaryBtnText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  /* One-Hand Action Bar */
  actionBar: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
  },
  actionBarRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: radii.md,
  },
  actionBtnHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: radii.md,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  /* Confirmation Modal */
  confirmOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  confirmModalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
  },
  confirmIconContainer: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  confirmTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  confirmBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default AdminManagementScreen;
