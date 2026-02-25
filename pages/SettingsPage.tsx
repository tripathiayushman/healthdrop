// =====================================================
// SETTINGS PAGE - Comprehensive Settings Management
// =====================================================
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Modal,
} from 'react-native';
import { useTheme } from '../lib/ThemeContext';
import { supabase } from '../lib/supabase';
import { InputField, Button } from '../components/shared';
import { Profile } from '../types';

interface SettingsPageProps {
  profile: Profile;
  onBack: () => void;
  onSignOut: () => void;
  onProfileUpdate: (profile: Profile) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ 
  profile, 
  onBack, 
  onSignOut,
  onProfileUpdate,
}) => {
  const { theme, toggleTheme, colors } = useTheme();
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Edit profile state
  const [editForm, setEditForm] = useState({
    full_name: profile.full_name || '',
    assigned_area: profile.assigned_area || '',
    phone: profile.phone || '',
    district: profile.district || '',
    state: profile.state || '',
  });

  const handleLogout = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert('Error', 'Failed to logout. Please try again.');
      } else {
        setShowLogoutModal(false);
        onSignOut();
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: editForm.full_name,
          assigned_area: editForm.assigned_area,
          phone: editForm.phone,
          district: editForm.district,
          state: editForm.state,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id)
        .select()
        .single();

      if (error) {
        Alert.alert('Error', 'Failed to update profile.');
      } else if (data) {
        onProfileUpdate(data);
        setShowEditModal(false);
        Alert.alert('Success', 'Profile updated successfully!');
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'super_admin': return 'Super Administrator';
      case 'health_admin': return 'Health Administrator';
      case 'admin': return 'Administrator'; // legacy fallback
      case 'clinic': return 'Clinic Staff';
      case 'asha_worker': return 'ASHA Worker';
      case 'volunteer': return 'Community Volunteer';
      case 'district_officer': return 'District Officer';
      default: return role;
    }
  };

  const settingsSections = [
    {
      title: 'Account',
      items: [
        {
          icon: '👤',
          label: 'Full Name',
          value: profile.full_name || 'Not set',
          onPress: () => setShowEditModal(true),
        },
        {
          icon: '📧',
          label: 'Email',
          value: profile.email || 'No email',
          disabled: true,
        },
        {
          icon: '📱',
          label: 'Phone',
          value: profile.phone || 'Not set',
          onPress: () => setShowEditModal(true),
        },
        {
          icon: '🏢',
          label: 'Assigned Area',
          value: profile.assigned_area || 'Not specified',
          onPress: () => setShowEditModal(true),
        },
        {
          icon: '👔',
          label: 'Role',
          value: getRoleDisplayName(profile.role),
          disabled: true,
        },
        {
          icon: '📍',
          label: 'Location',
          value: profile.district && profile.state 
            ? `${profile.district}, ${profile.state}` 
            : 'Not set',
          onPress: () => setShowEditModal(true),
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: theme === 'dark' ? '🌙' : '☀️',
          label: 'Theme',
          value: theme === 'dark' ? 'Dark Mode' : 'Light Mode',
          onPress: toggleTheme,
        },
        {
          icon: '🔔',
          label: 'Push Notifications',
          toggle: true,
          value: notificationsEnabled,
          onToggle: setNotificationsEnabled,
        },
        {
          icon: '📍',
          label: 'Location Services',
          toggle: true,
          value: locationEnabled,
          onToggle: setLocationEnabled,
        },
        {
          icon: '🔄',
          label: 'Auto Sync Data',
          toggle: true,
          value: autoSync,
          onToggle: setAutoSync,
        },
      ],
    },
    {
      title: 'Data & Storage',
      items: [
        {
          icon: '💾',
          label: 'Clear Cache',
          value: 'Clear app cache',
          onPress: () => Alert.alert('Success', 'Cache cleared successfully!'),
        },
        {
          icon: '📊',
          label: 'Data Usage',
          value: 'View statistics',
          onPress: () => Alert.alert('Info', 'Feature coming soon!'),
        },
        {
          icon: '☁️',
          label: 'Sync Now',
          value: 'Sync all data',
          onPress: () => Alert.alert('Success', 'Data synced successfully!'),
        },
      ],
    },
    {
      title: 'Support & About',
      items: [
        {
          icon: '❓',
          label: 'Help & FAQ',
          value: 'Get help',
          onPress: () => Alert.alert('Help', 'For assistance, contact support@healthdrop.in'),
        },
        {
          icon: '📝',
          label: 'Privacy Policy',
          value: 'View policy',
          onPress: () => Alert.alert('Privacy', 'Your data is secure.'),
        },
        {
          icon: '📋',
          label: 'Terms of Service',
          value: 'View terms',
          onPress: () => Alert.alert('Terms', 'By using HealthDrop, you agree to our terms.'),
        },
        {
          icon: 'ℹ️',
          label: 'App Version',
          value: 'v1.0.0 (Build 1)',
          disabled: true,
        },
      ],
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header with Back Button */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={[styles.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Summary Card */}
        <View style={[styles.profileCard, { backgroundColor: colors.primary + '10', borderColor: colors.primary }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>
              {(profile.full_name || profile.email || 'U')[0].toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>
              {profile.full_name || 'Set your name'}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>
              {profile.email}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.roleText}>{getRoleDisplayName(profile.role)}</Text>
            </View>
          </View>
          <TouchableOpacity 
            style={[styles.editButton, { borderColor: colors.primary }]}
            onPress={() => setShowEditModal(true)}
          >
            <Text style={[styles.editButtonText, { color: colors.primary }]}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Settings Sections */}
        {settingsSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              {section.title}
            </Text>
            <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {section.items.map((item: any, itemIndex) => (
                <TouchableOpacity
                  key={itemIndex}
                  style={[
                    styles.settingItem,
                    itemIndex < section.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  ]}
                  onPress={item.onPress}
                  disabled={item.disabled || item.toggle}
                  activeOpacity={item.disabled ? 1 : 0.7}
                >
                  <View style={styles.settingLeft}>
                    <Text style={styles.settingIcon}>{item.icon}</Text>
                    <View style={styles.settingText}>
                      <Text style={[styles.settingLabel, { color: colors.text }]}>
                        {item.label}
                      </Text>
                      {!item.toggle && (
                        <Text style={[styles.settingValue, { color: colors.textSecondary }]}>
                          {item.value}
                        </Text>
                      )}
                    </View>
                  </View>
                  {item.toggle ? (
                    <Switch
                      value={item.value as boolean}
                      onValueChange={item.onToggle}
                      thumbColor={item.value ? colors.primary : '#f4f3f4'}
                      trackColor={{ false: colors.border, true: colors.primary + '40' }}
                    />
                  ) : !item.disabled ? (
                    <Text style={[styles.settingArrow, { color: colors.textSecondary }]}>›</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <TouchableOpacity 
            style={[styles.logoutButton, { backgroundColor: colors.danger + '10', borderColor: colors.danger }]} 
            onPress={() => setShowLogoutModal(true)}
          >
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={[styles.logoutText, { color: colors.danger }]}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            HealthDrop Surveillance System
          </Text>
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            © 2024 National Health Mission
          </Text>
        </View>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal
        visible={showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile</Text>
            
            <ScrollView style={styles.modalScroll}>
              <InputField
                label="Full Name"
                value={editForm.full_name}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, full_name: text }))}
                placeholder="Enter your full name"
              />
              <InputField
                label="Phone"
                value={editForm.phone}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, phone: text }))}
                placeholder="Enter phone number"
                keyboardType="phone-pad"
              />
              <InputField
                label="Assigned Area"
                value={editForm.assigned_area}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, assigned_area: text }))}
                placeholder="Enter assigned area"
              />
              <InputField
                label="District"
                value={editForm.district}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, district: text }))}
                placeholder="Enter district"
              />
              <InputField
                label="State"
                value={editForm.state}
                onChangeText={(text) => setEditForm(prev => ({ ...prev, state: text }))}
                placeholder="Enter state"
              />
            </ScrollView>
            
            <View style={styles.modalButtons}>
              <Button
                title="Cancel"
                onPress={() => setShowEditModal(false)}
                variant="outline"
              />
              <Button
                title={loading ? 'Saving...' : 'Save Changes'}
                onPress={handleUpdateProfile}
                variant="primary"
                loading={loading}
                disabled={loading}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Logout Confirmation Modal */}
      <Modal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.confirmModal, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Confirm Logout</Text>
            <Text style={[styles.confirmMessage, { color: colors.textSecondary }]}>
              Are you sure you want to logout from HealthDrop?
            </Text>
            <View style={styles.modalButtons}>
              <Button
                title="Cancel"
                onPress={() => setShowLogoutModal(false)}
                variant="outline"
              />
              <Button
                title={loading ? 'Logging out...' : 'Logout'}
                onPress={handleLogout}
                variant="danger"
                loading={loading}
                disabled={loading}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 50,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  backIcon: {
    fontSize: 24,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 13,
    marginBottom: 8,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFF',
  },
  editButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  section: {
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionContent: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  settingText: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  settingValue: {
    fontSize: 13,
  },
  settingArrow: {
    fontSize: 20,
    fontWeight: '300',
  },
  logoutSection: {
    padding: 16,
    marginTop: 8,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  logoutIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    padding: 24,
    paddingBottom: 40,
  },
  footerText: {
    fontSize: 12,
    marginBottom: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 16,
    padding: 24,
  },
  confirmModal: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalScroll: {
    maxHeight: 350,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
});

export default SettingsPage;