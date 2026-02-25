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
