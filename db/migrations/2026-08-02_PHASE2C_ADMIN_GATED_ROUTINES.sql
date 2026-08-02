-- =====================================================================
-- PHASE 2c — ROUTINES THAT GATED ON THE DEAD 'admin' ROLE
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02 as three
-- migrations:
--   phase2c_admin_gated_routines                    (§1-4, §5 first cut, §7-10)
--   phase2c_approval_audit_log_ambiguous_id         (§5/6 — the behavioural
--       test found a second, older bug in the same function)
--   phase2c_drop_duplicate_campaigns_status_check   (§11)
--
-- Phase 2b fixed the RLS POLICIES that referenced 'admin' and redefined
-- is_admin() to mean super_admin|health_admin AND is_active. It left the
-- ROUTINES. Six of them tested a caller's role against 'admin', a value no
-- profile has and never has had, so every one of those tests answered the
-- same way for every real user:
--
--   get_audit_trail         !=          nobody could read an audit trail
--   get_deleted_records     !=          nobody could see a deleted record
--   purge_old_audit_logs    !=          see §3 — the accident WAS the feature
--   get_user_audit_log      != AND own  own log worked; admins saw only theirs
--   get_approval_audit_log  NOT IN      super_admin/health_admin denied
--   resolve_outbreak        = 'admin'   first branch of the chain unreachable
--
-- Each was replaced with is_admin() and NOTHING else: same signature, same
-- return type, same SECURITY DEFINER, same search_path, same body below the
-- guard. Where the role lookup existed only to feed the dead comparison it
-- went with it — that lookup is part of the guard, not separate from it.
--
-- Also here: the deletion of auto_approve_report() (§9), supporting indexes
-- for 16 unindexed foreign keys (§10), and the removal of a duplicate CHECK
-- on campaigns.status (§11).
-- =====================================================================

-- ── 1. get_audit_trail — always threw, for everyone ──────────────────────
--
-- On the NULL caller: the old `v_caller_role != 'admin'` let one through by
-- accident, because NULL != 'admin' is NULL and IF NULL is false. is_admin()
-- returns a real boolean and would have started refusing them. auth.uid() is
-- NULL only for a caller that never passed the API auth layer — postgres or
-- service_role — and anon holds no EXECUTE on any of these functions
-- (checked: proacl is {postgres,authenticated,service_role} throughout), so
-- keeping them in grants nobody anything they cannot already SELECT from
-- audit_logs directly. Preserved deliberately, and stated the same way in
-- every function below so nobody has to re-derive it from three-valued logic.
CREATE OR REPLACE FUNCTION public.get_audit_trail(p_table_name text, p_record_id uuid)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, action_type text, changed_fields text[], old_value jsonb, new_value jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Admin tier only. is_admin() = super_admin|health_admin AND is_active.
    -- auth.uid() IS NULL means the caller never came through the API auth
    -- layer (postgres / service_role); anon holds no EXECUTE on this
    -- function, and those two roles can read audit_logs directly, so
    -- letting them through grants nobody anything new.
    IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
        RAISE EXCEPTION 'Permission denied: only admins can view full audit trails';
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
$function$;

-- ── 2. get_deleted_records — always threw, for everyone ──────────────────
CREATE OR REPLACE FUNCTION public.get_deleted_records(p_table_name text DEFAULT NULL::text, p_days_back integer DEFAULT 7)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, table_name text, record_id uuid, deleted_record jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
        RAISE EXCEPTION 'Permission denied: only admins can view deleted records';
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
$function$;

-- ── 3. purge_old_audit_logs — the accidental path is the only real one ───
--
-- This one is not "broken", it is inverted. authenticated holds NO EXECUTE
-- on it (proacl = {postgres, service_role}), so no signed-in user can reach
-- it at all; the only callers are service_role and scheduled jobs, and every
-- one of them has auth.uid() = NULL. NULL != 'admin' is NULL, IF NULL is
-- false — so the dead guard was the entire reason purging worked.
--
-- Swapping in a bare `IF NOT is_admin()` would have turned that accident
-- into an outage the day someone scheduled it, because is_admin() returns
-- false (never NULL) for a caller with no uid. The `auth.uid() IS NOT NULL
-- AND` prefix is what preserves it: no uid, no check, exactly as today.
-- Verified below with an impersonation of nobody (V40, uid=NULL -> OK).
--
-- (For the record: no cron job currently calls this. cron.job today holds
-- healthdrop-push-retry, healthdrop-telemetry-purge and healthdrop-events-
-- purge only. The service_role path is live regardless.)
CREATE OR REPLACE FUNCTION public.purge_old_audit_logs(p_days_to_keep integer DEFAULT 365, p_purge_deletes boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    -- The old guard (v_caller_role != 'admin') let an unauthenticated caller
    -- through by accident: NULL != 'admin' is NULL, so the IF was false.
    -- That accident IS the cron / service_role path, so it is now explicit
    -- rather than incidental: a caller with no auth.uid() still succeeds.
    IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
        RAISE EXCEPTION 'Permission denied: only admins can purge audit logs';
    END IF;

    DELETE FROM audit_logs
    WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL
      AND (p_purge_deletes OR action_type != 'DELETE');

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE 'Purged % audit log rows older than % days.', v_deleted_count, p_days_to_keep;
    RETURN v_deleted_count;
END;
$function$;

-- ── 4. get_user_audit_log — admins were blind to everyone but themselves ─
--
-- The own-log half of the guard was the only half that worked, which is why
-- this never got reported: users saw their own history and nobody noticed
-- that an admin investigating someone else got 'Permission denied'.
--
-- `!=` is kept instead of IS DISTINCT FROM on purpose. IS DISTINCT FROM
-- would evaluate true for a NULL caller and start refusing service_role,
-- a behaviour change smuggled in under a readability change.
CREATE OR REPLACE FUNCTION public.get_user_audit_log(p_user_id uuid, p_days_back integer DEFAULT 30)
 RETURNS TABLE(id uuid, action_type text, table_name text, record_id uuid, changed_fields text[], created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id   UUID := auth.uid();
BEGIN
    -- Admin tier can query anyone; everyone else only themselves.
    -- '!=' (not IS DISTINCT FROM) is kept on purpose: it preserves the
    -- existing pass-through for a caller with no auth.uid().
    IF v_caller_id IS NOT NULL AND NOT is_admin() AND v_caller_id != p_user_id THEN
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
$function$;

-- ── 5/6. get_approval_audit_log — two bugs, one of them much older ───────
--
-- Bug 1 (the one this phase went looking for): the guard read
--     v_caller_role NOT IN ('admin','clinic','district_officer')
-- so the two most senior roles were the only ones locked out of the
-- approval history. clinic and district_officer are kept; is_admin() is
-- added alongside them, not in place of them.
--
-- Bug 2, found ONLY because the verification impersonated a clinic user:
-- the function threw 42702 "column reference id is ambiguous" for EVERY
-- caller, including clinic and district_officer. RETURNS TABLE declares an
-- OUT parameter named `id`, the guard's role lookup said
--     SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
-- and plpgsql's default variable_conflict is `error`. The very first
-- statement aborted, so this function has never returned a row to anyone.
--
-- This is exactly the failure mode a structural check misses: the function
-- existed, had the right signature, and had a guard naming the right roles.
-- The negative tests even "passed" — volunteer and asha_worker were refused,
-- just with the wrong error. Aliasing the table (profiles pr) fixes it.
--
-- The COALESCE is a deliberate tightening: the old NOT IN produced NULL for
-- an authenticated caller with no profile row, and IF NULL is false, so such
-- a caller was let in. They are now refused.
CREATE OR REPLACE FUNCTION public.get_approval_audit_log(p_table_name text DEFAULT 'disease_reports'::text, p_days_back integer DEFAULT 30)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, record_id uuid, old_approval_status text, new_approval_status text, rejection_reason text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_role TEXT;
BEGIN
    SELECT pr.role INTO v_caller_role FROM profiles pr WHERE pr.id = auth.uid();
    IF auth.uid() IS NOT NULL
       AND NOT (is_admin() OR COALESCE(v_caller_role IN ('clinic','district_officer'), FALSE)) THEN
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
$function$;

-- ── 7. resolve_outbreak — only the first branch of the chain changed ─────
--
-- The full ELSIF chain was checked before touching it, because widening the
-- first branch of a chain silently changes which later branch a caller
-- lands in. It does not here: `IF is_admin()` matches strictly fewer roles
-- than the clinic/district_officer ELSIF, so nothing that used to reach the
-- district check reaches the admin branch instead.
--
-- The district rule and the deny-by-default ELSE are untouched. A caller
-- with no profile still falls through both branches to the ELSE, because
-- NULL IN (...) is NULL and IF NULL is false — this function has always
-- refused the NULL caller and still does (unlike the audit readers above,
-- whose guards were shaped the other way round). The ELSE message was
-- reworded only to stop naming a role that does not exist.
CREATE OR REPLACE FUNCTION public.resolve_outbreak(p_outbreak_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS outbreaks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Permission check. Only the first branch changed; the district rule for
    -- clinic/district_officer and the deny-by-default ELSE are untouched, so
    -- a caller with no profile still falls to ELSE and is refused.
    IF is_admin() THEN
        NULL; -- admin tier can resolve any outbreak, in any district
    ELSIF v_caller_role IN ('clinic', 'district_officer') THEN
        IF v_caller_district != v_outbreak.district THEN
            RAISE EXCEPTION 'Permission denied: your district does not match outbreak district';
        END IF;
    ELSE
        RAISE EXCEPTION 'Permission denied: only an admin, clinic, or district_officer can resolve outbreaks';
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
$function$;

-- ── 8. dispatch_push_notification — redundant literal only ───────────────
--
-- This one was never broken: its guard was
--   role IS NULL OR role NOT IN ('admin','super_admin','health_admin')
-- which already admits the two roles that exist and denies the rest. Zero
-- profiles carry 'admin', so removing the literal cannot change who passes.
-- Deliberately NOT rewritten to call is_admin(): the existing test already
-- checks is_active = TRUE, so is_admin() would be a same-meaning rewrite of
-- a working function, and this migration is about behaviour users can see.
CREATE OR REPLACE FUNCTION public.dispatch_push_notification(p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb, p_target_role text DEFAULT NULL::text, p_target_district text DEFAULT NULL::text, p_target_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_role TEXT;
    v_count       INTEGER;
BEGIN
    SELECT role INTO v_caller_role
    FROM profiles WHERE id = auth.uid() AND is_active = TRUE;

    IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin','health_admin') THEN
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
$function$;

-- ── 9. auto_approve_report() dropped ─────────────────────────────────────
--
-- Phase 2 and Phase 2b both noted it and both left it standing. Re-verified
-- before dropping, not assumed:
--   * pg_trigger JOIN pg_proc on proname='auto_approve_report' -> 0 rows.
--     The live tables use auto_approve_reporter_id_report and siblings,
--     which gate on super_admin|health_admin|clinic|district_officer.
--   * no other routine's prosrc mentions it -> 0 rows.
--   * no reference anywhere in the app source; the only hits in the repo
--     are db/assertions.sql and these migration/doc files describing it.
-- It also gated on 'admin', so had anything ever attached it, every clinic
-- report would have been auto-approved and every admin report would not.
DROP FUNCTION IF EXISTS public.auto_approve_report();

-- ── 10. Supporting indexes for unindexed foreign keys ────────────────────
--
-- assertion A5. Postgres indexes the referenced side of an FK automatically
-- and the referencing side never — so every one of these makes the planner
-- seq-scan the child table on a join, and, more sharply, on any DELETE or
-- UPDATE of the parent key, which must scan the child to enforce the
-- constraint. Most of these children point at profiles: deactivating one
-- user scans disease_reports, water_quality_reports, water_sources,
-- health_alerts, health_campaigns and app_events end to end.
--
-- Plain CREATE INDEX, not CONCURRENTLY: apply_migration runs inside a
-- transaction, and CONCURRENTLY cannot. Every table here is small enough
-- (largest is 128 rows) that the brief ACCESS EXCLUSIVE lock is irrelevant.
CREATE INDEX IF NOT EXISTS idx_alert_acknowledgements_user_id      ON public.alert_acknowledgements (user_id);
CREATE INDEX IF NOT EXISTS idx_app_events_user_id                  ON public.app_events (user_id);
CREATE INDEX IF NOT EXISTS idx_disease_reports_approved_by         ON public.disease_reports (approved_by);
CREATE INDEX IF NOT EXISTS idx_disease_reports_verified_by         ON public.disease_reports (verified_by);
CREATE INDEX IF NOT EXISTS idx_health_alerts_approved_by           ON public.health_alerts (approved_by);
CREATE INDEX IF NOT EXISTS idx_health_campaigns_approved_by        ON public.health_campaigns (approved_by);
CREATE INDEX IF NOT EXISTS idx_outbreak_thresholds_created_by      ON public.outbreak_thresholds (created_by);
CREATE INDEX IF NOT EXISTS idx_outbreaks_resolved_by               ON public.outbreaks (resolved_by);
CREATE INDEX IF NOT EXISTS idx_outbreaks_triggered_by_report_id    ON public.outbreaks (triggered_by_report_id);
CREATE INDEX IF NOT EXISTS idx_profiles_supervisor_id              ON public.profiles (supervisor_id);
CREATE INDEX IF NOT EXISTS idx_role_invitations_invited_by         ON public.role_invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_water_quality_reports_approved_by   ON public.water_quality_reports (approved_by);
CREATE INDEX IF NOT EXISTS idx_water_quality_reports_verified_by   ON public.water_quality_reports (verified_by);
CREATE INDEX IF NOT EXISTS idx_water_sources_last_report_id        ON public.water_sources (last_report_id);
CREATE INDEX IF NOT EXISTS idx_water_sources_reopened_by           ON public.water_sources (reopened_by);
CREATE INDEX IF NOT EXISTS idx_water_sources_retest_assigned_to    ON public.water_sources (retest_assigned_to);

-- ── 11. campaigns.status carried the same CHECK twice ────────────────────
--
-- campaigns_status_check and chk_status_campaigns had byte-identical
-- definitions:
--     CHECK (status = ANY (ARRAY['planned','ongoing','completed','cancelled']))
--
-- Identical copies are harmless in themselves — a row must satisfy all of
-- them and the accepted set collapses to the intersection, which here equals
-- either copy. What makes it worth removing is the SHAPE: this is the same
-- pattern that broke water_quality_reports.overall_quality in Phase 2, where
-- three constraints DIFFERED, the intersection came out {moderate, unsafe},
-- and an ASHA worker could not record safe water. This was the last column
-- in the database carrying more than one CHECK, so dropping it closes the
-- pattern out and turns assertion A4 green with no allowlist entry.
--
-- Kept on a dead 0-row table where §10 refused to ADD indexes, because the
-- two directions are not the same: adding an index is upkeep that makes a
-- corpse look maintained, while dropping a redundant constraint is
-- subtractive and moves the table toward the deletion it is queued for.
-- Kept the auto-generated name, matching its sibling
-- campaigns_campaign_type_check.
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_status_campaigns;

-- =====================================================================
-- VERIFICATION — live results, 2026-08-02. Behavioural, not structural.
--
-- Every row below is a real call made while impersonating a real profile:
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', <profile uuid>, 'role','authenticated')::text, true);
-- then EXECUTE the call inside a BEGIN/EXCEPTION block that records either
-- the row count or the SQLSTATE + message. The negative rows are the point:
-- widening an admin check is how privilege escalation ships. resolve_outbreak
-- was tested against four seeded outbreak rows, deleted afterwards (the table
-- is back to 0 rows); the purge calls used p_days_to_keep := 1000000 so they
-- matched nothing (audit_logs: 128 rows before, 128 after).
--
--  seq  test                                              expect  result  actual
--   1   get_audit_trail            super_admin              OK     PASS   OK (rows=9)
--   2   get_audit_trail            health_admin             OK     PASS   OK (rows=9)
--   3   get_audit_trail            volunteer               ERR     PASS   ERR Permission denied: only admins can view full audit trails
--   4   get_audit_trail            asha_worker             ERR     PASS   ERR Permission denied: only admins can view full audit trails
--   5   get_audit_trail            clinic                  ERR     PASS   ERR Permission denied: only admins can view full audit trails
--   6   get_audit_trail            district_officer        ERR     PASS   ERR Permission denied: only admins can view full audit trails
--  10   get_deleted_records        super_admin              OK     PASS   OK (rows=18)
--  11   get_deleted_records        health_admin             OK     PASS   OK (rows=18)
--  12   get_deleted_records        volunteer               ERR     PASS   ERR Permission denied: only admins can view deleted records
--  13   get_deleted_records        asha_worker             ERR     PASS   ERR Permission denied: only admins can view deleted records
--  20   get_user_audit_log         volunteer -> self        OK     PASS   OK (rows=4)
--  21   get_user_audit_log         asha_worker -> self      OK     PASS   OK (rows=17)
--  22   get_user_audit_log         volunteer -> other      ERR     PASS   ERR Permission denied: cannot view another user's audit log
--  23   get_user_audit_log         asha_worker -> other    ERR     PASS   ERR Permission denied: cannot view another user's audit log
--  24   get_user_audit_log         super_admin -> other     OK     PASS   OK (rows=17)
--  25   get_user_audit_log         health_admin -> other    OK     PASS   OK (rows=17)
--  26   get_user_audit_log         clinic -> other         ERR     PASS   ERR Permission denied: cannot view another user's audit log
--  30   get_approval_audit_log     clinic                   OK     PASS   OK (rows=5)
--  31   get_approval_audit_log     district_officer         OK     PASS   OK (rows=5)
--  32   get_approval_audit_log     super_admin              OK     PASS   OK (rows=5)
--  33   get_approval_audit_log     health_admin             OK     PASS   OK (rows=5)
--  34   get_approval_audit_log     volunteer               ERR     PASS   ERR [P0001] Permission denied
--  35   get_approval_audit_log     asha_worker             ERR     PASS   ERR [P0001] Permission denied
--  40   purge_old_audit_logs       cron / uid=NULL          OK     PASS   OK (uid=NULL, rows=0)
--  41   purge_old_audit_logs       super_admin              OK     PASS   OK (rows=0)
--  42   purge_old_audit_logs       volunteer               ERR     PASS   ERR Permission denied: only admins can purge audit logs
--  43   purge_old_audit_logs       asha_worker             ERR     PASS   ERR Permission denied: only admins can purge audit logs
--  50   resolve_outbreak           super_admin              OK     PASS   OK (rows=1)   <- branch was dead
--  51   resolve_outbreak           health_admin             OK     PASS   OK (rows=1)   <- branch was dead
--  52   resolve_outbreak           district_officer, same district
--                                                           OK     PASS   OK (rows=1)
--  53   resolve_outbreak           clinic, other district  ERR     PASS   ERR Permission denied: your district does not match outbreak district
--  54   resolve_outbreak           volunteer               ERR     PASS   ERR Permission denied: only an admin, clinic, or district_officer can resolve outbreaks
--  55   resolve_outbreak           asha_worker             ERR     PASS   ERR Permission denied: only an admin, clinic, or district_officer can resolve outbreaks
--  60   dispatch_push_notification super_admin              OK     PASS   OK {"success":true,"tokens_dispatched":0}
--  61   dispatch_push_notification health_admin             OK     PASS   OK {"success":true,"tokens_dispatched":0}
--  62   dispatch_push_notification volunteer               ERR     PASS   ERR [P0001] Permission denied: admin role required
--  63   dispatch_push_notification asha_worker             ERR     PASS   ERR [P0001] Permission denied: admin role required
--  64   dispatch_push_notification district_officer        ERR     PASS   ERR [P0001] Permission denied: admin role required
--
-- The first run of rows 30-35 is why this file has a §5/6 instead of a §5:
-- all four positive cases came back
--     ERR column reference "id" is ambiguous
-- and the two negative cases "passed" with that same error. A structural
-- check, and a test that only asserted "volunteer is refused", would both
-- have shipped this.
--
-- Structural confirmations:
--   S1 16 indexes exist, each btree on the FK column                PASS
--   S2 unindexed FKs remaining: 3, all on campaigns /
--      campaign_volunteers (deliberately skipped, see below)         PASS
--   S3 auto_approve_report present in pg_proc: 0                     PASS
--   S4 routines still containing the literal 'admin': 2 —
--      notify_users_push (see below) and a comment in
--      purge_old_audit_logs describing the bug it replaced           PASS
--   S5 seeded verification outbreaks remaining: 0; outbreaks: 0 rows PASS
--   S6 columns carrying >1 CHECK, whole database: (none)              PASS
--      campaigns now has campaigns_campaign_type_check,
--      campaigns_status_check, chk_approval_status_campaigns,
--      valid_campaign_dates — one per column.
-- =====================================================================

-- ── NOT touched, and why ─────────────────────────────────────────────────
--
--  * notify_users_push(): its 'admin' sits in
--        OR p.role IN ('admin','super_admin','health_admin')
--    which is a district-BYPASS for the admin tier, not a permission guard —
--    the worst it can do is fail to widen a recipient list, and it already
--    widens correctly for the two roles that exist. Left alone because the
--    function is long, wraps a net.http_post, and swallows every exception
--    into `RETURN -1`; a typo in it would be invisible, and the only way to
--    test it end-to-end is to send real push notifications. Not worth it for
--    a literal that provably changes nothing. It belongs to the same cleanup
--    pass as the hardcoded key sitting in its body.
--
--  * campaigns and campaign_volunteers foreign keys — 3 of the 19 from A5:
--    campaigns_created_by_fkey, campaigns_approved_by_fkey,
--    campaign_volunteers_volunteer_id_fkey. Both tables have ZERO rows
--    (re-counted, not assumed) and are superseded by health_campaigns (5
--    rows) and campaign_participants (10). An index on an empty table that
--    is scheduled for deletion is pure upkeep on a corpse, and it makes the
--    table look maintained — the same reason Phase 2b left their RLS alone.
--    A5 will keep reporting 3 until the tables are dropped; that is the
--    assertion doing its job, not a regression.
--
--  * The RLS policies on campaigns / campaign_volunteers that still name
--    'admin' — unchanged since Phase 2b, same reason.
--
--  * Function grants — untouched throughout. CREATE OR REPLACE preserves
--    proacl, and none of these needed widening: authenticated already held
--    EXECUTE on the five reader/writer functions, purge_old_audit_logs is
--    still service_role-only, and anon holds EXECUTE on none of them.
