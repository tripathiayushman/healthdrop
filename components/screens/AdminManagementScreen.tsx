// =====================================================
// ADMIN MANAGEMENT SCREEN - Comprehensive Admin Tools
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
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';

const { width, height } = Dimensions.get('window');

// ==================== INTERFACES ====================
interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  phone: string;
  district: string;
  state: string;
  created_at: string;
  is_active: boolean;
}

interface DiseaseReport {
  id: string;
  disease_name: string;
  disease_type: string;
  severity: string;
  cases_count: number;
  location_name: string;
  district: string;
  state: string;
  symptoms: string;
  age_group: string;
  gender: string;
  treatment_status: string;
  reporter_id: string;
  status: string;
  verified_by: string;
  verified_at: string;
  created_at: string;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
}

interface WaterReport {
  id: string;
  source_name: string;
  source_type: string;
  location_name: string;
  district: string;
  state: string;
  overall_quality: string;
  contamination_type: string;
  reporter_id: string;
  status: string;
  verified_by: string;
  verified_at: string;
  notes: string;
  created_at: string;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
}

interface Campaign {
  id: string;
  name: string;
  campaign_type: string;
  district: string;
  state: string;
  start_date: string;
  end_date: string;
  status: string;
  target_population: number;
  volunteers_needed: number;
  created_by: string;
  created_at: string;
  approval_status?: string;
  organizer_id?: string;
}

interface HealthAlert {
  id: string;
  title: string;
  description: string;
  alert_type: string;
  urgency_level: string;
  location_name: string;
  district: string;
  state: string;
  status: string;
  created_by: string;
  created_at: string;
  affected_population?: number;
  cases_reported?: number;
  disease_or_issue?: string;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
}

interface AdminManagementScreenProps {
  profile: Profile;
  onBack: () => void;
}

type TabType = 'users' | 'disease' | 'water' | 'campaigns' | 'alerts' | 'analytics';

const AdminManagementScreen: React.FC<AdminManagementScreenProps> = ({ profile, onBack }) => {
  const { colors } = useTheme();
  const isClinic = profile.role === 'clinic';
  const isSuperAdmin = profile.role === 'super_admin';
  const isHealthAdmin = profile.role === 'health_admin';
  // super_admin starts on users tab; health_admin + clinic start on disease tab
  const [activeTab, setActiveTab] = useState<TabType>(isSuperAdmin ? 'users' : 'disease');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Data states
  const [users, setUsers] = useState<User[]>([]);
  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports] = useState<WaterReport[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [healthAlerts, setHealthAlerts] = useState<HealthAlert[]>([]);

  // Modal states
  const [showUserModal, setShowUserModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedReport, setSelectedReport] = useState<DiseaseReport | WaterReport | null>(null);
  const [reportType, setReportType] = useState<'disease' | 'water'>('disease');

  // Confirmation Modal states (for web compatibility)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    type: 'danger' | 'warning';
  } | null>(null);

  // Stats
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalDiseaseReports: 0,
    pendingDiseaseReports: 0,
    totalWaterReports: 0,
    unsafeWaterSources: 0,
    activeCampaigns: 0,
    completedCampaigns: 0,
    pendingApprovals: 0,
  });

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadStats(),
        activeTab === 'users' && loadUsers(),
        activeTab === 'disease' && loadDiseaseReports(),
        activeTab === 'water' && loadWaterReports(),
        activeTab === 'campaigns' && loadCampaigns(),
        activeTab === 'alerts' && loadAlerts(),
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const [usersRes, diseaseRes, waterRes, campaignsRes] = await Promise.allSettled([
        supabase.from('profiles').select('id, is_active', { count: 'exact' }),
        supabase.from('disease_reports').select('id, status, approval_status', { count: 'exact' }),
        supabase.from('water_quality_reports').select('id, overall_quality, approval_status', { count: 'exact' }),
        supabase.from('health_campaigns').select('id, status, approval_status', { count: 'exact' }),
      ]);

      const usersData = usersRes.status === 'fulfilled' ? usersRes.value.data || [] : [];
      const diseaseData = diseaseRes.status === 'fulfilled' ? diseaseRes.value.data || [] : [];
      const waterData = waterRes.status === 'fulfilled' ? waterRes.value.data || [] : [];
      const campaignsData = campaignsRes.status === 'fulfilled' ? campaignsRes.value.data || [] : [];

      // Count pending approvals across all report types
      const pendingDiseaseApprovals = diseaseData.filter((r: any) => r.approval_status === 'pending_approval').length;
      const pendingWaterApprovals = waterData.filter((r: any) => r.approval_status === 'pending_approval').length;
      const pendingCampaignApprovals = campaignsData.filter((c: any) => c.approval_status === 'pending_approval').length;

      setStats({
        totalUsers: usersData.length,
        activeUsers: usersData.filter((u: any) => u.is_active !== false).length,
        totalDiseaseReports: diseaseData.length,
        pendingDiseaseReports: diseaseData.filter((r: any) => r.status === 'reported').length,
        totalWaterReports: waterData.length,
        unsafeWaterSources: waterData.filter((r: any) => r.overall_quality === 'unsafe' || r.overall_quality === 'critical').length,
        activeCampaigns: campaignsData.filter((c: any) => c.status === 'active' || c.status === 'upcoming').length,
        completedCampaigns: campaignsData.filter((c: any) => c.status === 'completed').length,
        pendingApprovals: pendingDiseaseApprovals + pendingWaterApprovals + pendingCampaignApprovals,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadDiseaseReports = async () => {
    try {
      const { data, error } = await supabase
        .from('disease_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDiseaseReports(data || []);
    } catch (error) {
      console.error('Error loading disease reports:', error);
    }
  };

  const loadWaterReports = async () => {
    try {
      const { data, error } = await supabase
        .from('water_quality_reports')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWaterReports(data || []);
    } catch (error) {
      console.error('Error loading water reports:', error);
    }
  };

  const loadCampaigns = async () => {
    try {
      const { data, error } = await supabase
        .from('health_campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCampaigns(data || []);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  };

  const loadAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('health_alerts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHealthAlerts(data || []);
    } catch (error) {
      console.error('Error loading alerts:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ==================== USER MANAGEMENT FUNCTIONS ====================
  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    // Only super_admin can change roles
    if (profile.role !== 'super_admin') {
      setConfirmAction({
        title: 'Permission Denied',
        message: 'Only Super Administrators can change user roles.',
        onConfirm: async () => setShowConfirmModal(false),
        type: 'warning',
      });
      setShowConfirmModal(true);
      return;
    }
    // Prevent super_admin from changing their own role away from super_admin
    if (userId === profile.id && newRole !== 'super_admin') {
      setConfirmAction({
        title: 'Warning',
        message: 'You cannot change your own role from super_admin. Ask another super admin to do this.',
        onConfirm: async () => setShowConfirmModal(false),
        type: 'warning',
      });
      setShowConfirmModal(true);
      return;
    }

    setConfirmAction({
      title: 'Change Role',
      message: `Are you sure you want to change this user's role to ${newRole}?`,
      type: 'warning',
      onConfirm: async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .update({ role: newRole, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select();

          if (error) {
            console.error('Update role error:', error);
            throw error;
          }
          
          setShowConfirmModal(false);
          loadUsers();
          setShowUserModal(false);
        } catch (error: any) {
          console.error('Role update failed:', error);
          setConfirmAction({
            title: 'Error',
            message: error.message || 'Failed to update role. Check RLS policies.',
            onConfirm: async () => setShowConfirmModal(false),
            type: 'danger',
          });
        }
      },
    });
    setShowConfirmModal(true);
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    // Prevent admin from deactivating themselves
    if (userId === profile.id) {
      setConfirmAction({
        title: 'Warning',
        message: 'You cannot deactivate your own account.',
        onConfirm: async () => setShowConfirmModal(false),
        type: 'warning',
      });
      setShowConfirmModal(true);
      return;
    }

    const newStatus = !currentStatus;
    setConfirmAction({
      title: newStatus ? 'Activate User' : 'Deactivate User',
      message: `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} this user?`,
      type: newStatus ? 'warning' : 'danger',
      onConfirm: async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .update({ is_active: newStatus, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select();

          if (error) {
            console.error('Toggle status error:', error);
            throw error;
          }
          
          setShowConfirmModal(false);
          loadUsers();
          setShowUserModal(false);
        } catch (error: any) {
          console.error('Status toggle failed:', error);
          setConfirmAction({
            title: 'Error',
            message: error.message || 'Failed to update status. Check RLS policies.',
            onConfirm: async () => setShowConfirmModal(false),
            type: 'danger',
          });
        }
      },
    });
    setShowConfirmModal(true);
  };

  const handleDeleteUser = async (userId: string) => {
    // Prevent admin from deleting themselves
    if (userId === profile.id) {
      setConfirmAction({
        title: 'Warning',
        message: 'You cannot delete your own account.',
        onConfirm: async () => setShowConfirmModal(false),
        type: 'warning',
      });
      setShowConfirmModal(true);
      return;
    }

    setConfirmAction({
      title: 'Delete User',
      message: 'Are you sure you want to permanently delete this user? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('id', userId);

          if (error) {
            console.error('Delete user error:', error);
            throw error;
          }
          
          setShowConfirmModal(false);
          loadUsers();
          setShowUserModal(false);
        } catch (error: any) {
          console.error('Delete failed:', error);
          setConfirmAction({
            title: 'Error',
            message: error.message || 'Failed to delete user. Check RLS policies.',
            onConfirm: async () => setShowConfirmModal(false),
            type: 'danger',
          });
        }
      },
    });
    setShowConfirmModal(true);
  };

  // ==================== REPORT MANAGEMENT FUNCTIONS ====================
  const handleVerifyReport = async (reportId: string, type: 'disease' | 'water') => {
    try {
      const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';
      const { error } = await supabase
        .from(table)
        .update({ status: 'verified', verified_by: profile.id, verified_at: new Date().toISOString() })
        .eq('id', reportId);

      if (error) throw error;
      Alert.alert('Success', 'Report verified successfully');
      type === 'disease' ? loadDiseaseReports() : loadWaterReports();
      setShowReportModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleDeleteReport = async (reportId: string, type: 'disease' | 'water') => {
    setConfirmAction({
      title: 'Delete Report',
      message: 'Are you sure you want to delete this report? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const table = type === 'disease' ? 'disease_reports' : 'water_quality_reports';
          const { error } = await supabase.from(table).delete().eq('id', reportId);

          if (error) throw error;
          setShowConfirmModal(false);
          type === 'disease' ? loadDiseaseReports() : loadWaterReports();
          setShowReportModal(false);
        } catch (error: any) {
          setConfirmAction({
            title: 'Error',
            message: error.message || 'Failed to delete report.',
            onConfirm: async () => setShowConfirmModal(false),
            type: 'danger',
          });
        }
      },
    });
    setShowConfirmModal(true);
  };

  // ==================== APPROVAL FUNCTIONS ====================
  const handleApproveReport = async (reportId: string, type: 'disease' | 'water' | 'campaign' | 'alert') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let table = '';
      switch (type) {
        case 'disease': table = 'disease_reports'; break;
        case 'water': table = 'water_quality_reports'; break;
        case 'campaign': table = 'health_campaigns'; break;
        case 'alert': table = 'health_alerts'; break;
      }

      const { error } = await supabase
        .from(table)
        .update({
          approval_status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) throw error;
      Alert.alert('Success', 'Report approved successfully');
      
      // Reload data
      if (type === 'disease') loadDiseaseReports();
      else if (type === 'water') loadWaterReports();
      else if (type === 'campaign') loadCampaigns();
      else if (type === 'alert') loadAlerts();
      
      setShowReportModal(false);
      loadStats();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleRejectReport = async (reportId: string, type: 'disease' | 'water' | 'campaign' | 'alert', reason?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let table = '';
      switch (type) {
        case 'disease': table = 'disease_reports'; break;
        case 'water': table = 'water_quality_reports'; break;
        case 'campaign': table = 'health_campaigns'; break;
        case 'alert': table = 'health_alerts'; break;
      }

      const { error } = await supabase
        .from(table)
        .update({
          approval_status: 'rejected',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          rejection_reason: reason || 'Rejected by admin',
        })
        .eq('id', reportId);

      if (error) throw error;
      Alert.alert('Success', 'Report rejected');
      
      // Reload data
      if (type === 'disease') loadDiseaseReports();
      else if (type === 'water') loadWaterReports();
      else if (type === 'campaign') loadCampaigns();
      else if (type === 'alert') loadAlerts();
      
      setShowReportModal(false);
      loadStats();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const getApprovalStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'approved': return '#10B981';
      case 'pending_approval': return '#F59E0B';
      case 'rejected': return '#EF4444';
      default: return colors.textSecondary;
    }
  };

  const getApprovalStatusLabel = (status: string | undefined) => {
    switch (status) {
      case 'approved': return 'Approved';
      case 'pending_approval': return 'Pending Approval';
      case 'rejected': return 'Rejected';
      default: return 'Unknown';
    }
  };

  // ==================== CAMPAIGN MANAGEMENT FUNCTIONS ====================
  const handleUpdateCampaignStatus = async (campaignId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('health_campaigns')
        .update({ status: newStatus })
        .eq('id', campaignId);

      if (error) throw error;
      Alert.alert('Success', 'Campaign status updated');
      loadCampaigns();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    setConfirmAction({
      title: 'Delete Campaign',
      message: 'Are you sure you want to delete this campaign? This action cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
        try {
          const { error } = await supabase.from('health_campaigns').delete().eq('id', campaignId);

          if (error) throw error;
          setShowConfirmModal(false);
          loadCampaigns();
        } catch (error: any) {
          setConfirmAction({
            title: 'Error',
            message: error.message || 'Failed to delete campaign.',
            onConfirm: async () => setShowConfirmModal(false),
            type: 'danger',
          });
        }
      },
    });
    setShowConfirmModal(true);
  };

  // ==================== HELPER FUNCTIONS ====================
  const isVerified = (report: DiseaseReport | WaterReport): boolean => {
    return report.status === 'verified';
  };

  const getRoleColor = (role: string) => {
    const roleColors: Record<string, string> = {
      admin: '#EF4444',
      clinic: '#3B82F6',
      asha_worker: '#10B981',
      volunteer: '#8B5CF6',
    };
    return roleColors[role] || colors.textSecondary;
  };

  const getRoleIcon = (role: string) => {
    const icons: Record<string, string> = {
      super_admin: 'shield-checkmark',
      health_admin: 'medkit',
      admin: 'shield-checkmark', // legacy fallback
      clinic: 'medical',
      asha_worker: 'heart',
      volunteer: 'hand-left',
      district_officer: 'business',
    };
    return icons[role] || 'person';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#EF4444';
      case 'severe': return '#F97316';
      case 'moderate': return '#F59E0B';
      case 'mild': return '#10B981';
      default: return colors.textSecondary;
    }
  };

  const getQualityColor = (status: string) => {
    switch (status) {
      case 'safe': return '#10B981';
      case 'moderate': return '#F59E0B';
      case 'unsafe': return '#F97316';
      case 'critical': return '#EF4444';
      default: return colors.textSecondary;
    }
  };

  const getCampaignStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#10B981';
      case 'upcoming': return '#3B82F6';
      case 'completed': return '#8B5CF6';
      case 'cancelled': return '#EF4444';
      default: return colors.textSecondary;
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.role?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDiseaseReports = diseaseReports.filter(
    (report) =>
      report.disease_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.location_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.district?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredWaterReports = waterReports.filter(
    (report) =>
      report.source_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.district?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCampaigns = campaigns.filter(
    (campaign) =>
      campaign.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      campaign.district?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ==================== TAB CONTENT RENDERERS ====================
  // Filter tabs based on role - Clinic only sees reports, not users/analytics
  const allTabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'users', label: 'Users', icon: 'people' },
    { id: 'disease', label: 'Disease', icon: 'medkit' },
    { id: 'water', label: 'Water', icon: 'water' },
    { id: 'campaigns', label: 'Campaigns', icon: 'megaphone' },
    { id: 'alerts', label: 'Alerts', icon: 'alert-circle' },
    { id: 'analytics', label: 'Analytics', icon: 'stats-chart' },
  ];
  
  const tabs = isSuperAdmin
    ? allTabs  // super_admin: full access including Users tab
    : isClinic
    ? allTabs.filter(tab => ['disease', 'water', 'campaigns', 'alerts'].includes(tab.id))
    : allTabs.filter(tab => ['disease', 'water', 'campaigns', 'alerts', 'analytics'].includes(tab.id));
    // health_admin + district_officer: content + analytics but NOT Users tab


  const filteredAlerts = healthAlerts.filter(
    (a) =>
      a.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.district?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.disease_or_issue?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ==================== RENDER USER ITEM ====================
  const renderUserItem = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => {
        setSelectedUser(item);
        setShowUserModal(true);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.itemHeader}>
        <View style={[styles.avatarCircle, { backgroundColor: getRoleColor(item.role) + '20' }]}>
          <Ionicons name={getRoleIcon(item.role) as any} size={24} color={getRoleColor(item.role)} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
            {item.full_name || 'No Name'}
          </Text>
          <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.email}
          </Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: getRoleColor(item.role) + '20' }]}>
          <Text style={[styles.roleBadgeText, { color: getRoleColor(item.role) }]}>
            {item.role?.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.phone || 'No phone'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.district ? `${item.district}, ${item.state}` : 'No location'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            Joined {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy') : 'Unknown'}
          </Text>
        </View>
      </View>
      {item.is_active === false && (
        <View style={[styles.inactiveBadge, { backgroundColor: colors.error + '20' }]}>
          <Ionicons name="close-circle" size={14} color={colors.error} />
          <Text style={[styles.inactiveBadgeText, { color: colors.error }]}>Inactive</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  // ==================== RENDER DISEASE REPORT ITEM ====================
  const renderDiseaseReportItem = ({ item }: { item: DiseaseReport }) => (
    <TouchableOpacity
      style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => {
        setSelectedReport(item);
        setReportType('disease');
        setShowReportModal(true);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.itemHeader}>
        <View style={[styles.avatarCircle, { backgroundColor: getSeverityColor(item.severity) + '20' }]}>
          <MaterialCommunityIcons name="virus" size={24} color={getSeverityColor(item.severity)} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
            {item.disease_name || 'Unknown Disease'}
          </Text>
          <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            Cases: {item.cases_count} | {item.disease_type}
          </Text>
        </View>
        <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(item.severity) + '20' }]}>
          <Text style={[styles.severityBadgeText, { color: getSeverityColor(item.severity) }]}>
            {item.severity?.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.age_group || 'All ages'}, {item.gender || 'All'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.location_name}, {item.district}, {item.state}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy h:mm a') : 'Unknown'}
          </Text>
        </View>
      </View>
      <View style={styles.itemFooter}>
        <View style={[styles.statusBadge, { backgroundColor: isVerified(item) ? colors.success + '20' : colors.warning + '20' }]}>
          <Ionicons 
            name={isVerified(item) ? 'checkmark-circle' : 'time'} 
            size={14} 
            color={isVerified(item) ? colors.success : colors.warning} 
          />
          <Text style={[styles.statusBadgeText, { color: isVerified(item) ? colors.success : colors.warning }]}>
            {isVerified(item) ? 'Verified' : 'Pending'}
          </Text>
        </View>
        <View style={[styles.treatmentBadge, { backgroundColor: colors.info + '20' }]}>
          <Text style={[styles.treatmentBadgeText, { color: colors.info }]}>
            {item.treatment_status?.replace('_', ' ').toUpperCase() || 'NOT SET'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // ==================== RENDER WATER REPORT ITEM ====================
  const renderWaterReportItem = ({ item }: { item: WaterReport }) => (
    <TouchableOpacity
      style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => {
        setSelectedReport(item);
        setReportType('water');
        setShowReportModal(true);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.itemHeader}>
        <View style={[styles.avatarCircle, { backgroundColor: getQualityColor(item.overall_quality) + '20' }]}>
          <Ionicons name="water" size={24} color={getQualityColor(item.overall_quality)} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
            {item.source_name || 'Unknown Source'}
          </Text>
          <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.source_type}
          </Text>
        </View>
        <View style={[styles.qualityBadge, { backgroundColor: getQualityColor(item.overall_quality) + '20' }]}>
          <Text style={[styles.qualityBadgeText, { color: getQualityColor(item.overall_quality) }]}>
            {item.overall_quality?.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Ionicons name="warning-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.contamination_type || 'Not specified'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.location_name}, {item.district}, {item.state}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy h:mm a') : 'Unknown'}
          </Text>
        </View>
      </View>
      <View style={styles.itemFooter}>
        <View style={[styles.statusBadge, { backgroundColor: isVerified(item) ? colors.success + '20' : colors.warning + '20' }]}>
          <Ionicons 
            name={isVerified(item) ? 'checkmark-circle' : 'time'} 
            size={14} 
            color={isVerified(item) ? colors.success : colors.warning} 
          />
          <Text style={[styles.statusBadgeText, { color: isVerified(item) ? colors.success : colors.warning }]}>
            {isVerified(item) ? 'Verified' : 'Pending'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // ==================== RENDER CAMPAIGN ITEM ====================
  const renderCampaignItem = ({ item }: { item: Campaign }) => (
    <View style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.itemHeader}>
        <View style={[styles.avatarCircle, { backgroundColor: getCampaignStatusColor(item.status) + '20' }]}>
          <Ionicons name="megaphone" size={24} color={getCampaignStatusColor(item.status)} />
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.campaign_type}
          </Text>
        </View>
        <View style={[styles.campaignStatusBadge, { backgroundColor: getCampaignStatusColor(item.status) + '20' }]}>
          <Text style={[styles.campaignStatusText, { color: getCampaignStatusColor(item.status) }]}>
            {item.status?.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.start_date ? format(new Date(item.start_date), 'MMM d') : 'TBD'} - {item.end_date ? format(new Date(item.end_date), 'MMM d, yyyy') : 'TBD'}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            Target: {item.target_population?.toLocaleString() || 0} | Volunteers: {item.volunteers_needed || 0}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.detailText, { color: colors.textSecondary }]}>
            {item.district}, {item.state}
          </Text>
        </View>
      </View>
      <View style={styles.campaignActions}>
        {item.status !== 'completed' && item.status !== 'cancelled' && (
          <>
            <TouchableOpacity
              style={[styles.campaignActionBtn, { backgroundColor: colors.success + '20' }]}
              onPress={() => handleUpdateCampaignStatus(item.id, 'completed')}
            >
              <Ionicons name="checkmark" size={16} color={colors.success} />
              <Text style={[styles.campaignActionText, { color: colors.success }]}>Complete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.campaignActionBtn, { backgroundColor: colors.warning + '20' }]}
              onPress={() => handleUpdateCampaignStatus(item.id, 'cancelled')}
            >
              <Ionicons name="close" size={16} color={colors.warning} />
              <Text style={[styles.campaignActionText, { color: colors.warning }]}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[styles.campaignActionBtn, { backgroundColor: colors.error + '20' }]}
          onPress={() => handleDeleteCampaign(item.id)}
        >
          <Ionicons name="trash" size={16} color={colors.error} />
          <Text style={[styles.campaignActionText, { color: colors.error }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ==================== RENDER ANALYTICS ====================
  const renderAnalytics = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.analyticsContainer}>
        {/* User Stats */}
        <View style={[styles.analyticsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.analyticsHeader}>
            <Ionicons name="people" size={24} color="#3B82F6" />
            <Text style={[styles.analyticsTitle, { color: colors.text }]}>User Statistics</Text>
          </View>
          <View style={styles.analyticsStats}>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#3B82F6' }]}>{stats.totalUsers}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Total Users</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#10B981' }]}>{stats.activeUsers}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Active</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#EF4444' }]}>{stats.totalUsers - stats.activeUsers}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Inactive</Text>
            </View>
          </View>
        </View>

        {/* Disease Report Stats */}
        <View style={[styles.analyticsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.analyticsHeader}>
            <MaterialCommunityIcons name="virus" size={24} color="#EF4444" />
            <Text style={[styles.analyticsTitle, { color: colors.text }]}>Disease Reports</Text>
          </View>
          <View style={styles.analyticsStats}>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#EF4444' }]}>{stats.totalDiseaseReports}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Total</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#F59E0B' }]}>{stats.pendingDiseaseReports}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Pending</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#10B981' }]}>{stats.totalDiseaseReports - stats.pendingDiseaseReports}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Verified</Text>
            </View>
          </View>
        </View>

        {/* Water Report Stats */}
        <View style={[styles.analyticsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.analyticsHeader}>
            <Ionicons name="water" size={24} color="#3B82F6" />
            <Text style={[styles.analyticsTitle, { color: colors.text }]}>Water Quality Reports</Text>
          </View>
          <View style={styles.analyticsStats}>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#3B82F6' }]}>{stats.totalWaterReports}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Total</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#10B981' }]}>{stats.totalWaterReports - stats.unsafeWaterSources}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Safe</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#EF4444' }]}>{stats.unsafeWaterSources}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Unsafe</Text>
            </View>
          </View>
        </View>

        {/* Campaign Stats */}
        <View style={[styles.analyticsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.analyticsHeader}>
            <Ionicons name="megaphone" size={24} color="#8B5CF6" />
            <Text style={[styles.analyticsTitle, { color: colors.text }]}>Campaigns</Text>
          </View>
          <View style={styles.analyticsStats}>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#8B5CF6' }]}>{stats.activeCampaigns + stats.completedCampaigns}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Total</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#10B981' }]}>{stats.activeCampaigns}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Active</Text>
            </View>
            <View style={styles.analyticsStat}>
              <Text style={[styles.analyticsValue, { color: '#3B82F6' }]}>{stats.completedCampaigns}</Text>
              <Text style={[styles.analyticsLabel, { color: colors.textSecondary }]}>Completed</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );

  // ==================== RENDER TAB CONTENT ====================
  const renderTabContent = () => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
        </View>
      );
    }

    switch (activeTab) {
      case 'users':
        return (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={renderUserItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No users found</Text>
              </View>
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
          />
        );
      case 'disease':
        return (
          <FlatList
            data={filteredDiseaseReports}
            keyExtractor={(item) => item.id}
            renderItem={renderDiseaseReportItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name="virus-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No disease reports found</Text>
              </View>
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
          />
        );
      case 'water':
        return (
          <FlatList
            data={filteredWaterReports}
            keyExtractor={(item) => item.id}
            renderItem={renderWaterReportItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="water-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No water reports found</Text>
              </View>
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
          />
        );
      case 'campaigns':
        return (
          <FlatList
            data={filteredCampaigns}
            keyExtractor={(item) => item.id}
            renderItem={renderCampaignItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="megaphone-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No campaigns found</Text>
              </View>
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
          />
        );
      case 'alerts':
        return (
          <FlatList
            data={filteredAlerts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const urgencyColors: Record<string, string> = {
                critical: '#DC2626', high: '#EA580C', medium: '#F59E0B', low: '#10B981',
              };
              const urgColor = urgencyColors[item.urgency_level] || colors.textSecondary;
              return (
                <View style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.itemHeader}>
                    <View style={[styles.avatarCircle, { backgroundColor: urgColor + '20' }]}>
                      <Ionicons name="alert-circle" size={24} color={urgColor} />
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[styles.itemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                        {item.alert_type?.replace(/_/g, ' ')} • {item.urgency_level?.toUpperCase()}
                      </Text>
                    </View>
                    <View style={[styles.severityBadge, { backgroundColor: getApprovalStatusColor(item.approval_status) + '20' }]}>
                      <Text style={[styles.severityBadgeText, { color: getApprovalStatusColor(item.approval_status) }]}>
                        {getApprovalStatusLabel(item.approval_status)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.itemDetails}>
                    <View style={styles.detailRow}>
                      <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        {item.location_name || 'N/A'}, {item.district || 'N/A'}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        {item.created_at ? format(new Date(item.created_at), 'MMM d, yyyy h:mm a') : 'Unknown'}
                      </Text>
                    </View>
                    {item.disease_or_issue && (
                      <View style={styles.detailRow}>
                        <Ionicons name="medkit-outline" size={14} color={colors.textSecondary} />
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                          {item.disease_or_issue}
                        </Text>
                      </View>
                    )}
                  </View>
                  {item.approval_status === 'pending_approval' && (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <TouchableOpacity
                        style={[styles.approveBtn, { backgroundColor: '#10B981' }]}
                        onPress={() => handleApproveReport(item.id, 'alert')}
                      >
                        <Ionicons name="checkmark" size={16} color="#FFF" />
                        <Text style={styles.approveBtnText}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.approveBtn, { backgroundColor: '#EF4444' }]}
                        onPress={() => handleRejectReport(item.id, 'alert')}
                      >
                        <Ionicons name="close" size={16} color="#FFF" />
                        <Text style={styles.approveBtnText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {item.approval_status === 'rejected' && item.rejection_reason && (
                    <View style={{ marginTop: 8, padding: 8, backgroundColor: '#FEE2E2', borderRadius: 8 }}>
                      <Text style={{ color: '#991B1B', fontSize: 12 }}>Reason: {item.rejection_reason}</Text>
                    </View>
                  )}
                </View>
              );
            }}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No alerts found</Text>
              </View>
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
          />
        );
      case 'analytics':
        return renderAnalytics();
      default:
        return null;
    }
  };

  const roles = [
    { value: 'super_admin', label: 'Super Administrator' },
    { value: 'health_admin', label: 'Health Administrator' },
    { value: 'clinic', label: 'Clinic Staff' },
    { value: 'asha_worker', label: 'ASHA Worker' },
    { value: 'volunteer', label: 'Volunteer' },
    { value: 'district_officer', label: 'District Officer' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>{isClinic ? 'Report Approval' : 'Admin Management'}</Text>
          <Text style={styles.headerSubtitle}>
            {isSuperAdmin
              ? 'Manage users, reports & campaigns'
              : isHealthAdmin
              ? 'Approve reports, campaigns & alerts'
              : 'Review & approve pending reports'}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tab,
                activeTab === tab.id && { borderBottomColor: colors.primary, borderBottomWidth: 3 },
              ]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Ionicons
                name={tab.icon as any}
                size={20}
                color={activeTab === tab.id ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: activeTab === tab.id ? colors.primary : colors.textSecondary },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Search Bar */}
      {activeTab !== 'analytics' && (
        <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={`Search ${activeTab}...`}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {renderTabContent()}
      </View>

      {/* ==================== USER DETAIL MODAL ==================== */}
      <Modal visible={showUserModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>User Details</Text>
              <TouchableOpacity onPress={() => setShowUserModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* User Info */}
                <View style={styles.modalUserHeader}>
                  <View style={[styles.modalAvatar, { backgroundColor: getRoleColor(selectedUser.role) + '20' }]}>
                    <Ionicons name={getRoleIcon(selectedUser.role) as any} size={40} color={getRoleColor(selectedUser.role)} />
                  </View>
                  <Text style={[styles.modalUserName, { color: colors.text }]}>{selectedUser.full_name || 'No Name'}</Text>
                  <Text style={[styles.modalUserEmail, { color: colors.textSecondary }]}>{selectedUser.email}</Text>
                </View>

                {/* User Details */}
                <View style={[styles.detailsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={styles.detailItem}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Phone</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{selectedUser.phone || 'Not set'}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedUser.district ? `${selectedUser.district}, ${selectedUser.state}` : 'Not set'}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Status</Text>
                    <Text style={[styles.detailValue, { color: selectedUser.is_active !== false ? colors.success : colors.error }]}>
                      {selectedUser.is_active !== false ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Joined</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {selectedUser.created_at ? format(new Date(selectedUser.created_at), 'MMMM d, yyyy') : 'Unknown'}
                    </Text>
                  </View>
                </View>

                {/* Change Role */}
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Change Role</Text>
                {selectedUser.id === profile.id && (
                  <View style={[styles.selfWarning, { backgroundColor: colors.warning + '20', borderColor: colors.warning }]}>
                    <Ionicons name="warning" size={16} color={colors.warning} />
                    <Text style={[styles.selfWarningText, { color: colors.warning }]}>
                      This is your account. Some actions are restricted.
                    </Text>
                  </View>
                )}
                <View style={styles.rolesGrid}>
                  {roles.map((role) => (
                    <TouchableOpacity
                      key={role.value}
                      style={[
                        styles.roleOption,
                        { 
                          backgroundColor: selectedUser.role === role.value ? getRoleColor(role.value) + '20' : colors.background,
                          borderColor: selectedUser.role === role.value ? getRoleColor(role.value) : colors.border,
                        },
                        // Disable non-admin roles for self
                        (selectedUser.id === profile.id && role.value !== 'admin') && { opacity: 0.5 },
                      ]}
                      onPress={() => handleUpdateUserRole(selectedUser.id, role.value)}
                      disabled={selectedUser.role === role.value || (selectedUser.id === profile.id && role.value !== 'admin')}
                    >
                      <Ionicons name={getRoleIcon(role.value) as any} size={20} color={getRoleColor(role.value)} />
                      <Text style={[styles.roleOptionText, { color: getRoleColor(role.value) }]}>{role.label}</Text>
                      {selectedUser.role === role.value && (
                        <Ionicons name="checkmark-circle" size={16} color={getRoleColor(role.value)} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Actions */}
                <View style={styles.modalActions}>
                  {selectedUser.id !== profile.id && (
                    <TouchableOpacity
                      style={[styles.modalActionBtn, { backgroundColor: selectedUser.is_active !== false ? colors.warning + '20' : colors.success + '20' }]}
                      onPress={() => handleToggleUserStatus(selectedUser.id, selectedUser.is_active !== false)}
                    >
                      <Ionicons 
                        name={selectedUser.is_active !== false ? 'pause-circle' : 'play-circle'} 
                        size={20} 
                        color={selectedUser.is_active !== false ? colors.warning : colors.success} 
                      />
                      <Text style={[styles.modalActionText, { color: selectedUser.is_active !== false ? colors.warning : colors.success }]}>
                        {selectedUser.is_active !== false ? 'Deactivate' : 'Activate'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {selectedUser.id !== profile.id && (
                    <TouchableOpacity
                      style={[styles.modalActionBtn, { backgroundColor: colors.error + '20' }]}
                      onPress={() => handleDeleteUser(selectedUser.id)}
                    >
                      <Ionicons name="trash" size={20} color={colors.error} />
                      <Text style={[styles.modalActionText, { color: colors.error }]}>Delete User</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== REPORT DETAIL MODAL ==================== */}
      <Modal visible={showReportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {reportType === 'disease' ? 'Disease Report' : 'Water Quality Report'}
              </Text>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedReport && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {reportType === 'disease' ? (
                  <>
                    {/* Disease Report Details */}
                    <View style={[styles.detailsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Disease</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{(selectedReport as DiseaseReport).disease_name}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Disease Type</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{(selectedReport as DiseaseReport).disease_type}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Cases Count</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as DiseaseReport).cases_count}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Severity</Text>
                        <Text style={[styles.detailValue, { color: getSeverityColor((selectedReport as DiseaseReport).severity) }]}>
                          {(selectedReport as DiseaseReport).severity?.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Age Group</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as DiseaseReport).age_group || 'Not specified'}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Symptoms</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as DiseaseReport).symptoms || 'Not specified'}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Treatment Status</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as DiseaseReport).treatment_status?.replace('_', ' ') || 'Not set'}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as DiseaseReport).location_name}, {(selectedReport as DiseaseReport).district}, {(selectedReport as DiseaseReport).state}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Reported On</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {selectedReport.created_at ? format(new Date(selectedReport.created_at), 'MMMM d, yyyy h:mm a') : 'Unknown'}
                        </Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    {/* Water Report Details */}
                    <View style={[styles.detailsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Source Name</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{(selectedReport as WaterReport).source_name}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Source Type</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>{(selectedReport as WaterReport).source_type}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Quality Status</Text>
                        <Text style={[styles.detailValue, { color: getQualityColor((selectedReport as WaterReport).overall_quality) }]}>
                          {(selectedReport as WaterReport).overall_quality?.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Contamination</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as WaterReport).contamination_type || 'Not specified'}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as WaterReport).location_name}, {(selectedReport as WaterReport).district}, {(selectedReport as WaterReport).state}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Notes</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {(selectedReport as WaterReport).notes || 'No notes'}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Reported On</Text>
                        <Text style={[styles.detailValue, { color: colors.text }]}>
                          {selectedReport.created_at ? format(new Date(selectedReport.created_at), 'MMMM d, yyyy h:mm a') : 'Unknown'}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                {/* Approval Status */}
                <View style={[styles.verificationCard, { 
                  backgroundColor: getApprovalStatusColor(selectedReport.approval_status) + '10',
                  borderColor: getApprovalStatusColor(selectedReport.approval_status),
                }]}>
                  <Ionicons 
                    name={selectedReport.approval_status === 'approved' ? 'checkmark-circle' : 
                          selectedReport.approval_status === 'rejected' ? 'close-circle' : 'time'} 
                    size={24} 
                    color={getApprovalStatusColor(selectedReport.approval_status)} 
                  />
                  <Text style={[styles.verificationText, { color: getApprovalStatusColor(selectedReport.approval_status) }]}>
                    {getApprovalStatusLabel(selectedReport.approval_status)}
                  </Text>
                </View>

                {/* Verification Status (Legacy) */}
                <View style={[styles.verificationCard, { 
                  backgroundColor: isVerified(selectedReport) ? colors.success + '10' : colors.warning + '10',
                  borderColor: isVerified(selectedReport) ? colors.success : colors.warning,
                }]}>
                  <Ionicons 
                    name={isVerified(selectedReport) ? 'checkmark-circle' : 'time'} 
                    size={24} 
                    color={isVerified(selectedReport) ? colors.success : colors.warning} 
                  />
                  <Text style={[styles.verificationText, { color: isVerified(selectedReport) ? colors.success : colors.warning }]}>
                    {isVerified(selectedReport) ? 'This report has been verified' : 'This report is pending verification'}
                  </Text>
                </View>

                {/* Actions */}
                <View style={styles.modalActions}>
                  {/* Approval Actions - Show if pending */}
                  {selectedReport.approval_status === 'pending_approval' && (
                    <>
                      <TouchableOpacity
                        style={[styles.modalActionBtn, { backgroundColor: '#10B981' + '20' }]}
                        onPress={() => handleApproveReport(selectedReport.id, reportType)}
                      >
                        <Ionicons name="checkmark-done-circle" size={20} color="#10B981" />
                        <Text style={[styles.modalActionText, { color: '#10B981' }]}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalActionBtn, { backgroundColor: '#F59E0B' + '20' }]}
                        onPress={() => handleRejectReport(selectedReport.id, reportType)}
                      >
                        <Ionicons name="close-circle" size={20} color="#F59E0B" />
                        <Text style={[styles.modalActionText, { color: '#F59E0B' }]}>Reject</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {!isVerified(selectedReport) && (
                    <TouchableOpacity
                      style={[styles.modalActionBtn, { backgroundColor: colors.success + '20' }]}
                      onPress={() => handleVerifyReport(selectedReport.id, reportType)}
                    >
                      <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                      <Text style={[styles.modalActionText, { color: colors.success }]}>Verify Report</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.modalActionBtn, { backgroundColor: colors.error + '20' }]}
                    onPress={() => handleDeleteReport(selectedReport.id, reportType)}
                  >
                    <Ionicons name="trash" size={20} color={colors.error} />
                    <Text style={[styles.modalActionText, { color: colors.error }]}>Delete Report</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ==================== CONFIRMATION MODAL (Web Compatible) ==================== */}
      <Modal visible={showConfirmModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmModalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.confirmIconContainer, { 
              backgroundColor: confirmAction?.type === 'danger' ? colors.error + '20' : colors.warning + '20' 
            }]}>
              <Ionicons 
                name={confirmAction?.type === 'danger' ? 'warning' : 'alert-circle'} 
                size={40} 
                color={confirmAction?.type === 'danger' ? colors.error : colors.warning} 
              />
            </View>
            <Text style={[styles.confirmTitle, { color: colors.text }]}>
              {confirmAction?.title || 'Confirm'}
            </Text>
            <Text style={[styles.confirmMessage, { color: colors.textSecondary }]}>
              {confirmAction?.message || 'Are you sure?'}
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.border }]}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={[styles.confirmBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { 
                  backgroundColor: confirmAction?.type === 'danger' ? colors.error : colors.warning 
                }]}
                onPress={confirmAction?.onConfirm}
              >
                <Text style={[styles.confirmBtnText, { color: '#FFFFFF' }]}>
                  {confirmAction?.title === 'Warning' || confirmAction?.title === 'Error' ? 'OK' : 'Confirm'}
                </Text>
              </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 8,
  },
  headerContent: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  refreshButton: {
    padding: 8,
  },
  tabsContainer: {
    borderBottomWidth: 1,
  },
  tabsScroll: {
    paddingHorizontal: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  content: {
    flex: 1,
  },
  listContainer: {
    padding: 16,
    paddingTop: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
  },
  // Item Card Styles
  itemCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  itemSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  severityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  qualityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  qualityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  campaignStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  campaignStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  itemDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  treatmentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  treatmentBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  inactiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    top: 16,
    right: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  campaignActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  campaignActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  campaignActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Analytics Styles
  analyticsContainer: {
    padding: 16,
  },
  analyticsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  analyticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  analyticsTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  analyticsStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  analyticsStat: {
    alignItems: 'center',
  },
  analyticsValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  analyticsLabel: {
    fontSize: 12,
    marginTop: 4,
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
    maxHeight: height * 0.85,
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
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalUserHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalUserName: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalUserEmail: {
    fontSize: 14,
    marginTop: 4,
  },
  detailsCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  selfWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
  },
  selfWarningText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  rolesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  roleOptionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  verificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    marginBottom: 20,
  },
  verificationText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  modalActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Confirmation Modal Styles
  confirmModalContent: {
    width: '85%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  confirmIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default AdminManagementScreen;
