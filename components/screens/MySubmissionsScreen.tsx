// =====================================================
// MY REPORTS — Bharosa A·06 (status & the WHY)
// Personal timeline of everything the signed-in user
// has filed — disease reports (reporter_id), water
// quality reports (reporter_id) and health alerts
// (created_by) — merged, newest first. Rejection is
// "Not accepted" + the officer's exact words, name and
// time — and always a path forward (Fix & refile).
// Approval pays her back: the stamp, and — when the
// report fell inside an outbreak window — proof it
// became protection. 4-state data region.
// =====================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  RefreshControl, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { formatDateTime, formatTime } from '../../lib/format';
import { SkeletonBlock, ErrorCard, EmptyState, SyncPebble, VerifiedStamp, ROLE_ACCENT } from '../dashboards/DashboardShared';
import { Profile } from '../../types';

type SubmissionKind = 'disease' | 'water' | 'alert';

interface SubmissionRow {
  key: string;
  id: string;
  kind: SubmissionKind;
  title: string;
  meta: string;
  created_at: string;
  updated_at: string | null;
  approval_status: string | null;
  rejection_reason: string | null;
  approver_name: string | null;
  approved_at: string | null;
}

/** A·06 payback — the approved disease report fed an outbreak window. */
interface OutbreakPayback {
  district: string;
  disease: string;
  alertSent: boolean;
}

interface OutbreakLite {
  disease_name: string | null;
  district: string | null;
  window_start: string | null;
  window_end: string | null;
  alert_sent: boolean | null;
  triggered_by_report_id: string | null;
}

const KIND_LABEL: Record<SubmissionKind, string> = {
  disease: 'Disease report',
  water:   'Water quality report',
  alert:   'Health alert',
};

const KIND_ICON: Record<SubmissionKind, keyof typeof Ionicons.glyphMap> = {
  disease: 'medkit-outline',
  water:   'water-outline',
  alert:   'alert-circle-outline',
};

// Defensive readers — rejection_reason and approval_status are selected via
// select('*') and may be absent on older schemas.
const str = (row: Record<string, unknown>, key: string): string | null => {
  const v = row[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
};

const approverNameOf = (row: Record<string, unknown>): string | null => {
  const a = row.approver as { full_name?: unknown } | null | undefined;
  return a && typeof a.full_name === 'string' && a.full_name.trim().length > 0
    ? a.full_name.trim()
    : null;
};

const buildMeta = (row: Record<string, unknown>): string =>
  [str(row, 'location_name'), str(row, 'district')].filter(Boolean).join(', ');

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

// ─────────────────────────────────────────────────────
//  Approval pill — dot + UPPERCASE label on *Bg token
// ─────────────────────────────────────────────────────
const ApprovalPill: React.FC<{ status: string | null }> = ({ status }) => {
  const { colors } = useTheme();
  const s = (status ?? '').toLowerCase();

  let bg = colors.surfaceVariant;
  let fg = colors.textSecondary;
  let label = 'SUBMITTED';
  let spoken = 'submitted';

  if (s === 'pending_approval' || s === 'pending') {
    bg = colors.warningBg; fg = colors.warning; label = 'PENDING'; spoken = 'pending review';
  } else if (s === 'approved') {
    bg = colors.successBg; fg = colors.success; label = 'APPROVED'; spoken = 'approved';
  } else if (s === 'rejected') {
    bg = colors.dangerBg; fg = colors.danger; label = 'NOT ACCEPTED'; spoken = 'not accepted';
  }

  return (
    <View style={[ms.pill, { backgroundColor: bg }]} accessibilityLabel={`Review status: ${spoken}`}>
      <View style={[ms.pillDot, { backgroundColor: fg }]} />
      <Text style={[ms.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────
export default function MySubmissionsScreen({
  profile,
  onBack,
  onRefile,
}: {
  profile: Profile;
  onBack: () => void;
  /** A·06 — "Fix & refile" on rejected disease/water reports. */
  onRefile?: (type: 'disease' | 'water', reportId: string) => void;
}) {
  const { colors, isDark, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [payback, setPayback] = useState<Record<string, OutbreakPayback>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [asOf, setAsOf] = useState<Date | null>(null);

  // One entrance fade, 200ms, static under reduce-motion.
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  const load = useCallback(async () => {
    const failures: string[] = [];
    const collected: SubmissionRow[] = [];
    let paybackNext: Record<string, OutbreakPayback> = {};

    // Approver join (WHY — the officer's name); falls back to plain columns
    // on older schemas without the approved_by relationship.
    const queryOwn = async (
      table: 'disease_reports' | 'water_quality_reports' | 'health_alerts',
      ownerCol: string,
    ) => {
      const withApprover = await supabase.from(table)
        .select('*, approver:profiles!approved_by(full_name)')
        .eq(ownerCol, profile.id)
        .order('created_at', { ascending: false }).limit(100);
      if (!withApprover.error) return withApprover;
      return supabase.from(table)
        .select('*')
        .eq(ownerCol, profile.id)
        .order('created_at', { ascending: false }).limit(100);
    };

    try {
      const [diseaseRes, waterRes, alertRes] = await Promise.all([
        queryOwn('disease_reports', 'reporter_id'),
        queryOwn('water_quality_reports', 'reporter_id'),
        queryOwn('health_alerts', 'created_by'),
      ]);

      const pushRow = (
        r: Record<string, unknown>,
        kind: SubmissionKind,
        title: string,
      ) => {
        collected.push({
          key: `${kind}-${String(r.id ?? collected.length)}`,
          id: String(r.id ?? ''),
          kind,
          title,
          meta: buildMeta(r),
          created_at: str(r, 'created_at') ?? '',
          updated_at: str(r, 'updated_at'),
          approval_status: str(r, 'approval_status'),
          rejection_reason: str(r, 'rejection_reason'),
          approver_name: approverNameOf(r),
          approved_at: str(r, 'approved_at'),
        });
      };

      if (diseaseRes.error) {
        console.error('[MySubmissions] disease query failed:', diseaseRes.error);
        failures.push('disease reports');
      } else {
        for (const r of (diseaseRes.data ?? []) as Record<string, unknown>[]) {
          pushRow(r, 'disease', str(r, 'disease_name') ?? 'Disease report');
        }
      }

      if (waterRes.error) {
        console.error('[MySubmissions] water query failed:', waterRes.error);
        failures.push('water reports');
      } else {
        for (const r of (waterRes.data ?? []) as Record<string, unknown>[]) {
          pushRow(r, 'water', str(r, 'source_name') ?? 'Water quality report');
        }
      }

      if (alertRes.error) {
        console.error('[MySubmissions] alerts query failed:', alertRes.error);
        failures.push('health alerts');
      } else {
        for (const r of (alertRes.data ?? []) as Record<string, unknown>[]) {
          pushRow(r, 'alert', str(r, 'title') ?? 'Health alert');
        }
      }

      // ── A·06 payback — did an approved disease report feed an outbreak
      // window? One batched outbreaks query, matched client-side; degrades
      // silently when nothing matches or the table is unreachable.
      try {
        if (!diseaseRes.error) {
          const approvedDisease = ((diseaseRes.data ?? []) as Record<string, unknown>[])
            .filter((r) => norm(str(r, 'approval_status')) === 'approved');
          const districts = Array.from(new Set(
            approvedDisease.map((r) => str(r, 'district')).filter((d): d is string => !!d),
          ));

          if (approvedDisease.length > 0 && districts.length > 0) {
            const { data: outbreaks, error: obError } = await supabase
              .from('outbreaks')
              .select('disease_name, district, window_start, window_end, alert_sent, triggered_by_report_id')
              .in('district', districts)
              .order('created_at', { ascending: false })
              .limit(100);

            if (!obError && outbreaks) {
              for (const r of approvedDisease) {
                const id = String(r.id ?? '');
                if (!id) continue;
                const reportTime = new Date(str(r, 'created_at') ?? '').getTime();
                const match = (outbreaks as OutbreakLite[]).find((o) => {
                  if (o.triggered_by_report_id && String(o.triggered_by_report_id) === id) return true;
                  if (norm(o.disease_name) !== norm(str(r, 'disease_name'))) return false;
                  if (norm(o.district) !== norm(str(r, 'district'))) return false;
                  if (!Number.isFinite(reportTime)) return false;
                  const start = o.window_start ? new Date(o.window_start).getTime() : -Infinity;
                  const end = o.window_end ? new Date(o.window_end).getTime() : Infinity;
                  return reportTime >= start && reportTime <= end;
                });
                if (match) {
                  paybackNext[id] = {
                    district: (match.district ?? str(r, 'district') ?? '').trim(),
                    disease: (match.disease_name ?? str(r, 'disease_name') ?? '').trim(),
                    alertSent: match.alert_sent === true,
                  };
                }
              }
            }
          }
        }
      } catch (err) {
        // Payback is a bonus, never a blocker.
        console.error('[MySubmissions] outbreak payback check failed:', err);
        paybackNext = {};
      }
    } catch (err) {
      console.error('[MySubmissions] load failed:', err);
      failures.length = 0;
      failures.push('disease reports', 'water reports', 'health alerts');
    }

    collected.sort((a, b) => {
      const ta = new Date(a.created_at).getTime() || 0;
      const tb = new Date(b.created_at).getTime() || 0;
      return tb - ta;
    });

    setRows(collected);
    setPayback(paybackNext);
    setFailedSources(failures);
    setAsOf(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [profile.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;
  const totalFailure = failedSources.length > 0 && rows.length === 0;

  // ── Row ──
  const renderItem = ({ item }: { item: SubmissionRow }) => {
    const statusLower = (item.approval_status ?? '').toLowerCase();
    const rejected = statusLower === 'rejected';
    const approved = statusLower === 'approved';
    const paybackInfo = approved && item.kind === 'disease' ? payback[item.id] : undefined;
    const canRefile =
      rejected && !!onRefile && !!item.id && (item.kind === 'disease' || item.kind === 'water');
    const decidedAt = formatDateTime(item.approved_at ?? item.updated_at);

    return (
      <View style={[ms.card, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && ms.cardShadow]}>
        <View style={ms.cardRow}>
          <View style={[ms.iconWrap, { backgroundColor: colors.surfaceVariant }]}>
            <Ionicons name={KIND_ICON[item.kind]} size={24} color={colors.textSecondary} />
          </View>
          <View style={ms.cardBody}>
            <Text style={[ms.cardTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[ms.cardMeta, { color: colors.textSecondary }]} numberOfLines={2}>
              {KIND_LABEL[item.kind]}{item.meta ? ` · ${item.meta}` : ''}
            </Text>
          </View>
          <ApprovalPill status={item.approval_status} />
        </View>

        <Text style={[ms.cardDate, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
          Submitted {formatDateTime(item.created_at) || '—'}
        </Text>

        {/* ── A·06 — the WHY: the officer's exact words, name and time ── */}
        {rejected && (
          <View style={[ms.rejectBox, { backgroundColor: colors.dangerBg }]}>
            <Text style={[ms.whyEyebrow, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
              {`WHY — ${(item.approver_name ?? 'Reviewing officer').toUpperCase()}${decidedAt ? ` · ${decidedAt}` : ''}`}
            </Text>
            <Text style={[ms.rejectReason, { color: colors.text }]}>
              {item.rejection_reason
                ? `“${item.rejection_reason}”`
                : 'No reason was recorded — ask your reviewing officer for details.'}
            </Text>
            {canRefile && (
              <Pressable
                onPress={() => {
                  if (item.kind === 'disease' || item.kind === 'water') {
                    onRefile?.(item.kind, item.id);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Fix and refile this ${KIND_LABEL[item.kind].toLowerCase()}`}
                style={({ pressed }) => [
                  ms.refileBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                ]}
              >
                <Ionicons name="create-outline" size={18} color={colors.onPrimary} />
                <Text style={[ms.refileBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  Fix &amp; refile
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── A·06 — the payback: stamp + proof the report became protection ── */}
        {paybackInfo && (
          <View style={ms.paybackBox}>
            <VerifiedStamp
              verifierName={item.approver_name ?? 'Reviewing officer'}
              timestamp={formatDateTime(item.approved_at) || undefined}
            />
            <Text style={[ms.paybackCaption, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              {`Counted toward the ${paybackInfo.district} ${paybackInfo.disease.toLowerCase()} outbreak signal${paybackInfo.alertSent ? ' → district alert issued' : ''}`}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[ms.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg band + Role Ribbon */}
      <View
        style={[
          ms.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper still needs a hairline to read as separated.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={ms.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={ms.headerTextWrap}>
          <Text style={[ms.headerTitle, { color: headerText }]} numberOfLines={1}>My Submissions</Text>
          <Text style={[ms.headerSub, { color: headerSub }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            What you've filed and where it stands
          </Text>
        </View>
        <SyncPebble />
      </View>
      <View style={[ms.roleRibbon, { backgroundColor: accent }]} />

      <Animated.View style={{ flex: 1, opacity: fade }}>
        {/* 4-state region: skeleton / error / quiet zero / content */}
        {loading ? (
          <View style={ms.skeletonWrap}>
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
          </View>
        ) : totalFailure ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <ErrorCard message="Couldn't load your submissions — check connection" onRetry={load} />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            contentContainerStyle={ms.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListHeaderComponent={
              <View>
                {failedSources.length > 0 && (
                  <ErrorCard
                    message={`Couldn't load ${failedSources.join(' and ')} — check connection`}
                    onRetry={load}
                  />
                )}
                {rows.length > 0 && (
                  <View style={ms.eyebrowRow}>
                    <Text style={[ms.eyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                      SUBMISSION HISTORY
                      <Text style={ms.eyebrowCount}>{` · ${rows.length}`}</Text>
                    </Text>
                    {asOf && (
                      <Text style={[ms.asOf, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                        As of {formatTime(asOf)}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            }
            ListEmptyComponent={
              failedSources.length > 0 ? null : (
                <View style={{ paddingTop: spacing.lg }}>
                  <EmptyState
                    icon="document-text-outline"
                    color={colors.textSecondary}
                    title="Nothing filed yet."
                    subtitle="Disease reports, water tests and alerts you submit will appear here with their review status."
                  />
                </View>
              )
            }
          />
        )}
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────
const ms = StyleSheet.create({
  container: { flex: 1 },

  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    // Rendered inside MainApp's SafeAreaView, which already supplies the
    // status-bar inset — the old paddingTop: 42 double-counted it.
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2 },
  roleRibbon: { height: 4, width: '100%' },

  /* Eyebrow-and-count section header + as-of caption */
  eyebrowRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.sm, marginBottom: spacing.md, minHeight: 20, gap: spacing.sm,
  },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  eyebrowCount: { fontVariant: ['tabular-nums'] },
  asOf: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  /* Skeleton */
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },

  /* List */
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },

  /* Card */
  card: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.md,
    minHeight: 64,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  cardMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  cardDate: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: spacing.sm, fontVariant: ['tabular-nums'] },

  /* Approval pill */
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill, alignSelf: 'flex-start',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },

  /* A·06 WHY card — the officer's exact words, then a path forward */
  rejectBox: { borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  whyEyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  rejectReason: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  refileBtn: {
    minHeight: 48, borderRadius: radii.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.xs,
  },
  refileBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },

  /* A·06 payback — stamp + "counted toward the signal" caption */
  paybackBox: { marginTop: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
  paybackCaption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
});
