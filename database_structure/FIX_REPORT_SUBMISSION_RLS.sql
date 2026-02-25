-- =====================================================
-- FIX_REPORT_SUBMISSION_RLS.sql  (v3 — idempotent)
-- FIXES:
--   1. Stale trigger on disease_reports calling
--      auto_approve_created_by_report() which tries
--      NEW.created_by but that column doesn't exist
--      on disease_reports (it uses reporter_id).
--   2. All INSERT RLS policies still reference the
--      old 'admin' role → blocks super_admin/health_admin.
--   3. SELECT policies rebuilt with correct roles.
--
-- Run ONCE in Supabase SQL Editor.  Safe to re-run.
-- =====================================================


-- ── 1. FIX STALE TRIGGER ON disease_reports ──────────────────────────────────
-- The wrong function (auto_approve_created_by_report) may have been
-- accidentally attached to disease_reports. Drop ALL approval triggers
-- on that table and re-create the correct one.

DROP TRIGGER IF EXISTS auto_approve_report          ON disease_reports;
DROP TRIGGER IF EXISTS auto_approve_disease_report  ON disease_reports;
DROP TRIGGER IF EXISTS trg_auto_approve_disease     ON disease_reports;
DROP TRIGGER IF EXISTS before_insert_disease_report ON disease_reports;

-- Recreate the CORRECT trigger (uses reporter_id, not created_by)
DROP TRIGGER IF EXISTS auto_approve_reporter_id_disease ON disease_reports;
CREATE TRIGGER auto_approve_reporter_id_disease
  BEFORE INSERT ON disease_reports
  FOR EACH ROW EXECUTE FUNCTION auto_approve_reporter_id_report();


-- ── 2. FIX STALE TRIGGER ON water_quality_reports ────────────────────────────

DROP TRIGGER IF EXISTS auto_approve_report          ON water_quality_reports;
DROP TRIGGER IF EXISTS auto_approve_water_report    ON water_quality_reports;
DROP TRIGGER IF EXISTS trg_auto_approve_water       ON water_quality_reports;
DROP TRIGGER IF EXISTS before_insert_water_report   ON water_quality_reports;

DROP TRIGGER IF EXISTS auto_approve_reporter_id_water ON water_quality_reports;
CREATE TRIGGER auto_approve_reporter_id_water
  BEFORE INSERT ON water_quality_reports
  FOR EACH ROW EXECUTE FUNCTION auto_approve_reporter_id_report();


-- ── 3. FIX STALE TRIGGER ON health_campaigns ─────────────────────────────────

DROP TRIGGER IF EXISTS auto_approve_report          ON health_campaigns;
DROP TRIGGER IF EXISTS auto_approve_campaign        ON health_campaigns;
DROP TRIGGER IF EXISTS trg_auto_approve_campaign    ON health_campaigns;
DROP TRIGGER IF EXISTS before_insert_campaign       ON health_campaigns;

DROP TRIGGER IF EXISTS auto_approve_organizer_id_campaign ON health_campaigns;
CREATE TRIGGER auto_approve_organizer_id_campaign
  BEFORE INSERT ON health_campaigns
  FOR EACH ROW EXECUTE FUNCTION auto_approve_organizer_id_report();


-- ── 4. FIX STALE TRIGGER ON health_alerts ────────────────────────────────────

DROP TRIGGER IF EXISTS auto_approve_alert           ON health_alerts;
DROP TRIGGER IF EXISTS trg_auto_approve_alert       ON health_alerts;
DROP TRIGGER IF EXISTS before_insert_alert          ON health_alerts;

DROP TRIGGER IF EXISTS auto_approve_alert_trigger ON health_alerts;
CREATE TRIGGER auto_approve_alert_trigger
  BEFORE INSERT ON health_alerts
  FOR EACH ROW EXECUTE FUNCTION auto_approve_alert_fn();


-- ── 5. FIX AUTO-APPROVAL TRIGGER FUNCTIONS (role: admin → super_admin/health_admin) ──

CREATE OR REPLACE FUNCTION auto_approve_reporter_id_report()
RETURNS TRIGGER AS $$
DECLARE reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role FROM profiles WHERE id = NEW.reporter_id;
    IF reporter_role IN ('super_admin', 'health_admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.reporter_id;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_approve_organizer_id_report()
RETURNS TRIGGER AS $$
DECLARE reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role FROM profiles WHERE id = NEW.organizer_id;
    IF reporter_role IN ('super_admin', 'health_admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.organizer_id;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auto_approve_alert_fn()
RETURNS TRIGGER AS $$
DECLARE reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role FROM profiles WHERE id = NEW.created_by;
    IF reporter_role IN ('super_admin', 'health_admin', 'clinic', 'district_officer') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.created_by;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 6. FIX disease_reports RLS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Restrict insert disease reports to authorised roles" ON disease_reports;
DROP POLICY IF EXISTS "disease_reports_insert" ON disease_reports;

CREATE POLICY "disease_reports_insert"
ON disease_reports FOR INSERT WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);

DROP POLICY IF EXISTS "District based disease reports visibility" ON disease_reports;
DROP POLICY IF EXISTS "disease_reports_select" ON disease_reports;

CREATE POLICY "disease_reports_select"
ON disease_reports FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE)
    OR (reporter_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE))
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE AND profiles.district = disease_reports.district)
    OR (approval_status = 'approved' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE))
    OR (reporter_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'asha_worker' AND profiles.is_active = TRUE))
    OR (approval_status = 'approved' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'asha_worker' AND profiles.is_active = TRUE AND profiles.district = disease_reports.district))
    OR (reporter_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'district_officer' AND profiles.is_active = TRUE))
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'district_officer' AND profiles.is_active = TRUE AND profiles.district = disease_reports.district)
    OR (approval_status = 'approved' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'volunteer' AND profiles.is_active = TRUE))
);

DROP POLICY IF EXISTS "disease_reports_delete" ON disease_reports;
DROP POLICY IF EXISTS "Admins can delete reports" ON disease_reports;
CREATE POLICY "disease_reports_delete"
ON disease_reports FOR DELETE
    USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE));


-- ── 7. FIX water_quality_reports RLS ─────────────────────────────────────────
DROP POLICY IF EXISTS "Restrict insert water reports to authorised roles" ON water_quality_reports;
DROP POLICY IF EXISTS "water_reports_insert" ON water_quality_reports;

CREATE POLICY "water_reports_insert"
ON water_quality_reports FOR INSERT WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);

DROP POLICY IF EXISTS "District based water reports visibility" ON water_quality_reports;
DROP POLICY IF EXISTS "water_reports_select" ON water_quality_reports;

CREATE POLICY "water_reports_select"
ON water_quality_reports FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE)
    OR (reporter_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE))
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE AND profiles.district = water_quality_reports.district)
    OR (approval_status = 'approved' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'clinic' AND profiles.is_active = TRUE))
    OR (reporter_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'asha_worker' AND profiles.is_active = TRUE))
    OR (approval_status = 'approved' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'asha_worker' AND profiles.is_active = TRUE AND profiles.district = water_quality_reports.district))
    OR (reporter_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'district_officer' AND profiles.is_active = TRUE))
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'district_officer' AND profiles.is_active = TRUE AND profiles.district = water_quality_reports.district)
    OR (approval_status = 'approved' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'volunteer' AND profiles.is_active = TRUE))
);

DROP POLICY IF EXISTS "water_reports_delete" ON water_quality_reports;
CREATE POLICY "water_reports_delete"
ON water_quality_reports FOR DELETE
    USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE));


-- ── 8. FIX health_campaigns RLS ──────────────────────────────────────────────
DROP POLICY IF EXISTS "campaigns_insert" ON health_campaigns;

CREATE POLICY "campaigns_insert"
ON health_campaigns FOR INSERT WITH CHECK (
    organizer_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);

DROP POLICY IF EXISTS "campaigns_select" ON health_campaigns;

CREATE POLICY "campaigns_select"
ON health_campaigns FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE)
    OR (approval_status = 'approved')
    OR (organizer_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('clinic', 'district_officer') AND profiles.is_active = TRUE AND profiles.district = health_campaigns.district)
);

DROP POLICY IF EXISTS "health_campaigns_delete" ON health_campaigns;
CREATE POLICY "health_campaigns_delete"
ON health_campaigns FOR DELETE
    USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE));


-- ── 9. FIX health_alerts RLS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "alerts_insert" ON health_alerts;
DROP POLICY IF EXISTS "Authenticated users can create alerts" ON health_alerts;

CREATE POLICY "alerts_insert"
ON health_alerts FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('super_admin', 'health_admin', 'clinic', 'asha_worker', 'district_officer')
          AND profiles.is_active = TRUE
    )
);

DROP POLICY IF EXISTS "alerts_delete" ON health_alerts;
DROP POLICY IF EXISTS "Admins can delete alerts" ON health_alerts;
CREATE POLICY "alerts_delete"
ON health_alerts FOR DELETE
    USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'health_admin') AND profiles.is_active = TRUE));


-- ── DONE ──────────────────────────────────────────────────────────────────────
-- To verify triggers are correct, run:
-- SELECT tgname, tgrelid::regclass, tgfoid::regproc
-- FROM pg_trigger
-- WHERE tgrelid::regclass::text IN ('disease_reports','water_quality_reports','health_campaigns','health_alerts')
-- AND NOT tgisinternal
-- ORDER BY tgrelid::regclass, tgname;
