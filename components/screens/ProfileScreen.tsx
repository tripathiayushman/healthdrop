// =====================================================
// PROFILE SCREEN - User Profile & Settings
// =====================================================
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';

interface ProfileScreenProps {
  profile: Profile;
  onSignOut: () => void;
  onProfileUpdate?: (profile: Profile) => void;
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ profile, onSignOut, onProfileUpdate }) => {
  const { colors, isDark, toggleTheme } = useTheme();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  
  // Modal states
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showUpdateLocation, setShowUpdateLocation] = useState(false);
  const [showHelpFAQ, setShowHelpFAQ] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Form states
  const [editFormData, setEditFormData] = useState({
    full_name: profile.full_name || '',
    phone: profile.phone || '',
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [locationData, setLocationData] = useState({
    village: '',
    district: profile.district || '',
    state: profile.state || '',
    pincode: '',
  });
  const [gpsLoading, setGpsLoading] = useState(false);

  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('general');

  const getRoleInfo = (role: string) => {
    const roles: Record<string, { label: string; icon: string; color: string; gradient: [string, string] }> = {
      super_admin:      { label: 'Super Administrator', icon: 'shield-crown', color: '#42A5F5', gradient: ['#0F172A', '#1976D2'] },
      health_admin:     { label: 'Health Administrator', icon: 'hospital-box', color: '#26A69A', gradient: ['#0D3B2E', '#00897B'] },
      admin:            { label: 'Administrator', icon: 'shield-crown', color: '#F59E0B', gradient: ['#1C1400', '#B45309'] },
      clinic:           { label: 'Clinic Staff', icon: 'hospital-building', color: '#A78BFA', gradient: ['#1A1033', '#6D28D9'] },
      asha_worker:      { label: 'ASHA Worker', icon: 'account-heart', color: '#FB923C', gradient: ['#2D1B0E', '#EA580C'] },
      volunteer:        { label: 'Community Volunteer', icon: 'hand-heart', color: '#4ADE80', gradient: ['#0A2E1A', '#16A34A'] },
      district_officer: { label: 'District Officer', icon: 'account-tie', color: '#818CF8', gradient: ['#1E1B4B', '#4338CA'] },
    };
    return roles[role] || { label: role, icon: 'account', color: colors.primary, gradient: [colors.primary, colors.primary] as [string, string] };
  };

  const handleSignOut = () => {
    setShowSignOutModal(true);
  };

  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Sign out error:', error);
      }
      setShowSignOutModal(false);
      onSignOut();
    } catch (error) {
      console.error('Sign out error:', error);
      setShowSignOutModal(false);
      onSignOut(); // Still call onSignOut to reset the app state
    } finally {
      setSigningOut(false);
    }
  };

  const roleInfo = getRoleInfo(profile.role);

  // Helper functions for form input styling
  const getInputStyle = (fieldName: string) => [
    styles.modalInput,
    {
      backgroundColor: colors.card,
      borderColor: focusedField === fieldName ? colors.primary : colors.border,
      color: colors.text,
    },
  ];

  // Profile update handler
  const handleEditProfile = async () => {
    if (!editFormData.full_name.trim()) {
      Alert.alert('Required', 'Please enter your full name');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editFormData.full_name,
          phone: editFormData.phone,
        })
        .eq('id', user.id);

      if (error) throw error;

      Alert.alert('Success', 'Profile updated successfully');
      setShowEditProfile(false);
      onProfileUpdate?.({ ...profile, ...editFormData });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Password change handler
  const handleChangePassword = async () => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      Alert.alert('Required', 'Please fill in all password fields');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    if (passwordData.newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword,
      });

      if (error) throw error;

      Alert.alert('Success', 'Password changed successfully');
      setShowChangePassword(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Location update handler
  const handleUpdateLocation = async () => {
    if (!locationData.district.trim() || !locationData.state.trim()) {
      Alert.alert('Required', 'Please enter at least district and state');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update({
          district: locationData.district.trim(),
          state: locationData.state.trim(),
          // Store village + pincode in a notes-like field if your schema supports it
          // (optional — safe to ignore if column not present)
        })
        .eq('id', user.id);

      if (error) throw error;

      Alert.alert('Success', 'Location updated successfully');
      setShowUpdateLocation(false);
      onProfileUpdate?.({ ...profile, district: locationData.district, state: locationData.state });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // GPS auto-fill handler
  const handleGPSFetch = async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to auto-fill address.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&addressdetails=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'HealthDropApp/1.0' } }
      );
      const data = await res.json();
      const addr = data?.address ?? {};
      setLocationData(d => ({
        ...d,
        village: addr.village || addr.town || addr.suburb || addr.city_district || '',
        district: addr.state_district || addr.county || addr.city || d.district,
        state: addr.state || d.state,
        pincode: addr.postcode || d.pincode,
      }));
      Alert.alert('Location Detected', 'Address fields have been auto-filled. Please verify and save.');
    } catch {
      Alert.alert('Error', 'Could not determine location. Please enter manually.');
    } finally {
      setGpsLoading(false);
    }
  };


  // Feedback submit handler - stores in database
  const handleSubmitFeedback = async () => {
    if (!feedbackText.trim()) {
      Alert.alert('Required', 'Please enter your feedback');
      return;
    }
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'You must be logged in');
        return;
      }

      const { error } = await supabase.from('user_feedback').insert({
        user_id: user.id,
        user_name: profile.full_name,
        user_email: user.email,
        category: feedbackCategory,
        feedback_text: feedbackText,
        status: 'pending',
      });

      if (error) throw error;

      Alert.alert('Thank You!', 'Your feedback has been submitted successfully');
      setShowFeedback(false);
      setFeedbackText('');
      setFeedbackCategory('general');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  // Open external links
  const openTermsOfService = () => {
    Alert.alert(
      'Terms of Service',
      'Health Drop Surveillance System\n\n1. This app is for health surveillance reporting only.\n\n2. Users must provide accurate information.\n\n3. All data is handled securely and confidentially.\n\n4. Users must not misuse the platform.\n\n5. The app is provided as-is without warranties.',
      [{ text: 'OK' }]
    );
  };

  const openPrivacyPolicy = () => {
    Alert.alert(
      'Privacy Policy',
      'We are committed to protecting your privacy.\n\n• Your personal data is encrypted and stored securely.\n\n• We only collect necessary information for health surveillance.\n\n• Your data will not be shared with third parties without consent.\n\n• You can request data deletion at any time.\n\n• Location data is used only for report mapping.',
      [{ text: 'OK' }]
    );
  };

  interface MenuItem {
    iconName: string;
    iconFamily: 'ionicons' | 'material';
    label: string;
    action: () => void;
    hasSwitch?: boolean;
    switchValue?: boolean;
  }

  interface MenuSection {
    section: string;
    items: MenuItem[];
  }

  const menuItems: MenuSection[] = [
    {
      section: 'Account',
      items: [
        { iconName: 'person', iconFamily: 'ionicons', label: 'Edit Profile', action: () => setShowEditProfile(true) },
        { iconName: 'lock-closed', iconFamily: 'ionicons', label: 'Change Password', action: () => setShowChangePassword(true) },
        { iconName: 'location', iconFamily: 'ionicons', label: 'Update Location', action: () => setShowUpdateLocation(true) },
      ],
    },
    {
      section: 'Preferences',
      items: [
        { 
          iconName: isDark ? 'moon' : 'sunny', 
          iconFamily: 'ionicons',
          label: 'Dark Mode', 
          action: toggleTheme,
          hasSwitch: true,
          switchValue: isDark,
        },
        { 
          iconName: 'notifications', 
          iconFamily: 'ionicons',
          label: 'Notifications', 
          action: () => setNotificationsEnabled(!notificationsEnabled),
          hasSwitch: true,
          switchValue: notificationsEnabled,
        },
      ],
    },
    {
      section: 'Support',
      items: [
        { iconName: 'help-circle', iconFamily: 'ionicons', label: 'Help & FAQ', action: () => setShowHelpFAQ(true) },
        { iconName: 'chatbox-ellipses', iconFamily: 'ionicons', label: 'Send Feedback', action: () => setShowFeedback(true) },
        { iconName: 'document-text', iconFamily: 'ionicons', label: 'Terms of Service', action: openTermsOfService },
        { iconName: 'shield-checkmark', iconFamily: 'ionicons', label: 'Privacy Policy', action: openPrivacyPolicy },
      ],
    },
  ];

  const feedbackCategories = [
    { label: 'General', value: 'general' },
    { label: 'Bug Report', value: 'bug' },
    { label: 'Feature Request', value: 'feature' },
    { label: 'Improvement', value: 'improvement' },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header — role gradient */}
      <LinearGradient colors={roleInfo.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.4)' }]}>
            <MaterialCommunityIcons name={roleInfo.icon as any} size={40} color="#FFF" />
          </View>
          <View style={styles.onlineIndicator} />
        </View>
        <Text style={styles.userName}>{profile.full_name || 'User'}</Text>
        <Text style={styles.userEmail}>{profile.district ? `${profile.district}${profile.state ? ', ' + profile.state : ''}` : (profile.phone || 'No location set')}</Text>
        <View style={[styles.roleBadge, { backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }]}>
          <Text style={[styles.roleText, { color: '#FFFFFF' }]}>{roleInfo.label}</Text>
        </View>
      </LinearGradient>

      {/* Menu Sections */}
      {menuItems.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {section.section}
          </Text>
          <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {section.items.map((item, itemIndex) => (
              <TouchableOpacity
                key={itemIndex}
                style={[
                  styles.menuItem,
                  itemIndex < section.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
                onPress={item.action}
                activeOpacity={0.7}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name={item.iconName as any} size={22} color={colors.primary} />
                  <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
                </View>
                {item.hasSwitch ? (
                  <Switch
                    value={item.switchValue}
                    onValueChange={item.action}
                    trackColor={{ false: colors.border, true: colors.primary + '50' }}
                    thumbColor={item.switchValue ? colors.primary : colors.textSecondary}
                  />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* Sign Out Button */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.signOutButton, { backgroundColor: colors.error + '15', borderColor: colors.error }]}
          onPress={handleSignOut}
        >
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={styles.appInfo}>
        <Text style={[styles.appName, { color: colors.textSecondary }]}>Health Drop Surveillance</Text>
        <Text style={[styles.appVersion, { color: colors.textSecondary }]}>Version 1.0.0</Text>
      </View>

      <View style={styles.bottomSpacer} />

      {/* ==================== MODALS ==================== */}

      {/* Edit Profile Modal */}
      <Modal visible={showEditProfile} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="person" size={24} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile</Text>
            </View>
            
            <Text style={[styles.modalLabel, { color: colors.text }]}>Full Name</Text>
            <TextInput
              style={getInputStyle('full_name')}
              placeholder="Enter your full name"
              placeholderTextColor={colors.textSecondary}
              value={editFormData.full_name}
              onChangeText={(text) => setEditFormData({ ...editFormData, full_name: text })}
              onFocus={() => setFocusedField('full_name')}
              onBlur={() => setFocusedField(null)}
            />

            <Text style={[styles.modalLabel, { color: colors.text }]}>Phone Number</Text>
            <TextInput
              style={getInputStyle('phone')}
              placeholder="Enter phone number"
              placeholderTextColor={colors.textSecondary}
              value={editFormData.phone}
              onChangeText={(text) => setEditFormData({ ...editFormData, phone: text.replace(/[^0-9]/g, '') })}
              onFocus={() => setFocusedField('phone')}
              onBlur={() => setFocusedField(null)}
              keyboardType="phone-pad"
              maxLength={10}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn, { borderColor: colors.border }]}
                onPress={() => setShowEditProfile(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn, { backgroundColor: colors.primary }]}
                onPress={handleEditProfile}
                disabled={loading}
              >
                <Text style={[styles.modalBtnText, { color: '#FFF' }]}>{loading ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={showChangePassword} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="lock-closed" size={24} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Change Password</Text>
            </View>

            <Text style={[styles.modalLabel, { color: colors.text }]}>New Password</Text>
            <TextInput
              style={getInputStyle('newPassword')}
              placeholder="Enter new password"
              placeholderTextColor={colors.textSecondary}
              value={passwordData.newPassword}
              onChangeText={(text) => setPasswordData({ ...passwordData, newPassword: text })}
              onFocus={() => setFocusedField('newPassword')}
              onBlur={() => setFocusedField(null)}
              secureTextEntry
            />

            <Text style={[styles.modalLabel, { color: colors.text }]}>Confirm Password</Text>
            <TextInput
              style={getInputStyle('confirmPassword')}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textSecondary}
              value={passwordData.confirmPassword}
              onChangeText={(text) => setPasswordData({ ...passwordData, confirmPassword: text })}
              onFocus={() => setFocusedField('confirmPassword')}
              onBlur={() => setFocusedField(null)}
              secureTextEntry
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn, { borderColor: colors.border }]}
                onPress={() => {
                  setShowChangePassword(false);
                  setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                }}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn, { backgroundColor: colors.primary }]}
                onPress={handleChangePassword}
                disabled={loading}
              >
                <Text style={[styles.modalBtnText, { color: '#FFF' }]}>{loading ? 'Changing...' : 'Change'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Update Location Modal */}
      <Modal visible={showUpdateLocation} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="location" size={24} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Update Location</Text>
            </View>

            {/* GPS fetch button */}
            <TouchableOpacity
              style={[styles.gpsFetchBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}
              onPress={handleGPSFetch}
              disabled={gpsLoading}
            >
              {gpsLoading
                ? <ActivityIndicator size={16} color={colors.primary} />
                : <Ionicons name="navigate" size={16} color={colors.primary} />
              }
              <Text style={[styles.gpsFetchText, { color: colors.primary }]}>
                {gpsLoading ? 'Detecting location...' : 'Fetch GPS Location'}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.modalLabel, { color: colors.text }]}>Village / Town / Area</Text>
            <TextInput
              style={getInputStyle('village')}
              placeholder="e.g. Sector 12, Rajajipuram"
              placeholderTextColor={colors.textSecondary}
              value={locationData.village}
              onChangeText={(t) => setLocationData({ ...locationData, village: t })}
              onFocus={() => setFocusedField('village')}
              onBlur={() => setFocusedField(null)}
            />

            <Text style={[styles.modalLabel, { color: colors.text }]}>District *</Text>
            <TextInput
              style={getInputStyle('district')}
              placeholder="e.g. Lucknow"
              placeholderTextColor={colors.textSecondary}
              value={locationData.district}
              onChangeText={(t) => setLocationData({ ...locationData, district: t })}
              onFocus={() => setFocusedField('district')}
              onBlur={() => setFocusedField(null)}
            />

            <Text style={[styles.modalLabel, { color: colors.text }]}>State *</Text>
            <TextInput
              style={getInputStyle('state')}
              placeholder="e.g. Uttar Pradesh"
              placeholderTextColor={colors.textSecondary}
              value={locationData.state}
              onChangeText={(t) => setLocationData({ ...locationData, state: t })}
              onFocus={() => setFocusedField('state')}
              onBlur={() => setFocusedField(null)}
            />

            <Text style={[styles.modalLabel, { color: colors.text }]}>PIN Code</Text>
            <TextInput
              style={getInputStyle('pincode')}
              placeholder="e.g. 226012"
              placeholderTextColor={colors.textSecondary}
              value={locationData.pincode}
              onChangeText={(t) => setLocationData({ ...locationData, pincode: t.replace(/[^0-9]/g, '') })}
              onFocus={() => setFocusedField('pincode')}
              onBlur={() => setFocusedField(null)}
              keyboardType="numeric"
              maxLength={6}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn, { borderColor: colors.border }]}
                onPress={() => setShowUpdateLocation(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn, { backgroundColor: colors.primary }]}
                onPress={handleUpdateLocation}
                disabled={loading}
              >
                <Text style={[styles.modalBtnText, { color: '#FFF' }]}>{loading ? 'Updating...' : 'Update'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Help & FAQ Modal */}
      <Modal visible={showHelpFAQ} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="help-circle" size={24} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Help & FAQ</Text>
            </View>
            
            <ScrollView style={styles.faqScroll}>
              <View style={[styles.faqItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>How do I report a disease outbreak?</Text>
                <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>Go to Reports tab → Select "Disease Report" → Fill in all required details → Submit</Text>
              </View>
              
              <View style={[styles.faqItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>How do I create a health campaign?</Text>
                <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>Go to Reports tab → Select "Campaign" → Enter campaign details including dates, location and target audience</Text>
              </View>
              
              <View style={[styles.faqItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>What is an ASHA worker?</Text>
                <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>Accredited Social Health Activists (ASHA) are community health workers who serve as a link between the healthcare system and rural communities.</Text>
              </View>
              
              <View style={[styles.faqItem, { borderBottomColor: colors.border }]}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>How do I report water quality issues?</Text>
                <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>Go to Reports tab → Select "Water Quality" → Provide water source details and quality assessment</Text>
              </View>
              
              <View style={styles.faqItem}>
                <Text style={[styles.faqQuestion, { color: colors.text }]}>Who can see my reports?</Text>
                <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>Reports are visible to health administrators and relevant authorities in your region. Personal data is kept confidential.</Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalBtn, styles.modalSaveBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
              onPress={() => setShowHelpFAQ(false)}
            >
              <Text style={[styles.modalBtnText, { color: '#FFF' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Send Feedback Modal */}
      <Modal visible={showFeedback} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="chatbox-ellipses" size={24} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Send Feedback</Text>
            </View>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>Help us improve the app!</Text>

            <Text style={[styles.modalLabel, { color: colors.text }]}>Category</Text>
            <View style={styles.categoryGrid}>
              {feedbackCategories.map((cat) => (
                <TouchableOpacity
                  key={cat.value}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: feedbackCategory === cat.value ? colors.primary : colors.background,
                      borderColor: feedbackCategory === cat.value ? colors.primary : colors.border,
                    }
                  ]}
                  onPress={() => setFeedbackCategory(cat.value)}
                >
                  <Text style={[
                    styles.categoryText,
                    { color: feedbackCategory === cat.value ? '#FFF' : colors.text }
                  ]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.modalLabel, { color: colors.text }]}>Your Feedback</Text>
            <TextInput
              style={[getInputStyle('feedback'), styles.feedbackInput]}
              placeholder="Tell us what you think, suggestions, or report issues..."
              placeholderTextColor={colors.textSecondary}
              value={feedbackText}
              onChangeText={setFeedbackText}
              onFocus={() => setFocusedField('feedback')}
              onBlur={() => setFocusedField(null)}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn, { borderColor: colors.border }]}
                onPress={() => {
                  setShowFeedback(false);
                  setFeedbackText('');
                }}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn, { backgroundColor: colors.primary }]}
                onPress={handleSubmitFeedback}
                disabled={loading}
              >
                <Text style={[styles.modalBtnText, { color: '#FFF' }]}>{loading ? 'Sending...' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sign Out Confirmation Modal */}
      <Modal
        visible={showSignOutModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSignOutModal(false)}
      >
        <View style={styles.signOutModalOverlay}>
          <View style={[styles.signOutModalContainer, { backgroundColor: colors.card }]}>
            <View style={[styles.signOutModalIcon, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="log-out-outline" size={32} color="#EF4444" />
            </View>
            <Text style={[styles.signOutModalTitle, { color: colors.text }]}>
              Sign Out?
            </Text>
            <Text style={[styles.signOutModalMessage, { color: colors.textSecondary }]}>
              Are you sure you want to sign out of your account? You'll need to sign in again to access your data.
            </Text>
            <View style={styles.signOutModalButtons}>
              <TouchableOpacity
                style={[styles.signOutModalButton, styles.signOutModalCancelButton, { borderColor: colors.border }]}
                onPress={() => setShowSignOutModal(false)}
              >
                <Text style={[styles.signOutModalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.signOutModalButton, styles.signOutModalConfirmButton]}
                onPress={confirmSignOut}
                disabled={signingOut}
              >
                {signingOut ? (
                  <Text style={[styles.signOutModalButtonText, { color: '#FFFFFF' }]}>Signing Out...</Text>
                ) : (
                  <>
                    <Ionicons name="log-out-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={[styles.signOutModalButtonText, { color: '#FFFFFF' }]}>Sign Out</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 30,
    paddingBottom: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10B981',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 12,
  },
  roleBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: {
    fontWeight: '600',
    fontSize: 13,
  },
  section: {
    padding: 20,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  appName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  appVersion: {
    fontSize: 12,
  },
  bottomSpacer: {
    height: 20,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCancelBtn: {
    borderWidth: 1.5,
  },
  modalSaveBtn: {},
  modalBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  feedbackInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '500',
  },
  faqScroll: {
    maxHeight: 300,
  },
  faqItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  faqQuestion: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  faqAnswer: {
    fontSize: 14,
    lineHeight: 20,
  },
  // Sign Out Modal Styles
  signOutModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  signOutModalContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  signOutModalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  signOutModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  signOutModalMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  signOutModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  signOutModalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  signOutModalCancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  signOutModalConfirmButton: {
    backgroundColor: '#EF4444',
  },
  signOutModalButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  // GPS fetch button
  gpsFetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16,
  },
  gpsFetchText: {
    fontSize: 14,
    fontWeight: '600',
  },
});


export default ProfileScreen;
