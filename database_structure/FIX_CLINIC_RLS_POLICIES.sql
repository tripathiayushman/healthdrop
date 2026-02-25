-- =========================================================
-- FIX CLINIC RLS POLICIES
-- Grants clinic role UPDATE access to verify/approve disease
-- and water reports. Run this in Supabase SQL Editor.
-- =========================================================

-- ── DISEASE REPORTS ──────────────────────────────────────

-- Allow clinic to update approval_status and status (verify/approve/reject)
DROP POLICY IF EXISTS "clinic_update_disease_reports" ON disease_reports;
CREATE POLICY "clinic_update_disease_reports"
  ON disease_reports FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'clinic'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'clinic'
    )
  );

-- ── WATER QUALITY REPORTS ────────────────────────────────

DROP POLICY IF EXISTS "clinic_update_water_quality_reports" ON water_quality_reports;
CREATE POLICY "clinic_update_water_quality_reports"
  ON water_quality_reports FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'clinic'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'clinic'
    )
  );

-- ── HEALTH CAMPAIGNS ─────────────────────────────────────
-- Remove clinic UPDATE access on campaigns (district_officer + admin only)

DROP POLICY IF EXISTS "clinic_update_health_campaigns" ON health_campaigns;

-- Ensure district_officer can update campaigns
DROP POLICY IF EXISTS "district_officer_update_campaigns" ON health_campaigns;
CREATE POLICY "district_officer_update_campaigns"
  ON health_campaigns FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','health_admin','district_officer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','health_admin','district_officer')
    )
  );

-- ── HEALTH CAMPAIGNS INSERT ───────────────────────────────
-- Remove clinic INSERT access on campaigns

DROP POLICY IF EXISTS "clinic_insert_campaigns" ON health_campaigns;

-- Ensure district_officer can insert campaigns
DROP POLICY IF EXISTS "district_officer_insert_campaigns" ON health_campaigns;
CREATE POLICY "district_officer_insert_campaigns"
  ON health_campaigns FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','health_admin','district_officer','asha_worker')
    )
  );

-- ── HEALTH CAMPAIGNS DELETE ───────────────────────────────
DROP POLICY IF EXISTS "clinic_delete_campaigns" ON health_campaigns;

DROP POLICY IF EXISTS "admin_delete_campaigns" ON health_campaigns;
CREATE POLICY "admin_delete_campaigns"
  ON health_campaigns FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','health_admin','district_officer')
    )
  );

-- ── DISEASE REPORTS DELETE ────────────────────────────────
-- Clinic should NOT be able to delete disease reports

DROP POLICY IF EXISTS "clinic_delete_disease_reports" ON disease_reports;

-- ── WATER QUALITY REPORTS DELETE ─────────────────────────
-- Clinic should NOT be able to delete water reports

DROP POLICY IF EXISTS "clinic_delete_water_quality_reports" ON water_quality_reports;

-- =========================================================
-- VERIFY: check current policies
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE tablename IN ('disease_reports','water_quality_reports','health_campaigns')
-- ORDER BY tablename, cmd;
-- =========================================================
