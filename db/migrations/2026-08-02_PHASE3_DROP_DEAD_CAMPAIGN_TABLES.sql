-- =====================================================================
-- PHASE 3 — FIX THE CAMPAIGN VIEW, DROP THE DEAD TABLES AND MATVIEW
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
-- Taken on the owner's instruction to decide rather than ask.
--
-- The drop was blocked by a dependency that turned out to be a bug in its
-- own right, so this migration fixes that first.
-- =====================================================================

-- ── 1. mv_campaign_effectiveness: a stale snapshot of a broken view ──────
-- Built on vw_campaign_effectiveness (below), so it inherited that view's
-- emptiness. Verified before dropping: 0 rows, no routine refreshes it, no
-- cron job mentions it (the only scheduled jobs are push-retry,
-- telemetry-purge and events-purge), and the sole reference anywhere in the
-- repo was the assertion that flagged it as API-readable.
--
-- Dropping resolves invariant A10 permanently — there is no materialized view
-- left to leak — rather than leaving one revoked and hoping the next person
-- to grant SELECT reads the comment.
DROP MATERIALIZED VIEW IF EXISTS public.mv_campaign_effectiveness;

-- ── 2. vw_campaign_effectiveness was built on the WRONG table ────────────
--
-- It read `FROM campaigns c` — the 0-row dead table — and counted
-- participants with `WHERE p.campaign_id = c.id`. But
-- campaign_participants.campaign_id is a FOREIGN KEY to health_campaigns(id),
-- so it joined participants to a table they can never reference.
--
-- The view had therefore returned zero rows for its entire existence
-- (confirmed: count(*) = 0). That is why getCampaignEffectiveness always fell
-- through to its manual path and Campaign Intelligence never showed a
-- precomputed score — another instance of the pattern that runs through this
-- whole audit: a feature that reports nothing is indistinguishable from a
-- feature with nothing to report.
--
-- Rebuilt on health_campaigns (5 rows). Output columns are unchanged so
-- nothing downstream moves: campaign_name is exposed AS title because that is
-- the contract the view already had, and lib/services/advancedAnalytics.ts
-- reads it via parseCampaignName(['campaign_name','title','name']).
DROP VIEW IF EXISTS public.vw_campaign_effectiveness;

CREATE VIEW public.vw_campaign_effectiveness
WITH (security_invoker = true) AS
WITH campaign_stats AS (
  SELECT c.id,
         c.campaign_name AS title,
         c.district,
         c.start_date,
         c.end_date,
         (SELECT COALESCE(sum(d.cases_count), 0::bigint)
            FROM disease_reports d
           WHERE d.district = c.district
             AND d.created_at >= (c.start_date - '7 days'::interval)
             AND d.created_at <= c.start_date) AS cases_before,
         (SELECT COALESCE(sum(d.cases_count), 0::bigint)
            FROM disease_reports d
           WHERE d.district = c.district
             AND d.created_at >= c.start_date
             AND d.created_at <= c.end_date) AS cases_after,
         (SELECT count(*)
            FROM campaign_participants p
           WHERE p.campaign_id = c.id) AS participation_count
    FROM health_campaigns c
)
SELECT id, title, district, cases_before, cases_after, participation_count,
       CASE WHEN cases_before = 0 THEN 0::numeric
            ELSE (cases_before - cases_after)::numeric / cases_before::numeric * 100::numeric
       END AS success_score
  FROM campaign_stats;

-- security_invoker: the caller's own RLS on health_campaigns and
-- disease_reports applies, so district scoping survives the view.
GRANT SELECT ON public.vw_campaign_effectiveness TO authenticated;

-- ── 3. Drop the dead tables ──────────────────────────────────────────────
--
--   campaigns            0 rows, superseded by health_campaigns (5 rows)
--   campaign_volunteers  0 rows, superseded by campaign_participants (10 rows)
--
-- Nothing read them. The only client writer was lib/services/campaigns.ts, a
-- dead parallel enrolment path deleted earlier the same day, and the last
-- database dependency was the view corrected above. No inbound foreign keys
-- from any other table. Policies, triggers, indexes and constraints go with
-- them.
--
-- Four assertion allowlist entries existed solely to tolerate these two
-- tables — three unindexed foreign keys (A5) and the last policies naming the
-- dead 'admin' role (A3). All four are deleted in the same commit, so the
-- suite fails again if either is reintroduced. That is the point of dropping
-- rather than allowlisting: the excuse disappears with the thing it excused.
DROP TABLE IF EXISTS public.campaign_volunteers;
DROP TABLE IF EXISTS public.campaigns;

-- =====================================================================
-- VERIFICATION (live, 2026-08-02). F1-F3 are the ones that matter: they
-- prove the view now returns real data rather than merely existing.
--   F1 vw_campaign_effectiveness rows (5)          PASS - was 0 forever
--   F2 sample title="COVID VACCINATION DRIVE" p=4  PASS
--   F3 total participants joined (10)              PASS - join reaches rows
--   F4 campaigns / campaign_volunteers / mv gone   PASS
--   F5 health_campaigns=5 campaign_participants=10 PASS - untouched
--   F6 asha reads the view (5 rows, RLS-scoped)    PASS
-- =====================================================================
