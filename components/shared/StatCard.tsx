// =====================================================
// STAT CARD COMPONENT
// =====================================================
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../lib/ThemeContext';

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
  const { colors } = useTheme();

  const content = (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: color ? `${color}20` : colors.primaryLight }]}>
          {icon}
        </View>
        {trend && (
          <View style={[
            styles.trendBadge,
            { backgroundColor: trend.isPositive ? colors.successBg : colors.dangerBg }
          ]}>
            <Text style={[
              styles.trendText,
              { color: trend.isPositive ? colors.success : colors.danger }
            ]}>
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
            </Text>
          </View>
        )}
      </View>
      
      <Text style={[styles.value, { color: color || colors.text }]}>{value}</Text>
      <Text style={[styles.title, { color: colors.textSecondary }]}>{title}</Text>
      
      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{subtitle}</Text>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 160,
    marginRight: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trendBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  trendText: {
    fontSize: 12,
    fontWeight: '600',
  },
  value: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default StatCard;
