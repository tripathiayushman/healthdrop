-- =====================================================================
-- HealthDrop — cron health check
-- =====================================================================
--
-- WHAT THIS IS
--   A single, idempotent, READ-ONLY script. It reads `cron.job` and
--   `cron.job_run_details` and nothing else. It fails if any scheduled
--   job recorded a run with status='failed' in the last 24 hours,
--   naming the job, the command, the failure count and the error text.
--
-- WHY IT EXISTS
--   docs/REFINEMENT_PLAN.md BRK-08: `escalate-reports-job` runs hourly,
--   calls a function that does not exist, and had failed **960 times** —
--   forty days of continuous, invisible failure — before anyone looked.
--   Meanwhile `EscalationMonitoringScreen` computes "Overdue" client-side,
--   so the app looked alive while nothing server-side escalated anything.
--   A permanently-red job also masks every *future* cron failure, which is
--   the real reason this check has to be a build gate and not a dashboard.
--
-- HOW TO RUN
--   node scripts/check-db.cjs          (preferred — see db/README.md)
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db/cron-health.sql
--
-- NOTE ON PERMISSIONS
--   `cron.job_run_details` is owned by the `postgres` role on Supabase.
--   Run this as `postgres` (the connection string from Project Settings ->
--   Database). If pg_cron is not installed, or the tables are not visible
--   to the connected role, the script says so and passes rather than
--   failing the build on a missing capability — an unreadable check is an
--   ops problem, not a defect in the schema.
--
-- =====================================================================

DO $cron_health$
DECLARE
  r          record;
  v_failed   integer := 0;   -- jobs failing inside the window
  v_runs     integer := 0;   -- failed runs inside the window
  v_window   interval := interval '24 hours';
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== HealthDrop cron health — last % as of % ===', v_window, now();
  RAISE NOTICE '';

  IF to_regclass('cron.job_run_details') IS NULL OR to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'SKIP  pg_cron run history is not visible to %. Nothing checked.', current_user;
    RAISE NOTICE '      Install pg_cron, or connect as the postgres role, to enable this gate.';
    RETURN;
  END IF;

  IF NOT has_table_privilege(current_user, 'cron.job_run_details', 'SELECT') THEN
    RAISE NOTICE 'SKIP  % cannot SELECT cron.job_run_details. Nothing checked.', current_user;
    RETURN;
  END IF;

  -- Inventory first: an operator reading CI output should see the whole
  -- schedule, not only the part that is on fire.
  FOR r IN
    SELECT j.jobid, j.jobname, j.schedule, j.command, j.active,
           (SELECT count(*) FROM cron.job_run_details d
             WHERE d.jobid = j.jobid AND d.status = 'failed')::int AS failed_all_time,
           (SELECT count(*) FROM cron.job_run_details d
             WHERE d.jobid = j.jobid AND d.status = 'failed'
               AND d.start_time > now() - v_window)::int AS failed_window,
           (SELECT count(*) FROM cron.job_run_details d
             WHERE d.jobid = j.jobid AND d.status = 'succeeded'
               AND d.start_time > now() - v_window)::int AS ok_window
    FROM cron.job j
    ORDER BY j.jobid
  LOOP
    RAISE NOTICE 'job % "%"  schedule=%  active=%  last24h: % ok / % failed  (% failed all-time)',
      r.jobid, r.jobname, r.schedule, r.active, r.ok_window, r.failed_window, r.failed_all_time;
  END LOOP;
  RAISE NOTICE '';

  -- Now the failures themselves, one line per job with the real error text.
  FOR r IN
    SELECT d.jobid,
           coalesce(j.jobname, '(unscheduled job ' || d.jobid || ')') AS jobname,
           coalesce(j.command, '(command unknown — job removed)')     AS command,
           count(*)::int                                             AS runs,
           min(d.start_time)                                         AS first_seen,
           max(d.start_time)                                         AS last_seen,
           (SELECT count(*) FROM cron.job_run_details d2
             WHERE d2.jobid = d.jobid AND d2.status = 'failed')::int  AS failed_all_time,
           (array_agg(d.return_message ORDER BY d.start_time DESC))[1] AS last_error
    FROM cron.job_run_details d
    LEFT JOIN cron.job j ON j.jobid = d.jobid
    WHERE d.status = 'failed'
      AND d.start_time > now() - v_window
    GROUP BY d.jobid, j.jobname, j.command
    ORDER BY runs DESC, d.jobid
  LOOP
    IF r.command = '(command unknown — job removed)' THEN
      -- The job no longer exists in cron.job, so these runs are history: it
      -- cannot fail again. Unscheduling is exactly what the HINT below tells
      -- you to do, and failing the build for another 24 hours afterwards
      -- would punish taking the advice — and worse, would make "wait for the
      -- window to roll" the way to go green, which is indistinguishable from
      -- ignoring it. Reported loudly, not fatally, so the record stays
      -- visible while the gate goes back to watching LIVE jobs.
      RAISE NOTICE E'GONE cron job % "%" failed % time(s) in the last % before it was unscheduled (% failed all-time)\n     error   : %',
        r.jobid, r.jobname, r.runs, v_window, r.failed_all_time,
        rtrim(replace(coalesce(r.last_error, '(no return_message recorded)'), E'\n', ' '));
      CONTINUE;
    END IF;

    v_failed := v_failed + 1;
    v_runs   := v_runs + r.runs;
    RAISE WARNING E'FAIL cron job % "%" failed % time(s) in the last % (% failed all-time)\n     command : %\n     window  : % .. %\n     error   : %',
      r.jobid, r.jobname, r.runs, v_window, r.failed_all_time,
      r.command, r.first_seen, r.last_seen,
      rtrim(replace(coalesce(r.last_error, '(no return_message recorded)'), E'\n', ' '));
  END LOOP;

  RAISE NOTICE '';
  IF v_failed = 0 THEN
    RAISE NOTICE 'ALL CLEAR — no cron job failed in the last %.', v_window;
  ELSE
    RAISE EXCEPTION 'CRON HEALTH FAILED: % job(s), % failed run(s) in the last %',
      v_failed, v_runs, v_window
      USING DETAIL = 'Each failing job is named on a WARNING line above, with its last error.',
            HINT   = 'Fix the job or unschedule it (SELECT cron.unschedule(<jobid>)). '
                     'A permanently-red job hides every future cron failure — that is '
                     'how BRK-08 stayed invisible for 40 days.';
  END IF;
END
$cron_health$;
