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

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const SuperAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, users: 0, pendingFeedback: 0, pendingApprovals: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    try {
      const [d, w, c, a, u, f, pa] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('user_feedback').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
      ]);
      const alertData = await supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(3);
      setStats({
        disease: d.status === 'fulfilled' ? d.value.count ?? 0 : 0,
        water:   w.status === 'fulfilled' ? w.value.count ?? 0 : 0,
        campaigns: c.status === 'fulfilled' ? c.value.count ?? 0 : 0,
        alerts:  a.status === 'fulfilled' ? a.value.count ?? 0 : 0,
        users:   u.status === 'fulfilled' ? u.value.count ?? 0 : 0,
        pendingFeedback: f.status === 'fulfilled' ? f.value.count ?? 0 : 0,
        pendingApprovals: pa.status === 'fulfilled' ? pa.value.count ?? 0 : 0,
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

      {/* 1. Admin Panel — TOP PRIORITY */}
      <Section title="🛡️ Admin Panel" style={{ marginTop: 16 }}>
        <ToolCard icon="people" iconColor="#42A5F5" title="User Management" subtitle="Create, edit, deactivate users & manage roles" onPress={() => onNavigate('user-management')} />
        <ToolCard icon="shield-checkmark" iconColor="#A78BFA" title="Approval Queue" subtitle="Review pending reports & campaigns" onPress={() => onNavigate('approval-queue')} badge={stats.pendingApprovals} />
        {stats.pendingFeedback > 0 && (
          <ToolCard icon="chatbox-ellipses" iconColor="#FB923C" title="User Feedback" subtitle="Pending feedback awaiting review" onPress={() => onNavigate('approval-queue')} badge={stats.pendingFeedback} />
        )}
      </Section>

      <SectionDivider />

      {/* 2. System Stats */}
      <Section title="📊 System Overview">
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

      {/* 3. Quick Actions */}
      <Section title="⚡ Quick Actions">
        <View style={styles.qaRow}>
          <QuickActionBtn icon="virus" iconFamily="material" label="Report Disease" color="#EF4444" onPress={() => onNavigate('new-disease-report')} />
          <QuickActionBtn icon="water" label="Water Quality" color="#3B82F6" onPress={() => onNavigate('new-water-report')} />
          <QuickActionBtn icon="megaphone" label="New Campaign" color="#10B981" onPress={() => onNavigate('new-campaign')} />
          <QuickActionBtn icon="warning" label="Send Alert" color="#F59E0B" onPress={() => onNavigate('new-alert')} />
        </View>
      </Section>

      <SectionDivider />

      {/* 4. AI Insights */}
      <AIInsightsPanel profile={profile} />

      <SectionDivider />

      {/* 5. Active Alerts */}
      <Section title="🚨 Active Alerts" action={{ label: 'View All', onPress: () => onNavigate('approval-queue') }}>
        {alerts.length === 0
          ? <EmptyState icon="checkmark-circle" color="#10B981" title="No Active Alerts" subtitle="All systems are clear. No health alerts at this time." />
          : alerts.map(a => <AlertCard key={a.id} alert={a} onPress={() => RNAlert.alert(
              a.title ?? 'Alert',
              `Type: ${a.alert_type ?? '-'}\nUrgency: ${a.urgency_level ?? '-'}\nLocation: ${a.location_name ?? '-'}, ${a.district ?? '-'}, ${a.state ?? '-'}${a.disease_or_issue ? '\nDisease: ' + a.disease_or_issue : ''}${a.cases_reported ? '\nCases: ' + a.cases_reported : ''}\n\n${a.description ?? ''}`,
              [{ text: 'Close' }, { text: 'View Queue', onPress: () => onNavigate('approval-queue') }]
            )} />)
        }
      </Section>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8 },
  qaRow: { flexDirection: 'row', gap: 8 },
});

export default SuperAdminDashboard;
