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
// comes from a picker, the live recipient count is shown
// BEFORE sending, a zero count refuses to send, the
// receipt states the real number, and everything already
// sent is listed underneath with the scope it went to.
//
// The picker is the CANONICAL registry (districtsService)
// PLUS every district an active profile is actually stored
// under. Registry-only was wrong: district matching is exact
// string equality, so a live account sitting on a name the
// registry has never heard of ("Not specified") became
// unreachable the moment free text went away.
// =====================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Pressable,
  Modal, FlatList, KeyboardAvoidingView, Platform,
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
const SENT_PAGE = 10;

type AudienceKey = 'all' | 'asha_worker' | 'volunteer' | 'clinic';

// `one` / `many` are spelled out because the count sentence must be
// Hermes-safe — no Intl.PluralRules on this runtime.
//
// 'all' is "Everyone", not "All field staff", because that is what the
// row does: it inserts target_role NULL, and BOTH gates treat a null
// role as matching every role — the notifications SELECT policy and
// advisories.broadcastMatchesProfile (`if (n.target_role && ...)`).
// Officials in scope read it too. Calling it "field staff" and counting
// only the three field roles under-stated the readership: verified on
// the live DB, an "all" advisory to Chengalpattu is readable by 2
// accounts there, and the old count said 1.
const AUDIENCES: Array<{ key: AudienceKey; label: string; one: string; many: string }> = [
  { key: 'all',         label: 'Everyone',     one: 'person',      many: 'people' },
  { key: 'asha_worker', label: 'ASHA workers', one: 'ASHA worker', many: 'ASHA workers' },
  { key: 'volunteer',   label: 'Volunteers',   one: 'volunteer',   many: 'volunteers' },
  { key: 'clinic',      label: 'Clinics',      one: 'clinic',      many: 'clinics' },
];

/** Lowercase, collapse whitespace, trim — mirrors districtsService's own matching. */
const normalizePlace = (value: string | null | undefined): string =>
  String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** How many staff this advisory would reach. 'error' is NOT zero — the two must never look alike. */
type Reach =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'error' };

/** Skeleton / content / quiet-zero / error, in one shape. `ready` with an empty payload IS the quiet zero. */
type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error' };

/** One selectable district. `inRegistry` false = a real staff district the canonical list doesn't have yet. */
type DistrictOption = { name: string; inRegistry: boolean };

/** An advisory this user already sent — the receipt after the receipt. */
type SentAdvisory = {
  id: string;
  title: string;
  message: string;
  target_role: string | null;
  target_district: string | null;
  created_at: string;
};

const formatSentAt = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

/** The audience words for a stored target_role — null means the no-role broadcast. */
const audienceLabelFor = (role: string | null): string =>
  AUDIENCES.find((a) => a.key === role)?.label
  ?? (role ? role.replace(/_/g, ' ') : AUDIENCES[0].label);

export default function AdvisoryComposerScreen({
  profile, onBack,
}: { profile: Profile; onBack: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;
  const scrollRef = useRef<ScrollView>(null);

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

  // ── The district picker's options (admins only; officers are pinned) ──
  const [districtLoad, setDistrictLoad] = useState<Loadable<DistrictOption[]>>({ status: 'loading' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const prefilled = useRef(false);

  const districtOptions = districtLoad.status === 'ready' ? districtLoad.data : [];
  const registryUnreadable = districtLoad.status === 'error';
  const nothingToPick = districtLoad.status === 'ready' && districtLoad.data.length === 0;

  const loadDistricts = useCallback(async () => {
    setDistrictLoad({ status: 'loading' });

    // districtsForChecked reports failure instead of flattening it to [],
    // so an empty registry and a dead lookup no longer land in the same
    // state — one is a quiet zero, the other is an error with a Retry that
    // can actually succeed.
    const registry = await districtsService.districtsForChecked();
    if (registry.status === 'error') {
      setDistrictLoad({ status: 'error' });
      return;
    }

    // The registry is the canonical list, but it is not the whole list of
    // reachable audiences: targeting is EXACT string equality on
    // profiles.district, so any name an active profile actually sits on is
    // a real destination even when the registry has never heard of it
    // (live example: an active volunteer whose district is "Not specified").
    // Offering only canonical names silently took that account away.
    const { data, error } = await supabase
      .from('profiles')
      .select('district')
      .eq('is_active', true)
      .not('district', 'is', null)
      .limit(2000);
    if (error) {
      console.error('[AdvisoryComposer] staff districts lookup failed:', error);
      setDistrictLoad({ status: 'error' });
      return;
    }

    const options: DistrictOption[] = registry.districts.map((name) => ({ name, inRegistry: true }));
    // Dedupe EXACTLY, never case-insensitively: "Chengalpattu" and
    // "chengalpattu" are different destinations to an exact-match filter,
    // so collapsing them would hide one of them.
    const seen = new Set(registry.districts);
    for (const row of (data ?? []) as Array<{ district: string | null }>) {
      const name = String(row?.district ?? '');
      if (!name.trim() || seen.has(name)) continue;
      seen.add(name);
      options.push({ name, inRegistry: false });
    }
    options.sort((a, b) => a.name.localeCompare(b.name));
    setDistrictLoad({ status: 'ready', data: options });
  }, []);

  useEffect(() => {
    if (!isOfficial || isOfficer) return; // officers never pick a district
    loadDistricts();
  }, [isOfficial, isOfficer, loadDistricts]);

  // Prefill the picker from the profile ONLY when the profile's district is
  // itself a canonical registry name. The live health_admin's "chennai" is
  // now selectable (an active profile sits on it) but it is not canonical,
  // so that account still starts empty and must choose — which is the whole
  // point of BRK-12. Prefilling a district that reaches nobody is the bug.
  useEffect(() => {
    if (prefilled.current || isOfficer || districtLoad.status !== 'ready') return;
    if (districtLoad.data.length === 0) return;
    prefilled.current = true;
    const mine = normalizePlace(profile.district);
    if (!mine) return;
    const match = districtLoad.data.find((d) => d.inRegistry && normalizePlace(d.name) === mine);
    if (match) setDistrict(match.name);
  }, [districtLoad, isOfficer, profile.district]);

  const filteredDistricts = useMemo(() => {
    const q = normalizePlace(pickerQuery);
    if (!q) return districtOptions;
    return districtOptions.filter((d) => normalizePlace(d.name).includes(q));
  }, [districtOptions, pickerQuery]);

  // ── Recipient count — the number the receipt will have to stand behind ──
  const [reach, setReach] = useState<Reach>({ status: 'idle' });
  const reachSeq = useRef(0);

  /**
   * Active accounts other than the sender who would receive this advisory.
   * Mirrors exactly what advisories.broadcastMatchesProfile does on each
   * recipient's device:
   *   `if (n.target_role && n.target_role !== profile.role) return false;`
   * — so a NULL target_role (audience 'Everyone') filters by nothing and
   * every role reads it, officials included. The old count filtered to the
   * three field roles and therefore under-stated readership; verified live,
   * an 'Everyone' advisory to Chengalpattu is readable by 2 accounts and
   * the old count said 1.
   *
   * The sender is excluded: seeing your own advisory in your own inbox is
   * not "reach", and counting yourself would defeat refuse-at-zero for an
   * officer alone in their district.
   *
   * District is exact string equality, mirroring
   * `n.target_district !== profile.district`. RLS lets officers count their
   * own district and admins count anywhere, so this number is the truth for
   * whoever is asking.
   */
  const countRecipients = useCallback(async (aud: AudienceKey, dist: string | null): Promise<number> => {
    const base = supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .neq('id', profile.id);
    const scoped = aud === 'all' ? base : base.eq('role', aud);
    const { count, error } = await (dist ? scoped.eq('district', dist) : scoped);
    if (error) throw error;
    return count ?? 0;
  }, [profile.id]);

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
  // "no active people in X" reads wrong; the count excludes the sender, so
  // for the no-role audience the true sentence is "no one *else*".
  const zeroPhrase = audience === 'all'
    ? `there is no one else to reach ${scopePhrase}`
    : `there are no active ${audienceEntry.many} ${scopePhrase}`;

  // ── Sent advisories — what this account has already broadcast ──
  // The notifications SELECT policy admits every `user_id IS NULL` row, so
  // the sender can read back their own broadcasts; related_id is the sender
  // stamp `sendAdvisory` writes. Verified against the live DB under the
  // officer's own JWT (insert + select + rollback), not inferred from code.
  const [sent, setSent] = useState<Loadable<SentAdvisory[]>>({ status: 'loading' });

  const loadSent = useCallback(async () => {
    setSent({ status: 'loading' });
    const { data, error } = await supabase
      .from('notifications')
      .select('id,title,message,target_role,target_district,created_at')
      .is('user_id', null)
      .eq('type', 'info')
      .eq('related_type', 'user')
      .eq('related_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(SENT_PAGE);
    if (error) {
      // No `catch { return [] }` here: an unreadable history must not look
      // like an empty one, or this list repeats the bug it exists to fix.
      console.error('[AdvisoryComposer] sent advisories load failed:', error);
      setSent({ status: 'error' });
      return;
    }
    setSent({ status: 'ready', data: (data ?? []) as SentAdvisory[] });
  }, [profile.id]);

  useEffect(() => {
    if (!isOfficial) return;
    loadSent();
  }, [isOfficial, loadSent]);

  /**
   * Load a sent advisory back into the composer as a correction. An
   * advisory cannot be recalled — the row is a shared broadcast and the
   * DELETE policy is `user_id = auth.uid()`, which no broadcast row
   * satisfies — so the only honest remedy is a follow-up to the same scope.
   */
  const reuseForCorrection = (item: SentAdvisory) => {
    const base = item.title.trim();
    const next = base.toLowerCase().startsWith('correction:') ? base : `Correction: ${base}`;
    setTitle(next.slice(0, TITLE_MAX));
    setMessage(item.message.slice(0, MESSAGE_MAX));
    setAudience(AUDIENCES.find((a) => a.key === item.target_role)?.key ?? 'all');
    if (!isOfficer) {
      if (item.target_district) {
        setAllDistricts(false);
        setDistrict(item.target_district);
      } else {
        setAllDistricts(true);
        setDistrict('');
      }
    }
    setErrors({});
    setReceipt(null);
    setSubmitError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion });
  };

  const handleSend = async () => {
    if (sending || officerBlocked) return;
    // Clear the previous outcome FIRST. A receipt that survives a failed
    // re-validation is a green "sent to 3 people" sitting next to two fresh
    // red errors — a success claim about a send that did not happen.
    setReceipt(null);
    setSubmitError(null);

    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = 'Add a short title — staff see it first.';
    if (!message.trim()) nextErrors.message = 'Write the advisory message.';
    if (!isOfficer && !allDistricts && !district) {
      // Never point at a control the screen has withdrawn: when the list
      // failed or has nothing in it, "choose a district" is a dead end.
      nextErrors.district = registryUnreadable
        ? "The district list didn't load, so there is nothing to choose. Retry it above, or choose All districts."
        : nothingToPick
          ? 'There are no districts to choose from yet. Choose All districts instead.'
          : 'Choose a district, or choose All districts.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const targetRole: AdvisoryTargetRole = audience === 'all' ? null : audience;

    setSending(true);
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
          `Nothing was sent: ${zeroPhrase}. Change the audience or the district and try again.`,
        );
        return;
      }

      const res = await advisoriesService.sendAdvisory({
        title, message, targetRole, targetDistrict,
      });
      if (res.error || !res.data) throw new Error(res.error ?? 'Failed to send advisory');
      setReceipt(
        confirmed === null
          ? `Advisory sent to ${audienceLabel} ${scopePhrase} — we couldn't confirm how many people that reaches.`
          : `Advisory sent to ${peopleLabel(confirmed)} ${scopePhrase} — they see it next time they open HealthDrop.`,
      );
      setTitle('');
      setMessage('');
      setErrors({});
      loadSent(); // the new advisory belongs in the sent list immediately
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
      // Only ever name a control that exists right now. With no district
      // list to open, "choose a district" is an instruction with nothing
      // to tap; "All districts" is the choice that is still on screen.
      const hint = registryUnreadable
        ? "Choose All districts above to see how many staff this reaches — the district list didn't load."
        : nothingToPick
          ? 'Choose All districts above to see how many staff this reaches.'
          : 'Choose a district to see how many staff this reaches.';
      return (
        <View style={[st.noteCard, { backgroundColor: colors.surface }]}>
          <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
          <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            {hint}
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
            {`No one to reach — ${zeroPhrase}. This advisory would go nowhere, so it can't be sent.`}
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
        ref={scrollRef}
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
        {audience === 'all' && (
          <Text style={[st.chipCaption, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            "Everyone" sets no role filter, so officials in this scope see it too. The count never includes you.
          </Text>
        )}

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
                {/* Four states for the list itself — skeleton, the picker,
                    a quiet zero, and a dead lookup. An empty list and a
                    failed one get different words, and only the failure
                    gets a Retry, because only the failure can succeed. */}
                {districtLoad.status === 'loading' ? (
                  <SkeletonBlock height={52} radius={radii.md} />
                ) : districtLoad.status === 'error' ? (
                  <ErrorCard
                    message="Couldn't load the district list. Check your connection and try again."
                    onRetry={loadDistricts}
                  />
                ) : districtLoad.data.length === 0 ? (
                  <View style={[st.noteCard, { backgroundColor: colors.surface }]}>
                    <Ionicons name="map-outline" size={20} color={colors.textSecondary} />
                    <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                      No districts to choose from yet — the registry is empty and no active profile has a district on it. Choose All districts, or ask an administrator to add districts.
                    </Text>
                  </View>
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

        {/* ── How many people this actually reaches, before sending ──
             Suppressed for an officer with no district: there is no scope
             control on this screen for them, so a "choose a district"
             prompt would be an instruction with nothing to obey. The
             warning card above already carries the only next step. */}
        {!officerBlocked && <View style={{ marginTop: spacing.lg }}>{renderReach()}</View>}

        {/* ── Honest delivery caption — advisories do not push-notify ── */}
        <View style={[st.noteCard, { backgroundColor: colors.surface, marginTop: spacing.md }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            Delivered in-app the next time staff open HealthDrop — advisories do not push-notify.
          </Text>
        </View>

        {/* ── Sent advisories — the record of what actually went out ── */}
        <Text style={[st.sectionEyebrow, { color: colors.textSecondary, marginTop: spacing.xl }]} maxFontSizeMultiplier={1.3}>
          SENT ADVISORIES
        </Text>
        {sent.status === 'loading' ? (
          <View style={{ gap: spacing.sm }} accessibilityLabel="Loading sent advisories">
            <SkeletonBlock height={96} radius={radii.md} />
            <SkeletonBlock height={96} radius={radii.md} />
          </View>
        ) : sent.status === 'error' ? (
          <ErrorCard
            message="Couldn't load the advisories you've sent. Check your connection and try again."
            onRetry={loadSent}
          />
        ) : sent.data.length === 0 ? (
          <View style={[st.noteCard, { backgroundColor: colors.surface }]}>
            <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
            <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              You haven't sent an advisory yet. The ones you send appear here with the audience and district they went to.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {sent.data.map((item) => (
              <View key={item.id} style={[st.sentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={st.sentTopRow}>
                  <Text style={[st.sentScope, { color: colors.textSecondary }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                    {`${audienceLabelFor(item.target_role)} · ${item.target_district || 'All districts'}`}
                  </Text>
                  <Text style={[st.sentTime, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                    {formatSentAt(item.created_at)}
                  </Text>
                </View>
                <Text style={[st.sentTitle, { color: colors.text }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                  {item.title}
                </Text>
                <Text style={[st.sentMessage, { color: colors.textSecondary }]} numberOfLines={3} maxFontSizeMultiplier={1.3}>
                  {item.message}
                </Text>
                <Pressable
                  onPress={() => reuseForCorrection(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Send a correction to "${item.title}"`}
                  style={({ pressed }) => [
                    st.sentAction,
                    { backgroundColor: pressed ? colors.cardHover : colors.card },
                  ]}
                >
                  <Ionicons name="create-outline" size={16} color={colors.primaryDark} />
                  <Text style={[st.sentActionText, { color: colors.primaryDark }]} maxFontSizeMultiplier={1.3}>
                    Send a correction
                  </Text>
                </Pressable>
              </View>
            ))}
            <Text style={[st.sentFootnote, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              An advisory can't be recalled once it's sent. "Send a correction" reloads it here so the follow-up goes to the same audience and district.
            </Text>
          </View>
        )}
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
        {officerBlocked && !submitError && (
          <View style={[st.resultRow, { backgroundColor: colors.warningBg }]}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            <Text style={[st.resultText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              Can't send: an officer's advisory must name a district, and your profile has none.
            </Text>
          </View>
        )}
        {blockedByZero && !officerBlocked && !submitError && (
          <View style={[st.resultRow, { backgroundColor: colors.warningBg }]}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            <Text style={[st.resultText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {`Can't send: ${zeroPhrase}.`}
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
              : officerBlocked ? 'Send advisory — unavailable, your profile has no district'
                : blockedByZero ? `Send advisory — unavailable, ${zeroPhrase}`
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

      {/* ── District picker — a closed list, no free text. Canonical
           registry names plus the districts live staff are actually
           stored under, so no active account is unreachable. ── */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setPickerOpen(false)}
      >
        {/* The sheet centres itself in whatever height is left, so the
            search field can't end up under the keyboard on iOS (Android
            resizes the window itself, hence no behavior there). */}
        <KeyboardAvoidingView
          style={st.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
              keyExtractor={(item) => item.name}
              keyboardShouldPersistTaps="handled"
              style={st.modalList}
              ListEmptyComponent={
                <Text style={[st.modalEmpty, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {`No district matches "${pickerQuery.trim()}".`}
                </Text>
              }
              renderItem={({ item }) => {
                const selected = item.name === district;
                return (
                  <TouchableOpacity
                    onPress={() => {
                      setDistrict(item.name);
                      setPickerOpen(false);
                      touch();
                      if (errors.district) setErrors((e) => ({ ...e, district: undefined }));
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={
                      item.inRegistry
                        ? `District ${item.name}`
                        : `District ${item.name}, not in the district registry`
                    }
                    style={[st.modalRow, { borderBottomColor: colors.borderLight }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[st.modalRowText, { color: selected ? colors.primary : colors.text, fontWeight: selected ? '700' : '500' }]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                      >
                        {item.name}
                      </Text>
                      {/* Off-registry names are still real destinations —
                          staff are stored under them — but they are worth
                          flagging so the registry gets tidied. */}
                      {!item.inRegistry && (
                        <Text style={[st.modalRowMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                          Staff are filed here, but it isn't in the district registry
                        </Text>
                      )}
                    </View>
                    {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
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

  /* Audience / scope chips — selection is never tint alone.
     48dp, not 44: these chips are the audience and the scope, i.e. the
     two controls the recipient count depends on. */
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 48, borderRadius: radii.pill, borderWidth: 1.5,
    paddingHorizontal: spacing.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  chipText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  chipCaption: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.sm },

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

  /* Sent advisories — the record of what actually went out */
  sentCard: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, gap: spacing.xs,
  },
  sentTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sentScope: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', letterSpacing: 0.4 },
  sentTime: { fontSize: 12, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sentTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  sentMessage: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  sentAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start',
    gap: spacing.xs, minHeight: 48, borderRadius: radii.sm,
    marginTop: spacing.xs, paddingHorizontal: spacing.sm, alignSelf: 'flex-start',
  },
  sentActionText: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  sentFootnote: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.xs },

  /* District picker sheet */
  modalRoot: { flex: 1 },
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
  modalRowText: { fontSize: 15, lineHeight: 22 },
  modalRowMeta: { fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 2 },
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
