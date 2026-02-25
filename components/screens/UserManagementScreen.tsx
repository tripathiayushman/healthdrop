// =====================================================
// USER MANAGEMENT SCREEN
// Extracted from AdminManagementScreen — Users tab only
// Header color matches role dashboard gradient / accent
// =====================================================
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, Alert, ActivityIndicator, RefreshControl,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import { ROLE_GRADIENTS, ROLE_ACCENT } from '../dashboards/DashboardShared';

interface Props { profile: Profile; onBack: () => void }

interface User {
  id: string; email: string; full_name: string; role: string;
  phone: string; district: string; state: string;
  created_at: string; is_active: boolean;
}

const ROLES = ['super_admin','health_admin','district_officer','clinic','asha_worker','volunteer'];

const ROLE_COLOR: Record<string,string> = {
  super_admin: '#42A5F5', health_admin: '#26A69A', district_officer: '#818CF8',
  clinic: '#A78BFA', asha_worker: '#FB923C', volunteer: '#4ADE80',
};
const ROLE_ICON: Record<string,string> = {
  super_admin: 'shield-checkmark', health_admin: 'medkit', district_officer: 'business',
  clinic: 'medical', asha_worker: 'heart', volunteer: 'hand-left',
};
const ROLE_DISPLAY: Record<string,string> = {
  super_admin: 'Super Admin', health_admin: 'Health Admin',
  district_officer: 'District Officer', clinic: 'Clinic',
  asha_worker: 'ASHA Worker', volunteer: 'Volunteer',
};

export const UserManagementScreen: React.FC<Props> = ({ profile, onBack }) => {
  const { colors, isDark } = useTheme();
  const accent   = ROLE_ACCENT[profile.role] ?? '#42A5F5';
  const gradient = ROLE_GRADIENTS[profile.role] ?? ['#0F172A','#1E3A5F','#1976D2'];

  const [users, setUsers]           = useState<User[]>([]);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const [confirmModal, setConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string; message: string; type: 'danger'|'warning'; onConfirm: () => Promise<void>;
  } | null>(null);

  const load = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data ?? []);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const changeRole = (userId: string, newRole: string) => {
    if (profile.role !== 'super_admin') {
      Alert.alert('Permission Denied', 'Only Super Administrators can change roles.');
      return;
    }
    if (userId === profile.id && newRole !== 'super_admin') {
      Alert.alert('Warning', 'Cannot change your own role away from super_admin.');
      return;
    }
    setConfirmAction({
      title: 'Change Role',
      message: `Change role to ${newRole}?`,
      type: 'warning',
      onConfirm: async () => {
        const { error } = await supabase.from('profiles')
          .update({ role: newRole, updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) throw error;
        setConfirmModal(false);
        setShowModal(false);
        load();
      },
    });
    setConfirmModal(true);
  };

  const toggleStatus = (u: User) => {
    if (u.id === profile.id) { Alert.alert('Warning', 'Cannot deactivate your own account.'); return; }
    const next = !u.is_active;
    setConfirmAction({
      title: next ? 'Activate User' : 'Deactivate User',
      message: `${next ? 'Activate' : 'Deactivate'} ${u.full_name}?`,
      type: next ? 'warning' : 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('profiles')
          .update({ is_active: next, updated_at: new Date().toISOString() })
          .eq('id', u.id);
        if (error) throw error;
        setConfirmModal(false);
        setShowModal(false);
        load();
      },
    });
    setConfirmModal(true);
  };

  const deleteUser = (u: User) => {
    if (u.id === profile.id) { Alert.alert('Warning', 'Cannot delete your own account.'); return; }
    setConfirmAction({
      title: 'Delete User',
      message: `Permanently delete ${u.full_name}? This cannot be undone.`,
      type: 'danger',
      onConfirm: async () => {
        const { error } = await supabase.from('profiles').delete().eq('id', u.id);
        if (error) throw error;
        setConfirmModal(false);
        setShowModal(false);
        load();
      },
    });
    setConfirmModal(true);
  };

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      u.full_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q);
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  // ── UserCard ──────────────────────────────────────────────────────────────
  const renderUser = ({ item: u }: { item: User }) => {
    const rc = ROLE_COLOR[u.role] ?? colors.textSecondary;
    const ri = ROLE_ICON[u.role]  ?? 'person';
    return (
      <TouchableOpacity
        style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => { setSelectedUser(u); setShowModal(true); }}
        activeOpacity={0.75}
      >
        <View style={s.cardRow}>
          <View style={[s.avatar, { backgroundColor: rc + '22' }]}>
            <Ionicons name={ri as any} size={20} color={rc} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.nameRow}>
              <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>
                {u.full_name || 'No Name'}
              </Text>
              {u.is_active === false && (
                <View style={[s.inactivePill, { backgroundColor: '#EF444420' }]}>
                  <Text style={[s.inactivePillText, { color: '#EF4444' }]}>Inactive</Text>
                </View>
              )}
            </View>
            <Text style={[s.email, { color: colors.textSecondary }]} numberOfLines={1}>{u.email}</Text>
            <Text style={[s.loc, { color: colors.textSecondary }]} numberOfLines={1}>
              {u.district ? `${u.district}, ${u.state}` : 'No location'}
            </Text>
          </View>
          <View style={[s.rolePill, { backgroundColor: rc + '22' }]}>
            <Text style={[s.rolePillText, { color: rc }]}>{(ROLE_DISPLAY[u.role] ?? u.role)?.toUpperCase()}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient colors={gradient as any} style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.back}>
          <Ionicons name="arrow-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.headerTitle}>User Management</Text>
          <Text style={s.headerSub}>{users.length} registered users</Text>
        </View>
        <View style={[s.badge, { backgroundColor: accent + '30' }]}>
          <Ionicons name="people" size={18} color={accent} />
        </View>
      </LinearGradient>

      {/* Search */}
      <View style={[s.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder="Search users..."
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

      {/* Role filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: 'center' }}>
        {['all', ...ROLES].map(r => {
          const active = roleFilter === r;
          const chipColor = r === 'all' ? accent : (ROLE_COLOR[r] ?? accent);
          return (
            <TouchableOpacity
              key={r}
              style={[s.chip, { backgroundColor: active ? chipColor : colors.card, borderColor: active ? chipColor : colors.border }]}
              onPress={() => setRoleFilter(r)}
            >
              <Text style={[s.chipText, { color: active ? '#FFF' : colors.textSecondary }]}>
                {r === 'all' ? 'All' : (ROLE_DISPLAY[r] ?? r)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* List */}
      {loading
        ? <ActivityIndicator size="large" color={accent} style={{ marginTop: 40 }} />
        : (
          <FlatList
            data={filtered}
            renderItem={renderUser}
            keyExtractor={u => u.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={accent} />}
            ListEmptyComponent={
              <View style={s.empty}>
                <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                <Text style={[s.emptyText, { color: colors.textSecondary }]}>No users found</Text>
              </View>
            }
          />
        )
      }

      {/* ── User Detail Modal ── */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          {selectedUser && (
            <View style={[s.modalSheet, { backgroundColor: colors.card }]}>
              {/* Modal Header */}
              <LinearGradient colors={gradient as any} style={s.modalHeader}>
                <View style={[s.modalAvatar, { backgroundColor: (ROLE_COLOR[selectedUser.role] ?? '#888') + '30' }]}>
                  <Ionicons name={(ROLE_ICON[selectedUser.role] ?? 'person') as any} size={32} color={ROLE_COLOR[selectedUser.role] ?? '#888'} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.modalName}>{selectedUser.full_name || 'No Name'}</Text>
                  <Text style={s.modalEmail}>{selectedUser.email}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close" size={22} color="rgba(255,255,255,0.8)" />
                </TouchableOpacity>
              </LinearGradient>

              <ScrollView style={{ padding: 16 }}>
                {/* Info rows */}
                {[
                  { icon: 'location-outline', label: `${selectedUser.district ?? '-'}, ${selectedUser.state ?? '-'}` },
                  { icon: 'call-outline', label: selectedUser.phone || 'No phone' },
                  { icon: 'time-outline', label: selectedUser.created_at ? format(new Date(selectedUser.created_at),'MMM d, yyyy') : 'Unknown' },
                ].map((row, i) => (
                  <View key={i} style={[s.infoRow, { borderBottomColor: colors.border }]}>
                    <Ionicons name={row.icon as any} size={16} color={colors.textSecondary} />
                    <Text style={[s.infoText, { color: colors.text }]}>{row.label}</Text>
                  </View>
                ))}

                {/* Status */}
                <View style={[s.infoRow, { borderBottomColor: colors.border }]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={selectedUser.is_active !== false ? '#10B981' : '#EF4444'} />
                  <Text style={{ color: selectedUser.is_active !== false ? '#10B981' : '#EF4444', marginLeft: 8, fontWeight: '600' }}>
                    {selectedUser.is_active !== false ? 'Active' : 'Inactive'}
                  </Text>
                </View>

                {/* Role change — super_admin only */}
                {profile.role === 'super_admin' && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>CHANGE ROLE</Text>
                    <View style={s.roleGrid}>
                      {ROLES.map(r => {
                        const active = selectedUser.role === r;
                        const rc = ROLE_COLOR[r] ?? '#888';
                        return (
                          <TouchableOpacity
                            key={r}
                            style={[s.roleBtn, { backgroundColor: active ? rc : colors.surface, borderColor: active ? rc : colors.border }]}
                            onPress={() => changeRole(selectedUser.id, r)}
                          >
                            <Text style={[s.roleBtnText, { color: active ? '#FFF' : colors.textSecondary }]} numberOfLines={1}>
                              {ROLE_DISPLAY[r] ?? r.replace(/_/g, ' ')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Actions */}
                <View style={s.actionRow}>
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: selectedUser.is_active !== false ? '#EF4444' : '#10B981' }]}
                    onPress={() => toggleStatus(selectedUser)}
                  >
                    <Ionicons name={selectedUser.is_active !== false ? 'person-remove' : 'person-add'} size={16} color="#FFF" />
                    <Text style={s.actionBtnText}>{selectedUser.is_active !== false ? 'Deactivate' : 'Activate'}</Text>
                  </TouchableOpacity>
                  {profile.role === 'super_admin' && (
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: '#7F1D1D' }]}
                      onPress={() => deleteUser(selectedUser)}
                    >
                      <Ionicons name="trash" size={16} color="#FFF" />
                      <Text style={s.actionBtnText}>Delete User</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Confirm Modal ── */}
      <Modal visible={confirmModal} animationType="fade" transparent>
        <View style={s.confirmOverlay}>
          {confirmAction && (
            <View style={[s.confirmSheet, { backgroundColor: colors.card }]}>
              <Ionicons
                name={confirmAction.type === 'danger' ? 'warning' : 'alert-circle'}
                size={36}
                color={confirmAction.type === 'danger' ? '#EF4444' : '#F59E0B'}
                style={{ alignSelf: 'center', marginBottom: 12 }}
              />
              <Text style={[s.confirmTitle, { color: colors.text }]}>{confirmAction.title}</Text>
              <Text style={[s.confirmMsg, { color: colors.textSecondary }]}>{confirmAction.message}</Text>
              <View style={s.confirmBtns}>
                <TouchableOpacity style={[s.cBtn, { borderColor: colors.border }]} onPress={() => setConfirmModal(false)}>
                  <Text style={[s.cBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.cBtn, { backgroundColor: confirmAction.type === 'danger' ? '#EF4444' : '#F59E0B' }]}
                  onPress={() => confirmAction.onConfirm().catch(e => Alert.alert('Error', e.message))}
                >
                  <Text style={[s.cBtnText, { color: '#FFF' }]}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20, paddingTop: 36 },
  back: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', margin: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  filterRow: { maxHeight: 44, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', flex: 1 },
  email: { fontSize: 12, marginTop: 2 },
  loc: { fontSize: 12, marginTop: 1 },
  rolePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  rolePillText: { fontSize: 10, fontWeight: '700' },
  inactivePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  inactivePillText: { fontSize: 10, fontWeight: '700' },
  empty: { paddingTop: 60, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalName: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  modalEmail: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  infoText: { fontSize: 14 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleBtn: {
    borderWidth: 1.5, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
    width: '46%',
  },
  roleBtnText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 40 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  actionBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  // Confirm
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  confirmSheet: { borderRadius: 20, padding: 24 },
  confirmTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  confirmMsg: { fontSize: 14, textAlign: 'center', marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12 },
  cBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  cBtnText: { fontWeight: '700', fontSize: 14 },
});

export default UserManagementScreen;
