// =====================================================
// DISTRICT OFFICER DASHBOARD — "Prakash"
// Priority: District Stats → District Alerts → Quick Actions → District Tools → AI Insights
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
import { Outbreak, isOutbreakConfirmed, outbreaksService } from '../../lib/services/outbreaks';

interface Props {
  profile: Profile;
  onNavigate: (s: string) => void;
  /** Optional: open the outbreak signal-review / console flow. */
  onOpenOutbreak?: (id: string) => void;
}

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

const relativeAge = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const outbreakDay = (iso: string): number => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 1;
  return Math.max(1, Math.floor((Date.now() - t) / 86400000) + 1);
};

export const DistrictOfficerDashboard: React.FC<Props> = ({ profile, onNavigate, onOpenOutbreak }) => {
  const { colors, isDark } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ districtReports: 0, districtWater: 0, campaigns: 0, alerts: 0, pendingReports: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [outbreaks, setOutbreaks] = useState<Outbreak[]>([]);

  const openOutbreak = (id: string) => {
    if (onOpenOutbreak) onOpenOutbreak(id);
    else onNavigate(`outbreak-signal:${id}`);
  };

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
      const outbreakRes = await outbreaksService.getActive(profile.district || undefined);
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

      if (outbreakRes.error || !outbreakRes.data) {
        failed = true;
        setOutbreaks([]);
      } else {
        setOutbreaks(outbreakRes.data);
      }

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

  // C·01 — the auto-detected signal awaiting a human decision:
  // newest active outbreak with no confirmation entry in its audit log.
  const signalOutbreak = outbreaks.find((o) => o.status === 'active' && !isOutbreakConfirmed(o)) ?? null;
  const latestOutbreak = outbreaks[0] ?? null;

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

      {/* ── C·01 AUTO-DETECTED SIGNAL — outranks everything, but wears
           warning amber + a gear (rule-based, not AI, not confirmed danger).
           Never violet, never red. ── */}
      {!loading && !error && signalOutbreak && (
        <View style={styles.bannerWrap}>
          <View
            style={[
              styles.signalCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.warning },
              !isDark && styles.cardShadow,
            ]}
          >
            <View style={styles.signalHeader}>
              <View style={styles.signalEyebrowWrap}>
                <Ionicons name="settings-outline" size={14} color={colors.warning} />
                <Text style={[styles.signalEyebrow, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
                  AUTO-DETECTED SIGNAL
                </Text>
              </View>
              <Text style={[styles.signalAge, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {relativeAge(signalOutbreak.created_at)}
              </Text>
            </View>
            <Text style={[styles.signalTitle, { color: colors.text }]} numberOfLines={2}>
              Possible {signalOutbreak.disease_name.toLowerCase()} outbreak — {signalOutbreak.district}
            </Text>
            <Text style={[styles.signalMeta, { color: colors.textSecondary }]}>
              {signalOutbreak.total_cases} approved case{signalOutbreak.total_cases === 1 ? '' : 's'} from{' '}
              {signalOutbreak.report_count} report{signalOutbreak.report_count === 1 ? '' : 's'} · Rule:
              case threshold — not a public alert until you confirm.
            </Text>
            <Pressable
              onPress={() => openOutbreak(signalOutbreak.id)}
              accessibilityRole="button"
              accessibilityLabel="Review the auto-detected outbreak signal"
              style={({ pressed }) => [
                styles.signalBtn,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
              ]}
            >
              <Text style={[styles.signalBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                Review signal
              </Text>
            </Pressable>
          </View>
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
                  {latestOutbreak ? (
                    <StatCard
                      label={`Outbreak · ${latestOutbreak.status} · day ${outbreakDay(latestOutbreak.created_at)}`}
                      value={outbreaks.length}
                      icon="pulse-outline"
                      color={latestOutbreak.status === 'active' ? colors.danger : colors.warning}
                      onPress={() => openOutbreak(latestOutbreak.id)}
                    />
                  ) : (
                    <View style={styles.statSpacer} />
                  )}
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

  /* ── C·01 auto-detected signal card ── */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  signalCard: {
    borderWidth: 1, borderLeftWidth: 3, borderRadius: radii.md,
    padding: spacing.lg, gap: spacing.xs,
  },
  signalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm, marginBottom: 2,
  },
  signalEyebrowWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  signalEyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  signalAge: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  signalTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  signalMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  signalBtn: {
    minHeight: 48, borderRadius: radii.md, marginTop: spacing.sm,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  signalBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
});

export default DistrictOfficerDashboard;
