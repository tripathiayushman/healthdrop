// =====================================================
// DISEASE REPORT FORM — Prakash restyle
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
import { useTheme, getSeverityColor, Theme } from '../../lib/ThemeContext';
import { diseaseReportsService } from '../../lib/services/diseaseReports';
import { SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { DiseaseType, Severity, TreatmentStatus } from '../../types';

interface DiseaseReportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
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

const FIELD_ORDER = ['disease_name', 'location'];

export const DiseaseReportForm: React.FC<DiseaseReportFormProps> = ({
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

  const [formData, setFormData] = useState({
    disease_name: '',
    custom_disease_name: '',
    disease_type: 'waterborne',
    custom_disease_type: '',
    severity: 'medium',
    cases_count: '1',
    deaths_count: '0',
    location_name: '',
    district: '',
    state: '',
    symptoms: '',
    age_group: '',
    gender: '',
    treatment_status: 'pending',
    notes: '',
    latitude: null as number | null,
    longitude: null as number | null,
  });

  const diseaseTypes = [
    { label: 'Waterborne', value: 'waterborne' },
    { label: 'Airborne', value: 'airborne' },
    { label: 'Vector-borne', value: 'vector' },
    { label: 'Foodborne', value: 'foodborne' },
    { label: 'Other', value: 'other' },
  ];

  const severityLevels = [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
    { label: 'Critical', value: 'critical' },
  ];

  const treatmentStatusOptions = [
    { label: 'Pending', value: 'pending' },
    { label: 'In Treatment', value: 'in_treatment' },
    { label: 'Recovered', value: 'recovered' },
  ];

  const ageGroups = [
    { label: '0-5 years', value: '0-5' },
    { label: '6-14 years', value: '6-14' },
    { label: '15-24 years', value: '15-24' },
    { label: '25-44 years', value: '25-44' },
    { label: '45-64 years', value: '45-64' },
    { label: '65+ years', value: '65+' },
    { label: 'Mixed', value: 'mixed' },
  ];

  const genderOptions = [
    { label: 'Male', value: 'male' },
    { label: 'Female', value: 'female' },
    { label: 'Mixed', value: 'mixed' },
  ];

  const commonDiseases = [
    'Cholera', 'Typhoid', 'Malaria', 'Dengue', 'Chikungunya',
    'Diarrhea', 'Dysentery', 'Hepatitis A', 'Hepatitis E',
    'Tuberculosis', 'COVID-19', 'Influenza', 'Jaundice', 'Other',
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
    const diseaseName = formData.disease_name === 'Other'
      ? formData.custom_disease_name
      : formData.disease_name;
    if (!diseaseName.trim()) errs.disease_name = 'Select or enter a disease name';
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
      const diseaseName = formData.disease_name === 'Other'
        ? formData.custom_disease_name
        : formData.disease_name;

      const diseaseType = formData.disease_type === 'other'
        ? 'other'
        : formData.disease_type;

      const normalizedTreatmentStatus: TreatmentStatus =
        (formData.treatment_status as TreatmentStatus) || 'pending';

      const customDiseaseTypeNote =
        formData.disease_type === 'other' && formData.custom_disease_type.trim().length > 0
          ? `Custom disease type: ${formData.custom_disease_type.trim()}`
          : '';

      const mergedNotes = [formData.notes, customDiseaseTypeNote]
        .filter(Boolean)
        .join('\n')
        .trim();

      const { error, queued } = await diseaseReportsService.create({
        disease_name: diseaseName,
        disease_type: diseaseType as DiseaseType,
        severity: formData.severity as Severity,
        symptoms: formData.symptoms,
        cases_count: parseInt(formData.cases_count) || 1,
        deaths_count: parseInt(formData.deaths_count) || 0,
        age_group: formData.age_group,
        gender: formData.gender,
        location_name: formData.location_name,
        latitude: formData.latitude ?? undefined,
        longitude: formData.longitude ?? undefined,
        district: formData.district,
        state: formData.state,
        treatment_status: normalizedTreatmentStatus,
        notes: mergedNotes || undefined,
      });

      if (error) throw new Error(String(error));

      if (queued) {
        setModalType('success');
        setModalMessage('Saved on phone — will sync. Your report will upload automatically when you are back online.');
      } else {
        setModalType('success');
        setModalMessage('Your disease report has been submitted successfully and will be reviewed by health authorities.');
      }
      setModalVisible(true);
    } catch (error: any) {
      console.error('Submit error:', error);
      const message = String(error?.message ?? error ?? '').trim();
      setModalType('error');
      setModalMessage(message || 'Failed to submit report. Please try again.');
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
        <Text style={[styles.headerTitle, { color: headerText }]}>Disease Report</Text>
        <Text style={[styles.headerSubtitle, { color: headerText }]}>
          Report disease outbreaks in your area
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Disease Information */}
        <View style={styles.section} onLayout={onSectionLayout('disease')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Disease Information</Text>

          <View onLayout={onFieldLayout('disease', 'disease_name')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Disease Name *</Text>
            <View style={styles.chipWrap}>
              {commonDiseases.map((disease) => (
                <SelectChip
                  key={disease}
                  label={disease}
                  selected={formData.disease_name === disease}
                  onPress={() => { setFormData({ ...formData, disease_name: disease }); clearError('disease_name'); }}
                  colors={colors}
                />
              ))}
            </View>

            {formData.disease_name === 'Other' && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Disease Name</Text>
                <TextInput
                  style={getInputStyle('custom_disease_name')}
                  placeholder="Enter disease name..."
                  placeholderTextColor={colors.inputPlaceholderColor}
                  value={formData.custom_disease_name}
                  onChangeText={(text) => { setFormData({ ...formData, custom_disease_name: text }); clearError('disease_name'); }}
                  onFocus={() => setFocusedField('custom_disease_name')}
                  onBlur={() => setFocusedField(null)}
                />
              </>
            )}
            <FieldError message={errors.disease_name} colors={colors} />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Disease Type *</Text>
          <View style={styles.chipWrap}>
            {diseaseTypes.map((type) => (
              <SelectChip
                key={type.value}
                label={type.label}
                selected={formData.disease_type === type.value}
                onPress={() => setFormData({ ...formData, disease_type: type.value })}
                colors={colors}
              />
            ))}
          </View>

          {formData.disease_type === 'other' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Disease Type</Text>
              <TextInput
                style={getInputStyle('custom_disease_type')}
                placeholder="Specify disease type..."
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.custom_disease_type}
                onChangeText={(text) => setFormData({ ...formData, custom_disease_type: text })}
                onFocus={() => setFocusedField('custom_disease_type')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.textSecondary }]}>Severity Level *</Text>
          <View style={styles.chipWrap}>
            {severityLevels.map((level) => (
              <SelectChip
                key={level.value}
                label={level.label}
                selected={formData.severity === level.value}
                onPress={() => setFormData({ ...formData, severity: level.value })}
                colors={colors}
                fill={getSeverityColor(level.value, colors)}
                selectedLabelColor={colors.textInverse}
              />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Symptoms</Text>
          <TextInput
            style={[...getInputStyle('symptoms'), styles.textArea]}
            placeholder="Describe symptoms observed..."
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.symptoms}
            onChangeText={(text) => setFormData({ ...formData, symptoms: text })}
            onFocus={() => setFocusedField('symptoms')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Case Details */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Case Details</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Cases Count *</Text>
          <TextInput
            style={getInputStyle('cases_count')}
            placeholder="1"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.cases_count}
            onChangeText={(text) => setFormData({ ...formData, cases_count: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('cases_count')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Deaths Count</Text>
          <TextInput
            style={getInputStyle('deaths_count')}
            placeholder="0"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.deaths_count}
            onChangeText={(text) => setFormData({ ...formData, deaths_count: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('deaths_count')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Age Group</Text>
          <View style={styles.chipWrap}>
            {ageGroups.map((age) => (
              <SelectChip
                key={age.value}
                label={age.label}
                selected={formData.age_group === age.value}
                onPress={() => setFormData({ ...formData, age_group: age.value })}
                colors={colors}
              />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Gender</Text>
          <View style={styles.chipWrap}>
            {genderOptions.map((gender) => (
              <SelectChip
                key={gender.value}
                label={gender.label}
                selected={formData.gender === gender.value}
                onPress={() => setFormData({ ...formData, gender: gender.value })}
                colors={colors}
              />
            ))}
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Treatment Status</Text>
          <View style={styles.chipWrap}>
            {treatmentStatusOptions.map((status) => (
              <SelectChip
                key={status.value}
                label={status.label}
                selected={formData.treatment_status === status.value}
                onPress={() => setFormData({ ...formData, treatment_status: status.value })}
                colors={colors}
              />
            ))}
          </View>
        </View>

        {/* Location */}
        <View style={styles.section} onLayout={onSectionLayout('location')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Location</Text>
          <View onLayout={onFieldLayout('location', 'location')}>
            <LocationField
              value={{
                latitude: formData.latitude,
                longitude: formData.longitude,
                locationName: formData.location_name,
                district: formData.district,
                state: formData.state,
                formattedAddress: '',
              }}
              onChange={(loc) => {
                setFormData({
                  ...formData,
                  latitude: loc.latitude,
                  longitude: loc.longitude,
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

        {/* Additional Notes */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Additional Notes</Text>
          <TextInput
            style={[...getInputStyle('notes'), styles.textArea]}
            placeholder="Any additional observations or notes..."
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
            {loading ? 'Submitting…' : 'Submit Report'}
          </Text>
        </Pressable>
      </View>

      {/* Submission Modal */}
      <SubmissionModal
        visible={modalVisible}
        type={modalType}
        title={modalType === 'success' ? 'Report Submitted!' : 'Submission Failed'}
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
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1,
  },
  cancelLink: { minWidth: 88, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700' },
  submitBtn: { flex: 1, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '700' },
});

export default DiseaseReportForm;
