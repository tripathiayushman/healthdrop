// =====================================================
// HEALTH MAP COMPONENT  v2
// - Uses actual lat/lon from DB (NOT district name lookup)
// - GPS session cache (persists until page reload / logout)
// - Side-by-side layout via MapAndAlertsSection export
// - Leaflet perf: preferCanvas, optimised tile settings
// - Centers on user GPS when expanding
// - Location permission prompt on first mount
// =====================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { AlertCard, EmptyState } from '../dashboards/DashboardShared';
import { filterAlertsForProfile } from '../../lib/services/alertRadius';

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

// ── Colors ────────────────────────────────────────────
const URGENCY_COLOR: Record<string, string> = {
  critical:'#DC2626', high:'#EA580C', medium:'#F59E0B', low:'#10B981',
};
const MULTI_COLOR = '#7C3AED';
const LAYER_COLOR: Record<Layer, string> = {
  alerts:'#F59E0B', disease:'#EF4444', water:'#3B82F6', campaigns:'#10B981',
};

// ── Build markers — GROUP BY DISTRICT, use avg GPS if available ──
function groupByDistrict<T extends HealthMapRow>(
  rows: T[],
  getDistrict: (r: T) => string | null | undefined,
  getColor:    (r: T) => string,
  getLabel:    (r: T) => string,
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
    const color = colorArr.length > 1 ? MULTI_COLOR : colorArr[0];
    const uniqueLabels = [...new Set(info.labels)].slice(0, 3).join(', ') || info.district;
    const distPretty = info.district.replace(/\b\w/g, c => c.toUpperCase());

    return { lat, lon, district: distPretty, color, count: info.count, label: uniqueLabels };
  }) as MapMarker[];
}

type AlertLike = AlertRow | AlertLayerRow;

function buildAlertMarkers(alerts: AlertLike[]): MapMarker[] {
  return groupByDistrict(
    alerts,
    r => r.district,
    r => URGENCY_COLOR[r.urgency_level ?? ''] ?? '#F59E0B',
    r => `${(r.urgency_level ?? '').charAt(0).toUpperCase() + (r.urgency_level ?? '').slice(1)} Alert`,
    r => r.state,
    r => r.location_name,
  );
}

function buildDiseaseMarkers(data: DiseaseRow[]): MapMarker[] {
  return groupByDistrict(
    data,
    r => r.district,
    _r => LAYER_COLOR.disease,
    r => r.disease_name ?? '',
    r => r.state,
  );
}

function buildWaterMarkers(data: WaterRow[]): MapMarker[] {
  return groupByDistrict(
    data,
    r => r.district,
    _r => LAYER_COLOR.water,
    r => r.overall_quality ?? 'Water Report',
    r => r.state,
  );
}

function buildCampaignMarkers(data: CampaignRow[]): MapMarker[] {
  // campaigns table has no lat/lon columns — use district centroid only
  return groupByDistrict(
    data,
    r => r.district,
    _r => LAYER_COLOR.campaigns,
    r => (r.campaign_type ?? '').replace(/_/g, ' '),
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

// ── Leaflet HTML ──────────────────────────────────────
function buildLeafletHtml(markers: MapMarker[], activeLayer: Layer, userLat?: number, userLon?: number): string {
  const markersJs = JSON.stringify(markers);
  const activeLayerJs = JSON.stringify(activeLayer);
  const hasUserCoords = Number.isFinite(userLat) && Number.isFinite(userLon);
  const userJs = hasUserCoords ? `[${userLat},${userLon}]` : 'null';
  const initView = hasUserCoords
    ? `[${userLat},${userLon}],9`
    : '[20.5937,78.9629],5';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#0a0a0a;}
  #map{width:100%;height:100vh;}
  .legend{background:rgba(15,15,15,0.9);border-radius:8px;padding:8px 12px;font-size:11px;color:#e5e7eb;border:1px solid #374151;max-width:160px;}
  .li{display:flex;align-items:center;gap:6px;margin:3px 0;}
  .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
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
  zoomControl: true
}).setView(${initView});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  maxZoom: 13,
  maxNativeZoom: 12,
  subdomains: 'abcd',
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1
}).addTo(map);

// City labels only (lightweight second layer)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  maxZoom: 13, maxNativeZoom: 12, subdomains: 'abcd',
  updateWhenIdle: true, updateWhenZooming: false
}).addTo(map);

var markers = ${markersJs};
var activeLayer = ${activeLayerJs};
var userPos = ${userJs};
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
var colorLabels = {
  '#DC2626':'Critical','#EA580C':'High','#F59E0B':'Medium','#10B981':'Low',
  '#EF4444':'Disease','#3B82F6':'Water','#10B981':'Campaign','#7C3AED':'Multi-type'
};

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
  L.circleMarker([m.lat, m.lon], {
    radius: 10 + Math.min(m.count * 2, 14),
    color: m.color, fillColor: m.color,
    fillOpacity: 0.72, opacity: 0.98, weight: 2.4
  }).addTo(map).bindPopup(
    '<b style="font-size:13px">' + safeDistrict + '</b><br/>' +
    '<span style="font-size:12px">' + safeLabel + '</span><br/>' +
    '<span style="font-size:11px;color:#666">' + safeCount + ' record' + (m.count>1?'s':'') + '</span>'
  );
  seenColors[m.color] = colorLabels[m.color] || 'Data';
});

if (userPos) {
  boundsPoints.push(userPos);
  L.circle(userPos, {
    radius: 9000,
    color: '#3B82F6',
    weight: 1,
    opacity: 0.85,
    fillColor: '#3B82F6',
    fillOpacity: 0.12,
  }).addTo(map);
  var icon = L.divIcon({
    html: '<div style="width:18px;height:18px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 0 12px rgba(59,130,246,0.95)"></div>',
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
if(!Object.keys(seenColors).length) legendHtml += '<span style="color:#9ca3af">No data</span>';
legendHtml += '</div>';
var leg = L.control({position:'bottomright'});
leg.onAdd = function(){ var d=L.DomUtil.create('div'); d.innerHTML=legendHtml; return d; };
leg.addTo(map);
</script>
</body>
</html>`;
}

// ── WebMap iframe ─────────────────────────────────────
function WebMap({ html, height }: { html: string; height: number | string }) {
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
  { id:'alerts',    label:'Alerts',    icon:'warning'   },
  { id:'disease',   label:'Disease',   icon:'fitness'   },
  { id:'water',     label:'Water',     icon:'water'     },
  { id:'campaigns', label:'Campaigns', icon:'megaphone' },
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
  const { colors } = useTheme();
  const [activeLayer, setActiveLayer] = useState<Layer>('alerts');
  const [diseaseData,  setDiseaseData]  = useState<DiseaseRow[]>([]);
  const [waterData,    setWaterData]    = useState<WaterRow[]>([]);
  const [campaignData, setCampaignData] = useState<CampaignRow[]>([]);
  const [alertLayerData, setAlertLayerData] = useState<AlertLayerRow[]>([]);
  const [loadingData,  setLoadingData]  = useState(false);

  useEffect(() => {
    if (alerts.length && !alertLayerData.length) {
      setAlertLayerData(alerts as AlertLayerRow[]);
    }
  }, [alerts, alertLayerData.length]);

  const fetchLayerData = useCallback(async () => {
    setLoadingData(true);
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

      if (d.error) {
        console.error('Failed to load disease layer data:', d.error);
      } else if (d.data) {
        setDiseaseData(d.data);
      }

      if (w.error) {
        console.error('Failed to load water layer data:', w.error);
      } else if (w.data) {
        setWaterData(w.data);
      }

      if (c.error) {
        console.error('Failed to load campaign layer data:', c.error);
      } else if (c.data) {
        setCampaignData(c.data);
      }

    } catch (error) {
      console.error('Unexpected layer fetch error:', error);
    } finally {
      setLoadingData(false);
    }
  }, []);

  const fetchAlertLayerData = useCallback(async () => {
    setLoadingData(true);
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
      } else if (data) {
        setAlertLayerData(filterAlertsForProfile(data as unknown as AlertLayerRow[], profile));
      }
    } catch (error) {
      console.error('Unexpected alert layer fetch error:', error);
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
      case 'alerts':    return buildAlertMarkers(alertSource);
      case 'disease':   return buildDiseaseMarkers(diseaseData);
      case 'water':     return buildWaterMarkers(waterData);
      case 'campaigns': return buildCampaignMarkers(campaignData);
    }
  }, [activeLayer, alertSource, diseaseData, waterData, campaignData]);

  const html = React.useMemo(
    () => buildLeafletHtml(markers, activeLayer, userLat, userLon),
    [markers, activeLayer, userLat, userLon]
  );

  const accentColor = LAYER_COLOR[activeLayer];

  const reportItems = React.useMemo(() => {
    if (activeLayer === 'disease') {
      return diseaseData.filter(item => item.disease_name).slice(0, 8);
    }
    if (activeLayer === 'water') {
      return waterData.filter(item => item.source_name).slice(0, 8);
    }
    return [];
  }, [activeLayer, diseaseData, waterData]);

  const showReportOverlay = (activeLayer === 'disease' || activeLayer === 'water') && reportItems.length > 0;
  const showAlertOverlay = !!isExpanded && activeLayer === 'alerts' && alertSource.length > 0;
  const alertItems = React.useMemo(() => alertSource.slice(0, 8), [alertSource]);

  return (
    <View style={{ flex: 1 }}>
      <View style={[mp.mapFrame, isExpanded && mp.mapFrameExpanded]}>
        {/* Map — WebView on native, iframe on web */}
        <WebMap html={html} height={isExpanded ? '100%' : (IS_MOBILE ? 250 : 195)} />
        {showAlertOverlay && (
          <View style={[mp.alertOverlay, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[mp.alertOverlayTitle, { color: colors.text }]}>Alerts</Text>
            <ScrollView style={mp.alertList} showsVerticalScrollIndicator={false}>
              {alertItems.map((item, index) => {
                const urgency = (item.urgency_level ?? '').toLowerCase();
                const badgeColor = URGENCY_COLOR[urgency] ?? '#F59E0B';
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
                      <View style={[mp.alertBadge, { backgroundColor: badgeColor + '22' }]}> 
                        <Text style={[mp.alertBadgeText, { color: badgeColor }]}> 
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
          <View style={[mp.reportOverlay, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[mp.reportOverlayTitle, { color: colors.text }]}>
              {activeLayer === 'disease' ? 'Disease reports' : 'Water reports'}
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
                  >
                    <Text style={[mp.reportLink, { color: LAYER_COLOR[activeLayer] }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={LAYER_COLOR[activeLayer]} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Layer chips */}
      <View style={[mp.filterBar, isExpanded ? mp.filterBarExpanded : mp.filterBarInline]}>
        <View style={mp.filterContent}>
          {LAYERS.map(l => (
            <TouchableOpacity
              key={l.id}
              style={[mp.chip, {
                backgroundColor: activeLayer === l.id ? LAYER_COLOR[l.id] : colors.background,
                borderColor: LAYER_COLOR[l.id],
              }]}
              onPress={() => { setActiveLayer(l.id); }}
            >
              <Ionicons name={l.icon as any} size={IS_MOBILE ? 14 : 11} color={activeLayer === l.id ? '#fff' : LAYER_COLOR[l.id]} />
              <Text style={[mp.chipTxt, { color: activeLayer === l.id ? '#fff' : LAYER_COLOR[l.id] }]}>{l.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[mp.chip, { backgroundColor: colors.background, borderColor: '#3B82F6' }]} onPress={onRequestLocate} disabled={locating}>
            {locating
              ? <ActivityIndicator size="small" color="#3B82F6" />
              : <><Ionicons name="locate" size={IS_MOBILE ? 14 : 11} color="#3B82F6" /><Text style={[mp.chipTxt, { color:'#3B82F6' }]}>GPS</Text></>
            }
          </TouchableOpacity>
        </View>
        {loadingData && <ActivityIndicator size="small" color={accentColor} style={{ marginTop: 6, alignSelf: 'center' }} />}
      </View>

      {/* Native fallback if WebView unavailable */}
      {Platform.OS !== 'web' && !WebViewComponent && (
        <View style={[mp.nativeFallback, { backgroundColor: colors.background, height: isExpanded ? 400 : 195 }]}>
          <Ionicons name="map" size={28} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, textAlign:'center' }}>
            {markers.length} district{markers.length !== 1 ? 's' : ''} with {activeLayer} data
          </Text>
          {markers.slice(0, 4).map((m, i) => (
            <View key={i} style={{ flexDirection:'row', alignItems:'center', gap:6, marginTop:4 }}>
              <View style={{ width:8, height:8, borderRadius:4, backgroundColor:m.color }} />
              <Text style={{ color:colors.text, fontSize:11 }}>{m.district} ({m.count})</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const IS_MOBILE = Platform.OS !== 'web';

const mp = StyleSheet.create({
  mapFrame: { position: 'relative', overflow: 'hidden' },
  mapFrameExpanded: { flex: 1, minHeight: 0 },
  filterBar: { marginTop: 8, marginBottom: 2 },
  filterBarInline: { minHeight: 42 },
  filterBarExpanded: { minHeight: 52 },
  filterContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  chip: {
    flexDirection:'row',
    alignItems:'center',
    justifyContent: 'center',
    gap: IS_MOBILE ? 5 : 4,
    minHeight: 34,
    maxHeight: 34,
    minWidth: IS_MOBILE ? 94 : 86,
    paddingHorizontal: IS_MOBILE ? 10 : 9,
    borderRadius: 17,
    borderWidth:1.5,
  },
  chipTxt:     { fontSize: IS_MOBILE ? 12 : 11, fontWeight:'700' },
  nativeFallback: { alignItems:'center', justifyContent:'center', borderRadius:10 },
  reportOverlay: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    maxWidth: IS_MOBILE ? 170 : 200,
    maxHeight: IS_MOBILE ? 140 : 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  reportOverlayTitle: { fontSize: 11, fontWeight: '800', marginBottom: 6 },
  reportList: { maxHeight: IS_MOBILE ? 110 : 130 },
  reportItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingVertical: 4 },
  reportLink: { fontSize: 11, fontWeight: '700', textDecorationLine: 'underline', flex: 1 },
  alertOverlay: {
    position: 'absolute',
    left: 8,
    top: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
    maxWidth: IS_MOBILE ? 190 : 220,
    maxHeight: IS_MOBILE ? 140 : 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  alertOverlayTitle: { fontSize: 11, fontWeight: '800', marginBottom: 6 },
  alertList: { maxHeight: IS_MOBILE ? 110 : 130 },
  alertItem: { paddingVertical: 4 },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alertTitleText: { fontSize: 11, fontWeight: '700', flex: 1 },
  alertMeta: { fontSize: 10, marginTop: 2 },
  alertBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  alertBadgeText: { fontSize: 9, fontWeight: '700' },
});

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
  const { colors, isDark } = useTheme();
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

  const accentColor = '#3B82F6';

  return (
    <>
      {/* ── Web-only fallback modal for location alerts ── */}
      <Modal
        visible={Platform.OS === 'web' && !!webLocationAlert}
        transparent
        animationType="fade"
        onRequestClose={() => setWebLocationAlert(null)}
      >
        <View style={s.popupOverlay}>
          <View style={[s.popup, {
            backgroundColor: isDark ? 'rgba(10,10,10,0.97)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(59,130,246,0.3)',
          }, Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}]}>
            <View style={[s.popupIconWrap, { backgroundColor: '#3B82F618' }]}>
              <Ionicons name="information-circle" size={32} color="#3B82F6" />
            </View>
            <Text style={[s.popupTitle, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>
              {webLocationAlert?.title}
            </Text>
            <Text style={[s.popupBody, { color: isDark ? '#94A3B8' : '#64748B' }]}>
              {webLocationAlert?.message}
            </Text>
            <TouchableOpacity style={s.popupAllow} onPress={() => setWebLocationAlert(null)}>
              <LinearGradient
                colors={['#3B82F6', '#2563EB']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.popupAllowGrad}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>OK</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Location permission — MODAL POPUP on first load ── */}
      <Modal visible={showLocPrompt} transparent animationType="fade" onRequestClose={() => setShowLocPrompt(false)}>
        <View style={s.popupOverlay}>
          <View style={[s.popup, {
            backgroundColor: isDark ? 'rgba(10,10,10,0.97)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(59,130,246,0.3)',
          }, Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}]}>
            {isDark && (
              <LinearGradient
                colors={['rgba(59,130,246,0.08)', 'rgba(0,0,0,0)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            )}
            <View style={[s.popupIconWrap, { backgroundColor: '#3B82F618' }]}>
              <Ionicons name="location" size={32} color="#3B82F6" />
            </View>
            <Text style={[s.popupTitle, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>Enable Location</Text>
            <Text style={[s.popupBody, { color: isDark ? '#94A3B8' : '#64748B' }]}>
              Allow HealthDrop to center the map on your location so you see health alerts in your area first.
            </Text>
            <View style={s.popupActions}>
              <TouchableOpacity style={[s.popupDismiss, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : '#E2E8F0' }]} onPress={() => setShowLocPrompt(false)}>
                <Text style={{ color: isDark ? '#94A3B8' : '#64748B', fontSize: 14, fontWeight: '600' }}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.popupAllow} onPress={() => { setShowLocPrompt(false); requestGPS(); }}>
                <LinearGradient
                  colors={['#3B82F6', '#2563EB']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={s.popupAllowGrad}
                >
                  <Ionicons name="locate" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Allow Location</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Section heading — styled like QuickActions/Section in DashboardShared ── */}
      <View style={[s.sectionHeader, { marginHorizontal: 16, marginTop: 8, marginBottom: 6 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[s.sectionIconWrap, { backgroundColor: '#F59E0B18' }]}>
            <Ionicons name="alert-circle" size={15} color="#F59E0B" />
          </View>
          <Text style={[s.sectionTitle, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>Alerts &amp; Map</Text>
          {alerts.length > 0 && (
            <View style={[s.alertCountBadge, { backgroundColor: '#F59E0B22' }]}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#F59E0B' }}>{alerts.length}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Side-by-side row ── */}
      <View style={s.row}>
        {/* ── Left: Map ── */}
        <View style={[s.mapPanel, { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' }]}>
          {isDark && (
            <LinearGradient
              colors={['rgba(59,130,246,0.06)', 'rgba(0,0,0,0)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          <View style={s.panelHeader}>
            <Ionicons name="map" size={13} color={accentColor} />
            <Text style={[s.panelTitle, { color: colors.text }]}>Health Map</Text>
          </View>
          <View style={{ flex: 1, position: 'relative' }}>
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
              <View style={[s.inlineMapPaused, { backgroundColor: colors.background, borderColor: colors.border }]}> 
                <Ionicons name="expand" size={18} color="#3B82F6" />
                <Text style={[s.inlineMapPausedText, { color: colors.textSecondary }]}>Map opened in full screen</Text>
              </View>
            )}
            <TouchableOpacity
              style={[s.mapExpandFab, { backgroundColor: '#0B1220CC', borderColor: '#3B82F6' }]}
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel="Expand map"
            >
              <Ionicons name="expand" size={18} color="#3B82F6" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Right: Alerts ── */}
        <View style={[s.alertPanel, { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' }]}>
          {isDark && (
            <LinearGradient
              colors={['rgba(245,158,11,0.05)', 'rgba(0,0,0,0)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          <View style={s.panelHeader}>
            <Ionicons name="warning" size={13} color="#F59E0B" />
            <Text style={[s.panelTitle, { color: colors.text }]}>{alertSectionTitle}</Text>
            <View style={[s.countBadge, { backgroundColor: alerts.length > 0 ? '#F59E0B22' : colors.background }]}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: alerts.length > 0 ? '#F59E0B' : colors.textSecondary }}>{alerts.length}</Text>
            </View>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            onLayout={(e) => setAlertsViewportHeight(e.nativeEvent.layout.height)}
            onContentSizeChange={(_, h) => setAlertsContentHeight(h)}
          >
            {alerts.length === 0
              ? <EmptyState icon="checkmark-circle-outline" color="#10B981" title={emptyTitle} subtitle={emptySubtitle} />
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
            <TouchableOpacity style={[s.readMoreBtn, { borderColor: colors.border, backgroundColor: colors.background }]} onPress={onViewAllAlerts}>
              <Text style={[s.readMoreText, { color: '#F59E0B' }]}>Read more alerts</Text>
              <Ionicons name="chevron-forward" size={14} color="#F59E0B" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Full-screen modal ── */}
      {expanded && (
        <Modal
          visible
          animationType="fade"
          presentationStyle="fullScreen"
          statusBarTranslucent={Platform.OS === 'android'}
          onRequestClose={() => setExpanded(false)}
        >
          <View style={[
            s.modal,
            { backgroundColor: isDark ? '#0a0a0a' : '#f1f5f9' },
            Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}
          ]}>
            {/* Modal header */}
            <View style={[s.modalHeader, { backgroundColor: isDark ? '#111' : '#fff', borderBottomColor: colors.border }]}> 
              <TouchableOpacity onPress={() => setExpanded(false)} style={s.closeBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={[s.modalTitle, { color: colors.text }]}>Health Map</Text>
              <TouchableOpacity style={[s.iconBtn, { backgroundColor: '#3B82F632' }]} onPress={requestGPS} disabled={locating}>
                {locating ? <ActivityIndicator size="small" color="#3B82F6" /> : <Ionicons name="locate" size={16} color="#3B82F6" />}
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
  // Section heading
  sectionHeader:    { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  sectionIconWrap:  { width:28, height:28, borderRadius:8, alignItems:'center', justifyContent:'center' },
  sectionTitle:     { fontSize:15, fontWeight:'800', letterSpacing:-0.2 },
  alertCountBadge:  { paddingHorizontal:7, paddingVertical:2, borderRadius:8, minWidth:22, alignItems:'center' },
  // Location permission popup (centered modal)
  popupOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.70)', alignItems:'center', justifyContent:'center', padding:24 },
  popup:        { borderRadius:20, borderWidth:1, padding:28, width:'100%', maxWidth:360, alignItems:'center', overflow:'hidden' },
  popupIconWrap:{ width:64, height:64, borderRadius:20, alignItems:'center', justifyContent:'center', marginBottom:16 },
  popupTitle:   { fontSize:19, fontWeight:'800', marginBottom:8, textAlign:'center' },
  popupBody:    { fontSize:13, lineHeight:20, textAlign:'center', marginBottom:24 },
  popupActions: { flexDirection:'row', gap:12, width:'100%' },
  popupDismiss: { flex:1, borderWidth:1, borderRadius:12, paddingVertical:13, alignItems:'center', justifyContent:'center' },
  popupAllow:   { flex:1.5, borderRadius:12, overflow:'hidden' },
  popupAllowGrad:{ paddingVertical:13, paddingHorizontal:16, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },

  // Side-by-side row (stacks vertically on mobile)
  row:        { flexDirection: IS_MOBILE ? 'column' : 'row', marginHorizontal:16, marginBottom:12, minHeight: IS_MOBILE ? undefined : 280 },
  mapPanel:   {
    flex: IS_MOBILE ? undefined : 1.1,
    padding: IS_MOBILE ? 12 : 10,
    minWidth:0,
    minHeight: IS_MOBILE ? 320 : undefined,
    borderWidth: 1,
    borderRadius: 16,
    marginBottom: IS_MOBILE ? 10 : 0,
    marginRight: IS_MOBILE ? 0 : 10,
  },
  alertPanel: {
    flex: IS_MOBILE ? undefined : 1,
    padding: IS_MOBILE ? 12 : 10,
    minWidth:0,
    minHeight: IS_MOBILE ? 200 : undefined,
    maxHeight: IS_MOBILE ? 300 : undefined,
    borderWidth: 1,
    borderRadius: 16,
  },
  panelHeader:{ flexDirection:'row', alignItems:'center', gap:5, marginBottom:8 },
  panelTitle: { fontSize:13, fontWeight:'700', flex:1 },
  countBadge: { minWidth:20, height:20, borderRadius:10, alignItems:'center', justifyContent:'center', paddingHorizontal:4 },
  inlineMapPaused: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  inlineMapPausedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  mapExpandFab: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  readMoreBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  readMoreText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Full-screen modal
  modal:       { flex:1 },
  modalHeader: { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:10, paddingTop:Platform.OS==='ios'?52:12, borderBottomWidth:1, gap:8 },
  modalTitle:  { flex:1, fontSize:16, fontWeight:'700', textAlign:'center' },
  closeBtn:    { width:36, height:36, borderRadius:18, alignItems:'center', justifyContent:'center' },
  iconBtn:     { width:32, height:32, borderRadius:16, alignItems:'center', justifyContent:'center' },
});

// Keep old default export for backward compat (unused now — dashboards use MapAndAlertsSection)
export const HealthMapComponent = MapAndAlertsSection;
export default MapAndAlertsSection;
