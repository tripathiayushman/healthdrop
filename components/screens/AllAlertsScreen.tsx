// =====================================================
// ALL ALERTS SCREEN
// Full list of active health alerts with search, filter, and detail modal.
// =====================================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ScrollView, TextInput, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';

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

const URGENCY_COLORS: Record<string, string> = {
  critical: '#EF4444',
  high:     '#F59E0B',
  medium:   '#3B82F6',
  low:      '#10B981',
};

const getUrgencyColor = (level: string) => URGENCY_COLORS[level?.toLowerCase()] ?? '#6B7280';

const AllAlertsScreen: React.FC<Props> = ({ profile, onBack }) => {
  const { colors, isDark } = useTheme();
  const gradient: [string, string] = isDark ? ['#1E293B', '#0F172A'] : ['#DC2626', '#991B1B'];

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);

  const load = useCallback(async () => {
    try {
      let q = supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false });

      if (profile.district && profile.role === 'volunteer') {
        q = q.eq('district', profile.district);
      }
      if (urgencyFilter) q = q.eq('urgency_level', urgencyFilter);
      if (search.trim()) q = q.ilike('title', `%${search.trim()}%`);

      const { data } = await q;
      if (data) setAlerts(data);
    } catch {}
    finally { setLoading(false); }
  }, [urgencyFilter, search, profile]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={[as.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient colors={gradient} style={as.header}>
        <TouchableOpacity onPress={onBack} style={as.back}>
          <Ionicons name="arrow-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={as.headerTitle}>Active Alerts</Text>
          <Text style={as.headerSub}>{alerts.length} alert{alerts.length !== 1 ? 's' : ''} found</Text>
        </View>
      </LinearGradient>

      {/* Search */}
      <View style={[as.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[as.searchInput, { color: colors.text }]}
          placeholder="Search alerts..."
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Urgency filter chips */}
      <View style={as.chipRow}>
        {(['', 'critical', 'high', 'medium', 'low'] as const).map(u => {
          const active = urgencyFilter === u;
          const color = u === '' ? colors.primary : getUrgencyColor(u);
          return (
            <TouchableOpacity
              key={u || 'all'}
              style={[as.chip, { backgroundColor: active ? color : color + '15', borderColor: color }]}
              onPress={() => setUrgencyFilter(u)}
            >
              <Text style={[as.chipText, { color: active ? '#FFF' : color }]}>
                {u === '' ? 'All' : u.charAt(0).toUpperCase() + u.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={[as.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#10B981" />
              <Text style={[as.emptyTitle, { color: colors.text }]}>No Alerts Found</Text>
              <Text style={[as.emptySub, { color: colors.textSecondary }]}>
                {search || urgencyFilter ? 'Try a different search or filter' : 'No active health alerts right now'}
              </Text>
            </View>
          }
          renderItem={({ item: a }) => (
            <TouchableOpacity
              style={[as.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: getUrgencyColor(a.urgency_level), borderLeftWidth: 4 }]}
              activeOpacity={0.75}
              onPress={() => setSelected(a)}
            >
              <View style={as.cardTop}>
                <Text style={[as.cardTitle, { color: colors.text }]} numberOfLines={1}>{a.title}</Text>
                <View style={[as.urgencyBadge, { backgroundColor: getUrgencyColor(a.urgency_level) + '20' }]}>
                  <Text style={[as.urgencyText, { color: getUrgencyColor(a.urgency_level) }]}>
                    {a.urgency_level?.toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={[as.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>{a.description}</Text>
              <View style={as.cardFooter}>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={[as.cardLoc, { color: colors.textSecondary }]} numberOfLines={1}>
                  {a.location_name}, {a.district}
                </Text>
                <Text style={[as.cardDate, { color: colors.textSecondary }]}>
                  {format(new Date(a.created_at), 'dd MMM yyyy')}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!selected} animationType="slide" transparent>
        <View style={as.overlay}>
          {selected && (
            <View style={[as.sheet, { backgroundColor: colors.card }]}>
              <LinearGradient colors={gradient} style={as.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={as.modalTitle}>{selected.title}</Text>
                  <Text style={as.modalSub}>{selected.alert_type?.replace(/_/g, ' ')}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)}>
                  <Ionicons name="close" size={22} color="rgba(255,255,255,0.8)" />
                </TouchableOpacity>
              </LinearGradient>

              <ScrollView style={{ padding: 16 }}>
                {/* Urgency badge */}
                <View style={{ marginBottom: 14 }}>
                  <View style={[as.urgencyBadge, { backgroundColor: getUrgencyColor(selected.urgency_level) + '20', alignSelf: 'flex-start' }]}>
                    <Text style={[as.urgencyText, { color: getUrgencyColor(selected.urgency_level) }]}>
                      {selected.urgency_level?.toUpperCase()} PRIORITY
                    </Text>
                  </View>
                </View>

                {[
                  { label: 'Description',  value: selected.description },
                  { label: 'Location',     value: `${selected.location_name}, ${selected.district}, ${selected.state}` },
                  { label: 'Reported On',  value: format(new Date(selected.created_at), 'MMMM d, yyyy · h:mm a') },
                ].map((row, i) => (
                  <View key={i} style={[as.detailRow, { borderBottomColor: colors.border }]}>
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20, paddingTop: 36 },
  back: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5 },
  chipText: { fontSize: 12, fontWeight: '600' },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  urgencyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  urgencyText: { fontSize: 10, fontWeight: '700' },
  cardDesc: { fontSize: 13, marginBottom: 8, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardLoc: { fontSize: 12, flex: 1 },
  cardDate: { fontSize: 11 },
  emptyBox: { padding: 40, borderRadius: 16, borderWidth: 1, alignItems: 'center', marginTop: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  emptySub: { fontSize: 13, textAlign: 'center', marginTop: 6 },
  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  modalSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2, textTransform: 'capitalize' },
  detailRow: { paddingVertical: 12, borderBottomWidth: 1 },
  detailLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  detailValue: { fontSize: 14 },
});

export { AllAlertsScreen };
export default AllAlertsScreen;
