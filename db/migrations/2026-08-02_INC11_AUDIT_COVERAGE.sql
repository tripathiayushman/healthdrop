-- =====================================================================
-- INC-11 — audit coverage for the two tables where accountability matters,
--          plus the retention job audit_logs never had.
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
--
-- Neither health_alerts nor profiles carried an audit trigger, so the two
-- questions you most need answered after the fact had no record at all:
--   "who published this public warning, and who approved it?"
--   "who gave this account its role?"
-- =====================================================================

-- 1. health_alerts — full INSERT/UPDATE/DELETE. Every column of an alert is
--    public-facing by definition, and the table holds 4 rows.
DROP TRIGGER IF EXISTS trg_audit_health_alerts ON public.health_alerts;
CREATE TRIGGER trg_audit_health_alerts
  AFTER INSERT OR UPDATE OR DELETE ON public.health_alerts
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- 2. profiles — authority changes ONLY. A blanket trigger would audit every
--    last_login, push-token and avatar write and balloon audit_logs on a
--    500 MB free tier. The WHEN clause narrows it to the three columns that
--    confer or remove power.
DROP TRIGGER IF EXISTS trg_audit_profiles_authority ON public.profiles;
CREATE TRIGGER trg_audit_profiles_authority
  AFTER UPDATE OF role, role_verified, is_active ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role          IS DISTINCT FROM NEW.role
     OR OLD.role_verified IS DISTINCT FROM NEW.role_verified
     OR OLD.is_active     IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION public.audit_log_changes();

-- 3. profiles — account creation. INSERT ONLY, deliberately.
--
-- The proposed version also audited DELETE. That half was NOT applied.
-- profiles.id is ON DELETE CASCADE from auth.users, so a DELETE trigger fires
-- when someone deletes their ACCOUNT — and audit_log_changes writes the whole
-- outgoing row into audit_logs.old_value: email, phone, full name, copied into
-- a table with no retention job, at the exact moment they asked to be erased.
--
-- "Account deleted" as an event is worth recording; the deleted person's
-- contact details are not. An audit trail that quietly defeats account
-- deletion is worse than one gap in coverage — and it would be incoherent to
-- purge her saved drafts on deletion (done earlier today) and then archive her
-- profile forever one table over. If deletion accountability is wanted later,
-- the right shape is a narrow trigger writing {id, role, deleted_at}.
DROP TRIGGER IF EXISTS trg_audit_profiles_lifecycle ON public.profiles;
CREATE TRIGGER trg_audit_profiles_lifecycle
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- 4. Retention. audit_logs was the only log table without a purge job; push
--    telemetry and app events are both purged nightly. Safe from cron only
--    because Phase 2c rewrote the guard to
--      IF auth.uid() IS NOT NULL AND NOT is_admin() THEN RAISE
--    so a cron caller passes through explicitly. Before that it read
--    `IF v_caller_role != 'admin'`, which was NULL for cron and passed by
--    accident. 365 days; p_purge_deletes=false because DELETE rows are the
--    ones you most want a year later, and with profiles DELETE unaudited they
--    no longer carry a deleted person's contact details.
SELECT cron.schedule('healthdrop-audit-purge', '7 4 * * *',
                     $$SELECT public.purge_old_audit_logs(365, false)$$);

-- =====================================================================
-- VERIFICATION (live, 2026-08-02). I2 matters as much as I1: coverage that
-- audits every avatar change is coverage nobody will read.
--   I1 alert publish audited (1)                    PASS
--   I2 phone-only edit not audited (delta 0)        PASS
--   I3 role_verified flips audited (delta 2)        PASS - no-op ignored
--   I4 no profiles DELETE audit trigger (0)         PASS - deletion stays deletion
--   cron.job now holds 4 jobs, all active
--
-- Cleanup: verification wrote 4 audit rows describing events that never really
-- happened, and 13 more had accumulated from earlier test fixtures today
-- (TZTEST, PHASE2 SELFTEST, MISSIONTEST). All 17 were removed by label — an
-- audit trail containing fiction is worse than one with a gap. audit_logs is
-- back to 115 rows with history intact to 2026-02-22.
-- =====================================================================
