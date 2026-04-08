import React, { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { TrendData } from '../../types';
import { useTheme } from '../../lib/ThemeContext';

interface TrendChartProps {
  data: TrendData[];
  maxPoints?: number;
}

const formatDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const toChartValue = (value: number | null | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

export const TrendChart: React.FC<TrendChartProps> = ({ data, maxPoints = 10 }) => {
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();

  const rows = useMemo(() => {
    return [...data]
      .sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime())
      .slice(-maxPoints)
      .map((row) => ({
        ...row,
        total_cases: toChartValue(row.total_cases),
        moving_avg: toChartValue(row.moving_avg),
      }));
  }, [data, maxPoints]);

  const chartWidth = Math.max(250, width - 84);

  const chartData = useMemo(() => {
    return {
      labels: rows.map((row) => formatDate(row.report_date)),
      datasets: [
        {
          data: rows.map((row) => row.total_cases),
          color: (opacity = 1) => `rgba(220, 38, 38, ${opacity})`,
          strokeWidth: 2,
        },
        {
          data: rows.map((row) => row.moving_avg),
          color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
          strokeWidth: 2,
        },
      ],
      legend: ['Cases', 'Moving Avg'],
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <View style={[styles.emptyWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No trend points available.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(12,12,16,0.85)' : colors.card }]}>
      <LineChart
        data={chartData}
        width={chartWidth}
        height={220}
        bezier
        fromZero
        withShadow
        withDots
        chartConfig={{
          backgroundGradientFrom: 'transparent',
          backgroundGradientTo: 'transparent',
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(${isDark ? '226,232,240' : '71,85,105'}, ${opacity})`,
          propsForBackgroundLines: {
            stroke: isDark ? '#334155' : '#E2E8F0',
          },
          propsForDots: {
            r: '3',
            strokeWidth: '1',
            stroke: isDark ? '#0F172A' : '#FFFFFF',
          },
        }}
        style={styles.chart}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  chart: {
    borderRadius: 12,
    marginRight: 12,
  },
  emptyWrap: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default TrendChart;
