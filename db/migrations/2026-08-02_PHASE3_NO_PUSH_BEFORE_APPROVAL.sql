-- =====================================================================
-- UNAPPROVED ALERTS WERE PUSHED TO PHONES
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
--
-- docs/REFINEMENT_PLAN.md §1.2 states the rule this product exists to keep:
--   "Automation may accelerate detection and delivery. It must never speak
--    to the public. Public alerts are human-approved, always."
--
-- trg_push_on_alert_created is AFTER INSERT ON health_alerts FOR EACH ROW and
-- push_on_alert_created() never looked at approval_status. So the instant ANY
-- row landed, the push went out — including a row auto_approve_alert_fn had
-- just stamped 'pending_approval' precisely because its author is an
-- asha_worker or volunteer whose alerts are supposed to wait for an officer.
--
-- HOW IT WAS FOUND, because the route matters more than the fix:
-- while verifying an unrelated item I inserted a test alert as an asha_worker.
-- It came back approval_status='pending_approval' — correct — and I moved on.
-- Later, checking whether push worked at all, push_notification_outbox held
-- exactly one row: my own test alert, status='sent'. An unreviewed alert had
-- already reached a real handset before any human saw it. Nothing in the app
-- reports this; the outbox is the only place it is visible.
--
-- (Two of my own mistakes are recorded in the same breath: that test's
-- DELETE ran while impersonating the asha_worker, who has no delete
-- permission, so RLS discarded it silently and the row stayed live for hours
-- — the exact silent-write class this whole audit is about, in my own
-- verification. Cleanup is now done as the privileged role and asserted.)
-- =====================================================================

-- ── 1. On INSERT, push only what is already approved ─────────────────────
-- auto_approve_alert_fn approves on insert for super_admin, health_admin,
-- clinic and district_officer. Those are the humans, and their own insert IS
-- the human decision. Everyone else lands 'pending_approval' and waits.
CREATE OR REPLACE FUNCTION public.push_on_alert_created()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_body TEXT;
BEGIN
    -- The rule, in one line.
    IF COALESCE(NEW.approval_status, 'pending_approval') <> 'approved' THEN
        RETURN NEW;
    END IF;
    v_body := COALESCE(substring(NEW.description FROM 1 FOR 100), NEW.title,
                       'New health alert in your area');
    PERFORM notify_users_push(
        p_title           := '🚨 Health Alert: ' || COALESCE(NEW.title, 'New Alert'),
        p_body            := v_body,
        p_data            := jsonb_build_object('screen','AlertDetail','alertId',NEW.id,'district',NEW.district),
        p_trigger_type    := 'alert_created',
        p_reference_id    := NEW.id,
        p_reference_table := 'health_alerts',
        p_target_district := NEW.district);
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_alert_created failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- ── 2. ...and push when a human DOES approve it ──────────────────────────
-- Without this, closing the hole above would mean an ASHA worker's APPROVED
-- alert never reaches anyone — trading a rule violation for a silent failure,
-- which is the trade this codebase has already made too many times. The guard
-- is the TRANSITION, so re-saving an approved alert cannot push twice.
CREATE OR REPLACE FUNCTION public.push_on_alert_approved()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_body TEXT;
BEGIN
    IF NEW.approval_status <> 'approved'
       OR COALESCE(OLD.approval_status, 'pending_approval') = 'approved' THEN
        RETURN NEW;
    END IF;
    v_body := COALESCE(substring(NEW.description FROM 1 FOR 100), NEW.title,
                       'New health alert in your area');
    PERFORM notify_users_push(
        p_title           := '🚨 Health Alert: ' || COALESCE(NEW.title, 'New Alert'),
        p_body            := v_body,
        p_data            := jsonb_build_object('screen','AlertDetail','alertId',NEW.id,'district',NEW.district),
        p_trigger_type    := 'alert_approved',
        p_reference_id    := NEW.id,
        p_reference_table := 'health_alerts',
        p_target_district := NEW.district);
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_alert_approved failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_on_alert_approved ON public.health_alerts;
CREATE TRIGGER trg_push_on_alert_approved
  AFTER UPDATE OF approval_status ON public.health_alerts
  FOR EACH ROW EXECUTE FUNCTION public.push_on_alert_approved();

-- =====================================================================
-- VERIFICATION (live, 2026-08-02). G2 and G4 matter as much as G1: a fix that
-- stops unapproved pushes but also stops APPROVED ones is not a fix.
--   G1 asha alert pending_approval, pushes=0  PASS - waits, nobody notified
--   G2 pushes after approval (1)              PASS - reaches people once approved
--   G3 pushes after re-save (1)               PASS - transition-guarded, no duplicate
--   G4 officer alert approved, pushes=1       PASS - human author, goes immediately
--   G5 no residue left behind                 PASS
-- =====================================================================

-- ── STILL OPEN, deliberately ─────────────────────────────────────────────
--  * notify_on_unsafe_water pushes ONLY district_officer while writing in-app
--    notification rows for clinic and health_admin too. The ProfileScreen
--    caption now states the narrow behaviour truthfully, so it is honest
--    either way, but the two channels disagree and one of them should move.
--  * notify_users_push and retry_pending_push embed a JWT literal as the
--    fallback when the app.service_role_key GUC is unset (it IS unset, so the
--    literal is live). Decoded, it is the ANON key — the same value shipped in
--    every APK, not a service-role key — so this is not a privilege leak. It
--    is still a rotation landmine: changing the anon key silently kills push,
--    and the failure is swallowed into RETURN -1.
