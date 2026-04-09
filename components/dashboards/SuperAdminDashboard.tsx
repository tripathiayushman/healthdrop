// =====================================================
// SUPER ADMIN DASHBOARD — Polished
// Priority: Admin Panel → System Stats → Quick Actions → AI Insights → Alerts
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl, Alert as RNAlert } from 'react-native';

import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  AlertCard, ToolCard, EmptyState, SectionDivider,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const SuperAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, users: 0, pendingFeedback: 0, pendingApprovals: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      const [d, w, c, a, u, f, pendingDisease, pendingWater, pendingCampaigns, pendingAlerts] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('user_feedback').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
      ]);
      const alertData = await supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(3);
      const pendingApprovalsCount =
        (pendingDisease.status === 'fulfilled' ? pendingDisease.value.count ?? 0 : 0) +
        (pendingWater.status === 'fulfilled' ? pendingWater.value.count ?? 0 : 0) +
        (pendingCampaigns.status === 'fulfilled' ? pendingCampaigns.value.count ?? 0 : 0) +
        (pendingAlerts.status === 'fulfilled' ? pendingAlerts.value.count ?? 0 : 0);

      setStats({
        disease: d.status === 'fulfilled' ? d.value.count ?? 0 : 0,
        water:   w.status === 'fulfilled' ? w.value.count ?? 0 : 0,
        campaigns: c.status === 'fulfilled' ? c.value.count ?? 0 : 0,
        alerts:  a.status === 'fulfilled' ? a.value.count ?? 0 : 0,
        users:   u.status === 'fulfilled' ? u.value.count ?? 0 : 0,
        pendingFeedback: f.status === 'fulfilled' ? f.value.count ?? 0 : 0,
        pendingApprovals: pendingApprovalsCount,
      });
      if (alertData.data) setAlerts(alertData.data);
    } catch {}
  };

  useEffect(() => { load(); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      <DashboardHeader profile={profile} />

      {isWidgetVisible('admin_panel') && (
        <>
          <Section title="Admin Panel" style={{ marginTop: 16 }}>
            <ToolCard icon="people" iconColor="#42A5F5" title="User Management" subtitle="Create, edit, deactivate users & manage roles" onPress={() => onNavigate('user-management')} />
            <ToolCard icon="shield-checkmark" iconColor="#A78BFA" title="Approval Queue" subtitle="Review pending reports & campaigns" onPress={() => onNavigate('approval-queue')} badge={stats.pendingApprovals} />
            {stats.pendingFeedback > 0 && (
              <ToolCard icon="chatbox-ellipses" iconColor="#FB923C" title="User Feedback" subtitle="Pending feedback awaiting review" onPress={() => onNavigate('approval-queue')} badge={stats.pendingFeedback} />
            )}
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title="System Overview">
            <View style={styles.statsRow}>
              <StatCard label="Active Users" value={stats.users} icon="people" color="#42A5F5" />
              <StatCard label="Disease Reports" value={stats.disease} icon="bar-chart" color="#EF4444" />
              <StatCard label="Active Alerts" value={stats.alerts} icon="warning" color="#F59E0B" />
            </View>
            <View style={[styles.statsRow, { marginTop: 8 }]}>
              <StatCard label="Water Reports" value={stats.water} icon="water" color="#3B82F6" />
              <StatCard label="Campaigns" value={stats.campaigns} icon="megaphone" color="#10B981" />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('quick_actions') && (
        <>
          <Section title="Quick Actions">
            <View style={styles.qaRow}>
              <QuickActionBtn icon="virus" iconFamily="material" label="Report Disease" color="#EF4444" onPress={() => onNavigate('new-disease-report')} />
              <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
              <QuickActionBtn icon="megaphone" label="New Campaign" color="#10B981" onPress={() => onNavigate('new-campaign')} />
              <QuickActionBtn icon="warning" label="Send Alert" color="#F59E0B" onPress={() => onNavigate('new-alert')} />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse" iconColor="#0EA5E9" title="District Health Score" subtitle="Monitor district risk ranking and response health" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics" iconColor="#F59E0B" title="Campaign Intelligence" subtitle="Track campaign impact, performance, and AI recommendations" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network" iconColor="#EF4444" title="Escalation Monitoring" subtitle="Watch pending approvals crossing escalation thresholds" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="options" iconColor="#8B5CF6" title="Customize Widgets" subtitle="Control which dashboard widgets are visible" onPress={() => onNavigate('widget-customization')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('ai_insights') && (
        <>
          <AIInsightsPanel profile={profile} />
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('alerts_map') && (
        <MapAndAlertsSection
          profile={profile}
          alerts={alerts}
          onOpenReport={(type, id) => onNavigate(`open-report:${type}:${id}`)}
          onViewAllAlerts={() => onNavigate('all-alerts')}
          alertSectionTitle="Active Alerts"
          emptyTitle="No Active Alerts"
          emptySubtitle="All systems are clear. No health alerts at this time."
        />
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8 },
  qaRow: { flexDirection: 'row', gap: 8 },
});

export default SuperAdminDashboard;
