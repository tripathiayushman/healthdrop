-- =========================================================
-- ALERT_APPROVAL_WORKFLOW.sql
-- ASHA workers cannot directly publish alerts — they submit
-- alert *requests*.  Admin / Clinic must approve before the
-- alert becomes visible to the public.
--
-- Run this ONCE in the Supabase SQL Editor.
-- =========================================================

-- ─── 1. SCHEMA UPDATE ─────────────────────────────────────
-- Add approval columns to health_alerts (idempotent)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'health_alerts' AND column_name = 'approval_status'
    ) THEN
        ALTER TABLE health_alerts
            ADD COLUMN approval_status TEXT DEFAULT 'pending_approval';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'health_alerts' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE health_alerts
            ADD COLUMN approved_by UUID REFERENCES profiles(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'health_alerts' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE health_alerts
            ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'health_alerts' AND column_name = 'rejection_reason'
    ) THEN
        ALTER TABLE health_alerts
            ADD COLUMN rejection_reason TEXT;
    END IF;
END $$;

-- Back-fill: mark all existing alerts as approved
UPDATE health_alerts
SET approval_status = 'approved'
WHERE approval_status IS NULL;


-- ─── 2. AUTO-APPROVE TRIGGER ──────────────────────────────
-- Admin / Clinic → auto-approved on INSERT
-- ASHA worker   → pending_approval

DROP TRIGGER IF EXISTS auto_approve_alert ON health_alerts;

CREATE OR REPLACE FUNCTION auto_approve_alert_fn()
RETURNS TRIGGER AS $$
DECLARE
    reporter_role TEXT;
BEGIN
    SELECT role INTO reporter_role
    FROM profiles
    WHERE id = NEW.created_by;

    IF reporter_role IN ('admin', 'clinic') THEN
        NEW.approval_status := 'approved';
        NEW.approved_by     := NEW.created_by;
        NEW.approved_at     := NOW();
    ELSE
        NEW.approval_status := 'pending_approval';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_approve_alert
    BEFORE INSERT ON health_alerts
    FOR EACH ROW
    EXECUTE FUNCTION auto_approve_alert_fn();


-- ─── 3. RLS POLICIES ──────────────────────────────────────
-- Drop old policies first (idempotent)
DROP POLICY IF EXISTS "health_alerts_select"  ON health_alerts;
DROP POLICY IF EXISTS "alerts_select"         ON health_alerts;
DROP POLICY IF EXISTS "health_alerts_insert"  ON health_alerts;
DROP POLICY IF EXISTS "alerts_insert"         ON health_alerts;
DROP POLICY IF EXISTS "health_alerts_update"  ON health_alerts;
DROP POLICY IF EXISTS "alerts_update"         ON health_alerts;
DROP POLICY IF EXISTS "health_alerts_delete"  ON health_alerts;
DROP POLICY IF EXISTS "alerts_delete"         ON health_alerts;

ALTER TABLE health_alerts ENABLE ROW LEVEL SECURITY;

-- SELECT: everyone can see APPROVED alerts.
--         Admin / Clinic can also see pending & rejected.
--         ASHA can see their own pending alerts.
CREATE POLICY "alerts_select" ON health_alerts FOR SELECT USING (
    approval_status = 'approved'
    OR (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'clinic')
        )
    )
    OR created_by = auth.uid()
);

-- INSERT: admin, clinic, asha_worker, district_officer can create
CREATE POLICY "alerts_insert" ON health_alerts FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('admin', 'clinic', 'asha_worker', 'district_officer')
    )
);

-- UPDATE: only admin / clinic can update (for approval workflow)
CREATE POLICY "alerts_update" ON health_alerts FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('admin', 'clinic')
    )
);

-- DELETE: only admin can delete
CREATE POLICY "alerts_delete" ON health_alerts FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
    )
);

-- ─── 4. GRANT ──────────────────────────────────────────────
GRANT ALL ON health_alerts TO authenticated;

-- ─── DONE ──────────────────────────────────────────────────
SELECT '✅ Alert approval workflow deployed successfully.' AS status;
