// =====================================================
// WEEKLY SUMMARY SCREEN (Bharosa D·03 · NEW-07 + NEW-10)
// "Weekly summary → WhatsApp": one district, one ISO
// week, styled like a printed report. The summary card
// wears a 2px border and the ✓ VERIFIED DATA stamp —
// every figure comes from human-approved rows only.
//
// NEW-07 — what leaves the app. A big-type bilingual
// POSTER (PDF) for a village WhatsApp group, the IDSP
// sheet for an officer's inbox, and a plain-text caption
// for low-data recipients. Every one of them carries the
// district, the ISO week, when the figures were read and
// when it was exported, and says in words that it is a
// snapshot rather than live data. Nothing is ever sent
// automatically — each artifact exists only because a
// human pressed a button (§2.3).
//
// NEW-10 — offline. loadWeeklySummary() serves this
// phone's last saved copy when the network fails, with an
// "as of" stamp and the reason, instead of an empty page.
// A cache miss stays an error-with-retry: "no data" and
// "the read failed" must never look the same.
//
// FIVE states in the data region: skeleton / live content
// / cached content with an as-of stamp / quiet-zero /
// error-with-retry.
// =====================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { formatDateTime, formatTime } from '../../lib/format';
import { EmptyState, ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import {
  ArtifactOptions,
  buildPosterHtml,
  buildSummaryHtml,
  buildWhatsAppCaption,
  formatAckRate,
  formatCasesDelta,
  getWeekWindow,
  loadWeeklySummary,
  MAX_WEEKS_BACK,
  PRINT_PAGE,
  readCachedWeeklySummary,
  WeeklySummaryResult,
} from '../../lib/services/weeklySummary';

interface ShareStatus {
  kind: 'success' | 'error';
  text: string;
}

type BusyAction = 'poster' | 'sheet' | 'text' | null;

/**
 * expo-sharing has no web implementation and expo-print's web shim resolves
 * printToFileAsync() to window.print() returning undefined — destructuring a
 * uri off it would throw. So the file actions are not rendered at all in a
 * browser: an honest note beats a button that cannot work (§ web degradation).
 */
const CAN_MAKE_FILES = Platform.OS !== 'web';

/** "as of 14:32" today, "14 Jul 09:32" for anything older. Locale-aware. */
const asOfLabel = (iso: string): string => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? formatTime(at) : formatDateTime(at);
};

export default function WeeklySummaryScreen({
  profile,
  onBack,
}: {
  profile: Profile;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const district = (profile.district ?? '').trim();
  const [weekOffset, setWeekOffset] = useState(0);
  const [result, setResult] = useState<WeeklySummaryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);

  const summary = result?.summary ?? null;
  const fromCache = result?.source === 'cache';
  /**
   * Cached figures are on screen and the live read has not answered yet.
   * Distinguishes "showing the saved copy while we check" from "showing the
   * saved copy because the server could not be reached" — two different
   * sentences, and telling the user the wrong one is its own small lie.
   */
  const revalidating = fromCache && result?.staleReason === null;

  /**
   * Guards against a stale answer overwriting a fresh one. The week arrows stay
   * live during pull-to-refresh, so two loads can be in flight at once; without
   * this the slower one wins and the card shows W30's figures under a "1 week
   * back" label. Only the newest request may touch state.
   */
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!district) {
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setError(null);

    // ── Paint the saved copy FIRST (AsyncStorage, no network) ──
    // This is the whole point of NEW-10. A read has a 15 s deadline
    // (READ_TIMEOUT_MS) and this digest issues seven of them, so on the weak
    // signal where the digest matters most the old order — network, then
    // fallback — meant staring at a skeleton for up to half a minute before
    // the phone showed figures it already had. The live read below still runs
    // and replaces this; until it does, the banner says so.
    const cached = await readCachedWeeklySummary(district, weekOffset);
    if (seq !== requestSeq.current) return;
    if (cached) {
      setResult({
        summary: cached.summary,
        source: 'cache',
        fetchedAtIso: cached.fetchedAtIso,
        staleReason: null,
        offline: false,
      });
      setLoading(false);
    }

    try {
      // Read-through: live first, this phone's saved copy as the fallback.
      // Throws only when BOTH fail — which is a real error, not an empty week.
      const next = await loadWeeklySummary(district, weekOffset);
      if (seq !== requestSeq.current) return;
      setResult(next);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('weekly.loadFailed', {
              defaultValue: "Couldn't load the weekly summary — check connection.",
            }),
      );
      // Reached only when there was no cached copy either — loadWeeklySummary
      // returns the cache rather than throwing whenever one exists. So this
      // never wipes figures the user can still see.
      setResult(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [district, weekOffset, t]);

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
  // Stamp taken at press time, not at load time: a digest read this morning
  // and forwarded tonight must show both instants, and must say when the
  // figures came off the phone's cache rather than the network.
  const artifactOptions = (): ArtifactOptions => ({
    exportedAtIso: new Date().toISOString(),
    fromCache,
  });

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

  /**
   * Render HTML to a PDF and hand it to the OS share sheet.
   * Availability is checked BEFORE the file is written so a device with no
   * receiver never leaves an orphan PDF in the cache directory.
   */
  const sharePdfNative = async (html: string, dialogTitle: string) => {
    const available = await Sharing.isAvailableAsync();
    if (!available) throw new Error('sharing-unavailable');
    // The page size is stated, never defaulted: expo-print falls back to
    // 612 × 792 (US Letter) on BOTH platforms, so an unqualified call put an
    // Indian district's IDSP sheet on American paper. PRINT_PAGE is A4 and
    // matches the padding the HTML lays out against.
    const { uri } = await Print.printToFileAsync({
      html,
      width: PRINT_PAGE.width,
      height: PRINT_PAGE.height,
    });
    await Sharing.shareAsync(uri, {
      dialogTitle,
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    });
  };

  const reportShareError = (err: any, fallback: string) => {
    if (err?.name === 'AbortError') return false; // user closed the sheet
    setShareStatus({
      kind: 'error',
      text:
        err?.message === 'sharing-unavailable'
          ? t('weekly.sharingUnavailable', {
              defaultValue:
                'This device has no app that can receive a file. Use "Share as text" instead.',
            })
          : fallback,
    });
    return true;
  };

  /** NEW-07 — the bilingual poster, the artifact meant for a WhatsApp group. */
  const handleSharePoster = async () => {
    if (!summary || busy || !CAN_MAKE_FILES) return;
    setShareStatus(null);
    setBusy('poster');
    try {
      await sharePdfNative(
        buildPosterHtml(summary, artifactOptions()),
        t('weekly.posterDialog', { defaultValue: 'Share weekly poster' }),
      );
      setShareStatus({
        kind: 'success',
        text: t('weekly.posterReady', {
          defaultValue:
            'Poster ready — pick WhatsApp in the sheet. It carries the district, the week and when the figures were read.',
        }),
      });
    } catch (err: any) {
      reportShareError(
        err,
        t('weekly.posterFailed', {
          defaultValue: "Couldn't build the poster — try again, or use Share as text.",
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  /** The IDSP table — for an officer's inbox, not for a village group. */
  const handleShareSheet = async () => {
    if (!summary || busy || !CAN_MAKE_FILES) return;
    setShareStatus(null);
    setBusy('sheet');
    try {
      await sharePdfNative(
        buildSummaryHtml(summary, artifactOptions()),
        t('weekly.sheetDialog', { defaultValue: 'Share IDSP summary sheet' }),
      );
      setShareStatus({
        kind: 'success',
        text: t('weekly.sheetReady', {
          defaultValue: 'IDSP sheet ready — choose a recipient, or "Save to Files" to keep a copy.',
        }),
      });
    } catch (err: any) {
      reportShareError(
        err,
        t('weekly.sheetFailed', {
          defaultValue: "Couldn't create the PDF — try again in a moment.",
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleShareText = async () => {
    if (!summary || busy) return;
    setShareStatus(null);
    setBusy('text');
    try {
      const caption = buildWhatsAppCaption(summary, artifactOptions());
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        if (nav?.share) {
          await nav.share({ text: caption });
          setShareStatus({
            kind: 'success',
            text: t('weekly.webShareOpened', { defaultValue: 'Share sheet opened — pick WhatsApp.' }),
          });
        } else if (await copyCaptionOnWeb(caption)) {
          setShareStatus({
            kind: 'success',
            text: t('weekly.captionCopied', { defaultValue: 'Summary copied to clipboard.' }),
          });
        } else {
          setShareStatus({
            kind: 'error',
            text: t('weekly.captionCopyFailed', {
              defaultValue: "This browser wouldn't let the app copy or share. Select the card text by hand.",
            }),
          });
        }
      } else {
        await Share.share({ message: caption });
        setShareStatus({
          kind: 'success',
          text: t('weekly.captionReady', { defaultValue: 'Summary ready to send as text.' }),
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setBusy(null);
        return;
      }
      setShareStatus({
        kind: 'error',
        text: t('weekly.captionFailed', { defaultValue: "Couldn't share the text summary." }),
      });
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

  /** The instant these figures were read — shown whenever they are not live. */
  const asOfText = useMemo(() => (result ? asOfLabel(result.fetchedAtIso) : ''), [result]);

  /**
   * Which week the arrows are pointing at — pure local date maths, never the
   * loaded payload. Taking it from `result` meant that during a fetch the label
   * still read the PREVIOUS week while the caption underneath already said
   * "1 week back", and on a failed load the header kept naming a week whose
   * figures were no longer on screen.
   */
  const navWeekLabel = useMemo(() => getWeekWindow(weekOffset).weekLabel, [weekOffset]);

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
                  {navWeekLabel}
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
                {/* ── NEW-10: cached content is content, not an error — but it
                       never pretends to be live. Stamp, reason, retry. ── */}
                {fromCache && (
                  <View
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.cacheBanner,
                      { backgroundColor: colors.warningBg, borderColor: colors.warning },
                    ]}
                  >
                    <Ionicons name="cloud-offline-outline" size={18} color={colors.warning} />
                    <View style={styles.cacheBannerBody}>
                      <Text
                        style={[styles.cacheBannerTitle, { color: colors.text }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t('weekly.savedCopy', {
                          defaultValue: 'Saved copy · as of {{when}}',
                          when: asOfText,
                        })}
                      </Text>
                      <Text
                        style={[styles.cacheBannerText, { color: colors.textSecondary }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {revalidating
                          ? t('weekly.savedCopyChecking', {
                              defaultValue: 'Checking for newer figures…',
                            })
                          : (result?.staleReason ??
                            t('weekly.savedCopyReason', {
                              defaultValue: 'The server could not be reached just now.',
                            }))}
                      </Text>
                      {!revalidating && (
                        <Text
                          style={[styles.cacheBannerText, { color: colors.textSecondary }]}
                          maxFontSizeMultiplier={1.3}
                        >
                          {t('weekly.savedCopyMayHaveChanged', {
                            defaultValue: 'Figures may have changed since. Pull down to refresh.',
                          })}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

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
                  {/* The card is what gets screenshotted, so it carries the same
                      read-instant the exported artifacts do. */}
                  <Text style={[styles.cardStamp, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                    {t('weekly.figuresRead', {
                      defaultValue: 'Figures read {{when}}',
                      when: asOfText,
                    })}
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

                {/* ── Actions ──
                    File actions exist only where a file can actually be made
                    and handed over. In a browser they are not rendered at all
                    and the note below says why. ── */}
                {CAN_MAKE_FILES ? (
                  <>
                    <Pressable
                      onPress={handleSharePoster}
                      disabled={!!busy}
                      accessibilityRole="button"
                      accessibilityLabel={t('weekly.sharePosterA11y', {
                        defaultValue: 'Share the weekly poster, opens the share sheet',
                      })}
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
                        busy && styles.disabled,
                      ]}
                    >
                      {busy === 'poster' ? (
                        <ActivityIndicator size="small" color={colors.onPrimary} />
                      ) : (
                        <Ionicons name="logo-whatsapp" size={20} color={colors.onPrimary} />
                      )}
                      <Text
                        style={[styles.primaryBtnText, { color: colors.onPrimary }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t('weekly.sharePoster', { defaultValue: 'Share poster on WhatsApp' })}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={handleShareSheet}
                      disabled={!!busy}
                      accessibilityRole="button"
                      accessibilityLabel={t('weekly.shareSheetA11y', {
                        defaultValue: 'Share the I D S P summary sheet as a PDF',
                      })}
                      style={({ pressed }) => [
                        styles.outlineBtn,
                        {
                          borderColor: colors.inputBorder,
                          backgroundColor: pressed ? colors.cardHover : 'transparent',
                        },
                        busy && styles.disabled,
                      ]}
                    >
                      {busy === 'sheet' ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Ionicons name="document-outline" size={20} color={colors.text} />
                      )}
                      <Text
                        style={[styles.outlineBtnText, { color: colors.text }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t('weekly.shareSheet', { defaultValue: 'IDSP sheet (PDF)' })}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <View
                    style={[
                      styles.webNote,
                      { backgroundColor: colors.infoBg, borderColor: colors.border },
                    ]}
                  >
                    <Ionicons name="information-circle-outline" size={18} color={colors.text} />
                    <Text
                      style={[styles.webNoteText, { color: colors.text }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {t('weekly.webNoFiles', {
                        defaultValue:
                          'Poster and PDF export need the HealthDrop app on a phone — a browser cannot hand a file to WhatsApp. The text summary below works here.',
                      })}
                    </Text>
                  </View>
                )}

                <Pressable
                  onPress={handleShareText}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('weekly.shareTextA11y', {
                    defaultValue: 'Share the summary as plain text',
                  })}
                  style={({ pressed }) => [
                    CAN_MAKE_FILES ? styles.textLink : styles.primaryBtn,
                    !CAN_MAKE_FILES && {
                      backgroundColor: pressed ? colors.primaryPressed : colors.primary,
                    },
                    CAN_MAKE_FILES && pressed && { opacity: 0.7 },
                    busy && styles.disabled,
                  ]}
                >
                  {busy === 'text' && !CAN_MAKE_FILES && (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  )}
                  <Text
                    style={
                      CAN_MAKE_FILES
                        ? [styles.textLinkLabel, { color: colors.primary }]
                        : [styles.primaryBtnText, { color: colors.onPrimary }]
                    }
                    maxFontSizeMultiplier={1.3}
                  >
                    {CAN_MAKE_FILES
                      ? t('weekly.shareText', { defaultValue: 'Share as text' })
                      : t('weekly.copyText', { defaultValue: 'Copy summary as text' })}
                  </Text>
                </Pressable>

                {/* Anything that leaves the app is a decision, and it cannot be
                    taken back — say so before the button is pressed, not after. */}
                <Text style={[styles.footnote, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {t('weekly.shareFootnote', {
                    defaultValue:
                      'Every shared copy is stamped with {{district}}, {{week}} and the time the figures were read, and states it is a snapshot. It is for health staff, not an official public notice — and once sent it cannot be corrected.',
                    district: summary.district,
                    week: summary.weekTag,
                  })}
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
  cardStamp: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  cardRule: {
    height: 1,
    marginTop: 12,
    marginBottom: 2,
  },
  cacheBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  cacheBannerBody: {
    flex: 1,
    gap: 2,
  },
  cacheBannerTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cacheBannerText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  webNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  webNoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
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
