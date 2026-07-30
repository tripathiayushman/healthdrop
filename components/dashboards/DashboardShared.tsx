// =====================================================
// SHARED DASHBOARD COMPONENTS — "Prakash" design system
// Flat headerBg header + Role Ribbon, Big Number stat
// cards, eyebrow section headers, directive-first alert
// cards, skeleton / error / quiet-zero states, Sync
// Pebble — used by all role dashboards.
// =====================================================
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable,
  Animated, ViewStyle, StyleProp, DimensionValue, Modal, ScrollView, Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTheme, Theme, themes, radii, spacing } from '../../lib/ThemeContext';
import { useSyncCounts } from '../../src/services/offlineSync';
import { Profile } from '../../types';

// ─────────────────────────────────────────────────────
//  Role design tokens
//  The role accent appears in exactly two places per
//  screen: the 4px Role Ribbon and the avatar/badge ring.
// ─────────────────────────────────────────────────────
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
  super_admin:      'shield-checkmark-outline',
  health_admin:     'medkit-outline',
  clinic:           'medical-outline',
  asha_worker:      'heart-outline',
  volunteer:        'hand-left-outline',
  district_officer: 'business-outline',
};

const WEB_NO_SELECT = Platform.OS === 'web' ? ({ userSelect: 'none' } as any) : null;

// ─────────────────────────────────────────────────────
//  Severity / water-quality helpers — token-driven.
//  Water vocab: safe/moderate/unsafe/critical, plus
//  legacy 'poor' → unsafe and 'contaminated' → critical.
// ─────────────────────────────────────────────────────
export function getSeverityColor(severity: string, themeColors?: Theme): string {
  const t = themeColors ?? themes.light;
  switch (severity?.toLowerCase()) {
    case 'critical': return t.severityCritical;
    case 'high':     return t.severityHigh;
    case 'medium':   return t.severityMedium;
    case 'low':      return t.severityLow;
    default:         return t.textSecondary;
  }
}

export function getWaterQualityColor(quality: string, themeColors?: Theme): string {
  const t = themeColors ?? themes.light;
  switch (quality?.toLowerCase()) {
    case 'safe':         return t.waterSafe;
    case 'moderate':     return t.waterModerate;
    case 'poor':
    case 'unsafe':       return t.waterUnsafe;
    case 'contaminated':
    case 'critical':     return t.waterCritical;
    default:             return t.textSecondary;
  }
}

/** Legacy alias kept for existing callers — reads theme tokens. */
export const urgencyColor = (u: string, themeColors?: Theme): string =>
  getSeverityColor(u, themeColors);

/** Matching soft background for a severity level (solid fill is CRITICAL's privilege). */
const severityBg = (level: string, t: Theme): string => {
  switch (level?.toLowerCase()) {
    case 'critical': return t.dangerBg;
    case 'high':     return t.offlineBg;   // saffron family
    case 'medium':   return t.warningBg;
    case 'low':      return t.successBg;
    default:         return t.surfaceVariant;
  }
};

const formatShortDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

// ─────────────────────────────────────────────────────
//  DashboardHeader — flat headerBg band + 4px Role Ribbon
// ─────────────────────────────────────────────────────
interface HeaderProps { profile: Profile; subtitle?: string }

export const DashboardHeader: React.FC<HeaderProps> = ({ profile, subtitle }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const role   = profile.role ?? 'volunteer';
  const accent = ROLE_ACCENT[role] ?? ROLE_ACCENT.volunteer;
  const greeting = getGreeting();

  const fadeAnim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      fadeAnim.setValue(1);
      return;
    }
    Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  // Navy band in light mode → white text; surface band in dark mode → ink text.
  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub  = isDark ? colors.textSecondary : colors.primaryLight;

  return (
    <View>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Role pill — Eyebrow type. Accent stays on the border/icon ring;
              the label renders in the guaranteed-contrast header ink (F17) —
              several ROLE_ACCENT hues fall below 4.5:1 on the navy band. */}
          <View style={[styles.rolePill, { borderColor: accent }]}>
            <Ionicons name={ROLE_ICON[role]} size={12} color={accent} />
            <Text style={[styles.rolePillText, { color: headerText }]} maxFontSizeMultiplier={1.3}>
              {ROLE_LABEL[role]}
            </Text>
          </View>

          <Text style={[styles.greeting, { color: headerSub }]}>{greeting}</Text>
          <Text style={[styles.userName, { color: headerText }]} numberOfLines={1}>
            {profile.full_name || 'User'}
          </Text>

          {(subtitle || profile.district) && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color={headerSub} />
              <Text style={[styles.locationText, { color: headerSub }]} numberOfLines={1}>
                {subtitle ?? `${profile.district}${profile.state ? `, ${profile.state}` : ''}`}
              </Text>
            </View>
          )}
        </Animated.View>
      </View>

      {/* Role Ribbon — the one surviving trace of the role identity */}
      <View style={[styles.roleRibbon, { backgroundColor: accent }]} />
    </View>
  );
};

function getGreeting(): string {
  return 'Welcome back';
}

// ─────────────────────────────────────────────────────
//  Section wrapper — eyebrow-and-count header
// ─────────────────────────────────────────────────────
interface SectionProps {
  title?: string;
  count?: number;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
  style?: ViewStyle;
}

export const Section: React.FC<SectionProps> = ({ title, count, action, children, style }) => {
  const { colors, isDark } = useTheme();
  return (
    <View style={[styles.section, style]}>
      {title && (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {title}
            {typeof count === 'number' && (
              <Text style={styles.sectionCount}>{` · ${count}`}</Text>
            )}
          </Text>
          {action && (
            <TouchableOpacity
              onPress={action.onPress}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Text style={[styles.sectionAction, { color: isDark ? colors.primary : colors.primaryDark }]}>
                {action.label}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {children}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  StatCard — Big Number Protocol
//  Tabular-nums ink value over a 13/700 label with a
//  3px semantic top rule. Two per row on phones.
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

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [
        styles.statCard,
        WEB_NO_SELECT,
        {
          backgroundColor: pressed && onPress ? colors.cardHover : colors.card,
          borderColor: colors.border,
          borderTopColor: color,
        },
        !isDark && styles.cardShadow,
      ]}
    >
      <View style={[styles.statIconWrap, { backgroundColor: color + '14' }]}>
        {iconFamily === 'material'
          ? <MaterialCommunityIcons name={icon as any} size={24} color={color} />
          : <Ionicons name={icon as any} size={24} color={color} />
        }
      </View>
      <Text
        style={[styles.statValue, { color: colors.text }]}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────
//  QuickActionBtn — flat card, background-change press
// ─────────────────────────────────────────────────────
interface QuickActionProps {
  icon: string;
  label: string;
  color: string;
  iconFamily?: 'ionicons' | 'material';
  onPress: () => void;
}

export const QuickActionBtn: React.FC<QuickActionProps> = ({ icon, label, color, iconFamily = 'ionicons', onPress }) => {
  const { colors, isDark } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.qaBtn,
        WEB_NO_SELECT,
        {
          backgroundColor: pressed ? colors.cardHover : colors.card,
          borderColor: colors.border,
        },
        !isDark && styles.cardShadow,
      ]}
    >
      <View style={[styles.qaIcon, { backgroundColor: color + '14' }]}>
        {iconFamily === 'material'
          ? <MaterialCommunityIcons name={icon as any} size={24} color={color} />
          : <Ionicons name={icon as any} size={24} color={color} />
        }
      </View>
      <Text style={[styles.qaLabel, { color: colors.text }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────
//  Severity pill — dot + UPPERCASE label on *Bg token.
//  Solid danger fill is CRITICAL's privilege alone.
// ─────────────────────────────────────────────────────
const SeverityPill: React.FC<{ level: string }> = ({ level }) => {
  const { colors } = useTheme();
  const key = level?.toLowerCase() ?? '';
  const isCritical = key === 'critical';
  const fg = isCritical ? colors.textInverse : getSeverityColor(key, colors);
  const bg = isCritical ? colors.danger : severityBg(key, colors);

  return (
    <View
      style={[styles.severityPill, { backgroundColor: bg }]}
      accessibilityLabel={`Urgency: ${key || 'unknown'}`}
    >
      {!isCritical && <View style={[styles.severityDot, { backgroundColor: fg }]} />}
      <Text style={[styles.severityPillText, { color: fg }]} maxFontSizeMultiplier={1.3}>
        {(level ?? '').toUpperCase()}
      </Text>
    </View>
  );
};

interface AlertCardProps {
  alert: {
    id: string;
    title: string;
    urgency_level: string;
    location_name: string;
    district: string;
    state?: string;
    created_at: string;
    description: string;
    alert_type?: string;
    disease_or_issue?: string;
    cases_reported?: number;
    affected_population?: number;
    immediate_actions?: string;
    precautionary_measures?: string;
  };
  onPress?: () => void;
}

// ─────────────────────────────────────────────────────
//  AlertCard — Status Is a Sentence.
//  Leads with the plain-language directive; 3px severity
//  left edge is the only structural color.
// ─────────────────────────────────────────────────────
export const AlertCard: React.FC<AlertCardProps> = ({ alert, onPress }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const sev = getSeverityColor(alert.urgency_level, colors);
  const [showDetail, setShowDetail] = useState(false);

  const handlePress = () => {
    setShowDetail(true);
    onPress?.();
  };

  return (
    <>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Alert, urgency ${alert.urgency_level}: ${alert.title}`}
        style={({ pressed }) => [
          styles.alertCard,
          WEB_NO_SELECT,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.border,
            borderLeftColor: sev,
          },
          !isDark && styles.cardShadow,
        ]}
      >
        {/* Severity + absolute-short timestamp */}
        <View style={styles.alertHeader}>
          <SeverityPill level={alert.urgency_level} />
          <Text style={[styles.alertTime, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            {formatShortDateTime(alert.created_at)}
          </Text>
        </View>

        {/* Plain-language directive first */}
        <Text style={[styles.alertTitle, { color: colors.text }]} numberOfLines={2}>{alert.title}</Text>
        <Text style={[styles.alertDesc, { color: colors.textSecondary }]} numberOfLines={2}>{alert.description}</Text>

        <View style={styles.alertFooter}>
          <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.alertLocation, { color: colors.textSecondary }]} numberOfLines={1}>
            {alert.location_name ? `${alert.location_name}, ` : ''}{alert.district}
          </Text>
          <View style={{ flex: 1 }} />
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </View>
      </Pressable>

      {/* Detail Modal — card-colored header, 3px severity top rule */}
      <Modal
        visible={showDetail}
        transparent
        animationType={reduceMotion ? 'none' : 'slide'}
        onRequestClose={() => setShowDetail(false)}
      >
        <View style={[adStyles.overlay, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setShowDetail(false)}
            accessibilityLabel="Close alert details"
          />
          <View style={[adStyles.sheet, { backgroundColor: colors.card }]}>
            {/* 3px severity top rule */}
            <View style={[adStyles.topRule, { backgroundColor: sev }]} />
            <View style={[adStyles.handle, { backgroundColor: colors.border }]} />

            {/* Header — card-colored, never flood-filled */}
            <View style={[adStyles.headerBlock, { borderBottomColor: colors.borderLight }]}>
              <View style={adStyles.headerRow}>
                <SeverityPill level={alert.urgency_level} />
                {alert.alert_type && (
                  <Text style={[adStyles.alertTypeText, { color: colors.textTertiary }]}>
                    {alert.alert_type.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={[adStyles.modalTitle, { color: colors.text }]} numberOfLines={3}>
                {alert.title}
              </Text>
              <TouchableOpacity
                style={[adStyles.closeBtn, { backgroundColor: colors.surfaceVariant }]}
                onPress={() => setShowDetail(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={adStyles.body} showsVerticalScrollIndicator={false}>
              <Text style={[adStyles.sectionLabel, { color: colors.textSecondary }]}>Description</Text>
              <Text style={[adStyles.bodyText, { color: colors.text }]}>{alert.description}</Text>

              {/* Key info grid — plain surface boxes */}
              <View style={adStyles.infoGrid}>
                <View style={[adStyles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                  <Text style={[adStyles.infoLabel, { color: colors.textSecondary }]}>Location</Text>
                  <Text style={[adStyles.infoValue, { color: colors.text }]} numberOfLines={2}>
                    {[alert.location_name, alert.district, alert.state].filter(Boolean).join(', ')}
                  </Text>
                </View>
                <View style={[adStyles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                  <Text style={[adStyles.infoLabel, { color: colors.textSecondary }]}>Date</Text>
                  <Text style={[adStyles.infoValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {formatShortDateTime(alert.created_at)}
                  </Text>
                </View>
                {alert.cases_reported !== null && alert.cases_reported !== undefined && (
                  <View style={[adStyles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
                    <Text style={[adStyles.infoLabel, { color: colors.textSecondary }]}>Cases</Text>
                    <Text style={[adStyles.infoValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {alert.cases_reported}
                    </Text>
                  </View>
                )}
                {alert.affected_population !== null && alert.affected_population !== undefined && (
                  <View style={[adStyles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Ionicons name="stats-chart-outline" size={16} color={colors.textSecondary} />
                    <Text style={[adStyles.infoLabel, { color: colors.textSecondary }]}>Affected</Text>
                    <Text style={[adStyles.infoValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {alert.affected_population}
                    </Text>
                  </View>
                )}
              </View>

              {alert.disease_or_issue && (
                <>
                  <Text style={[adStyles.sectionLabel, { color: colors.textSecondary }]}>Disease / Issue</Text>
                  <Text style={[adStyles.bodyText, { color: colors.text }]}>{alert.disease_or_issue}</Text>
                </>
              )}
              {alert.immediate_actions && (
                <>
                  <Text style={[adStyles.sectionLabel, { color: colors.textSecondary }]}>Immediate Actions</Text>
                  <Text style={[adStyles.bodyText, { color: colors.text }]}>{alert.immediate_actions}</Text>
                </>
              )}
              {alert.precautionary_measures && (
                <>
                  <Text style={[adStyles.sectionLabel, { color: colors.textSecondary }]}>Precautionary Measures</Text>
                  <Text style={[adStyles.bodyText, { color: colors.text }]}>{alert.precautionary_measures}</Text>
                </>
              )}
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
};

// ── AlertCard detail modal styles ────────────────
const adStyles = StyleSheet.create({
  overlay:       { flex: 1, justifyContent: 'flex-end' },
  sheet:         { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '88%', overflow: 'hidden' },
  topRule:       { height: 3, width: '100%' },
  handle:        { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.md, marginBottom: spacing.xs },
  headerBlock:   { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, paddingRight: 64, borderBottomWidth: 1 },
  headerRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  alertTypeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  modalTitle:    { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  closeBtn:      { position: 'absolute', top: spacing.sm, right: spacing.lg, width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  body:          { paddingHorizontal: spacing.lg },
  sectionLabel:  { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.xs },
  bodyText:      { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  infoGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  infoBox:       { width: '47%', borderRadius: radii.md, borderWidth: 1, padding: spacing.md, gap: spacing.xs },
  infoLabel:     { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  infoValue:     { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

// ─────────────────────────────────────────────────────
//  ToolCard — flat list row: icon + title + chevron
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
  const { colors, isDark } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge} pending` : title}
      style={({ pressed }) => [
        styles.toolCard,
        WEB_NO_SELECT,
        {
          backgroundColor: pressed ? colors.cardHover : colors.card,
          borderColor: colors.border,
        },
        !isDark && styles.cardShadow,
      ]}
    >
      <View style={[styles.toolIcon, { backgroundColor: iconColor + '14' }]}>
        <Ionicons name={icon as any} size={24} color={iconColor} />
        {badge !== undefined && badge > 0 && (
          <View style={[styles.toolBadge, { backgroundColor: colors.danger }]}>
            <Text style={[styles.toolBadgeText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.toolInfo}>
        <Text style={[styles.toolTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.toolSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    </Pressable>
  );
};

// ─────────────────────────────────────────────────────
//  InfoBanner — flat card with a 3px semantic left edge
// ─────────────────────────────────────────────────────
interface BannerProps { icon: string; color: string; text: string }

export const InfoBanner: React.FC<BannerProps> = ({ icon, color, text }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: color }]}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[styles.bannerText, { color: colors.text }]}>{text}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  EmptyState — the quiet zero: words on plain surface
// ─────────────────────────────────────────────────────
interface EmptyProps { icon: string; color: string; title: string; subtitle?: string }

export const EmptyState: React.FC<EmptyProps> = ({ icon, color, title, subtitle }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.emptyWrap, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <Ionicons name={icon as any} size={24} color={color || colors.success} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  SkeletonBlock — pulsing loading twin.
//  Shape it like the real content; hidden from a11y.
// ─────────────────────────────────────────────────────
interface SkeletonBlockProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonBlock: React.FC<SkeletonBlockProps> = ({
  width = '100%',
  height = 16,
  radius = radii.sm,
  style,
}) => {
  const { colors, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.skeleton, opacity: pulse },
        style,
      ]}
    />
  );
};

// ─────────────────────────────────────────────────────
//  ErrorCard — inline failed-fetch state with Retry.
//  Error ≠ empty; silent catch-and-show-zero is a bug.
// ─────────────────────────────────────────────────────
interface ErrorCardProps { message: string; onRetry: () => void }

export const ErrorCard: React.FC<ErrorCardProps> = ({ message, onRetry }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.errorCard, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
      <View style={styles.errorRow}>
        <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
        <Text style={[styles.errorText, { color: colors.text }]}>{message}</Text>
      </View>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={({ pressed }) => [
          styles.errorRetry,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.danger,
          },
        ]}
      >
        <Text style={[styles.errorRetryText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  SyncPebble — honest system state in the header.
//  Synced / Saving… / n need retry / Offline · n queued,
//  with a 1.5s "All synced" flash when the queue truly
//  drains. Failure-aware (F5): permanently-failed items
//  show a danger-toned "need retry" state and suppress
//  the green Synced / All-synced states.
// ─────────────────────────────────────────────────────
export const SyncPebble: React.FC = () => {
  const { colors } = useTheme();
  const netInfo = useNetInfo();
  const { pending, failed } = useSyncCounts();
  const [flash, setFlash] = useState(false);
  const prevPending = useRef(pending);

  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;

  useEffect(() => {
    const prev = prevPending.current;
    prevPending.current = pending;
    // Never celebrate while failures remain (F5).
    if (failed > 0) {
      setFlash(false);
      return;
    }
    if (prev > 0 && pending === 0 && !offline) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [pending, failed, offline]);

  const queued = pending + failed;

  let bg: string;
  let fg: string;
  let icon: keyof typeof Ionicons.glyphMap;
  let label: string;
  let a11yLabel: string;

  if (offline) {
    bg = colors.offlineBg;
    fg = colors.offline;
    icon = 'cloud-offline-outline';
    label = queued > 0 ? `Offline · ${queued} queued` : 'Offline';
    a11yLabel = queued > 0
      ? `Offline. ${queued} ${queued === 1 ? 'report' : 'reports'} saved on phone, will sync`
      : 'Offline. Reports will be saved on phone';
  } else if (pending > 0) {
    bg = colors.warningBg;
    fg = colors.warning;
    icon = 'sync-outline';
    label = 'Saving…';
    a11yLabel = `Saving. ${pending} ${pending === 1 ? 'report' : 'reports'} waiting to sync`;
  } else if (failed > 0) {
    bg = colors.dangerBg;
    fg = colors.danger;
    icon = 'alert-circle-outline';
    label = failed === 1 ? '1 needs retry' : `${failed} need retry`;
    a11yLabel = `${failed} ${failed === 1 ? 'report' : 'reports'} could not upload and ${failed === 1 ? 'needs' : 'need'} a retry from the Sync Outbox`;
  } else if (flash) {
    bg = colors.successBg;
    fg = colors.success;
    icon = 'checkmark-circle-outline';
    label = 'All synced';
    a11yLabel = 'All reports synced';
  } else {
    bg = colors.successBg;
    fg = colors.success;
    icon = 'checkmark-circle-outline';
    label = 'Synced';
    a11yLabel = 'Synced';
  }

  return (
    <View
      style={[styles.pebble, { backgroundColor: bg }]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={a11yLabel}
    >
      <Ionicons name={icon} size={14} color={fg} />
      <Text
        style={[styles.pebbleText, { color: fg, fontVariant: ['tabular-nums'] }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
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
  /* ── Light-mode-only shadow (single recipe) ── */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  /* ── Header ── */
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: 42,
    paddingBottom: spacing.xl,
  },
  roleRibbon: { height: 4, width: '100%' },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill, borderWidth: 1,
    marginBottom: spacing.lg,
  },
  rolePillText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  greeting: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginBottom: 2 },
  userName: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4, marginBottom: spacing.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  locationText: { fontSize: 13, lineHeight: 18, fontWeight: '500', flexShrink: 1 },

  /* ── Section ── */
  section: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md, marginTop: spacing.sm, minHeight: 20,
  },
  sectionTitle: {
    fontSize: 12, lineHeight: 16, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1,
  },
  sectionCount: { fontVariant: ['tabular-nums'] },
  sectionAction: { fontSize: 13, lineHeight: 18, fontWeight: '700' },

  /* ── Stat card — Big Number Protocol ── */
  statCard: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderTopWidth: 3,
    padding: spacing.lg,
    minHeight: 122,
    justifyContent: 'flex-end',
  },
  statIconWrap: {
    width: 44, height: 44, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statValue: {
    fontSize: 32, lineHeight: 38, fontWeight: '800',
    fontVariant: ['tabular-nums'],
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  statLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 2 },

  /* ── Quick action ── */
  qaBtn: {
    flex: 1,
    borderRadius: radii.md, borderWidth: 1,
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
    minHeight: 104,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  qaIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },

  /* ── Severity pill ── */
  severityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
  },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  severityPillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },

  /* ── Alert card ── */
  alertCard: {
    borderRadius: radii.md, borderWidth: 1, borderLeftWidth: 3,
    padding: spacing.lg, marginBottom: spacing.md,
    minHeight: 64,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  alertTime: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  alertTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: spacing.xs },
  alertDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.sm },
  alertFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  alertLocation: { fontSize: 13, lineHeight: 18, flexShrink: 1 },

  /* ── Tool card ── */
  toolCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.sm,
    minHeight: 64,
  },
  toolIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  toolBadge: {
    position: 'absolute', top: -6, right: -6,
    borderRadius: radii.pill,
    paddingHorizontal: 5, paddingVertical: 1, minWidth: 20, alignItems: 'center',
  },
  toolBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  toolInfo: { flex: 1 },
  toolTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 2 },
  toolSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* ── Banner ── */
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radii.md, borderWidth: 1, borderLeftWidth: 3,
    padding: spacing.md, marginBottom: spacing.md,
  },
  bannerText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500' },

  /* ── Empty — the quiet zero ── */
  emptyWrap: {
    alignItems: 'center', borderRadius: radii.md, borderWidth: 1,
    padding: spacing.xl, marginBottom: spacing.sm, gap: spacing.sm,
    maxHeight: 240,
  },
  emptyTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: { fontSize: 13, lineHeight: 18, textAlign: 'center' },

  /* ── Error card ── */
  errorCard: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.sm, gap: spacing.md,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  errorText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  errorRetry: {
    minHeight: 48, borderRadius: radii.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  errorRetryText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },

  /* ── Sync Pebble ── */
  pebble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    minHeight: 28, alignSelf: 'flex-start',
  },
  pebbleText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },

  /* ── Divider ── */
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg, marginVertical: spacing.xs },
});
