-- =====================================================================
-- PERFORMANCE ADVISOR TRIAGE — 146 lints, ONE applied
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
--
-- Recording the triage as well as the fix, because three of the four lint
-- classes are things you should NOT act on here, and the next person to run
-- get_advisors will see the same 146 and be tempted.
-- =====================================================================

-- ── APPLIED: duplicate_index (1) ────────────────────────────────────────
-- health_alerts carried two byte-identical btree indexes on (district),
-- confirmed identical from pg_indexes before dropping. A duplicate index is
-- pure cost: every INSERT/UPDATE/DELETE maintains both and the planner can
-- only use one. Kept the plural name, which matches the table.
DROP INDEX IF EXISTS public.idx_alert_district;

-- ── NOT APPLIED: unused_index (59) ──────────────────────────────────────
-- "Index X has not been used" is measured against THIS database, whose
-- largest table is audit_logs at 119 rows and whose next largest are in
-- single digits. Postgres seq-scans all of them regardless of what indexes
-- exist, so pg_stat_user_indexes shows zero scans for almost everything.
-- The lint is describing the size of the test fixture, not the design.
-- Dropping a production index on that evidence would be a real outage in a
-- district with real volume. Re-run this advisory only against a database
-- with representative data.

-- ── NOT APPLIED: auth_rls_initplan (57) ─────────────────────────────────
-- Policies that call auth.uid() / current_setting() per ROW rather than once
-- per statement. The remedy is mechanical and semantically identical —
-- wrap the call as (SELECT auth.uid()) so the planner hoists it to an
-- InitPlan — and every policy written during this audit already does that.
--
-- Not swept across the other 57 in one pass, deliberately: regenerating that
-- many policy definitions programmatically is exactly the kind of change that
-- silently widens or narrows access, and the cost it buys back is
-- proportional to row count, which is currently double digits. It is a real
-- optimisation for the day this carries a district's traffic, and it should
-- be done table by table with the before/after row visibility asserted —
-- not blind, and not while other work is in flight.

-- ── NOT APPLIED: multiple_permissive_policies (29) ──────────────────────
-- Overlapping permissive policies on the same table/role/action; every one
-- adds an OR term to each query. This is the plan's REF-01 (policy collapse)
-- and it is a genuine simplification, but collapsing policies changes who can
-- see what if it is done carelessly — and this database has already shown
-- three separate cases where a policy that looked redundant was the only
-- grant for a role. It needs the same per-table, impersonate-and-assert
-- treatment the dead-'admin' sweep got, not a bulk rewrite.
-- =====================================================================
