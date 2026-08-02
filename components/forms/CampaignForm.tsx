// =====================================================
// CAMPAIGN FORM — Prakash restyle
// Flat header, labels-above 52dp inputs, 44dp selection
// chips, inline errors + scroll-to-first-error,
// One-Hand Action Bar. Zero hex literals.
// =====================================================
import React, { useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { useFormDraft, FormExitHandle } from '../../lib/useFormDraft';
import {
  DiscardChangesSheet,
  RestoreDraftSheet,
  DraftStorageNotice,
  StaleDraftDatesNotice,
} from '../../lib/FormGuardSheets';
import { SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';
import { Profile } from '../../types';

interface CampaignFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  /** Scopes the autosaved draft to this user — a shared handset must not leak drafts. */
  profile?: Profile;
  /** BRK-14 — MainApp routes the Android hardware back press through here. */
  exitRef?: React.Ref<FormExitHandle>;
}

// ── Local building blocks ────────────────────────────────────────────────────

const SelectChip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: Theme;
}> = ({ label, selected, onPress, colors }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    style={({ pressed }) => [
      styles.chip,
      {
        backgroundColor: selected ? colors.primary : pressed ? colors.cardHover : colors.card,
        borderColor: selected ? colors.primary : colors.border,
      },
    ]}
  >
    {selected && <Ionicons name="checkmark" size={16} color={colors.onPrimary} />}
    <Text style={[styles.chipLabel, { color: selected ? colors.onPrimary : colors.text }]}>
      {label}
    </Text>
  </Pressable>
);

const FieldError: React.FC<{ message?: string; colors: Theme }> = ({ message, colors }) => {
  if (!message) return null;
  return (
    <View style={styles.errorRow} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={[styles.errorText, { color: colors.danger }]}>{message}</Text>
    </View>
  );
};

const FIELD_ORDER = ['campaign_name', 'location', 'end_date'];

export const CampaignForm: React.FC<CampaignFormProps> = ({
  onSuccess,
  onCancel,
  profile,
  exitRef,
}) => {
  const { colors, reduceMotion } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const sectionYRef = useRef<Record<string, number>>({});
  const fieldYRef = useRef<Record<string, number>>({});
  const fieldSectionRef = useRef<Record<string, string>>({});

  /** Same convention as the seeded defaults below, so the two are comparable. */
  const todayIso = () => new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState(() => {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
    campaign_name: '',
    campaign_type: 'vaccination',
    custom_campaign_type: '',
    description: '',
    target_audience: 'all',
    custom_target_audience: '',
    location_name: '',
    district: '',
    state: '',
    start_date: today.toISOString().split('T')[0],
    end_date: nextWeek.toISOString().split('T')[0],
    target_beneficiaries: '',
    contact_person: '',
    contact_phone: '',
    notes: '',
    // One idempotency key per filling-in, carried INSIDE the draft snapshot so
    // it survives the save/restore round trip. health_campaigns already has a
    // UNIQUE index on client_idempotency_key (verified against the live
    // project), and the offline queue has always used one — only this online
    // insert did not, so a request whose row committed while the response was
    // lost left a draft that could file the SAME campaign twice on restore.
    // Never regenerated per send: a key minted at send time cannot collide
    // with the row already inserted, which is the whole point.
    client_idempotency_key: `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    };
  });

  // ── NEW-01 / BRK-14 — draft autosave + dirty guard ─────────────────────────
  const draft = useFormDraft({
    formKey: 'campaign',
    userId: profile?.id,
    values: formData,
  });

  const [confirmExit, setConfirmExit] = useState(false);
  // A restored draft can carry dates that were "today" and "next week" when it
  // was written and are simply in the past now. The values are re-applied
  // wholesale, so without this the form would show a start date days gone by
  // and say nothing about it.
  const [staleDates, setStaleDates] = useState(false);

  const applyDraft = () => {
    const values = draft.restore();
    if (!values) return;
    // Merged over the live defaults, so a draft written by an older build can
    // never blank a field that build did not have.
    setFormData((prev) => ({ ...prev, ...values }));
    const now = todayIso();
    setStaleDates(
      (typeof values.start_date === 'string' && values.start_date < now) ||
        (typeof values.end_date === 'string' && values.end_date < now)
    );
    setErrors({});
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const campaignTypeOptions = [
    { label: 'Vaccination', value: 'vaccination' },
    { label: 'Health Checkup', value: 'health_checkup' },
    { label: 'Awareness', value: 'awareness' },
    { label: 'Medicine Distribution', value: 'medicine_distribution' },
    { label: 'Medical Camp', value: 'medical_camp' },
    { label: 'Eye Camp', value: 'eye_camp' },
    { label: 'Dental Camp', value: 'dental_camp' },
    { label: 'Mental Health', value: 'mental_health' },
    { label: 'Maternal Health', value: 'maternal_health' },
    { label: 'Child Health', value: 'child_health' },
    { label: 'Water & Sanitation', value: 'water_sanitation' },
    { label: 'Nutrition', value: 'nutrition' },
    { label: 'Other', value: 'other' },
  ];

  const targetAudienceOptions = [
    { label: 'All Public', value: 'all' },
    { label: 'Children (0-5)', value: 'children_0_5' },
    { label: 'Children (6-14)', value: 'children_6_14' },
    { label: 'Adolescents', value: 'adolescents' },
    { label: 'Adults', value: 'adults' },
    { label: 'Elderly', value: 'elderly' },
    { label: 'Pregnant Women', value: 'pregnant_women' },
    { label: 'Lactating Mothers', value: 'lactating_mothers' },
    { label: 'Women', value: 'women' },
    { label: 'Men', value: 'men' },
    { label: 'Other', value: 'other' },
  ];

  // ── Layout tracking for scroll-to-first-error ─────────────────────────────
  const onSectionLayout = (section: string) => (e: LayoutChangeEvent) => {
    sectionYRef.current[section] = e.nativeEvent.layout.y;
  };
  const onFieldLayout = (section: string, field: string) => (e: LayoutChangeEvent) => {
    fieldYRef.current[field] = e.nativeEvent.layout.y;
    fieldSectionRef.current[field] = section;
  };
  const scrollToFirstError = (errs: Record<string, string>) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (!first) return;
    const section = fieldSectionRef.current[first];
    const y =
      (section ? sectionYRef.current[section] ?? 0 : 0) + (fieldYRef.current[first] ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: !reduceMotion });
  };

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateForm = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!formData.campaign_name.trim()) errs.campaign_name = 'Enter a campaign name';
    if (!formData.location_name.trim() || !formData.district.trim() || !formData.state) {
      errs.location = 'Enter location, district and state';
    }
    if (formData.end_date < formData.start_date) {
      errs.end_date = 'End date cannot be before start date';
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validateForm();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }

    setLoading(true);
    try {
      // Resolve the user from the locally cached session first — getSession()
      // reads local storage (no network), so the offline sync-queue path below
      // stays reachable. Fall back to the network getUser() only when online
      // and no cached session exists.
      const { data: { session } } = await supabase.auth.getSession();
      let user = session?.user ?? null;

      const net = await NetInfo.fetch();
      const isOnline = net.isConnected !== false && net.isInternetReachable !== false;

      if (!user && isOnline) {
        const { data: userData } = await supabase.auth.getUser();
        user = userData.user;
      }

      if (!user) {
        setModalType('error');
        setModalMessage('You must be logged in to create a campaign.');
        setModalVisible(true);
        setLoading(false);
        return;
      }

      const campaignType = formData.campaign_type === 'other'
        ? formData.custom_campaign_type || 'other'
        : formData.campaign_type;

      const targetAudience = formData.target_audience === 'other'
        ? formData.custom_target_audience || 'other'
        : formData.target_audience;

      const payload = {
        organizer_id: user.id,
        campaign_name: formData.campaign_name,
        campaign_type: campaignType,
        description: formData.description,
        target_audience: targetAudience,
        location_name: formData.location_name,
        district: formData.district,
        state: formData.state,
        start_date: formData.start_date,
        end_date: formData.end_date,
        target_beneficiaries: formData.target_beneficiaries ? parseInt(formData.target_beneficiaries) : null,
        contact_person: formData.contact_person || null,
        contact_phone: formData.contact_phone || null,
        notes: formData.notes || null,
        status: 'planned',
        // Stable across every attempt at THIS filling-in (it lives in the draft
        // snapshot), so a resend after a lost response collides with the row
        // that already committed instead of creating a second campaign.
        client_idempotency_key: formData.client_idempotency_key,
      };

      if (!isOnline) {
        await syncQueue.enqueue('campaign', payload);
        // Queued to sync — the draft has done its job.
        draft.clear();
        setModalType('success');
        setModalMessage('Saved on phone — will sync. Your campaign will upload automatically when you are back online.');
        setModalVisible(true);
        return;
      }

      // ignoreDuplicates turns a resend of an already-committed campaign into a
      // no-op rather than a unique-violation error she cannot act on.
      let { error } = await supabase
        .from('health_campaigns')
        .upsert(payload, { onConflict: 'client_idempotency_key', ignoreDuplicates: true });

      // Schema-drift armour, mirroring lib/services/diseaseReports.ts: if this
      // deployment's table lacks the column or the UNIQUE constraint, fall back
      // to the plain insert this form always did rather than fail the save.
      if (error && /client_idempotency_key|on conflict|no unique or exclusion constraint/i.test(String(error.message ?? ''))) {
        const { client_idempotency_key: _dropped, ...legacyPayload } = payload;
        ({ error } = await supabase.from('health_campaigns').insert(legacyPayload));
      }

      if (error) throw error;

      // Created — the draft has done its job.
      draft.clear();

      setModalType('success');
      setModalMessage('Your health campaign has been created successfully! Volunteers and health workers will be notified.');
      setModalVisible(true);
    } catch (error: any) {
      console.error('Submit error:', error);
      setModalType('error');
      setModalMessage(error.message || 'Failed to create campaign. Please try again.');
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleModalClose = () => {
    setModalVisible(false);
    if (modalType === 'success') {
      onSuccess();
    }
  };

  /** Cancel means "leave" — so it always faces the dirty guard. */
  const handleCancelPress = () => {
    if (draft.dirty) {
      setConfirmExit(true);
      return;
    }
    onCancel();
  };

  const discardAndLeave = () => {
    setConfirmExit(false);
    draft.clear();
    onCancel();
  };

  // BRK-14 — "back" in this app's own terms, shared by the header Back button
  // and MainApp's hardware-back listener.
  //
  // The two are the same code path for every NON-modal state. They are not
  // identical while a Modal is up: on Android a visible Modal's Dialog answers
  // the back press through its own onRequestClose before any BackHandler
  // listener runs, and the chevron is behind that Modal. The modalVisible and
  // confirmExit rungs below are therefore unreachable from the hardware key —
  // they stay as the correct answer for a non-Modal caller (react-native-web
  // renders Modal inline), not because a back press reaches them today. The
  // live rung is draft.offered: the restore sheet routes its onRequestClose
  // here on purpose.
  const requestClose = () => {
    if (modalVisible) {
      handleModalClose();
      return;
    }
    if (confirmExit) {
      setConfirmExit(false);
      return;
    }
    if (draft.offered) {
      // The draft stays on the phone — leaving is not deciding.
      onCancel();
      return;
    }
    if (draft.dirty) {
      setConfirmExit(true);
      return;
    }
    onCancel();
  };

  useImperativeHandle(exitRef, () => ({ requestClose }));

  const getInputStyle = (fieldName: string) => [
    styles.input,
    {
      backgroundColor: colors.inputBackground,
      color: colors.text,
      borderColor: errors[fieldName]
        ? colors.inputErrorBorder
        : focusedField === fieldName
          ? colors.inputFocusBorder
          : colors.inputBorder,
      borderWidth: errors[fieldName] || focusedField === fieldName ? 2 : 1.5,
    },
  ];

  const getDuration = () => {
    const start = new Date(formData.start_date);
    const end = new Date(formData.end_date);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return isNaN(diffDays) ? 0 : diffDays;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — headerBg surface, ink-on-surface, 1px hairline (both modes) */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={requestClose}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Create Health Campaign</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          Organize health initiatives for your community
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Campaign Details */}
        <View style={styles.section} onLayout={onSectionLayout('details')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Campaign Details</Text>

          <View onLayout={onFieldLayout('details', 'campaign_name')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Campaign Name *</Text>
            <TextInput
              style={getInputStyle('campaign_name')}
              placeholder="e.g., Polio Vaccination Drive"
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.campaign_name}
              onChangeText={(text) => { setFormData({ ...formData, campaign_name: text }); clearError('campaign_name'); }}
              onFocus={() => setFocusedField('campaign_name')}
              onBlur={() => setFocusedField(null)}
            />
            <FieldError message={errors.campaign_name} colors={colors} />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Campaign Type *</Text>
          <View style={styles.chipWrap}>
            {campaignTypeOptions.map((type) => (
              <SelectChip
                key={type.value}
                label={type.label}
                selected={formData.campaign_type === type.value}
                onPress={() => setFormData({ ...formData, campaign_type: type.value })}
                colors={colors}
              />
            ))}
          </View>

          {formData.campaign_type === 'other' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Campaign Type</Text>
              <TextInput
                style={getInputStyle('custom_campaign_type')}
                placeholder="Specify campaign type..."
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.custom_campaign_type}
                onChangeText={(text) => setFormData({ ...formData, custom_campaign_type: text })}
                onFocus={() => setFocusedField('custom_campaign_type')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.textSecondary }]}>Description</Text>
          <TextInput
            style={[...getInputStyle('description'), styles.textArea]}
            placeholder="Brief description of the campaign objectives..."
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            onFocus={() => setFocusedField('description')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Target Audience */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Target Audience</Text>

          <View style={styles.chipWrap}>
            {targetAudienceOptions.map((audience) => (
              <SelectChip
                key={audience.value}
                label={audience.label}
                selected={formData.target_audience === audience.value}
                onPress={() => setFormData({ ...formData, target_audience: audience.value })}
                colors={colors}
              />
            ))}
          </View>

          {formData.target_audience === 'other' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Target Audience</Text>
              <TextInput
                style={getInputStyle('custom_target_audience')}
                placeholder="Specify target audience..."
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.custom_target_audience}
                onChangeText={(text) => setFormData({ ...formData, custom_target_audience: text })}
                onFocus={() => setFocusedField('custom_target_audience')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.textSecondary }]}>Target Beneficiaries</Text>
          <TextInput
            style={getInputStyle('target_beneficiaries')}
            placeholder="Expected number of beneficiaries"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.target_beneficiaries}
            onChangeText={(text) => setFormData({ ...formData, target_beneficiaries: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('target_beneficiaries')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />
        </View>

        {/* Location */}
        <View style={styles.section} onLayout={onSectionLayout('location')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Location</Text>
          <View onLayout={onFieldLayout('location', 'location')}>
            <LocationField
              value={{
                latitude: null,
                longitude: null,
                locationName: formData.location_name,
                district: formData.district,
                state: formData.state,
                formattedAddress: '',
              }}
              onChange={(loc) => {
                // A location block that has only ever held machine-written
                // values is not the user's work: re-arm the pristine mark so
                // Back still closes silently.
                //
                // The extra "was the location EMPTY before?" test meant only
                // the FIRST fix counted as the machine typing, so tapping
                // "Re-fetch" on an already-located, otherwise untouched form
                // raised "Leave without saving?" over a campaign nobody had
                // written.
                //
                // Telling the machine from the user, exactly: LocationField
                // spreads the current `value` for every hand edit (typing a
                // place, typing a district, picking a registry suggestion), and
                // this form passes latitude: null and formattedAddress: '' in
                // that value — so a non-null latitude or a non-empty
                // formattedAddress can only have come from LocationField's own
                // GPS/geocode sync. Nothing typed satisfies either test.
                const machineFilled = loc.latitude != null || !!loc.formattedAddress;
                setFormData({
                  ...formData,
                  location_name: loc.locationName,
                  district: loc.district,
                  state: loc.state,
                });
                if (machineFilled && !draft.dirty) {
                  draft.markPristine();
                }
                if (loc.locationName && loc.district && loc.state) clearError('location');
              }}
              autoFetch={true}
            />
            <FieldError message={errors.location} colors={colors} />
          </View>
        </View>

        {/* Campaign Duration */}
        <View style={styles.section} onLayout={onSectionLayout('schedule')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Campaign Duration</Text>

          {/* A draft answered days later re-applies the dates it was written
              with. The values are right there in the two fields below, but
              nothing said they were stale — so this does, once, beside them. */}
          <StaleDraftDatesNotice visible={staleDates} />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Start Date</Text>
          <TextInput
            style={getInputStyle('start_date')}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.start_date}
            onChangeText={(text) => { setFormData({ ...formData, start_date: text }); clearError('end_date'); setStaleDates(false); }}
            onFocus={() => setFocusedField('start_date')}
            onBlur={() => setFocusedField(null)}
          />

          <View onLayout={onFieldLayout('schedule', 'end_date')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>End Date</Text>
            <TextInput
              style={getInputStyle('end_date')}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.end_date}
              onChangeText={(text) => { setFormData({ ...formData, end_date: text }); clearError('end_date'); setStaleDates(false); }}
              onFocus={() => setFocusedField('end_date')}
              onBlur={() => setFocusedField(null)}
            />
            <FieldError message={errors.end_date} colors={colors} />
          </View>

          <View style={styles.durationRow}>
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.durationText, { color: colors.text }]}>
              Duration: {getDuration()} day{getDuration() === 1 ? '' : 's'}
            </Text>
          </View>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Contact Information</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Contact Person</Text>
          <TextInput
            style={getInputStyle('contact_person')}
            placeholder="Name of person in charge"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contact_person}
            onChangeText={(text) => setFormData({ ...formData, contact_person: text })}
            onFocus={() => setFocusedField('contact_person')}
            onBlur={() => setFocusedField(null)}
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Contact Phone</Text>
          <TextInput
            style={getInputStyle('contact_phone')}
            placeholder="Phone number"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contact_phone}
            onChangeText={(text) => setFormData({ ...formData, contact_phone: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('contact_phone')}
            onBlur={() => setFocusedField(null)}
            keyboardType="phone-pad"
            maxLength={10}
          />
        </View>

        {/* Additional Notes */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Additional Notes</Text>
          <TextInput
            style={[...getInputStyle('notes'), styles.textArea]}
            placeholder="Any additional information, requirements, or instructions..."
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            onFocus={() => setFocusedField('notes')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={4}
          />
        </View>
      </ScrollView>

      {/* NEW-01 — persistence that is NOT working says so. A silent read
          failure looks exactly like "you have no unfinished campaign". */}
      <DraftStorageNotice issue={draft.storageIssue} onRetry={draft.retryStorage} />

      {/* One-Hand Action Bar */}
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleCancelPress}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cancelLink,
            { backgroundColor: pressed ? colors.surfaceVariant : colors.surface },
          ]}
        >
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          disabled={loading}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.submitBtn,
            {
              backgroundColor: pressed ? colors.primaryDark : colors.primary,
              opacity: loading ? 0.4 : 1,
            },
          ]}
        >
          <Text style={[styles.submitText, { color: colors.onPrimary }]}>
            {loading ? 'Creating…' : 'Create Campaign'}
          </Text>
        </Pressable>
      </View>

      {/* Submission Modal */}
      <SubmissionModal
        visible={modalVisible}
        type={modalType}
        title={modalType === 'success' ? 'Campaign Created!' : 'Creation Failed'}
        message={modalMessage}
        onClose={handleModalClose}
        onRetry={modalType === 'error' ? handleSubmit : undefined}
      />

      {/* NEW-01 — an unfinished campaign found on this phone, offered not applied */}
      <RestoreDraftSheet
        visible={!!draft.offered}
        savedAt={draft.offeredAt}
        onRestore={applyDraft}
        onStartFresh={draft.dismiss}
        onRequestClose={requestClose}
      />

      {/* BRK-14 — the guard between Back and a lost campaign */}
      <DiscardChangesSheet
        visible={confirmExit}
        onKeepEditing={() => setConfirmExit(false)}
        onDiscard={discardAndLeave}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Rendered inside MainApp's SafeAreaView — no status-bar inset re-added here.
  header: { paddingTop: 24, paddingBottom: 12, paddingHorizontal: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, alignSelf: 'flex-start', paddingRight: 12 },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginTop: 2 },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 16, paddingBottom: 24 },
  section: { marginTop: 24 },
  sectionLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: 12,
  },
  label: {
    fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 6, marginTop: 16,
  },
  input: { minHeight: 52, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8,
  },
  chipLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', flex: 1 },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, minHeight: 24 },
  durationText: { fontSize: 13, lineHeight: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1,
  },
  cancelLink: { minWidth: 88, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700' },
  submitBtn: { flex: 1, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '700' },
});

export default CampaignForm;
