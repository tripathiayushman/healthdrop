// =====================================================
// WATER QUALITY REPORT FORM — Prakash restyle
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
  Switch,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, getWaterQualityColor, Theme } from '../../lib/ThemeContext';
import { waterQualityService } from '../../lib/services/waterQuality';
import { SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { SourceType, WaterQuality } from '../../types';

interface WaterQualityReportFormProps {
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

const FIELD_ORDER = ['source_name', 'location'];

// Exactly the four selectable qualities — no dead branches.
const QUALITY_MESSAGES: Record<string, string> = {
  safe: 'Water is safe for drinking',
  moderate: 'Water needs basic treatment before use',
  unsafe: 'Water is unsafe — treat before any use',
  critical: 'Water is not safe — do not consume',
};

const QUALITY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  safe: 'checkmark-circle',
  moderate: 'alert-circle',
  unsafe: 'warning',
  critical: 'close-circle',
};

export const WaterQualityReportForm: React.FC<WaterQualityReportFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [labTested, setLabTested] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const sectionYRef = useRef<Record<string, number>>({});
  const fieldYRef = useRef<Record<string, number>>({});
  const fieldSectionRef = useRef<Record<string, string>>({});

  const [formData, setFormData] = useState({
    source_name: '',
    source_type: 'well',
    custom_source_type: '',
    location_name: '',
    district: '',
    state: '',
    quality: 'moderate',
    ph_level: '',
    tds_level: '',
    contamination_type: '',
    custom_contamination: '',
    contamination_level: '',
    households_affected: '1',
    notes: '',
    latitude: null as number | null,
    longitude: null as number | null,
  });

  const waterSourceOptions = [
    { label: 'Well', value: 'well' },
    { label: 'Borewell', value: 'borewell' },
    { label: 'Tap Water', value: 'tap' },
    { label: 'River', value: 'river' },
    { label: 'Pond/Lake', value: 'pond' },
    { label: 'Handpump', value: 'handpump' },
    { label: 'Tank', value: 'tank' },
    { label: 'Other', value: 'other' },
  ];

  // Options are exactly safe / moderate / unsafe / critical
  const waterQualityOptions = [
    { label: 'Safe', value: 'safe' },
    { label: 'Moderate', value: 'moderate' },
    { label: 'Unsafe', value: 'unsafe' },
    { label: 'Critical', value: 'critical' },
  ];

  const contaminantOptions = [
    { label: 'None', value: 'none' },
    { label: 'Iron', value: 'iron' },
    { label: 'Arsenic', value: 'arsenic' },
    { label: 'Fluoride', value: 'fluoride' },
    { label: 'Nitrates', value: 'nitrates' },
    { label: 'E. coli', value: 'bacteria' },
    { label: 'Lead', value: 'lead' },
    { label: 'Chlorine', value: 'chlorine' },
    { label: 'Turbidity', value: 'turbidity' },
    { label: 'High TDS', value: 'tds' },
    { label: 'Multiple', value: 'multiple' },
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
    if (!formData.source_name.trim()) errs.source_name = 'Enter the water source name';
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
      const sourceType = formData.source_type === 'other'
        ? 'other'
        : formData.source_type;

      const contaminationType = formData.contamination_type === 'other'
        ? formData.custom_contamination || 'other'
        : formData.contamination_type;

      const customSourceTypeNote =
        formData.source_type === 'other' && formData.custom_source_type.trim().length > 0
          ? `Custom source type: ${formData.custom_source_type.trim()}`
          : '';

      // households_affected and contamination_level have no columns in the live
      // water_quality_reports table — persist them inside notes (same pattern as
      // custom source type) instead of silently dropping them.
      const householdsNote = formData.households_affected.trim()
        ? `Households affected: ${formData.households_affected.trim()}`
        : '';
      const contaminationLevelNote = formData.contamination_level.trim()
        ? `Contamination level: ${formData.contamination_level.trim()}`
        : '';

      const mergedNotes = [formData.notes, customSourceTypeNote, householdsNote, contaminationLevelNote]
        .filter(Boolean)
        .join('\n')
        .trim();

      const { error, queued } = await waterQualityService.create({
        source_name: formData.source_name,
        source_type: sourceType as SourceType,
        location_name: formData.location_name,
        latitude: formData.latitude ?? undefined,
        longitude: formData.longitude ?? undefined,
        district: formData.district,
        state: formData.state,
        overall_quality: formData.quality as WaterQuality,
        ph_level: formData.ph_level ? parseFloat(formData.ph_level) : undefined,
        tds_level: formData.tds_level ? parseInt(formData.tds_level) : undefined,
        contamination_type: contaminationType,
        notes: mergedNotes || undefined,
      });

      if (error) throw new Error(String(error));

      if (queued) {
        setModalType('success');
        setModalMessage('Saved on phone — will sync. Your report will upload automatically when you are back online.');
      } else {
        setModalType('success');
        setModalMessage('Your water quality report has been submitted successfully and will help monitor water safety in your area.');
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

  const qualityColor = getWaterQualityColor(formData.quality, colors);

  const getPHIndicator = () => {
    const ph = parseFloat(formData.ph_level);
    if (isNaN(ph)) return null;
    const isSafe = ph >= 6.5 && ph <= 8.5;
    return {
      color: isSafe ? colors.success : colors.warning,
      bg: isSafe ? colors.successBg : colors.warningBg,
      icon: (isSafe ? 'checkmark-circle' : 'alert-circle') as keyof typeof Ionicons.glyphMap,
      text: isSafe ? 'Within safe range (6.5-8.5)' : 'Outside safe range',
    };
  };

  const getTDSIndicator = () => {
    const tds = parseInt(formData.tds_level);
    if (isNaN(tds)) return null;
    if (tds <= 500) {
      return { color: colors.success, bg: colors.successBg, icon: 'checkmark-circle' as const, text: 'Excellent (< 500 ppm)' };
    }
    if (tds <= 1000) {
      return { color: colors.warning, bg: colors.warningBg, icon: 'alert-circle' as const, text: 'Acceptable (500-1000 ppm)' };
    }
    return { color: colors.danger, bg: colors.dangerBg, icon: 'warning' as const, text: 'High - needs treatment (> 1000 ppm)' };
  };

  const phIndicator = getPHIndicator();
  const tdsIndicator = getTDSIndicator();
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
        <Text style={[styles.headerTitle, { color: headerText }]}>Water Quality Report</Text>
        <Text style={[styles.headerSubtitle, { color: headerText }]}>
          Report water source quality assessment
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Water Source Details */}
        <View style={styles.section} onLayout={onSectionLayout('source')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Water Source Details</Text>

          <View onLayout={onFieldLayout('source', 'source_name')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Source Name *</Text>
            <TextInput
              style={getInputStyle('source_name')}
              placeholder="e.g., Village Well #3, Main Handpump"
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.source_name}
              onChangeText={(text) => { setFormData({ ...formData, source_name: text }); clearError('source_name'); }}
              onFocus={() => setFocusedField('source_name')}
              onBlur={() => setFocusedField(null)}
            />
            <FieldError message={errors.source_name} colors={colors} />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Source Type *</Text>
          <View style={styles.chipWrap}>
            {waterSourceOptions.map((source) => (
              <SelectChip
                key={source.value}
                label={source.label}
                selected={formData.source_type === source.value}
                onPress={() => setFormData({ ...formData, source_type: source.value })}
                colors={colors}
              />
            ))}
          </View>

          {formData.source_type === 'other' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Source Type</Text>
              <TextInput
                style={getInputStyle('custom_source_type')}
                placeholder="Specify source type..."
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.custom_source_type}
                onChangeText={(text) => setFormData({ ...formData, custom_source_type: text })}
                onFocus={() => setFocusedField('custom_source_type')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}
        </View>

        {/* Location & Impact */}
        <View style={styles.section} onLayout={onSectionLayout('location')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Location & Impact</Text>

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

          <Text style={[styles.label, { color: colors.textSecondary }]}>Households Affected</Text>
          <TextInput
            style={getInputStyle('households_affected')}
            placeholder="Number of households"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.households_affected}
            onChangeText={(text) => setFormData({ ...formData, households_affected: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('households_affected')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />
        </View>

        {/* Quality Assessment */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Quality Assessment</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Overall Water Quality *</Text>
          <View style={styles.chipWrap}>
            {waterQualityOptions.map((quality) => (
              <SelectChip
                key={quality.value}
                label={quality.label}
                selected={formData.quality === quality.value}
                onPress={() => setFormData({ ...formData, quality: quality.value })}
                colors={colors}
                fill={getWaterQualityColor(quality.value, colors)}
                selectedLabelColor={colors.textInverse}
              />
            ))}
          </View>

          {/* Quality indicator — handles exactly safe/moderate/unsafe/critical */}
          <View
            style={[
              styles.indicatorCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderLeftColor: qualityColor,
              },
            ]}
          >
            <Ionicons
              name={QUALITY_ICONS[formData.quality] ?? 'information-circle'}
              size={20}
              color={qualityColor}
            />
            <Text style={[styles.indicatorText, { color: colors.text }]}>
              {QUALITY_MESSAGES[formData.quality] ?? 'Select the overall water quality'}
            </Text>
          </View>
        </View>

        {/* Lab Testing */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Lab Testing</Text>
          <View style={[styles.switchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.switchContent}>
              <Ionicons name="flask-outline" size={24} color={colors.textSecondary} />
              <View style={styles.switchTextWrap}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Lab Tested?</Text>
                <Text style={[styles.switchDesc, { color: colors.textSecondary }]}>
                  Enable if water was tested in a lab
                </Text>
              </View>
            </View>
            <Switch
              value={labTested}
              onValueChange={setLabTested}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>

          {labTested && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>pH Level</Text>
              <TextInput
                style={getInputStyle('ph_level')}
                placeholder="e.g., 7.2"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.ph_level}
                onChangeText={(text) => setFormData({ ...formData, ph_level: text })}
                onFocus={() => setFocusedField('ph_level')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
              {phIndicator && (
                <View style={[styles.miniIndicator, { backgroundColor: phIndicator.bg }]}>
                  <Ionicons name={phIndicator.icon} size={16} color={phIndicator.color} />
                  <Text style={[styles.miniIndicatorText, { color: phIndicator.color }]}>
                    {phIndicator.text}
                  </Text>
                </View>
              )}

              <Text style={[styles.label, { color: colors.textSecondary }]}>TDS Level (ppm)</Text>
              <TextInput
                style={getInputStyle('tds_level')}
                placeholder="e.g., 350"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.tds_level}
                onChangeText={(text) => setFormData({ ...formData, tds_level: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('tds_level')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
              {tdsIndicator && (
                <View style={[styles.miniIndicator, { backgroundColor: tdsIndicator.bg }]}>
                  <Ionicons name={tdsIndicator.icon} size={16} color={tdsIndicator.color} />
                  <Text style={[styles.miniIndicatorText, { color: tdsIndicator.color }]}>
                    {tdsIndicator.text}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Contamination Details */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Contamination Details</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Contamination Type</Text>
          <View style={styles.chipWrap}>
            {contaminantOptions.map((contaminant) => (
              <SelectChip
                key={contaminant.value}
                label={contaminant.label}
                selected={formData.contamination_type === contaminant.value}
                onPress={() => setFormData({ ...formData, contamination_type: contaminant.value })}
                colors={colors}
              />
            ))}
          </View>

          {formData.contamination_type === 'other' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Contamination Type</Text>
              <TextInput
                style={getInputStyle('custom_contamination')}
                placeholder="Specify contamination type..."
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.custom_contamination}
                onChangeText={(text) => setFormData({ ...formData, custom_contamination: text })}
                onFocus={() => setFocusedField('custom_contamination')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.textSecondary }]}>Contamination Level / Details</Text>
          <TextInput
            style={getInputStyle('contamination_level')}
            placeholder="Describe contamination level or test results"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contamination_level}
            onChangeText={(text) => setFormData({ ...formData, contamination_level: text })}
            onFocus={() => setFocusedField('contamination_level')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        {/* Additional Notes */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Additional Information</Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Notes & Observations</Text>
          <TextInput
            style={[...getInputStyle('notes'), styles.textArea]}
            placeholder="Color, smell, taste observations, community feedback..."
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
  // Quality indicator — card with 3px left edge in the quality token
  indicatorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, marginTop: 16,
  },
  indicatorText: { fontSize: 15, lineHeight: 22, fontWeight: '700', flex: 1 },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderRadius: 12, borderWidth: 1, minHeight: 64,
  },
  switchContent: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  switchTextWrap: { flex: 1 },
  switchLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  switchDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  miniIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginTop: 8,
  },
  miniIndicatorText: { fontSize: 12, lineHeight: 16, fontWeight: '600', flex: 1 },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1,
  },
  cancelLink: { minWidth: 88, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700' },
  submitBtn: { flex: 1, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '700' },
});

export default WaterQualityReportForm;
