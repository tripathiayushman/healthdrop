-- =====================================================================
-- PHASE 2 — MAKE THE MISSION LOOP ACTUALLY WORK
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
-- Source of truth: docs/REFINEMENT_PLAN.md §4 (Broken & incomplete).
--
-- Four independent SILENT failures. Every one of them reported success to
-- the user while doing nothing. That shared shape is the real finding: this
-- codebase had several places where a write is swallowed and the UI cheers.
-- Everything below is idempotent and safe to re-run.
-- =====================================================================

-- ── 1. Officer approvals were being silently discarded ───────────────────
--
-- resolve_conflict() is a BEFORE UPDATE trigger on disease_reports and
-- water_quality_reports. It read:
--     IF NEW.last_updated_at > OLD.last_updated_at THEN RETURN NEW;
--     ELSE RETURN OLD; END IF;
--
-- Nothing in the app ever sets last_updated_at (verified: 0 of 4 rows had a
-- value). So the comparison was NULL > NULL, which is NULL, not true — the
-- ELSE branch ran, and a BEFORE UPDATE trigger that returns OLD CANCELS THE
-- WRITE. Every approval, rejection, verification and edit made by every
-- officer was thrown away, and PostgREST still returned 200 so the UI showed
-- success. Nobody could have noticed except by re-reading the row.
--
-- New behaviour: only refuse a write that is PROVABLY stale — both stamps
-- present and the incoming one genuinely older — and never do it silently.
CREATE OR REPLACE FUNCTION public.resolve_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.last_updated_at IS NOT NULL
     AND NEW.last_updated_at IS NOT NULL
     AND NEW.last_updated_at < OLD.last_updated_at THEN
    RAISE WARNING
      'resolve_conflict: discarded a stale write to %.% id=% (incoming % < stored %)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id, NEW.last_updated_at, OLD.last_updated_at;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. ...and fixing that alone would have made things worse ─────────────
--
-- calculate_response_time() assigns NEW.response_time_hours, a column that
-- did not exist. While resolve_conflict swallowed every UPDATE the error
-- never surfaced; the moment approvals began working, each one would have
-- failed hard with 42703 (undefined_column). Two bugs were masking each
-- other, which is why neither had ever been reported.
--
-- Added rather than dropping the trigger: it is the officer response-time
-- metric the dashboards want, and it costs one nullable numeric.
ALTER TABLE public.disease_reports
  ADD COLUMN IF NOT EXISTS response_time_hours numeric;

-- ── 3. An ASHA worker could not record SAFE water ────────────────────────
--
-- Three CHECK constraints had accumulated on overall_quality:
--   chk_overall_quality                          safe|moderate|poor|contaminated|unsafe|critical
--   valid_quality                                good|moderate|poor|unsafe
--   water_quality_reports_overall_quality_check  safe|moderate|unsafe|critical
--
-- A row must satisfy ALL THREE. The intersection is {moderate, unsafe}.
-- "Safe" — by far the most common real-world result — and "critical" — the
-- most urgent — both silently failed to save.
--
-- The evidence was sitting in the data: every water row in the database was
-- 'moderate', the only value the app offers that could ever be written.
ALTER TABLE public.water_quality_reports DROP CONSTRAINT IF EXISTS chk_overall_quality;
ALTER TABLE public.water_quality_reports DROP CONSTRAINT IF EXISTS valid_quality;
ALTER TABLE public.water_quality_reports DROP CONSTRAINT IF EXISTS water_quality_reports_overall_quality_check;

-- One constraint: the four values the app writes, plus the two legacy
-- spellings historical rows may carry.
ALTER TABLE public.water_quality_reports
  ADD CONSTRAINT water_quality_reports_overall_quality_check
  CHECK (overall_quality = ANY (ARRAY[
    'safe'::text, 'moderate'::text, 'unsafe'::text, 'critical'::text,
    'poor'::text, 'contaminated'::text
  ]));

-- ── 4. Unsafe-water alerts notified nobody (a bug I shipped myself) ──────
--
-- notify_on_unsafe_water inserted related_type='water_quality_report', but
-- the notifications CHECK permits only 'water_report'. Every insert violated
-- the constraint; the function's own catch-all handler swallowed it; the
-- feature was marked done. Zero such notifications had ever existed.
--
-- The handler stays non-blocking (a failed notification must never block a
-- water report) but now RAISEs a WARNING instead of vanishing.
CREATE OR REPLACE FUNCTION public.notify_on_unsafe_water()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_title TEXT;
    v_msg   TEXT;
    v_role  TEXT;
BEGIN
    IF NEW.overall_quality NOT IN ('unsafe','critical','poor','contaminated') THEN
        RETURN NEW;
    END IF;

    v_title := '💧 Unsafe water: ' || COALESCE(NEW.source_name, 'water source') || ' — ' || NEW.district;
    v_msg :=
        'A water quality report flagged ' || NEW.overall_quality || ' water.' || CHR(10) ||
        'Source: '   || COALESCE(NEW.source_name, 'unknown') || CHR(10) ||
        'Location: ' || COALESCE(NEW.location_name, NEW.district) || CHR(10) ||
        'District: ' || NEW.district || CHR(10) ||
        'Verify and arrange retesting/remediation.';

    FOREACH v_role IN ARRAY ARRAY['district_officer','clinic'] LOOP
        INSERT INTO notifications (title, message, type, priority, target_role,
            target_district, related_type, related_id, is_read)
        VALUES (v_title, v_msg, 'warning', 'high', v_role,
            NEW.district, 'water_report', NEW.id, FALSE);
    END LOOP;
    INSERT INTO notifications (title, message, type, priority, target_role,
        target_district, related_type, related_id, is_read)
    VALUES (v_title, v_msg, 'warning', 'high', 'health_admin',
        NULL, 'water_report', NEW.id, FALSE);

    PERFORM notify_users_push(
        p_title           := v_title,
        p_body            := 'Unsafe water reported at ' || COALESCE(NEW.source_name, NEW.district) || '. Verify and arrange retesting.',
        p_data            := jsonb_build_object('screen','Reports','reportId',NEW.id,'district',NEW.district),
        p_trigger_type    := 'water_unsafe',
        p_reference_id    := NEW.id,
        p_reference_table := 'water_quality_reports',
        p_target_role     := 'district_officer',
        p_target_district := NEW.district
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_on_unsafe_water failed for report %: % (%)', NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$function$;

-- ── 5. A cron job that had failed 961 times ──────────────────────────────
--
-- escalate-reports-job ran hourly calling escalate_pending_reports(), which
-- does not exist: 961 all-time failures, 24 in the last day, nobody watching.
-- Unscheduled rather than left permanently red. The escalation SCREEN reads
-- live data and never depended on this job. Re-create it only alongside a
-- real escalate_pending_reports().
DO $$
BEGIN
  PERFORM cron.unschedule('escalate-reports-job');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'escalate-reports-job not scheduled: %', SQLERRM;
END $$;

-- ── 6. Deleting a notification silently did nothing ──────────────────────
--
-- Found by db/assertions.sql invariant A8: notifications had RLS enabled but
-- no DELETE policy, so lib/services/notifications.ts:206,226 deleted zero
-- rows while PostgREST reported success — the same swallow-and-cheer shape
-- as #1. Users may delete their own; broadcast rows are shared and stay.
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =====================================================================
-- VERIFICATION — run after applying. All six must report PASS.
-- These are BEHAVIOURAL, not structural: an earlier structural-only check
-- of #4 passed while the feature was completely broken.
-- =====================================================================
--
-- Note when writing such a test: disease_reports has an auto-approve trigger
-- that sets approval_status on INSERT based on the reporter's role. A test
-- that inserts as an officer and then "approves" is a no-op and PASSES
-- meaninglessly. Always move the row to a value DIFFERENT from the one the
-- trigger left, and assert on a free-text field too.
--
--   INSERT ... RETURNING id INTO v_rid;
--   SELECT approval_status INTO v_before FROM disease_reports WHERE id=v_rid;
--   UPDATE disease_reports
--      SET approval_status = CASE WHEN v_before='approved' THEN 'rejected'
--                                 ELSE 'approved' END,
--          notes = 'EDITED BY OFFICER'
--    WHERE id = v_rid;
--   -- both the status change AND notes must have persisted.
--
-- Live results, 2026-08-02:
--   B1  approval persists (approved -> rejected)     PASS
--   B1b response_time_hours recorded                 PASS
--   B2  genuinely stale write still refused          PASS
--   B3  safe water saves                             PASS
--   B4  unsafe water notifies (3 rows)               PASS
--   B5  critical water saves + notifies (3)          PASS

-- ── NOT changed here, and why ────────────────────────────────────────────
--
--  * auto_approve_report(): gates on role 'admin', which does not exist in
--    this six-role system. It is attached to NO trigger — the live tables all
--    use auto_approve_reporter_id_report / _created_by_ / _organizer_id_,
--    which gate correctly on super_admin|health_admin|clinic|district_officer.
--    Dead code, not a live bug; belongs to the delete phase. Left standing
--    here so this migration stays about behaviour that users can observe.
--
--  * campaign_volunteers DELETE policy (assertion A8's other half): NOT added.
--    The table has 0 rows and nothing reads it; the live enrolment path is
--    campaign_participants. Adding a policy would preserve a dead write path.
--    The fix is to remove the path in the client, not to grant it permission.
