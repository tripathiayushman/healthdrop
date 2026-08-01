// =====================================================
// WATER SOURCES SCREEN — Bharosa E·01 + E·03
// A flagged well is a promise: flag → fix → retest →
// reopen. The list puts broken promises first; the
// detail tracks each one to completion with a vertical
// stepper, readings with inline healthy ranges, and a
// human-only reopen that ends in the rubber stamp.
// The public is never auto-alerted — that call stays
// with an official. Four-state data regions throughout.
// =====================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Profile } from '../../types';
import { useTheme, radii, spacing, getWaterQualityColor } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock, VerifiedStamp } from '../dashboards/DashboardShared';
import { StatusBadge } from '../shared/StatusBadge';
import {
  WaterSourceRecord,
  WaterSourceReport,
  waterSourcesService,
} from '../../lib/services/waterSources';

const LIST_ERROR = "Couldn't load water sources — check connection.";
const DETAIL_ERROR = "Couldn't load this source — check connection.";
const REPORTS_ERROR = "Couldn't load this source's readings — check connection.";

/** RLS mirror: only these roles may UPDATE water_sources. */
const OFFICIAL_ROLES: Profile['role'][] = [
  'super_admin',
  'health_admin',
  'district_officer',
  'clinic',
];

const ROLE_TITLE: Record<Profile['role'], string> = {
  super_admin: 'Super Administrator',
  health_admin: 'Health Administrator',
  clinic: 'Clinic Staff',
  asha_worker: 'ASHA Worker',
  volunteer: 'Community Volunteer',
  district_officer: 'District Officer',
};

// ─────────────────────────────────────────────────────
//  Date helpers
// ─────────────────────────────────────────────────────
const shortDate = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const shortDateTime = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

const daysSince = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

const agoLabel = (iso?: string | null): string => {
  const d = daysSince(iso);
  if (d === null) return '';
  if (d === 0) return 'today';
  return `${d}d ago`;
};

/** Parse a DATE column ('YYYY-MM-DD') as a LOCAL date — no UTC drift. */
const parseDueDate = (dateStr?: string | null): Date | null => {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const formatDue = (dateStr?: string | null): string => {
  const d = parseDueDate(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** Days until the due date; negative = overdue. */
const dueDelta = (dateStr?: string | null): number | null => {
  const d = parseDueDate(dateStr);
  if (!d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86400000);
};

const localDateString = (d: Date): string => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ─────────────────────────────────────────────────────
//  Water helpers
// ─────────────────────────────────────────────────────
const isFlaggedStatus = (s?: string | null): boolean => s === 'unsafe' || s === 'critical';

const isUnsafeQuality = (q?: string | null): boolean => {
  const k = (q ?? '').toLowerCase();
  return k === 'unsafe' || k === 'critical' || k === 'poor' || k === 'contaminated';
};

const isSafeQuality = (q?: string | null): boolean => (q ?? '').toLowerCase() === 'safe';

/** Households ride inside report notes ("Households affected: N"). */
const householdsFromReports = (reports: WaterSourceReport[]): number | null => {
  for (const r of reports) {
    const m = /households affected:\s*(\d+)/i.exec(r.notes ?? '');
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
};

const formatPh = (v?: number | null): string =>
  v === null || v === undefined ? '—' : `${v}`;

const formatNtu = (v?: number | null): string =>
  v === null || v === undefined ? '—' : `${v}`;

type SheetKind = null | 'assign' | 'treatment' | 'reopen';

// =====================================================
//  Screen
// =====================================================
export default function WaterSourcesScreen({
  profile,
  onBack,
  onNavigateToForm,
}: {
  profile: Profile;
  onBack: () => void;
  onNavigateToForm?: (route: string) => void;
}) {
  const { colors, isDark } = useTheme();
  const isOfficial = OFFICIAL_ROLES.includes(profile.role);

  const [view, setView] = useState<'list' | 'detail'>('list');

  // ── List region ──
  const [sources, setSources] = useState<WaterSourceRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Detail region ──
  const [selected, setSelected] = useState<WaterSourceRecord | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reports, setReports] = useState<WaterSourceReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [justReopened, setJustReopened] = useState(false);

  // ── Sheets ──
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [treatmentNote, setTreatmentNote] = useState('');
  const [reopenNote, setReopenNote] = useState('');
  const [dueDays, setDueDays] = useState<number>(3);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);

  const loadList = async () => {
    setListError(null);
    const res = await waterSourcesService.list({ district: profile.district || undefined });
    if (res.error || !res.data) {
      setListError(LIST_ERROR);
    } else {
      setSources(res.data);
    }
    setListLoading(false);
  };

  useEffect(() => {
    loadList();
  }, []);

  const onRefreshList = async () => {
    setRefreshing(true);
    await loadList();
    setRefreshing(false);
  };

  const retryList = () => {
    setListLoading(true);
    loadList();
  };

  const loadReports = async (src: WaterSourceRecord) => {
    setReportsError(null);
    setReportsLoading(true);
    const res = await waterSourcesService.reportsForSource(src);
    if (res.error || !res.data) {
      setReportsError(REPORTS_ERROR);
      setReports([]);
    } else {
      setReports(res.data);
    }
    setReportsLoading(false);
  };

  const loadDetail = async (id: string) => {
    setDetailError(null);
    const res = await waterSourcesService.getById(id);
    if (res.error || !res.data) {
      setDetailError(DETAIL_ERROR);
      setReportsLoading(false);
      return;
    }
    setSelected(res.data);
    await loadReports(res.data);
  };

  const openDetail = (src: WaterSourceRecord) => {
    setSelected(src);
    setJustReopened(false);
    setReports([]);
    setView('detail');
    loadDetail(src.id);
  };

  const backToList = () => {
    setView('list');
    setSheet(null);
    setDetailError(null);
    // Reflect any detail edits back into the cached list
    if (selected) {
      setSources((prev) => prev.map((s) => (s.id === selected.id ? selected : s)));
    }
  };

  // Back gesture from the detail returns to the list, not out of the screen.
  // (Native only — react-native-web has no hardware back.)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'detail') {
        backToList();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [view, selected]);

  // ── Derived detail facts ──
  const flagged = isFlaggedStatus(selected?.current_status);

  /** The reading that raised the flag — nearest unsafe report at/before flagged_at. */
  const flagReport = useMemo(() => {
    if (!selected) return null;
    const unsafe = reports.filter((r) => isUnsafeQuality(r.overall_quality));
    if (unsafe.length === 0) return null;
    if (!selected.flagged_at) return unsafe[0];
    const flagT = new Date(selected.flagged_at).getTime();
    return (
      unsafe.find((r) => new Date(r.created_at).getTime() <= flagT + 60000) ??
      unsafe[unsafe.length - 1]
    );
  }, [reports, selected]);

  /** Newest SAFE reading filed after the flag — the retest receipt. */
  const safeRetestReport = useMemo(() => {
    if (!selected) return null;
    return (
      reports.find(
        (r) =>
          isSafeQuality(r.overall_quality) &&
          (!selected.flagged_at || new Date(r.created_at).getTime() > new Date(selected.flagged_at).getTime()),
      ) ?? null
    );
  }, [reports, selected]);

  const households = useMemo(() => householdsFromReports(reports), [reports]);

  const reporters = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    reports.forEach((r) => {
      const id = r.reporter?.id ?? r.reporter_id;
      if (id && !seen.has(id)) {
        seen.set(id, { id, name: r.reporter?.full_name || 'Field reporter' });
      }
    });
    return Array.from(seen.values());
  }, [reports]);

  // ── Sheet openers ──
  const openAssignSheet = () => {
    setSheetError(null);
    setDueDays(3);
    // Assignee defaults to the last reporter — she knows the way to the well.
    setAssigneeId(reports[0]?.reporter?.id ?? reports[0]?.reporter_id ?? null);
    setSheet('assign');
  };

  const openTreatmentSheet = () => {
    setSheetError(null);
    setTreatmentNote(selected?.treatment_note ?? '');
    setSheet('treatment');
  };

  const openReopenSheet = () => {
    setSheetError(null);
    setReopenNote('');
    setSheet('reopen');
  };

  const mergeSource = (next: WaterSourceRecord) => {
    setSelected(next);
    setSources((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  };

  // ── Sheet saves ──
  const saveAssign = async () => {
    if (!selected || sheetSaving) return;
    if (!assigneeId) {
      setSheetError('Pick who will retest this source.');
      return;
    }
    setSheetSaving(true);
    setSheetError(null);
    const due = new Date();
    due.setDate(due.getDate() + dueDays);
    const res = await waterSourcesService.assignRetest(selected.id, {
      assignedTo: assigneeId,
      dueDate: localDateString(due),
    });
    setSheetSaving(false);
    if (res.error || !res.data) {
      setSheetError(res.error ?? "Couldn't save the assignment — check connection and try again.");
      return;
    }
    mergeSource(res.data);
    setSheet(null);
  };

  const saveTreatment = async () => {
    if (!selected || sheetSaving || !treatmentNote.trim()) return;
    setSheetSaving(true);
    setSheetError(null);
    const res = await waterSourcesService.logTreatment(selected.id, treatmentNote);
    setSheetSaving(false);
    if (res.error || !res.data) {
      setSheetError(res.error ?? "Couldn't save the treatment note — check connection and try again.");
      return;
    }
    mergeSource(res.data);
    setSheet(null);
  };

  const saveReopen = async () => {
    if (!selected || sheetSaving || !reopenNote.trim()) return;
    setSheetSaving(true);
    setSheetError(null);
    const res = await waterSourcesService.reopen(selected.id, reopenNote);
    setSheetSaving(false);
    if (res.error || !res.data) {
      setSheetError(res.error ?? "Couldn't reopen the source — check connection and try again.");
      return;
    }
    mergeSource(res.data);
    setJustReopened(true);
    setSheet(null);
  };

  // Header ink — headerBg is a mode-appropriate SURFACE (paper in light, dark
  // surface in dark), so plain ink reads in BOTH modes. textInverse is illegal here.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  // ── List split: broken promises first ──
  const flaggedSources = useMemo(
    () =>
      sources
        .filter((s) => isFlaggedStatus(s.current_status))
        .sort((a, b) => {
          const ta = a.flagged_at ? new Date(a.flagged_at).getTime() : Number.MAX_SAFE_INTEGER;
          const tb = b.flagged_at ? new Date(b.flagged_at).getTime() : Number.MAX_SAFE_INTEGER;
          return ta - tb; // longest-waiting first
        }),
    [sources],
  );
  const calmSources = useMemo(
    () => sources.filter((s) => !isFlaggedStatus(s.current_status)),
    [sources],
  );

  // ═══════════════════════════════════════════════════
  //  LIST VIEW
  // ═══════════════════════════════════════════════════
  if (view === 'list') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.headerBg,
              // Paper-on-paper needs the hairline in BOTH modes.
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Ionicons name="chevron-back" size={22} color={headerText} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: headerText }]} numberOfLines={1}>
              Water sources
            </Text>
            <Text style={[styles.headerSubtitle, { color: headerSub }]} numberOfLines={1}>
              {profile.district ?? 'All districts'} · flag → fix → retest → reopen
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefreshList} tintColor={colors.primary} />
          }
          showsVerticalScrollIndicator={false}
        >
          {listLoading ? (
            <View style={{ gap: spacing.md }}>
              <SkeletonBlock height={72} radius={radii.md} />
              <SkeletonBlock height={72} radius={radii.md} />
              <SkeletonBlock height={72} radius={radii.md} />
              <SkeletonBlock height={72} radius={radii.md} />
            </View>
          ) : listError ? (
            <ErrorCard message={listError} onRetry={retryList} />
          ) : sources.length === 0 ? (
            <EmptyState
              icon="water-outline"
              color={colors.success}
              title="No water sources tracked yet"
              subtitle="Sources appear here automatically as water reports are filed."
            />
          ) : (
            <>
              {flaggedSources.length > 0 && (
                <>
                  <Text style={[styles.eyebrow, { color: colors.waterUnsafe }]} maxFontSizeMultiplier={1.3}>
                    NEEDS ACTION
                    <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${flaggedSources.length}`}</Text>
                  </Text>
                  {flaggedSources.map((s) => (
                    <SourceRow key={s.id} source={s} flaggedRow onPress={() => openDetail(s)} />
                  ))}
                </>
              )}

              {calmSources.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.eyebrow,
                      { color: colors.textSecondary },
                      flaggedSources.length > 0 && { marginTop: spacing.lg },
                    ]}
                    maxFontSizeMultiplier={1.3}
                  >
                    ALL SOURCES
                    <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${calmSources.length}`}</Text>
                  </Text>
                  {calmSources.map((s) => (
                    <SourceRow key={s.id} source={s} onPress={() => openDetail(s)} />
                  ))}
                </>
              )}
            </>
          )}
          <View style={{ height: 48 }} />
        </ScrollView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════
  //  DETAIL VIEW — E·01 tracking / E·03 loop closed
  // ═══════════════════════════════════════════════════
  const src = selected;

  const phWord = src?.last_ph == null ? null : src.last_ph < 6.5 ? 'low' : src.last_ph > 8.5 ? 'high' : 'ok';
  const ntuWord = src?.last_turbidity == null ? null : src.last_turbidity < 5 ? 'ok' : 'high';

  const flagReporterName = flagReport?.reporter?.full_name ?? null;
  const assigneeName = src?.assignee?.full_name ?? null;
  const reopenerName = src?.reopener?.full_name ?? (justReopened ? profile.full_name : null);
  const reopenerRole = src?.reopener?.role
    ? ROLE_TITLE[src.reopener.role as Profile['role']] ?? src.reopener.role
    : justReopened
      ? ROLE_TITLE[profile.role]
      : undefined;

  const loopClosed = !!src && !flagged && !!src.reopened_at;

  // BEFORE → AFTER — derivable only when both ends exist
  const beforePh = flagReport?.ph_level ?? (flagged ? src?.last_ph ?? null : null);
  const beforeNtu = flagReport?.turbidity ?? (flagged ? src?.last_turbidity ?? null : null);
  const afterPh = safeRetestReport?.ph_level ?? (loopClosed ? src?.last_ph ?? null : null);
  const afterNtu = safeRetestReport?.turbidity ?? (loopClosed ? src?.last_turbidity ?? null : null);
  const beforeAfterDerivable =
    (beforePh != null || beforeNtu != null) && (afterPh != null || afterNtu != null);

  const retestDelta = dueDelta(src?.retest_due_date);
  const retestCaption = src?.retest_due_date
    ? `Due ${formatDue(src.retest_due_date)}${
        retestDelta != null && retestDelta < 0
          ? ` · overdue ${Math.abs(retestDelta)}d`
          : retestDelta === 0
            ? ' · due today'
            : ''
      }${assigneeName ? ` · assigned to ${assigneeName}` : ''}`
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper needs the hairline in BOTH modes.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={backToList}
          accessibilityRole="button"
          accessibilityLabel="Back to the water sources list"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: headerText }]} numberOfLines={1}>
            {src?.source_name ?? 'Water source'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]} numberOfLines={1}>
            {[src?.location_name, src?.district].filter(Boolean).join(' · ') || 'Source detail'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              if (!src) return;
              setRefreshing(true);
              await loadDetail(src.id);
              setRefreshing(false);
            }}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {detailError || !src ? (
          <ErrorCard
            message={detailError ?? DETAIL_ERROR}
            onRetry={() => src && loadDetail(src.id)}
          />
        ) : (
          <>
            {/* ── Identity card — name, households, water pill ── */}
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                !isDark && styles.cardShadow,
              ]}
            >
              <View style={styles.identityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sourceTitle, { color: colors.text }]} numberOfLines={2}>
                    {src.source_name}
                  </Text>
                  <Text style={[styles.sourceMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[src.location_name, src.district].filter(Boolean).join(', ')}
                    {households ? ` · ${households} households use it` : ''}
                  </Text>
                </View>
                <StatusBadge status={src.current_status} type="water" />
              </View>

              {/* Readings with inline healthy ranges — numbers stay ink;
                  only the status word wears color. */}
              <View style={[styles.readingsRow, { borderTopColor: colors.borderLight }]}>
                <View style={styles.readingCell}>
                  <Text style={[styles.readingValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {formatPh(src.last_ph)}
                  </Text>
                  <Text style={[styles.readingLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    pH (6.5–8.5 ok)
                  </Text>
                  {phWord && (
                    <Text
                      style={[
                        styles.readingWord,
                        { color: phWord === 'ok' ? colors.success : colors.waterUnsafe },
                      ]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {phWord}
                    </Text>
                  )}
                </View>
                <View style={[styles.readingDivider, { backgroundColor: colors.borderLight }]} />
                <View style={styles.readingCell}>
                  <Text style={[styles.readingValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {formatNtu(src.last_turbidity)}
                  </Text>
                  <Text style={[styles.readingLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    NTU ({'<'}5 ok)
                  </Text>
                  {ntuWord && (
                    <Text
                      style={[
                        styles.readingWord,
                        { color: ntuWord === 'ok' ? colors.success : colors.waterUnsafe },
                      ]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {ntuWord}
                    </Text>
                  )}
                </View>
                <View style={[styles.readingDivider, { backgroundColor: colors.borderLight }]} />
                <View style={styles.readingCell}>
                  <Text style={[styles.readingValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {src.last_reported_at ? agoLabel(src.last_reported_at) : '—'}
                  </Text>
                  <Text style={[styles.readingLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    last reading
                  </Text>
                </View>
              </View>

              {(flagged || src.flagged_at) && (
                <Text style={[styles.notifyCaption, { color: colors.textSecondary }]}>
                  District officials auto-notified{src.flagged_at ? ` ${shortDateTime(src.flagged_at)}` : ''}.
                  The public is never auto-alerted — that call stays with you.
                </Text>
              )}
            </View>

            {/* ── E·03 — loop closed: the well's receipt ── */}
            {loopClosed && (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.success,
                    marginTop: spacing.md,
                  },
                ]}
              >
                <Text style={[styles.eyebrowInCard, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                  LOOP CLOSED — RETESTED SAFE
                </Text>
                <VerifiedStamp
                  verifierName={reopenerName ?? 'Official'}
                  role={reopenerRole}
                  timestamp={shortDateTime(src.reopened_at)}
                />
                {!!src.reopen_note && (
                  <Text style={[styles.bodyText, { color: colors.text, marginTop: spacing.md }]}>
                    {src.reopen_note}
                  </Text>
                )}
                {beforeAfterDerivable && (
                  <BeforeAfterTable
                    beforePh={beforePh}
                    beforeNtu={beforeNtu}
                    afterPh={afterPh}
                    afterNtu={afterNtu}
                  />
                )}
                <Text style={[styles.captionText, { color: colors.textSecondary, marginTop: spacing.md }]}>
                  Everyone who sees this source now sees it safe — with the reopening official's name on it.
                </Text>
              </View>
            )}

            {/* ── THE PROMISE — vertical stepper ── */}
            {(flagged || src.flagged_at || src.reopened_at) && (
              <>
                <Text style={[styles.eyebrow, { color: colors.textSecondary, marginTop: spacing.xl }]} maxFontSizeMultiplier={1.3}>
                  THE PROMISE — FLAG → FIX → RETEST → REOPEN
                </Text>
                <View
                  style={[
                    styles.card,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    !isDark && styles.cardShadow,
                  ]}
                >
                  {reportsLoading ? (
                    <View style={{ gap: spacing.md }}>
                      <SkeletonBlock height={40} radius={radii.sm} />
                      <SkeletonBlock height={40} radius={radii.sm} />
                      <SkeletonBlock height={40} radius={radii.sm} />
                      <SkeletonBlock height={40} radius={radii.sm} />
                    </View>
                  ) : (
                    <>
                      <PromiseStep
                        first
                        done
                        title="Flagged unsafe"
                        meta={[
                          flagReporterName,
                          shortDateTime(src.flagged_at ?? flagReport?.created_at),
                          flagReport
                            ? `#${flagReport.id.slice(0, 8)}${
                                (flagReport.approval_status ?? '') === 'approved' ? ' approved' : ''
                              }`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                      <PromiseStep
                        done={!!src.treatment_note}
                        title={src.treatment_note ? 'Treatment logged' : 'Treatment not logged yet'}
                        meta={src.treatment_note ?? 'What was done to this source — chlorination, repair, closure.'}
                        action={
                          isOfficial && flagged
                            ? {
                                label: src.treatment_note ? 'Update treatment note' : 'Log treatment',
                                onPress: openTreatmentSheet,
                              }
                            : undefined
                        }
                      />
                      <PromiseStep
                        done={!!src.retest_due_date}
                        title={
                          src.retest_due_date
                            ? retestDelta != null && retestDelta < 0
                              ? 'Retest overdue'
                              : 'Retest due'
                            : 'Retest not assigned yet'
                        }
                        overdue={retestDelta != null && retestDelta < 0}
                        meta={retestCaption ?? 'A retest needs an owner and a date, not a hope.'}
                        action={
                          isOfficial && flagged
                            ? {
                                label: src.retest_due_date ? 'Reschedule retest' : 'Assign retest',
                                onPress: openAssignSheet,
                              }
                            : undefined
                        }
                      />
                      <PromiseStep
                        last
                        done={loopClosed}
                        title={loopClosed ? 'Reopened' : 'Reopen source'}
                        meta={
                          loopClosed
                            ? `${reopenerName ?? 'Official'} · ${shortDateTime(src.reopened_at)}`
                            : 'After a safe retest — a human decision, never automatic.'
                        }
                        action={
                          isOfficial && flagged
                            ? { label: 'Reopen source…', onPress: openReopenSheet }
                            : undefined
                        }
                      />
                    </>
                  )}
                </View>
              </>
            )}

            {/* ── Recent readings — the source's paper trail ── */}
            <Text style={[styles.eyebrow, { color: colors.textSecondary, marginTop: spacing.xl }]} maxFontSizeMultiplier={1.3}>
              RECENT READINGS
              {!reportsLoading && !reportsError && (
                <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${reports.length}`}</Text>
              )}
            </Text>
            {reportsLoading ? (
              <View style={{ gap: spacing.sm }}>
                <SkeletonBlock height={56} radius={radii.md} />
                <SkeletonBlock height={56} radius={radii.md} />
              </View>
            ) : reportsError ? (
              <ErrorCard message={reportsError} onRetry={() => loadReports(src)} />
            ) : reports.length === 0 ? (
              <EmptyState
                icon="document-text-outline"
                color={colors.success}
                title="No readings on file yet"
                subtitle="Readings filed for this source will appear here."
              />
            ) : (
              <View
                style={[
                  styles.readingList,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  !isDark && styles.cardShadow,
                ]}
              >
                {reports.slice(0, 5).map((r, idx) => (
                  <View
                    key={r.id}
                    style={[
                      styles.readingRowItem,
                      idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    ]}
                    accessible
                    accessibilityLabel={`Reading ${shortDateTime(r.created_at)}, quality ${r.overall_quality ?? 'unknown'}, by ${r.reporter?.full_name ?? 'reporter'}`}
                  >
                    <View
                      style={[
                        styles.readingTick,
                        { backgroundColor: getWaterQualityColor((r.overall_quality ?? '').toLowerCase(), colors) },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.readingItemTitle, { color: colors.text }]} numberOfLines={1}>
                        {[
                          r.ph_level != null ? `pH ${r.ph_level}` : null,
                          r.turbidity != null ? `${r.turbidity} NTU` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Field assessment'}
                        {' · '}
                        {(r.overall_quality ?? 'unknown').toString()}
                      </Text>
                      <Text style={[styles.readingItemMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                        {r.reporter?.full_name ?? 'Reporter'} · {shortDateTime(r.created_at)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* ── Bottom action zone — the retest itself, for everyone ── */}
            {onNavigateToForm && (
              <View style={{ marginTop: spacing.xl }}>
                <Pressable
                  onPress={() => onNavigateToForm(`new-water-report:prefill:${src.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel="Log a retest reading for this source"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  ]}
                >
                  <Ionicons name="water" size={18} color={colors.onPrimary} />
                  <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                    Log retest reading
                  </Text>
                </Pressable>
                <Text style={[styles.consequence, { color: colors.textSecondary }]}>
                  Opens the water report form prefilled with this source's history.
                </Text>
              </View>
            )}
          </>
        )}
        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ═══ ASSIGN RETEST SHEET ═══ */}
      <Modal
        visible={sheet === 'assign'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Assign retest</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              A retest is an assignment with an owner and a date, not a hope.
            </Text>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>DUE DATE</Text>
            <View style={styles.chipRow}>
              {[
                { days: 0, label: 'Today' },
                { days: 3, label: 'In 3 days' },
                { days: 7, label: 'In 7 days' },
              ].map((opt) => {
                const active = dueDays === opt.days;
                return (
                  <Pressable
                    key={opt.days}
                    onPress={() => setDueDays(opt.days)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Due ${opt.label}`}
                    style={({ pressed }) => [
                      styles.dateChip,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : pressed
                            ? colors.cardHover
                            : colors.card,
                        borderColor: active ? colors.primary : colors.inputBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.dateChipText, { color: active ? colors.onPrimary : colors.text }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.captionText, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              {(() => {
                const d = new Date();
                d.setDate(d.getDate() + dueDays);
                return `Retest due ${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`;
              })()}
            </Text>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>ASSIGN TO</Text>
            {reporters.length === 0 ? (
              <Text style={[styles.captionText, { color: colors.textSecondary }]}>
                No one has filed a reading for this source yet — ask a field worker to report it first.
              </Text>
            ) : (
              reporters.map((p) => {
                const active = assigneeId === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setAssigneeId(p.id);
                      setSheetError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Assign to ${p.name}`}
                    style={({ pressed }) => [
                      styles.assigneeRow,
                      {
                        backgroundColor: active
                          ? colors.primaryContainer
                          : pressed
                            ? colors.cardHover
                            : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={active ? colors.primary : colors.textTertiary}
                    />
                    <Text style={[styles.assigneeName, { color: colors.text }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {reports[0] && (reports[0].reporter?.id ?? reports[0].reporter_id) === p.id && (
                      <Text style={[styles.assigneeHint, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                        last reporter
                      </Text>
                    )}
                  </Pressable>
                );
              })
            )}

            {sheetError && (
              <View style={styles.inlineErrorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{sheetError}</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setSheet(null)}
                disabled={sheetSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.modalTextBtn, pressed && { backgroundColor: colors.cardHover }]}
              >
                <Text style={[styles.modalTextBtnLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={saveAssign}
                disabled={sheetSaving || !assigneeId}
                accessibilityRole="button"
                accessibilityLabel="Save the retest assignment"
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  (sheetSaving || !assigneeId) && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.modalPrimaryLabel, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {sheetSaving ? 'Saving…' : 'Assign retest'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ═══ LOG TREATMENT SHEET ═══ */}
      <Modal
        visible={sheet === 'treatment'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Log treatment</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              What was done and by whom — e.g. "Chlorination done · PHED team, Thu evening".
            </Text>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>TREATMENT NOTE · REQUIRED</Text>
            <TextInput
              value={treatmentNote}
              onChangeText={(t) => {
                setTreatmentNote(t);
                setSheetError(null);
              }}
              placeholder="e.g. Chlorination done by PHED team"
              placeholderTextColor={colors.inputPlaceholderColor}
              multiline
              style={[
                styles.modalInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
            {sheetError && (
              <View style={styles.inlineErrorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{sheetError}</Text>
              </View>
            )}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setSheet(null)}
                disabled={sheetSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.modalTextBtn, pressed && { backgroundColor: colors.cardHover }]}
              >
                <Text style={[styles.modalTextBtnLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={saveTreatment}
                disabled={sheetSaving || !treatmentNote.trim()}
                accessibilityRole="button"
                accessibilityLabel="Save the treatment note"
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  (sheetSaving || !treatmentNote.trim()) && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.modalPrimaryLabel, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {sheetSaving ? 'Saving…' : 'Save note'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ═══ REOPEN SHEET — required note, before→after receipt ═══ */}
      <Modal
        visible={sheet === 'reopen'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Reopen this source?</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              It will be marked safe again with your name and time on it. Safe readings never do this
              automatically — this is your call.
            </Text>

            {beforeAfterDerivable ? (
              <BeforeAfterTable
                beforePh={beforePh}
                beforeNtu={beforeNtu}
                afterPh={safeRetestReport?.ph_level ?? afterPh}
                afterNtu={safeRetestReport?.turbidity ?? afterNtu}
              />
            ) : (
              <Text style={[styles.captionText, { color: colors.textSecondary, marginTop: spacing.md }]}>
                Before → after readings aren't derivable yet for this source.
              </Text>
            )}

            {!safeRetestReport && (
              <View style={[styles.warnCard, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                <Text style={[styles.warnText, { color: colors.text }]}>
                  No safe retest reading is on file after the flag — reopen only if you are certain.
                </Text>
              </View>
            )}

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>YOUR NOTE · REQUIRED</Text>
            <TextInput
              value={reopenNote}
              onChangeText={(t) => {
                setReopenNote(t);
                setSheetError(null);
              }}
              placeholder="e.g. Retested safe after chlorination — readings and field assessment both clear"
              placeholderTextColor={colors.inputPlaceholderColor}
              multiline
              style={[
                styles.modalInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
            {sheetError && (
              <View style={styles.inlineErrorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{sheetError}</Text>
              </View>
            )}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setSheet(null)}
                disabled={sheetSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.modalTextBtn, pressed && { backgroundColor: colors.cardHover }]}
              >
                <Text style={[styles.modalTextBtnLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={saveReopen}
                disabled={sheetSaving || !reopenNote.trim()}
                accessibilityRole="button"
                accessibilityLabel="Reopen the source and mark it safe"
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  (sheetSaving || !reopenNote.trim()) && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.modalPrimaryLabel, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {sheetSaving ? 'Reopening…' : 'Reopen — mark safe'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────
//  SourceRow — droplet + name, location, water pill,
//  and an honest caption line. ≥64dp touch target.
// ─────────────────────────────────────────────────────
const SourceRow: React.FC<{
  source: WaterSourceRecord;
  flaggedRow?: boolean;
  onPress: () => void;
}> = ({ source, flaggedRow, onPress }) => {
  const { colors } = useTheme();
  const waterColor = getWaterQualityColor(source.current_status, colors);

  let caption: string;
  if (flaggedRow) {
    const flaggedFor = daysSince(source.flagged_at);
    const delta = dueDelta(source.retest_due_date);
    const flagBit =
      flaggedFor === null ? 'Flagged' : flaggedFor === 0 ? 'Flagged today' : `Flagged ${flaggedFor}d ago`;
    const retestBit = source.retest_due_date
      ? delta != null && delta < 0
        ? `retest overdue ${Math.abs(delta)}d`
        : delta === 0
          ? 'retest due today'
          : `retest due ${formatDue(source.retest_due_date)}`
      : 'no retest assigned';
    caption = `${flagBit} · ${retestBit}`;
  } else {
    const bits = [
      source.last_ph != null ? `pH ${source.last_ph}` : null,
      source.last_turbidity != null ? `${source.last_turbidity} NTU` : null,
      source.last_reported_at ? agoLabel(source.last_reported_at) : null,
    ].filter(Boolean);
    caption = bits.length > 0 ? bits.join(' · ') : 'No readings yet';
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${source.source_name}, ${source.location_name ?? source.district}, water quality ${source.current_status}. ${caption}`}
      style={({ pressed }) => [
        rowStyles.row,
        {
          backgroundColor: pressed ? colors.cardHover : colors.card,
          borderColor: colors.border,
        },
        flaggedRow && { borderLeftWidth: 3, borderLeftColor: waterColor },
      ]}
    >
      <View style={[rowStyles.icon, { backgroundColor: waterColor + '14' }]}>
        <Ionicons name="water" size={20} color={waterColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[rowStyles.title, { color: colors.text }]} numberOfLines={1}>
          {source.source_name}
        </Text>
        <Text style={[rowStyles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {[source.location_name, source.district].filter(Boolean).join(' · ')}
        </Text>
        <Text
          style={[
            rowStyles.caption,
            { color: flaggedRow ? waterColor : colors.textTertiary },
            { fontVariant: ['tabular-nums'] },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {caption}
        </Text>
      </View>
      <StatusBadge status={source.current_status} type="water" size="small" />
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────
//  PromiseStep — one rung of the MUI-style vertical
//  stepper, flattened to Bharosa tokens.
// ─────────────────────────────────────────────────────
const PromiseStep: React.FC<{
  title: string;
  meta?: string;
  done?: boolean;
  overdue?: boolean;
  first?: boolean;
  last?: boolean;
  action?: { label: string; onPress: () => void };
}> = ({ title, meta, done, overdue, first, last, action }) => {
  const { colors } = useTheme();
  const dotColor = done ? colors.success : overdue ? colors.waterUnsafe : colors.textTertiary;
  return (
    <View style={stepStyles.wrap}>
      <View style={stepStyles.rail}>
        {!first && <View style={[stepStyles.line, { backgroundColor: colors.border }]} />}
        <View
          style={[
            stepStyles.dot,
            done
              ? { backgroundColor: dotColor, borderColor: dotColor }
              : { backgroundColor: 'transparent', borderColor: dotColor },
          ]}
        >
          {done && <Ionicons name="checkmark" size={12} color={colors.textInverse} />}
        </View>
        {!last && <View style={[stepStyles.lineGrow, { backgroundColor: colors.border }]} />}
      </View>
      <View style={stepStyles.body}>
        <Text
          style={[
            stepStyles.title,
            { color: done ? colors.text : overdue ? colors.waterUnsafe : colors.textSecondary },
          ]}
        >
          {title}
        </Text>
        {!!meta && (
          <Text style={[stepStyles.meta, { color: colors.textSecondary }]}>{meta}</Text>
        )}
        {action && (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [
              stepStyles.actionBtn,
              {
                backgroundColor: pressed ? colors.cardHover : colors.card,
                borderColor: colors.primary,
              },
            ]}
          >
            <Text style={[stepStyles.actionText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  BeforeAfterTable — the well's receipt (E·03).
//  Numbers in ink, tabular; only status words colored.
// ─────────────────────────────────────────────────────
const BeforeAfterTable: React.FC<{
  beforePh: number | null | undefined;
  beforeNtu: number | null | undefined;
  afterPh: number | null | undefined;
  afterNtu: number | null | undefined;
}> = ({ beforePh, beforeNtu, afterPh, afterNtu }) => {
  const { colors } = useTheme();
  const rows: Array<{ label: string; before: string; after: string; colored?: boolean }> = [];
  if (beforePh != null || afterPh != null) {
    rows.push({ label: 'pH', before: formatPh(beforePh), after: formatPh(afterPh) });
  }
  if (beforeNtu != null || afterNtu != null) {
    rows.push({
      label: 'Turbidity',
      before: beforeNtu != null ? `${beforeNtu} NTU` : '—',
      after: afterNtu != null ? `${afterNtu} NTU` : '—',
    });
  }
  rows.push({ label: 'Status', before: 'Unsafe', after: 'Safe · reopened', colored: true });

  return (
    <View
      style={[baStyles.table, { borderColor: colors.border }]}
      accessible
      accessibilityLabel={rows
        .map((r) => `${r.label}: ${r.before} before, ${r.after} after`)
        .join('. ')}
    >
      <Text style={[baStyles.eyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        BEFORE → AFTER
      </Text>
      {rows.map((r, idx) => (
        <View
          key={r.label}
          style={[
            baStyles.row,
            idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
          ]}
        >
          <Text style={[baStyles.label, { color: colors.textSecondary }]}>{r.label}</Text>
          <Text
            style={[
              baStyles.value,
              { color: r.colored ? colors.waterUnsafe : colors.text },
            ]}
            maxFontSizeMultiplier={1.3}
          >
            {r.before}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.textTertiary} />
          <Text
            style={[
              baStyles.value,
              { color: r.colored ? colors.success : colors.text },
            ]}
            maxFontSizeMultiplier={1.3}
          >
            {r.after}
          </Text>
        </View>
      ))}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  /* ── Header ── */
  header: {
    // No status-bar inset here — MainApp's SafeAreaView already provides it.
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  eyebrow: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: spacing.md,
  },
  eyebrowInCard: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: spacing.md,
  },

  /* ── Detail identity card ── */
  card: { borderWidth: 1, borderRadius: radii.md, padding: spacing.lg },
  identityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sourceTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  sourceMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  readingsRow: {
    flexDirection: 'row', alignItems: 'stretch',
    borderTopWidth: 1, marginTop: spacing.lg, paddingTop: spacing.lg,
  },
  readingCell: { flex: 1, gap: 2 },
  readingDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: spacing.md },
  readingValue: {
    fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  readingLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  readingWord: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },

  notifyCaption: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.lg },
  bodyText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  captionText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Recent readings list ── */
  readingList: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  readingRowItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56,
  },
  readingTick: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  readingItemTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  readingItemMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  /* ── Bottom action ── */
  primaryBtn: {
    minHeight: 56, borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  primaryBtnText: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  consequence: {
    fontSize: 12, lineHeight: 16, fontWeight: '500',
    marginTop: spacing.xs, textAlign: 'center',
  },
  btnDisabled: { opacity: 0.4 },

  /* ── Sheets ── */
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: {
    width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg,
  },
  modalTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  modalBody: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginTop: spacing.xs },
  modalLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  modalInput: {
    minHeight: 72, borderWidth: 1.5, borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, lineHeight: 22, textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg,
  },
  modalTextBtn: {
    minHeight: 48, minWidth: 88, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  modalTextBtnLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  modalPrimaryBtn: {
    minHeight: 48, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  modalPrimaryLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700' },

  chipRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  dateChip: {
    minHeight: 48, borderRadius: radii.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  dateChipText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },

  assigneeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 48, borderWidth: 1.5, borderRadius: radii.md,
    paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  assigneeName: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  assigneeHint: { fontSize: 12, lineHeight: 16, fontWeight: '600' },

  inlineErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  inlineErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  warnCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md,
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderRadius: radii.md,
    padding: spacing.md, marginBottom: spacing.sm, minHeight: 64,
  },
  icon: {
    width: 44, height: 44, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 2 },
});

const stepStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 24, alignItems: 'center' },
  line: { width: 2, height: spacing.sm },
  lineGrow: { width: 2, flex: 1 },
  dot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, paddingBottom: spacing.lg },
  title: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  actionBtn: {
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5, alignSelf: 'flex-start',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.lg, marginTop: spacing.sm,
  },
  actionText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});

const baStyles = StyleSheet.create({
  table: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  eyebrow: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: 36, paddingVertical: spacing.xs,
  },
  label: { width: 76, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  value: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
