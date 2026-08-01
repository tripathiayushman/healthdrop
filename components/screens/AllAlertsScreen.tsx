// =====================================================
// ALL ALERTS SCREEN — Bharosa B·02 inbox + B·03 poster
// Full list of active health alerts with search, filter,
// and a detail view restyled as THE POSTER: the block
// designed to be shown across a doorway. Directive first,
// disease second; verification is a stamp with a human
// name; acknowledging is a promise ("I'll inform my
// area") — that count is what the officer watches.
// =====================================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ScrollView, TextInput, RefreshControl, Pressable,
  Linking, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import { filterAlertsForProfile, isRadiusScopedRole } from '../../lib/services/alertRadius';
import { sanitizeSearchTerm } from '../../lib/services/searchSanitize';
import { alertAcks } from '../../lib/services/alertAcks';
import {
  SkeletonBlock, ErrorCard, EmptyState, getSeverityColor, VerifiedStamp,
} from '../dashboards/DashboardShared';
import { StatusBadge } from '../shared/StatusBadge';

interface Props { profile: Profile; onBack: () => void; }

interface Alert {
  id: string;
  title: string;
  description: string;
  alert_type: string;
  urgency_level: string;
  district: string;
  state: string;
  location_name: string;
  status: string;
  created_at: string;
  disease_or_issue?: string | null;
  precautionary_measures?: string | null;
  immediate_actions?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  approval_status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** "№A1B2C3D4" — the alert's short, quotable number. */
const shortAlertNo = (id: string): string => `№${id.slice(0, 8).toUpperCase()}`;

/** Honest relative time; falls back to the date past a month. */
const relativeTime = (iso?: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days <= 30) return `${days}d ago`;
  return format(new Date(t), 'dd MMM yyyy');
};

/**
 * B·03 "DO THESE THREE THINGS" — split precautionary_measures /
 * immediate_actions on newlines & semicolons, strip any manual
 * numbering, keep the first 3. A block that won't split falls
 * back to its full text as a single step; nothing → no section.
 */
const parseDirectiveSteps = (
  ...sources: (string | null | undefined)[]
): string[] => {
  const steps: string[] = [];
  for (const source of sources) {
    if (typeof source !== 'string' || !source.trim()) continue;
    const parts = source
      .split(/[\n;]+/)
      .map((s) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
    if (parts.length === 0) parts.push(source.trim());
    for (const p of parts) {
      if (!steps.some((s) => s.toLowerCase() === p.toLowerCase())) steps.push(p);
      if (steps.length >= 3) return steps;
    }
  }
  return steps;
};

const stepsHeading = (n: number): string =>
  n >= 3 ? 'DO THESE THREE THINGS' : n === 2 ? 'DO THESE TWO THINGS' : 'DO THIS ONE THING';

/** metadata.directive_hindi, only when it's a real non-empty string. */
const directiveHindiOf = (alert: Alert): string | null => {
  const raw = alert.metadata?.['directive_hindi'];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

const AllAlertsScreen: React.FC<Props> = ({ profile, onBack }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const { width } = useWindowDimensions();
  // title-1 poster scale — 24/700, up to 28 on wide screens.
  // Devanagari gets ~1.3× line-height headroom.
  const wide = width >= 480;
  const directiveSize = wide ? 28 : 24;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Acknowledgement state (B·03 promise loop) ──
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set());
  const [ackSaving, setAckSaving] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  // ── Approver for the stamp — fetched, never faked ──
  const [approver, setApprover] = useState<{ name: string; role?: string } | null>(null);

  const load = useCallback(async () => {
    setFetchError(null);
    try {
      let q = supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(200);

      if (urgencyFilter) q = q.eq('urgency_level', urgencyFilter);
      const term = sanitizeSearchTerm(search);
      if (term) q = q.ilike('title', `%${term}%`);

      const { data, error } = await q;
      if (error) {
        console.error('Failed to load alerts:', error);
        setFetchError("Couldn't load alerts — check connection");
      } else if (data) {
        const list = isRadiusScopedRole(profile.role)
          ? filterAlertsForProfile(data, profile)
          : data;
        setAlerts(list);
        // Batch: which of these has this user already acknowledged?
        // Failure degrades quietly — captions simply don't render.
        const ackRes = await alertAcks.myAckFor(list.map((a: Alert) => a.id));
        if (ackRes.data) setAckedIds(ackRes.data);
      }
    } catch (err: any) {
      console.error('Failed to load alerts:', err);
      setFetchError("Couldn't load alerts — check connection");
    }
    finally { setLoading(false); }
  }, [urgencyFilter, search, profile]);

  useEffect(() => { load(); }, [load]);

  // Fetch the approving officer's name for the stamp. The stamp is
  // only ever applied with a human name — on failure it is omitted.
  useEffect(() => {
    setApprover(null);
    const sel = selected;
    if (!sel || sel.approval_status !== 'approved' || !sel.approved_by) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', sel.approved_by)
          .single();
        if (!cancelled && !error && data?.full_name) {
          setApprover({
            name: data.full_name,
            role: data.role ? String(data.role).replace(/_/g, ' ') : undefined,
          });
        }
      } catch { /* omit the stamp — never fake it */ }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openDetail = (a: Alert) => { setAckError(null); setSelected(a); };

  const acknowledge = async () => {
    if (!selected || ackSaving) return;
    setAckSaving(true);
    setAckError(null);
    const res = await alertAcks.acknowledge(selected.id);
    setAckSaving(false);
    if (res.error) {
      setAckError("Couldn't record your acknowledgement — check connection and try again.");
      return;
    }
    setAckedIds(prev => new Set(prev).add(selected.id));
  };

  const callHelpline = (phone: string) => {
    // tel: is a no-op link on web — guard so a blocked scheme never throws.
    try {
      const tel = phone.replace(/[^\d+]/g, '');
      if (tel) Linking.openURL(`tel:${tel}`).catch(() => {});
    } catch { /* unsupported platform — quietly do nothing */ }
  };

  const formatSafeDate = (value: string | null | undefined, pattern: string, fallback = ''): string => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return fallback;
    return format(parsed, pattern);
  };

  // Soft background for a severity pill — solid fill is CRITICAL's privilege alone.
  const severitySoftBg = (level: string): string => {
    switch (level?.toLowerCase()) {
      case 'critical': return colors.dangerBg;
      case 'high': return colors.offlineBg;
      case 'medium': return colors.warningBg;
      case 'low': return colors.successBg;
      default: return colors.surfaceVariant;
    }
  };

  const SeverityPill: React.FC<{ level: string; suffix?: string }> = ({ level, suffix }) => {
    const key = level?.toLowerCase() ?? '';
    const isCritical = key === 'critical';
    const fg = isCritical ? colors.textInverse : getSeverityColor(key, colors);
    const bg = isCritical ? colors.danger : severitySoftBg(key);
    return (
      <View style={[as.severityPill, { backgroundColor: bg }]} accessibilityLabel={`Urgency: ${key || 'unknown'}`}>
        {!isCritical && <View style={[as.severityDot, { backgroundColor: fg }]} />}
        <Text style={[as.severityPillText, { color: fg }]} maxFontSizeMultiplier={1.3}>
          {(level ?? '').toUpperCase()}{suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
    );
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers read correctly in BOTH modes.
  // textInverse here would be white-on-paper — invisible — and is banned.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  // ── Poster derivations for the selected alert ──
  const selHindi = selected ? directiveHindiOf(selected) : null;
  const selSteps = selected
    ? parseDirectiveSteps(selected.precautionary_measures, selected.immediate_actions)
    : [];
  const selAcked = !!selected && ackedIds.has(selected.id);

  return (
    <View style={[as.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg surface. No Role Ribbon on this screen, so the
          1px hairline is the only separator and must render in both modes. */}
      <View
        style={[
          as.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={as.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[as.headerTitle, { color: headerText }]}>Active Alerts</Text>
          <Text style={[as.headerSub, { color: headerSub }]} maxFontSizeMultiplier={1.3}>
            {alerts.length} alert{alerts.length !== 1 ? 's' : ''} found
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={[as.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[as.searchInput, { color: colors.text }]}
          placeholder="Search alerts..."
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

      {/* Urgency filter chips — selected = solid fill + check, never tint alone */}
      <View style={as.chipRow}>
        {(['', 'critical', 'high', 'medium', 'low'] as const).map(u => {
          const active = urgencyFilter === u;
          const color = u === '' ? colors.primary : getSeverityColor(u, colors);
          const selectedText = u === '' ? colors.onPrimary : colors.textInverse;
          return (
            <TouchableOpacity
              key={u || 'all'}
              style={[
                as.chip,
                active
                  ? { backgroundColor: color, borderColor: color }
                  : { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => setUrgencyFilter(u)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={u === '' ? 'All urgencies' : `Urgency ${u}`}
            >
              {active && <Ionicons name="checkmark" size={14} color={selectedText} />}
              <Text style={[as.chipText, { color: active ? selectedText : colors.text }]} maxFontSizeMultiplier={1.3}>
                {u === '' ? 'All' : u.charAt(0).toUpperCase() + u.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List — skeleton / error / quiet-zero / content */}
      {fetchError && !loading && (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorCard message={fetchError} onRetry={load} />
        </View>
      )}
      {loading ? (
        <View style={as.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={104} radius={radii.md} />
          <SkeletonBlock height={104} radius={radii.md} />
          <SkeletonBlock height={104} radius={radii.md} />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={a => a.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            fetchError ? null : (
              <EmptyState
                icon={search || urgencyFilter ? 'search-outline' : 'checkmark-circle-outline'}
                color={search || urgencyFilter ? colors.textSecondary : colors.success}
                title={search || urgencyFilter
                  ? 'No alerts match — try a different search or filter.'
                  : 'All clear — no active health alerts right now.'}
              />
            )
          }
          renderItem={({ item: a }) => (
            <Pressable
              style={({ pressed }) => [
                as.card,
                {
                  backgroundColor: pressed ? colors.cardHover : colors.card,
                  borderColor: colors.border,
                  borderLeftColor: getSeverityColor(a.urgency_level, colors),
                },
                !isDark && as.cardShadow,
              ]}
              onPress={() => openDetail(a)}
              accessibilityRole="button"
              accessibilityLabel={
                `Alert, urgency ${a.urgency_level}: ${a.title}` +
                (ackedIds.has(a.id) ? '. Acknowledged.' : '')
              }
            >
              <View style={as.cardTop}>
                <SeverityPill level={a.urgency_level} />
                <Text style={[as.cardDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {formatSafeDate(a.created_at, 'dd MMM yyyy', '—')}
                </Text>
              </View>
              <Text style={[as.cardTitle, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
              <Text style={[as.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>{a.description}</Text>
              {ackedIds.has(a.id) && (
                <View style={as.ackCaptionRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={[as.ackCaptionText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                    acknowledged ✓
                  </Text>
                </View>
              )}
              <View style={as.cardFooter}>
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <Text style={[as.cardLoc, { color: colors.textSecondary }]} numberOfLines={1}>
                  {a.location_name}, {a.district}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </View>
            </Pressable>
          )}
        />
      )}

      {/* ── Detail — B·03 THE POSTER ──
          Severity pill row, then the strong-bordered poster block:
          directive at title-1 scale (Hindi first when present),
          description, the numbered "do these things" list, helpline
          with a Call button, the stamp, provenance. Then the
          acknowledge zone — a promise, not a dismissal. */}
      <Modal visible={!!selected} animationType={reduceMotion ? 'none' : 'slide'} transparent>
        <View style={[as.overlay, { backgroundColor: colors.overlay }]}>
          {selected && (
            <View style={[as.sheet, { backgroundColor: colors.card }]}>
              <View style={[as.modalTopRule, { backgroundColor: getSeverityColor(selected.urgency_level, colors) }]} />
              <View style={[as.modalHeader, { borderBottomColor: colors.borderLight }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[as.modalHeadTitle, { color: colors.text }]} numberOfLines={1}>
                    Alert {shortAlertNo(selected.id)}
                  </Text>
                  <Text style={[as.modalHeadSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {selected.location_name}, {selected.district}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelected(null)}
                  style={[as.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close alert details"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ paddingHorizontal: spacing.lg }} contentContainerStyle={{ paddingVertical: spacing.lg }}>
                {/* Severity pill row — word + shape, never color alone */}
                <View style={as.modalPillRow}>
                  <StatusBadge status={selected.urgency_level} type="severity" size="medium" />
                  <Text style={[as.modalTypeText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                    {selected.alert_type?.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>

                {/* THE POSTER — full-strength 2px ink border: the thing
                    to show across a doorway, in sun or on a dim verandah */}
                <View style={[as.poster, { borderColor: colors.text, backgroundColor: colors.card }]}>
                  {selHindi ? (
                    <>
                      <Text
                        style={[as.posterDirective, {
                          color: colors.text,
                          fontSize: directiveSize,
                          lineHeight: Math.round(directiveSize * 1.4),
                        }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {selHindi}
                      </Text>
                      <Text style={[as.posterEnglish, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {selected.title}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={[as.posterDirective, {
                        color: colors.text,
                        fontSize: directiveSize,
                        lineHeight: Math.round(directiveSize * 1.25),
                      }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {selected.title}
                    </Text>
                  )}

                  {!!selected.description && (
                    <Text style={[as.posterBody, { color: colors.textSecondary }]}>
                      {selected.description}
                    </Text>
                  )}

                  {selSteps.length > 0 && (
                    <View style={as.stepsBlock}>
                      <Text style={[as.stepsHeading, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {stepsHeading(selSteps.length)}
                      </Text>
                      {selSteps.map((step, i) => (
                        <View key={i} style={as.stepRow}>
                          <View style={[as.stepNum, { borderColor: colors.text }]}>
                            <Text style={[as.stepNumText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                              {i + 1}
                            </Text>
                          </View>
                          <Text style={[as.stepText, { color: colors.text }]}>{step}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {!!selected.contact_phone && (
                    <View style={[as.helplineRow, { borderTopColor: colors.borderStrong }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[as.helplinePhone, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                          {selected.contact_phone}
                        </Text>
                        <Text style={[as.helplineMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                          {selected.contact_person ? `${selected.contact_person} · helpline` : 'health helpline'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => callHelpline(selected.contact_phone!)}
                        accessibilityRole="button"
                        accessibilityLabel={`Call helpline ${selected.contact_phone}`}
                        style={({ pressed }) => [
                          as.callBtn,
                          { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
                        ]}
                      >
                        <Ionicons name="call" size={16} color={colors.onPrimary} />
                        <Text style={[as.callBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                          Call
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {/* The stamp — only with a fetched human name, never faked */}
                  {selected.approval_status === 'approved' && approver && (
                    <View style={{ marginTop: spacing.lg }}>
                      <VerifiedStamp
                        verifierName={approver.name}
                        role={approver.role}
                        timestamp={formatSafeDate(selected.approved_at, 'dd MMM yyyy · HH:mm')}
                      />
                    </View>
                  )}

                  {/* Provenance — disease taxonomy is literally the last line */}
                  <Text style={[as.posterProvenance, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                    {shortAlertNo(selected.id)}
                    {relativeTime(selected.created_at) ? ` · ${relativeTime(selected.created_at)}` : ''}
                    {selected.disease_or_issue ? ` · ${selected.disease_or_issue}` : ''}
                  </Text>
                </View>

                {/* ── Acknowledge zone — the promise ── */}
                {selAcked ? (
                  <View
                    style={[as.ackDoneRow, { backgroundColor: colors.successBg }]}
                    accessible
                    accessibilityLabel="Acknowledged. You promised to inform your area."
                  >
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[as.ackDoneText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                      Acknowledged ✓ · you promised to inform your area
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={acknowledge}
                    disabled={ackSaving}
                    accessibilityRole="button"
                    accessibilityLabel="I've seen this — I'll inform my area"
                    style={({ pressed }) => [
                      as.ackBtn,
                      { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
                      ackSaving && as.btnDisabled,
                    ]}
                  >
                    <Text style={[as.ackBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                      {ackSaving ? 'Saving…' : "I've seen this — I'll inform my area"}
                    </Text>
                  </Pressable>
                )}
                {!!ackError && !selAcked && (
                  <View style={as.ackErrorRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <Text style={[as.ackErrorText, { color: colors.danger }]}>{ackError}</Text>
                  </View>
                )}

                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const as = StyleSheet.create({
  container: { flex: 1 },
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  /* No status-bar inset here — MainApp already wraps this route in a SafeAreaView. */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  /* -8 pulls the 44dp target back so the glyph optically sits on the 16dp gutter */
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, minHeight: 52,
    borderRadius: radii.md, borderWidth: 1.5, gap: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.lg, minHeight: 44,
    borderRadius: radii.pill, borderWidth: 1.5,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  skeletonWrap: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.xs },
  card: {
    borderRadius: radii.md, borderWidth: 1, borderLeftWidth: 3,
    padding: spacing.lg, marginBottom: spacing.md, minHeight: 64,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: spacing.xs },
  severityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
  },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  severityPillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  cardDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.sm },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardLoc: { fontSize: 13, lineHeight: 18, flex: 1 },
  cardDate: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  /* "acknowledged ✓" list caption — B·02 */
  ackCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  ackCaptionText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  // Modal
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '88%', overflow: 'hidden' },
  modalTopRule: { height: 3, width: '100%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1,
  },
  modalHeadTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800', letterSpacing: -0.2 },
  modalHeadSub: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },
  modalPillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  modalTypeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  modalCloseBtn: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },

  /* ── THE POSTER — strong 2px border, calm paper, no fill tricks ── */
  poster: { borderWidth: 2, borderRadius: radii.md, padding: spacing.lg },
  posterDirective: { fontWeight: '700', letterSpacing: -0.3 },
  posterEnglish: { fontSize: 17, lineHeight: 22, fontWeight: '600', marginTop: spacing.xs },
  posterBody: { fontSize: 15, lineHeight: 22, fontWeight: '400', marginTop: spacing.md },
  stepsBlock: { marginTop: spacing.lg },
  stepsHeading: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.sm },
  stepRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginTop: spacing.sm },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNumText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  helplineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderTopWidth: 1, marginTop: spacing.lg, paddingTop: spacing.lg,
  },
  helplinePhone: { fontSize: 20, lineHeight: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
  helplineMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },
  callBtn: {
    minHeight: 48, minWidth: 88, borderRadius: radii.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.lg,
  },
  callBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  posterProvenance: { fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: spacing.lg, fontVariant: ['tabular-nums'] },

  /* ── Acknowledge zone ── */
  ackBtn: {
    minHeight: 56, borderRadius: radii.md, marginTop: spacing.lg,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  ackBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  ackDoneRow: {
    minHeight: 56, borderRadius: radii.md, marginTop: spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  ackDoneText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  ackErrorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
  ackErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  btnDisabled: { opacity: 0.4 },
});

export { AllAlertsScreen };
export default AllAlertsScreen;
