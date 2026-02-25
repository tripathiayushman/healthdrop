// =====================================================
// DATA TABLE COMPONENT
// =====================================================
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../../lib/ThemeContext';

interface Column<T> {
  key: keyof T | string;
  title: string;
  width?: number;
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
    return (
      <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{emptyMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={[styles.headerRow, { backgroundColor: colors.surfaceVariant, borderBottomColor: colors.border }]}>
            {columns.map((column, index) => (
              <View 
                key={index} 
                style={[
                  styles.headerCell, 
                  { width: column.width || 150 }
                ]}
              >
                <Text style={[styles.headerText, { color: colors.textSecondary }]}>
                  {column.title}
                </Text>
              </View>
            ))}
          </View>

          {/* Data Rows */}
          {data.map((item, rowIndex) => (
            <TouchableOpacity
              key={item.id || rowIndex}
              onPress={() => onRowPress?.(item)}
              activeOpacity={onRowPress ? 0.7 : 1}
              style={[
                styles.dataRow,
                { 
                  borderBottomColor: colors.border,
                  backgroundColor: rowIndex % 2 === 0 ? colors.card : colors.surfaceVariant,
                }
              ]}
            >
              {columns.map((column, colIndex) => (
                <View 
                  key={colIndex} 
                  style={[styles.dataCell, { width: column.width || 150 }]}
                >
                  {column.render ? (
                    column.render(item, rowIndex)
                  ) : (
                    <Text style={[styles.cellText, { color: colors.text }]} numberOfLines={2}>
                      {getValue(item, column.key as string)?.toString() || '-'}
                    </Text>
                  )}
                </View>
              ))}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
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
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dataRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  dataCell: {
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  cellText: {
    fontSize: 14,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
  },
});

export default DataTable;
