// =====================================================
// HEALTH MAP COMPONENT  v3 — "Prakash" design system
// - Uses actual lat/lon from DB (NOT district name lookup)
// - GPS session cache (persists until page reload / logout)
// - MapAndAlertsSection is WIDTH-DRIVEN, not platform-driven:
//   below STACK_BREAKPOINT the map card and the alerts column
//   stack into one column (a phone can never clip the right
//   column off-screen); side-by-side returns on tablet/desktop
// - Leaflet 1.9.4 VENDORED inline (leafletAssets.ts) — the map
//   shell no longer depends on the unpkg CDN at runtime
// - Leaflet perf: preferCanvas, optimised tile settings
// - Token-driven marker colors + per-layer legend labels
// - Severity markers carry a text count badge
// - Honest offline states: netinfo-offline panel, and a tile
//   watchdog that falls back to the district list when tiles
//   repeatedly fail ("Map tiles need internet — data below is
//   from your last sync")
// - Honest EMPTY states (BRK-05): an empty alert list only earns
//   the green "all clear" when the server really has no active
//   alert. A district filter that emptied a non-empty result, a
//   profile with no district, a list that failed to load rows the
//   server does have for this profile, and a check that never
//   completed each say so in their own words. The check re-runs
//   the caller's own scope predicate (not a bare head-count), is
//   skipped while known-offline, and is abort-timeout capped so
//   the skeleton always resolves.
// =====================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Platform, ActivityIndicator, ScrollView, Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { AlertCard, EmptyState, SkeletonBlock, getSeverityColor } from '../dashboards/DashboardShared';
import { ALERT_RADIUS_KM, filterAlertsForProfile, isRadiusScopedRole } from '../../lib/services/alertRadius';
import { computeCompleteness } from '../../lib/services/profileCompleteness';
import { LEAFLET_CSS, LEAFLET_JS } from './leafletAssets';

// Import WebView for native map rendering
let WebViewComponent: any = null;
if (Platform.OS !== 'web') {
  try {
    WebViewComponent = require('react-native-webview').WebView;
  } catch (e) {
    // WebView not available, will use fallback
  }
}

// ── Session location cache (persists until reload = logout) ─
let _cachedLat: number | null = null;
let _cachedLon: number | null = null;
let _cachedAt: number | null = null;
let _locationAsked = false;   // have we shown the prompt yet?
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 30;

function getCachedLocation(): { lat: number; lon: number } | null {
  return _cachedLat !== null && _cachedLon !== null
    ? { lat: _cachedLat, lon: _cachedLon }
    : null;
}

function setCachedLocation(lat: number, lon: number): void {
  _cachedLat = lat;
  _cachedLon = lon;
  _cachedAt = Date.now();
}

// ── Responsive breakpoint ─────────────────────────────
// Below this window width the map + alerts stack into ONE column.
// Phones (360–430dp) and split-screen web viewports all land here;
// tablets and desktop keep the two-column reading layout.
const STACK_BREAKPOINT = 600;

// ── Layer type ────────────────────────────────────────
type Layer = 'alerts' | 'disease' | 'water' | 'campaigns';

interface HealthMapRow {
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface AlertRow extends HealthMapRow {
  id: string;
  title: string;
  description: string;
  location_name: string;
  district: string;
  state?: string;
  created_at: string;
  urgency_level: string;
  alert_type?: string;
  disease_or_issue?: string;
  cases_reported?: number;
  affected_population?: number;
  immediate_actions?: string;
  precautionary_measures?: string;
}

interface DiseaseRow extends HealthMapRow {
  id?: string | null;
  disease_name?: string | null;
  severity?: string | null;
  district?: string | null;
  state?: string | null;
  created_at?: string | null;
}

interface WaterRow extends HealthMapRow {
  id?: string | null;
  source_name?: string | null;
  overall_quality?: string | null;
  district?: string | null;
  state?: string | null;
  created_at?: string | null;
}

interface CampaignRow extends HealthMapRow {
  campaign_type?: string | null;
  status?: string | null;
}

interface AlertLayerRow extends HealthMapRow {
  id?: string | null;
  title?: string | null;
  urgency_level?: string | null;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
  created_at?: string | null;
  alert_type?: string | null;
  disease_or_issue?: string | null;
}

// ── Fallback district centroids (only used when no GPS data available) ─
const DISTRICT_CENTROIDS: Record<string, [number, number]> = {
  'visakhapatnam': [17.686,83.218],'vijayawada':[16.506,80.648],'guntur':[16.300,80.436],
  'nellore':[14.442,79.987],'kurnool':[15.828,78.037],'tirupati':[13.628,79.419],
  'hyderabad':[17.385,78.487],'warangal':[17.977,79.600],'nizamabad':[18.672,78.094],
  'karimnagar':[18.438,79.128],'khammam':[17.247,80.150],'nalgonda':[17.056,79.268],
  'mumbai':[19.076,72.877],'pune':[18.520,73.856],'nagpur':[21.145,79.088],
  'nashik':[19.997,73.791],'aurangabad':[19.876,75.343],'thane':[19.218,72.978],
  'bengaluru':[12.972,77.594],'mysuru':[12.295,76.644],'hubli':[15.365,75.124],
  'mangaluru':[12.914,74.856],'belagavi':[15.850,74.497],'kalaburagi':[17.328,76.819],
  'chengalpattu':[12.6819,79.9836],'chengalpet':[12.6819,79.9836],'kanchipuram':[12.8342,79.7036],
  'chennai':[13.083,80.270],'coimbatore':[11.017,76.954],'madurai':[9.924,78.119],
  'tiruchirappalli':[10.790,78.706],'salem':[11.667,78.146],'tirunelveli':[8.730,77.695],
  'vellore':[12.916,79.131],'erode':[11.341,77.728],'thanjavur':[10.787,79.139],
  'thiruvananthapuram':[8.524,76.936],'kochi':[9.931,76.267],'kozhikode':[11.258,75.776],
  'thrissur':[10.527,76.213],'kollam':[8.887,76.591],'palakkad':[10.777,76.652],
  'ahmedabad':[23.033,72.585],'surat':[21.170,72.831],'vadodara':[22.307,73.180],
  'rajkot':[22.303,70.802],'bhavnagar':[21.762,72.152],'jamnagar':[22.468,70.058],
  'gandhinagar':[23.223,72.650],'junagadh':[21.517,70.457],
  'jaipur':[26.912,75.787],'jodhpur':[26.292,73.023],'kota':[25.182,75.839],
  'bikaner':[28.022,73.312],'ajmer':[26.450,74.635],'udaipur':[24.585,73.712],
  'lucknow':[26.847,80.947],'kanpur':[26.449,80.331],'agra':[27.177,78.008],
  'varanasi':[25.317,82.971],'allahabad':[25.435,81.846],'meerut':[28.984,77.707],
  'ghaziabad':[28.667,77.454],'noida':[28.535,77.391],'bareilly':[28.347,79.419],
  'gorakhpur':[26.760,83.373],'mathura':[27.492,77.673],
  'bhopal':[23.259,77.412],'indore':[22.719,75.857],'jabalpur':[23.166,79.934],
  'gwalior':[26.218,78.182],'ujjain':[23.183,75.772],
  'patna':[25.594,85.137],'gaya':[24.796,85.007],'bhagalpur':[25.240,86.980],
  'muzaffarpur':[26.120,85.390],'darbhanga':[26.152,85.897],
  'kolkata':[22.573,88.363],'howrah':[22.588,88.304],'durgapur':[23.480,87.320],
  'asansol':[23.683,86.983],'siliguri':[26.716,88.426],
  'delhi':[28.704,77.102],'new delhi':[28.613,77.209],'north delhi':[28.732,77.168],
  'south delhi':[28.527,77.213],'east delhi':[28.659,77.291],'west delhi':[28.677,77.055],
  'ludhiana':[30.901,75.857],'amritsar':[31.634,74.872],'jalandhar':[31.326,75.576],
  'gurugram':[28.459,77.026],'faridabad':[28.408,77.318],'ambala':[30.378,76.778],
  'shimla':[31.104,77.173],'dharamsala':[32.220,76.324],
  'dehradun':[30.316,78.032],'haridwar':[29.945,78.163],
  'ranchi':[23.344,85.310],'jamshedpur':[22.805,86.203],
  'bhubaneswar':[20.296,85.822],'cuttack':[20.463,85.882],
  'guwahati':[26.144,91.736],'silchar':[24.826,92.798],
  'raipur':[21.251,81.630],'bilaspur':[22.088,82.144],
  'panaji':[15.499,73.826],'margao':[15.274,73.958],
  'srinagar':[34.083,74.797],'jammu':[32.726,74.857],
  '__default__':[20.593,78.963],
};

const STATE_CENTROIDS: Record<string, [number, number]> = {
  'andhra pradesh': [15.9129, 79.7400],
  'tamil nadu': [11.1271, 78.6569],
  'karnataka': [15.3173, 75.7139],
  'telangana': [18.1124, 79.0193],
  'kerala': [10.8505, 76.2711],
  'maharashtra': [19.7515, 75.7139],
  'gujarat': [22.2587, 71.1924],
  'rajasthan': [27.0238, 74.2179],
  'uttar pradesh': [26.8467, 80.9462],
  'madhya pradesh': [22.9734, 78.6569],
  'bihar': [25.0961, 85.3131],
  'west bengal': [22.9868, 87.8550],
  'delhi': [28.7041, 77.1025],
  '__default__': [20.593, 78.963],
};

const DISTRICT_ALIASES: Record<string, string> = {
  chengalpattu: 'chengalpattu',
  chengalpet: 'chengalpattu',
  'chengalpattu district': 'chengalpattu',
  chelungpattu: 'chengalpattu',
  chelpungpattu: 'chengalpattu',
  chenglapattu: 'chengalpattu',
  kancheepuram: 'kanchipuram',
  kanchipuram: 'kanchipuram',
  madras: 'chennai',
};

const STATE_ALIASES: Record<string, string> = {
  tn: 'tamil nadu',
  ap: 'andhra pradesh',
  ts: 'telangana',
  mp: 'madhya pradesh',
  up: 'uttar pradesh',
  wb: 'west bengal',
  nct: 'delhi',
};

function normalizePlaceKey(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveDistrictKey(district?: string | null, locationName?: string | null): string | null {
  const directKey = normalizePlaceKey(district);
  if (directKey) {
    const aliased = DISTRICT_ALIASES[directKey] ?? directKey;
    if (DISTRICT_CENTROIDS[aliased]) return aliased;
  }

  const locationKey = normalizePlaceKey(locationName);
  if (!locationKey) return null;

  const aliasEntries = Object.entries(DISTRICT_ALIASES);
  for (const [alias, canonical] of aliasEntries) {
    if (locationKey.includes(alias)) return canonical;
  }

  for (const key of Object.keys(DISTRICT_CENTROIDS)) {
    if (key === '__default__') continue;
    if (locationKey.includes(key)) return key;
  }

  return null;
}

function fallbackCoords(district?: string | null, state?: string | null, locationName?: string | null): [number, number] {
  const districtKey = resolveDistrictKey(district, locationName);
  if (districtKey && DISTRICT_CENTROIDS[districtKey]) {
    return DISTRICT_CENTROIDS[districtKey];
  }

  const stateKeyRaw = normalizePlaceKey(state);
  const stateKey = STATE_ALIASES[stateKeyRaw] ?? stateKeyRaw;
  if (stateKey && STATE_CENTROIDS[stateKey]) {
    return STATE_CENTROIDS[stateKey];
  }

  return STATE_CENTROIDS['__default__'];
}

// ── Marker ────────────────────────────────────────────
interface MapMarker {
  lat: number; lon: number; district: string;
  color: string; count: number; label: string;
}

// ── Colors — all token-driven (zero hex literals) ─────
// Campaigns get their own distinct teal (colors.secondary)
// so they can never collide with low-urgency green.
const layerColor = (layer: Layer, t: Theme): string => {
  switch (layer) {
    case 'alerts':    return t.accent;
    case 'disease':   return t.danger;
    case 'water':     return t.info;
    case 'campaigns': return t.secondary;
  }
};

/** Marker color when a district mixes several severities/types. */
const mixedColor = (t: Theme): string => t.primary;

/** Soft background tone for a severity level (solid fill is CRITICAL's privilege). */
const severityBgTone = (level: string, t: Theme): string => {
  switch (level?.toLowerCase()) {
    case 'critical': return t.dangerBg;
    case 'high':     return t.offlineBg;   // saffron family
    case 'medium':   return t.warningBg;
    case 'low':      return t.successBg;
    default:         return t.surfaceVariant;
  }
};

/** Per-layer legend: color → label, computed from theme tokens.
 *  Fixes the old duplicate-key bug where low-urgency green was
 *  overwritten by the campaign label. */
function legendLabelsFor(layer: Layer, t: Theme): Record<string, string> {
  const base: Record<string, string> = { [mixedColor(t)]: 'Mixed' };
  switch (layer) {
    case 'alerts':
      return {
        [t.severityCritical]: 'Critical',
        [t.severityHigh]:     'High',
        [t.severityMedium]:   'Medium',
        [t.severityLow]:      'Low',
        ...base,
      };
    case 'disease':   return { [t.danger]: 'Disease reports', ...base };
    case 'water':     return { [t.info]: 'Water reports', ...base };
    case 'campaigns': return { [t.secondary]: 'Campaign', ...base };
  }
}

// ── Build markers — GROUP BY DISTRICT, use avg GPS if available ──
function groupByDistrict<T extends HealthMapRow>(
  rows: T[],
  getDistrict: (r: T) => string | null | undefined,
  getColor:    (r: T) => string,
  getLabel:    (r: T) => string,
  multi:       string,
  getState?:   (r: T) => string | null | undefined,
  getLocationName?: (r: T) => string | null | undefined,
  hasCoords = true,
): MapMarker[] {
  const map: Record<string, {
    lats: number[]; lons: number[]; colors: Set<string>;
    labels: string[]; count: number; district: string;
    state?: string | null; locationName?: string | null;
  }> = {};

  rows.forEach(r => {
    const rawDistrict = getDistrict(r) || getLocationName?.(r) || 'Unknown';
    const dist = String(rawDistrict).toLowerCase().trim();
    if (!map[dist]) {
      map[dist] = {
        lats: [], lons: [], colors: new Set(), labels: [], count: 0, district: dist,
        state: getState?.(r) ?? null,
        locationName: getLocationName?.(r) ?? null,
      };
    }
    map[dist].count++;
    if (!map[dist].state) map[dist].state = getState?.(r) ?? null;
    if (!map[dist].locationName) map[dist].locationName = getLocationName?.(r) ?? null;
    // Use ACTUAL GPS from the record if present and valid (not 0,0 which is default/empty)
    if (
      hasCoords &&
      r.latitude !== undefined && r.latitude !== null &&
      r.longitude !== undefined && r.longitude !== null &&
      !(r.latitude === 0 && r.longitude === 0)
    ) {
      map[dist].lats.push(Number(r.latitude));
      map[dist].lons.push(Number(r.longitude));
    }
    map[dist].colors.add(getColor(r));
    const lbl = getLabel(r);
    if (lbl) map[dist].labels.push(lbl);
  });

  return Object.values(map).map(info => {
    // Average of actual GPS coords if available, else use centroid lookup
    const lat = info.lats.length
      ? info.lats.reduce((a, b) => a + b, 0) / info.lats.length
      : fallbackCoords(info.district, info.state, info.locationName)[0];
    const lon = info.lons.length
      ? info.lons.reduce((a, b) => a + b, 0) / info.lons.length
      : fallbackCoords(info.district, info.state, info.locationName)[1];

    const colorArr = Array.from(info.colors);
    const color = colorArr.length > 1 ? multi : colorArr[0];
    const uniqueLabels = [...new Set(info.labels)].slice(0, 3).join(', ') || info.district;
    const distPretty = info.district.replace(/\b\w/g, c => c.toUpperCase());

    return { lat, lon, district: distPretty, color, count: info.count, label: uniqueLabels };
  }) as MapMarker[];
}

type AlertLike = AlertRow | AlertLayerRow;

function buildAlertMarkers(alerts: AlertLike[], t: Theme): MapMarker[] {
  return groupByDistrict(
    alerts,
    r => r.district,
    r => getSeverityColor(r.urgency_level ?? '', t),
    r => `${(r.urgency_level ?? '').charAt(0).toUpperCase() + (r.urgency_level ?? '').slice(1)} Alert`,
    mixedColor(t),
    r => r.state,
    r => r.location_name,
  );
}

function buildDiseaseMarkers(data: DiseaseRow[], t: Theme): MapMarker[] {
  return groupByDistrict(
    data,
    r => r.district,
    _r => layerColor('disease', t),
    r => r.disease_name ?? '',
    mixedColor(t),
    r => r.state,
  );
}

function buildWaterMarkers(data: WaterRow[], t: Theme): MapMarker[] {
  return groupByDistrict(
    data,
    r => r.district,
    _r => layerColor('water', t),
    r => r.overall_quality ?? 'Water Report',
    mixedColor(t),
    r => r.state,
  );
}

function buildCampaignMarkers(data: CampaignRow[], t: Theme): MapMarker[] {
  // campaigns table has no lat/lon columns — use district centroid only
  return groupByDistrict(
    data,
    r => r.district,
    _r => layerColor('campaigns', t),
    r => (r.campaign_type ?? '').replace(/_/g, ' '),
    mixedColor(t),
    r => r.state,
    r => r.location_name,
    false,  // hasCoords = false
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Leaflet HTML — colors interpolated from theme tokens ──
interface MapHtmlTheme {
  isDark: boolean;
  pageBg: string;       // colors.background
  legendBg: string;     // colors.card
  legendText: string;   // colors.text
  legendBorder: string; // colors.border
  legendMuted: string;  // colors.textSecondary
  badgeText: string;    // colors.textInverse — count numeral on marker
  badgeRing: string;    // colors.card — ring around count badge
  userColor: string;    // colors.primary — "you are here"
  legendLabels: Record<string, string>;
}

function buildLeafletHtml(
  markers: MapMarker[],
  activeLayer: Layer,
  mapTheme: MapHtmlTheme,
  userLat?: number,
  userLon?: number,
): string {
  const markersJs = JSON.stringify(markers);
  const activeLayerJs = JSON.stringify(activeLayer);
  const legendLabelsJs = JSON.stringify(mapTheme.legendLabels);
  const hasUserCoords = Number.isFinite(userLat) && Number.isFinite(userLon);
  const userJs = hasUserCoords ? `[${userLat},${userLon}]` : 'null';
  const initView = hasUserCoords
    ? `[${userLat},${userLon}],9`
    : '[20.5937,78.9629],5';
  const tileBase = mapTheme.isDark ? 'dark_nolabels' : 'light_nolabels';
  const tileLabels = mapTheme.isDark ? 'dark_only_labels' : 'light_only_labels';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:${mapTheme.pageBg};overflow:hidden;}
  #map{width:100%;height:100vh;}
  /* Controls stay clear of the card edges AND of the RN overlays that
     float above this map: RN owns top-left + top-right, Leaflet owns
     bottom-left (zoom) and bottom-right (legend). */
  .leaflet-control-container .leaflet-control{margin:10px;clear:none;}
  .leaflet-bar a{width:32px;height:32px;line-height:32px;}
  .legend{background:${mapTheme.legendBg};border-radius:8px;padding:8px 12px;font-size:12px;font-weight:600;color:${mapTheme.legendText};border:1px solid ${mapTheme.legendBorder};max-width:150px;}
  .li{display:flex;align-items:center;gap:6px;margin:3px 0;}
  .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
  .count-badge{min-width:26px;height:26px;border-radius:13px;border:2px solid ${mapTheme.badgeRing};color:${mapTheme.badgeText};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;font-family:system-ui,sans-serif;padding:0 5px;}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map', {
  preferCanvas: true,
  zoomAnimation: true,
  fadeAnimation: false,
  markerZoomAnimation: false,
  attributionControl: false,
  zoomControl: false
}).setView(${initView});

// Zoom sits bottom-left: the top-left corner belongs to the RN
// alert/report overlay and the top-right to the expand button.
L.control.zoom({ position: 'bottomleft' }).addTo(map);

var baseTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/${tileBase}/{z}/{x}/{y}{r}.png', {
  maxZoom: 13,
  maxNativeZoom: 12,
  detectRetina: false,
  subdomains: 'abcd',
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1
}).addTo(map);

// City labels only (lightweight second layer)
var labelTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/${tileLabels}/{z}/{x}/{y}{r}.png', {
  maxZoom: 13, maxNativeZoom: 12, detectRetina: false, subdomains: 'abcd',
  updateWhenIdle: true, updateWhenZooming: false
}).addTo(map);

// Tile watchdog — Leaflet itself is inlined, so only TILES need the
// network. After repeated failures (and failures clearly outnumbering
// successes) tell the RN side so it can swap in the honest fallback.
var tileErrors = 0, tileLoads = 0, tilesDownSent = false;
function noteTileLoad() { tileLoads++; }
function noteTileError() {
  tileErrors++;
  if (!tilesDownSent && tileErrors >= 6 && tileErrors >= tileLoads * 3) {
    tilesDownSent = true;
    var msg = 'HEALTHMAP_TILES_OFFLINE';
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(msg);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
      }
    } catch (e) {}
  }
}
baseTiles.on('tileload', noteTileLoad);
baseTiles.on('tileerror', noteTileError);
labelTiles.on('tileload', noteTileLoad);
labelTiles.on('tileerror', noteTileError);

var markers = ${markersJs};
var activeLayer = ${activeLayerJs};
var userPos = ${userJs};
var legendLabels = ${legendLabelsJs};
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
var seenColors = {};
var boundsPoints = [];
var layerStyle = {
  alerts: { baseRadius: 46000, perCountRadius: 16000, maxRadius: 190000, fillOpacity: 0.34, strokeOpacity: 0.95, strokeWeight: 2 },
  disease: { baseRadius: 36000, perCountRadius: 12000, maxRadius: 150000, fillOpacity: 0.22, strokeOpacity: 0.8, strokeWeight: 1.4 },
  water: { baseRadius: 30000, perCountRadius: 9000,  maxRadius: 130000, fillOpacity: 0.16, strokeOpacity: 0.72, strokeWeight: 1.2 },
  campaigns: { baseRadius: 36000, perCountRadius: 11000, maxRadius: 160000, fillOpacity: 0.24, strokeOpacity: 0.88, strokeWeight: 1.8 }
}[activeLayer] || { baseRadius: 30000, perCountRadius: 9000, maxRadius: 130000, fillOpacity: 0.16, strokeOpacity: 0.72, strokeWeight: 1.2 };

markers.forEach(function(m) {
  var areaRadiusMeters = Math.min(layerStyle.maxRadius, layerStyle.baseRadius + (m.count * layerStyle.perCountRadius));
  boundsPoints.push([m.lat, m.lon]);

  // Area highlight for affected district.
  L.circle([m.lat, m.lon], {
    radius: areaRadiusMeters,
    color: m.color,
    weight: layerStyle.strokeWeight,
    opacity: layerStyle.strokeOpacity,
    fillColor: m.color,
    fillOpacity: layerStyle.fillOpacity
  }).addTo(map);

  var safeDistrict = escapeHtml(m.district);
  var safeLabel = escapeHtml(m.label);
  var safeCount = escapeHtml(m.count);
  // Severity marker with a text count badge — never color alone.
  var badgeIcon = L.divIcon({
    html: '<div class="count-badge" style="background:' + m.color + '">' + safeCount + '</div>',
    className: '',
    iconSize: null,
    iconAnchor: [13, 13]
  });
  L.marker([m.lat, m.lon], { icon: badgeIcon }).addTo(map).bindPopup(
    '<b style="font-size:13px">' + safeDistrict + '</b><br/>' +
    '<span style="font-size:12px">' + safeLabel + '</span><br/>' +
    '<span style="font-size:12px">' + safeCount + ' record' + (m.count>1?'s':'') + '</span>'
  );
  seenColors[m.color] = legendLabels[m.color] || 'Data';
});

if (userPos) {
  boundsPoints.push(userPos);
  L.circle(userPos, {
    radius: 9000,
    color: '${mapTheme.userColor}',
    weight: 1,
    opacity: 0.85,
    fillColor: '${mapTheme.userColor}',
    fillOpacity: 0.12,
  }).addTo(map);
  var icon = L.divIcon({
    html: '<div style="width:18px;height:18px;border-radius:50%;background:${mapTheme.userColor};border:3px solid ${mapTheme.badgeRing}"></div>',
    className:'', iconAnchor:[9,9]
  });
  L.marker(userPos, {icon:icon}).addTo(map).bindPopup('<b>Your Location</b>');
}

if (boundsPoints.length > 0) {
  var bounds = L.latLngBounds(boundsPoints);
  map.fitBounds(bounds, { padding: [28, 28], maxZoom: 8 });
}

var legendHtml = '<div class="legend">';
Object.keys(seenColors).forEach(function(c){
  legendHtml += '<div class="li"><div class="dot" style="background:'+c+'"></div>'+seenColors[c]+'</div>';
});
if(!Object.keys(seenColors).length) legendHtml += '<span style="color:${mapTheme.legendMuted}">No data</span>';
legendHtml += '</div>';
var leg = L.control({position:'bottomright'});
leg.onAdd = function(){ var d=L.DomUtil.create('div'); d.innerHTML=legendHtml; return d; };
leg.addTo(map);
</script>
</body>
</html>`;
}

// ── WebMap iframe ─────────────────────────────────────
const TILES_OFFLINE_MSG = 'HEALTHMAP_TILES_OFFLINE';

function WebMap({
  html,
  height,
  onTilesOffline,
}: {
  html: string;
  height: number | string;
  onTilesOffline?: () => void;
}) {
  // Keep the latest callback without re-subscribing the web listener.
  const tilesOfflineRef = useRef(onTilesOffline);
  tilesOfflineRef.current = onTilesOffline;

  // Web branch: the sandboxed iframe reports tile failure via
  // window.parent.postMessage — listen once per mount.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      if (event?.data === TILES_OFFLINE_MSG) tilesOfflineRef.current?.();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (Platform.OS !== 'web') {
    if (WebViewComponent) {
      const nativeStyle = typeof height === 'number'
        ? { width: '100%', height }
        : { width: '100%', flex: 1 };

      return (
        <WebViewComponent
          originWhitelist={['*']}
          source={{ html }}
          style={nativeStyle}
          javaScriptEnabled
          domStorageEnabled
          onMessage={(event: any) => {
            if (event?.nativeEvent?.data === TILES_OFFLINE_MSG) tilesOfflineRef.current?.();
          }}
        />
      );
    }

    return null;
  }

  return (
    <iframe
      srcDoc={html}
      style={{ width: '100%', height, border: 'none', display: 'block' } as any}
      title="HealthMap"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}

// ── Layer config ──────────────────────────────────────
const LAYERS: { id: Layer; label: string; icon: string }[] = [
  { id:'alerts',    label:'Alerts',    icon:'warning-outline'   },
  { id:'disease',   label:'Disease',   icon:'fitness-outline'   },
  { id:'water',     label:'Water',     icon:'water-outline'     },
  { id:'campaigns', label:'Campaigns', icon:'megaphone-outline' },
];

// ══════════════════════════════════════════════════════
//  Core map panel (used inside MapAndAlertsSection)
// ══════════════════════════════════════════════════════
interface MapPanelProps {
  profile: Profile;
  alerts: AlertRow[];
  userLat?: number;
  userLon?: number;
  onRequestLocate: () => void;
  locating: boolean;
  isExpanded?: boolean;
  onOpenReport?: (type: 'disease' | 'water', reportId: string) => void;
}

const MapPanel: React.FC<MapPanelProps> = ({
  profile, alerts, userLat, userLon, onRequestLocate, locating, isExpanded, onOpenReport,
}) => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth < STACK_BREAKPOINT;
  const netInfo = useNetInfo();
  // NetInfo reports isInternetReachable === null before the first probe — treat as online.
  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const [activeLayer, setActiveLayer] = useState<Layer>('alerts');
  const [diseaseData,  setDiseaseData]  = useState<DiseaseRow[]>([]);
  const [waterData,    setWaterData]    = useState<WaterRow[]>([]);
  const [campaignData, setCampaignData] = useState<CampaignRow[]>([]);
  const [alertLayerData, setAlertLayerData] = useState<AlertLayerRow[]>([]);
  const [loadingData,  setLoadingData]  = useState(false);
  // Per-layer fetch errors — error ≠ empty; a failed load never renders as "No data".
  const [layerErrors, setLayerErrors] = useState<Partial<Record<Layer, string>>>({});
  // Tile watchdog verdict — the map shell (vendored Leaflet) rendered fine but
  // tiles keep failing. Distinct from netinfo-offline and from data-fetch errors.
  const [tilesFailed, setTilesFailed] = useState(false);
  // How many alert rows the client-side district filter dropped from the last
  // fetch (BRK-05). A map with no pins must never be read as "nothing is
  // happening" when the server did return rows — it means we hid them.
  const [alertsHiddenByScope, setAlertsHiddenByScope] = useState(0);

  // Give tiles another chance when the layer changes or connectivity returns.
  useEffect(() => { setTilesFailed(false); }, [activeLayer, offline]);
  const handleTilesOffline = useCallback(() => setTilesFailed(true), []);

  useEffect(() => {
    if (alerts.length && !alertLayerData.length) {
      setAlertLayerData(alerts as AlertLayerRow[]);
    }
  }, [alerts, alertLayerData.length]);

  const fetchLayerData = useCallback(async () => {
    setLoadingData(true);
    setLayerErrors(prev => ({ ...prev, disease: undefined, water: undefined, campaigns: undefined }));
    try {
      const [d, w, c] = await Promise.all([
        supabase.from('disease_reports')
          .select('id,district,state,disease_name,severity,latitude,longitude,created_at')
          .order('created_at', { ascending: false })
          .eq('approval_status','approved').limit(300),
        supabase.from('water_quality_reports')
          .select('id,district,state,source_name,overall_quality,latitude,longitude,created_at')
          .order('created_at', { ascending: false })
          .eq('approval_status','approved').limit(300),
        supabase.from('health_campaigns')
          .select('district,state,location_name,campaign_type,status')
          .order('created_at', { ascending: false })
          .limit(300),
      ]);

      const nextErrors: Partial<Record<Layer, string>> = {};

      if (d.error) {
        console.error('Failed to load disease layer data:', d.error);
        nextErrors.disease = "Couldn't load disease reports — check connection";
      } else if (d.data) {
        setDiseaseData(d.data);
      }

      if (w.error) {
        console.error('Failed to load water layer data:', w.error);
        nextErrors.water = "Couldn't load water reports — check connection";
      } else if (w.data) {
        setWaterData(w.data);
      }

      if (c.error) {
        console.error('Failed to load campaign layer data:', c.error);
        nextErrors.campaigns = "Couldn't load campaign data — check connection";
      } else if (c.data) {
        setCampaignData(c.data);
      }

      if (Object.keys(nextErrors).length > 0) {
        setLayerErrors(prev => ({ ...prev, ...nextErrors }));
      }
    } catch (error) {
      console.error('Unexpected layer fetch error:', error);
      setLayerErrors(prev => ({
        ...prev,
        disease: "Couldn't load disease reports — check connection",
        water: "Couldn't load water reports — check connection",
        campaigns: "Couldn't load campaign data — check connection",
      }));
    } finally {
      setLoadingData(false);
    }
  }, []);

  const fetchAlertLayerData = useCallback(async () => {
    setLoadingData(true);
    setLayerErrors(prev => ({ ...prev, alerts: undefined }));
    setAlertsHiddenByScope(0);
    try {
      const runAlertQuery = async (selectClause: string) => {
        let q = supabase
          .from('health_alerts')
          .select(selectClause)
          .eq('status', 'active')
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(300);
        return q;
      };

      const { data, error } = await runAlertQuery(
        'id,district,state,location_name,title,urgency_level,alert_type,disease_or_issue,created_at'
      );

      if (error) {
        console.error('Failed to load alert layer data:', error);
        setLayerErrors(prev => ({ ...prev, alerts: "Couldn't load alert data — check connection" }));
      } else if (data) {
        const rows = data as unknown as AlertLayerRow[];
        const inScope = filterAlertsForProfile(rows, profile);
        // Remember what the district filter removed so the map can admit it.
        setAlertsHiddenByScope(rows.length - inScope.length);
        setAlertLayerData(inScope);
      }
    } catch (error) {
      console.error('Unexpected alert layer fetch error:', error);
      setLayerErrors(prev => ({ ...prev, alerts: "Couldn't load alert data — check connection" }));
    } finally {
      setLoadingData(false);
    }
  }, [profile.district, profile.role]);

  useEffect(() => {
    if (activeLayer === 'alerts') {
      fetchAlertLayerData();
    } else {
      fetchLayerData();
    }
  }, [activeLayer, fetchAlertLayerData, fetchLayerData]);

  const alertSource = (alertLayerData.length ? alertLayerData : alerts) as AlertLike[];

  const markers = React.useMemo((): MapMarker[] => {
    switch (activeLayer) {
      case 'alerts':    return buildAlertMarkers(alertSource, colors);
      case 'disease':   return buildDiseaseMarkers(diseaseData, colors);
      case 'water':     return buildWaterMarkers(waterData, colors);
      case 'campaigns': return buildCampaignMarkers(campaignData, colors);
    }
  }, [activeLayer, alertSource, diseaseData, waterData, campaignData, colors]);

  const html = React.useMemo(
    () => buildLeafletHtml(
      markers,
      activeLayer,
      {
        isDark,
        pageBg: colors.background,
        legendBg: colors.card,
        legendText: colors.text,
        legendBorder: colors.border,
        legendMuted: colors.textSecondary,
        badgeText: colors.textInverse,
        badgeRing: colors.card,
        userColor: colors.primary,
        legendLabels: legendLabelsFor(activeLayer, colors),
      },
      userLat,
      userLon,
    ),
    [markers, activeLayer, userLat, userLon, colors, isDark]
  );

  const reportItems = React.useMemo(() => {
    if (activeLayer === 'disease') {
      return diseaseData.filter(item => item.disease_name).slice(0, 8);
    }
    if (activeLayer === 'water') {
      return waterData.filter(item => item.source_name).slice(0, 8);
    }
    return [];
  }, [activeLayer, diseaseData, waterData]);

  // Fetch failure for the layer currently on screen — rendered as an inline
  // error panel with Retry, never conflated with a genuinely empty map.
  const activeLayerError = layerErrors[activeLayer];
  const retryActiveLayer = useCallback(() => {
    if (activeLayer === 'alerts') {
      fetchAlertLayerData();
    } else {
      fetchLayerData();
    }
  }, [activeLayer, fetchAlertLayerData, fetchLayerData]);

  // An alerts map with no pins has three different meanings and only one of
  // them is calm. Say which one this is, right under the map (BRK-05).
  const districtNotSet = React.useMemo(
    () => isRadiusScopedRole(profile.role) && computeCompleteness(profile).missing.includes('district'),
    [profile],
  );
  const alertScopeNotice = React.useMemo(() => {
    if (activeLayer !== 'alerts' || offline || activeLayerError) return null;
    if (districtNotSet) {
      return t('alertScope.mapNoDistrict', {
        defaultValue: "Your district isn't set, so no alert can be matched to you. Add it in Profile — an empty map here is not an all-clear.",
      });
    }
    if (alertsHiddenByScope > 0) {
      const n = alertsHiddenByScope;
      const where = profile.district
        ? t('alertScope.whereDistrict', {
            defaultValue: '{{district}} and {{km}} km around it',
            district: profile.district,
            km: ALERT_RADIUS_KM,
          })
        : t('alertScope.whereUnknown', { defaultValue: 'your area' });
      return n === 1
        ? t('alertScope.mapHiddenOne', {
            defaultValue: '1 active alert is not on this map — it is outside {{where}}.',
            where,
          })
        : t('alertScope.mapHiddenMany', {
            defaultValue: '{{n}} active alerts are not on this map — they are outside {{where}}.',
            n,
            where,
          });
    }
    return null;
  }, [activeLayer, offline, activeLayerError, districtNotSet, alertsHiddenByScope, profile.district, t]);

  const showReportOverlay = !offline && !activeLayerError && !tilesFailed && (activeLayer === 'disease' || activeLayer === 'water') && reportItems.length > 0;
  const showAlertOverlay = !offline && !activeLayerError && !tilesFailed && !!isExpanded && activeLayer === 'alerts' && alertSource.length > 0;
  const alertItems = React.useMemo(() => alertSource.slice(0, 8), [alertSource]);
  // Stacked (narrow) layout gives the map the full card width, so it can
  // afford a taller frame; side-by-side keeps the shorter one.
  const mapHeight = isExpanded ? '100%' : (isNarrow ? 240 : 195);
  // Floating panels are capped as a fraction of the card so they can never
  // reach past its edges at 360dp — the other corner stays free for the
  // expand button (top-right) and the Leaflet zoom/legend (bottom row).
  const overlayWidthCap = { maxWidth: isNarrow ? '64%' : 230 } as const;

  return (
    <View style={isExpanded ? mp.rootExpanded : mp.rootInline}>
      <View style={[mp.mapFrame, isExpanded && mp.mapFrameExpanded]}>
        {offline ? (
          /* No connection at all — the shell is local now, but tiles
             and data need the network; say so honestly. */
          <View
            style={[
              mp.offlinePanel,
              { backgroundColor: colors.offlineBg, borderColor: colors.offline },
              typeof mapHeight === 'number' ? { height: mapHeight } : { flex: 1 },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons name="cloud-offline-outline" size={24} color={colors.offline} />
            <Text style={[mp.offlineTitle, { color: colors.text }]}>You're offline — map unavailable</Text>
            <Text style={[mp.offlineBody, { color: colors.textSecondary }]}>
              The live map needs a connection. It will come back when you're online; alerts saved on this phone still show here.
            </Text>
          </View>
        ) : activeLayerError ? (
          /* Layer fetch failed — inline error with Retry (error ≠ empty). */
          <View
            style={[
              mp.errorPanel,
              { backgroundColor: colors.dangerBg, borderColor: colors.danger },
              typeof mapHeight === 'number' ? { height: mapHeight } : { flex: 1 },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
            <Text style={[mp.errorTitle, { color: colors.text }]}>{activeLayerError}</Text>
            <TouchableOpacity
              style={[mp.retryBtn, { backgroundColor: colors.card, borderColor: colors.danger }]}
              onPress={retryActiveLayer}
              disabled={loadingData}
              accessibilityRole="button"
              accessibilityLabel="Retry loading map data"
            >
              {loadingData
                ? <ActivityIndicator size="small" color={colors.danger} />
                : <><Ionicons name="refresh-outline" size={16} color={colors.danger} /><Text style={[mp.retryText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>Retry</Text></>
              }
            </TouchableOpacity>
          </View>
        ) : tilesFailed ? (
          /* Leaflet itself is vendored, so the shell loads — but the TILES
             kept failing. Honest offline/list fallback: say why, show the
             last-synced district data, offer a retry. */
          <View
            style={[
              mp.offlinePanel,
              { backgroundColor: colors.offlineBg, borderColor: colors.offline },
              typeof mapHeight === 'number' ? { height: mapHeight } : { flex: 1 },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons name="cloud-offline-outline" size={24} color={colors.offline} />
            <Text style={[mp.offlineTitle, { color: colors.text }]}>
              Map tiles need internet — data below is from your last sync
            </Text>
            <Text style={[mp.tilesFallbackCount, { color: colors.textSecondary }]}>
              {markers.length} district{markers.length !== 1 ? 's' : ''} with {activeLayer} data
            </Text>
            {isExpanded && markers.slice(0, 4).map((m, i) => (
              <View key={`${m.district}-${i}`} style={mp.tilesFallbackRow}>
                <View style={[mp.tilesFallbackDot, { backgroundColor: m.color }]} />
                <Text style={[mp.tilesFallbackRowText, { color: colors.text }]} numberOfLines={1}>
                  {m.district} ({m.count})
                </Text>
              </View>
            ))}
            <TouchableOpacity
              style={[mp.retryBtn, { backgroundColor: colors.card, borderColor: colors.offline }]}
              onPress={() => setTilesFailed(false)}
              accessibilityRole="button"
              accessibilityLabel="Retry loading map tiles"
            >
              <Ionicons name="refresh-outline" size={16} color={colors.offline} />
              <Text style={[mp.retryText, { color: colors.offline }]} maxFontSizeMultiplier={1.3}>Retry map</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Map — WebView on native, iframe on web */
          <WebMap html={html} height={mapHeight} onTilesOffline={handleTilesOffline} />
        )}
        {showAlertOverlay && (
          <View style={[mp.floatingOverlay, overlayWidthCap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[mp.overlayTitle, { color: colors.textSecondary }]}>ALERTS</Text>
            <ScrollView style={mp.alertList} showsVerticalScrollIndicator={false}>
              {alertItems.map((item, index) => {
                const urgency = (item.urgency_level ?? '').toLowerCase();
                const isCritical = urgency === 'critical';
                const badgeFg = isCritical ? colors.textInverse : getSeverityColor(urgency, colors);
                const badgeBg = isCritical ? colors.danger : severityBgTone(urgency, colors);
                const title = (item.title ?? 'Untitled alert').trim();
                const meta = [
                  item.district?.trim(),
                  item.disease_or_issue?.trim(),
                  item.alert_type?.replace(/_/g, ' ').trim(),
                ].filter(Boolean).join(' · ');

                return (
                  <View key={`${item.id || 'alert'}-${index}`} style={mp.alertItem}>
                    <View style={mp.alertTitleRow}>
                      <Text style={[mp.alertTitleText, { color: colors.text }]} numberOfLines={1}>
                        {title}
                      </Text>
                      <View style={[mp.alertBadge, { backgroundColor: badgeBg }]}>
                        <Text style={[mp.alertBadgeText, { color: badgeFg }]} maxFontSizeMultiplier={1.3}>
                          {(urgency || 'medium').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    {meta.length > 0 && (
                      <Text style={[mp.alertMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                        {meta}
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
        {showReportOverlay && (
          <View style={[mp.floatingOverlay, overlayWidthCap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[mp.overlayTitle, { color: colors.textSecondary }]}>
              {activeLayer === 'disease' ? 'DISEASE REPORTS' : 'WATER REPORTS'}
            </Text>
            <ScrollView style={mp.reportList} showsVerticalScrollIndicator={false}>
              {reportItems.map((item, index) => {
                const id = item.id ?? '';
                const label = activeLayer === 'disease'
                  ? ((item as DiseaseRow).disease_name ?? 'Unknown disease')
                  : ((item as WaterRow).source_name ?? 'Unknown source');

                return (
                  <TouchableOpacity
                    key={`${id || 'report'}-${index}`}
                    style={mp.reportItem}
                    onPress={() => {
                      if (!id || !onOpenReport) return;
                      onOpenReport(activeLayer as 'disease' | 'water', id);
                    }}
                    disabled={!id || !onOpenReport}
                    accessibilityRole="link"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[mp.reportLink, { color: isDark ? colors.primary : colors.primaryDark }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Scope confession — the pins on this map are filtered client-side, and
          "no pins" must never be mistaken for "nothing is happening". */}
      {alertScopeNotice && (
        <View
          style={[mp.scopeNotice, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
          <Text style={[mp.scopeNoticeText, { color: colors.text }]}>{alertScopeNotice}</Text>
        </View>
      )}

      {/* Layer chips — selection is never conveyed by tint alone */}
      <View style={[mp.filterBar, isExpanded ? mp.filterBarExpanded : mp.filterBarInline]}>
        <View style={mp.filterContent}>
          {LAYERS.map(l => {
            const selected = activeLayer === l.id;
            const chipColor = layerColor(l.id, colors);
            return (
              <TouchableOpacity
                key={l.id}
                style={[mp.chip, {
                  backgroundColor: selected ? chipColor : colors.card,
                  borderColor: selected ? chipColor : colors.border,
                }]}
                onPress={() => { setActiveLayer(l.id); }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${l.label} layer${selected ? ', selected' : ''}`}
              >
                {selected
                  ? <Ionicons name="checkmark" size={14} color={colors.textInverse} />
                  : <Ionicons name={l.icon as any} size={14} color={colors.textSecondary} />
                }
                <Text style={[mp.chipTxt, { color: selected ? colors.textInverse : colors.text }]} maxFontSizeMultiplier={1.3}>
                  {l.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[mp.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={onRequestLocate}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Center map on my location"
          >
            {locating
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <><Ionicons name="locate-outline" size={14} color={colors.primary} /><Text style={[mp.chipTxt, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>GPS</Text></>
            }
          </TouchableOpacity>
        </View>
        {loadingData && <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 6, alignSelf: 'center' }} />}
      </View>

      {/* Native fallback if WebView unavailable */}
      {Platform.OS !== 'web' && !WebViewComponent && (
        <View style={[mp.nativeFallback, { backgroundColor: colors.surface, borderColor: colors.borderLight, height: isExpanded ? 400 : mapHeight }]}>
          <Ionicons name="map-outline" size={28} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
            {markers.length} district{markers.length !== 1 ? 's' : ''} with {activeLayer} data
          </Text>
          {markers.slice(0, 4).map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
              <Text style={{ color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] }}>{m.district} ({m.count})</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const mp = StyleSheet.create({
  // Full-screen: a strict flex child of the modal (definite height).
  rootExpanded: { flex: 1 },
  // Inline: flexBasis 'auto' (NOT flex:1 / basis 0) so the panel is sized by
  // its own content when the card's height is content-driven — a basis-0 child
  // in an auto-height parent collapses and the layer chips get clipped.
  rootInline: { flexGrow: 1, flexBasis: 'auto' },
  mapFrame: { position: 'relative', overflow: 'hidden', borderRadius: 8 },
  mapFrameExpanded: { flex: 1, minHeight: 0 },
  offlinePanel: {
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 6,
  },
  offlineTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  offlineBody: { fontSize: 13, lineHeight: 18, fontWeight: '500', textAlign: 'center' },
  errorPanel: {
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  errorTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    minWidth: 120,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 4,
  },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  // Tile-failure fallback — count line + district rows (last-synced data)
  tilesFallbackCount: { fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center', fontVariant: ['tabular-nums'] },
  tilesFallbackRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tilesFallbackDot: { width: 8, height: 8, borderRadius: 4 },
  tilesFallbackRowText: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  // Scope confession strip — wraps rather than truncates; the sentence is the
  // whole point of it, so it may never be clipped at 360dp.
  scopeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  scopeNoticeText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  filterBar: { marginTop: 8, marginBottom: 2 },
  filterBarInline: { minHeight: 48 },
  filterBarExpanded: { minHeight: 56 },
  filterContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 2,
    // The shell's floating AI button is pinned to the right edge (56dp wide +
    // 16 inset) and never scrolls, so anything laid out in that column is
    // permanently unreachable. Keep the wrapping filter chips clear of it —
    // at 360dp the "Water" chip used to sit under the button with no scroll
    // position that could free it.
    paddingRight: 76,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  chipTxt:     { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  nativeFallback: { alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  /* One floating panel recipe, pinned top-left with a 10dp inset.
     The alert list and the report list are mutually exclusive (they belong
     to different layers), so they share the corner. Width is capped at
     render time against the window width — see overlayWidthCap. */
  floatingOverlay: {
    position: 'absolute',
    left: 10,
    top: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    maxHeight: 150,
  },
  overlayTitle: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  reportList: { maxHeight: 110 },
  reportItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingVertical: 6, minHeight: 32 },
  reportLink: { fontSize: 12, lineHeight: 16, fontWeight: '700', textDecorationLine: 'underline', flex: 1 },
  alertList: { maxHeight: 110 },
  alertItem: { paddingVertical: 4 },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertTitleText: { fontSize: 12, lineHeight: 16, fontWeight: '700', flex: 1 },
  alertMeta: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  alertBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  alertBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
});

// ══════════════════════════════════════════════════════
//  Why is the alert list empty?  (BRK-05)
// ══════════════════════════════════════════════════════
// The `alerts` we are handed have already been through
// filterAlertsForProfile on the caller's side: an exact district-string match,
// widened to ALERT_RADIUS_KM only for the pairs that both appear in a 105-entry
// hardcoded gazetteer. So an empty array means one of several different things,
// and exactly one of them deserves the green tick. Telling a health worker her
// district is clear when three alerts are live is the most dangerous lie this
// app can tell, so when the list is empty we go and ask the server whether it
// really is.
//
// A head-count of "any active alerts at all?" is NOT enough to earn the
// specific sentence "all N are outside your area": an empty list can also mean
// the caller's own fetch failed (MapTabScreen renders <MapAndAlertsSection
// alerts={[]}> beside its ErrorCard when the alert query errors), and then
// "none are near you" is a worse lie than the vague one it replaced. So the
// probe re-runs THE SAME predicate the caller's filter uses — it fetches the
// rows and applies filterAlertsForProfile itself:
//   in-scope rows exist but the list is empty  → the LIST failed, say so
//   rows exist and none are in scope           → genuinely scoped out
//   no rows at all                             → genuinely clear
const PROBE_LIMIT = 200;
const PROBE_TIMEOUT_MS = 8000;

type AlertsEmptyReason =
  | { kind: 'probing' }                        // we don't know yet — skeleton, never a tick
  | { kind: 'clear' }                          // server has none: the calm state is TRUE
  // Rows exist and the probe proved none of them are in scope. `checked` is how
  // many rows were actually examined and `total` the server's exact count — when
  // they differ we may not claim "ALL n are outside", only that the ones we read
  // were. (Keeps the sentence true if a caller ever adds a limit or predicate.)
  | { kind: 'scoped-out'; total: number; checked: number }
  // The server HAS alerts matching this profile's scope, and they are not in the
  // list we were handed — the list, not the world, is empty.
  | { kind: 'missing'; inScope: number }
  | { kind: 'no-district' }                    // profile has no district: nothing can match
  | { kind: 'unconfirmed'; cause: 'offline' | 'timeout' | 'error' }; // check failed — retry

interface ProbeRow { district?: string | null; state?: string | null; location_name?: string | null }

/** Server-side truth for "is this list empty because the world is quiet?".
 *  Runs only while the list is empty; skipped entirely when we already know we
 *  are offline, and hard-capped by PROBE_TIMEOUT_MS so the skeleton always
 *  resolves into one of the sanctioned states. */
function useAlertsEmptyReason(profile: Profile, isEmpty: boolean, offline: boolean) {
  const [reason, setReason] = useState<AlertsEmptyReason>({ kind: 'probing' });
  const [retryToken, setRetryToken] = useState(0);
  // 'Not specified' is a provisioning default, not a district — one live
  // volunteer profile holds exactly that string and would otherwise be told,
  // in green, that all is well forever.
  const districtNotSet =
    isRadiusScopedRole(profile.role) && computeCompleteness(profile).missing.includes('district');
  const { role, district, state } = profile;

  useEffect(() => {
    if (!isEmpty) return;
    if (districtNotSet) { setReason({ kind: 'no-district' }); return; }
    // Known-offline: opening a socket that cannot connect just parks the
    // skeleton until the OS TCP timeout. Answer immediately, and re-run by
    // itself when `offline` flips back to false.
    if (offline) { setReason({ kind: 'unconfirmed', cause: 'offline' }); return; }

    let cancelled = false;
    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, PROBE_TIMEOUT_MS);
    setReason({ kind: 'probing' });

    (async () => {
      try {
        const { data, count, error } = await supabase
          .from('health_alerts')
          .select('district,state,location_name', { count: 'exact' })
          .eq('status', 'active')
          .eq('approval_status', 'approved')
          .order('created_at', { ascending: false })
          .limit(PROBE_LIMIT)
          .abortSignal(controller.signal);
        if (cancelled) return;
        if (error || !data) {
          console.error('Alert all-clear check failed:', error);
          setReason({ kind: 'unconfirmed', cause: timedOut ? 'timeout' : 'error' });
          return;
        }
        const rows = data as unknown as ProbeRow[];
        const total = typeof count === 'number' ? count : rows.length;
        if (total === 0) { setReason({ kind: 'clear' }); return; }
        // Counted rows we were not given: we cannot judge scope on zero
        // evidence, and guessing is what this whole item is about.
        if (rows.length === 0) { setReason({ kind: 'unconfirmed', cause: 'error' }); return; }
        // Same predicate the caller filtered with. If it finds anything, the
        // caller's list should have contained it and does not.
        const inScope = filterAlertsForProfile(rows, { role, district, state }).length;
        if (inScope > 0) { setReason({ kind: 'missing', inScope }); return; }
        setReason({ kind: 'scoped-out', total, checked: rows.length });
      } catch (e) {
        if (cancelled) return;
        console.error('Alert all-clear check failed:', e);
        setReason({ kind: 'unconfirmed', cause: timedOut ? 'timeout' : 'error' });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [isEmpty, districtNotSet, offline, retryToken, role, district, state]);

  const retry = useCallback(() => setRetryToken(n => n + 1), []);
  return { reason, retry };
}

// ══════════════════════════════════════════════════════
//  MapAndAlertsSection — EXPORTED — used by dashboards
//  Renders [MAP | ALERTS] side by side
// ══════════════════════════════════════════════════════
interface MapAndAlertsSectionProps {
  profile: Profile;
  alerts: AlertRow[];
  alertSectionTitle?: string;
  onAlertPress?: (alert: AlertRow) => void;
  onViewAllAlerts?: () => void;
  onOpenReport?: (type: 'disease' | 'water', reportId: string) => void;
  emptyTitle?: string;
  emptySubtitle?: string;
}

export const MapAndAlertsSection: React.FC<MapAndAlertsSectionProps> = ({
  profile,
  alerts,
  alertSectionTitle = 'Active Alerts',
  onAlertPress,
  onViewAllAlerts,
  onOpenReport,
  emptyTitle = 'No Active Alerts',
  emptySubtitle = 'All systems are clear.',
}) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const { t } = useTranslation();
  // Layout is decided by WINDOW WIDTH, never by platform: a 412dp phone and a
  // 412px browser window get the same single column, a tablet gets two.
  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth < STACK_BREAKPOINT;
  const netInfo = useNetInfo();
  // NetInfo reports isInternetReachable === null before the first probe — treat as online.
  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const { reason: emptyReason, retry: retryEmptyReason } =
    useAlertsEmptyReason(profile, alerts.length === 0, offline);
  const [expanded,    setExpanded   ] = useState(false);
  const [userLat,     setUserLat    ] = useState<number | undefined>(getCachedLocation()?.lat);
  const [userLon,     setUserLon    ] = useState<number | undefined>(getCachedLocation()?.lon);
  const [locating,    setLocating   ] = useState(false);
  const [showLocPrompt, setShowLocPrompt] = useState(false);
  const [webLocationAlert, setWebLocationAlert] = useState<{ title: string; message: string } | null>(null);
  const [alertsViewportHeight, setAlertsViewportHeight] = useState(0);
  const [alertsContentHeight, setAlertsContentHeight] = useState(0);
  const mounted = useRef(false);
  const hasAlertsOverflow = alerts.length > 0 && alertsContentHeight > alertsViewportHeight + 8;

  // On first mount: if location not yet cached & not yet asked → show prompt
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (!_locationAsked && !getCachedLocation()) {
        _locationAsked = true;
        setShowLocPrompt(true);
      }
    }
  }, []);

  const showLocationAlert = useCallback((title: string, message: string) => {
    if (Platform.OS === 'web') {
      setWebLocationAlert({ title, message });
      return;
    }
    Alert.alert(title, message);
  }, []);

  const requestGPS = useCallback(async () => {
    setLocating(true);
    try {
      const cached = getCachedLocation();
      const cacheIsFresh = !!_cachedAt && (Date.now() - _cachedAt) < LOCATION_CACHE_TTL_MS;
      if (cached && cacheIsFresh) {
        setUserLat(cached.lat);
        setUserLon(cached.lon);
        return;
      }

      if (Platform.OS === 'web') {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          showLocationAlert(
            'Location Unavailable',
            'Geolocation is not supported in this browser. Please enable location services or try another browser.'
          );
          return;
        }
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            pos => {
              setCachedLocation(pos.coords.latitude, pos.coords.longitude);
              setUserLat(pos.coords.latitude);
              setUserLon(pos.coords.longitude);
              resolve();
            },
            reject,
            { timeout: 12000, enableHighAccuracy: true, maximumAge: 300000 }
          )
        );
      } else {
        const Location = await import('expo-location');
        const currentPerm = await Location.getForegroundPermissionsAsync();
        const status = currentPerm.status === 'granted'
          ? 'granted'
          : (await Location.requestForegroundPermissionsAsync()).status;
        if (status === 'granted') {
          const lastKnown = await Location.getLastKnownPositionAsync();
          if (lastKnown?.coords) {
            setCachedLocation(lastKnown.coords.latitude, lastKnown.coords.longitude);
            setUserLat(lastKnown.coords.latitude);
            setUserLon(lastKnown.coords.longitude);
            return;
          }

          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setCachedLocation(pos.coords.latitude, pos.coords.longitude);
          setUserLat(pos.coords.latitude);
          setUserLon(pos.coords.longitude);
        } else {
          Alert.alert('Permission Needed', 'Location permission was not granted. Enable it in settings to center the map on your current location.');
        }
      }
    } catch (error: any) {
      const reason = error?.message ? `\n\nReason: ${error.message}` : '';
      Alert.alert('Unable To Get Location', `We could not retrieve your current location.${reason}`);
    } finally {
      setLocating(false);
    }
  }, [showLocationAlert]);

  const linkColor = isDark ? colors.primary : colors.primaryDark;

  /** "Open the alert list" — deliberately NOT "see the full list": for a
   *  radius-scoped role that screen scopes too, and only offers the wider view
   *  behind an explicit tap. The label may promise no more than that. */
  const openListAction = (a11yLabel: string, borderColor: string) => onViewAllAlerts ? (
    <TouchableOpacity
      style={[s.emptyAction, { borderColor, backgroundColor: colors.surface }]}
      onPress={onViewAllAlerts}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <Ionicons name="list-outline" size={16} color={linkColor} />
      <Text style={[s.emptyActionText, { color: linkColor }]} maxFontSizeMultiplier={1.3}>
        {t('alertScope.openListAction', { defaultValue: 'Open the alert list' })}
      </Text>
    </TouchableOpacity>
  ) : null;

  // The legitimate faces of an empty alert list. Only 'clear' has earned the
  // green tick; every other branch names what actually happened, because a
  // worker who reads "District is Clear" will stop looking.
  const renderEmptyAlerts = () => {
    switch (emptyReason.kind) {
      case 'probing':
        return (
          <View
            style={s.emptyProbing}
            accessible
            accessibilityLabel={t('alertScope.probingA11y', { defaultValue: 'Checking whether any alerts are active' })}
          >
            <SkeletonBlock height={72} radius={12} />
            <SkeletonBlock height={72} radius={12} style={s.emptyProbingGap} />
          </View>
        );

      case 'no-district':
        return (
          <View accessibilityLiveRegion="polite">
            <EmptyState
              icon="location-outline"
              color={colors.warning}
              title={t('alertScope.noDistrictTitle', { defaultValue: "Your district isn't set" })}
              subtitle={t('alertScope.noDistrictBody', {
                defaultValue: 'Alerts are matched to your district, so none can reach you yet. This is not an all-clear — open Profile and set your district.',
              })}
            />
          </View>
        );

      case 'scoped-out': {
        const n = emptyReason.total;
        // The probe only read `checked` of `total` rows. If those differ we
        // cannot claim ALL of them are elsewhere — only the ones we read.
        const partial = emptyReason.checked < n;
        const where = profile.district
          ? t('alertScope.whereDistrict', {
              defaultValue: '{{district}} and {{km}} km around it',
              district: profile.district,
              km: ALERT_RADIUS_KM,
            })
          : t('alertScope.whereUnknown', { defaultValue: 'your area' });
        return (
          <View accessibilityLiveRegion="polite">
            <EmptyState
              icon="alert-circle-outline"
              color={colors.warning}
              title={n === 1
                ? t('alertScope.scopedOutTitleOne', { defaultValue: '1 active alert — not in your area' })
                : t('alertScope.scopedOutTitleMany', { defaultValue: '{{n}} active alerts — none in your area', n })}
              subtitle={partial
                ? t('alertScope.scopedOutBodyPartial', {
                    defaultValue: 'This list only covers {{where}}. None of the {{checked}} most recent of {{n}} active alerts are inside it, so this is not an all-clear.',
                    where, n, checked: emptyReason.checked,
                  })
                : n === 1
                  ? t('alertScope.scopedOutBodyOne', {
                      defaultValue: 'This list only covers {{where}}. The one active alert is outside that, so this is not an all-clear.',
                      where,
                    })
                  : t('alertScope.scopedOutBodyMany', {
                      defaultValue: 'This list only covers {{where}}. All {{n}} active alerts are outside that, so this is not an all-clear.',
                      where, n,
                    })}
            />
            {openListAction(
              n === 1
                ? t('alertScope.openListA11yOne', { defaultValue: 'Open the alert list, where you can show the 1 alert outside your area' })
                : t('alertScope.openListA11yMany', { defaultValue: 'Open the alert list, where you can show the {{n}} alerts outside your area', n }),
              colors.warning,
            )}
          </View>
        );
      }

      case 'missing': {
        // The server has alerts that DO match this profile's scope — so the
        // empty list in front of the user is a load failure, not a quiet world.
        const n = emptyReason.inScope;
        return (
          <View accessibilityLiveRegion="polite">
            <EmptyState
              icon="alert-circle-outline"
              color={colors.danger}
              title={n === 1
                ? t('alertScope.missingTitleOne', { defaultValue: '1 alert in your area is not shown here' })
                : t('alertScope.missingTitleMany', { defaultValue: '{{n}} alerts in your area are not shown here', n })}
              subtitle={n === 1
                ? t('alertScope.missingBodyOne', {
                    defaultValue: 'The server has 1 active alert that matches your area, but this list did not load it. This is not an all-clear.',
                  })
                : t('alertScope.missingBodyMany', {
                    defaultValue: 'The server has {{n}} active alerts that match your area, but this list did not load them. This is not an all-clear.',
                    n,
                  })}
            />
            {openListAction(
              n === 1
                ? t('alertScope.openListA11yMissingOne', { defaultValue: 'Open the alert list to see the 1 alert in your area that is missing here' })
                : t('alertScope.openListA11yMissingMany', { defaultValue: 'Open the alert list to see the {{n}} alerts in your area that are missing here', n }),
              colors.danger,
            )}
            <TouchableOpacity
              style={[s.emptyAction, { borderColor: colors.danger, backgroundColor: colors.surface }]}
              onPress={retryEmptyReason}
              accessibilityRole="button"
              accessibilityLabel={t('alertScope.checkAgainA11y', { defaultValue: 'Check again for active alerts' })}
            >
              <Ionicons name="refresh-outline" size={16} color={colors.danger} />
              <Text style={[s.emptyActionText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                {t('alertScope.checkAgain', { defaultValue: 'Check again' })}
              </Text>
            </TouchableOpacity>
          </View>
        );
      }

      case 'unconfirmed': {
        const offlineCause = emptyReason.cause === 'offline';
        return (
          <View accessibilityLiveRegion="polite">
            <EmptyState
              icon={offlineCause ? 'cloud-offline-outline' : 'alert-circle-outline'}
              color={colors.danger}
              title={offlineCause
                ? t('alertScope.unconfirmedOfflineTitle', { defaultValue: "You're offline — alerts not confirmed" })
                : emptyReason.cause === 'timeout'
                  ? t('alertScope.unconfirmedTimeoutTitle', { defaultValue: 'The alert check timed out' })
                  : t('alertScope.unconfirmedErrorTitle', { defaultValue: "Couldn't check for active alerts" })}
              subtitle={offlineCause
                ? t('alertScope.unconfirmedOfflineBody', {
                    defaultValue: 'Nothing is listed, but we could not reach the server to confirm that. This will check itself again when you are back online — do not read it as an all-clear.',
                  })
                : t('alertScope.unconfirmedBody', {
                    defaultValue: 'Nothing is listed, but we could not reach the server to confirm that. Do not read this as an all-clear.',
                  })}
            />
            <TouchableOpacity
              style={[s.emptyAction, { borderColor: colors.danger, backgroundColor: colors.surface }]}
              onPress={retryEmptyReason}
              accessibilityRole="button"
              accessibilityLabel={t('alertScope.checkAgainA11y', { defaultValue: 'Check again for active alerts' })}
            >
              <Ionicons name="refresh-outline" size={16} color={colors.danger} />
              <Text style={[s.emptyActionText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
                {t('alertScope.checkAgain', { defaultValue: 'Check again' })}
              </Text>
            </TouchableOpacity>
          </View>
        );
      }

      case 'clear':
      default:
        // Verified against the server: there really is nothing active.
        return <EmptyState icon="checkmark-circle-outline" color={colors.success} title={emptyTitle} subtitle={emptySubtitle} />;
    }
  };

  return (
    <>
      {/* ── Web-only fallback modal for location alerts ── */}
      <Modal
        visible={Platform.OS === 'web' && !!webLocationAlert}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setWebLocationAlert(null)}
      >
        <View style={[s.popupOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[s.popup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.popupIconWrap, { backgroundColor: colors.primary + '14' }]}>
              <Ionicons name="information-circle-outline" size={32} color={colors.primary} />
            </View>
            <Text style={[s.popupTitle, { color: colors.text }]}>
              {webLocationAlert?.title}
            </Text>
            <Text style={[s.popupBody, { color: colors.textSecondary }]}>
              {webLocationAlert?.message}
            </Text>
            <TouchableOpacity
              style={[s.popupAllow, { backgroundColor: colors.primary }]}
              onPress={() => setWebLocationAlert(null)}
              accessibilityRole="button"
              accessibilityLabel="OK"
            >
              <Text style={{ color: colors.onPrimary, fontSize: 15, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Location permission — MODAL POPUP on first load ── */}
      <Modal visible={showLocPrompt} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setShowLocPrompt(false)}>
        <View style={[s.popupOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[s.popup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.popupIconWrap, { backgroundColor: colors.primary + '14' }]}>
              <Ionicons name="location-outline" size={32} color={colors.primary} />
            </View>
            <Text style={[s.popupTitle, { color: colors.text }]}>Enable Location</Text>
            <Text style={[s.popupBody, { color: colors.textSecondary }]}>
              Allow HealthDrop to center the map on your location so you see health alerts in your area first.
            </Text>
            <View style={s.popupActions}>
              <TouchableOpacity
                style={[s.popupDismiss, { borderColor: colors.inputBorder }]}
                onPress={() => setShowLocPrompt(false)}
                accessibilityRole="button"
                accessibilityLabel="Not now"
              >
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.popupAllow, { backgroundColor: colors.primary, flexDirection: 'row', gap: 8 }]}
                onPress={() => { setShowLocPrompt(false); requestGPS(); }}
                accessibilityRole="button"
                accessibilityLabel="Allow location"
              >
                <Ionicons name="locate-outline" size={16} color={colors.onPrimary} />
                <Text style={{ color: colors.onPrimary, fontSize: 15, fontWeight: '700' }}>Allow Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Section heading — eyebrow-and-count ── */}
      <View style={[s.sectionHeader, { marginHorizontal: 16, marginTop: 8, marginBottom: 6 }]}>
        <Text style={[s.sectionTitle, { color: colors.textSecondary }]} numberOfLines={1}>
          ALERTS &amp; MAP
          {alerts.length > 0 && (
            <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${alerts.length}`}</Text>
          )}
        </Text>
      </View>

      {/* ── Map + alerts: one column on phones, two side by side when wide ── */}
      <View style={[s.row, isNarrow ? s.rowStacked : s.rowSideBySide]}>
        {/* ── Map ── */}
        <View style={[
          s.panel,
          isNarrow ? s.mapPanelStacked : s.mapPanelSide,
          { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' },
          !isDark && s.cardShadow,
        ]}>
          <View style={s.panelHeader}>
            <Ionicons name="map-outline" size={14} color={colors.textSecondary} />
            <Text style={[s.panelTitle, { color: colors.textSecondary }]}>HEALTH MAP</Text>
          </View>
          <View style={s.panelBody}>
            {!expanded ? (
              <MapPanel
                profile={profile}
                alerts={alerts}
                userLat={userLat}
                userLon={userLon}
                onRequestLocate={requestGPS}
                locating={locating}
                onOpenReport={onOpenReport}
              />
            ) : (
              <View style={[s.inlineMapPaused, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="expand-outline" size={18} color={colors.textSecondary} />
                <Text style={[s.inlineMapPausedText, { color: colors.textSecondary }]}>Map opened in full screen</Text>
              </View>
            )}
            <TouchableOpacity
              style={[s.mapExpandFab, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel="Expand map"
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="expand-outline" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Alerts (below the map on phones, beside it when wide) ── */}
        <View style={[
          s.panel,
          isNarrow ? s.alertPanelStacked : s.alertPanelSide,
          { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' },
          !isDark && s.cardShadow,
        ]}>
          <View style={s.panelHeader}>
            <Ionicons name="warning-outline" size={14} color={colors.textSecondary} />
            {/* The count is a fact about the list, so it is only printed when
                the list has rows. A bare "· 0" beside a body that says "4
                active alerts — none in your area" is the same silent zero this
                item exists to remove: the header is scanned first and would
                contradict the sentence underneath it. */}
            <Text style={[s.panelTitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {alertSectionTitle.toUpperCase()}
              {alerts.length > 0 && (
                <Text style={{ fontVariant: ['tabular-nums'] }}>{` · ${alerts.length}`}</Text>
              )}
            </Text>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            onLayout={(e) => setAlertsViewportHeight(e.nativeEvent.layout.height)}
            onContentSizeChange={(_, h) => setAlertsContentHeight(h)}
          >
            {alerts.length === 0
              ? renderEmptyAlerts()
              : alerts.map(a => (
                  <AlertCard
                    key={a.id}
                    alert={a}
                    onPress={onAlertPress ? () => onAlertPress(a) : undefined}
                  />
                ))
            }
          </ScrollView>
          {hasAlertsOverflow && onViewAllAlerts && (
            <TouchableOpacity
              style={[s.readMoreBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={onViewAllAlerts}
              accessibilityRole="button"
              accessibilityLabel="Read more alerts"
            >
              <Text style={[s.readMoreText, { color: isDark ? colors.primary : colors.primaryDark }]}>Read more alerts</Text>
              <Ionicons name="chevron-forward" size={14} color={isDark ? colors.primary : colors.primaryDark} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Full-screen modal ── */}
      {expanded && (
        <Modal
          visible
          animationType={reduceMotion ? 'none' : 'fade'}
          presentationStyle="fullScreen"
          statusBarTranslucent={Platform.OS === 'android'}
          onRequestClose={() => setExpanded(false)}
        >
          <View style={[s.modal, { backgroundColor: colors.background }]}>
            {/* Modal header */}
            <View style={[s.modalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <TouchableOpacity
                onPress={() => setExpanded(false)}
                style={s.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close map"
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={[s.modalTitle, { color: colors.text }]}>Health Map</Text>
              <TouchableOpacity
                style={[s.iconBtn, { backgroundColor: colors.primary + '14' }]}
                onPress={requestGPS}
                disabled={locating}
                accessibilityRole="button"
                accessibilityLabel="Center map on my location"
              >
                {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate-outline" size={18} color={colors.primary} />}
              </TouchableOpacity>
            </View>

            {/* Full map */}
            <View style={{ flex: 1 }}>
              <MapPanel
                profile={profile}
                alerts={alerts}
                userLat={userLat}
                userLon={userLon}
                onRequestLocate={requestGPS}
                locating={locating}
                isExpanded
                onOpenReport={onOpenReport}
              />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
};

const s = StyleSheet.create({
  // Light-mode-only shadow (single recipe)
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  // Section heading — eyebrow-and-count
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 },
  sectionTitle:     { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  // Location permission popup (centered modal)
  popupOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  popup:        { borderRadius: 16, borderWidth: 1, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center', overflow: 'hidden' },
  popupIconWrap:{ width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  popupTitle:   { fontSize: 16, lineHeight: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  popupBody:    { fontSize: 13, lineHeight: 18, fontWeight: '500', textAlign: 'center', marginBottom: 24 },
  popupActions: { flexDirection: 'row', gap: 12, width: '100%' },
  popupDismiss: { flex: 1, borderWidth: 1.5, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  popupAllow:   { flex: 1.5, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },

  // ── Responsive row ──────────────────────────────────────────────
  // Narrow (< STACK_BREAKPOINT): one column, each card full width, so
  // nothing can be pushed off the right edge of a 360dp screen.
  // Wide: the original two-column reading layout.
  row:           { marginHorizontal: 16, marginBottom: 12 },
  rowStacked:    { flexDirection: 'column' },
  rowSideBySide: { flexDirection: 'row', minHeight: 280 },
  panel: {
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 12,
  },
  mapPanelStacked:   { width: '100%', padding: 12, marginBottom: 12 },
  mapPanelSide:      { flex: 1.1, padding: 10, marginRight: 12 },
  alertPanelStacked: { width: '100%', padding: 12, minHeight: 200, maxHeight: 320 },
  alertPanelSide:    { flex: 1, padding: 10 },
  panelHeader:{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  panelTitle: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flex: 1 },
  // Grows into a tall card, but is content-sized when the card's height is
  // content-driven (stacked) — see MapPanel's rootInline note.
  panelBody:  { flexGrow: 1, flexBasis: 'auto', position: 'relative' },
  inlineMapPaused: {
    flexGrow: 1,
    flexBasis: 'auto',
    minHeight: 200,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  inlineMapPausedText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  mapExpandFab: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  readMoreBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  readMoreText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  // Empty-state affordances — full 48dp because they are the only way out of
  // the "we hid your alerts" / "we couldn't check" states.
  emptyProbing: { paddingVertical: 4 },
  emptyProbingGap: { marginTop: 8 },
  emptyAction: {
    marginTop: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  // Full-screen modal
  modal:       { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, paddingTop: Platform.OS === 'ios' ? 52 : 12, borderBottomWidth: 1, gap: 8 },
  modalTitle:  { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  closeBtn:    { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  iconBtn:     { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});

// Keep old default export for backward compat (unused now — dashboards use MapAndAlertsSection)
export const HealthMapComponent = MapAndAlertsSection;
export default MapAndAlertsSection;
