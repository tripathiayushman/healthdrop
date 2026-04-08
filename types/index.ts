// =====================================================
// HEALTH DROP SURVEILLANCE SYSTEM - TYPE DEFINITIONS
// =====================================================

// User Profile Types
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'super_admin' | 'health_admin' | 'clinic' | 'asha_worker' | 'volunteer' | 'district_officer';
  phone?: string;
  district?: string;
  state?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  avatar_url?: string;
  assigned_area?: string;
  supervisor_id?: string;
}

// Disease Report Types
export type DiseaseType = 'waterborne' | 'airborne' | 'vector' | 'foodborne' | 'other';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ReportStatus = 'reported' | 'verified' | 'investigating' | 'resolved' | 'dismissed';
export type TreatmentStatus = 'pending' | 'in_treatment' | 'recovered' | 'deceased';

export interface DiseaseReport {
  id: string;
  reporter_id: string;
  disease_name: string;
  disease_type: DiseaseType;
  severity: Severity;
  cases_count: number;
  deaths_count: number;
  location_name: string;
  district: string;
  state: string;
  latitude?: number;
  longitude?: number;
  symptoms?: string;
  age_group?: string;
  gender?: string;
  treatment_status?: TreatmentStatus;
  notes?: string;
  status: ReportStatus;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
  // Joined data
  reporter?: Profile;
  verifier?: Profile;
}

// Water Quality Report Types
export type SourceType = 'well' | 'river' | 'pond' | 'tap' | 'handpump' | 'borewell' | 'tank' | 'tanker' | 'other';
export type WaterSource = SourceType; // Alias for consistency
export type WaterQuality = 'safe' | 'moderate' | 'poor' | 'contaminated' | 'unsafe' | 'critical';
export type WaterReportStatus = 'reported' | 'verified' | 'action_required' | 'resolved';

export interface WaterQualityReport {
  id: string;
  reporter_id: string;
  source_name: string;
  source_type: SourceType;
  location_name: string;
  district: string;
  state: string;
  latitude?: number;
  longitude?: number;

  // Water quality parameters
  ph_level?: number;
  turbidity?: number;
  chlorine_level?: number;
  tds_level?: number;
  coliform_present?: boolean;
  arsenic_level?: number;
  fluoride_level?: number;
  iron_level?: number;
  nitrate_level?: number;

  overall_quality?: WaterQuality;
  contamination_type?: string;
  action_taken?: string;

  status: WaterReportStatus;
  verified_by?: string;
  verified_at?: string;
  notes?: string;
  images?: string[];

  created_at: string;
  updated_at: string;
  // Joined data
  reporter?: Profile;
}

// Campaign Types
export type CampaignType = 'vaccination' | 'awareness' | 'health_camp' | 'screening' | 'sanitation' | 'water_testing' | 'nutrition' | 'prevention' | 'other';
export type CampaignStatus = 'planned' | 'ongoing' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  created_by: string;
  title: string;
  description: string;
  campaign_type: CampaignType;
  target_disease?: string;

  start_date: string;
  end_date: string;

  location_name: string;
  district: string;
  state: string;
  latitude?: number;
  longitude?: number;

  target_population?: number;
  reached_population: number;
  volunteers_needed: number;
  volunteers_enrolled: number;

  status: CampaignStatus;
  budget?: number;
  spent: number;

  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;

  notes?: string;
  images?: string[];

  created_at: string;
  updated_at: string;
  // Joined data
  creator?: Profile;
}

// Campaign Volunteer Types
export type VolunteerStatus = 'enrolled' | 'confirmed' | 'attended' | 'absent' | 'withdrawn';

export interface CampaignVolunteer {
  id: string;
  campaign_id: string;
  volunteer_id: string;
  status: VolunteerStatus;
  hours_contributed: number;
  tasks_completed: number;
  feedback?: string;
  rating?: number;
  enrolled_at: string;
  // Joined data
  campaign?: Campaign;
  volunteer?: Profile;
}

// Notification Types
export type NotificationType = 'alert' | 'info' | 'warning' | 'success' | 'campaign' | 'report';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  id: string;
  user_id?: string;
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  target_role?: string;
  target_district?: string;
  related_type?: 'disease_report' | 'water_report' | 'campaign' | 'user';
  related_id?: string;
  is_read: boolean;
  read_at?: string;
  created_at: string;
  expires_at?: string;
}

// Activity Log Types
export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  created_at: string;
  // Joined
  user?: Profile;
}

// Statistics Types
export interface DiseaseStatistics {
  disease_name: string;
  disease_type: DiseaseType;
  district: string;
  state: string;
  report_count: number;
  total_cases: number;
  total_deaths: number;
  max_severity: Severity;
  month: string;
}

export interface WaterQualityStatistics {
  district: string;
  state: string;
  source_type: SourceType;
  source_count: number;
  safe_count: number;
  unsafe_count: number;
  avg_ph: number;
  avg_tds: number;
}

// Dashboard Stats
export interface DashboardStats {
  totalReports: number;
  activeOutbreaks: number;
  waterSources: number;
  unsafeWaterSources: number;
  activeCampaigns: number;
  totalUsers: number;
  pendingVerifications: number;
  criticalAlerts: number;
}

// Form Input Types
export interface DiseaseReportInput {
  disease_name: string;
  disease_type: DiseaseType;
  severity: Severity;
  cases_count: number;
  deaths_count?: number;
  location_name: string;
  district: string;
  state: string;
  latitude?: number;
  longitude?: number;
  symptoms?: string;
  age_group?: string;
  gender?: string;
  treatment_status?: TreatmentStatus;
  notes?: string;
}

export interface WaterQualityReportInput {
  source_name: string;
  source_type: SourceType;
  location_name: string;
  district: string;
  state: string;
  latitude?: number;
  longitude?: number;
  ph_level?: number;
  turbidity?: number;
  chlorine_level?: number;
  tds_level?: number;
  coliform_present?: boolean;
  arsenic_level?: number;
  fluoride_level?: number;
  iron_level?: number;
  nitrate_level?: number;
  quality?: WaterQuality;
  overall_quality?: WaterQuality;
  contamination_type?: string;
  contamination_level?: string;
  households_affected?: number;
  action_taken?: string;
  notes?: string;
}

// Alias for forms
export type WaterQualityInput = WaterQualityReportInput;

export interface CampaignInput {
  title: string;
  description: string;
  campaign_type: CampaignType;
  target_disease?: string;
  start_date: string;
  end_date: string;
  location_name: string;
  district: string;
  state: string;
  latitude?: number;
  longitude?: number;
  target_population?: number;
  target_participants?: number;
  volunteers_needed?: number;
  volunteers_required?: number;
  budget?: number;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  notes?: string;
}

// Navigation Types
export type Screen =
  | 'Dashboard'
  | 'DiseaseReports'
  | 'WaterQuality'
  | 'Campaigns'
  | 'Users'
  | 'Notifications'
  | 'Analytics'
  | 'Settings'
  | 'Profile'
  | 'NewDiseaseReport'
  | 'NewWaterReport'
  | 'NewCampaign'
  | 'ReportDetails'
  | 'CampaignDetails';

// API Response Types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  count?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// =====================================================
// AI, ANALYTICS, AND OPERATIONAL TYPES
// =====================================================

export type AIRecommendationType = 'alert' | 'campaign' | 'escalation';
export type AIRecommendationStatus = 'pending' | 'accepted' | 'rejected' | 'auto_executed';
export type AIRecommendationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AIRecommendation {
  id: string;
  type: AIRecommendationType;
  status: AIRecommendationStatus;
  title: string;
  description: string;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
  severity?: AIRecommendationSeverity | null;
  confidence_score?: number | null;
  recommended_action?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
  acted_at?: string | null;
  acted_by?: string | null;
}

export interface AIRecommendationInput {
  type: AIRecommendationType;
  title: string;
  description: string;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
  severity?: AIRecommendationSeverity | null;
  confidence_score?: number | null;
  recommended_action?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TrendData {
  district: string;
  disease_name: string;
  report_date: string;
  total_cases: number;
  moving_avg: number;
  prev_cases: number;
}

export interface OutbreakWarning extends TrendData {
  trend_status: 'stable' | 'rising' | 'anomaly';
  growth_rate?: number;
}

export type MapPointType = 'disease' | 'water' | 'alert';

export interface MapPoint {
  id: string;
  type: MapPointType;
  label: string;
  severity: string;
  created_at: string;
  location_geo?: unknown;
  latitude: number;
  longitude: number;
  weight: number;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
}

export interface DistrictHealthScore {
  district: string;
  active_cases: number;
  avg_water_score: number;
  outbreak_count: number;
  avg_response_time: number;
  health_score: number;
}

export interface DistrictHealthRanking extends DistrictHealthScore {
  risk_rank: number;
}

export interface CampaignEffectiveness {
  campaign_id: string;
  campaign_name: string;
  campaign_type?: string | null;
  district?: string | null;
  state?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  target_population?: number | null;
  reached_population?: number | null;
  participant_count?: number | null;
  cases_before?: number | null;
  cases_after?: number | null;
  success_score?: number | null;
  impact_score?: number | null;
}

export interface EscalationRecord {
  report_id: string;
  report_type: string;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
  status?: string | null;
  approval_status?: string | null;
  escalation_level?: number | null;
  created_at: string;
  last_updated_at?: string | null;
  pending_hours?: number | null;
  is_overdue?: boolean;
}

export interface TraceabilityRecord {
  report_id: string;
  report_type: string;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
  outbreak_id?: string | null;
  campaign_id?: string | null;
  alert_id?: string | null;
  escalation_level?: number | null;
  report_status?: string | null;
  approval_status?: string | null;
  created_at: string;
  linked_at?: string | null;
}

export interface ValidationResponse {
  success: boolean;
  error?: string;
  statusCode?: number;
  code?: 'duplicate' | 'invalid_input' | 'validation_failed';
  details?: Record<string, unknown> | null;
}

export interface AIAlert {
  id: string;
  district: string;
  disease_name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  status: string;
  created_at: string;
  report_date: string;
  trend_status: 'stable' | 'rising' | 'anomaly';
  state?: string;
  location_name?: string;
  confidence_score?: number;
  recommended_action?: string;
}
