import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Profile, AIAlert } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { getAIAlerts } from '../../lib/services/advancedAnalytics';

interface MapTabScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
}

interface AlertItem {
  id: string;
  title: string;
  description: string;
  location_name: string;
  district: string;
  state?: string;
  created_at: string;
  urgency_level: string;
  alert_type?: string;
  disease_or_issue?: string;
  cases_reported?: number;
  affected_population?: number;
  immediate_actions?: string;
  precautionary_measures?: string;
}

const mapAiAlertToMapAlert = (alert: AIAlert): AlertItem => ({
  id: `ai-${alert.id}`,
  title: alert.title,
  description: alert.description,
  location_name: alert.location_name || alert.district,
  district: alert.district,
  state: alert.state,
  created_at: alert.created_at,
  urgency_level: alert.severity,
  alert_type: 'ai_signal',
  disease_or_issue: alert.disease_name,
  immediate_actions: alert.recommended_action,
  precautionary_measures: `Trend status: ${alert.trend_status}`,
});

const MapTabScreen: React.FC<MapTabScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [aiAlerts, setAiAlerts] = useState<AIAlert[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [manualAlertsRes, aiAlertsRes] = await Promise.all([
        supabase
          .from('health_alerts')
          .select(
            'id,title,description,location_name,district,state,created_at,urgency_level,alert_type,disease_or_issue,cases_reported,affected_population,immediate_actions,precautionary_measures'
          )
          .eq('status', 'active')
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(180),
        getAIAlerts(profile),
      ]);

      const manualAlerts = manualAlertsRes.error
        ? []
        : filterAlertsForProfile(
            (manualAlertsRes.data ?? []).map((row: any) => ({
              id: String(row.id ?? `alert-${row.created_at ?? Date.now()}`),
              title: String(row.title ?? 'Health Alert'),
              description: String(row.description ?? 'No description available.'),
              location_name: String(row.location_name ?? row.district ?? 'Unknown location'),
              district: String(row.district ?? 'Unknown'),
              state: row.state ? String(row.state) : undefined,
              created_at: String(row.created_at ?? new Date().toISOString()),
              urgency_level: String(row.urgency_level ?? 'medium'),
              alert_type: row.alert_type ? String(row.alert_type) : undefined,
              disease_or_issue: row.disease_or_issue ? String(row.disease_or_issue) : undefined,
              cases_reported: typeof row.cases_reported === 'number' ? row.cases_reported : undefined,
              affected_population: typeof row.affected_population === 'number' ? row.affected_population : undefined,
              immediate_actions: row.immediate_actions ? String(row.immediate_actions) : undefined,
              precautionary_measures: row.precautionary_measures ? String(row.precautionary_measures) : undefined,
            })),
            profile
          );

      const mappedAiAlerts = aiAlertsRes.map(mapAiAlertToMapAlert);
      const mergedAlerts = [...manualAlerts, ...mappedAiAlerts].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setAiAlerts(aiAlertsRes);
      setAlerts(mergedAlerts);

      if (manualAlertsRes.error) {
        setError('Some alert sources could not be loaded, but map intelligence is still available.');
      }
    } catch {
      setError('Unable to load map intelligence right now. Please try again.');
      setAiAlerts([]);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [profile.role, profile.district, profile.state]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const metrics = useMemo(() => {
    const criticalCount = alerts.filter((alert) => alert.urgency_level.toLowerCase() === 'critical').length;
    const districtCount = new Set(alerts.map((alert) => String(alert.district || 'unknown').toLowerCase())).size;

    return {
      totalAlerts: alerts.length,
      aiSignals: aiAlerts.length,
      criticalCount,
      districtCount,
    };
  }, [alerts, aiAlerts]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { backgroundColor: colors.primary }]}> 
        <Text style={styles.headerTitle}>Map Intelligence</Text>
        <Text style={styles.headerSubtitle}>Live alerts, AI signals, and geospatial risk overview</Text>
      </View>

      <View style={styles.metricsRow}>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Visible Alerts</Text>
          <Text style={[styles.metricValue, { color: colors.text }]}>{metrics.totalAlerts}</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>AI Signals</Text>
          <Text style={[styles.metricValue, { color: colors.text }]}>{metrics.aiSignals}</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Critical</Text>
          <Text style={[styles.metricValue, { color: '#DC2626' }]}>{metrics.criticalCount}</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Districts</Text>
          <Text style={[styles.metricValue, { color: colors.text }]}>{metrics.districtCount}</Text>
        </View>
      </View>

      {error && (
        <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
        </View>
      )}

      {loading && alerts.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading map intelligence...</Text>
        </View>
      ) : (
        <MapAndAlertsSection
          profile={profile}
          alerts={alerts}
          onOpenReport={(type, id) => onNavigateToForm(`open-report:${type}:${id}`)}
          onViewAllAlerts={() => onNavigateToForm('all-alerts')}
          alertSectionTitle="Operational Alerts & AI Signals"
          emptyTitle="No Active Signals"
          emptySubtitle="No alerts or AI risk signals are currently active in your visible area."
        />
      )}

      <View style={[styles.aiFeed, { backgroundColor: colors.card, borderColor: colors.border }]}> 
        <Text style={[styles.aiFeedTitle, { color: colors.text }]}>AI Signal Feed</Text>
        {aiAlerts.length === 0 ? (
          <Text style={[styles.aiFeedEmpty, { color: colors.textSecondary }]}>No AI-generated signals available right now.</Text>
        ) : (
          aiAlerts.slice(0, 6).map((signal) => (
            <TouchableOpacity
              key={signal.id}
              style={[styles.signalCard, { borderColor: colors.border }]}
              activeOpacity={0.85}
            >
              <View style={styles.signalHeader}>
                <Text style={[styles.signalTitle, { color: colors.text }]} numberOfLines={1}>
                  {signal.title}
                </Text>
                <View style={[styles.severityPill, { backgroundColor: `${signal.severity === 'critical' ? '#DC2626' : signal.severity === 'high' ? '#EA580C' : signal.severity === 'medium' ? '#F59E0B' : '#10B981'}22` }]}> 
                  <Text
                    style={[
                      styles.severityText,
                      {
                        color:
                          signal.severity === 'critical'
                            ? '#DC2626'
                            : signal.severity === 'high'
                              ? '#EA580C'
                              : signal.severity === 'medium'
                                ? '#F59E0B'
                                : '#10B981',
                      },
                    ]}
                  >
                    {signal.severity.toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={[styles.signalMeta, { color: colors.textSecondary }]}> 
                {signal.district}
                {signal.confidence_score ? ` • Confidence ${Math.round(signal.confidence_score)}%` : ''}
                {` • ${signal.trend_status}`}
              </Text>
              <Text style={[styles.signalBody, { color: colors.textSecondary }]} numberOfLines={2}>
                {signal.recommended_action || signal.description}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={{ height: 110 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 4,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  metricsRow: {
    paddingHorizontal: 16,
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    flexBasis: '48%',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metricLabel: {
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  errorCard: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  aiFeed: {
    marginTop: 10,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  aiFeedTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  aiFeedEmpty: {
    fontSize: 13,
  },
  signalCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  signalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signalTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  severityPill: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '800',
  },
  signalMeta: {
    marginTop: 4,
    fontSize: 11,
  },
  signalBody: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
});

export default MapTabScreen;
