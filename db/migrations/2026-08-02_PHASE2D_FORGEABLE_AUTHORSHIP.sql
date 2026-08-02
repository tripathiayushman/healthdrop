-- =====================================================================
-- FORGEABLE AUTHORSHIP, AN ANON-REACHABLE RPC, AND TWO OPEN READS
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
-- Surfaced by db/assertions.sql invariants A1, A9, A10 and A11 running
-- in CI for the first time.
-- =====================================================================

-- ── A9 (the serious one): anyone could publish an alert as someone else ──
--
-- alerts_insert checked the CALLER'S ROLE but never required created_by to BE
-- the caller. That is not merely a wrong byline. auto_approve_alert_fn decides
-- auto-approval by looking up the role of NEW.created_by:
--
--     SELECT role INTO reporter_role FROM profiles WHERE id = NEW.created_by;
--     IF reporter_role IN ('super_admin','health_admin','clinic','district_officer')
--       THEN NEW.approval_status := 'approved';
--
-- The policy also admits asha_worker, whose alerts are meant to wait for a
-- human. An asha_worker inserting with created_by set to any clinic or officer
-- account got the alert stamped 'approved' immediately and attributed to that
-- person: a self-approving, mis-attributed PUBLIC HEALTH ALERT. Privilege
-- escalation into the exact thing this product exists to control — what is
-- said to the public, and who verified it.
--
-- Binding the column to auth.uid() closes the forgery and the escalation
-- together, because the trigger then reads the real author's role.
DROP POLICY IF EXISTS alerts_insert ON public.health_alerts;
CREATE POLICY alerts_insert ON public.health_alerts
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY[
          'super_admin','health_admin','clinic','asha_worker','district_officer'
        ])
        AND profiles.is_active = true
    )
  );

-- Same shape on health_campaigns. Its sibling policy campaigns_insert already
-- bound organizer_id = auth.uid(); this one did not, and with permissive
-- policies OR-ed together the looser one wins.
DROP POLICY IF EXISTS district_officer_insert_campaigns ON public.health_campaigns;
CREATE POLICY district_officer_insert_campaigns ON public.health_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    organizer_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY[
          'super_admin','health_admin','district_officer','asha_worker'
        ])
    )
  );

-- ── A1: claim_push_token was reachable with the APK's anon key ───────────
-- It is SECURITY DEFINER and deliberately powerful: unlike a direct upsert
-- (which owner-only RLS blocks) it MOVES a shared device's push token from
-- whichever account last held it to the caller's. Correct for a shared field
-- handset; never something an unauthenticated caller should reach. The client
-- only calls it after resolving a signed-in user
-- (lib/services/users.ts:284-295 returns early when getUser() is empty), so
-- `authenticated` loses nothing.
REVOKE ALL ON FUNCTION public.claim_push_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_push_token(text, text) TO authenticated;

-- ── A10: a materialized view cannot enforce RLS ─────────────────────────
-- mv_campaign_effectiveness was SELECT-able by `authenticated`, and a matview
-- has no row-level security at all, so every signed-in volunteer could read
-- campaign aggregates for every district — bypassing the district scoping
-- that applies to the underlying tables.
--
-- Nothing in the app reads it; the only reference in the repo is the
-- assertion that flagged it. The live path uses the VIEW
-- vw_campaign_effectiveness, which is security_invoker and does NOT read this
-- matview. That was checked BEFORE revoking: a security_invoker view reading
-- a revoked matview would have broken Campaign Intelligence for everyone.
REVOKE ALL ON public.mv_campaign_effectiveness FROM anon, authenticated;

-- ── A11: the dead `campaigns` table was world-readable ──────────────────
-- Two always-true SELECT policies granted to `public`, which includes `anon`,
-- and the anon key ships in every APK. The table holds ZERO rows and is
-- superseded by health_campaigns, so nothing leaked today — but an
-- always-true policy on a forgotten table is how a future write becomes a
-- public one. Restricted to `authenticated` rather than dropped; dropping the
-- table is the right end state and is destructive, so it waits for the owner.
DROP POLICY IF EXISTS "Everyone can view campaigns" ON public.campaigns;
DROP POLICY IF EXISTS campaigns_select ON public.campaigns;
CREATE POLICY campaigns_select ON public.campaigns
  FOR SELECT TO authenticated
  USING (true);

-- =====================================================================
-- VERIFICATION — behavioural, by impersonating a real ASHA worker.
-- Structure is not evidence: the point is whether the attack still works.
--
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', <asha uuid>, 'role','authenticated')::text, true);
--   SET LOCAL ROLE authenticated;   -- RLS does not apply to a superuser
--
-- Live results, 2026-08-02:
--   D1 asha forges created_by=clinic     PASS - refused, new row violates RLS
--   D2 asha inserts as self              PASS - saved as 'pending_approval'
--
-- D2 matters as much as D1: the fix must not break the honest path, and the
-- alert must still wait for a human rather than auto-approving.
--
--   A10 matview no longer API-readable                 PASS
--   vw_campaign_effectiveness still readable           PASS
--   A11 no always-true anon SELECT on campaigns        PASS
--   A9  alerts_insert binds created_by                 PASS
--   A9  campaigns insert binds organizer_id            PASS
--   claim_push_token: anon revoked / authenticated ok  PASS
--   get_my_role + get_my_district still EXECUTE-able   PASS  (or every query 500s)
-- =====================================================================
