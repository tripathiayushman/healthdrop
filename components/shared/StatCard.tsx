// =====================================================
// STAT CARD COMPONENT — Big Number Protocol (admin grid)
// 24/800 tabular-nums ink value, 13/700 label, 3px
// semantic top rule. Only the delta takes status color.
// =====================================================
import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { useTheme, radii } from '../../lib/ThemeContext';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  onPress?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color,
  trend,
  onPress,
}) => {
  const { colors, isDark } = useTheme();
  const ruleColor = color || colors.primary;

  const a11yLabel = trend
    ? `${title}: ${value}, ${trend.isPositive ? 'up' : 'down'} ${Math.abs(trend.value)} percent`
    : `${title}: ${value}`;

  const inner = (pressed: boolean) => (
    <View
      style={[
        styles.container,
        {
          backgroundColor: pressed ? colors.cardHover : colors.card,
          borderColor: colors.border,
          borderTopColor: ruleColor,
        },
        !isDark && styles.cardShadow,
      ]}
    >
      {(icon || trend) && (
        <View style={styles.header}>
          {icon ? (
            <View style={[styles.iconContainer, { backgroundColor: ruleColor + '14' }]}>
              {icon}
            </View>
          ) : (
            <View />
          )}
          {trend && (
            <View
              style={[
                styles.trendBadge,
                { backgroundColor: trend.isPositive ? colors.successBg : colors.dangerBg },
              ]}
            >
              <Text
                style={[
                  styles.trendText,
                  { color: trend.isPositive ? colors.success : colors.danger },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {trend.isPositive ? '▲' : '▼'} {Math.abs(trend.value)}%
              </Text>
            </View>
          )}
        </View>
      )}

      <Text
        style={[styles.value, { color: colors.text }]}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text style={[styles.title, { color: colors.textSecondary }]} numberOfLines={2}>
        {title}
      </Text>

      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.textTertiary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
      >
        {({ pressed }) => inner(pressed)}
      </Pressable>
    );
  }

  return <View accessible accessibilityLabel={a11yLabel}>{inner(false)}</View>;
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: radii.md,
    borderWidth: 1,
    borderTopWidth: 3,
    minWidth: 160,
    marginRight: 12,
    marginBottom: 12,
  },
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trendBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  trendText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  value: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
  },
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 4,
  },
});

export default StatCard;
