// =====================================================
// REPORTS SCREEN - Advanced Filtering, Search & Pagination
// =====================================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ReportsScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
}

interface DiseaseReport {
  id: string;
  disease_name: string;
  disease_type: string;
  severity: string;
  cases_count: number;
  deaths_count: number;
  symptoms: string | null;
  age_group: string;
  gender: string;
  location_name: string;
  district: string;
  state: string;
  treatment_status: string;
  status: string;
  notes: string;
  created_at: string;
  approval_status?: string;
  rejection_reason?: string;
  reporter_id?: string;
}

interface WaterReport {
  id: string;
  source_name: string;
  source_type: string;
  location_name: string;
  district: string;
  state: string;
  overall_quality: string;
  ph_level: number | null;
  tds_level: number | null;
  contamination_type: string;
  status: string;
  notes: string;
  created_at: string;
  approval_status?: string;
  rejection_reason?: string;
  reporter_id?: string;
}

interface Filters {
  searchQuery: string;
  severity: string;
  status: string;
  approvalStatus: string;
  district: string;
  dateFrom: string;
  dateTo: string;
  quality: string; // for water reports
}

const PAGE_SIZE = 15;

// ── Component ─────────────────────────────────────────────────────────────────

const ReportsScreen: React.FC<ReportsScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors } = useTheme();

  // Role access — mirrors DB-level RLS
  const canAccessDiseaseReports = ['super_admin', 'health_admin', 'clinic', 'district_officer'].includes(profile.role);
  const canAccessWaterReports   = ['super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer'].includes(profile.role);
  const canCreateReports        = ['super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer'].includes(profile.role);
  const canApproveReports       = ['super_admin', 'health_admin', 'clinic', 'district_officer'].includes(profile.role);
  const isVolunteer             = profile.role === 'volunteer';
  // Admin/clinic see approval_status; volunteers never do; others see only their own
  const canSeeApprovalStatus    = ['super_admin', 'health_admin', 'clinic', 'district_officer'].includes(profile.role);


  // State
  const [activeTab, setActiveTab] = useState<'disease' | 'water'>(canAccessDiseaseReports ? 'disease' : 'water');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports] = useState<WaterReport[]>([]);
  const [diseaseTotalCount, setDiseaseTotalCount] = useState(0);
  const [waterTotalCount, setWaterTotalCount] = useState(0);
  const [page, setPage] = useState(1);

  const [selectedDiseaseReport, setSelectedDiseaseReport] = useState<DiseaseReport | null>(null);
  const [selectedWaterReport, setSelectedWaterReport] = useState<WaterReport | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const emptyFilters: Filters = {
    searchQuery: '', severity: '', status: '', approvalStatus: '', district: '', dateFrom: '', dateTo: '', quality: '',
  };
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [searchText, setSearchText] = useState('');
  const [fetchingLocation, setFetchingLocation] = useState(false);

  // Count active filters (excluding search)
  const activeFilterCount = [
    appliedFilters.severity, appliedFilters.status, appliedFilters.approvalStatus,
    appliedFilters.district, appliedFilters.dateFrom, appliedFilters.dateTo, appliedFilters.quality,
  ].filter(Boolean).length;

  // ── Data Loading ──────────────────────────────────────────────────────────

  const loadReports = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const offset = (pageNum - 1) * PAGE_SIZE;

      if (activeTab === 'disease') {
        let query = supabase
          .from('disease_reports')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (appliedFilters.status) query = query.eq('status', appliedFilters.status);
        if (appliedFilters.approvalStatus) query = query.eq('approval_status', appliedFilters.approvalStatus);
        if (appliedFilters.district) query = query.ilike('district', `%${appliedFilters.district}%`);
        if (appliedFilters.severity) query = query.eq('severity', appliedFilters.severity);
        if (appliedFilters.searchQuery) {
          query = query.or(`disease_name.ilike.%${appliedFilters.searchQuery}%,location_name.ilike.%${appliedFilters.searchQuery}%`);
        }
        if (appliedFilters.dateFrom) query = query.gte('created_at', appliedFilters.dateFrom);
        if (appliedFilters.dateTo) query = query.lte('created_at', appliedFilters.dateTo + 'T23:59:59');

        const { data, error, count } = await query;
        if (!error && data) {
          setDiseaseReports(append ? prev => [...prev, ...data] : data);
          setDiseaseTotalCount(count || 0);
        }
      } else {
        let query = supabase
          .from('water_quality_reports')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (appliedFilters.status) query = query.eq('status', appliedFilters.status);
        if (appliedFilters.approvalStatus) query = query.eq('approval_status', appliedFilters.approvalStatus);
        if (appliedFilters.district) query = query.ilike('district', `%${appliedFilters.district}%`);
        if (appliedFilters.quality) query = query.eq('overall_quality', appliedFilters.quality);
        if (appliedFilters.searchQuery) {
          query = query.or(`source_name.ilike.%${appliedFilters.searchQuery}%,location_name.ilike.%${appliedFilters.searchQuery}%`);
        }
        if (appliedFilters.dateFrom) query = query.gte('created_at', appliedFilters.dateFrom);
        if (appliedFilters.dateTo) query = query.lte('created_at', appliedFilters.dateTo + 'T23:59:59');

        const { data, error, count } = await query;
        if (!error && data) {
          setWaterReports(append ? prev => [...prev, ...data] : data);
          setWaterTotalCount(count || 0);
        }
      }
    } catch (error) {
      console.log('Reports loading error:', error);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [activeTab, appliedFilters]);

  // Reload on tab change or filter apply
  useEffect(() => {
    setPage(1);
    loadReports(1, false);
  }, [activeTab, appliedFilters]);

  const onRefresh = async () => {
    setRefreshing(true);
    setPage(1);
    await loadReports(1, false);
    setRefreshing(false);
  };

  const loadMore = () => {
    const total = activeTab === 'disease' ? diseaseTotalCount : waterTotalCount;
    const current = activeTab === 'disease' ? diseaseReports.length : waterReports.length;
    if (current < total && !loadingMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadReports(nextPage, true);
    }
  };

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = () => {
    setAppliedFilters(prev => ({ ...prev, searchQuery: searchText.trim() }));
  };

  const clearSearch = () => {
    setSearchText('');
    setAppliedFilters(prev => ({ ...prev, searchQuery: '' }));
  };

  // ── Filter Actions ────────────────────────────────────────────────────────

  const applyFilters = () => {
    setAppliedFilters(prev => ({ ...prev, ...filters, searchQuery: prev.searchQuery }));
    setShowFilterPanel(false);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(prev => ({ ...prev, severity: '', status: '', district: '', dateFrom: '', dateTo: '', quality: '' }));
    setShowFilterPanel(false);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getSeverityColor = (severity: string) => {
    const m: Record<string, string> = {
      critical: '#DC2626', high: '#EA580C', severe: '#EA580C',
      medium: '#F59E0B', moderate: '#F59E0B', low: '#10B981', mild: '#10B981',
    };
    return m[severity?.toLowerCase()] || colors.textSecondary;
  };

  const getQualityColor = (quality: string) => {
    const m: Record<string, string> = {
      safe: '#10B981', moderate: '#F59E0B', poor: '#EA580C', contaminated: '#DC2626',
    };
    return m[quality?.toLowerCase()] || colors.textSecondary;
  };

  const getStatusColor = (status: string) => {
    const m: Record<string, string> = {
      reported: '#3B82F6', verified: '#10B981', investigating: '#F59E0B',
      resolved: '#6B7280', rejected: '#EF4444', pending: '#F59E0B',
    };
    return m[status?.toLowerCase()] || colors.textSecondary;
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // ── Filter Chip Helper ────────────────────────────────────────────────────

  const FilterChip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity
      style={[s.filterChip, {
        backgroundColor: active ? colors.primary + '20' : colors.card,
        borderColor: active ? colors.primary : colors.border,
      }]}
      onPress={onPress}
    >
      <Text style={[s.filterChipText, { color: active ? colors.primary : colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  // ── Render Report Cards ───────────────────────────────────────────────────

  const renderDiseaseReports = () => {
    if (diseaseReports.length === 0) {
      return (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="virus-outline" size={48} color={colors.textSecondary} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Disease Reports Found</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>
            {activeFilterCount > 0 || appliedFilters.searchQuery ? 'Try adjusting your filters or search' : 'No disease reports yet'}
          </Text>
        </View>
      );
    }

    return diseaseReports.map((r) => (
      <TouchableOpacity
        key={r.id}
        style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
        onPress={() => { setSelectedDiseaseReport(r); setSelectedWaterReport(null); setShowDetailModal(true); }}
      >
        <View style={s.cardHeader}>
          <View style={s.cardTitleRow}>
            <MaterialCommunityIcons name="virus" size={22} color={colors.primary} />
            <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1}>{r.disease_name}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: getSeverityColor(r.severity) + '20' }]}>
            <Text style={[s.badgeText, { color: getSeverityColor(r.severity) }]}>{r.severity?.toUpperCase()}</Text>
          </View>
        </View>

        <View style={s.cardBody}>
          <View style={s.row}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <Text style={[s.rowText, { color: colors.text }]} numberOfLines={1}>
              {r.location_name}, {r.district}
            </Text>
          </View>
          <View style={s.row}>
            <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
            <Text style={[s.rowText, { color: colors.text }]}>
              {r.cases_count || 1} case(s){r.deaths_count ? `, ${r.deaths_count} death(s)` : ''}
            </Text>
          </View>
          {/* Card footer: status pills stacked vertically, date on right */}
          <View style={s.cardFooter}>
            <View style={s.footerLeft}>
              {/* Status pill */}
              <View style={[s.statusPill, { backgroundColor: getStatusColor(r.status) + '15' }]}>
                <View style={[s.statusDot, { backgroundColor: getStatusColor(r.status) }]} />
                <Text style={[s.statusText, { color: getStatusColor(r.status) }]}>
                  {isVolunteer
                    ? (r.status === 'verified' ? 'Verified' : 'Reported')
                    : r.status
                  }
                </Text>
              </View>
              {/* Approval badge — below status, for admins/clinic and the reporter */}
              {!isVolunteer && r.approval_status && (canSeeApprovalStatus || r.reporter_id === profile.id) && (
                <View style={[s.statusPill, {
                  marginTop: 4,
                  backgroundColor:
                    r.approval_status === 'approved' ? '#10B98115' :
                    r.approval_status === 'rejected' ? '#EF444415' : '#F59E0B15'
                }]}>
                  <View style={[s.statusDot, {
                    backgroundColor:
                      r.approval_status === 'approved' ? '#10B981' :
                      r.approval_status === 'rejected' ? '#EF4444' : '#F59E0B'
                  }]} />
                  <Text style={[s.statusText, {
                    color:
                      r.approval_status === 'approved' ? '#10B981' :
                      r.approval_status === 'rejected' ? '#EF4444' : '#F59E0B'
                  }]}>
                    {r.approval_status === 'pending_approval' ? 'Pending' : r.approval_status}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[s.dateText, { color: colors.textSecondary }]}>{formatDate(r.created_at)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    ));
  };

  const renderWaterReports = () => {
    if (waterReports.length === 0) {
      return (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="water-outline" size={48} color={colors.textSecondary} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Water Reports Found</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>
            {activeFilterCount > 0 || appliedFilters.searchQuery ? 'Try adjusting your filters or search' : 'No water reports yet'}
          </Text>
        </View>
      );
    }

    return waterReports.map((r) => (
      <TouchableOpacity
        key={r.id}
        style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
        onPress={() => { setSelectedWaterReport(r); setSelectedDiseaseReport(null); setShowDetailModal(true); }}
      >
        <View style={s.cardHeader}>
          <View style={s.cardTitleRow}>
            <Ionicons name="water" size={22} color={colors.secondary} />
            <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1}>{r.source_name || r.source_type}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: getQualityColor(r.overall_quality) + '20' }]}>
            <Text style={[s.badgeText, { color: getQualityColor(r.overall_quality) }]}>
              {(r.overall_quality || 'N/A').toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={s.cardBody}>
          <View style={s.row}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <Text style={[s.rowText, { color: colors.text }]} numberOfLines={1}>{r.location_name}, {r.district}</Text>
          </View>
          <View style={s.row}>
            <Ionicons name="analytics-outline" size={14} color={colors.textSecondary} />
            <Text style={[s.rowText, { color: colors.text }]}>
              pH: {r.ph_level?.toFixed(1) || 'N/A'} · TDS: {r.tds_level || 'N/A'} ppm
            </Text>
          </View>
          {/* Card footer: status pills stacked vertically, approval below, date right */}
          <View style={s.cardFooter}>
            <View style={s.footerLeft}>
              <View style={[s.statusPill, { backgroundColor: getStatusColor(r.status) + '15' }]}>
                <View style={[s.statusDot, { backgroundColor: getStatusColor(r.status) }]} />
                <Text style={[s.statusText, { color: getStatusColor(r.status) }]}>
                  {isVolunteer
                    ? (r.status === 'verified' ? 'Verified' : 'Reported')
                    : r.status
                  }
                </Text>
              </View>
              {!isVolunteer && r.approval_status && (canSeeApprovalStatus || r.reporter_id === profile.id) && (
                <View style={[s.statusPill, {
                  marginTop: 4,
                  backgroundColor:
                    r.approval_status === 'approved' ? '#10B98115' :
                    r.approval_status === 'rejected' ? '#EF444415' : '#F59E0B15'
                }]}>
                  <View style={[s.statusDot, {
                    backgroundColor:
                      r.approval_status === 'approved' ? '#10B981' :
                      r.approval_status === 'rejected' ? '#EF4444' : '#F59E0B'
                  }]} />
                  <Text style={[s.statusText, {
                    color:
                      r.approval_status === 'approved' ? '#10B981' :
                      r.approval_status === 'rejected' ? '#EF4444' : '#F59E0B'
                  }]}>
                    {r.approval_status === 'pending_approval' ? 'Pending' : r.approval_status}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[s.dateText, { color: colors.textSecondary }]}>{formatDate(r.created_at)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    ));
  };

  // ── Result Count Bar ──────────────────────────────────────────────────────

  const total = activeTab === 'disease' ? diseaseTotalCount : waterTotalCount;
  const shown = activeTab === 'disease' ? diseaseReports.length : waterReports.length;
  const hasMore = shown < total;

  // ── Main Render ───────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.primary }]}>
        <Text style={s.headerTitle}>Reports</Text>
        <Text style={s.headerSub}>View and manage health reports</Text>
      </View>

      {/* Search Bar */}
      <View style={[s.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder={activeTab === 'disease' ? 'Search by disease or location...' : 'Search by source or location...'}
          placeholderTextColor={colors.textSecondary}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {searchText ? (
          <TouchableOpacity onPress={clearSearch}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[s.filterBtn, { backgroundColor: activeFilterCount > 0 ? colors.primary : 'transparent', borderColor: colors.primary }]}
          onPress={() => { setFilters({ ...appliedFilters }); setShowFilterPanel(true); }}
        >
          <Ionicons name="options" size={18} color={activeFilterCount > 0 ? '#fff' : colors.primary} />
          {activeFilterCount > 0 && (
            <View style={s.filterBadge}>
              <Text style={s.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter tags */}
      {(activeFilterCount > 0 || appliedFilters.searchQuery) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.activeFiltersRow} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
          {appliedFilters.searchQuery ? (
            <TouchableOpacity style={[s.activeTag, { borderColor: colors.primary }]} onPress={clearSearch}>
              <Text style={[s.activeTagText, { color: colors.primary }]}>"{appliedFilters.searchQuery}"</Text>
              <Ionicons name="close" size={12} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.severity ? (
            <TouchableOpacity style={[s.activeTag, { borderColor: getSeverityColor(appliedFilters.severity) }]} onPress={() => setAppliedFilters(f => ({ ...f, severity: '' }))}>
              <Text style={[s.activeTagText, { color: getSeverityColor(appliedFilters.severity) }]}>{appliedFilters.severity}</Text>
              <Ionicons name="close" size={12} color={getSeverityColor(appliedFilters.severity)} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.status ? (
            <TouchableOpacity style={[s.activeTag, { borderColor: getStatusColor(appliedFilters.status) }]} onPress={() => setAppliedFilters(f => ({ ...f, status: '' }))}>
              <Text style={[s.activeTagText, { color: getStatusColor(appliedFilters.status) }]}>{appliedFilters.status}</Text>
              <Ionicons name="close" size={12} color={getStatusColor(appliedFilters.status)} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.district ? (
            <TouchableOpacity style={[s.activeTag, { borderColor: colors.primary }]} onPress={() => setAppliedFilters(f => ({ ...f, district: '' }))}>
              <Text style={[s.activeTagText, { color: colors.primary }]}>📍 {appliedFilters.district}</Text>
              <Ionicons name="close" size={12} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.quality ? (
            <TouchableOpacity style={[s.activeTag, { borderColor: getQualityColor(appliedFilters.quality) }]} onPress={() => setAppliedFilters(f => ({ ...f, quality: '' }))}>
              <Text style={[s.activeTagText, { color: getQualityColor(appliedFilters.quality) }]}>{appliedFilters.quality}</Text>
              <Ionicons name="close" size={12} color={getQualityColor(appliedFilters.quality)} />
            </TouchableOpacity>
          ) : null}
          {(appliedFilters.dateFrom || appliedFilters.dateTo) ? (
            <TouchableOpacity style={[s.activeTag, { borderColor: colors.primary }]} onPress={() => setAppliedFilters(f => ({ ...f, dateFrom: '', dateTo: '' }))}>
              <Text style={[s.activeTagText, { color: colors.primary }]}>📅 {appliedFilters.dateFrom || '...'} → {appliedFilters.dateTo || '...'}</Text>
              <Ionicons name="close" size={12} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => { clearSearch(); clearFilters(); }}>
            <Text style={[s.clearAllText, { color: colors.danger || '#EF4444' }]}>Clear all</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Tabs */}
      <View style={[s.tabRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'disease' && { backgroundColor: colors.primary }]}
          onPress={() => setActiveTab('disease')}
        >
          <MaterialCommunityIcons name="virus" size={16} color={activeTab === 'disease' ? '#FFF' : colors.text} />
          <Text style={[s.tabText, { color: activeTab === 'disease' ? '#FFF' : colors.text }]}>Disease</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'water' && { backgroundColor: colors.secondary }]}
          onPress={() => setActiveTab('water')}
        >
          <Ionicons name="water" size={16} color={activeTab === 'water' ? '#FFF' : colors.text} />
          <Text style={[s.tabText, { color: activeTab === 'water' ? '#FFF' : colors.text }]}>Water Quality</Text>
        </TouchableOpacity>
      </View>

      {/* Result count */}
      <View style={s.resultBar}>
        <Text style={[s.resultText, { color: colors.textSecondary }]}>
          {loading ? 'Loading...' : `${total} result${total !== 1 ? 's' : ''} found`}
          {shown < total ? ` · showing ${shown}` : ''}
        </Text>
      </View>

      {/* Content */}
      <ScrollView
        style={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={s.loaderBox}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {activeTab === 'disease' ? renderDiseaseReports() : renderWaterReports()}

            {/* Load More */}
            {hasMore && (
              <TouchableOpacity
                style={[s.loadMoreBtn, { borderColor: colors.primary }]}
                onPress={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[s.loadMoreText, { color: colors.primary }]}>Load More ({total - shown} remaining)</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* FAB */}
      {canCreateReports && ((activeTab === 'disease' && canAccessDiseaseReports) || (activeTab === 'water' && canAccessWaterReports)) && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => onNavigateToForm(activeTab === 'disease' ? 'new-disease-report' : 'new-water-report')}
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {/* ── Filter Panel Modal ──────────────────────────────────────────────── */}
      <Modal visible={showFilterPanel} animationType="slide" transparent onRequestClose={() => setShowFilterPanel(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.filterPanel, { backgroundColor: colors.card }]}>
            <View style={[s.filterPanelHeader, { borderBottomColor: colors.border }]}>
              <Text style={[s.filterPanelTitle, { color: colors.text }]}>Filters</Text>
              <TouchableOpacity onPress={() => setShowFilterPanel(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.filterPanelBody} showsVerticalScrollIndicator={false}>
              {/* Severity / Quality */}
              {activeTab === 'disease' ? (
                <>
                  <Text style={[s.filterLabel, { color: colors.text }]}>Severity</Text>
                  <View style={s.chipRow}>
                    {['low', 'medium', 'high', 'critical'].map(v => (
                      <FilterChip key={v} label={v.charAt(0).toUpperCase() + v.slice(1)} active={filters.severity === v}
                        onPress={() => setFilters(f => ({ ...f, severity: f.severity === v ? '' : v }))} />
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <Text style={[s.filterLabel, { color: colors.text }]}>Water Quality</Text>
                  <View style={s.chipRow}>
                    {['safe', 'moderate', 'poor', 'contaminated'].map(v => (
                      <FilterChip key={v} label={v.charAt(0).toUpperCase() + v.slice(1)} active={filters.quality === v}
                        onPress={() => setFilters(f => ({ ...f, quality: f.quality === v ? '' : v }))} />
                    ))}
                  </View>
                </>
              )}

              {/* Status — volunteers only see reported/verified; others get full list */}
              <Text style={[s.filterLabel, { color: colors.text, marginTop: 16 }]}>Status</Text>
              <View style={s.chipRow}>
                {(isVolunteer
                  ? ['reported', 'verified']
                  : ['reported', 'verified', 'investigating', 'resolved', 'rejected']
                ).map(v => (
                  <FilterChip key={v} label={v.charAt(0).toUpperCase() + v.slice(1)} active={filters.status === v}
                    onPress={() => setFilters(f => ({ ...f, status: f.status === v ? '' : v }))} />
                ))}
              </View>

              {/* Approval status filter — only for admins/clinic (not volunteers, not ASHA) */}
              {canSeeApprovalStatus && (
                <>
                  <Text style={[s.filterLabel, { color: colors.text, marginTop: 16 }]}>Approval Status</Text>
                  <View style={s.chipRow}>
                    {['pending_approval', 'approved', 'rejected'].map(v => (
                      <FilterChip key={v}
                        label={v === 'pending_approval' ? 'Pending' : v.charAt(0).toUpperCase() + v.slice(1)}
                        active={filters.approvalStatus === v}
                        onPress={() => setFilters(f => ({ ...f, approvalStatus: f.approvalStatus === v ? '' : v }))}
                      />
                    ))}
                  </View>
                </>
              )}

              {/* District */}
              <Text style={[s.filterLabel, { color: colors.text, marginTop: 16 }]}>District</Text>
              <View style={s.districtRow}>
                <TextInput
                  style={[s.filterInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                  placeholder="Type district name..."
                  placeholderTextColor={colors.textSecondary}
                  value={filters.district}
                  onChangeText={(t) => setFilters(f => ({ ...f, district: t }))}
                />
                <TouchableOpacity
                  style={[s.myLocBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}
                  onPress={async () => {
                    try {
                      setFetchingLocation(true);
                      const { status } = await Location.requestForegroundPermissionsAsync();
                      if (status !== 'granted') {
                        Alert.alert('Permission Denied', 'Location permission is required to auto-detect your district.');
                        setFetchingLocation(false);
                        return;
                      }
                      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                      const { latitude, longitude } = loc.coords;

                      // Reverse geocode with Nominatim (works on web + native)
                      const resp = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`,
                        { headers: { 'Accept-Language': 'en' } }
                      );
                      const data = await resp.json();
                      if (data?.address) {
                        const district = data.address.state_district || data.address.county || data.address.city_district || data.address.city || '';
                        if (district) {
                          setFilters(f => ({ ...f, district }));
                        } else {
                          Alert.alert('Not Found', 'Could not determine your district from GPS.');
                        }
                      }
                    } catch (err: any) {
                      console.warn('My Location error:', err);
                      Alert.alert('Error', 'Failed to fetch your location.');
                    } finally {
                      setFetchingLocation(false);
                    }
                  }}
                  disabled={fetchingLocation}
                >
                  {fetchingLocation ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="navigate" size={16} color={colors.primary} />
                      <Text style={[s.myLocText, { color: colors.primary }]}>My Location</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Date Range */}
              <Text style={[s.filterLabel, { color: colors.text, marginTop: 16 }]}>Date Range</Text>
              <View style={s.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.dateLabel, { color: colors.textSecondary }]}>From</Text>
                  <TextInput
                    style={[s.filterInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textSecondary}
                    value={filters.dateFrom}
                    onChangeText={(t) => setFilters(f => ({ ...f, dateFrom: t }))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.dateLabel, { color: colors.textSecondary }]}>To</Text>
                  <TextInput
                    style={[s.filterInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textSecondary}
                    value={filters.dateTo}
                    onChangeText={(t) => setFilters(f => ({ ...f, dateTo: t }))}
                  />
                </View>
              </View>
            </ScrollView>

            {/* Filter actions */}
            <View style={[s.filterActions, { borderTopColor: colors.border }]}>
              <TouchableOpacity style={[s.filterActionBtn, { borderColor: colors.border }]} onPress={clearFilters}>
                <Text style={[s.filterActionText, { color: colors.text }]}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.filterActionBtn, { backgroundColor: colors.primary }]} onPress={applyFilters}>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={[s.filterActionText, { color: '#fff' }]}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Detail Modal ────────────────────────────────────────────────────── */}
      <Modal visible={showDetailModal} animationType="slide" transparent onRequestClose={() => setShowDetailModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.detailModal, { backgroundColor: colors.card }]}>
            <View style={[s.detailModalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[s.detailModalTitle, { color: colors.text }]}>
                {selectedDiseaseReport ? 'Disease Report Details' : 'Water Quality Report Details'}
              </Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.detailModalContent} showsVerticalScrollIndicator={false}>
              {selectedDiseaseReport && (
                <>
                  <DetailRow label="Disease Name" value={selectedDiseaseReport.disease_name} color={colors} />
                  <DetailRow label="Type" value={selectedDiseaseReport.disease_type} color={colors} />
                  <DetailRow label="Severity" value={selectedDiseaseReport.severity?.toUpperCase()} color={colors} valueColor={getSeverityColor(selectedDiseaseReport.severity)} />
                  <DetailRow label="Cases Reported" value={String(selectedDiseaseReport.cases_count || 1)} color={colors} />
                  {selectedDiseaseReport.deaths_count > 0 && <DetailRow label="Deaths" value={String(selectedDiseaseReport.deaths_count)} color={colors} valueColor="#EF4444" />}
                  <DetailRow label="Location" value={`${selectedDiseaseReport.location_name}, ${selectedDiseaseReport.district}, ${selectedDiseaseReport.state}`} color={colors} />
                  <DetailRow label="Demographics" value={`${selectedDiseaseReport.age_group || 'N/A'} • ${selectedDiseaseReport.gender || 'N/A'}`} color={colors} />
                  {selectedDiseaseReport.symptoms && <DetailRow label="Symptoms" value={selectedDiseaseReport.symptoms} color={colors} />}
                  <DetailRow label="Treatment" value={selectedDiseaseReport.treatment_status || 'N/A'} color={colors} />
                  <DetailRow label="Status" value={
                    isVolunteer
                      ? (selectedDiseaseReport.status === 'verified' ? 'Verified' : 'Reported')
                      : selectedDiseaseReport.status || 'N/A'
                  } color={colors} valueColor={getStatusColor(selectedDiseaseReport.status)} />
                  {/* Approval status — visible to admins/clinic and to the specific reporter */}
                  {!isVolunteer && (canSeeApprovalStatus || selectedDiseaseReport.reporter_id === profile.id) && (
                    <DetailRow
                      label="Approval"
                      value={selectedDiseaseReport.approval_status === 'pending_approval' ? 'Pending Review' : (selectedDiseaseReport.approval_status || 'N/A')}
                      color={colors}
                      valueColor={selectedDiseaseReport.approval_status === 'approved' ? '#10B981' : selectedDiseaseReport.approval_status === 'rejected' ? '#EF4444' : '#F59E0B'}
                    />
                  )}
                  {/* Rejection reason — only for the reporter of this specific report or admins */}
                  {selectedDiseaseReport.rejection_reason &&
                   (canSeeApprovalStatus || selectedDiseaseReport.reporter_id === profile.id) && (
                    <DetailRow label="Rejection Reason" value={selectedDiseaseReport.rejection_reason} color={colors} valueColor="#EF4444" />
                  )}
                  {selectedDiseaseReport.notes && <DetailRow label="Notes" value={selectedDiseaseReport.notes} color={colors} />}
                  <DetailRow label="Reported On" value={formatDate(selectedDiseaseReport.created_at)} color={colors} />
                </>
              )}
              {selectedWaterReport && (
                <>
                  <DetailRow label="Source Name" value={selectedWaterReport.source_name || 'N/A'} color={colors} />
                  <DetailRow label="Source Type" value={selectedWaterReport.source_type} color={colors} />
                  <DetailRow label="Overall Quality" value={(selectedWaterReport.overall_quality || 'N/A').toUpperCase()} color={colors} valueColor={getQualityColor(selectedWaterReport.overall_quality)} />
                  <DetailRow label="Location" value={`${selectedWaterReport.location_name}, ${selectedWaterReport.district}, ${selectedWaterReport.state}`} color={colors} />
                  <DetailRow label="pH Level" value={selectedWaterReport.ph_level?.toFixed(2) || 'N/A'} color={colors} />
                  <DetailRow label="TDS Level" value={`${selectedWaterReport.tds_level || 'N/A'} ppm`} color={colors} />
                  {selectedWaterReport.contamination_type && selectedWaterReport.contamination_type !== 'none' && (
                    <DetailRow label="Contamination" value={selectedWaterReport.contamination_type} color={colors} valueColor="#EF4444" />
                  )}
                  <DetailRow label="Status" value={
                    isVolunteer
                      ? (selectedWaterReport.status === 'verified' ? 'Verified' : 'Reported')
                      : selectedWaterReport.status || 'N/A'
                  } color={colors} valueColor={getStatusColor(selectedWaterReport.status)} />
                  {!isVolunteer && (canSeeApprovalStatus || selectedWaterReport.reporter_id === profile.id) && (
                    <DetailRow
                      label="Approval"
                      value={selectedWaterReport.approval_status === 'pending_approval' ? 'Pending Review' : (selectedWaterReport.approval_status || 'N/A')}
                      color={colors}
                      valueColor={selectedWaterReport.approval_status === 'approved' ? '#10B981' : selectedWaterReport.approval_status === 'rejected' ? '#EF4444' : '#F59E0B'}
                    />
                  )}
                  {/* Rejection reason — for reporter or admin */}
                  {selectedWaterReport.rejection_reason &&
                   (canSeeApprovalStatus || selectedWaterReport.reporter_id === profile.id) && (
                    <DetailRow label="Rejection Reason" value={selectedWaterReport.rejection_reason} color={colors} valueColor="#EF4444" />
                  )}
                  {selectedWaterReport.notes && <DetailRow label="Notes" value={selectedWaterReport.notes} color={colors} />}
                  <DetailRow label="Reported On" value={formatDate(selectedWaterReport.created_at)} color={colors} />
                </>
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ── DetailRow helper ──────────────────────────────────────────────────────────

function DetailRow({ label, value, color, valueColor }: { label: string; value: string; color: any; valueColor?: string }) {
  return (
    <View style={[s.detailSection, { borderBottomColor: color.border }]}>
      <Text style={[s.detailLabel, { color: color.textSecondary }]}>{label}</Text>
      <Text style={[s.detailValue, { color: valueColor || color.text }]}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 20, paddingBottom: 16, paddingHorizontal: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#FFF', marginBottom: 2 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },

  // Search bar
  searchRow: { flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 0, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  filterBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  filterBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF4444', width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Active filter tags
  activeFiltersRow: { maxHeight: 36, marginTop: 8 },
  activeTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  activeTagText: { fontSize: 12, fontWeight: '500' },
  clearAllText: { fontSize: 12, fontWeight: '600', paddingVertical: 4, paddingHorizontal: 8 },

  // Tabs
  tabRow: { flexDirection: 'row', marginHorizontal: 12, marginTop: 8, borderRadius: 10, padding: 3, borderWidth: 1 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  tabText: { fontSize: 13, fontWeight: '600' },

  // Result bar
  resultBar: { paddingHorizontal: 16, paddingVertical: 6 },
  resultText: { fontSize: 12 },

  // Content
  content: { flex: 1, paddingHorizontal: 12 },
  loaderBox: { paddingTop: 60, alignItems: 'center' },

  // Cards
  card: { padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  cardBody: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowText: { fontSize: 13 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8 },
  footerLeft: { flexDirection: 'column', alignItems: 'flex-start', flex: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  dateText: { fontSize: 11 },

  // Load more
  loadMoreBtn: { paddingVertical: 12, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', marginVertical: 8 },
  loadMoreText: { fontSize: 13, fontWeight: '600' },

  // Empty state
  emptyState: { padding: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', marginTop: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  emptyDesc: { fontSize: 13, textAlign: 'center' },

  // FAB
  fab: { position: 'absolute', right: 22, bottom: 88, width: 56, height: 56, borderRadius: 28, backgroundColor: '#0D9488', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8 },

  // Modals shared
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },

  // Filter panel
  filterPanel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75%' },
  filterPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1 },
  filterPanelTitle: { fontSize: 18, fontWeight: '700' },
  filterPanelBody: { padding: 18 },
  filterLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  filterChipText: { fontSize: 13, fontWeight: '500' },
  filterInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  districtRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  myLocBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  myLocText: { fontSize: 12, fontWeight: '600' },
  dateRow: { flexDirection: 'row', gap: 12 },
  dateLabel: { fontSize: 12, marginBottom: 4 },
  filterActions: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  filterActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, borderWidth: 1 },
  filterActionText: { fontSize: 15, fontWeight: '600' },

  // Detail modal
  detailModal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  detailModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1 },
  detailModalTitle: { fontSize: 18, fontWeight: '700' },
  detailModalContent: { padding: 18 },
  detailSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1 },
  detailLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginBottom: 3 },
  detailValue: { fontSize: 15 },
});

export default ReportsScreen;
