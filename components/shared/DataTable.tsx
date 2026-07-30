// =====================================================
// DATA TABLE COMPONENT — flat hairline rows on surface,
// Eyebrow column headers on surfaceVariant, numeric
// columns right-aligned in tabular-nums ink.
// =====================================================
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme, radii } from '../../lib/ThemeContext';
import { SkeletonBlock } from '../dashboards/DashboardShared';

interface Column<T> {
  key: keyof T | string;
  title: string;
  width?: number;
  /** Right-aligns the column in tabular-nums; auto-detected for number values. */
  numeric?: boolean;
  render?: (item: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  onRowPress?: (item: T) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T extends { id?: string }>({
  data,
  columns,
  onRowPress,
  emptyMessage = 'No data available',
  loading = false,
}: DataTableProps<T>) {
  const { colors } = useTheme();

  const getValue = (item: T, key: string): any => {
    const keys = key.split('.');
    let value: any = item;
    for (const k of keys) {
      value = value?.[k];
    }
    return value;
  };

  if (loading) {
    // Skeleton twin — three rows shaped like the real content
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.skeletonWrap}>
          <SkeletonBlock height={16} width="40%" />
          <SkeletonBlock height={16} />
          <SkeletonBlock height={16} />
          <SkeletonBlock height={16} width="70%" />
        </View>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{emptyMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header — Eyebrow row on surfaceVariant */}
          <View style={[styles.headerRow, { backgroundColor: colors.surfaceVariant, borderBottomColor: colors.border }]}>
            {columns.map((column, index) => (
              <View
                key={index}
                style={[
                  styles.headerCell,
                  { width: column.width || 150 },
                ]}
              >
                <Text
                  style={[
                    styles.headerText,
                    { color: colors.textSecondary },
                    column.numeric && styles.numericText,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {column.title}
                </Text>
              </View>
            ))}
          </View>

          {/* Data rows — flat, hairline dividers, no zebra fills */}
          {data.map((item, rowIndex) => (
            <TouchableOpacity
              key={item.id || rowIndex}
              onPress={() => onRowPress?.(item)}
              activeOpacity={onRowPress ? 0.7 : 1}
              disabled={!onRowPress}
              accessibilityRole={onRowPress ? 'button' : undefined}
              style={[
                styles.dataRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: rowIndex === data.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              {columns.map((column, colIndex) => {
                const raw = getValue(item, column.key as string);
                const numeric = column.numeric ?? typeof raw === 'number';
                return (
                  <View
                    key={colIndex}
                    style={[styles.dataCell, { width: column.width || 150 }]}
                  >
                    {column.render ? (
                      column.render(item, rowIndex)
                    ) : (
                      <Text
                        style={[
                          styles.cellText,
                          { color: colors.text },
                          numeric && styles.numericCell,
                        ]}
                        numberOfLines={2}
                        maxFontSizeMultiplier={1.3}
                      >
                        {raw?.toString() || '-'}
                      </Text>
                    )}
                  </View>
                );
              })}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerCell: {
    paddingHorizontal: 8,
  },
  headerText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  dataCell: {
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  cellText: {
    fontSize: 15,
    lineHeight: 22,
  },
  numericText: {
    textAlign: 'right',
  },
  numericCell: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
  },
  skeletonWrap: {
    padding: 16,
    gap: 12,
  },
});

export default DataTable;
