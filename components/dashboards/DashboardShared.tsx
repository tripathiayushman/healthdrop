// =====================================================
// SHARED DASHBOARD COMPONENTS — "Bharosa" design language
// Flat headerBg masthead + Role Ribbon, Big Number stat
// cards, eyebrow section headers, directive-first alert
// cards, skeleton / error / quiet-zero states, the §9.4
// Sync Ledger (SyncPebble), and the two §9.6 provenance
// marks: VerifiedStamp and AILabel/AICard. Borders do
// the work — no elevation shadows, no gradients.
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
// Accents are drawn from the Bharosa ladders (dark-mode tier:
// vivid enough on the ink masthead and on dark surfaces alike).
// Violet is reserved for AI and may never be a role accent.
export const ROLE_ACCENT: Record<string, string> = {
  super_admin:      themes.dark.info,         // sky
  health_admin:     themes.dark.primary,      // action teal
  clinic:           themes.dark.waterSafe,    // cyan
  asha_worker:      themes.dark.severityHigh, // warm ochre
  volunteer:        themes.dark.success,      // green
  district_officer: themes.dark.warning,      // amber
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

/** §9.1 — escalation is shape-coded: outline → tinted → filled (+icon). */
type PillVariant = 'outline' | 'tinted' | 'filled';

const severityVariant = (level: string): PillVariant => {
  switch (level?.toLowerCase()) {
    case 'critical': return 'filled';
    case 'high':     return 'tinted';
    default:         return 'outline'; // low / medium / unknown
  }
};

/** Soft container for the tinted tier — sev-high wears its own hue family. */
const severityTint = (level: string, t: Theme): string => {
  switch (level?.toLowerCase()) {
    case 'high':   return t.severityHighBg;
    case 'medium': return t.warningBg;
    default:       return t.surfaceVariant;
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

  // Ink masthead in light mode → white text; surface band in dark mode → ink text.
  // Both modes end on a strong bottom border — the divider carries the meaning,
  // never a shadow.
  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub  = isDark ? colors.textSecondary : colors.primaryLight;

  return (
    <View>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.borderStrong,
          },
        ]}
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Role pill — Eyebrow type. Accent stays on the border/icon ring;
              the label renders in the guaranteed-contrast header ink (F17) —
              several ROLE_ACCENT hues fall below 4.5:1 on the ink masthead. */}
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
  const { colors } = useTheme();

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
  const { colors } = useTheme();

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
//  Severity pill — §9.1 shape-coded escalation.
//  low / medium = outline · high = tinted · critical =
//  filled + icon. The word always travels with the color.
// ─────────────────────────────────────────────────────
const SeverityPill: React.FC<{ level: string }> = ({ level }) => {
  const { colors } = useTheme();
  const key = level?.toLowerCase() ?? '';
  const sev = getSeverityColor(key, colors);
  const variant = severityVariant(key);
  const filled = variant === 'filled';
  const fg = filled ? colors.textInverse : sev;
  const bg = filled ? sev : variant === 'tinted' ? severityTint(key, colors) : 'transparent';

  return (
    <View
      style={[
        styles.severityPill,
        { backgroundColor: bg, borderColor: variant === 'outline' ? sev : 'transparent' },
      ]}
      accessibilityLabel={`Urgency: ${key || 'unknown'}`}
    >
      {filled && <Ionicons name="warning" size={12} color={fg} />}
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
  const { colors, reduceMotion } = useTheme();
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
  const { colors } = useTheme();
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
//  SyncPebble — the §9.4 sync ledger: one component,
//  four truths, always rendered (quiet when good):
//    All synced · last HH:MM      (sync-synced green)
//    Syncing n of m…              (sync-saving blue)
//    n saved on phone — will sync (sync-queued amber)
//    n couldn't sync — needs you  (sync-failed red)
//  Offline is a place, not an error — the queued truth
//  wears amber, never red. Counts always mirror the
//  Outbox exactly; changes announce politely (a11y).
// ─────────────────────────────────────────────────────
export const SyncPebble: React.FC = () => {
  const { colors } = useTheme();
  const netInfo = useNetInfo();
  const { pending, failed } = useSyncCounts();
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const prevPending = useRef(pending);
  const batchTotal = useRef(0);

  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;

  useEffect(() => {
    // Track the size of the in-flight batch so "Syncing n of m" is honest.
    if (pending > batchTotal.current) batchTotal.current = pending;
    const prev = prevPending.current;
    prevPending.current = pending;
    if (prev > 0 && pending === 0) {
      batchTotal.current = 0;
      // The ledger never lies: the timestamp is only minted on a clean drain.
      if (failed === 0) {
        setLastSyncedAt(
          new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        );
      }
    }
  }, [pending, failed]);

  const queued = pending + failed;

  let bg: string;
  let fg: string;
  let icon: keyof typeof Ionicons.glyphMap;
  let label: string;
  let a11yLabel: string;

  if (offline && queued > 0) {
    // Truth 3 — saved on phone, will sync (waiting, not wrong)
    bg = colors.warningBg;
    fg = colors.syncQueued;
    icon = 'phone-portrait-outline';
    label = `${queued} saved on phone — will sync`;
    a11yLabel = `${queued} ${queued === 1 ? 'report' : 'reports'} saved on phone, will sync when the network returns`;
  } else if (offline) {
    // Quiet offline — the place itself, nothing waiting
    bg = colors.warningBg;
    fg = colors.syncQueued;
    icon = 'cloud-offline-outline';
    label = 'Offline — saves on phone';
    a11yLabel = 'Offline. New reports will save on this phone and sync later';
  } else if (failed > 0 && pending === 0) {
    // Truth 4 — couldn't sync, needs a human. Never silent.
    bg = colors.dangerBg;
    fg = colors.syncFailed;
    icon = 'alert-circle-outline';
    label = `${failed} couldn't sync — needs you`;
    a11yLabel = `${failed} ${failed === 1 ? 'report' : 'reports'} could not sync and ${failed === 1 ? 'needs' : 'need'} your attention in the Sync Outbox`;
  } else if (pending > 0) {
    // Truth 2 — in flight
    const total = Math.max(batchTotal.current, pending);
    const current = Math.min(total - pending + 1, total);
    bg = colors.infoBg;
    fg = colors.syncSaving;
    icon = 'sync-outline';
    label = `Syncing ${current} of ${total}…`;
    a11yLabel = `Syncing ${current} of ${total} reports`;
  } else {
    // Truth 1 — all synced, timestamped when we truly know
    bg = colors.successBg;
    fg = colors.syncSynced;
    icon = 'checkmark-circle-outline';
    label = lastSyncedAt ? `All synced · last ${lastSyncedAt}` : 'All synced';
    a11yLabel = lastSyncedAt ? `All reports synced. Last sync ${lastSyncedAt}` : 'All reports synced';
  }

  return (
    <View
      style={[styles.pebble, { backgroundColor: bg, borderColor: fg }]}
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
//  VerifiedStamp — §3 Move 01 / §9.6 provenance mark.
//  The rubber stamp: slightly rotated, 1.5px inked border
//  in success ink, a human name, a role, a tabular time.
//  Pure border + text — survives cheap GPUs and print.
//  Only ever applied with a human name; never for AI.
// ─────────────────────────────────────────────────────
interface VerifiedStampProps {
  verifierName: string;
  role?: string;
  timestamp?: string;
}

export const VerifiedStamp: React.FC<VerifiedStampProps> = ({ verifierName, role, timestamp }) => {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.stamp, { borderColor: colors.success }]}
      accessible
      accessibilityLabel={
        `Verified by ${verifierName}` +
        (role ? `, ${role}` : '') +
        (timestamp ? `, ${timestamp}` : '')
      }
    >
      <Text style={[styles.stampTitle, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
        {'✓ VERIFIED'}
      </Text>
      <Text
        style={[styles.stampMeta, { color: colors.success }]}
        maxFontSizeMultiplier={1.3}
        numberOfLines={2}
      >
        {role ? `${verifierName} · ${role}` : verifierName}
      </Text>
      {!!timestamp && (
        <Text
          style={[styles.stampTime, { color: colors.success }]}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
        >
          {timestamp}
        </Text>
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  AILabel — §9.6 the violet provenance chip. Violet +
//  sparkle + dashed border + the word "AI": triple-coded
//  so the lesson survives colorblindness and low
//  literacy. Violet means the system worked this out —
//  it is never a fact until a human makes it one.
// ─────────────────────────────────────────────────────
export const AILabel: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.aiLabel, { backgroundColor: colors.aiBg, borderColor: colors.aiBorder }]}
      accessible
      accessibilityLabel="AI inferred — not a verified fact"
    >
      <Ionicons name="sparkles" size={12} color={colors.ai} />
      <Text style={[styles.aiLabelText, { color: colors.ai }]} maxFontSizeMultiplier={1.3}>
        {children ?? 'AI — INFERRED'}
      </Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  AICard — dashed-violet-border card for AI surfaces.
//  Wraps content under the AILabel eyebrow; the dashed
//  border means "inferred" on every AI surface, no
//  exceptions. Nothing may wear both this and the stamp.
// ─────────────────────────────────────────────────────
interface AICardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Optional eyebrow override — defaults to "AI — INFERRED". */
  label?: string;
}

export const AICard: React.FC<AICardProps> = ({ children, style, label }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.aiCard, { backgroundColor: colors.aiBg, borderColor: colors.aiBorder }, style]}>
      <AILabel>{label}</AILabel>
      {children}
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

  /* ── Severity pill — §9.1: h28, r-full, micro type; borderWidth is
        constant so outline / tinted / filled tiers keep one geometry ── */
  severityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4,
    minHeight: 28,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  severityPillText: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6 },

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

  /* ── Sync Pebble — §9.4 ledger chip: tint + 1px truth-colored hairline ── */
  pebble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 28, alignSelf: 'flex-start',
  },
  pebbleText: { fontSize: 12, lineHeight: 16, fontWeight: '700', flexShrink: 1 },

  /* ── VerifiedStamp — §9.6: border + text only, gently askew ── */
  stamp: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
    transform: [{ rotate: '-2deg' }],
  },
  stampTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800', letterSpacing: 1 },
  stampMeta:  { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stampTime:  { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },

  /* ── AI provenance — §9.6: violet + sparkle + dashed + the word ── */
  aiLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    minHeight: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  aiLabelText: {
    fontSize: 12, lineHeight: 16, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  aiCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },

  /* ── Divider ── */
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg, marginVertical: spacing.xs },
});
