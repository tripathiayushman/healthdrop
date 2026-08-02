// =====================================================
// SHARED DASHBOARD COMPONENTS — "Bharosa" design language
// Paper headerBg masthead + Role Ribbon, Big Number stat
// cards, eyebrow section headers, directive-first alert
// cards, skeleton / error / quiet-zero states, the §9.4
// Sync Ledger (SyncPebble), and the two §9.6 provenance
// marks: VerifiedStamp and AILabel/AICard. Borders do
// the work — no elevation shadows, no gradients.
// =====================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable,
  Animated, ViewStyle, StyleProp, DimensionValue, Modal, ScrollView, Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { useTheme, Theme, themes, radii, spacing } from '../../lib/ThemeContext';
import { useSyncCounts } from '../../src/services/offlineSync';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/format';
import { Profile } from '../../types';

// ─────────────────────────────────────────────────────
//  Role design tokens
//  The role accent appears in exactly two places per
//  screen: the 4px Role Ribbon and the avatar/badge ring.
// ─────────────────────────────────────────────────────
// Accents are drawn from the Bharosa ladders. They used to use the
// dark-mode (pastel) tier because the masthead was an ink slab; on the
// paper header those pastels collapse to ~1.7:1 — an invisible ribbon,
// an invisible pill icon. The light/ink tier is the only tier that is
// legible on BOTH canvases: ≥4.5:1 on paper (so it may even carry text
// and take white text when filled) and ≥2.7:1 as a solid strip/glyph on
// the dark surface. Violet is reserved for AI and is never a role accent.
export const ROLE_ACCENT: Record<string, string> = {
  super_admin:      themes.light.info,         // sky
  health_admin:     themes.light.primary,      // action teal
  clinic:           themes.light.waterSafe,    // cyan
  asha_worker:      themes.light.severityHigh, // warm ochre
  volunteer:        themes.light.success,      // green
  district_officer: themes.light.warning,      // amber
};

/**
 * 8% alpha suffix — the accent-tinted pill/avatar wash used across the
 * dashboards. Derived from a token, never a standalone color.
 */
const TINT_ALPHA = '14';

const ROLE_LABEL: Record<string, string> = {
  super_admin:      'Super Administrator',
  health_admin:     'Health Administrator',
  clinic:           'Clinic Staff',
  asha_worker:      'ASHA Worker',
  volunteer:        'Community Volunteer',
  district_officer: 'District Officer',
};

// Eyebrow chips are short by design: the pill now shares its row with the
// user's name, and a truncated role reads as broken. The full ROLE_LABEL
// still goes to the screen reader.
const ROLE_CHIP: Record<string, string> = {
  super_admin:      'Super Admin',
  health_admin:     'Health Admin',
  clinic:           'Clinic',
  asha_worker:      'ASHA Worker',
  volunteer:        'Volunteer',
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
//  DashboardHeader — paper headerBg band + 4px Role Ribbon
//  One tight block: greeting + name on the left, role pill
//  on the right, location underneath. No ink slab, no dead
//  space — the whole header is ~92dp at default font scale
//  so the first stat card is visible without scrolling.
// ─────────────────────────────────────────────────────
interface HeaderProps { profile: Profile; subtitle?: string }

export const DashboardHeader: React.FC<HeaderProps> = ({ profile, subtitle }) => {
  const { colors, reduceMotion } = useTheme();
  const role   = profile.role ?? 'volunteer';
  const accent = ROLE_ACCENT[role] ?? ROLE_ACCENT.volunteer;
  const greeting = getGreeting();
  const location =
    subtitle ??
    (profile.district ? `${profile.district}${profile.state ? `, ${profile.state}` : ''}` : '');

  const fadeAnim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      fadeAnim.setValue(1);
      return;
    }
    Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers are correct in both modes: `text` for
  // the name, `textSecondary` for greeting and location. textInverse would
  // be white-on-paper — invisible — and is banned here. Separation is a 1px
  // border hairline plus the Role Ribbon; never a shadow.
  return (
    <View>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          <View style={styles.headerRow}>
            <View style={styles.identityBlock}>
              <Text
                style={[styles.greeting, { color: colors.text }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {greeting}
              </Text>
              <Text
                style={[styles.userName, { color: colors.text }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {profile.full_name || 'User'}
              </Text>
            </View>

            {/* Role pill — Eyebrow type. The accent carries the border and the
                icon; the LABEL is ink, because the accent itself never has to
                pass a text ratio on its own tint. */}
            <View
              style={[
                styles.rolePill,
                { borderColor: accent, backgroundColor: accent + TINT_ALPHA },
              ]}
              accessible
              accessibilityLabel={`Role: ${ROLE_LABEL[role]}`}
            >
              <Ionicons name={ROLE_ICON[role]} size={14} color={accent} />
              <Text
                style={[styles.rolePillText, { color: colors.text }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {ROLE_CHIP[role] ?? ROLE_LABEL[role]}
              </Text>
            </View>
          </View>

          {!!location && (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text
                style={[styles.locationText, { color: colors.textSecondary }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {location}
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
      <View style={[styles.statIconWrap, { backgroundColor: color + TINT_ALPHA }]}>
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
      <View style={[styles.qaIcon, { backgroundColor: color + TINT_ALPHA }]}>
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
      <View style={[styles.toolIcon, { backgroundColor: iconColor + TINT_ALPHA }]}>
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
//  PaybackCard — NEW-02. "What did my reporting achieve?"
//
//  A field worker files into what feels like a void. Every
//  line below is a fact read back from the live database;
//  a fact that cannot be derived is not shown at all — an
//  overstated card is worse than no card, because the
//  person reading it is deciding whether the work is worth
//  doing. Four states: skeleton / content / quiet-zero /
//  error-with-retry. A failed query renders the error, and
//  NEVER a confident zero — "you achieved nothing" is the
//  cruellest possible instance of this codebase's
//  signature catch-and-show-zero defect.
//
//  Deliberately NOT claimed here (all re-verified against
//  the live schema on 3 Aug 2026):
//   • "your report triggered an outbreak" —
//     detect_outbreak_after_report() runs only AFTER
//     INSERT and returns early unless the new row is
//     already 'approved', while auto_approve_reporter_id_report()
//     forces every asha_worker / volunteer row to
//     'pending_approval'. Nothing recomputes totals on
//     approval (recompute_outbreak_on_rejection only fires
//     approved → rejected). So a field worker's report can
//     never be an outbreak's triggered_by_report_id, and
//     `outbreaks` holds 0 rows. MySubmissionsScreen already
//     shows the honest per-report window-overlap version.
//   • "your report became a public alert" — health_alerts
//     carries no report linkage; `metadata` is {} on every
//     live row.
//   • the reviewer's NAME — profiles_select_policy lets a
//     field worker read exactly one profile row: her own
//     (confirmed by querying as her JWT: 1 row visible).
//     A join would render "verified by —".
// ─────────────────────────────────────────────────────

/** Newest-first page we tally locally; beyond it only the total is claimed. */
const PAYBACK_ROW_LIMIT = 400;
/** Cap on the source names we look up in one registry query. */
const PAYBACK_SOURCE_LIMIT = 60;
/** The qualities sync_water_source_registry() treats as a flag. */
const FLAG_QUALITIES = ['unsafe', 'critical', 'poor', 'contaminated'];
/**
 * water_sources.current_status can only be ESCALATED by a report
 * (sync_water_source_registry never lowers it — a safe reading does not clear
 * a flag). So a source she flagged sitting at safe/moderate means a human
 * with official write access lowered it. That is the fact we may state.
 */
const CLEARED_STATUSES = ['safe', 'moderate'];

interface OwnReportRow {
  approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

interface OwnWaterRow extends OwnReportRow {
  source_name: string | null;
  district: string | null;
  overall_quality: string | null;
  created_at: string | null;
}

interface RegistryRow {
  source_name: string | null;
  district: string | null;
  current_status: string | null;
  last_reported_at: string | null;
}

export interface PaybackFacts {
  /** Reports she filed (disease + water). Server count, not a page length. */
  filed: number;
  /** False when she has filed more than one page — then only `filed` is claimed. */
  breakdownExact: boolean;
  verified: number;
  waiting: number;
  needsFix: number;
  /** True only when every approved row was decided by somebody other than her. */
  verifiedByReviewer: boolean;
  lastVerifiedAt: string | null;
  /** Distinct sources her own reports flagged unsafe/critical. */
  flagged: number;
  /** …that have a newer reading than her flag. */
  retested: number;
  /** …that an official has since taken off unsafe/critical. */
  cleared: number;
  /** False when she has flagged more sources than one registry query covers. */
  waterExact: boolean;
  campaignsJoined: number;
}

/** Exact when the page we tallied covers the whole server-side count. */
const pageIsWhole = (count: number | null, rows: unknown[]): boolean =>
  typeof count === 'number' ? rows.length >= count : rows.length < PAYBACK_ROW_LIMIT;

const totalOf = (count: number | null, rows: unknown[]): number =>
  typeof count === 'number' ? count : rows.length;

const msOf = (iso: string | null): number => {
  if (!iso) return NaN;
  return new Date(iso).getTime();
};

/**
 * Reads the facts. Returns null on ANY failure — a partial answer would
 * under-report her work, which is the same lie in a quieter voice.
 */
const loadPaybackFacts = async (userId: string): Promise<PaybackFacts | null> => {
  try {
    const [diseaseRes, waterRes, campaignRes] = await Promise.all([
      supabase
        .from('disease_reports')
        .select('approval_status, approved_by, approved_at', { count: 'exact' })
        .eq('reporter_id', userId)
        .order('created_at', { ascending: false })
        .limit(PAYBACK_ROW_LIMIT),
      supabase
        .from('water_quality_reports')
        .select('approval_status, approved_by, approved_at, source_name, district, overall_quality, created_at', { count: 'exact' })
        .eq('reporter_id', userId)
        .order('created_at', { ascending: false })
        .limit(PAYBACK_ROW_LIMIT),
      supabase
        .from('campaign_participants')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('status', 'cancelled'),
    ]);

    if (diseaseRes.error || waterRes.error || campaignRes.error) {
      console.error('[PaybackCard] load failed:', diseaseRes.error ?? waterRes.error ?? campaignRes.error);
      return null;
    }
    // head+exact must yield a number; anything else is an unknown, not a zero.
    const campaignsJoined = campaignRes.count;
    if (typeof campaignsJoined !== 'number') {
      console.error('[PaybackCard] campaign count missing from response');
      return null;
    }

    const diseaseRows = (diseaseRes.data ?? []) as OwnReportRow[];
    const waterRows = (waterRes.data ?? []) as OwnWaterRow[];
    const allRows: OwnReportRow[] = [...diseaseRows, ...waterRows];

    let verified = 0;
    let waiting = 0;
    let needsFix = 0;
    let verifiedByReviewer = true;
    let lastVerifiedAt: string | null = null;

    for (const row of allRows) {
      const status = (row.approval_status ?? '').toLowerCase();
      if (status === 'approved') {
        verified += 1;
        // "A reviewer verified it" is only sayable while nobody self-approved.
        if (!row.approved_by || row.approved_by === userId) verifiedByReviewer = false;
        if (row.approved_at && (!lastVerifiedAt || msOf(row.approved_at) > msOf(lastVerifiedAt))) {
          lastVerifiedAt = row.approved_at;
        }
      } else if (status === 'rejected') {
        needsFix += 1;
      } else {
        waiting += 1;
      }
    }

    const filed = totalOf(diseaseRes.count, diseaseRows) + totalOf(waterRes.count, waterRows);
    const breakdownExact =
      pageIsWhole(diseaseRes.count, diseaseRows) && pageIsWhole(waterRes.count, waterRows);

    // ── Water sources she flagged ──
    // Keyed exactly the way sync_water_source_registry() matches them
    // (district = district AND source_name = source_name), so the join here
    // is the same relation the trigger itself used. No fuzzy matching: it
    // could merge two real sources and invent a retest that never happened.
    const flags = new Map<string, { name: string; district: string; at: number }>();
    for (const row of waterRows) {
      const quality = (row.overall_quality ?? '').toLowerCase();
      if (!FLAG_QUALITIES.includes(quality)) continue;
      if (!row.source_name || !row.district) continue;
      const at = msOf(row.created_at);
      if (!Number.isFinite(at)) continue;
      const key = `${row.district} ${row.source_name}`;
      const seen = flags.get(key);
      // Her most recent flag is the one a retest has to beat.
      if (!seen || at > seen.at) flags.set(key, { name: row.source_name, district: row.district, at });
    }

    let retested = 0;
    let cleared = 0;
    const waterExact = flags.size <= PAYBACK_SOURCE_LIMIT;

    if (flags.size > 0 && waterExact) {
      const entries = Array.from(flags.entries());
      // The two .in() filters are a cross product, so this can return sources
      // that share a name across districts; the exact-key match below drops
      // them. Truncation here can only UNDER-count, never invent a retest.
      const registryRes = await supabase
        .from('water_sources')
        .select('source_name, district, current_status, last_reported_at')
        .in('source_name', entries.map(([, v]) => v.name))
        .in('district', entries.map(([, v]) => v.district))
        .limit(500);

      if (registryRes.error) {
        console.error('[PaybackCard] water source registry query failed:', registryRes.error);
        return null;
      }

      const registry = new Map<string, RegistryRow>();
      for (const row of (registryRes.data ?? []) as RegistryRow[]) {
        if (!row.source_name || !row.district) continue;
        registry.set(`${row.district} ${row.source_name}`, row);
      }

      for (const [key, flag] of entries) {
        const source = registry.get(key);
        if (!source) continue;
        // "Retested" = a reading was filed on this source after her flag. The
        // registry is written on INSERT regardless of approval, so this claims
        // a test happened — never that its result was accepted.
        const lastAt = msOf(source.last_reported_at);
        if (!Number.isFinite(lastAt) || lastAt <= flag.at) continue;
        retested += 1;
        // `cleared` is kept a strict subset of `retested` so the caption's
        // "N of them" is literally true.
        if (CLEARED_STATUSES.includes((source.current_status ?? '').toLowerCase())) cleared += 1;
      }
    }

    return {
      filed,
      breakdownExact,
      verified,
      waiting,
      needsFix,
      verifiedByReviewer,
      lastVerifiedAt,
      flagged: flags.size,
      retested,
      cleared,
      waterExact,
      campaignsJoined,
    };
  } catch (err) {
    console.error('[PaybackCard] load threw:', err);
    return null;
  }
};

interface PaybackLine {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  text: string;
  caption?: string;
  onPress?: () => void;
}

interface PaybackCardProps {
  profile: Profile;
  onNavigate: (screen: string) => void;
  /** Bump to reload — the dashboards raise it on pull-to-refresh. */
  refreshKey?: number;
  /** false for roles that cannot file reports; changes only the quiet-zero words. */
  canFile?: boolean;
}

export const PaybackCard: React.FC<PaybackCardProps> = ({
  profile, onNavigate, refreshKey = 0, canFile = true,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const [facts, setFacts] = useState<PaybackFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    loadPaybackFacts(profile.id).then((next) => {
      if (!active) return;
      setFacts(next);
      setFailed(next === null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [profile.id, refreshKey, retryTick]);

  const retry = useCallback(() => setRetryTick(n => n + 1), []);

  const title = t('payback.title', { defaultValue: 'What your work did' });

  // ── Skeleton ──
  if (loading) {
    return (
      <Section title={title}>
        <View style={[styles.paybackCard, styles.paybackSkeleton, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SkeletonBlock height={20} width="82%" />
          <SkeletonBlock height={20} width="64%" style={{ marginTop: spacing.md }} />
          <SkeletonBlock height={20} width="48%" style={{ marginTop: spacing.md }} />
        </View>
      </Section>
    );
  }

  // ── Error with retry — never a zero ──
  if (failed || !facts) {
    return (
      <Section title={title}>
        <ErrorCard
          message={t('payback.error', {
            defaultValue: "Couldn't load what your work did — check connection",
          })}
          onRetry={retry}
        />
      </Section>
    );
  }

  const lines: PaybackLine[] = [];

  if (!facts.breakdownExact) {
    // More reports than one page: the total is still exact, the split is not.
    lines.push({
      key: 'filed',
      icon: 'document-text-outline',
      color: colors.textSecondary,
      text: facts.filed === 1
        ? t('payback.filedOne', { defaultValue: '1 report filed' })
        : t('payback.filedMany', { n: facts.filed, defaultValue: '{{n}} reports filed' }),
    });
  } else {
    if (facts.verified > 0) {
      const text = facts.verifiedByReviewer
        ? (facts.verified === 1
          ? t('payback.verifiedOne', { defaultValue: 'A reviewer verified 1 of your reports' })
          : t('payback.verifiedMany', { n: facts.verified, defaultValue: 'A reviewer verified {{n}} of your reports' }))
        : (facts.verified === 1
          ? t('payback.approvedOne', { defaultValue: '1 of your reports is approved' })
          : t('payback.approvedMany', { n: facts.verified, defaultValue: '{{n}} of your reports are approved' }));
      const stamped = facts.lastVerifiedAt ? formatDate(facts.lastVerifiedAt) : '';
      lines.push({
        key: 'verified',
        icon: 'checkmark-circle-outline',
        color: colors.success,
        text,
        caption: stamped
          ? t('payback.lastVerified', { date: stamped, defaultValue: 'Most recent on {{date}}' })
          : undefined,
      });
    }

    // Pending only speaks when nothing has come back yet — otherwise the
    // dashboard's own pending banner and stat tiles already say it.
    if (facts.verified === 0 && facts.waiting > 0) {
      lines.push({
        key: 'waiting',
        icon: 'time-outline',
        color: colors.warning,
        text: facts.waiting === 1
          ? t('payback.waitingOne', { defaultValue: '1 report is waiting for review' })
          : t('payback.waitingMany', { n: facts.waiting, defaultValue: '{{n}} reports are waiting for review' }),
      });
    }

    if (facts.needsFix > 0) {
      lines.push({
        key: 'needsFix',
        icon: 'alert-circle-outline',
        color: colors.danger,
        text: facts.needsFix === 1
          ? t('payback.needsFixOne', { defaultValue: '1 report needs a fix — tap to see why' })
          : t('payback.needsFixMany', { n: facts.needsFix, defaultValue: '{{n}} reports need a fix — tap to see why' }),
        onPress: () => onNavigate('my-submissions'),
      });
    }
  }

  if (facts.waterExact && facts.retested > 0) {
    lines.push({
      key: 'water',
      icon: 'water-outline',
      color: colors.waterSafe,
      text: facts.retested === 1
        ? t('payback.waterRetestedOne', { defaultValue: '1 water source you flagged has been retested' })
        : t('payback.waterRetestedMany', { n: facts.retested, defaultValue: '{{n}} water sources you flagged have been retested' }),
      caption: facts.cleared > 0
        ? (facts.cleared === 1
          ? t('payback.waterClearedOne', { defaultValue: '1 is no longer marked unsafe' })
          : t('payback.waterClearedMany', { n: facts.cleared, defaultValue: '{{n}} are no longer marked unsafe' }))
        : undefined,
      onPress: () => onNavigate('water-sources'),
    });
  } else if (facts.flagged > 0) {
    lines.push({
      key: 'waterFlagged',
      icon: 'water-outline',
      color: colors.info,
      text: facts.flagged === 1
        ? t('payback.waterFlaggedOne', { defaultValue: '1 water source you flagged is on the register' })
        : t('payback.waterFlaggedMany', { n: facts.flagged, defaultValue: '{{n}} water sources you flagged are on the register' }),
      onPress: () => onNavigate('water-sources'),
    });
  }

  if (facts.campaignsJoined > 0) {
    lines.push({
      key: 'campaigns',
      icon: 'megaphone-outline',
      color: colors.textSecondary,
      text: facts.campaignsJoined === 1
        ? t('payback.campaignsOne', { defaultValue: '1 campaign joined' })
        : t('payback.campaignsMany', { n: facts.campaignsJoined, defaultValue: '{{n}} campaigns joined' }),
    });
  }

  // ── Quiet zero — honest, and not a scolding ──
  if (lines.length === 0) {
    return (
      <Section title={title}>
        <EmptyState
          icon={canFile ? 'document-text-outline' : 'megaphone-outline'}
          color={colors.primary}
          title={canFile
            ? t('payback.emptyTitle', { defaultValue: 'Your first report will show its journey here' })
            : t('payback.emptyTitleHelper', { defaultValue: 'Nothing to show here yet' })}
          subtitle={canFile
            ? t('payback.emptyBody', { defaultValue: 'File a report and this card will show what happened to it.' })
            : t('payback.emptyBodyHelper', { defaultValue: 'Join a campaign and it will appear here.' })}
        />
      </Section>
    );
  }

  // ── Content ──
  return (
    <Section title={title}>
      <View style={[styles.paybackCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {lines.map((line, i) => {
          const body = (
            <>
              <Ionicons name={line.icon} size={22} color={line.color} />
              <View style={styles.paybackTextWrap}>
                <Text style={[styles.paybackText, { color: colors.text }]}>{line.text}</Text>
                {!!line.caption && (
                  <Text style={[styles.paybackCaption, { color: colors.textSecondary }]}>{line.caption}</Text>
                )}
              </View>
              {!!line.onPress && <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />}
            </>
          );
          const divider = i < lines.length - 1
            ? { borderBottomWidth: 1, borderBottomColor: colors.borderLight }
            : null;

          return line.onPress ? (
            <Pressable
              key={line.key}
              onPress={line.onPress}
              accessibilityRole="button"
              accessibilityLabel={line.caption ? `${line.text}. ${line.caption}` : line.text}
              style={({ pressed }) => [
                styles.paybackRow,
                divider,
                pressed && { backgroundColor: colors.cardHover },
              ]}
            >
              {body}
            </Pressable>
          ) : (
            <View
              key={line.key}
              style={[styles.paybackRow, divider]}
              accessible
              accessibilityLabel={line.caption ? `${line.text}. ${line.caption}` : line.text}
            >
              {body}
            </View>
          );
        })}
      </View>

      {/* Only offered when there is something to open. */}
      {facts.filed > 0 && (
        <Pressable
          onPress={() => onNavigate('my-submissions')}
          accessibilityRole="button"
          accessibilityLabel={t('payback.seeSubmissions', { defaultValue: 'See your submissions' })}
          style={({ pressed }) => [styles.paybackLink, pressed && { backgroundColor: colors.cardHover }]}
        >
          <Text style={[styles.paybackLinkText, { color: isDark ? colors.primary : colors.primaryDark }]}>
            {t('payback.seeSubmissions', { defaultValue: 'See your submissions' })}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={isDark ? colors.primary : colors.primaryDark} />
        </Pressable>
      )}
    </Section>
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
  /* ── Header — 16 gutter, 12 vertical rhythm. The shell header above
        already clears the status bar, so there is no inset padding to
        repeat here: ~92dp total at 1.0 scale, ~110dp at 1.3. Heights are
        content-driven (minHeight only), never fixed. ── */
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityBlock: { flex: 1 },
  roleRibbon: { height: 4, width: '100%' },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: 10, paddingVertical: spacing.sm,
    borderRadius: radii.pill, borderWidth: 1,
    minHeight: 44,
    // Never let the chip eat the name: it shrinks first and is capped at
    // half the row.
    flexShrink: 1, maxWidth: '50%',
  },
  rolePillText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  greeting: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  userName: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
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

  /* ── Payback card — NEW-02. Flat card, hairline-separated 48dp fact
        rows. No accent edge: the colour lives on the row icon, where it
        encodes a ladder position, and nowhere else. ── */
  paybackCard: {
    borderRadius: radii.md, borderWidth: 1,
    overflow: 'hidden',
  },
  paybackSkeleton: { padding: spacing.lg },
  paybackRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  paybackTextWrap: { flex: 1 },
  paybackText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  paybackCaption: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  paybackLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    minHeight: 48, borderRadius: radii.md,
    paddingHorizontal: spacing.lg, marginTop: spacing.sm,
  },
  paybackLinkText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },

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
