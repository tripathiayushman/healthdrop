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

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const HealthAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      const [d, w, c, a, pending] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
      ]);
      const alertData = await supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(3);
      setStats({
        disease: d.status === 'fulfilled' ? d.value.count ?? 0 : 0,
        water:   w.status === 'fulfilled' ? w.value.count ?? 0 : 0,
        campaigns: c.status === 'fulfilled' ? c.value.count ?? 0 : 0,
        alerts:  a.status === 'fulfilled' ? a.value.count ?? 0 : 0,
        pendingReports: pending.status === 'fulfilled' ? pending.value.count ?? 0 : 0,
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

      {/* 1. Health Stats */}
      <Section title="📊 Health Overview" style={{ marginTop: 16 }}>
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

      {/* 2. Approval Queue */}
      <Section title="✅ Approval Queue">
        <ToolCard icon="checkmark-circle" iconColor="#26A69A" title="Reports Pending Review" subtitle={`${stats.pendingReports} ASHA/clinic reports awaiting approval`} onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
        <ToolCard icon="megaphone" iconColor="#10B981" title="Campaign Approvals" subtitle="Review & publish pending health campaigns" onPress={() => onNavigate('approval-queue:campaigns')} />
        <ToolCard icon="warning" iconColor="#F59E0B" title="Alert Management" subtitle="Approve, publish & manage health alerts" onPress={() => onNavigate('approval-queue:alerts')} />
      </Section>

      <SectionDivider />

      {/* 3. Active Alerts */}
      <Section title="🚨 Active Alerts" action={{ label: 'Manage', onPress: () => onNavigate('approval-queue:alerts') }}>
        {alerts.length === 0
          ? <EmptyState icon="checkmark-circle" color="#10B981" title="No Active Alerts" subtitle="No alerts are currently active in the system." />
          : alerts.map(a => <AlertCard key={a.id} alert={a} onPress={() => RNAlert.alert(
              a.title ?? 'Alert',
              `Type: ${a.alert_type ?? '-'}\nUrgency: ${a.urgency_level ?? '-'}\nLocation: ${a.location_name ?? '-'}, ${a.district ?? '-'}, ${a.state ?? '-'}${a.disease_or_issue ? '\nDisease: ' + a.disease_or_issue : ''}${a.cases_reported ? '\nCases: ' + a.cases_reported : ''}\n\n${a.description ?? ''}`,
              [{ text: 'Close' }, { text: 'Manage Alerts', onPress: () => onNavigate('approval-queue:alerts') }]
            )} />)
        }
      </Section>

      <SectionDivider />

      {/* 4. Quick Actions */}
      <Section title="⚡ Quick Actions">
        <View style={styles.qaRow}>
          <QuickActionBtn icon="virus" iconFamily="material" label="Report Disease" color="#EF4444" onPress={() => onNavigate('new-disease-report')} />
          <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
          <QuickActionBtn icon="megaphone" label="Campaign" color="#10B981" onPress={() => onNavigate('new-campaign')} />
          <QuickActionBtn icon="warning" label="Alert" color="#F59E0B" onPress={() => onNavigate('new-alert')} />
        </View>
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

export default HealthAdminDashboard;
