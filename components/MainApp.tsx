// =====================================================
// MAIN APP - Tab Navigation Container
// Role-aware dashboard + improved bottom tab bar
// Mobile UX: swipe-to-switch-tabs, glass tab bar
// =====================================================
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  PanResponder,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/ThemeContext';
import { Profile } from '../types';

// Screens
import ReportsScreen from './screens/ReportsScreen';
import CampaignsScreen from './screens/CampaignsScreen';
import ProfileScreen from './screens/ProfileScreen';
import AdminManagementScreen from './screens/AdminManagementScreen';
import UserManagementScreen from './screens/UserManagementScreen';
import ApprovalQueueScreen from './screens/ApprovalQueueScreen';
import AllAlertsScreen from './screens/AllAlertsScreen';

// Forms
import { DiseaseReportForm, WaterQualityReportForm, CampaignForm, AlertForm } from './forms';

// AI Chatbot
import { AIChatbot } from './ai/AIChatbot';

// Role-based Dashboard Router
import { DashboardRouter } from './dashboards/DashboardRouter';

const IS_MOBILE = Platform.OS !== 'web';

type TabType = 'home' | 'reports' | 'campaigns' | 'profile';
type CreateScreenType = 'new-disease-report' | 'new-water-report' | 'new-campaign' | 'new-alert';
type ScreenType = 'tabs' | CreateScreenType | 'admin-management' | 'user-management' | 'approval-queue' | 'all-alerts';

const TAB_ORDER: TabType[] = ['home', 'reports', 'campaigns', 'profile'];

const CREATE_PERMISSIONS: Record<CreateScreenType, Profile['role'][]> = {
  'new-disease-report': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
  'new-water-report': ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
  'new-campaign': ['super_admin', 'health_admin', 'district_officer', 'asha_worker'],
  'new-alert': ['super_admin', 'health_admin', 'district_officer'],
};

const CREATE_ACTIONS: Array<{
  screen: CreateScreenType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}> = [
  { screen: 'new-disease-report', label: 'Disease Report', icon: 'medkit', color: '#EF4444' },
  { screen: 'new-water-report', label: 'Water Quality', icon: 'water', color: '#3B82F6' },
  { screen: 'new-campaign', label: 'Campaign', icon: 'megaphone', color: '#10B981' },
  { screen: 'new-alert', label: 'Health Alert', icon: 'warning', color: '#F59E0B' },
];

const isCreateScreen = (value: string): value is CreateScreenType =>
  value in CREATE_PERMISSIONS;

const canCreateOnRole = (role: Profile['role'], screen: CreateScreenType): boolean =>
  CREATE_PERMISSIONS[screen].includes(role);

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
      if (isCreateScreen(formType) && !canCreateOnRole(profile.role, formType)) {
        Alert.alert(
          'Permission Denied',
          'Your role does not have permission to create this record type.'
        );
        return;
      }
      setCurrentScreen(formType as ScreenType);
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

  // ── Tab definitions ───────────────────────────────────────────
  const tabs: { id: TabType; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'home',      label: 'Home',      icon: 'home-outline',          activeIcon: 'home' },
    { id: 'reports',   label: 'Reports',   icon: 'document-text-outline', activeIcon: 'document-text' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone-outline',     activeIcon: 'megaphone' },
    { id: 'profile',   label: 'Profile',   icon: 'person-outline',        activeIcon: 'person' },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':      return <DashboardRouter profile={profile} onNavigate={navigateToForm} />;
      case 'reports':   return (
        <ReportsScreen
          profile={profile}
          onNavigateToForm={navigateToForm}
          focusReport={reportFocus}
          onFocusHandled={() => setReportFocus(null)}
        />
      );
      case 'campaigns': return <CampaignsScreen profile={profile} onNavigateToForm={navigateToForm} />;
      case 'profile':   return <ProfileScreen profile={profile} onSignOut={onSignOut} onProfileUpdate={onProfileUpdate} />;
      default:          return null;
    }
  };

  const tabBarStyle: any[] = [
    styles.tabBar,
    {
      backgroundColor: Platform.OS !== 'web'
        ? 'transparent' // BlurView handles the background on native
        : isDark ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.82)',
      borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      shadowColor: isDark ? '#000' : '#0F172A',
    },
    // Glass blur on web
    Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {},
  ];

  const renderTabItems = () => tabs.map((tab) => {
    const isActive = activeTab === tab.id;
    return (
      <TouchableOpacity
        key={tab.id}
        style={styles.tabItem}
        onPress={() => setActiveTab(tab.id)}
        activeOpacity={0.7}
      >
        {isActive && (
          <View style={[styles.activePill, { backgroundColor: colors.primary + '18' }]} />
        )}
        <Ionicons
          name={isActive ? tab.activeIcon : tab.icon}
          size={22}
          color={isActive ? colors.primary : colors.textSecondary}
        />
        <Text style={[styles.tabLabel, { color: isActive ? colors.primary : colors.textSecondary, fontWeight: isActive ? '700' : '400' }]}>
          {tab.label}
        </Text>
      </TouchableOpacity>
    );
  });

  const showUniversalAddFab =
    currentScreen === 'tabs' &&
    (activeTab === 'reports' || activeTab === 'campaigns') &&
    availableCreateActions.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Main Content — swipe gesture area (mobile only) */}
      <View style={styles.content} {...panResponder.panHandlers}>
        {renderTabContent()}
      </View>

      {showUniversalAddFab && (
        <>
          {showCreateMenu && (
            <TouchableOpacity
              style={styles.createMenuBackdrop}
              activeOpacity={1}
              onPress={() => setShowCreateMenu(false)}
            />
          )}

          {showCreateMenu && (
            <View style={[styles.createMenu, { backgroundColor: colors.card, borderColor: colors.border }]}> 
              {availableCreateActions.map((action) => (
                <TouchableOpacity
                  key={action.screen}
                  style={styles.createMenuItem}
                  onPress={() => {
                    setShowCreateMenu(false);
                    navigateToForm(action.screen);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.createMenuIcon, { backgroundColor: action.color + '1A' }]}>
                    <Ionicons name={action.icon} size={16} color={action.color} />
                  </View>
                  <Text style={[styles.createMenuLabel, { color: colors.text }]}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.createFab,
              isDark
                ? { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1 }
                : { backgroundColor: '#000000' },
              Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px)' } as any) : {},
            ]}
            onPress={() => setShowCreateMenu(prev => !prev)}
            activeOpacity={0.85}
          >
            <Ionicons name={showCreateMenu ? 'close' : 'add'} size={28} color={isDark ? '#E0E0F0' : '#FFFFFF'} />
          </TouchableOpacity>
        </>
      )}

      {/* ── Glass Bottom Tab Bar ─── */}
      {Platform.OS !== 'web' ? (
        <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={tabBarStyle}>
          {renderTabItems()}
        </BlurView>
      ) : (
        <View style={tabBarStyle}>
          {renderTabItems()}
        </View>
      )}

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
  createMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18,
  },
  createFab: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 96 : 88,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 10,
  },
  createMenu: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 164 : 156,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 6,
    minWidth: 188,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 9,
  },
  createMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  createMenuIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createMenuLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 6,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 3,
    position: 'relative',
  },
  activePill: {
    position: 'absolute',
    top: 0, bottom: 0, left: 6, right: 6,
    borderRadius: 12,
  },
  tabLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});

export default MainApp;
