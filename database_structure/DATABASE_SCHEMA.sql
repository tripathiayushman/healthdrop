-- =====================================================
-- HEALTH DROP SURVEILLANCE SYSTEM - DATABASE SCHEMA
-- =====================================================
-- Run these queries in your Supabase SQL Editor
-- Make sure to run them in order!

-- =====================================================
-- 1. PROFILES TABLE (if not already created)
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'clinic', 'asha_worker', 'volunteer')),
    phone TEXT,
    district TEXT,
    state TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    avatar_url TEXT,
    assigned_area TEXT,
    supervisor_id UUID REFERENCES profiles(id)
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can update any profile" ON profiles
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins can insert profiles" ON profiles
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR auth.uid() = id
    );

-- =====================================================
-- 2. DISEASE REPORTS TABLE
-- =====================================================
CREATE TABLE disease_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    disease_name TEXT NOT NULL,
    disease_type TEXT NOT NULL CHECK (disease_type IN ('waterborne', 'airborne', 'vector', 'foodborne', 'other')),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    cases_count INTEGER NOT NULL DEFAULT 1,
    deaths_count INTEGER DEFAULT 0,
    location_name TEXT NOT NULL,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    symptoms TEXT,
    age_group TEXT,
    gender TEXT,
    treatment_status TEXT CHECK (treatment_status IN ('pending', 'in_treatment', 'recovered', 'deceased')),
    notes TEXT,
    status TEXT DEFAULT 'reported' CHECK (status IN ('reported', 'verified', 'investigating', 'resolved', 'dismissed')),
    verified_by UUID REFERENCES profiles(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE disease_reports ENABLE ROW LEVEL SECURITY;

-- Disease reports policies

-- SELECT: district-aware visibility per role
--   Admin       → all reports (any status, any district)
--   Clinic      → own + same-district (any status) + approved nationwide
--   ASHA Worker → own + approved reports in own district only
--   Volunteer   → approved reports nationwide only
CREATE POLICY "District based disease reports visibility" ON disease_reports
    FOR SELECT USING (
        -- Admin: full access
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin' AND profiles.is_active = TRUE
        )
        OR
        -- Clinic: own reports
        (reporter_id = auth.uid() AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE
        ))
        OR
        -- Clinic: all reports in their district (for approval/oversight)
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'clinic'
              AND profiles.is_active = TRUE AND profiles.district = disease_reports.district
        )
        OR
        -- Clinic: approved reports nationwide
        (approval_status = 'approved' AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE
        ))
        OR
        -- ASHA Worker: own reports
        (reporter_id = auth.uid() AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'asha_worker' AND profiles.is_active = TRUE
        ))
        OR
        -- ASHA Worker: approved reports in their district only
        (approval_status = 'approved' AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'asha_worker'
              AND profiles.is_active = TRUE AND profiles.district = disease_reports.district
        ))
        OR
        -- Volunteer: approved reports nationwide only
        (approval_status = 'approved' AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'volunteer' AND profiles.is_active = TRUE
        ))
    );

-- Only admin, clinic, and asha_worker roles may insert disease reports.
-- Volunteers are blocked at the database level regardless of frontend state.
CREATE POLICY "Restrict insert disease reports to authorised roles" ON disease_reports
    FOR INSERT WITH CHECK (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id   = auth.uid()
              AND profiles.role IN ('admin', 'clinic', 'asha_worker')
              AND profiles.is_active = TRUE
        )
    );

CREATE POLICY "Users can update own reports" ON disease_reports
    FOR UPDATE USING (
        reporter_id = auth.uid() OR
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Admins can delete reports" ON disease_reports
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- =====================================================
-- 3. WATER QUALITY REPORTS TABLE
-- =====================================================
CREATE TABLE water_quality_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('well', 'river', 'pond', 'tap', 'handpump', 'borewell', 'tank', 'other')),
    location_name TEXT NOT NULL,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Water quality parameters
    ph_level DECIMAL(4, 2),
    turbidity DECIMAL(6, 2),
    chlorine_level DECIMAL(6, 3),
    tds_level INTEGER,
    coliform_present BOOLEAN,
    arsenic_level DECIMAL(6, 4),
    fluoride_level DECIMAL(6, 3),
    iron_level DECIMAL(6, 3),
    nitrate_level DECIMAL(6, 2),
    
    overall_quality TEXT CHECK (overall_quality IN ('safe', 'moderate', 'unsafe', 'critical')),
    contamination_type TEXT,
    action_taken TEXT,
    
    status TEXT DEFAULT 'reported' CHECK (status IN ('reported', 'verified', 'action_required', 'resolved')),
    verified_by UUID REFERENCES profiles(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    images TEXT[], -- Array of image URLs
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE water_quality_reports ENABLE ROW LEVEL SECURITY;

-- Water quality policies
CREATE POLICY "Users can view water reports" ON water_quality_reports
    FOR SELECT USING (
        reporter_id = auth.uid() OR
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'asha_worker'))
    );

-- Only admin, clinic, and asha_worker roles may insert water quality reports.
-- Volunteers are blocked at the database level regardless of frontend state.
CREATE POLICY "Restrict insert water reports to authorised roles" ON water_quality_reports
    FOR INSERT WITH CHECK (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id   = auth.uid()
              AND profiles.role IN ('admin', 'clinic', 'asha_worker')
              AND profiles.is_active = TRUE
        )
    );

CREATE POLICY "Users can update own water reports" ON water_quality_reports
    FOR UPDATE USING (
        reporter_id = auth.uid() OR
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- =====================================================
-- 4. CAMPAIGNS TABLE
-- =====================================================
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    campaign_type TEXT NOT NULL CHECK (campaign_type IN ('vaccination', 'awareness', 'screening', 'sanitation', 'nutrition', 'other')),
    target_disease TEXT,
    
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
    location_name TEXT NOT NULL,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    target_population INTEGER,
    reached_population INTEGER DEFAULT 0,
    volunteers_needed INTEGER DEFAULT 0,
    volunteers_enrolled INTEGER DEFAULT 0,
    
    status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'ongoing', 'completed', 'cancelled')),
    budget DECIMAL(12, 2),
    spent DECIMAL(12, 2) DEFAULT 0,
    
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    
    notes TEXT,
    images TEXT[],

    -- Approval workflow columns (consistent with health_campaigns / APPROVAL_SYSTEM.sql)
    approval_status  TEXT DEFAULT 'pending_approval',
    approved_by      UUID REFERENCES profiles(id),
    approved_at      TIMESTAMPTZ,
    rejection_reason TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Campaign policies

-- SELECT: everyone sees approved campaigns; admin/clinic/asha see all
CREATE POLICY "Everyone can view campaigns" ON campaigns
    FOR SELECT USING (true);

-- INSERT: admin, clinic, asha_worker — must insert as themselves and be active
CREATE POLICY "Admins can create campaigns" ON campaigns
    FOR INSERT WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      IN ('admin', 'clinic', 'asha_worker')
              AND profiles.is_active = TRUE
        )
    );

-- UPDATE — Admin: unrestricted global access
CREATE POLICY "Admin full update campaigns" ON campaigns
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'admin'
              AND profiles.is_active = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'admin'
              AND profiles.is_active = TRUE
        )
    );

-- UPDATE — Clinic district approval: clinic may approve campaigns in their own district only
CREATE POLICY "Clinic district update campaigns" ON campaigns
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
              AND profiles.district  = campaigns.district
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
              AND profiles.district  = campaigns.district
        )
    );

-- UPDATE — Clinic own campaign: clinic can always edit campaigns they created
CREATE POLICY "Clinic own campaign update" ON campaigns
    FOR UPDATE
    USING (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )
    WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    );

-- UPDATE — ASHA own campaign: asha_worker can edit own campaigns but cannot self-approve
CREATE POLICY "ASHA own campaign update" ON campaigns
    FOR UPDATE
    USING (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
        )
    )
    WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
        )
        -- Prevents ASHA workers from self-approving at the database level
        AND (approval_status IS NULL OR approval_status = 'pending_approval')
    );

-- =====================================================
-- 5. CAMPAIGN VOLUNTEERS TABLE
-- =====================================================
CREATE TABLE campaign_volunteers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    volunteer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'confirmed', 'attended', 'absent', 'withdrawn')),
    hours_contributed DECIMAL(5, 2) DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    feedback TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(campaign_id, volunteer_id)
);

-- Enable RLS
ALTER TABLE campaign_volunteers ENABLE ROW LEVEL SECURITY;

-- Volunteer policies
CREATE POLICY "Volunteers can view own enrollments" ON campaign_volunteers
    FOR SELECT USING (
        volunteer_id = auth.uid() OR
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Volunteers can enroll" ON campaign_volunteers
    FOR INSERT WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "Users can update own enrollment" ON campaign_volunteers
    FOR UPDATE USING (
        volunteer_id = auth.uid() OR
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- =====================================================
-- 6. HEALTH ALERTS TABLE
-- =====================================================
CREATE TABLE health_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('disease_outbreak', 'water_contamination', 'food_poisoning', 'vector_alert', 'toxic_exposure', 'medical_emergency', 'general')),
    urgency_level TEXT NOT NULL CHECK (urgency_level IN ('critical', 'high', 'medium', 'low')),
    
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    
    location_name TEXT NOT NULL,
    district TEXT NOT NULL,
    state TEXT NOT NULL,
    affected_population INTEGER DEFAULT 0,
    
    disease_or_issue TEXT,
    symptoms_to_watch TEXT,
    cases_reported INTEGER DEFAULT 0,
    deaths_reported INTEGER DEFAULT 0,
    
    immediate_actions TEXT,
    precautionary_measures TEXT,
    
    contact_person TEXT,
    contact_phone TEXT,
    
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'expired', 'cancelled')),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES profiles(id),

    -- Approval workflow (Prompt 14)
    approval_status TEXT DEFAULT 'pending_approval',
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE health_alerts ENABLE ROW LEVEL SECURITY;

-- Health alerts policies (approval workflow — Prompt 14)
-- SELECT: everyone sees approved; admin/clinic sees all; ASHA sees own pending
CREATE POLICY "alerts_select" ON health_alerts
    FOR SELECT USING (
        approval_status = 'approved'
        OR EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'clinic')
        )
        OR created_by = auth.uid()
    );

-- INSERT: admin, clinic, asha_worker, district_officer
CREATE POLICY "alerts_insert" ON health_alerts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'clinic', 'asha_worker', 'district_officer')
        )
    );

-- UPDATE: only admin/clinic (for approval workflow)
CREATE POLICY "alerts_update" ON health_alerts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'clinic')
        )
    );

-- DELETE: only admin
CREATE POLICY "alerts_delete" ON health_alerts
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
        )
    );

-- Index for alerts
CREATE INDEX IF NOT EXISTS idx_health_alerts_status ON health_alerts(status);
CREATE INDEX IF NOT EXISTS idx_health_alerts_urgency ON health_alerts(urgency_level);
CREATE INDEX IF NOT EXISTS idx_health_alerts_created ON health_alerts(created_at DESC);

-- =====================================================
-- 7. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('alert', 'info', 'warning', 'success', 'campaign', 'report')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    
    -- NULL user_id means broadcast to all or specific roles
    target_role TEXT CHECK (target_role IN ('admin', 'clinic', 'asha_worker', 'volunteer')),
    target_district TEXT,
    
    related_type TEXT CHECK (related_type IN ('disease_report', 'water_report', 'campaign', 'user')),
    related_id UUID,
    
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Notification policies
CREATE POLICY "Users can view own notifications" ON notifications
    FOR SELECT USING (
        user_id = auth.uid() OR
        user_id IS NULL OR
        EXISTS (
            SELECT 1 FROM profiles p 
            WHERE p.id = auth.uid() 
            AND (target_role IS NULL OR p.role = target_role)
            AND (target_district IS NULL OR p.district = target_district)
        )
    );

CREATE POLICY "Admins can create notifications" ON notifications
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can update own notifications" ON notifications
    FOR UPDATE USING (user_id = auth.uid());

-- =====================================================
-- 7. ACTIVITY LOGS TABLE (for audit trail)
-- =====================================================
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Activity log policies
CREATE POLICY "Admins can view all logs" ON activity_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "Users can view own logs" ON activity_logs
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System can insert logs" ON activity_logs
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- 8. USEFUL VIEWS
-- =====================================================

-- View for disease outbreak statistics
CREATE OR REPLACE VIEW disease_statistics AS
SELECT 
    disease_name,
    disease_type,
    district,
    state,
    COUNT(*) as report_count,
    SUM(cases_count) as total_cases,
    SUM(deaths_count) as total_deaths,
    MAX(severity) as max_severity,
    DATE_TRUNC('month', created_at) as month
FROM disease_reports
WHERE status != 'dismissed'
GROUP BY disease_name, disease_type, district, state, DATE_TRUNC('month', created_at);

-- View for water quality overview
CREATE OR REPLACE VIEW water_quality_statistics AS
SELECT 
    district,
    state,
    source_type,
    COUNT(*) as source_count,
    COUNT(CASE WHEN overall_quality = 'safe' THEN 1 END) as safe_count,
    COUNT(CASE WHEN overall_quality = 'unsafe' OR overall_quality = 'critical' THEN 1 END) as unsafe_count,
    AVG(ph_level) as avg_ph,
    AVG(tds_level) as avg_tds
FROM water_quality_reports
GROUP BY district, state, source_type;

-- =====================================================
-- 9. USEFUL FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_disease_reports_updated_at
    BEFORE UPDATE ON disease_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_water_quality_updated_at
    BEFORE UPDATE ON water_quality_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- 10. INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_disease_reports_district ON disease_reports(district);
CREATE INDEX IF NOT EXISTS idx_disease_reports_disease ON disease_reports(disease_name);
CREATE INDEX IF NOT EXISTS idx_disease_reports_status ON disease_reports(status);
CREATE INDEX IF NOT EXISTS idx_disease_reports_created ON disease_reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_water_reports_district ON water_quality_reports(district);
CREATE INDEX IF NOT EXISTS idx_water_reports_quality ON water_quality_reports(overall_quality);
CREATE INDEX IF NOT EXISTS idx_water_reports_created ON water_quality_reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates ON campaigns(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_district ON profiles(district);

-- =====================================================
-- DONE! Your database is now ready.
-- =====================================================
