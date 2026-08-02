// =====================================================
// CAMPAIGNS SCREEN - Health Campaigns Management
// Approval-consistent visibility, token-driven status
// colors, 4-state data region.
//
// BRK-17 — attendance honesty. `health_campaigns` has no
// latitude/longitude column (verified against the live
// schema on 2 Aug 2026: id, organizer_id, campaign_name,
// campaign_type, description, target_audience,
// location_name, district, state, start_date, end_date,
// target_beneficiaries, contact_person, contact_phone,
// notes, status, created_at, updated_at,
// current_participants, max_participants, approval_status,
// approved_by, approved_at, client_idempotency_key).
// A camp DOES have a location — location_name, district and
// state are all populated, and this card prints them. What
// it has no record of is COORDINATES, so there is nothing to
// geofence against. This screen no longer pretends there is:
// marking attendance records a TIME, and the phone's own
// position when it can get one, and the copy says exactly
// that — "no coordinates", never "no location". See the note
// above handleCheckIn for why location is optional rather
// than required.
// =====================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Pressable,
  AccessibilityInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { SkeletonBlock, ErrorCard } from '../dashboards/DashboardShared';

interface CampaignsScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
}

const CAMPAIGN_TABS = ['active', 'upcoming', 'past'] as const;
type CampaignTab = (typeof CAMPAIGN_TABS)[number];

interface Campaign {
  id: string;
  campaign_name?: string;
  name?: string;
  title?: string;
  description: string;
  campaign_type: string;
  start_date: string;
  end_date: string;
  target_audience: string;
  location_name?: string;
  district?: string;
  state?: string;
  contact_person?: string;
  contact_phone?: string;
  target_beneficiaries?: number;
  status: string;
  approval_status?: string;
  organizer_id?: string;
  max_participants?: number;
  current_participants?: number;
  notes?: string;
  created_at: string;
  // NOTE: no latitude/longitude. `health_campaigns` carries none, so this
  // interface must not carry them either — an optional field the table never
  // returns is how the old geofence came to be permanently unreachable while
  // the compiler stayed silent. If site coordinates are ever added, add them
  // here AND to the check-in copy in the same change.
}

type CampaignEligibilityFields = Pick<Campaign, 'status' | 'approval_status' | 'start_date' | 'end_date'>;

/** What a recorded attendance looks like in this screen's state. */
interface CheckinRecord {
  /** ISO timestamp the attendance was recorded. '' when unknown. */
  at: string;
  /** True when a GPS position was captured alongside the time. */
  located: boolean;
  /**
   * True only when a `Checked in <iso>` audit line exists on the row — i.e.
   * the attendance was recorded through THIS screen, by the account that owns
   * the row. participants_update lets the organiser and every super_admin,
   * health_admin and district_officer set status='attended' on someone else's
   * row (verified in pg_policies, 2 Aug 2026), and those writes leave no audit
   * line. Without this flag the screen would tell a worker she recorded her own
   * attendance at the organiser's edit timestamp — a first-person claim the
   * data cannot support. `false` here means: attended per the register, source
   * unknown, no time and no location may be asserted.
   */
  selfRecorded: boolean;
}

type NoticeTone = 'info' | 'success' | 'warning';

interface CampaignNotice {
  tone: NoticeTone;
  message: string;
}

/** Location is best-effort; never let a stuck GPS lock the button forever. */
const LOCATION_TIMEOUT_MS = 12000;

/**
 * The one place the attendance audit line is written, and the one place it is
 * read back. Two shapes, both starting `Checked in <iso>`:
 *   Checked in 2026-08-02T09:12:00.000Z @ 12.840000,80.150000 ±14m
 *   Checked in 2026-08-02T09:12:00.000Z · location not recorded
 */
const buildCheckinLine = (iso: string, fix: GpsFix | null): string => {
  if (!fix) return `Checked in ${iso} · location not recorded`;
  const accuracy = fix.accuracy != null ? ` ±${Math.round(fix.accuracy)}m` : '';
  return `Checked in ${iso} @ ${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}${accuracy}`;
};

const CHECKIN_LINE_RE = /Checked in (\S+)(?: @ (-?[\d.]+),(-?[\d.]+))?/g;

const parseCheckinNotes = (notes: unknown): CheckinRecord => {
  // NOTE: no updated_at fallback. updated_at is "when this row was last
  // edited, by anyone" — presenting it as a check-in time is exactly the
  // borrowed-precision defect BRK-17 exists to remove. No line, no time.
  if (typeof notes !== 'string') return { at: '', located: false, selfRecorded: false };
  CHECKIN_LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = CHECKIN_LINE_RE.exec(notes)) !== null) last = match;
  if (!last) return { at: '', located: false, selfRecorded: false };
  return { at: last[1] || '', located: Boolean(last[2] && last[3]), selfRecorded: true };
};

interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number | null;
}

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });

/**
 * Best-effort position. Returns null when permission is refused, the fix times
 * out, or the platform errors — and that null is NOT swallowed: the caller
 * records the attendance anyway and the UI says "location was not available",
 * so the user is told exactly what ended up on the record.
 */
const tryGetLocation = async (): Promise<GpsFix | null> => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    // Fast path: a recent last-known fix, then an active one under a timeout.
    let position = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 200 });
    if (!position) {
      position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_TIMEOUT_MS,
      );
    }
    if (!position) return null;

    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      lat: latitude,
      lng: longitude,
      accuracy: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null,
    };
  } catch (error) {
    console.warn('[CampaignsScreen.tryGetLocation] No position available', { error });
    return null;
  }
};

const CampaignsScreen: React.FC<CampaignsScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<CampaignTab>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [enrollingCampaignId, setEnrollingCampaignId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [enrolledCampaigns, setEnrolledCampaigns] = useState<Set<string>>(new Set());
  // Enrolment is its own data region with its own four states. It used to have
  // one: a console.log and an early return, which made "the fetch failed" look
  // byte-for-byte like "you are not enrolled" — the Enrol button reappearing
  // for someone already enrolled, with no message and no retry.
  const [enrolmentLoading, setEnrolmentLoading] = useState(true);
  const [enrolmentError, setEnrolmentError] = useState<string | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);
  // Attendance: campaignId → what was actually recorded.
  const [checkins, setCheckins] = useState<Record<string, CheckinRecord>>({});
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);
  // Inline per-campaign notices (enrolment + attendance) — never Alert.alert,
  // which is banned for validation and for decisions.
  const [notices, setNotices] = useState<Record<string, CampaignNotice | null>>({});
  // Once the worker picks a tab we never move it again. Only the very first
  // load may land on a tab that actually has rows (see the effect below).
  const tabChosenByUser = useRef(false);
  const initialTabSettled = useRef(false);

  // Approval consistency: admins/officers see everything; other roles see
  // approved campaigns (or legacy rows without an approval status) plus
  // their own submissions in any status.
  const hasFullVisibility = ['super_admin', 'health_admin', 'district_officer'].includes(profile.role);

  useEffect(() => {
    loadCampaigns();
    loadUserEnrollments();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    setCampaignsError(null);
    try {
      let query = supabase
        .from('health_campaigns')
        .select('*')
        .order('start_date', { ascending: false });

      if (!hasFullVisibility) {
        query = query.or(
          `approval_status.eq.approved,approval_status.is.null,organizer_id.eq.${profile.id}`
        );
      }

      const { data, error } = await query;

      if (error) {
        setCampaignsError(t('campaigns.list.loadFailed', {
          defaultValue: "Couldn't load campaigns — check connection.",
        }));
        console.error('[CampaignsScreen.loadCampaigns] Query failed', { error });
        return;
      }

      setCampaigns(data || []);
    } catch (error) {
      setCampaignsError(t('campaigns.list.loadFailed', {
        defaultValue: "Couldn't load campaigns — check connection.",
      }));
      console.error('[CampaignsScreen.loadCampaigns] Unexpected error', { error });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Loads which campaigns this user is enrolled in, and what attendance is
   * already on record.
   *
   * A failure here is NEVER absorbed into the empty set. If it were, the card
   * would show "Enrol" to someone who is already enrolled, hide the enrolled
   * badge, and hide the attendance region — telling the worker something false
   * with no way to notice or retry. On failure the previous (possibly stale)
   * enrolment set is left untouched, `enrolmentError` is raised so every card
   * says "Enrolment status unknown" in place of a control that would assert
   * one, and a banner above the list carries the retry.
   */
  const loadUserEnrollments = async () => {
    setEnrolmentLoading(true);
    setEnrolmentError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const user = authData?.user;
      if (authError || !user) {
        console.error('[CampaignsScreen.loadUserEnrollments] No session', { authError });
        setEnrolmentError(t('campaigns.enrolment.signedOut', {
          defaultValue: "Couldn't confirm who is signed in, so your enrolments are not shown.",
        }));
        return;
      }

      const { data, error } = await supabase
        .from('campaign_participants')
        .select('campaign_id, status, notes')
        .eq('user_id', user.id)
        .neq('status', 'cancelled');

      if (error) {
        console.error('[CampaignsScreen.loadUserEnrollments] Query failed', { error });
        setEnrolmentError(t('campaigns.enrolment.loadFailed', {
          defaultValue: "Couldn't load your enrolments — check connection.",
        }));
        return;
      }

      const rows = data || [];
      const enrolledIds = new Set(rows.map(item => item.campaign_id));
      // Rebuild attendance state from the participant rows so it survives
      // remounts: an 'attended'/'completed' row means attendance is on the
      // register; only an audit line in `notes` means THIS user recorded it,
      // and only then may a time or a location be shown.
      const checkinMap: Record<string, CheckinRecord> = {};
      for (const row of rows) {
        if (row.status !== 'attended' && row.status !== 'completed') continue;
        checkinMap[row.campaign_id] = parseCheckinNotes(row.notes);
      }
      if (__DEV__) {
        console.info('[CampaignsScreen] Loaded enrolled campaigns', { count: enrolledIds.size });
      }
      setEnrolledCampaigns(enrolledIds);
      setCheckins(checkinMap);
    } catch (error) {
      console.error('[CampaignsScreen.loadUserEnrollments] Unexpected error', { error });
      setEnrolmentError(t('campaigns.enrolment.loadFailed', {
        defaultValue: "Couldn't load your enrolments — check connection.",
      }));
    } finally {
      setEnrolmentLoading(false);
    }
  };

  /**
   * The one retry. The visible ErrorCard used to re-run loadCampaigns only, so
   * a failed enrolment fetch could not be recovered by any control on screen.
   */
  const reloadAll = async () => {
    await Promise.all([loadCampaigns(), loadUserEnrollments()]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    // A pull-to-refresh may change the truth under a notice ("You're enrolled
    // in X"), so the notices go with it rather than outliving their facts.
    setNotices({});
    await reloadAll();
    setRefreshing(false);
  };

  const getCampaignTypeInfo = (type: string) => {
    const types: Record<string, { icon: string; color: string }> = {
      vaccination: { icon: 'medkit-outline', color: colors.info },
      awareness: { icon: 'megaphone-outline', color: colors.primary },
      screening: { icon: 'flask-outline', color: colors.accent },
      sanitation: { icon: 'hand-left-outline', color: colors.success },
      nutrition: { icon: 'nutrition-outline', color: colors.warning },
      default: { icon: 'clipboard-outline', color: colors.textSecondary },
    };
    return types[type] || types.default;
  };

  /** Campaign type as words, translated; an unknown type shows its raw value. */
  const getCampaignTypeLabel = (type: string) => {
    const key = (type || '').toLowerCase();
    const known: Record<string, string> = {
      vaccination: 'Vaccination',
      awareness: 'Awareness',
      screening: 'Screening',
      sanitation: 'Sanitation',
      nutrition: 'Nutrition',
    };
    if (!known[key]) return type || t('campaigns.typeUnknown', { defaultValue: 'Not specified' });
    return t(`campaigns.type.${key}`, { defaultValue: known[key] });
  };

  // Every status the table actually writes gets a colour with a meaning.
  // 'planned' is what all five live rows carry and it used to fall through to
  // the grey default, so a scheduled camp read as an archived one.
  const getStatusColor = (status: string) => {
    const statusColors: Record<string, string> = {
      active: colors.success,
      ongoing: colors.success,
      planned: colors.info,
      scheduled: colors.info,
      upcoming: colors.info,
      draft: colors.textSecondary,
      completed: colors.textSecondary,
      inactive: colors.textSecondary,
      closed: colors.textSecondary,
      archived: colors.textSecondary,
      cancelled: colors.danger,
    };
    return statusColors[(status || '').toLowerCase()] || colors.textSecondary;
  };

  const getStatusBg = (status: string) => {
    const statusBgs: Record<string, string> = {
      active: colors.successBg,
      ongoing: colors.successBg,
      planned: colors.infoBg,
      scheduled: colors.infoBg,
      upcoming: colors.infoBg,
      draft: colors.surfaceVariant,
      completed: colors.surfaceVariant,
      inactive: colors.surfaceVariant,
      closed: colors.surfaceVariant,
      archived: colors.surfaceVariant,
      cancelled: colors.dangerBg,
    };
    return statusBgs[(status || '').toLowerCase()] || colors.surfaceVariant;
  };

  /** Status labels are translated; an unknown status falls back to its raw value. */
  const getStatusLabel = (status: string) => {
    const key = (status || '').toLowerCase();
    if (!key) return t('campaigns.status.unknown', { defaultValue: 'UNKNOWN' });
    const known: Record<string, string> = {
      active: 'ACTIVE',
      ongoing: 'ONGOING',
      planned: 'PLANNED',
      scheduled: 'SCHEDULED',
      upcoming: 'UPCOMING',
      draft: 'DRAFT',
      completed: 'COMPLETED',
      inactive: 'INACTIVE',
      closed: 'CLOSED',
      archived: 'ARCHIVED',
      cancelled: 'CANCELLED',
    };
    if (!known[key]) return status.toUpperCase();
    return t(`campaigns.status.${key}`, { defaultValue: known[key] });
  };

  const StatusPill: React.FC<{ status: string }> = ({ status }) => (
    <View
      style={[styles.statusPill, { backgroundColor: getStatusBg(status) }]}
      accessibilityLabel={t('campaigns.statusLabel', {
        defaultValue: 'Status: {{status}}',
        status: getStatusLabel(status),
      })}
    >
      <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
      <Text style={[styles.statusPillText, { color: getStatusColor(status) }]} maxFontSizeMultiplier={1.3}>
        {getStatusLabel(status)}
      </Text>
    </View>
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const isCampaignEnrollable = (campaign: CampaignEligibilityFields) => {
    const now = new Date();
    const startDate = new Date(campaign.start_date);
    const endDate = new Date(campaign.end_date);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;

    const status = (campaign.status || '').toLowerCase();
    const closedStatuses = ['completed', 'cancelled', 'inactive', 'closed', 'archived'];
    const isClosed = closedStatuses.includes(status);
    const isApproved = !campaign.approval_status || campaign.approval_status === 'approved';
    return isApproved && !isClosed && endDate >= now;
  };

  const isCampaignActive = (campaign: Campaign) => {
    return isCampaignEnrollable(campaign);
  };

  // ── Attendance ──────────────────────────────────────────────────────────

  /** Attendance window: status 'ongoing', or today within start/end dates. */
  const isCheckinOpen = (campaign: Campaign) => {
    const status = (campaign.status || '').toLowerCase();
    if (['completed', 'cancelled', 'inactive', 'closed', 'archived'].includes(status)) return false;
    if (status === 'ongoing' || status === 'active') return true;
    const start = new Date(campaign.start_date);
    const end = new Date(campaign.end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
    end.setHours(23, 59, 59, 999); // end_date is a DATE — inclusive through end of day
    const now = new Date();
    return start <= now && now <= end;
  };

  const formatCheckinTime = (iso: string) => {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    });
  };

  const setNotice = (campaignId: string, tone: NoticeTone, message: string) => {
    setNotices(prev => ({ ...prev, [campaignId]: { tone, message } }));
    // accessibilityLiveRegion is Android-only. Without this, a VoiceOver user
    // on iOS loses the outcome of the press entirely — the alert this replaced
    // was at least impossible to miss.
    try {
      AccessibilityInfo.announceForAccessibility(message);
    } catch {
      /* best-effort — the drawn notice carries it regardless */
    }
  };

  const clearNotice = (campaignId: string) => {
    setNotices(prev => ({ ...prev, [campaignId]: null }));
  };

  /**
   * Record attendance for a campaign the user is enrolled in.
   *
   * What this actually writes, and nothing more: `campaign_participants.status`
   * becomes 'attended' and one audit line is appended to that row's `notes`
   * holding the time and, when the phone can supply one, the position it was
   * standing at. `health_campaigns` has no site coordinates, so there is
   * nothing to compare that position against — this is a self-reported
   * attendance record, not a verified one, and the copy below says so.
   *
   * Location is therefore OPTIONAL. Refusing to record attendance because GPS
   * is unavailable would withhold the only real part of the record (the time)
   * in exchange for nothing, and would leave a worker who once declined the
   * permission unable to mark attendance at all.
   */
  const handleCheckIn = async (campaign: Campaign) => {
    const campaignId = campaign.id;
    clearNotice(campaignId);
    setCheckinBusyId(campaignId);
    try {
      // Attendance needs the network — queueing it offline would only pretend
      // to count, so we say so instead of fake-queueing it.
      const net = await NetInfo.fetch();
      const isOnline = net.isConnected !== false && net.isInternetReachable !== false;
      if (!isOnline) {
        setNotice(campaignId, 'warning', t('campaigns.checkin.offline', {
          defaultValue: "Marking attendance needs a connection — try again when you're back online.",
        }));
        return;
      }

      const fix = await tryGetLocation();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setNotice(campaignId, 'warning', t('campaigns.checkin.signedOut', {
          defaultValue: 'You must be signed in to mark attendance.',
        }));
        return;
      }

      const { data: participantRow, error: rowError } = await supabase
        .from('campaign_participants')
        .select('id, notes')
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .maybeSingle();

      // A failed lookup and "you are not enrolled" are different answers and
      // must never share a message.
      if (rowError) {
        console.error('[CampaignsScreen.handleCheckIn] Enrolment lookup failed', { rowError });
        setNotice(campaignId, 'warning', t('campaigns.checkin.lookupFailed', {
          defaultValue: "Couldn't check your enrolment — check connection and try again.",
        }));
        return;
      }
      if (!participantRow) {
        setNotice(campaignId, 'info', t('campaigns.checkin.notEnrolled', {
          defaultValue: 'You are not enrolled in this campaign — enrol first, then mark attendance.',
        }));
        return;
      }

      const nowIso = new Date().toISOString();
      const checkinLine = buildCheckinLine(nowIso, fix);
      const nextNotes = participantRow.notes ? `${participantRow.notes}\n${checkinLine}` : checkinLine;

      // Own-row update permitted by campaign_participants RLS (participants_update).
      //
      // The filter repeats `.neq('status','cancelled')` from the lookup above.
      // Without it, a withdrawal landing between the two — a second device, or
      // this card and the detail modal both mounted — would flip the row
      // cancelled → attended, and handle_enrollment_status_change only
      // re-increments on cancelled → 'enrolled' (verified in the live function
      // body), so health_campaigns.current_participants would stay decremented
      // with an attended row against it. Matching zero rows is the correct
      // outcome there, and .select() is what makes it visible: without it
      // supabase-js returns {data:null, error:null} for both "updated" and
      // "matched nothing", and this screen would print "Attendance recorded"
      // over a write that never happened.
      const { data: updatedRows, error: updateError } = await supabase
        .from('campaign_participants')
        .update({ status: 'attended', notes: nextNotes, updated_at: nowIso })
        .eq('id', participantRow.id)
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .select('id');

      if (updateError) {
        console.error('[CampaignsScreen.handleCheckIn] Update failed', { updateError });
        setNotice(campaignId, 'warning', t('campaigns.checkin.saveFailed', {
          defaultValue: "Couldn't record attendance — check connection and try again.",
        }));
        return;
      }

      if (!updatedRows || updatedRows.length === 0) {
        console.error('[CampaignsScreen.handleCheckIn] Update matched no rows', { campaignId });
        setNotice(campaignId, 'warning', t('campaigns.checkin.notSaved', {
          defaultValue: 'Nothing was saved — your enrolment changed while you were marking attendance. Pull down to refresh, then try again.',
        }));
        await loadUserEnrollments();
        return;
      }

      setCheckins(prev => ({
        ...prev,
        [campaignId]: { at: nowIso, located: fix !== null, selfRecorded: true },
      }));
    } catch (error: any) {
      console.error('[CampaignsScreen.handleCheckIn] Error', { error });
      setNotice(campaignId, 'warning', t('campaigns.checkin.saveFailed', {
        defaultValue: "Couldn't record attendance — check connection and try again.",
      }));
    } finally {
      setCheckinBusyId(null);
    }
  };

  /**
   * Attendance region for a campaign the user is enrolled in — four states:
   *   skeleton      → the enrolment fetch is still in flight
   *   error+retry   → the enrolment fetch failed; enrolment/attendance UNKNOWN,
   *                   which is stated in those words and is never allowed to
   *                   look like "not enrolled"
   *   content       → attendance on record, or the window is open and the
   *                   button plus its disclosure are shown
   *   quiet zero    → known not enrolled, or window closed: nothing
   */
  const renderCheckinBlock = (campaign: Campaign) => {
    if (enrolmentError) {
      // Only where the card would otherwise make an enrolment claim. A role
      // that cannot enrol, with no enrolment on the last good read, is told
      // nothing about enrolment by this card — so silence here is not a hidden
      // failure, and the banner above the list carries the failure regardless.
      // (The live region lives on that banner; five announcing strips would
      // bury the message they are trying to deliver.)
      if (!canEnroll && !enrolledCampaigns.has(campaign.id)) return null;
      return (
        <View style={[styles.checkinUnknownRow, { backgroundColor: colors.warningBg }]}>
          <Ionicons name="help-circle-outline" size={16} color={colors.warning} />
          <View style={styles.checkinDoneTextWrap}>
            <Text style={[styles.checkinDoneText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
              {t('campaigns.enrolment.unknownTitle', { defaultValue: 'Enrolment status unknown' })}
            </Text>
            <Text style={[styles.checkinDoneDetail, { color: colors.warning }]} maxFontSizeMultiplier={1.5}>
              {t('campaigns.enrolment.unknownDetail', {
                defaultValue: 'This is not the same as not being enrolled — the list of your enrolments could not be loaded.',
              })}
            </Text>
          </View>
        </View>
      );
    }

    if (enrolmentLoading) {
      if (!canEnroll && !enrolledCampaigns.has(campaign.id)) return null;
      return (
        <View style={styles.checkinBlock} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <SkeletonBlock height={40} radius={radii.sm} />
        </View>
      );
    }

    if (!enrolledCampaigns.has(campaign.id)) return null;

    const record = checkins[campaign.id];
    if (record) {
      // Two different facts, two different sentences. A row that carries an
      // audit line was recorded by this account through this screen, so a
      // first-person claim with a time is supportable. A row that merely says
      // 'attended' was set by someone with write access — the organiser, or
      // any admin or district officer — and nothing about who, when or where
      // may be asserted about it.
      if (!record.selfRecorded) {
        const headline = t('campaigns.checkin.markedAttended', { defaultValue: 'Marked as attended' });
        const detail = t('campaigns.checkin.markedByRegister', {
          defaultValue: 'Recorded on the camp register, not from this phone. No check-in time or location was saved with it.',
        });
        return (
          <View
            style={[styles.checkinDoneRow, { backgroundColor: colors.infoBg }]}
            accessibilityLabel={`${headline}. ${detail}`}
          >
            <Ionicons name="clipboard-outline" size={16} color={colors.info} />
            <View style={styles.checkinDoneTextWrap}>
              <Text style={[styles.checkinDoneText, { color: colors.info }]} maxFontSizeMultiplier={1.3}>
                {headline}
              </Text>
              <Text style={[styles.checkinDoneDetail, { color: colors.info }]} maxFontSizeMultiplier={1.5}>
                {detail}
              </Text>
            </View>
          </View>
        );
      }

      const timeLabel = formatCheckinTime(record.at);
      const headline = timeLabel
        ? t('campaigns.checkin.recordedAt', {
            defaultValue: 'You marked your attendance · {{time}}',
            time: timeLabel,
          })
        : t('campaigns.checkin.recorded', { defaultValue: 'You marked your attendance' });
      const detail = record.located
        ? t('campaigns.checkin.savedWithLocation', { defaultValue: 'Time and location saved.' })
        : t('campaigns.checkin.savedTimeOnly', { defaultValue: 'Time saved — location was not available.' });
      return (
        <View
          style={[styles.checkinDoneRow, { backgroundColor: colors.successBg }]}
          accessibilityLabel={`${headline}. ${detail}`}
        >
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <View style={styles.checkinDoneTextWrap}>
            <Text style={[styles.checkinDoneText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
              {headline}
            </Text>
            <Text style={[styles.checkinDoneDetail, { color: colors.success }]} maxFontSizeMultiplier={1.5}>
              {detail}
            </Text>
          </View>
        </View>
      );
    }

    if (!isCheckinOpen(campaign)) return null;

    const busy = checkinBusyId === campaign.id;
    return (
      <View style={styles.checkinBlock}>
        <Pressable
          style={({ pressed }) => [
            styles.checkinButton,
            { backgroundColor: pressed ? colors.primaryDark : colors.primary },
            busy && { opacity: 0.6 },
          ]}
          onPress={() => handleCheckIn(campaign)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('campaigns.checkin.markFor', {
            defaultValue: 'Mark my attendance at {{campaign}}',
            campaign: getCampaignTitle(campaign),
          })}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <>
              <Ionicons name="checkmark-done-outline" size={18} color={colors.onPrimary} />
              <Text style={[styles.checkinButtonText, { color: colors.onPrimary }]}>
                {t('campaigns.checkin.mark', { defaultValue: 'Mark my attendance' })}
              </Text>
            </>
          )}
        </Pressable>
        {/* The disclosure. This is the whole of BRK-17: say what the button
            records, and do not imply a site check the data cannot support.
            It says COORDINATES, not "location" — this same card prints the
            camp's location_name three rows up, and a sentence contradicted by
            the card it sits on is the defect, not the fix. */}
        <Text
          style={[styles.checkinCaption, { color: colors.textSecondary }]}
          maxFontSizeMultiplier={1.5}
        >
          {t('campaigns.checkin.records', {
            defaultValue:
              "Saves the time, and your phone's position if it is available. No map coordinates are stored for this camp, so your position cannot be compared with the camp site.",
          })}
        </Text>
        {/* Audience. participants_select grants read to the row owner, the
            campaign organiser, and — as a bare role check with no district
            scoping — every super_admin, health_admin and district_officer in
            the service. participants_update grants the same set write access
            to this notes column. "District officials" understated both. */}
        <Text
          style={[styles.checkinCaptionMeta, { color: colors.textTertiary }]}
          maxFontSizeMultiplier={1.5}
        >
          {t('campaigns.checkin.whoSees', {
            defaultValue:
              'The camp organiser can see this, and so can district officers and health administrators anywhere in the service — not only in your district. They can also change it.',
          })}
        </Text>
      </View>
    );
  };

  /** Shared inline notice — enrolment and attendance both speak through this. */
  const renderNotice = (campaignId: string) => {
    const notice = notices[campaignId];
    if (!notice) return null;
    const toneColor =
      notice.tone === 'success' ? colors.success : notice.tone === 'info' ? colors.info : colors.warning;
    const toneBg =
      notice.tone === 'success' ? colors.successBg : notice.tone === 'info' ? colors.infoBg : colors.warningBg;
    const icon =
      notice.tone === 'success'
        ? 'checkmark-circle-outline'
        : notice.tone === 'info'
        ? 'information-circle-outline'
        : 'alert-circle-outline';
    return (
      <View style={[styles.noticeRow, { backgroundColor: toneBg }]} accessibilityLiveRegion="polite">
        <Ionicons name={icon as any} size={16} color={toneColor} />
        <Text style={[styles.noticeText, { color: toneColor }]} maxFontSizeMultiplier={1.5}>
          {notice.message}
        </Text>
        {/* A notice states an outcome at a moment. It must be dismissable, or
            it outlives the fact it reports. Refresh and tab changes clear the
            whole set; this clears one. */}
        <Pressable
          onPress={() => clearNotice(campaignId)}
          style={({ pressed }) => [styles.noticeDismiss, pressed && { opacity: 0.6 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('campaigns.notice.dismiss', { defaultValue: 'Dismiss this message' })}
        >
          <Ionicons name="close" size={16} color={toneColor} />
        </Pressable>
      </View>
    );
  };

  /**
   * Enrolment is a screen-wide data region, so its failure gets one banner
   * rather than one per card, and the banner is where the retry lives. The
   * per-card consequence (no enrol control, "status unknown") is drawn by
   * renderCheckinBlock; this is the explanation and the way out.
   */
  const renderEnrolmentBanner = () => {
    if (!enrolmentError) return null;
    return (
      <View
        style={[styles.enrolmentBanner, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.enrolmentBannerRow}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
          <Text style={[styles.enrolmentBannerText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>
            {enrolmentError}
          </Text>
        </View>
        <Pressable
          onPress={loadUserEnrollments}
          accessibilityRole="button"
          accessibilityLabel={t('campaigns.enrolment.retry', { defaultValue: 'Retry loading your enrolments' })}
          style={({ pressed }) => [
            styles.enrolmentBannerRetry,
            { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.warning },
          ]}
        >
          <Text style={[styles.enrolmentBannerRetryText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
            {t('campaigns.enrolment.retryLabel', { defaultValue: 'Retry' })}
          </Text>
        </Pressable>
      </View>
    );
  };

  /**
   * Which tab a campaign belongs to. One definition, used by the filter and by
   * the first-load tab choice, so the two can never disagree.
   *
   * end_date is a DATE column: comparing it raw puts a camp finishing TODAY in
   * the past tab at 00:00. Inclusive to end of day, matching isCheckinOpen.
   * A row with unparseable dates belongs to no tab (unchanged behaviour).
   */
  const campaignBucket = (campaign: Campaign, now: Date): CampaignTab | null => {
    const start = new Date(campaign.start_date);
    const end = new Date(campaign.end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    if (now < start) return 'upcoming';
    if (now > end) return 'past';
    return 'active';
  };

  const filterCampaigns = () => {
    const now = new Date();
    return campaigns.filter((campaign) => campaignBucket(campaign, now) === activeTab);
  };

  /**
   * First successful load only: if the tab the screen opens on has no rows and
   * another one does, open on a tab that has rows.
   *
   * Every campaign in the live table finished months ago, so 'active' opens
   * empty and the screen reads as broken before a worker has seen a single
   * card. This does not invent or reclassify anything — it just declines to
   * open on a guaranteed-empty view. It runs once, and never overrides a tab
   * the worker chose.
   */
  useEffect(() => {
    if (initialTabSettled.current || tabChosenByUser.current) return;
    if (loading || campaignsError) return;
    initialTabSettled.current = true;
    if (campaigns.length === 0) return;

    const now = new Date();
    const counts: Record<CampaignTab, number> = { active: 0, upcoming: 0, past: 0 };
    for (const campaign of campaigns) {
      const bucket = campaignBucket(campaign, now);
      if (bucket) counts[bucket] += 1;
    }
    if (counts[activeTab] > 0) return;
    const fallback = CAMPAIGN_TABS.find((tab) => counts[tab] > 0);
    if (fallback) setActiveTab(fallback);
  }, [loading, campaignsError, campaigns]);

  // Enrolment writes campaign_participants (RLS participants_insert_own:
  // user_id = auth.uid()); the unique (campaign_id, user_id) constraint is the
  // real guard against a double enrolment, so 23505 is an expected answer, not
  // a crash. Re-enrolling a cancelled row is what re-increments
  // health_campaigns.current_participants, via handle_enrollment_status_change.
  const handleEnroll = async (campaignId: string, campaignName: string) => {
    setEnrollingCampaignId(campaignId);
    clearNotice(campaignId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setNotice(campaignId, 'warning', t('campaigns.enrol.signedOut', {
          defaultValue: 'You must be signed in to enrol.',
        }));
        return;
      }

      // maybeSingle, not single: "no such row" must arrive as data === null and
      // not as a PGRST116 error, because a failed query and a campaign that is
      // gone are different answers. Telling someone to "refresh and try again"
      // about a campaign that was deleted — or that campaigns_select no longer
      // shows them — is a refresh they can repeat forever.
      const { data: campaignRecord, error: campaignFetchError } = await supabase
        .from('health_campaigns')
        .select('id, status, approval_status, start_date, end_date')
        .eq('id', campaignId)
        .maybeSingle();

      if (campaignFetchError) {
        console.error('[CampaignsScreen.handleEnroll] Campaign re-check failed', { campaignFetchError });
        setNotice(campaignId, 'warning', t('campaigns.enrol.checkFailed', {
          defaultValue: "Couldn't check this campaign — check connection and try again.",
        }));
        return;
      }

      if (!campaignRecord) {
        console.warn('[CampaignsScreen.handleEnroll] Campaign no longer visible', { campaignId });
        setNotice(campaignId, 'info', t('campaigns.enrol.gone', {
          defaultValue: 'This campaign is no longer listed for you — it may have been removed. Pull down to refresh the list.',
        }));
        return;
      }

      const isEnrollable = isCampaignEnrollable(campaignRecord as CampaignEligibilityFields);

      if (!isEnrollable) {
        setNotice(campaignId, 'info', t('campaigns.enrol.closed', {
          defaultValue: 'Enrolment is open only for approved campaigns that have not finished.',
        }));
        return;
      }

      // Check if already enrolled
      const { data: existingEnrollment, error: checkError } = await supabase
        .from('campaign_participants')
        .select('id, status')
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('[CampaignsScreen.handleEnroll] Enrolment check failed', { checkError });
        setNotice(campaignId, 'warning', t('campaigns.enrol.statusFailed', {
          defaultValue: "Couldn't check your enrolment — check connection and try again.",
        }));
        return;
      }

      if (existingEnrollment) {
        if (existingEnrollment.status === 'cancelled') {
          // Re-enroll if previously cancelled
          const { error: updateError } = await supabase
            .from('campaign_participants')
            .update({ status: 'enrolled', updated_at: new Date().toISOString() })
            .eq('id', existingEnrollment.id);

          if (updateError) throw updateError;

          setNotice(campaignId, 'success', t('campaigns.enrol.reenrolled', {
            defaultValue: "You're enrolled again in \"{{campaign}}\".",
            campaign: campaignName,
          }));
        } else {
          setNotice(campaignId, 'info', t('campaigns.enrol.already', {
            defaultValue: "You're already enrolled in \"{{campaign}}\".",
            campaign: campaignName,
          }));
        }
        await Promise.all([loadCampaigns(), loadUserEnrollments()]);
        return;
      }

      // Create new enrollment
      const { error: insertError } = await supabase
        .from('campaign_participants')
        .insert({
          campaign_id: campaignId,
          user_id: user.id,
          status: 'enrolled',
        });

      if (insertError) {
        // Unique (campaign_id, user_id) — someone else's tab, or a double tap.
        if (insertError.code === '23505') {
          setNotice(campaignId, 'info', t('campaigns.enrol.already', {
            defaultValue: "You're already enrolled in \"{{campaign}}\".",
            campaign: campaignName,
          }));
        } else {
          throw insertError;
        }
      } else {
        setNotice(campaignId, 'success', t('campaigns.enrol.done', {
          defaultValue: "You're enrolled in \"{{campaign}}\".",
          campaign: campaignName,
        }));
      }

      // Refresh campaigns and enrollments
      await Promise.all([loadCampaigns(), loadUserEnrollments()]);
    } catch (error: any) {
      console.error('[CampaignsScreen.handleEnroll] Error', { error });
      setNotice(campaignId, 'warning', t('campaigns.enrol.failed', {
        defaultValue: "Couldn't enrol — check connection and try again.",
      }));
    } finally {
      setEnrollingCampaignId(null);
    }
  };

  const handleWithdraw = (campaignId: string, campaignName: string) => {
    // Show custom confirmation modal
    setWithdrawTarget({ id: campaignId, name: campaignName });
    setShowWithdrawModal(true);
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;

    const { id: campaignId, name: campaignName } = withdrawTarget;

    setShowWithdrawModal(false);
    setWithdrawing(campaignId);
    clearNotice(campaignId);

    // Kept so an optimistic withdraw can be undone exactly, including any
    // attendance already recorded against the enrolment.
    const previousCheckin = checkins[campaignId];

    const revertOptimistic = () => {
      setEnrolledCampaigns(prev => {
        const newSet = new Set(prev);
        newSet.add(campaignId);
        return newSet;
      });
      if (previousCheckin) {
        setCheckins(prev => ({ ...prev, [campaignId]: previousCheckin }));
      }
    };

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setNotice(campaignId, 'warning', t('campaigns.withdraw.signedOut', {
          defaultValue: 'You must be signed in to withdraw.',
        }));
        return;
      }

      // Immediately update UI (optimistic update)
      setEnrolledCampaigns(prev => {
        const newSet = new Set(prev);
        newSet.delete(campaignId);
        return newSet;
      });
      setCheckins(prev => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });

      // Update status to cancelled — handle_enrollment_status_change decrements
      // health_campaigns.current_participants on this transition.
      const { data: cancelledRows, error } = await supabase
        .from('campaign_participants')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .select('id');

      if (error) {
        console.error('[CampaignsScreen.confirmWithdraw] Update failed', { error });
        revertOptimistic();
        setNotice(campaignId, 'warning', t('campaigns.withdraw.failed', {
          defaultValue: "Couldn't withdraw — check connection and try again.",
        }));
      } else if (!cancelledRows || cancelledRows.length === 0) {
        // .select() was already here; nothing read it. A zero-row update is not
        // a withdrawal, and the optimistic UI must go back.
        console.error('[CampaignsScreen.confirmWithdraw] Update matched no rows', { campaignId });
        revertOptimistic();
        setNotice(campaignId, 'warning', t('campaigns.withdraw.notFound', {
          defaultValue: 'Nothing was changed — no enrolment of yours was found for this campaign. Pull down to refresh.',
        }));
        await loadUserEnrollments();
      } else {
        setNotice(campaignId, 'success', t('campaigns.withdraw.done', {
          defaultValue: "You've withdrawn from \"{{campaign}}\". You can enrol again while places remain.",
          campaign: campaignName,
        }));
        // Refresh to get updated participant count
        loadCampaigns();
      }
    } catch (error: any) {
      console.error('[CampaignsScreen.confirmWithdraw] Error', { error });
      revertOptimistic();
      setNotice(campaignId, 'warning', t('campaigns.withdraw.failed', {
        defaultValue: "Couldn't withdraw — check connection and try again.",
      }));
    } finally {
      setWithdrawing(null);
      setWithdrawTarget(null);
    }
  };

  const handleViewDetails = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setShowDetailModal(true);
  };

  const getCampaignTitle = (campaign: Campaign) => {
    return (
      campaign.campaign_name ||
      campaign.title ||
      campaign.name ||
      t('campaigns.untitled', { defaultValue: 'Untitled campaign' })
    );
  };

  const tabLabel = (tab: CampaignTab) =>
    tab === 'active'
      ? t('campaigns.tabs.active', { defaultValue: 'Active' })
      : tab === 'upcoming'
      ? t('campaigns.tabs.upcoming', { defaultValue: 'Upcoming' })
      : t('campaigns.tabs.past', { defaultValue: 'Past' });

  const handleTabPress = (tab: CampaignTab) => {
    tabChosenByUser.current = true;
    if (tab === activeTab) return;
    // A notice reports the outcome of an action on a card in the view it was
    // raised in. Leaving the view retires it rather than letting it hang around
    // asserting something that may no longer hold.
    setNotices({});
    setActiveTab(tab);
  };

  const filteredCampaigns = filterCampaigns();

  const canCreateCampaigns = ['super_admin', 'health_admin', 'district_officer', 'asha_worker'].includes(profile.role);
  const canEnroll = profile.role === 'asha_worker' || profile.role === 'volunteer';
  const canViewCampaignIntelligence = ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'].includes(profile.role);

  const renderCampaigns = () => {
    if (filteredCampaigns.length === 0) {
      return (
        // Quiet zero, not success: an empty list is neither good news nor a
        // failure, so it gets ink and not the success teal. The error state is
        // the ErrorCard above, and the two can never be confused.
        <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
          <Ionicons name="calendar-outline" size={24} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.5}>
            {activeTab === 'active'
              ? t('campaigns.empty.active', { defaultValue: 'No campaigns are running right now.' })
              : activeTab === 'upcoming'
              ? t('campaigns.empty.upcoming', { defaultValue: 'No upcoming campaigns are scheduled.' })
              : t('campaigns.empty.past', { defaultValue: 'No past campaigns on record.' })}
          </Text>
          {canCreateCampaigns && (
            <Pressable
              style={({ pressed }) => [
                styles.emptyButton,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
              ]}
              onPress={() => onNavigateToForm('new-campaign')}
              accessibilityRole="button"
              accessibilityLabel={t('campaigns.create', { defaultValue: 'Create campaign' })}
            >
              <Text style={[styles.emptyButtonText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                {t('campaigns.create', { defaultValue: 'Create campaign' })}
              </Text>
            </Pressable>
          )}
        </View>
      );
    }

    return filteredCampaigns.map((campaign) => {
      const typeInfo = getCampaignTypeInfo(campaign.campaign_type);
      const maxPart = campaign.max_participants || campaign.target_beneficiaries || 0;
      const currentPart = campaign.current_participants || 0;
      const progressPercent = maxPart > 0 ? (currentPart / maxPart) * 100 : 0;
      const campaignIsActive = isCampaignActive(campaign);

      return (
        <View
          key={campaign.id}
          style={[styles.campaignCard, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}
        >
          <View style={styles.campaignHeader}>
            <View style={[styles.typeIcon, { backgroundColor: typeInfo.color + '14' }]}>
              <Ionicons name={typeInfo.icon as any} size={24} color={typeInfo.color} />
            </View>
            <View style={styles.campaignTitleSection}>
              <Text style={[styles.campaignTitle, { color: colors.text }]}>{getCampaignTitle(campaign)}</Text>
              <StatusPill status={campaign.status} />
            </View>
          </View>

          <Text style={[styles.campaignDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {campaign.description}
          </Text>

          <View style={styles.campaignDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, styles.numericText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {formatDate(campaign.start_date)} - {formatDate(campaign.end_date)}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.text }]}>
                {campaign.location_name ||
                  campaign.district ||
                  t('campaigns.locationTbd', { defaultValue: 'Location to be confirmed' })}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.text }]}>
                {campaign.target_audience ||
                  t('campaigns.audienceGeneral', { defaultValue: 'General public' })}
              </Text>
            </View>
          </View>

          {maxPart > 0 && (
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {t('campaigns.participation', { defaultValue: 'Participation' })}
                </Text>
                <Text style={[styles.progressValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {currentPart}/{maxPart}
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(progressPercent, 100)}%`, backgroundColor: colors.primary },
                  ]}
                />
              </View>
            </View>
          )}

          <View style={styles.campaignActions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: pressed ? colors.cardHover : 'transparent',
                  borderColor: colors.inputBorder,
                },
              ]}
              onPress={() => handleViewDetails(campaign)}
              accessibilityRole="button"
              accessibilityLabel={t('campaigns.viewDetailsFor', {
                defaultValue: 'View details for {{campaign}}',
                campaign: getCampaignTitle(campaign),
              })}
            >
              <Text style={[styles.actionButtonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {t('campaigns.viewDetails', { defaultValue: 'View details' })}
              </Text>
            </Pressable>
            {/* No enrol/withdraw control until enrolment is actually KNOWN.
                While it is loading or failed, either button would assert a fact
                we do not have — "Enrol" says you are not enrolled, "Withdraw"
                says you are. The block below states that it is unknown and the
                banner above the list carries the retry. */}
            {campaignIsActive && canEnroll && !enrolmentLoading && !enrolmentError && (
              enrolledCampaigns.has(campaign.id) ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.primaryButton,
                    { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                  ]}
                  onPress={() => handleWithdraw(campaign.id, getCampaignTitle(campaign))}
                  disabled={withdrawing === campaign.id}
                  accessibilityRole="button"
                  accessibilityLabel={t('campaigns.withdrawFrom', {
                    defaultValue: 'Withdraw from {{campaign}}',
                    campaign: getCampaignTitle(campaign),
                  })}
                >
                  {withdrawing === campaign.id ? (
                    <ActivityIndicator size="small" color={colors.textInverse} />
                  ) : (
                    <Text style={[styles.actionButtonText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>
                      {t('campaigns.withdrawAction', { defaultValue: 'Withdraw' })}
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.primaryButton,
                    { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  ]}
                  onPress={() => handleEnroll(campaign.id, getCampaignTitle(campaign))}
                  disabled={campaign.id === enrollingCampaignId}
                  accessibilityRole="button"
                  accessibilityLabel={t('campaigns.enrolIn', {
                    defaultValue: 'Enrol in {{campaign}}',
                    campaign: getCampaignTitle(campaign),
                  })}
                >
                  {campaign.id === enrollingCampaignId ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Text style={[styles.actionButtonText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                      {t('campaigns.enrolAction', { defaultValue: 'Enrol' })}
                    </Text>
                  )}
                </Pressable>
              )
            )}
          </View>

          {/* Enrolment / attendance outcome — inline, never an OS alert */}
          {renderNotice(campaign.id)}

          {/* Attendance — enrolled + window open */}
          {renderCheckinBlock(campaign)}

          {/* Enrolled badge — suppressed while enrolment is unknown, so a failed
              fetch never leaves a stale "You're enrolled" standing unqualified. */}
          {!enrolmentError && !enrolmentLoading && enrolledCampaigns.has(campaign.id) && (
            <View style={[styles.enrolledBadge, { backgroundColor: colors.successBg }]}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={[styles.enrolledBadgeText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                {t('campaigns.enrolledBadge', { defaultValue: "You're enrolled" })}
              </Text>
            </View>
          )}
        </View>
      );
    });
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers read correctly in BOTH modes.
  // textInverse here would be white-on-paper — invisible — and is banned.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg surface continuing the shell band above it,
          closed by a 1px hairline in both modes. */}
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
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: headerText }]} numberOfLines={1}>
              {t('campaigns.title', { defaultValue: 'Campaigns' })}
            </Text>
            <Text style={[styles.headerSubtitle, { color: headerSub }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {t('campaigns.subtitle', { defaultValue: 'Health awareness and outreach programmes' })}
            </Text>
          </View>
          {canViewCampaignIntelligence && (
            <TouchableOpacity
              style={[styles.headerActionBtn, { borderColor: colors.inputBorder }]}
              onPress={() => onNavigateToForm('campaign-intelligence')}
              accessibilityRole="button"
              accessibilityLabel={t('campaigns.intelligenceOpen', { defaultValue: 'Open campaign intelligence' })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="analytics-outline" size={15} color={colors.text} />
              <Text
                style={[styles.headerActionText, { color: colors.text }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {t('campaigns.intelligence', { defaultValue: 'Intelligence' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tab Buttons */}
      <View style={[styles.tabContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {CAMPAIGN_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && { backgroundColor: colors.primary },
            ]}
            onPress={() => handleTabPress(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            accessibilityLabel={t('campaigns.tabA11y', {
              defaultValue: '{{tab}} campaigns',
              tab: tabLabel(tab),
            })}
          >
            <Text
              style={[styles.tabText, { color: activeTab === tab ? colors.onPrimary : colors.text }]}
              maxFontSizeMultiplier={1.3}
            >
              {tabLabel(tab)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Eyebrow-and-count section header */}
        <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]} numberOfLines={1}>
          {t('campaigns.sectionEyebrow', {
            defaultValue: '{{tab}} CAMPAIGNS',
            tab: tabLabel(activeTab).toUpperCase(),
          })}
          {!loading && !campaignsError && (
            <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${filteredCampaigns.length}`}</Text>
          )}
        </Text>

        {loading ? (
          <View style={styles.skeletonWrap} accessibilityElementsHidden>
            <SkeletonBlock height={220} radius={radii.md} />
            <SkeletonBlock height={220} radius={radii.md} />
          </View>
        ) : campaignsError ? (
          // Retries BOTH loaders. Wired to loadCampaigns alone, the only visible
          // retry on the screen could not recover a failed enrolment fetch.
          <ErrorCard message={campaignsError} onRetry={reloadAll} />
        ) : (
          <>
            {renderEnrolmentBanner()}
            {renderCampaigns()}
          </>
        )}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Campaign Details Modal */}
      <Modal
        visible={showDetailModal}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent={true}
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
            {/* 3px status top rule — never flood-fill a modal header */}
            <View
              style={[
                styles.modalTopRule,
                { backgroundColor: selectedCampaign ? getStatusColor(selectedCampaign.status) : colors.border },
              ]}
            />
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t('campaigns.detail.title', { defaultValue: 'Campaign details' })}
              </Text>
              <TouchableOpacity
                onPress={() => setShowDetailModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                accessibilityRole="button"
                accessibilityLabel={t('campaigns.detail.close', { defaultValue: 'Close campaign details' })}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedCampaign && (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.name', { defaultValue: 'Campaign name' })}
                  </Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{getCampaignTitle(selectedCampaign)}</Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.type', { defaultValue: 'Type' })}
                  </Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {getCampaignTypeLabel(selectedCampaign.campaign_type)}
                  </Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.description', { defaultValue: 'Description' })}
                  </Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedCampaign.description ||
                      t('campaigns.detail.noDescription', { defaultValue: 'No description was given.' })}
                  </Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.schedule', { defaultValue: 'Schedule' })}
                  </Text>
                  <Text style={[styles.detailValue, styles.numericText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {formatDate(selectedCampaign.start_date)} - {formatDate(selectedCampaign.end_date)}
                  </Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.location', { defaultValue: 'Location' })}
                  </Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedCampaign.location_name ||
                      t('campaigns.locationTbd', { defaultValue: 'Location to be confirmed' })}
                    {selectedCampaign.district && `, ${selectedCampaign.district}`}
                    {selectedCampaign.state && `, ${selectedCampaign.state}`}
                  </Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.audience', { defaultValue: 'Who it is for' })}
                  </Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedCampaign.target_audience ||
                      t('campaigns.audienceGeneral', { defaultValue: 'General public' })}
                  </Text>
                </View>

                {selectedCampaign.target_beneficiaries && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      {t('campaigns.detail.targetBeneficiaries', { defaultValue: 'Target beneficiaries' })}
                    </Text>
                    <Text style={[styles.detailValue, styles.numericText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {selectedCampaign.target_beneficiaries}
                    </Text>
                  </View>
                )}

                {selectedCampaign.contact_person && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      {t('campaigns.detail.contact', { defaultValue: 'Contact person' })}
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.contact_person}</Text>
                    {selectedCampaign.contact_phone && (
                      <Text style={[styles.detailValue, styles.numericText, { color: isDark ? colors.primary : colors.primaryDark }]} maxFontSizeMultiplier={1.3}>
                        {selectedCampaign.contact_phone}
                      </Text>
                    )}
                  </View>
                )}

                {selectedCampaign.notes && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                      {t('campaigns.detail.notes', { defaultValue: 'Notes' })}
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.notes}</Text>
                  </View>
                )}

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                    {t('campaigns.detail.status', { defaultValue: 'Status' })}
                  </Text>
                  <View style={{ alignSelf: 'flex-start' }}>
                    <StatusPill status={selectedCampaign.status} />
                  </View>
                </View>

                {/* Enrolment status — same suppression rule as the card badge */}
                {!enrolmentError && !enrolmentLoading && enrolledCampaigns.has(selectedCampaign.id) && (
                  <View style={[styles.enrolledBadge, { backgroundColor: colors.successBg, marginBottom: spacing.md }]}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text
                      style={[styles.enrolledBadgeText, { color: colors.success, fontSize: 15 }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t('campaigns.enrolledInThis', { defaultValue: "You're enrolled in this campaign" })}
                    </Text>
                  </View>
                )}

                {/* Enrolment / attendance outcome in Modal */}
                {renderNotice(selectedCampaign.id)}

                {/* Attendance in Modal */}
                {renderCheckinBlock(selectedCampaign)}

                {isCampaignActive(selectedCampaign) && canEnroll && !enrolmentError && !enrolmentLoading && (
                  enrolledCampaigns.has(selectedCampaign.id) ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.enrollModalButton,
                        { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                      ]}
                      onPress={() => {
                        setShowDetailModal(false);
                        handleWithdraw(selectedCampaign.id, getCampaignTitle(selectedCampaign));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('campaigns.withdrawFromThis', { defaultValue: 'Withdraw from this campaign' })}
                    >
                      <Ionicons name="exit-outline" size={20} color={colors.textInverse} />
                      <Text
                        style={[styles.enrollModalButtonText, { color: colors.textInverse }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t('campaigns.withdrawFromThis', { defaultValue: 'Withdraw from this campaign' })}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [
                        styles.enrollModalButton,
                        { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                      ]}
                      onPress={() => {
                        setShowDetailModal(false);
                        handleEnroll(selectedCampaign.id, getCampaignTitle(selectedCampaign));
                      }}
                      disabled={selectedCampaign.id === enrollingCampaignId}
                      accessibilityRole="button"
                      accessibilityLabel={t('campaigns.enrolInThis', { defaultValue: 'Enrol in this campaign' })}
                    >
                      {selectedCampaign.id === enrollingCampaignId ? (
                        <ActivityIndicator size="small" color={colors.onPrimary} />
                      ) : (
                        <>
                          <Ionicons name="person-add-outline" size={20} color={colors.onPrimary} />
                          <Text
                            style={[styles.enrollModalButtonText, { color: colors.onPrimary }]}
                            maxFontSizeMultiplier={1.3}
                          >
                            {t('campaigns.enrolInThis', { defaultValue: 'Enrol in this campaign' })}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  )
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Withdraw Confirmation Modal */}
      <Modal
        visible={showWithdrawModal}
        animationType={reduceMotion ? 'none' : 'fade'}
        transparent={true}
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => {
          setShowWithdrawModal(false);
          setWithdrawTarget(null);
        }}
      >
        <View style={[styles.confirmModalOverlay, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              styles.confirmModalContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            <View style={[styles.confirmModalIcon, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="warning-outline" size={32} color={colors.danger} />
            </View>
            <Text style={[styles.confirmModalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {t('campaigns.withdrawConfirm.title', { defaultValue: 'Withdraw from this campaign?' })}
            </Text>
            <Text style={[styles.confirmModalMessage, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              {t('campaigns.withdrawConfirm.body', {
                defaultValue:
                  'Your place in "{{campaign}}" will be given up. You can enrol again while places remain.',
                campaign: withdrawTarget?.name || '',
              })}
            </Text>
            <View style={styles.confirmModalButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalCancelButton,
                  { borderColor: colors.inputBorder, backgroundColor: pressed ? colors.cardHover : 'transparent' },
                ]}
                onPress={() => {
                  setShowWithdrawModal(false);
                  setWithdrawTarget(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('campaigns.withdrawConfirm.cancel', { defaultValue: 'Keep my place' })}
              >
                <Text style={[styles.confirmModalButtonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {t('campaigns.withdrawConfirm.cancel', { defaultValue: 'Keep my place' })}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                ]}
                onPress={confirmWithdraw}
                accessibilityRole="button"
                accessibilityLabel={t('campaigns.withdrawConfirm.confirmA11y', {
                  defaultValue: 'Confirm withdrawal from this campaign',
                })}
              >
                <Ionicons name="exit-outline" size={18} color={colors.textInverse} style={{ marginRight: 6 }} />
                <Text style={[styles.confirmModalButtonText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>
                  {t('campaigns.withdrawAction', { defaultValue: 'Withdraw' })}
                </Text>
              </Pressable>
            </View>
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
  /* No status-bar inset: this tab renders below MainApp's shell header, which
     already sits inside the SafeAreaView. Two stacked 42dp insets was the
     "wasted vertical space" defect. */
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  skeletonWrap: {
    gap: spacing.md,
  },
  sectionEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 5,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tabContainer: {
    flexDirection: 'row',
    margin: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.xs,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  campaignCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  campaignHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  campaignTitleSection: {
    flex: 1,
  },
  campaignTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  campaignDescription: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  campaignDetails: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    flexShrink: 1,
  },
  numericText: {
    fontVariant: ['tabular-nums'],
  },
  progressSection: {
    marginBottom: spacing.lg,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  campaignActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  primaryButton: {
    borderWidth: 0,
  },
  actionButtonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 80,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalTopRule: {
    height: 3,
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    flex: 1,
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    padding: spacing.lg,
  },
  detailSection: {
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  enrollModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  enrollModalButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  enrolledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    marginTop: spacing.md,
    gap: 6,
  },
  /* Shared inline notice (enrolment + attendance). Tone colour sits on its own
     tint so both directions are covered by scripts/check-contrast.cjs. */
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  /* 40dp drawn + 8dp hitSlop on every side = 56dp of touch, comfortably over
     the 48dp floor, without a close button that outweighs its notice. */
  noticeDismiss: {
    width: 40,
    height: 40,
    marginTop: -8,
    marginRight: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Enrolment region error — one banner for a screen-wide fetch, with its own
     retry, because the campaigns ErrorCard cannot recover it. */
  enrolmentBanner: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  enrolmentBannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  enrolmentBannerText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  enrolmentBannerRetry: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    borderWidth: 1.5,
  },
  enrolmentBannerRetryText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  checkinUnknownRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 40,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    marginTop: spacing.md,
    gap: 6,
  },
  /* Attendance */
  checkinBlock: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  checkinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  checkinButtonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  checkinCaption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  checkinCaptionMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  checkinDoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 40,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    marginTop: spacing.md,
    gap: 6,
  },
  checkinDoneTextWrap: {
    flex: 1,
    gap: 2,
  },
  checkinDoneText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  checkinDoneDetail: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  enrolledBadgeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  // Withdraw Confirmation Modal Styles
  confirmModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  confirmModalContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
  },
  confirmModalIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  confirmModalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  confirmModalMessage: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  confirmModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.md,
  },
  confirmModalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  confirmModalCancelButton: {
    borderWidth: 1.5,
  },
  confirmModalButtonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
});

export default CampaignsScreen;
