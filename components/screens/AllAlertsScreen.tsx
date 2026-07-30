// =====================================================
// ALL ALERTS SCREEN ("Prakash" design)
// Full list of active health alerts with search, filter,
// and detail modal. Flat headerBg band, token-driven
// severity, 4-state data region.
// =====================================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ScrollView, TextInput, RefreshControl, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import { filterAlertsForProfile, isRadiusScopedRole } from '../../lib/services/alertRadius';
import { sanitizeSearchTerm } from '../../lib/services/searchSanitize';
import { SkeletonBlock, ErrorCard, EmptyState, getSeverityColor } from '../dashboards/DashboardShared';

interface Props { profile: Profile; onBack: () => void; }

interface Alert {
  id: string;
  title: string;
  description: string;
  alert_type: string;
  urgency_level: string;
  district: string;
  state: string;
  location_name: string;
  status: string;
  created_at: string;
}

const AllAlertsScreen: React.FC<Props> = ({ profile, onBack }) => {
  const { colors, isDark, reduceMotion } = useTheme();

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFetchError(null);
    try {
      let q = supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(200);

      if (urgencyFilter) q = q.eq('urgency_level', urgencyFilter);
      const term = sanitizeSearchTerm(search);
      if (term) q = q.ilike('title', `%${term}%`);

      const { data, error } = await q;
      if (error) {
        console.error('Failed to load alerts:', error);
        setFetchError("Couldn't load alerts — check connection");
      } else if (data) {
        if (isRadiusScopedRole(profile.role)) {
          setAlerts(filterAlertsForProfile(data, profile));
        } else {
          setAlerts(data);
        }
      }
    } catch (err: any) {
      console.error('Failed to load alerts:', err);
      setFetchError("Couldn't load alerts — check connection");
    }
    finally { setLoading(false); }
  }, [urgencyFilter, search, profile]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const formatSafeDate = (value: string | null | undefined, pattern: string, fallback = ''): string => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return fallback;
    return format(parsed, pattern);
  };

  // Soft background for a severity pill — solid fill is CRITICAL's privilege alone.
  const severitySoftBg = (level: string): string => {
    switch (level?.toLowerCase()) {
      case 'critical': return colors.dangerBg;
      case 'high': return colors.offlineBg;
      case 'medium': return colors.warningBg;
      case 'low': return colors.successBg;
      default: return colors.surfaceVariant;
    }
  };

  const SeverityPill: React.FC<{ level: string; suffix?: string }> = ({ level, suffix }) => {
    const key = level?.toLowerCase() ?? '';
    const isCritical = key === 'critical';
    const fg = isCritical ? colors.textInverse : getSeverityColor(key, colors);
    const bg = isCritical ? colors.danger : severitySoftBg(key);
    return (
      <View style={[as.severityPill, { backgroundColor: bg }]} accessibilityLabel={`Urgency: ${key || 'unknown'}`}>
        {!isCritical && <View style={[as.severityDot, { backgroundColor: fg }]} />}
        <Text style={[as.severityPillText, { color: fg }]} maxFontSizeMultiplier={1.3}>
          {(level ?? '').toUpperCase()}{suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
    );
  };

  // Header text: navy band in light mode → white; surface band in dark → ink.
  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;

  return (
    <View style={[as.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg band */}
      <View
        style={[
          as.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={as.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[as.headerTitle, { color: headerText }]}>Active Alerts</Text>
          <Text style={[as.headerSub, { color: headerSub }]} maxFontSizeMultiplier={1.3}>
            {alerts.length} alert{alerts.length !== 1 ? 's' : ''} found
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={[as.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[as.searchInput, { color: colors.text }]}
          placeholder="Search alerts..."
          placeholderTextColor={colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Urgency filter chips — selected = solid fill + check, never tint alone */}
      <View style={as.chipRow}>
        {(['', 'critical', 'high', 'medium', 'low'] as const).map(u => {
          const active = urgencyFilter === u;
          const color = u === '' ? colors.primary : getSeverityColor(u, colors);
          const selectedText = u === '' ? colors.onPrimary : colors.textInverse;
          return (
            <TouchableOpacity
              key={u || 'all'}
              style={[
                as.chip,
                active
                  ? { backgroundColor: color, borderColor: color }
                  : { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => setUrgencyFilter(u)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={u === '' ? 'All urgencies' : `Urgency ${u}`}
            >
              {active && <Ionicons name="checkmark" size={14} color={selectedText} />}
              <Text style={[as.chipText, { color: active ? selectedText : colors.text }]} maxFontSizeMultiplier={1.3}>
                {u === '' ? 'All' : u.charAt(0).toUpperCase() + u.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List — skeleton / error / quiet-zero / content */}
      {fetchError && !loading && (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorCard message={fetchError} onRetry={load} />
        </View>
      )}
      {loading ? (
        <View style={as.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={104} radius={radii.md} />
          <SkeletonBlock height={104} radius={radii.md} />
          <SkeletonBlock height={104} radius={radii.md} />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={a => a.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            fetchError ? null : (
              <EmptyState
                icon={search || urgencyFilter ? 'search-outline' : 'checkmark-circle-outline'}
                color={search || urgencyFilter ? colors.textSecondary : colors.success}
                title={search || urgencyFilter
                  ? 'No alerts match — try a different search or filter.'
                  : 'All clear — no active health alerts right now.'}
              />
            )
          }
          renderItem={({ item: a }) => (
            <Pressable
              style={({ pressed }) => [
                as.card,
                {
                  backgroundColor: pressed ? colors.cardHover : colors.card,
                  borderColor: colors.border,
                  borderLeftColor: getSeverityColor(a.urgency_level, colors),
                },
                !isDark && as.cardShadow,
              ]}
              onPress={() => setSelected(a)}
              accessibilityRole="button"
              accessibilityLabel={`Alert, urgency ${a.urgency_level}: ${a.title}`}
            >
              <View style={as.cardTop}>
                <SeverityPill level={a.urgency_level} />
                <Text style={[as.cardDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {formatSafeDate(a.created_at, 'dd MMM yyyy', '—')}
                </Text>
              </View>
              <Text style={[as.cardTitle, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
              <Text style={[as.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>{a.description}</Text>
              <View style={as.cardFooter}>
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <Text style={[as.cardLoc, { color: colors.textSecondary }]} numberOfLines={1}>
                  {a.location_name}, {a.district}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </View>
            </Pressable>
          )}
        />
      )}

      {/* Detail Modal — card surface, 3px severity top rule, no flood fill */}
      <Modal visible={!!selected} animationType={reduceMotion ? 'none' : 'slide'} transparent>
        <View style={[as.overlay, { backgroundColor: colors.overlay }]}>
          {selected && (
            <View style={[as.sheet, { backgroundColor: colors.card }]}>
              <View style={[as.modalTopRule, { backgroundColor: getSeverityColor(selected.urgency_level, colors) }]} />
              <View style={[as.modalHeader, { borderBottomColor: colors.borderLight }]}>
                <View style={{ flex: 1 }}>
                  <View style={as.modalPillRow}>
                    <SeverityPill level={selected.urgency_level} suffix="PRIORITY" />
                    <Text style={[as.modalTypeText, { color: colors.textTertiary }]}>
                      {selected.alert_type?.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[as.modalTitle, { color: colors.text }]} numberOfLines={3}>{selected.title}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelected(null)}
                  style={[as.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close alert details"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ padding: spacing.lg }}>
                {[
                  { label: 'Description',  value: selected.description },
                  { label: 'Location',     value: `${selected.location_name}, ${selected.district}, ${selected.state}` },
                  { label: 'Reported On',  value: formatSafeDate(selected.created_at, 'MMMM d, yyyy · h:mm a', 'Unknown') },
                ].map((row, i) => (
                  <View key={i} style={[as.detailRow, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[as.detailLabel, { color: colors.textSecondary }]}>{row.label}</Text>
                    <Text style={[as.detailValue, { color: colors.text }]}>{row.value || 'N/A'}</Text>
                  </View>
                ))}

                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const as = StyleSheet.create({
  container: { flex: 1 },
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, paddingTop: 42 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, minHeight: 52,
    borderRadius: radii.md, borderWidth: 1.5, gap: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.lg, minHeight: 44,
    borderRadius: radii.pill, borderWidth: 1.5,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  skeletonWrap: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.xs },
  card: {
    borderRadius: radii.md, borderWidth: 1, borderLeftWidth: 3,
    padding: spacing.lg, marginBottom: spacing.md, minHeight: 64,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: spacing.xs },
  severityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
  },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  severityPillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  cardDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.sm },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardLoc: { fontSize: 13, lineHeight: 18, flex: 1 },
  cardDate: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  // Modal
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '80%', overflow: 'hidden' },
  modalTopRule: { height: 3, width: '100%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.lg, borderBottomWidth: 1,
  },
  modalPillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  modalTypeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  modalTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  modalCloseBtn: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  detailRow: { paddingVertical: spacing.md, borderBottomWidth: 1 },
  detailLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  detailValue: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
});

export { AllAlertsScreen };
export default AllAlertsScreen;
