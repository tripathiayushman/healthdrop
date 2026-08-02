// =====================================================
// ADVISORY COMPOSER SCREEN — Bharosa B·02 / D·02
// "Broadcast to staff": officials write an internal
// advisory that lands in field staff's notifications
// inbox — IN-APP ONLY. There is no officer-accessible
// push path, and the UI says so honestly. Officers are
// locked to their own district (the DB INSERT policy
// enforces it); health/super admins pick ONE canonical
// district from the registry or scope to all. Inline
// success + inline errors, never Alert.alert.
//
// BRK-12: the district used to be free text and the
// receipt claimed success without a number, so a typo —
// or the prefilled profile district, which for the live
// health_admin is "chennai" and matches nobody — sent a
// green "Advisory sent" to zero people. Now the district
// comes from public.districts (districtsService, the same
// registry the report forms steer to), the live recipient
// count is shown BEFORE sending, a zero count refuses to
// send, and the receipt states the real number.
// =====================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Pressable,
  Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  advisoriesService, AdvisoryTargetRole, ADVISORY_SENDER_ROLES,
} from '../../lib/services/advisories';
import { districtsService } from '../../lib/services/districts';
import { SyncPebble, SkeletonBlock, ErrorCard, ROLE_ACCENT } from '../dashboards/DashboardShared';

const TITLE_MAX = 120;
const MESSAGE_MAX = 1000;

type AudienceKey = 'all' | 'asha_worker' | 'volunteer' | 'clinic';

// `one` / `many` are spelled out because the count sentence must be
// Hermes-safe — no Intl.PluralRules on this runtime.
const AUDIENCES: Array<{ key: AudienceKey; label: string; one: string; many: string }> = [
  { key: 'all',         label: 'All field staff', one: 'field staff member', many: 'field staff' },
  { key: 'asha_worker', label: 'ASHA workers',    one: 'ASHA worker',        many: 'ASHA workers' },
  { key: 'volunteer',   label: 'Volunteers',      one: 'volunteer',          many: 'volunteers' },
  { key: 'clinic',      label: 'Clinics',         one: 'clinic',             many: 'clinics' },
];

/** The roles an advisory can actually land on — "All field staff" fans out to exactly these. */
const FIELD_ROLES: string[] = AUDIENCES.filter((a) => a.key !== 'all').map((a) => a.key);

/** Lowercase, collapse whitespace, trim — mirrors districtsService's own matching. */
const normalizePlace = (value: string | null | undefined): string =>
  String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** How many staff this advisory would reach. 'error' is NOT zero — the two must never look alike. */
type Reach =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'error' };

export default function AdvisoryComposerScreen({
  profile, onBack,
}: { profile: Profile; onBack: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  const isOfficial = ADVISORY_SENDER_ROLES.includes(profile.role);
  const isOfficer = profile.role === 'district_officer';
  // The DB requires an officer's target_district to equal their own
  // district exactly. No district on the profile → cannot send at all
  // (a null target would legally broadcast to every district).
  const officerDistrict = (profile.district ?? '').trim();
  const officerBlocked = isOfficer && !officerDistrict;

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AudienceKey>('all');
  const [allDistricts, setAllDistricts] = useState(false); // admins only
  // Admins start with NO district. It is filled only from the registry
  // (see the prefill effect) — never straight from the profile, because
  // a profile district that matches no staff is exactly the BRK-12 bug.
  const [district, setDistrict] = useState('');
  const [focused, setFocused] = useState<'title' | 'message' | null>(null);
  const [errors, setErrors] = useState<{ title?: string; message?: string; district?: string }>({});
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const audienceEntry = useMemo(
    () => AUDIENCES.find((a) => a.key === audience) ?? AUDIENCES[0],
    [audience],
  );
  const audienceLabel = audienceEntry.label;

  // The district this advisory is actually addressed to, and whether the
  // officer/admin has said enough for a recipient count to mean anything.
  const targetDistrict = isOfficer
    ? (officerDistrict || null)
    : allDistricts ? null : (district || null);
  const scopeChosen = isOfficer ? !!officerDistrict : (allDistricts || !!district);
  const scopePhrase = targetDistrict ? `in ${targetDistrict}` : 'across all districts';

  // Any edit clears the last inline success — one send, one receipt.
  const touch = () => { if (receipt) setReceipt(null); if (submitError) setSubmitError(null); };

  // ── Canonical district registry (admins only; officers are pinned) ──
  const [districtList, setDistrictList] = useState<string[] | null>(null);
  const [districtsFailed, setDistrictsFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const prefilled = useRef(false);

  const loadDistricts = useCallback(async () => {
    setDistrictsFailed(false);
    setDistrictList(null);
    let rows: string[] = [];
    try {
      rows = await districtsService.districtsFor();
    } catch {
      rows = [];
    }
    // districtsService degrades silently to [] on failure, so an empty
    // answer here is either a dead lookup or an empty registry. The
    // registry is never legitimately empty, and an officer must not be
    // shown a blank picker they cannot act on, so empty == error + retry.
    setDistrictList(rows);
    setDistrictsFailed(rows.length === 0);
  }, []);

  useEffect(() => {
    if (!isOfficial || isOfficer) return; // officers never pick a district
    loadDistricts();
  }, [isOfficial, isOfficer, loadDistricts]);

  // Prefill the picker from the profile ONLY when the profile's district is
  // itself a canonical registry name. The live health_admin's "chennai"
  // matches nothing, so that account now starts empty and must choose —
  // which is the whole point of BRK-12.
  useEffect(() => {
    if (prefilled.current || isOfficer || !districtList || districtList.length === 0) return;
    prefilled.current = true;
    const mine = normalizePlace(profile.district);
    if (!mine) return;
    const match = districtList.find((d) => normalizePlace(d) === mine);
    if (match) setDistrict(match);
  }, [districtList, isOfficer, profile.district]);

  const filteredDistricts = useMemo(() => {
    const rows = districtList ?? [];
    const q = normalizePlace(pickerQuery);
    if (!q) return rows;
    return rows.filter((d) => normalizePlace(d).includes(q));
  }, [districtList, pickerQuery]);

  // ── Recipient count — the number the receipt will have to stand behind ──
  const [reach, setReach] = useState<Reach>({ status: 'idle' });
  const reachSeq = useRef(0);

  /**
   * Active staff who would receive this advisory. Mirrors exactly what
   * advisories.broadcastMatchesProfile does on each recipient's device:
   * role must match (null role = all three field roles), and district must
   * match by exact string equality — which is why the district has to be
   * canonical. RLS lets officers count their own district and admins count
   * anywhere, so this number is the truth for whoever is asking.
   */
  const countRecipients = useCallback(async (aud: AudienceKey, dist: string | null): Promise<number> => {
    const base = supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    const scoped = aud === 'all' ? base.in('role', FIELD_ROLES) : base.eq('role', aud);
    const { count, error } = await (dist ? scoped.eq('district', dist) : scoped);
    if (error) throw error;
    return count ?? 0;
  }, []);

  const refreshReach = useCallback(() => {
    if (!scopeChosen) { setReach({ status: 'idle' }); return; }
    const seq = ++reachSeq.current;
    setReach({ status: 'loading' });
    countRecipients(audience, targetDistrict)
      .then((n) => { if (reachSeq.current === seq) setReach({ status: 'ready', count: n }); })
      .catch((err) => {
        console.error('[AdvisoryComposer] recipient count failed:', err);
        if (reachSeq.current === seq) setReach({ status: 'error' });
      });
  }, [audience, targetDistrict, scopeChosen, countRecipients]);

  useEffect(() => { refreshReach(); }, [refreshReach]);

  const peopleLabel = (n: number) => `${n} ${n === 1 ? audienceEntry.one : audienceEntry.many}`;
  const blockedByZero = reach.status === 'ready' && reach.count === 0;

  const handleSend = async () => {
    if (sending || officerBlocked) return;
    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = 'Add a short title — staff see it first.';
    if (!message.trim()) nextErrors.message = 'Write the advisory message.';
    if (!isOfficer && !allDistricts && !district) {
      nextErrors.district = 'Choose a district, or choose All districts.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const targetRole: AdvisoryTargetRole = audience === 'all' ? null : audience;

    setSending(true);
    setSubmitError(null);
    setReceipt(null);
    try {
      // Re-count at the moment of sending: the number in the receipt has to
      // be the number at send time, and a count that went to zero while the
      // officer was typing must not slip through.
      let confirmed: number | null = null;
      try {
        confirmed = await countRecipients(audience, targetDistrict);
        reachSeq.current++; // this answer wins over any in-flight refresh
        setReach({ status: 'ready', count: confirmed });
      } catch (countErr) {
        console.error('[AdvisoryComposer] pre-send recipient count failed:', countErr);
        reachSeq.current++;
        setReach({ status: 'error' });
        confirmed = null; // unknown — NOT zero, so the send still goes ahead
      }

      if (confirmed === 0) {
        setSubmitError(
          `Nothing was sent: there are no active ${audienceEntry.many} ${scopePhrase}. ` +
          'Change the audience or the district and try again.',
        );
        return;
      }

      const res = await advisoriesService.sendAdvisory({
        title, message, targetRole, targetDistrict,
      });
      if (res.error || !res.data) throw new Error(res.error ?? 'Failed to send advisory');
      setReceipt(
        confirmed === null
          ? `Advisory sent to ${audienceLabel} ${scopePhrase} — we couldn't confirm how many staff that reaches.`
          : `Advisory sent to ${peopleLabel(confirmed)} ${scopePhrase} — they see it next time they open HealthDrop.`,
      );
      setTitle('');
      setMessage('');
      setErrors({});
    } catch (err: any) {
      console.error('[AdvisoryComposer] send failed:', err);
      setSubmitError(err.message ?? "Couldn't send the advisory — check connection and try again.");
    } finally {
      setSending(false);
    }
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers read correctly in BOTH modes.
  // textInverse here would be white-on-paper — invisible — and is banned.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  const inputStyle = (field: 'title' | 'message', hasError: boolean) => ([
    st.input,
    {
      backgroundColor: colors.inputBackground,
      color: colors.text,
      borderColor: hasError
        ? colors.inputErrorBorder
        : focused === field ? colors.inputFocusBorder : colors.inputBorder,
      borderWidth: hasError || focused === field ? 2 : 1.5,
    },
  ]);

  const header = (
    <>
      <View
        style={[
          st.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={st.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={st.headerTextWrap}>
          <Text style={[st.headerTitle, { color: headerText }]} numberOfLines={1}>Broadcast to staff</Text>
          <Text style={[st.headerSub, { color: headerSub }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            Internal advisory — never shown to public
          </Text>
        </View>
        <SyncPebble />
      </View>
      <View style={[st.roleRibbon, { backgroundColor: accent }]} />
    </>
  );

  // In-screen guard — the route gates roles too, but never trust one wall.
  if (!isOfficial) {
    return (
      <View style={[st.container, { backgroundColor: colors.background }]}>
        {header}
        <View style={st.guardWrap}>
          <Ionicons name="lock-closed-outline" size={24} color={colors.textSecondary} />
          <Text style={[st.guardTitle, { color: colors.text }]}>Officials only</Text>
          <Text style={[st.guardBody, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            Staff advisories are sent by district officers and health administrators. Your role can't send them.
          </Text>
        </View>
      </View>
    );
  }

  // ── The reach block: skeleton / count / quiet zero / error-with-retry ──
  const renderReach = () => {
    if (reach.status === 'idle') {
      return (
        <View style={[st.noteCard, { backgroundColor: colors.surface }]}>
          <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
          <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            Choose a district to see how many staff this reaches.
          </Text>
        </View>
      );
    }
    if (reach.status === 'loading') {
      return (
        <View
          style={[st.noteCard, { backgroundColor: colors.surface }]}
          accessibilityLabel="Counting recipients"
        >
          <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <SkeletonBlock width="70%" height={14} />
            <SkeletonBlock width="40%" height={12} />
          </View>
        </View>
      );
    }
    if (reach.status === 'error') {
      return (
        <ErrorCard
          message="Couldn't check how many staff this reaches. You can still send — the receipt will say the number is unconfirmed."
          onRetry={refreshReach}
        />
      );
    }
    if (reach.count === 0) {
      // A silent zero is the bug this screen was shipped with. Say it loudly:
      // sending now would produce a green receipt and reach nobody.
      return (
        <View style={[st.noteCard, { backgroundColor: colors.warningBg }]} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
          <Text style={[st.noteText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {`No one to reach — there are no active ${audienceEntry.many} ${scopePhrase}. This advisory would go nowhere, so it can't be sent.`}
          </Text>
        </View>
      );
    }
    return (
      <View style={[st.reachCard, { backgroundColor: colors.primaryLight }]} accessibilityLiveRegion="polite">
        <Ionicons name="people-outline" size={20} color={colors.primaryDark} />
        <Text style={[st.reachText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          {`Reaches ${peopleLabel(reach.count)} ${scopePhrase}.`}
        </Text>
      </View>
    );
  };

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      {header}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={st.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Message section ── */}
        <Text style={[st.sectionEyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
          THE ADVISORY
        </Text>

        <Text style={[st.label, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>TITLE *</Text>
        <TextInput
          value={title}
          onChangeText={(v) => { setTitle(v); touch(); if (errors.title) setErrors((e) => ({ ...e, title: undefined })); }}
          onFocus={() => setFocused('title')}
          onBlur={() => setFocused(null)}
          placeholder="e.g. Carry ORS on Saturday rounds"
          placeholderTextColor={colors.inputPlaceholderColor}
          maxLength={TITLE_MAX}
          style={inputStyle('title', !!errors.title)}
          accessibilityLabel="Advisory title"
        />
        {!!errors.title && (
          <View style={st.errorRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={[st.errorText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>{errors.title}</Text>
          </View>
        )}

        <Text style={[st.label, { color: colors.textSecondary, marginTop: spacing.lg }]} maxFontSizeMultiplier={1.3}>
          MESSAGE *
        </Text>
        <TextInput
          value={message}
          onChangeText={(v) => { setMessage(v); touch(); if (errors.message) setErrors((e) => ({ ...e, message: undefined })); }}
          onFocus={() => setFocused('message')}
          onBlur={() => setFocused(null)}
          placeholder="What should staff do, and when? Short verbs carry best."
          placeholderTextColor={colors.inputPlaceholderColor}
          maxLength={MESSAGE_MAX}
          multiline
          style={[...inputStyle('message', !!errors.message), st.textarea]}
          accessibilityLabel="Advisory message"
        />
        <View style={st.counterRow}>
          {errors.message ? (
            <View style={[st.errorRow, { marginTop: 0, flex: 1 }]}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
              <Text style={[st.errorText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>{errors.message}</Text>
            </View>
          ) : <View style={{ flex: 1 }} />}
          <Text style={[st.counter, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
            {`${message.length}/${MESSAGE_MAX}`}
          </Text>
        </View>

        {/* ── Audience section ── */}
        <Text style={[st.sectionEyebrow, { color: colors.textSecondary, marginTop: spacing.xl }]} maxFontSizeMultiplier={1.3}>
          WHO SEES IT
        </Text>
        <View style={st.chipRow}>
          {AUDIENCES.map((a) => {
            const selected = audience === a.key;
            return (
              <Pressable
                key={a.key}
                onPress={() => { setAudience(a.key); touch(); }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Audience: ${a.label}`}
                style={({ pressed }) => [
                  st.chip,
                  selected
                    ? { backgroundColor: pressed ? colors.primaryPressed : colors.primary, borderColor: colors.primary }
                    : { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.border },
                ]}
              >
                {selected && <Ionicons name="checkmark" size={16} color={colors.onPrimary} />}
                <Text
                  style={[st.chipText, { color: selected ? colors.onPrimary : colors.text }]}
                  maxFontSizeMultiplier={1.3}
                >
                  {a.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── District scope ── */}
        <Text style={[st.sectionEyebrow, { color: colors.textSecondary, marginTop: spacing.xl }]} maxFontSizeMultiplier={1.3}>
          WHERE
        </Text>
        {isOfficer ? (
          officerBlocked ? (
            <View style={[st.noteCard, { backgroundColor: colors.warningBg }]}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
              <Text style={[st.noteText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                Your profile has no district set, so there is no one to send to. Ask your administrator to fix your profile first.
              </Text>
            </View>
          ) : (
            <View style={[st.lockedRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[st.lockedDistrict, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {officerDistrict}
                </Text>
                <Text style={[st.lockedCaption, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {`You can only reach staff in ${officerDistrict}`}
                </Text>
              </View>
            </View>
          )
        ) : (
          <>
            <View style={st.chipRow}>
              {[{ all: true, label: 'All districts' }, { all: false, label: 'One district' }].map((opt) => {
                const selected = allDistricts === opt.all;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => { setAllDistricts(opt.all); touch(); if (errors.district) setErrors((e) => ({ ...e, district: undefined })); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Scope: ${opt.label}`}
                    style={({ pressed }) => [
                      st.chip,
                      selected
                        ? { backgroundColor: pressed ? colors.primaryPressed : colors.primary, borderColor: colors.primary }
                        : { backgroundColor: pressed ? colors.cardHover : colors.card, borderColor: colors.border },
                    ]}
                  >
                    {selected && <Ionicons name="checkmark" size={16} color={colors.onPrimary} />}
                    <Text
                      style={[st.chipText, { color: selected ? colors.onPrimary : colors.text }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!allDistricts && (
              <>
                <Text style={[st.label, { color: colors.textSecondary, marginTop: spacing.md }]} maxFontSizeMultiplier={1.3}>
                  DISTRICT *
                </Text>
                {/* Four states for the registry itself — a blank picker and a
                    dead lookup must not look the same. */}
                {districtsFailed ? (
                  <ErrorCard
                    message="Couldn't load the district list. Check your connection and try again."
                    onRetry={loadDistricts}
                  />
                ) : districtList === null ? (
                  <SkeletonBlock height={52} radius={radii.md} />
                ) : (
                  <Pressable
                    onPress={() => { setPickerQuery(''); setPickerOpen(true); }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: pickerOpen }}
                    accessibilityLabel={district ? `District: ${district}. Change district` : 'Choose a district'}
                    style={({ pressed }) => [
                      st.pickerBtn,
                      {
                        backgroundColor: pressed ? colors.cardHover : colors.inputBackground,
                        borderColor: errors.district
                          ? colors.inputErrorBorder
                          : district ? colors.inputFilledBorder : colors.inputBorder,
                        borderWidth: errors.district ? 2 : 1.5,
                      },
                    ]}
                  >
                    <Text
                      style={[st.pickerText, { color: district ? colors.text : colors.inputPlaceholderColor }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                    >
                      {district || 'Choose a district'}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                  </Pressable>
                )}
                {!!errors.district && (
                  <View style={st.errorRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <Text style={[st.errorText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>{errors.district}</Text>
                  </View>
                )}
              </>
            )}
          </>
        )}

        {/* ── How many people this actually reaches, before sending ── */}
        <View style={{ marginTop: spacing.lg }}>{renderReach()}</View>

        {/* ── Honest delivery caption — advisories do not push-notify ── */}
        <View style={[st.noteCard, { backgroundColor: colors.surface, marginTop: spacing.md }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            Delivered in-app the next time staff open HealthDrop — advisories do not push-notify.
          </Text>
        </View>
      </ScrollView>

      {/* ── One-Hand Action Bar — inline receipt / inline failure, 56dp Send ── */}
      <View style={[st.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {receipt && (
          <View style={[st.resultRow, { backgroundColor: colors.successBg }]}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
            <Text style={[st.resultText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
              {receipt}
            </Text>
          </View>
        )}
        {submitError && (
          <View style={[st.resultRow, { backgroundColor: colors.dangerBg }]}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={[st.resultText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
              {submitError}
            </Text>
          </View>
        )}
        {/* The disabled Send must never be a mystery — say why, next to it. */}
        {blockedByZero && !submitError && (
          <View style={[st.resultRow, { backgroundColor: colors.warningBg }]}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            <Text style={[st.resultText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {`Can't send: no active ${audienceEntry.many} ${scopePhrase}.`}
            </Text>
          </View>
        )}
        <Pressable
          onPress={handleSend}
          disabled={sending || officerBlocked || blockedByZero}
          accessibilityRole="button"
          accessibilityState={{ disabled: sending || officerBlocked || blockedByZero }}
          accessibilityLabel={
            sending ? 'Sending advisory'
              : blockedByZero ? `Send advisory — unavailable, no active ${audienceEntry.many} ${scopePhrase}`
                : reach.status === 'ready' ? `Send advisory to ${peopleLabel(reach.count)} ${scopePhrase}`
                  : `Send advisory to ${audienceLabel}`
          }
          style={({ pressed }) => [
            st.sendBtn,
            {
              backgroundColor: pressed ? colors.primaryPressed : colors.primary,
              opacity: sending || officerBlocked || blockedByZero ? 0.4 : 1,
            },
          ]}
        >
          <Text style={[st.sendBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
            {sending
              ? 'Sending…'
              : reach.status === 'ready' && reach.count > 0
                ? `Send to ${peopleLabel(reach.count)}`
                : 'Send advisory'}
          </Text>
        </Pressable>
      </View>

      {/* ── Canonical district picker — registry names only, no free text ── */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={[st.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setPickerOpen(false)}
          accessibilityLabel="Close district list"
        >
          {/* Inner Pressable swallows taps so a tap on the sheet doesn't close it. */}
          <Pressable
            style={[st.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <View style={[st.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[st.modalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                Choose a district
              </Text>
              <TouchableOpacity
                onPress={() => setPickerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={st.modalSearchWrap}>
              <TextInput
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder="Search districts"
                placeholderTextColor={colors.inputPlaceholderColor}
                autoCorrect={false}
                style={[
                  st.input,
                  { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder, borderWidth: 1.5 },
                ]}
                accessibilityLabel="Search districts"
              />
            </View>

            <FlatList
              data={filteredDistricts}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={st.modalList}
              ListEmptyComponent={
                <Text style={[st.modalEmpty, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {`No district in the registry matches "${pickerQuery.trim()}".`}
                </Text>
              }
              renderItem={({ item }) => {
                const selected = item === district;
                return (
                  <TouchableOpacity
                    onPress={() => {
                      setDistrict(item);
                      setPickerOpen(false);
                      touch();
                      if (errors.district) setErrors((e) => ({ ...e, district: undefined }));
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`District ${item}`}
                    style={[st.modalRow, { borderBottomColor: colors.borderLight }]}
                  >
                    <Text
                      style={[st.modalRowText, { color: selected ? colors.primary : colors.text, fontWeight: selected ? '700' : '500' }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                    >
                      {item}
                    </Text>
                    {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  /* No status-bar inset here — MainApp already wraps this route in a SafeAreaView. */
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, lineHeight: 30 /* ×1.35+ — Devanagari matras */, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2 },
  roleRibbon: { height: 4, width: '100%' },

  /* Role guard */
  guardWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  guardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  guardBody: { fontSize: 15, lineHeight: 22, fontWeight: '500', textAlign: 'center' },

  /* Form */
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  sectionEyebrow: { fontSize: 12, lineHeight: 17 /* ×1.35+ */, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.md },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.4, marginBottom: spacing.sm },
  input: {
    minHeight: 52, borderRadius: radii.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 15, lineHeight: 21, fontWeight: '500',
  },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
  counterRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.xs, gap: spacing.sm },
  counter: { fontSize: 12, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.xs },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  /* Audience / scope chips — selection is never tint alone */
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44, borderRadius: radii.pill, borderWidth: 1.5,
    paddingHorizontal: spacing.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  chipText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },

  /* District picker trigger — reads as an input, opens the registry list */
  pickerBtn: {
    minHeight: 52, borderRadius: radii.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  pickerText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500' },

  /* Officer's locked district */
  lockedRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radii.md, borderWidth: 1, padding: spacing.lg, minHeight: 56,
  },
  lockedDistrict: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  lockedCaption: { fontSize: 12, lineHeight: 17 /* ×1.35+ */, fontWeight: '500', marginTop: 2 },

  /* Quiet informational card */
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    borderRadius: radii.md, padding: spacing.lg,
  },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  /* Recipient count — the one number this screen has to stand behind */
  reachCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radii.md, padding: spacing.lg,
  },
  reachText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700' },

  /* District picker sheet */
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 420, maxHeight: '80%', borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, borderBottomWidth: 1,
  },
  modalTitle: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  modalSearchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  // flexShrink lets the list give way to the card's 80% cap on short
  // screens; without it the rows would clip under the sheet's edge.
  modalList: { paddingHorizontal: spacing.lg, maxHeight: 400, flexShrink: 1 },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: 48, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowText: { flex: 1, fontSize: 15, lineHeight: 22 },
  modalEmpty: { fontSize: 14, lineHeight: 20, fontWeight: '600', paddingVertical: spacing.lg },

  /* One-Hand Action Bar */
  actionBar: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderRadius: radii.sm, padding: spacing.md,
  },
  resultText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  sendBtn: {
    minHeight: 56, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
});
