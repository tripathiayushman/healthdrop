-- =====================================================
-- OUTBREAK_DETECTION.sql
-- Automated Outbreak Detection System
--
-- What this file does:
--   1. Creates the `outbreaks` table to store detected outbreaks
--   2. Creates the trigger function `detect_outbreak_after_report()`
--   3. Attaches the trigger AFTER INSERT on disease_reports
--   4. Implements duplicate-window guard (same disease + district within 7 days)
--   5. Auto-inserts notifications for admin (globally) and
--      clinics + district_officers in the affected district
--   6. Adds RLS policies on the outbreaks table
--
-- Detection Logic:
--   After every new disease_report insert, the trigger sums
--   cases_count for the same disease_name + district over the
--   past 7 days. If the running total exceeds 50, and no active
--   outbreak record exists for that disease+district within the
--   same 7-day window, a new outbreak is created and notifications
--   are dispatched.
--
-- Safe to re-run: uses IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE.
-- Run this in Supabase SQL Editor.
-- =====================================================


-- =====================================================
-- SECTION 1: outbreaks TABLE SCHEMA
-- =====================================================

CREATE TABLE IF NOT EXISTS outbreaks (
    -- Primary key
    id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,

    -- What outbreak is this?
    disease_name          TEXT          NOT NULL,
    district              TEXT          NOT NULL,
    state                 TEXT          NOT NULL,

    -- Aggregated metrics at time of detection
    total_cases           INTEGER       NOT NULL DEFAULT 0,
    total_deaths          INTEGER       NOT NULL DEFAULT 0,
    report_count          INTEGER       NOT NULL DEFAULT 1,  -- number of reports in window
    max_severity          TEXT,                              -- 'low','medium','high','critical'

    -- Detection window (the rolling 7-day window that triggered this)
    window_start          TIMESTAMPTZ   NOT NULL,  -- NOW() - 7 days at time of detection
    window_end            TIMESTAMPTZ   NOT NULL,  -- NOW() at time of detection

    -- Lifecycle
    status                TEXT          NOT NULL DEFAULT 'active',
    -- 'active'     → confirmed, under watch
    -- 'monitoring' → cases declining but not resolved
    -- 'resolved'   → closed by admin/clinic/district_officer

    -- Traceability
    triggered_by_report_id  UUID        REFERENCES disease_reports(id) ON DELETE SET NULL,
    detected_by_trigger      BOOLEAN    DEFAULT TRUE,         -- always true for auto-detected

    -- Response tracking
    alert_sent            BOOLEAN       DEFAULT FALSE,
    response_notes        TEXT,
    resolved_by           UUID          REFERENCES profiles(id) ON DELETE SET NULL,
    resolved_at           TIMESTAMPTZ,

    -- Timestamps
    created_at            TIMESTAMPTZ   DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   DEFAULT NOW(),

    -- Uniqueness guard: only one active outbreak per disease+district per 7-day window.
    -- Additional guard is enforced in the trigger logic via EXISTS check.
    CONSTRAINT outbreaks_positive_cases CHECK (total_cases >= 0),
    CONSTRAINT outbreaks_positive_deaths CHECK (total_deaths >= 0),
    CONSTRAINT outbreaks_valid_status CHECK (
        status IN ('active', 'monitoring', 'resolved')
    ),
    CONSTRAINT outbreaks_valid_severity CHECK (
        max_severity IS NULL
        OR max_severity IN ('low', 'medium', 'high', 'critical')
    )
);

-- Indexes for the most common query patterns
CREATE INDEX IF NOT EXISTS idx_outbreaks_disease_district
    ON outbreaks (disease_name, district);

CREATE INDEX IF NOT EXISTS idx_outbreaks_district
    ON outbreaks (district);

CREATE INDEX IF NOT EXISTS idx_outbreaks_status
    ON outbreaks (status);

CREATE INDEX IF NOT EXISTS idx_outbreaks_window_end
    ON outbreaks (window_end DESC);

CREATE INDEX IF NOT EXISTS idx_outbreaks_created_at
    ON outbreaks (created_at DESC);

-- Enable RLS
ALTER TABLE outbreaks ENABLE ROW LEVEL SECURITY;

-- updated_at auto-maintenance trigger
CREATE OR REPLACE FUNCTION set_outbreaks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbreaks_updated_at ON outbreaks;
CREATE TRIGGER trg_outbreaks_updated_at
    BEFORE UPDATE ON outbreaks
    FOR EACH ROW
    EXECUTE FUNCTION set_outbreaks_updated_at();


-- =====================================================
-- SECTION 2: RLS POLICIES FOR outbreaks
-- =====================================================

-- Drop any existing policies first (safe re-run)
DROP POLICY IF EXISTS "Admin full access outbreaks"                     ON outbreaks;
DROP POLICY IF EXISTS "Clinic select outbreaks"                         ON outbreaks;
DROP POLICY IF EXISTS "Clinic update outbreaks"                         ON outbreaks;
DROP POLICY IF EXISTS "District Officer select outbreaks"               ON outbreaks;
DROP POLICY IF EXISTS "District Officer update outbreaks"               ON outbreaks;
DROP POLICY IF EXISTS "ASHA Worker select outbreaks"                    ON outbreaks;
DROP POLICY IF EXISTS "Volunteer select outbreaks"                      ON outbreaks;

-- Admin: full access (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Admin full access outbreaks"
ON outbreaks
FOR ALL
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

-- Clinic: SELECT outbreaks in their district + all active outbreaks
-- (clinics need cross-district awareness for public health decision-making)
CREATE POLICY "Clinic select outbreaks"
ON outbreaks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
    )
);

-- Clinic: UPDATE to resolve/monitor outbreaks in their district
CREATE POLICY "Clinic update outbreaks"
ON outbreaks
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND profiles.district  = outbreaks.district
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'clinic'
          AND profiles.is_active = TRUE
          AND profiles.district  = outbreaks.district
    )
);

-- District Officer: SELECT outbreaks in their district only
CREATE POLICY "District Officer select outbreaks"
ON outbreaks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = outbreaks.district
    )
);

-- District Officer: UPDATE to resolve/monitor outbreaks in their district
CREATE POLICY "District Officer update outbreaks"
ON outbreaks
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = outbreaks.district
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'district_officer'
          AND profiles.is_active = TRUE
          AND profiles.district  = outbreaks.district
    )
);

-- ASHA Worker: SELECT outbreaks in their district (situational awareness)
CREATE POLICY "ASHA Worker select outbreaks"
ON outbreaks
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'asha_worker'
          AND profiles.is_active = TRUE
          AND profiles.district  = outbreaks.district
    )
);

-- Volunteer: SELECT all active outbreaks (public health awareness)
CREATE POLICY "Volunteer select outbreaks"
ON outbreaks
FOR SELECT
TO authenticated
USING (
    status IN ('active', 'monitoring')
    AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'volunteer'
          AND profiles.is_active = TRUE
    )
);


-- =====================================================
-- SECTION 3: OUTBREAK DETECTION TRIGGER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION detect_outbreak_after_report()
RETURNS TRIGGER AS $$
DECLARE
    -- Configuration
    v_case_threshold    INTEGER  := 50;        -- cases in window before outbreak declared
    v_window_days       INTEGER  := 7;         -- rolling window in days

    -- Aggregation results
    v_total_cases       INTEGER;
    v_total_deaths      INTEGER;
    v_report_count      INTEGER;
    v_max_severity      TEXT;
    v_state             TEXT;

    -- Duplicate check
    v_existing_outbreak_id  UUID;

    -- Outbreak row
    v_outbreak_id UUID;
    v_window_start TIMESTAMPTZ;
    v_window_end   TIMESTAMPTZ;

    -- Notification message
    v_notif_title   TEXT;
    v_notif_message TEXT;
BEGIN
    -- Only process approved or pending reports that have actual case data.
    -- Rejected rows should not trigger outbreak detection.
    IF NEW.approval_status = 'rejected' THEN
        RETURN NEW;
    END IF;

    -- Define the rolling window boundaries
    v_window_end   := NOW();
    v_window_start := NOW() - (v_window_days || ' days')::INTERVAL;

    -- ── STEP 1: Aggregate cases for this disease+district in the window ──
    SELECT
        COALESCE(SUM(dr.cases_count), 0),
        COALESCE(SUM(dr.deaths_count), 0),
        COUNT(dr.id),
        -- Map severity to a numeric rank so we can pick the MAX
        CASE MAX(
            CASE dr.severity
                WHEN 'critical' THEN 4
                WHEN 'high'     THEN 3
                WHEN 'medium'   THEN 2
                WHEN 'low'      THEN 1
                ELSE 0
            END
        )
            WHEN 4 THEN 'critical'
            WHEN 3 THEN 'high'
            WHEN 2 THEN 'medium'
            WHEN 1 THEN 'low'
            ELSE NULL
        END,
        MAX(dr.state)   -- state should be the same for same district
    INTO
        v_total_cases,
        v_total_deaths,
        v_report_count,
        v_max_severity,
        v_state
    FROM disease_reports dr
    WHERE dr.disease_name      = NEW.disease_name
      AND dr.district          = NEW.district
      AND dr.approval_status  != 'rejected'
      AND dr.created_at       >= v_window_start
      AND dr.created_at       <= v_window_end;

    -- ── STEP 2: Check if threshold is exceeded ───────────────────────────
    IF v_total_cases <= v_case_threshold THEN
        -- Threshold not met — nothing to do
        RETURN NEW;
    END IF;

    -- ── STEP 3: Duplicate guard — is there already an active outbreak ────
    --           for this disease+district within the 7-day window?
    SELECT id INTO v_existing_outbreak_id
    FROM outbreaks
    WHERE disease_name = NEW.disease_name
      AND district     = NEW.district
      AND status      != 'resolved'
      AND detected_at >= v_window_start   -- outbreak was detected in this window
    LIMIT 1;

    IF v_existing_outbreak_id IS NOT NULL THEN
        -- Outbreak already recorded — update its running totals instead of
        -- inserting a duplicate.
        UPDATE outbreaks
        SET
            total_cases  = v_total_cases,
            total_deaths = v_total_deaths,
            report_count = v_report_count,
            max_severity = v_max_severity,
            window_start = v_window_start,
            window_end   = v_window_end,
            updated_at   = NOW()
        WHERE id = v_existing_outbreak_id;

        -- Exit — notification was already sent when outbreak was first created
        RETURN NEW;
    END IF;

    -- ── STEP 4: Insert new outbreak record ───────────────────────────────
    INSERT INTO outbreaks (
        disease_name,
        district,
        state,
        total_cases,
        total_deaths,
        report_count,
        max_severity,
        window_start,
        window_end,
        status,
        triggered_by_report_id,
        detected_by_trigger,
        alert_sent
    ) VALUES (
        NEW.disease_name,
        NEW.district,
        COALESCE(v_state, NEW.state),
        v_total_cases,
        v_total_deaths,
        v_report_count,
        v_max_severity,
        v_window_start,
        v_window_end,
        'active',
        NEW.id,
        TRUE,
        FALSE   -- will be set TRUE after notifications are sent below
    )
    RETURNING id INTO v_outbreak_id;

    -- ── STEP 5: Build notification content ───────────────────────────────
    v_notif_title := '⚠️ Outbreak Detected: ' || NEW.disease_name
                     || ' in ' || NEW.district;

    v_notif_message := 'Automated detection: ' || v_total_cases::TEXT
                       || ' cases of ' || NEW.disease_name
                       || ' reported in ' || NEW.district
                       || ' over the last 7 days ('
                       || v_report_count::TEXT || ' reports). '
                       || 'Max severity: ' || COALESCE(v_max_severity, 'unknown') || '. '
                       || 'Deaths: ' || v_total_deaths::TEXT || '. '
                       || 'Immediate review required.';

    -- ── STEP 6: Send notifications ────────────────────────────────────────
    --
    -- We insert 3 targeted broadcast notifications:
    --   a) One for ALL admins (no district filter — admins see everything)
    --   b) One for clinics IN the affected district
    --   c) One for district_officers IN the affected district
    --
    -- These use target_role + target_district so the notification service
    -- in the app (notificationsService.getAll) will filter them correctly.

    -- a) Admin broadcast (global, no district needed)
    INSERT INTO notifications (
        title,
        message,
        type,
        priority,
        target_role,
        target_district,
        related_type,
        related_id,
        is_read
    ) VALUES (
        v_notif_title,
        v_notif_message,
        'warning',
        'urgent',
        'admin',
        NULL,               -- admins see all districts
        'disease_report',
        NEW.id,
        FALSE
    );

    -- b) Clinic broadcast for the affected district
    INSERT INTO notifications (
        title,
        message,
        type,
        priority,
        target_role,
        target_district,
        related_type,
        related_id,
        is_read
    ) VALUES (
        v_notif_title,
        v_notif_message,
        'warning',
        'urgent',
        'clinic',
        NEW.district,       -- only clinics in this district
        'disease_report',
        NEW.id,
        FALSE
    );

    -- c) District Officer broadcast for the affected district
    INSERT INTO notifications (
        title,
        message,
        type,
        priority,
        target_role,
        target_district,
        related_type,
        related_id,
        is_read
    ) VALUES (
        v_notif_title,
        v_notif_message,
        'warning',
        'urgent',
        'district_officer',
        NEW.district,
        'disease_report',
        NEW.id,
        FALSE
    );

    -- ── STEP 7: Mark alert as sent on the outbreak record ────────────────
    UPDATE outbreaks
    SET alert_sent = TRUE
    WHERE id = v_outbreak_id;

    RETURN NEW;

EXCEPTION
    -- If anything goes wrong in the trigger, we must NOT block the original
    -- disease_report INSERT. Log to Postgres log and return NEW gracefully.
    WHEN OTHERS THEN
        RAISE WARNING 'detect_outbreak_after_report: error for report id=% disease=% district=%: %',
                      NEW.id, NEW.disease_name, NEW.district, SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- SECTION 4: ATTACH THE TRIGGER TO disease_reports
-- =====================================================

-- Drop existing trigger if it exists (safe re-run)
DROP TRIGGER IF EXISTS trg_detect_outbreak ON disease_reports;

-- AFTER INSERT: runs after the row is committed to the table,
-- so our aggregate query will include the new report itself.
CREATE TRIGGER trg_detect_outbreak
    AFTER INSERT ON disease_reports
    FOR EACH ROW
    EXECUTE FUNCTION detect_outbreak_after_report();


-- =====================================================
-- SECTION 5: HELPER — MANUAL OUTBREAK RESOLUTION
-- Clinics, admins, and district_officers can call this
-- function to close an active outbreak.
-- =====================================================

CREATE OR REPLACE FUNCTION resolve_outbreak(
    p_outbreak_id  UUID,
    p_notes        TEXT DEFAULT NULL
)
RETURNS outbreaks AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_district TEXT;
    v_outbreak outbreaks;
BEGIN
    -- Get caller's role and district
    SELECT role, district
    INTO v_caller_role, v_caller_district
    FROM profiles
    WHERE id = auth.uid();

    -- Fetch the outbreak
    SELECT * INTO v_outbreak FROM outbreaks WHERE id = p_outbreak_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Outbreak % not found', p_outbreak_id;
    END IF;

    -- Permission check
    IF v_caller_role = 'admin' THEN
        NULL; -- admin can resolve any outbreak
    ELSIF v_caller_role IN ('clinic', 'district_officer') THEN
        IF v_caller_district != v_outbreak.district THEN
            RAISE EXCEPTION 'Permission denied: your district does not match outbreak district';
        END IF;
    ELSE
        RAISE EXCEPTION 'Permission denied: only admin, clinic, or district_officer can resolve outbreaks';
    END IF;

    -- Resolve it
    UPDATE outbreaks
    SET
        status       = 'resolved',
        resolved_by  = auth.uid(),
        resolved_at  = NOW(),
        response_notes = COALESCE(p_notes, response_notes),
        updated_at   = NOW()
    WHERE id = p_outbreak_id
    RETURNING * INTO v_outbreak;

    RETURN v_outbreak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION resolve_outbreak(UUID, TEXT) TO authenticated;


-- =====================================================
-- SECTION 6: HELPER — THRESHOLD CONFIGURATION TABLE
-- (Optional) Allows admins to set per-disease thresholds
-- without changing trigger code. If no row matches the
-- disease, the trigger falls back to the default of 50.
-- =====================================================

CREATE TABLE IF NOT EXISTS outbreak_thresholds (
    id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
    disease_name  TEXT    UNIQUE NOT NULL,
    case_threshold INTEGER NOT NULL DEFAULT 50,
    window_days   INTEGER NOT NULL DEFAULT 7,
    notes         TEXT,
    created_by    UUID    REFERENCES profiles(id),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT threshold_positive CHECK (case_threshold > 0),
    CONSTRAINT window_positive CHECK (window_days > 0)
);

ALTER TABLE outbreak_thresholds ENABLE ROW LEVEL SECURITY;

-- Only admins can manage thresholds
DROP POLICY IF EXISTS "Admin manage outbreak_thresholds" ON outbreak_thresholds;
CREATE POLICY "Admin manage outbreak_thresholds"
ON outbreak_thresholds
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      = 'admin'
          AND profiles.is_active = TRUE
    )
);

-- All authenticated users can read thresholds (for display in UI)
DROP POLICY IF EXISTS "Authenticated read outbreak_thresholds" ON outbreak_thresholds;
CREATE POLICY "Authenticated read outbreak_thresholds"
ON outbreak_thresholds
FOR SELECT
TO authenticated
USING (TRUE);


-- =====================================================
-- SECTION 7: UPDATE TRIGGER TO USE CONFIGURABLE THRESHOLDS
-- Re-create the trigger function to look up per-disease
-- thresholds from outbreak_thresholds table.
-- =====================================================

CREATE OR REPLACE FUNCTION detect_outbreak_after_report()
RETURNS TRIGGER AS $$
DECLARE
    -- From outbreak_thresholds or defaults
    v_case_threshold    INTEGER  := 50;
    v_window_days       INTEGER  := 7;

    -- Aggregation results
    v_total_cases       INTEGER;
    v_total_deaths      INTEGER;
    v_report_count      INTEGER;
    v_max_severity      TEXT;
    v_state             TEXT;

    -- Duplicate check
    v_existing_outbreak_id  UUID;

    -- Outbreak row
    v_outbreak_id  UUID;
    v_window_start TIMESTAMPTZ;
    v_window_end   TIMESTAMPTZ;

    -- Notification
    v_notif_title   TEXT;
    v_notif_message TEXT;
BEGIN
    -- Skip rejected reports
    IF NEW.approval_status = 'rejected' THEN
        RETURN NEW;
    END IF;

    -- ── Load threshold from config table (falls back to defaults if missing) ──
    SELECT
        COALESCE(ot.case_threshold, 50),
        COALESCE(ot.window_days, 7)
    INTO
        v_case_threshold,
        v_window_days
    FROM outbreak_thresholds ot
    WHERE ot.disease_name = NEW.disease_name
    LIMIT 1;

    -- Default if no row found (SELECT INTO sets to NULL if nothing found)
    IF v_case_threshold IS NULL THEN v_case_threshold := 50; END IF;
    IF v_window_days    IS NULL THEN v_window_days    := 7;  END IF;

    -- Define window
    v_window_end   := NOW();
    v_window_start := NOW() - (v_window_days || ' days')::INTERVAL;

    -- ── Aggregate cases ───────────────────────────────────────────────────
    SELECT
        COALESCE(SUM(dr.cases_count), 0),
        COALESCE(SUM(dr.deaths_count), 0),
        COUNT(dr.id),
        CASE MAX(
            CASE dr.severity
                WHEN 'critical' THEN 4
                WHEN 'high'     THEN 3
                WHEN 'medium'   THEN 2
                WHEN 'low'      THEN 1
                ELSE 0
            END
        )
            WHEN 4 THEN 'critical'
            WHEN 3 THEN 'high'
            WHEN 2 THEN 'medium'
            WHEN 1 THEN 'low'
            ELSE NULL
        END,
        MAX(dr.state)
    INTO
        v_total_cases,
        v_total_deaths,
        v_report_count,
        v_max_severity,
        v_state
    FROM disease_reports dr
    WHERE dr.disease_name      = NEW.disease_name
      AND dr.district          = NEW.district
      AND dr.approval_status  != 'rejected'
      AND dr.created_at       >= v_window_start
      AND dr.created_at       <= v_window_end;

    -- ── Check threshold ───────────────────────────────────────────────────
    IF v_total_cases <= v_case_threshold THEN
        RETURN NEW;
    END IF;

    -- ── Duplicate guard ───────────────────────────────────────────────────
    SELECT id INTO v_existing_outbreak_id
    FROM outbreaks
    WHERE disease_name = NEW.disease_name
      AND district     = NEW.district
      AND status      != 'resolved'
      AND detected_at >= v_window_start
    LIMIT 1;

    IF v_existing_outbreak_id IS NOT NULL THEN
        -- Update running totals on existing outbreak
        UPDATE outbreaks
        SET
            total_cases  = v_total_cases,
            total_deaths = v_total_deaths,
            report_count = v_report_count,
            max_severity = v_max_severity,
            window_start = v_window_start,
            window_end   = v_window_end,
            updated_at   = NOW()
        WHERE id = v_existing_outbreak_id;

        RETURN NEW;  -- no new notification — already sent
    END IF;

    -- ── Insert new outbreak ───────────────────────────────────────────────
    INSERT INTO outbreaks (
        disease_name, district, state,
        total_cases, total_deaths, report_count, max_severity,
        window_start, window_end, status,
        triggered_by_report_id, detected_by_trigger, alert_sent
    ) VALUES (
        NEW.disease_name, NEW.district, COALESCE(v_state, NEW.state),
        v_total_cases, v_total_deaths, v_report_count, v_max_severity,
        v_window_start, v_window_end, 'active',
        NEW.id, TRUE, FALSE
    )
    RETURNING id INTO v_outbreak_id;

    -- ── Build notification text ───────────────────────────────────────────
    v_notif_title := '⚠️ Outbreak Alert: ' || NEW.disease_name
                     || ' — ' || NEW.district;

    v_notif_message :=
        'AUTOMATED DETECTION — Outbreak threshold exceeded.' || CHR(10) ||
        'Disease: '    || NEW.disease_name                  || CHR(10) ||
        'District: '   || NEW.district                      || CHR(10) ||
        'Total cases: '|| v_total_cases::TEXT || ' (threshold: ' || v_case_threshold::TEXT || ')' || CHR(10) ||
        'Reports: '    || v_report_count::TEXT || ' in the last ' || v_window_days::TEXT || ' days' || CHR(10) ||
        'Deaths: '     || v_total_deaths::TEXT             || CHR(10) ||
        'Max severity: '|| COALESCE(v_max_severity, 'unknown') || CHR(10) ||
        'Immediate action required.';

    -- ── Notify admin (global broadcast) ──────────────────────────────────
    INSERT INTO notifications (
        title, message, type, priority,
        target_role, target_district,
        related_type, related_id, is_read
    ) VALUES (
        v_notif_title, v_notif_message, 'warning', 'urgent',
        'admin', NULL,
        'disease_report', NEW.id, FALSE
    );

    -- ── Notify clinics in affected district ──────────────────────────────
    INSERT INTO notifications (
        title, message, type, priority,
        target_role, target_district,
        related_type, related_id, is_read
    ) VALUES (
        v_notif_title, v_notif_message, 'warning', 'urgent',
        'clinic', NEW.district,
        'disease_report', NEW.id, FALSE
    );

    -- ── Notify district_officers in affected district ─────────────────────
    INSERT INTO notifications (
        title, message, type, priority,
        target_role, target_district,
        related_type, related_id, is_read
    ) VALUES (
        v_notif_title, v_notif_message, 'warning', 'urgent',
        'district_officer', NEW.district,
        'disease_report', NEW.id, FALSE
    );

    -- ── Mark alert_sent on outbreak ───────────────────────────────────────
    UPDATE outbreaks
    SET alert_sent = TRUE
    WHERE id = v_outbreak_id;

    RETURN NEW;

EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING
            'detect_outbreak_after_report() failed for report id=% disease=% district=%: %',
            NEW.id, NEW.disease_name, NEW.district, SQLERRM;
        RETURN NEW;  -- never block the original INSERT
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- SECTION 8: GRANT TABLE PERMISSIONS
-- =====================================================

GRANT SELECT, INSERT, UPDATE ON outbreaks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbreak_thresholds TO authenticated;

-- Sequences (if UUID default uses a sequence — usually not needed for gen_random_uuid)
-- but grant on the table is sufficient.


-- =====================================================
-- SECTION 9: SEED EXAMPLE THRESHOLDS (OPTIONAL)
-- Remove or adjust before running in production.
-- These demonstrate how to configure per-disease thresholds.
-- =====================================================

INSERT INTO outbreak_thresholds (disease_name, case_threshold, window_days, notes)
VALUES
    ('Cholera',    10,  7, 'Higher sensitivity — very dangerous'),
    ('Dengue',     30,  7, 'Common in monsoon, threshold raised'),
    ('Malaria',    40,  7, 'Endemic regions may need higher threshold'),
    ('Typhoid',    25,  7, 'Waterborne — fast spread in poor sanitation areas'),
    ('COVID-19',   100, 7, 'Large population base, threshold is higher')
ON CONFLICT (disease_name) DO NOTHING;


-- =====================================================
-- SECTION 10: VERIFICATION QUERIES
-- Run after applying to confirm system is active.
-- =====================================================

-- Confirm trigger is attached
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'disease_reports'
  AND trigger_name = 'trg_detect_outbreak';

-- Confirm outbreaks table exists with correct columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'outbreaks'
ORDER BY ordinal_position;

-- Confirm RLS policies on outbreaks
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'outbreaks'
ORDER BY policyname;

-- Confirm outbreak_thresholds
SELECT * FROM outbreak_thresholds ORDER BY disease_name;

SELECT 'Outbreak Detection System configured successfully!' AS status;
