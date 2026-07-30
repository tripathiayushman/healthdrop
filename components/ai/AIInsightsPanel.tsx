// =====================================================
// AI INSIGHTS PANEL — "Prakash" design system.
// Indigo = intelligence: the insight card carries a 3px
// colors.ai left tick + an "AI" Eyebrow micro-badge on
// aiBg. Four-state data regions (skeleton / content /
// quiet zero / error-with-retry). Token colors only —
// service-provided accentColor hexes are ignored.
// =====================================================
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile, TrendData } from '../../types';
import { getAIInsights, AIInsight, InsightContext, InsightScope } from '../../lib/services/gemini';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import { SkeletonBlock, ErrorCard, EmptyState } from '../dashboards/DashboardShared';
import TrendChart from '../charts/TrendChart';

interface AIInsightsPanelProps { profile: Profile }

interface RawAlert    { title: string; urgency_level: string; disease_or_issue?: string; description: string; district: string }
interface RawDisease  { disease_name?: string; severity?: string; district: string; symptoms?: string }
interface RawWater    { overall_quality?: string; ph_level?: number; source_name?: string; district: string }
interface TrendSourceRow {
  created_at: string;
  cases_count?: number | null;
  district?: string | null;
}

const DISTRICT_SCOPED_ROLES: Profile['role'][] = ['district_officer', 'clinic', 'asha_worker', 'volunteer'];

// Scope icon mapping (Ionicons, outline at rest)
const SCOPE_ICON: Record<InsightScope, keyof typeof Ionicons.glyphMap> = {
  district: 'location-outline',
  state:    'map-outline',
  global:   'globe-outline',
};
const SCOPE_LABEL: Record<InsightScope, (d?: string, s?: string) => string> = {
  district: (d) => d || 'Your District',
  state:    (_, s) => s || 'Your State',
  global:   () => 'General Health',
};

const INSIGHTS_CACHE_PREFIX = 'healthdrop:ai-insights';

interface CachedInsightPayload {
  insight: AIInsight;
  scope: InsightScope;
  savedAt: string;
}

const getInsightsCacheKey = (profile: Profile): string => {
  const userId = profile.id || 'unknown';
  const district = (profile.district || 'none').toLowerCase();
  const state = (profile.state || 'none').toLowerCase();
  return `${INSIGHTS_CACHE_PREFIX}:${userId}:${district}:${state}`;
};

const formatShortDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

export const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({ profile }) => {
  const { colors, isDark } = useTheme();
  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [insightError, setInsightError] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<InsightScope>('global');
  const [trendData, setTrendData] = useState<TrendData[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(false);

  const loadInsights = async () => {
    setLoading(true);
    setInsightError(false);
    setExpanded(false);
    const cacheKey = getInsightsCacheKey(profile);
    try {
      const district = profile.district;
      const state    = profile.state;

      const [alertsRes, diseaseRes, waterRes] = await Promise.allSettled([
        supabase.from('health_alerts').select('title,urgency_level,disease_or_issue,description,district').eq('status', 'active').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(10),
        supabase.from('disease_reports').select('disease_name,severity,district,symptoms').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(10),
        supabase.from('water_quality_reports').select('overall_quality,ph_level,source_name,district').eq('approval_status', 'approved').order('created_at', { ascending: false }).limit(10),
      ]);

      const allAlerts:  RawAlert[]   = alertsRes.status  === 'fulfilled' ? alertsRes.value.data  || [] : [];
      const allDisease: RawDisease[] = diseaseRes.status === 'fulfilled' ? diseaseRes.value.data || [] : [];
      const allWater:   RawWater[]   = waterRes.status   === 'fulfilled' ? waterRes.value.data   || [] : [];
      const visibleAlerts = filterAlertsForProfile(allAlerts, profile);
      const visibleDisease = filterAlertsForProfile(allDisease, profile);
      const visibleWater = filterAlertsForProfile(allWater, profile);

      let detectedScope: InsightScope = 'global';
      let ctx: InsightContext;

      if (district && (visibleAlerts.length || visibleDisease.length || visibleWater.length)) {
        detectedScope = 'district';
        ctx = {
          scope: 'district', userDistrict: district, userState: state,
          alerts: visibleAlerts,
          diseaseReports: visibleDisease,
          waterReports: visibleWater,
        };
      } else if (state && (allAlerts.length || allDisease.length || allWater.length)) {
        detectedScope = 'state';
        ctx = {
          scope: 'state', userDistrict: district, userState: state,
          alerts: allAlerts.slice(0, 3), diseaseReports: allDisease.slice(0, 3), waterReports: allWater.slice(0, 3),
        };
      } else {
        detectedScope = 'global';
        ctx = { scope: 'global', userDistrict: district, userState: state, alerts: [], diseaseReports: [], waterReports: [] };
      }

      setScope(detectedScope);
      const result = await getAIInsights(ctx);
      setInsight(result);
      setCachedAt(null);

      const cachePayload: CachedInsightPayload = {
        insight: result,
        scope: detectedScope,
        savedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(cacheKey, JSON.stringify(cachePayload));
    } catch {
      // Fetch failed — fall back to the cached insight (marked as-of),
      // otherwise surface an explicit error state. Never a silent zero.
      try {
        const cachedRaw = await AsyncStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as CachedInsightPayload;
          if (cached?.insight) {
            setInsight(cached.insight);
            setScope(cached.scope || 'global');
            setCachedAt(cached.savedAt || null);
          } else {
            setInsight(null);
            setInsightError(true);
          }
        } else {
          setInsight(null);
          setInsightError(true);
        }
      } catch {
        setInsight(null);
        setInsightError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadTrendData = async () => {
    setTrendLoading(true);
    setTrendError(false);
    try {
      const useDistrictScope = DISTRICT_SCOPED_ROLES.includes(profile.role);
      const district = (profile.district || '').trim();

      let trendQuery = supabase
        .from('disease_reports')
        .select('created_at,cases_count,district')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(500);

      if (useDistrictScope && district && district.toLowerCase() !== 'not specified') {
        trendQuery = trendQuery.eq('district', district);
      }

      const { data, error } = await trendQuery;
      if (error) {
        setTrendData([]);
        setTrendError(true);
        return;
      }
      if (!data) {
        setTrendData([]);
        return;
      }

      const rows = data as TrendSourceRow[];
      const dailyTotals = new Map<string, number>();

      rows.forEach((row) => {
        const dayKey = String(row.created_at || '').slice(0, 10);
        if (!dayKey) return;

        const count = typeof row.cases_count === 'number' && Number.isFinite(row.cases_count)
          ? Math.max(0, row.cases_count)
          : 0;

        dailyTotals.set(dayKey, (dailyTotals.get(dayKey) ?? 0) + count);
      });

      const sortedSeries = Array.from(dailyTotals.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(-14);

      const chartRows: TrendData[] = sortedSeries.map(([reportDate, totalCases], index) => {
        const movingWindow = sortedSeries.slice(Math.max(0, index - 2), index + 1);
        const movingAverage = movingWindow.reduce((sum, [, value]) => sum + value, 0) / movingWindow.length;
        const previousCases = index > 0 ? sortedSeries[index - 1][1] : totalCases;

        return {
          district: useDistrictScope && district ? district : 'All Districts',
          disease_name: 'All Diseases',
          report_date: reportDate,
          total_cases: totalCases,
          moving_avg: Number.isFinite(movingAverage) ? Math.round(movingAverage) : totalCases,
          prev_cases: previousCases,
        };
      });

      setTrendData(chartRows);
    } catch {
      setTrendData([]);
      setTrendError(true);
    } finally {
      setTrendLoading(false);
    }
  };

  const refreshPanel = () => {
    loadInsights();
    loadTrendData();
  };

  useEffect(() => {
    loadInsights();
    loadTrendData();
  }, [profile.role, profile.district, profile.state]);

  const toggleExpand = () => setExpanded(v => !v);

  const refreshBusy = loading || trendLoading;
  const actionColor = isDark ? colors.primary : colors.primaryDark;
  const trendScopeLabel = DISTRICT_SCOPED_ROLES.includes(profile.role) && profile.district
    ? `${profile.district} district trend (last 14 days)`
    : 'All districts trend (last 14 days)';

  return (
    <View style={styles.section}>
      {/* Eyebrow section header + Refresh action link */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} numberOfLines={1}>
          AI Health Insights
        </Text>
        <Pressable
          onPress={refreshPanel}
          disabled={refreshBusy}
          accessibilityRole="button"
          accessibilityLabel="Refresh insights"
          accessibilityState={{ disabled: refreshBusy }}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={[styles.sectionAction, { color: refreshBusy ? colors.textTertiary : actionColor }]}>
            Refresh
          </Text>
        </Pressable>
      </View>

      {/* ── Insight region: skeleton / error / content / quiet zero ── */}
      {loading ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.ai },
            !isDark && styles.cardShadow,
          ]}
        >
          <View style={styles.badgeRow}>
            <SkeletonBlock width={44} height={20} />
            <SkeletonBlock width={120} height={20} />
          </View>
          <SkeletonBlock width="70%" height={16} style={{ marginTop: spacing.md }} />
          <SkeletonBlock width="100%" height={14} style={{ marginTop: spacing.md }} />
          <SkeletonBlock width="90%" height={14} style={{ marginTop: spacing.sm }} />
          <SkeletonBlock width="80%" height={14} style={{ marginTop: spacing.md }} />
          <SkeletonBlock width="75%" height={14} style={{ marginTop: spacing.sm }} />
          <SkeletonBlock width="82%" height={14} style={{ marginTop: spacing.sm }} />
        </View>
      ) : insightError ? (
        <ErrorCard message="Couldn't load insights — check connection" onRetry={loadInsights} />
      ) : insight ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.ai },
            !isDark && styles.cardShadow,
          ]}
        >
          {/* "AI" Eyebrow micro-badge on aiBg + scope pill */}
          <View style={styles.badgeRow}>
            <View style={[styles.aiBadge, { backgroundColor: colors.aiBg }]}>
              <Text style={[styles.aiBadgeText, { color: colors.ai }]} maxFontSizeMultiplier={1.3}>
                AI
              </Text>
            </View>
            <View style={[styles.scopeBadge, { backgroundColor: colors.surfaceVariant }]}>
              <Ionicons name={SCOPE_ICON[scope]} size={12} color={colors.textSecondary} />
              <Text
                style={[styles.scopeText, { color: colors.textSecondary }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {SCOPE_LABEL[scope](profile.district, profile.state)}
              </Text>
            </View>
          </View>

          {/* Headline */}
          <Text style={[styles.headline, { color: colors.text }]}>{insight.headline}</Text>

          {/* Body */}
          <Text
            numberOfLines={expanded ? undefined : 2}
            style={[styles.body, { color: colors.textSecondary }]}
          >
            {insight.body}
          </Text>

          {/* Tips */}
          <View style={styles.tips}>
            {insight.tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <View style={[styles.tipDot, { backgroundColor: colors.ai }]} />
                <Text style={[styles.tipText, { color: colors.text }]}>{tip}</Text>
              </View>
            ))}
          </View>

          {/* Expand toggle */}
          <Pressable
            onPress={toggleExpand}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less' : 'Read more'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.expandBtn}
          >
            <Text style={[styles.expandText, { color: actionColor }]}>
              {expanded ? 'Show less' : 'Read more'}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={actionColor} />
          </Pressable>

          {/* As-of caption when serving a cached insight */}
          {cachedAt && (
            <View style={styles.asOfRow}>
              <Ionicons name="time-outline" size={16} color={colors.textTertiary} />
              <Text style={[styles.asOfText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                {`Saved on phone · ${formatShortDateTime(cachedAt)}`}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <EmptyState
          icon="checkmark-circle-outline"
          color={colors.success}
          title="All quiet — no insights right now"
          subtitle="Tap Refresh to check again."
        />
      )}

      {/* ── Disease trend card ── */}
      <View
        style={[
          styles.trendCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          !isDark && styles.cardShadow,
        ]}
      >
        <View style={styles.trendHeaderRow}>
          <View style={[styles.trendIconWrap, { backgroundColor: colors.primary + '14' }]}>
            <Ionicons name="stats-chart-outline" size={24} color={colors.primary} />
          </View>
          <View style={styles.trendTitleWrap}>
            <Text style={[styles.trendTitle, { color: colors.text }]}>Disease Trend</Text>
            <Text style={[styles.trendSubtitle, { color: colors.textSecondary }]}>{trendScopeLabel}</Text>
          </View>
        </View>

        {trendLoading ? (
          <View>
            <SkeletonBlock width="100%" height={180} />
            <SkeletonBlock width="60%" height={12} style={{ marginTop: spacing.sm }} />
          </View>
        ) : trendError ? (
          <ErrorCard message="Couldn't load trend data — check connection" onRetry={loadTrendData} />
        ) : (
          /* TrendChart renders its own quiet zero when there are no points */
          <TrendChart data={trendData} maxPoints={10} />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  /* ── Light-mode-only shadow (single recipe) ── */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  section: { paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md, marginTop: spacing.sm, minHeight: 20,
  },
  sectionTitle: {
    fontSize: 12, lineHeight: 16, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1,
  },
  sectionAction: { fontSize: 13, lineHeight: 18, fontWeight: '700' },

  /* ── Insight card — 3px ai left tick, 1px border ── */
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: spacing.lg,
  },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  aiBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  aiBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  scopeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    flexShrink: 1,
  },
  scopeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },

  headline: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginBottom: spacing.md },

  tips: { gap: spacing.sm },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  tipDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, flexShrink: 0 },
  tipText: { fontSize: 15, lineHeight: 22, fontWeight: '500', flex: 1 },

  expandBtn: {
    marginTop: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  expandText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },

  asOfRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  asOfText: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  /* ── Trend card ── */
  trendCard: {
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  trendHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  trendIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendTitleWrap: { flex: 1 },
  trendTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  trendSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },
});

export default AIInsightsPanel;
