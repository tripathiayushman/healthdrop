// =====================================================
// CLINIC DASHBOARD — "Prakash"
// Priority: Quick Actions → Approval Tools → Activity Stats → District Alerts → AI Insights
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
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

// The home feed scrolls underneath two floating buttons owned by the shell:
// the violet AI launcher (bottom 96, 56dp tall) and the Create FAB. Without a
// tail the last card ends up sitting behind them. This is scroll padding, not
// a spacer view, so it survives any widget being hidden.
const FAB_SAFE_PAD = 120;

export const ClinicDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ myReports: 0, districtAlerts: 0, pendingReports: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    setError(null);
    try {
      const [myDisease, myWater, pendingDisease, pendingWater, campaigns] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);
      const alertData = await supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(60);

      // Silent zeros are design bugs: a failed query marks the region errored.
      let failed = false;
      const countOf = (r: PromiseSettledResult<any>): number => {
        if (r.status !== 'fulfilled' || r.value?.error) { failed = true; return 0; }
        return r.value.count ?? 0;
      };

      if (alertData.error) failed = true;
      const visibleAlerts = filterAlertsForProfile(alertData.data ?? [], profile);

      setStats({
        myReports: countOf(myDisease) + countOf(myWater),
        pendingReports: countOf(pendingDisease) + countOf(pendingWater),
        campaigns: countOf(campaigns),
        districtAlerts: visibleAlerts.length,
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
      contentContainerStyle={styles.scrollContent}
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

      {isWidgetVisible('quick_actions') && (
        <>
          <Section title="Quick Actions" style={{ marginTop: spacing.lg }}>
            <View style={styles.qaRow}>
              <QuickActionBtn icon="thermometer-outline" label="Report Disease" color={colors.danger} onPress={() => onNavigate('new-disease-report')} />
              <QuickActionBtn icon="water-outline" label="Water Quality" color={colors.info} onPress={() => onNavigate('new-water-report')} />
            </View>
            <View style={[styles.qaRow, styles.rowGap]}>
              <QuickActionBtn icon="checkmark-done-outline" label="Review Queue" color={colors.success} onPress={() => onNavigate('approval-queue:disease')} />
              <View style={styles.statSpacer} />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('approval_tools') && (
        <>
          <Section title="Clinic Approval Tools">
            <ToolCard icon="medkit-outline" iconColor={colors.danger} title="Disease Reports" subtitle="Verify and approve submitted disease reports" onPress={() => onNavigate('approval-queue:disease')} badge={stats.pendingReports} />
            <ToolCard icon="water-outline" iconColor={colors.info} title="Water Quality Reports" subtitle="Verify and approve water quality submissions" onPress={() => onNavigate('approval-queue:water')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title="Your Activity">
            {loading ? (
              <>
                <View style={styles.statsRow}>
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                  <View style={styles.statSpacer} />
                </View>
              </>
            ) : !error ? (
              <>
                <View style={styles.statsRow}>
                  <StatCard label="My Reports" value={stats.myReports} icon="document-text-outline" color={colors.primary} />
                  <StatCard label="Active Campaigns" value={stats.campaigns} icon="megaphone-outline" color={colors.success} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="District Alerts" value={stats.districtAlerts} icon="warning-outline" color={colors.warning} />
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
            <Section title={profile.district ? `${profile.district} Alerts` : 'Active Alerts'}>
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
              alertSectionTitle={`${profile.district ? profile.district + ' Alerts' : 'Active Alerts'}`}
              emptyTitle="District is Clear"
              emptySubtitle="No active health alerts in your district."
            />
          ) : null}
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="View district health score and response indicators" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics-outline" iconColor={colors.success} title="Campaign Intelligence" subtitle="Track campaign effectiveness for your district" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network-outline" iconColor={colors.danger} title="Escalation Monitoring" subtitle="Monitor pending approvals crossing escalation windows" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Tailor the dashboard modules visible to you" onPress={() => onNavigate('widget-customization')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('ai_insights') && <AIInsightsPanel profile={profile} />}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  /* Tail clearance so the AI / Create FABs never cover the last card */
  scrollContent: { paddingBottom: FAB_SAFE_PAD },
  qaRow: { flexDirection: 'row', gap: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  rowGap: { marginTop: spacing.sm },
  statSpacer: { flex: 1 },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
});

export default ClinicDashboard;
