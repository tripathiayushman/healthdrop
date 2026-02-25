-- =====================================================
-- PUSH_NOTIFICATIONS.sql
-- Expo Push Notification Integration
--
-- Architecture:
--   1. profiles.expo_push_token         — stores device token per user
--   2. push_notification_outbox         — reliable delivery log / retry queue
--   3. trg_push_on_alert_created        — fires when health_alert is inserted
--   4. trg_push_on_report_approved      — fires when approval_status → 'approved'
--   5. notify_users_push()              — SECURITY DEFINER core dispatch function
--                                         calls the Edge Function via pg_net
--   6. dispatch_push_notification()     — admin RPC for manual dispatch
--
-- Edge Function path: supabase/functions/push-notifications/index.ts
-- The DB trigger calls it via pg_net.http_post() — no polling needed.
--
-- Run order: paste this entire file in Supabase SQL Editor.
-- Enable pg_net extension first if not already active.
-- =====================================================


-- =====================================================
-- STEP 0: Enable pg_net (built-in Supabase extension)
-- pg_net lets PostgreSQL make HTTP calls from triggers/functions.
-- Already enabled in Supabase Pro by default.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_net;


-- =====================================================
-- STEP 1: ADD expo_push_token TO profiles
-- =====================================================

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- Index: fast lookup when resolving tokens by role + district
CREATE INDEX IF NOT EXISTS idx_profiles_expo_token
    ON profiles (expo_push_token)
    WHERE expo_push_token IS NOT NULL;

COMMENT ON COLUMN profiles.expo_push_token IS
    'Expo push token (ExponentPushToken[xxx]) registered by the mobile app on login.
     Updated by the app on every login via UPDATE profiles SET expo_push_token = $1.
     NULL means the user has never logged in on a mobile device or has revoked permission.';


-- =====================================================
-- STEP 2: PUSH NOTIFICATION OUTBOX (Delivery Log)
-- Records every attempted push. Allows retry + audit.
-- =====================================================

CREATE TABLE IF NOT EXISTS push_notification_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who received it
    user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    expo_push_token TEXT NOT NULL,

    -- What was sent
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    data            JSONB DEFAULT '{}',        -- deep-link payload

    -- What triggered it
    trigger_type    TEXT NOT NULL,             -- 'alert_created' | 'report_approved' | 'manual'
    reference_id    UUID,                      -- ID of the source row (alert_id, report_id)
    reference_table TEXT,                      -- 'health_alerts' | 'disease_reports'

    -- Delivery tracking
    status          TEXT NOT NULL DEFAULT 'pending',
                                               -- 'pending' | 'sent' | 'failed' | 'skipped'
    expo_ticket_id  TEXT,                      -- ticket returned by Expo API
    error_message   TEXT,
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: only service role + admins can read the outbox
ALTER TABLE push_notification_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read push outbox"
    ON push_notification_outbox FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
              AND profiles.is_active = TRUE
        )
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_push_outbox_status
    ON push_notification_outbox (status, created_at DESC)
    WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_push_outbox_user
    ON push_notification_outbox (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_outbox_reference
    ON push_notification_outbox (reference_table, reference_id)
    WHERE reference_id IS NOT NULL;


-- =====================================================
-- STEP 3: CORE DISPATCH FUNCTION
-- Resolves target tokens and calls the Edge Function
-- via pg_net.http_post(). SECURITY DEFINER so it can
-- read profiles regardless of RLS.
-- =====================================================

CREATE OR REPLACE FUNCTION notify_users_push(
    p_title          TEXT,
    p_body           TEXT,
    p_data           JSONB       DEFAULT '{}',
    p_trigger_type   TEXT        DEFAULT 'manual',
    p_reference_id   UUID        DEFAULT NULL,
    p_reference_table TEXT       DEFAULT NULL,
    -- Targeting — pass NULL to skip that filter
    p_target_user_id UUID        DEFAULT NULL,   -- single user
    p_target_role    TEXT        DEFAULT NULL,   -- all users with this role
    p_target_district TEXT       DEFAULT NULL    -- further restrict by district
)
RETURNS INTEGER                                  -- returns count of tokens resolved
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token_rows    RECORD;
    v_tokens        TEXT[]  := '{}';
    v_user_ids      UUID[]  := '{}';
    v_edge_url      TEXT;
    v_service_key   TEXT;
    v_payload       JSONB;
BEGIN
    -- ── 1. Resolve target expo_push_tokens ──────────────────────────────
    FOR v_token_rows IN
        SELECT id, expo_push_token
        FROM profiles
        WHERE expo_push_token IS NOT NULL
          AND is_active = TRUE
          -- Single user override
          AND (p_target_user_id IS NULL OR id = p_target_user_id)
          -- Role filter (NULL = all roles)
          AND (p_target_role IS NULL OR role = p_target_role)
          -- District filter (NULL = all districts; role='admin' has no district restriction)
          AND (
              p_target_district IS NULL
              OR district = p_target_district
              OR role = 'admin'
          )
    LOOP
        v_tokens   := v_tokens   || v_token_rows.expo_push_token;
        v_user_ids := v_user_ids || v_token_rows.id;
    END LOOP;

    -- No tokens resolved → nothing to do
    IF array_length(v_tokens, 1) IS NULL THEN
        RETURN 0;
    END IF;

    -- ── 2. Insert outbox rows (one per token) ────────────────────────────
    INSERT INTO push_notification_outbox (
        user_id, expo_push_token, title, body, data,
        trigger_type, reference_id, reference_table, status
    )
    SELECT
        unnest(v_user_ids),
        unnest(v_tokens),
        p_title, p_body, p_data,
        p_trigger_type, p_reference_id, p_reference_table,
        'pending'
    ;

    -- ── 3. Call the Edge Function via pg_net ──────────────────────────────
    -- Read the Edge Function URL and service key from app settings.
    -- Set these once via:
    --   SELECT set_config('app.edge_function_url',
    --     'https://<project-ref>.functions.supabase.co/push-notifications', FALSE);
    --   SELECT set_config('app.service_role_key', '<SERVICE_ROLE_KEY>', FALSE);
    --
    -- In production, store these in Supabase Vault instead.

    v_edge_url    := current_setting('app.edge_function_url', TRUE);
    v_service_key := current_setting('app.service_role_key', TRUE);

    IF v_edge_url IS NOT NULL AND v_service_key IS NOT NULL THEN
        v_payload := jsonb_build_object(
            'tokens',         to_jsonb(v_tokens),
            'title',          p_title,
            'body',           p_body,
            'data',           p_data,
            'triggerType',    p_trigger_type,
            'referenceId',    p_reference_id,
            'referenceTable', p_reference_table
        );

        PERFORM net.http_post(
            url     := v_edge_url,
            headers := jsonb_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ' || v_service_key
            ),
            body    := v_payload
        );
    END IF;

    RETURN array_length(v_tokens, 1);

EXCEPTION WHEN OTHERS THEN
    -- Never block the parent transaction — log and continue
    RAISE WARNING 'notify_users_push failed: % %', SQLERRM, SQLSTATE;
    RETURN -1;
END;
$$;


-- =====================================================
-- STEP 4: TRIGGER — health_alert CREATED
-- Fires AFTER INSERT on health_alerts.
-- Targets: all active users in the same district.
-- =====================================================

CREATE OR REPLACE FUNCTION push_on_alert_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_body TEXT;
BEGIN
    -- Build a concise push body from the alert row
    v_body := COALESCE(
        substring(NEW.message FROM 1 FOR 100),
        NEW.title,
        'New health alert in your area'
    );

    PERFORM notify_users_push(
        p_title           := '🚨 Health Alert: ' || COALESCE(NEW.title, 'New Alert'),
        p_body            := v_body,
        p_data            := jsonb_build_object(
                                'screen',   'AlertDetail',
                                'alertId',  NEW.id,
                                'district', NEW.district
                             ),
        p_trigger_type    := 'alert_created',
        p_reference_id    := NEW.id,
        p_reference_table := 'health_alerts',
        p_target_district := NEW.district    -- NULL = broadcast to all districts
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_alert_created failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_alert_created ON health_alerts;
CREATE TRIGGER trg_push_on_alert_created
    AFTER INSERT ON health_alerts
    FOR EACH ROW
    EXECUTE FUNCTION push_on_alert_created();


-- =====================================================
-- STEP 5: TRIGGER — disease_report APPROVED
-- Fires AFTER UPDATE on disease_reports when
-- approval_status transitions to 'approved'.
-- Targets: the original reporter only.
-- =====================================================

CREATE OR REPLACE FUNCTION push_on_report_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT := OLD.approval_status::TEXT;
    v_new_status TEXT := NEW.approval_status::TEXT;
BEGIN
    -- Only fire on the approved transition, not on every update
    IF v_old_status = 'approved' OR v_new_status != 'approved' THEN
        RETURN NEW;
    END IF;

    PERFORM notify_users_push(
        p_title           := '✅ Report Approved',
        p_body            := 'Your report for ' || COALESCE(NEW.disease_name, 'disease') ||
                             ' in ' || COALESCE(NEW.district, 'your district') ||
                             ' has been approved.',
        p_data            := jsonb_build_object(
                                'screen',     'ReportDetail',
                                'reportId',   NEW.id,
                                'district',   NEW.district
                             ),
        p_trigger_type    := 'report_approved',
        p_reference_id    := NEW.id,
        p_reference_table := 'disease_reports',
        p_target_user_id  := NEW.reporter_id    -- only the person who filed the report
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_report_approved failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_report_approved ON disease_reports;
CREATE TRIGGER trg_push_on_report_approved
    AFTER UPDATE OF approval_status ON disease_reports
    FOR EACH ROW
    EXECUTE FUNCTION push_on_report_approved();


-- =====================================================
-- STEP 6: ADMIN RPC — manual push dispatch
-- Callable from Supabase dashboard or app admin panel.
-- =====================================================

CREATE OR REPLACE FUNCTION dispatch_push_notification(
    p_title          TEXT,
    p_body           TEXT,
    p_data           JSONB    DEFAULT '{}',
    p_target_role    TEXT     DEFAULT NULL,
    p_target_district TEXT    DEFAULT NULL,
    p_target_user_id UUID     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_count       INTEGER;
BEGIN
    -- Only admin can call this RPC
    SELECT role INTO v_caller_role
    FROM profiles WHERE id = auth.uid() AND is_active = TRUE;

    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Permission denied: admin role required';
    END IF;

    v_count := notify_users_push(
        p_title           := p_title,
        p_body            := p_body,
        p_data            := p_data,
        p_trigger_type    := 'manual',
        p_target_user_id  := p_target_user_id,
        p_target_role     := p_target_role,
        p_target_district := p_target_district
    );

    RETURN jsonb_build_object(
        'success',           TRUE,
        'tokens_dispatched', v_count,
        'dispatched_at',     NOW()
    );
END;
$$;

-- Grant RPC to authenticated (RPC checks role internally)
GRANT EXECUTE ON FUNCTION dispatch_push_notification TO authenticated;


-- =====================================================
-- STEP 7: UPDATE OUTBOX STATUS (called by Edge Function)
-- The Edge Function POSTs back ticket IDs after Expo responds.
-- =====================================================

CREATE OR REPLACE FUNCTION update_push_outbox_status(
    p_expo_token   TEXT,
    p_ticket_id    TEXT,
    p_status       TEXT,    -- 'sent' | 'failed'
    p_error        TEXT     DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE push_notification_outbox
    SET
        status          = p_status,
        expo_ticket_id  = p_ticket_id,
        error_message   = p_error,
        sent_at         = CASE WHEN p_status = 'sent' THEN NOW() ELSE NULL END,
        attempt_count   = attempt_count + 1
    WHERE expo_push_token = p_expo_token
      AND status          = 'pending'
      AND created_at     >= NOW() - INTERVAL '1 hour'   -- only update recent items
    ;
END;
$$;

GRANT EXECUTE ON FUNCTION update_push_outbox_status TO service_role;


-- =====================================================
-- STEP 8: CONFIGURE EDGE FUNCTION URL
-- Run this after deploying the Edge Function.
-- Replace <project-ref> with your Supabase project ref.
-- =====================================================

-- ALTER DATABASE postgres
--     SET "app.edge_function_url" = 'https://<project-ref>.functions.supabase.co/push-notifications';
-- ALTER DATABASE postgres
--     SET "app.service_role_key"  = '<YOUR_SERVICE_ROLE_KEY>';


-- =====================================================
-- VERIFICATION
-- =====================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'expo_push_token';

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_name = 'push_notification_outbox'
ORDER BY ordinal_position;

SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger
WHERE tgname IN ('trg_push_on_alert_created', 'trg_push_on_report_approved');

SELECT 'Push notification schema ready!' AS status;
