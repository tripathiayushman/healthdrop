// =====================================================
// STATUS BADGE COMPONENT
// =====================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, getStatusColor, getSeverityColor, getWaterQualityColor } from '../../lib/ThemeContext';

interface StatusBadgeProps {
  status: string;
  type?: 'status' | 'severity' | 'water';
  size?: 'small' | 'medium' | 'large';
}

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

  const color = getColor();
  const backgroundColor = `${color}20`;

  const sizeStyles = {
    small: { paddingHorizontal: 6, paddingVertical: 2, fontSize: 10 },
    medium: { paddingHorizontal: 10, paddingVertical: 4, fontSize: 12 },
    large: { paddingHorizontal: 14, paddingVertical: 6, fontSize: 14 },
  };

  const formatLabel = (str: string) => {
    return str
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

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
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color, fontSize: sizeStyles[size].fontSize }]}>
        {formatLabel(status)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  text: {
    fontWeight: '600',
  },
});

export default StatusBadge;
