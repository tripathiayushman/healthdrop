-- =====================================================
-- DISTRICT_OFFICER_RLS.sql
-- Applies to: ALL tables that need district_officer support
--
-- Purpose:
--   Add the 'district_officer' role to every RLS policy
--   and trigger function in the system. The district_officer
--   has district-scoped authority — they can approve reports,
--   campaigns, and send alerts within their district, but
--   cannot see or modify data outside their district, cannot
--   change user roles, and cannot delete users.
--
-- What this script touches:
--   1. Auto-approval trigger functions (district_officer → auto-approved)
--   2. disease_reports  → INSERT + SELECT + UPDATE (approval)
--   3. water_quality_reports → INSERT + SELECT + UPDATE (approval)
--   4. health_campaigns → INSERT + UPDATE (approval, district-scoped)
--   5. campaigns (legacy) → INSERT + UPDATE (approval, district-scoped)
--   6. health_alerts → INSERT (district-scoped) + SELECT
--   7. profiles → SELECT (district_officer needs to read district peers)
--   8. notifications → INSERT (district_officer can send to district)
--
-- What this script deliberately does NOT change:
--   • profiles UPDATE/DELETE — district_officer cannot change user roles
--     or delete users (admin-only remains unchanged)
--   • disease_reports DELETE — admin-only, unchanged
--   • water_quality_reports DELETE — admin-only, unchanged
--
-- Safe to re-run: all DROPs use IF EXISTS.
-- Run this in Supabase SQL Editor.
-- =====================================================


-- =====================================================
-- SECTION 1: UPDATE AUTO-APPROVAL TRIGGER FUNCTIONS
--
-- The original functions in APPROVAL_SYSTEM.sql only
-- auto-approve 'admin' and 'clinic'. We extend each
-- to also auto-approve district_officer submissions,
-- since they are trusted district-level authorities.
-- =====================================================

-- 1a. Reports with reporter_id column (disease_reports, water_quality_reports)
CREATE OR REPLACE FUNCTION auto_approve_reporter_id_report()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role
    FROM profiles
    WHERE id = NEW.reporter_id;

    -- Auto-approve for admin, clinic, and district_officer
    IF reporter_role IN ('admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.reporter_id;
        NEW.approved_at     := NOW();
    ELSE
        -- asha_worker reports go to pending; volunteer is blocked by INSERT policy
        NEW.approval_status := 'pending_approval';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1b. Alerts with created_by column (health_alerts)
CREATE OR REPLACE FUNCTION auto_approve_created_by_report()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role
    FROM profiles
    WHERE id = NEW.created_by;

    IF reporter_role IN ('admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.created_by;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1c. Campaigns with organizer_id column (health_campaigns)
CREATE OR REPLACE FUNCTION auto_approve_organizer_id_report()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role
    FROM profiles
    WHERE id = NEW.organizer_id;

    IF reporter_role IN ('admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.organizer_id;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1d. Campaigns with created_by column (campaigns legacy table)
CREATE OR REPLACE FUNCTION auto_approve_created_by_campaign()
RETURNS TRIGGER AS $$
DECLARE
    submitter_role TEXT;
BEGIN
    SELECT role INTO submitter_role
    FROM profiles
    WHERE id = NEW.created_by;

    IF submitter_role IN ('admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.created_by;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- SECTION 2: disease_reports
-- =====================================================

-- ── 2a. INSERT: add district_officer to authorised roles ──────────────────
-- The current policy (from RESTRICT_REPORT_INSERT_RLS.sql) only allows
-- admin, clinic, asha_worker. District officers should also be able to
-- submit disease reports for their district.

DROP POLICY IF EXISTS "Restrict insert disease reports to authorised roles" ON disease_reports;

CREATE POLICY "Restrict insert disease reports to authorised roles"
ON disease_reports
FOR INSERT
WITH CHECK (
    -- Must be inserting as themselves
    reporter_id = auth.uid()
    AND
    -- Role must be one of the authorised roles (volunteer excluded)
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id   = auth.uid()
          AND profiles.role IN ('admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);


-- ── 2b. SELECT: add district_officer visibility path ─────────────────────
-- The current policy (from DISTRICT_REPORT_VISIBILITY.sql) has 7 paths.
-- We add a PATH 8 for district_officer:
--   • Own submitted reports (any status)
--   • All reports in their district (any status) — enables approval workflow
--   • district_officer CANNOT see approved reports from other districts
--     (unlike clinic). This enforces the "no data outside district" rule.

DROP POLICY IF EXISTS "District based disease reports visibility"        ON disease_reports;
DROP POLICY IF EXISTS "District based disease reports visibility "       ON disease_reports; -- trailing-space variant

CREATE POLICY "District based disease reports visibility"
ON disease_reports
FOR SELECT
TO authenticated
USING (
    -- ── PATH 1: Admin — all reports globally ─────────────────────────────
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'admin'
          AND profiles.is_active = TRUE
    )

    OR

    -- ── PATH 2: Clinic — own submitted reports (any status) ───────────────
    (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ── PATH 3: Clinic — all reports in their district (any status) ───────
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND profiles.district  = disease_reports.district
    )

    OR

    -- ── PATH 4: Clinic — approved reports nationwide ──────────────────────
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ── PATH 5: ASHA Worker — own submitted reports (any status) ─────────
    (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ── PATH 6: ASHA Worker — approved reports in own district ───────────
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
              AND profiles.district  = disease_reports.district
        )
    )

    OR

    -- ── PATH 7: Volunteer — approved reports nationwide ───────────────────
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'volunteer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ── PATH 8: District Officer — own submitted reports (any status) ─────
    -- District officers can always track their own submissions.
    (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'district_officer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ── PATH 9: District Officer — all reports in their district ──────────
    -- District officers can see ALL reports (any approval_status) within
    -- their district so they can perform oversight and approval duties.
    -- They CANNOT see reports from outside their district.
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = disease_reports.district
    )
);


-- ── 2c. UPDATE: district_officer can approve reports in their district ────
-- The original "disease_reports_update" policy (APPROVAL_SYSTEM.sql) only
-- allows admin full access and clinic/asha_worker own-report access.
-- We add a district-scoped UPDATE policy for district_officer so they can
-- set approval_status on reports within their district.

-- Drop the legacy "disease_reports_update" policy and rebuild it with all roles.
DROP POLICY IF EXISTS "disease_reports_update"                              ON disease_reports;
DROP POLICY IF EXISTS "District Officer district update disease_reports"    ON disease_reports;

-- Admin: unrestricted UPDATE on all disease reports.
DROP POLICY IF EXISTS "Admin full update disease_reports" ON disease_reports;
CREATE POLICY "Admin full update disease_reports"
ON disease_reports
FOR UPDATE
TO authenticated
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

-- Clinic: can update (approve) any report in their district OR their own reports.
DROP POLICY IF EXISTS "Clinic update disease_reports" ON disease_reports;
CREATE POLICY "Clinic update disease_reports"
ON disease_reports
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          -- Either the report is in the clinic's district OR the clinic submitted it
          AND (profiles.district = disease_reports.district OR reporter_id = auth.uid())
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND (profiles.district = disease_reports.district OR reporter_id = auth.uid())
    )
);

-- ASHA Worker: can update only their own reports, cannot self-approve.
DROP POLICY IF EXISTS "ASHA own update disease_reports" ON disease_reports;
CREATE POLICY "ASHA own update disease_reports"
ON disease_reports
FOR UPDATE
TO authenticated
USING (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'asha_worker'
          AND profiles.is_active = TRUE
    )
)
WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'asha_worker'
          AND profiles.is_active = TRUE
    )
    -- ASHA workers cannot self-approve — block writing approval_status = 'approved'
    AND (approval_status IS NULL OR approval_status = 'pending_approval')
);

-- District Officer: can approve/update reports in their district.
-- They CANNOT touch reports outside their district (USING clause enforces district match).
CREATE POLICY "District Officer district update disease_reports"
ON disease_reports
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = disease_reports.district
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          -- Re-validate district match in the post-update state
          AND profiles.district  = disease_reports.district
    )
);


-- =====================================================
-- SECTION 3: water_quality_reports
-- =====================================================

-- ── 3a. INSERT: add district_officer ─────────────────────────────────────
DROP POLICY IF EXISTS "Restrict insert water reports to authorised roles"    ON water_quality_reports;

CREATE POLICY "Restrict insert water reports to authorised roles"
ON water_quality_reports
FOR INSERT
WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id   = auth.uid()
          AND profiles.role IN ('admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);


-- ── 3b. SELECT: district-based visibility for water_quality_reports ───────
-- The original "water_reports_select" (from APPROVAL_SYSTEM.sql) gives
-- admin/clinic full access and others only approved+own. We now apply the
-- same district-scoped model as disease_reports.

DROP POLICY IF EXISTS "water_reports_select"                                ON water_quality_reports;
DROP POLICY IF EXISTS "District based water reports visibility"             ON water_quality_reports;

CREATE POLICY "District based water reports visibility"
ON water_quality_reports
FOR SELECT
TO authenticated
USING (
    -- Admin: all reports globally
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'admin'
          AND profiles.is_active = TRUE
    )

    OR

    -- Clinic: own reports (any status)
    (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- Clinic: all reports in their district (any status)
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND profiles.district  = water_quality_reports.district
    )

    OR

    -- Clinic: approved reports nationwide
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ASHA Worker: own reports (any status)
    (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ASHA Worker: approved reports in own district only
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
              AND profiles.district  = water_quality_reports.district
        )
    )

    OR

    -- Volunteer: approved reports nationwide (read-only)
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'volunteer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- District Officer: own submitted reports (any status)
    (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'district_officer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- District Officer: ALL reports in their district (any status)
    -- Enables approval workflow within the district.
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = water_quality_reports.district
    )
);


-- ── 3c. UPDATE: district_officer can approve water reports in district ────
DROP POLICY IF EXISTS "water_reports_update"                                ON water_quality_reports;
DROP POLICY IF EXISTS "Admin full update water_quality_reports"             ON water_quality_reports;
DROP POLICY IF EXISTS "Clinic update water_quality_reports"                 ON water_quality_reports;
DROP POLICY IF EXISTS "ASHA own update water_quality_reports"               ON water_quality_reports;
DROP POLICY IF EXISTS "District Officer district update water_quality_reports" ON water_quality_reports;

-- Admin: unrestricted
CREATE POLICY "Admin full update water_quality_reports"
ON water_quality_reports
FOR UPDATE
TO authenticated
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

-- Clinic: own reports OR district reports
CREATE POLICY "Clinic update water_quality_reports"
ON water_quality_reports
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND (profiles.district = water_quality_reports.district OR reporter_id = auth.uid())
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND (profiles.district = water_quality_reports.district OR reporter_id = auth.uid())
    )
);

-- ASHA Worker: own reports, cannot self-approve
CREATE POLICY "ASHA own update water_quality_reports"
ON water_quality_reports
FOR UPDATE
TO authenticated
USING (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'asha_worker'
          AND profiles.is_active = TRUE
    )
)
WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'asha_worker'
          AND profiles.is_active = TRUE
    )
    AND (approval_status IS NULL OR approval_status = 'pending_approval')
);

-- District Officer: approve/update water reports in their district
CREATE POLICY "District Officer district update water_quality_reports"
ON water_quality_reports
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = water_quality_reports.district
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = water_quality_reports.district
    )
);


-- =====================================================
-- SECTION 4: health_campaigns
-- =====================================================

-- ── 4a. INSERT: district_officer can create campaigns ────────────────────
-- The current "campaigns_insert" policy (from CAMPAIGN_APPROVAL_POLICY_FIX.sql)
-- only allows admin, clinic, asha_worker. Add district_officer.
DROP POLICY IF EXISTS "campaigns_insert" ON health_campaigns;

CREATE POLICY "campaigns_insert"
ON health_campaigns
FOR INSERT
TO authenticated
WITH CHECK (
    organizer_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      IN ('admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);


-- ── 4b. SELECT: district_officer can view campaigns in their district ─────
-- The current "campaigns_select" only allows admin/clinic all access +
-- organizer + approved. We rebuild with district_officer path.
DROP POLICY IF EXISTS "campaigns_select" ON health_campaigns;

CREATE POLICY "campaigns_select"
ON health_campaigns
FOR SELECT
TO authenticated
USING (
    -- Admin: see all
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'admin'
          AND profiles.is_active = TRUE
    )

    OR

    -- Clinic: see all campaigns in their district + own + approved
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND profiles.district  = health_campaigns.district
    )

    OR

    (
        organizer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ASHA Worker: own campaigns + approved in their district
    (
        organizer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
        )
    )

    OR

    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
              AND profiles.district  = health_campaigns.district
        )
    )

    OR

    -- Volunteer: approved campaigns only (for enrollment)
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'volunteer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- District Officer: own created campaigns (any status)
    (
        organizer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'district_officer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- District Officer: ALL campaigns in their district (any status)
    -- Enables district-level approval and oversight.
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = health_campaigns.district
    )
);


-- ── 4c. UPDATE: district_officer can approve campaigns in their district ──
-- From CAMPAIGN_APPROVAL_POLICY_FIX.sql we have: Admin / Clinic district /
-- Clinic own / ASHA own. Add District Officer district-scoped approval path.

DROP POLICY IF EXISTS "District Officer district update health_campaigns" ON health_campaigns;

CREATE POLICY "District Officer district update health_campaigns"
ON health_campaigns
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = health_campaigns.district
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          -- Re-validate district in post-update state
          AND profiles.district  = health_campaigns.district
    )
);


-- =====================================================
-- SECTION 5: campaigns (legacy table)
-- =====================================================

DO $do$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'campaigns') THEN

        -- 5a. INSERT: add district_officer
        DROP POLICY IF EXISTS "campaigns_insert" ON campaigns;
        -- NOTE: campaigns table uses created_by (not organizer_id)
        EXECUTE $inner$
            CREATE POLICY "campaigns_insert"
            ON campaigns
            FOR INSERT
            TO authenticated
            WITH CHECK (
                created_by = auth.uid()
                AND EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id        = auth.uid()
                      AND profiles.role      IN ('admin','clinic','asha_worker','district_officer')
                      AND profiles.is_active = TRUE
                )
            )
        $inner$;

        -- 5b. UPDATE: district_officer district-scoped approval
        DROP POLICY IF EXISTS "District Officer district update campaigns" ON campaigns;
        EXECUTE $inner$
            CREATE POLICY "District Officer district update campaigns"
            ON campaigns
            FOR UPDATE
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id        = auth.uid()
                      AND profiles.role      = 'district_officer'
                      AND profiles.is_active = TRUE
                      AND profiles.district  = campaigns.district
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id        = auth.uid()
                      AND profiles.role      = 'district_officer'
                      AND profiles.is_active = TRUE
                      AND profiles.district  = campaigns.district
                )
            )
        $inner$;

    END IF;
END $do$;


-- =====================================================
-- SECTION 6: health_alerts
-- =====================================================

-- ── 6a. INSERT: district_officer can send alerts (district-scoped) ────────
-- The original "alerts_insert" policy allows admin, clinic, asha_worker.
-- District officers should also be able to send alerts, however they are
-- constrained to their own district via the district column in the alert row.
DROP POLICY IF EXISTS "alerts_insert"                                       ON health_alerts;
DROP POLICY IF EXISTS "District Officer district insert health_alerts"      ON health_alerts;

-- Rebuild alerts_insert to include district_officer
CREATE POLICY "alerts_insert"
ON health_alerts
FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      IN ('admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
    -- District officer must insert an alert whose district matches their profile.district
    -- (If the role is NOT district_officer, the district check is skipped.)
    AND (
        -- Non-district-officer roles: no district restriction
        NOT EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id   = auth.uid()
              AND profiles.role = 'district_officer'
        )
        OR
        -- District officer: alert district must match their profile district
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id       = auth.uid()
              AND profiles.role     = 'district_officer'
              AND profiles.district = health_alerts.district
        )
    )
);


-- ── 6b. SELECT: district_officer can see alerts in their district ─────────
DROP POLICY IF EXISTS "alerts_select"                               ON health_alerts;

CREATE POLICY "alerts_select"
ON health_alerts
FOR SELECT
TO authenticated
USING (
    -- Admin: all alerts
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'admin'
          AND profiles.is_active = TRUE
    )

    OR

    -- Clinic: own + district + approved nationwide
    (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id   = auth.uid()
              AND profiles.role = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND profiles.district  = health_alerts.district
    )

    OR

    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'clinic'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- ASHA Worker: own + approved in district
    (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id   = auth.uid()
              AND profiles.role = 'asha_worker'
              AND profiles.is_active = TRUE
        )
    )

    OR

    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
              AND profiles.district  = health_alerts.district
        )
    )

    OR

    -- Volunteer: approved alerts only
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'volunteer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    -- District Officer: own alerts + all alerts in their district
    (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id   = auth.uid()
              AND profiles.role = 'district_officer'
              AND profiles.is_active = TRUE
        )
    )

    OR

    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = health_alerts.district
    )
);


-- ── 6c. UPDATE/approval for alerts by district_officer ───────────────────
DROP POLICY IF EXISTS "alerts_update"                                       ON health_alerts;
DROP POLICY IF EXISTS "District Officer district update health_alerts"      ON health_alerts;

-- Rebuild alerts_update to include district_officer
CREATE POLICY "alerts_update"
ON health_alerts
FOR UPDATE
TO authenticated
USING (
    -- Admin: unrestricted
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'admin'
          AND profiles.is_active = TRUE
    )
    OR
    -- Clinic: own + district
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND (profiles.district = health_alerts.district OR created_by = auth.uid())
    )
    OR
    -- ASHA: own alerts only
    (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id        = auth.uid()
              AND profiles.role      = 'asha_worker'
              AND profiles.is_active = TRUE
        )
    )
    OR
    -- District Officer: alerts in their district
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = health_alerts.district
    )
);


-- =====================================================
-- SECTION 7: profiles
-- =====================================================

-- ── 7a. SELECT: district_officer can view profiles in their district ──────
-- The current "profiles_select_policy" only allows self or admin.
-- A district officer needs to read other profiles in their district
-- (e.g., to identify ASHA workers to supervise, see reporter names).
-- We do NOT allow district_officer to UPDATE or DELETE profiles.

DROP POLICY IF EXISTS "profiles_select_policy"                              ON profiles;

CREATE POLICY "profiles_select_policy"
ON profiles
FOR SELECT
TO authenticated
USING (
    -- Own profile
    auth.uid() = id

    OR

    -- Admin: see all
    EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id        = auth.uid()
          AND p.role      = 'admin'
          AND p.is_active = TRUE
    )

    OR

    -- District Officer: see profiles within their district
    EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id        = auth.uid()
          AND p.role      = 'district_officer'
          AND p.is_active = TRUE
          AND p.district  = profiles.district   -- profiles here refers to the row being checked
    )
);

-- profiles_update_policy and profiles_delete_policy remain UNCHANGED
-- (district_officer cannot change roles or delete users — admin-only)


-- =====================================================
-- SECTION 8: notifications
-- =====================================================

-- District officers can send district-targeted notifications
-- and receive notifications targeted at their district.
-- The existing notifications policies use RLS + in-app filtering.
-- We ensure district_officer is treated the same as clinic here.

-- Most notification policies are already open enough (user_id = uid OR broadcast).
-- The sending restriction should be enforced at the application layer;
-- however, if there's an INSERT policy we update it here.

DROP POLICY IF EXISTS "notifications_insert"                                ON notifications;

DO $do$
BEGIN
    -- Re-create notifications_insert allowing admin, clinic, district_officer, asha_worker to send
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notifications') THEN
        EXECUTE $inner$
            CREATE POLICY "notifications_insert"
            ON notifications
            FOR INSERT
            TO authenticated
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id        = auth.uid()
                      AND profiles.role      IN ('admin','clinic','district_officer','asha_worker')
                      AND profiles.is_active = TRUE
                )
            )
        $inner$;
    END IF;
END $do$;


-- =====================================================
-- SECTION 9: VERIFICATION QUERIES
-- Run these after applying to confirm correct state.
-- =====================================================

-- All policies across affected tables
SELECT
    tablename,
    policyname,
    cmd        AS operation,
    roles
FROM pg_policies
WHERE tablename IN (
    'disease_reports',
    'water_quality_reports',
    'health_campaigns',
    'campaigns',
    'health_alerts',
    'profiles',
    'notifications'
)
ORDER BY tablename, cmd, policyname;

-- Confirm trigger functions have district_officer in auto-approval logic
SELECT
    routine_name,
    routine_definition
FROM information_schema.routines
WHERE routine_name IN (
    'auto_approve_reporter_id_report',
    'auto_approve_created_by_report',
    'auto_approve_organizer_id_report',
    'auto_approve_created_by_campaign'
)
ORDER BY routine_name;

SELECT 'district_officer RLS applied successfully' AS status;
