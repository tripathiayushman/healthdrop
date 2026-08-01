// =====================================================
// PROFILE SCREEN ("Prakash" design)
// User profile & settings — flat headerBg band + Role
// Ribbon, token-driven cards, inline validation (no
// Alert.alert), One-Hand Action Bar modals.
// =====================================================
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Switch,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { ROLE_ACCENT } from '../dashboards/DashboardShared';
import { clearExpoPushToken } from '../../lib/services/users';
import { computeCompleteness } from '../../lib/services/profileCompleteness';
import { setAppLanguage } from '../../lib/i18n';

interface ProfileScreenProps {
  profile: Profile;
  onSignOut: () => void;
  onProfileUpdate?: (profile: Profile) => void;
  onNavigateToForm?: (formType: string) => void;
}

/**
 * 8% alpha suffix — the accent-tinted role-chip wash, matching the dashboard
 * header. Derived from the role-accent token, never a standalone color.
 */
const ACCENT_TINT_ALPHA = '14';

const NOTIFICATIONS_KEY = 'healthdrop:notificationsEnabled';
const LANGUAGE_KEY = 'healthdrop:language';
const CRITICAL_OVERRIDE_KEY = 'healthdrop:criticalOverridesDnd';

type AppLanguage = 'en' | 'hi';

const LANGUAGE_OPTIONS: { value: AppLanguage; label: string; sub: string }[] = [
  { value: 'en', label: 'English', sub: 'Default' },
  { value: 'hi', label: 'हिन्दी', sub: 'Hindi' },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin:      'Super Administrator',
  health_admin:     'Health Administrator',
  clinic:           'Clinic Staff',
  asha_worker:      'ASHA Worker',
  volunteer:        'Community Volunteer',
  district_officer: 'District Officer',
};

const ROLE_ION_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  super_admin:      'shield-checkmark-outline',
  health_admin:     'medkit-outline',
  clinic:           'medical-outline',
  asha_worker:      'heart-outline',
  volunteer:        'hand-left-outline',
  district_officer: 'business-outline',
};

const TERMS_TEXT =
  'Health Drop Surveillance System\n\n1. This app is for health surveillance reporting only.\n\n2. Users must provide accurate information.\n\n3. All data is handled securely and confidentially.\n\n4. Users must not misuse the platform.\n\n5. The app is provided as-is without warranties.';

const PRIVACY_TEXT =
  'We are committed to protecting your privacy.\n\n• Your personal data is encrypted and stored securely.\n\n• We only collect necessary information for health surveillance.\n\n• Your data will not be shared with third parties without consent.\n\n• You can request data deletion at any time.\n\n• Location data is used only for report mapping.';

const ProfileScreen: React.FC<ProfileScreenProps> = ({
  profile,
  onSignOut,
  onProfileUpdate,
  onNavigateToForm,
}) => {
  const { colors, isDark, toggleTheme, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [criticalOverride, setCriticalOverride] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  // Modal states
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showUpdateLocation, setShowUpdateLocation] = useState(false);
  const [showHelpFAQ, setShowHelpFAQ] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [infoDoc, setInfoDoc] = useState<{ title: string; body: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Danger zone — account deletion
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Inline validation / server errors — Alert.alert is banned for validation
  const [editError, setEditError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  // GPS status message shown inline inside the location modal
  const [gpsMessage, setGpsMessage] = useState('');

  // Form states
  const [editFormData, setEditFormData] = useState({
    full_name: profile.full_name || '',
    phone: profile.phone || '',
  });
  const [passwordData, setPasswordData] = useState({
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

  // Load persisted settings (notifications, critical-override, language)
  useEffect(() => {
    AsyncStorage.getItem(NOTIFICATIONS_KEY)
      .then(value => {
        if (value !== null) setNotificationsEnabled(value === 'true');
      })
      .catch(() => {
        /* storage unavailable — keep default */
      });
    AsyncStorage.getItem(CRITICAL_OVERRIDE_KEY)
      .then(value => {
        if (value !== null) setCriticalOverride(value === 'true');
      })
      .catch(() => {
        /* storage unavailable — keep default */
      });
    AsyncStorage.getItem(LANGUAGE_KEY)
      .then(value => {
        if (value === 'en' || value === 'hi') setLanguage(value);
      })
      .catch(() => {
        /* storage unavailable — keep default */
      });
  }, []);

  const toggleNotifications = () => {
    setNotificationsEnabled(prev => {
      const next = !prev;
      AsyncStorage.setItem(NOTIFICATIONS_KEY, String(next)).catch(() => {
        /* storage unavailable — in-memory toggle still applies */
      });
      return next;
    });
  };

  const toggleCriticalOverride = () => {
    setCriticalOverride(prev => {
      const next = !prev;
      AsyncStorage.setItem(CRITICAL_OVERRIDE_KEY, String(next)).catch(() => {
        /* storage unavailable — in-memory toggle still applies */
      });
      return next;
    });
  };

  const handleSelectLanguage = (lang: AppLanguage) => {
    setLanguage(lang);
    AsyncStorage.setItem(LANGUAGE_KEY, lang).catch(() => {
      /* storage unavailable — in-memory choice still applies this session */
    });
    try {
      Promise.resolve(setAppLanguage(lang)).catch(error => {
        console.warn('Failed to apply app language:', error);
      });
    } catch (error) {
      console.warn('Failed to apply app language:', error);
    }
    // Also persist to profiles.preferred_language so server-side surfaces
    // (push notifications) can localize. Fail-soft: the on-device switch
    // above already applied; a failed write only costs server localization.
    supabase
      .from('profiles')
      .update({ preferred_language: lang })
      .eq('id', profile.id)
      .then(
        ({ error }) => {
          if (error) console.warn('Failed to save language preference to profile:', error.message);
        },
        (error: unknown) => {
          console.warn('Failed to save language preference to profile:', error);
        },
      );
    setShowLanguageModal(false);
  };

  // Profile completeness — pure compute from the prop; recomputes when the
  // edit-profile / update-location modals push a new profile up via
  // onProfileUpdate. Hidden entirely at 100%.
  const completeness = computeCompleteness(profile);
  const completenessCaption = t('completeness.caption', {
    pct: completeness.pct,
    missing: completeness.missing.map(field => t(`completeness.fields.${field}`)).join(', '),
  });

  const accent = ROLE_ACCENT[profile.role] ?? colors.primary;
  const roleLabel = ROLE_LABEL[profile.role] ?? profile.role;
  const roleIcon = ROLE_ION_ICON[profile.role] ?? 'person-outline';

  const handleSignOut = () => {
    setShowSignOutModal(true);
  };

  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      // Remove this device's push token BEFORE the session ends —
      // the profiles update needs an authenticated session to pass RLS.
      try {
        await clearExpoPushToken();
      } catch (tokenError) {
        console.warn('Failed to clear push token on sign-out:', tokenError);
      }
      // Clear this user's queued offline items if the API is available.
      try {
        const offlineSync: any = require('../../src/services/offlineSync');
        if (typeof offlineSync?.clearQueueForUser === 'function') {
          await offlineSync.clearQueueForUser(profile.id);
        }
      } catch (queueError) {
        console.warn('Failed to clear offline queue on sign-out:', queueError);
      }
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

  const openDeleteAccount = () => {
    setDeleteConfirmText('');
    setDeleteError('');
    setShowDeleteAccount(true);
  };

  // Permanently delete the caller's account via the delete-account edge
  // function. Server side: auth user + profile/tokens/acks/participation are
  // removed; health reports are KEPT with identity detached. A 409 means the
  // caller is the last active super admin — surfaced inline, never a popup.
  const confirmDeleteAccount = async () => {
    if (deleteConfirmText.trim() !== 'DELETE' || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const { error } = await supabase.functions.invoke('delete-account', {
        body: { confirm: 'DELETE' },
      });

      if (error) {
        // FunctionsHttpError carries the Response in error.context — read the
        // status and body defensively (shape varies by platform/version).
        const ctx: any = (error as any)?.context;
        const status: number | undefined =
          typeof ctx?.status === 'number' ? ctx.status : undefined;
        let serverMsg = '';
        try {
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            serverMsg = String(body?.error ?? body?.message ?? '');
          }
        } catch {
          /* body unreadable — fall back to status/message below */
        }
        if (status === 409 || /last\s+(active\s+)?super[\s_-]?admin/i.test(serverMsg)) {
          setDeleteError(
            serverMsg ||
              'You are the last active super admin — assign another super admin before deleting this account.',
          );
        } else {
          setDeleteError(serverMsg || error.message || "Couldn't delete account — check connection and try again.");
        }
        return;
      }

      // Server-side deletion succeeded — clear this device's local traces.
      try {
        const offlineSync: any = require('../../src/services/offlineSync');
        if (typeof offlineSync?.clearQueueForUser === 'function') {
          await offlineSync.clearQueueForUser(profile.id);
        }
      } catch (queueError) {
        console.warn('Failed to clear offline queue after account deletion:', queueError);
      }
      try {
        await AsyncStorage.removeItem('healthdrop:cachedProfile:' + profile.id);
      } catch (cacheError) {
        console.warn('Failed to clear cached profile after account deletion:', cacheError);
      }
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        // The auth user no longer exists — a failed remote sign-out is
        // expected; the local session is still discarded.
        console.warn('Sign-out after account deletion:', signOutError);
      }
      setShowDeleteAccount(false);
      onSignOut();
    } catch (error: any) {
      setDeleteError(error?.message || "Couldn't delete account — check connection and try again.");
    } finally {
      setDeleteBusy(false);
    }
  };

  // Input styling — 1.5px border at rest, 2px focus, no glow
  const getInputStyle = (fieldName: string) => [
    styles.modalInput,
    {
      backgroundColor: colors.inputBackground,
      borderColor: focusedField === fieldName ? colors.inputFocusBorder : colors.inputBorder,
      borderWidth: focusedField === fieldName ? 2 : 1.5,
      color: colors.text,
    },
  ];

  const InlineError: React.FC<{ message: string }> = ({ message }) =>
    message ? (
      <View style={styles.inlineErrorRow}>
        <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
        <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{message}</Text>
      </View>
    ) : null;

  // Profile update handler
  const handleEditProfile = async () => {
    if (!editFormData.full_name.trim()) {
      setEditError('Please enter your full name');
      return;
    }
    setEditError('');
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

      setShowEditProfile(false);
      onProfileUpdate?.({ ...profile, ...editFormData });
    } catch (error: any) {
      setEditError(error.message || "Couldn't save — check connection");
    } finally {
      setLoading(false);
    }
  };

  // Password change handler
  const handleChangePassword = async () => {
    if (!passwordData.newPassword || !passwordData.confirmPassword) {
      setPasswordError('Please fill in all password fields');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (passwordData.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    setPasswordError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword,
      });

      if (error) throw error;

      setShowChangePassword(false);
      setPasswordData({ newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      setPasswordError(error.message || "Couldn't change password — check connection");
    } finally {
      setLoading(false);
    }
  };

  // Location update handler
  const handleUpdateLocation = async () => {
    if (!locationData.district.trim() || !locationData.state.trim()) {
      setLocationError('Please enter at least district and state');
      return;
    }
    setLocationError('');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update({
          district: locationData.district.trim(),
          state: locationData.state.trim(),
        })
        .eq('id', user.id);

      if (error) throw error;

      setShowUpdateLocation(false);
      setGpsMessage('');
      onProfileUpdate?.({ ...profile, district: locationData.district, state: locationData.state });
    } catch (error: any) {
      setLocationError(error.message || "Couldn't save — check connection");
    } finally {
      setLoading(false);
    }
  };

  // GPS auto-fill handler — status is shown inline, never as a popup
  const handleGPSFetch = async () => {
    setGpsLoading(true);
    setGpsMessage('');
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setGpsMessage('Location services (GPS) are off — enable them on your device and try again.');
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsMessage('Location permission is required to auto-fill address.');
        return;
      }

      // First try last known location for fast UX, then fall back to active GPS fix.
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 120000, requiredAccuracy: 200 });
      if (!pos) {
        pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: true,
        });
      }

      const [addr] = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });

      if (!addr) {
        setGpsMessage('GPS location detected, but address lookup was unavailable. Please fill details manually.');
        return;
      }

      setLocationData(d => ({
        ...d,
        village: addr.district || addr.subregion || addr.city || addr.street || d.village,
        district: addr.subregion || addr.city || addr.region || d.district,
        state: addr.region || d.state,
        pincode: addr.postalCode || d.pincode,
      }));
      setGpsMessage('Address auto-filled from GPS. Please verify and save.');
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('timeout')) {
        setGpsMessage('GPS took too long to respond. Move to an open area and try again.');
      } else {
        setGpsMessage('Could not determine location. Please enter manually.');
      }
    } finally {
      setGpsLoading(false);
    }
  };

  // Feedback submit handler - stores in database
  const handleSubmitFeedback = async () => {
    if (!feedbackText.trim()) {
      setFeedbackError('Please enter your feedback');
      return;
    }
    setFeedbackError('');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setFeedbackError('You must be logged in');
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

      setShowFeedback(false);
      setFeedbackText('');
      setFeedbackCategory('general');
    } catch (error: any) {
      setFeedbackError(error.message || "Couldn't send — check connection");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWidgetCustomization = () => {
    if (!onNavigateToForm) return;
    onNavigateToForm('widget-customization');
  };

  interface MenuItem {
    iconName: keyof typeof Ionicons.glyphMap;
    label: string;
    action: () => void;
    hasSwitch?: boolean;
    switchValue?: boolean;
    /** Small honest-state line under the label */
    caption?: string;
    /** Current value shown before the chevron (e.g. selected language) */
    valueLabel?: string;
  }

  interface MenuSection {
    section: string;
    items: MenuItem[];
  }

  const menuItems: MenuSection[] = [
    {
      section: 'Account',
      items: [
        { iconName: 'person-outline', label: 'Edit Profile', action: () => setShowEditProfile(true) },
        { iconName: 'lock-closed-outline', label: 'Change Password', action: () => setShowChangePassword(true) },
        { iconName: 'location-outline', label: 'Update Location', action: () => setShowUpdateLocation(true) },
      ],
    },
    {
      section: 'Preferences',
      items: [
        {
          iconName: 'grid-outline',
          label: 'Customize Widgets',
          action: handleOpenWidgetCustomization,
        },
        {
          iconName: isDark ? 'moon-outline' : 'sunny-outline',
          label: 'Dark Mode',
          action: toggleTheme,
          hasSwitch: true,
          switchValue: isDark,
        },
        {
          iconName: 'language-outline',
          label: 'Language / भाषा',
          caption: 'हिन्दी अनुवाद जारी है — some screens remain English',
          valueLabel: language === 'hi' ? 'हिन्दी' : 'English',
          action: () => setShowLanguageModal(true),
        },
      ],
    },
    {
      section: 'Notifications',
      items: [
        {
          iconName: 'notifications-outline',
          label: 'Notifications',
          action: toggleNotifications,
          hasSwitch: true,
          switchValue: notificationsEnabled,
        },
        {
          iconName: 'alert-circle-outline',
          label: 'Critical alerts override silent mode',
          caption: 'Recommended for field roles — applies from the next app start',
          action: toggleCriticalOverride,
          hasSwitch: true,
          switchValue: criticalOverride,
        },
      ],
    },
    {
      section: 'Support',
      items: [
        { iconName: 'help-circle-outline', label: 'Help & FAQ', action: () => setShowHelpFAQ(true) },
        { iconName: 'chatbox-ellipses-outline', label: 'Send Feedback', action: () => setShowFeedback(true) },
        { iconName: 'document-text-outline', label: 'Terms of Service', action: () => setInfoDoc({ title: 'Terms of Service', body: TERMS_TEXT }) },
        { iconName: 'shield-checkmark-outline', label: 'Privacy Policy', action: () => setInfoDoc({ title: 'Privacy Policy', body: PRIVACY_TEXT }) },
      ],
    },
  ];

  const feedbackCategories = [
    { label: 'General', value: 'general' },
    { label: 'Bug Report', value: 'bug' },
    { label: 'Feature Request', value: 'feature' },
    { label: 'Improvement', value: 'improvement' },
  ];

  // Header ink — headerBg is a mode-appropriate SURFACE (paper in light, dark
  // surface in dark), so plain ink reads in BOTH modes. textInverse is illegal here.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  // One-Hand Action Bar for modals: 56dp primary at bottom, Cancel above as text link
  const ActionBar: React.FC<{
    label: string;
    onPress: () => void;
    onCancel: () => void;
    busy?: boolean;
    busyLabel?: string;
    destructive?: boolean;
  }> = ({ label, onPress, onCancel, busy, busyLabel, destructive }) => (
    <View style={styles.actionBar}>
      <TouchableOpacity
        onPress={onCancel}
        style={styles.cancelLink}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
      >
        <Text style={[styles.cancelLinkText, { color: isDark ? colors.primary : colors.primaryDark }]}>Cancel</Text>
      </TouchableOpacity>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.primaryBtn,
          {
            backgroundColor: destructive
              ? colors.danger
              : pressed
              ? colors.primaryDark
              : colors.primary,
          },
          busy && { opacity: 0.4 },
        ]}
      >
        <Text style={[styles.primaryBtnText, { color: destructive ? colors.textInverse : colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
          {busy ? busyLabel ?? label : label}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header — flat headerBg surface, avatar ring in role accent */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper needs the hairline in BOTH modes.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={[styles.avatar, { borderColor: accent, backgroundColor: colors.headerBg }]}>
          <Ionicons name={roleIcon} size={36} color={accent} />
        </View>
        <Text style={[styles.userName, { color: headerText }]} numberOfLines={1}>
          {profile.full_name || 'User'}
        </Text>
        <Text style={[styles.userLocation, { color: headerSub }]} numberOfLines={1}>
          {profile.district
            ? `${profile.district}${profile.state ? ', ' + profile.state : ''}`
            : profile.phone || 'No location set'}
        </Text>
        {/* Role chip — accent carries the border + glyph; the LABEL is plain ink.
            The accent ink tier is only ~2.8:1 on the dark header surface, so it
            may never be the text color here. */}
        <View style={[styles.rolePill, { borderColor: accent, backgroundColor: accent + ACCENT_TINT_ALPHA }]}>
          <Ionicons name={roleIcon} size={12} color={accent} />
          <Text style={[styles.rolePillText, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
            {roleLabel}
          </Text>
        </View>
      </View>
      {/* Role Ribbon */}
      <View style={[styles.roleRibbon, { backgroundColor: accent }]} />

      {/* Profile completeness — thin progress bar + caption; tapping opens
          the edit-profile modal. Hidden once the profile reaches 100%. */}
      {completeness.pct < 100 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {t('completeness.title')}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.completenessCard,
              {
                backgroundColor: pressed ? colors.cardHover : colors.card,
                borderColor: colors.border,
              },
              !isDark && styles.cardShadow,
            ]}
            onPress={() => setShowEditProfile(true)}
            accessibilityRole="button"
            accessibilityLabel={completenessCaption}
            accessibilityHint={t('completeness.a11yHint')}
          >
            {/* Thin token-colored progress bar — flex split avoids % widths */}
            <View style={[styles.completenessTrack, { backgroundColor: colors.surfaceVariant }]}>
              <View
                style={[
                  styles.completenessFill,
                  { flex: completeness.pct, backgroundColor: colors.primary },
                ]}
              />
              <View style={{ flex: 100 - completeness.pct }} />
            </View>
            <View style={styles.completenessCaptionRow}>
              <Text
                style={[styles.completenessCaption, { color: colors.textSecondary }]}
                maxFontSizeMultiplier={1.3}
              >
                {completenessCaption}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </View>
          </Pressable>
        </View>
      )}

      {/* Menu Sections — eyebrow headers, flat cards */}
      {menuItems.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {section.section}
          </Text>
          <View
            style={[
              styles.menuCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            {section.items.map((item, itemIndex) => (
              <Pressable
                key={itemIndex}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && { backgroundColor: colors.cardHover },
                  itemIndex < section.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
                ]}
                onPress={item.action}
                accessibilityRole={item.hasSwitch ? 'switch' : 'button'}
                accessibilityLabel={item.label}
                accessibilityState={item.hasSwitch ? { checked: item.switchValue } : undefined}
              >
                <View style={styles.menuItemLeft}>
                  <Ionicons name={item.iconName} size={22} color={colors.textSecondary} />
                  <View style={styles.menuTextWrap}>
                    <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
                    {item.caption ? (
                      <Text style={[styles.menuCaption, { color: colors.textTertiary }]}>
                        {item.caption}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {item.hasSwitch ? (
                  <Switch
                    value={item.switchValue}
                    onValueChange={item.action}
                    trackColor={{ false: colors.surfaceVariant, true: colors.primary }}
                    thumbColor={colors.card}
                    ios_backgroundColor={colors.surfaceVariant}
                  />
                ) : (
                  <View style={styles.menuItemRight}>
                    {item.valueLabel ? (
                      <Text style={[styles.menuValue, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                        {item.valueLabel}
                      </Text>
                    ) : null}
                    <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      {/* Sign Out Button — secondary style, danger outline */}
      <View style={styles.section}>
        <Pressable
          style={({ pressed }) => [
            styles.signOutButton,
            {
              backgroundColor: pressed ? colors.cardHover : colors.card,
              borderColor: colors.danger,
            },
          ]}
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={22} color={colors.danger} />
          <Text style={[styles.signOutText, { color: colors.danger }]}>Sign Out</Text>
        </Pressable>
      </View>

      {/* Danger Zone — irreversible account deletion */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.danger }]}>Danger Zone</Text>
        <View
          style={[
            styles.menuCard,
            { backgroundColor: colors.card, borderColor: colors.danger },
            !isDark && styles.cardShadow,
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.menuItem,
              pressed && { backgroundColor: colors.cardHover },
            ]}
            onPress={openDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
          >
            <View style={styles.menuItemLeft}>
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
              <View style={styles.menuTextWrap}>
                <Text style={[styles.menuLabel, { color: colors.danger, fontWeight: '700' }]}>
                  Delete my account
                </Text>
                <Text style={[styles.menuCaption, { color: colors.textTertiary }]}>
                  Permanent — reports you filed stay in the health record without your name
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.danger} />
          </Pressable>
        </View>
      </View>

      {/* App Info */}
      <View style={styles.appInfo}>
        <Text style={[styles.appName, { color: colors.textSecondary }]}>Health Drop Surveillance</Text>
        <Text style={[styles.appVersion, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
          Version 1.0.0
        </Text>
      </View>

      <View style={styles.bottomSpacer} />

      {/* ==================== MODALS ==================== */}

      {/* Edit Profile Modal */}
      <Modal visible={showEditProfile} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setShowEditProfile(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="person-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile</Text>
            </View>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Full Name</Text>
            <TextInput
              style={getInputStyle('full_name')}
              placeholder="Enter your full name"
              placeholderTextColor={colors.placeholder}
              value={editFormData.full_name}
              onChangeText={(text) => setEditFormData({ ...editFormData, full_name: text })}
              onFocus={() => setFocusedField('full_name')}
              onBlur={() => setFocusedField(null)}
            />

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Phone Number</Text>
            <TextInput
              style={getInputStyle('phone')}
              placeholder="Enter phone number"
              placeholderTextColor={colors.placeholder}
              value={editFormData.phone}
              onChangeText={(text) => setEditFormData({ ...editFormData, phone: text.replace(/[^0-9]/g, '') })}
              onFocus={() => setFocusedField('phone')}
              onBlur={() => setFocusedField(null)}
              keyboardType="phone-pad"
              maxLength={10}
            />

            <InlineError message={editError} />
            <ActionBar
              label="Save"
              busyLabel="Saving…"
              busy={loading}
              onPress={handleEditProfile}
              onCancel={() => { setShowEditProfile(false); setEditError(''); }}
            />
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={showChangePassword} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setShowChangePassword(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="lock-closed-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Change Password</Text>
            </View>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>New Password</Text>
            <TextInput
              style={getInputStyle('newPassword')}
              placeholder="Enter new password"
              placeholderTextColor={colors.placeholder}
              value={passwordData.newPassword}
              onChangeText={(text) => setPasswordData({ ...passwordData, newPassword: text })}
              onFocus={() => setFocusedField('newPassword')}
              onBlur={() => setFocusedField(null)}
              secureTextEntry
            />

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Confirm Password</Text>
            <TextInput
              style={getInputStyle('confirmPassword')}
              placeholder="Confirm new password"
              placeholderTextColor={colors.placeholder}
              value={passwordData.confirmPassword}
              onChangeText={(text) => setPasswordData({ ...passwordData, confirmPassword: text })}
              onFocus={() => setFocusedField('confirmPassword')}
              onBlur={() => setFocusedField(null)}
              secureTextEntry
            />

            <InlineError message={passwordError} />
            <ActionBar
              label="Change Password"
              busyLabel="Changing…"
              busy={loading}
              onPress={handleChangePassword}
              onCancel={() => {
                setShowChangePassword(false);
                setPasswordError('');
                setPasswordData({ newPassword: '', confirmPassword: '' });
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Update Location Modal */}
      <Modal visible={showUpdateLocation} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setShowUpdateLocation(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="location-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Update Location</Text>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* GPS fetch button */}
              <Pressable
                style={({ pressed }) => [
                  styles.gpsFetchBtn,
                  {
                    backgroundColor: pressed ? colors.cardHover : colors.primaryLight,
                    borderColor: colors.primary,
                  },
                ]}
                onPress={handleGPSFetch}
                disabled={gpsLoading}
                accessibilityRole="button"
                accessibilityLabel="Fetch GPS location"
              >
                {gpsLoading
                  ? <ActivityIndicator size={16} color={colors.primary} />
                  : <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                }
                <Text style={[styles.gpsFetchText, { color: isDark ? colors.primary : colors.primaryDark }]}>
                  {gpsLoading ? 'Detecting location…' : 'Fetch GPS Location'}
                </Text>
              </Pressable>

              {gpsMessage ? (
                <View style={styles.gpsMessageRow}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.gpsMessageText, { color: colors.textSecondary }]}>{gpsMessage}</Text>
                </View>
              ) : null}

              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Village / Town / Area</Text>
              <TextInput
                style={getInputStyle('village')}
                placeholder="e.g. Sector 12, Rajajipuram"
                placeholderTextColor={colors.placeholder}
                value={locationData.village}
                onChangeText={(t) => setLocationData({ ...locationData, village: t })}
                onFocus={() => setFocusedField('village')}
                onBlur={() => setFocusedField(null)}
              />

              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>District *</Text>
              <TextInput
                style={getInputStyle('district')}
                placeholder="e.g. Lucknow"
                placeholderTextColor={colors.placeholder}
                value={locationData.district}
                onChangeText={(t) => setLocationData({ ...locationData, district: t })}
                onFocus={() => setFocusedField('district')}
                onBlur={() => setFocusedField(null)}
              />

              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>State *</Text>
              <TextInput
                style={getInputStyle('state')}
                placeholder="e.g. Uttar Pradesh"
                placeholderTextColor={colors.placeholder}
                value={locationData.state}
                onChangeText={(t) => setLocationData({ ...locationData, state: t })}
                onFocus={() => setFocusedField('state')}
                onBlur={() => setFocusedField(null)}
              />

              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>PIN Code</Text>
              <TextInput
                style={getInputStyle('pincode')}
                placeholder="e.g. 226012"
                placeholderTextColor={colors.placeholder}
                value={locationData.pincode}
                onChangeText={(t) => setLocationData({ ...locationData, pincode: t.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('pincode')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
                maxLength={6}
              />
            </ScrollView>

            <InlineError message={locationError} />
            <ActionBar
              label="Update Location"
              busyLabel="Updating…"
              busy={loading}
              onPress={handleUpdateLocation}
              onCancel={() => { setShowUpdateLocation(false); setLocationError(''); setGpsMessage(''); }}
            />
          </View>
        </View>
      </Modal>

      {/* Language Picker Modal */}
      <Modal visible={showLanguageModal} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setShowLanguageModal(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="language-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Language / भाषा</Text>
            </View>

            {LANGUAGE_OPTIONS.map(option => {
              const active = language === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={({ pressed }) => [
                    styles.languageOption,
                    {
                      backgroundColor: pressed
                        ? colors.cardHover
                        : active
                        ? colors.primaryLight
                        : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleSelectLanguage(option.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${option.label} (${option.sub})`}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? (isDark ? colors.primary : colors.primaryDark) : colors.textTertiary}
                  />
                  <View style={styles.languageOptionTextWrap}>
                    <Text
                      style={[
                        styles.languageOptionLabel,
                        { color: active ? (isDark ? colors.primary : colors.primaryDark) : colors.text },
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={[styles.languageOptionSub, { color: colors.textTertiary }]}>
                      {option.sub}
                    </Text>
                  </View>
                  {active && (
                    <Ionicons name="checkmark" size={18} color={isDark ? colors.primary : colors.primaryDark} />
                  )}
                </Pressable>
              );
            })}

            {/* Honest partial-coverage note */}
            <View style={styles.gpsMessageRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.gpsMessageText, { color: colors.textSecondary }]}>
                हिन्दी अनुवाद जारी है — some screens remain English
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setShowLanguageModal(false)}
              style={[styles.cancelLink, { marginTop: spacing.md }]}
              accessibilityRole="button"
              accessibilityLabel="Close language picker"
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            >
              <Text style={[styles.cancelLinkText, { color: isDark ? colors.primary : colors.primaryDark }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Help & FAQ Modal */}
      <Modal visible={showHelpFAQ} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setShowHelpFAQ(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="help-circle-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Help & FAQ</Text>
            </View>

            <ScrollView style={styles.faqScroll} showsVerticalScrollIndicator={false}>
              {[
                { q: 'How do I report a disease outbreak?', a: 'Go to Reports tab → Select "Disease Report" → Fill in all required details → Submit' },
                { q: 'How do I create a health campaign?', a: 'Go to Reports tab → Select "Campaign" → Enter campaign details including dates, location and target audience' },
                { q: 'What is an ASHA worker?', a: 'Accredited Social Health Activists (ASHA) are community health workers who serve as a link between the healthcare system and rural communities.' },
                { q: 'How do I report water quality issues?', a: 'Go to Reports tab → Select "Water Quality" → Provide water source details and quality assessment' },
                { q: 'Who can see my reports?', a: 'Reports are visible to health administrators and relevant authorities in your region. Personal data is kept confidential.' },
              ].map((faq, i, arr) => (
                <View key={i} style={[styles.faqItem, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.faqQuestion, { color: colors.text }]}>{faq.q}</Text>
                  <Text style={[styles.faqAnswer, { color: colors.textSecondary }]}>{faq.a}</Text>
                </View>
              ))}
            </ScrollView>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary, marginTop: spacing.lg },
              ]}
              onPress={() => setShowHelpFAQ(false)}
              accessibilityRole="button"
              accessibilityLabel="Close help"
            >
              <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Terms / Privacy Info Modal */}
      <Modal visible={!!infoDoc} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setInfoDoc(null)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="document-text-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>{infoDoc?.title}</Text>
            </View>
            <ScrollView style={styles.faqScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.infoBody, { color: colors.textSecondary }]}>{infoDoc?.body}</Text>
            </ScrollView>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary, marginTop: spacing.lg },
              ]}
              onPress={() => setInfoDoc(null)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Send Feedback Modal */}
      <Modal visible={showFeedback} animationType={reduceMotion ? 'none' : 'slide'} transparent onRequestClose={() => setShowFeedback(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="chatbox-ellipses-outline" size={24} color={colors.textSecondary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Send Feedback</Text>
            </View>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>Help us improve the app!</Text>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Category</Text>
            <View style={styles.categoryGrid}>
              {feedbackCategories.map((cat) => {
                const active = feedbackCategory === cat.value;
                return (
                  <TouchableOpacity
                    key={cat.value}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setFeedbackCategory(cat.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={cat.label}
                  >
                    {active && <Ionicons name="checkmark" size={14} color={colors.onPrimary} />}
                    <Text style={[styles.categoryText, { color: active ? colors.onPrimary : colors.text }]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Your Feedback</Text>
            <TextInput
              style={[getInputStyle('feedback'), styles.feedbackInput]}
              placeholder="Tell us what you think, suggestions, or report issues..."
              placeholderTextColor={colors.placeholder}
              value={feedbackText}
              onChangeText={setFeedbackText}
              onFocus={() => setFocusedField('feedback')}
              onBlur={() => setFocusedField(null)}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />

            <InlineError message={feedbackError} />
            <ActionBar
              label="Submit Feedback"
              busyLabel="Sending…"
              busy={loading}
              onPress={handleSubmitFeedback}
              onCancel={() => {
                setShowFeedback(false);
                setFeedbackError('');
                setFeedbackText('');
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Sign Out Confirmation Modal */}
      <Modal
        visible={showSignOutModal}
        animationType={reduceMotion ? 'none' : 'fade'}
        transparent={true}
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => setShowSignOutModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center' }]}>
            <View style={[styles.signOutModalIcon, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="log-out-outline" size={32} color={colors.danger} />
            </View>
            <Text style={[styles.signOutModalTitle, { color: colors.text }]}>
              Sign Out?
            </Text>
            <Text style={[styles.signOutModalMessage, { color: colors.textSecondary }]}>
              Are you sure you want to sign out of your account? You'll need to sign in again to access your data.
            </Text>
            <View style={{ alignSelf: 'stretch' }}>
              <ActionBar
                label="Sign Out"
                busyLabel="Signing Out…"
                busy={signingOut}
                destructive
                onPress={confirmSignOut}
                onCancel={() => setShowSignOutModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Account Confirmation Modal — type DELETE to enable */}
      <Modal
        visible={showDeleteAccount}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent={true}
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => { if (!deleteBusy) setShowDeleteAccount(false); }}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="trash-outline" size={24} color={colors.danger} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Delete my account</Text>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* Plain statements of what happens — no euphemisms */}
              {[
                {
                  icon: 'document-text-outline' as const,
                  color: colors.textSecondary,
                  text: 'Reports you filed remain in the health record — without your name.',
                },
                {
                  icon: 'trash-outline' as const,
                  color: colors.danger,
                  text: 'Your sign-in, notifications and participation are permanently deleted.',
                },
                {
                  icon: 'warning-outline' as const,
                  color: colors.danger,
                  text: 'This cannot be undone.',
                },
              ].map((row, i) => (
                <View key={i} style={styles.deleteFactRow}>
                  <Ionicons name={row.icon} size={18} color={row.color} />
                  <Text style={[styles.deleteFactText, { color: colors.text }]}>{row.text}</Text>
                </View>
              ))}

              <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>
                Type DELETE to confirm
              </Text>
              <TextInput
                style={getInputStyle('deleteConfirm')}
                placeholder="DELETE"
                placeholderTextColor={colors.placeholder}
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                onFocus={() => setFocusedField('deleteConfirm')}
                onBlur={() => setFocusedField(null)}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Type DELETE to confirm account deletion"
              />

              <InlineError message={deleteError} />
            </ScrollView>

            {/* One-Hand Action Bar — confirm stays disabled until DELETE is typed */}
            <View style={styles.actionBar}>
              <TouchableOpacity
                onPress={() => { if (!deleteBusy) { setShowDeleteAccount(false); setDeleteError(''); } }}
                style={styles.cancelLink}
                accessibilityRole="button"
                accessibilityLabel="Cancel account deletion"
                hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
              >
                <Text style={[styles.cancelLinkText, { color: isDark ? colors.primary : colors.primaryDark }]}>Cancel</Text>
              </TouchableOpacity>
              <Pressable
                onPress={confirmDeleteAccount}
                disabled={deleteBusy || deleteConfirmText.trim() !== 'DELETE'}
                accessibilityRole="button"
                accessibilityLabel="Permanently delete my account"
                accessibilityState={{ disabled: deleteBusy || deleteConfirmText.trim() !== 'DELETE' }}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: colors.danger },
                  (deleteBusy || deleteConfirmText.trim() !== 'DELETE') && { opacity: 0.4 },
                ]}
              >
                <Text style={[styles.primaryBtnText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>
                  {deleteBusy ? 'Deleting…' : 'Delete my account'}
                </Text>
              </Pressable>
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
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  /* Header */
  header: {
    // No status-bar inset here — MainApp's SafeAreaView + shell header sit above.
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  roleRibbon: { height: 4, width: '100%' },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    marginBottom: spacing.md,
  },
  userName: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: spacing.xs,
  },
  userLocation: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  rolePillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  /* Sections */
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  menuCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /* Profile completeness — thin bar + caption */
  completenessCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
    minHeight: 48,
  },
  completenessTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  completenessFill: {
    borderRadius: radii.pill,
  },
  completenessCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  completenessCaption: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
    flex: 1,
  },
  menuTextWrap: {
    flexShrink: 1,
  },
  menuLabel: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  menuCaption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    marginTop: 2,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  menuValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1.5,
    gap: spacing.sm,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '700',
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  appName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  appVersion: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  bottomSpacer: {
    height: spacing.xl,
  },
  /* Modals */
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    maxHeight: '85%',
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  modalLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  modalInput: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
  inlineErrorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  /* One-Hand Action Bar */
  actionBar: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  cancelLink: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLinkText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  primaryBtn: {
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  feedbackInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  categoryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  faqScroll: {
    maxHeight: 320,
  },
  faqItem: {
    paddingVertical: spacing.lg,
  },
  faqQuestion: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  faqAnswer: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoBody: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  /* Delete-account modal */
  deleteFactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  deleteFactText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  /* Sign-out modal */
  signOutModalIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  signOutModalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  signOutModalMessage: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  /* Language picker */
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  languageOptionTextWrap: {
    flex: 1,
  },
  languageOptionLabel: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  languageOptionSub: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  /* GPS fetch */
  gpsFetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
  },
  gpsFetchText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  gpsMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  gpsMessageText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});

export default ProfileScreen;
