// =====================================================
// CAMPAIGNS SCREEN - Health Campaigns Management (Vector Icons)
// =====================================================
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Modal,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';

const { width } = Dimensions.get('window');

interface CampaignFilters {
  searchQuery: string;
  campaignType: string;
  status: string;
  district: string;
  dateFrom: string;
  dateTo: string;
}

interface CampaignsScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
}

interface Campaign {
  id: string;
  campaign_name?: string;
  title?: string;
  description: string;
  campaign_type: string;
  start_date: string;
  end_date: string;
  target_audience: string;
  location_name?: string;
  district?: string;
  state?: string;
  contact_person?: string;
  contact_phone?: string;
  target_beneficiaries?: number;
  status: string;
  max_participants?: number;
  current_participants?: number;
  notes?: string;
  created_at: string;
}

const CampaignsScreen: React.FC<CampaignsScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors } = useTheme();

  // Role permission constants — mirrors DB RLS
  const canCreateCampaign  = ['super_admin', 'health_admin', 'district_officer', 'asha_worker'].includes(profile.role);
  const canApproveCampaign = ['super_admin', 'health_admin', 'district_officer'].includes(profile.role);
  const canEnrollCampaign  = ['volunteer', 'asha_worker'].includes(profile.role);
  const isViewOnly         = profile.role === 'volunteer';


  const [activeTab, setActiveTab] = useState<'active' | 'upcoming' | 'past'>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [enrolledCampaigns, setEnrolledCampaigns] = useState<Set<string>>(new Set());
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);

  // Search & Filter state
  const emptyFilters: CampaignFilters = { searchQuery: '', campaignType: '', status: '', district: '', dateFrom: '', dateTo: '' };
  const [searchText, setSearchText] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters] = useState<CampaignFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<CampaignFilters>(emptyFilters);
  const [fetchingLocation, setFetchingLocation] = useState(false);

  const activeFilterCount = [
    appliedFilters.campaignType, appliedFilters.status, appliedFilters.district,
    appliedFilters.dateFrom, appliedFilters.dateTo,
  ].filter(Boolean).length;

  useEffect(() => {
    loadCampaigns();
    loadUserEnrollments();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('health_campaigns')
        .select('*')
        .order('start_date', { ascending: false });

      if (data && !error) {
        setCampaigns(data);
      }
    } catch (error) {
      console.log('Campaigns loading - table may not exist yet');
    }
    setLoading(false);
  };

  const loadUserEnrollments = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('campaign_participants')
        .select('campaign_id')
        .eq('user_id', user.id)
        .neq('status', 'cancelled');

      if (error) {
        console.log('Enrollments error:', error.message);
        // Table might not exist - that's okay
        return;
      }

      if (data) {
        const enrolledIds = new Set(data.map(item => item.campaign_id));
        console.log('Loaded enrolled campaigns:', enrolledIds.size);
        setEnrolledCampaigns(enrolledIds);
      }
    } catch (error: any) {
      console.log('Enrollments loading error:', error.message);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCampaigns(), loadUserEnrollments()]);
    setRefreshing(false);
  };

  const getCampaignTypeInfo = (type: string) => {
    const types: Record<string, { icon: string; iconFamily: 'ionicons' | 'material'; color: string }> = {
      vaccination: { icon: 'needle', iconFamily: 'material', color: '#3B82F6' },
      awareness: { icon: 'megaphone', iconFamily: 'ionicons', color: '#8B5CF6' },
      screening: { icon: 'flask', iconFamily: 'ionicons', color: '#EC4899' },
      sanitation: { icon: 'hand-wash', iconFamily: 'material', color: '#10B981' },
      nutrition: { icon: 'nutrition', iconFamily: 'ionicons', color: '#F59E0B' },
      default: { icon: 'clipboard', iconFamily: 'ionicons', color: '#6B7280' },
    };
    return types[type] || types.default;
  };

  const getStatusColor = (status: string) => {
    const statusColors: Record<string, string> = {
      active: '#10B981',
      upcoming: '#3B82F6',
      completed: '#6B7280',
      cancelled: '#EF4444',
    };
    return statusColors[status] || colors.textSecondary;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const filterCampaigns = () => {
    const now = new Date();
    return campaigns.filter((campaign) => {
      const startDate = new Date(campaign.start_date);
      const endDate = new Date(campaign.end_date);

      // Tab filter
      switch (activeTab) {
        case 'active':
          if (!(startDate <= now && endDate >= now)) return false;
          break;
        case 'upcoming':
          if (!(startDate > now)) return false;
          break;
        case 'past':
          if (!(endDate < now)) return false;
          break;
      }

      // Search filter
      if (appliedFilters.searchQuery) {
        const q = appliedFilters.searchQuery.toLowerCase();
        const name = (campaign.campaign_name || campaign.title || '').toLowerCase();
        const loc = (campaign.location_name || '').toLowerCase();
        const desc = (campaign.description || '').toLowerCase();
        if (!name.includes(q) && !loc.includes(q) && !desc.includes(q)) return false;
      }

      // Campaign type filter
      if (appliedFilters.campaignType && campaign.campaign_type !== appliedFilters.campaignType) return false;

      // Status filter
      if (appliedFilters.status && campaign.status !== appliedFilters.status) return false;

      // District filter
      if (appliedFilters.district) {
        const d = (campaign.district || '').toLowerCase();
        if (!d.includes(appliedFilters.district.toLowerCase())) return false;
      }

      // Date range filter (on start_date)
      if (appliedFilters.dateFrom && campaign.start_date < appliedFilters.dateFrom) return false;
      if (appliedFilters.dateTo && campaign.start_date > appliedFilters.dateTo + 'T23:59:59') return false;

      return true;
    });
  };

  // Search & filter helpers
  const handleSearch = () => setAppliedFilters(f => ({ ...f, searchQuery: searchText.trim() }));
  const clearSearch = () => { setSearchText(''); setAppliedFilters(f => ({ ...f, searchQuery: '' })); };
  const applyFilters = () => { setAppliedFilters(f => ({ ...f, ...filters, searchQuery: f.searchQuery })); setShowFilterPanel(false); };
  const clearAllFilters = () => { setFilters(emptyFilters); setAppliedFilters(f => ({ ...f, campaignType: '', status: '', district: '', dateFrom: '', dateTo: '' })); setShowFilterPanel(false); };

  const handleMyLocation = async () => {
    try {
      setFetchingLocation(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission Denied', 'Location permission is needed.'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&format=json&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await resp.json();
      const district = data?.address?.state_district || data?.address?.county || data?.address?.city_district || data?.address?.city || '';
      if (district) setFilters(f => ({ ...f, district }));
      else Alert.alert('Not Found', 'Could not determine district from GPS.');
    } catch { Alert.alert('Error', 'Failed to fetch location.'); }
    finally { setFetchingLocation(false); }
  };

  const handleEnroll = async (campaignId: string, campaignName: string) => {
    setEnrolling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'You must be logged in to enroll');
        setEnrolling(false);
        return;
      }

      // Check if already enrolled
      const { data: existingEnrollment, error: checkError } = await supabase
        .from('campaign_participants')
        .select('id, status')
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .single();

      if (existingEnrollment) {
        if (existingEnrollment.status === 'cancelled') {
          // Re-enroll if previously cancelled
          const { error: updateError } = await supabase
            .from('campaign_participants')
            .update({ status: 'enrolled', updated_at: new Date().toISOString() })
            .eq('id', existingEnrollment.id);

          if (updateError) throw updateError;

          Alert.alert(
            '🎉 Re-enrolled Successfully!',
            `You have been re-enrolled in "${campaignName}".`,
            [{ text: 'OK', style: 'default' }]
          );
        } else {
          Alert.alert(
            'Already Enrolled',
            `You are already enrolled in "${campaignName}".`,
            [{ text: 'OK', style: 'default' }]
          );
        }
        await Promise.all([loadCampaigns(), loadUserEnrollments()]);
        setEnrolling(false);
        return;
      }

      // Create new enrollment
      const { error: insertError } = await supabase
        .from('campaign_participants')
        .insert({
          campaign_id: campaignId,
          user_id: user.id,
          status: 'enrolled',
        });

      if (insertError) {
        // Handle unique constraint violation
        if (insertError.code === '23505') {
          Alert.alert('Already Enrolled', `You are already enrolled in this campaign.`);
        } else {
          throw insertError;
        }
      } else {
        Alert.alert(
          '🎉 Enrolled Successfully!',
          `You have been enrolled in "${campaignName}". You will receive updates about this campaign.`,
          [{ text: 'OK', style: 'default' }]
        );
      }

      // Refresh campaigns and enrollments
      await Promise.all([loadCampaigns(), loadUserEnrollments()]);
    } catch (error: any) {
      console.error('Enrollment error:', error);
      Alert.alert('Error', error.message || 'Failed to enroll in campaign');
    } finally {
      setEnrolling(false);
    }
  };

  const handleWithdraw = (campaignId: string, campaignName: string) => {
    // Show custom confirmation modal
    setWithdrawTarget({ id: campaignId, name: campaignName });
    setShowWithdrawModal(true);
  };

  const confirmWithdraw = async () => {
    if (!withdrawTarget) return;
    
    const { id: campaignId, name: campaignName } = withdrawTarget;
    console.log('Confirming withdraw for:', campaignId, campaignName);
    
    setShowWithdrawModal(false);
    setWithdrawing(campaignId);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      console.log('User ID:', user?.id);
      if (!user) {
        Alert.alert('Error', 'You must be logged in to withdraw');
        setWithdrawing(null);
        return;
      }

      // Immediately update UI (optimistic update)
      setEnrolledCampaigns(prev => {
        const newSet = new Set(prev);
        newSet.delete(campaignId);
        return newSet;
      });

      console.log('Updating campaign_participants status to cancelled...');
      // Update status to cancelled
      const { data, error } = await supabase
        .from('campaign_participants')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .select();

      console.log('Update result - data:', data, 'error:', error);

      if (error) {
        console.error('Withdraw error:', error);
        // Revert optimistic update on error
        setEnrolledCampaigns(prev => {
          const newSet = new Set(prev);
          newSet.add(campaignId);
          return newSet;
        });
        Alert.alert('Error', error.message || 'Failed to withdraw');
      } else {
        console.log('Withdraw successful!');
        // Refresh to get updated participant count
        loadCampaigns();
      }
    } catch (error: any) {
      console.error('Withdraw catch error:', error);
      // Revert optimistic update on error
      setEnrolledCampaigns(prev => {
        const newSet = new Set(prev);
        newSet.add(campaignId);
        return newSet;
      });
      Alert.alert('Error', error.message || 'Failed to withdraw');
    } finally {
      setWithdrawing(null);
      setWithdrawTarget(null);
    }
  };

  const handleViewDetails = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setShowDetailModal(true);
  };

  const getCampaignTitle = (campaign: Campaign) => {
    return campaign.campaign_name || campaign.title || 'Untitled Campaign';
  };

  const filteredCampaigns = filterCampaigns();

  const renderCampaigns = () => {
    if (filteredCampaigns.length === 0) {
      return (
        <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="megaphone-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No {activeTab} Campaigns</Text>
          <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
            {activeTab === 'active'
              ? 'There are no active campaigns right now'
              : activeTab === 'upcoming'
              ? 'No upcoming campaigns scheduled'
              : 'No past campaigns found'}
          </Text>
          {canCreateCampaign && (
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: colors.primary }]}
              onPress={() => onNavigateToForm('new-campaign')}
            >
              <Text style={styles.emptyButtonText}>Create Campaign</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return filteredCampaigns.map((campaign) => {
      const typeInfo = getCampaignTypeInfo(campaign.campaign_type);
      const maxPart = campaign.max_participants || campaign.target_beneficiaries || 0;
      const currentPart = campaign.current_participants || 0;
      const progressPercent = maxPart > 0 ? (currentPart / maxPart) * 100 : 0;

      return (
        <View
          key={campaign.id}
          style={[styles.campaignCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.campaignHeader}>
            <View style={[styles.typeIcon, { backgroundColor: typeInfo.color + '20' }]}>
              {typeInfo.iconFamily === 'material' ? (
                <MaterialCommunityIcons name={typeInfo.icon as any} size={24} color={typeInfo.color} />
              ) : (
                <Ionicons name={typeInfo.icon as any} size={24} color={typeInfo.color} />
              )}
            </View>
            <View style={styles.campaignTitleSection}>
              <Text style={[styles.campaignTitle, { color: colors.text }]}>{getCampaignTitle(campaign)}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(campaign.status) + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(campaign.status) }]}>
                  {campaign.status?.toUpperCase()}
                </Text>
              </View>
            </View>
          </View>

          <Text style={[styles.campaignDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {campaign.description}
          </Text>

          <View style={styles.campaignDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.text }]}>
                {formatDate(campaign.start_date)} - {formatDate(campaign.end_date)}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.text }]}>
                {campaign.location_name || campaign.district || 'Location TBD'}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.text }]}>
                {campaign.target_audience || 'General Public'}
              </Text>
            </View>
          </View>

          {maxPart > 0 && (
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>Participation</Text>
                <Text style={[styles.progressValue, { color: colors.text }]}>
                  {currentPart}/{maxPart}
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(progressPercent, 100)}%`, backgroundColor: typeInfo.color },
                  ]}
                />
              </View>
            </View>
          )}

          <View style={styles.campaignActions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => handleViewDetails(campaign)}
            >
              <Ionicons name="eye-outline" size={16} color={colors.text} style={{ marginRight: 4 }} />
              <Text style={[styles.actionButtonText, { color: colors.text }]}>View Details</Text>
            </TouchableOpacity>
            {activeTab !== 'past' && canEnrollCampaign && (
              enrolledCampaigns.has(campaign.id) ? (
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton, { backgroundColor: '#EF4444' }]}
                  onPress={() => handleWithdraw(campaign.id, getCampaignTitle(campaign))}
                  disabled={withdrawing === campaign.id}
                >
                  {withdrawing === campaign.id ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="exit-outline" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                      <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>Withdraw</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton, { backgroundColor: typeInfo.color }]}
                  onPress={() => handleEnroll(campaign.id, getCampaignTitle(campaign))}
                  disabled={enrolling}
                >
                  {enrolling ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="person-add-outline" size={16} color="#FFFFFF" style={{ marginRight: 4 }} />
                      <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>Enroll</Text>
                    </>
                  )}
                </TouchableOpacity>
              )
            )}
          </View>

          {/* Enrolled Badge */}
          {enrolledCampaigns.has(campaign.id) && (
            <View style={[styles.enrolledBadge, { backgroundColor: '#10B981' + '20' }]}>
              <Ionicons name="checkmark-circle" size={14} color="#10B981" />
              <Text style={[styles.enrolledBadgeText, { color: '#10B981' }]}>You're Enrolled</Text>
            </View>
          )}
        </View>
      );
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — gradient */}
      <LinearGradient
        colors={['#EF4444', '#DC2626', '#B91C1C']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Campaigns</Text>
          <Text style={styles.headerSubtitle}>Health awareness and outreach programs</Text>
        </View>
      </LinearGradient>

      {/* Search Bar */}
      <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search campaigns..."
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
          style={[styles.filterIconBtn, { backgroundColor: activeFilterCount > 0 ? colors.accent : 'transparent', borderColor: colors.accent }]}
          onPress={() => { setFilters({ ...appliedFilters }); setShowFilterPanel(true); }}
        >
          <Ionicons name="options" size={18} color={activeFilterCount > 0 ? '#fff' : colors.accent} />
          {activeFilterCount > 0 && (
            <View style={styles.filterCountBadge}><Text style={styles.filterCountText}>{activeFilterCount}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter tags */}
      {(activeFilterCount > 0 || appliedFilters.searchQuery) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activeFilterTags} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
          {appliedFilters.searchQuery ? (
            <TouchableOpacity style={[styles.filterTag, { borderColor: colors.accent }]} onPress={clearSearch}>
              <Text style={[styles.filterTagText, { color: colors.accent }]}>"{appliedFilters.searchQuery}"</Text>
              <Ionicons name="close" size={12} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.campaignType ? (
            <TouchableOpacity style={[styles.filterTag, { borderColor: colors.accent }]} onPress={() => setAppliedFilters(f => ({ ...f, campaignType: '' }))}>
              <Text style={[styles.filterTagText, { color: colors.accent }]}>{appliedFilters.campaignType.replace(/_/g, ' ')}</Text>
              <Ionicons name="close" size={12} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.status ? (
            <TouchableOpacity style={[styles.filterTag, { borderColor: getStatusColor(appliedFilters.status) }]} onPress={() => setAppliedFilters(f => ({ ...f, status: '' }))}>
              <Text style={[styles.filterTagText, { color: getStatusColor(appliedFilters.status) }]}>{appliedFilters.status}</Text>
              <Ionicons name="close" size={12} color={getStatusColor(appliedFilters.status)} />
            </TouchableOpacity>
          ) : null}
          {appliedFilters.district ? (
            <TouchableOpacity style={[styles.filterTag, { borderColor: colors.accent }]} onPress={() => setAppliedFilters(f => ({ ...f, district: '' }))}>
              <Text style={[styles.filterTagText, { color: colors.accent }]}>📍 {appliedFilters.district}</Text>
              <Ionicons name="close" size={12} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
          {(appliedFilters.dateFrom || appliedFilters.dateTo) ? (
            <TouchableOpacity style={[styles.filterTag, { borderColor: colors.accent }]} onPress={() => setAppliedFilters(f => ({ ...f, dateFrom: '', dateTo: '' }))}>
              <Text style={[styles.filterTagText, { color: colors.accent }]}>📅 {appliedFilters.dateFrom || '...'} → {appliedFilters.dateTo || '...'}</Text>
              <Ionicons name="close" size={12} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => { clearSearch(); clearAllFilters(); }}>
            <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600', paddingVertical: 4, paddingHorizontal: 8 }}>Clear all</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Tab Buttons */}
      <View style={[styles.tabContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['active', 'upcoming', 'past'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && { backgroundColor: colors.accent },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? '#FFF' : colors.text }]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Result count */}
      <View style={styles.resultBar}>
        <Text style={[styles.resultText, { color: colors.textSecondary }]}>
          {filteredCampaigns.length} campaign{filteredCampaigns.length !== 1 ? 's' : ''} found
        </Text>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.accent]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {renderCampaigns()}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* FAB - Only for super_admin/health_admin/clinic */}
      {(profile.role === 'super_admin' || profile.role === 'health_admin' || profile.role === 'clinic') && (
      <TouchableOpacity
          style={[styles.fab, { backgroundColor: '#EF4444' }]}
          onPress={() => onNavigateToForm('new-campaign')}
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {/* Campaign Details Modal */}
      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Campaign Details</Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            {selectedCampaign && (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Campaign Name</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{getCampaignTitle(selectedCampaign)}</Text>
                </View>
                
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Type</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.campaign_type}</Text>
                </View>
                
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Description</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.description || 'No description'}</Text>
                </View>
                
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Schedule</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {formatDate(selectedCampaign.start_date)} - {formatDate(selectedCampaign.end_date)}
                  </Text>
                </View>
                
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedCampaign.location_name || 'N/A'}
                    {selectedCampaign.district && `, ${selectedCampaign.district}`}
                    {selectedCampaign.state && `, ${selectedCampaign.state}`}
                  </Text>
                </View>
                
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Target Audience</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.target_audience || 'General Public'}</Text>
                </View>
                
                {selectedCampaign.target_beneficiaries && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Target Beneficiaries</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.target_beneficiaries}</Text>
                  </View>
                )}
                
                {selectedCampaign.contact_person && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Contact Person</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.contact_person}</Text>
                    {selectedCampaign.contact_phone && (
                      <Text style={[styles.detailValue, { color: colors.primary }]}>{selectedCampaign.contact_phone}</Text>
                    )}
                  </View>
                )}
                
                {selectedCampaign.notes && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Notes</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.notes}</Text>
                  </View>
                )}
                
                <View style={[styles.detailSection, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Status</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedCampaign.status) + '20', alignSelf: 'flex-start' }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(selectedCampaign.status) }]}>
                      {selectedCampaign.status?.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Enrollment Status in Modal */}
                {enrolledCampaigns.has(selectedCampaign.id) && (
                  <View style={[styles.enrolledBadge, { backgroundColor: '#10B981' + '20', marginBottom: 12 }]}>
                    <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                    <Text style={[styles.enrolledBadgeText, { color: '#10B981', fontSize: 15 }]}>You're Enrolled in this Campaign</Text>
                  </View>
                )}

                {activeTab !== 'past' && (
                  enrolledCampaigns.has(selectedCampaign.id) ? (
                    <TouchableOpacity
                      style={[styles.enrollModalButton, { backgroundColor: '#EF4444' }]}
                      onPress={() => {
                        setShowDetailModal(false);
                        handleWithdraw(selectedCampaign.id, getCampaignTitle(selectedCampaign));
                      }}
                    >
                      <Ionicons name="exit-outline" size={20} color="#FFFFFF" />
                      <Text style={styles.enrollModalButtonText}>Withdraw from Campaign</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.enrollModalButton, { backgroundColor: colors.accent }]}
                      onPress={() => {
                        setShowDetailModal(false);
                        handleEnroll(selectedCampaign.id, getCampaignTitle(selectedCampaign));
                      }}
                      disabled={enrolling}
                    >
                      {enrolling ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="person-add-outline" size={20} color="#FFFFFF" />
                          <Text style={styles.enrollModalButtonText}>Enroll in Campaign</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Withdraw Confirmation Modal */}
      <Modal
        visible={showWithdrawModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          setShowWithdrawModal(false);
          setWithdrawTarget(null);
        }}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={[styles.confirmModalContainer, { backgroundColor: colors.card }]}>
            <View style={[styles.confirmModalIcon, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="warning" size={32} color="#EF4444" />
            </View>
            <Text style={[styles.confirmModalTitle, { color: colors.text }]}>
              Withdraw from Campaign?
            </Text>
            <Text style={[styles.confirmModalMessage, { color: colors.textSecondary }]}>
              Are you sure you want to withdraw from "{withdrawTarget?.name}"? You can re-enroll later if spots are available.
            </Text>
            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalCancelButton, { borderColor: colors.border }]}
                onPress={() => {
                  setShowWithdrawModal(false);
                  setWithdrawTarget(null);
                }}
              >
                <Text style={[styles.confirmModalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmModalButton, styles.confirmModalWithdrawButton]}
                onPress={confirmWithdraw}
              >
                <Ionicons name="exit-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={[styles.confirmModalButtonText, { color: '#FFFFFF' }]}>Withdraw</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Filter Panel Modal ─────────────────────────────────── */}
      <Modal visible={showFilterPanel} animationType="slide" transparent onRequestClose={() => setShowFilterPanel(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.filterPanel, { backgroundColor: colors.card }]}>
            <View style={[styles.filterPanelHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.filterPanelTitle, { color: colors.text }]}>Filters</Text>
              <TouchableOpacity onPress={() => setShowFilterPanel(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.filterPanelBody} showsVerticalScrollIndicator={false}>
              {/* Campaign Type */}
              <Text style={[styles.fLabel, { color: colors.text }]}>Campaign Type</Text>
              <View style={styles.chipRow}>
                {['vaccination', 'awareness', 'health_checkup', 'medicine_distribution', 'medical_camp', 'water_sanitation', 'nutrition'].map(v => (
                  <TouchableOpacity key={v}
                    style={[styles.fChip, { backgroundColor: filters.campaignType === v ? colors.accent + '20' : colors.card, borderColor: filters.campaignType === v ? colors.accent : colors.border }]}
                    onPress={() => setFilters(f => ({ ...f, campaignType: f.campaignType === v ? '' : v }))}>
                    <Text style={[styles.fChipText, { color: filters.campaignType === v ? colors.accent : colors.text }]}>
                      {v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Status */}
              <Text style={[styles.fLabel, { color: colors.text, marginTop: 16 }]}>Status</Text>
              <View style={styles.chipRow}>
                {['active', 'upcoming', 'completed', 'cancelled'].map(v => (
                  <TouchableOpacity key={v}
                    style={[styles.fChip, { backgroundColor: filters.status === v ? getStatusColor(v) + '20' : colors.card, borderColor: filters.status === v ? getStatusColor(v) : colors.border }]}
                    onPress={() => setFilters(f => ({ ...f, status: f.status === v ? '' : v }))}>
                    <Text style={[styles.fChipText, { color: filters.status === v ? getStatusColor(v) : colors.text }]}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* District + My Location */}
              <Text style={[styles.fLabel, { color: colors.text, marginTop: 16 }]}>District</Text>
              <View style={styles.districtRow}>
                <TextInput
                  style={[styles.fInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                  placeholder="Type district name..."
                  placeholderTextColor={colors.textSecondary}
                  value={filters.district}
                  onChangeText={(t) => setFilters(f => ({ ...f, district: t }))}
                />
                <TouchableOpacity
                  style={[styles.myLocBtn, { backgroundColor: colors.accent + '15', borderColor: colors.accent }]}
                  onPress={handleMyLocation}
                  disabled={fetchingLocation}
                >
                  {fetchingLocation ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <>
                      <Ionicons name="navigate" size={16} color={colors.accent} />
                      <Text style={[styles.myLocText, { color: colors.accent }]}>My Location</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Date Range */}
              <Text style={[styles.fLabel, { color: colors.text, marginTop: 16 }]}>Date Range</Text>
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dateSubLabel, { color: colors.textSecondary }]}>From</Text>
                  <TextInput
                    style={[styles.fInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary}
                    value={filters.dateFrom}
                    onChangeText={(t) => setFilters(f => ({ ...f, dateFrom: t }))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dateSubLabel, { color: colors.textSecondary }]}>To</Text>
                  <TextInput
                    style={[styles.fInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                    placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary}
                    value={filters.dateTo}
                    onChangeText={(t) => setFilters(f => ({ ...f, dateTo: t }))}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={[styles.filterActions, { borderTopColor: colors.border }]}>
              <TouchableOpacity style={[styles.filterActionBtn, { borderColor: colors.border }]} onPress={clearAllFilters}>
                <Text style={[styles.filterActionText, { color: colors.text }]}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterActionBtn, { backgroundColor: colors.accent }]} onPress={applyFilters}>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={[styles.filterActionText, { color: '#fff' }]}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* Floating Action Button */}
      {canCreateCampaign && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => onNavigateToForm('new-campaign')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color="#FFF" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  headerCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    marginLeft: 12,
  },
  headerCreateBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  tabContainer: {
    flexDirection: 'row',
    margin: 16,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyState: {
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  emptyDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  emptyButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  campaignCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  campaignHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  typeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  campaignTitleSection: {
    flex: 1,
  },
  campaignTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  campaignDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  campaignDetails: {
    gap: 8,
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
  },
  progressSection: {
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  campaignActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  primaryButton: {
    borderWidth: 0,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 88,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0D9488',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  bottomSpacer: {
    height: 80,
  },
  // Search & Filter styles
  searchRow: { flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 0, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  filterIconBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  filterCountBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF4444', width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  filterCountText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  activeFilterTags: { maxHeight: 36, marginTop: 8 },
  filterTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  filterTagText: { fontSize: 12, fontWeight: '500' },
  resultBar: { paddingHorizontal: 16, paddingVertical: 4 },
  resultText: { fontSize: 12 },
  filterPanel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '75%' },
  filterPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1 },
  filterPanelTitle: { fontSize: 18, fontWeight: '700' },
  filterPanelBody: { padding: 18 },
  fLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  fChipText: { fontSize: 13, fontWeight: '500' },
  fInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  districtRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  myLocBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  myLocText: { fontSize: 12, fontWeight: '600' },
  dateRow: { flexDirection: 'row', gap: 12 },
  dateSubLabel: { fontSize: 12, marginBottom: 4 },
  filterActions: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  filterActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12, borderWidth: 1 },
  filterActionText: { fontSize: 15, fontWeight: '600' },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalContent: {
    padding: 20,
  },
  detailSection: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: 16,
  },
  enrollModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 20,
    gap: 8,
  },
  enrollModalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  enrolledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 6,
  },
  enrolledBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Withdraw Confirmation Modal Styles
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmModalContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  confirmModalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmModalMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  confirmModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  confirmModalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  confirmModalCancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  confirmModalWithdrawButton: {
    backgroundColor: '#EF4444',
  },
  confirmModalButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default CampaignsScreen;
