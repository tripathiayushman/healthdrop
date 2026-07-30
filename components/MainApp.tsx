// =====================================================
// MAIN APP - Tab Navigation Container ("Prakash")
// Flat headerBg shell header + Role Ribbon + Sync Pebble,
// opaque bottom tab bar (outline icons at rest, filled
// active, labels always), swipe-to-switch-tabs.
// =====================================================
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  PanResponder,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../lib/ThemeContext';
import { Profile } from '../types';

// Screens
import ReportsScreen from './screens/ReportsScreen';
import CampaignsScreen from './screens/CampaignsScreen';
import ProfileScreen from './screens/ProfileScreen';
import MapTabScreen from './screens/MapTabScreen';
import AdminManagementScreen from './screens/AdminManagementScreen';
import UserManagementScreen from './screens/UserManagementScreen';
import ApprovalQueueScreen from './screens/ApprovalQueueScreen';
import AllAlertsScreen from './screens/AllAlertsScreen';
import CampaignIntelligenceScreen from './screens/CampaignIntelligenceScreen';
import HealthScoreScreen from './screens/HealthScoreScreen';
import EscalationMonitoringScreen from './screens/EscalationMonitoringScreen';
import WidgetCustomizationScreen from './screens/WidgetCustomizationScreen';
import SyncOutboxScreen from './screens/SyncOutboxScreen';
import MySubmissionsScreen from './screens/MySubmissionsScreen';

// Forms
import { DiseaseReportForm, WaterQualityReportForm, CampaignForm, AlertForm } from './forms';

// AI Chatbot
import { AIChatbot } from './ai/AIChatbot';

// Role-based Dashboard Router
import { DashboardRouter } from './dashboards/DashboardRouter';

// Shared shell pieces
import { SyncPebble, ROLE_ACCENT } from './dashboards/DashboardShared';

const IS_MOBILE = Platform.OS !== 'web';

type TabType = 'home' | 'map' | 'reports' | 'campaigns' | 'profile';
type CreateScreenType = 'new-disease-report' | 'new-water-report' | 'new-campaign' | 'new-alert';
type ScreenType =
  | 'tabs'
  | CreateScreenType
  | 'admin-management'
  | 'user-management'
  | 'approval-queue'
  | 'all-alerts'
  | 'campaign-intelligence'
  | 'health-score'
  | 'escalation-monitoring'
  | 'widget-customization'
  | 'sync-outbox'
  | 'my-submissions';
type RestrictedScreenType = Exclude<ScreenType, 'tabs' | CreateScreenType>;

const TAB_ORDER: TabType[] = ['home', 'map', 'reports', 'campaigns', 'profile'];

const CREATE_PERMISSIONS: Record<CreateScreenType, Profile['role'][]> = {
  'new-disease-report': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
  'new-water-report': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
  'new-campaign': ['super_admin', 'health_admin', 'district_officer', 'asha_worker'],
  'new-alert': ['super_admin', 'health_admin', 'district_officer'],
};

const ALL_ROLES: Profile['role'][] = ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'];

const SCREEN_PERMISSIONS: Record<RestrictedScreenType, Profile['role'][]> = {
  'admin-management': ['super_admin', 'health_admin', 'clinic'],
  'user-management': ['super_admin', 'health_admin'],
  'approval-queue': ['super_admin', 'health_admin', 'district_officer', 'clinic'],
  'all-alerts': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
  'campaign-intelligence': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
  'health-score': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
  'escalation-monitoring': ['super_admin', 'health_admin', 'district_officer', 'clinic'],
  'widget-customization': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
  'sync-outbox': ALL_ROLES,
  'my-submissions': ALL_ROLES,
};

const CREATE_ACTIONS: Array<{
  screen: CreateScreenType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { screen: 'new-disease-report', label: 'Disease Report', icon: 'medkit-outline' },
  { screen: 'new-water-report', label: 'Water Quality', icon: 'water-outline' },
  { screen: 'new-campaign', label: 'Campaign', icon: 'megaphone-outline' },
  { screen: 'new-alert', label: 'Health Alert', icon: 'warning-outline' },
];

const isCreateScreen = (value: string): value is CreateScreenType =>
  value in CREATE_PERMISSIONS;

const isScreenType = (value: string): value is ScreenType =>
  [
    'tabs',
    'new-disease-report',
    'new-water-report',
    'new-campaign',
    'new-alert',
    'admin-management',
    'user-management',
    'approval-queue',
    'all-alerts',
    'campaign-intelligence',
    'health-score',
    'escalation-monitoring',
    'widget-customization',
    'sync-outbox',
    'my-submissions',
  ].includes(value);

const canCreateOnRole = (role: Profile['role'], screen: CreateScreenType): boolean =>
  CREATE_PERMISSIONS[screen].includes(role);

const canAccessScreen = (role: Profile['role'], screen: RestrictedScreenType): boolean =>
  SCREEN_PERMISSIONS[screen].includes(role);

interface MainAppProps {
  profile: Profile;
  onSignOut: () => void;
  onProfileUpdate: (profile: Profile) => void;
}

const MainApp: React.FC<MainAppProps> = ({ profile, onSignOut, onProfileUpdate }) => {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('tabs');
  const [approvalQueueInitialTab, setApprovalQueueInitialTab] = useState<'disease' | 'water' | 'campaigns' | 'alerts'>('disease');
  const [reportFocus, setReportFocus] = useState<{ type: 'disease' | 'water'; id: string } | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  const availableCreateActions = CREATE_ACTIONS.filter(action =>
    canCreateOnRole(profile.role, action.screen)
  );

  // Semantic tint per create action — token-driven, no hex literals.
  const createActionColor: Record<CreateScreenType, string> = {
    'new-disease-report': colors.danger,
    'new-water-report': colors.info,
    'new-campaign': colors.success,
    'new-alert': colors.warning,
  };

  useEffect(() => {
    setShowCreateMenu(false);
  }, [activeTab, currentScreen]);

  // Hide status bar and Android navigation bar for immersive experience
  useEffect(() => {
    if (Platform.OS !== 'web') {
      StatusBar.setHidden(true, 'fade');
      StatusBar.setTranslucent(true);
      if (Platform.OS === 'android') {
        import('expo-navigation-bar').then(NavBar => {
          NavBar.setVisibilityAsync('hidden');
        }).catch((error) => {
          console.error('Failed to configure Android navigation bar:', error);
        });
      }
    }

    return () => {
      if (Platform.OS !== 'web') {
        StatusBar.setHidden(false, 'fade');
        StatusBar.setTranslucent(false);
        if (Platform.OS === 'android') {
          import('expo-navigation-bar').then(NavBar => {
            NavBar.setVisibilityAsync('visible');
          }).catch((error) => {
            console.error('Failed to restore Android navigation bar:', error);
          });
        }
      }
    };
  }, []);

  // Swipe gesture — mobile only
  // Use a ref for activeTab so PanResponder always reads the latest value
  const activeTabRef = useRef<TabType>(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const panResponder = useRef(
    IS_MOBILE
      ? PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: (_, gs) =>
            Math.abs(gs.dx) > 12 && Math.abs(gs.dy) < 40,
          onPanResponderRelease: (_, gs) => {
            const dx = gs.dx;
            if (Math.abs(dx) < 50) return; // threshold
            const idx = TAB_ORDER.indexOf(activeTabRef.current);
            if (dx < -50 && idx < TAB_ORDER.length - 1) {
              setActiveTab(TAB_ORDER[idx + 1]); // swipe left → next tab
            } else if (dx > 50 && idx > 0) {
              setActiveTab(TAB_ORDER[idx - 1]); // swipe right → prev tab
            }
          },
        })
      : { panHandlers: {} }
  ).current;

  const navigateToForm = (formType: string) => {
    if (formType.startsWith('open-report:')) {
      const [, reportType, reportId] = formType.split(':');
      if ((reportType === 'disease' || reportType === 'water') && reportId) {
        setReportFocus({ type: reportType, id: reportId });
        setCurrentScreen('tabs');
        setActiveTab('reports');
      }
      return;
    }

    if (formType.startsWith('approval-queue:')) {
      if (!canAccessScreen(profile.role, 'approval-queue')) {
        Alert.alert(
          'Permission Denied',
          'Your role does not have permission to access the approval queue.'
        );
        return;
      }

      const tab = formType.split(':')[1];
      const isApprovalQueueTab = (value: string): value is 'disease' | 'water' | 'campaigns' | 'alerts' =>
        ['disease', 'water', 'campaigns', 'alerts'].includes(value);

      if (!isApprovalQueueTab(tab)) {
        console.error('Invalid approval queue tab received:', tab);
        setApprovalQueueInitialTab('disease');
      } else {
        setApprovalQueueInitialTab(tab);
      }
      setCurrentScreen('approval-queue');
    } else {
      if (!isScreenType(formType)) {
        console.error('Invalid navigation target received:', formType);
        return;
      }

      if (isCreateScreen(formType) && !canCreateOnRole(profile.role, formType)) {
        Alert.alert(
          'Permission Denied',
          'Your role does not have permission to create this record type.'
        );
        return;
      }

      if (formType !== 'tabs' && !isCreateScreen(formType) && !canAccessScreen(profile.role, formType)) {
        Alert.alert(
          'Permission Denied',
          'Your role does not have permission to open this screen.'
        );
        return;
      }

      setCurrentScreen(formType);
    }
  };

  const goBackToTabs = () => {
    setShowCreateMenu(false);
    setCurrentScreen('tabs');
  };

  // ── Form / sub-screens ────────────────────────────────────────
  if (currentScreen === 'new-disease-report') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <DiseaseReportForm onSuccess={goBackToTabs} onCancel={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'new-water-report') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <WaterQualityReportForm onSuccess={goBackToTabs} onCancel={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'new-campaign') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <CampaignForm onSuccess={goBackToTabs} onCancel={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'new-alert') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <AlertForm onSuccess={goBackToTabs} onCancel={goBackToTabs} profile={profile} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'admin-management') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <AdminManagementScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'user-management') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <UserManagementScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'approval-queue') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ApprovalQueueScreen profile={profile} onBack={goBackToTabs} initialTab={approvalQueueInitialTab} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'all-alerts') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <AllAlertsScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'campaign-intelligence') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <CampaignIntelligenceScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'health-score') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <HealthScoreScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'escalation-monitoring') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <EscalationMonitoringScreen
          profile={profile}
          onBack={goBackToTabs}
          onOpenQueue={(tab) => navigateToForm(`approval-queue:${tab}`)}
        />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'widget-customization') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <WidgetCustomizationScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'sync-outbox') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <SyncOutboxScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }
  if (currentScreen === 'my-submissions') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <MySubmissionsScreen profile={profile} onBack={goBackToTabs} />
      </SafeAreaView>
    );
  }

  // ── Tab definitions ───────────────────────────────────────────
  const tabs: { id: TabType; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'home',      label: 'Home',      icon: 'home-outline',          activeIcon: 'home' },
    { id: 'map',       label: 'Map',       icon: 'map-outline',           activeIcon: 'map' },
    { id: 'reports',   label: 'Reports',   icon: 'document-text-outline', activeIcon: 'document-text' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone-outline',     activeIcon: 'megaphone' },
    { id: 'profile',   label: 'Profile',   icon: 'person-outline',        activeIcon: 'person' },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':      return <DashboardRouter profile={profile} onNavigate={navigateToForm} />;
      case 'map':       return <MapTabScreen profile={profile} onNavigateToForm={navigateToForm} />;
      case 'reports':   return (
        <ReportsScreen
          profile={profile}
          onNavigateToForm={navigateToForm}
          focusReport={reportFocus}
          onFocusHandled={() => setReportFocus(null)}
        />
      );
      case 'campaigns': return <CampaignsScreen profile={profile} onNavigateToForm={navigateToForm} />;
      case 'profile':
        return (
          <ProfileScreen
            profile={profile}
            onSignOut={onSignOut}
            onProfileUpdate={onProfileUpdate}
            onNavigateToForm={navigateToForm}
          />
        );
      default:          return null;
    }
  };

  const renderTabItems = () => tabs.map((tab) => {
    const isActive = activeTab === tab.id;
    return (
      <Pressable
        key={tab.id}
        style={({ pressed }) => [
          styles.tabItem,
          pressed && { backgroundColor: colors.surfaceVariant },
        ]}
        onPress={() => setActiveTab(tab.id)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={tab.label}
      >
        <Ionicons
          name={isActive ? tab.activeIcon : tab.icon}
          size={24}
          color={isActive ? colors.primary : colors.textSecondary}
        />
        <Text
          style={[
            styles.tabLabel,
            { color: isActive ? colors.primary : colors.textSecondary, fontWeight: isActive ? '700' : '600' },
          ]}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  });

  const showUniversalAddFab =
    currentScreen === 'tabs' &&
    (activeTab === 'reports' || activeTab === 'campaigns') &&
    availableCreateActions.length > 0;

  // The home dashboards render their own full DashboardHeader
  // (greeting band + Role Ribbon), so the shell ribbon and dark-mode
  // divider only appear on tabs without one — a single ribbon per screen.
  const showShellRibbon = activeTab !== 'home';
  const headerText = isDark ? colors.text : colors.textInverse;
  const roleAccent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  // Shell-level quick access: My Submissions beside the report lists,
  // Sync Outbox in the profile section.
  const quickAccess =
    activeTab === 'reports'
      ? { screen: 'my-submissions', icon: 'albums-outline' as keyof typeof Ionicons.glyphMap, label: 'My Submissions' }
      : activeTab === 'profile'
        ? { screen: 'sync-outbox', icon: 'cloud-upload-outline' as keyof typeof Ionicons.glyphMap, label: 'Sync Outbox' }
        : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Shell header — flat headerBg band + Sync Pebble ── */}
      <View
        style={[
          styles.shellHeader,
          { backgroundColor: colors.headerBg },
          isDark && showShellRibbon && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.brandText, { color: headerText }]} maxFontSizeMultiplier={1.3}>
          HealthDrop
        </Text>
        <Pressable
          onPress={() => navigateToForm('sync-outbox')}
          accessibilityRole="button"
          accessibilityLabel="Open sync outbox"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <SyncPebble />
        </Pressable>
      </View>
      {showShellRibbon && (
        <View style={[styles.roleRibbon, { backgroundColor: roleAccent }]} />
      )}

      {/* ── Quick access row (shell-level) ── */}
      {quickAccess && (
        <Pressable
          style={({ pressed }) => [
            styles.quickLink,
            {
              backgroundColor: pressed ? colors.cardHover : colors.card,
              borderBottomColor: colors.border,
            },
          ]}
          onPress={() => navigateToForm(quickAccess.screen)}
          accessibilityRole="button"
          accessibilityLabel={quickAccess.label}
        >
          <Ionicons name={quickAccess.icon} size={20} color={colors.textSecondary} />
          <Text style={[styles.quickLinkLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {quickAccess.label}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </Pressable>
      )}

      {/* Main Content — swipe gesture area (mobile only) */}
      <View style={styles.content} {...panResponder.panHandlers}>
        {renderTabContent()}
      </View>

      {showUniversalAddFab && (
        <>
          {showCreateMenu && (
            <Pressable
              style={styles.createMenuBackdrop}
              onPress={() => setShowCreateMenu(false)}
              accessibilityRole="button"
              accessibilityLabel="Close create menu"
            />
          )}

          {showCreateMenu && (
            <View style={[styles.createMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {availableCreateActions.map((action) => {
                const tint = createActionColor[action.screen];
                return (
                  <Pressable
                    key={action.screen}
                    style={({ pressed }) => [
                      styles.createMenuItem,
                      pressed && { backgroundColor: colors.cardHover },
                    ]}
                    onPress={() => {
                      setShowCreateMenu(false);
                      navigateToForm(action.screen);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Create ${action.label}`}
                  >
                    <View style={[styles.createMenuIcon, { backgroundColor: tint + '14' }]}>
                      <Ionicons name={action.icon} size={18} color={tint} />
                    </View>
                    <Text style={[styles.createMenuLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Extended create button — labeled, never icon-only */}
          <Pressable
            style={({ pressed }) => [
              styles.createFab,
              {
                backgroundColor: pressed ? colors.primaryDark : colors.primary,
                shadowColor: colors.shadow,
              },
            ]}
            onPress={() => setShowCreateMenu(prev => !prev)}
            accessibilityRole="button"
            accessibilityLabel={showCreateMenu ? 'Close create menu' : 'Create new record'}
            accessibilityState={{ expanded: showCreateMenu }}
          >
            <Ionicons name={showCreateMenu ? 'close' : 'add'} size={24} color={colors.onPrimary} />
            <Text style={[styles.createFabLabel, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
              Create
            </Text>
          </Pressable>
        </>
      )}

      {/* ── Opaque Bottom Tab Bar — border-first, no glass ── */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {renderTabItems()}
      </View>

      {/* AI Chatbot — persistent across all tabs except Profile */}
      <AIChatbot profile={profile} activeTab={activeTab} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 0,
  },
  content: { flex: 1 },

  /* ── Shell header ── */
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  brandText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  roleRibbon: { height: 4, width: '100%' },

  /* ── Quick access row ── */
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  quickLinkLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },

  /* ── Create menu ── */
  createMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18,
  },
  createFab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: Platform.OS === 'ios' ? 96 : 88,
    height: 56,
    minWidth: 56,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    zIndex: 20,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  createFabLabel: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  createMenu: {
    position: 'absolute',
    right: spacing.lg,
    bottom: Platform.OS === 'ios' ? 164 : 156,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    minWidth: 220,
    zIndex: 20,
    overflow: 'hidden',
  },
  createMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  createMenuIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createMenuLabel: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },

  /* ── Tab bar ── */
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: spacing.xs,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: spacing.xs,
    gap: 2,
    borderRadius: radii.sm,
  },
  tabLabel: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
});

export default MainApp;
