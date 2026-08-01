import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EscalationRecord, Profile } from '../../types';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import { getEscalationMonitoring } from '../../lib/services/advancedAnalytics';

interface EscalationMonitoringScreenProps {
  profile: Profile;
  onBack: () => void;
  onOpenQueue?: (tab: 'disease' | 'water' | 'campaigns' | 'alerts') => void;
}

type FilterType = 'all' | 'disease' | 'water' | 'campaign' | 'alert';

const escalationColor = (level: number, t: Theme): string => {
  if (level >= 3) return t.severityCritical;
  if (level === 2) return t.severityHigh;
  if (level === 1) return t.severityMedium;
  return t.severityLow;
};

const escalationBg = (level: number, t: Theme): string => {
  if (level >= 3) return t.dangerBg;
  if (level === 2) return t.offlineBg;   // saffron family
  if (level === 1) return t.warningBg;
  return t.successBg;
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
  const { colors, isDark } = useTheme();
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
    } catch {
      setRecords([]);
      setError("Couldn't load escalation monitoring — check connection.");
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

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  const summaryCards: { label: string; value: number; rule: string }[] = [
    { label: 'Pending Items', value: summary.total, rule: colors.primary },
    { label: 'Overdue', value: summary.overdue, rule: colors.danger },
    { label: 'High Escalation', value: summary.highEscalation, rule: colors.severityHigh },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper still needs a hairline to read as separated.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: headerText }]}>Escalation Monitoring</Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]}>Pending approvals, SLA breaches, and escalation levels</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.summaryRow}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} width="47%" height={92} radius={8} style={{ flexGrow: 1 }} />
            ))}
          </View>
        ) : (
          <View style={styles.summaryRow}>
            {summaryCards.map((card) => (
              <View
                key={card.label}
                style={[
                  styles.summaryCard,
                  { backgroundColor: colors.card, borderColor: colors.border, borderTopColor: card.rule },
                  !isDark && styles.cardShadow,
                ]}
                accessible
                accessibilityLabel={`${card.label}: ${card.value}`}
              >
                <Text style={[styles.summaryValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {card.value}
                </Text>
                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                  {card.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Filter chips — selection is never conveyed by tint alone */}
        <View style={styles.filterRow}>
          {(['all', 'disease', 'water', 'campaign', 'alert'] as const).map((item) => {
            const selected = filter === item;
            const label = item === 'all' ? 'All' : item.charAt(0).toUpperCase() + item.slice(1);
            return (
              <TouchableOpacity
                key={item}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: selected ? colors.primary : colors.card,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setFilter(item)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Filter: ${label}${selected ? ', selected' : ''}`}
              >
                {selected && <Ionicons name="checkmark" size={14} color={colors.onPrimary} />}
                <Text
                  style={[styles.filterChipText, { color: selected ? colors.onPrimary : colors.text }]}
                  maxFontSizeMultiplier={1.3}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            <SkeletonBlock height={112} radius={8} />
            <SkeletonBlock height={112} radius={8} />
            <SkeletonBlock height={112} radius={8} />
          </View>
        ) : error ? (
          <View style={{ marginTop: 12 }}>
            <ErrorCard message={error} onRetry={loadRecords} />
          </View>
        ) : (
          <View
            style={[
              styles.listCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            <Text style={[styles.listTitle, { color: colors.textSecondary }]}>
              ESCALATIONS
              <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${filteredRecords.length}`}</Text>
            </Text>
            {filteredRecords.length === 0 ? (
              <EmptyState
                icon="checkmark-circle-outline"
                color={colors.success}
                title="Queue clear"
                subtitle={
                  filter === 'all'
                    ? 'No pending escalation records in your visible scope.'
                    : 'No records for the selected filter.'
                }
              />
            ) : (
              filteredRecords.map((record) => {
                const level = record.escalation_level || 0;
                const levelColor = escalationColor(level, colors);
                const levelBg = escalationBg(level, colors);
                const isCriticalLevel = level >= 3;

                return (
                  <View
                    key={`${record.report_type}-${record.report_id}`}
                    style={[styles.recordCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  >
                    <View style={styles.recordHeader}>
                      <Text style={[styles.recordTitle, { color: colors.text }]}>
                        {record.report_type.replace(/_/g, ' ').toUpperCase()} · {record.report_id.slice(0, 8)}
                      </Text>
                      <View
                        style={[styles.levelPill, { backgroundColor: isCriticalLevel ? colors.danger : levelBg }]}
                        accessibilityLabel={`Escalation level ${level}`}
                      >
                        {!isCriticalLevel && <View style={[styles.levelDot, { backgroundColor: levelColor }]} />}
                        <Text
                          style={[styles.levelText, { color: isCriticalLevel ? colors.textInverse : levelColor }]}
                          maxFontSizeMultiplier={1.3}
                        >
                          L{level}
                        </Text>
                      </View>
                    </View>

                    <Text style={[styles.recordMeta, { color: colors.textSecondary }]}>
                      {record.district || 'Unknown district'}
                      {record.location_name ? ` · ${record.location_name}` : ''}
                    </Text>
                    <Text style={[styles.recordMeta, { color: colors.textSecondary }]}>
                      Pending {Math.round(record.pending_hours || 0)}h
                      {record.is_overdue ? ' · Overdue' : ' · Within SLA'}
                      {record.approval_status ? ` · ${record.approval_status}` : ''}
                    </Text>

                    {onOpenQueue && (
                      <TouchableOpacity
                        style={[styles.queueBtn, { borderColor: colors.inputBorder, backgroundColor: colors.card }]}
                        onPress={() => onOpenQueue(queueTabForRecord(record.report_type))}
                        accessibilityRole="button"
                        accessibilityLabel="Open approval queue"
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <Ionicons name="open-outline" size={16} color={isDark ? colors.primary : colors.primaryDark} />
                        <Text style={[styles.queueBtnText, { color: isDark ? colors.primary : colors.primaryDark }]}>Open Queue</Text>
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
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    // Rendered inside MainApp's SafeAreaView — no status-bar inset here.
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderTopWidth: 3,
    borderRadius: 12,
    padding: 16,
    minHeight: 92,
    justifyContent: 'flex-end',
  },
  summaryLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  summaryValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  filterRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  filterChipText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  listCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  listTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  recordCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
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
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  levelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  levelText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'],
  },
  recordMeta: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  queueBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  queueBtnText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});

export default EscalationMonitoringScreen;
