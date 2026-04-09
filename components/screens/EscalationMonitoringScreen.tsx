import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EscalationRecord, Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { getEscalationMonitoring } from '../../lib/services/advancedAnalytics';

interface EscalationMonitoringScreenProps {
  profile: Profile;
  onBack: () => void;
  onOpenQueue?: (tab: 'disease' | 'water' | 'campaigns' | 'alerts') => void;
}

type FilterType = 'all' | 'disease' | 'water' | 'campaign' | 'alert';

const escalationColor = (level: number): string => {
  if (level >= 3) return '#DC2626';
  if (level === 2) return '#EA580C';
  if (level === 1) return '#F59E0B';
  return '#10B981';
};

const queueTabForRecord = (reportType: string): 'disease' | 'water' | 'campaigns' | 'alerts' => {
  const normalized = reportType.toLowerCase();
  if (normalized.includes('water')) return 'water';
  if (normalized.includes('campaign')) return 'campaigns';
  if (normalized.includes('alert')) return 'alerts';
  return 'disease';
};

const EscalationMonitoringScreen: React.FC<EscalationMonitoringScreenProps> = ({
  profile,
  onBack,
  onOpenQueue,
}) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState<EscalationRecord[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState<string | null>(null);

  const loadRecords = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getEscalationMonitoring(profile);
      setRecords(data);
      if (data.length === 0) {
        setError('No pending escalation records were found for your visible scope.');
      }
    } catch {
      setRecords([]);
      setError('Unable to load escalation monitoring right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [profile.role, profile.district]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecords();
    setRefreshing(false);
  };

  const filteredRecords = useMemo(() => {
    if (filter === 'all') return records;
    return records.filter((record) => record.report_type.toLowerCase().includes(filter));
  }, [records, filter]);

  const summary = useMemo(() => {
    const overdue = records.filter((record) => record.is_overdue).length;
    const highEscalation = records.filter((record) => (record.escalation_level || 0) >= 2).length;

    return {
      total: records.length,
      overdue,
      highEscalation,
    };
  }, [records]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { backgroundColor: colors.warning }]}> 
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Escalation Monitoring</Text>
          <Text style={styles.headerSubtitle}>Pending approvals, SLA breaches, and escalation levels</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.warning} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Pending Items</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.total}</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Overdue</Text>
            <Text style={[styles.summaryValue, { color: '#DC2626' }]}>{summary.overdue}</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>High Escalation</Text>
            <Text style={[styles.summaryValue, { color: '#EA580C' }]}>{summary.highEscalation}</Text>
          </View>
        </View>

        <View style={[styles.filterRow, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          {(['all', 'disease', 'water', 'campaign', 'alert'] as const).map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === item ? colors.warning : colors.background,
                  borderColor: filter === item ? colors.warning : colors.border,
                },
              ]}
              onPress={() => setFilter(item)}
            >
              <Text style={[styles.filterChipText, { color: filter === item ? '#FFFFFF' : colors.textSecondary }]}>
                {item === 'all' ? 'All' : item.charAt(0).toUpperCase() + item.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error && (
          <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>{error}</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.warning} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading escalations...</Text>
          </View>
        ) : (
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            {filteredRecords.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No records for the selected filter.</Text>
            ) : (
              filteredRecords.map((record) => {
                const level = record.escalation_level || 0;
                const levelColor = escalationColor(level);

                return (
                  <View key={`${record.report_type}-${record.report_id}`} style={[styles.recordCard, { borderColor: colors.border }]}> 
                    <View style={styles.recordHeader}>
                      <Text style={[styles.recordTitle, { color: colors.text }]}>
                        {record.report_type.replace(/_/g, ' ').toUpperCase()} • {record.report_id.slice(0, 8)}
                      </Text>
                      <View style={[styles.levelPill, { backgroundColor: `${levelColor}22` }]}> 
                        <Text style={[styles.levelText, { color: levelColor }]}>L{level}</Text>
                      </View>
                    </View>

                    <Text style={[styles.recordMeta, { color: colors.textSecondary }]}> 
                      {record.district || 'Unknown district'}
                      {record.location_name ? ` • ${record.location_name}` : ''}
                    </Text>
                    <Text style={[styles.recordMeta, { color: colors.textSecondary }]}> 
                      Pending {Math.round(record.pending_hours || 0)}h
                      {record.is_overdue ? ' • Overdue' : ' • Within SLA'}
                      {record.approval_status ? ` • ${record.approval_status}` : ''}
                    </Text>

                    {onOpenQueue && (
                      <TouchableOpacity
                        style={[styles.queueBtn, { borderColor: colors.warning, backgroundColor: `${colors.warning}18` }]}
                        onPress={() => onOpenQueue(queueTabForRecord(record.report_type))}
                      >
                        <Ionicons name="open-outline" size={13} color={colors.warning} />
                        <Text style={[styles.queueBtnText, { color: colors.warning }]}>Open Queue</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  filterRow: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  errorCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  listCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  emptyText: {
    fontSize: 12,
  },
  recordCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  recordTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  levelPill: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  levelText: {
    fontSize: 10,
    fontWeight: '800',
  },
  recordMeta: {
    marginTop: 4,
    fontSize: 11,
  },
  queueBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  queueBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default EscalationMonitoringScreen;
