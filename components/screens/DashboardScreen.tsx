// =====================================================
// DASHBOARD SCREEN - Main Home Screen (Vector Icons)
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
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';

const { width } = Dimensions.get('window');

interface Feedback {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  category: string;
  feedback_text: string;
  status: string;
  created_at: string;
}

interface DashboardScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
}

interface HealthAlert {
  id: string;
  alert_type: string;
  urgency_level: string;
  title: string;
  description: string;
  location_name: string;
  district: string;
  state: string;
  status: string;
  created_at: string;
  affected_population?: number;
  cases_reported?: number;
  disease_or_issue?: string;
  symptoms_to_watch?: string;
  immediate_actions?: string;
  precautionary_measures?: string;
  contact_person?: string;
  contact_phone?: string;
  approval_status?: string;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    diseaseReports: 0,
    waterReports: 0,
    campaigns: 0,
    criticalAlerts: 0,
    pendingFeedback: 0,
  });

  // Alerts state
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<HealthAlert | null>(null);
  const [showAlertModal, setShowAlertModal] = useState(false);

  // Feedback state (for admin)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  useEffect(() => {
    loadStats();
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (data && !error) {
        setAlerts(data);
      }
    } catch (error) {
      console.log('Alerts loading - table may not exist yet');
    }
  };

  const loadStats = async () => {
    try {
      const [diseaseRes, waterRes, campaignsRes, alertsRes] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);

      let pendingFeedbackCount = 0;
      // Super Admin + Health Admin get feedback count
      if (profile.role === 'super_admin' || profile.role === 'health_admin') {
        const feedbackRes = await supabase
          .from('user_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        pendingFeedbackCount = feedbackRes.count || 0;
      }

      setStats({
        diseaseReports: diseaseRes.status === 'fulfilled' ? (diseaseRes.value.count || 0) : 0,
        waterReports: waterRes.status === 'fulfilled' ? (waterRes.value.count || 0) : 0,
        campaigns: campaignsRes.status === 'fulfilled' ? (campaignsRes.value.count || 0) : 0,
        criticalAlerts: alertsRes.status === 'fulfilled' ? (alertsRes.value.count || 0) : 0,
        pendingFeedback: pendingFeedbackCount,
      });
    } catch (error) {
      console.log('Stats loading - tables may not exist yet');
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
      loadFeedback();
      loadStats();
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
    await Promise.all([loadStats(), loadAlerts()]);
    setRefreshing(false);
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency?.toLowerCase()) {
      case 'critical': return '#DC2626';
      case 'high': return '#EA580C';
      case 'medium': return '#F59E0B';
      case 'low': return '#10B981';
      default: return '#6B7280';
    }
  };

  const getAlertTypeIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'disease_outbreak': return 'virus';
      case 'water_contamination': return 'water';
      case 'emergency': return 'warning';
      case 'natural_disaster': return 'thunderstorm';
      default: return 'alert-circle';
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin: 'Super Administrator',
      health_admin: 'Health Administrator',
      clinic: 'Clinic Staff',
      asha_worker: 'ASHA Worker',
      volunteer: 'Volunteer',
      district_officer: 'District Officer',
    };
    return labels[role] || role;
  };

  // Role-based quick actions
  // Admin & Clinic: Disease, Water, Campaign, Alert
  // ASHA Worker: Water, Campaign, Alert (NO disease)
  // Volunteer: NO quick actions (can only view and enroll in campaigns)
  const getAllQuickActions = () => {
    const allActions = [
      { id: 'disease', icon: 'virus' as const, iconFamily: 'material' as const, label: 'Report Disease', color: '#EF4444', screen: 'new-disease-report', roles: ['super_admin', 'health_admin', 'clinic', 'district_officer'] },
      { id: 'water', icon: 'water' as const, iconFamily: 'ionicons' as const, label: 'Water Quality', color: '#3B82F6', screen: 'new-water-report', roles: ['super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer'] },
      { id: 'campaign', icon: 'megaphone' as const, iconFamily: 'ionicons' as const, label: 'New Campaign', color: '#10B981', screen: 'new-campaign', roles: ['super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer'] },
      { id: 'alert', icon: 'alert-circle' as const, iconFamily: 'ionicons' as const, label: 'Send Alert', color: '#F59E0B', screen: 'new-alert', roles: ['super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer'] },
    ];
    
    // Volunteers don't get any quick actions - they can only view and enroll
    return allActions.filter(action => action.roles.includes(profile.role));
  };

  const quickActions = getAllQuickActions();
  const isVolunteer = profile.role === 'volunteer';

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'bug': return { name: 'bug', color: colors.error };
      case 'feature': return { name: 'bulb-outline', color: colors.warning };
      case 'improvement': return { name: 'trending-up', color: colors.secondary };
      default: return { name: 'chatbox', color: colors.primary };
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

  const statCards = [
    { label: 'Disease Reports', value: stats.diseaseReports, icon: 'bar-chart' as const, iconFamily: 'ionicons' as const, color: '#EF4444' },
    { label: 'Water Reports', value: stats.waterReports, icon: 'water' as const, iconFamily: 'ionicons' as const, color: '#3B82F6' },
    { label: 'Active Campaigns', value: stats.campaigns, icon: 'megaphone' as const, iconFamily: 'ionicons' as const, color: '#10B981' },
    { label: 'Critical Alerts', value: stats.criticalAlerts, icon: 'warning' as const, iconFamily: 'ionicons' as const, color: '#F59E0B' },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <View style={styles.headerContent}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName}>{profile.full_name || 'User'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{getRoleLabel(profile.role)}</Text>
          </View>
        </View>
        <View style={styles.headerPattern} />
      </View>

      {/* Quick Actions - Only show if user has actions available */}
      {quickActions.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
          <View style={styles.quickActionsGrid}>
            {quickActions.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={[styles.quickActionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => onNavigateToForm(action.screen)}
                activeOpacity={0.7}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: action.color + '20' }]}>
                  {action.iconFamily === 'material' ? (
                    <MaterialCommunityIcons name={action.icon} size={28} color={action.color} />
                  ) : (
                    <Ionicons name={action.icon} size={28} color={action.color} />
                  )}
                </View>
                <Text style={[styles.quickActionLabel, { color: colors.text }]}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Volunteer Info Card - Show helpful info for volunteers */}
      {isVolunteer && (
        <View style={styles.section}>
          <View style={[styles.volunteerInfoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.volunteerIconContainer, { backgroundColor: '#10B981' + '20' }]}>
              <Ionicons name="heart" size={32} color="#10B981" />
            </View>
            <View style={styles.volunteerInfoContent}>
              <Text style={[styles.volunteerInfoTitle, { color: colors.text }]}>Welcome, Volunteer!</Text>
              <Text style={[styles.volunteerInfoText, { color: colors.textSecondary }]}>
                You can view reports, alerts, and enroll in health campaigns. Check the Campaigns tab to participate!
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ==================== ADMIN TOOLS SECTION ==================== */}
      {(profile.role === 'super_admin' || profile.role === 'health_admin') && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Admin Tools</Text>
          <TouchableOpacity
            style={[styles.adminToolCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => onNavigateToForm('admin-management')}
            activeOpacity={0.7}
          >
            <View style={styles.adminToolContent}>
              <View style={[styles.adminToolIcon, { backgroundColor: '#EF4444' + '20' }]}>
                <Ionicons name="shield-checkmark" size={32} color="#EF4444" />
              </View>
              <View style={styles.adminToolInfo}>
                <Text style={[styles.adminToolTitle, { color: colors.text }]}>
                  {profile.role === 'super_admin' ? 'Super Admin Panel' : 'Health Admin Panel'}
                </Text>
                <Text style={[styles.adminToolSubtitle, { color: colors.textSecondary }]}>
                  {profile.role === 'super_admin'
                    ? 'Manage users, reports, campaigns & analytics'
                    : 'Approve reports, campaigns, alerts & analytics'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* ==================== CLINIC APPROVAL SECTION ==================== */}
      {profile.role === 'clinic' && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Clinic Tools</Text>
          <TouchableOpacity
            style={[styles.adminToolCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => onNavigateToForm('admin-management')}
            activeOpacity={0.7}
          >
            <View style={styles.adminToolContent}>
              <View style={[styles.adminToolIcon, { backgroundColor: '#8B5CF6' + '20' }]}>
                <Ionicons name="checkmark-circle" size={32} color="#8B5CF6" />
              </View>
              <View style={styles.adminToolInfo}>
                <Text style={[styles.adminToolTitle, { color: colors.text }]}>Report Approval</Text>
                <Text style={[styles.adminToolSubtitle, { color: colors.textSecondary }]}>
                  Review & approve pending ASHA worker reports
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Stats Overview */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Overview</Text>
        <View style={styles.statsGrid}>
          {statCards.map((stat, index) => (
            <View
              key={index}
              style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.statIconContainer, { backgroundColor: stat.color + '20' }]}>
                <Ionicons name={stat.icon} size={24} color={stat.color} />
              </View>
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ==================== AI HEALTH INSIGHTS ==================== */}
      <AIInsightsPanel profile={profile} />

      {/* ==================== HEALTH ALERTS SECTION ==================== */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>🚨 Active Alerts</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => onNavigateToForm('all-alerts')}>
              <Text style={[styles.seeAllText, { color: colors.primary }]}>View All</Text>
            </TouchableOpacity>
            {(profile.role === 'super_admin' || profile.role === 'health_admin' || profile.role === 'clinic' || profile.role === 'district_officer') && (
              <TouchableOpacity onPress={() => onNavigateToForm('new-alert')}>
                <Text style={[styles.seeAllText, { color: colors.primary }]}>+ New Alert</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        
        {alerts.length === 0 ? (
          <View style={[styles.emptyAlertCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="checkmark-circle" size={40} color="#10B981" />
            <Text style={[styles.emptyAlertTitle, { color: colors.text }]}>No Active Alerts</Text>
            <Text style={[styles.emptyAlertSubtitle, { color: colors.textSecondary }]}>
              All clear! No health alerts at this time.
            </Text>
          </View>
        ) : (
          <View style={styles.alertsList}>
            {alerts.map((alert) => (
              <TouchableOpacity
                key={alert.id}
                style={[styles.alertCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  setSelectedAlert(alert);
                  setShowAlertModal(true);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.alertHeader}>
                  <View style={[styles.alertIconContainer, { backgroundColor: getUrgencyColor(alert.urgency_level) + '20' }]}>
                    {alert.alert_type === 'water_contamination' ? (
                      <Ionicons name="water" size={20} color={getUrgencyColor(alert.urgency_level)} />
                    ) : alert.alert_type === 'disease_outbreak' ? (
                      <MaterialCommunityIcons name="virus" size={20} color={getUrgencyColor(alert.urgency_level)} />
                    ) : (
                      <Ionicons name="warning" size={20} color={getUrgencyColor(alert.urgency_level)} />
                    )}
                  </View>
                  <View style={styles.alertTitleSection}>
                    <Text style={[styles.alertTitle, { color: colors.text }]} numberOfLines={1}>
                      {alert.title}
                    </Text>
                    <View style={[styles.urgencyBadge, { backgroundColor: getUrgencyColor(alert.urgency_level) + '20' }]}>
                      <Text style={[styles.urgencyText, { color: getUrgencyColor(alert.urgency_level) }]}>
                        {alert.urgency_level?.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </View>
                <Text style={[styles.alertDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                  {alert.description}
                </Text>
                <View style={styles.alertFooter}>
                  <View style={styles.alertLocation}>
                    <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.alertLocationText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {alert.location_name}, {alert.district}
                    </Text>
                  </View>
                  <Text style={[styles.alertTime, { color: colors.textSecondary }]}>
                    {new Date(alert.created_at).toLocaleDateString()}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* ==================== ADMIN ONLY: User Feedbacks Section ==================== */}
      {(profile.role === 'super_admin' || profile.role === 'health_admin') && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>User Feedbacks</Text>
          <View style={[styles.feedbackSectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.feedbackSectionHeader}>
              <View style={[styles.feedbackIconContainer, { backgroundColor: '#8B5CF6' + '20' }]}>
                <Ionicons name="chatbox-ellipses" size={28} color="#8B5CF6" />
              </View>
              <View style={styles.feedbackSectionInfo}>
                <Text style={[styles.feedbackSectionTitle, { color: colors.text }]}>
                  {stats.pendingFeedback} Pending
                </Text>
                <Text style={[styles.feedbackSectionSubtitle, { color: colors.textSecondary }]}>
                  User feedback awaiting review
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.viewFeedbackButton, { backgroundColor: '#8B5CF6' }]}
              onPress={handleViewFeedback}
              activeOpacity={0.8}
            >
              <Ionicons name="eye" size={18} color="#FFFFFF" />
              <Text style={styles.viewFeedbackButtonText}>View All Feedbacks</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.bottomSpacer} />

      {/* ==================== FEEDBACK MODAL (Admin Only) ==================== */}
      <Modal visible={showFeedbackModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="chatbox-ellipses" size={24} color="#8B5CF6" />
                <Text style={[styles.modalTitle, { color: colors.text }]}>User Feedbacks</Text>
              </View>
              <TouchableOpacity onPress={() => setShowFeedbackModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {feedbackLoading ? (
              <View style={styles.feedbackLoadingContainer}>
                <ActivityIndicator size="large" color="#8B5CF6" />
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
                          <Ionicons name="person-circle" size={32} color="#8B5CF6" />
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

      {/* Alert Detail Modal */}
      <Modal
        visible={showAlertModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAlertModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <Ionicons 
                  name={selectedAlert?.alert_type === 'disease_outbreak' ? 'bug' : 
                        selectedAlert?.alert_type === 'water_contamination' ? 'water' : 'warning'} 
                  size={24} 
                  color={getUrgencyColor(selectedAlert?.urgency_level || 'medium')} 
                />
                <Text style={[styles.modalTitle, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                  {selectedAlert?.title}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowAlertModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Urgency Badge */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <View style={[styles.urgencyBadge, { backgroundColor: getUrgencyColor(selectedAlert?.urgency_level || 'medium') + '20' }]}>
                  <Text style={[styles.urgencyText, { color: getUrgencyColor(selectedAlert?.urgency_level || 'medium') }]}>
                    {selectedAlert?.urgency_level?.toUpperCase()}
                  </Text>
                </View>
                <View style={[styles.urgencyBadge, { backgroundColor: colors.info + '20' }]}>
                  <Text style={[styles.urgencyText, { color: colors.info }]}>
                    {selectedAlert?.status?.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Description */}
              <View style={styles.alertDetailSection}>
                <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Description</Text>
                <Text style={[styles.alertDetailText, { color: colors.text }]}>
                  {selectedAlert?.description}
                </Text>
              </View>

              {/* Location */}
              <View style={styles.alertDetailSection}>
                <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Location</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="location" size={16} color={colors.primary} />
                  <Text style={[styles.alertDetailText, { color: colors.text }]}>
                    {selectedAlert?.location_name}
                    {selectedAlert?.district && `, ${selectedAlert.district}`}
                    {selectedAlert?.state && `, ${selectedAlert.state}`}
                  </Text>
                </View>
              </View>

              {/* Disease/Issue */}
              {selectedAlert?.disease_or_issue && (
                <View style={styles.alertDetailSection}>
                  <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Disease/Issue</Text>
                  <Text style={[styles.alertDetailText, { color: colors.text }]}>
                    {selectedAlert.disease_or_issue}
                  </Text>
                </View>
              )}

              {/* Statistics Row */}
              {(selectedAlert?.affected_population || selectedAlert?.cases_reported) && (
                <View style={[styles.alertDetailSection, { flexDirection: 'row', gap: 20 }]}>
                  {selectedAlert?.affected_population && (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Affected Population</Text>
                      <Text style={[styles.alertStatNumber, { color: colors.warning }]}>
                        {selectedAlert.affected_population.toLocaleString()}
                      </Text>
                    </View>
                  )}
                  {selectedAlert?.cases_reported && (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Cases Reported</Text>
                      <Text style={[styles.alertStatNumber, { color: colors.error }]}>
                        {selectedAlert.cases_reported.toLocaleString()}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Symptoms to Watch */}
              {selectedAlert?.symptoms_to_watch && (
                <View style={styles.alertDetailSection}>
                  <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>
                    <Ionicons name="medkit" size={14} color={colors.warning} /> Symptoms to Watch
                  </Text>
                  <Text style={[styles.alertDetailText, { color: colors.text }]}>
                    {selectedAlert.symptoms_to_watch}
                  </Text>
                </View>
              )}

              {/* Immediate Actions */}
              {selectedAlert?.immediate_actions && (
                <View style={styles.alertDetailSection}>
                  <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>
                    <Ionicons name="flash" size={14} color={colors.error} /> Immediate Actions
                  </Text>
                  <Text style={[styles.alertDetailText, { color: colors.text }]}>
                    {selectedAlert.immediate_actions}
                  </Text>
                </View>
              )}

              {/* Precautionary Measures */}
              {selectedAlert?.precautionary_measures && (
                <View style={styles.alertDetailSection}>
                  <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>
                    <Ionicons name="shield-checkmark" size={14} color={colors.success} /> Precautionary Measures
                  </Text>
                  <Text style={[styles.alertDetailText, { color: colors.text }]}>
                    {selectedAlert.precautionary_measures}
                  </Text>
                </View>
              )}

              {/* Contact Information */}
              {(selectedAlert?.contact_person || selectedAlert?.contact_phone) && (
                <View style={styles.alertDetailSection}>
                  <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Contact Information</Text>
                  {selectedAlert?.contact_person && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Ionicons name="person" size={16} color={colors.primary} />
                      <Text style={[styles.alertDetailText, { color: colors.text }]}>
                        {selectedAlert.contact_person}
                      </Text>
                    </View>
                  )}
                  {selectedAlert?.contact_phone && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="call" size={16} color={colors.success} />
                      <Text style={[styles.alertDetailText, { color: colors.text }]}>
                        {selectedAlert.contact_phone}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Created Date */}
              <View style={[styles.alertDetailSection, { marginTop: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="calendar" size={16} color={colors.textSecondary} />
                  <Text style={[styles.alertDetailText, { color: colors.textSecondary }]}>
                    Created: {selectedAlert?.created_at ? format(new Date(selectedAlert.created_at), 'MMMM d, yyyy h:mm a') : 'Unknown'}
                  </Text>
                </View>
              </View>
            </ScrollView>

            {/* Close Button */}
            <TouchableOpacity
              style={[styles.alertCloseButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowAlertModal(false)}
            >
              <Text style={styles.alertCloseButtonText}>Close</Text>
            </TouchableOpacity>
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
  header: {
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    overflow: 'hidden',
  },
  headerContent: {
    zIndex: 1,
  },
  headerPattern: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.1)',
    transform: [{ translateX: 50 }, { translateY: -50 }],
  },
  greeting: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 4,
  },
  userName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  section: {
    padding: 20,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionCard: {
    width: (width - 52) / 2,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  quickActionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Volunteer Info Card Styles
  volunteerInfoCard: {
    flexDirection: 'row',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  volunteerIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  volunteerInfoContent: {
    flex: 1,
  },
  volunteerInfoTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  volunteerInfoText: {
    fontSize: 14,
    lineHeight: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: (width - 52) / 2,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  // Feedback Section Styles (Admin)
  feedbackSectionCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  feedbackSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  feedbackIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  feedbackSectionInfo: {
    flex: 1,
  },
  feedbackSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  feedbackSectionSubtitle: {
    fontSize: 14,
  },
  viewFeedbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  viewFeedbackButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Activity Card
  activityCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  activityDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  activityButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
  },
  activityButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  noticeCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  noticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 20,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
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
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  feedbackLoadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyFeedback: {
    padding: 40,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  feedbackScroll: {
    maxHeight: 500,
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
    gap: 12,
  },
  feedbackUserName: {
    fontSize: 16,
    fontWeight: '600',
  },
  feedbackEmail: {
    fontSize: 12,
  },
  feedbackStatus: {
    paddingHorizontal: 10,
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
    marginBottom: 12,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Admin Tools Styles
  adminToolCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  adminToolContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminToolIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminToolInfo: {
    flex: 1,
    marginLeft: 16,
  },
  adminToolTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  adminToolSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Alert Section Styles
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  alertsList: {
    gap: 12,
  },
  alertCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  alertIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertTitleSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  urgencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  urgencyText: {
    fontSize: 10,
    fontWeight: '700',
  },
  alertDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  alertFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  alertLocationText: {
    fontSize: 12,
    flex: 1,
  },
  alertTime: {
    fontSize: 11,
  },
  emptyAlertCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyAlertTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyAlertSubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  alertDetailSection: {
    marginBottom: 16,
  },
  alertDetailLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  alertDetailText: {
    fontSize: 15,
    lineHeight: 22,
  },
  alertStatNumber: {
    fontSize: 24,
    fontWeight: '700',
  },
  alertCloseButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  alertCloseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default DashboardScreen;
