// =====================================================
// ASHA WORKER DASHBOARD — "Prakash"
// Priority: Quick Actions → District Alerts → AI Insights → My Report Stats
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  InfoBanner, SectionDivider, ToolCard, SkeletonBlock, ErrorCard,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

export const AshaWorkerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ myReports: 0, myPending: 0, myApproved: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    setError(null);
    try {
      const [diseaseAll, waterAll, diseasePending, waterPending, diseaseApproved, waterApproved, campaigns] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id).eq('approval_status', 'pending_approval'),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id).eq('approval_status', 'approved'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', profile.id).eq('approval_status', 'approved'),
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

      setStats({
        myReports: countOf(diseaseAll) + countOf(waterAll),
        myPending: countOf(diseasePending) + countOf(waterPending),
        myApproved: countOf(diseaseApproved) + countOf(waterApproved),
        campaigns: countOf(campaigns),
      });
      if (alertData.error) failed = true;
      setAlerts(filterAlertsForProfile(alertData.data ?? [], profile).slice(0, 4));
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

      {/* Pending approval banner */}
      {!loading && !error && stats.myPending > 0 && (
        <View style={styles.bannerWrap}>
          <InfoBanner icon="time-outline" color={colors.warning} text={`${stats.myPending} of your report${stats.myPending > 1 ? 's are' : ' is'} awaiting clinic approval`} />
        </View>
      )}

      {isWidgetVisible('quick_actions') && (
        <>
          <Section title="Quick Actions" style={{ marginTop: stats.myPending > 0 ? spacing.xs : spacing.lg }}>
            <View style={styles.qaRow}>
              <QuickActionBtn icon="thermometer-outline" label="Report Disease" color={colors.danger} onPress={() => onNavigate('new-disease-report')} />
              <QuickActionBtn icon="water-outline" label="Water Quality" color={colors.info} onPress={() => onNavigate('new-water-report')} />
            </View>
            <View style={[styles.qaRow, styles.rowGap]}>
              <QuickActionBtn icon="megaphone-outline" label="New Campaign" color={colors.success} onPress={() => onNavigate('new-campaign')} />
              <View style={styles.spacer} />
            </View>
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
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="View district risk score and outbreak pressure" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics-outline" iconColor={colors.success} title="Campaign Intelligence" subtitle="Review campaign performance and strategic guidance" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Choose dashboard widgets you want to see" onPress={() => onNavigate('widget-customization')} />
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('ai_insights') && (
        <>
          <AIInsightsPanel profile={profile} />
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('my_stats') && (
        <Section title="My Submission Stats">
          {loading ? (
            <>
              <View style={styles.statsRow}>
                <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
              </View>
              <View style={[styles.statsRow, styles.rowGap]}>
                <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
                <View style={styles.spacer} />
              </View>
            </>
          ) : !error ? (
            <>
              <View style={styles.statsRow}>
                <StatCard label="Total Submitted" value={stats.myReports} icon="document-text-outline" color={colors.primary} />
                <StatCard label="Approved" value={stats.myApproved} icon="checkmark-circle-outline" color={colors.success} />
              </View>
              <View style={[styles.statsRow, styles.rowGap]}>
                <StatCard label="Pending" value={stats.myPending} icon="time-outline" color={colors.accent} />
                <View style={styles.spacer} />
              </View>
            </>
          ) : null}
        </Section>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  qaRow: { flexDirection: 'row', gap: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  rowGap: { marginTop: spacing.sm },
  spacer: { flex: 1 },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  bannerWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
});

export default AshaWorkerDashboard;
