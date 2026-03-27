// =====================================================
// REPORTS SCREEN - Disease & Water Quality Reports (Vector Icons)
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
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';

const { width } = Dimensions.get('window');

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
  reporter_id?: string;
}

const ReportsScreen: React.FC<ReportsScreenProps> = ({ profile, onNavigateToForm }) => {
  const { colors } = useTheme();
  // Role-based access:
  // Admin & Clinic: Can create disease & water reports, can approve reports
  // ASHA Worker: Can create water reports only
  // Volunteer: Can only VIEW reports (no create)
  const canAccessDiseaseReports = ['health_admin', 'clinic'].includes(profile.role);
  const canAccessWaterReports = ['health_admin', 'clinic', 'asha_worker'].includes(profile.role);
  const canCreateReports = ['health_admin', 'clinic', 'asha_worker'].includes(profile.role);
  const canApproveReports = ['health_admin', 'clinic'].includes(profile.role);
  const isVolunteer = profile.role === 'volunteer';
  
  const [activeTab, setActiveTab] = useState<'disease' | 'water'>(canAccessDiseaseReports ? 'disease' : 'water');
  const [refreshing, setRefreshing] = useState(false);
  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports] = useState<WaterReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDiseaseReport, setSelectedDiseaseReport] = useState<DiseaseReport | null>(null);
  const [selectedWaterReport, setSelectedWaterReport] = useState<WaterReport | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    setLoading(true);
    try {
      const [diseaseRes, waterRes] = await Promise.allSettled([
        supabase.from('disease_reports').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('water_quality_reports').select('*').order('created_at', { ascending: false }).limit(20),
      ]);

      if (diseaseRes.status === 'fulfilled' && diseaseRes.value.data) {
        setDiseaseReports(diseaseRes.value.data);
      }
      if (waterRes.status === 'fulfilled' && waterRes.value.data) {
        setWaterReports(waterRes.value.data);
      }
    } catch (error) {
      console.log('Reports loading - tables may not exist yet');
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  const getSeverityColor = (severity: string) => {
    const severityColors: Record<string, string> = {
      critical: '#DC2626',
      high: '#EA580C',
      severe: '#EA580C',
      medium: '#F59E0B',
      moderate: '#F59E0B',
      low: '#10B981',
      mild: '#10B981',
    };
    return severityColors[severity?.toLowerCase()] || colors.textSecondary;
  };

  const getQualityColor = (quality: string) => {
    const qualityColors: Record<string, string> = {
      safe: '#10B981',
      moderate: '#F59E0B',
      poor: '#EA580C',
      contaminated: '#DC2626',
    };
    return qualityColors[quality?.toLowerCase()] || colors.textSecondary;
  };

  const getContaminationColor = (level: string) => {
    const levelColors: Record<string, string> = {
      high: '#DC2626',
      moderate: '#F59E0B',
      low: '#10B981',
      none: '#059669',
    };
    return levelColors[level] || colors.textSecondary;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderDiseaseReports = () => {
    if (diseaseReports.length === 0) {
      return (
        <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MaterialCommunityIcons name="virus-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Disease Reports</Text>
          <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
            {canCreateReports ? 'Disease reports you create will appear here' : 'Disease reports will appear here'}
          </Text>
          {canCreateReports && canAccessDiseaseReports && (
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: colors.primary }]}
              onPress={() => onNavigateToForm('new-disease-report')}
            >
              <Text style={styles.emptyButtonText}>Create First Report</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return diseaseReports.map((report) => (
      <TouchableOpacity
        key={report.id}
        style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
        onPress={() => {
          setSelectedDiseaseReport(report);
          setSelectedWaterReport(null);
          setShowDetailModal(true);
        }}
      >
        <View style={styles.reportHeader}>
          <View style={styles.reportTitleRow}>
            <MaterialCommunityIcons name="virus" size={24} color={colors.primary} />
            <Text style={[styles.reportTitle, { color: colors.text }]}>{report.disease_name}</Text>
          </View>
          <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(report.severity) + '20' }]}>
            <Text style={[styles.severityText, { color: getSeverityColor(report.severity) }]}>
              {report.severity?.toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.reportDetails}>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {report.location_name}, {report.district}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Cases:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {report.cases_count || 1} case(s){report.deaths_count ? `, ${report.deaths_count} death(s)` : ''}
            </Text>
          </View>
          {report.symptoms && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Symptoms:</Text>
              <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1}>
                {report.symptoms}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Date:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{formatDate(report.created_at)}</Text>
          </View>
        </View>
        <View style={styles.tapHint}>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          <Text style={[styles.tapHintText, { color: colors.textSecondary }]}>Tap for details</Text>
        </View>
      </TouchableOpacity>
    ));
  };

  const renderWaterReports = () => {
    if (waterReports.length === 0) {
      return (
        <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="water-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Water Reports</Text>
          <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
            {canCreateReports ? 'Water quality reports you create will appear here' : 'Water quality reports will appear here'}
          </Text>
          {canCreateReports && canAccessWaterReports && (
            <TouchableOpacity
              style={[styles.emptyButton, { backgroundColor: colors.secondary }]}
              onPress={() => onNavigateToForm('new-water-report')}
            >
              <Text style={styles.emptyButtonText}>Create First Report</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return waterReports.map((report) => (
      <TouchableOpacity
        key={report.id}
        style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
        onPress={() => {
          setSelectedWaterReport(report);
          setSelectedDiseaseReport(null);
          setShowDetailModal(true);
        }}
      >
        <View style={styles.reportHeader}>
          <View style={styles.reportTitleRow}>
            <Ionicons name="water" size={24} color={colors.secondary} />
            <Text style={[styles.reportTitle, { color: colors.text }]}>{report.source_name || report.source_type}</Text>
          </View>
          <View style={[styles.severityBadge, { backgroundColor: getQualityColor(report.overall_quality) + '20' }]}>
            <Text style={[styles.severityText, { color: getQualityColor(report.overall_quality) }]}>
              {(report.overall_quality || 'unknown').toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.reportDetails}>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{report.location_name}, {report.district}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>pH Level:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{report.ph_level?.toFixed(1) || 'N/A'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>TDS Level:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{report.tds_level || 'N/A'} ppm</Text>
          </View>
          {report.contamination_type && report.contamination_type !== 'none' && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Contamination:</Text>
              <Text style={[styles.detailValue, { color: '#EF4444' }]}>
                {report.contamination_type}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Date:</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{formatDate(report.created_at)}</Text>
          </View>
        </View>
        <View style={styles.tapHint}>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          <Text style={[styles.tapHintText, { color: colors.textSecondary }]}>Tap for details</Text>
        </View>
      </TouchableOpacity>
    ));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Reports</Text>
        <Text style={styles.headerSubtitle}>View and manage all health reports</Text>
      </View>

      {/* Tab Buttons - Volunteers see both tabs but cannot create */}
      <View style={[styles.tabContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Disease Tab - Viewable by all, creatable by Admin & Clinic */}
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'disease' && { backgroundColor: colors.primary },
          ]}
          onPress={() => setActiveTab('disease')}
        >
          <View style={styles.tabContent}>
            <MaterialCommunityIcons 
              name="virus" 
              size={18} 
              color={activeTab === 'disease' ? '#FFF' : colors.text} 
            />
            <Text style={[styles.tabText, { color: activeTab === 'disease' ? '#FFF' : colors.text }]}>
              Disease
            </Text>
          </View>
        </TouchableOpacity>
        {/* Water Tab - Viewable by all */}
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'water' && { backgroundColor: colors.secondary },
          ]}
          onPress={() => setActiveTab('water')}
        >
          <View style={styles.tabContent}>
            <Ionicons 
              name="water" 
              size={18} 
              color={activeTab === 'water' ? '#FFF' : colors.text} 
            />
            <Text style={[styles.tabText, { color: activeTab === 'water' ? '#FFF' : colors.text }]}>
              Water Quality
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'disease' ? renderDiseaseReports() : renderWaterReports()}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* FAB - Only for roles that can create (NOT volunteers) */}
      {canCreateReports && ((activeTab === 'disease' && canAccessDiseaseReports) || (activeTab === 'water' && canAccessWaterReports)) && (
        <TouchableOpacity
          style={[
            styles.fab,
            { backgroundColor: activeTab === 'disease' ? colors.primary : colors.secondary },
          ]}
          onPress={() => onNavigateToForm(activeTab === 'disease' ? 'new-disease-report' : 'new-water-report')}
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {/* Report Detail Modal */}
      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedDiseaseReport ? 'Disease Report Details' : 'Water Quality Report Details'}
              </Text>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              {selectedDiseaseReport && (
                <>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Disease Name</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.disease_name}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Type</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.disease_type}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Severity</Text>
                    <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(selectedDiseaseReport.severity) + '20', alignSelf: 'flex-start' }]}>
                      <Text style={[styles.severityText, { color: getSeverityColor(selectedDiseaseReport.severity) }]}>
                        {selectedDiseaseReport.severity?.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Cases Reported</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.cases_count || 1}</Text>
                  </View>
                  {selectedDiseaseReport.deaths_count > 0 && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Deaths</Text>
                      <Text style={[styles.modalValue, { color: '#EF4444' }]}>{selectedDiseaseReport.deaths_count}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Location</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedDiseaseReport.location_name}, {selectedDiseaseReport.district}, {selectedDiseaseReport.state}
                    </Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Affected Demographics</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedDiseaseReport.age_group || 'N/A'} • {selectedDiseaseReport.gender || 'N/A'}
                    </Text>
                  </View>
                  {selectedDiseaseReport.symptoms && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Symptoms</Text>
                      <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.symptoms}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Treatment Status</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.treatment_status || 'N/A'}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Report Status</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.status || 'N/A'}</Text>
                  </View>
                  {selectedDiseaseReport.notes && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Notes</Text>
                      <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.notes}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Reported On</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{formatDate(selectedDiseaseReport.created_at)}</Text>
                  </View>
                </>
              )}

              {selectedWaterReport && (
                <>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Source Name</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.source_name || 'N/A'}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Source Type</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.source_type}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Overall Quality</Text>
                    <View style={[styles.severityBadge, { backgroundColor: getQualityColor(selectedWaterReport.overall_quality) + '20', alignSelf: 'flex-start' }]}>
                      <Text style={[styles.severityText, { color: getQualityColor(selectedWaterReport.overall_quality) }]}>
                        {(selectedWaterReport.overall_quality || 'unknown').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Location</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedWaterReport.location_name}, {selectedWaterReport.district}, {selectedWaterReport.state}
                    </Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>pH Level</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.ph_level?.toFixed(2) || 'N/A'}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>TDS Level</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.tds_level || 'N/A'} ppm</Text>
                  </View>
                  {selectedWaterReport.contamination_type && selectedWaterReport.contamination_type !== 'none' && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Contamination Type</Text>
                      <Text style={[styles.modalValue, { color: '#EF4444' }]}>{selectedWaterReport.contamination_type}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Status</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.status || 'N/A'}</Text>
                  </View>
                  {selectedWaterReport.notes && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Notes</Text>
                      <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.notes}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Reported On</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{formatDate(selectedWaterReport.created_at)}</Text>
                  </View>
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
  tabContainer: {
    flexDirection: 'row',
    margin: 16,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabText: {
    fontSize: 14,
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
  reportCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  reportTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  reportTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  severityText: {
    fontSize: 11,
    fontWeight: '700',
  },
  reportDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
  },
  detailLabel: {
    fontSize: 13,
    width: 100,
  },
  detailValue: {
    fontSize: 13,
    flex: 1,
    fontWeight: '500',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  bottomSpacer: {
    height: 80,
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 4,
  },
  tapHintText: {
    fontSize: 11,
  },
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
  modalSection: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  modalValue: {
    fontSize: 16,
  },
});

export default ReportsScreen;
