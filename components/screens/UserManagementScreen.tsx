// =====================================================
// USER MANAGEMENT SCREEN ("Prakash" design)
// Users admin table — flat headerBg band + Role Ribbon,
// flat data rows with hairline dividers, 4-state data
// region, One-Hand Action Bar on the detail modal.
// Delete semantics: soft-delete only (is_active=false),
// surfaced as "Deactivate".
// =====================================================
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, Pressable, RefreshControl, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import { ROLE_ACCENT, SkeletonBlock, ErrorCard, EmptyState } from '../dashboards/DashboardShared';

interface Props { profile: Profile; onBack: () => void }

interface User {
  id: string; email: string; full_name: string; role: string;
  phone: string; district: string; state: string;
  created_at: string; is_active: boolean;
}

const ROLES = ['super_admin','health_admin','district_officer','clinic','asha_worker','volunteer'];

const ROLE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  super_admin: 'shield-checkmark-outline', health_admin: 'medkit-outline', district_officer: 'business-outline',
  clinic: 'medical-outline', asha_worker: 'heart-outline', volunteer: 'hand-left-outline',
};
const ROLE_DISPLAY: Record<string,string> = {
  super_admin: 'Super Admin', health_admin: 'Health Admin',
  district_officer: 'District Officer', clinic: 'Clinic',
  asha_worker: 'ASHA Worker', volunteer: 'Volunteer',
};

interface ConfirmAction {
  title: string;
  message: string;
  type: 'danger' | 'warning';
  /** Notice-style dialog: single OK button, no destructive confirm */
  notice?: boolean;
  onConfirm: () => Promise<void>;
}

export const UserManagementScreen: React.FC<Props> = ({ profile, onBack }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? colors.primary;

  const [users, setUsers]           = useState<User[]>([]);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const [confirmModal, setConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const showNotice = (title: string, message: string, type: 'danger' | 'warning' = 'warning') => {
    setConfirmAction({ title, message, type, notice: true, onConfirm: async () => setConfirmModal(false) });
    setConfirmModal(true);
  };

  const load = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data ?? []);
      setFetchError(null);
    } catch (e: any) {
      setFetchError("Couldn't load users — check connection");
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const changeRole = (userId: string, newRole: string) => {
    if (profile.role !== 'super_admin') {
      showNotice('Permission Denied', 'Only Super Administrators can change roles.');
      return;
    }
    if (userId === profile.id && newRole !== 'super_admin') {
      showNotice('Not Allowed', 'Cannot change your own role away from super_admin.');
      return;
    }
    setConfirmAction({
      title: 'Change Role',
      message: `Change role to ${ROLE_DISPLAY[newRole] ?? newRole}?`,
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

  // Single soft-delete path: is_active=false, always reversible.
  const toggleStatus = (u: User) => {
    if (u.id === profile.id) {
      showNotice('Not Allowed', 'Cannot deactivate your own account.');
      return;
    }
    const next = !u.is_active;
    setConfirmAction({
      title: next ? 'Activate User' : 'Deactivate User',
      message: next
        ? `Activate ${u.full_name}? They will regain access to the system.`
        : `Deactivate ${u.full_name}? The account will be marked inactive and can be reactivated later.`,
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

  const runConfirm = async () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try {
      await confirmAction.onConfirm();
    } catch (e: any) {
      showNotice('Error', e?.message ?? 'Action failed — check connection', 'danger');
    } finally {
      setConfirmBusy(false);
    }
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

  // ── Flat data row — surface bg, hairline divider ──────────────────────────
  const renderUser = ({ item: u }: { item: User }) => {
    const rc = ROLE_ACCENT[u.role] ?? colors.textSecondary;
    const ri = ROLE_ICON[u.role] ?? 'person-outline';
    return (
      <Pressable
        style={({ pressed }) => [
          s.row,
          {
            backgroundColor: pressed ? colors.cardHover : colors.surface,
            borderBottomColor: colors.borderLight,
          },
        ]}
        onPress={() => { setSelectedUser(u); setShowModal(true); }}
        accessibilityRole="button"
        accessibilityLabel={`${u.full_name || 'Unnamed user'}, role ${ROLE_DISPLAY[u.role] ?? u.role}${u.is_active === false ? ', inactive' : ''}`}
      >
        <View style={[s.avatar, { backgroundColor: rc + '14' }]}>
          <Ionicons name={ri} size={20} color={rc} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>
            {u.full_name || 'No Name'}
          </Text>
          <Text style={[s.email, { color: colors.textSecondary }]} numberOfLines={1}>{u.email}</Text>
          <Text style={[s.loc, { color: colors.textSecondary }]} numberOfLines={1}>
            {u.district ? `${u.district}, ${u.state}` : 'No location'}
          </Text>
        </View>
        <View style={s.rowRight}>
          <View style={[s.rolePill, { backgroundColor: colors.surfaceVariant }]}>
            <View style={[s.pillDot, { backgroundColor: rc }]} />
            <Text style={[s.rolePillText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              {(ROLE_DISPLAY[u.role] ?? u.role)?.toUpperCase()}
            </Text>
          </View>
          {u.is_active === false && (
            <View style={[s.rolePill, { backgroundColor: colors.dangerBg }]}>
              <View style={[s.pillDot, { backgroundColor: colors.danger }]} />
              <Text style={[s.rolePillText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                INACTIVE
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  // Header text: navy band in light mode → white; surface band in dark → ink.
  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;

  const selectedActive = selectedUser?.is_active !== false;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg band */}
      <View
        style={[
          s.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={s.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[s.headerTitle, { color: headerText }]}>User Management</Text>
          <Text style={[s.headerSub, { color: headerSub }]} maxFontSizeMultiplier={1.3}>
            {users.length} registered user{users.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
      {/* Role Ribbon */}
      <View style={[s.roleRibbon, { backgroundColor: accent }]} />

      {/* Search */}
      <View style={[s.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder="Search users..."
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

      {/* Role filter chips — selected = solid fill + check, never tint alone */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filterRow}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center' }}
      >
        {['all', ...ROLES].map(r => {
          const active = roleFilter === r;
          return (
            <TouchableOpacity
              key={r}
              style={[
                s.chip,
                active
                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                  : { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => setRoleFilter(r)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={r === 'all' ? 'All roles' : `Role ${ROLE_DISPLAY[r] ?? r}`}
            >
              {active && <Ionicons name="checkmark" size={14} color={colors.onPrimary} />}
              <Text style={[s.chipText, { color: active ? colors.onPrimary : colors.text }]} maxFontSizeMultiplier={1.3}>
                {r === 'all' ? 'All' : (ROLE_DISPLAY[r] ?? r)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Column-header eyebrow row */}
      <View style={[s.tableHead, { backgroundColor: colors.surfaceVariant, borderBottomColor: colors.border }]}>
        <Text style={[s.tableHeadText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
          USERS
          <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${filtered.length}`}</Text>
        </Text>
      </View>

      {/* Data region — skeleton / error / quiet-zero / content */}
      {fetchError && !loading && (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <ErrorCard message={fetchError} onRetry={() => { setLoading(true); load(); }} />
        </View>
      )}
      {loading ? (
        <View style={s.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
          <SkeletonBlock height={64} radius={radii.sm} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderUser}
          keyExtractor={u => u.id}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            fetchError ? null : (
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
                <EmptyState
                  icon={search || roleFilter !== 'all' ? 'search-outline' : 'checkmark-circle-outline'}
                  color={search || roleFilter !== 'all' ? colors.textSecondary : colors.success}
                  title={search || roleFilter !== 'all'
                    ? 'No users match — try a different search or filter.'
                    : 'No users registered yet.'}
                />
              </View>
            )
          }
        />
      )}

      {/* ── User Detail Modal — One-Hand Action Bar ── */}
      <Modal
        visible={showModal}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={[s.modalOverlay, { backgroundColor: colors.overlay }]}>
          {selectedUser && (
            <View style={[s.modalSheet, { backgroundColor: colors.card }]}>
              {/* Modal Header — avatar ring in role accent */}
              <View style={[s.modalHeader, { borderBottomColor: colors.borderLight }]}>
                <View style={[s.modalAvatar, { borderColor: ROLE_ACCENT[selectedUser.role] ?? colors.border, backgroundColor: colors.surface }]}>
                  <Ionicons
                    name={ROLE_ICON[selectedUser.role] ?? 'person-outline'}
                    size={28}
                    color={ROLE_ACCENT[selectedUser.role] ?? colors.textSecondary}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={[s.modalName, { color: colors.text }]} numberOfLines={1}>{selectedUser.full_name || 'No Name'}</Text>
                  <Text style={[s.modalEmail, { color: colors.textSecondary }]} numberOfLines={1}>{selectedUser.email}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowModal(false)}
                  style={[s.closeBtn, { backgroundColor: colors.surfaceVariant }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close user details"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ paddingHorizontal: spacing.lg }}>
                {/* Status pill — dot + label, never color alone */}
                <View style={s.statusRow}>
                  <View style={[s.rolePill, { backgroundColor: selectedActive ? colors.successBg : colors.dangerBg }]}>
                    <View style={[s.pillDot, { backgroundColor: selectedActive ? colors.success : colors.danger }]} />
                    <Text style={[s.rolePillText, { color: selectedActive ? colors.success : colors.danger }]} maxFontSizeMultiplier={1.3}>
                      {selectedActive ? 'ACTIVE' : 'INACTIVE'}
                    </Text>
                  </View>
                </View>

                {/* Info rows */}
                {[
                  { icon: 'location-outline' as const, label: `${selectedUser.district ?? '-'}, ${selectedUser.state ?? '-'}` },
                  { icon: 'call-outline' as const, label: selectedUser.phone || 'No phone' },
                  { icon: 'time-outline' as const, label: selectedUser.created_at ? `Joined ${format(new Date(selectedUser.created_at),'d MMM yyyy')}` : 'Joined date unknown' },
                ].map((row, i) => (
                  <View key={i} style={[s.infoRow, { borderBottomColor: colors.borderLight }]}>
                    <Ionicons name={row.icon} size={16} color={colors.textSecondary} />
                    <Text style={[s.infoText, { color: colors.text }]}>{row.label}</Text>
                  </View>
                ))}

                {/* Role change — super_admin only */}
                {profile.role === 'super_admin' && (
                  <View style={{ marginTop: spacing.lg }}>
                    <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>CHANGE ROLE</Text>
                    <View style={s.roleGrid}>
                      {ROLES.map(r => {
                        const active = selectedUser.role === r;
                        const rc = ROLE_ACCENT[r] ?? colors.primary;
                        return (
                          <TouchableOpacity
                            key={r}
                            style={[
                              s.roleBtn,
                              active
                                ? { backgroundColor: rc, borderColor: rc }
                                : { backgroundColor: colors.card, borderColor: colors.border },
                            ]}
                            onPress={() => changeRole(selectedUser.id, r)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`Set role ${ROLE_DISPLAY[r] ?? r}`}
                          >
                            {active && <Ionicons name="checkmark" size={14} color={colors.textInverse} />}
                            <Text
                              style={[s.roleBtnText, { color: active ? colors.textInverse : colors.text }]}
                              numberOfLines={1}
                              maxFontSizeMultiplier={1.3}
                            >
                              {ROLE_DISPLAY[r] ?? r.replace(/_/g, ' ')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
                <View style={{ height: spacing.xl }} />
              </ScrollView>

              {/* One-Hand Action Bar — soft-delete only, labeled Deactivate */}
              <View style={[s.actionBar, { borderTopColor: colors.borderLight, backgroundColor: colors.card }]}>
                <Pressable
                  style={({ pressed }) => [
                    s.actionBtn,
                    selectedActive
                      ? {
                          backgroundColor: pressed ? colors.cardHover : colors.card,
                          borderWidth: 1.5,
                          borderColor: colors.danger,
                        }
                      : { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  ]}
                  onPress={() => toggleStatus(selectedUser)}
                  accessibilityRole="button"
                  accessibilityLabel={selectedActive ? 'Deactivate user' : 'Activate user'}
                >
                  <Ionicons
                    name={selectedActive ? 'person-remove-outline' : 'person-add-outline'}
                    size={18}
                    color={selectedActive ? colors.danger : colors.onPrimary}
                  />
                  <Text style={[s.actionBtnText, { color: selectedActive ? colors.danger : colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                    {selectedActive ? 'Deactivate' : 'Activate'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Confirm / Notice Modal ── */}
      <Modal
        visible={confirmModal}
        animationType={reduceMotion ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setConfirmModal(false)}
      >
        <View style={[s.confirmOverlay, { backgroundColor: colors.overlay }]}>
          {confirmAction && (
            <View style={[s.confirmSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[s.confirmIconWrap, { backgroundColor: confirmAction.type === 'danger' ? colors.dangerBg : colors.warningBg }]}>
                <Ionicons
                  name={confirmAction.type === 'danger' ? 'warning-outline' : 'alert-circle-outline'}
                  size={28}
                  color={confirmAction.type === 'danger' ? colors.danger : colors.warning}
                />
              </View>
              <Text style={[s.confirmTitle, { color: colors.text }]}>{confirmAction.title}</Text>
              <Text style={[s.confirmMsg, { color: colors.textSecondary }]}>{confirmAction.message}</Text>
              {confirmAction.notice ? (
                <Pressable
                  style={({ pressed }) => [
                    s.cBtn,
                    { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  ]}
                  onPress={() => setConfirmModal(false)}
                  accessibilityRole="button"
                  accessibilityLabel="OK"
                >
                  <Text style={[s.cBtnText, { color: colors.onPrimary }]}>OK</Text>
                </Pressable>
              ) : (
                <View style={s.confirmBtns}>
                  <Pressable
                    style={({ pressed }) => [
                      s.cBtn,
                      {
                        backgroundColor: pressed ? colors.cardHover : colors.card,
                        borderWidth: 1.5,
                        borderColor: colors.inputBorder,
                      },
                    ]}
                    onPress={() => setConfirmModal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <Text style={[s.cBtnText, { color: colors.text }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      s.cBtn,
                      {
                        backgroundColor: confirmAction.type === 'danger'
                          ? colors.danger
                          : pressed ? colors.primaryDark : colors.primary,
                      },
                      confirmBusy && { opacity: 0.4 },
                    ]}
                    onPress={runConfirm}
                    disabled={confirmBusy}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm"
                  >
                    <Text style={[s.cBtnText, { color: confirmAction.type === 'danger' ? colors.textInverse : colors.onPrimary }]}>
                      {confirmBusy ? 'Working…' : 'Confirm'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  /* Header */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, paddingTop: 42 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2, fontVariant: ['tabular-nums'] },
  roleRibbon: { height: 4, width: '100%' },
  /* Search */
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, minHeight: 48,
    borderRadius: radii.md, borderWidth: 1.5, gap: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  /* Filter chips */
  filterRow: { maxHeight: 52, marginBottom: spacing.sm, flexGrow: 0 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    minHeight: 44, paddingHorizontal: spacing.lg,
    borderRadius: radii.pill, borderWidth: 1.5,
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  /* Table head */
  tableHead: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHeadText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  /* Flat data rows */
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  email: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  loc: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  rolePillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  /* Skeleton */
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  /* Detail modal */
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '88%', overflow: 'hidden' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.lg, borderBottomWidth: 1,
  },
  modalAvatar: { width: 56, height: 56, borderRadius: radii.pill, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  modalName: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  modalEmail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  closeBtn: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  statusRow: { flexDirection: 'row', marginTop: spacing.lg, marginBottom: spacing.xs },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, borderBottomWidth: 1 },
  infoText: { fontSize: 15, lineHeight: 22, fontWeight: '500', flexShrink: 1 },
  sectionLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.md },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  roleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderWidth: 1.5, borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, minHeight: 44,
    width: '47%',
  },
  roleBtnText: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  /* One-Hand Action Bar */
  actionBar: {
    padding: spacing.lg, paddingBottom: spacing.xl,
    borderTopWidth: 1,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 56, borderRadius: radii.md,
  },
  actionBtnText: { fontSize: 16, fontWeight: '700' },
  /* Confirm modal */
  confirmOverlay: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  confirmSheet: { borderRadius: radii.lg, borderWidth: 1, padding: spacing.xl, alignItems: 'center' },
  confirmIconWrap: { width: 56, height: 56, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  confirmTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm },
  confirmMsg: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: spacing.xl },
  confirmBtns: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },
  cBtn: { flex: 1, minHeight: 56, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  cBtnText: { fontWeight: '700', fontSize: 15 },
});

export default UserManagementScreen;
