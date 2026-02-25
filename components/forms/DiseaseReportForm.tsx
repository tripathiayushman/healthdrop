// =====================================================
// DISEASE REPORT FORM - Modern UI with Vector Icons
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
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { StateDropdown, SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';

interface DiseaseReportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const DiseaseReportForm: React.FC<DiseaseReportFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');

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
    { label: 'Waterborne', value: 'waterborne', icon: 'water' },
    { label: 'Airborne', value: 'airborne', icon: 'weather-windy' },
    { label: 'Vector-borne', value: 'vector', icon: 'bug' },
    { label: 'Foodborne', value: 'foodborne', icon: 'food' },
    { label: 'Other', value: 'other', icon: 'clipboard-list' },
  ];

  const severityLevels = [
    { label: 'Low', value: 'low', color: '#10B981' },
    { label: 'Medium', value: 'medium', color: '#F59E0B' },
    { label: 'High', value: 'high', color: '#EF4444' },
    { label: 'Critical', value: 'critical', color: '#DC2626' },
  ];

  const treatmentStatusOptions = [
    { label: 'Pending', value: 'pending', icon: 'time-outline' },
    { label: 'In Treatment', value: 'in_treatment', icon: 'medical-outline' },
    { label: 'Treatment Complete', value: 'treatment_complete', icon: 'checkmark-circle-outline' },
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
    { label: 'Male', value: 'male', icon: 'male' },
    { label: 'Female', value: 'female', icon: 'female' },
    { label: 'Mixed', value: 'mixed', icon: 'people' },
  ];

  const commonDiseases = [
    'Cholera', 'Typhoid', 'Malaria', 'Dengue', 'Chikungunya',
    'Diarrhea', 'Dysentery', 'Hepatitis A', 'Hepatitis E',
    'Tuberculosis', 'COVID-19', 'Influenza', 'Jaundice', 'Other',
  ];

  const validateForm = (): boolean => {
    const diseaseName = formData.disease_name === 'Other' 
      ? formData.custom_disease_name 
      : formData.disease_name;
    
    if (!diseaseName.trim()) {
      Alert.alert('Required', 'Please select or enter a disease name');
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

      const diseaseName = formData.disease_name === 'Other' 
        ? formData.custom_disease_name 
        : formData.disease_name;

      const diseaseType = formData.disease_type === 'other'
        ? formData.custom_disease_type || 'other'
        : formData.disease_type;

      const { error, queued } = await supabase.from('disease_reports').insert({
        reporter_id: user.id,
        disease_name: diseaseName,
        disease_type: diseaseType,
        severity: formData.severity,
        symptoms: formData.symptoms,
        cases_count: parseInt(formData.cases_count) || 1,
        deaths_count: parseInt(formData.deaths_count) || 0,
        age_group: formData.age_group,
        gender: formData.gender,
        location_name: formData.location_name,
        latitude: formData.latitude,
        longitude: formData.longitude,
        district: formData.district,
        state: formData.state,
        treatment_status: formData.treatment_status,
        notes: formData.notes,
        status: 'reported',
      }) as any;

      if (error) throw error;

      if (queued) {
        setModalType('success');
        setModalMessage('No internet connection — your report has been saved and will sync automatically when you go back online.');
      } else {
        setModalType('success');
        setModalMessage('Your disease report has been submitted successfully and will be reviewed by health authorities.');
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <MaterialCommunityIcons name="virus" size={28} color="#FFF" />
          <Text style={styles.headerTitle}>Disease Report</Text>
        </View>
        <Text style={styles.headerSubtitle}>Report disease outbreaks in your area</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Disease Information */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons name="clipboard-text" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Disease Information</Text>
          </View>

          {/* Disease Name */}
          <Text style={[styles.label, { color: colors.text }]}>Disease Name *</Text>
          <View style={styles.chipGrid}>
            {commonDiseases.map((disease) => (
              <TouchableOpacity
                key={disease}
                style={[
                  styles.chip,
                  {
                    backgroundColor: formData.disease_name === disease ? colors.primary : colors.card,
                    borderColor: formData.disease_name === disease ? colors.primary : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, disease_name: disease })}
              >
                <Text style={[
                  styles.chipText,
                  { color: formData.disease_name === disease ? '#FFF' : colors.text }
                ]}>
                  {disease}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Disease Input */}
          {formData.disease_name === 'Other' && (
            <View style={styles.customInputContainer}>
              <TextInput
                style={getInputStyle('custom_disease_name')}
                placeholder="Enter disease name..."
                placeholderTextColor={colors.textSecondary}
                value={formData.custom_disease_name}
                onChangeText={(text) => setFormData({ ...formData, custom_disease_name: text })}
                onFocus={() => setFocusedField('custom_disease_name')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}

          {/* Disease Type */}
          <Text style={[styles.label, { color: colors.text }]}>Disease Type *</Text>
          <View style={styles.optionRow}>
            {diseaseTypes.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.optionBtn,
                  {
                    backgroundColor: formData.disease_type === type.value ? colors.primary + '15' : colors.card,
                    borderColor: formData.disease_type === type.value ? colors.primary : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, disease_type: type.value })}
              >
                <MaterialCommunityIcons 
                  name={type.icon as any} 
                  size={18} 
                  color={formData.disease_type === type.value ? colors.primary : colors.textSecondary} 
                />
                <Text style={[
                  styles.optionText,
                  { color: formData.disease_type === type.value ? colors.primary : colors.text }
                ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Disease Type Input */}
          {formData.disease_type === 'other' && (
            <View style={styles.customInputContainer}>
              <TextInput
                style={getInputStyle('custom_disease_type')}
                placeholder="Specify disease type..."
                placeholderTextColor={colors.textSecondary}
                value={formData.custom_disease_type}
                onChangeText={(text) => setFormData({ ...formData, custom_disease_type: text })}
                onFocus={() => setFocusedField('custom_disease_type')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}

          {/* Severity */}
          <Text style={[styles.label, { color: colors.text }]}>Severity Level *</Text>
          <View style={styles.severityRow}>
            {severityLevels.map((level) => (
              <TouchableOpacity
                key={level.value}
                style={[
                  styles.severityBtn,
                  {
                    backgroundColor: formData.severity === level.value ? level.color : colors.card,
                    borderColor: level.color,
                  }
                ]}
                onPress={() => setFormData({ ...formData, severity: level.value })}
              >
                <Text style={[
                  styles.severityText,
                  { color: formData.severity === level.value ? '#FFF' : level.color }
                ]}>
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Symptoms */}
          <Text style={[styles.label, { color: colors.text }]}>Symptoms</Text>
          <TextInput
            style={[getInputStyle('symptoms'), styles.textArea]}
            placeholder="Describe symptoms observed..."
            placeholderTextColor={colors.textSecondary}
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
          <View style={styles.sectionHeader}>
            <Ionicons name="stats-chart" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Case Details</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Cases Count *</Text>
              <TextInput
                style={getInputStyle('cases_count')}
                placeholder="1"
                placeholderTextColor={colors.textSecondary}
                value={formData.cases_count}
                onChangeText={(text) => setFormData({ ...formData, cases_count: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('cases_count')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Deaths Count</Text>
              <TextInput
                style={getInputStyle('deaths_count')}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={formData.deaths_count}
                onChangeText={(text) => setFormData({ ...formData, deaths_count: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('deaths_count')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Age Group */}
          <Text style={[styles.label, { color: colors.text }]}>Age Group</Text>
          <View style={styles.chipGrid}>
            {ageGroups.map((age) => (
              <TouchableOpacity
                key={age.value}
                style={[
                  styles.chip,
                  {
                    backgroundColor: formData.age_group === age.value ? colors.secondary : colors.card,
                    borderColor: formData.age_group === age.value ? colors.secondary : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, age_group: age.value })}
              >
                <Text style={[
                  styles.chipText,
                  { color: formData.age_group === age.value ? '#FFF' : colors.text }
                ]}>
                  {age.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Gender */}
          <Text style={[styles.label, { color: colors.text }]}>Gender</Text>
          <View style={styles.optionRow}>
            {genderOptions.map((gender) => (
              <TouchableOpacity
                key={gender.value}
                style={[
                  styles.genderBtn,
                  {
                    backgroundColor: formData.gender === gender.value ? colors.secondary + '15' : colors.card,
                    borderColor: formData.gender === gender.value ? colors.secondary : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, gender: gender.value })}
              >
                <Ionicons 
                  name={gender.icon as any} 
                  size={18} 
                  color={formData.gender === gender.value ? colors.secondary : colors.textSecondary} 
                />
                <Text style={[
                  styles.optionText,
                  { color: formData.gender === gender.value ? colors.secondary : colors.text }
                ]}>
                  {gender.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Treatment Status */}
          <Text style={[styles.label, { color: colors.text }]}>Treatment Status</Text>
          <View style={styles.optionRow}>
            {treatmentStatusOptions.map((status) => (
              <TouchableOpacity
                key={status.value}
                style={[
                  styles.statusBtn,
                  {
                    backgroundColor: formData.treatment_status === status.value ? colors.accent + '15' : colors.card,
                    borderColor: formData.treatment_status === status.value ? colors.accent : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, treatment_status: status.value })}
              >
                <Ionicons 
                  name={status.icon as any} 
                  size={18} 
                  color={formData.treatment_status === status.value ? colors.accent : colors.textSecondary} 
                />
                <Text style={[
                  styles.statusText,
                  { color: formData.treatment_status === status.value ? colors.accent : colors.text }
                ]}>
                  {status.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
        </View>

        {/* Additional Notes */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Additional Notes</Text>
          </View>

          <TextInput
            style={[getInputStyle('notes'), styles.textArea]}
            placeholder="Any additional observations or notes..."
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
          style={[styles.footerBtn, styles.submitBtn, { backgroundColor: colors.primary }]}
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
  chipText: { fontSize: 13, fontWeight: '500' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  optionText: { fontSize: 13, fontWeight: '500' },
  severityRow: { flexDirection: 'row', gap: 10 },
  severityBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
  severityText: { fontSize: 13, fontWeight: '600' },
  genderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  statusText: { fontSize: 12, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  footer: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  cancelBtn: { borderWidth: 1.5 },
  submitBtn: {},
  footerBtnText: { fontSize: 16, fontWeight: '600' },
});

export default DiseaseReportForm;
