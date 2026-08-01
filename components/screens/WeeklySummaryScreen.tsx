// =====================================================
// WEEKLY SUMMARY SCREEN (Bharosa D·03)
// "Weekly summary → WhatsApp": one district, one ISO
// week, styled like a printed report. The summary card
// wears a 2px border and the ✓ VERIFIED DATA stamp —
// every figure comes from human-approved rows only.
// Share paths: PDF via expo-print + expo-sharing on
// native, navigator.share / clipboard on web, and a
// plain-text caption for low-data recipients.
// 4-state data region; zeros here are real zeros.
// =====================================================
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import {
  buildSummaryHtml,
  buildWeeklySummary,
  buildWhatsAppCaption,
  formatAckRate,
  formatCasesDelta,
  MAX_WEEKS_BACK,
  WeeklySummary,
} from '../../lib/services/weeklySummary';

interface ShareStatus {
  kind: 'success' | 'error';
  text: string;
}

type BusyAction = 'whatsapp' | 'pdf' | 'text' | null;

export default function WeeklySummaryScreen({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  const { colors } = useTheme();

  const district = (profile.district ?? '').trim();
  const [weekOffset, setWeekOffset] = useState(0);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);

  const load = useCallback(async () => {
    if (!district) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const data = await buildWeeklySummary(district, weekOffset);
      setSummary(data);
    } catch {
      setError("Couldn't load the weekly summary — check connection.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [district, weekOffset]);

  useEffect(() => {
    setLoading(true);
    setShareStatus(null);
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ── Sharing ─────────────────────────────────────────
  const copyCaptionOnWeb = async (caption: string): Promise<boolean> => {
    try {
      const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(caption);
        return true;
      }
    } catch {
      // fall through — caller reports the failure honestly
    }
    return false;
  };

  const sharePdfNative = async (dialogTitle: string) => {
    if (!summary) return;
    const html = buildSummaryHtml(summary);
    const { uri } = await Print.printToFileAsync({ html });
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      throw new Error('sharing-unavailable');
    }
    await Sharing.shareAsync(uri, {
      dialogTitle,
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    });
  };

  const handleShareWhatsApp = async () => {
    if (!summary || busy) return;
    setShareStatus(null);
    setBusy('whatsapp');
    try {
      const caption = buildWhatsAppCaption(summary);
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        if (nav?.share) {
          await nav.share({ text: caption });
          setShareStatus({ kind: 'success', text: 'Share sheet opened — pick WhatsApp.' });
        } else if (await copyCaptionOnWeb(caption)) {
          setShareStatus({
            kind: 'success',
            text: 'Caption copied — paste it into WhatsApp Web.',
          });
        } else {
          setShareStatus({
            kind: 'error',
            text: "Couldn't open sharing or copy here — use the mobile app to share.",
          });
        }
      } else {
        await sharePdfNative('Share weekly summary');
        setShareStatus({
          kind: 'success',
          text: 'PDF ready to send. Use "Share as text" for low-data recipients.',
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // The user closed the share sheet — not an error.
        setBusy(null);
        return;
      }
      setShareStatus({
        kind: 'error',
        text: "Couldn't share the summary — try again, or use Share as text.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSavePdf = async () => {
    if (!summary || busy) return;
    setShareStatus(null);
    setBusy('pdf');
    try {
      if (Platform.OS === 'web') {
        const caption = buildWhatsAppCaption(summary);
        if (await copyCaptionOnWeb(caption)) {
          setShareStatus({
            kind: 'success',
            text: 'PDF export needs the mobile app — the text caption was copied instead.',
          });
        } else {
          setShareStatus({
            kind: 'error',
            text: 'PDF export needs the mobile app, and copying the caption failed here.',
          });
        }
      } else {
        await sharePdfNative('Save weekly summary PDF');
        setShareStatus({
          kind: 'success',
          text: 'PDF generated — choose "Save to Files" (or a drive app) in the sheet.',
        });
      }
    } catch {
      setShareStatus({
        kind: 'error',
        text: "Couldn't create the PDF — try again in a moment.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleShareText = async () => {
    if (!summary || busy) return;
    setShareStatus(null);
    setBusy('text');
    try {
      const caption = buildWhatsAppCaption(summary);
      if (Platform.OS === 'web') {
        if (await copyCaptionOnWeb(caption)) {
          setShareStatus({ kind: 'success', text: 'Caption copied to clipboard.' });
        } else {
          setShareStatus({ kind: 'error', text: "Couldn't copy the caption here." });
        }
      } else {
        await Share.share({ message: caption });
        setShareStatus({ kind: 'success', text: 'Caption ready to send.' });
      }
    } catch {
      setShareStatus({ kind: 'error', text: "Couldn't share the text caption." });
    } finally {
      setBusy(null);
    }
  };

  // ── Header ink — headerBg is a mode-appropriate SURFACE (paper in light,
  // dark surface in dark), so plain ink reads in BOTH modes. No textInverse here.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  const atCurrentWeek = weekOffset <= 0;
  const atOldestWeek = weekOffset >= MAX_WEEKS_BACK;

  const deltaColor =
    summary && summary.casesDelta > 0
      ? colors.danger
      : summary && summary.casesDelta < 0
        ? colors.success
        : colors.textSecondary;

  const quietWeek =
    !!summary &&
    summary.newCasesApproved === 0 &&
    summary.deaths === 0 &&
    summary.activeOutbreaks.count === 0 &&
    summary.waterUnsafe === 0 &&
    summary.waterRetestedSafe === 0 &&
    summary.alertsIssued === 0;

  const StatRow: React.FC<{
    label: string;
    value: string;
    valueColor?: string;
    suffix?: string;
    suffixColor?: string;
    last?: boolean;
  }> = ({ label, value, valueColor, suffix, suffixColor, last }) => (
    <View
      style={[styles.statRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}
      accessible
      accessibilityLabel={`${label}: ${value}${suffix ? `, ${suffix}` : ''}`}
    >
      <Text style={[styles.statLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      <View style={styles.statValueWrap}>
        <Text
          style={[styles.statValue, { color: valueColor ?? colors.text }]}
          maxFontSizeMultiplier={1.3}
        >
          {value}
        </Text>
        {!!suffix && (
          <Text
            style={[styles.statSuffix, { color: suffixColor ?? colors.textSecondary }]}
            maxFontSizeMultiplier={1.3}
          >
            {suffix}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header band ── */}
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
          <Text style={[styles.headerTitle, { color: headerText }]} maxFontSizeMultiplier={1.3}>
            Weekly summary
          </Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]} numberOfLines={1}>
            {district ? `${district} · verified data only` : 'Verified data only'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {!district ? (
          <View style={{ marginTop: 12 }}>
            <EmptyState
              icon="location-outline"
              color={colors.warning}
              title="No district on your profile"
              subtitle="Weekly summaries are per-district. Ask your administrator to set a district on your account, then return here."
            />
          </View>
        ) : (
          <>
            {/* ── Week navigation ── */}
            <View style={[styles.weekNav, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Pressable
                onPress={() => !atOldestWeek && setWeekOffset((w) => Math.min(MAX_WEEKS_BACK, w + 1))}
                disabled={atOldestWeek || loading}
                accessibilityRole="button"
                accessibilityLabel="Previous week"
                accessibilityState={{ disabled: atOldestWeek || loading }}
                style={({ pressed }) => [
                  styles.weekNavBtn,
                  { backgroundColor: pressed ? colors.cardHover : 'transparent' },
                  (atOldestWeek || loading) && styles.disabled,
                ]}
              >
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <View style={styles.weekNavCenter} accessibilityLiveRegion="polite">
                <Text style={[styles.weekNavLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {summary ? summary.weekLabel : `Week of record`}
                </Text>
                <Text style={[styles.weekNavMeta, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {atCurrentWeek ? 'Current week' : `${weekOffset} week${weekOffset === 1 ? '' : 's'} back`}
                  {atOldestWeek ? ' · oldest available' : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => !atCurrentWeek && setWeekOffset((w) => Math.max(0, w - 1))}
                disabled={atCurrentWeek || loading}
                accessibilityRole="button"
                accessibilityLabel="Next week"
                accessibilityState={{ disabled: atCurrentWeek || loading }}
                style={({ pressed }) => [
                  styles.weekNavBtn,
                  { backgroundColor: pressed ? colors.cardHover : 'transparent' },
                  (atCurrentWeek || loading) && styles.disabled,
                ]}
              >
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>

            {/* ── 4-state data region ── */}
            {loading ? (
              <View style={{ gap: 12 }}>
                <SkeletonBlock height={380} radius={12} />
                <SkeletonBlock height={56} radius={12} />
                <SkeletonBlock height={56} radius={12} />
              </View>
            ) : error ? (
              <ErrorCard message={error} onRetry={load} />
            ) : summary ? (
              <>
                {/* ── THE SUMMARY CARD — printed-report style, 2px border ── */}
                <View
                  style={[
                    styles.summaryCard,
                    { backgroundColor: colors.card, borderColor: colors.borderStrong },
                  ]}
                >
                  <Text style={[styles.cardEyebrow, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    HEALTHDROP WEEKLY · {summary.weekTag}
                  </Text>
                  <Text style={[styles.cardMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    {summary.rangeLabel} · {summary.district}
                  </Text>
                  <View style={[styles.cardRule, { backgroundColor: colors.borderStrong }]} />

                  <StatRow
                    label="New cases (approved)"
                    value={String(summary.newCasesApproved)}
                    suffix={formatCasesDelta(summary)}
                    suffixColor={deltaColor}
                  />
                  {summary.topDiseases.length > 0 ? (
                    <StatRow
                      label={summary.topDiseases.map((d) => d.name).join(' / ')}
                      value={summary.topDiseases.map((d) => d.count).join(' / ')}
                    />
                  ) : (
                    <StatRow label="Top diseases" value="—" suffix="no approved cases this week" />
                  )}
                  <StatRow label="Deaths" value={String(summary.deaths)} />
                  <StatRow
                    label="Active outbreaks"
                    value={String(summary.activeOutbreaks.count)}
                    suffix={
                      summary.activeOutbreaks.count > 0
                        ? summary.activeOutbreaks.items
                            .map((o) => `${o.shortId} · day ${o.dayAge}`)
                            .join('  ')
                        : undefined
                    }
                  />
                  <StatRow
                    label="Water: unsafe / retested-safe"
                    value={`${summary.waterUnsafe} / ${summary.waterRetestedSafe}`}
                  />
                  <StatRow
                    label="Alerts issued / ack rate"
                    value={`${summary.alertsIssued} / ${formatAckRate(summary)}`}
                    suffix={
                      summary.ackRate !== null && summary.fieldStaffCount !== null
                        ? `${summary.ackCount} of ${summary.fieldStaffCount} field staff`
                        : summary.alertsIssued > 0 && summary.fieldStaffCount === null
                          ? 'field-staff count unavailable'
                          : undefined
                    }
                    last
                  />

                  {quietWeek && (
                    <View style={styles.quietRow}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                      <Text style={[styles.quietText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                        A genuinely quiet week — these zeros are verified, not missing data.
                      </Text>
                    </View>
                  )}

                  {/* ── The ✓ VERIFIED DATA stamp ── */}
                  <View
                    style={[styles.stamp, { borderColor: colors.success }]}
                    accessible
                    accessibilityLabel="Verified data. All figures from human-approved reports only."
                  >
                    <Text style={[styles.stampTitle, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                      ✓ VERIFIED DATA
                    </Text>
                    <Text style={[styles.stampSub, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                      All figures from human-approved reports only
                    </Text>
                  </View>
                </View>

                {/* ── Share status — inline, never a popup ── */}
                {shareStatus && (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.statusRow,
                      shareStatus.kind === 'success'
                        ? { backgroundColor: colors.successBg, borderColor: colors.success }
                        : { backgroundColor: colors.dangerBg, borderColor: colors.danger },
                    ]}
                  >
                    <Ionicons
                      name={shareStatus.kind === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                      size={18}
                      color={shareStatus.kind === 'success' ? colors.success : colors.danger}
                    />
                    <Text style={[styles.statusText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {shareStatus.text}
                    </Text>
                  </View>
                )}

                {/* ── Actions ── */}
                <Pressable
                  onPress={handleShareWhatsApp}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel="Share on WhatsApp"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
                    busy && styles.disabled,
                  ]}
                >
                  {busy === 'whatsapp' ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Ionicons name="logo-whatsapp" size={20} color={colors.onPrimary} />
                  )}
                  <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                    Share on WhatsApp
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleSavePdf}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel="Save PDF"
                  style={({ pressed }) => [
                    styles.outlineBtn,
                    {
                      borderColor: colors.inputBorder,
                      backgroundColor: pressed ? colors.cardHover : 'transparent',
                    },
                    busy && styles.disabled,
                  ]}
                >
                  {busy === 'pdf' ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <Ionicons name="document-outline" size={20} color={colors.text} />
                  )}
                  <Text style={[styles.outlineBtnText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    Save PDF
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleShareText}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel="Share as text"
                  style={({ pressed }) => [styles.textLink, pressed && { opacity: 0.7 }, busy && styles.disabled]}
                >
                  <Text style={[styles.textLinkLabel, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                    {Platform.OS === 'web' ? 'Copy caption as text' : 'Share as text'}
                  </Text>
                </Pressable>

                <Text style={[styles.footnote, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  Goes as a document + a plain-text caption for low-data recipients.
                </Text>
              </>
            ) : null}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    // No status-bar inset here — MainApp's SafeAreaView already provides it.
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: 4,
    minHeight: 56,
  },
  weekNavBtn: {
    width: 48,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavCenter: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  weekNavLabel: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  weekNavMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  summaryCard: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
  },
  cardMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  cardRule: {
    height: 1,
    marginTop: 12,
    marginBottom: 2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
    paddingVertical: 8,
  },
  statLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  statValueWrap: {
    flexShrink: 1,
    alignItems: 'flex-end',
    gap: 2,
    maxWidth: '55%',
  },
  statValue: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  statSuffix: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  quietText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  stamp: {
    borderWidth: 2,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 16,
    alignSelf: 'flex-start',
    transform: [{ rotate: '-1.2deg' }],
  },
  stampTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  stampSub: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  primaryBtn: {
    minHeight: 56,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  primaryBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  outlineBtn: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  outlineBtnText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  textLink: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLinkLabel: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  footnote: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  disabled: {
    opacity: 0.4,
  },
});
