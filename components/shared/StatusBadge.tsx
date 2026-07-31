// =====================================================
// STATUS BADGE — §9.1 Bharosa pills. Escalation is
// shape-coded: outline → tinted → filled; the word
// always travels with the color, and critical adds an
// icon. Water pills always carry the droplet pictogram;
// water-critical is filled and says "DO NOT DRINK".
// Never color alone, never a bare dot.
// =====================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useTheme,
  Theme,
  getStatusColor,
  getSeverityColor,
  getWaterQualityColor,
  radii,
} from '../../lib/ThemeContext';

interface StatusBadgeProps {
  status: string;
  type?: 'status' | 'severity' | 'water';
  size?: 'small' | 'medium' | 'large';
}

type PillVariant = 'outline' | 'tinted' | 'filled';

// §9.1 ladders — low/medium (safe/moderate) stay quiet outlines,
// high (unsafe) is tinted, critical is filled + icon.
const SEVERITY_VARIANT: Record<string, PillVariant> = {
  low: 'outline',
  medium: 'outline',
  high: 'tinted',
  critical: 'filled',
};

const WATER_VARIANT: Record<string, PillVariant> = {
  safe: 'outline',
  moderate: 'outline',
  poor: 'tinted',      // legacy vocab → unsafe tier
  unsafe: 'tinted',
  contaminated: 'filled', // legacy vocab → critical tier
  critical: 'filled',
};

/** Resolve the soft container token that pairs with a resolved pill color. */
const getBgToken = (color: string, colors: Theme): string => {
  switch (color) {
    case colors.success:
    case colors.badgeActive:
      return colors.successBg;
    case colors.warning:
      return colors.warningBg;
    case colors.danger:
    case colors.severityCritical:
      return colors.dangerBg;
    case colors.severityHigh:
    case colors.waterUnsafe:
    case colors.accent:
      return colors.severityHighBg;
    case colors.offline:
      return colors.offlineBg;
    case colors.info:
      return colors.infoBg;
    default:
      return colors.surfaceVariant;
  }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  type = 'status',
  size = 'medium',
}) => {
  const { colors } = useTheme();
  const key = status?.toLowerCase() ?? '';

  const resolveColor = () => {
    switch (type) {
      case 'severity':
        return getSeverityColor(key, colors);
      case 'water':
        return getWaterQualityColor(key, colors);
      default:
        return getStatusColor(key, colors);
    }
  };

  // Shape tier: severity and water follow the §9.1 ladders; generic
  // statuses stay tinted, except critical — filled is its privilege alone.
  let variant: PillVariant;
  if (type === 'severity') {
    variant = SEVERITY_VARIANT[key] ?? 'outline';
  } else if (type === 'water') {
    variant = WATER_VARIANT[key] ?? 'outline';
  } else {
    variant = key === 'critical' ? 'filled' : 'tinted';
  }

  const base = resolveColor();
  const filled = variant === 'filled';
  const color = filled ? colors.textInverse : base;
  const backgroundColor = filled
    ? base
    : variant === 'tinted'
      ? getBgToken(base, colors)
      : 'transparent';
  const borderColor = variant === 'outline' ? base : 'transparent';

  // The directive outranks the taxonomy: water-critical commands.
  const isWaterCritical = type === 'water' && (key === 'critical' || key === 'contaminated');
  const label = isWaterCritical
    ? 'DO NOT DRINK'
    : (status ?? '').replace(/_/g, ' ').toUpperCase();

  const sizeStyles = {
    small: { paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, icon: 11 },
    medium: { paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, icon: 12 },
    large: { paddingHorizontal: 14, paddingVertical: 5, fontSize: 13, icon: 13 },
  };

  const a11yPrefix =
    type === 'severity' ? 'Urgency' : type === 'water' ? 'Water quality' : 'Status';
  const a11yLabel = isWaterCritical
    ? `Water quality: critical. Do not drink`
    : `${a11yPrefix}: ${(status ?? '').replace(/_/g, ' ')}`;

  // Icons carry the words' meaning past color: droplet on every water
  // pill, warning on filled critical, dot on tinted status pills.
  const showDroplet = type === 'water';
  const showCriticalIcon = !showDroplet && filled;
  const showDot = type === 'status' && !filled;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor,
          borderColor,
          paddingHorizontal: sizeStyles[size].paddingHorizontal,
          paddingVertical: sizeStyles[size].paddingVertical,
        },
      ]}
      accessible
      accessibilityLabel={a11yLabel}
    >
      {showDroplet && <Ionicons name="water" size={sizeStyles[size].icon} color={color} />}
      {showCriticalIcon && <Ionicons name="warning" size={sizeStyles[size].icon} color={color} />}
      {showDot && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text
        style={[styles.text, { color, fontSize: sizeStyles[size].fontSize }]}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radii.pill,
    // Constant borderWidth keeps outline / tinted / filled the same height
    borderWidth: 1.5,
    minHeight: 28,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontWeight: '600',
    letterSpacing: 0.6,
    lineHeight: 16,
  },
});

export default StatusBadge;
