// =====================================================
// WATER QUALITY REPORT FORM - Modern UI with Vector Icons
// =====================================================
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Switch,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { StateDropdown, SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';

interface WaterQualityReportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const WaterQualityReportForm: React.FC<WaterQualityReportFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [labTested, setLabTested] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');

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
    { label: 'Well', value: 'well', icon: 'bucket' },
    { label: 'Borewell', value: 'borewell', icon: 'pipe' },
    { label: 'Tap Water', value: 'tap', icon: 'water-pump' },
    { label: 'River', value: 'river', icon: 'waves' },
    { label: 'Pond/Lake', value: 'pond', icon: 'water' },
    { label: 'Handpump', value: 'handpump', icon: 'hand-water' },
    { label: 'Tank', value: 'tank', icon: 'tanker-truck' },
    { label: 'Other', value: 'other', icon: 'clipboard-list' },
  ];

  const waterQualityOptions = [
    { label: 'Safe', value: 'safe', color: '#10B981', desc: 'Potable water', icon: 'checkmark-circle' },
    { label: 'Moderate', value: 'moderate', color: '#F59E0B', desc: 'Use with caution', icon: 'alert-circle' },
    { label: 'Unsafe', value: 'unsafe', color: '#EF4444', desc: 'Needs treatment', icon: 'warning' },
    { label: 'Critical', value: 'critical', color: '#DC2626', desc: 'Not safe', icon: 'close-circle' },
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

  const validateForm = (): boolean => {
    if (!formData.source_name.trim()) {
      Alert.alert('Required', 'Please enter water source name');
      return false;
    }
    if (!formData.location_name.trim()) {
      Alert.alert('Required', 'Please enter location name');
      return false;
    }
    if (!formData.district.trim()) {
      Alert.alert('Required', 'Please enter district');
      return false;
    }
    if (!formData.state) {
      Alert.alert('Required', 'Please select a state');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setModalType('error');
        setModalMessage('You must be logged in to submit a report.');
        setModalVisible(true);
        setLoading(false);
        return;
      }

      const sourceType = formData.source_type === 'other'
        ? formData.custom_source_type || 'other'
        : formData.source_type;

      const contaminationType = formData.contamination_type === 'other'
        ? formData.custom_contamination || 'other'
        : formData.contamination_type;

      const { error, queued } = await supabase.from('water_quality_reports').insert({
        reporter_id: user.id,
        source_name: formData.source_name,
        source_type: sourceType,
        location_name: formData.location_name,
        latitude: formData.latitude,
        longitude: formData.longitude,
        district: formData.district,
        state: formData.state,
        overall_quality: formData.quality,
        ph_level: formData.ph_level ? parseFloat(formData.ph_level) : null,
        tds_level: formData.tds_level ? parseInt(formData.tds_level) : null,
        contamination_type: contaminationType,
        notes: formData.notes,
        status: 'reported',
      }) as any;

      if (error) throw error;

      if (queued) {
        setModalType('success');
        setModalMessage('No internet connection — your report has been saved and will sync automatically when you go back online.');
      } else {
        setModalType('success');
        setModalMessage('Your water quality report has been submitted successfully and will help monitor water safety in your area.');
      }
      setModalVisible(true);
    } catch (error: any) {
      console.error('Submit error:', error);
      setModalType('error');
      setModalMessage(error.message || 'Failed to submit report. Please try again.');
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
      backgroundColor: colors.card,
      borderColor: focusedField === fieldName ? colors.primary : colors.border,
      color: colors.text,
    },
  ];

  const getQualityColor = () => {
    const quality = waterQualityOptions.find(q => q.value === formData.quality);
    return quality?.color || colors.textSecondary;
  };

  const getPHIndicator = () => {
    const ph = parseFloat(formData.ph_level);
    if (isNaN(ph)) return null;
    const isSafe = ph >= 6.5 && ph <= 8.5;
    return {
      color: isSafe ? '#10B981' : '#F59E0B',
      text: isSafe ? 'Within safe range (6.5-8.5)' : 'Outside safe range',
    };
  };

  const getTDSIndicator = () => {
    const tds = parseInt(formData.tds_level);
    if (isNaN(tds)) return null;
    if (tds <= 500) return { color: '#10B981', text: 'Excellent (< 500 ppm)' };
    if (tds <= 1000) return { color: '#F59E0B', text: 'Acceptable (500-1000 ppm)' };
    return { color: '#EF4444', text: 'High - needs treatment (> 1000 ppm)' };
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: '#3B82F6' }]}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Ionicons name="water" size={28} color="#FFF" />
          <Text style={styles.headerTitle}>Water Quality Report</Text>
        </View>
        <Text style={styles.headerSubtitle}>Report water source quality assessment</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Water Source Details */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="water-well" size={20} color="#3B82F6" />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Water Source Details</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Source Name *</Text>
          <TextInput
            style={getInputStyle('source_name')}
            placeholder="e.g., Village Well #3, Main Handpump"
            placeholderTextColor={colors.textSecondary}
            value={formData.source_name}
            onChangeText={(text) => setFormData({ ...formData, source_name: text })}
            onFocus={() => setFocusedField('source_name')}
            onBlur={() => setFocusedField(null)}
          />

          {/* Source Type */}
          <Text style={[styles.label, { color: colors.text }]}>Source Type *</Text>
          <View style={styles.chipGrid}>
            {waterSourceOptions.map((source) => (
              <TouchableOpacity
                key={source.value}
                style={[
                  styles.sourceChip,
                  {
                    backgroundColor: formData.source_type === source.value ? '#3B82F6' : colors.card,
                    borderColor: formData.source_type === source.value ? '#3B82F6' : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, source_type: source.value })}
              >
                <MaterialCommunityIcons 
                  name={source.icon as any} 
                  size={16} 
                  color={formData.source_type === source.value ? '#FFF' : colors.textSecondary} 
                />
                <Text style={[
                  styles.chipText,
                  { color: formData.source_type === source.value ? '#FFF' : colors.text }
                ]}>
                  {source.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Source Type Input */}
          {formData.source_type === 'other' && (
            <View style={styles.customInputContainer}>
              <TextInput
                style={getInputStyle('custom_source_type')}
                placeholder="Specify source type..."
                placeholderTextColor={colors.textSecondary}
                value={formData.custom_source_type}
                onChangeText={(text) => setFormData({ ...formData, custom_source_type: text })}
                onFocus={() => setFocusedField('custom_source_type')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}
        </View>

        {/* Location — unified: GPS + reverse geocode + district/state */}
        <View style={styles.section}>
          <LocationField
            value={{
              latitude: formData.latitude,
              longitude: formData.longitude,
              locationName: formData.location_name,
              district: formData.district,
              state: formData.state,
              formattedAddress: '',
            }}
            onChange={(loc) =>
              setFormData({
                ...formData,
                latitude: loc.latitude,
                longitude: loc.longitude,
                location_name: loc.locationName,
                district: loc.district,
                state: loc.state,
              })
            }
            autoFetch={true}
          />

          <Text style={[styles.label, { color: colors.text }]}>Households Affected</Text>
          <TextInput
            style={getInputStyle('households_affected')}
            placeholder="Number of households"
            placeholderTextColor={colors.textSecondary}
            value={formData.households_affected}
            onChangeText={(text) => setFormData({ ...formData, households_affected: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('households_affected')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />
        </View>

        {/* Quality Assessment */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="analytics" size={20} color="#3B82F6" />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Quality Assessment</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Overall Water Quality *</Text>
          <View style={styles.qualityGrid}>
            {waterQualityOptions.map((quality) => (
              <TouchableOpacity
                key={quality.value}
                style={[
                  styles.qualityCard,
                  {
                    backgroundColor: formData.quality === quality.value ? quality.color + '15' : colors.card,
                    borderColor: formData.quality === quality.value ? quality.color : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, quality: quality.value })}
              >
                <Ionicons 
                  name={quality.icon as any} 
                  size={22} 
                  color={formData.quality === quality.value ? quality.color : colors.textSecondary} 
                />
                <Text style={[styles.qualityLabel, { color: formData.quality === quality.value ? quality.color : colors.text }]}>
                  {quality.label}
                </Text>
                <Text style={[styles.qualityDesc, { color: colors.textSecondary }]}>{quality.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quality Indicator */}
          <View style={[styles.indicatorCard, { backgroundColor: getQualityColor() + '15', borderColor: getQualityColor() }]}>
            <Ionicons 
              name={formData.quality === 'safe' ? 'checkmark-circle' : 'information-circle'} 
              size={20} 
              color={getQualityColor()} 
            />
            <Text style={[styles.indicatorText, { color: getQualityColor() }]}>
              {formData.quality === 'safe' && 'Water is safe for drinking'}
              {formData.quality === 'moderate' && 'Water needs basic treatment before use'}
              {formData.quality === 'poor' && 'Water requires proper treatment'}
              {formData.quality === 'contaminated' && 'Water is not safe - do not consume'}
            </Text>
          </View>
        </View>

        {/* Lab Testing Section */}
        <View style={styles.section}>
          <View style={[styles.switchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.switchContent}>
              <MaterialCommunityIcons name="flask" size={22} color="#3B82F6" />
              <View>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Lab Tested?</Text>
                <Text style={[styles.switchDesc, { color: colors.textSecondary }]}>Enable if water was tested in a lab</Text>
              </View>
            </View>
            <Switch
              value={labTested}
              onValueChange={setLabTested}
              trackColor={{ false: colors.border, true: '#3B82F6' }}
            />
          </View>

          {labTested && (
            <View style={styles.labSection}>
              <View style={styles.row}>
                <View style={styles.halfField}>
                  <Text style={[styles.label, { color: colors.text }]}>pH Level</Text>
                  <TextInput
                    style={getInputStyle('ph_level')}
                    placeholder="e.g., 7.2"
                    placeholderTextColor={colors.textSecondary}
                    value={formData.ph_level}
                    onChangeText={(text) => setFormData({ ...formData, ph_level: text })}
                    onFocus={() => setFocusedField('ph_level')}
                    onBlur={() => setFocusedField(null)}
                    keyboardType="numeric"
                  />
                  {getPHIndicator() && (
                    <View style={[styles.miniIndicator, { backgroundColor: getPHIndicator()!.color + '15', borderColor: getPHIndicator()!.color }]}>
                      <Text style={[styles.miniIndicatorText, { color: getPHIndicator()!.color }]}>
                        {getPHIndicator()!.text}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.halfField}>
                  <Text style={[styles.label, { color: colors.text }]}>TDS Level (ppm)</Text>
                  <TextInput
                    style={getInputStyle('tds_level')}
                    placeholder="e.g., 350"
                    placeholderTextColor={colors.textSecondary}
                    value={formData.tds_level}
                    onChangeText={(text) => setFormData({ ...formData, tds_level: text.replace(/[^0-9]/g, '') })}
                    onFocus={() => setFocusedField('tds_level')}
                    onBlur={() => setFocusedField(null)}
                    keyboardType="numeric"
                  />
                  {getTDSIndicator() && (
                    <View style={[styles.miniIndicator, { backgroundColor: getTDSIndicator()!.color + '15', borderColor: getTDSIndicator()!.color }]}>
                      <Text style={[styles.miniIndicatorText, { color: getTDSIndicator()!.color }]}>
                        {getTDSIndicator()!.text}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Contamination Details */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="biohazard" size={20} color="#3B82F6" />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Contamination Details</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Contamination Type</Text>
          <View style={styles.chipGrid}>
            {contaminantOptions.map((contaminant) => (
              <TouchableOpacity
                key={contaminant.value}
                style={[
                  styles.chip,
                  {
                    backgroundColor: formData.contamination_type === contaminant.value ? '#3B82F6' : colors.card,
                    borderColor: formData.contamination_type === contaminant.value ? '#3B82F6' : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, contamination_type: contaminant.value })}
              >
                <Text style={[
                  styles.chipText,
                  { color: formData.contamination_type === contaminant.value ? '#FFF' : colors.text }
                ]}>
                  {contaminant.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Contamination Input */}
          {formData.contamination_type === 'other' && (
            <View style={styles.customInputContainer}>
              <TextInput
                style={getInputStyle('custom_contamination')}
                placeholder="Specify contamination type..."
                placeholderTextColor={colors.textSecondary}
                value={formData.custom_contamination}
                onChangeText={(text) => setFormData({ ...formData, custom_contamination: text })}
                onFocus={() => setFocusedField('custom_contamination')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}

          <Text style={[styles.label, { color: colors.text }]}>Contamination Level / Details</Text>
          <TextInput
            style={getInputStyle('contamination_level')}
            placeholder="Describe contamination level or test results"
            placeholderTextColor={colors.textSecondary}
            value={formData.contamination_level}
            onChangeText={(text) => setFormData({ ...formData, contamination_level: text })}
            onFocus={() => setFocusedField('contamination_level')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        {/* Additional Notes */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text" size={20} color="#3B82F6" />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Additional Information</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Notes & Observations</Text>
          <TextInput
            style={[getInputStyle('notes'), styles.textArea]}
            placeholder="Color, smell, taste observations, community feedback..."
            placeholderTextColor={colors.textSecondary}
            value={formData.notes}
            onChangeText={(text) => setFormData({ ...formData, notes: text })}
            onFocus={() => setFocusedField('notes')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer Buttons */}
      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.footerBtn, styles.cancelBtn, { borderColor: colors.border }]}
          onPress={onCancel}
        >
          <Ionicons name="close" size={20} color={colors.text} />
          <Text style={[styles.footerBtnText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.footerBtn, styles.submitBtn, { backgroundColor: '#3B82F6' }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Ionicons name="checkmark" size={20} color="#FFF" />
          <Text style={[styles.footerBtnText, { color: '#FFF' }]}>
            {loading ? 'Submitting...' : 'Submit Report'}
          </Text>
        </TouchableOpacity>
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
  header: { paddingTop: 50, paddingBottom: 20, paddingHorizontal: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  backText: { color: '#FFF', fontSize: 16 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#FFF', fontSize: 24, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 4 },
  content: { flex: 1, paddingHorizontal: 20 },
  section: { marginTop: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 15 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  customInputContainer: { marginTop: 12 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  sourceChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 13, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  qualityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  qualityCard: { width: '47%', padding: 14, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  qualityLabel: { fontSize: 14, fontWeight: '600', marginTop: 6 },
  qualityDesc: { fontSize: 11, marginTop: 2 },
  indicatorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  indicatorText: { fontSize: 14, fontWeight: '500', flex: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1.5 },
  switchContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  switchDesc: { fontSize: 12, marginTop: 2 },
  labSection: { marginTop: 16 },
  miniIndicator: { padding: 8, borderRadius: 8, borderWidth: 1, marginTop: 8 },
  miniIndicatorText: { fontSize: 11, fontWeight: '500' },
  footer: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  cancelBtn: { borderWidth: 1.5 },
  submitBtn: {},
  footerBtnText: { fontSize: 16, fontWeight: '600' },
});

export default WaterQualityReportForm;
