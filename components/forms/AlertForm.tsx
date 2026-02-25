// =====================================================
// HEALTH ALERT FORM - Send Urgent Health Alerts (Vector Icons)
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
import { Profile } from '../../types';

interface AlertFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  profile?: Profile;
}

export const AlertForm: React.FC<AlertFormProps> = ({ onSuccess, onCancel, profile }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');

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
    { label: 'Disease Outbreak', value: 'disease_outbreak', color: '#EF4444', desc: 'Report new disease outbreak', icon: 'virus', iconFamily: 'material' as const },
    { label: 'Water Contamination', value: 'water_contamination', color: '#3B82F6', desc: 'Unsafe water supply alert', icon: 'water', iconFamily: 'ionicons' as const },
    { label: 'Food Poisoning', value: 'food_poisoning', color: '#F59E0B', desc: 'Mass food poisoning incident', icon: 'restaurant', iconFamily: 'ionicons' as const },
    { label: 'Vector Alert', value: 'vector_alert', color: '#8B5CF6', desc: 'Mosquito/pest outbreak', icon: 'bug', iconFamily: 'ionicons' as const },
    { label: 'Toxic Exposure', value: 'toxic_exposure', color: '#DC2626', desc: 'Chemical/toxic exposure', icon: 'skull', iconFamily: 'ionicons' as const },
    { label: 'Medical Emergency', value: 'medical_emergency', color: '#EC4899', desc: 'Mass casualty/emergency', icon: 'medical', iconFamily: 'ionicons' as const },
    { label: 'General Health Alert', value: 'general', color: '#6B7280', desc: 'Other health concerns', icon: 'warning', iconFamily: 'ionicons' as const },
  ];

  const urgencyLevels = [
    { label: 'Critical', value: 'critical', color: '#DC2626', desc: 'Immediate action needed' },
    { label: 'High', value: 'high', color: '#F59E0B', desc: 'Urgent attention required' },
    { label: 'Medium', value: 'medium', color: '#3B82F6', desc: 'Important, monitor closely' },
    { label: 'Low', value: 'low', color: '#10B981', desc: 'Advisory information' },
  ];

  const commonDiseases = [
    'Cholera', 'Typhoid', 'Malaria', 'Dengue', 'Chikungunya',
    'COVID-19', 'Influenza', 'Hepatitis', 'Diarrhea', 'Gastroenteritis', 'Other',
  ];

  const getInputStyle = (fieldName: string) => [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: focusedField === fieldName ? colors.primary : colors.border,
      color: colors.text,
    },
  ];

  const getTextAreaStyle = (fieldName: string) => [
    styles.textArea,
    {
      backgroundColor: colors.card,
      borderColor: focusedField === fieldName ? colors.primary : colors.border,
      color: colors.text,
    },
  ];

  const validateForm = (): boolean => {
    if (!formData.title.trim()) {
      Alert.alert('Required', 'Please enter an alert title');
      return false;
    }
    if (!formData.description.trim()) {
      Alert.alert('Required', 'Please provide alert description');
      return false;
    }
    if (!formData.location_name.trim() || !formData.district.trim() || !formData.state) {
      Alert.alert('Required', 'Please provide complete location details');
      return false;
    }
    return true;
  };

  // ── Push notification sender ─────────────────────────────────────────────
  const sendPushNotifications = async (alertTitle: string, alertBody: string, scope: 'officials' | 'all', district: string) => {
    try {
      // Fetch push tokens from profiles
      let query = supabase.from('profiles').select('expo_push_token').not('expo_push_token', 'is', null);
      if (scope === 'officials') {
        // Only district officials, clinics, ASHA workers — filtered by district
        query = query.in('role', ['district_officer', 'clinic', 'asha_worker', 'health_admin']);
        if (district) query = query.eq('district', district);
      }
      // For 'all': all users with push tokens
      const { data: profilesWithTokens } = await query;
      const tokens = (profilesWithTokens ?? []).map((p: any) => p.expo_push_token).filter(Boolean);
      if (tokens.length === 0) return;

      // Send via Expo Push API (best-effort, chunked)
      const CHUNK = 100;
      for (let i = 0; i < tokens.length; i += CHUNK) {
        const chunk = tokens.slice(i, i + CHUNK);
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk.map((token: string) => ({
            to: token,
            title: `🚨 ${alertTitle}`,
            body: alertBody,
            sound: 'default',
            priority: 'high',
            data: { type: 'health_alert' },
          }))),
        });
      }
      console.log(`[Push] Sent health alert to ${tokens.length} device(s)`);
    } catch (e) {
      console.warn('[Push] Push notification send failed (non-critical):', e);
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setModalType('error');
        setModalMessage('You must be logged in to send an alert.');
        setModalVisible(true);
        setLoading(false);
        return;
      }

      const diseaseValue = formData.disease_or_issue === 'Other' ? formData.custom_disease : formData.disease_or_issue;

      const { error } = await supabase.from('health_alerts').insert({
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
      });

      if (error) throw error;

      // Send push notifications (non-blocking)
      const pushBody = `${formData.urgency_level.toUpperCase()} • ${formData.location_name}, ${formData.district}${formData.disease_or_issue ? ' • ' + formData.disease_or_issue : ''}`;
      sendPushNotifications(formData.title, pushBody, formData.notify_scope, formData.district);

      // Role-aware success message
      const isAshaWorker = profile?.role === 'asha_worker';
      if (isAshaWorker) {
        setModalType('success');
        setModalMessage(
          '📋 Your alert request has been submitted for review. An Admin or Clinic staff member will review and approve it before it becomes visible to others.'
        );
      } else {
        const scopeMsg = formData.notify_scope === 'all'
          ? 'All app users have been notified via push notification.'
          : 'District officials, clinics, and ASHA workers have been notified.';
        setModalType('success');
        setModalMessage(`✅ Your health alert has been published successfully.\n\n${scopeMsg}`);
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: selectedAlertType?.color || colors.danger }]}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <View style={styles.backRow}>
            <Ionicons name="arrow-back" size={20} color="#FFF" />
            <Text style={styles.backText}>Cancel</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Ionicons name="alert-circle" size={28} color="#FFF" />
          <Text style={styles.headerTitle}>Send Health Alert</Text>
        </View>
        <Text style={styles.headerSubtitle}>Notify authorities about health emergencies</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Alert Type Selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Alert Type</Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            What type of health emergency?
          </Text>
          
          <View style={styles.alertTypesGrid}>
            {alertTypes.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.alertTypeCard,
                  {
                    backgroundColor: formData.alert_type === type.value ? type.color + '15' : colors.card,
                    borderColor: formData.alert_type === type.value ? type.color : colors.border,
                  }
                ]}
                onPress={() => setFormData({ ...formData, alert_type: type.value })}
              >
                {type.iconFamily === 'material' ? (
                  <MaterialCommunityIcons name={type.icon as any} size={24} color={type.color} />
                ) : (
                  <Ionicons name={type.icon as any} size={24} color={type.color} />
                )}
                <Text style={[styles.alertTypeLabel, { color: colors.text }]}>
                  {type.label}
                </Text>
                <Text style={[styles.alertTypeDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                  {type.desc}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Urgency Level */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Urgency Level</Text>
          <View style={styles.urgencyRow}>
            {urgencyLevels.map((level) => (
              <TouchableOpacity
                key={level.value}
                style={[
                  styles.urgencyBtn,
                  {
                    backgroundColor: formData.urgency_level === level.value ? level.color : colors.card,
                    borderColor: level.color,
                  }
                ]}
                onPress={() => setFormData({ ...formData, urgency_level: level.value })}
              >
                <View style={[styles.urgencyDot, { backgroundColor: formData.urgency_level === level.value ? '#FFF' : level.color }]} />
                <Text style={[
                  styles.urgencyLabel,
                  { color: formData.urgency_level === level.value ? '#FFF' : level.color }
                ]}>
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {selectedUrgency && (
            <Text style={[styles.urgencyHint, { color: selectedUrgency.color }]}>
              {selectedUrgency.desc}
            </Text>
          )}
        </View>

        {/* Alert Details */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="document-text" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Alert Details</Text>
          </View>
          
          <Text style={[styles.label, { color: colors.text }]}>Alert Title *</Text>
          <TextInput
            style={getInputStyle('title')}
            placeholder="Brief title for the alert"
            placeholderTextColor={colors.textSecondary}
            value={formData.title}
            onChangeText={(text) => setFormData({ ...formData, title: text })}
            onFocus={() => setFocusedField('title')}
            onBlur={() => setFocusedField(null)}
          />

          <Text style={[styles.label, { color: colors.text }]}>Description *</Text>
          <TextInput
            style={getTextAreaStyle('description')}
            placeholder="Describe the health emergency in detail..."
            placeholderTextColor={colors.textSecondary}
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            onFocus={() => setFocusedField('description')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={4}
          />

          {/* Quick Disease Selection */}
          {(formData.alert_type === 'disease_outbreak' || formData.alert_type === 'food_poisoning') && (
            <>
              <Text style={[styles.label, { color: colors.text }]}>Disease / Issue</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.diseaseScroll}>
                {commonDiseases.map((disease) => (
                  <TouchableOpacity
                    key={disease}
                    style={[
                      styles.diseaseChip,
                      {
                        backgroundColor: formData.disease_or_issue === disease ? colors.primary : colors.card,
                        borderColor: formData.disease_or_issue === disease ? colors.primary : colors.border,
                      }
                    ]}
                    onPress={() => setFormData({ ...formData, disease_or_issue: disease })}
                  >
                    <Text style={[
                      styles.diseaseChipText,
                      { color: formData.disease_or_issue === disease ? '#FFF' : colors.text }
                    ]}>
                      {disease}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {formData.disease_or_issue === 'Other' && (
                <View style={styles.customInputContainer}>
                  <TextInput
                    style={getInputStyle('custom_disease')}
                    placeholder="Specify disease/issue name"
                    placeholderTextColor={colors.textSecondary}
                    value={formData.custom_disease}
                    onChangeText={(text) => setFormData({ ...formData, custom_disease: text })}
                    onFocus={() => setFocusedField('custom_disease')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>
              )}

              <Text style={[styles.label, { color: colors.text }]}>Symptoms to Watch</Text>
              <TextInput
                style={getInputStyle('symptoms')}
                placeholder="e.g., fever, vomiting, diarrhea..."
                placeholderTextColor={colors.textSecondary}
                value={formData.symptoms_to_watch}
                onChangeText={(text) => setFormData({ ...formData, symptoms_to_watch: text })}
                onFocus={() => setFocusedField('symptoms')}
                onBlur={() => setFocusedField(null)}
              />
            </>
          )}
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

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Population Affected</Text>
              <TextInput
                style={getInputStyle('population')}
                placeholder="Approx. number"
                placeholderTextColor={colors.textSecondary}
                value={formData.affected_population}
                onChangeText={(text) => setFormData({ ...formData, affected_population: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('population')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Cases Count */}
          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Cases Reported</Text>
              <TextInput
                style={getInputStyle('cases')}
                placeholder="Number of cases"
                placeholderTextColor={colors.textSecondary}
                value={formData.cases_reported}
                onChangeText={(text) => setFormData({ ...formData, cases_reported: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('cases')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Deaths (if any)</Text>
              <TextInput
                style={getInputStyle('deaths')}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={formData.deaths_reported}
                onChangeText={(text) => setFormData({ ...formData, deaths_reported: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('deaths')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />
            </View>
          </View>
        </View>

        {/* Actions & Precautions */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="flash" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Actions & Precautions</Text>
          </View>

          <Text style={[styles.label, { color: colors.text }]}>Immediate Actions Recommended</Text>
          <TextInput
            style={getTextAreaStyle('actions')}
            placeholder="What immediate steps should be taken?"
            placeholderTextColor={colors.textSecondary}
            value={formData.immediate_actions}
            onChangeText={(text) => setFormData({ ...formData, immediate_actions: text })}
            onFocus={() => setFocusedField('actions')}
            onBlur={() => setFocusedField(null)}
            multiline
            numberOfLines={3}
          />

          <Text style={[styles.label, { color: colors.text }]}>Precautionary Measures for Public</Text>
          <TextInput
            style={getTextAreaStyle('precautions')}
            placeholder="What precautions should people take?"
            placeholderTextColor={colors.textSecondary}
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
          <View style={styles.sectionTitleRow}>
            <Ionicons name="call" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Contact Information</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Contact Person</Text>
              <TextInput
                style={getInputStyle('contact_person')}
                placeholder="Your name"
                placeholderTextColor={colors.textSecondary}
                value={formData.contact_person}
                onChangeText={(text) => setFormData({ ...formData, contact_person: text })}
                onFocus={() => setFocusedField('contact_person')}
                onBlur={() => setFocusedField(null)}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: colors.text }]}>Phone Number</Text>
              <TextInput
                style={getInputStyle('contact_phone')}
                placeholder="Contact number"
                placeholderTextColor={colors.textSecondary}
                value={formData.contact_phone}
                onChangeText={(text) => setFormData({ ...formData, contact_phone: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('contact_phone')}
                onBlur={() => setFocusedField(null)}
                keyboardType="phone-pad"
                maxLength={10}
              />
            </View>
          </View>
        </View>

        {/* Notification Options */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="notifications" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notification Options</Text>
          </View>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Who should receive push notifications for this alert?
          </Text>

          {/* Option 1 */}
          <TouchableOpacity
            style={[
              styles.notifyCard,
              {
                backgroundColor: formData.notify_scope === 'officials' ? colors.primary + '12' : colors.card,
                borderColor: formData.notify_scope === 'officials' ? colors.primary : colors.border,
                borderWidth: formData.notify_scope === 'officials' ? 2 : 1,
              },
            ]}
            onPress={() => setFormData({ ...formData, notify_scope: 'officials' })}
            activeOpacity={0.8}
          >
            <View style={[styles.notifyIconWrap, { backgroundColor: '#818CF8' + '22' }]}>
              <Ionicons name="shield-checkmark" size={24} color="#818CF8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.notifyTitle, { color: colors.text }]}>District Officials, Clinics & ASHA Workers</Text>
              <Text style={[styles.notifyDesc, { color: colors.textSecondary }]}>
                Targeted notification to health professionals in the district
              </Text>
            </View>
            <View style={[styles.radioOuter, { borderColor: formData.notify_scope === 'officials' ? colors.primary : colors.border }]}>
              {formData.notify_scope === 'officials' && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
            </View>
          </TouchableOpacity>

          {/* Option 2 */}
          <TouchableOpacity
            style={[
              styles.notifyCard,
              {
                backgroundColor: formData.notify_scope === 'all' ? '#EF4444' + '12' : colors.card,
                borderColor: formData.notify_scope === 'all' ? '#EF4444' : colors.border,
                borderWidth: formData.notify_scope === 'all' ? 2 : 1,
                marginTop: 10,
              },
            ]}
            onPress={() => setFormData({ ...formData, notify_scope: 'all' })}
            activeOpacity={0.8}
          >
            <View style={[styles.notifyIconWrap, { backgroundColor: '#EF4444' + '22' }]}>
              <Ionicons name="megaphone" size={24} color="#EF4444" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.notifyTitle, { color: colors.text }]}>All App Users</Text>
              <Text style={[styles.notifyDesc, { color: colors.textSecondary }]}>
                Broadcast to everyone on the HealthDrop platform
              </Text>
            </View>
            <View style={[styles.radioOuter, { borderColor: formData.notify_scope === 'all' ? '#EF4444' : colors.border }]}>
              {formData.notify_scope === 'all' && <View style={[styles.radioInner, { backgroundColor: '#EF4444' }]} />}
            </View>
          </TouchableOpacity>
        </View>

        {/* Summary Preview */}
        <View style={[styles.summaryCard, { backgroundColor: selectedAlertType?.color + '10', borderColor: selectedAlertType?.color }]}>
          <View style={styles.summaryTitleRow}>
            <Ionicons name="alert-circle" size={20} color={selectedAlertType?.color} />
            <Text style={[styles.summaryTitle, { color: selectedAlertType?.color }]}>Alert Preview</Text>
          </View>
          <Text style={[styles.summaryText, { color: colors.text }]}>
            Type: {selectedAlertType?.label || '-'}{'\n'}
            Urgency: {selectedUrgency?.label || '-'}{'\n'}
            Title: {formData.title || '-'}{'\n'}
            Location: {formData.location_name}, {formData.district}, {formData.state}
            {formData.cases_reported ? `\nCases: ${formData.cases_reported}` : ''}
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer Buttons */}
      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.footerBtn, styles.cancelBtn, { borderColor: colors.border }]}
          onPress={onCancel}
        >
          <Text style={[styles.footerBtnText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.footerBtn, styles.submitBtn, { backgroundColor: selectedAlertType?.color || colors.danger }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <View style={styles.submitBtnContent}>
            <Ionicons name="alert-circle" size={18} color="#FFF" />
            <Text style={[styles.footerBtnText, { color: '#FFF' }]}>
              {loading ? 'Sending...' : 'Send Alert'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Submission Modal */}
      <SubmissionModal
        visible={modalVisible}
        type={modalType}
        title={modalType === 'success' ? 'Alert Sent!' : 'Alert Failed'}
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
  backBtn: { marginBottom: 10 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: '#FFF', fontSize: 16 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: '#FFF', fontSize: 24, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 4 },
  content: { flex: 1, paddingHorizontal: 20 },
  section: { marginTop: 24 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionDesc: { fontSize: 13, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 15 },
  textArea: { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 15, minHeight: 100, textAlignVertical: 'top' },
  alertTypesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  alertTypeCard: { width: '47%', padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', gap: 4 },
  alertTypeLabel: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  alertTypeDesc: { fontSize: 10, textAlign: 'center' },
  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 2, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  urgencyDot: { width: 10, height: 10, borderRadius: 5 },
  urgencyLabel: { fontSize: 12, fontWeight: '600' },
  urgencyHint: { fontSize: 12, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  diseaseScroll: { maxHeight: 45 },
  diseaseChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, marginRight: 8 },
  diseaseChipText: { fontSize: 13 },
  customInputContainer: { marginTop: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 10 },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  switchDesc: { fontSize: 12, marginTop: 2 },
  summaryCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginTop: 24 },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  summaryTitle: { fontSize: 16, fontWeight: '700' },
  summaryText: { fontSize: 14, lineHeight: 22 },
  footer: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  footerBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  cancelBtn: { borderWidth: 1.5 },
  submitBtn: {},
  submitBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerBtnText: { fontSize: 16, fontWeight: '600' },
  // Notification radio cards
  notifyCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, gap: 12 },
  notifyIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  notifyTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  notifyDesc: { fontSize: 12 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 12, height: 12, borderRadius: 6 },
});

export default AlertForm;
