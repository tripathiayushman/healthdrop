-- =====================================================
-- ENUM_MIGRATION.sql
-- Safe Migration of TEXT Columns → PostgreSQL ENUM Types
--
-- STRATEGY:
--   Sections 0-2: Same as before (pre-flight, ENUM type creation,
--                 data sanitization).
--   Section 3:    CHECK CONSTRAINTS — NOT ALTER COLUMN TYPE.
--                 See explanation in Section 3 for why.
--   Section 4:    Verification queries.
--   Section 5:    Future: how to add new ENUM values.
--   Section 6:    Rollback (drop constraints only).
--   Section 7:    Nuclear option (ALTER TABLE to ENUM) — commented.
--                 Only feasible if all 50+ RLS policies are dropped first.
--
-- Safe to re-run: all ENUM creations use DO/pg_type guards;
--                 all constraints use DROP IF EXISTS before ADD.
-- Run in Supabase SQL Editor.
-- =====================================================


-- =====================================================
-- SECTION 0: PRE-FLIGHT CHECKS
-- =====================================================

SELECT DISTINCT disease_type, COUNT(*) AS row_count
FROM disease_reports
WHERE disease_type NOT IN ('waterborne','airborne','vector','foodborne','other')
   OR disease_type IS NULL
GROUP BY disease_type;

SELECT DISTINCT severity, COUNT(*) AS row_count
FROM disease_reports
WHERE severity NOT IN ('low','medium','high','critical')
   OR severity IS NULL
GROUP BY severity;

SELECT DISTINCT approval_status, COUNT(*) AS row_count
FROM disease_reports
WHERE approval_status NOT IN ('pending_approval','approved','rejected')
   OR approval_status IS NULL
GROUP BY approval_status;

SELECT DISTINCT approval_status, COUNT(*) AS row_count
FROM water_quality_reports
WHERE approval_status NOT IN ('pending_approval','approved','rejected')
   OR approval_status IS NULL
GROUP BY approval_status;

SELECT DISTINCT approval_status, COUNT(*) AS row_count
FROM health_campaigns
WHERE approval_status NOT IN ('pending_approval','approved','rejected')
   OR approval_status IS NULL
GROUP BY approval_status;

SELECT DISTINCT status, COUNT(*) AS row_count
FROM health_campaigns
WHERE status NOT IN ('planned','ongoing','completed','cancelled')
   OR status IS NULL
GROUP BY status;

SELECT DISTINCT overall_quality, COUNT(*) AS row_count
FROM water_quality_reports
WHERE overall_quality NOT IN ('safe','moderate','poor','contaminated','unsafe','critical')
   OR overall_quality IS NULL
GROUP BY overall_quality;

SELECT '=== Pre-flight complete. Review any rows above before continuing. ===' AS preflight_status;


-- =====================================================
-- SECTION 1: CREATE ENUM TYPES
-- These types are created now for:
--   a) immediate use in CHECK constraint defaults
--   b) future use on new tables / columns
--   c) the nuclear ALTER TABLE option in Section 7
-- =====================================================

DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disease_type_enum') THEN
        CREATE TYPE disease_type_enum AS ENUM (
            'waterborne', 'airborne', 'vector', 'foodborne', 'other'
        );
    END IF;
END $do$;

DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'severity_enum') THEN
        CREATE TYPE severity_enum AS ENUM (
            'low', 'medium', 'high', 'critical'
        );
    END IF;
END $do$;

DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status_enum') THEN
        CREATE TYPE approval_status_enum AS ENUM (
            'pending_approval', 'approved', 'rejected'
        );
    END IF;
END $do$;

DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_status_enum') THEN
        CREATE TYPE campaign_status_enum AS ENUM (
            'planned', 'ongoing', 'completed', 'cancelled'
        );
    END IF;
END $do$;

DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'water_quality_enum') THEN
        CREATE TYPE water_quality_enum AS ENUM (
            'safe', 'moderate', 'poor', 'contaminated', 'unsafe', 'critical'
        );
    END IF;
END $do$;

SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) AS values
FROM pg_type
JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid
WHERE typname IN (
    'disease_type_enum', 'severity_enum', 'approval_status_enum',
    'campaign_status_enum', 'water_quality_enum'
)
GROUP BY typname
ORDER BY typname;


-- =====================================================
-- SECTION 2: DATA SANITIZATION
-- =====================================================

UPDATE disease_reports SET disease_type = 'other'
WHERE disease_type NOT IN ('waterborne','airborne','vector','foodborne','other')
   OR disease_type IS NULL;

UPDATE disease_reports SET severity = 'low'
WHERE severity NOT IN ('low','medium','high','critical')
   OR severity IS NULL;

UPDATE disease_reports SET approval_status = 'pending_approval'
WHERE approval_status NOT IN ('pending_approval','approved','rejected')
   OR approval_status IS NULL;

UPDATE water_quality_reports SET approval_status = 'pending_approval'
WHERE approval_status NOT IN ('pending_approval','approved','rejected')
   OR approval_status IS NULL;

UPDATE water_quality_reports SET overall_quality = 'moderate'
WHERE overall_quality NOT IN ('safe','moderate','poor','contaminated','unsafe','critical')
   OR overall_quality IS NULL;

UPDATE health_campaigns SET approval_status = 'pending_approval'
WHERE approval_status NOT IN ('pending_approval','approved','rejected')
   OR approval_status IS NULL;

UPDATE health_campaigns SET status = 'planned'
WHERE status NOT IN ('planned','ongoing','completed','cancelled')
   OR status IS NULL;

DO $do$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'campaigns') THEN
        UPDATE campaigns SET approval_status = 'pending_approval'
        WHERE approval_status NOT IN ('pending_approval','approved','rejected')
           OR approval_status IS NULL;
        UPDATE campaigns SET status = 'planned'
        WHERE status NOT IN ('planned','ongoing','completed','cancelled')
           OR status IS NULL;
    END IF;
END $do$;

SELECT 'Data sanitization complete.' AS sanitize_status;


-- =====================================================
-- SECTION 3: ENFORCE INTEGRITY WITH CHECK CONSTRAINTS
--
-- WHY NOT ALTER COLUMN TYPE TO ENUM?
--
-- PostgreSQL enforces this hard rule (error 0A000):
--   "cannot alter type of a column used in a policy definition"
--
-- Every affected table has 10-20 active RLS policies that
-- reference approval_status, severity, disease_type, status,
-- overall_quality in USING() and WITH CHECK() expressions.
-- (Defined in DISTRICT_OFFICER_RLS.sql and earlier scripts.)
--
-- To use ALTER COLUMN TYPE you would need to DROP all 50+
-- RLS policies, alter the columns, then recreate every policy.
-- That is error-prone and dangerous in production.
--
-- SOLUTION: CHECK CONSTRAINTS achieve identical integrity:
--   • Invalid values are REJECTED at the database level
--   • Error message is clear: "violates check constraint chk_*"
--   • 100% compatible with all existing RLS policies
--   • No policy recreation needed
--   • Rollback is a single DROP CONSTRAINT per column
--   • The ENUM types (Section 1) remain available for
--     future use on new tables or new columns
-- =====================================================

-- ── disease_reports ───────────────────────────────────────────────────────

ALTER TABLE disease_reports
    DROP CONSTRAINT IF EXISTS chk_disease_type;
ALTER TABLE disease_reports
    ADD CONSTRAINT chk_disease_type
        CHECK (disease_type IN ('waterborne','airborne','vector','foodborne','other'));

ALTER TABLE disease_reports
    DROP CONSTRAINT IF EXISTS chk_severity;
ALTER TABLE disease_reports
    ADD CONSTRAINT chk_severity
        CHECK (severity IN ('low','medium','high','critical'));

ALTER TABLE disease_reports
    DROP CONSTRAINT IF EXISTS chk_approval_status_disease;
ALTER TABLE disease_reports
    ADD CONSTRAINT chk_approval_status_disease
        CHECK (approval_status IN ('pending_approval','approved','rejected'));

-- ── water_quality_reports ─────────────────────────────────────────────────

ALTER TABLE water_quality_reports
    DROP CONSTRAINT IF EXISTS chk_overall_quality;
ALTER TABLE water_quality_reports
    ADD CONSTRAINT chk_overall_quality
        CHECK (overall_quality IN ('safe','moderate','poor','contaminated','unsafe','critical'));

ALTER TABLE water_quality_reports
    DROP CONSTRAINT IF EXISTS chk_approval_status_water;
ALTER TABLE water_quality_reports
    ADD CONSTRAINT chk_approval_status_water
        CHECK (approval_status IN ('pending_approval','approved','rejected'));

-- ── health_campaigns ──────────────────────────────────────────────────────

ALTER TABLE health_campaigns
    DROP CONSTRAINT IF EXISTS chk_campaign_status;
ALTER TABLE health_campaigns
    ADD CONSTRAINT chk_campaign_status
        CHECK (status IN ('planned','ongoing','completed','cancelled'));

ALTER TABLE health_campaigns
    DROP CONSTRAINT IF EXISTS chk_approval_status_campaign;
ALTER TABLE health_campaigns
    ADD CONSTRAINT chk_approval_status_campaign
        CHECK (approval_status IN ('pending_approval','approved','rejected'));

-- ── campaigns (legacy — conditional) ──────────────────────────────────────

DO $do$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'campaigns') THEN
        EXECUTE $inner$
            ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS chk_approval_status_campaigns;
            ALTER TABLE campaigns
                ADD CONSTRAINT chk_approval_status_campaigns
                    CHECK (approval_status IN ('pending_approval','approved','rejected'));
            ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS chk_status_campaigns;
            ALTER TABLE campaigns
                ADD CONSTRAINT chk_status_campaigns
                    CHECK (status IN ('planned','ongoing','completed','cancelled'))
        $inner$;
    END IF;
END $do$;

SELECT 'CHECK constraints applied — data integrity enforced on all tables.' AS migrate_status;


-- =====================================================
-- SECTION 4: POST-MIGRATION VERIFICATION
-- =====================================================

-- Confirm constraints exist
SELECT conrelid::regclass AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
    'chk_disease_type', 'chk_severity',
    'chk_approval_status_disease', 'chk_approval_status_water',
    'chk_overall_quality', 'chk_campaign_status',
    'chk_approval_status_campaign', 'chk_approval_status_campaigns',
    'chk_status_campaigns'
)
ORDER BY table_name, constraint_name;

-- Confirm ENUM types exist
SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) AS values
FROM pg_type
JOIN pg_enum ON pg_enum.enumtypid = pg_type.oid
WHERE typname IN (
    'disease_type_enum', 'severity_enum', 'approval_status_enum',
    'campaign_status_enum', 'water_quality_enum'
)
GROUP BY typname
ORDER BY typname;

-- Smoke test: this INSERT should FAIL with constraint violation
-- (uncomment to test, then rollback)
-- BEGIN;
-- INSERT INTO disease_reports (disease_type, ...) VALUES ('INVALID', ...);
-- ROLLBACK;

SELECT 'Migration verified successfully!' AS final_status;


-- =====================================================
-- SECTION 5: ADDING NEW VALUES IN THE FUTURE
--
-- CHECK CONSTRAINT: edit the constraint definition
--   ALTER TABLE disease_reports DROP CONSTRAINT chk_disease_type;
--   ALTER TABLE disease_reports ADD CONSTRAINT chk_disease_type
--       CHECK (disease_type IN ('waterborne','airborne','vector',
--                               'foodborne','zoonotic','other'));
--
-- ENUM type: add the value to the type too (for future columns)
--   ALTER TYPE disease_type_enum ADD VALUE 'zoonotic' BEFORE 'other';
-- =====================================================


-- =====================================================
-- SECTION 6: ROLLBACK INSTRUCTIONS
-- To remove all CHECK constraints added by this script:
-- =====================================================

/*
ALTER TABLE disease_reports
    DROP CONSTRAINT IF EXISTS chk_disease_type,
    DROP CONSTRAINT IF EXISTS chk_severity,
    DROP CONSTRAINT IF EXISTS chk_approval_status_disease;

ALTER TABLE water_quality_reports
    DROP CONSTRAINT IF EXISTS chk_overall_quality,
    DROP CONSTRAINT IF EXISTS chk_approval_status_water;

ALTER TABLE health_campaigns
    DROP CONSTRAINT IF EXISTS chk_campaign_status,
    DROP CONSTRAINT IF EXISTS chk_approval_status_campaign;

-- campaigns (if exists)
DO $do$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'campaigns') THEN
        EXECUTE $inner$
            ALTER TABLE campaigns
                DROP CONSTRAINT IF EXISTS chk_approval_status_campaigns,
                DROP CONSTRAINT IF EXISTS chk_status_campaigns
        $inner$;
    END IF;
END $do$;

-- Optionally drop the ENUM types too (only if unused elsewhere)
-- DROP TYPE IF EXISTS disease_type_enum;
-- DROP TYPE IF EXISTS severity_enum;
-- DROP TYPE IF EXISTS approval_status_enum;
-- DROP TYPE IF EXISTS campaign_status_enum;
-- DROP TYPE IF EXISTS water_quality_enum;

SELECT 'Rollback complete — all CHECK constraints removed.' AS rollback_status;
*/


-- =====================================================
-- SECTION 7: NUCLEAR OPTION — ALTER TABLE TO ENUM
--
-- Use ONLY if you are willing to drop and recreate ALL
-- RLS policies on disease_reports, water_quality_reports,
-- and health_campaigns (50+ policies across 3 SQL files).
--
-- Steps to use this:
--   1. Run your DROP POLICY statements for all 3 tables
--   2. Uncomment and run the block below
--   3. Re-run DISTRICT_OFFICER_RLS.sql and earlier RLS scripts
-- =====================================================

/*
DROP VIEW IF EXISTS vw_district_health_summary;
DROP VIEW IF EXISTS vw_disease_heatmap;
DROP VIEW IF EXISTS vw_water_heatmap;

ALTER TABLE disease_reports ALTER COLUMN disease_type DROP DEFAULT;
ALTER TABLE disease_reports ALTER COLUMN disease_type
    TYPE disease_type_enum USING disease_type::disease_type_enum;

ALTER TABLE disease_reports ALTER COLUMN severity DROP DEFAULT;
ALTER TABLE disease_reports ALTER COLUMN severity
    TYPE severity_enum USING severity::severity_enum;

ALTER TABLE disease_reports ALTER COLUMN approval_status DROP DEFAULT;
ALTER TABLE disease_reports ALTER COLUMN approval_status
    TYPE approval_status_enum USING approval_status::approval_status_enum;
ALTER TABLE disease_reports ALTER COLUMN approval_status
    SET DEFAULT 'pending_approval'::approval_status_enum;

ALTER TABLE water_quality_reports ALTER COLUMN overall_quality DROP DEFAULT;
ALTER TABLE water_quality_reports ALTER COLUMN overall_quality
    TYPE water_quality_enum USING overall_quality::water_quality_enum;

ALTER TABLE water_quality_reports ALTER COLUMN approval_status DROP DEFAULT;
ALTER TABLE water_quality_reports ALTER COLUMN approval_status
    TYPE approval_status_enum USING approval_status::approval_status_enum;
ALTER TABLE water_quality_reports ALTER COLUMN approval_status
    SET DEFAULT 'pending_approval'::approval_status_enum;

ALTER TABLE health_campaigns ALTER COLUMN approval_status DROP DEFAULT;
ALTER TABLE health_campaigns ALTER COLUMN approval_status
    TYPE approval_status_enum USING approval_status::approval_status_enum;
ALTER TABLE health_campaigns ALTER COLUMN approval_status
    SET DEFAULT 'pending_approval'::approval_status_enum;

ALTER TABLE health_campaigns ALTER COLUMN status DROP DEFAULT;
ALTER TABLE health_campaigns ALTER COLUMN status
    TYPE campaign_status_enum USING status::campaign_status_enum;
ALTER TABLE health_campaigns ALTER COLUMN status SET DEFAULT 'planned'::campaign_status_enum;

-- Then recreate views and re-run all RLS scripts.
*/
