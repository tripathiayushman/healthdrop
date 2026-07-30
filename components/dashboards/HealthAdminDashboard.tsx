// =====================================================
// HEALTH ADMIN DASHBOARD — "Prakash"
// Priority: Stats → Approval Queue → Active Alerts → Quick Actions → AI Insights
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';

import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  ToolCard, SectionDivider, SkeletonBlock, ErrorCard,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

export const HealthAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    setError(null);
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

      // Silent zeros are design bugs: a failed query marks the region errored.
      let failed = false;
      const countOf = (r: PromiseSettledResult<any>): number => {
        if (r.status !== 'fulfilled' || r.value?.error) { failed = true; return 0; }
        return r.value.count ?? 0;
      };

      setStats({
        disease: countOf(d),
        water: countOf(w),
        campaigns: countOf(c),
        alerts: countOf(a),
        pendingReports: countOf(pendingDisease) + countOf(pendingWater),
      });
      if (alertData.error) failed = true;
      setAlerts(alertData.data ?? []);
      if (failed) setError(LOAD_ERROR);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const retry = () => { setLoading(true); load(); };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      <DashboardHeader profile={profile} />

      {/* Error-with-retry: one inline card covering the failed data regions */}
      {!loading && error && (
        <View style={styles.errorWrap}>
          <ErrorCard message={error} onRetry={retry} />
        </View>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title="Health Overview" style={{ marginTop: spacing.lg }}>
            {loading ? (
              <>
                <View style={styles.statsRow}>
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                </View>
              </>
            ) : !error ? (
              <>
                <View style={styles.statsRow}>
                  <StatCard label="Disease Reports" value={stats.disease} icon="bar-chart-outline" color={colors.danger} />
                  <StatCard label="Water Reports" value={stats.water} icon="water-outline" color={colors.info} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="Active Alerts" value={stats.alerts} icon="warning-outline" color={colors.warning} />
                  <StatCard label="Campaigns" value={stats.campaigns} icon="megaphone-outline" color={colors.success} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="Pending Approvals" value={stats.pendingReports} icon="time-outline" color={colors.accent} />
                  <View style={styles.statSpacer} />
                </View>
              </>
            ) : null}
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('approval_tools') && (
        <>
          <Section title="Approval Queue">
            <ToolCard icon="checkmark-circle-outline" iconColor={colors.accent} title="Reports Pending Review" subtitle="ASHA & clinic reports awaiting approval" onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
            <ToolCard icon="megaphone-outline" iconColor={colors.success} title="Campaign Approvals" subtitle="Review & publish pending health campaigns" onPress={() => onNavigate('approval-queue:campaigns')} />
            <ToolCard icon="warning-outline" iconColor={colors.warning} title="Alert Management" subtitle="Approve, publish & manage health alerts" onPress={() => onNavigate('approval-queue:alerts')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('alerts_map') && (
        <>
          {loading ? (
            <Section title="Active Alerts">
              <SkeletonBlock height={160} radius={radii.md} style={styles.skelGap} />
              <SkeletonBlock height={72} radius={radii.md} style={styles.skelGap} />
              <SkeletonBlock height={72} radius={radii.md} />
            </Section>
          ) : !error ? (
            <MapAndAlertsSection
              profile={profile}
              alerts={alerts}
              onOpenReport={(type, id) => onNavigate(`open-report:${type}:${id}`)}
              onViewAllAlerts={() => onNavigate('all-alerts')}
              alertSectionTitle="Active Alerts"
              emptyTitle="No Active Alerts"
              emptySubtitle="No alerts are currently active in the system."
            />
          ) : null}
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('quick_actions') && (
        <>
          <Section title="Quick Actions">
            <View style={styles.qaRow}>
              <QuickActionBtn icon="thermometer-outline" label="Report Disease" color={colors.danger} onPress={() => onNavigate('new-disease-report')} />
              <QuickActionBtn icon="water-outline" label="Water Quality" color={colors.info} onPress={() => onNavigate('new-water-report')} />
            </View>
            <View style={[styles.qaRow, styles.rowGap]}>
              <QuickActionBtn icon="megaphone-outline" label="Campaign" color={colors.success} onPress={() => onNavigate('new-campaign')} />
              <QuickActionBtn icon="warning-outline" label="Alert" color={colors.warning} onPress={() => onNavigate('new-alert')} />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="Track health score and district risk ranking" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics-outline" iconColor={colors.success} title="Campaign Intelligence" subtitle="Measure campaign impact and optimize outreach" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network-outline" iconColor={colors.danger} title="Escalation Monitoring" subtitle="Identify pending approvals that need intervention" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Select dashboard modules visible on your home view" onPress={() => onNavigate('widget-customization')} />
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
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  qaRow: { flexDirection: 'row', gap: spacing.sm },
  rowGap: { marginTop: spacing.sm },
  statSpacer: { flex: 1 },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
});

export default HealthAdminDashboard;
