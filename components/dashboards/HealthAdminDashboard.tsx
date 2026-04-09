// =====================================================
// HEALTH ADMIN DASHBOARD — Polished
// Priority: Stats → Approval Queue → Active Alerts → Quick Actions → AI Insights
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

export const HealthAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      const [d, w, c, a, pendingDisease, pendingWater] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
      ]);
      const alertData = await supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(3);
      const pendingReportsCount =
        (pendingDisease.status === 'fulfilled' ? pendingDisease.value.count ?? 0 : 0) +
        (pendingWater.status === 'fulfilled' ? pendingWater.value.count ?? 0 : 0);

      setStats({
        disease: d.status === 'fulfilled' ? d.value.count ?? 0 : 0,
        water:   w.status === 'fulfilled' ? w.value.count ?? 0 : 0,
        campaigns: c.status === 'fulfilled' ? c.value.count ?? 0 : 0,
        alerts:  a.status === 'fulfilled' ? a.value.count ?? 0 : 0,
        pendingReports: pendingReportsCount,
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

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title="Health Overview" style={{ marginTop: 16 }}>
            <View style={styles.statsRow}>
              <StatCard label="Disease Reports" value={stats.disease} icon="bar-chart" color="#EF4444" />
              <StatCard label="Water Reports" value={stats.water} icon="water" color="#3B82F6" />
              <StatCard label="Active Alerts" value={stats.alerts} icon="warning" color="#F59E0B" />
            </View>
            <View style={[styles.statsRow, { marginTop: 8 }]}>
              <StatCard label="Campaigns" value={stats.campaigns} icon="megaphone" color="#10B981" />
              <StatCard label="Pending Approvals" value={stats.pendingReports} icon="time" color="#8B5CF6" />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('approval_tools') && (
        <>
          <Section title="Approval Queue">
            <ToolCard icon="checkmark-circle" iconColor="#26A69A" title="Reports Pending Review" subtitle={`${stats.pendingReports} ASHA/clinic reports awaiting approval`} onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
            <ToolCard icon="megaphone" iconColor="#10B981" title="Campaign Approvals" subtitle="Review & publish pending health campaigns" onPress={() => onNavigate('approval-queue:campaigns')} />
            <ToolCard icon="warning" iconColor="#F59E0B" title="Alert Management" subtitle="Approve, publish & manage health alerts" onPress={() => onNavigate('approval-queue:alerts')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('alerts_map') && (
        <>
          <MapAndAlertsSection
            profile={profile}
            alerts={alerts}
            onOpenReport={(type, id) => onNavigate(`open-report:${type}:${id}`)}
            onViewAllAlerts={() => onNavigate('all-alerts')}
            alertSectionTitle="Active Alerts"
            emptyTitle="No Active Alerts"
            emptySubtitle="No alerts are currently active in the system."
          />
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('quick_actions') && (
        <>
          <Section title="Quick Actions">
            <View style={styles.qaRow}>
              <QuickActionBtn icon="virus" iconFamily="material" label="Report Disease" color="#EF4444" onPress={() => onNavigate('new-disease-report')} />
              <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
              <QuickActionBtn icon="megaphone" label="Campaign" color="#10B981" onPress={() => onNavigate('new-campaign')} />
              <QuickActionBtn icon="warning" label="Alert" color="#F59E0B" onPress={() => onNavigate('new-alert')} />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse" iconColor="#0EA5E9" title="District Health Score" subtitle="Track health score and district risk ranking" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics" iconColor="#F59E0B" title="Campaign Intelligence" subtitle="Measure campaign impact and optimize outreach" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network" iconColor="#EF4444" title="Escalation Monitoring" subtitle="Identify pending approvals that need intervention" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="options" iconColor="#8B5CF6" title="Customize Widgets" subtitle="Select dashboard modules visible on your home view" onPress={() => onNavigate('widget-customization')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('ai_insights') && <AIInsightsPanel profile={profile} />}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8 },
  qaRow: { flexDirection: 'row', gap: 8 },
});

export default HealthAdminDashboard;
