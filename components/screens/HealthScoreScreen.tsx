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
import { Profile, DistrictHealthRanking } from '../../types';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import { getDistrictHealthRanking } from '../../lib/services/advancedAnalytics';

interface HealthScoreScreenProps {
  profile: Profile;
  onBack: () => void;
}

const scoreColor = (value: number, t: Theme): string => {
  if (value >= 80) return t.success;
  if (value >= 60) return t.info;
  if (value >= 40) return t.warning;
  return t.danger;
};

const scoreBg = (value: number, t: Theme): string => {
  if (value >= 80) return t.successBg;
  if (value >= 60) return t.infoBg;
  if (value >= 40) return t.warningBg;
  return t.dangerBg;
};

const HealthScoreScreen: React.FC<HealthScoreScreenProps> = ({ profile, onBack }) => {
  const { colors, isDark } = useTheme();
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
    } catch {
      setError("Couldn't load district health scores — check connection.");
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

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
          <Text style={[styles.headerTitle, { color: headerText }]}>District Health Score</Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]}>Risk ranking, outbreaks, and response health indicators</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {districtSummary && !loading && (
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: scoreColor(districtSummary.health_score, colors) },
              !isDark && styles.cardShadow,
            ]}
            accessible
            accessibilityLabel={`Your district health score: ${Math.round(districtSummary.health_score)}, risk rank ${districtSummary.risk_rank}`}
          >
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>YOUR DISTRICT HEALTH SCORE</Text>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryScore, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {Math.round(districtSummary.health_score)}
              </Text>
              <View style={[styles.rankPill, { backgroundColor: scoreBg(districtSummary.health_score, colors) }]}>
                <Text
                  style={[styles.rankText, { color: scoreColor(districtSummary.health_score, colors) }]}
                  maxFontSizeMultiplier={1.3}
                >
                  RISK RANK #{districtSummary.risk_rank}
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
          <View style={{ gap: 12 }}>
            <SkeletonBlock height={132} radius={12} />
            <SkeletonBlock height={96} radius={12} />
            <SkeletonBlock height={96} radius={12} />
            <SkeletonBlock height={96} radius={12} />
          </View>
        ) : error ? (
          <ErrorCard message={error} onRetry={loadScores} />
        ) : scores.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            color={colors.success}
            title="No health scores yet"
            subtitle="No district health score records are available for your visible scope."
          />
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                DISTRICT RANKING
                <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${scores.length}`}</Text>
              </Text>
            </View>
            {scores.map((item) => {
              const color = scoreColor(item.health_score, colors);
              return (
                <View
                  key={`${item.district}-${item.risk_rank}`}
                  style={[
                    styles.itemCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    !isDark && styles.cardShadow,
                  ]}
                  accessible
                  accessibilityLabel={`${item.district}: health score ${Math.round(item.health_score)}, rank ${item.risk_rank}`}
                >
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemDistrict, { color: colors.text }]} numberOfLines={1}>
                      {item.district}
                    </Text>
                    <Text style={[styles.itemScore, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {Math.round(item.health_score)}
                    </Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.surfaceVariant }]}>
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
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    // Rendered inside MainApp's SafeAreaView — no status-bar inset here.
    paddingTop: 12,
    paddingBottom: 12,
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 20,
    marginBottom: 12,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summaryCard: {
    borderWidth: 1,
    borderTopWidth: 3,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summaryRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  summaryScore: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  rankPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rankText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  summaryMetrics: {
    marginTop: 8,
    gap: 4,
  },
  summaryMetric: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  itemDistrict: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  itemScore: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
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
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});

export default HealthScoreScreen;
