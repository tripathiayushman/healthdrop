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
import { Profile } from '../../types';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { EmptyState, ErrorCard, SkeletonBlock } from '../dashboards/DashboardShared';
import {
  EscalationRecordWithSla,
  EscalationSlaPolicy,
  getEscalationMonitoring,
  getEscalationSlaPolicy,
} from '../../lib/services/advancedAnalytics';

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

// A pending item can be four days old. "96h" is a number you have to decode;
// "4.0d" is one you can read at a glance.
const formatHours = (hours: number): string => {
  const value = Math.max(0, hours);
  if (value < 1) return '<1h';
  if (value < 48) return `${Math.round(value)}h`;
  const days = value / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
};

const typeLabel = (reportType: string): string => {
  switch (reportType) {
    case 'disease':
      return 'Disease report';
    case 'water':
      return 'Water report';
    case 'campaign':
      return 'Campaign';
    case 'alert':
      return 'Alert';
    default:
      return 'Report';
  }
};

const EscalationMonitoringScreen: React.FC<EscalationMonitoringScreenProps> = ({
  profile,
  onBack,
  onOpenQueue,
}) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState<EscalationRecordWithSla[]>([]);
  const [policy, setPolicy] = useState<EscalationSlaPolicy | null>(null);
  const [slaOpen, setSlaOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState<string | null>(null);

  const loadRecords = async () => {
    setLoading(true);
    setError(null);

    try {
      const [data, slaPolicy] = await Promise.all([
        getEscalationMonitoring(profile),
        getEscalationSlaPolicy(profile),
      ]);
      setRecords(data);
      setPolicy(slaPolicy);
    } catch {
      // Deliberately NOT `setRecords([])` and carry on: an empty queue and a
      // failed query must never look the same on the screen that decides who
      // is overdue. The error state below owns this branch.
      setRecords([]);
      setPolicy(null);
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

  // The SLA range actually in force, read off the policy rather than restated
  // by hand — a summary line that can drift from the rule is worse than none.
  const slaRange = useMemo(() => {
    if (!policy || policy.tiers.length === 0) return null;
    const hours = policy.tiers.map((tier) => tier.hours);
    return { min: Math.min(...hours), max: Math.max(...hours) };
  }, [policy]);

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  // Labels state the arithmetic. "High Escalation" meant "18 hours old" under
  // one constant while "Overdue" meant "24 hours old" under another; the two
  // counts could disagree and nothing on screen said why.
  const summaryCards: { label: string; value: number; rule: string }[] = [
    { label: 'Awaiting approval', value: summary.total, rule: colors.primary },
    { label: 'Past its SLA', value: summary.overdue, rule: colors.danger },
    { label: 'Twice past its SLA', value: summary.highEscalation, rule: colors.severityHigh },
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

        {/* The rule itself, on the screen that applies it. Until an official
            can edit these hours in the app, the least this owes them is the
            number being used — and where it comes from. */}
        {loading ? (
          <View style={{ marginTop: 12 }}>
            <SkeletonBlock height={64} radius={12} />
          </View>
        ) : policy && slaRange ? (
          <View
            style={[
              styles.slaCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            <TouchableOpacity
              style={styles.slaToggle}
              onPress={() => setSlaOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: slaOpen }}
              accessibilityLabel={`Overdue rule: an item is overdue after ${formatHours(
                slaRange.min
              )} to ${formatHours(slaRange.max)} depending on type and severity. ${
                slaOpen ? 'Hide' : 'Show'
              } every threshold.`}
            >
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.slaTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  Overdue after {formatHours(slaRange.min)}–{formatHours(slaRange.max)}
                </Text>
                <Text style={[styles.slaSub, { color: colors.textSecondary }]}>
                  {policy.editable
                    ? 'Set for this district — tap to see every threshold'
                    : 'Fixed in this app version · not yet editable in the field'}
                </Text>
              </View>
              <Ionicons
                name={slaOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {slaOpen && (
              <View style={[styles.slaTable, { borderTopColor: colors.border }]}>
                {policy.tiers.map((tier) => (
                  <View
                    key={`${tier.report_type}-${tier.severity ?? 'any'}-${tier.district ?? 'all'}`}
                    style={styles.slaRow}
                    accessible
                    accessibilityLabel={`${tier.label}: overdue after ${formatHours(tier.hours)}`}
                  >
                    <Text style={[styles.slaRowLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                      {tier.label}
                    </Text>
                    <Text style={[styles.slaRowValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {formatHours(tier.hours)}
                    </Text>
                  </View>
                ))}
                <Text style={[styles.slaFootnote, { color: colors.textSecondary }]}>
                  Level rises with the item&apos;s own threshold: L1 past it, L2 at twice it, L3 at three times.
                </Text>
              </View>
            )}
          </View>
        ) : null}

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
                const pending = record.pending_hours || 0;
                const remaining = Math.max(0, record.sla_hours - pending);
                const waitLine = record.is_overdue
                  ? `Waiting ${formatHours(pending)} · ${formatHours(record.overdue_by_hours)} past its ${formatHours(record.sla_hours)} SLA`
                  : `Waiting ${formatHours(pending)} · ${formatHours(remaining)} left of its ${formatHours(record.sla_hours)} SLA`;

                return (
                  <View
                    key={`${record.report_type}-${record.report_id}`}
                    style={[styles.recordCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  >
                    {/* Grouped so a screen reader reads one sentence, not six
                        fragments — and so "Open Queue" stays its own stop. */}
                    <View
                      accessible
                      accessibilityLabel={`${typeLabel(record.report_type)}${
                        record.headline ? `, ${record.headline}` : ''
                      }${record.severity_label ? `, ${record.severity_label}` : ''}, ${
                        record.district || 'unknown district'
                      }. ${waitLine}. Escalation level ${level} of 3.`}
                    >
                    <View style={styles.recordHeader}>
                      <Text style={[styles.recordTitle, { color: colors.text }]} numberOfLines={2}>
                        {record.headline || typeLabel(record.report_type)}
                      </Text>
                      <View
                        style={[styles.levelPill, { backgroundColor: isCriticalLevel ? colors.danger : levelBg }]}
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
                      {typeLabel(record.report_type).toUpperCase()}
                      {record.severity_label ? ` · ${record.severity_label.toUpperCase()}` : ''}
                      {` · ${record.report_id.slice(0, 8)}`}
                    </Text>
                    <Text style={[styles.recordMeta, { color: colors.textSecondary }]}>
                      {record.district || 'Unknown district'}
                      {record.location_name ? ` · ${record.location_name}` : ''}
                    </Text>
                    <Text style={[styles.recordMeta, { color: colors.textSecondary }]}>{waitLine}</Text>
                    {record.is_overdue && (
                      // danger-on-dangerBg is the pairing the contrast gate
                      // guards; danger on the card surface is not.
                      <View style={[styles.overduePill, { backgroundColor: colors.dangerBg }]}>
                        <Ionicons name="alert-circle" size={13} color={colors.danger} />
                        <Text style={[styles.overdueText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                          OVERDUE
                        </Text>
                      </View>
                    )}
                    </View>

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
  slaCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  slaToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 64,
    paddingVertical: 12,
  },
  slaTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  slaSub: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  slaTable: {
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 12,
  },
  slaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  slaRowLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  slaRowValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  slaFootnote: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
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
    minHeight: 48,
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
  overduePill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  overdueText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  queueBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 12,
    minHeight: 48,
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
