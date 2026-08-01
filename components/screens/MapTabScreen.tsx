import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Profile, AIAlert } from '../../types';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { MapAndAlertsSection } from '../shared/HealthMapComponent';
import {
  ErrorCard,
  SkeletonBlock,
  getSeverityColor,
} from '../dashboards/DashboardShared';
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

/** Soft background tone for a severity level (solid fill is CRITICAL's privilege). */
const severityBgTone = (level: string, t: Theme): string => {
  switch (level?.toLowerCase()) {
    case 'critical': return t.dangerBg;
    case 'high':     return t.offlineBg;
    case 'medium':   return t.warningBg;
    case 'low':      return t.successBg;
    default:         return t.surfaceVariant;
  }
};

const MapTabScreen: React.FC<MapTabScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors, isDark } = useTheme();
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
        setError("Couldn't load some alert sources — check connection.");
      }
    } catch {
      setError("Couldn't load map intelligence — check connection.");
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

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  const metricCards: { label: string; value: number; rule: string }[] = [
    { label: 'Visible Alerts', value: metrics.totalAlerts, rule: colors.primary },
    { label: 'AI Signals', value: metrics.aiSignals, rule: colors.ai },
    { label: 'Critical', value: metrics.criticalCount, rule: colors.danger },
    { label: 'Districts', value: metrics.districtCount, rule: colors.info },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper still needs a hairline to read as separated.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: headerText }]}>Map Intelligence</Text>
        <Text style={[styles.headerSubtitle, { color: headerSub }]}>Live alerts, AI signals, and geospatial risk overview</Text>
      </View>

      {loading && alerts.length === 0 ? (
        <View style={styles.metricsRow}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} width="48%" height={92} radius={8} style={{ flexGrow: 1 }} />
          ))}
        </View>
      ) : (
        <View style={styles.metricsRow}>
          {metricCards.map((card) => (
            <View
              key={card.label}
              style={[
                styles.metricCard,
                { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: card.rule },
                !isDark && styles.cardShadow,
              ]}
              accessible
              accessibilityLabel={`${card.label}: ${card.value}`}
            >
              <Text style={[styles.metricValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {card.value}
              </Text>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                {card.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {error && (
        <View style={styles.errorWrap}>
          <ErrorCard message={error} onRetry={loadData} />
        </View>
      )}

      {loading && alerts.length === 0 ? (
        <View style={styles.mapSkeletonWrap}>
          <SkeletonBlock height={280} radius={12} />
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

      {/* AI Signal Feed — indigo means "the system inferred this" */}
      <View
        style={[
          styles.aiFeed,
          { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.ai },
          !isDark && styles.cardShadow,
        ]}
      >
        <View style={styles.aiFeedHeader}>
          <Text style={[styles.aiFeedTitle, { color: colors.textSecondary }]}>
            AI SIGNAL FEED
            {aiAlerts.length > 0 && (
              <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${aiAlerts.length}`}</Text>
            )}
          </Text>
          <View style={[styles.aiBadge, { backgroundColor: colors.aiBg }]}>
            <Text style={[styles.aiBadgeText, { color: colors.ai }]} maxFontSizeMultiplier={1.3}>AI</Text>
          </View>
        </View>
        {loading && aiAlerts.length === 0 ? (
          <View style={{ gap: 8 }}>
            <SkeletonBlock height={64} radius={8} />
            <SkeletonBlock height={64} radius={8} />
          </View>
        ) : aiAlerts.length === 0 ? (
          <Text style={[styles.aiFeedEmpty, { color: colors.textSecondary }]}>
            All quiet — the system has no AI-generated signals for your area right now.
          </Text>
        ) : (
          aiAlerts.slice(0, 6).map((signal) => {
            const sev = signal.severity.toLowerCase();
            const isCritical = sev === 'critical';
            const pillFg = isCritical ? colors.textInverse : getSeverityColor(sev, colors);
            const pillBg = isCritical ? colors.danger : severityBgTone(sev, colors);
            return (
              <View
                key={signal.id}
                style={[styles.signalCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <View style={styles.signalHeader}>
                  <Text style={[styles.signalTitle, { color: colors.text }]} numberOfLines={1}>
                    {signal.title}
                  </Text>
                  <View
                    style={[styles.severityPill, { backgroundColor: pillBg }]}
                    accessibilityLabel={`Urgency: ${sev}`}
                  >
                    {!isCritical && <View style={[styles.severityDot, { backgroundColor: pillFg }]} />}
                    <Text style={[styles.severityText, { color: pillFg }]} maxFontSizeMultiplier={1.3}>
                      {signal.severity.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.signalMeta, { color: colors.textSecondary }]}>
                  {signal.district}
                  {signal.confidence_score ? ` · Confidence ${Math.round(signal.confidence_score)}%` : ''}
                  {` · ${signal.trend_status}`}
                </Text>
                <Text style={[styles.signalBody, { color: colors.textSecondary }]} numberOfLines={2}>
                  {signal.recommended_action || signal.description}
                </Text>
              </View>
            );
          })
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
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    // Sits directly under MainApp's 56dp shell header + Role Ribbon, so it
    // carries no status-bar inset and stays compact.
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  metricsRow: {
    paddingHorizontal: 16,
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderTopWidth: 3,
    padding: 16,
    minHeight: 92,
    justifyContent: 'flex-end',
  },
  metricLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  metricValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  errorWrap: {
    marginTop: 12,
    marginHorizontal: 16,
  },
  mapSkeletonWrap: {
    marginTop: 12,
    marginHorizontal: 16,
  },
  aiFeed: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 16,
  },
  aiFeedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  aiFeedTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  aiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  aiBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  aiFeedEmpty: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  signalCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  signalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signalTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  severityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  severityText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  signalMeta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  signalBody: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});

export default MapTabScreen;
