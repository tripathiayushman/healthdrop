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
import {
  listInvitations, createInvitation, revokeInvitation, verifyRole,
  RoleInvitation, InvitableRole,
} from '../../lib/services/provisioning';

interface Props { profile: Profile; onBack: () => void }

interface User {
  id: string; email: string; full_name: string; role: string;
  phone: string; district: string; state: string;
  created_at: string; is_active: boolean;
  role_verified?: boolean;
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

/** Self-signup roles that need admin confirmation before full access. */
const VERIFIABLE_ROLES = ['clinic', 'asha_worker'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Provisioning — invitations + invite sheet
  const canProvision = profile.role === 'super_admin' || profile.role === 'health_admin';
  const [invitations, setInvitations] = useState<RoleInvitation[]>([]);
  const [invLoading, setInvLoading]   = useState(true);
  const [invError, setInvError]       = useState<string | null>(null);
  const [invExpanded, setInvExpanded] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [inviteEmail, setInviteEmail]       = useState('');
  const [inviteRole, setInviteRole]         = useState<InvitableRole | null>(null);
  const [inviteDistrict, setInviteDistrict] = useState('');
  const [inviteState, setInviteState]       = useState('');
  const [inviteError, setInviteError]       = useState('');
  const [inviteBusy, setInviteBusy]         = useState(false);
  const [inviteFocus, setInviteFocus]       = useState<string | null>(null);

  // health_admin may only provision the three lower roles; super_admin also health_admin
  const inviteRoles: InvitableRole[] = profile.role === 'super_admin'
    ? ['health_admin', 'district_officer', 'clinic', 'asha_worker']
    : ['district_officer', 'clinic', 'asha_worker'];

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

  const loadInvitations = async () => {
    setInvLoading(true);
    const { data, error } = await listInvitations();
    if (error || !data) {
      setInvError("Couldn't load invitations — check connection");
    } else {
      setInvitations(data);
      setInvError(null);
    }
    setInvLoading(false);
  };

  useEffect(() => {
    load();
    if (canProvision) loadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openInvites = invitations.filter(i => !i.claimed_at);
  // "Recently claimed" — the latest few, newest claim first (service pre-sorts)
  const claimedInvites = invitations.filter(i => !!i.claimed_at).slice(0, 5);

  // ── Actions ──────────────────────────────────────────────────────────────
  const resetInviteForm = () => {
    setInviteEmail(''); setInviteRole(null);
    setInviteDistrict(''); setInviteState('');
    setInviteError(''); setInviteFocus(null);
  };

  const submitInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      setInviteError('Enter a valid email address');
      return;
    }
    if (!inviteRole) {
      setInviteError('Choose the role this person will hold');
      return;
    }
    setInviteError('');
    setInviteBusy(true);
    const { error } = await createInvitation({
      email,
      role: inviteRole,
      district: inviteDistrict.trim() || null,
      state: inviteState.trim() || null,
    });
    setInviteBusy(false);
    if (error) {
      setInviteError(error);
      return;
    }
    resetInviteForm();
    setShowInviteSheet(false);
    setInvExpanded(true);
    loadInvitations();
  };

  const confirmRevokeInvite = (inv: RoleInvitation) => {
    setConfirmAction({
      title: 'Revoke Invitation',
      message: `Remove the open invitation for ${inv.email}? If they sign up afterwards they will NOT receive the ${ROLE_DISPLAY[inv.role] ?? inv.role} role.`,
      type: 'danger',
      onConfirm: async () => {
        const { error } = await revokeInvitation(inv.id);
        if (error) throw new Error(error);
        setConfirmModal(false);
        loadInvitations();
      },
    });
    setConfirmModal(true);
  };

  const confirmVerifyRole = (u: User) => {
    setConfirmAction({
      title: 'Verify Role',
      message: `Mark ${u.full_name || u.email} as a verified ${ROLE_DISPLAY[u.role] ?? u.role}? This unlocks district-wide access for their account.`,
      type: 'warning',
      onConfirm: async () => {
        const { error } = await verifyRole(u.id);
        if (error) throw new Error(error);
        setConfirmModal(false);
        setShowModal(false);
        load();
      },
    });
    setConfirmModal(true);
  };
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
    const unverified = VERIFIABLE_ROLES.includes(u.role) && u.role_verified === false;
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
        accessibilityLabel={`${u.full_name || 'Unnamed user'}, role ${ROLE_DISPLAY[u.role] ?? u.role}${unverified ? ', role not yet verified' : ''}${u.is_active === false ? ', inactive' : ''}`}
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
          {unverified && (
            <View style={[s.rolePill, { backgroundColor: colors.warningBg }]}>
              {/* amber always pairs with an icon — never a bare dot */}
              <Ionicons name="alert-circle" size={12} color={colors.warning} />
              <Text style={[s.rolePillText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
                UNVERIFIED
              </Text>
            </View>
          )}
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
  const selectedUnverified =
    !!selectedUser && VERIFIABLE_ROLES.includes(selectedUser.role) && selectedUser.role_verified === false;

  // Invite-sheet input styling — 1.5px at rest, 2px focus, no glow
  const inviteInputStyle = (field: string) => [
    s.invInput,
    {
      backgroundColor: colors.inputBackground,
      borderColor: inviteFocus === field ? colors.inputFocusBorder : colors.inputBorder,
      borderWidth: inviteFocus === field ? 2 : 1.5,
      color: colors.text,
    },
  ];

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

      {/* Invite official — provisioning entry point (super/health admin only) */}
      {canProvision && (
        <Pressable
          style={({ pressed }) => [
            s.inviteBtn,
            {
              backgroundColor: pressed ? colors.cardHover : colors.card,
              borderColor: colors.inputBorder,
            },
          ]}
          onPress={() => { resetInviteForm(); setShowInviteSheet(true); }}
          accessibilityRole="button"
          accessibilityLabel="Invite official"
        >
          <Ionicons name="person-add-outline" size={18} color={isDark ? colors.primary : colors.primaryDark} />
          <Text style={[s.inviteBtnText, { color: isDark ? colors.primary : colors.primaryDark }]} maxFontSizeMultiplier={1.3}>
            Invite official
          </Text>
        </Pressable>
      )}

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

      {/* ── INVITATIONS section — collapsible eyebrow header + 4-state region ── */}
      {canProvision && (
        <>
          <Pressable
            style={({ pressed }) => [
              s.tableHead,
              s.invHead,
              {
                backgroundColor: pressed ? colors.cardHover : colors.surfaceVariant,
                borderBottomColor: colors.border,
              },
            ]}
            onPress={() => setInvExpanded(v => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: invExpanded }}
            accessibilityLabel={`Invitations, ${openInvites.length} open. ${invExpanded ? 'Collapse' : 'Expand'}`}
            hitSlop={{ top: 8, bottom: 8 }}
          >
            <Text style={[s.tableHeadText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              INVITATIONS
              {!invLoading && !invError && (
                <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${openInvites.length}`}</Text>
              )}
            </Text>
            <Ionicons
              name={invExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>
          {invExpanded && (
            <View style={[s.invBody, { borderBottomColor: colors.border }]}>
              {invLoading ? (
                <View style={{ padding: spacing.lg, gap: spacing.md }} accessibilityElementsHidden>
                  <SkeletonBlock height={56} radius={radii.sm} />
                  <SkeletonBlock height={56} radius={radii.sm} />
                </View>
              ) : invError ? (
                <View style={{ padding: spacing.lg }}>
                  <ErrorCard message={invError} onRetry={loadInvitations} />
                </View>
              ) : openInvites.length === 0 && claimedInvites.length === 0 ? (
                <View style={s.invEmpty}>
                  <Ionicons name="mail-open-outline" size={20} color={colors.textSecondary} />
                  <Text style={[s.invEmptyText, { color: colors.textSecondary }]}>
                    No invitations yet — invited officials appear here until they sign up.
                  </Text>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 264 }} nestedScrollEnabled>
                  {openInvites.map(inv => (
                    <View
                      key={inv.id}
                      style={[s.invRow, { backgroundColor: colors.surface, borderBottomColor: colors.borderLight }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>{inv.email}</Text>
                        <Text style={[s.email, { color: colors.textSecondary }]} numberOfLines={1}>
                          {(ROLE_DISPLAY[inv.role] ?? inv.role)}
                          {inv.district ? ` · ${inv.district}` : ' · Any district'}
                        </Text>
                      </View>
                      <View style={[s.rolePill, { backgroundColor: colors.infoBg }]}>
                        <View style={[s.pillDot, { backgroundColor: colors.info }]} />
                        <Text style={[s.rolePillText, { color: colors.info }]} maxFontSizeMultiplier={1.3}>OPEN</Text>
                      </View>
                      <TouchableOpacity
                        style={s.invRevoke}
                        onPress={() => confirmRevokeInvite(inv)}
                        accessibilityRole="button"
                        accessibilityLabel={`Revoke invitation for ${inv.email}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {claimedInvites.map(inv => (
                    <View
                      key={inv.id}
                      style={[s.invRow, { backgroundColor: colors.surface, borderBottomColor: colors.borderLight }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>{inv.email}</Text>
                        <Text style={[s.email, { color: colors.textSecondary }]} numberOfLines={1}>
                          {(ROLE_DISPLAY[inv.role] ?? inv.role)}
                          {inv.claimed_at ? ` · claimed ${format(new Date(inv.claimed_at), 'd MMM')}` : ''}
                        </Text>
                      </View>
                      <View style={[s.rolePill, { backgroundColor: colors.successBg }]}>
                        <View style={[s.pillDot, { backgroundColor: colors.success }]} />
                        <Text style={[s.rolePillText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>CLAIMED</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </>
      )}

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
                  {selectedUnverified && (
                    <View style={[s.rolePill, { backgroundColor: colors.warningBg }]}>
                      <Ionicons name="alert-circle" size={12} color={colors.warning} />
                      <Text style={[s.rolePillText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
                        UNVERIFIED
                      </Text>
                    </View>
                  )}
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

                {/* Role verification — clinic/ASHA self-signups awaiting admin confirmation */}
                {canProvision && selectedUnverified && (
                  <View style={{ marginTop: spacing.lg }}>
                    <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>ROLE VERIFICATION</Text>
                    <Text style={[s.verifyCaption, { color: colors.textSecondary }]}>
                      Confirm this person really is a clinic/ASHA worker before verifying — verification unlocks district-wide access.
                    </Text>
                    <Pressable
                      style={({ pressed }) => [
                        s.verifyBtn,
                        { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                      ]}
                      onPress={() => confirmVerifyRole(selectedUser)}
                      accessibilityRole="button"
                      accessibilityLabel={`Verify role of ${selectedUser.full_name || selectedUser.email}`}
                    >
                      <Ionicons name="shield-checkmark-outline" size={18} color={colors.onPrimary} />
                      <Text style={[s.verifyBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                        Verify role
                      </Text>
                    </Pressable>
                  </View>
                )}

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

      {/* ── Invite Official Sheet ── */}
      <Modal
        visible={showInviteSheet}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        onRequestClose={() => setShowInviteSheet(false)}
      >
        <View style={[s.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[s.modalSheet, { backgroundColor: colors.card }]}>
            <View style={[s.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <View style={[s.modalAvatar, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
                <Ionicons name="person-add-outline" size={26} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[s.modalName, { color: colors.text }]}>Invite official</Text>
                <Text style={[s.modalEmail, { color: colors.textSecondary }]}>
                  Pre-assign a role to a trusted email
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowInviteSheet(false)}
                style={[s.closeBtn, { backgroundColor: colors.surfaceVariant }]}
                accessibilityRole="button"
                accessibilityLabel="Close invite sheet"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ paddingHorizontal: spacing.lg }} keyboardShouldPersistTaps="handled">
              <Text style={[s.sectionLabel, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                EMAIL
              </Text>
              <TextInput
                style={inviteInputStyle('email')}
                placeholder="official@example.gov.in"
                placeholderTextColor={colors.placeholder}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                onFocus={() => setInviteFocus('email')}
                onBlur={() => setInviteFocus(null)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />

              <Text style={[s.sectionLabel, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                ROLE
              </Text>
              <View style={s.roleGrid}>
                {inviteRoles.map(r => {
                  const active = inviteRole === r;
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
                      onPress={() => setInviteRole(r)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Invite as ${ROLE_DISPLAY[r] ?? r}`}
                    >
                      {active && <Ionicons name="checkmark" size={14} color={colors.textInverse} />}
                      <Text
                        style={[s.roleBtnText, { color: active ? colors.textInverse : colors.text }]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.3}
                      >
                        {ROLE_DISPLAY[r] ?? r}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[s.sectionLabel, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                DISTRICT
              </Text>
              <TextInput
                style={inviteInputStyle('district')}
                placeholder="e.g. Lucknow"
                placeholderTextColor={colors.placeholder}
                value={inviteDistrict}
                onChangeText={setInviteDistrict}
                onFocus={() => setInviteFocus('district')}
                onBlur={() => setInviteFocus(null)}
              />

              <Text style={[s.sectionLabel, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                STATE
              </Text>
              <TextInput
                style={inviteInputStyle('state')}
                placeholder="e.g. Uttar Pradesh"
                placeholderTextColor={colors.placeholder}
                value={inviteState}
                onChangeText={setInviteState}
                onFocus={() => setInviteFocus('state')}
                onBlur={() => setInviteFocus(null)}
              />

              {/* Honest mechanism caption — no email is sent by the app */}
              <View style={s.invCaptionRow}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={[s.invCaptionText, { color: colors.textSecondary }]}>
                  They sign up with this email and arrive with the role already assigned and verified.
                </Text>
              </View>

              {inviteError ? (
                <View style={s.invCaptionRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                  <Text style={[s.invCaptionText, { color: colors.danger, fontWeight: '600' }]}>
                    {inviteError}
                  </Text>
                </View>
              ) : null}
              <View style={{ height: spacing.lg }} />
            </ScrollView>

            {/* One-Hand Action Bar */}
            <View style={[s.actionBar, { borderTopColor: colors.borderLight, backgroundColor: colors.card }]}>
              <TouchableOpacity
                onPress={() => setShowInviteSheet(false)}
                style={s.invCancelLink}
                accessibilityRole="button"
                accessibilityLabel="Cancel invitation"
                hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
              >
                <Text style={[s.invCancelText, { color: isDark ? colors.primary : colors.primaryDark }]}>Cancel</Text>
              </TouchableOpacity>
              <Pressable
                style={({ pressed }) => [
                  s.actionBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  inviteBusy && { opacity: 0.4 },
                ]}
                onPress={submitInvite}
                disabled={inviteBusy}
                accessibilityRole="button"
                accessibilityLabel="Create invite"
              >
                <Ionicons name="person-add-outline" size={18} color={colors.onPrimary} />
                <Text style={[s.actionBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {inviteBusy ? 'Creating…' : 'Create invite'}
                </Text>
              </Pressable>
            </View>
          </View>
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
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
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
  /* Invite official button — 48dp secondary action in the gutter */
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5,
  },
  inviteBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  /* Invitations section */
  invHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  invBody: { borderBottomWidth: StyleSheet.hairlineWidth },
  invEmpty: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
  },
  invEmptyText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  invRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  invRevoke: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  /* Role verification (detail modal) */
  verifyCaption: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.md },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: 48, borderRadius: radii.md,
  },
  verifyBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  /* Invite sheet */
  invInput: {
    minHeight: 52, borderRadius: radii.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 15,
  },
  invCaptionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginTop: spacing.lg,
  },
  invCaptionText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  invCancelLink: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  invCancelText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
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
