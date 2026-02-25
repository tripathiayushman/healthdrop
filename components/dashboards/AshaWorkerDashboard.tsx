// =====================================================
// ASHA WORKER DASHBOARD — Polished
// Priority: Quick Actions → District Alerts → AI Insights → My Report Stats
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  AlertCard, EmptyState, InfoBanner, SectionDivider,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const AshaWorkerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ myReports: 0, myPending: 0, myApproved: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      // ASHA workers submit water reports (and campaigns/alerts), not disease reports
      const [all, pending, approved, campaigns] = await Promise.allSettled([
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id).eq('approval_status', 'approved'),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      let alertQ = supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(4);
      if (profile.district) alertQ = alertQ.eq('district', profile.district);
      const alertData = await alertQ;
      setStats({
        myReports: all.status === 'fulfilled' ? all.value.count ?? 0 : 0,
        myPending: pending.status === 'fulfilled' ? pending.value.count ?? 0 : 0,
        myApproved: approved.status === 'fulfilled' ? approved.value.count ?? 0 : 0,
        campaigns: campaigns.status === 'fulfilled' ? campaigns.value.count ?? 0 : 0,
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

      {/* Pending approval banner */}
      {stats.myPending > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <InfoBanner icon="time-outline" color="#F59E0B" text={`${stats.myPending} of your report${stats.myPending > 1 ? 's are' : ' is'} awaiting clinic approval`} />
        </View>
      )}

      {/* 1. Quick Actions */}
      <Section title="Quick Actions" style={{ marginTop: stats.myPending > 0 ? 4 : 16 }}>
        <View style={styles.qaRow}>
          <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
          <QuickActionBtn icon="megaphone" label="New Campaign" color="#10B981" onPress={() => onNavigate('new-campaign')} />
          <QuickActionBtn icon="warning" label="Send Alert" color="#F59E0B" onPress={() => onNavigate('new-alert')} />
        </View>
      </Section>

      <SectionDivider />

      {/* 2. District Alerts */}
      <Section title={`${profile.district ? profile.district + ' Alerts' : 'Active Alerts'}`}>
        {alerts.length === 0
          ? <EmptyState icon="checkmark-circle-outline" color="#10B981" title="District is Clear" subtitle="No active health alerts in your district." />
          : alerts.map(a => <AlertCard key={a.id} alert={a} onPress={() => {}} />)
        }
      </Section>

      <SectionDivider />

      {/* 3. AI Insights */}
      <AIInsightsPanel profile={profile} />

      <SectionDivider />

      {/* 4. My Report Stats */}
      <Section title="My Submission Stats">
        <View style={styles.statsRow}>
          <StatCard label="Total Submitted" value={stats.myReports} icon="document-text" color="#EA580C" />
          <StatCard label="Approved" value={stats.myApproved} icon="checkmark-circle" color="#10B981" />
          <StatCard label="Pending" value={stats.myPending} icon="time" color="#F59E0B" />
        </View>
      </Section>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  qaRow: { flexDirection: 'row', gap: 8 },
  statsRow: { flexDirection: 'row', gap: 8 },
});

export default AshaWorkerDashboard;
