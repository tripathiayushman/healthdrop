// =====================================================
// APPROVAL QUEUE SCREEN
// Handles pending disease reports, water reports,
// campaign approvals — role-colored per admin type
// =====================================================
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, Alert, ActivityIndicator, RefreshControl,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import { ROLE_GRADIENTS, ROLE_ACCENT } from '../dashboards/DashboardShared';

interface Props { profile: Profile; onBack: () => void; initialTab?: QueueTab }

type QueueTab = 'disease' | 'water' | 'campaigns' | 'alerts';

interface DiseaseReport {
  id: string; disease_name: string; disease_type: string; severity: string;
  cases_count: number; location_name: string; district: string; state: string;
  symptoms: string; age_group: string; gender: string; treatment_status: string;
  reporter_id: string; status: string; approval_status?: string; created_at: string;
}
interface WaterReport {
  id: string; source_name: string; source_type: string; location_name: string;
  district: string; state: string; overall_quality: string; contamination_type: string;
  reporter_id: string; status: string; approval_status?: string; notes: string; created_at: string;
}
interface Campaign {
  id: string; name: string; campaign_type: string; district: string; state: string;
  start_date: string; end_date: string; status: string; target_population: number;
  volunteers_needed: number; approval_status?: string; created_at: string;
}
interface HealthAlert {
  id: string; title: string; description: string; alert_type: string;
  urgency_level: string; location_name: string; district: string; state: string;
  status: string; created_by: string; approval_status?: string;
  affected_population?: number; cases_reported?: number; disease_or_issue?: string;
  immediate_actions?: string; precautionary_measures?: string; created_at: string;
}

const URGENCY_COLOR: Record<string,string> = {
  critical: '#DC2626', high: '#F59E0B', medium: '#3B82F6', low: '#10B981',
};
const SEVERITY_COLOR: Record<string,string> = {
  critical: '#EF4444', severe: '#F97316', moderate: '#F59E0B', mild: '#10B981',
};
const QUALITY_COLOR: Record<string,string> = {
  safe: '#10B981', moderate: '#F59E0B', unsafe: '#F97316', critical: '#EF4444',
};
const STATUS_COLOR: Record<string,string> = {
  approved: '#10B981', pending_approval: '#F59E0B', rejected: '#EF4444',
};

// ─────────────────────────────────────────────────────────────────────────────

export const ApprovalQueueScreen: React.FC<Props> = ({ profile, onBack, initialTab }) => {
  const { colors, isDark } = useTheme();
  const accent   = ROLE_ACCENT[profile.role] ?? '#42A5F5';
  const gradient = ROLE_GRADIENTS[profile.role] ?? ['#0F172A','#1E3A5F','#1976D2'];

  const isClinic = profile.role === 'clinic';
  const isDistrictOfficer = profile.role === 'district_officer';
  const isAdmin = profile.role === 'super_admin' || profile.role === 'health_admin';
  const canVerify = isAdmin || isClinic; // can verify disease/water reports

  const [tab, setTab] = useState<QueueTab>(initialTab ?? 'disease');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]       = useState('');

  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports]     = useState<WaterReport[]>([]);
  const [campaigns, setCampaigns]           = useState<Campaign[]>([]);
  const [alerts, setAlerts]                 = useState<HealthAlert[]>([]);
  const [pendingCounts, setPendingCounts]   = useState({ disease: 0, water: 0, campaigns: 0, alerts: 0 });

  const [selectedItem, setSelectedItem]   = useState<any>(null);
  const [selectedType, setSelectedType]   = useState<QueueTab>('disease');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [rejectReason, setRejectReason]   = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Tabs based on role ───────────────────────────────────────────────────
  const allTabs: { id: QueueTab; label: string; icon: string }[] = [
    { id: 'disease',   label: 'Disease',   icon: 'medkit' },
    { id: 'water',     label: 'Water',     icon: 'water' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone' },
    { id: 'alerts',    label: 'Alerts',    icon: 'alert-circle' },
  ];
  // Clinic sees all 4; district_officer sees disease/water/campaigns; others same
  const visibleTabs = isClinic
    ? allTabs
    : isDistrictOfficer
    ? allTabs.filter(t => ['disease','water','campaigns'].includes(t.id))
    : allTabs;

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      await Promise.all([loadDiseaseReports(), loadWaterReports(), loadCampaigns(), loadAlerts()]);
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const loadDiseaseReports = async () => {
    const q = supabase.from('disease_reports').select('*').order('created_at', { ascending: false });
    if (isDistrictOfficer && profile.district) q.eq('district', profile.district);
    const { data } = await q;
    const rows = data ?? [];
    setDiseaseReports(rows);
    setPendingCounts(p => ({ ...p, disease: rows.filter(r => r.approval_status === 'pending_approval').length }));
  };
  const loadWaterReports = async () => {
    const q = supabase.from('water_quality_reports').select('*').order('created_at', { ascending: false });
    if (isDistrictOfficer && profile.district) q.eq('district', profile.district);
    const { data } = await q;
    const rows = data ?? [];
    setWaterReports(rows);
    setPendingCounts(p => ({ ...p, water: rows.filter(r => r.approval_status === 'pending_approval').length }));
  };
  const loadCampaigns = async () => {
    const q = supabase.from('health_campaigns').select('*').order('created_at', { ascending: false });
    if (isDistrictOfficer && profile.district) q.eq('district', profile.district);
    const { data } = await q;
    const rows = data ?? [];
    setCampaigns(rows);
    setPendingCounts(p => ({ ...p, campaigns: rows.filter(r => r.approval_status === 'pending_approval').length }));
  };
  const loadAlerts = async () => {
    if (isClinic) return; // clinics dont approve alerts
    const { data } = await supabase.from('health_alerts').select('*').order('created_at', { ascending: false });
    const rows = data ?? [];
    setAlerts(rows);
    setPendingCounts(p => ({ ...p, alerts: rows.filter(r => r.approval_status === 'pending_approval').length }));
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteItem = async (id: string, type: QueueTab) => {
    Alert.alert(
      'Confirm Delete',
      'Permanently delete this item? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const table = { disease:'disease_reports', water:'water_quality_reports', campaigns:'health_campaigns', alerts:'health_alerts' }[type];
              const { error } = await supabase.from(table as string).delete().eq('id', id);
              if (error) throw error;
              setShowDetailModal(false);
              load();
            } catch (e: any) { Alert.alert('Error', e.message); }
            finally { setActionLoading(false); }
          },
        },
      ]
    );
  };

  // ── Verify / Unverify ────────────────────────────────────────────────────
  const verifyItem = async (id: string, type: QueueTab, newStatus: 'verified' | 'reported') => {
    setActionLoading(true);
    try {
      const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';
      const { error } = await supabase.from(table).update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setSelectedItem((prev: any) => prev ? { ...prev, status: newStatus } : prev);
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setActionLoading(false); }
  };

  // ── Approve / Reject ─────────────────────────────────────────────────────
  const approve = async (id: string, type: QueueTab) => {
    setActionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const table = { disease:'disease_reports', water:'water_quality_reports', campaigns:'health_campaigns', alerts:'health_alerts' }[type];
      const { error } = await supabase.from(table as string)
        .update({ approval_status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      Alert.alert('Approved', 'Item approved successfully.');
      setShowDetailModal(false);
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setActionLoading(false); }
  };

  const reject = async (id: string, type: QueueTab, reason: string) => {
    setActionLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const table = { disease:'disease_reports', water:'water_quality_reports', campaigns:'health_campaigns', alerts:'health_alerts' }[type];
      const { error } = await supabase.from(table as string)
        .update({ approval_status: 'rejected', approved_by: user?.id, approved_at: new Date().toISOString(), rejection_reason: reason || 'Rejected by admin' })
        .eq('id', id);
      if (error) throw error;
      Alert.alert('Rejected', 'Item has been rejected.');
      setShowDetailModal(false);
      setShowRejectInput(false);
      setRejectReason('');
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setActionLoading(false); }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const statusChip = (s?: string) => (
    <View style={[qst.chip, { backgroundColor: (STATUS_COLOR[s??''] ?? colors.textSecondary) + '22' }]}>
      <Text style={[qst.chipText, { color: STATUS_COLOR[s??''] ?? colors.textSecondary }]}>
        {s === 'pending_approval' ? 'Pending' : s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'Unknown'}
      </Text>
    </View>
  );

  // ── Filtered lists ────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const fDisease   = diseaseReports.filter(r => !q || r.disease_name?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));
  const fWater     = waterReports.filter(r => !q || r.source_name?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));
  const fCampaigns = campaigns.filter(r => !q || r.name?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));
  const fAlerts    = alerts.filter(r => !q || r.title?.toLowerCase().includes(q) || r.district?.toLowerCase().includes(q));

  // ── Card renderer ─────────────────────────────────────────────────────────
  const renderCard = (item: any, type: QueueTab) => {
    const isPending = item.approval_status === 'pending_approval';
    let iconColor = accent;
    let iconName: string = 'document-text';
    let titleText = '';
    let subtitleText = '';

    switch (type) {
      case 'disease':
        iconColor = SEVERITY_COLOR[item.severity] ?? '#EF4444';
        iconName = 'medkit';
        titleText = item.disease_name ?? 'Unknown Disease';
        subtitleText = `Cases: ${item.cases_count ?? 0} · ${item.district}, ${item.state}`;
        break;
      case 'water':
        iconColor = QUALITY_COLOR[item.overall_quality] ?? '#3B82F6';
        iconName = 'water';
        titleText = item.source_name ?? 'Unknown Source';
        subtitleText = `${item.source_type} · ${item.district}, ${item.state}`;
        break;
      case 'campaigns':
        iconColor = '#8B5CF6';
        iconName = 'megaphone';
        titleText = item.name ?? 'Unnamed Campaign';
        subtitleText = `${item.campaign_type} · ${item.district}, ${item.state}`;
        break;
      case 'alerts':
        iconColor = URGENCY_COLOR[item.urgency_level] ?? '#F59E0B';
        iconName = 'alert-circle';
        titleText = item.title ?? 'Untitled Alert';
        subtitleText = `${item.alert_type ?? ''} · ${item.district}, ${item.state}`;
        break;
    }

    return (
      <TouchableOpacity
        key={item.id}
        style={[qst.card, { backgroundColor: colors.card, borderColor: isPending ? accent : colors.border, borderLeftWidth: isPending ? 4 : 1, borderLeftColor: isPending ? accent : colors.border }]}
        onPress={() => { setSelectedItem(item); setSelectedType(type); setShowDetailModal(true); }}
        activeOpacity={0.78}
      >
        <View style={qst.cardRow}>
          <View style={[qst.iconWrap, { backgroundColor: iconColor + '22' }]}>
            <Ionicons name={iconName as any} size={20} color={iconColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[qst.cardTitle, { color: colors.text }]} numberOfLines={1}>{titleText}</Text>
            <Text style={[qst.cardSub, { color: colors.textSecondary }]} numberOfLines={1}>{subtitleText}</Text>
            <Text style={[qst.cardDate, { color: colors.textSecondary }]}>
              {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : ''}
            </Text>
          </View>
          {statusChip(item.approval_status)}
        </View>
      </TouchableOpacity>
    );
  };

  const currentData   = tab === 'disease' ? fDisease : tab === 'water' ? fWater : tab === 'campaigns' ? fCampaigns : fAlerts;
  const pendingOfTab  = tab === 'disease' ? pendingCounts.disease : tab === 'water' ? pendingCounts.water : tab === 'campaigns' ? pendingCounts.campaigns : pendingCounts.alerts;
  const totalPending  = pendingCounts.disease + pendingCounts.water + pendingCounts.campaigns + pendingCounts.alerts;

  // ── Detail modal fields ───────────────────────────────────────────────────
  const DetailRow = ({ label, value }: { label: string; value?: string|number }) => (
    value !== undefined && value !== null && value !== '' && value !== 0
      ? <View style={[qst.detailRow, { borderBottomColor: colors.border }]}>
          <Text style={[qst.detailLabel, { color: colors.textSecondary }]}>{label}</Text>
          <Text style={[qst.detailValue, { color: colors.text }]}>{String(value)}</Text>
        </View>
      : null
  );

  return (
    <View style={[qst.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient colors={gradient as any} style={qst.header}>
        <TouchableOpacity onPress={onBack} style={qst.back}>
          <Ionicons name="arrow-back" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={qst.headerTitle}>Approval Queue</Text>
          <Text style={qst.headerSub}>{totalPending} pending reviews</Text>
        </View>
        {totalPending > 0 && (
          <View style={[qst.totalBadge, { backgroundColor: accent }]}>
            <Text style={qst.totalBadgeText}>{totalPending}</Text>
          </View>
        )}
      </LinearGradient>

      {/* Tab bar */}
      <View style={[qst.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {visibleTabs.map(t => {
          const active = tab === t.id;
          const count  = { disease: pendingCounts.disease, water: pendingCounts.water, campaigns: pendingCounts.campaigns, alerts: pendingCounts.alerts }[t.id];
          return (
            <TouchableOpacity key={t.id} style={qst.tabItem} onPress={() => setTab(t.id)}>
              <Ionicons name={t.icon as any} size={18} color={active ? accent : colors.textSecondary} />
              <Text style={[qst.tabLabel, { color: active ? accent : colors.textSecondary, fontWeight: active ? '700' : '400' }]}>
                {t.label}
              </Text>
              {count > 0 && (
                <View style={[qst.tabBadge, { backgroundColor: accent }]}>
                  <Text style={qst.tabBadgeText}>{count}</Text>
                </View>
              )}
              {active && <View style={[qst.tabUnderline, { backgroundColor: accent }]} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search */}
      <View style={[qst.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[qst.searchInput, { color: colors.text }]}
          placeholder="Search..."
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

      {/* Summary row */}
      <View style={[qst.summaryRow, { backgroundColor: colors.surface }]}>
        <Text style={[qst.summaryText, { color: colors.textSecondary }]}>
          {currentData.length} items · {pendingOfTab} pending
        </Text>
      </View>

      {/* List */}
      {loading
        ? <ActivityIndicator size="large" color={accent} style={{ marginTop: 40 }} />
        : (
          <FlatList
            data={currentData as any[]}
            keyExtractor={item => item.id}
            renderItem={({ item }) => renderCard(item, tab)}
            contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={accent} />}
            ListEmptyComponent={
              <View style={qst.empty}>
                <Ionicons name="checkmark-circle-outline" size={48} color="#10B981" />
                <Text style={[qst.emptyText, { color: colors.textSecondary }]}>No items found</Text>
              </View>
            }
          />
        )
      }

      {/* ── Detail / Approve Modal ──────────────────────────────────────── */}
      <Modal visible={showDetailModal} animationType="slide" transparent>
        <View style={qst.overlay}>
          {selectedItem && (
            <View style={[qst.sheet, { backgroundColor: colors.card }]}>
              {/* Modal header */}
              <LinearGradient colors={gradient as any} style={qst.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={qst.modalTitle} numberOfLines={2}>
                    {selectedItem.disease_name ?? selectedItem.source_name ?? selectedItem.name ?? selectedItem.title ?? 'Detail'}
                  </Text>
                  <Text style={qst.modalSub}>{selectedItem.district}, {selectedItem.state}</Text>
                </View>
                <TouchableOpacity onPress={() => { setShowDetailModal(false); setShowRejectInput(false); setRejectReason(''); }}>
                  <Ionicons name="close" size={22} color="rgba(255,255,255,0.8)" />
                </TouchableOpacity>
              </LinearGradient>

              <ScrollView style={{ padding: 16 }}>
                {/* Approval / Rejection status chip */}
                <View style={qst.statusRow}>{statusChip(selectedItem.approval_status)}</View>

                {/* Verification status chip (disease + water only) */}
                {(selectedType === 'disease' || selectedType === 'water') && selectedItem.status && (
                  <View style={[qst.statusRow, { marginTop: -4 }]}>
                    <View style={[qst.chip, { backgroundColor: selectedItem.status === 'verified' ? '#10B98122' : '#3B82F622' }]}>
                      <Text style={[qst.chipText, { color: selectedItem.status === 'verified' ? '#10B981' : '#3B82F6' }]}>
                        {selectedItem.status === 'verified' ? '✓ Verified' : '○ Reported'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Fields based on type */}
                {selectedType === 'disease' && <>
                  <DetailRow label="Disease" value={selectedItem.disease_name} />
                  <DetailRow label="Type" value={selectedItem.disease_type} />
                  <DetailRow label="Severity" value={selectedItem.severity} />
                  <DetailRow label="Cases" value={selectedItem.cases_count} />
                  <DetailRow label="Age Group" value={selectedItem.age_group} />
                  <DetailRow label="Gender" value={selectedItem.gender} />
                  <DetailRow label="Symptoms" value={selectedItem.symptoms} />
                  <DetailRow label="Treatment" value={selectedItem.treatment_status} />
                  <DetailRow label="Location" value={`${selectedItem.location_name}, ${selectedItem.district}, ${selectedItem.state}`} />
                </>}
                {selectedType === 'water' && <>
                  <DetailRow label="Source" value={selectedItem.source_name} />
                  <DetailRow label="Type" value={selectedItem.source_type} />
                  <DetailRow label="Quality" value={selectedItem.overall_quality} />
                  <DetailRow label="Contamination" value={selectedItem.contamination_type} />
                  <DetailRow label="Location" value={`${selectedItem.location_name}, ${selectedItem.district}, ${selectedItem.state}`} />
                  <DetailRow label="Notes" value={selectedItem.notes} />
                </>}
                {selectedType === 'campaigns' && <>
                  <DetailRow label="Name" value={selectedItem.name} />
                  <DetailRow label="Type" value={selectedItem.campaign_type} />
                  <DetailRow label="Status" value={selectedItem.status} />
                  <DetailRow label="Start" value={selectedItem.start_date ? format(new Date(selectedItem.start_date), 'MMM d, yyyy') : ''} />
                  <DetailRow label="End" value={selectedItem.end_date ? format(new Date(selectedItem.end_date), 'MMM d, yyyy') : ''} />
                  <DetailRow label="Target Pop." value={selectedItem.target_population} />
                  <DetailRow label="Volunteers" value={selectedItem.volunteers_needed} />
                  <DetailRow label="Location" value={`${selectedItem.district}, ${selectedItem.state}`} />
                </>}
                {selectedType === 'alerts' && <>
                  <DetailRow label="Title" value={selectedItem.title} />
                  <DetailRow label="Type" value={selectedItem.alert_type} />
                  <DetailRow label="Urgency" value={selectedItem.urgency_level} />
                  <DetailRow label="Disease / Issue" value={selectedItem.disease_or_issue} />
                  <DetailRow label="Description" value={selectedItem.description} />
                  <DetailRow label="Cases Reported" value={selectedItem.cases_reported} />
                  <DetailRow label="Affected Population" value={selectedItem.affected_population} />
                  <DetailRow label="Immediate Actions" value={selectedItem.immediate_actions} />
                  <DetailRow label="Precautions" value={selectedItem.precautionary_measures} />
                  <DetailRow label="Location" value={`${selectedItem.location_name ?? ''}, ${selectedItem.district}, ${selectedItem.state}`} />
                </>}

                {/* Reject reason input */}
                {showRejectInput && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={[qst.rejectLabel, { color: colors.text }]}>Reason for rejection</Text>
                    <TextInput
                      style={[qst.rejectInput, { backgroundColor: colors.surface, borderColor: '#EF4444', color: colors.text }]}
                      placeholder="Optional rejection reason..."
                      placeholderTextColor={colors.textSecondary}
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      multiline
                      numberOfLines={3}
                    />
                  </View>
                )}

                {/* Verify / Unverify buttons — disease + water only, for admins and clinics */}
                {canVerify && (selectedType === 'disease' || selectedType === 'water') && (
                  <View style={[qst.actionRow, { marginTop: 12 }]}>
                    <TouchableOpacity
                      style={[qst.actionBtn, {
                        backgroundColor: selectedItem.status === 'verified' ? '#1E40AF' : '#10B981',
                        flex: 1,
                      }]}
                      onPress={() => verifyItem(
                        selectedItem.id,
                        selectedType,
                        selectedItem.status === 'verified' ? 'reported' : 'verified'
                      )}
                      disabled={actionLoading}
                    >
                      <Ionicons
                        name={selectedItem.status === 'verified' ? 'close-circle-outline' : 'checkmark-done-circle'}
                        size={18} color="#FFF"
                      />
                      <Text style={qst.actionBtnText}>
                        {selectedItem.status === 'verified' ? 'Unverify' : 'Mark Verified'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Approve/Reject buttons — always available for admins AND clinics */}
                {(selectedItem.approval_status === 'pending_approval' || canVerify) && (
                  <View style={qst.actionRow}>
                    {!showRejectInput
                      ? <>
                          <TouchableOpacity
                            style={[qst.actionBtn, { backgroundColor: '#EF4444' }]}
                            onPress={() => setShowRejectInput(true)}
                          >
                            <Ionicons name="close-circle" size={18} color="#FFF" />
                            <Text style={qst.actionBtnText}>Reject</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[qst.actionBtn, { backgroundColor: '#10B981' }]}
                            onPress={() => approve(selectedItem.id, selectedType)}
                            disabled={actionLoading}
                          >
                            {actionLoading
                              ? <ActivityIndicator size={18} color="#FFF" />
                              : <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                            }
                            <Text style={qst.actionBtnText}>Approve</Text>
                          </TouchableOpacity>
                        </>
                      : <>
                          <TouchableOpacity
                            style={[qst.actionBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                            onPress={() => { setShowRejectInput(false); setRejectReason(''); }}
                          >
                            <Text style={[qst.actionBtnText, { color: colors.text }]}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[qst.actionBtn, { backgroundColor: '#EF4444' }]}
                            onPress={() => reject(selectedItem.id, selectedType, rejectReason)}
                            disabled={actionLoading}
                          >
                            {actionLoading
                              ? <ActivityIndicator size={18} color="#FFF" />
                              : <Ionicons name="trash" size={18} color="#FFF" />
                            }
                            <Text style={qst.actionBtnText}>Confirm Reject</Text>
                          </TouchableOpacity>
                        </>
                    }
                  </View>
                )}

                {/* Delete — super_admin and health_admin only (NOT clinic) */}
                {isAdmin && (
                  <View style={{ marginTop: 12 }}>
                    <TouchableOpacity
                      style={[qst.deleteBtn]}
                      onPress={() => deleteItem(selectedItem.id, selectedType)}
                      disabled={actionLoading}
                    >
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                      <Text style={qst.deleteBtnText}>Delete Report Permanently</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const qst = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20, paddingTop: 36 },
  back: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  totalBadge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  totalBadgeText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  // Tabs
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 2, position: 'relative' },
  tabLabel: { fontSize: 11 },
  tabBadge: { position: 'absolute', top: 6, right: 4, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: 0, left: 8, right: 8, height: 2, borderRadius: 1 },
  // Search
  searchRow: { flexDirection: 'row', alignItems: 'center', margin: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  // Summary
  summaryRow: { paddingHorizontal: 16, paddingVertical: 6 },
  summaryText: { fontSize: 12 },
  // Card
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardSub: { fontSize: 12, marginTop: 2 },
  cardDate: { fontSize: 11, marginTop: 2 },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 11, fontWeight: '600' },
  empty: { paddingTop: 60, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15 },
  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  modalSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  statusRow: { flexDirection: 'row', marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1 },
  detailLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
  detailValue: { fontSize: 13, flex: 2, textAlign: 'right' },
  rejectLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  rejectInput: { borderWidth: 1.5, borderRadius: 10, padding: 10, fontSize: 13, minHeight: 80 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  actionBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#EF4444', backgroundColor: '#EF444410' },
  deleteBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
});

export default ApprovalQueueScreen;
