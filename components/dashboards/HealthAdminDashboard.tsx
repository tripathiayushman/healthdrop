// =====================================================
// HEALTH ADMIN DASHBOARD — "Prakash"
// Priority: Stats → Approval Queue → Active Alerts → Quick Actions → AI Insights
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl, Pressable } from 'react-native';

import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, QuickActionBtn,
  ToolCard, SectionDivider, SkeletonBlock, ErrorCard, InfoBanner,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';
import { unverifiedCount } from '../../lib/services/provisioning';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

// The home feed scrolls underneath two floating buttons owned by the shell:
// the violet AI launcher (bottom 96, 56dp tall) and the Create FAB. Without a
// tail the last card ends up sitting behind them. This is scroll padding, not
// a spacer view, so it survives any widget being hidden.
const FAB_SAFE_PAD = 120;

export const HealthAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, pendingReports: 0, unverified: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    setError(null);
    try {
      const [d, w, c, a, pendingDisease, pendingWater, unverified] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        unverifiedCount(),
      ]);
      const alertData = await supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(3);

      // Silent zeros are design bugs: a failed query marks the region errored.
      let failed = false;
      const countOf = (r: PromiseSettledResult<any>): number => {
        if (r.status !== 'fulfilled' || r.value?.error) { failed = true; return 0; }
        return r.value.count ?? 0;
      };

      // Role-verification banner is fail-soft: if the count errors the banner
      // simply stays hidden — no number is displayed, so nothing lies as 0.
      const unverifiedUsers =
        unverified.status === 'fulfilled' && unverified.value.data !== null
          ? unverified.value.data
          : 0;

      setStats({
        disease: countOf(d),
        water: countOf(w),
        campaigns: countOf(c),
        alerts: countOf(a),
        pendingReports: countOf(pendingDisease) + countOf(pendingWater),
        unverified: unverifiedUsers,
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

      {/* Pending role-verification signal — tap routes to User Management */}
      {!loading && !error && stats.unverified > 0 && (
        <Pressable
          onPress={() => onNavigate('user-management')}
          accessibilityRole="button"
          accessibilityLabel={`${stats.unverified} clinic or ASHA account${stats.unverified === 1 ? '' : 's'} awaiting role verification — opens user management`}
          style={styles.bannerWrap}
        >
          <InfoBanner icon="shield-checkmark-outline" color={colors.warning} text={`${stats.unverified} clinic/ASHA account${stats.unverified === 1 ? '' : 's'} awaiting role verification`} />
        </Pressable>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title="Health Overview" style={{ marginTop: stats.unverified > 0 ? spacing.xs : spacing.lg }}>
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
            <ToolCard icon="albums-outline" iconColor={colors.primary} title="Records Console" subtitle="Users, disease, water and campaign records in one place" onPress={() => onNavigate('admin-management')} />
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
            <ToolCard icon="water-outline" iconColor={colors.info} title="Water Sources" subtitle="Every registered source and its latest test result" onPress={() => onNavigate('water-sources')} />
            <ToolCard icon="share-social-outline" iconColor={colors.primary} title="Weekly Summary" subtitle="IDSP-style verified digest — share on WhatsApp" onPress={() => onNavigate('weekly-summary')} />
            <ToolCard icon="radio-outline" iconColor={colors.primary} title="Broadcast to staff" subtitle="In-app advisory to field staff — never shown to the public" onPress={() => onNavigate('advisory-composer')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Select dashboard modules visible on your home view" onPress={() => onNavigate('widget-customization')} />
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
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  qaRow: { flexDirection: 'row', gap: spacing.sm },
  rowGap: { marginTop: spacing.sm },
  statSpacer: { flex: 1 },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  bannerWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
});

export default HealthAdminDashboard;
