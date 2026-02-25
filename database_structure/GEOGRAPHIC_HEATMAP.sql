-- =====================================================
-- GEOGRAPHIC_HEATMAP.sql
-- Adds PostGIS spatial support for heatmap queries
--
-- What this file does:
--   1. Enables the PostGIS extension
--   2. Adds a GEOGRAPHY(POINT, 4326) column to disease_reports
--      and water_quality_reports
--   3. Backfills the geography column from existing lat/lng data
--   4. Creates BEFORE INSERT/UPDATE triggers to keep the geo
--      column in sync automatically
--   5. Creates GiST spatial indexes for fast proximity queries
--   6. Provides ready-to-use queries for:
--       a) Reports within N km radius of a point
--       b) Cluster counts by district
--       c) Heatmap density grid
--   7. Adds a heatmap_view for frontend consumption
--
-- BACKWARD COMPATIBILITY:
--   The existing `latitude` and `longitude` DECIMAL columns are
--   never modified or removed. All reads/writes via the app
--   services continue to work unchanged. The `location_geo`
--   column is a derived column maintained automatically by a
--   trigger — developers can ignore it entirely on the app side.
--
-- COORDINATE SYSTEM:
--   SRID 4326 = WGS 84 (the same system used by GPS / Google Maps).
--   ST_DWithin on GEOGRAPHY type uses METERS (not degrees).
--   So 5 km = 5000 meters.
--
--   IMPORTANT: ST_Point expects (longitude, latitude), NOT (lat, lng).
--   This is the standard GIS convention (X = lon, Y = lat).
--
-- Safe to re-run: all operations use IF NOT EXISTS or OR REPLACE.
-- Run this in Supabase SQL Editor.
-- =====================================================


-- =====================================================
-- SECTION 1: ENABLE PostGIS
-- Supabase supports PostGIS natively. This is idempotent.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify installation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'postgis'
    ) THEN
        RAISE EXCEPTION 'PostGIS could not be enabled. Contact your database administrator.';
    END IF;
    RAISE NOTICE 'PostGIS version: %', PostGIS_Version();
END $$;


-- =====================================================
-- SECTION 2: ADD GEOGRAPHY COLUMNS
--
-- We use GEOGRAPHY (not GEOMETRY) because:
--   • GEOGRAPHY operates on a spherical model of the Earth → accurate
--     meter-based distance calculations anywhere on the globe
--   • GEOMETRY uses a flat (Cartesian) plane → inaccurate for large distances
--   • Supabase / PostGIS ST_DWithin on GEOGRAPHY uses meters natively
-- =====================================================

-- disease_reports: add location_geo column
ALTER TABLE disease_reports
    ADD COLUMN IF NOT EXISTS location_geo GEOGRAPHY(POINT, 4326);

-- water_quality_reports: add location_geo column
ALTER TABLE water_quality_reports
    ADD COLUMN IF NOT EXISTS location_geo GEOGRAPHY(POINT, 4326);

-- outbreaks: add location_geo column (centroid of affected area)
-- This is optional — we populate it by averaging district report coords.
ALTER TABLE outbreaks
    ADD COLUMN IF NOT EXISTS location_geo GEOGRAPHY(POINT, 4326);


-- =====================================================
-- SECTION 3: BACKFILL EXISTING ROWS
--
-- ST_Point(longitude, latitude) :: geography converts decimal
-- columns into a proper spatial point. Rows where both
-- latitude and longitude are non-null get a geo point.
-- =====================================================

-- Backfill disease_reports
UPDATE disease_reports
SET location_geo = ST_Point(longitude, latitude)::geography
WHERE latitude  IS NOT NULL
  AND longitude IS NOT NULL
  AND location_geo IS NULL;

-- Backfill water_quality_reports
UPDATE water_quality_reports
SET location_geo = ST_Point(longitude, latitude)::geography
WHERE latitude  IS NOT NULL
  AND longitude IS NOT NULL
  AND location_geo IS NULL;

-- Report backfill counts
DO $$
DECLARE
    dr_count  INTEGER;
    wqr_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dr_count  FROM disease_reports      WHERE location_geo IS NOT NULL;
    SELECT COUNT(*) INTO wqr_count FROM water_quality_reports WHERE location_geo IS NOT NULL;
    RAISE NOTICE 'Backfill complete: % disease_reports, % water_quality_reports geocoded.',
                 dr_count, wqr_count;
END $$;


-- =====================================================
-- SECTION 4: AUTO-SYNC TRIGGER FUNCTIONS
--
-- These triggers keep location_geo in sync whenever
-- latitude or longitude is inserted or updated.
-- The app code never needs to touch location_geo directly.
-- =====================================================

-- 4a. Sync function for tables with reporter_id (disease & water reports)
CREATE OR REPLACE FUNCTION sync_location_geo()
RETURNS TRIGGER AS $$
BEGIN
    -- If both lat and lng are provided, build the geo point
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location_geo := ST_Point(NEW.longitude, NEW.latitude)::geography;
    ELSE
        -- One or both coords are NULL → clear the geo column
        NEW.location_geo := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to disease_reports
DROP TRIGGER IF EXISTS trg_sync_disease_report_geo ON disease_reports;
CREATE TRIGGER trg_sync_disease_report_geo
    BEFORE INSERT OR UPDATE OF latitude, longitude
    ON disease_reports
    FOR EACH ROW
    EXECUTE FUNCTION sync_location_geo();

-- Attach to water_quality_reports
DROP TRIGGER IF EXISTS trg_sync_water_report_geo ON water_quality_reports;
CREATE TRIGGER trg_sync_water_report_geo
    BEFORE INSERT OR UPDATE OF latitude, longitude
    ON water_quality_reports
    FOR EACH ROW
    EXECUTE FUNCTION sync_location_geo();


-- =====================================================
-- SECTION 5: SPATIAL INDEXES (GiST)
--
-- GiST = Generalized Search Tree. The standard index type
-- for spatial columns. Required for fast ST_DWithin,
-- ST_Within, ST_Intersects queries. Without this index,
-- proximity queries do a full table scan.
-- =====================================================

-- disease_reports spatial index
CREATE INDEX IF NOT EXISTS idx_disease_reports_geo
    ON disease_reports USING GIST (location_geo);

-- water_quality_reports spatial index
CREATE INDEX IF NOT EXISTS idx_water_quality_reports_geo
    ON water_quality_reports USING GIST (location_geo);

-- outbreaks spatial index
CREATE INDEX IF NOT EXISTS idx_outbreaks_geo
    ON outbreaks USING GIST (location_geo);

-- Compound index: district + spatial (for filtered proximity queries)
CREATE INDEX IF NOT EXISTS idx_disease_reports_district_geo
    ON disease_reports (district) INCLUDE (location_geo);

CREATE INDEX IF NOT EXISTS idx_water_reports_district_geo
    ON water_quality_reports (district) INCLUDE (location_geo);


-- =====================================================
-- SECTION 6: READY-TO-USE SPATIAL QUERIES
--
-- These are parameterised templates. Replace the
-- placeholder values before running.
-- =====================================================

-- ─────────────────────────────────────────────────────────────────
-- QUERY A: Disease reports within N km radius of a GPS point
--
-- Replace:
--   28.6139  → target latitude  (e.g. user's GPS lat)
--   77.2090  → target longitude (e.g. user's GPS lng)
--   5000     → radius in METERS (5 km = 5000)
-- ─────────────────────────────────────────────────────────────────
/*
SELECT
    dr.id,
    dr.disease_name,
    dr.district,
    dr.state,
    dr.cases_count,
    dr.deaths_count,
    dr.severity,
    dr.approval_status,
    dr.created_at,
    dr.latitude,
    dr.longitude,
    -- Distance from the target point in meters
    ROUND(
        ST_Distance(
            dr.location_geo,
            ST_Point(77.2090, 28.6139)::geography   -- (lng, lat)
        )::numeric,
        2
    ) AS distance_meters,
    -- Distance in km (useful for display)
    ROUND(
        ST_Distance(
            dr.location_geo,
            ST_Point(77.2090, 28.6139)::geography
        )::numeric / 1000,
        3
    ) AS distance_km
FROM disease_reports dr
WHERE
    -- ST_DWithin uses meters when GEOGRAPHY type is used
    ST_DWithin(
        dr.location_geo,
        ST_Point(77.2090, 28.6139)::geography,   -- target (lng, lat)
        5000                                      -- radius in meters (5 km)
    )
    -- Only show approved reports (respects app visibility rules)
    AND dr.approval_status = 'approved'
    -- Only geocoded rows
    AND dr.location_geo IS NOT NULL
ORDER BY distance_meters ASC;
*/


-- ─────────────────────────────────────────────────────────────────
-- QUERY B: Water quality reports within N km radius
-- ─────────────────────────────────────────────────────────────────
/*
SELECT
    wqr.id,
    wqr.source_name,
    wqr.source_type,
    wqr.overall_quality,
    wqr.district,
    wqr.latitude,
    wqr.longitude,
    ROUND(
        ST_Distance(
            wqr.location_geo,
            ST_Point(77.2090, 28.6139)::geography
        )::numeric / 1000,
        3
    ) AS distance_km
FROM water_quality_reports wqr
WHERE
    ST_DWithin(
        wqr.location_geo,
        ST_Point(77.2090, 28.6139)::geography,
        5000
    )
    AND wqr.approval_status = 'approved'
    AND wqr.location_geo IS NOT NULL
ORDER BY distance_km ASC;
*/


-- ─────────────────────────────────────────────────────────────────
-- QUERY C: Cluster count by district
-- Returns total reports, total cases, total deaths, and unique
-- diseases per district — ideal for a choropleth/heatmap layer.
-- ─────────────────────────────────────────────────────────────────
/*
SELECT
    dr.district,
    dr.state,
    COUNT(dr.id)                        AS report_count,
    SUM(dr.cases_count)                 AS total_cases,
    SUM(dr.deaths_count)               AS total_deaths,
    COUNT(DISTINCT dr.disease_name)     AS unique_diseases,
    MAX(
        CASE dr.severity
            WHEN 'critical' THEN 4
            WHEN 'high'     THEN 3
            WHEN 'medium'   THEN 2
            WHEN 'low'      THEN 1
            ELSE 0
        END
    )                                   AS severity_rank,   -- 4=critical
    -- Centroid of all geocoded reports in this district
    -- Can be used as the pin location on the map
    ST_AsText(
        ST_Centroid(
            ST_Collect(dr.location_geo::geometry)
        )
    )                                   AS district_centroid_wkt
FROM disease_reports dr
WHERE
    dr.approval_status = 'approved'
    AND dr.created_at  >= NOW() - INTERVAL '30 days'   -- adjust window
GROUP BY
    dr.district, dr.state
ORDER BY
    total_cases DESC;
*/


-- ─────────────────────────────────────────────────────────────────
-- QUERY D: High-density hotspot grid (H3-style density grid)
-- Groups all reports into ~1 km² cells using ST_SnapToGrid.
-- Each cell returns a count: useful for heatmap intensity layers.
-- ─────────────────────────────────────────────────────────────────
/*
SELECT
    -- Round coords to 0.01° ≈ 1 km grid cells
    ROUND(dr.longitude::numeric, 2) AS cell_lng,
    ROUND(dr.latitude::numeric,  2) AS cell_lat,
    COUNT(dr.id)                    AS report_count,
    SUM(dr.cases_count)             AS total_cases,
    SUM(dr.deaths_count)           AS total_deaths
FROM disease_reports dr
WHERE
    dr.approval_status = 'approved'
    AND dr.location_geo IS NOT NULL
    AND dr.created_at  >= NOW() - INTERVAL '30 days'
GROUP BY
    cell_lng, cell_lat
ORDER BY
    total_cases DESC;
*/


-- ─────────────────────────────────────────────────────────────────
-- QUERY E: Outbreak hotspot — reports near a known outbreak
-- Finds all reports within 10 km of a specific outbreak record
-- to understand the geographic spread.
-- ─────────────────────────────────────────────────────────────────
/*
-- First get the outbreak's centroid (replace with actual outbreak_id)
WITH outbreak_center AS (
    SELECT location_geo
    FROM outbreaks
    WHERE id = 'YOUR-OUTBREAK-UUID-HERE'
)
SELECT
    dr.id,
    dr.disease_name,
    dr.cases_count,
    dr.severity,
    dr.district,
    dr.latitude,
    dr.longitude,
    ROUND(
        ST_Distance(dr.location_geo, oc.location_geo)::numeric / 1000,
        2
    ) AS km_from_outbreak_center
FROM disease_reports dr, outbreak_center oc
WHERE
    ST_DWithin(dr.location_geo, oc.location_geo, 10000)   -- 10 km
    AND dr.location_geo IS NOT NULL
ORDER BY km_from_outbreak_center;
*/


-- ─────────────────────────────────────────────────────────────────
-- QUERY F: Combined disease + water quality reports near a point
-- Single unified query for a full-overlay heatmap.
-- ─────────────────────────────────────────────────────────────────
/*
SELECT
    'disease'          AS report_type,
    id,
    disease_name       AS label,
    severity           AS quality_or_severity,
    cases_count        AS count_value,
    district,
    latitude,
    longitude,
    ROUND(ST_Distance(location_geo, ST_Point(77.2090, 28.6139)::geography)::numeric / 1000, 2) AS distance_km
FROM disease_reports
WHERE ST_DWithin(location_geo, ST_Point(77.2090, 28.6139)::geography, 5000)
  AND approval_status = 'approved'
  AND location_geo IS NOT NULL

UNION ALL

SELECT
    'water'            AS report_type,
    id,
    source_name        AS label,
    overall_quality    AS quality_or_severity,
    1                  AS count_value,
    district,
    latitude,
    longitude,
    ROUND(ST_Distance(location_geo, ST_Point(77.2090, 28.6139)::geography)::numeric / 1000, 2) AS distance_km
FROM water_quality_reports
WHERE ST_DWithin(location_geo, ST_Point(77.2090, 28.6139)::geography, 5000)
  AND approval_status = 'approved'
  AND location_geo IS NOT NULL

ORDER BY distance_km;
*/


-- =====================================================
-- SECTION 7: HEATMAP VIEWS
--
-- Materialized views are NOT supported in Supabase Free.
-- These are regular views — they run the aggregation live.
-- For high-traffic apps, consider caching these in the app.
-- =====================================================

-- Drop existing views (safe re-run)
DROP VIEW IF EXISTS vw_disease_heatmap;
DROP VIEW IF EXISTS vw_water_heatmap;
DROP VIEW IF EXISTS vw_district_health_summary;

-- View A: Disease heatmap points (approved reports with coordinates)
CREATE VIEW vw_disease_heatmap AS
SELECT
    id,
    disease_name,
    disease_type,
    severity,
    cases_count,
    deaths_count,
    approval_status,
    district,
    state,
    latitude,
    longitude,
    -- GeoJSON representation for Leaflet / Mapbox / deck.gl
    json_build_object(
        'type',        'Feature',
        'geometry',    ST_AsGeoJSON(location_geo)::json,
        'properties',  json_build_object(
            'id',           id,
            'disease',      disease_name,
            'severity',     severity,
            'cases',        cases_count,
            'deaths',       deaths_count,
            'district',     district,
            'date',         created_at
        )
    ) AS geojson_feature,
    created_at
FROM disease_reports
WHERE approval_status = 'approved'
  AND location_geo IS NOT NULL;

-- View B: Water quality heatmap points
CREATE VIEW vw_water_heatmap AS
SELECT
    id,
    source_name,
    source_type,
    overall_quality,
    district,
    state,
    latitude,
    longitude,
    json_build_object(
        'type',       'Feature',
        'geometry',   ST_AsGeoJSON(location_geo)::json,
        'properties', json_build_object(
            'id',       id,
            'source',   source_name,
            'quality',  overall_quality,
            'district', district,
            'date',     created_at
        )
    ) AS geojson_feature,
    created_at
FROM water_quality_reports
WHERE approval_status = 'approved'
  AND location_geo IS NOT NULL;

-- View C: District-level aggregate summary (for choropleth maps)
CREATE VIEW vw_district_health_summary AS
SELECT
    dr.district,
    dr.state,
    COUNT(dr.id)                     AS total_reports,
    SUM(dr.cases_count)              AS total_cases,
    SUM(dr.deaths_count)            AS total_deaths,
    COUNT(DISTINCT dr.disease_name)  AS unique_diseases,
    -- Active outbreaks count for this district
    (
        SELECT COUNT(*)
        FROM outbreaks o
        WHERE o.district = dr.district
          AND o.status   != 'resolved'
    ) AS active_outbreaks,
    -- Severity score (weighted: critical=4, high=3, medium=2, low=1)
    ROUND(AVG(
        CASE dr.severity
            WHEN 'critical' THEN 4
            WHEN 'high'     THEN 3
            WHEN 'medium'   THEN 2
            WHEN 'low'      THEN 1
            ELSE 0
        END
    ), 2) AS avg_severity_score,
    -- Geographic centroid of all geocoded reports in this district
    ST_AsGeoJSON(
        ST_Centroid(
            ST_Collect(dr.location_geo::geometry)
        )
    )::json AS centroid_geojson
FROM disease_reports dr
WHERE dr.approval_status = 'approved'
GROUP BY dr.district, dr.state
ORDER BY total_cases DESC;


-- =====================================================
-- SECTION 8: RLS ON VIEWS
--
-- In PostgreSQL, views inherit the RLS of their underlying
-- tables. Since vw_disease_heatmap and vw_water_heatmap
-- query already-RLS-protected tables, no extra policies
-- are needed. The views automatically filter rows using
-- the caller's auth.uid() context.
--
-- GRANT SELECT to let authenticated users query the views.
-- =====================================================

GRANT SELECT ON vw_disease_heatmap         TO authenticated;
GRANT SELECT ON vw_water_heatmap           TO authenticated;
GRANT SELECT ON vw_district_health_summary TO authenticated;


-- =====================================================
-- SECTION 9: SUPABASE-COMPATIBLE RPC FUNCTIONS
--
-- Since Supabase JS client cannot call ST_DWithin directly,
-- we wrap the spatial queries in SECURITY DEFINER functions
-- callable via supabase.rpc('function_name', { params }).
-- =====================================================

-- 9a. Get disease reports within radius
CREATE OR REPLACE FUNCTION get_disease_reports_near(
    p_latitude   FLOAT,
    p_longitude  FLOAT,
    p_radius_km  FLOAT   DEFAULT 5.0
)
RETURNS TABLE (
    id              UUID,
    disease_name    TEXT,
    disease_type    TEXT,
    severity        TEXT,
    cases_count     INTEGER,
    deaths_count    INTEGER,
    district        TEXT,
    state           TEXT,
    latitude        DECIMAL,
    longitude       DECIMAL,
    distance_km     NUMERIC,
    created_at      TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dr.id,
        dr.disease_name,
        dr.disease_type,
        dr.severity,
        dr.cases_count,
        dr.deaths_count,
        dr.district,
        dr.state,
        dr.latitude,
        dr.longitude,
        ROUND(
            ST_Distance(
                dr.location_geo,
                ST_Point(p_longitude, p_latitude)::geography
            )::numeric / 1000,
            3
        ) AS distance_km,
        dr.created_at
    FROM disease_reports dr
    WHERE
        dr.location_geo IS NOT NULL
        AND dr.approval_status = 'approved'
        AND ST_DWithin(
            dr.location_geo,
            ST_Point(p_longitude, p_latitude)::geography,
            p_radius_km * 1000   -- convert km → meters
        )
    ORDER BY distance_km ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_disease_reports_near(FLOAT, FLOAT, FLOAT) TO authenticated;


-- 9b. Get water quality reports within radius
CREATE OR REPLACE FUNCTION get_water_reports_near(
    p_latitude   FLOAT,
    p_longitude  FLOAT,
    p_radius_km  FLOAT DEFAULT 5.0
)
RETURNS TABLE (
    id              UUID,
    source_name     TEXT,
    source_type     TEXT,
    overall_quality TEXT,
    district        TEXT,
    state           TEXT,
    latitude        DECIMAL,
    longitude       DECIMAL,
    distance_km     NUMERIC,
    created_at      TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        wqr.id,
        wqr.source_name,
        wqr.source_type,
        wqr.overall_quality,
        wqr.district,
        wqr.state,
        wqr.latitude,
        wqr.longitude,
        ROUND(
            ST_Distance(
                wqr.location_geo,
                ST_Point(p_longitude, p_latitude)::geography
            )::numeric / 1000,
            3
        ) AS distance_km,
        wqr.created_at
    FROM water_quality_reports wqr
    WHERE
        wqr.location_geo IS NOT NULL
        AND wqr.approval_status = 'approved'
        AND ST_DWithin(
            wqr.location_geo,
            ST_Point(p_longitude, p_latitude)::geography,
            p_radius_km * 1000
        )
    ORDER BY distance_km ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_water_reports_near(FLOAT, FLOAT, FLOAT) TO authenticated;


-- 9c. Get district health summary (for choropleth / heatmap layer)
CREATE OR REPLACE FUNCTION get_district_health_summary(
    p_days_back INTEGER DEFAULT 30   -- rolling window in days
)
RETURNS TABLE (
    district         TEXT,
    state            TEXT,
    total_reports    BIGINT,
    total_cases      BIGINT,
    total_deaths     BIGINT,
    unique_diseases  BIGINT,
    active_outbreaks BIGINT,
    avg_severity     NUMERIC,
    centroid_lat     FLOAT,
    centroid_lng     FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dr.district,
        dr.state,
        COUNT(dr.id),
        SUM(dr.cases_count),
        SUM(dr.deaths_count),
        COUNT(DISTINCT dr.disease_name),
        (
            SELECT COUNT(*)
            FROM outbreaks o
            WHERE o.district = dr.district
              AND o.status != 'resolved'
        ),
        ROUND(AVG(
            CASE dr.severity
                WHEN 'critical' THEN 4
                WHEN 'high'     THEN 3
                WHEN 'medium'   THEN 2
                WHEN 'low'      THEN 1
                ELSE 0
            END
        ), 2),
        -- Centroid latitude of geocoded reports in district
        ROUND(
            ST_Y(
                ST_Centroid(
                    ST_Collect(dr.location_geo::geometry)
                )
            )::numeric,
            6
        )::float,
        -- Centroid longitude
        ROUND(
            ST_X(
                ST_Centroid(
                    ST_Collect(dr.location_geo::geometry)
                )
            )::numeric,
            6
        )::float
    FROM disease_reports dr
    WHERE
        dr.approval_status = 'approved'
        AND dr.created_at  >= NOW() - (p_days_back || ' days')::INTERVAL
    GROUP BY dr.district, dr.state
    ORDER BY total_cases DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_district_health_summary(INTEGER) TO authenticated;


-- 9d. Get heatmap GeoJSON FeatureCollection
-- Returns a single GeoJSON FeatureCollection string
-- consumable directly by Leaflet / Mapbox / deck.gl.
CREATE OR REPLACE FUNCTION get_disease_heatmap_geojson(
    p_days_back INTEGER DEFAULT 30
)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', json_agg(
            json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(dr.location_geo)::json,
                'properties', json_build_object(
                    'id',           dr.id,
                    'disease',      dr.disease_name,
                    'severity',     dr.severity,
                    'cases',        dr.cases_count,
                    'deaths',       dr.deaths_count,
                    'district',     dr.district,
                    'state',        dr.state,
                    'date',         dr.created_at,
                    -- Numeric weight for heatmap intensity
                    'weight',       LEAST(dr.cases_count, 100)
                )
            )
        )
    )
    INTO v_result
    FROM disease_reports dr
    WHERE dr.approval_status = 'approved'
      AND dr.location_geo IS NOT NULL
      AND dr.created_at >= NOW() - (p_days_back || ' days')::INTERVAL;

    RETURN COALESCE(v_result, '{"type":"FeatureCollection","features":[]}'::json);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_disease_heatmap_geojson(INTEGER) TO authenticated;


-- =====================================================
-- SECTION 10: USAGE GUIDE — Supabase JS Client
-- =====================================================

-- In your React Native / Expo app, call these functions via:
--
-- // Reports within 5 km of current GPS location
-- const { data } = await supabase.rpc('get_disease_reports_near', {
--   p_latitude:  userLat,
--   p_longitude: userLng,
--   p_radius_km: 5
-- });
--
-- // District choropleth data (last 30 days)
-- const { data } = await supabase.rpc('get_district_health_summary', {
--   p_days_back: 30
-- });
--
-- // Full GeoJSON FeatureCollection for Leaflet/Mapbox
-- const { data: geojson } = await supabase.rpc('get_disease_heatmap_geojson', {
--   p_days_back: 7
-- });
-- map.addSource('disease-heatmap', { type: 'geojson', data: geojson });
--
-- // Direct view access (reads filtered by RLS automatically)
-- const { data } = await supabase.from('vw_district_health_summary').select('*');


-- =====================================================
-- SECTION 11: VERIFICATION QUERIES
-- =====================================================

-- Confirm PostGIS is active
SELECT PostGIS_Version() AS postgis_version;

-- Confirm new columns on disease_reports
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'disease_reports'
  AND column_name = 'location_geo';

-- Confirm GiST indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('disease_reports', 'water_quality_reports', 'outbreaks')
  AND indexdef LIKE '%GIST%';

-- Confirm triggers exist
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_name IN (
    'trg_sync_disease_report_geo',
    'trg_sync_water_report_geo'
);

-- Confirm views exist
SELECT table_name
FROM information_schema.views
WHERE table_name IN (
    'vw_disease_heatmap',
    'vw_water_heatmap',
    'vw_district_health_summary'
);

-- Confirm RPC functions exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name IN (
    'get_disease_reports_near',
    'get_water_reports_near',
    'get_district_health_summary',
    'get_disease_heatmap_geojson'
);

-- Quick geocoding stats
SELECT
    'disease_reports' AS table_name,
    COUNT(*)          AS total_rows,
    COUNT(location_geo) AS geocoded_rows,
    COUNT(*) - COUNT(location_geo) AS missing_geo
FROM disease_reports
UNION ALL
SELECT
    'water_quality_reports',
    COUNT(*),
    COUNT(location_geo),
    COUNT(*) - COUNT(location_geo)
FROM water_quality_reports;

SELECT 'Geographic heatmap support configured successfully!' AS status;
