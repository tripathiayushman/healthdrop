// =====================================================
// ADVISORY COMPOSER SCREEN — Bharosa B·02 / D·02
// "Broadcast to staff": officials write an internal
// advisory that lands in field staff's notifications
// inbox — IN-APP ONLY. There is no officer-accessible
// push path, and the UI says so honestly. Officers are
// locked to their own district (the DB INSERT policy
// enforces it); health/super admins may scope to one
// district or all. Inline success + inline errors,
// never Alert.alert.
// =====================================================
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { Profile } from '../../types';
import {
  advisoriesService, AdvisoryTargetRole, ADVISORY_SENDER_ROLES,
} from '../../lib/services/advisories';
import { SyncPebble, ROLE_ACCENT } from '../dashboards/DashboardShared';

const TITLE_MAX = 120;
const MESSAGE_MAX = 1000;

type AudienceKey = 'all' | 'asha_worker' | 'volunteer' | 'clinic';

const AUDIENCES: Array<{ key: AudienceKey; label: string }> = [
  { key: 'all',         label: 'All field staff' },
  { key: 'asha_worker', label: 'ASHA workers' },
  { key: 'volunteer',   label: 'Volunteers' },
  { key: 'clinic',      label: 'Clinics' },
];

export default function AdvisoryComposerScreen({
  profile, onBack,
}: { profile: Profile; onBack: () => void }) {
  const { colors, isDark } = useTheme();
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
  const [district, setDistrict] = useState(isOfficer ? officerDistrict : (profile.district ?? ''));
  const [focused, setFocused] = useState<'title' | 'message' | 'district' | null>(null);
  const [errors, setErrors] = useState<{ title?: string; message?: string; district?: string }>({});
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const audienceLabel = useMemo(
    () => AUDIENCES.find((a) => a.key === audience)?.label ?? 'All field staff',
    [audience],
  );

  // Any edit clears the last inline success — one send, one receipt.
  const touch = () => { if (sentTo) setSentTo(null); if (submitError) setSubmitError(null); };

  const handleSend = async () => {
    if (sending || officerBlocked) return;
    const nextErrors: typeof errors = {};
    if (!title.trim()) nextErrors.title = 'Add a short title — staff see it first.';
    if (!message.trim()) nextErrors.message = 'Write the advisory message.';
    if (!isOfficer && !allDistricts && !district.trim()) {
      nextErrors.district = 'Name a district, or choose All districts.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const targetRole: AdvisoryTargetRole = audience === 'all' ? null : audience;
    const targetDistrict = isOfficer
      ? officerDistrict
      : allDistricts ? null : district.trim();

    setSending(true);
    setSubmitError(null);
    setSentTo(null);
    try {
      const res = await advisoriesService.sendAdvisory({
        title, message, targetRole, targetDistrict,
      });
      if (res.error || !res.data) throw new Error(res.error ?? 'Failed to send advisory');
      const scope = targetDistrict ? `in ${targetDistrict}` : 'across all districts';
      setSentTo(`${audienceLabel} ${scope}`);
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

  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;

  const inputStyle = (field: 'title' | 'message' | 'district', hasError: boolean) => ([
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
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
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
                <TextInput
                  value={district}
                  onChangeText={(v) => { setDistrict(v); touch(); if (errors.district) setErrors((e) => ({ ...e, district: undefined })); }}
                  onFocus={() => setFocused('district')}
                  onBlur={() => setFocused(null)}
                  placeholder="e.g. Kalahandi"
                  placeholderTextColor={colors.inputPlaceholderColor}
                  style={inputStyle('district', !!errors.district)}
                  accessibilityLabel="Target district"
                />
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

        {/* ── Honest delivery caption — advisories do not push-notify ── */}
        <View style={[st.noteCard, { backgroundColor: colors.surface, marginTop: spacing.xl }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={[st.noteText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            Delivered in-app the next time staff open HealthDrop — advisories do not push-notify.
          </Text>
        </View>
      </ScrollView>

      {/* ── One-Hand Action Bar — inline receipt / inline failure, 56dp Send ── */}
      <View style={[st.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {sentTo && (
          <View style={[st.resultRow, { backgroundColor: colors.successBg }]}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
            <Text style={[st.resultText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
              {`Advisory sent to ${sentTo} — staff see it next time they open HealthDrop.`}
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
        <Pressable
          onPress={handleSend}
          disabled={sending || officerBlocked}
          accessibilityRole="button"
          accessibilityLabel={sending ? 'Sending advisory' : `Send advisory to ${audienceLabel}`}
          style={({ pressed }) => [
            st.sendBtn,
            {
              backgroundColor: pressed ? colors.primaryPressed : colors.primary,
              opacity: sending || officerBlocked ? 0.4 : 1,
            },
          ]}
        >
          <Text style={[st.sendBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
            {sending ? 'Sending…' : 'Send advisory'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: 42, paddingBottom: spacing.xl,
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
