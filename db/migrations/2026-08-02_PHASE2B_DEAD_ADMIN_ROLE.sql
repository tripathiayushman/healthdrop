-- =====================================================================
-- PHASE 2b — RETIRE THE DEAD 'admin' ROLE
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
-- Found by db/assertions.sql invariant A3: 21 references to a role that
-- no profile has. This system uses six roles and 'admin' is not one.
--
-- Most references turned out to be harmlessly redundant (a sibling policy
-- already granted the same access) or to sit on tables with zero rows.
-- THREE were real gaps. Each table was checked individually first --
-- RLS policies are OR-ed, so a dead policy only matters when it is the
-- ONLY grant for that command.
-- =====================================================================

-- ── 1. is_admin() always returned false ──────────────────────────────────
-- It tested role = 'admin'. Nothing references it today, so nothing was
-- broken by it -- but it is a landmine: the next policy written with it
-- would silently deny everyone, the hardest kind of bug to notice.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('super_admin','health_admin')
      AND is_active = TRUE
  );
$function$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ── 2. REAL GAP: nobody could edit the outbreak thresholds ───────────────
-- outbreak_thresholds holds 5 live rows and drives outbreak detection. Its
-- only write policy required 'admin', so INSERT/UPDATE/DELETE were
-- impossible for every user in the system. Reads were already open.
DROP POLICY IF EXISTS "Admin manage outbreak_thresholds" ON public.outbreak_thresholds;
CREATE POLICY "Admins manage outbreak_thresholds" ON public.outbreak_thresholds
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── 3. REAL GAP: the senior roles were blind to outbreaks ────────────────
-- outbreaks had SELECT policies for asha_worker, clinic, district_officer
-- and volunteer, and UPDATE for clinic/district_officer -- but the only
-- policy covering super_admin and health_admin required 'admin'. The two
-- most senior roles could not see a single outbreak. The table is empty
-- today, so it had not yet bitten; it would have on the first detection.
DROP POLICY IF EXISTS "Admin full access outbreaks" ON public.outbreaks;
CREATE POLICY "Admins full access outbreaks" ON public.outbreaks
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── 4. REAL GAP: nobody could delete feedback ────────────────────────────
DROP POLICY IF EXISTS feedback_delete ON public.user_feedback;
CREATE POLICY feedback_delete ON public.user_feedback
  FOR DELETE TO authenticated
  USING (is_admin());

-- ── 5. Redundant dead policies, removed so they stop misleading readers ──
-- Each required 'admin' while a sibling already granted the same access to
-- the correct roles. Policies are OR-ed, so dropping one that can never
-- match cannot take access away from anyone.

-- audit_logs: audit_logs_super_admin already grants super_admin ALL.
DROP POLICY IF EXISTS "Admin full access audit_logs" ON public.audit_logs;

-- user_feedback UPDATE: feedback_admin_update already covers the admin tier.
DROP POLICY IF EXISTS feedback_update ON public.user_feedback;

-- user_feedback SELECT: this one ALSO granted own-row access, so it could
-- not simply be dropped -- users would have lost sight of their own
-- feedback. Rewritten as own-row only; feedback_admin_select covers admins.
DROP POLICY IF EXISTS feedback_select ON public.user_feedback;
CREATE POLICY feedback_select ON public.user_feedback
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- notification_logs: its array already contained super_admin/health_admin/
-- district_officer, so the stray 'admin' entry changed nothing. Rewritten
-- only to stop the next reader wondering whether it mattered.
DROP POLICY IF EXISTS "Admins can read notification logs" ON public.notification_logs;
CREATE POLICY "Admins can read notification logs" ON public.notification_logs
  FOR SELECT TO authenticated
  USING (get_my_role() = ANY (ARRAY['super_admin','health_admin','district_officer']));

-- =====================================================================
-- VERIFICATION (live results, 2026-08-02). The negative cases matter most:
-- widening an admin check is exactly how privilege escalation ships.
--   C1 is_admin() for super_admin              PASS (true)
--   C2 is_admin() for volunteer                PASS (false)
--   C3 is_admin() for asha_worker              PASS (false)
--   C4 dead-role refs outside dead tables (0)  PASS
--   C5 user_feedback SELECT policies (own+admin) PASS
--   C6 outbreak_thresholds has a write policy  PASS
--
-- Impersonate with:
--   PERFORM set_config('request.jwt.claims',
--     json_build_object('sub', <uuid>, 'role','authenticated')::text, true);
-- =====================================================================

-- ── NOT touched, and why ─────────────────────────────────────────────────
--  * public.campaigns and public.campaign_volunteers still carry 'admin'
--    policies. Both have ZERO rows and are superseded by health_campaigns
--    (5 rows) and campaign_participants (10 rows), whose policies already
--    use the correct six roles. Fixing RLS on a dead table would only make
--    it look maintained. Dropping tables is destructive -- owner sign-off.
--  * auto_approve_report() also gates on 'admin' but is attached to no
--    trigger; the live tables use auto_approve_reporter_id_report and
--    siblings, which gate correctly on the four senior roles. Dead code.
