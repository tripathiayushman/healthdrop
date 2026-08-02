// =====================================================
// VOLUNTEER DASHBOARD — "Prakash"
// Priority: Active Alerts → AI Insights → Active Campaigns → Community Stats
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, EmptyState,
  SectionDivider, InfoBanner, ToolCard, SkeletonBlock, ErrorCard, PaybackCard,
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

/**
 * 8% alpha suffix — the same accent-tinted icon wash the shared dashboard
 * components use. Derived from a token, never a standalone color.
 */
const TINT_ALPHA = '14';

// First-run guidance — per-user dismissal flag on this phone.
const firstRunKey = (userId: string) => `healthdrop:firstRunDismissed:${userId}`;

// Three 48dp rows. Volunteers cannot create reports (MainApp
// CREATE_PERMISSIONS excludes the role — the info banner below says so),
// so the first row points at the district health score instead of a form.
const FIRST_RUN_ROWS: Array<{
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  target: string;
}> = [
  { key: 'score',   icon: 'pulse-outline',          labelKey: 'firstRun.healthScore', target: 'health-score' },
  { key: 'alerts',  icon: 'warning-outline',        labelKey: 'firstRun.seeAlerts',   target: 'all-alerts' },
  { key: 'offline', icon: 'phone-portrait-outline', labelKey: 'firstRun.offlineFirst', target: 'sync-outbox' },
];

export const VolunteerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ alerts: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  // NEW-02 — the payback card owns its own queries and its own four states,
  // so a failure there can never be confused with a failure here. Pull-to-
  // refresh reloads it by bumping this counter.
  const [paybackTick, setPaybackTick] = useState(0);
  // null = storage not read yet — the card stays hidden until we know.
  const [firstRunDismissed, setFirstRunDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(firstRunKey(profile.id))
      .then(value => { if (mounted) setFirstRunDismissed(value === 'true'); })
      .catch(() => { if (mounted) setFirstRunDismissed(false); });
    return () => { mounted = false; };
  }, [profile.id]);

  const dismissFirstRun = () => {
    setFirstRunDismissed(true);
    AsyncStorage.setItem(firstRunKey(profile.id), 'true').catch(() => {
      /* storage unavailable — stays hidden for this session */
    });
  };

  const load = async () => {
    setError(null);
    try {
      const alertData = await supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(80);
      // Select only columns that exist. This used to ask for a speculative
      // union — id,name,title,campaign_name,... — and health_campaigns has
      // campaign_name but neither name nor title. Postgres rejects the whole
      // statement on the first unknown column (42703), so this query returned
      // HTTP 400 every single time and the volunteer's campaign list was
      // permanently empty. The error was counted, but an empty list reads as
      // "no campaigns" rather than "the query is broken".
      const campaignData = await supabase.from('health_campaigns').select('id,campaign_name,description,campaign_type,start_date,end_date,district,state').eq('status', 'active').order('start_date', { ascending: true }).limit(4);

      // Silent zeros are design bugs: a failed fetch marks the region errored.
      if (alertData.error || campaignData.error) {
        setError(LOAD_ERROR);
      }
      const visibleAlerts = filterAlertsForProfile(alertData.data ?? [], profile);
      setAlerts(visibleAlerts.slice(0, 5));
      setCampaigns(campaignData.data ?? []);
      setStats({ alerts: visibleAlerts.length, campaigns: campaignData.data?.length ?? 0 });
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  const onRefresh = async () => {
    setRefreshing(true);
    setPaybackTick(n => n + 1);
    await load();
    setRefreshing(false);
  };
  const retry = () => { setLoading(true); load(); };

  // Shown until dismissed. Volunteers have no own submissions to count
  // (the role cannot create reports), so dismissal is the only auto-hide.
  const showGettingStarted = firstRunDismissed === false && !loading;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      <DashboardHeader profile={profile} subtitle="Community Health Volunteer" />

      {/* Error-with-retry: one inline card covering the failed data regions */}
      {!loading && error && (
        <View style={styles.errorWrap}>
          <ErrorCard message={error} onRetry={retry} />
        </View>
      )}

      {/* GETTING STARTED — first-run guidance card. Quiet "Got it" dismisses
          it for this user on this phone. */}
      {showGettingStarted && (
        <>
          <Section
            title={t('firstRun.title')}
            style={{ marginTop: spacing.lg }}
            action={{ label: t('firstRun.dismiss'), onPress: dismissFirstRun }}
          >
            <View
              style={[
                styles.firstRunCard,
                { backgroundColor: colors.card, borderColor: colors.border },
                !isDark && styles.cardShadow,
              ]}
            >
              {FIRST_RUN_ROWS.map((row, i, arr) => (
                <Pressable
                  key={row.key}
                  onPress={() => onNavigate(row.target)}
                  accessibilityRole="button"
                  accessibilityLabel={t(row.labelKey)}
                  style={({ pressed }) => [
                    styles.firstRunRow,
                    pressed && { backgroundColor: colors.cardHover },
                    i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
                  ]}
                >
                  <Ionicons name={row.icon} size={22} color={colors.textSecondary} />
                  <Text style={[styles.firstRunText, { color: colors.text }]} numberOfLines={2}>
                    {t(row.labelKey)}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('alerts_map') && (
        <>
          {loading ? (
            <Section title="Active Health Alerts" style={{ marginTop: spacing.lg }}>
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
              alertSectionTitle="Active Health Alerts"
              emptyTitle="No Active Alerts"
              emptySubtitle="Your community is safe! No health alerts at this time."
            />
          ) : null}
          <SectionDivider />
        </>
      )}

      {/* NEW-02 — the payback card, the same component the ASHA dashboard
          renders. `canFile={false}`: MainApp's CREATE_PERMISSIONS excludes
          volunteers from reporting, so the quiet-zero must not tell this
          person to file a report she is not allowed to file. See the
          AshaWorkerDashboard comment for why the widget key is
          `overview_stats`. */}
      {isWidgetVisible('overview_stats') && (
        <>
          <PaybackCard
            profile={profile}
            onNavigate={onNavigate}
            refreshKey={paybackTick}
            canFile={false}
          />
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="Track your district risk and health score trend" onPress={() => onNavigate('health-score')} />
            <ToolCard icon="water-outline" iconColor={colors.info} title="Water Sources" subtitle="Which sources near you are safe, and when each was tested" onPress={() => onNavigate('water-sources')} />
            <ToolCard icon="options-outline" iconColor={colors.textSecondary} title="Customize Widgets" subtitle="Choose which dashboard widgets remain visible" onPress={() => onNavigate('widget-customization')} />
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

      {isWidgetVisible('campaigns') && (
        <>
          <Section title="Active Campaigns" count={loading || error ? undefined : campaigns.length}>
            {loading ? (
              <>
                <SkeletonBlock height={88} radius={radii.md} style={styles.skelGap} />
                <SkeletonBlock height={88} radius={radii.md} />
              </>
            ) : !error ? (
              campaigns.length === 0
                ? <EmptyState icon="checkmark-circle-outline" color={colors.success} title="No active campaigns right now" subtitle="Check back soon for health campaigns near you." />
                : campaigns.map(c => (
                  <View
                    key={c.id}
                    style={[
                      styles.campaignCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      !isDark && styles.cardShadow,
                    ]}
                  >
                    <View style={[styles.campaignIconWrap, { backgroundColor: colors.success + TINT_ALPHA }]}>
                      <Ionicons name="megaphone-outline" size={24} color={colors.success} />
                    </View>
                    <View style={styles.campaignInfo}>
                      <Text style={[styles.campaignTitle, { color: colors.text }]} numberOfLines={1}>
                        {c.campaign_name || 'Untitled Campaign'}
                      </Text>
                      <Text style={[styles.campaignDesc, { color: colors.textSecondary }]} numberOfLines={2}>{c.description}</Text>
                      <View style={styles.campaignMeta}>
                        {c.district && <>
                          <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                          <Text
                            style={[styles.campaignMetaText, { color: colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            {c.district}
                          </Text>
                        </>}
                        {c.campaign_type && (
                          <View style={[styles.typePill, { backgroundColor: colors.primaryLight }]}>
                            <Text
                              style={[styles.typeText, { color: isDark ? colors.primary : colors.primaryDark }]}
                              maxFontSizeMultiplier={1.3}
                              numberOfLines={1}
                            >
                              {c.campaign_type.replace(/_/g, ' ')}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                ))
            ) : null}
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('community_stats') && (
        <Section title="Community Overview">
          {loading ? (
            <View style={styles.statsRow}>
              <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
              <SkeletonBlock height={122} radius={radii.md} style={styles.skelStat} />
            </View>
          ) : !error ? (
            <View style={styles.statsRow}>
              <StatCard label="Active Alerts" value={stats.alerts} icon="warning-outline" color={colors.warning} />
              <StatCard label="Active Campaigns" value={stats.campaigns} icon="megaphone-outline" color={colors.success} />
            </View>
          ) : null}
        </Section>
      )}

      {/* Volunteer info banner */}
      <View style={styles.bannerWrap}>
        <InfoBanner icon="information-circle-outline" color={colors.info} text="As a volunteer you can view alerts, campaigns & AI health insights. Contact your clinic for reporting access." />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  /* Tail clearance so the AI / Create FABs never cover the last card */
  scrollContent: { paddingBottom: FAB_SAFE_PAD },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  /* Light-mode-only shadow — single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  /* Getting-started card — 48dp icon rows, hairline dividers */
  firstRunCard: { borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  firstRunRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  firstRunText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  campaignCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radii.md, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md,
    minHeight: 64,
  },
  campaignIconWrap: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  campaignInfo: { flex: 1 },
  campaignTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 2 },
  campaignDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.xs },
  campaignMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  campaignMetaText: { fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },
  /* The meta row wraps, but a long campaign type must shrink rather than
     push the card past 360dp. */
  typePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, flexShrink: 1 },
  typeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  bannerWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
});

export default VolunteerDashboard;
