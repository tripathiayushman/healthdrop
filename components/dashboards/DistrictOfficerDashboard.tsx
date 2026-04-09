// =====================================================
// DISTRICT OFFICER DASHBOARD — Polished
// Priority: District Stats → District Alerts → Quick Actions → District Tools → AI Insights
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl, Alert as RNAlert } from 'react-native';

import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  AlertCard, ToolCard, EmptyState, InfoBanner, SectionDivider,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const DistrictOfficerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ districtReports: 0, districtWater: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      let dQ = supabase.from('disease_reports').select('id', { count: 'exact', head: true });
      let wQ = supabase.from('water_quality_reports').select('id', { count: 'exact', head: true });
      let pDiseaseQ = supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval');
      let pWaterQ = supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval');
      if (profile.district) {
        dQ = dQ.eq('district', profile.district);
        wQ = wQ.eq('district', profile.district);
        pDiseaseQ = pDiseaseQ.eq('district', profile.district);
        pWaterQ = pWaterQ.eq('district', profile.district);
      }
      const [d, w, pendingDisease, pendingWater, campaigns] = await Promise.allSettled([
        dQ, wQ, pDiseaseQ, pWaterQ,
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      const alertData = await supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(120);
      const visibleAlerts = filterAlertsForProfile(alertData.data ?? [], profile);
      const pendingReportsCount =
        (pendingDisease.status === 'fulfilled' ? pendingDisease.value.count ?? 0 : 0) +
        (pendingWater.status === 'fulfilled' ? pendingWater.value.count ?? 0 : 0);

      setStats({
        districtReports: d.status === 'fulfilled' ? d.value.count ?? 0 : 0,
        districtWater:   w.status === 'fulfilled' ? w.value.count ?? 0 : 0,
        alerts:          visibleAlerts.length,
        pendingReports:  pendingReportsCount,
        campaigns:       campaigns.status === 'fulfilled' ? campaigns.value.count ?? 0 : 0,
      });
      setAlerts(visibleAlerts.slice(0, 4));
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

      {stats.pendingReports > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <InfoBanner icon="alert-circle-outline" color="#F59E0B" text={`${stats.pendingReports} district report${stats.pendingReports > 1 ? 's are' : ' is'} awaiting approval`} />
        </View>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title={`${profile.district ?? 'District'} Overview`} style={{ marginTop: stats.pendingReports > 0 ? 4 : 16 }}>
            <View style={styles.statsRow}>
              <StatCard label="Disease Reports" value={stats.districtReports} icon="bar-chart" color="#EF4444" />
              <StatCard label="Water Reports" value={stats.districtWater} icon="water" color="#3B82F6" />
              <StatCard label="Active Alerts" value={stats.alerts} icon="warning" color="#F59E0B" />
            </View>
            <View style={[styles.statsRow, { marginTop: 8 }]}>
              <StatCard label="Active Campaigns" value={stats.campaigns} icon="megaphone" color="#10B981" />
              <StatCard label="Pending Approval" value={stats.pendingReports} icon="time" color="#8B5CF6" />
            </View>
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
            alertSectionTitle={`${profile.district ?? 'District'} Alerts`}
            emptyTitle={`${profile.district ?? 'District'} is Clear`}
            emptySubtitle="No active health alerts in your district."
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

      {isWidgetVisible('district_tools') && (
        <>
          <Section title="District Tools">
            <ToolCard icon="document-text" iconColor="#4338CA" title="Disease Reports" subtitle="Review, verify & approve disease reports in your district" onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
            <ToolCard icon="water" iconColor="#0891B2" title="Water Quality Reports" subtitle="Review, verify & approve water quality reports in your district" onPress={() => onNavigate('approval-queue:water')} />
            <ToolCard icon="megaphone" iconColor="#10B981" title="Campaign Management" subtitle="Approve, reject & manage health campaigns in your district" onPress={() => onNavigate('approval-queue:campaigns')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse" iconColor="#0EA5E9" title="District Health Score" subtitle="See your district risk score and response trends" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics" iconColor="#F59E0B" title="Campaign Intelligence" subtitle="Review campaign performance and AI recommendations" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network" iconColor="#EF4444" title="Escalation Monitoring" subtitle="Track district approvals nearing SLA breach" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="options" iconColor="#8B5CF6" title="Customize Widgets" subtitle="Control visibility of dashboard sections" onPress={() => onNavigate('widget-customization')} />
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

export default DistrictOfficerDashboard;
