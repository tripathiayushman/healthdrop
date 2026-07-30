// =====================================================
// TREND CHART — one ink series on a hairline grid.
// No gradient fills, no bezier decoration; min/max/
// latest labelled in 12px tabular text. Empty state is
// a quiet zero, not an empty axis.
// =====================================================
import React, { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { TrendData } from '../../types';
import { useTheme, radii } from '../../lib/ThemeContext';

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
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  const rows = useMemo(() => {
    return [...data]
      .sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime())
      .slice(-maxPoints)
      .map((row) => ({
        ...row,
        total_cases: toChartValue(row.total_cases),
      }));
  }, [data, maxPoints]);

  const chartWidth = Math.max(250, width - 84);

  const chartData = useMemo(() => {
    return {
      labels: rows.map((row) => formatDate(row.report_date)),
      datasets: [
        {
          data: rows.map((row) => row.total_cases),
          color: () => colors.chartLine,
          strokeWidth: 2,
        },
      ],
    };
  }, [rows, colors.chartLine]);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const values = rows.map((row) => row.total_cases);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      latest: values[values.length - 1],
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <View style={[styles.emptyWrap, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}>
        <Ionicons name="checkmark-circle-outline" size={24} color={colors.success} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No trend points yet — nothing reported in this window.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <LineChart
        data={chartData}
        width={chartWidth}
        height={220}
        fromZero
        withShadow={false}
        withDots
        chartConfig={{
          backgroundGradientFrom: colors.card,
          backgroundGradientTo: colors.card,
          fillShadowGradientFromOpacity: 0,
          fillShadowGradientToOpacity: 0,
          decimalPlaces: 0,
          color: () => colors.chartLine,
          labelColor: () => colors.textSecondary,
          propsForBackgroundLines: {
            stroke: colors.chartGrid,
            strokeWidth: 1,
            strokeDasharray: '',
          },
          propsForDots: {
            r: '3',
            strokeWidth: '1',
            stroke: colors.card,
          },
        }}
        style={styles.chart}
      />
      {summary && (
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
            MIN <Text style={{ color: colors.text }}>{summary.min}</Text>
            {'   ·   '}MAX <Text style={{ color: colors.text }}>{summary.max}</Text>
            {'   ·   '}LATEST <Text style={{ color: colors.text }}>{summary.latest}</Text>
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  chart: {
    borderRadius: radii.sm,
    marginRight: 12,
  },
  summaryRow: {
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  emptyWrap: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default TrendChart;
