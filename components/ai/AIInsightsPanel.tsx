// =====================================================
// AI INSIGHTS PANEL — Polished v2
// No Gemini tag, no emojis — Ionicons only
// =====================================================
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { getAIInsights, AIInsight, InsightContext, InsightScope } from '../../lib/services/gemini';

interface AIInsightsPanelProps { profile: Profile }

interface RawAlert    { title: string; urgency_level: string; disease_or_issue?: string; description: string; district: string }
interface RawDisease  { disease_name?: string; severity?: string; district: string; symptoms?: string }
interface RawWater    { overall_quality?: string; ph_level?: number; source_name?: string; district: string }

// Scope icon mapping (Ionicons)
const SCOPE_ICON: Record<InsightScope, keyof typeof Ionicons.glyphMap> = {
  district: 'location',
  state:    'map',
  global:   'globe-outline',
};
const SCOPE_LABEL: Record<InsightScope, (d?: string, s?: string) => string> = {
  district: (d) => d || 'Your District',
  state:    (_, s) => s || 'Your State',
  global:   () => 'General Health',
};

export const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({ profile }) => {
  const { colors, isDark } = useTheme();
  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<InsightScope>('global');

  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Shimmer while loading
  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, { toValue: 1, duration: 850, useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0, duration: 850, useNativeDriver: true }),
        ])
      ).start();
    } else {
      shimmerAnim.setValue(0);
    }
  }, [loading]);

  const loadInsights = async () => {
    setLoading(true);
    setExpanded(false);
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

      const inDistrict = (items: { district: string }[]) =>
        items.some(i => district && i.district?.toLowerCase() === district.toLowerCase());

      let detectedScope: InsightScope = 'global';
      let ctx: InsightContext;

      if (district && (inDistrict(allAlerts) || inDistrict(allDisease) || inDistrict(allWater))) {
        detectedScope = 'district';
        ctx = {
          scope: 'district', userDistrict: district, userState: state,
          alerts: allAlerts.filter(a => a.district?.toLowerCase() === district.toLowerCase()),
          diseaseReports: allDisease.filter(r => r.district?.toLowerCase() === district.toLowerCase()),
          waterReports: allWater.filter(r => r.district?.toLowerCase() === district.toLowerCase()),
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
    } catch {
      setInsight(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInsights(); }, [profile.district, profile.state]);

  const toggleExpand = () => setExpanded(v => !v);

  // Declare these first (used by both glass vars and JSX below)
  const accentColor = insight?.accentColor || colors.primary;
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });

  // Glass card — darker, more opaque so text is clearly readable on black bg
  const glassStyle: any = isDark && Platform.OS === 'web'
    ? { backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }
    : {};
  const cardBg = isDark ? 'rgba(18,18,22,0.88)' : '#FFFFFF';
  const cardBorder = isDark ? 'rgba(255,255,255,0.12)' : (accentColor + '30');
  const cardTopBorder = accentColor;

  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={[styles.sectionIconWrap, { backgroundColor: accentColor + '18' }]}>
            <MaterialCommunityIcons name="brain" size={16} color={accentColor} />
          </View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Health Insights</Text>
        </View>
        <TouchableOpacity onPress={loadInsights} disabled={loading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh" size={17} color={loading ? colors.textSecondary : colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={[styles.card, glassStyle, {
        backgroundColor: cardBg,
        borderColor: cardBorder,
        borderTopColor: cardTopBorder,
      }]}>
        {/* Subtle gradient overlay for depth */}
        {isDark && (
          <LinearGradient
            colors={['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.00)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}
        {/* Scope badge row */}
        <View style={styles.scopeRow}>
          <View style={[styles.scopeBadge, { backgroundColor: accentColor + '15' }]}>
            <Ionicons name={SCOPE_ICON[scope]} size={11} color={accentColor} />
            <Text style={[styles.scopeText, { color: accentColor }]}>
              {SCOPE_LABEL[scope](profile.district, profile.state)}
            </Text>
          </View>
        </View>

        {loading ? (
          /* Skeleton shimmer */
          <Animated.View style={{ opacity: shimmerOpacity }}>
            <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '80%' }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '95%', marginTop: 8 }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '65%', marginTop: 6 }]} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              {[1, 2, 3].map(i => <View key={i} style={[styles.skeletonChip, { backgroundColor: colors.border }]} />)}
            </View>
          </Animated.View>
        ) : insight ? (
          <>
            {/* Headline */}
            <Text style={[styles.headline, { color: isDark ? '#E0E0F0' : colors.text }]}>
              {insight.headline}
            </Text>

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
                  <View style={[styles.tipDot, { backgroundColor: accentColor }]} />
                  <Text style={[styles.tipText, { color: isDark ? '#C0C0D0' : colors.text }]}>
                    {tip}
                  </Text>
                </View>
              ))}
            </View>

            {/* Expand toggle */}
            <TouchableOpacity onPress={toggleExpand} style={styles.expandBtn}>
              <Text style={[styles.expandText, { color: accentColor }]}>
                {expanded ? 'Show less' : 'Read more'}
              </Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={accentColor} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.errorState}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.textSecondary} />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              Could not load insights. Tap refresh to retry.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginBottom: 4, paddingHorizontal: 16 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8, marginTop: 6,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },

  card: {
    borderRadius: 14, borderWidth: 1, borderTopWidth: 3,
    padding: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },

  scopeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  scopeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  scopeText: { fontSize: 11, fontWeight: '700' },

  headline: { fontSize: 16, fontWeight: '700', lineHeight: 22, marginBottom: 7 },
  body: { fontSize: 13, lineHeight: 20, marginBottom: 12 },

  tips: { gap: 7 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  tipText: { fontSize: 13, lineHeight: 20, flex: 1 },

  expandBtn: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  expandText: { fontSize: 13, fontWeight: '600' },

  skeletonLine: { height: 13, borderRadius: 7 },
  skeletonChip: { height: 26, borderRadius: 8, width: 80 },

  errorState: { alignItems: 'center', paddingVertical: 14, gap: 8 },
  errorText: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});

export default AIInsightsPanel;
