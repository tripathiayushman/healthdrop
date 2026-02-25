-- =====================================================
-- OFFLINE_SYNC_SCHEMA.sql
-- DB-side support for offline-first client_idempotency_key
--
-- Adds a client_idempotency_key column to disease_reports
-- and water_quality_reports with a UNIQUE constraint.
-- The React Native app sets this to a UUID it generates locally.
-- On sync, upsert ON CONFLICT DO NOTHING silently ignores retries.
-- =====================================================

-- ── disease_reports ───────────────────────────────────────────────────────────

ALTER TABLE disease_reports
    ADD COLUMN IF NOT EXISTS client_idempotency_key TEXT;

-- Partial unique index: only enforce uniqueness on non-NULL keys
-- Rows submitted via the old web dashboard (no key) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_disease_reports_idempotency
    ON disease_reports (client_idempotency_key)
    WHERE client_idempotency_key IS NOT NULL;

-- ── water_quality_reports ─────────────────────────────────────────────────────

ALTER TABLE water_quality_reports
    ADD COLUMN IF NOT EXISTS client_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_water_reports_idempotency
    ON water_quality_reports (client_idempotency_key)
    WHERE client_idempotency_key IS NOT NULL;
    
-- ── Verify ────────────────────────────────────────────────────────────────────

SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name = 'client_idempotency_key'
ORDER BY table_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE indexname IN (
    'idx_disease_reports_idempotency',
    'idx_water_reports_idempotency'
);

SELECT 'Offline sync schema ready!' AS status;
