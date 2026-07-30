// =====================================================
// VOLUNTEER DASHBOARD — "Prakash"
// Priority: Active Alerts → AI Insights → Active Campaigns → Community Stats
// Four-state data regions: skeleton / content / quiet-zero / error-with-retry.
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  DashboardHeader, Section, StatCard, EmptyState,
  SectionDivider, InfoBanner, ToolCard, SkeletonBlock, ErrorCard,
} from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

const LOAD_ERROR = "Couldn't load dashboard data — check connection";

export const VolunteerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors, isDark } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ alerts: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

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
      const campaignData = await supabase.from('health_campaigns').select('id,name,title,campaign_name,description,campaign_type,start_date,end_date,district,state').eq('status', 'active').order('start_date', { ascending: true }).limit(4);

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
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const retry = () => { setLoading(true); load(); };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
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

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <ToolCard icon="pulse-outline" iconColor={colors.info} title="District Health Score" subtitle="Track your district risk and health score trend" onPress={() => onNavigate('health-score')} />
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
                    <View style={[styles.campaignIconWrap, { backgroundColor: colors.success + '14' }]}>
                      <Ionicons name="megaphone-outline" size={24} color={colors.success} />
                    </View>
                    <View style={styles.campaignInfo}>
                      <Text style={[styles.campaignTitle, { color: colors.text }]} numberOfLines={1}>
                        {c.campaign_name || c.title || c.name || 'Untitled Campaign'}
                      </Text>
                      <Text style={[styles.campaignDesc, { color: colors.textSecondary }]} numberOfLines={2}>{c.description}</Text>
                      <View style={styles.campaignMeta}>
                        {c.district && <>
                          <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                          <Text style={[styles.campaignMetaText, { color: colors.textSecondary }]}>{c.district}</Text>
                        </>}
                        {c.campaign_type && (
                          <View style={[styles.typePill, { backgroundColor: colors.primaryLight }]}>
                            <Text style={[styles.typeText, { color: isDark ? colors.primary : colors.primaryDark }]} maxFontSizeMultiplier={1.3}>
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

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  /* Light-mode-only shadow — single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
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
  campaignMetaText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  typePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill },
  typeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  skelStat: { flex: 1, width: 'auto' },
  skelGap: { marginBottom: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  bannerWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
});

export default VolunteerDashboard;
