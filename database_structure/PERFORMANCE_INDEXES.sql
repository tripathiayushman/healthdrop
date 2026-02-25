-- =====================================================
-- PERFORMANCE_INDEXES.sql
-- BTree, Partial, and Composite Indexes for Scale
--
-- Index strategy summary:
--   BTree    — default; ideal for equality, range, ORDER BY, LIKE 'prefix%'
--   Partial  — adds a WHERE clause; smaller index, faster for selective queries
--   Composite— multiple columns; useful when queries filter on all of them
--   GiST     — already created in GEOGRAPHIC_HEATMAP.sql (spatial columns)
--   GIN      — useful for JSONB/array search (not needed here yet)
--
-- All indexes use IF NOT EXISTS — safe to re-run.
-- Indexes are created CONCURRENTLY where noted to avoid locking
-- (Supabase SQL Editor runs statements sequentially, so CONCURRENTLY
-- is omitted here — add it when running against a live production DB).
--
-- IMPORTANT: Every RLS policy does a subquery like:
--   EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'X' ...)
-- This means profiles is hit on EVERY authenticated query.
-- The profiles indexes are therefore the HIGHEST IMPACT in the entire system.
-- =====================================================


-- =====================================================
-- TABLE: profiles
-- Hit on every single RLS check across all tables.
-- Priority: CRITICAL
-- =====================================================

-- Covers: all RLS USING() subqueries that check role + is_active
-- Pattern: WHERE id = auth.uid() AND role = 'clinic' AND is_active = TRUE
-- Partial index on is_active = TRUE shrinks the index by ~50% if half accounts are inactive.
CREATE INDEX IF NOT EXISTS idx_profiles_id_role_active
    ON profiles (id, role)
    WHERE is_active = TRUE;

-- Covers: district-scoped RLS lookups
-- Pattern: WHERE id = auth.uid() AND role = 'district_officer' AND district = X AND is_active = TRUE
CREATE INDEX IF NOT EXISTS idx_profiles_role_district_active
    ON profiles (role, district)
    WHERE is_active = TRUE;
-- Reasoning: district_officer + clinic RLS policies resolve this subquery on every row scan.
-- Without this, Postgres does a seq-scan on profiles for every row in the outer table.

-- Covers: getStatistics() and user listing queries
-- Pattern: WHERE role = 'asha_worker' AND is_active = TRUE
CREATE INDEX IF NOT EXISTS idx_profiles_role
    ON profiles (role)
    WHERE is_active = TRUE;

-- Covers: email-based login lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email
    ON profiles (email);


-- =====================================================
-- TABLE: disease_reports
-- Core table. Every dashboard, RLS, and trigger hits it.
-- =====================================================

-- 1. Plain district index — used in RLS district-scoped SELECT policies
--    Pattern: WHERE district = 'Patna'
CREATE INDEX IF NOT EXISTS idx_disease_reports_district
    ON disease_reports (district);

-- 2. Composite: district + approval_status — the single most common query pattern.
--    All clinic/district_officer dashboards filter by both simultaneously.
--    Pattern: WHERE district = 'Patna' AND approval_status = 'approved'
CREATE INDEX IF NOT EXISTS idx_disease_reports_district_approval
    ON disease_reports (district, approval_status);

-- 3. Partial index on pending_approval only — powers the "Pending Approvals" dashboard widget.
--    95% of approval-related queries are looking for PENDING rows (to act on them).
--    The other statuses (approved, rejected) are historical and queried less urgently.
--    Partial index is ~3× smaller than a full approval_status index.
CREATE INDEX IF NOT EXISTS idx_disease_reports_pending
    ON disease_reports (district, created_at DESC)
    WHERE approval_status = 'pending_approval';

-- 4. Status index (report lifecycle: reported → investigating → resolved)
--    Pattern: WHERE status = 'investigating'
CREATE INDEX IF NOT EXISTS idx_disease_reports_status
    ON disease_reports (status);

-- 5. Composite: disease_name + district + created_at
--    Critical for the outbreak detection trigger (detect_outbreak_after_report).
--    The trigger runs: WHERE disease_name = X AND district = Y AND created_at >= NOW() - 7 days
CREATE INDEX IF NOT EXISTS idx_disease_reports_outbreak_lookup
    ON disease_reports (disease_name, district, created_at DESC);

-- 6. reporter_id FK index — for "my reports" queries and JOIN to profiles
CREATE INDEX IF NOT EXISTS idx_disease_reports_reporter_id
    ON disease_reports (reporter_id);

-- 7. Approved reports timeline — powers public/volunteer feeds and national stats
--    Pattern: WHERE approval_status = 'approved' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_disease_reports_approved_timeline
    ON disease_reports (created_at DESC)
    WHERE approval_status = 'approved';

-- 8. Severity filter — for high-priority alert queries
--    Pattern: WHERE severity IN ('high','critical') AND approval_status = 'approved'
CREATE INDEX IF NOT EXISTS idx_disease_reports_high_severity
    ON disease_reports (district, created_at DESC)
    WHERE severity IN ('high', 'critical')
      AND approval_status = 'approved';


-- =====================================================
-- TABLE: water_quality_reports
-- =====================================================

-- 1. overall_quality — primary filter for water quality dashboards
--    Pattern: WHERE overall_quality IN ('poor','contaminated')
CREATE INDEX IF NOT EXISTS idx_water_quality_overall
    ON water_quality_reports (overall_quality);

-- 2. Partial: poor/contaminated/unsafe water only
--    Powers the "Water Alerts" widget — only unsafe reports are acted on urgently.
CREATE INDEX IF NOT EXISTS idx_water_quality_unsafe
    ON water_quality_reports (district, created_at DESC)
    WHERE overall_quality IN ('poor', 'contaminated', 'unsafe', 'critical');

-- 3. District + approval_status composite — same pattern as disease_reports
CREATE INDEX IF NOT EXISTS idx_water_reports_district_approval
    ON water_quality_reports (district, approval_status);

-- 4. Pending approval partial
CREATE INDEX IF NOT EXISTS idx_water_reports_pending
    ON water_quality_reports (district, created_at DESC)
    WHERE approval_status = 'pending_approval';

-- 5. Reporter FK
CREATE INDEX IF NOT EXISTS idx_water_reports_reporter_id
    ON water_quality_reports (reporter_id);

-- 6. Approved reports timeline (public visibility)
CREATE INDEX IF NOT EXISTS idx_water_reports_approved_timeline
    ON water_quality_reports (created_at DESC)
    WHERE approval_status = 'approved';


-- =====================================================
-- TABLE: health_campaigns (app-facing table)
-- =====================================================

-- 1. Status index — powers active/upcoming campaign lists
--    Pattern: WHERE status = 'ongoing'
CREATE INDEX IF NOT EXISTS idx_health_campaigns_status
    ON health_campaigns (status);

-- 2. Partial: only active/planned campaigns
--    The majority of UI queries filter for live campaigns. Completed / cancelled
--    campaigns are historical; exclude them from the hot index path.
CREATE INDEX IF NOT EXISTS idx_health_campaigns_active
    ON health_campaigns (district, created_at DESC)
    WHERE status IN ('planned', 'ongoing');

-- 3. District index — RLS district-scoped policies
CREATE INDEX IF NOT EXISTS idx_health_campaigns_district
    ON health_campaigns (district);

-- 4. Organizer FK — "my campaigns" view
CREATE INDEX IF NOT EXISTS idx_health_campaigns_organizer
    ON health_campaigns (organizer_id);

-- 5. Composite: district + status — common combined filter
CREATE INDEX IF NOT EXISTS idx_health_campaigns_district_status
    ON health_campaigns (district, status);


-- =====================================================
-- TABLE: campaigns (legacy — guarded)
-- =====================================================

DO $do$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'campaigns') THEN
        -- Status index
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaigns_status') THEN
            EXECUTE 'CREATE INDEX idx_campaigns_status ON campaigns (status)';
        END IF;
        -- District + status composite
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaigns_district_status') THEN
            EXECUTE 'CREATE INDEX idx_campaigns_district_status ON campaigns (district, status)';
        END IF;
        -- Active campaigns partial
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaigns_active') THEN
            EXECUTE $inner$
                CREATE INDEX idx_campaigns_active
                    ON campaigns (district, created_at DESC)
                    WHERE status IN ('planned','ongoing')
            $inner$;
        END IF;
    END IF;
END $do$;


-- =====================================================
-- TABLE: notifications
-- Queried constantly: unread badge count on every app load.
-- =====================================================

-- 1. Composite: user_id + is_read — PRIMARY performance index for this table.
--    Pattern: WHERE user_id = auth.uid() AND is_read = FALSE ORDER BY created_at DESC
--    This covers: notification bell count, unread list fetch.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, created_at DESC)
    WHERE is_read = FALSE;
-- Reasoning: Partial index on is_read=FALSE means the index only contains unread rows.
-- As users read notifications, rows drop out of the index automatically.
-- A full (user_id, is_read) index would be twice as large with no benefit for read rows.

-- 2. Full user_id + created_at — for notification history (all read/unread)
CREATE INDEX IF NOT EXISTS idx_notifications_user_timeline
    ON notifications (user_id, created_at DESC);

-- 3. Target role + district — used by outbreak notification dispatcher
--    Pattern: WHERE target_role = 'clinic' AND target_district = 'Patna'
CREATE INDEX IF NOT EXISTS idx_notifications_target_role_district
    ON notifications (target_role, target_district)
    WHERE target_role IS NOT NULL;



-- =====================================================
-- TABLE: outbreaks
-- (Added by OUTBREAK_DETECTION.sql)
-- =====================================================

-- 1. Active outbreaks by district — dashboard widget
--    Pattern: WHERE status != 'resolved' AND district = X
CREATE INDEX IF NOT EXISTS idx_outbreaks_active_district
    ON outbreaks (district, created_at DESC)
    WHERE status != 'resolved';

-- 2. Disease + district — duplicate-check in trigger
--    The detect_outbreak_after_report() trigger queries:
--    WHERE disease_name = X AND district = Y AND status != 'resolved'
CREATE INDEX IF NOT EXISTS idx_outbreaks_disease_district
    ON outbreaks (disease_name, district)
    WHERE status != 'resolved';

-- 3. Status index — global "all active outbreaks" admin view
CREATE INDEX IF NOT EXISTS idx_outbreaks_status
    ON outbreaks (status, created_at DESC);


-- =====================================================
-- TABLE: health_alerts
-- Real columns: status, urgency_level, district,
--               created_by, created_at
-- =====================================================

-- 1. District + created_at DESC — district-level alert feed and RLS
CREATE INDEX IF NOT EXISTS idx_health_alerts_district
    ON health_alerts (district, created_at DESC);

-- 2. urgency_level — matches existing idx_health_alerts_urgency in DATABASE_SCHEMA.sql
--    High-urgency alert filtering
CREATE INDEX IF NOT EXISTS idx_health_alerts_urgency
    ON health_alerts (urgency_level, created_at DESC);

-- 3. status — active/inactive alert filtering
CREATE INDEX IF NOT EXISTS idx_health_alerts_status
    ON health_alerts (status);

-- 4. created_by FK — "my alerts" queries and audit joins
CREATE INDEX IF NOT EXISTS idx_health_alerts_created_by
    ON health_alerts (created_by);


-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- List all newly created indexes
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Check index sizes (run after some data exists)
SELECT
    schemaname,
    relname        AS tablename,
    indexrelname   AS indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname LIKE 'idx_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Check for unused indexes (run after some traffic)
-- These should be dropped if idx_scan = 0 after weeks of traffic:
SELECT
    schemaname,
    relname        AS tablename,
    indexrelname   AS indexname,
    idx_scan       AS scans_since_reset
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname LIKE 'idx_%'
  AND idx_scan = 0
ORDER BY relname, indexrelname;

SELECT 'Performance indexes created successfully!' AS status;
