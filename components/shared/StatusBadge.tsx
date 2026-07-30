// =====================================================
// STATUS BADGE COMPONENT — dot + UPPERCASE pill on the
// matching *Bg token. Solid danger fill is reserved for
// CRITICAL alone. Never color alone, never a bare dot.
// =====================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

/** Resolve the soft *Bg token that pairs with a resolved status color. */
const getBgToken = (color: string, colors: Theme): string => {
  switch (color) {
    case colors.success:
    case colors.severityLow:
    case colors.waterSafe:
      return colors.successBg;
    case colors.warning:
    case colors.severityMedium:
    case colors.waterModerate:
      return colors.warningBg;
    case colors.danger:
    case colors.severityCritical:
    case colors.waterUnsafe:
    case colors.waterCritical:
      return colors.dangerBg;
    case colors.severityHigh:
    case colors.accent:
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

  const getColor = () => {
    switch (type) {
      case 'severity':
        return getSeverityColor(status, colors);
      case 'water':
        return getWaterQualityColor(status, colors);
      default:
        return getStatusColor(status, colors);
    }
  };

  // Solid fill is CRITICAL's privilege alone
  const isCritical = status?.toLowerCase() === 'critical';
  const color = isCritical ? colors.textInverse : getColor();
  const backgroundColor = isCritical ? colors.danger : getBgToken(getColor(), colors);

  const sizeStyles = {
    small: { paddingHorizontal: 8, paddingVertical: 3, fontSize: 12 },
    medium: { paddingHorizontal: 10, paddingVertical: 6, fontSize: 12 },
    large: { paddingHorizontal: 14, paddingVertical: 6, fontSize: 13 },
  };

  const formatLabel = (str: string) => str.replace(/_/g, ' ').toUpperCase();

  const a11yPrefix =
    type === 'severity' ? 'Urgency' : type === 'water' ? 'Water quality' : 'Status';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor,
          paddingHorizontal: sizeStyles[size].paddingHorizontal,
          paddingVertical: sizeStyles[size].paddingVertical,
        },
      ]}
      accessible
      accessibilityLabel={`${a11yPrefix}: ${status?.replace(/_/g, ' ')}`}
    >
      {!isCritical && <View style={[styles.dot, { backgroundColor: color }]} />}
      <Text
        style={[styles.text, { color, fontSize: sizeStyles[size].fontSize }]}
        maxFontSizeMultiplier={1.3}
      >
        {formatLabel(status)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  text: {
    fontWeight: '800',
    letterSpacing: 0.6,
    lineHeight: 16,
  },
});

export default StatusBadge;
