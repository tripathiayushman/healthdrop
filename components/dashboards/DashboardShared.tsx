// =====================================================
// SHARED DASHBOARD COMPONENTS — POLISHED v2
// Gradient headers, animated stat cards, alert cards,
// tool cards, quick actions — used by all role dashboards
// =====================================================
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { Profile } from '../../types';

// ─────────────────────────────────────────────────────
//  Role design tokens
// ─────────────────────────────────────────────────────
export const ROLE_GRADIENTS: Record<string, [string, string, string]> = {
  super_admin:      ['#0F172A', '#1E3A5F', '#1976D2'],
  health_admin:     ['#0D3B2E', '#0F5132', '#00897B'],
  clinic:           ['#1A1033', '#2D1B69', '#6D28D9'],
  asha_worker:      ['#2D1B0E', '#7C2D12', '#EA580C'],
  volunteer:        ['#0A2E1A', '#14532D', '#16A34A'],
  district_officer: ['#1E1B4B', '#312E81', '#4338CA'],
};

export const ROLE_ACCENT: Record<string, string> = {
  super_admin:      '#42A5F5',
  health_admin:     '#26A69A',
  clinic:           '#A78BFA',
  asha_worker:      '#FB923C',
  volunteer:        '#4ADE80',
  district_officer: '#818CF8',
};

const ROLE_LABEL: Record<string, string> = {
  super_admin:      'Super Administrator',
  health_admin:     'Health Administrator',
  clinic:           'Clinic Staff',
  asha_worker:      'ASHA Worker',
  volunteer:        'Community Volunteer',
  district_officer: 'District Officer',
};

const ROLE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  super_admin:      'shield-checkmark',
  health_admin:     'medkit',
  clinic:           'medical',
  asha_worker:      'heart',
  volunteer:        'hand-left',
  district_officer: 'business',
};

// ─────────────────────────────────────────────────────
//  DashboardHeader — animated gradient with role badge
// ─────────────────────────────────────────────────────
interface HeaderProps { profile: Profile; subtitle?: string }

export const DashboardHeader: React.FC<HeaderProps> = ({ profile, subtitle }) => {
  const role   = profile.role ?? 'volunteer';
  const gradient = ROLE_GRADIENTS[role] ?? ROLE_GRADIENTS.volunteer;
  const accent   = ROLE_ACCENT[role]    ?? '#4ADE80';
  const greeting = getGreeting();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 500, useNativeDriver: false }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: false }),
    ]).start();
  }, []);

  return (
    <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
      {/* Decorative blobs */}
      <View style={[styles.blob1, { backgroundColor: accent + '20' }]} />
      <View style={[styles.blob2, { backgroundColor: accent + '12' }]} />
      <View style={[styles.blob3, { backgroundColor: accent + '08' }]} />

      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        {/* Role badge */}
        <View style={[styles.rolePill, { backgroundColor: accent + '28', borderColor: accent + '55' }]}>
          <Ionicons name={ROLE_ICON[role]} size={11} color={accent} />
          <Text style={[styles.rolePillText, { color: accent }]}>{ROLE_LABEL[role]}</Text>
        </View>

        <Text style={styles.greeting}>{greeting},</Text>
        <Text style={styles.userName} numberOfLines={1}>
          {profile.full_name || 'User'} 👋
        </Text>

        {(subtitle || profile.district) && (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.6)" />
            <Text style={styles.locationText}>
              {subtitle ?? `${profile.district}${profile.state ? `, ${profile.state}` : ''}`}
            </Text>
          </View>
        )}
      </Animated.View>
    </LinearGradient>
  );
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─────────────────────────────────────────────────────
//  Section wrapper
// ─────────────────────────────────────────────────────
interface SectionProps {
  title?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
  style?: ViewStyle;
}

export const Section: React.FC<SectionProps> = ({ title, action, children, style }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, style]}>
      {title && (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
          {action && (
            <TouchableOpacity onPress={action.onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.sectionAction, { color: colors.primary }]}>{action.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {children}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  StatCard — animated count-up feel
// ─────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number | string;
  icon: string;
  color: string;
  iconFamily?: 'ionicons' | 'material';
  onPress?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, icon, color, iconFamily = 'ionicons', onPress }) => {
  const { colors, isDark } = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 7 }).start();
  }, []);

  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Animated.View style={[{ flex: 1 }, { transform: [{ scale: scaleAnim }] }]}>
      <Wrapper
        style={[styles.statCard, {
          backgroundColor: colors.card,
          borderColor: isDark ? colors.border : color + '25',
          borderTopWidth: 3, borderTopColor: color,
        }]}
        onPress={onPress}
        activeOpacity={0.75}
      >
        <View style={[styles.statIconWrap, { backgroundColor: color + '18' }]}>
          {iconFamily === 'material'
            ? <MaterialCommunityIcons name={icon as any} size={20} color={color} />
            : <Ionicons name={icon as any} size={20} color={color} />
          }
        </View>
        <Text style={[styles.statValue, { color }]}>{value}</Text>
        <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={2}>{label}</Text>
      </Wrapper>
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────
//  QuickActionBtn
// ─────────────────────────────────────────────────────
interface QuickActionProps {
  icon: string;
  label: string;
  color: string;
  iconFamily?: 'ionicons' | 'material';
  onPress: () => void;
}

export const QuickActionBtn: React.FC<QuickActionProps> = ({ icon, label, color, iconFamily = 'ionicons', onPress }) => {
  const { colors } = useTheme();
  const pressAnim = useRef(new Animated.Value(1)).current;

  const onPressIn  = () => Animated.spring(pressAnim, { toValue: 0.93, useNativeDriver: false, tension: 120 }).start();
  const onPressOut = () => Animated.spring(pressAnim, { toValue: 1, useNativeDriver: false, tension: 80  }).start();

  return (
    <Animated.View style={[{ flex: 1 }, { transform: [{ scale: pressAnim }] }]}>
      <TouchableOpacity
        style={[styles.qaBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={[styles.qaIcon, { backgroundColor: color + '18' }]}>
          {iconFamily === 'material'
            ? <MaterialCommunityIcons name={icon as any} size={24} color={color} />
            : <Ionicons name={icon as any} size={24} color={color} />
          }
        </View>
        <Text style={[styles.qaLabel, { color: colors.text }]} numberOfLines={2}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ─────────────────────────────────────────────────────
//  Urgency mapper
// ─────────────────────────────────────────────────────
export const urgencyColor = (u: string): string => {
  switch (u?.toLowerCase()) {
    case 'critical': return '#DC2626';
    case 'high':     return '#EA580C';
    case 'medium':   return '#F59E0B';
    case 'low':      return '#10B981';
    default:         return '#6B7280';
  }
};

// ─────────────────────────────────────────────────────
//  AlertCard — severity-coded left border
// ─────────────────────────────────────────────────────
interface AlertCardProps {
  alert: {
    id: string;
    title: string;
    urgency_level: string;
    location_name: string;
    district: string;
    created_at: string;
    description: string;
    alert_type?: string;
  };
  onPress: () => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, onPress }) => {
  const { colors } = useTheme();
  const uc = urgencyColor(alert.urgency_level);

  return (
    <TouchableOpacity
      style={[styles.alertCard, {
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderLeftColor: uc,
      }]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      {/* Urgency header row */}
      <View style={styles.alertHeader}>
        <View style={[styles.urgencyPill, { backgroundColor: uc + '20' }]}>
          <View style={[styles.urgencyDot, { backgroundColor: uc }]} />
          <Text style={[styles.urgencyText, { color: uc }]}>{alert.urgency_level?.toUpperCase()}</Text>
        </View>
        <Text style={[styles.alertTime, { color: colors.textSecondary }]}>
          {new Date(alert.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </Text>
      </View>

      <Text style={[styles.alertTitle, { color: colors.text }]} numberOfLines={2}>{alert.title}</Text>
      <Text style={[styles.alertDesc, { color: colors.textSecondary }]} numberOfLines={2}>{alert.description}</Text>

      <View style={styles.alertFooter}>
        <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
        <Text style={[styles.alertLocation, { color: colors.textSecondary }]} numberOfLines={1}>
          {alert.location_name ? `${alert.location_name}, ` : ''}{alert.district}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────
//  ToolCard — icon + title + subtitle + chevron
// ─────────────────────────────────────────────────────
interface ToolCardProps {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: number;
}

export const ToolCard: React.FC<ToolCardProps> = ({ icon, iconColor, title, subtitle, onPress, badge }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.toolCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.toolIcon, { backgroundColor: iconColor + '18' }]}>
        <Ionicons name={icon as any} size={26} color={iconColor} />
        {badge !== undefined && badge > 0 && (
          <View style={styles.toolBadge}>
            <Text style={styles.toolBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </View>
      <View style={styles.toolInfo}>
        <Text style={[styles.toolTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>{subtitle}</Text>
      </View>
      <View style={[styles.chevronWrap, { backgroundColor: colors.border + '60' }]}>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────
//  InfoBanner
// ─────────────────────────────────────────────────────
interface BannerProps { icon: string; color: string; text: string }

export const InfoBanner: React.FC<BannerProps> = ({ icon, color, text }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: color + '12', borderColor: color + '35' }]}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[styles.bannerText, { color: colors.text }]}>{text}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  EmptyState
// ─────────────────────────────────────────────────────
interface EmptyProps { icon: string; color: string; title: string; subtitle?: string }

export const EmptyState: React.FC<EmptyProps> = ({ icon, color, title, subtitle }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.emptyWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon as any} size={32} color={color} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  SectionDivider
// ─────────────────────────────────────────────────────
export const SectionDivider: React.FC = () => {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
};

// ─────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  /* ── Header ── */
  header: {
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  blob1: { position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: 90 },
  blob2: { position: 'absolute', bottom: -30, right: 30, width: 120, height: 120, borderRadius: 60 },
  blob3: { position: 'absolute', top: 20, right: 100, width: 60, height: 60, borderRadius: 30 },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1,
    marginBottom: 14,
  },
  rolePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  greeting: { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginBottom: 2 },
  userName: { fontSize: 26, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.6, marginBottom: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },

  /* ── Section ── */
  section: { paddingHorizontal: 16, marginBottom: 6 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  sectionAction: { fontSize: 13, fontWeight: '600' },

  /* ── Stat card ── */
  statCard: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3,
  },
  statIconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 24, fontWeight: '800', marginBottom: 2 },
  statLabel: { fontSize: 11, textAlign: 'center', fontWeight: '500', lineHeight: 15 },

  /* ── Quick action ── */
  qaBtn: {
    borderRadius: 14, borderWidth: 1,
    paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  qaIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 15 },

  /* ── Alert card ── */
  alertCard: {
    borderRadius: 12, borderWidth: 1, borderLeftWidth: 4,
    padding: 13, marginBottom: 9,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  urgencyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  urgencyDot: { width: 6, height: 6, borderRadius: 3 },
  urgencyText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  alertTime: { fontSize: 11 },
  alertTitle: { fontSize: 14, fontWeight: '700', lineHeight: 20, marginBottom: 4 },
  alertDesc: { fontSize: 12, lineHeight: 17, marginBottom: 7 },
  alertFooter: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  alertLocation: { fontSize: 11, flex: 1 },

  /* ── Tool card ── */
  toolCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 5, elevation: 2,
  },
  toolIcon: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  toolBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#DC2626', borderRadius: 8,
    paddingHorizontal: 4, paddingVertical: 1, minWidth: 18, alignItems: 'center',
  },
  toolBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  toolInfo: { flex: 1 },
  toolTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  toolSubtitle: { fontSize: 12, lineHeight: 17 },
  chevronWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  /* ── Banner ── */
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },

  /* ── Empty ── */
  emptyWrap: {
    alignItems: 'center', borderRadius: 14, borderWidth: 1,
    padding: 24, marginBottom: 8,
  },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

  /* ── Divider ── */
  divider: { height: 1, marginHorizontal: 16, marginVertical: 4 },
});
