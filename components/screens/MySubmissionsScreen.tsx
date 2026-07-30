// =====================================================
// MY SUBMISSIONS SCREEN ("Prakash" design)
// Personal timeline of everything the signed-in user
// has filed — disease reports (reporter_id), water
// quality reports (reporter_id) and health alerts
// (created_by) — merged, newest first, with the
// approval status and, when rejected, the reviewer's
// reason in plain language. 4-state data region.
// No resubmit flow yet (roadmap).
// =====================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { SkeletonBlock, ErrorCard, EmptyState, SyncPebble, ROLE_ACCENT } from '../dashboards/DashboardShared';
import { Profile } from '../../types';

type SubmissionKind = 'disease' | 'water' | 'alert';

interface SubmissionRow {
  key: string;
  kind: SubmissionKind;
  title: string;
  meta: string;
  created_at: string;
  approval_status: string | null;
  rejection_reason: string | null;
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

const formatShortDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

const formatTimeOnly = (d: Date): string =>
  d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

// Defensive readers — rejection_reason and approval_status are selected via
// select('*') and may be absent on older schemas.
const str = (row: Record<string, unknown>, key: string): string | null => {
  const v = row[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
};

const buildMeta = (row: Record<string, unknown>): string =>
  [str(row, 'location_name'), str(row, 'district')].filter(Boolean).join(', ');

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
    bg = colors.dangerBg; fg = colors.danger; label = 'REJECTED'; spoken = 'sent back by the reviewer';
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
export default function MySubmissionsScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { colors, isDark, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  const [rows, setRows] = useState<SubmissionRow[]>([]);
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

    try {
      const [diseaseRes, waterRes, alertRes] = await Promise.all([
        supabase.from('disease_reports').select('*')
          .eq('reporter_id', profile.id)
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('water_quality_reports').select('*')
          .eq('reporter_id', profile.id)
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('health_alerts').select('*')
          .eq('created_by', profile.id)
          .order('created_at', { ascending: false }).limit(100),
      ]);

      if (diseaseRes.error) {
        console.error('[MySubmissions] disease query failed:', diseaseRes.error);
        failures.push('disease reports');
      } else {
        for (const r of (diseaseRes.data ?? []) as Record<string, unknown>[]) {
          collected.push({
            key: `disease-${String(r.id ?? collected.length)}`,
            kind: 'disease',
            title: str(r, 'disease_name') ?? 'Disease report',
            meta: buildMeta(r),
            created_at: str(r, 'created_at') ?? '',
            approval_status: str(r, 'approval_status'),
            rejection_reason: str(r, 'rejection_reason'),
          });
        }
      }

      if (waterRes.error) {
        console.error('[MySubmissions] water query failed:', waterRes.error);
        failures.push('water reports');
      } else {
        for (const r of (waterRes.data ?? []) as Record<string, unknown>[]) {
          collected.push({
            key: `water-${String(r.id ?? collected.length)}`,
            kind: 'water',
            title: str(r, 'source_name') ?? 'Water quality report',
            meta: buildMeta(r),
            created_at: str(r, 'created_at') ?? '',
            approval_status: str(r, 'approval_status'),
            rejection_reason: str(r, 'rejection_reason'),
          });
        }
      }

      if (alertRes.error) {
        console.error('[MySubmissions] alerts query failed:', alertRes.error);
        failures.push('health alerts');
      } else {
        for (const r of (alertRes.data ?? []) as Record<string, unknown>[]) {
          collected.push({
            key: `alert-${String(r.id ?? collected.length)}`,
            kind: 'alert',
            title: str(r, 'title') ?? 'Health alert',
            meta: buildMeta(r),
            created_at: str(r, 'created_at') ?? '',
            approval_status: str(r, 'approval_status'),
            rejection_reason: str(r, 'rejection_reason'),
          });
        }
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
    setFailedSources(failures);
    setAsOf(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [profile.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;
  const totalFailure = failedSources.length > 0 && rows.length === 0;

  // ── Row ──
  const renderItem = ({ item }: { item: SubmissionRow }) => {
    const rejected = (item.approval_status ?? '').toLowerCase() === 'rejected';
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
          Submitted {formatShortDateTime(item.created_at) || '—'}
        </Text>

        {rejected && (
          <View style={[ms.rejectBox, { backgroundColor: colors.dangerBg }]}>
            <View style={ms.rejectHead}>
              <Ionicons name="arrow-undo-outline" size={16} color={colors.danger} />
              <Text style={[ms.rejectTitle, { color: colors.text }]}>Sent back — needs changes</Text>
            </View>
            <Text style={[ms.rejectReason, { color: colors.text }]}>
              {item.rejection_reason ?? 'No reason was recorded — ask your supervisor for details.'}
            </Text>
            <Text style={[ms.rejectFootnote, { color: colors.textSecondary }]}>
              Fixing and resubmitting from here is coming soon.
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
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
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
                        As of {formatTimeOnly(asOf)}
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
    paddingHorizontal: spacing.lg, paddingTop: 42, paddingBottom: spacing.xl,
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

  /* Rejection framing — plain language, soft dangerBg (no flood fill) */
  rejectBox: { borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  rejectHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rejectTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  rejectReason: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  rejectFootnote: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
