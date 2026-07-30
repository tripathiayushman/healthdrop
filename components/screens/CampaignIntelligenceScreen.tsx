import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CampaignEffectiveness, Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import {
  getCampaignEffectiveness,
  getCampaignIntelligence,
} from '../../lib/services/advancedAnalytics';

interface CampaignIntelligenceScreenProps {
  profile: Profile;
  onBack: () => void;
}

const toNumber = (value: number | null | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const CampaignIntelligenceScreen: React.FC<CampaignIntelligenceScreenProps> = ({ profile, onBack }) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignEffectiveness[]>([]);
  const [insights, setInsights] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadIntelligence = async () => {
    setLoading(true);
    setError(null);

    try {
      const [effectivenessRows, intelligenceRows] = await Promise.all([
        getCampaignEffectiveness(profile),
        getCampaignIntelligence(profile),
      ]);

      setCampaigns(effectivenessRows);
      setInsights(intelligenceRows);
    } catch {
      setCampaigns([]);
      setInsights([]);
      setError("Couldn't load campaign intelligence — check connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntelligence();
  }, [profile.role, profile.district]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadIntelligence();
    setRefreshing(false);
  };

  const summary = useMemo(() => {
    const campaignCount = campaigns.length;
    const avgSuccess =
      campaignCount === 0
        ? 0
        : campaigns.reduce((sum, row) => sum + toNumber(row.success_score), 0) / campaignCount;
    const avgImpact =
      campaignCount === 0
        ? 0
        : campaigns.reduce((sum, row) => sum + toNumber(row.impact_score), 0) / campaignCount;
    const lowPerformance = campaigns.filter((row) => toNumber(row.success_score) < 45).length;

    return {
      campaignCount,
      avgSuccess,
      avgImpact,
      lowPerformance,
    };
  }, [campaigns]);

  const statusColor = (status?: string | null): string => {
    if (status === 'completed') return colors.success;
    if (status === 'ongoing' || status === 'active') return colors.info;
    return colors.warning;
  };

  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;

  const summaryCards: { label: string; value: number; rule: string }[] = [
    { label: 'Campaigns', value: summary.campaignCount, rule: colors.primary },
    { label: 'Avg Success', value: Math.round(summary.avgSuccess), rule: colors.success },
    { label: 'Avg Impact', value: Math.round(summary.avgImpact), rule: colors.info },
    { label: 'Low Score', value: summary.lowPerformance, rule: colors.danger },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: headerText }]}>Campaign Intelligence</Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]}>Performance analytics, impact score, and AI guidance</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.summaryRow}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} width="47%" height={92} radius={8} style={{ flexGrow: 1 }} />
            ))}
          </View>
        ) : (
          <View style={styles.summaryRow}>
            {summaryCards.map((card) => (
              <View
                key={card.label}
                style={[
                  styles.summaryCard,
                  { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: card.rule },
                  !isDark && styles.cardShadow,
                ]}
                accessible
                accessibilityLabel={`${card.label}: ${card.value}`}
              >
                <Text style={[styles.summaryValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {card.value}
                </Text>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                  {card.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Intelligence Summary — AI-generated, indigo-tagged */}
        <View
          style={[
            styles.insightCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.ai },
            !isDark && styles.cardShadow,
          ]}
        >
          <View style={styles.insightHeader}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>INTELLIGENCE SUMMARY</Text>
            <View style={[styles.aiBadge, { backgroundColor: colors.aiBg }]}>
              <Text style={[styles.aiBadgeText, { color: colors.ai }]} maxFontSizeMultiplier={1.3}>AI</Text>
            </View>
          </View>
          {loading ? (
            <View style={{ gap: 8 }}>
              <SkeletonBlock height={16} radius={8} />
              <SkeletonBlock height={16} width="80%" radius={8} />
            </View>
          ) : insights.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              All quiet — no campaign signals need your attention right now.
            </Text>
          ) : (
            insights.map((insight, index) => (
              <View key={`${index}-${insight.slice(0, 20)}`} style={styles.insightRow}>
                <View style={[styles.insightDot, { backgroundColor: colors.ai }]} />
                <Text style={[styles.insightText, { color: colors.text }]}>{insight}</Text>
              </View>
            ))
          )}
        </View>

        {error && <View style={{ marginTop: 12 }}><ErrorCard message={error} onRetry={loadIntelligence} /></View>}

        <View
          style={[
            styles.listCard,
            { backgroundColor: colors.card, borderColor: colors.border },
            !isDark && styles.cardShadow,
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginBottom: 12 }]}>
            CAMPAIGN PERFORMANCE
            {campaigns.length > 0 && (
              <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${campaigns.length}`}</Text>
            )}
          </Text>

          {loading ? (
            <View style={{ gap: 8 }}>
              <SkeletonBlock height={112} radius={8} />
              <SkeletonBlock height={112} radius={8} />
              <SkeletonBlock height={112} radius={8} />
            </View>
          ) : campaigns.length === 0 ? (
            <EmptyState
              icon="checkmark-circle-outline"
              color={colors.success}
              title="No campaigns to analyze"
              subtitle="No campaign performance data is available in your visible scope yet."
            />
          ) : (
            campaigns.slice(0, 16).map((campaign) => {
              const successScore = toNumber(campaign.success_score);
              const impactScore = toNumber(campaign.impact_score);
              const target = toNumber(campaign.target_population);
              const reached = toNumber(campaign.reached_population);
              const reachRatio = target > 0 ? Math.round((reached / target) * 100) : 0;

              return (
                <View
                  key={campaign.campaign_id}
                  style={[styles.itemCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                >
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                      {campaign.campaign_name}
                    </Text>
                    <Text
                      style={[styles.statusText, { color: statusColor(campaign.status) }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {(campaign.status || 'planned').toUpperCase()}
                    </Text>
                  </View>

                  <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                    {campaign.district || 'Unknown district'}
                    {campaign.campaign_type ? ` · ${campaign.campaign_type.replace(/_/g, ' ')}` : ''}
                  </Text>

                  {/* Single ink series — labels distinguish the bars */}
                  <View style={styles.metricBars}>
                    <View>
                      <Text style={[styles.barLabel, { color: colors.textSecondary }]}>Success {Math.round(successScore)}</Text>
                      <View style={[styles.barTrack, { backgroundColor: colors.chartGrid }]}>
                        <View style={[styles.barFill, { width: `${Math.max(4, Math.round(successScore))}%`, backgroundColor: colors.chartLine }]} />
                      </View>
                    </View>
                    <View>
                      <Text style={[styles.barLabel, { color: colors.textSecondary }]}>Impact {Math.round(impactScore)}</Text>
                      <View style={[styles.barTrack, { backgroundColor: colors.chartGrid }]}>
                        <View style={[styles.barFill, { width: `${Math.max(4, Math.round(impactScore))}%`, backgroundColor: colors.chartLine }]} />
                      </View>
                    </View>
                  </View>

                  <View style={styles.itemFooter}>
                    <Text style={[styles.footerText, { color: colors.textSecondary }]}>Target {target || '-'}</Text>
                    <Text style={[styles.footerText, { color: colors.textSecondary }]}>Reached {reached || '-'}</Text>
                    <Text style={[styles.footerText, { color: colors.textSecondary }]}>Reach {reachRatio || 0}%</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
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
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    borderWidth: 1,
    borderTopWidth: 3,
    borderRadius: 12,
    padding: 16,
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 92,
    justifyContent: 'flex-end',
  },
  summaryLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  summaryValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  insightCard: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 16,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
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
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 7,
  },
  insightText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  listCard: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  itemMeta: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  metricBars: {
    marginTop: 8,
    gap: 6,
  },
  barLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginBottom: 2,
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    height: 6,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  itemFooter: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  footerText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});

export default CampaignIntelligenceScreen;
