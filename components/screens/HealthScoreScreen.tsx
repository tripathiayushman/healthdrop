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
import { Profile, DistrictHealthRanking } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { getDistrictHealthRanking } from '../../lib/services/advancedAnalytics';

interface HealthScoreScreenProps {
  profile: Profile;
  onBack: () => void;
}

const scoreColor = (value: number): string => {
  if (value >= 80) return '#10B981';
  if (value >= 60) return '#0EA5E9';
  if (value >= 40) return '#F59E0B';
  return '#DC2626';
};

const HealthScoreScreen: React.FC<HealthScoreScreenProps> = ({ profile, onBack }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scores, setScores] = useState<DistrictHealthRanking[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadScores = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getDistrictHealthRanking(profile);
      setScores(data);
      if (data.length === 0) {
        setError('No health score records are available yet for your visible scope.');
      }
    } catch {
      setError('Unable to load district health score data right now.');
      setScores([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScores();
  }, [profile.role, profile.district]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadScores();
    setRefreshing(false);
  };

  const districtSummary = useMemo(() => {
    const districtName = (profile.district || '').trim().toLowerCase();
    if (!districtName) return null;
    return scores.find((item) => item.district.trim().toLowerCase() === districtName) ?? null;
  }, [scores, profile.district]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { backgroundColor: colors.secondary }]}> 
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>District Health Score</Text>
          <Text style={styles.headerSubtitle}>Risk ranking, outbreaks, and response health indicators</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />}
        showsVerticalScrollIndicator={false}
      >
        {districtSummary && (
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Your district health score</Text>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryScore, { color: scoreColor(districtSummary.health_score) }]}>
                {Math.round(districtSummary.health_score)}
              </Text>
              <View style={[styles.rankPill, { backgroundColor: `${scoreColor(districtSummary.health_score)}22` }]}> 
                <Text style={[styles.rankText, { color: scoreColor(districtSummary.health_score) }]}>
                  Risk Rank #{districtSummary.risk_rank}
                </Text>
              </View>
            </View>
            <View style={styles.summaryMetrics}>
              <Text style={[styles.summaryMetric, { color: colors.textSecondary }]}>Active cases: {districtSummary.active_cases}</Text>
              <Text style={[styles.summaryMetric, { color: colors.textSecondary }]}>Outbreaks: {districtSummary.outbreak_count}</Text>
              <Text style={[styles.summaryMetric, { color: colors.textSecondary }]}>Water score: {districtSummary.avg_water_score.toFixed(1)}</Text>
              <Text style={[styles.summaryMetric, { color: colors.textSecondary }]}>Avg response: {districtSummary.avg_response_time.toFixed(1)}h</Text>
            </View>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.secondary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading health scores...</Text>
          </View>
        ) : (
          <>
            {error && (
              <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
                <Ionicons name="alert-circle-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
              </View>
            )}

            {scores.map((item) => {
              const color = scoreColor(item.health_score);
              return (
                <View key={`${item.district}-${item.risk_rank}`} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemDistrict, { color: colors.text }]} numberOfLines={1}>
                      {item.district}
                    </Text>
                    <Text style={[styles.itemScore, { color }]}>{Math.round(item.health_score)}</Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.border }]}> 
                    <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(item.health_score))}%`, backgroundColor: color }]} />
                  </View>
                  <View style={styles.itemMetaRow}>
                    <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>Rank #{item.risk_rank}</Text>
                    <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>Cases {item.active_cases}</Text>
                    <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>Outbreaks {item.outbreak_count}</Text>
                    <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>Water {item.avg_water_score.toFixed(1)}</Text>
                  </View>
                </View>
              );
            })}
          </>
        )}

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
  summaryCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  summaryRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryScore: {
    fontSize: 34,
    fontWeight: '900',
  },
  rankPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rankText: {
    fontSize: 11,
    fontWeight: '700',
  },
  summaryMetrics: {
    marginTop: 8,
    gap: 4,
  },
  summaryMetric: {
    fontSize: 12,
  },
  loadingWrap: {
    paddingTop: 36,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 12,
    flex: 1,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  itemDistrict: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  itemScore: {
    fontSize: 20,
    fontWeight: '900',
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  itemMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  itemMeta: {
    fontSize: 11,
  },
});

export default HealthScoreScreen;
