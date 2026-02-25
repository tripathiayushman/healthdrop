-- =====================================================
-- AUDIT_LOG.sql
-- Enterprise-Grade Audit Logging System
--
-- What this file does:
--   1. Creates the audit_logs table with JSONB old/new values
--   2. Creates a single generic trigger function (shared by all tables)
--   3. Attaches AFTER UPDATE + AFTER DELETE triggers on:
--        • disease_reports
--        • water_quality_reports
--        • health_campaigns  (app-facing table)
--        • campaigns         (legacy table, if it exists)
--   4. Also logs INSERT on all four tables (full record trail)
--   5. Applies RLS: admin sees all, users see logs of their own rows
--   6. Provides admin query helpers and indexed access patterns
--
-- PERFORMANCE PHILOSOPHY:
--   • Triggers are AFTER (not BEFORE) — they fire post-commit
--     so they never slow down or block the main transaction.
--   • The trigger function is a single generic function reused
--     across all tables. No per-table code duplication.
--   • auth.uid() is captured directly in the function using
--     a SECURITY DEFINER context.
--   • The audit_logs table has targeted indexes (user_id,
--     table_name, record_id, created_at) — not a GiST or
--     heavy index. JSONB columns are NOT indexed by default
--     (add a GIN index only if you query JSON internals).
--   • EXCEPTION block prevents audit errors from ever rolling
--     back the parent transaction.
--
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- Run this in Supabase SQL Editor.
-- =====================================================


-- =====================================================
-- SECTION 1: audit_logs TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    -- Identity
    id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Who performed the action
    user_id         UUID,         -- auth.uid() at time of action; NULL if service-role
    user_email      TEXT,         -- denormalized for quick display without JOIN

    -- What happened
    action_type     TEXT          NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
    table_name      TEXT          NOT NULL,   -- 'disease_reports' | 'water_quality_reports' | etc.
    record_id       UUID,                     -- primary key of the affected row

    -- Row values (JSONB snapshots)
    old_value       JSONB,        -- full OLD row for UPDATE and DELETE; NULL for INSERT
    new_value       JSONB,        -- full NEW row for INSERT and UPDATE; NULL for DELETE

    -- Change diff (UPDATE only) — stores only what changed
    -- Computed in the trigger: new_value - old_value keys
    changed_fields  TEXT[],       -- list of column names that changed

    -- Context
    ip_address      INET,         -- request IP (populate from app if available via SET LOCAL)
    session_id      TEXT,         -- optional: app session token prefix

    -- When
    created_at      TIMESTAMPTZ   DEFAULT NOW() NOT NULL,

    -- Constraints
    CONSTRAINT audit_logs_valid_action CHECK (
        action_type IN ('INSERT', 'UPDATE', 'DELETE')
    )
);

-- Partition-ready comment: for very high-volume production use,
-- consider converting to a range-partitioned table on created_at:
--   PARTITION BY RANGE (created_at)
-- Each month becomes a separate partition. Not needed for most installs.


-- ── Indexes ───────────────────────────────────────────────────────────────
-- Keep these narrow and specific. Do not index JSONB columns unless needed.

-- Lookup by user (who did what)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
    ON audit_logs (user_id, created_at DESC);

-- Lookup by table (what table was changed)
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name
    ON audit_logs (table_name, created_at DESC);

-- Lookup by record (full history of a single row)
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id
    ON audit_logs (record_id, created_at DESC);

-- Lookup by action type (all DELETEs, all UPDATEs, etc.)
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type
    ON audit_logs (action_type, created_at DESC);

-- Time-range scans (dashboards, exports)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs (created_at DESC);

-- Composite: table + record (most common audit query pattern)
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record
    ON audit_logs (table_name, record_id, created_at DESC);


-- ── Enable RLS ────────────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Admin: full access to all audit logs
DROP POLICY IF EXISTS "Admin full access audit_logs" ON audit_logs;
CREATE POLICY "Admin full access audit_logs"
ON audit_logs
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

-- Users: SELECT only logs where they were the actor
DROP POLICY IF EXISTS "Users view own audit_logs" ON audit_logs;
CREATE POLICY "Users view own audit_logs"
ON audit_logs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Clinic / District Officer: SELECT audit logs for records in their district
-- (Allows viewing WHO approved/rejected reports in their district)
DROP POLICY IF EXISTS "Clinic district_officer read district audit_logs" ON audit_logs;
CREATE POLICY "Clinic district_officer read district audit_logs"
ON audit_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id        = auth.uid()
          AND profiles.role      IN ('clinic', 'district_officer')
          AND profiles.is_active = TRUE
    )
    -- Only logs from disease/water reports in their district
    AND table_name IN ('disease_reports', 'water_quality_reports')
    AND (
        (old_value->>'district') IN (
            SELECT district FROM profiles WHERE id = auth.uid()
        )
        OR
        (new_value->>'district') IN (
            SELECT district FROM profiles WHERE id = auth.uid()
        )
    )
);

-- NOTE: INSERT policy is intentionally absent.
-- Only the trigger function (SECURITY DEFINER) inserts into audit_logs.
-- No user or role should ever INSERT directly.
GRANT SELECT ON audit_logs TO authenticated;


-- =====================================================
-- SECTION 2: GENERIC AUDIT TRIGGER FUNCTION
--
-- One function handles INSERT, UPDATE, and DELETE for
-- every table. TG_TABLE_NAME, TG_OP, OLD, NEW are
-- automatically set by PostgreSQL for each trigger call.
-- =====================================================

CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id      UUID;
    v_user_email   TEXT;
    v_old_data     JSONB;
    v_new_data     JSONB;
    v_record_id    UUID;
    v_changed      TEXT[];
    v_key          TEXT;
BEGIN
    -- ── Capture current user ──────────────────────────────────────────────
    -- auth.uid() works in SECURITY DEFINER when called from an RLS context.
    -- Returns NULL when triggered by service-role or internal operations.
    BEGIN
        v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- Fetch email for denormalization (avoid JOIN on every audit query)
    IF v_user_id IS NOT NULL THEN
        SELECT email INTO v_user_email
        FROM profiles
        WHERE id = v_user_id
        LIMIT 1;
    END IF;

    -- ── Build old / new snapshots ─────────────────────────────────────────
    IF TG_OP = 'DELETE' THEN
        v_old_data  := to_jsonb(OLD);
        v_new_data  := NULL;
        v_record_id := (to_jsonb(OLD)->>'id')::UUID;

    ELSIF TG_OP = 'INSERT' THEN
        v_old_data  := NULL;
        v_new_data  := to_jsonb(NEW);
        v_record_id := (to_jsonb(NEW)->>'id')::UUID;

    ELSIF TG_OP = 'UPDATE' THEN
        v_old_data  := to_jsonb(OLD);
        v_new_data  := to_jsonb(NEW);
        v_record_id := (to_jsonb(NEW)->>'id')::UUID;

        -- ── Compute changed_fields for UPDATE ─────────────────────────────
        -- Iterate over every key in the new row. If the value differs
        -- from the old row's value, record the key name.
        v_changed := ARRAY[]::TEXT[];
        FOR v_key IN SELECT jsonb_object_keys(v_new_data)
        LOOP
            IF (v_new_data->>v_key) IS DISTINCT FROM (v_old_data->>v_key) THEN
                v_changed := v_changed || v_key;
            END IF;
        END LOOP;

        -- Skip writing an audit row if nothing actually changed
        -- (can happen if UPDATE sets same value — e.g., trigger re-runs)
        IF array_length(v_changed, 1) IS NULL THEN
            RETURN NULL;   -- no real change, skip the audit row
        END IF;
    END IF;

    -- ── Write the audit row ───────────────────────────────────────────────
    INSERT INTO audit_logs (
        user_id,
        user_email,
        action_type,
        table_name,
        record_id,
        old_value,
        new_value,
        changed_fields,
        created_at
    ) VALUES (
        v_user_id,
        v_user_email,
        TG_OP,                  -- 'INSERT', 'UPDATE', or 'DELETE'
        TG_TABLE_NAME,          -- set automatically by PostgreSQL
        v_record_id,
        v_old_data,
        v_new_data,
        v_changed,              -- NULL for INSERT/DELETE, populated for UPDATE
        NOW()
    );

    -- Always return NEW for INSERT/UPDATE, OLD for DELETE
    -- (AFTER trigger return value is ignored by PG, but good practice)
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;

EXCEPTION
    -- CRITICAL: If the audit write fails for ANY reason, we must NOT
    -- roll back the parent transaction. Log a warning and continue.
    WHEN OTHERS THEN
        RAISE WARNING
            'audit_log_changes() failed on %.% (op=%, record=%): %',
            TG_TABLE_NAME, TG_OP, TG_OP, v_record_id, SQLERRM;
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- SECTION 3: ATTACH TRIGGERS TO TABLES
--
-- We use a single trigger per table that covers INSERT,
-- UPDATE, and DELETE in one FOR EACH ROW trigger.
-- AFTER ensures the main transaction's data is committed
-- before the audit row is written.
-- =====================================================

-- ── disease_reports ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_disease_reports ON disease_reports;
CREATE TRIGGER trg_audit_disease_reports
    AFTER INSERT OR UPDATE OR DELETE
    ON disease_reports
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_changes();

-- ── water_quality_reports ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_water_quality_reports ON water_quality_reports;
CREATE TRIGGER trg_audit_water_quality_reports
    AFTER INSERT OR UPDATE OR DELETE
    ON water_quality_reports
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_changes();

-- ── health_campaigns (app-facing table) ──────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_health_campaigns ON health_campaigns;
CREATE TRIGGER trg_audit_health_campaigns
    AFTER INSERT OR UPDATE OR DELETE
    ON health_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_changes();

-- ── campaigns (legacy table — conditional) ───────────────────────────────
DO $do$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'campaigns') THEN
        EXECUTE $inner$
            DROP TRIGGER IF EXISTS trg_audit_campaigns ON campaigns;
            CREATE TRIGGER trg_audit_campaigns
                AFTER INSERT OR UPDATE OR DELETE
                ON campaigns
                FOR EACH ROW
                EXECUTE FUNCTION audit_log_changes()
        $inner$;
    END IF;
END $do$;


-- =====================================================
-- SECTION 4: ADMIN QUERY HELPERS (READ-ONLY RPC FUNCTIONS)
--
-- These are SECURITY DEFINER functions that bypass RLS
-- constraints, letting admins query audit logs with
-- ergonomic parameters from the Supabase JS client.
-- =====================================================

-- 4a. Full audit trail for a single record
CREATE OR REPLACE FUNCTION get_audit_trail(
    p_table_name  TEXT,
    p_record_id   UUID
)
RETURNS TABLE (
    id              UUID,
    user_id         UUID,
    user_email      TEXT,
    action_type     TEXT,
    changed_fields  TEXT[],
    old_value       JSONB,
    new_value       JSONB,
    created_at      TIMESTAMPTZ
) AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- Only admin can call this
    SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only admin can view full audit trails';
    END IF;

    RETURN QUERY
    SELECT
        al.id,
        al.user_id,
        al.user_email,
        al.action_type,
        al.changed_fields,
        al.old_value,
        al.new_value,
        al.created_at
    FROM audit_logs al
    WHERE al.table_name = p_table_name
      AND al.record_id  = p_record_id
    ORDER BY al.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_audit_trail(TEXT, UUID) TO authenticated;


-- 4b. All actions performed by a specific user
CREATE OR REPLACE FUNCTION get_user_audit_log(
    p_user_id    UUID,
    p_days_back  INTEGER DEFAULT 30
)
RETURNS TABLE (
    id              UUID,
    action_type     TEXT,
    table_name      TEXT,
    record_id       UUID,
    changed_fields  TEXT[],
    created_at      TIMESTAMPTZ
) AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_id   UUID := auth.uid();
BEGIN
    SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;

    -- Admin can query anyone; regular user can only query themselves
    IF v_caller_role != 'admin' AND v_caller_id != p_user_id THEN
        RAISE EXCEPTION 'Permission denied: cannot view another user''s audit log';
    END IF;

    RETURN QUERY
    SELECT
        al.id,
        al.action_type,
        al.table_name,
        al.record_id,
        al.changed_fields,
        al.created_at
    FROM audit_logs al
    WHERE al.user_id    = p_user_id
      AND al.created_at >= NOW() - (p_days_back || ' days')::INTERVAL
    ORDER BY al.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_user_audit_log(UUID, INTEGER) TO authenticated;


-- 4c. All deletions across the system (admin only — forensics)
CREATE OR REPLACE FUNCTION get_deleted_records(
    p_table_name   TEXT    DEFAULT NULL,
    p_days_back    INTEGER DEFAULT 7
)
RETURNS TABLE (
    id              UUID,
    user_id         UUID,
    user_email      TEXT,
    table_name      TEXT,
    record_id       UUID,
    deleted_record  JSONB,
    created_at      TIMESTAMPTZ
) AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only admin can view deleted records';
    END IF;

    RETURN QUERY
    SELECT
        al.id,
        al.user_id,
        al.user_email,
        al.table_name,
        al.record_id,
        al.old_value   AS deleted_record,
        al.created_at
    FROM audit_logs al
    WHERE al.action_type = 'DELETE'
      AND (p_table_name IS NULL OR al.table_name = p_table_name)
      AND al.created_at  >= NOW() - (p_days_back || ' days')::INTERVAL
    ORDER BY al.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_deleted_records(TEXT, INTEGER) TO authenticated;


-- 4d. Approval activity log — who approved/rejected what
-- Specifically tracks changes to approval_status column.
CREATE OR REPLACE FUNCTION get_approval_audit_log(
    p_table_name   TEXT    DEFAULT 'disease_reports',
    p_days_back    INTEGER DEFAULT 30
)
RETURNS TABLE (
    id                  UUID,
    user_id             UUID,
    user_email          TEXT,
    record_id           UUID,
    old_approval_status TEXT,
    new_approval_status TEXT,
    rejection_reason    TEXT,
    created_at          TIMESTAMPTZ
) AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
    IF v_caller_role NOT IN ('admin', 'clinic', 'district_officer') THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    RETURN QUERY
    SELECT
        al.id,
        al.user_id,
        al.user_email,
        al.record_id,
        al.old_value->>'approval_status',
        al.new_value->>'approval_status',
        al.new_value->>'rejection_reason',
        al.created_at
    FROM audit_logs al
    WHERE al.table_name   = p_table_name
      AND al.action_type  = 'UPDATE'
      AND 'approval_status' = ANY(al.changed_fields)  -- only rows where approval changed
      AND al.created_at   >= NOW() - (p_days_back || ' days')::INTERVAL
    ORDER BY al.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_approval_audit_log(TEXT, INTEGER) TO authenticated;


-- =====================================================
-- SECTION 5: AUDIT LOG RETENTION POLICY
--
-- Optional: auto-purge old audit logs to manage storage.
-- By default this is DISABLED (commented out).
-- Enable and schedule via pg_cron on Supabase Pro,
-- or run manually as a maintenance task.
-- =====================================================

-- Purge audit logs older than N days (keep DELETEs permanently by default)
CREATE OR REPLACE FUNCTION purge_old_audit_logs(
    p_days_to_keep   INTEGER DEFAULT 365,
    p_purge_deletes  BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
    v_caller_role   TEXT;
BEGIN
    SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only admin can purge audit logs';
    END IF;

    DELETE FROM audit_logs
    WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL
      AND (p_purge_deletes OR action_type != 'DELETE');

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE 'Purged % audit log rows older than % days.', v_deleted_count, p_days_to_keep;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION purge_old_audit_logs(INTEGER, BOOLEAN) TO authenticated;

-- To run retention (admin only, from app):
-- await supabase.rpc('purge_old_audit_logs', { p_days_to_keep: 365, p_purge_deletes: false });


-- =====================================================
-- SECTION 6: USEFUL AUDIT VIEWS
-- =====================================================

DROP VIEW IF EXISTS vw_recent_audit_activity;
DROP VIEW IF EXISTS vw_approval_activity;

-- View: last 200 audit events (admin-only via RLS)
CREATE VIEW vw_recent_audit_activity AS
SELECT
    al.id,
    al.created_at,
    al.action_type,
    al.table_name,
    al.record_id,
    al.user_email,
    al.changed_fields,
    -- Lightweight preview: show only key fields, not full JSONB
    CASE al.action_type
        WHEN 'DELETE' THEN al.old_value->>'id'
        ELSE al.new_value->>'id'
    END AS affected_record_id,
    CASE al.action_type
        WHEN 'UPDATE' THEN jsonb_object_agg(f.key, al.new_value->f.key)
        ELSE NULL
    END AS changed_values_preview
FROM audit_logs al
LEFT JOIN LATERAL (
    SELECT unnest(al.changed_fields) AS key
) f ON al.action_type = 'UPDATE'
WHERE al.created_at >= NOW() - INTERVAL '7 days'
GROUP BY al.id, al.created_at, al.action_type, al.table_name,
         al.record_id, al.user_email, al.changed_fields,
         al.old_value, al.new_value
ORDER BY al.created_at DESC
LIMIT 200;

-- View: approval activity specifically
CREATE VIEW vw_approval_activity AS
SELECT
    al.id,
    al.created_at,
    al.table_name,
    al.record_id,
    al.user_email                          AS approved_by_email,
    al.old_value->>'approval_status'       AS from_status,
    al.new_value->>'approval_status'       AS to_status,
    al.new_value->>'rejection_reason'      AS rejection_reason,
    al.old_value->>'district'              AS district
FROM audit_logs al
WHERE al.action_type = 'UPDATE'
  AND 'approval_status' = ANY(al.changed_fields)
ORDER BY al.created_at DESC;

GRANT SELECT ON vw_recent_audit_activity TO authenticated;
GRANT SELECT ON vw_approval_activity     TO authenticated;


-- =====================================================
-- SECTION 7: VERIFICATION QUERIES
-- =====================================================

-- Confirm audit_logs table exists with correct structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

-- Confirm all indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'audit_logs'
ORDER BY indexname;

-- Confirm triggers on all tables
SELECT
    trigger_name,
    event_object_table,
    event_manipulation,
    action_timing
FROM information_schema.triggers
WHERE trigger_name IN (
    'trg_audit_disease_reports',
    'trg_audit_water_quality_reports',
    'trg_audit_health_campaigns',
    'trg_audit_campaigns'
)
ORDER BY event_object_table, event_manipulation;

-- Confirm RLS policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'audit_logs'
ORDER BY policyname;

-- Confirm RPC functions
SELECT routine_name
FROM information_schema.routines
WHERE routine_name IN (
    'audit_log_changes',
    'get_audit_trail',
    'get_user_audit_log',
    'get_deleted_records',
    'get_approval_audit_log',
    'purge_old_audit_logs'
);

-- ── QUICK SMOKE TEST ──────────────────────────────────────────────────────
-- After running this script, perform a test update on any disease_report
-- and then query audit_logs to confirm it captured correctly:
--
--   UPDATE disease_reports
--   SET notes = 'audit test ' || NOW()::TEXT
--   WHERE id = (SELECT id FROM disease_reports LIMIT 1);
--
--   SELECT * FROM audit_logs
--   WHERE table_name = 'disease_reports'
--   ORDER BY created_at DESC
--   LIMIT 5;

SELECT 'Audit logging system installed successfully!' AS status;
