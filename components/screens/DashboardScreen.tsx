// =====================================================
// DASHBOARD SCREEN - Main Home Screen ("Prakash" design)
// Flat headerBg band + Role Ribbon, Big Number stats,
// eyebrow sections, 4-state data regions.
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
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format, isValid } from 'date-fns';
import { AIInsightsPanel } from '../ai/AIInsightsPanel';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';
import {
  DashboardHeader,
  Section,
  StatCard,
  QuickActionBtn,
  ToolCard,
  SkeletonBlock,
  ErrorCard,
  EmptyState,
  getSeverityColor,
} from '../dashboards/DashboardShared';

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

const formatShortDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

const DashboardScreen: React.FC<DashboardScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const isMountedRef = React.useRef(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    diseaseReports: 0,
    waterReports: 0,
    campaigns: 0,
    criticalAlerts: 0,
    pendingFeedback: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Alerts state
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<HealthAlert | null>(null);
  const [showAlertModal, setShowAlertModal] = useState(false);

  // Feedback state (for admin)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    loadStats();
    loadAlerts();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAlerts = async () => {
    setAlertsError(null);
    try {
      const { data, error } = await supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(80);

      if (!isMountedRef.current) return;

      if (error) {
        console.error('[DashboardScreen.loadAlerts] Alerts query failed', { error, role: profile.role });
        setAlertsError("Couldn't load alerts — check connection");
      } else if (data) {
        setAlerts(filterAlertsForProfile(data, profile).slice(0, 5));
      }
    } catch (error) {
      console.error('[DashboardScreen.loadAlerts] Alerts loading failed', {
        error,
        role: profile.role,
      });
      if (isMountedRef.current) setAlertsError("Couldn't load alerts — check connection");
    } finally {
      if (isMountedRef.current) setAlertsLoading(false);
    }
  };

  const loadStats = async () => {
    setStatsError(null);
    try {
      const [diseaseRes, waterRes, campaignsRes, alertsRes] = await Promise.allSettled([
        supabase.from('disease_reports').select('id', { count: 'exact', head: true }),
        supabase.from('water_quality_reports').select('id', { count: 'exact', head: true }),
        supabase.from('health_campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('health_alerts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      ]);

      let hasQueryError = false;

      const getSafeCount = (label: string, result: PromiseSettledResult<any>): number => {
        if (result.status === 'rejected') {
          console.error(`[DashboardScreen.loadStats] ${label} query rejected`, { error: result.reason });
          hasQueryError = true;
          return 0;
        }

        if (result.value?.error) {
          console.error(`[DashboardScreen.loadStats] ${label} query failed`, { error: result.value.error });
          hasQueryError = true;
          return 0;
        }

        const count = result.value?.count;
        return typeof count === 'number' && Number.isFinite(count) ? count : 0;
      };

      let pendingFeedbackCount = 0;
      // Super Admin + Health Admin get feedback count
      if (profile.role === 'super_admin' || profile.role === 'health_admin') {
        const feedbackRes = await supabase
          .from('user_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');

        if (feedbackRes.error) {
          console.error('[DashboardScreen.loadStats] pending feedback query failed', { error: feedbackRes.error });
        } else {
          pendingFeedbackCount =
            typeof feedbackRes.count === 'number' && Number.isFinite(feedbackRes.count)
              ? feedbackRes.count
              : 0;
        }
      }

      if (!isMountedRef.current) return;

      setStats({
        diseaseReports: getSafeCount('disease_reports', diseaseRes),
        waterReports: getSafeCount('water_quality_reports', waterRes),
        campaigns: getSafeCount('health_campaigns', campaignsRes),
        criticalAlerts: getSafeCount('health_alerts', alertsRes),
        pendingFeedback: pendingFeedbackCount,
      });

      if (hasQueryError) {
        setStatsError("Couldn't load overview — check connection");
      }
    } catch (error) {
      console.log('Stats loading - tables may not exist yet');
      if (isMountedRef.current) setStatsError("Couldn't load overview — check connection");
    } finally {
      if (isMountedRef.current) setStatsLoading(false);
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
      await Promise.all([loadFeedback(), loadStats()]);
    } catch (error) {
      console.error('Error updating feedback:', error);
      Alert.alert('Update failed', 'Unable to update feedback status. Please try again.');
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

  // Soft background for a severity pill — solid fill is CRITICAL's privilege alone.
  const severitySoftBg = (level: string): string => {
    switch (level?.toLowerCase()) {
      case 'critical': return colors.dangerBg;
      case 'high': return colors.offlineBg;
      case 'medium': return colors.warningBg;
      case 'low': return colors.successBg;
      default: return colors.surfaceVariant;
    }
  };

  const SeverityPill: React.FC<{ level: string }> = ({ level }) => {
    const key = level?.toLowerCase() ?? '';
    const isCritical = key === 'critical';
    const fg = isCritical ? colors.textInverse : getSeverityColor(key, colors);
    const bg = isCritical ? colors.danger : severitySoftBg(key);
    return (
      <View style={[styles.severityPill, { backgroundColor: bg }]} accessibilityLabel={`Urgency: ${key || 'unknown'}`}>
        {!isCritical && <View style={[styles.severityDot, { backgroundColor: fg }]} />}
        <Text style={[styles.severityPillText, { color: fg }]} maxFontSizeMultiplier={1.3}>
          {(level ?? '').toUpperCase()}
        </Text>
      </View>
    );
  };

  // Role-based quick actions
  // Admin & District Officer: Disease, Water, Campaign, Alert (alerts admin/DO only)
  // Clinic: Disease + Water
  // ASHA Worker: Disease, Water, Campaign (submit)
  // Volunteer: NO quick actions (can only view and enroll in campaigns)
  const getAllQuickActions = () => {
    const allActions = [
      { id: 'disease', icon: 'medkit-outline', label: 'Report Disease', color: colors.danger, screen: 'new-disease-report', roles: ['super_admin', 'health_admin', 'clinic', 'district_officer', 'asha_worker'] },
      { id: 'water', icon: 'water-outline', label: 'Water Quality', color: colors.info, screen: 'new-water-report', roles: ['super_admin', 'health_admin', 'clinic', 'district_officer', 'asha_worker'] },
      { id: 'campaign', icon: 'megaphone-outline', label: 'New Campaign', color: colors.success, screen: 'new-campaign', roles: ['super_admin', 'health_admin', 'district_officer', 'asha_worker'] },
      { id: 'alert', icon: 'alert-circle-outline', label: 'Send Alert', color: colors.warning, screen: 'new-alert', roles: ['super_admin', 'health_admin', 'district_officer'] },
    ];

    // Volunteers don't get any quick actions - they can only view and enroll
    return allActions.filter(action => action.roles.includes(profile.role));
  };

  const quickActions = getAllQuickActions();
  const isVolunteer = profile.role === 'volunteer';

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'bug': return { name: 'bug-outline', color: colors.error };
      case 'feature': return { name: 'bulb-outline', color: colors.warning };
      case 'improvement': return { name: 'trending-up-outline', color: colors.secondary };
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

  const getFeedbackStatusBg = (status: string) => {
    switch (status) {
      case 'pending': return colors.warningBg;
      case 'reviewed': return colors.infoBg;
      case 'resolved': return colors.successBg;
      default: return colors.surfaceVariant;
    }
  };

  const statCards = [
    { label: 'Disease Reports', value: stats.diseaseReports, icon: 'bar-chart-outline', color: colors.danger },
    { label: 'Water Reports', value: stats.waterReports, icon: 'water-outline', color: colors.info },
    { label: 'Active Campaigns', value: stats.campaigns, icon: 'megaphone-outline', color: colors.success },
    { label: 'Critical Alerts', value: stats.criticalAlerts, icon: 'warning-outline', color: colors.warning },
  ];

  // Two stat cards per row — never three on phones.
  const statRows: (typeof statCards)[] = [];
  for (let i = 0; i < statCards.length; i += 2) {
    statRows.push(statCards.slice(i, i + 2));
  }
  const quickActionRows: (typeof quickActions)[] = [];
  for (let i = 0; i < quickActions.length; i += 2) {
    quickActionRows.push(quickActions.slice(i, i + 2));
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header — flat headerBg band + Role Ribbon */}
      <DashboardHeader profile={profile} />

      <View style={{ height: spacing.lg }} />

      {/* Quick Actions - Only show if user has actions available */}
      {quickActions.length > 0 && (
        <Section title="Quick Actions">
          <View style={styles.gridColumn}>
            {quickActionRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {row.map((action) => (
                  <QuickActionBtn
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    color={action.color}
                    onPress={() => onNavigateToForm(action.screen)}
                  />
                ))}
                {row.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Volunteer Info Card - Show helpful info for volunteers */}
      {isVolunteer && (
        <Section>
          <View style={[styles.volunteerInfoCard, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}>
            <View style={[styles.volunteerIconContainer, { backgroundColor: colors.success + '14' }]}>
              <Ionicons name="heart-outline" size={24} color={colors.success} />
            </View>
            <View style={styles.volunteerInfoContent}>
              <Text style={[styles.volunteerInfoTitle, { color: colors.text }]}>Welcome, Volunteer!</Text>
              <Text style={[styles.volunteerInfoText, { color: colors.textSecondary }]}>
                You can view reports, alerts, and enroll in health campaigns. Check the Campaigns tab to participate!
              </Text>
            </View>
          </View>
        </Section>
      )}

      {/* ==================== ADMIN TOOLS SECTION ==================== */}
      {(profile.role === 'super_admin' || profile.role === 'health_admin') && (
        <Section title="Admin Tools">
          <ToolCard
            icon="shield-checkmark-outline"
            iconColor={colors.primary}
            title={profile.role === 'super_admin' ? 'Super Admin Panel' : 'Health Admin Panel'}
            subtitle={profile.role === 'super_admin'
              ? 'Manage users, reports, campaigns & analytics'
              : 'Approve reports, campaigns, alerts & analytics'}
            onPress={() => onNavigateToForm('admin-management')}
          />
        </Section>
      )}

      {/* ==================== CLINIC APPROVAL SECTION ==================== */}
      {profile.role === 'clinic' && (
        <Section title="Clinic Tools">
          <ToolCard
            icon="checkmark-circle-outline"
            iconColor={colors.secondary}
            title="Report Approval"
            subtitle="Review & approve pending ASHA worker reports"
            onPress={() => onNavigateToForm('admin-management')}
          />
        </Section>
      )}

      {/* Stats Overview — Big Number Protocol, 4-state region */}
      <Section title="Overview">
        {statsLoading ? (
          <View style={styles.gridColumn} accessibilityElementsHidden>
            {[0, 1].map((row) => (
              <View key={row} style={styles.gridRow}>
                <SkeletonBlock height={122} radius={radii.md} style={{ flex: 1 }} />
                <SkeletonBlock height={122} radius={radii.md} style={{ flex: 1 }} />
              </View>
            ))}
          </View>
        ) : statsError ? (
          <ErrorCard message={statsError} onRetry={loadStats} />
        ) : (
          <View style={styles.gridColumn}>
            {statRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {row.map((stat, index) => (
                  <StatCard
                    key={index}
                    label={stat.label}
                    value={stat.value}
                    icon={stat.icon}
                    color={stat.color}
                  />
                ))}
                {row.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
          </View>
        )}
      </Section>

      {/* ==================== AI HEALTH INSIGHTS ==================== */}
      <AIInsightsPanel profile={profile} />

      {/* ==================== HEALTH ALERTS SECTION ==================== */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]} numberOfLines={1}>
            ACTIVE ALERTS
            <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${alerts.length}`}</Text>
          </Text>
          <View style={styles.sectionActions}>
            <TouchableOpacity
              onPress={() => onNavigateToForm('all-alerts')}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="View all alerts"
            >
              <Text style={[styles.sectionActionText, { color: isDark ? colors.primary : colors.primaryDark }]}>View All</Text>
            </TouchableOpacity>
            {(profile.role === 'super_admin' || profile.role === 'health_admin' || profile.role === 'district_officer') && (
              <TouchableOpacity
                onPress={() => onNavigateToForm('new-alert')}
                hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Create new alert"
              >
                <Text style={[styles.sectionActionText, { color: isDark ? colors.primary : colors.primaryDark }]}>+ New Alert</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {alertsLoading ? (
          <View style={{ gap: spacing.md }} accessibilityElementsHidden>
            <SkeletonBlock height={96} radius={radii.md} />
            <SkeletonBlock height={96} radius={radii.md} />
          </View>
        ) : alertsError ? (
          <ErrorCard message={alertsError} onRetry={loadAlerts} />
        ) : alerts.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            color={colors.success}
            title="All clear — no active alerts right now."
          />
        ) : (
          <View style={styles.alertsList}>
            {alerts.map((alert) => (
              <Pressable
                key={alert.id}
                style={({ pressed }) => [
                  styles.alertCard,
                  {
                    backgroundColor: pressed ? colors.cardHover : colors.card,
                    borderColor: colors.border,
                    borderLeftColor: getSeverityColor(alert.urgency_level, colors),
                  },
                  !isDark && styles.cardShadow,
                ]}
                onPress={() => {
                  setSelectedAlert(alert);
                  setShowAlertModal(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Alert, urgency ${alert.urgency_level}: ${alert.title}`}
              >
                <View style={styles.alertHeader}>
                  <SeverityPill level={alert.urgency_level} />
                  <Text style={[styles.alertTime, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    {formatShortDateTime(alert.created_at)}
                  </Text>
                </View>
                <Text style={[styles.alertTitle, { color: colors.text }]} numberOfLines={2}>
                  {alert.title}
                </Text>
                <Text style={[styles.alertDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                  {alert.description}
                </Text>
                <View style={styles.alertFooter}>
                  <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.alertLocationText, { color: colors.textSecondary }]} numberOfLines={1}>
                    {alert.location_name}, {alert.district}
                  </Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* ==================== ADMIN ONLY: User Feedbacks Section ==================== */}
      {(profile.role === 'super_admin' || profile.role === 'health_admin') && (
        <Section title="User Feedback" count={stats.pendingFeedback}>
          <View style={[styles.feedbackSectionCard, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && styles.cardShadow]}>
            <View style={styles.feedbackSectionHeader}>
              <View style={[styles.feedbackIconContainer, { backgroundColor: colors.primary + '14' }]}>
                <Ionicons name="chatbox-ellipses-outline" size={24} color={colors.primary} />
              </View>
              <View style={styles.feedbackSectionInfo}>
                <Text style={[styles.feedbackSectionTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {stats.pendingFeedback} Pending
                </Text>
                <Text style={[styles.feedbackSectionSubtitle, { color: colors.textSecondary }]}>
                  User feedback awaiting review
                </Text>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.viewFeedbackButton,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
              ]}
              onPress={handleViewFeedback}
              accessibilityRole="button"
              accessibilityLabel="View all feedback"
            >
              <Text style={[styles.viewFeedbackButtonText, { color: colors.onPrimary }]}>View All Feedback</Text>
            </Pressable>
          </View>
        </Section>
      )}

      <View style={styles.bottomSpacer} />

      {/* ==================== FEEDBACK MODAL (Admin Only) ==================== */}
      <Modal visible={showFeedbackModal} animationType={reduceMotion ? 'none' : 'slide'} transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="chatbox-ellipses-outline" size={24} color={colors.primary} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>User Feedback</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowFeedbackModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close feedback modal"
                accessibilityHint="Closes the user feedback details modal"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {feedbackLoading ? (
              <View style={styles.feedbackLoadingContainer} accessibilityElementsHidden>
                <SkeletonBlock height={96} radius={radii.md} />
                <SkeletonBlock height={96} radius={radii.md} />
                <SkeletonBlock height={96} radius={radii.md} width="70%" />
              </View>
            ) : feedbackList.length === 0 ? (
              <View style={styles.emptyFeedback}>
                <Ionicons name="checkmark-circle-outline" size={24} color={colors.success} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Inbox clear — no feedback yet.</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                  User feedback will appear here
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.feedbackScroll} showsVerticalScrollIndicator={false}>
                {feedbackList.map((feedback) => {
                  const catIcon = getCategoryIcon(feedback.category);
                  const feedbackCreatedAt = new Date(feedback.created_at);
                  const feedbackCreatedAtLabel = isValid(feedbackCreatedAt)
                    ? format(feedbackCreatedAt, 'MMM d, yyyy h:mm a')
                    : 'Invalid date';
                  return (
                    <View
                      key={feedback.id}
                      style={[styles.feedbackCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    >
                      <View style={styles.feedbackHeader}>
                        <View style={styles.feedbackUser}>
                          <Ionicons name="person-circle-outline" size={32} color={colors.textSecondary} />
                          <View>
                            <Text style={[styles.feedbackUserName, { color: colors.text }]}>
                              {feedback.user_name || 'Anonymous'}
                            </Text>
                            <Text style={[styles.feedbackEmail, { color: colors.textSecondary }]}>
                              {feedback.user_email}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.feedbackStatus, { backgroundColor: getFeedbackStatusBg(feedback.status) }]}>
                          <View style={[styles.severityDot, { backgroundColor: getStatusColor(feedback.status) }]} />
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
                          <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                          <Text style={[styles.feedbackDateText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                            {feedbackCreatedAtLabel}
                          </Text>
                        </View>

                        {feedback.status === 'pending' && (
                          <View style={styles.feedbackActions}>
                            <TouchableOpacity
                              style={[styles.actionBtn, { backgroundColor: colors.infoBg }]}
                              onPress={() => updateFeedbackStatus(feedback.id, 'reviewed')}
                              accessibilityRole="button"
                              accessibilityLabel="Mark feedback as reviewed"
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                            >
                              <Ionicons name="eye-outline" size={16} color={colors.info} />
                              <Text style={[styles.actionBtnText, { color: colors.info }]}>Review</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.actionBtn, { backgroundColor: colors.successBg }]}
                              onPress={() => updateFeedbackStatus(feedback.id, 'resolved')}
                              accessibilityRole="button"
                              accessibilityLabel="Mark feedback as resolved"
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                            >
                              <Ionicons name="checkmark-outline" size={16} color={colors.success} />
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
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent={true}
        onRequestClose={() => setShowAlertModal(false)}
      >
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, maxHeight: '90%' }]}>
            {/* 3px severity top rule — never flood-fill a modal header */}
            <View style={[styles.modalTopRule, { backgroundColor: getSeverityColor(selectedAlert?.urgency_level || '', colors) }]} />
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                {selectedAlert?.title}
              </Text>
              <TouchableOpacity
                onPress={() => setShowAlertModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close alert details modal"
                accessibilityHint="Closes the health alert details modal"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} showsVerticalScrollIndicator={false}>
              {/* Urgency + status pills */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
                <SeverityPill level={selectedAlert?.urgency_level || ''} />
                <View style={[styles.statusPill, { backgroundColor: colors.infoBg }]}>
                  <View style={[styles.severityDot, { backgroundColor: colors.info }]} />
                  <Text style={[styles.severityPillText, { color: colors.info }]} maxFontSizeMultiplier={1.3}>
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
                  <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
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

              {/* Statistics Row — values in ink, tabular */}
              {(selectedAlert?.affected_population || selectedAlert?.cases_reported) && (
                <View style={[styles.alertDetailSection, { flexDirection: 'row', gap: spacing.xl }]}>
                  {selectedAlert?.affected_population && (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Affected Population</Text>
                      <Text style={[styles.alertStatNumber, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {selectedAlert.affected_population.toLocaleString()}
                      </Text>
                    </View>
                  )}
                  {selectedAlert?.cases_reported && (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.alertDetailLabel, { color: colors.textSecondary }]}>Cases Reported</Text>
                      <Text style={[styles.alertStatNumber, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
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
                    <Ionicons name="medkit-outline" size={14} color={colors.warning} /> Symptoms to Watch
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
                    <Ionicons name="flash-outline" size={14} color={colors.danger} /> Immediate Actions
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
                    <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} /> Precautionary Measures
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
                      <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.alertDetailText, { color: colors.text }]}>
                        {selectedAlert.contact_person}
                      </Text>
                    </View>
                  )}
                  {selectedAlert?.contact_phone && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="call-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.alertDetailText, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
                        {selectedAlert.contact_phone}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Created Date */}
              <View style={[styles.alertDetailSection, { marginTop: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.alertDetailMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    Created: {selectedAlert?.created_at ? formatShortDateTime(selectedAlert.created_at) : 'Unknown'}
                  </Text>
                </View>
              </View>
            </ScrollView>

            {/* Close Button — One-Hand Action Bar */}
            <Pressable
              style={({ pressed }) => [
                styles.alertCloseButton,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
              ]}
              onPress={() => setShowAlertModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Close alert details"
            >
              <Text style={[styles.alertCloseButtonText, { color: colors.onPrimary }]}>Close</Text>
            </Pressable>
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
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
    minHeight: 20,
  },
  sectionEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  sectionActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  gridColumn: {
    gap: spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  // Volunteer Info Card Styles
  volunteerInfoCard: {
    flexDirection: 'row',
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  volunteerIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  volunteerInfoContent: {
    flex: 1,
  },
  volunteerInfoTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  volunteerInfoText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  // Feedback Section Styles (Admin)
  feedbackSectionCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  feedbackSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  feedbackIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  feedbackSectionInfo: {
    flex: 1,
  },
  feedbackSectionTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
  feedbackSectionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  viewFeedbackButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radii.md,
  },
  viewFeedbackButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: spacing.xl,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '85%',
    padding: spacing.lg,
    overflow: 'hidden',
  },
  modalTopRule: {
    height: 3,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    marginBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackLoadingContainer: {
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  emptyFeedback: {
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  feedbackScroll: {
    maxHeight: 500,
  },
  feedbackCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  feedbackUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  feedbackUserName: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  feedbackEmail: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  feedbackStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  feedbackStatusText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  feedbackCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  feedbackCategoryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  feedbackText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  feedbackFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  feedbackDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  feedbackDateText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  feedbackActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radii.sm,
    gap: 4,
  },
  actionBtnText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  // Alert Section Styles
  alertsList: {
    gap: spacing.md,
  },
  alertCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: spacing.lg,
    minHeight: 64,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  severityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  severityPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  alertTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  alertTime: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  alertDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  alertFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  alertLocationText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  alertDetailSection: {
    marginBottom: spacing.lg,
  },
  alertDetailLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  alertDetailText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  alertDetailMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  alertStatNumber: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  alertCloseButton: {
    marginTop: spacing.lg,
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCloseButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

export default DashboardScreen;
