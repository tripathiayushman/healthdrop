// =====================================================
// REPORTS SCREEN - Disease & Water Quality Reports
// ("Prakash" design) — approval-consistent visibility,
// token-driven severity/water colors, 4-state regions,
// flat data-table rows for admin viewers.
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
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import {
  SkeletonBlock,
  ErrorCard,
  getSeverityColor,
  getWaterQualityColor,
} from '../dashboards/DashboardShared';
import { DataTable } from '../shared/DataTable';

interface ReportsScreenProps {
  profile: Profile;
  onNavigateToForm: (formType: string) => void;
  focusReport?: { type: 'disease' | 'water'; id: string } | null;
  onFocusHandled?: () => void;
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

// Legacy severity vocab → canonical: severe→high, moderate→medium, mild→low.
const normalizeSeverity = (severity: string): string => {
  switch (severity?.toLowerCase()) {
    case 'severe': return 'high';
    case 'moderate': return 'medium';
    case 'mild': return 'low';
    default: return severity?.toLowerCase() ?? '';
  }
};

// Water vocab is safe/moderate/unsafe/critical; legacy poor→unsafe, contaminated→critical.
const getWaterQualityLabel = (quality: string): string => {
  switch (quality?.toLowerCase()) {
    case 'safe': return 'SAFE';
    case 'moderate': return 'MODERATE';
    case 'poor':
    case 'unsafe': return 'UNSAFE';
    case 'contaminated':
    case 'critical': return 'CRITICAL';
    default: return (quality || 'unknown').toUpperCase();
  }
};

const ReportsScreen: React.FC<ReportsScreenProps> = ({ profile, onNavigateToForm, focusReport, onFocusHandled }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  // Role-based access:
  // Admin, Clinic, District Officer, ASHA: Can create disease & water reports
  // Volunteer: Can only VIEW reports (no create)
  const canAccessDiseaseReports = ['super_admin', 'health_admin', 'clinic', 'district_officer', 'asha_worker'].includes(profile.role);
  const canAccessWaterReports = ['super_admin', 'health_admin', 'clinic', 'district_officer', 'asha_worker'].includes(profile.role);
  const canCreateReports = ['super_admin', 'health_admin', 'clinic', 'district_officer', 'asha_worker'].includes(profile.role);
  // Approval consistency: admins/officers see everything; other roles see
  // approved reports plus their own submissions in any status.
  const hasFullVisibility = ['super_admin', 'health_admin', 'district_officer'].includes(profile.role);
  // Admin data screens flatten to table rows when the list exceeds ~6 items.
  const usesTableLayout = hasFullVisibility;

  const [activeTab, setActiveTab] = useState<'disease' | 'water'>(canAccessDiseaseReports ? 'disease' : 'water');
  const [refreshing, setRefreshing] = useState(false);
  const [diseaseReports, setDiseaseReports] = useState<DiseaseReport[]>([]);
  const [waterReports, setWaterReports] = useState<WaterReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDiseaseReport, setSelectedDiseaseReport] = useState<DiseaseReport | null>(null);
  const [selectedWaterReport, setSelectedWaterReport] = useState<WaterReport | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  useEffect(() => {
    loadReports();
  }, []);

  useEffect(() => {
    if (!focusReport) return;

    const openFocusedReport = async () => {
      if (focusReport.type === 'disease') {
        setActiveTab('disease');
        const match = diseaseReports.find(r => r.id === focusReport.id);
        if (match) {
          setSelectedDiseaseReport(match);
          setSelectedWaterReport(null);
          setShowDetailModal(true);
          onFocusHandled?.();
          return;
        }

        const { data } = await supabase
          .from('disease_reports')
          .select('*')
          .eq('id', focusReport.id)
          .single();
        if (data) {
          setSelectedDiseaseReport(data);
          setSelectedWaterReport(null);
          setShowDetailModal(true);
        }
        onFocusHandled?.();
        return;
      }

      setActiveTab('water');
      const match = waterReports.find(r => r.id === focusReport.id);
      if (match) {
        setSelectedWaterReport(match);
        setSelectedDiseaseReport(null);
        setShowDetailModal(true);
        onFocusHandled?.();
        return;
      }

      const { data } = await supabase
        .from('water_quality_reports')
        .select('*')
        .eq('id', focusReport.id)
        .single();
      if (data) {
        setSelectedWaterReport(data);
        setSelectedDiseaseReport(null);
        setShowDetailModal(true);
      }
      onFocusHandled?.();
    };

    openFocusedReport();
  }, [focusReport, diseaseReports, waterReports, onFocusHandled]);

  const loadReports = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let diseaseQuery = supabase.from('disease_reports').select('*').order('created_at', { ascending: false }).limit(20);
      let waterQuery = supabase.from('water_quality_reports').select('*').order('created_at', { ascending: false }).limit(20);

      if (!hasFullVisibility) {
        // Approved reports plus the viewer's own submissions in any status.
        diseaseQuery = diseaseQuery.or(`approval_status.eq.approved,reporter_id.eq.${profile.id}`);
        waterQuery = waterQuery.or(`approval_status.eq.approved,reporter_id.eq.${profile.id}`);
      }

      const [diseaseRes, waterRes] = await Promise.allSettled([diseaseQuery, waterQuery]);

      let hasQueryError = false;

      if (diseaseRes.status === 'fulfilled') {
        if (diseaseRes.value.error) {
          hasQueryError = true;
          console.error('Failed loading disease reports:', diseaseRes.value.error);
        } else if (diseaseRes.value.data) {
          setDiseaseReports(diseaseRes.value.data);
        }
      } else {
        hasQueryError = true;
        console.error('Disease reports query rejected:', diseaseRes.reason);
      }

      if (waterRes.status === 'fulfilled') {
        if (waterRes.value.error) {
          hasQueryError = true;
          console.error('Failed loading water quality reports:', waterRes.value.error);
        } else if (waterRes.value.data) {
          setWaterReports(waterRes.value.data);
        }
      } else {
        hasQueryError = true;
        console.error('Water quality reports query rejected:', waterRes.reason);
      }

      if (hasQueryError) {
        setLoadError("Couldn't load some reports — check connection");
      }
    } catch (error) {
      console.error('Unexpected error loading reports:', error);
      setLoadError("Couldn't load reports — check connection");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  const severityColor = (severity: string) => getSeverityColor(normalizeSeverity(severity), colors);

  // Soft background for a severity pill — solid fill is CRITICAL's privilege alone.
  const severitySoftBg = (level: string): string => {
    switch (normalizeSeverity(level)) {
      case 'critical': return colors.dangerBg;
      case 'high': return colors.offlineBg;
      case 'medium': return colors.warningBg;
      case 'low': return colors.successBg;
      default: return colors.surfaceVariant;
    }
  };

  const waterSoftBg = (quality: string): string => {
    switch (getWaterQualityLabel(quality)) {
      case 'SAFE': return colors.successBg;
      case 'MODERATE': return colors.warningBg;
      case 'UNSAFE': return colors.dangerBg;
      case 'CRITICAL': return colors.dangerBg;
      default: return colors.surfaceVariant;
    }
  };

  const SeverityPill: React.FC<{ level: string }> = ({ level }) => {
    const key = normalizeSeverity(level);
    const isCritical = key === 'critical';
    const fg = isCritical ? colors.textInverse : severityColor(level);
    const bg = isCritical ? colors.danger : severitySoftBg(level);
    return (
      <View style={[styles.pill, { backgroundColor: bg }]} accessibilityLabel={`Severity: ${key || 'unknown'}`}>
        {!isCritical && <View style={[styles.pillDot, { backgroundColor: fg }]} />}
        <Text style={[styles.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>
          {(level || 'unknown').toUpperCase()}
        </Text>
      </View>
    );
  };

  const WaterQualityPill: React.FC<{ quality: string }> = ({ quality }) => {
    const label = getWaterQualityLabel(quality);
    const isCritical = label === 'CRITICAL';
    const fg = isCritical ? colors.textInverse : getWaterQualityColor(quality, colors);
    const bg = isCritical ? colors.waterCritical : waterSoftBg(quality);
    return (
      <View style={[styles.pill, { backgroundColor: bg }]} accessibilityLabel={`Water quality: ${label.toLowerCase()}`}>
        {!isCritical && <View style={[styles.pillDot, { backgroundColor: fg }]} />}
        <Text style={[styles.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>{label}</Text>
      </View>
    );
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

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const openDiseaseReport = (report: DiseaseReport) => {
    setSelectedDiseaseReport(report);
    setSelectedWaterReport(null);
    setShowDetailModal(true);
  };

  const openWaterReport = (report: WaterReport) => {
    setSelectedWaterReport(report);
    setSelectedDiseaseReport(null);
    setShowDetailModal(true);
  };

  const renderQuietZero = (
    title: string,
    subtitle: string,
    createScreen: string | null,
  ) => (
    <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <Ionicons name="checkmark-circle-outline" size={24} color={colors.success} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>{subtitle}</Text>
      {createScreen && (
        <Pressable
          style={({ pressed }) => [
            styles.emptyButton,
            { backgroundColor: pressed ? colors.primaryDark : colors.primary },
          ]}
          onPress={() => onNavigateToForm(createScreen)}
          accessibilityRole="button"
          accessibilityLabel="Create first report"
        >
          <Text style={[styles.emptyButtonText, { color: colors.onPrimary }]}>Create First Report</Text>
        </Pressable>
      )}
    </View>
  );

  const renderDiseaseReports = () => {
    if (diseaseReports.length === 0) {
      return renderQuietZero(
        'No disease reports on record.',
        canCreateReports ? 'Disease reports you create will appear here' : 'Disease reports will appear here',
        canCreateReports && canAccessDiseaseReports ? 'new-disease-report' : null,
      );
    }

    // Admin data screens with >6 rows: flat hairline table, numeric right-aligned.
    if (usesTableLayout && diseaseReports.length > 6) {
      return (
        <DataTable<DiseaseReport>
          data={diseaseReports}
          onRowPress={openDiseaseReport}
          columns={[
            { key: 'disease_name', title: 'Disease', width: 130 },
            { key: 'severity', title: 'Severity', width: 120, render: (item) => <SeverityPill level={item.severity} /> },
            { key: 'cases_count', title: 'Cases', width: 70, numeric: true, render: (item) => (
              <Text style={[styles.tableNumeric, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {item.cases_count ?? 1}
              </Text>
            ) },
            { key: 'district', title: 'District', width: 110 },
            { key: 'created_at', title: 'Date', width: 90, render: (item) => (
              <Text style={[styles.tableDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {formatShortDate(item.created_at)}
              </Text>
            ) },
          ]}
        />
      );
    }

    return diseaseReports.map((report) => (
      <Pressable
        key={report.id}
        style={({ pressed }) => [
          styles.reportCard,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.border,
            borderLeftColor: severityColor(report.severity),
          },
          !isDark && styles.cardShadow,
        ]}
        onPress={() => openDiseaseReport(report)}
        accessibilityRole="button"
        accessibilityLabel={`Disease report, severity ${report.severity}: ${report.disease_name}`}
      >
        <View style={styles.reportHeader}>
          <Text style={[styles.reportTitle, { color: colors.text }]} numberOfLines={1}>{report.disease_name}</Text>
          <SeverityPill level={report.severity} />
        </View>
        <View style={styles.reportDetails}>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              {report.location_name}, {report.district}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Cases</Text>
            <Text style={[styles.detailValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {report.cases_count ?? 1} case(s){report.deaths_count ? `, ${report.deaths_count} death(s)` : ''}
            </Text>
          </View>
          {report.symptoms && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Symptoms</Text>
              <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1}>
                {report.symptoms}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Date</Text>
            <Text style={[styles.detailValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {formatDate(report.created_at)}
            </Text>
          </View>
        </View>
        <View style={styles.tapHint}>
          <Text style={[styles.tapHintText, { color: colors.textSecondary }]}>Tap for details</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </View>
      </Pressable>
    ));
  };

  const renderWaterReports = () => {
    if (waterReports.length === 0) {
      return renderQuietZero(
        'No water quality reports on record.',
        canCreateReports ? 'Water quality reports you create will appear here' : 'Water quality reports will appear here',
        canCreateReports && canAccessWaterReports ? 'new-water-report' : null,
      );
    }

    if (usesTableLayout && waterReports.length > 6) {
      return (
        <DataTable<WaterReport>
          data={waterReports}
          onRowPress={openWaterReport}
          columns={[
            { key: 'source_name', title: 'Source', width: 130, render: (item) => (
              <Text style={[styles.tableCellText, { color: colors.text }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {item.source_name || item.source_type}
              </Text>
            ) },
            { key: 'overall_quality', title: 'Quality', width: 120, render: (item) => <WaterQualityPill quality={item.overall_quality} /> },
            { key: 'ph_level', title: 'pH', width: 64, numeric: true, render: (item) => (
              <Text style={[styles.tableNumeric, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {item.ph_level?.toFixed(2) ?? '—'}
              </Text>
            ) },
            { key: 'tds_level', title: 'TDS', width: 72, numeric: true, render: (item) => (
              <Text style={[styles.tableNumeric, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {item.tds_level === null || item.tds_level === undefined ? '—' : item.tds_level}
              </Text>
            ) },
            { key: 'district', title: 'District', width: 110 },
            { key: 'created_at', title: 'Date', width: 90, render: (item) => (
              <Text style={[styles.tableDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {formatShortDate(item.created_at)}
              </Text>
            ) },
          ]}
        />
      );
    }

    return waterReports.map((report) => (
      <Pressable
        key={report.id}
        style={({ pressed }) => [
          styles.reportCard,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.border,
            borderLeftColor: getWaterQualityColor(report.overall_quality, colors),
          },
          !isDark && styles.cardShadow,
        ]}
        onPress={() => openWaterReport(report)}
        accessibilityRole="button"
        accessibilityLabel={`Water report, quality ${getWaterQualityLabel(report.overall_quality).toLowerCase()}: ${report.source_name || report.source_type}`}
      >
        <View style={styles.reportHeader}>
          <Text style={[styles.reportTitle, { color: colors.text }]} numberOfLines={1}>
            {report.source_name || report.source_type}
          </Text>
          <WaterQualityPill quality={report.overall_quality} />
        </View>
        <View style={styles.reportDetails}>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{report.location_name}, {report.district}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>pH Level</Text>
            <Text style={[styles.detailValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {report.ph_level?.toFixed(2) || 'N/A'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>TDS Level</Text>
            <Text style={[styles.detailValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {report.tds_level === null || report.tds_level === undefined ? 'N/A' : `${report.tds_level} ppm`}
            </Text>
          </View>
          {report.contamination_type && report.contamination_type !== 'none' && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Contamination</Text>
              <Text style={[styles.detailValue, { color: colors.danger }]}>
                {report.contamination_type}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Date</Text>
            <Text style={[styles.detailValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {formatDate(report.created_at)}
            </Text>
          </View>
        </View>
        <View style={styles.tapHint}>
          <Text style={[styles.tapHintText, { color: colors.textSecondary }]}>Tap for details</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </View>
      </Pressable>
    ));
  };

  // Header ink — headerBg is a mode-appropriate SURFACE (paper in light, dark
  // surface in dark), so plain ink reads in BOTH modes. textInverse is illegal here.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;
  const activeCount = activeTab === 'disease' ? diseaseReports.length : waterReports.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg surface + hairline */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper needs the hairline in BOTH modes.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: headerText }]}>Reports</Text>
        <Text style={[styles.headerSubtitle, { color: headerSub }]}>View and manage all health reports</Text>
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
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'disease' }}
          accessibilityLabel="Disease reports tab"
        >
          <View style={styles.tabContent}>
            <Ionicons
              name={activeTab === 'disease' ? 'medkit' : 'medkit-outline'}
              size={18}
              color={activeTab === 'disease' ? colors.onPrimary : colors.text}
            />
            <Text style={[styles.tabText, { color: activeTab === 'disease' ? colors.onPrimary : colors.text }]}>
              Disease
            </Text>
          </View>
        </TouchableOpacity>
        {/* Water Tab - Viewable by all */}
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'water' && { backgroundColor: colors.primary },
          ]}
          onPress={() => setActiveTab('water')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'water' }}
          accessibilityLabel="Water quality reports tab"
        >
          <View style={styles.tabContent}>
            <Ionicons
              name={activeTab === 'water' ? 'water' : 'water-outline'}
              size={18}
              color={activeTab === 'water' ? colors.onPrimary : colors.text}
            />
            <Text style={[styles.tabText, { color: activeTab === 'water' ? colors.onPrimary : colors.text }]}>
              Water Quality
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Eyebrow-and-count section header */}
        <Text style={[styles.sectionEyebrow, { color: colors.textSecondary }]} numberOfLines={1}>
          {activeTab === 'disease' ? 'DISEASE REPORTS' : 'WATER QUALITY REPORTS'}
          {!loading && <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${activeCount}`}</Text>}
        </Text>

        {loading ? (
          <View style={styles.skeletonWrap} accessibilityElementsHidden>
            <SkeletonBlock height={150} radius={radii.md} />
            <SkeletonBlock height={150} radius={radii.md} />
            <SkeletonBlock height={150} radius={radii.md} />
          </View>
        ) : (
          <>
            {loadError && <ErrorCard message={loadError} onRetry={loadReports} />}
            {activeTab === 'disease' ? renderDiseaseReports() : renderWaterReports()}
          </>
        )}
      </ScrollView>

      {/* Report Detail Modal */}
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
            {/* 3px semantic top rule — never flood-fill a modal header */}
            <View
              style={[
                styles.modalTopRule,
                {
                  backgroundColor: selectedDiseaseReport
                    ? severityColor(selectedDiseaseReport.severity)
                    : selectedWaterReport
                    ? getWaterQualityColor(selectedWaterReport.overall_quality, colors)
                    : colors.border,
                },
              ]}
            />
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedDiseaseReport ? 'Disease Report Details' : 'Water Quality Report Details'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowDetailModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Close report details modal"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              {selectedDiseaseReport && (
                <>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Disease Name</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.disease_name}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Type</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.disease_type}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Severity</Text>
                    <View style={{ alignSelf: 'flex-start' }}>
                      <SeverityPill level={selectedDiseaseReport.severity} />
                    </View>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Cases Reported</Text>
                    <Text style={[styles.modalValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {selectedDiseaseReport.cases_count ?? 1}
                    </Text>
                  </View>
                  {selectedDiseaseReport.deaths_count > 0 && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Deaths</Text>
                      <Text style={[styles.modalValue, styles.numericValue, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                        {selectedDiseaseReport.deaths_count}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Location</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedDiseaseReport.location_name}, {selectedDiseaseReport.district}, {selectedDiseaseReport.state}
                    </Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Affected Demographics</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedDiseaseReport.age_group || 'N/A'} • {selectedDiseaseReport.gender || 'N/A'}
                    </Text>
                  </View>
                  {selectedDiseaseReport.symptoms && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Symptoms</Text>
                      <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.symptoms}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Treatment Status</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.treatment_status || 'N/A'}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Report Status</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.status || 'N/A'}</Text>
                  </View>
                  {selectedDiseaseReport.notes && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Notes</Text>
                      <Text style={[styles.modalValue, { color: colors.text }]}>{selectedDiseaseReport.notes}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Reported On</Text>
                    <Text style={[styles.modalValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {formatDate(selectedDiseaseReport.created_at)}
                    </Text>
                  </View>
                </>
              )}

              {selectedWaterReport && (
                <>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Source Name</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.source_name || 'N/A'}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Source Type</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.source_type}</Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Overall Quality</Text>
                    <View style={{ alignSelf: 'flex-start' }}>
                      <WaterQualityPill quality={selectedWaterReport.overall_quality} />
                    </View>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Location</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedWaterReport.location_name}, {selectedWaterReport.district}, {selectedWaterReport.state}
                    </Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>pH Level</Text>
                    <Text style={[styles.modalValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {selectedWaterReport.ph_level?.toFixed(2) || 'N/A'}
                    </Text>
                  </View>
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>TDS Level</Text>
                    <Text style={[styles.modalValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {selectedWaterReport.tds_level === null || selectedWaterReport.tds_level === undefined
                        ? 'N/A'
                        : `${selectedWaterReport.tds_level} ppm`}
                    </Text>
                  </View>
                  {selectedWaterReport.contamination_type && selectedWaterReport.contamination_type !== 'none' && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Contamination Type</Text>
                      <Text style={[styles.modalValue, { color: colors.danger }]}>{selectedWaterReport.contamination_type}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Status</Text>
                    <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.status || 'N/A'}</Text>
                  </View>
                  {selectedWaterReport.notes && (
                    <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                      <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Notes</Text>
                      <Text style={[styles.modalValue, { color: colors.text }]}>{selectedWaterReport.notes}</Text>
                    </View>
                  )}
                  <View style={[styles.modalSection, { borderBottomColor: colors.borderLight }]}>
                    <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Reported On</Text>
                    <Text style={[styles.modalValue, styles.numericValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {formatDate(selectedWaterReport.created_at)}
                    </Text>
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
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    // No status-bar inset here — MainApp's SafeAreaView + shell header sit above.
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
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
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  // Clears the shell's floating "Create" button (56dp tall, docked 88/96dp
  // from the safe-area bottom) so it can never cover a card's last row.
  scrollContent: {
    paddingBottom: 96,
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
  skeletonWrap: {
    gap: spacing.md,
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
  emptyDescription: {
    fontSize: 13,
    lineHeight: 18,
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
  reportCard: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    marginBottom: spacing.md,
    minHeight: 64,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  reportTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    flex: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  reportDetails: {
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
  },
  detailLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    width: 100,
  },
  detailValue: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: '500',
  },
  numericValue: {
    fontVariant: ['tabular-nums'],
  },
  tableCellText: {
    fontSize: 15,
    lineHeight: 22,
  },
  tableNumeric: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  tableDate: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
    gap: 4,
  },
  tapHintText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
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
  modalSection: {
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
  },
  modalLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  modalValue: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
});

export default ReportsScreen;
