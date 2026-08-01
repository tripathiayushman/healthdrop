// =====================================================
// OUTBREAK CONSOLE SCREEN — Bharosa D·02
// The running logbook of a confirmed outbreak: status
// with a deliberate resolve step (closing note REQUIRED),
// honest stat deltas, and the response log rendered as a
// vertical stepper timeline — every entry carries a name
// and a time. Four-state data regions.
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
import { useTheme, Theme, radii, spacing } from '../../lib/ThemeContext';
import { ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import { supabase } from '../../lib/supabase';
import { alertAcks } from '../../lib/services/alertAcks';
import {
  Outbreak,
  OutbreakStatus,
  OUTBREAK_CONFIRM_MARKER,
  outbreaksService,
  parseResponseNotes,
} from '../../lib/services/outbreaks';

const OUTBREAK_ERROR = "Couldn't load this outbreak — check connection.";

/**
 * D·02 reach stat — loads independently of the console.
 * 'ready' never fakes a percent: staff null/0 means the
 * denominator is unknown and only the ack count is shown.
 */
type ReachState =
  | { kind: 'loading' }
  | { kind: 'ready'; acked: number; staff: number | null }
  | { kind: 'unavailable' };

const STATUS_OPTIONS: { value: OutbreakStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
];

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const shortDateTime = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

const dayNumber = (createdAt: string): number => {
  const start = new Date(createdAt).getTime();
  if (Number.isNaN(start)) return 1;
  return Math.max(1, Math.floor((Date.now() - start) / 86400000) + 1);
};

const statusTone = (status: OutbreakStatus, t: Theme): { fg: string; bg: string } => {
  switch (status) {
    case 'active':     return { fg: t.danger, bg: t.dangerBg };
    case 'monitoring': return { fg: t.warning, bg: t.warningBg };
    case 'resolved':   return { fg: t.success, bg: t.successBg };
    default:           return { fg: t.textSecondary, bg: t.surfaceVariant };
  }
};

export default function OutbreakConsoleScreen({
  profile,
  outbreakId,
  onBack,
}: {
  profile: Profile;
  outbreakId: string;
  onBack: () => void;
}) {
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outbreak, setOutbreak] = useState<Outbreak | null>(null);

  const [reports, setReports] = useState<DiseaseReport[]>([]);
  const [deltasAvailable, setDeltasAvailable] = useState(false);

  const [reach, setReach] = useState<ReachState>({ kind: 'loading' });

  const [statusSaving, setStatusSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const [resolveOpen, setResolveOpen] = useState(false);
  const [closingNote, setClosingNote] = useState('');
  const [resolveSaving, setResolveSaving] = useState(false);

  const load = async () => {
    setError(null);
    const res = await outbreaksService.getById(outbreakId);
    if (res.error || !res.data) {
      setError(OUTBREAK_ERROR);
      setLoading(false);
      return;
    }
    setOutbreak(res.data);
    setLoading(false);
    // Reach loads independently — its own skeleton, its own fallback.
    loadReach(res.data);
    // Deltas need the contributing reports; their failure only
    // degrades the delta captions, never fakes a zero.
    const reportsRes = await outbreaksService.contributingReports(res.data);
    if (reportsRes.error || !reportsRes.data) {
      setDeltasAvailable(false);
      setReports([]);
    } else {
      setReports(reportsRes.data);
      setDeltasAvailable(true);
    }
  };

  /**
   * D·02 — "% of staff acknowledged", the outbreak's real-time reach.
   * Only when an alert is live (alert_sent): find the newest approved
   * live health_alert for the district, preferring one that names this
   * disease in disease_or_issue/title, then count acks vs. active
   * field staff. Any failure → 'unavailable', never a fake number.
   */
  const loadReach = async (ob: Outbreak) => {
    if (!ob.alert_sent) return;
    setReach({ kind: 'loading' });
    try {
      const { data, error } = await supabase
        .from('health_alerts')
        .select('id, title, disease_or_issue, created_at')
        .eq('approval_status', 'approved')
        .eq('status', 'active')
        .eq('district', ob.district)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      if (!data || data.length === 0) {
        setReach({ kind: 'unavailable' });
        return;
      }
      const disease = (ob.disease_name ?? '').trim().toLowerCase();
      const linked =
        (disease &&
          data.find(
            (a: { title?: string | null; disease_or_issue?: string | null }) =>
              String(a.disease_or_issue ?? '').toLowerCase().includes(disease) ||
              String(a.title ?? '').toLowerCase().includes(disease),
          )) ||
        data[0];
      const res = await alertAcks.reachForDistrict(linked.id, ob.district);
      if (res.error || !res.data) {
        setReach({ kind: 'unavailable' });
        return;
      }
      setReach({ kind: 'ready', acked: res.data.acked, staff: res.data.staff });
    } catch (e) {
      console.error('Error loading alert reach:', e);
      setReach({ kind: 'unavailable' });
    }
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
    load();
  };

  // ── Honest deltas: approved cases / deaths logged today ──
  const todayDeltas = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let cases = 0;
    let deaths = 0;
    reports.forEach((r) => {
      const t = new Date(r.created_at).getTime();
      if (!Number.isNaN(t) && t >= startOfDay.getTime()) {
        cases += r.cases_count || 0;
        deaths += r.deaths_count || 0;
      }
    });
    return { cases, deaths };
  }, [reports]);

  const noteEntries = useMemo(
    () => parseResponseNotes(outbreak?.response_notes),
    [outbreak?.response_notes],
  );

  const confirmEntry = useMemo(
    () => noteEntries.find((e) => e.text.includes(OUTBREAK_CONFIRM_MARKER)) ?? null,
    [noteEntries],
  );

  // ── Actions ──
  const changeStatus = async (target: OutbreakStatus) => {
    if (!outbreak || statusSaving || target === outbreak.status) return;
    if (target === 'resolved') {
      setActionError(null);
      setClosingNote('');
      setResolveOpen(true);
      return;
    }
    setStatusSaving(true);
    setActionError(null);
    const note =
      outbreak.status === 'resolved'
        ? `Reopened — status changed to ${target}.`
        : `Status changed to ${target}.`;
    const res = await outbreaksService.updateStatus(outbreak.id, target, note);
    setStatusSaving(false);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Couldn't change the status — check connection and try again.");
      return;
    }
    setOutbreak(res.data);
  };

  const submitResolve = async () => {
    if (!outbreak || resolveSaving || !closingNote.trim()) return;
    setResolveSaving(true);
    setActionError(null);
    const res = await outbreaksService.resolve(outbreak.id, closingNote.trim());
    setResolveSaving(false);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Couldn't resolve the outbreak — check connection and try again.");
      setResolveOpen(false);
      return;
    }
    setOutbreak(res.data);
    setResolveOpen(false);
    setClosingNote('');
  };

  const submitNote = async () => {
    if (!outbreak || noteSaving || !noteText.trim()) return;
    setNoteSaving(true);
    setActionError(null);
    const res = await outbreaksService.addNote(outbreak.id, noteText.trim());
    setNoteSaving(false);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Couldn't save your note — check connection and try again.");
      return;
    }
    setOutbreak(res.data);
    setNoteText('');
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;
  const tone = outbreak ? statusTone(outbreak.status, colors) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
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
          <Text style={[styles.headerTitle, { color: headerText }]} numberOfLines={1}>
            {outbreak ? `${capitalize(outbreak.disease_name)} outbreak` : 'Outbreak console'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]} numberOfLines={1}>
            {outbreak
              ? `${outbreak.district} · detected ${shortDateTime(outbreak.created_at)}`
              : 'Response log & status'}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <View style={{ gap: spacing.md }}>
            <SkeletonBlock height={88} radius={radii.md} />
            <SkeletonBlock height={48} radius={radii.md} />
            <SkeletonBlock height={110} radius={radii.md} />
            <SkeletonBlock height={200} radius={radii.md} />
          </View>
        ) : error || !outbreak || !tone ? (
          <ErrorCard message={error ?? OUTBREAK_ERROR} onRetry={retry} />
        ) : (
          <>
            {/* ── Status card: pill + provenance line ── */}
            <View
              style={[
                styles.statusCard,
                { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: tone.fg },
                !isDark && styles.cardShadow,
              ]}
            >
              <View style={styles.statusRow}>
                <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                  <View style={[styles.statusDot, { backgroundColor: tone.fg }]} />
                  <Text style={[styles.statusPillText, { color: tone.fg }]} maxFontSizeMultiplier={1.3}>
                    {outbreak.status.toUpperCase()}
                    {outbreak.status !== 'resolved' ? ` · DAY ${dayNumber(outbreak.created_at)}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={[styles.statusMeta, { color: colors.textSecondary }]}>
                {confirmEntry
                  ? `Confirmed by ${confirmEntry.author ?? 'an officer'}${confirmEntry.at ? `, ${shortDateTime(confirmEntry.at)}` : ''}`
                  : 'Auto-detected by rule — not yet confirmed by an officer.'}
                {outbreak.status === 'resolved' && outbreak.resolved_at
                  ? ` · Resolved ${shortDateTime(outbreak.resolved_at)}`
                  : ''}
              </Text>
            </View>

            {/* ── Status segmented control ── */}
            <View
              style={[styles.segmentWrap, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}
              accessibilityRole="tablist"
            >
              {STATUS_OPTIONS.map((opt) => {
                const selected = outbreak.status === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => changeStatus(opt.value)}
                    disabled={statusSaving}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={
                      opt.value === 'resolved'
                        ? 'Resolved. Requires a closing note.'
                        : opt.label
                    }
                    style={({ pressed }) => [
                      styles.segment,
                      selected && { backgroundColor: colors.primary },
                      !selected && pressed && { backgroundColor: colors.cardHover },
                      statusSaving && styles.btnDisabled,
                    ]}
                  >
                    {selected && (
                      <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
                    )}
                    <Text
                      style={[
                        styles.segmentText,
                        { color: selected ? colors.onPrimary : colors.textSecondary },
                      ]}
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                    >
                      {statusSaving && !selected ? '…' : opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.segmentCaption, { color: colors.textSecondary }]}>
              Resolving requires a closing note — the audit log's last word.
            </Text>

            {actionError && (
              <View style={[styles.actionErrorCard, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Text style={[styles.actionErrorText, { color: colors.text }]}>{actionError}</Text>
              </View>
            )}

            {/* ── Stat row with honest deltas ── */}
            <View style={[styles.statsRow, { marginTop: spacing.md }]}>
              <DeltaTile
                value={outbreak.total_cases}
                label="cases"
                rule={colors.danger}
                delta={deltasAvailable ? todayDeltas.cases : null}
              />
              <DeltaTile
                value={outbreak.total_deaths}
                label={outbreak.total_deaths === 1 ? 'death' : 'deaths'}
                rule={colors.danger}
                delta={deltasAvailable ? todayDeltas.deaths : null}
              />
            </View>
            <View style={[styles.statsRow, { marginTop: spacing.sm }]}>
              <DeltaTile
                value={outbreak.report_count}
                label="reports · human-approved"
                rule={colors.info}
                delta={null}
                deltaCaption="all verified by people"
              />
              {outbreak.alert_sent ? <ReachTile state={reach} /> : <View style={{ flex: 1 }} />}
            </View>

            {/* ── Linked alert ── */}
            {outbreak.alert_sent ? (
              <View
                style={[
                  styles.alertBanner,
                  { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.info },
                  !isDark && styles.cardShadow,
                ]}
              >
                <Ionicons name="megaphone-outline" size={18} color={colors.info} />
                <Text style={[styles.alertBannerText, { color: colors.text }]}>
                  An alert has been sent for this outbreak — field staff in {outbreak.district} were notified.
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.alertBanner,
                  { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.borderDark },
                  !isDark && styles.cardShadow,
                ]}
              >
                <Ionicons name="megaphone-outline" size={18} color={colors.textTertiary} />
                <Text style={[styles.alertBannerText, { color: colors.textSecondary }]}>
                  No alert has been sent for this outbreak. Alerts are issued separately and never
                  fire automatically.
                </Text>
              </View>
            )}

            {/* ── Response log — vertical stepper timeline ── */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                RESPONSE NOTES · AUDIT-LOGGED
                <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${noteEntries.length}`}</Text>
              </Text>
            </View>
            {noteEntries.length === 0 ? (
              <View style={[styles.quietZero, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                <Ionicons name="document-text-outline" size={20} color={colors.success} />
                <Text style={[styles.quietZeroText, { color: colors.textSecondary }]}>
                  No response notes yet — every action you log appears here with your name and time.
                </Text>
              </View>
            ) : (
              <View
                style={[styles.timelineCard, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}
              >
                {noteEntries.map((entry, idx) => {
                  const last = idx === noteEntries.length - 1;
                  return (
                    <View key={`${entry.at ?? 'legacy'}-${idx}`} style={styles.timelineRow}>
                      <View style={styles.timelineRail}>
                        <View style={[styles.timelineDot, { backgroundColor: last ? colors.primary : colors.borderDark }]} />
                        {!last && <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />}
                      </View>
                      <View style={styles.timelineBody}>
                        <Text style={[styles.timelineText, { color: colors.text }]}>{entry.text}</Text>
                        <Text style={[styles.timelineMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                          {entry.author ?? 'Unattributed'}
                          {entry.at ? ` · ${shortDateTime(entry.at)}` : ' · earlier note'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── Add a note ── */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>ADD A NOTE</Text>
            </View>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Add a note… e.g. Tanker water arranged for Kendupali till retest clears."
              placeholderTextColor={colors.inputPlaceholderColor}
              multiline
              style={[
                styles.noteInput,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
            />
            <Pressable
              onPress={submitNote}
              disabled={noteSaving || !noteText.trim()}
              accessibilityRole="button"
              accessibilityLabel="Add note to the audit log"
              style={({ pressed }) => [
                styles.noteBtn,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                (noteSaving || !noteText.trim()) && styles.btnDisabled,
              ]}
            >
              <Text style={[styles.noteBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                {noteSaving ? 'Saving…' : 'Add note'}
              </Text>
            </Pressable>
            <Text style={[styles.noteCaption, { color: colors.textSecondary }]}>
              Audit-logged with your name and time. Notes cannot be edited or removed.
            </Text>
          </>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Resolve modal — closing note REQUIRED ── */}
      <Modal
        visible={resolveOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setResolveOpen(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Resolve this outbreak?</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              The console closes with your note as the record of how it ended. This does not
              notify the public.
            </Text>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>CLOSING NOTE · REQUIRED</Text>
            <TextInput
              value={closingNote}
              onChangeText={setClosingNote}
              placeholder="e.g. No new cases for 7 days; both water sources retested safe."
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
                onPress={() => setResolveOpen(false)}
                disabled={resolveSaving}
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
                onPress={submitResolve}
                disabled={resolveSaving || !closingNote.trim()}
                accessibilityRole="button"
                accessibilityLabel="Resolve outbreak"
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  (resolveSaving || !closingNote.trim()) && styles.btnDisabled,
                ]}
              >
                <Text style={[styles.modalPrimaryLabel, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {resolveSaving ? 'Resolving…' : 'Resolve outbreak'}
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
//  DeltaTile — Big Number with an honest delta caption.
//  Only the delta takes semantic color; the value is ink.
// ─────────────────────────────────────────────────────
const DeltaTile: React.FC<{
  value: number;
  label: string;
  rule: string;
  /** Today's change; null = not computable (never fake a zero) */
  delta: number | null;
  deltaCaption?: string;
}> = ({ value, label, rule, delta, deltaCaption }) => {
  const { colors, isDark } = useTheme();

  let deltaNode: React.ReactNode = null;
  if (deltaCaption) {
    deltaNode = (
      <Text style={[styles.deltaText, { color: colors.textTertiary }]} numberOfLines={1}>
        {deltaCaption}
      </Text>
    );
  } else if (delta === null) {
    deltaNode = (
      <Text style={[styles.deltaText, { color: colors.textTertiary }]} numberOfLines={1}>
        — today's change unavailable
      </Text>
    );
  } else if (delta > 0) {
    deltaNode = (
      <Text style={[styles.deltaText, { color: colors.danger }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        ▲ {delta} today
      </Text>
    );
  } else {
    deltaNode = (
      <Text style={[styles.deltaText, { color: colors.textTertiary }]} numberOfLines={1}>
        unchanged today
      </Text>
    );
  }

  const a11yDelta = deltaCaption
    ? deltaCaption
    : delta === null
      ? 'change today unavailable'
      : delta > 0
        ? `up ${delta} today`
        : 'unchanged today';

  return (
    <View
      style={[
        styles.statTile,
        { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: rule },
        !isDark && styles.cardShadow,
      ]}
      accessible
      accessibilityLabel={`${label}: ${value}, ${a11yDelta}`}
    >
      <Text style={[styles.statValue, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      {deltaNode}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  ReachTile — D·02 "{pct}% alert ack'd · {acked} of
//  {staff} staff". Four states, one footprint (no layout
//  jump): skeleton while loading; percent only when the
//  staff denominator is real; "{acked} acknowledged"
//  when it isn't; a quiet dash when nothing loads.
// ─────────────────────────────────────────────────────
const ReachTile: React.FC<{ state: ReachState }> = ({ state }) => {
  const { colors, isDark } = useTheme();

  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1 }} accessibilityElementsHidden>
        <SkeletonBlock height={104} radius={radii.md} />
      </View>
    );
  }

  let value = '—';
  let label = 'alert reach';
  let caption = 'unavailable right now';
  let a11y = 'Alert reach unavailable right now';

  if (state.kind === 'ready') {
    const { acked, staff } = state;
    if (staff !== null && staff > 0) {
      const pct = Math.round((acked / staff) * 100);
      value = `${pct}%`;
      label = "alert ack'd";
      caption = `${acked} of ${staff} staff`;
      a11y = `Alert acknowledged by ${pct} percent: ${acked} of ${staff} staff`;
    } else {
      // Staff count blocked (RLS) or genuinely zero — never a fake percent.
      value = `${acked}`;
      label = 'acknowledged';
      caption = 'staff count unavailable';
      a11y = `${acked} acknowledged; staff count unavailable`;
    }
  }

  return (
    <View
      style={[
        styles.statTile,
        { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: colors.info },
        !isDark && styles.cardShadow,
      ]}
      accessible
      accessibilityLabel={a11y}
    >
      <Text style={[styles.statValue, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[styles.deltaText, { color: colors.textTertiary }]}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
      >
        {caption}
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
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },

  /* ── Status card ── */
  statusCard: {
    borderWidth: 1, borderTopWidth: 3, borderRadius: radii.md,
    padding: spacing.lg, gap: spacing.sm,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6, fontVariant: ['tabular-nums'] },
  statusMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Segmented control ── */
  segmentWrap: {
    flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.xs,
  },
  segment: {
    flex: 1, minHeight: 48, borderRadius: radii.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: spacing.xs,
  },
  // flexShrink lets "Monitoring" + its checkmark ellipsize instead of
  // pushing the third segment off-screen at 360dp / large font scales.
  segmentText: { fontSize: 13, lineHeight: 18, fontWeight: '700', flexShrink: 1 },
  segmentCaption: { fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: spacing.xs, textAlign: 'center' },

  actionErrorCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md,
  },
  actionErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Stats ── */
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statTile: {
    flex: 1, borderWidth: 1, borderTopWidth: 3, borderRadius: radii.md,
    padding: spacing.lg, minHeight: 104, justifyContent: 'flex-end',
  },
  statValue: { fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2 },
  deltaText: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },

  /* ── Linked alert banner ── */
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderLeftWidth: 3, borderRadius: radii.md,
    padding: spacing.md, marginTop: spacing.md,
  },
  alertBannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Sections ── */
  sectionHeaderRow: { marginTop: spacing.lg, marginBottom: spacing.md, minHeight: 20, justifyContent: 'center' },
  sectionTitle: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },

  quietZero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderRadius: radii.md, padding: spacing.lg,
  },
  quietZeroText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Timeline (vertical stepper) ── */
  timelineCard: { borderWidth: 1, borderRadius: radii.md, padding: spacing.lg },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { width: 12, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  timelineLine: { width: 2, flex: 1, marginTop: 2, marginBottom: -4 },
  timelineBody: { flex: 1, paddingBottom: spacing.lg },
  timelineText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  timelineMeta: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },

  /* ── Add note ── */
  noteInput: {
    minHeight: 72, borderWidth: 1.5, borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, lineHeight: 22, textAlignVertical: 'top',
  },
  noteBtn: {
    minHeight: 48, borderRadius: radii.md, marginTop: spacing.sm,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  noteBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  noteCaption: { fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: spacing.xs, textAlign: 'center' },
  btnDisabled: { opacity: 0.4 },

  /* ── Resolve modal ── */
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg },
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
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
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
});
