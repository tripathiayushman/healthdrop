// =====================================================
// SUPER ADMIN DASHBOARD — "Prakash"
// Priority: Admin Panel → System Stats → Quick Actions → AI Insights → Alerts
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
import { unverifiedCount } from '../../lib/services/provisioning';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

// The home feed scrolls underneath two floating buttons owned by the shell:
// the violet AI launcher (bottom 96, 56dp tall) and the Create FAB. Without a
// tail the last card ends up sitting behind them. This is scroll padding, not
// a spacer view, so it survives any widget being hidden.
const FAB_SAFE_PAD = 120;

export const SuperAdminDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0, users: 0, pendingApprovals: 0, unverified: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);

  const load = async () => {
    setError(null);
    try {
      const [d, w, c, a, u, pendingDisease, pendingWater, pendingCampaigns, pendingAlerts, unverified] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        // BRK-23(ii) — "Active Alerts" must mean what it says. `status='active'`
        // alone also counts alerts NOBODY HAS APPROVED: a rolled-back probe
        // inserting one pending alert moved this tile 4 → 5 while the list
        // directly beneath it (and every field consumer) still showed 4.
        // An unapproved alert is a draft, not an active advisory.
        supabase.from('health_alerts').select('id', { count: 'exact', head: true })
          .eq('status', 'active').eq('approval_status', 'approved'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('approval_status', 'pending_approval'),
        unverifiedCount(),
      ]);
      const alertData = await supabase.from('health_alerts').select('*').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(3);

      // Silent zeros are design bugs: a query that failed marks the
      // whole region as errored instead of masquerading as 0.
      let failed = false;
      const countOf = (r: PromiseSettledResult<any>): number => {
        if (r.status !== 'fulfilled' || r.value?.error) { failed = true; return 0; }
        return r.value.count ?? 0;
      };

      const pendingApprovalsCount =
        countOf(pendingDisease) + countOf(pendingWater) + countOf(pendingCampaigns) + countOf(pendingAlerts);

      // Role-verification badge is fail-soft: if the count errors the badge
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
        users: countOf(u),
        pendingApprovals: pendingApprovalsCount,
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

      {isWidgetVisible('admin_panel') && (
        <>
          <Section title="Admin Panel" style={{ marginTop: spacing.lg }}>
            <ToolCard icon="people-outline" iconColor={colors.primary} title="User Management" subtitle={stats.unverified > 0 ? `${stats.unverified} clinic/ASHA account${stats.unverified === 1 ? '' : 's'} awaiting role verification` : 'Create, edit, deactivate users & manage roles'} onPress={() => onNavigate('user-management')} badge={stats.unverified} />
            <ToolCard icon="shield-checkmark-outline" iconColor={colors.accent} title="Approval Queue" subtitle="Review pending reports & campaigns" onPress={() => onNavigate('approval-queue')} badge={stats.pendingApprovals} />
            <ToolCard icon="albums-outline" iconColor={colors.primary} title="Records Console" subtitle="Users, disease, water and campaign records in one place" onPress={() => onNavigate('admin-management')} />
            {/* BRK-22 — the "User Feedback" ToolCard was removed, not re-routed.
                It promised "pending feedback awaiting review" and navigated to
                'approval-queue', whose tabs are only disease | water | campaigns
                | alerts (ApprovalQueueScreen.tsx:30) — there is no feedback tab
                and no feedback-reading UI anywhere in the shipped app.

                Re-pointing it at 'notifications-inbox' was considered and
                rejected: the badge counted `user_feedback.status='pending'`
                while the inbox lists `notifications` rows, and those two
                numbers are not the same thing. Live proof — `user_feedback`
                holds 1 row (status 'resolved') and `notifications` holds 0, so
                a badge sourced from one and a destination sourced from the
                other would still be a lie, just a quieter one.

                Nothing is lost by removing it. `notify_on_feedback()` (verified
                in pg_proc) already inserts a notification for super_admin and
                health_admin carrying the first 180 chars of the feedback text,
                and the shell's notification bell (MainApp.tsx:705-713) is
                rendered unconditionally for every role. The bell is the real
                destination and it shows more than this card ever did.

                Restore a card here only together with a genuine feedback
                review surface (a Feedback tab in ApprovalQueueScreen). */}
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('overview_stats') && (
        <>
          <Section title="System Overview">
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
                  <StatCard label="Active Users" value={stats.users} icon="people-outline" color={colors.primary} />
                  <StatCard label="Disease Reports" value={stats.disease} icon="bar-chart-outline" color={colors.danger} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="Active Alerts" value={stats.alerts} icon="warning-outline" color={colors.warning} />
                  <StatCard label="Water Reports" value={stats.water} icon="water-outline" color={colors.info} />
                </View>
                <View style={[styles.statsRow, styles.rowGap]}>
                  <StatCard label="Campaigns" value={stats.campaigns} icon="megaphone-outline" color={colors.success} />
                  <StatCard label="Pending Approvals" value={stats.pendingApprovals} icon="time-outline" color={colors.accent} />
                </View>
              </>
            ) : null}
          </Section>
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
              <QuickActionBtn icon="megaphone-outline" label="New Campaign" color={colors.success} onPress={() => onNavigate('new-campaign')} />
              <QuickActionBtn icon="warning-outline" label="Send Alert" color={colors.warning} onPress={() => onNavigate('new-alert')} />
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="Monitor district risk ranking and response health" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="analytics-outline" iconColor={colors.success} title="Campaign Intelligence" subtitle="Track campaign impact, performance, and AI recommendations" onPress={() => onNavigate('campaign-intelligence')} />
            <ToolCard icon="git-network-outline" iconColor={colors.danger} title="Escalation Monitoring" subtitle="Watch pending approvals crossing escalation thresholds" onPress={() => onNavigate('escalation-monitoring')} />
            <ToolCard icon="water-outline" iconColor={colors.info} title="Water Sources" subtitle="Every registered source and its latest test result" onPress={() => onNavigate('water-sources')} />
            <ToolCard icon="share-social-outline" iconColor={colors.primary} title="Weekly Summary" subtitle="IDSP-style verified digest — share on WhatsApp" onPress={() => onNavigate('weekly-summary')} />
            <ToolCard icon="radio-outline" iconColor={colors.primary} title="Broadcast to staff" subtitle="In-app advisory to field staff — never shown to the public" onPress={() => onNavigate('advisory-composer')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Control which dashboard widgets are visible" onPress={() => onNavigate('widget-customization')} />
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

      {isWidgetVisible('alerts_map') && (
        loading ? (
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
            emptySubtitle="All systems are clear. No health alerts at this time."
          />
        ) : null
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  /* Tail clearance so the AI / Create FABs never cover the last card */
  scrollContent: { paddingBottom: FAB_SAFE_PAD },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  qaRow: { flexDirection: 'row', gap: spacing.sm },
  rowGap: { marginTop: spacing.sm },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
});

export default SuperAdminDashboard;
