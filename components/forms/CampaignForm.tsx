// =====================================================
// CAMPAIGN FORM - Modern UI with Vector Icons
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { StateDropdown, SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';

interface CampaignFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const CampaignForm: React.FC<CampaignFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');

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
    { label: 'Vaccination', value: 'vaccination', color: '#10B981', icon: 'syringe' },
    { label: 'Health Checkup', value: 'health_checkup', color: '#3B82F6', icon: 'stethoscope' },
    { label: 'Awareness', value: 'awareness', color: '#8B5CF6', icon: 'bullhorn' },
    { label: 'Medicine Distribution', value: 'medicine_distribution', color: '#F59E0B', icon: 'pill' },
    { label: 'Medical Camp', value: 'medical_camp', color: '#EC4899', icon: 'hospital-box' },
    { label: 'Eye Camp', value: 'eye_camp', color: '#06B6D4', icon: 'eye' },
    { label: 'Dental Camp', value: 'dental_camp', color: '#14B8A6', icon: 'tooth' },
    { label: 'Mental Health', value: 'mental_health', color: '#6366F1', icon: 'brain' },
    { label: 'Maternal Health', value: 'maternal_health', color: '#F472B6', icon: 'human-pregnant' },
    { label: 'Child Health', value: 'child_health', color: '#84CC16', icon: 'baby-face' },
    { label: 'Water & Sanitation', value: 'water_sanitation', color: '#0EA5E9', icon: 'water' },
    { label: 'Nutrition', value: 'nutrition', color: '#EF4444', icon: 'food-apple' },
    { label: 'Other', value: 'other', color: '#6B7280', icon: 'clipboard-list' },
  ];

  const targetAudienceOptions = [
    { label: 'All Public', value: 'all', icon: 'people' },
    { label: 'Children (0-5)', value: 'children_0_5', icon: 'happy' },
    { label: 'Children (6-14)', value: 'children_6_14', icon: 'school' },
    { label: 'Adolescents', value: 'adolescents', icon: 'person' },
    { label: 'Adults', value: 'adults', icon: 'people' },
    { label: 'Elderly', value: 'elderly', icon: 'accessibility' },
    { label: 'Pregnant Women', value: 'pregnant_women', icon: 'body' },
    { label: 'Lactating Mothers', value: 'lactating_mothers', icon: 'heart' },
    { label: 'Women', value: 'women', icon: 'female' },
    { label: 'Men', value: 'men', icon: 'male' },
    { label: 'Other', value: 'other', icon: 'clipboard' },
  ];

  const validateForm = (): boolean => {
    if (!formData.campaign_name.trim()) {
      Alert.alert('Required', 'Please enter campaign name');
      return false;
    }
    if (!formData.location_name.trim()) {
      Alert.alert('Required', 'Please enter location');
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
    if (formData.end_date < formData.start_date) {
      Alert.alert('Invalid', 'End date cannot be before start date');
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

      const { error } = await supabase.from('health_campaigns').insert({
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
      });

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
      backgroundColor: colors.card,
      borderColor: focusedField === fieldName ? colors.primary : colors.border,
      color: colors.text,
    },
  ];

  const getCampaignColor = () => {
    const campaign = campaignTypeOptions.find(c => c.value === formData.campaign_type);
    return campaign?.color || colors.primary;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getDuration = () => {
    const start = new Date(formData.start_date);
    const end = new Date(formData.end_date);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: getCampaignColor() }]}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Ionicons name="megaphone" size={28} color="#FFF" />
          <Text style={styles.headerTitle}>Create Health Campaign</Text>
        </View>
        <Text style={styles.headerSubtitle}>Organize health initiatives for your community</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Campaign Details */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="clipboard" size={20} color={getCampaignColor()} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Campaign Details</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Campaign Name *</Text>
          <TextInput
            style={getInputStyle('campaign_name')}
            placeholder="e.g., Polio Vaccination Drive"
            placeholderTextColor={colors.textSecondary}
            value={formData.campaign_name}
            onChangeText={(text) => setFormData({ ...formData, campaign_name: text })}
            onFocus={() => setFocusedField('campaign_name')}
            onBlur={() => setFocusedField(null)}
          />

          {/* Campaign Type */}
          <Text style={[styles.label, { color: colors.text }]}>Campaign Type *</Text>
          <View style={styles.chipGrid}>
            {campaignTypeOptions.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: formData.campaign_type === type.value ? type.color + '20' : colors.card,
                    borderColor: formData.campaign_type === type.value ? type.color : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, campaign_type: type.value })}
              >
                <MaterialCommunityIcons 
                  name={type.icon as any} 
                  size={16} 
                  color={formData.campaign_type === type.value ? type.color : colors.textSecondary} 
                />
                <Text style={[
                  styles.chipText,
                  { color: formData.campaign_type === type.value ? type.color : colors.text }
                ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Campaign Type Input */}
          {formData.campaign_type === 'other' && (
            <View style={styles.customInputContainer}>
              <TextInput
                style={getInputStyle('custom_campaign_type')}
                placeholder="Specify campaign type..."
                placeholderTextColor={colors.textSecondary}
                value={formData.custom_campaign_type}
                onChangeText={(text) => setFormData({ ...formData, custom_campaign_type: text })}
                onFocus={() => setFocusedField('custom_campaign_type')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}

          <Text style={[styles.label, { color: colors.text }]}>Description</Text>
          <TextInput
            style={[getInputStyle('description'), styles.textArea]}
            placeholder="Brief description of the campaign objectives..."
            placeholderTextColor={colors.textSecondary}
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
          <View style={styles.sectionHeader}>
            <Ionicons name="people" size={20} color={getCampaignColor()} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Target Audience</Text>
          </View>

          <View style={styles.chipGrid}>
            {targetAudienceOptions.map((audience) => (
              <TouchableOpacity
                key={audience.value}
                style={[
                  styles.audienceChip,
                  {
                    backgroundColor: formData.target_audience === audience.value ? getCampaignColor() + '20' : colors.card,
                    borderColor: formData.target_audience === audience.value ? getCampaignColor() : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, target_audience: audience.value })}
              >
                <Ionicons 
                  name={audience.icon as any} 
                  size={16} 
                  color={formData.target_audience === audience.value ? getCampaignColor() : colors.textSecondary} 
                />
                <Text style={[
                  styles.chipText,
                  { color: formData.target_audience === audience.value ? getCampaignColor() : colors.text }
                ]}>
                  {audience.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Target Audience Input */}
          {formData.target_audience === 'other' && (
            <View style={styles.customInputContainer}>
              <TextInput
                style={getInputStyle('custom_target_audience')}
                placeholder="Specify target audience..."
                placeholderTextColor={colors.textSecondary}
                value={formData.custom_target_audience}
                onChangeText={(text) => setFormData({ ...formData, custom_target_audience: text })}
                onFocus={() => setFocusedField('custom_target_audience')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          )}

          <Text style={[styles.label, { color: colors.text }]}>Target Beneficiaries</Text>
          <TextInput
            style={getInputStyle('target_beneficiaries')}
            placeholder="Expected number of beneficiaries"
            placeholderTextColor={colors.textSecondary}
            value={formData.target_beneficiaries}
            onChangeText={(text) => setFormData({ ...formData, target_beneficiaries: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('target_beneficiaries')}
            onBlur={() => setFocusedField(null)}
            keyboardType="numeric"
          />
        </View>

        {/* Location — unified: GPS + reverse geocode + district/state */}
        <View style={styles.section}>
          <LocationField
            value={{
              latitude: null,
              longitude: null,
              locationName: formData.location_name,
              district: formData.district,
              state: formData.state,
              formattedAddress: '',
            }}
            onChange={(loc) =>
              setFormData({
                ...formData,
                location_name: loc.locationName,
                district: loc.district,
                state: loc.state,
              })
            }
            autoFetch={true}
          />
        </View>

        {/* Campaign Duration */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="calendar" size={20} color={getCampaignColor()} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Campaign Duration</Text>
          </View>

          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={[styles.label, { color: colors.text }]}>Start Date</Text>
              <TextInput
                style={getInputStyle('start_date')}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                value={formData.start_date}
                onChangeText={(text) => setFormData({ ...formData, start_date: text })}
                onFocus={() => setFocusedField('start_date')}
                onBlur={() => setFocusedField(null)}
              />
            </View>

            <View style={styles.dateField}>
              <Text style={[styles.label, { color: colors.text }]}>End Date</Text>
              <TextInput
                style={getInputStyle('end_date')}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                value={formData.end_date}
                onChangeText={(text) => setFormData({ ...formData, end_date: text })}
                onFocus={() => setFocusedField('end_date')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          </View>

          <View style={[styles.durationCard, { backgroundColor: getCampaignColor() + '15', borderColor: getCampaignColor() }]}>
            <Ionicons name="time" size={18} color={getCampaignColor()} />
            <Text style={[styles.durationText, { color: getCampaignColor() }]}>
              Duration: {getDuration()} day{getDuration() > 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="call" size={20} color={getCampaignColor()} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Contact Information</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Contact Person</Text>
          <TextInput
            style={getInputStyle('contact_person')}
            placeholder="Name of person in charge"
            placeholderTextColor={colors.textSecondary}
            value={formData.contact_person}
            onChangeText={(text) => setFormData({ ...formData, contact_person: text })}
            onFocus={() => setFocusedField('contact_person')}
            onBlur={() => setFocusedField(null)}
          />

          <Text style={[styles.label, { color: colors.text }]}>Contact Phone</Text>
          <TextInput
            style={getInputStyle('contact_phone')}
            placeholder="Phone number"
            placeholderTextColor={colors.textSecondary}
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
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text" size={20} color={getCampaignColor()} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Additional Notes</Text>
          </View>

          <TextInput
            style={[getInputStyle('notes'), styles.textArea]}
            placeholder="Any additional information, requirements, or instructions..."
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
          style={[styles.footerBtn, styles.submitBtn, { backgroundColor: '#EF4444' }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Ionicons name="checkmark" size={20} color="#FFF" />
          <Text style={[styles.footerBtnText, { color: '#FFF' }]}>
            {loading ? 'Creating...' : 'Create Campaign'}
          </Text>
        </TouchableOpacity>
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
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  audienceChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 13, fontWeight: '500' },
  dateRow: { flexDirection: 'row', gap: 12 },
  dateField: { flex: 1 },
  durationCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  durationText: { fontSize: 14, fontWeight: '600' },
  footer: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  cancelBtn: { borderWidth: 1.5 },
  submitBtn: {},
  footerBtnText: { fontSize: 16, fontWeight: '600' },
});

export default CampaignForm;
