// =====================================================
// CLINIC DASHBOARD — Polished
// Priority: Quick Actions → Approval Tools → Activity Stats → District Alerts → AI Insights
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  AlertCard, ToolCard, EmptyState, SectionDivider,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const ClinicDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ myReports: 0, districtAlerts: 0, pendingReports: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      const [myR, pending, campaigns] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      let alertQuery = supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(4);
      if (profile.district) alertQuery = alertQuery.eq('district', profile.district);
      const alertData = await alertQuery;
      setStats({
        myReports: myR.status === 'fulfilled' ? myR.value.count ?? 0 : 0,
        pendingReports: pending.status === 'fulfilled' ? pending.value.count ?? 0 : 0,
        campaigns: campaigns.status === 'fulfilled' ? campaigns.value.count ?? 0 : 0,
        districtAlerts: alertData.data?.length ?? 0,
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

      {/* 1. Quick Actions — Report only (no campaign/alert creation for clinic) */}
      <Section title="⚡ Quick Actions" style={{ marginTop: 16 }}>
        <View style={styles.qaRow}>
          <QuickActionBtn icon="virus" iconFamily="material" label="Report Disease" color="#EF4444" onPress={() => onNavigate('new-disease-report')} />
          <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
          <QuickActionBtn icon="checkmark-done" label="Review Queue" color="#10B981" onPress={() => onNavigate('approval-queue:disease')} />
        </View>
      </Section>

      <SectionDivider />

      {/* 2. Approval Tools — clinic verifies/approves disease & water reports */}
      <Section title="✅ Clinic Approval Tools">
        <ToolCard icon="medkit" iconColor="#EF4444" title="Disease Reports" subtitle="Verify and approve submitted disease reports" onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
        <ToolCard icon="water" iconColor="#3B82F6" title="Water Quality Reports" subtitle="Verify and approve water quality submissions" onPress={() => onNavigate('approval-queue:water')} />
      </Section>

      <SectionDivider />

      {/* 3. Activity Stats */}
      <Section title="📊 Your Activity">
        <View style={styles.statsRow}>
          <StatCard label="My Reports" value={stats.myReports} icon="document-text" color="#6D28D9" />
          <StatCard label="Active Campaigns" value={stats.campaigns} icon="megaphone" color="#10B981" />
          <StatCard label="District Alerts" value={stats.districtAlerts} icon="warning" color="#F59E0B" />
        </View>
      </Section>

      <SectionDivider />

      {/* 4. District Alerts */}
      <Section title={`🚨 ${profile.district ? profile.district + ' Alerts' : 'Active Alerts'}`}>
        {alerts.length === 0
          ? <EmptyState icon="checkmark-circle-outline" color="#10B981" title="District is Clear" subtitle="No active health alerts in your district." />
          : alerts.map(a => <AlertCard key={a.id} alert={a} onPress={() => {}} />)
        }
      </Section>

      <SectionDivider />

      {/* 5. AI Insights */}
      <AIInsightsPanel profile={profile} />

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  qaRow: { flexDirection: 'row', gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
});

export default ClinicDashboard;
