// =====================================================
// CAMPAIGN FORM — Prakash restyle
// Flat header, labels-above 52dp inputs, 44dp selection
// chips, inline errors + scroll-to-first-error,
// One-Hand Action Bar. Zero hex literals.
// =====================================================
import React, { useRef, useState } from 'react';
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
import { SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';

interface CampaignFormProps {
  onSuccess: () => void;
  onCancel: () => void;
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
}) => {
  const { colors, isDark, reduceMotion } = useTheme();
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

  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [formData, setFormData] = useState({
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
  });

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
      const { data: { user } } = await supabase.auth.getUser();
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
      };

      const net = await NetInfo.fetch();
      const isOnline = net.isConnected && net.isInternetReachable;

      if (!isOnline) {
        await syncQueue.enqueue('campaign', payload);
        setModalType('success');
        setModalMessage('Saved on phone — will sync. Your campaign will upload automatically when you are back online.');
        setModalVisible(true);
        return;
      }

      const { error } = await supabase.from('health_campaigns').insert(payload);

      if (error) throw error;

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

  const headerText = isDark ? colors.text : colors.textInverse;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — flat band */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: isDark ? 1 : 0,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={onCancel}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={headerText} />
          <Text style={[styles.backText, { color: headerText }]}>Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: headerText }]}>Create Health Campaign</Text>
        <Text style={[styles.headerSubtitle, { color: headerText }]}>
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
                setFormData({
                  ...formData,
                  location_name: loc.locationName,
                  district: loc.district,
                  state: loc.state,
                });
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

          <Text style={[styles.label, { color: colors.textSecondary }]}>Start Date</Text>
          <TextInput
            style={getInputStyle('start_date')}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.start_date}
            onChangeText={(text) => { setFormData({ ...formData, start_date: text }); clearError('end_date'); }}
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
              onChangeText={(text) => { setFormData({ ...formData, end_date: text }); clearError('end_date'); }}
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

      {/* One-Hand Action Bar */}
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Pressable
          onPress={onCancel}
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16 },
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
