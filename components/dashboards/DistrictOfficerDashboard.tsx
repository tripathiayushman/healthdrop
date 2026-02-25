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

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const DistrictOfficerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ districtReports: 0, districtWater: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      let dQ = supabase.from('disease_reports').select('id', { count: 'exact', head: true });
      let wQ = supabase.from('water_quality_reports').select('id', { count: 'exact', head: true });
      let aQ = supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active');
      let pQ = supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval');
      if (profile.district) {
        dQ = dQ.eq('district', profile.district);
        wQ = wQ.eq('district', profile.district);
        aQ = aQ.eq('district', profile.district);
        pQ = pQ.eq('district', profile.district);
      }
      const [d, w, a, pending, campaigns] = await Promise.allSettled([
        dQ, wQ, aQ, pQ,
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      let alertListQ = supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(4);
      if (profile.district) alertListQ = alertListQ.eq('district', profile.district);
      const alertData = await alertListQ;
      setStats({
        districtReports: d.status === 'fulfilled' ? d.value.count ?? 0 : 0,
        districtWater:   w.status === 'fulfilled' ? w.value.count ?? 0 : 0,
        alerts:          a.status === 'fulfilled' ? a.value.count ?? 0 : 0,
        pendingReports:  pending.status === 'fulfilled' ? pending.value.count ?? 0 : 0,
        campaigns:       campaigns.status === 'fulfilled' ? campaigns.value.count ?? 0 : 0,
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

      {stats.pendingReports > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <InfoBanner icon="alert-circle-outline" color="#F59E0B" text={`${stats.pendingReports} district report${stats.pendingReports > 1 ? 's are' : ' is'} awaiting approval`} />
        </View>
      )}

      {/* 1. District Stats */}
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

      {/* 2. District Alerts */}
      <Section title={`${profile.district ?? 'District'} Alerts`}>
        {alerts.length === 0
          ? <EmptyState icon="checkmark-circle-outline" color="#10B981" title={`${profile.district ?? 'District'} is Clear`} subtitle="No active health alerts in your district." />
          : alerts.map(a => <AlertCard key={a.id} alert={a} onPress={() => RNAlert.alert(
              a.title ?? 'Alert',
              `Type: ${a.alert_type ?? '-'}\nUrgency: ${a.urgency_level ?? '-'}\nLocation: ${a.location_name ?? '-'}, ${a.district ?? '-'}${a.disease_or_issue ? '\nDisease: ' + a.disease_or_issue : ''}${a.cases_reported ? '\nCases: ' + a.cases_reported : ''}\n\n${a.description ?? ''}`,
              [{ text: 'Close' }, { text: 'View Queue', onPress: () => onNavigate('approval-queue') }]
            )} />)
        }
      </Section>

      <SectionDivider />

      {/* 3. Quick Actions */}
      <Section title="Quick Actions">
        <View style={styles.qaRow}>
          <QuickActionBtn icon="virus" iconFamily="material" label="Report Disease" color="#EF4444" onPress={() => onNavigate('new-disease-report')} />
          <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
          <QuickActionBtn icon="megaphone" label="Campaign" color="#10B981" onPress={() => onNavigate('new-campaign')} />
          <QuickActionBtn icon="warning" label="Alert" color="#F59E0B" onPress={() => onNavigate('new-alert')} />
        </View>
      </Section>

      <SectionDivider />

      {/* 4. District Management Tools */}
      <Section title="🏛️ District Tools">
        <ToolCard icon="document-text" iconColor="#4338CA" title="District Reports" subtitle="Review all disease & water reports in your district" onPress={() => onNavigate('approval-queue')} badge={stats.pendingReports} />
        <ToolCard icon="bar-chart" iconColor="#0891B2" title="District Analytics" subtitle="Trends, outbreak patterns and health coverage" onPress={() => onNavigate('approval-queue')} />
        <ToolCard icon="megaphone" iconColor="#10B981" title="Campaign Management" subtitle="Manage health campaigns in your district" onPress={() => onNavigate('new-campaign')} />
      </Section>

      <SectionDivider />

      {/* 5. AI Insights */}
      <AIInsightsPanel profile={profile} />

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8 },
  qaRow: { flexDirection: 'row', gap: 8 },
});

export default DistrictOfficerDashboard;
