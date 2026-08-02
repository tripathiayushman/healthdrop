-- =====================================================================
-- PHASE 1 — CLOSE THE FRONT DOOR
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
-- Source of truth: docs/REFINEMENT_PLAN.md §3 (Security) and §8 (roadmap).
--
-- Recorded here because "the schema is only reproducible from the live
-- database, not the repo" is itself an open finding. Everything below is
-- idempotent and safe to re-run.
-- =====================================================================

-- ── SEC-01 / SEC-02: routines reachable with the APK's anon key ──────────
--
-- 37 SECURITY DEFINER routines in `public` carried PostgreSQL's default
-- GRANT EXECUTE TO PUBLIC. On Supabase PUBLIC includes `anon`, and the anon
-- key ships inside every published APK. Two were outright dangerous:
--   * create_admin_user(text) — a SECURITY DEFINER helper that mints
--     privileged accounts: unauthenticated privilege escalation.
--   * notify_users_push(...)  — push arbitrary text to every handset that
--     has registered a token: spoofed health alerts at scale.
--
-- The client calls exactly TWO rpcs (verified by grepping every .rpc() call
-- site in App.tsx/components/lib/src): claim_push_token and
-- increment_volunteers. Everything else was exposed for nothing.

-- Admin/officer rpcs: authenticated only, never anon.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'dispatch_push_notification', 'get_audit_trail', 'get_user_audit_log',
    'get_approval_audit_log', 'get_deleted_records', 'resolve_outbreak',
    'get_disease_heatmap_geojson', 'get_disease_reports_near',
    'get_water_reports_near', 'get_district_health_summary'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = fn) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', fn);
    END IF;
  END LOOP;
END $$;

-- Cron- and service-role-only routines: no client role at all.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'purge_old_app_events', 'purge_old_audit_logs', 'purge_push_telemetry',
    'retry_pending_push', 'update_push_outbox_status', 'notify_users_push'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = fn) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.create_admin_user(text);

-- Stop the next routine being born exposed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- ── DELIBERATELY NOT REVOKED, and why ────────────────────────────────────
--
--  * Trigger functions (auto_approve_*, push_on_*, notify_on_*, detect_*,
--    sync_*, handle_*, audit_log_changes, *_campaign_participants,
--    recompute_*): invoked by the trigger machinery, not by callers.
--    PostgreSQL checks EXECUTE at CREATE TRIGGER time, not at fire time.
--
--  * get_my_role() / get_my_district() / is_admin(): these are evaluated
--    INSIDE RLS policy expressions, and a policy's function calls DO require
--    EXECUTE for the querying role. Revoking them would lock every
--    authenticated user out of every table in the schema. This is the trap
--    in a blanket "revoke everything from authenticated" sweep.
--
--  * claim_push_token() / increment_volunteers(): the client's two rpcs.
--    NOTE: increment_volunteers DOES NOT EXIST in this database — the call
--    at lib/services/campaigns.ts:235 has always failed silently. Left for
--    the delete phase: enrollVolunteer() writes to campaign_volunteers
--    (0 rows, nothing reads it) while the live enrolment path uses
--    campaign_participants (10 rows, trigger-maintained counts).

-- ── Verification (expected results at time of writing) ───────────────────
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.prosecdef
--    AND has_function_privilege('anon', p.oid,'EXECUTE')
--    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e');
--   -> 37 before, 22 after (remainder are trigger fns + the RLS helpers above)
--
-- SELECT has_function_privilege('authenticated','public.get_my_role()','EXECUTE');
--   -> must stay true, or the whole app 500s on every query.
