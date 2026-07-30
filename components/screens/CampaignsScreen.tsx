// =====================================================
// CAMPAIGNS SCREEN - Health Campaigns Management
// ("Prakash" design) — approval-consistent visibility,
// token-driven status colors, 4-state data region.
// =====================================================
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Alert,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { SkeletonBlock, ErrorCard } from '../dashboards/DashboardShared';

interface CampaignsScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
}

interface Campaign {
  id: string;
  campaign_name?: string;
  name?: string;
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
  approval_status?: string;
  organizer_id?: string;
  max_participants?: number;
  current_participants?: number;
  notes?: string;
  created_at: string;
}

type CampaignEligibilityFields = Pick<Campaign, 'status' | 'approval_status' | 'start_date' | 'end_date'>;

const CampaignsScreen: React.FC<CampaignsScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const [activeTab, setActiveTab] = useState<'active' | 'upcoming' | 'past'>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [enrollingCampaignId, setEnrollingCampaignId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [enrolledCampaigns, setEnrolledCampaigns] = useState<Set<string>>(new Set());
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);

  // Approval consistency: admins/officers see everything; other roles see
  // approved campaigns (or legacy rows without an approval status) plus
  // their own submissions in any status.
  const hasFullVisibility = ['super_admin', 'health_admin', 'district_officer'].includes(profile.role);

  useEffect(() => {
    loadCampaigns();
    loadUserEnrollments();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    setCampaignsError(null);
    try {
      let query = supabase
        .from('health_campaigns')
        .select('*')
        .order('start_date', { ascending: false });

      if (!hasFullVisibility) {
        query = query.or(
          `approval_status.eq.approved,approval_status.is.null,organizer_id.eq.${profile.id}`
        );
      }

      const { data, error } = await query;

      if (error) {
        setCampaignsError("Couldn't load campaigns — check connection");
        console.error('[CampaignsScreen.loadCampaigns] Query failed', { error });
        return;
      }

      setCampaigns(data || []);
    } catch (error) {
      setCampaignsError("Couldn't load campaigns — check connection");
      console.error('[CampaignsScreen.loadCampaigns] Unexpected error', { error });
    } finally {
      setLoading(false);
    }
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
        if (__DEV__) {
          console.info('[CampaignsScreen] Loaded enrolled campaigns', { count: enrolledIds.size });
        }
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
    const types: Record<string, { icon: string; color: string }> = {
      vaccination: { icon: 'medkit-outline', color: colors.info },
      awareness: { icon: 'megaphone-outline', color: colors.primary },
      screening: { icon: 'flask-outline', color: colors.accent },
      sanitation: { icon: 'hand-left-outline', color: colors.success },
      nutrition: { icon: 'nutrition-outline', color: colors.warning },
      default: { icon: 'clipboard-outline', color: colors.textSecondary },
    };
    return types[type] || types.default;
  };

  const getStatusColor = (status: string) => {
    const statusColors: Record<string, string> = {
      active: colors.success,
      upcoming: colors.info,
      completed: colors.textSecondary,
      cancelled: colors.danger,
    };
    return statusColors[status] || colors.textSecondary;
  };

  const getStatusBg = (status: string) => {
    const statusBgs: Record<string, string> = {
      active: colors.successBg,
      upcoming: colors.infoBg,
      completed: colors.surfaceVariant,
      cancelled: colors.dangerBg,
    };
    return statusBgs[status] || colors.surfaceVariant;
  };

  const StatusPill: React.FC<{ status: string }> = ({ status }) => (
    <View
      style={[styles.statusPill, { backgroundColor: getStatusBg(status) }]}
      accessibilityLabel={`Status: ${status || 'unknown'}`}
    >
      <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
      <Text style={[styles.statusPillText, { color: getStatusColor(status) }]} maxFontSizeMultiplier={1.3}>
        {status?.toUpperCase()}
      </Text>
    </View>
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const isCampaignEnrollable = (campaign: CampaignEligibilityFields) => {
    const now = new Date();
    const startDate = new Date(campaign.start_date);
    const endDate = new Date(campaign.end_date);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;

    const status = (campaign.status || '').toLowerCase();
    const closedStatuses = ['completed', 'cancelled', 'inactive', 'closed', 'archived'];
    const isClosed = closedStatuses.includes(status);
    const isApproved = !campaign.approval_status || campaign.approval_status === 'approved';
    return isApproved && !isClosed && endDate >= now;
  };

  const isCampaignActive = (campaign: Campaign) => {
    return isCampaignEnrollable(campaign);
  };

  const filterCampaigns = () => {
    const now = new Date();
    return campaigns.filter((campaign) => {
      const startDate = new Date(campaign.start_date);
      const endDate = new Date(campaign.end_date);

      switch (activeTab) {
        case 'active':
          return startDate <= now && endDate >= now;
        case 'upcoming':
          return startDate > now;
        case 'past':
          return endDate < now;
        default:
          return true;
      }
    });
  };

  const handleEnroll = async (campaignId: string, campaignName: string) => {
    setEnrollingCampaignId(campaignId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'You must be logged in to enroll');
        return;
      }

      const { data: campaignRecord, error: campaignFetchError } = await supabase
        .from('health_campaigns')
        .select('id, status, approval_status, start_date, end_date')
        .eq('id', campaignId)
        .single();

      if (campaignFetchError || !campaignRecord) {
        Alert.alert('Campaign Unavailable', 'Could not verify campaign status. Please refresh and try again.');
        setEnrollingCampaignId(null);
        return;
      }

      const isEnrollable = isCampaignEnrollable(campaignRecord as CampaignEligibilityFields);

      if (!isEnrollable) {
        Alert.alert('Campaign Closed', 'Enrollment is available only for upcoming or ongoing approved campaigns.');
        setEnrollingCampaignId(null);
        return;
      }

      // Check if already enrolled
      const { data: existingEnrollment, error: checkError } = await supabase
        .from('campaign_participants')
        .select('id, status')
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Enrollment check failed:', checkError);
        Alert.alert('Error', checkError.message || 'Failed to verify campaign enrollment status');
        return;
      }

      if (existingEnrollment) {
        if (existingEnrollment.status === 'cancelled') {
          // Re-enroll if previously cancelled
          const { error: updateError } = await supabase
            .from('campaign_participants')
            .update({ status: 'enrolled', updated_at: new Date().toISOString() })
            .eq('id', existingEnrollment.id);

          if (updateError) throw updateError;

          Alert.alert(
            'Re-enrolled Successfully',
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
          'Enrolled Successfully',
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
      setEnrollingCampaignId(null);
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

    setShowWithdrawModal(false);
    setWithdrawing(campaignId);

    try {
      const { data: { user } } = await supabase.auth.getUser();
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

      // Update status to cancelled
      const { error } = await supabase
        .from('campaign_participants')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .select();

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
    return campaign.campaign_name || campaign.title || campaign.name || 'Untitled Campaign';
  };

  const filteredCampaigns = filterCampaigns();

  const canCreateCampaigns = ['super_admin', 'health_admin', 'district_officer', 'asha_worker'].includes(profile.role);
  const canEnroll = profile.role === 'asha_worker' || profile.role === 'volunteer';
  const canViewCampaignIntelligence = ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'].includes(profile.role);

  const renderCampaigns = () => {
    if (filteredCampaigns.length === 0) {
      return (
        <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
          <Ionicons name="checkmark-circle-outline" size={24} color={colors.success} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {activeTab === 'active'
              ? 'No active campaigns right now.'
              : activeTab === 'upcoming'
              ? 'No upcoming campaigns scheduled.'
              : 'No past campaigns on record.'}
          </Text>
          {canCreateCampaigns && (
            <Pressable
              style={({ pressed }) => [
                styles.emptyButton,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
              ]}
              onPress={() => onNavigateToForm('new-campaign')}
              accessibilityRole="button"
              accessibilityLabel="Create campaign"
            >
              <Text style={[styles.emptyButtonText, { color: colors.onPrimary }]}>Create Campaign</Text>
            </Pressable>
          )}
        </View>
      );
    }

    return filteredCampaigns.map((campaign) => {
      const typeInfo = getCampaignTypeInfo(campaign.campaign_type);
      const maxPart = campaign.max_participants || campaign.target_beneficiaries || 0;
      const currentPart = campaign.current_participants || 0;
      const progressPercent = maxPart > 0 ? (currentPart / maxPart) * 100 : 0;
      const campaignIsActive = isCampaignActive(campaign);

      return (
        <View
          key={campaign.id}
          style={[styles.campaignCard, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}
        >
          <View style={styles.campaignHeader}>
            <View style={[styles.typeIcon, { backgroundColor: typeInfo.color + '14' }]}>
              <Ionicons name={typeInfo.icon as any} size={24} color={typeInfo.color} />
            </View>
            <View style={styles.campaignTitleSection}>
              <Text style={[styles.campaignTitle, { color: colors.text }]}>{getCampaignTitle(campaign)}</Text>
              <StatusPill status={campaign.status} />
            </View>
          </View>

          <Text style={[styles.campaignDescription, { color: colors.textSecondary }]} numberOfLines={2}>
            {campaign.description}
          </Text>

          <View style={styles.campaignDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.detailText, styles.numericText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
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
                <Text style={[styles.progressValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {currentPart}/{maxPart}
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.surfaceVariant }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(progressPercent, 100)}%`, backgroundColor: colors.primary },
                  ]}
                />
              </View>
            </View>
          )}

          <View style={styles.campaignActions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: pressed ? colors.cardHover : 'transparent',
                  borderColor: colors.inputBorder,
                },
              ]}
              onPress={() => handleViewDetails(campaign)}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${getCampaignTitle(campaign)}`}
            >
              <Text style={[styles.actionButtonText, { color: colors.text }]}>View Details</Text>
            </Pressable>
            {campaignIsActive && canEnroll && (
              enrolledCampaigns.has(campaign.id) ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.primaryButton,
                    { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                  ]}
                  onPress={() => handleWithdraw(campaign.id, getCampaignTitle(campaign))}
                  disabled={withdrawing === campaign.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Withdraw from ${getCampaignTitle(campaign)}`}
                >
                  {withdrawing === campaign.id ? (
                    <ActivityIndicator size="small" color={colors.textInverse} />
                  ) : (
                    <Text style={[styles.actionButtonText, { color: colors.textInverse }]}>Withdraw</Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.primaryButton,
                    { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                  ]}
                  onPress={() => handleEnroll(campaign.id, getCampaignTitle(campaign))}
                  disabled={campaign.id === enrollingCampaignId}
                  accessibilityRole="button"
                  accessibilityLabel={`Enroll in ${getCampaignTitle(campaign)}`}
                >
                  {campaign.id === enrollingCampaignId ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Text style={[styles.actionButtonText, { color: colors.onPrimary }]}>Enroll</Text>
                  )}
                </Pressable>
              )
            )}
          </View>

          {/* Enrolled Badge */}
          {enrolledCampaigns.has(campaign.id) && (
            <View style={[styles.enrolledBadge, { backgroundColor: colors.successBg }]}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={[styles.enrolledBadgeText, { color: colors.success }]}>You're Enrolled</Text>
            </View>
          )}
        </View>
      );
    });
  };

  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg band */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: headerText }]}>Campaigns</Text>
            <Text style={[styles.headerSubtitle, { color: headerSub }]}>Health awareness and outreach programs</Text>
          </View>
          {canViewCampaignIntelligence && (
            <TouchableOpacity
              style={[styles.headerActionBtn, { borderColor: headerSub }]}
              onPress={() => onNavigateToForm('campaign-intelligence')}
              accessibilityRole="button"
              accessibilityLabel="Open campaign intelligence"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="analytics-outline" size={15} color={headerText} />
              <Text style={[styles.headerActionText, { color: headerText }]}>Intelligence</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tab Buttons */}
      <View style={[styles.tabContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['active', 'upcoming', 'past'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && { backgroundColor: colors.primary },
            ]}
            onPress={() => setActiveTab(tab)}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === tab }}
            accessibilityLabel={`${tab} campaigns tab`}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.onPrimary : colors.text }]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Eyebrow-and-count section header */}
        <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]} numberOfLines={1}>
          {activeTab.toUpperCase()} CAMPAIGNS
          {!loading && !campaignsError && (
            <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${filteredCampaigns.length}`}</Text>
          )}
        </Text>

        {loading ? (
          <View style={styles.skeletonWrap} accessibilityElementsHidden>
            <SkeletonBlock height={220} radius={radii.md} />
            <SkeletonBlock height={220} radius={radii.md} />
          </View>
        ) : campaignsError ? (
          <ErrorCard message={campaignsError} onRetry={loadCampaigns} />
        ) : (
          renderCampaigns()
        )}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Campaign Details Modal */}
      <Modal
        visible={showDetailModal}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent={true}
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
            {/* 3px status top rule — never flood-fill a modal header */}
            <View
              style={[
                styles.modalTopRule,
                { backgroundColor: selectedCampaign ? getStatusColor(selectedCampaign.status) : colors.border },
              ]}
            />
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Campaign Details</Text>
              <TouchableOpacity
                onPress={() => setShowDetailModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                accessibilityRole="button"
                accessibilityLabel="Close campaign details"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedCampaign && (
              <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Campaign Name</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{getCampaignTitle(selectedCampaign)}</Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Type</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.campaign_type}</Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Description</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.description || 'No description'}</Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Schedule</Text>
                  <Text style={[styles.detailValue, styles.numericText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {formatDate(selectedCampaign.start_date)} - {formatDate(selectedCampaign.end_date)}
                  </Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {selectedCampaign.location_name || 'N/A'}
                    {selectedCampaign.district && `, ${selectedCampaign.district}`}
                    {selectedCampaign.state && `, ${selectedCampaign.state}`}
                  </Text>
                </View>

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Target Audience</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.target_audience || 'General Public'}</Text>
                </View>

                {selectedCampaign.target_beneficiaries && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Target Beneficiaries</Text>
                    <Text style={[styles.detailValue, styles.numericText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {selectedCampaign.target_beneficiaries}
                    </Text>
                  </View>
                )}

                {selectedCampaign.contact_person && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Contact Person</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.contact_person}</Text>
                    {selectedCampaign.contact_phone && (
                      <Text style={[styles.detailValue, styles.numericText, { color: isDark ? colors.primary : colors.primaryDark }]} maxFontSizeMultiplier={1.3}>
                        {selectedCampaign.contact_phone}
                      </Text>
                    )}
                  </View>
                )}

                {selectedCampaign.notes && (
                  <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Notes</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedCampaign.notes}</Text>
                  </View>
                )}

                <View style={[styles.detailSection, { borderBottomColor: colors.borderLight }]}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Status</Text>
                  <View style={{ alignSelf: 'flex-start' }}>
                    <StatusPill status={selectedCampaign.status} />
                  </View>
                </View>

                {/* Enrollment Status in Modal */}
                {enrolledCampaigns.has(selectedCampaign.id) && (
                  <View style={[styles.enrolledBadge, { backgroundColor: colors.successBg, marginBottom: spacing.md }]}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text style={[styles.enrolledBadgeText, { color: colors.success, fontSize: 15 }]}>You're Enrolled in this Campaign</Text>
                  </View>
                )}

                {isCampaignActive(selectedCampaign) && canEnroll && (
                  enrolledCampaigns.has(selectedCampaign.id) ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.enrollModalButton,
                        { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                      ]}
                      onPress={() => {
                        setShowDetailModal(false);
                        handleWithdraw(selectedCampaign.id, getCampaignTitle(selectedCampaign));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Withdraw from campaign"
                    >
                      <Ionicons name="exit-outline" size={20} color={colors.textInverse} />
                      <Text style={[styles.enrollModalButtonText, { color: colors.textInverse }]}>Withdraw from Campaign</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [
                        styles.enrollModalButton,
                        { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                      ]}
                      onPress={() => {
                        setShowDetailModal(false);
                        handleEnroll(selectedCampaign.id, getCampaignTitle(selectedCampaign));
                      }}
                      disabled={selectedCampaign.id === enrollingCampaignId}
                      accessibilityRole="button"
                      accessibilityLabel="Enroll in campaign"
                    >
                      {selectedCampaign.id === enrollingCampaignId ? (
                        <ActivityIndicator size="small" color={colors.onPrimary} />
                      ) : (
                        <>
                          <Ionicons name="person-add-outline" size={20} color={colors.onPrimary} />
                          <Text style={[styles.enrollModalButtonText, { color: colors.onPrimary }]}>Enroll in Campaign</Text>
                        </>
                      )}
                    </Pressable>
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
        animationType={reduceMotion ? 'none' : 'fade'}
        transparent={true}
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => {
          setShowWithdrawModal(false);
          setWithdrawTarget(null);
        }}
      >
        <View style={[styles.confirmModalOverlay, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              styles.confirmModalContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            <View style={[styles.confirmModalIcon, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="warning-outline" size={32} color={colors.danger} />
            </View>
            <Text style={[styles.confirmModalTitle, { color: colors.text }]}>
              Withdraw from Campaign?
            </Text>
            <Text style={[styles.confirmModalMessage, { color: colors.textSecondary }]}>
              Are you sure you want to withdraw from "{withdrawTarget?.name}"? You can re-enroll later if spots are available.
            </Text>
            <View style={styles.confirmModalButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalCancelButton,
                  { borderColor: colors.inputBorder, backgroundColor: pressed ? colors.cardHover : 'transparent' },
                ]}
                onPress={() => {
                  setShowWithdrawModal(false);
                  setWithdrawTarget(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel withdrawal"
              >
                <Text style={[styles.confirmModalButtonText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                ]}
                onPress={confirmWithdraw}
                accessibilityRole="button"
                accessibilityLabel="Confirm withdrawal"
              >
                <Ionicons name="exit-outline" size={18} color={colors.textInverse} style={{ marginRight: 6 }} />
                <Text style={[styles.confirmModalButtonText, { color: colors.textInverse }]}>Withdraw</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    paddingTop: 42,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  skeletonWrap: {
    gap: spacing.md,
  },
  sectionEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tabContainer: {
    flexDirection: 'row',
    margin: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.xs,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  campaignCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  campaignHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  campaignTitleSection: {
    flex: 1,
  },
  campaignTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  campaignDescription: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  campaignDetails: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    flexShrink: 1,
  },
  numericText: {
    fontVariant: ['tabular-nums'],
  },
  progressSection: {
    marginBottom: spacing.lg,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
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
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  primaryButton: {
    borderWidth: 0,
  },
  actionButtonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 80,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalTopRule: {
    height: 3,
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    flex: 1,
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    padding: spacing.lg,
  },
  detailSection: {
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailValue: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  enrollModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  enrollModalButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  enrolledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    marginTop: spacing.md,
    gap: 6,
  },
  enrolledBadgeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  // Withdraw Confirmation Modal Styles
  confirmModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  confirmModalContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
  },
  confirmModalIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  confirmModalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  confirmModalMessage: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  confirmModalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.md,
  },
  confirmModalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  confirmModalCancelButton: {
    borderWidth: 1.5,
  },
  confirmModalButtonText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
});

export default CampaignsScreen;
