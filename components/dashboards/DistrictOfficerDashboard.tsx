// =====================================================
// DISTRICT OFFICER DASHBOARD — "Prakash"
// Priority: District Stats → District Alerts → Quick Actions → District Tools → AI Insights
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';

import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  ToolCard, InfoBanner, SectionDivider, SkeletonBlock, ErrorCard,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

export const DistrictOfficerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ districtReports: 0, districtWater: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    setError(null);
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

      // Silent zeros are design bugs: a failed query marks the region errored.
      let failed = false;
      const countOf = (r: PromiseSettledResult<any>): number => {
        if (r.status !== 'fulfilled' || r.value?.error) { failed = true; return 0; }
        return r.value.count ?? 0;
      };

      if (alertData.error) failed = true;
      const visibleAlerts = filterAlertsForProfile(alertData.data ?? [], profile);

      setStats({
        districtReports: countOf(d),
        districtWater: countOf(w),
        alerts: visibleAlerts.length,
        pendingReports: countOf(pendingDisease) + countOf(pendingWater),
        campaigns: countOf(campaigns),
      });
      setAlerts(visibleAlerts.slice(0, 4));
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

      {!loading && !error && stats.pendingReports > 0 && (
        <View style={styles.bannerWrap}>
          <InfoBanner icon="alert-circle-outline" color={colors.warning} text={`${stats.pendingReports} district report${stats.pendingReports > 1 ? 's are' : ' is'} awaiting approval`} />
        </View>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title={`${profile.district ?? 'District'} Overview`} style={{ marginTop: stats.pendingReports > 0 ? spacing.xs : spacing.lg }}>
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
                  <StatCard label="Disease Reports" value={stats.districtReports} icon="bar-chart-outline" color={colors.danger} />
                  <StatCard label="Water Reports" value={stats.districtWater} icon="water-outline" color={colors.info} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="Active Alerts" value={stats.alerts} icon="warning-outline" color={colors.warning} />
                  <StatCard label="Active Campaigns" value={stats.campaigns} icon="megaphone-outline" color={colors.success} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="Pending Approval" value={stats.pendingReports} icon="time-outline" color={colors.accent} />
                  <View style={styles.statSpacer} />
                </View>
              </>
            ) : null}
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('alerts_map') && (
        <>
          {loading ? (
            <Section title={`${profile.district ?? 'District'} Alerts`}>
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
              alertSectionTitle={`${profile.district ?? 'District'} Alerts`}
              emptyTitle={`${profile.district ?? 'District'} is Clear`}
              emptySubtitle="No active health alerts in your district."
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

      {isWidgetVisible('district_tools') && (
        <>
          <Section title="District Tools">
            <ToolCard icon="document-text-outline" iconColor={colors.danger} title="Disease Reports" subtitle="Review, verify & approve disease reports in your district" onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
            <ToolCard icon="water-outline" iconColor={colors.info} title="Water Quality Reports" subtitle="Review, verify & approve water quality reports in your district" onPress={() => onNavigate('approval-queue:water')} />
            <ToolCard icon="megaphone-outline" iconColor={colors.success} title="Campaign Management" subtitle="Approve, reject & manage health campaigns in your district" onPress={() => onNavigate('approval-queue:campaigns')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="See your district risk score and response trends" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics-outline" iconColor={colors.success} title="Campaign Intelligence" subtitle="Review campaign performance and AI recommendations" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network-outline" iconColor={colors.danger} title="Escalation Monitoring" subtitle="Track district approvals nearing SLA breach" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Control visibility of dashboard sections" onPress={() => onNavigate('widget-customization')} />
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
  bannerWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
});

export default DistrictOfficerDashboard;
