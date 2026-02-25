// =====================================================
// ADMIN DASHBOARD - with Vector Icons & Feedback Section
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
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { StatCard, DataTable, StatusBadge, Button } from '../shared';
import { diseaseReportsService, waterQualityService, campaignsService, usersService } from '../../lib/services';
import { supabase } from '../../lib/supabase';
import { DiseaseReport, WaterQualityReport, Campaign, Profile } from '../../types';
import { format } from 'date-fns';

const { width } = Dimensions.get('window');
const isSmallScreen = width < 768;

interface AdminDashboardProps {
  profile: Profile;
  onNavigate: (screen: string, params?: any) => void;
}

interface DashboardStats {
  totalReports: number;
  activeOutbreaks: number;
  criticalCases: number;
  pendingVerifications: number;
  totalWaterSources: number;
  unsafeWaterSources: number;
  activeCampaigns: number;
  totalUsers: number;
  pendingFeedback: number;
}

interface UserFeedback {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  category: string;
  feedback_text: string;
  status: string;
  created_at: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ profile, onNavigate }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalReports: 0,
    activeOutbreaks: 0,
    criticalCases: 0,
    pendingVerifications: 0,
    totalWaterSources: 0,
    unsafeWaterSources: 0,
    activeCampaigns: 0,
    totalUsers: 0,
    pendingFeedback: 0,
  });
  const [recentReports, setRecentReports] = useState<DiseaseReport[]>([]);
  const [recentWaterReports, setRecentWaterReports] = useState<WaterQualityReport[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<Campaign[]>([]);
  
  // Feedback states
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackList, setFeedbackList] = useState<UserFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // Load all data in parallel
      const [
        diseaseStats,
        waterStats,
        campaignStats,
        userStats,
        recentDiseaseReports,
        recentWater,
        campaigns,
        feedbackStats,
      ] = await Promise.all([
        diseaseReportsService.getStatistics(),
        waterQualityService.getStatistics(),
        campaignsService.getStatistics(),
        usersService.getStatistics(),
        diseaseReportsService.getRecent(5),
        waterQualityService.getRecent(5),
        campaignsService.getActive(),
        supabase.from('user_feedback').select('id', { count: 'exact' }).eq('status', 'pending'),
      ]);

      setStats({
        totalReports: diseaseStats.data?.totalReports || 0,
        activeOutbreaks: diseaseStats.data?.activeOutbreaks || 0,
        criticalCases: diseaseStats.data?.criticalCases || 0,
        pendingVerifications: diseaseStats.data?.pendingVerifications || 0,
        totalWaterSources: waterStats.data?.totalSources || 0,
        unsafeWaterSources: (waterStats.data?.unsafeSources || 0) + (waterStats.data?.criticalSources || 0),
        activeCampaigns: campaignStats.data?.activeCampaigns || 0,
        totalUsers: userStats.data?.totalUsers || 0,
        pendingFeedback: feedbackStats.count || 0,
      });

      setRecentReports(recentDiseaseReports.data || []);
      setRecentWaterReports(recentWater.data || []);
      setActiveCampaigns(campaigns.data?.slice(0, 3) || []);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFeedback = async () => {
    setFeedbackLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setFeedbackList(data || []);
    } catch (error) {
      console.error('Error loading feedback:', error);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const updateFeedbackStatus = async (id: string, status: string) => {
    try {
      const { error } = await supabase
        .from('user_feedback')
        .update({ status })
        .eq('id', id);

      if (error) throw error;
      
      // Refresh feedback list
      loadFeedback();
      loadDashboardData();
    } catch (error) {
      console.error('Error updating feedback:', error);
    }
  };

  const handleViewFeedback = () => {
    loadFeedback();
    setShowFeedbackModal(true);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'bug': return { name: 'bug', color: colors.error };
      case 'feature': return { name: 'bulb-outline', color: colors.warning };
      case 'improvement': return { name: 'trending-up', color: colors.secondary };
      default: return { name: 'chatbox-outline', color: colors.primary };
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return colors.warning;
      case 'reviewed': return colors.info;
      case 'resolved': return colors.success;
      default: return colors.textSecondary;
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading dashboard...
        </Text>
      </View>
    );
  }

  const reportColumns = [
    { key: 'disease_name', title: 'Disease', width: 150 },
    {
      key: 'severity',
      title: 'Severity',
      width: 120,
      render: (item: DiseaseReport) => <StatusBadge status={item.severity} type="severity" size="small" />,
    },
    { key: 'cases_count', title: 'Cases', width: 80 },
    { key: 'location_name', title: 'Location', width: 150 },
    {
      key: 'status',
      title: 'Status',
      width: 120,
      render: (item: DiseaseReport) => <StatusBadge status={item.status} size="small" />,
    },
    {
      key: 'created_at',
      title: 'Reported',
      width: 120,
      render: (item: DiseaseReport) => (
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {format(new Date(item.created_at), 'MMM d, yyyy')}
        </Text>
      ),
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>Welcome back,</Text>
          <Text style={[styles.name, { color: colors.text }]}>{profile.full_name}</Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: colors.primaryLight }]}>
          <Text style={[styles.roleText, { color: colors.primary }]}>Admin</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <Button
          title="New Alert"
          onPress={() => onNavigate('NewAlert')}
          variant="primary"
          size="small"
        />
        <Button
          title="View Reports"
          onPress={() => onNavigate('DiseaseReports')}
          variant="outline"
          size="small"
        />
        <Button
          title="View Feedbacks"
          onPress={handleViewFeedback}
          variant="outline"
          size="small"
        />
      </View>

      {/* Stats Overview */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Overview</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.statsRow}>
            <StatCard
              title="Disease Reports"
              value={stats.totalReports}
              subtitle={`${stats.pendingVerifications} pending verification`}
              color={colors.primary}
              icon={<Ionicons name="bar-chart" size={24} color={colors.primary} />}
              onPress={() => onNavigate('DiseaseReports')}
            />
            <StatCard
              title="Active Outbreaks"
              value={stats.activeOutbreaks}
              subtitle={`${stats.criticalCases} critical cases`}
              color={colors.danger}
              icon={<Ionicons name="alert-circle" size={24} color={colors.danger} />}
              onPress={() => onNavigate('DiseaseReports', { filter: 'active' })}
            />
            <StatCard
              title="Water Sources"
              value={stats.totalWaterSources}
              subtitle={`${stats.unsafeWaterSources} unsafe sources`}
              color={stats.unsafeWaterSources > 0 ? colors.warning : colors.success}
              icon={<Ionicons name="water" size={24} color={stats.unsafeWaterSources > 0 ? colors.warning : colors.success} />}
              onPress={() => onNavigate('WaterQuality')}
            />
            <StatCard
              title="Active Campaigns"
              value={stats.activeCampaigns}
              color={colors.secondary}
              icon={<Ionicons name="megaphone" size={24} color={colors.secondary} />}
              onPress={() => onNavigate('Campaigns')}
            />
            <StatCard
              title="Total Users"
              value={stats.totalUsers}
              color={colors.info}
              icon={<Ionicons name="people" size={24} color={colors.info} />}
              onPress={() => onNavigate('Users')}
            />
            <StatCard
              title="User Feedback"
              value={stats.pendingFeedback}
              subtitle="pending review"
              color={colors.accent}
              icon={<Ionicons name="chatbox-ellipses" size={24} color={colors.accent} />}
              onPress={handleViewFeedback}
            />
          </View>
        </ScrollView>
      </View>

      {/* Critical Alerts */}
      {stats.criticalCases > 0 && (
        <View style={[styles.alertBanner, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
          <Ionicons name="warning" size={24} color={colors.danger} />
          <View style={styles.alertContent}>
            <Text style={[styles.alertTitle, { color: colors.danger }]}>
              {stats.criticalCases} Critical Cases Require Attention
            </Text>
            <Text style={[styles.alertSubtitle, { color: colors.textSecondary }]}>
              Immediate action required for outbreak control
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => onNavigate('DiseaseReports', { severity: 'critical' })}
            style={[styles.alertButton, { backgroundColor: colors.danger }]}
          >
            <Text style={styles.alertButtonText}>View</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent Disease Reports */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Disease Reports</Text>
          <TouchableOpacity onPress={() => onNavigate('DiseaseReports')}>
            <Text style={[styles.viewAllLink, { color: colors.primary }]}>View All →</Text>
          </TouchableOpacity>
        </View>
        <DataTable
          data={recentReports}
          columns={reportColumns}
          onRowPress={(item) => onNavigate('ReportDetails', { id: item.id, type: 'disease' })}
          emptyMessage="No disease reports yet"
        />
      </View>

      {/* Active Campaigns */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Active Campaigns</Text>
          <TouchableOpacity onPress={() => onNavigate('Campaigns')}>
            <Text style={[styles.viewAllLink, { color: colors.primary }]}>View All →</Text>
          </TouchableOpacity>
        </View>
        {activeCampaigns.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="megaphone-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Active Campaigns</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Create a new campaign to engage the community
            </Text>
            <Button
              title="Create Campaign"
              onPress={() => onNavigate('NewCampaign')}
              variant="primary"
              size="small"
            />
          </View>
        ) : (
          <View style={styles.campaignsList}>
            {activeCampaigns.map((campaign) => (
              <TouchableOpacity
                key={campaign.id}
                onPress={() => onNavigate('CampaignDetails', { id: campaign.id })}
                style={[styles.campaignCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.campaignHeader}>
                  <StatusBadge status={campaign.status} size="small" />
                  <Text style={[styles.campaignType, { color: colors.textSecondary }]}>
                    {campaign.campaign_type.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.campaignTitle, { color: colors.text }]}>{campaign.title}</Text>
                <View style={styles.campaignLocationRow}>
                  <Ionicons name="location" size={14} color={colors.textSecondary} />
                  <Text style={[styles.campaignLocation, { color: colors.textSecondary }]}>
                    {campaign.location_name}, {campaign.district}
                  </Text>
                </View>
                <View style={styles.campaignFooter}>
                  <Text style={[styles.campaignDate, { color: colors.textTertiary }]}>
                    {format(new Date(campaign.start_date), 'MMM d')} - {format(new Date(campaign.end_date), 'MMM d, yyyy')}
                  </Text>
                  <View style={styles.volunteersRow}>
                    <Ionicons name="people" size={14} color={colors.secondary} />
                    <Text style={[styles.campaignVolunteers, { color: colors.secondary }]}>
                      {campaign.volunteers_enrolled}/{campaign.volunteers_needed}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Water Quality Summary */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Water Quality Summary</Text>
          <TouchableOpacity onPress={() => onNavigate('WaterQuality')}>
            <Text style={[styles.viewAllLink, { color: colors.primary }]}>View All →</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.waterSummary}>
          <View style={[styles.waterCard, { backgroundColor: colors.successBg, borderColor: colors.success }]}>
            <Ionicons name="checkmark-circle" size={28} color={colors.success} />
            <Text style={[styles.waterCount, { color: colors.success }]}>
              {stats.totalWaterSources - stats.unsafeWaterSources}
            </Text>
            <Text style={[styles.waterLabel, { color: colors.textSecondary }]}>Safe Sources</Text>
          </View>
          <View style={[styles.waterCard, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
            <Ionicons name="warning" size={28} color={colors.warning} />
            <Text style={[styles.waterCount, { color: colors.warning }]}>{stats.unsafeWaterSources}</Text>
            <Text style={[styles.waterLabel, { color: colors.textSecondary }]}>Need Attention</Text>
          </View>
        </View>
      </View>

      <View style={styles.bottomSpacer} />

      {/* ==================== FEEDBACK MODAL ==================== */}
      <Modal visible={showFeedbackModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="chatbox-ellipses" size={24} color={colors.primary} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>User Feedbacks</Text>
              </View>
              <TouchableOpacity onPress={() => setShowFeedbackModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {feedbackLoading ? (
              <View style={styles.feedbackLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading feedback...</Text>
              </View>
            ) : feedbackList.length === 0 ? (
              <View style={styles.emptyFeedback}>
                <Ionicons name="chatbox-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No Feedback Yet</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  User feedback will appear here
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.feedbackScroll} showsVerticalScrollIndicator={false}>
                {feedbackList.map((feedback) => {
                  const catIcon = getCategoryIcon(feedback.category);
                  return (
                    <View
                      key={feedback.id}
                      style={[styles.feedbackCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                    >
                      <View style={styles.feedbackHeader}>
                        <View style={styles.feedbackUser}>
                          <Ionicons name="person-circle" size={32} color={colors.primary} />
                          <View>
                            <Text style={[styles.feedbackUserName, { color: colors.text }]}>
                              {feedback.user_name || 'Anonymous'}
                            </Text>
                            <Text style={[styles.feedbackEmail, { color: colors.textSecondary }]}>
                              {feedback.user_email}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.feedbackStatus, { backgroundColor: getStatusColor(feedback.status) + '20' }]}>
                          <Text style={[styles.feedbackStatusText, { color: getStatusColor(feedback.status) }]}>
                            {feedback.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.feedbackCategory}>
                        <Ionicons name={catIcon.name as any} size={16} color={catIcon.color} />
                        <Text style={[styles.feedbackCategoryText, { color: catIcon.color }]}>
                          {feedback.category.charAt(0).toUpperCase() + feedback.category.slice(1)}
                        </Text>
                      </View>

                      <Text style={[styles.feedbackText, { color: colors.text }]}>
                        {feedback.feedback_text}
                      </Text>

                      <View style={styles.feedbackFooter}>
                        <View style={styles.feedbackDate}>
                          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                          <Text style={[styles.feedbackDateText, { color: colors.textSecondary }]}>
                            {format(new Date(feedback.created_at), 'MMM d, yyyy h:mm a')}
                          </Text>
                        </View>

                        {feedback.status === 'pending' && (
                          <View style={styles.feedbackActions}>
                            <TouchableOpacity
                              style={[styles.actionBtn, { backgroundColor: colors.info + '20' }]}
                              onPress={() => updateFeedbackStatus(feedback.id, 'reviewed')}
                            >
                              <Ionicons name="eye" size={16} color={colors.info} />
                              <Text style={[styles.actionBtnText, { color: colors.info }]}>Review</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.actionBtn, { backgroundColor: colors.success + '20' }]}
                              onPress={() => updateFeedbackStatus(feedback.id, 'resolved')}
                            >
                              <Ionicons name="checkmark" size={16} color={colors.success} />
                              <Text style={[styles.actionBtnText, { color: colors.success }]}>Resolve</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  greeting: {
    fontSize: 14,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 4,
  },
  roleBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 20,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  viewAllLink: {
    fontSize: 14,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    paddingBottom: 8,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 24,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  alertContent: {
    flex: 1,
    marginLeft: 12,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  alertSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  alertButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  alertButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  campaignsList: {
    gap: 12,
  },
  campaignCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  campaignHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  campaignType: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  campaignTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  campaignLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  campaignLocation: {
    fontSize: 13,
  },
  campaignFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  campaignDate: {
    fontSize: 12,
  },
  volunteersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  campaignVolunteers: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyCard: {
    padding: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  waterSummary: {
    flexDirection: 'row',
    gap: 12,
  },
  waterCard: {
    flex: 1,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  waterCount: {
    fontSize: 32,
    fontWeight: '700',
    marginVertical: 8,
  },
  waterLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  bottomSpacer: {
    height: 40,
  },
  // Feedback Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  feedbackLoading: {
    padding: 40,
    alignItems: 'center',
  },
  emptyFeedback: {
    padding: 40,
    alignItems: 'center',
  },
  feedbackScroll: {
    flex: 1,
  },
  feedbackCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  feedbackUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  feedbackUserName: {
    fontSize: 15,
    fontWeight: '600',
  },
  feedbackEmail: {
    fontSize: 12,
  },
  feedbackStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  feedbackStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  feedbackCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  feedbackCategoryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  feedbackText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  feedbackFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  feedbackDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  feedbackDateText: {
    fontSize: 12,
  },
  feedbackActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default AdminDashboard;
