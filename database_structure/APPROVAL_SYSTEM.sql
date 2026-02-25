-- APPROVAL_SYSTEM.sql
-- Run this in Supabase SQL Editor to set up the report approval system
-- 
-- APPROVAL WORKFLOW:
-- 1. Reports submitted by ASHA workers have status 'pending_approval'
-- 2. Reports submitted by Clinic/Admin have status 'approved' automatically
-- 3. Only approved reports are visible to everyone
-- 4. Admins and Clinics can approve/reject pending reports
-- 5. Users can update their own reports, Admins can update/delete any

-- =====================================================
-- 1. ADD APPROVAL COLUMNS TO TABLES
-- =====================================================

-- Add approval_status to water_quality_reports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'water_quality_reports' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE water_quality_reports ADD COLUMN approval_status TEXT DEFAULT 'pending_approval';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'water_quality_reports' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE water_quality_reports ADD COLUMN approved_by UUID REFERENCES profiles(id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'water_quality_reports' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE water_quality_reports ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'water_quality_reports' AND column_name = 'rejection_reason'
    ) THEN
        ALTER TABLE water_quality_reports ADD COLUMN rejection_reason TEXT;
    END IF;
END $$;

-- Add approval_status to disease_reports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'disease_reports' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE disease_reports ADD COLUMN approval_status TEXT DEFAULT 'pending_approval';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'disease_reports' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE disease_reports ADD COLUMN approved_by UUID REFERENCES profiles(id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'disease_reports' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE disease_reports ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'disease_reports' AND column_name = 'rejection_reason'
    ) THEN
        ALTER TABLE disease_reports ADD COLUMN rejection_reason TEXT;
    END IF;
END $$;

-- Add approval_status to health_alerts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'health_alerts' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE health_alerts ADD COLUMN approval_status TEXT DEFAULT 'pending_approval';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'health_alerts' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE health_alerts ADD COLUMN approved_by UUID REFERENCES profiles(id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'health_alerts' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE health_alerts ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add approval_status to health_campaigns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'health_campaigns' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE health_campaigns ADD COLUMN approval_status TEXT DEFAULT 'pending_approval';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'health_campaigns' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE health_campaigns ADD COLUMN approved_by UUID REFERENCES profiles(id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'health_campaigns' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE health_campaigns ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
END $$;

-- =====================================================
-- 2. DROP EXISTING POLICIES
-- =====================================================
DROP POLICY IF EXISTS "water_reports_select" ON water_quality_reports;
DROP POLICY IF EXISTS "water_reports_insert" ON water_quality_reports;
DROP POLICY IF EXISTS "water_reports_update" ON water_quality_reports;
DROP POLICY IF EXISTS "water_reports_delete" ON water_quality_reports;

DROP POLICY IF EXISTS "disease_reports_select" ON disease_reports;
DROP POLICY IF EXISTS "disease_reports_insert" ON disease_reports;
DROP POLICY IF EXISTS "disease_reports_update" ON disease_reports;
DROP POLICY IF EXISTS "disease_reports_delete" ON disease_reports;

DROP POLICY IF EXISTS "alerts_select" ON health_alerts;
DROP POLICY IF EXISTS "alerts_insert" ON health_alerts;
DROP POLICY IF EXISTS "alerts_update" ON health_alerts;
DROP POLICY IF EXISTS "alerts_delete" ON health_alerts;

DROP POLICY IF EXISTS "campaigns_select" ON health_campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON health_campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON health_campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON health_campaigns;

-- =====================================================
-- 3. WATER QUALITY REPORTS - POLICIES
-- =====================================================

-- SELECT: Users see approved reports + their own pending reports
-- Admin/Clinic see ALL reports (for approval workflow)
CREATE POLICY "water_reports_select"
ON water_quality_reports FOR SELECT
TO authenticated
USING (
    -- Admin and Clinic can see ALL reports for approval
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic')
    )
    OR
    -- User sees their own reports regardless of status
    reporter_id = auth.uid()
    OR
    -- Others only see approved reports
    approval_status = 'approved'
);

-- INSERT: Admin, Clinic, ASHA Worker can insert
CREATE POLICY "water_reports_insert"
ON water_quality_reports FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic', 'asha_worker')
    )
);

-- UPDATE: User can update own reports, Admin can update any
CREATE POLICY "water_reports_update"
ON water_quality_reports FOR UPDATE
TO authenticated
USING (
    -- Admin can update any report
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
    OR
    -- Clinic can update own reports AND can approve ASHA reports
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'clinic'
    )
    OR
    -- ASHA Worker can only update their own reports
    (reporter_id = auth.uid() AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'asha_worker'
    ))
);

-- DELETE: Only Admin can delete reports
CREATE POLICY "water_reports_delete"
ON water_quality_reports FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
);

-- =====================================================
-- 4. DISEASE REPORTS - POLICIES
-- =====================================================

-- SELECT: Admin/Clinic see all, others see approved + own
CREATE POLICY "disease_reports_select"
ON disease_reports FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic')
    )
    OR reporter_id = auth.uid()
    OR approval_status = 'approved'
);

-- INSERT: Only Admin & Clinic
CREATE POLICY "disease_reports_insert"
ON disease_reports FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic')
    )
);

-- UPDATE: Admin can update any, Clinic can update own
CREATE POLICY "disease_reports_update"
ON disease_reports FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
    OR
    (reporter_id = auth.uid() AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'clinic'
    ))
);

-- DELETE: Only Admin
CREATE POLICY "disease_reports_delete"
ON disease_reports FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
);

-- =====================================================
-- 5. HEALTH ALERTS - POLICIES
-- =====================================================

CREATE POLICY "alerts_select"
ON health_alerts FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic')
    )
    OR created_by = auth.uid()
    OR approval_status = 'approved'
);

CREATE POLICY "alerts_insert"
ON health_alerts FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic', 'asha_worker')
    )
);

CREATE POLICY "alerts_update"
ON health_alerts FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
    OR
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'clinic'
    )
    OR
    (created_by = auth.uid() AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'asha_worker'
    ))
);

CREATE POLICY "alerts_delete"
ON health_alerts FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
);

-- =====================================================
-- 6. HEALTH CAMPAIGNS - POLICIES
-- =====================================================

CREATE POLICY "campaigns_select"
ON health_campaigns FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic')
    )
    OR organizer_id = auth.uid()
    OR approval_status = 'approved'
);

CREATE POLICY "campaigns_insert"
ON health_campaigns FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role IN ('admin', 'clinic', 'asha_worker')
    )
);

CREATE POLICY "campaigns_update"
ON health_campaigns FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
    OR
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'clinic'
    )
    OR
    (organizer_id = auth.uid() AND EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'asha_worker'
    ))
);

CREATE POLICY "campaigns_delete"
ON health_campaigns FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE profiles.id = auth.uid() 
        AND profiles.role = 'admin'
    )
);

-- =====================================================
-- 7. CREATE ADMIN USER FUNCTION
-- =====================================================

-- Function to create an admin user (run manually with specific email)
CREATE OR REPLACE FUNCTION create_admin_user(admin_email TEXT)
RETURNS void AS $$
BEGIN
    UPDATE profiles 
    SET role = 'admin', is_active = true 
    WHERE email = admin_email;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User with email % not found', admin_email;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 8. AUTO-APPROVAL TRIGGER FOR ADMIN/CLINIC REPORTS
-- =====================================================

-- Function to auto-approve reports with reporter_id column (disease_reports, water_quality_reports)
CREATE OR REPLACE FUNCTION auto_approve_reporter_id_report()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    -- Get the reporter's role
    SELECT role INTO reporter_role 
    FROM profiles 
    WHERE id = NEW.reporter_id;
    
    -- Auto-approve if submitted by admin or clinic
    IF reporter_role IN ('admin', 'clinic') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by := NEW.reporter_id;
        NEW.approved_at := NOW();
    ELSE
        -- ASHA worker reports need approval
        NEW.approval_status := 'pending_approval';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-approve reports with created_by column (health_alerts)
CREATE OR REPLACE FUNCTION auto_approve_created_by_report()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    -- Get the reporter's role
    SELECT role INTO reporter_role 
    FROM profiles 
    WHERE id = NEW.created_by;
    
    -- Auto-approve if submitted by admin or clinic
    IF reporter_role IN ('admin', 'clinic') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by := NEW.created_by;
        NEW.approved_at := NOW();
    ELSE
        -- ASHA worker reports need approval
        NEW.approval_status := 'pending_approval';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-approve campaigns with organizer_id column (health_campaigns)
CREATE OR REPLACE FUNCTION auto_approve_organizer_id_report()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    -- Get the organizer's role
    SELECT role INTO reporter_role 
    FROM profiles 
    WHERE id = NEW.organizer_id;
    
    -- Auto-approve if submitted by admin or clinic
    IF reporter_role IN ('admin', 'clinic') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by := NEW.organizer_id;
        NEW.approved_at := NOW();
    ELSE
        -- ASHA worker reports need approval
        NEW.approval_status := 'pending_approval';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to water_quality_reports (uses reporter_id)
DROP TRIGGER IF EXISTS auto_approve_water_report ON water_quality_reports;
CREATE TRIGGER auto_approve_water_report
    BEFORE INSERT ON water_quality_reports
    FOR EACH ROW
    EXECUTE FUNCTION auto_approve_reporter_id_report();

-- Apply trigger to health_alerts (uses created_by)
DROP TRIGGER IF EXISTS auto_approve_alert ON health_alerts;
CREATE TRIGGER auto_approve_alert
    BEFORE INSERT ON health_alerts
    FOR EACH ROW
    EXECUTE FUNCTION auto_approve_created_by_report();

-- Apply trigger to health_campaigns (uses organizer_id)
DROP TRIGGER IF EXISTS auto_approve_campaign ON health_campaigns;
CREATE TRIGGER auto_approve_campaign
    BEFORE INSERT ON health_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION auto_approve_organizer_id_report();

-- Disease reports are always from admin/clinic so auto-approve
DROP TRIGGER IF EXISTS auto_approve_disease_report ON disease_reports;
CREATE TRIGGER auto_approve_disease_report
    BEFORE INSERT ON disease_reports
    FOR EACH ROW
    EXECUTE FUNCTION auto_approve_report();

-- =====================================================
-- 9. UPDATE EXISTING REPORTS TO APPROVED
-- =====================================================
UPDATE water_quality_reports SET approval_status = 'approved' WHERE approval_status IS NULL;
UPDATE disease_reports SET approval_status = 'approved' WHERE approval_status IS NULL;
UPDATE health_alerts SET approval_status = 'approved' WHERE approval_status IS NULL;
UPDATE health_campaigns SET approval_status = 'approved' WHERE approval_status IS NULL;

-- =====================================================
-- HOW TO CREATE AN ADMIN:
-- =====================================================
-- 1. First, have the user sign up normally with their email
-- 2. Run this command in SQL Editor (replace with actual email):
--    SELECT create_admin_user('admin@example.com');
-- =====================================================

-- =====================================================
-- PERMISSION SUMMARY:
-- =====================================================
-- | Action              | Admin | Clinic | ASHA Worker | Volunteer |
-- |---------------------|-------|--------|-------------|-----------|
-- | View approved       |   ✅  |   ✅   |     ✅      |    ✅     |
-- | View pending        |   ✅  |   ✅   |   Own only  |    ❌     |
-- | Submit Disease      |   ✅  |   ✅   |     ❌      |    ❌     |
-- | Submit Water        |   ✅  |   ✅   |     ✅      |    ❌     |
-- | Submit Alert        |   ✅  |   ✅   |     ✅      |    ❌     |
-- | Submit Campaign     |   ✅  |   ✅   |     ✅      |    ❌     |
-- | Approve Reports     |   ✅  |   ✅   |     ❌      |    ❌     |
-- | Update Own Report   |   ✅  |   ✅   |     ✅      |    ❌     |
-- | Update Any Report   |   ✅  |   ❌   |     ❌      |    ❌     |
-- | Delete Any Report   |   ✅  |   ❌   |     ❌      |    ❌     |
-- | Auto-Approved       |   ✅  |   ✅   |     ❌      |    N/A    |
-- =====================================================

SELECT 'Approval system configured successfully!' as status;
