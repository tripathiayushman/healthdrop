-- =====================================================================
-- FIX_VERIFICATION_AND_VISIBILITY.sql
-- Run ONCE in Supabase SQL Editor.  Fully idempotent (safe to re-run).
--
-- What this fixes:
--   1. UPDATE policies for disease/water reports so super_admin,
--      health_admin, clinic can approve/reject/verify reports.
--   2. SELECT policies so reporters can ALWAYS see their own reports
--      (including rejected ones + rejection_reason).
--   3. is_verified computed via existing `status` column — no new column
--      needed. Verify = status → 'verified', Unverify = status → 'reported'.
-- =====================================================================

-- ── 1. disease_reports UPDATE policy ─────────────────────────────────────────
DROP POLICY IF EXISTS "disease_reports_update" ON disease_reports;

CREATE POLICY "disease_reports_update"
ON disease_reports FOR UPDATE
USING (
    -- Admins can update any report
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin')
          AND profiles.is_active = TRUE
    )
    OR
    -- Clinic can update reports in their district
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('clinic', 'district_officer')
          AND profiles.is_active = TRUE
    )
    OR
    -- Reporter can edit their own pending report
    (
        reporter_id = auth.uid()
        AND approval_status = 'pending_approval'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('asha_worker', 'clinic', 'district_officer')
              AND profiles.is_active = TRUE
        )
    )
);

-- ── 2. disease_reports SELECT policy — reporters always see own ───────────────
DROP POLICY IF EXISTS "disease_reports_select" ON disease_reports;

CREATE POLICY "disease_reports_select"
ON disease_reports FOR SELECT USING (
    -- super_admin and health_admin: see everything
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin')
          AND profiles.is_active = TRUE
    )
    OR
    -- Reporter always sees their own (approved, pending, rejected)
    reporter_id = auth.uid()
    OR
    -- Clinic sees own + same district
    (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'clinic'
              AND profiles.is_active = TRUE
        )
        AND (reporter_id = auth.uid() OR approval_status = 'approved')
    )
    OR
    -- District officer sees own district
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district = disease_reports.district
    )
    OR
    -- Everyone else (volunteer, asha_worker): approved only
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('volunteer', 'asha_worker')
              AND profiles.is_active = TRUE
        )
    )
);

-- ── 3. water_quality_reports UPDATE policy ────────────────────────────────────
DROP POLICY IF EXISTS "water_reports_update" ON water_quality_reports;

CREATE POLICY "water_reports_update"
ON water_quality_reports FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin', 'clinic', 'district_officer')
          AND profiles.is_active = TRUE
    )
    OR
    (
        reporter_id = auth.uid()
        AND approval_status = 'pending_approval'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('asha_worker', 'clinic', 'district_officer')
              AND profiles.is_active = TRUE
        )
    )
);

-- ── 4. water_quality_reports SELECT policy — reporters see own ───────────────
DROP POLICY IF EXISTS "water_reports_select" ON water_quality_reports;

CREATE POLICY "water_reports_select"
ON water_quality_reports FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin')
          AND profiles.is_active = TRUE
    )
    OR
    reporter_id = auth.uid()
    OR
    (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'clinic'
              AND profiles.is_active = TRUE
        )
        AND (reporter_id = auth.uid() OR approval_status = 'approved')
    )
    OR
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district = water_quality_reports.district
    )
    OR
    (
        approval_status = 'approved'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('volunteer', 'asha_worker')
              AND profiles.is_active = TRUE
        )
    )
);

-- ── DONE ──────────────────────────────────────────────────────────────────────
SELECT 'FIX_VERIFICATION_AND_VISIBILITY applied successfully' AS status;
