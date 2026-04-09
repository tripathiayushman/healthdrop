// =====================================================
// VOLUNTEER DASHBOARD — Polished
// Priority: Active Alerts → AI Insights → Active Campaigns → Community Stats
// =====================================================
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { DashboardHeader, Section, StatCard, AlertCard, EmptyState, SectionDivider, InfoBanner } from './DashboardShared';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { useDashboardWidgetVisibility } from '../../lib/services/widgetPreferences';

interface Props { profile: Profile; onNavigate: (s: string) => void }

export const VolunteerDashboard: React.FC<Props> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const { isWidgetVisible } = useDashboardWidgetVisibility(profile);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ alerts: 0, campaigns: 0 });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  const load = async () => {
    try {
      const alertData = await supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(80);
      const campaignData = await supabase.from('health_campaigns').select('id,name,title,campaign_name,description,campaign_type,start_date,end_date,district,state').eq('status', 'active').order('start_date', { ascending: true }).limit(4);
      const visibleAlerts = filterAlertsForProfile(alertData.data ?? [], profile);
      setAlerts(visibleAlerts.slice(0, 5));
      setCampaigns(campaignData.data ?? []);
      setStats({ alerts: visibleAlerts.length, campaigns: campaignData.data?.length ?? 0 });
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
      <DashboardHeader profile={profile} subtitle="Community Health Volunteer" />

      {isWidgetVisible('alerts_map') && (
        <>
          <MapAndAlertsSection
            profile={profile}
            alerts={alerts}
            onOpenReport={(type, id) => onNavigate(`open-report:${type}:${id}`)}
            onViewAllAlerts={() => onNavigate('all-alerts')}
            alertSectionTitle="Active Health Alerts"
            emptyTitle="No Active Alerts"
            emptySubtitle="Your community is safe! No health alerts at this time."
          />
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('operations_tools') && (
        <>
          <Section title="Operations Intelligence">
            <TouchableOpacity style={[styles.actionTile, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => onNavigate('health-score')}>
              <Ionicons name="pulse" size={18} color="#0EA5E9" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>District Health Score</Text>
                <Text style={[styles.actionSubtitle, { color: colors.textSecondary }]}>Track your district risk and health score trend.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionTile, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => onNavigate('widget-customization')}>
              <Ionicons name="options" size={18} color="#8B5CF6" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: colors.text }]}>Customize Widgets</Text>
                <Text style={[styles.actionSubtitle, { color: colors.textSecondary }]}>Choose which dashboard widgets remain visible.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
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
          <Section title="Active Campaigns">
            {campaigns.length === 0
              ? <EmptyState icon="megaphone-outline" color="#16A34A" title="No Active Campaigns" subtitle="Check back soon for health campaigns near you." />
              : campaigns.map(c => (
                <TouchableOpacity key={c.id} style={[styles.campaignCard, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.78}>
                  <View style={[styles.campaignIconWrap, { backgroundColor: '#16A34A18' }]}>
                    <Ionicons name="megaphone" size={20} color="#16A34A" />
                  </View>
                  <View style={styles.campaignInfo}>
                    <Text style={[styles.campaignTitle, { color: colors.text }]} numberOfLines={1}>
                      {c.campaign_name || c.title || c.name || 'Untitled Campaign'}
                    </Text>
                    <Text style={[styles.campaignDesc, { color: colors.textSecondary }]} numberOfLines={2}>{c.description}</Text>
                    <View style={styles.campaignMeta}>
                      {c.district && <>
                        <Ionicons name="location-outline" size={11} color={colors.textSecondary} />
                        <Text style={[styles.campaignMetaText, { color: colors.textSecondary }]}>{c.district}</Text>
                      </>}
                      {c.campaign_type && (
                        <View style={[styles.typePill, { backgroundColor: colors.primaryLight }]}>
                          <Text style={[styles.typeText, { color: colors.primary }]}>{c.campaign_type.replace('_', ' ')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ))
            }
          </Section>
          <SectionDivider />
        </>
      )}

      {isWidgetVisible('community_stats') && (
        <Section title="Community Overview">
          <View style={styles.statsRow}>
            <StatCard label="Active Alerts" value={stats.alerts} icon="warning" color="#F59E0B" />
            <StatCard label="Active Campaigns" value={stats.campaigns} icon="megaphone" color="#16A34A" />
          </View>
        </Section>
      )}

      {/* Volunteer info banner */}
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <InfoBanner icon="information-circle-outline" color="#4338CA" text="As a volunteer you can view alerts, campaigns & AI health insights. Contact your clinic for reporting access." />
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8 },
  campaignCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 13, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  campaignIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  campaignInfo: { flex: 1 },
  campaignTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  campaignDesc: { fontSize: 12, lineHeight: 17, marginBottom: 5 },
  campaignMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  campaignMetaText: { fontSize: 11 },
  typePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 10, fontWeight: '700' },
  actionTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  actionSubtitle: {
    marginTop: 2,
    fontSize: 11,
  },
});

export default VolunteerDashboard;
