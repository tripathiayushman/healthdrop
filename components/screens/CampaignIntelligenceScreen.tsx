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
import { CampaignEffectiveness, Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
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
  const { colors } = useTheme();
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

      if (effectivenessRows.length === 0) {
        setError('No campaign performance data is available in your visible scope yet.');
      }
    } catch {
      setCampaigns([]);
      setInsights([]);
      setError('Unable to load campaign intelligence right now.');
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { backgroundColor: colors.accent }]}> 
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Campaign Intelligence</Text>
          <Text style={styles.headerSubtitle}>Performance analytics, impact score, and AI guidance</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Campaigns</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.campaignCount}</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Avg Success</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{Math.round(summary.avgSuccess)}</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Avg Impact</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{Math.round(summary.avgImpact)}</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Low Score</Text>
            <Text style={[styles.summaryValue, { color: '#DC2626' }]}>{summary.lowPerformance}</Text>
          </View>
        </View>

        <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Intelligence Summary</Text>
          {loading ? (
            <View style={styles.loadingInline}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.loadingInlineText, { color: colors.textSecondary }]}>Computing campaign signals...</Text>
            </View>
          ) : insights.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No intelligence summary available.</Text>
          ) : (
            insights.map((insight, index) => (
              <View key={`${index}-${insight.slice(0, 20)}`} style={styles.insightRow}>
                <View style={[styles.insightDot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.insightText, { color: colors.textSecondary }]}>{insight}</Text>
              </View>
            ))
          )}
        </View>

        {error && (
          <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Ionicons name="alert-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          </View>
        )}

        <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Campaign Performance</Text>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : campaigns.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No campaigns available for performance analysis.</Text>
          ) : (
            campaigns.slice(0, 16).map((campaign) => {
              const successScore = toNumber(campaign.success_score);
              const impactScore = toNumber(campaign.impact_score);
              const target = toNumber(campaign.target_population);
              const reached = toNumber(campaign.reached_population);
              const reachRatio = target > 0 ? Math.round((reached / target) * 100) : 0;

              return (
                <View key={campaign.campaign_id} style={[styles.itemCard, { borderColor: colors.border }]}> 
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                      {campaign.campaign_name}
                    </Text>
                    <Text
                      style={[
                        styles.statusText,
                        {
                          color:
                            campaign.status === 'completed'
                              ? '#10B981'
                              : campaign.status === 'ongoing' || campaign.status === 'active'
                                ? '#3B82F6'
                                : '#F59E0B',
                        },
                      ]}
                    >
                      {(campaign.status || 'planned').toUpperCase()}
                    </Text>
                  </View>

                  <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                    {campaign.district || 'Unknown district'}
                    {campaign.campaign_type ? ` • ${campaign.campaign_type.replace(/_/g, ' ')}` : ''}
                  </Text>

                  <View style={styles.metricBars}>
                    <View>
                      <Text style={[styles.barLabel, { color: colors.textSecondary }]}>Success {Math.round(successScore)}</Text>
                      <View style={[styles.barTrack, { backgroundColor: colors.border }]}> 
                        <View style={[styles.barFill, { width: `${Math.max(4, Math.round(successScore))}%`, backgroundColor: '#0EA5E9' }]} />
                      </View>
                    </View>
                    <View>
                      <Text style={[styles.barLabel, { color: colors.textSecondary }]}>Impact {Math.round(impactScore)}</Text>
                      <View style={[styles.barTrack, { backgroundColor: colors.border }]}> 
                        <View style={[styles.barFill, { width: `${Math.max(4, Math.round(impactScore))}%`, backgroundColor: '#10B981' }]} />
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
  header: {
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
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
    gap: 8,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexBasis: '48%',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  insightCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
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
    marginTop: 6,
  },
  insightText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
  },
  loadingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingInlineText: {
    fontSize: 12,
  },
  errorCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
  },
  listCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  loadingWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
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
    fontSize: 13,
    fontWeight: '700',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  itemMeta: {
    marginTop: 2,
    fontSize: 11,
  },
  metricBars: {
    marginTop: 8,
    gap: 6,
  },
  barLabel: {
    fontSize: 11,
    marginBottom: 2,
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
    fontSize: 11,
  },
});

export default CampaignIntelligenceScreen;
