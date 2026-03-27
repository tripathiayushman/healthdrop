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
  Platform,
  Dimensions,
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

const { width } = Dimensions.get('window');
const IS_MOBILE = Platform.OS !== 'web';

type TabType = 'home' | 'reports' | 'campaigns' | 'profile';
type ScreenType = 'tabs' | 'new-disease-report' | 'new-water-report' | 'new-campaign' | 'new-alert' | 'admin-management' | 'user-management' | 'approval-queue' | 'all-alerts';

const TAB_ORDER: TabType[] = ['home', 'reports', 'campaigns', 'profile'];

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

  // Hide status bar and Android navigation bar for immersive experience
  useEffect(() => {
    if (Platform.OS !== 'web') {
      StatusBar.setHidden(true, 'fade');
      if (Platform.OS === 'android') {
        StatusBar.setTranslucent(true);
        import('expo-navigation-bar').then(NavBar => {
          NavBar.setVisibilityAsync('hidden');
          NavBar.setBehaviorAsync('overlay-swipe');
        }).catch((error) => {
          console.error('Failed to configure Android navigation bar:', error);
        });
      }
    }

    return () => {
      if (Platform.OS !== 'web') {
        StatusBar.setHidden(false, 'fade');
        if (Platform.OS === 'android') {
          StatusBar.setTranslucent(false);
          import('expo-navigation-bar').then(NavBar => {
            NavBar.setVisibilityAsync('visible');
            NavBar.setBehaviorAsync('inset-swipe');
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

  const swipeX = useRef(0);
  const panResponder = useRef(
    IS_MOBILE
      ? PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onMoveShouldSetPanResponder: (_, gs) =>
            Math.abs(gs.dx) > 12 && Math.abs(gs.dy) < 40,
          onPanResponderGrant: (_, gs) => { swipeX.current = gs.dx; },
          onPanResponderMove: (_, gs) => { swipeX.current = gs.dx; },
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
    if (formType.startsWith('approval-queue:')) {
      const tab = formType.split(':')[1] as 'disease' | 'water' | 'campaigns' | 'alerts';
      setApprovalQueueInitialTab(tab);
      setCurrentScreen('approval-queue');
    } else {
      setCurrentScreen(formType as ScreenType);
    }
  };

  const goBackToTabs = () => setCurrentScreen('tabs');

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
      case 'reports':   return <ReportsScreen profile={profile} onNavigateToForm={navigateToForm} />;
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Main Content — swipe gesture area (mobile only) */}
      <View style={styles.content} {...panResponder.panHandlers}>
        {renderTabContent()}
      </View>

      {/* ── Glass Bottom Tab Bar ─── */}
      {Platform.OS !== 'web' ? (
        <BlurView intensity={80} tint={isDark ? 'dark' : 'light'} style={tabBarStyle}>
          {tabs.map((tab) => {
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
          })}
        </BlurView>
      ) : (
        <View style={tabBarStyle}>
          {tabs.map((tab) => {
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
          })}
        </View>
      )}

      {/* Swipe hint indicator — mobile only, shown briefly */}
      {IS_MOBILE && (
        <View style={styles.swipeIndicator} pointerEvents="none">
          {TAB_ORDER.map((t, i) => (
            <View
              key={t}
              style={[
                styles.swipeDot,
                { backgroundColor: activeTab === t ? colors.primary : colors.textSecondary + '40' }
              ]}
            />
          ))}
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
  // Swipe position dots — mobile only
  swipeIndicator: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 76 : 62,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  swipeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});

export default MainApp;
