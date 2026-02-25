// =====================================================
// MAIN APP - Tab Navigation Container
// Role-aware dashboard + improved bottom tab bar
// =====================================================
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Dimensions,
} from 'react-native';
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

type TabType = 'home' | 'reports' | 'campaigns' | 'profile';
type ScreenType = 'tabs' | 'new-disease-report' | 'new-water-report' | 'new-campaign' | 'new-alert' | 'admin-management' | 'user-management' | 'approval-queue' | 'all-alerts';


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

  const navigateToForm = (formType: string) => {
    // Support 'approval-queue:disease', 'approval-queue:campaigns', 'approval-queue:alerts', etc.
    if (formType.startsWith('approval-queue:')) {
      const tab = formType.split(':')[1] as 'disease' | 'water' | 'campaigns' | 'alerts';
      setApprovalQueueInitialTab(tab);
      setCurrentScreen('approval-queue');
    } else {
      setCurrentScreen(formType as ScreenType);
    }
  };

  const goBackToTabs = () => {
    setCurrentScreen('tabs');
  };

  // ── Form screens ────────────────────────────────────
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

  // ── Tab definitions ─────────────────────────────────
  const tabs: { id: TabType; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
    { id: 'home',      label: 'Home',      icon: 'home-outline',          activeIcon: 'home' },
    { id: 'reports',   label: 'Reports',   icon: 'document-text-outline', activeIcon: 'document-text' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone-outline',     activeIcon: 'megaphone' },
    { id: 'profile',   label: 'Profile',   icon: 'person-outline',        activeIcon: 'person' },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return <DashboardRouter profile={profile} onNavigate={navigateToForm} />;
      case 'reports':
        return <ReportsScreen profile={profile} onNavigateToForm={navigateToForm} />;
      case 'campaigns':
        return <CampaignsScreen profile={profile} onNavigateToForm={navigateToForm} />;
      case 'profile':
        return <ProfileScreen profile={profile} onSignOut={onSignOut} onProfileUpdate={onProfileUpdate} />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Main Content */}
      <View style={styles.content}>
        {renderTabContent()}
      </View>

      {/* ── Improved Bottom Tab Bar ───────────────────── */}
      <View style={[styles.tabBar, {
        backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
        borderTopColor: isDark ? '#334155' : '#E2E8F0',
        shadowColor: isDark ? '#000' : '#0F172A',
      }]}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabItem}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              {/* Active pill background */}
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

      {/* AI Chatbot — persistent across all tabs except Profile */}
      <AIChatbot profile={profile} activeTab={activeTab} />

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 25 : 0,
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
});

export default MainApp;
