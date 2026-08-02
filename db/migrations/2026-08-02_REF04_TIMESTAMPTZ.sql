-- =====================================================================
-- REF-04 — seven `timestamp WITHOUT time zone` columns become timestamptz
-- Applied live to project ekfdimdlxifatsaubvbh on 2026-08-02.
--
-- Why this is not cosmetic. disease_reports.last_updated_at and
-- water_quality_reports.last_updated_at are the columns resolve_conflict()
-- compares to decide whether an incoming offline write is stale enough to
-- DISCARD. A naive column silently drops the offset from an ISO string the
-- client sends: '2026-08-02T14:00:00Z' is stored as 14:00 with no zone, and a
-- later comparison against now() (which IS zone-aware) resolves through
-- whatever the session TimeZone happens to be.
--
-- Today that accident works, because Supabase sessions run in UTC and the
-- client sends UTC. It works by coincidence, not by construction — and the
-- failure mode is a field report silently discarded for being "older" than one
-- it is actually newer than. That is precisely the class of bug this audit
-- spent the day removing from resolve_conflict itself; leaving the ambiguity
-- underneath it would be fixing the symptom and keeping the cause.
--
-- All seven columns held ZERO non-null values (verified immediately before
-- applying), so the conversion moved no data and could not reinterpret an
-- existing timestamp. This is the cheapest this fix will ever be: once offline
-- sync starts writing last_updated_at, the same change would need a considered
-- decision about what the stored naive values were meant to mean.
-- =====================================================================

ALTER TABLE public.disease_reports
  ALTER COLUMN last_updated_at TYPE timestamptz USING last_updated_at AT TIME ZONE 'UTC';
ALTER TABLE public.water_quality_reports
  ALTER COLUMN last_updated_at TYPE timestamptz USING last_updated_at AT TIME ZONE 'UTC';
ALTER TABLE public.notification_logs
  ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC';
ALTER TABLE public.ai_generated_alerts
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.ai_recommendations
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.ai_recommendations
  ALTER COLUMN acted_at  TYPE timestamptz USING acted_at  AT TIME ZONE 'UTC';
ALTER TABLE public.disease_trends
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- =====================================================================
-- VERIFICATION (live, 2026-08-02). H2/H3 exercise the actual conflict
-- resolver rather than just checking the column type: a type change that
-- quietly broke stale-write rejection would be worse than the ambiguity.
--   H1 naive timestamp columns remaining (0)   PASS
--   H2 stale write refused (notes=first)       PASS
--   H3 newer write kept (notes=newer)          PASS
--   H4 test row removed                        PASS
-- =====================================================================
