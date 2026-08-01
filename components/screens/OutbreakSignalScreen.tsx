// =====================================================
// OUTBREAK SIGNAL SCREEN — Bharosa D·01
// Review of an AUTO-DETECTED outbreak signal. The gear
// badge wears warning amber (rule-based, not AI — never
// violet; red is reserved for confirmed danger). Every
// input is a human-approved report, listed by name.
// Three exits, each with its consequence in words.
// Four-state data regions throughout.
// =====================================================
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
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
import { DiseaseReport, Profile } from '../../types';
import { useTheme, radii, spacing } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock, getSeverityColor } from '../dashboards/DashboardShared';
import {
  Outbreak,
  OutbreakThreshold,
  OUTBREAK_CONFIRM_MARKER,
  outbreaksService,
} from '../../lib/services/outbreaks';

const OUTBREAK_ERROR = "Couldn't load this signal — check connection.";
const REPORTS_ERROR = "Couldn't load the contributing reports — check connection.";

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

/** Local YYYY-MM-DD key for day bucketing. */
const dayKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

interface DayBar {
  key: string;
  label: string;
  cases: number;
}

type ActingState = null | 'confirm' | 'monitor' | 'dismiss';

export default function OutbreakSignalScreen({
  profile,
  outbreakId,
  onBack,
  onOpenConsole,
}: {
  profile: Profile;
  outbreakId: string;
  onBack: () => void;
  /** Optional: navigate to the response console after Confirm. Falls back to onBack. */
  onOpenConsole?: (id: string) => void;
}) {
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outbreak, setOutbreak] = useState<Outbreak | null>(null);

  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reports, setReports] = useState<DiseaseReport[]>([]);
  const [threshold, setThreshold] = useState<OutbreakThreshold | null>(null);

  const [acting, setActing] = useState<ActingState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissNote, setDismissNote] = useState('');

  const loadReports = async (ob: Outbreak) => {
    setReportsError(null);
    setReportsLoading(true);
    const [reportsRes, thresholdRes] = await Promise.all([
      outbreaksService.contributingReports(ob),
      outbreaksService.getThreshold(ob.disease_name),
    ]);
    if (reportsRes.error || !reportsRes.data) {
      setReportsError(REPORTS_ERROR);
      setReports([]);
    } else {
      setReports(reportsRes.data);
    }
    // The rule caption degrades gracefully — a missing threshold row
    // is not an error state, the rule text just gets less specific.
    setThreshold(thresholdRes.data ?? null);
    setReportsLoading(false);
  };

  const load = async () => {
    setError(null);
    const res = await outbreaksService.getById(outbreakId);
    if (res.error || !res.data) {
      setError(OUTBREAK_ERROR);
      setLoading(false);
      setReportsLoading(false);
      return;
    }
    setOutbreak(res.data);
    setLoading(false);
    await loadReports(res.data);
  };

  useEffect(() => {
    load();
  }, [outbreakId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const retry = () => {
    setLoading(true);
    setReportsLoading(true);
    load();
  };

  // ── Derived stats — every number is from human-approved data ──
  const villages = useMemo(() => {
    const names = new Set<string>();
    reports.forEach((r) => {
      const v = (r.location_name ?? '').trim();
      if (v) names.add(v.toLowerCase());
    });
    if (names.size > 0) return names.size;
    const districts = new Set(reports.map((r) => (r.district ?? '').trim().toLowerCase()).filter(Boolean));
    return districts.size;
  }, [reports]);

  const reporters = useMemo(
    () => new Set(reports.map((r) => r.reporter_id).filter(Boolean)).size,
    [reports],
  );

  const bars: DayBar[] = useMemo(() => {
    if (!outbreak) return [];
    const start = new Date(outbreak.window_start);
    const rawEnd = outbreak.status === 'resolved' && outbreak.window_end
      ? new Date(outbreak.window_end)
      : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(rawEnd.getTime())) return [];

    const byDay = new Map<string, number>();
    reports.forEach((r) => {
      const d = new Date(r.created_at);
      if (Number.isNaN(d.getTime())) return;
      const key = dayKey(d);
      byDay.set(key, (byDay.get(key) ?? 0) + (r.cases_count || 0));
    });

    const days: DayBar[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(rawEnd.getFullYear(), rawEnd.getMonth(), rawEnd.getDate());
    while (cursor.getTime() <= endDay.getTime() && days.length < 60) {
      const key = dayKey(cursor);
      days.push({
        key,
        label: cursor.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        cases: byDay.get(key) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days.slice(-14); // last 14 days at most
  }, [outbreak, reports]);

  const maxBar = useMemo(() => Math.max(1, ...bars.map((b) => b.cases)), [bars]);

  const ruleText = threshold
    ? `Rule: ${threshold.case_threshold}+ approved cases in ${threshold.window_days} days`
    : 'Rule: approved case count crossed the threshold';

  const windowLabel = threshold ? `${threshold.window_days}d window` : 'window';

  // ── Actions ──
  const runAction = async (kind: Exclude<ActingState, null>) => {
    if (!outbreak || acting) return;
    setActing(kind);
    setActionError(null);
    let res;
    if (kind === 'confirm') {
      res = await outbreaksService.updateStatus(
        outbreak.id,
        'active',
        `${OUTBREAK_CONFIRM_MARKER} — response console opened. No public alert was sent by this action.`,
      );
    } else if (kind === 'monitor') {
      res = await outbreaksService.updateStatus(
        outbreak.id,
        'monitoring',
        'Keeping this signal under monitoring — not confirmed yet.',
      );
    } else {
      const reason = dismissNote.trim();
      res = await outbreaksService.resolve(
        outbreak.id,
        reason ? `Dismissed as a false signal: ${reason}` : 'Dismissed as a false signal.',
      );
    }
    setActing(null);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Couldn't save your decision — check connection and try again.");
      return;
    }
    setDismissOpen(false);
    if (kind === 'confirm') {
      if (onOpenConsole) onOpenConsole(outbreak.id);
      else onBack();
    } else {
      onBack();
    }
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header — flat band + AUTO gear badge (amber, never violet/red) ── */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper still needs a hairline to read as separated.
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
          <View style={styles.headerTitleRow}>
            <Text style={[styles.headerTitle, { color: headerText }]} numberOfLines={1}>
              Signal review
            </Text>
            <View
              style={[styles.autoBadge, { backgroundColor: colors.warningBg }]}
              accessible
              accessibilityLabel="Auto-detected by a rule, not by a person"
            >
              <Ionicons name="settings-outline" size={12} color={colors.warning} />
              <Text style={[styles.autoBadgeText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
                AUTO
              </Text>
            </View>
          </View>
          <Text style={[styles.headerSubtitle, { color: headerSub }]} numberOfLines={1}>
            {outbreak
              ? `${outbreak.disease_name} · ${outbreak.district} · fired ${shortDateTime(outbreak.created_at)}`
              : 'Auto-detected outbreak signal'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Region 1: the signal itself ── */}
        {loading ? (
          <View style={{ gap: spacing.md }}>
            <SkeletonBlock height={76} radius={radii.md} />
            <SkeletonBlock height={122} radius={radii.md} />
            <SkeletonBlock height={180} radius={radii.md} />
          </View>
        ) : error || !outbreak ? (
          <ErrorCard message={error ?? OUTBREAK_ERROR} onRetry={retry} />
        ) : (
          <>
            {/* Rule card — amber left edge: a machine raised its hand */}
            <View
              style={[
                styles.ruleCard,
                { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.warning },
                !isDark && styles.cardShadow,
              ]}
            >
              <Text style={[styles.ruleTitle, { color: colors.text }]}>
                Possible {outbreak.disease_name.toLowerCase()} outbreak — {outbreak.district}
              </Text>
              <Text style={[styles.ruleMeta, { color: colors.textSecondary }]}>
                {ruleText} · window opened {shortDate(outbreak.window_start)}. This is not a public
                alert — nothing reaches villagers until a human decides.
              </Text>
            </View>

            {/* ── Region 2: the evidence (stats · chart · reports) ── */}
            {reportsLoading ? (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                <View style={styles.statsRow}>
                  <SkeletonBlock height={92} radius={radii.md} style={styles.skelStat} />
                  <SkeletonBlock height={92} radius={radii.md} style={styles.skelStat} />
                </View>
                <View style={styles.statsRow}>
                  <SkeletonBlock height={92} radius={radii.md} style={styles.skelStat} />
                  <SkeletonBlock height={92} radius={radii.md} style={styles.skelStat} />
                </View>
                <SkeletonBlock height={168} radius={radii.md} />
                <SkeletonBlock height={64} radius={radii.md} />
                <SkeletonBlock height={64} radius={radii.md} />
              </View>
            ) : reportsError ? (
              <View style={{ marginTop: spacing.md }}>
                <ErrorCard message={reportsError} onRetry={() => loadReports(outbreak)} />
              </View>
            ) : (
              <>
                {/* Stat grid — 2 per row, tabular ink numerals */}
                <View style={[styles.statsRow, { marginTop: spacing.md }]}>
                  <StatTile
                    value={outbreak.total_cases}
                    label={`cases · ${windowLabel}`}
                    rule={colors.danger}
                  />
                  <StatTile
                    value={outbreak.total_deaths}
                    label={outbreak.total_deaths === 1 ? 'death' : 'deaths'}
                    rule={colors.danger}
                  />
                </View>
                <View style={[styles.statsRow, { marginTop: spacing.sm }]}>
                  <StatTile
                    value={villages}
                    label={villages === 1 ? 'village' : 'villages'}
                    rule={colors.info}
                  />
                  <StatTile
                    value={reporters}
                    label={reporters === 1 ? 'reporter' : 'reporters'}
                    rule={colors.info}
                  />
                </View>

                {/* Bar chart — one ink series, labels in text tokens */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                    APPROVED CASES · BY DAY
                  </Text>
                </View>
                {bars.length === 0 || bars.every((b) => b.cases === 0) ? (
                  <View style={[styles.quietZero, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                    <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
                    <Text style={[styles.quietZeroText, { color: colors.textSecondary }]}>
                      No approved cases inside this window yet — the counts may still be syncing.
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}
                    accessible
                    accessibilityLabel={`Approved cases by day, ${bars.length} days, peak ${maxBar} cases in one day`}
                  >
                    <View style={styles.chartBars}>
                      {bars.map((bar) => {
                        const h = Math.max(bar.cases > 0 ? 6 : 2, Math.round((bar.cases / maxBar) * 104));
                        const showLabel = bar.cases > 0 && (bars.length <= 10 || bar.cases === maxBar);
                        return (
                          <View key={bar.key} style={styles.chartCol}>
                            {showLabel && (
                              <Text
                                style={[styles.chartValue, { color: colors.textSecondary }]}
                                maxFontSizeMultiplier={1.3}
                                numberOfLines={1}
                              >
                                {bar.cases}
                              </Text>
                            )}
                            <View
                              style={[
                                styles.chartBar,
                                {
                                  height: h,
                                  backgroundColor: bar.cases > 0 ? colors.chartLine : colors.chartGrid,
                                },
                              ]}
                            />
                          </View>
                        );
                      })}
                    </View>
                    <View style={[styles.chartBaseline, { backgroundColor: colors.border }]} />
                    <View style={styles.chartAxisRow}>
                      <Text style={[styles.chartAxisText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                        {bars[0]?.label ?? ''}
                      </Text>
                      <Text style={[styles.chartAxisText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                        {bars[bars.length - 1]?.label ?? ''}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Contributing reports — the human lineage of this signal */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                    CONTRIBUTING REPORTS — ALL HUMAN-APPROVED
                    <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${reports.length}`}</Text>
                  </Text>
                </View>
                {reports.length === 0 ? (
                  <EmptyState
                    icon="document-text-outline"
                    color={colors.success}
                    title="No matching approved reports"
                    subtitle="No approved reports for this disease and district fall inside the window."
                  />
                ) : (
                  <View
                    style={[styles.reportList, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}
                  >
                    {reports.map((r, idx) => (
                      <View
                        key={r.id}
                        style={[
                          styles.reportRow,
                          idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                        ]}
                        accessible
                        accessibilityLabel={`Report ${r.cases_count} cases${r.deaths_count ? `, ${r.deaths_count} deaths` : ''}, ${r.location_name || r.district}, by ${r.reporter?.full_name ?? 'unknown reporter'}`}
                      >
                        <View style={[styles.reportSevTick, { backgroundColor: getSeverityColor(r.severity, colors) }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reportTitle, { color: colors.text }]} numberOfLines={1}>
                            #{r.id.slice(0, 8)} · {r.cases_count} {r.cases_count === 1 ? 'case' : 'cases'}
                            {r.deaths_count > 0 ? `, ${r.deaths_count} ${r.deaths_count === 1 ? 'death' : 'deaths'}` : ''}
                            {' · '}{r.location_name || r.district}
                          </Text>
                          <Text style={[styles.reportMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                            {r.reporter?.full_name ?? 'Reporter'} · approved · {shortDateTime(r.created_at)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* ── Three exits, each with its consequence in words ── */}
            <View style={styles.actionsWrap}>
              {actionError && (
                <View style={[styles.actionErrorCard, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                  <Text style={[styles.actionErrorText, { color: colors.text }]}>{actionError}</Text>
                </View>
              )}

              <Pressable
                onPress={() => runAction('confirm')}
                disabled={acting !== null}
                accessibilityRole="button"
                accessibilityLabel="Confirm outbreak. Opens the response console. Does not alert the public by itself."
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  acting !== null && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {acting === 'confirm' ? 'Confirming…' : 'Confirm outbreak'}
                </Text>
              </Pressable>
              <Text style={[styles.consequence, { color: colors.textSecondary }]}>
                Confirming opens the response console. It does NOT alert the public by itself.
              </Text>

              <Pressable
                onPress={() => runAction('monitor')}
                disabled={acting !== null}
                accessibilityRole="button"
                accessibilityLabel="Keep monitoring. The signal stays open without confirming."
                style={({ pressed }) => [
                  styles.outlineBtn,
                  {
                    backgroundColor: pressed ? colors.cardHover : colors.card,
                    borderColor: colors.inputBorder,
                  },
                  acting !== null && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.outlineBtnText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {acting === 'monitor' ? 'Saving…' : 'Keep monitoring'}
                </Text>
              </Pressable>
              <Text style={[styles.consequence, { color: colors.textSecondary }]}>
                The signal stays open and keeps counting new approved cases. No one is alerted.
              </Text>

              <Pressable
                onPress={() => {
                  setActionError(null);
                  setDismissOpen(true);
                }}
                disabled={acting !== null}
                accessibilityRole="button"
                accessibilityLabel="Dismiss as a false signal"
                style={({ pressed }) => [
                  styles.outlineBtn,
                  {
                    backgroundColor: pressed ? colors.cardHover : colors.card,
                    borderColor: colors.danger,
                  },
                  acting !== null && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.outlineBtnText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                  Dismiss — false signal
                </Text>
              </Pressable>
              <Text style={[styles.consequence, { color: colors.textSecondary }]}>
                Marks this signal resolved as a false alarm — logged to the audit trail with your name.
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Dismiss confirmation — reason optional, decision logged ── */}
      <Modal
        visible={dismissOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDismissOpen(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Dismiss this signal?</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              It will be marked resolved as a false alarm and logged with your name and time.
            </Text>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>WHY IS IT FALSE? · OPTIONAL</Text>
            <TextInput
              value={dismissNote}
              onChangeText={setDismissNote}
              placeholder="e.g. Duplicate of last week's cluster, already resolved"
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
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setDismissOpen(false)}
                disabled={acting !== null}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [
                  styles.modalTextBtn,
                  pressed && { backgroundColor: colors.cardHover },
                ]}
              >
                <Text style={[styles.modalTextBtnLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => runAction('dismiss')}
                disabled={acting !== null}
                accessibilityRole="button"
                accessibilityLabel="Dismiss signal"
                style={({ pressed }) => [
                  styles.modalDangerBtn,
                  { backgroundColor: pressed ? colors.danger : colors.danger },
                  acting !== null && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.modalDangerLabel, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>
                  {acting === 'dismiss' ? 'Dismissing…' : 'Dismiss signal'}
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
//  StatTile — compact Big Number: tabular ink numeral
//  over a label, 3px semantic top rule. Two per row.
// ─────────────────────────────────────────────────────
const StatTile: React.FC<{ value: number; label: string; rule: string }> = ({ value, label, rule }) => {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={[
        styles.statTile,
        { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: rule },
        !isDark && styles.cardShadow,
      ]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={[styles.statValue, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
};

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
    // Rendered inside MainApp's SafeAreaView — no status-bar inset here.
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4, flexShrink: 1 },
  headerSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  autoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
  },
  autoBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },

  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  /* ── Rule card ── */
  ruleCard: {
    borderWidth: 1, borderLeftWidth: 3, borderRadius: radii.md,
    padding: spacing.lg, gap: spacing.xs,
  },
  ruleTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  ruleMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Stats ── */
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  skelStat: { flex: 1, width: 'auto' },
  statTile: {
    flex: 1, borderWidth: 1, borderTopWidth: 3, borderRadius: radii.md,
    padding: spacing.lg, minHeight: 92, justifyContent: 'flex-end',
  },
  statValue: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2 },

  /* ── Section headers ── */
  sectionHeaderRow: { marginTop: spacing.lg, marginBottom: spacing.md, minHeight: 20, justifyContent: 'center' },
  sectionTitle: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },

  /* ── Chart ── */
  chartCard: { borderWidth: 1, borderRadius: radii.md, padding: spacing.lg, paddingBottom: spacing.md },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 128 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  chartValue: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chartBar: { alignSelf: 'stretch', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartBaseline: { height: StyleSheet.hairlineWidth, marginTop: 0 },
  chartAxisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  chartAxisText: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  quietZero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.lg,
  },
  quietZeroText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Contributing reports ── */
  reportList: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  reportRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56,
  },
  reportSevTick: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  reportTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  reportMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  /* ── Actions ── */
  actionsWrap: { marginTop: spacing.xl },
  actionErrorCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md,
  },
  actionErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  primaryBtn: {
    minHeight: 56, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  primaryBtnText: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  outlineBtn: {
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  outlineBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  consequence: {
    fontSize: 12, lineHeight: 16, fontWeight: '500',
    marginTop: spacing.xs, marginBottom: spacing.md, textAlign: 'center',
  },

  /* ── Dismiss modal ── */
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
  modalDangerBtn: {
    minHeight: 48, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  modalDangerLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
});
