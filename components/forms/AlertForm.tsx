// =====================================================
// HEALTH ALERT FORM — Send Urgent Health Alerts
// Prakash design: flat header, labels-above 52dp inputs,
// 44dp selection chips, inline errors + scroll-to-first-error,
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
import { useTheme, getSeverityColor, Theme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { Profile } from '../../types';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';

interface AlertFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  profile?: Profile;
}

// ── Local building blocks ────────────────────────────────────────────────────

const SelectChip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: Theme;
  fill?: string;
  selectedLabelColor?: string;
}> = ({ label, selected, onPress, colors, fill, selectedLabelColor }) => {
  const bg = fill ?? colors.primary;
  const labelColor = selectedLabelColor ?? colors.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? bg : pressed ? colors.cardHover : colors.card,
          borderColor: selected ? bg : colors.border,
        },
      ]}
    >
      {selected && <Ionicons name="checkmark" size={16} color={labelColor} />}
      <Text style={[styles.chipLabel, { color: selected ? labelColor : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
};

const FieldError: React.FC<{ message?: string; colors: Theme }> = ({ message, colors }) => {
  if (!message) return null;
  return (
    <View style={styles.errorRow} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={[styles.errorText, { color: colors.danger }]}>{message}</Text>
    </View>
  );
};

const FIELD_ORDER = ['title', 'description', 'location'];

export const AlertForm: React.FC<AlertFormProps> = ({ onSuccess, onCancel, profile }) => {
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

  const [formData, setFormData] = useState({
    // Alert Type
    alert_type: 'disease_outbreak',
    urgency_level: 'high',

    // Alert Details
    title: '',
    description: '',

    // Affected Area
    location_name: '',
    district: '',
    state: '',
    affected_population: '',

    // Health Details
    disease_or_issue: '',
    custom_disease: '',
    symptoms_to_watch: '',
    cases_reported: '',
    deaths_reported: '',

    // Precautions & Actions
    immediate_actions: '',
    precautionary_measures: '',

    // Contact Info
    contact_person: '',
    contact_phone: '',
    emergency_helpline: '',

    // Notification scope: 'officials' = district officials/clinics/ASHA workers, 'all' = all users
    notify_scope: 'officials' as 'officials' | 'all',
  });

  const alertTypes = [
    { label: 'Disease Outbreak', value: 'disease_outbreak' },
    { label: 'Water Contamination', value: 'water_contamination' },
    { label: 'Food Poisoning', value: 'food_poisoning' },
    { label: 'Vector Alert', value: 'vector_alert' },
    { label: 'Toxic Exposure', value: 'toxic_exposure' },
    { label: 'Medical Emergency', value: 'medical_emergency' },
    { label: 'General Health Alert', value: 'general' },
  ];

  const urgencyLevels = [
    { label: 'Critical', value: 'critical', desc: 'Immediate action needed' },
    { label: 'High', value: 'high', desc: 'Urgent attention required' },
    { label: 'Medium', value: 'medium', desc: 'Important, monitor closely' },
    { label: 'Low', value: 'low', desc: 'Advisory information' },
  ];

  const commonDiseases = [
    'Cholera', 'Typhoid', 'Malaria', 'Dengue', 'Chikungunya',
    'COVID-19', 'Influenza', 'Hepatitis', 'Diarrhea', 'Gastroenteritis', 'Other',
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

  const getTextAreaStyle = (fieldName: string) => [...getInputStyle(fieldName), styles.textArea];

  const validateForm = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!formData.title.trim()) errs.title = 'Enter an alert title';
    if (!formData.description.trim()) errs.description = 'Describe the health emergency';
    if (!formData.location_name.trim() || !formData.district.trim() || !formData.state) {
      errs.location = 'Enter location, district and state';
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
        setModalMessage('You must be logged in to send an alert.');
        setModalVisible(true);
        setLoading(false);
        return;
      }

      const diseaseValue = formData.disease_or_issue === 'Other' ? formData.custom_disease : formData.disease_or_issue;
      const isAshaWorker = profile?.role === 'asha_worker';

      const payload = {
        created_by: user.id,
        alert_type: formData.alert_type,
        urgency_level: formData.urgency_level,
        title: formData.title,
        description: formData.description,
        location_name: formData.location_name,
        district: formData.district,
        state: formData.state,
        affected_population: parseInt(formData.affected_population) || 0,
        disease_or_issue: diseaseValue,
        symptoms_to_watch: formData.symptoms_to_watch,
        cases_reported: parseInt(formData.cases_reported) || 0,
        immediate_actions: formData.immediate_actions,
        precautionary_measures: formData.precautionary_measures,
        contact_person: formData.contact_person,
        contact_phone: formData.contact_phone,
        status: 'active',
        // health_alerts has no deaths_reported / emergency_helpline columns in the
        // live schema — persist them in the metadata jsonb column instead of
        // silently dropping what the worker typed.
        metadata: {
          deaths_reported: parseInt(formData.deaths_reported) || 0,
          emergency_helpline: formData.emergency_helpline.trim() || null,
        },
      };

      if (!isOnline) {
        await syncQueue.enqueue('health_alert', payload);
        setModalType('success');
        if (isAshaWorker) {
          setModalMessage(
            'Saved on phone — will sync. Your alert request will upload automatically when you are back online, then go to Admin/Clinic review before other users see it in the app.'
          );
        } else {
          setModalMessage(
            'Saved on phone — will sync. Your alert will be published automatically when you are back online.'
          );
        }
        setModalVisible(true);
        return;
      }

      const { error } = await supabase.from('health_alerts').insert(payload);

      if (error) throw error;

      // Push delivery is handled server-side: the trg_push_on_alert_created
      // trigger fans out to the push-notifications edge function on insert.
      // No client-side fan-out — it would double-notify and cannot enumerate
      // tokens under profiles RLS for most roles.

      // Role-aware, honest success message
      setModalType('success');
      if (isAshaWorker) {
        // Honest per actual insert behavior: the row is inserted immediately and
        // the server-side push fan-out fires on insert; only in-app visibility
        // for other users waits on Admin/Clinic approval (DB auto_approve trigger).
        setModalMessage(
          'Your alert has been submitted and health officials will be notified. It will appear inside the app for other users after an Admin or Clinic staff member approves it.'
        );
      } else {
        setModalMessage(
          'Your health alert has been published successfully. Health officials will be notified.'
        );
      }
      setModalVisible(true);
    } catch (error: any) {
      console.error('Alert submit error:', error);
      setModalType('error');
      setModalMessage(error.message || 'Failed to send alert. Please try again or contact emergency services directly.');
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

  const selectedAlertType = alertTypes.find(a => a.value === formData.alert_type);
  const selectedUrgency = urgencyLevels.find(u => u.value === formData.urgency_level);
  const urgencyColorFor = (value: string) => getSeverityColor(value, colors);
  const headerText = isDark ? colors.text : colors.textInverse;
  const isAsha = profile?.role === 'asha_worker';

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
        <Text style={[styles.headerTitle, { color: headerText }]}>Send Health Alert</Text>
        <Text style={[styles.headerSubtitle, { color: headerText }]}>
          Notify authorities about health emergencies
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Alert Type */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Alert Type</Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            What type of health emergency?
          </Text>
          <View style={styles.chipWrap}>
            {alertTypes.map((type) => (
              <SelectChip
                key={type.value}
                label={type.label}
                selected={formData.alert_type === type.value}
                onPress={() => setFormData({ ...formData, alert_type: type.value })}
                colors={colors}
              />
            ))}
          </View>
        </View>

        {/* Urgency Level */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Urgency Level</Text>
          <View style={styles.chipWrap}>
            {urgencyLevels.map((level) => (
              <SelectChip
                key={level.value}
                label={level.label}
                selected={formData.urgency_level === level.value}
                onPress={() => setFormData({ ...formData, urgency_level: level.value })}
                colors={colors}
                fill={urgencyColorFor(level.value)}
                selectedLabelColor={colors.textInverse}
              />
            ))}
          </View>
          {selectedUrgency && (
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              {selectedUrgency.desc}
            </Text>
          )}
        </View>

        {/* Alert Details */}
        <View style={styles.section} onLayout={onSectionLayout('details')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Alert Details</Text>

          <View onLayout={onFieldLayout('details', 'title')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Alert Title *</Text>
            <TextInput
              style={getInputStyle('title')}
              placeholder="Brief title for the alert"
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.title}
              onChangeText={(text) => { setFormData({ ...formData, title: text }); clearError('title'); }}
              onFocus={() => setFocusedField('title')}
              onBlur={() => setFocusedField(null)}
            />
            <FieldError message={errors.title} colors={colors} />
          </View>

          <View onLayout={onFieldLayout('details', 'description')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Description *</Text>
            <TextInput
              style={getTextAreaStyle('description')}
              placeholder="Describe the health emergency in detail..."
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.description}
              onChangeText={(text) => { setFormData({ ...formData, description: text }); clearError('description'); }}
              onFocus={() => setFocusedField('description')}
              onBlur={() => setFocusedField(null)}
              multiline
              numberOfLines={4}
            />
            <FieldError message={errors.description} colors={colors} />
          </View>

          {/* Quick Disease Selection */}
          {(formData.alert_type === 'disease_outbreak' || formData.alert_type === 'food_poisoning') && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Disease / Issue</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipScrollContent}
              >
                {commonDiseases.map((disease) => (
                  <SelectChip
                    key={disease}
                    label={disease}
                    selected={formData.disease_or_issue === disease}
                    onPress={() => setFormData({ ...formData, disease_or_issue: disease })}
                    colors={colors}
                  />
                ))}
              </ScrollView>

              {formData.disease_or_issue === 'Other' && (
                <>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Disease / Issue</Text>
                  <TextInput
                    style={getInputStyle('custom_disease')}
                    placeholder="Disease or issue name"
                    placeholderTextColor={colors.inputPlaceholderColor}
                    value={formData.custom_disease}
                    onChangeText={(text) => setFormData({ ...formData, custom_disease: text })}
                    onFocus={() => setFocusedField('custom_disease')}
                    onBlur={() => setFocusedField(null)}
                  />
                </>
              )}

              <Text style={[styles.label, { color: colors.textSecondary }]}>Symptoms to Watch</Text>
              <TextInput
                style={getInputStyle('symptoms')}
                placeholder="e.g., fever, vomiting, diarrhea..."
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.symptoms_to_watch}
                onChangeText={(text) => setFormData({ ...formData, symptoms_to_watch: text })}
                onFocus={() => setFocusedField('symptoms')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}
        </View>

        {/* Location & Impact */}
        <View style={styles.section} onLayout={onSectionLayout('location')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Affected Area</Text>

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

          <Text style={[styles.label, { color: colors.textSecondary }]}>Population Affected</Text>
          <TextInput
            style={getInputStyle('population')}
            placeholder="Approx. number"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.affected_population}
            onChangeText={(text) => setFormData({ ...formData, affected_population: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('population')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Cases Reported</Text>
          <TextInput
            style={getInputStyle('cases')}
            placeholder="Number of cases"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.cases_reported}
            onChangeText={(text) => setFormData({ ...formData, cases_reported: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('cases')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Deaths (If Any)</Text>
          <TextInput
            style={getInputStyle('deaths')}
            placeholder="0"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.deaths_reported}
            onChangeText={(text) => setFormData({ ...formData, deaths_reported: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('deaths')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />
        </View>

        {/* Actions & Precautions */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Actions & Precautions</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Immediate Actions Recommended</Text>
          <TextInput
            style={getTextAreaStyle('actions')}
            placeholder="What immediate steps should be taken?"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.immediate_actions}
            onChangeText={(text) => setFormData({ ...formData, immediate_actions: text })}
            onFocus={() => setFocusedField('actions')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={3}
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Precautionary Measures for Public</Text>
          <TextInput
            style={getTextAreaStyle('precautions')}
            placeholder="What precautions should people take?"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.precautionary_measures}
            onChangeText={(text) => setFormData({ ...formData, precautionary_measures: text })}
            onFocus={() => setFocusedField('precautions')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Contact Information</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Contact Person</Text>
          <TextInput
            style={getInputStyle('contact_person')}
            placeholder="Your name"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contact_person}
            onChangeText={(text) => setFormData({ ...formData, contact_person: text })}
            onFocus={() => setFocusedField('contact_person')}
            onBlur={() => setFocusedField(null)}
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Phone Number</Text>
          <TextInput
            style={getInputStyle('contact_phone')}
            placeholder="Contact number"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contact_phone}
            onChangeText={(text) => setFormData({ ...formData, contact_phone: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('contact_phone')}
            onBlur={() => setFocusedField(null)}
            keyboardType="phone-pad"
            maxLength={10}
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Emergency Helpline</Text>
          <TextInput
            style={getInputStyle('emergency_helpline')}
            placeholder="e.g., 108"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.emergency_helpline}
            onChangeText={(text) => setFormData({ ...formData, emergency_helpline: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('emergency_helpline')}
            onBlur={() => setFocusedField(null)}
            keyboardType="phone-pad"
            maxLength={15}
          />
        </View>

        {/* Notification Options */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Notification Options</Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Who should receive push notifications for this alert?
          </Text>

          {/* Option 1 — officials */}
          <Pressable
            onPress={() => setFormData({ ...formData, notify_scope: 'officials' })}
            accessibilityRole="button"
            accessibilityState={{ selected: formData.notify_scope === 'officials' }}
            style={({ pressed }) => [
              styles.notifyCard,
              {
                backgroundColor: pressed ? colors.cardHover : colors.card,
                borderColor: formData.notify_scope === 'officials' ? colors.primary : colors.border,
                borderWidth: formData.notify_scope === 'officials' ? 2 : 1,
              },
            ]}
          >
            <View style={[styles.notifyIconWrap, { backgroundColor: colors.primary + '14' }]}>
              <Ionicons name="shield-checkmark-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.notifyBody}>
              <Text style={[styles.notifyTitle, { color: colors.text }]}>
                District Officials, Clinics & ASHA Workers
              </Text>
              <Text style={[styles.notifyDesc, { color: colors.textSecondary }]}>
                Targeted notification to health professionals in the district
              </Text>
            </View>
            <View
              style={[
                styles.radioOuter,
                { borderColor: formData.notify_scope === 'officials' ? colors.primary : colors.border },
              ]}
            >
              {formData.notify_scope === 'officials' && (
                <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />
              )}
            </View>
          </Pressable>

          {/* Option 2 — everyone */}
          <Pressable
            onPress={() => setFormData({ ...formData, notify_scope: 'all' })}
            accessibilityRole="button"
            accessibilityState={{ selected: formData.notify_scope === 'all' }}
            style={({ pressed }) => [
              styles.notifyCard,
              styles.notifyCardSpacing,
              {
                backgroundColor: pressed ? colors.cardHover : colors.card,
                borderColor: formData.notify_scope === 'all' ? colors.danger : colors.border,
                borderWidth: formData.notify_scope === 'all' ? 2 : 1,
              },
            ]}
          >
            <View style={[styles.notifyIconWrap, { backgroundColor: colors.danger + '14' }]}>
              <Ionicons name="megaphone-outline" size={24} color={colors.danger} />
            </View>
            <View style={styles.notifyBody}>
              <Text style={[styles.notifyTitle, { color: colors.text }]}>All App Users</Text>
              <Text style={[styles.notifyDesc, { color: colors.textSecondary }]}>
                Broadcast to everyone on the HealthDrop platform
              </Text>
            </View>
            <View
              style={[
                styles.radioOuter,
                { borderColor: formData.notify_scope === 'all' ? colors.danger : colors.border },
              ]}
            >
              {formData.notify_scope === 'all' && (
                <View style={[styles.radioInner, { backgroundColor: colors.danger }]} />
              )}
            </View>
          </Pressable>
        </View>

        {/* Summary Preview */}
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderLeftColor: urgencyColorFor(formData.urgency_level),
            },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Alert Preview</Text>
          <Text style={[styles.summaryText, { color: colors.text }]}>
            Type: {selectedAlertType?.label || '-'}{'\n'}
            Urgency: {selectedUrgency?.label || '-'}{'\n'}
            Title: {formData.title || '-'}{'\n'}
            Location: {formData.location_name}, {formData.district}, {formData.state}
            {formData.cases_reported ? `\nCases: ${formData.cases_reported}` : ''}
            {formData.deaths_reported ? `\nDeaths: ${formData.deaths_reported}` : ''}
          </Text>
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
            {loading ? 'Sending…' : 'Send Alert'}
          </Text>
        </Pressable>
      </View>

      {/* Submission Modal */}
      <SubmissionModal
        visible={modalVisible}
        type={modalType}
        title={modalType === 'success' ? (isAsha ? 'Alert Submitted' : 'Alert Sent') : 'Alert Failed'}
        message={modalMessage}
        onClose={handleModalClose}
        onRetry={modalType === 'error' ? handleSubmit : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Header — flat band, no radius, no gradient
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
  sectionDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: 12, marginTop: -4 },
  label: {
    fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 6, marginTop: 16,
  },
  input: { minHeight: 52, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  // Selection chips — 44dp, pill, solid fill + checkmark when selected
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipScrollContent: { gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8,
  },
  chipLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  hintText: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 8 },
  // Inline field errors
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', flex: 1 },
  // Notification radio cards
  notifyCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, gap: 12 },
  notifyCardSpacing: { marginTop: 12 },
  notifyIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  notifyBody: { flex: 1 },
  notifyTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 2 },
  notifyDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  radioOuter: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 12, height: 12, borderRadius: 999 },
  // Summary preview — card with 3px severity left edge
  summaryCard: { padding: 16, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, marginTop: 24 },
  summaryText: { fontSize: 15, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'] },
  // One-Hand Action Bar
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1,
  },
  cancelLink: { minWidth: 88, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700' },
  submitBtn: { flex: 1, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '700' },
});

export default AlertForm;
