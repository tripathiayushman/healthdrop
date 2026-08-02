# `db/` — the database assertion suite

Two read-only SQL scripts and one runner. They execute against the live
Postgres and fail the build when the schema, the grants, the policies or
the scheduled jobs stop matching what this app assumes.

| File | What it checks |
| --- | --- |
| `assertions.sql` | 11 invariants over grants, policies, constraints and indexes |
| `cron-health.sql` | any `cron.job_run_details` row with `status='failed'` in the last 24 h |
| `../scripts/check-db.cjs` | runs both, exits non-zero on any violation |

```bash
npm run check:db                      # SKIPPED (exit 0) if SUPABASE_DB_URL is unset
SUPABASE_DB_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require" npm run check:db
```

Both scripts are **read-only and idempotent**: they read system catalogues
and `cron.job_run_details`, write nothing, and can be run any number of
times against production without side effects.

---

## Why this exists

`docs/REFINEMENT_PLAN.md` §2.6 records the verification bar this project
kept failing: things were "verified by reading" and later turned out to be
wrong. §8 Phase 0 names the fix — SEC-01, SEC-02, SEC-03, SEC-12, BRK-02
and BRK-06 are all **mechanically detectable**, and BRK-08 (a cron job)
had failed **960 times** across forty days with nobody noticing.

A document can claim a thing is fixed. A script that runs cannot.

The ship criterion is deliberately *not* "green". It is: **the suite runs,
and today's real defects are recorded as failures rather than hidden.**

---

## Reading the output

Every violation prints one `WARNING` line naming the object:

```
WARNING:  FAIL A5  foreign key disease_reports.disease_reports_approved_by_fkey (approved_by) has no supporting index
WARNING:  FAIL A8  client performs DELETE on public.notifications but no permissive RLS policy allows it (write silently affects 0 rows)  [lib/services/notifications.ts]
```

Passing invariants print `PASS A<n>`. The final exception repeats the
per-invariant counts in its `DETAIL`, so a caller that only captures the
error still learns what failed:

```
ERROR:  DB ASSERTIONS FAILED: 71 violation(s) across 8 of 11 invariants
DETAIL:  A1 anon-EXECUTE on SECURITY DEFINER routine: 22
         A3 role literal outside Profile['role']: 21
         ...
```

---

## The invariants

### A1 — no SECURITY DEFINER routine in `public` is EXECUTE-able by `anon`

**Would have caught:** SEC-01, SEC-02, SEC-03, SEC-12.

A `SECURITY DEFINER` routine runs as its owner, so every RLS policy on
every table it touches is bypassed. Granting `EXECUTE` on one to `anon`
publishes that bypass to anyone who unpacks the APK and reads the
publishable key. That is how `create_admin_user(text)` — whose entire body
is `UPDATE profiles SET role='admin', is_active=true WHERE email=$1` with
no caller check — was reachable unauthenticated, and how
`notify_users_push()` would have let a stranger push *"the water in your
village is poisoned"* to every handset.

Extension-owned routines (PostGIS `ST_EstimatedExtent`) are excluded
structurally — their grants are not ours to set.

Trigger-returning functions **are** reported. PostgREST will not invoke
them as RPCs, but they are inside the blast radius of SEC-01's blanket
`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated`,
and the `returns trigger` marker in the message makes triage instant.

### A2 — every SECURITY DEFINER routine pins its `search_path`

**Would have caught:** the same escalation class as SEC-01.

Without `SET search_path`, a caller who can create a schema puts their own
`profiles` table in front of the real one, and the definer-privileged body
reads it. Cheap to check, impossible to argue with.

### A3 — no policy or routine compares a role against a string outside `Profile['role']`

**Would have caught:** BRK-06.

The six roles live in `types/index.ts:10`. Zero profiles hold `role='admin'`,
yet policies on `outbreaks`, `audit_logs`, `outbreak_thresholds`,
`campaigns`, `user_feedback`, `notification_logs` and `campaign_volunteers`
still gate on it, and so do `resolve_outbreak`, `purge_old_audit_logs`,
`get_deleted_records`, `get_user_audit_log`, `is_admin` and
`dispatch_push_notification`. The result is two failures at once: the
national roles are **blind to the outbreak table this product exists to
fill** — their dashboards render a quiet zero that reads as "no outbreaks"
rather than "no permission" — while a village clinic sees outbreak records
for the entire country.

The detection matches `<anything>role[()]` followed by `=`, `<>`, `!=`,
`IN (…)` or `= ANY (ARRAY[…])`, so one pass covers `profiles.role`,
`get_my_role()`, `v_caller_role`, `target_role` and `p_target_role`, in both
policy expressions and routine bodies.

### A4 — no column carries more than one CHECK constraint

**Would have caught:** BRK-02.

Three CHECKs coexisted on `water_quality_reports.overall_quality`:
`{safe,moderate,poor,contaminated,unsafe,critical}`,
`{good,moderate,poor,unsafe}` and `{safe,moderate,unsafe,critical}`.
CHECKs AND together, so the intersection is `{moderate, unsafe}` — an ASHA
worker who tests a handpump and reports it **Safe**, the most common
outcome there is, gets a raw `23514` and loses the submission. Offline, the
row retries forever. Half the water ladder was unreachable and the dataset
silently censored.

Nobody reads all three. The invariant is not "the CHECKs must agree" — it
is "there must only be one to read".

### A5 — every foreign-key column has a supporting index

**Would have caught:** REF-06 (19 unindexed FKs).

An unindexed FK turns every join and every cascading delete into a
sequential scan. Low severity while the tables hold four rows; the point is
to fix it **before** the pilot loads data, and it costs nothing to check.

"Supporting" means an index whose leading columns are exactly the FK
columns, in any order. Partial and expression indexes are not analysed —
if you add one deliberately, allowlist the constraint.

### A6 — RLS is enabled on every table in `public`

A table without RLS is fully readable and writable by every role holding
the table grant, and `authenticated` holds `SELECT`/`INSERT`/`UPDATE`/
`DELETE` on all of them here. Extension-owned tables (PostGIS
`spatial_ref_sys`) are excluded structurally.

### A7 — no write policy is unconditionally `true`

**Would have caught:** the class behind SEC-08 and REF-01.

Permissive policies **OR** together, so security is decided by the single
loosest of up to fourteen overlapping rules. One `USING (true)` on
INSERT/UPDATE/DELETE/ALL silences every other rule on the table.

### A8 — every write the client performs is actually permitted

**Would have caught:** BRK-01, and two live defects the plan had not found.

A write with no matching permissive policy does not fail loudly. PostgREST
returns 200 with zero rows changed, so the app reports success and the data
never moves — exactly how *every* UPDATE on `disease_reports` was silently
discarded while the approval queue looked healthy.

The check reads a **client-write manifest** embedded in `assertions.sql`,
derived by grepping the app for `.from('<table>').<insert|update|upsert|
delete>` across `lib/`, `components/`, `src/` and `App.tsx`. For each
`(table, command)` pair it asserts a permissive policy exists **and** that
`authenticated` holds the table grant. A manifest row naming a table that
no longer exists is itself reported, so the manifest cannot rot silently.

When a new write lands in the client, add its row. That is the whole
maintenance burden.

### A9 — every INSERT policy on a client-written table binds its owner column to `auth.uid()`

Without the binding a user forges authorship — files a report, an alert or
a campaign under someone else's name. It matters more than it looks:
`alerts_select` grants read access on `created_by = auth.uid()`, and the
approval screens attribute work by the same column. And because permissive
policies OR, **one** unbound INSERT policy defeats every bound one on the
same table.

Tables whose `user_id` is a *recipient* rather than an author
(`notifications`) and admin-managed registries (`role_invitations`,
`water_sources`, `outbreaks`) carry `owner_col = NULL` in the manifest and
are skipped, with the reason recorded inline.

### A10 — no materialized view is readable by `anon` or `authenticated`

**Would have caught:** SEC-13.

Materialized views **never** enforce RLS, whatever `relrowsecurity` says,
so a SELECT grant on one is unconditional. `mv_campaign_effectiveness`
hands every logged-in volunteer the campaign aggregates for every district,
bypassing the district scoping its sibling `security_invoker` view
enforces. `PRODUCTION_READINESS.md` #4 is marked DONE and names this exact
view; the MV half was never done.

### A11 — no table is readable without a session

**Would have caught:** SEC-15 (`campaigns` is anon-readable; readiness #3
wrongly claims a fix).

A permissive SELECT policy applying to `PUBLIC` or `anon` whose qual never
mentions the caller — no `auth.uid()`, no `auth.jwt()`, no
`get_my_role()`/`get_my_district()` — is reachable by anyone holding the
APK's publishable key.

**Known limit, stated rather than hidden.** A qual that mentions
`auth.uid()` in one OR-branch and is identity-free in another passes this
check. That is `alerts_select` (SEC-03): `approval_status = 'approved' OR
… OR created_by = auth.uid()`. Catching it needs expression-tree analysis;
splitting the printed qual on `" OR "` produces false positives on nested
`EXISTS`. SEC-03 stays tracked in the plan and by an anon-key HTTP probe,
not here. **Do not** relax A11 to pretend otherwise.

---

## What it reports today

Recorded 2 Aug 2026 against project `ekfdimdlxifatsaubvbh`. This is the
baseline the Phase-0 ship criterion asks for — real defects on the record,
not a green tick.

| | Invariant | Result | Detail |
| --- | --- | --- | --- |
| A1 | anon EXECUTE on SECURITY DEFINER | **FAIL** | 22 routines (18 trigger fns + `claim_push_token`, `get_my_role`, `get_my_district`, `is_admin`) |
| A2 | pinned `search_path` | PASS | only the 3 PostGIS `st_estimatedextent` overloads lack one, and they are excluded |
| A3 | role literal outside `Profile['role']` | **FAIL** | 21 objects, all `'admin'` — 11 policies + 10 routines |
| A4 | one CHECK per column | **FAIL** | `water_quality_reports.overall_quality` (3), `campaigns.status` (2) |
| A5 | FK has supporting index | **FAIL** | 19 constraints |
| A6 | RLS on every table | PASS | `spatial_ref_sys` is PostGIS-owned and excluded |
| A7 | no unconditional write policy | PASS | all 8 `USING (true)` policies are SELECT-only |
| A8 | client write has a policy | **FAIL** | 2: `campaign_volunteers` DELETE, `notifications` DELETE |
| A9 | INSERT binds owner column | **FAIL** | 2: `health_alerts.alerts_insert`, `health_campaigns.district_officer_insert_campaigns` |
| A10 | no API-readable matview | **FAIL** | 1: `mv_campaign_effectiveness` (authenticated) |
| A11 | no anon-readable table | **FAIL** | 2: `campaigns` via *Everyone can view campaigns* and `campaigns_select` |

**Total: 71 violations across 8 of 11 invariants.**

Two of these were not in the refinement plan. A8's findings are new:
`lib/services/campaigns.ts` un-enrols a volunteer and
`lib/services/notifications.ts` deletes notifications, and **neither table
has a DELETE policy** — so both operations return success and delete
nothing.

A1's count is a moving target: two Phase-1 migrations
(`revoke_anon_execute_on_privileged_functions`,
`phase1_revoke_anon_execute_sweep`) landed on 2 Aug 2026 and already
removed the `anon` grant from `create_admin_user`, `notify_users_push`,
`update_push_outbox_status`, the four geo RPCs and the audit RPCs. Re-run
the suite rather than trusting this table.

### Cron health, 2 Aug 2026

```
job 1 "escalate-reports-job"        0 * * * *     24 failed in 24 h,  961 failed all-time
job 2 "healthdrop-push-retry"       */15 * * * *   0 failed
job 3 "healthdrop-telemetry-purge"  23 3 * * *     0 failed
job 4 "healthdrop-events-purge"     41 3 * * *     0 failed
```

`escalate-reports-job` has now failed **961** times — one more than the 960
the plan recorded — with `ERROR: function escalate_pending_reports() does
not exist`. Nothing server-side escalates an overdue report. Verdict:
`CRON HEALTH FAILED: 1 job(s), 24 failed run(s) in the last 24:00:00`.

---

## Adding an invariant

1. Copy an existing `-- ═══ A<n> ═══` block in `assertions.sql`. Each is
   self-contained: bump `v_checked`, reset `v_n`, loop a detection query,
   `RAISE WARNING` once per offending object, then the standard
   `IF v_n > 0` tail that accumulates `v_total` and `v_summary`.
2. **Name the object in the warning.** "Something is wrong" is what the
   documentation already did. The message must say which policy, which
   constraint, which routine.
3. Write the comment header before the query: what it catches, and the
   finding ID it would have caught. An invariant nobody can justify is an
   invariant somebody will delete under time pressure.
4. If the invariant needs exceptions, add a `k_<name>_allow CONSTANT text[]`
   in the `DECLARE` block and filter on it. Seed it **empty**.
5. Run it against the live database before you commit. If it reports zero
   violations on a database you know is broken, it does not work.

## Adding an exception

Put it in the matching allowlist array with a comment saying **why it is
safe**, and re-run. Never widen a detection query to make it pass — a
query that no longer detects the thing is worse than no query, because it
reports green.

## Notes on running it

- **Connection.** Use the direct connection string (Project Settings →
  Database), as the `postgres` role. `cron.job_run_details` is owned by
  `postgres`; a role that cannot read it makes `cron-health.sql` print
  `SKIP` and pass, because an unreadable check is an ops problem, not a
  schema defect.
- **TLS.** The runner sets `rejectUnauthorized: false` unless the URL
  already carries `sslmode=`, because Supabase's chain is not in most CI
  images. Set `SUPABASE_DB_SSL_STRICT=1` to verify the certificate.
- **Missing secret.** No `SUPABASE_DB_URL` → `SKIPPED`, exit 0. A fork or
  an outside PR has no secret and must not read as a red build. A secret
  that *is* set but with no `pg` and no `psql` exits 1 — a configured gate
  that cannot run is a broken gate.
- **Transport.** `pg` (devDependency) is preferred: it surfaces every
  `WARNING` line. `psql` on `PATH` is the fallback.
- **Not yet wired into CI.** Phase 0's fourth item is adding
  `npm run check:db` to `.github/workflows/build-on-push.yml` alongside the
  contrast gate. Until that lands this runs on demand only.
