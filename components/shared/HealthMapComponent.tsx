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
  Platform, ActivityIndicator, ScrollView, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import { AlertCard, EmptyState } from '../dashboards/DashboardShared';

// ── Session location cache (persists until reload = logout) ─
let _cachedLat: number | null = null;
let _cachedLon: number | null = null;
let _locationAsked = false;   // have we shown the prompt yet?

function getCachedLocation(): { lat: number; lon: number } | null {
  return _cachedLat !== null && _cachedLon !== null
    ? { lat: _cachedLat, lon: _cachedLon }
    : null;
}

// ── Layer type ────────────────────────────────────────
type Layer = 'alerts' | 'disease' | 'water' | 'campaigns';

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

function fallbackCoords(district?: string | null): [number, number] {
  if (!district) return DISTRICT_CENTROIDS['__default__'];
  const k = district.toLowerCase().trim();
  return DISTRICT_CENTROIDS[k] ?? DISTRICT_CENTROIDS['__default__'];
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
function groupByDistrict(
  rows: any[],
  getDistrict: (r: any) => string,
  getColor:    (r: any) => string,
  getLabel:    (r: any) => string,
  hasCoords = true,
): MapMarker[] {
  const map: Record<string, {
    lats: number[]; lons: number[]; colors: Set<string>;
    labels: string[]; count: number; district: string;
  }> = {};

  rows.forEach(r => {
    const dist = (getDistrict(r) || 'Unknown').toLowerCase().trim();
    if (!map[dist]) map[dist] = { lats: [], lons: [], colors: new Set(), labels: [], count: 0, district: dist };
    map[dist].count++;
    // Use ACTUAL GPS from the record if present and valid (not 0,0 which is default/empty)
    if (hasCoords && r.latitude && r.longitude && !(r.latitude === 0 && r.longitude === 0)) {
      map[dist].lats.push(Number(r.latitude));
      map[dist].lons.push(Number(r.longitude));
    }
    map[dist].colors.add(getColor(r));
    const lbl = getLabel(r);
    if (lbl) map[dist].labels.push(lbl);
  });

  const DEFAULT = DISTRICT_CENTROIDS['__default__'];

  return Object.values(map).map(info => {
    // Average of actual GPS coords if available, else use centroid lookup
    const lat = info.lats.length
      ? info.lats.reduce((a, b) => a + b, 0) / info.lats.length
      : fallbackCoords(info.district)[0];
    const lon = info.lons.length
      ? info.lons.reduce((a, b) => a + b, 0) / info.lons.length
      : fallbackCoords(info.district)[1];

    // Skip markers that landed exactly on the __default__ fallback
    // (means we have no real location data for this district)
    if (lat === DEFAULT[0] && lon === DEFAULT[1]) return null;

    const colorArr = Array.from(info.colors);
    const color = colorArr.length > 1 ? MULTI_COLOR : colorArr[0];

    const uniqueLabels = [...new Set(info.labels)].slice(0, 3).join(', ') || info.district;
    const distPretty = info.district.replace(/\b\w/g, c => c.toUpperCase());

    return { lat, lon, district: distPretty, color, count: info.count, label: uniqueLabels };
  }).filter(Boolean) as MapMarker[];
}

function buildAlertMarkers(alerts: any[]): MapMarker[] {
  return groupByDistrict(
    alerts,
    r => r.district,
    r => URGENCY_COLOR[r.urgency_level] ?? '#F59E0B',
    r => `${(r.urgency_level ?? '').charAt(0).toUpperCase() + (r.urgency_level ?? '').slice(1)} Alert`,
  );
}

function buildDiseaseMarkers(data: any[]): MapMarker[] {
  return groupByDistrict(
    data,
    r => r.district,
    _r => LAYER_COLOR.disease,
    r => r.disease_name ?? '',
  );
}

function buildWaterMarkers(data: any[]): MapMarker[] {
  return groupByDistrict(
    data,
    r => r.district,
    _r => LAYER_COLOR.water,
    r => r.overall_quality ?? 'Water Report',
  );
}

function buildCampaignMarkers(data: any[]): MapMarker[] {
  // campaigns table has no lat/lon columns — use district centroid only
  return groupByDistrict(
    data,
    r => r.district,
    _r => LAYER_COLOR.campaigns,
    r => (r.campaign_type ?? '').replace(/_/g, ' '),
    false,  // hasCoords = false
  );
}

// ── Leaflet HTML ──────────────────────────────────────
function buildLeafletHtml(markers: MapMarker[], userLat?: number, userLon?: number): string {
  const markersJs = JSON.stringify(markers);
  const userJs = (userLat && userLon) ? `[${userLat},${userLon}]` : 'null';
  const initView = (userLat && userLon)
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
var userPos = ${userJs};
var seenColors = {};
var colorLabels = {
  '#DC2626':'Critical','#EA580C':'High','#F59E0B':'Medium','#10B981':'Low',
  '#EF4444':'Disease','#3B82F6':'Water','#10B981':'Campaign','#7C3AED':'Multi-type'
};

markers.forEach(function(m) {
  var r = 20000 + (m.count * 4000);
  L.circleMarker([m.lat, m.lon], {
    radius: 10 + Math.min(m.count * 2, 14),
    color: m.color, fillColor: m.color,
    fillOpacity: 0.5, opacity: 0.9, weight: 2
  }).addTo(map).bindPopup(
    '<b style="font-size:13px">' + m.district + '</b><br/>' +
    '<span style="font-size:12px">' + m.label + '</span><br/>' +
    '<span style="font-size:11px;color:#666">' + m.count + ' record' + (m.count>1?'s':'') + '</span>'
  );
  seenColors[m.color] = colorLabels[m.color] || 'Data';
});

if (userPos) {
  var icon = L.divIcon({
    html: '<div style="width:13px;height:13px;border-radius:50%;background:#3B82F6;border:2px solid #fff;box-shadow:0 0 8px rgba(59,130,246,0.9)"></div>',
    className:'', iconAnchor:[6,6]
  });
  L.marker(userPos, {icon:icon}).addTo(map).bindPopup('<b>Your Location</b>');
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
  alerts: any[];
  userLat?: number;
  userLon?: number;
  onRequestLocate: () => void;
  locating: boolean;
  isExpanded?: boolean;
}

const MapPanel: React.FC<MapPanelProps> = ({
  alerts, userLat, userLon, onRequestLocate, locating, isExpanded,
}) => {
  const { colors } = useTheme();
  const [activeLayer, setActiveLayer] = useState<Layer>('alerts');
  const [diseaseData,  setDiseaseData]  = useState<any[]>([]);
  const [waterData,    setWaterData]    = useState<any[]>([]);
  const [campaignData, setCampaignData] = useState<any[]>([]);
  const [loadingData,  setLoadingData]  = useState(false);

  const fetchLayerData = useCallback(async () => {
    if (diseaseData.length || waterData.length || campaignData.length) return;
    setLoadingData(true);
    try {
      const [d, w, c] = await Promise.all([
        supabase.from('disease_reports')
          .select('district,disease_name,severity,latitude,longitude')
          .eq('approval_status','approved').limit(300),
        supabase.from('water_quality_reports')
          .select('district,overall_quality,latitude,longitude')
          .eq('approval_status','approved').limit(300),
        supabase.from('health_campaigns')
          .select('district,campaign_type,status')
          .eq('status','active').limit(300),
      ]);
      if (d.data) setDiseaseData(d.data);
      if (w.data) setWaterData(w.data);
      if (c.data) setCampaignData(c.data);
    } catch {}
    setLoadingData(false);
  }, [diseaseData, waterData, campaignData]);

  const markers = React.useMemo((): MapMarker[] => {
    switch (activeLayer) {
      case 'alerts':    return buildAlertMarkers(alerts);
      case 'disease':   return buildDiseaseMarkers(diseaseData);
      case 'water':     return buildWaterMarkers(waterData);
      case 'campaigns': return buildCampaignMarkers(campaignData);
    }
  }, [activeLayer, alerts, diseaseData, waterData, campaignData]);

  const html = React.useMemo(
    () => buildLeafletHtml(markers, userLat, userLon),
    [markers, userLat, userLon]
  );

  const accentColor = LAYER_COLOR[activeLayer];

  return (
    <View style={{ flex: 1 }}>
      {/* Layer chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }} contentContainerStyle={{ gap: 5, paddingRight: 4 }}>
        {LAYERS.map(l => (
          <TouchableOpacity
            key={l.id}
            style={[mp.chip, {
              backgroundColor: activeLayer === l.id ? LAYER_COLOR[l.id] : colors.background,
              borderColor: LAYER_COLOR[l.id],
            }]}
            onPress={() => { setActiveLayer(l.id); if (l.id !== 'alerts') fetchLayerData(); }}
          >
            <Ionicons name={l.icon as any} size={10} color={activeLayer === l.id ? '#fff' : LAYER_COLOR[l.id]} />
            <Text style={[mp.chipTxt, { color: activeLayer === l.id ? '#fff' : LAYER_COLOR[l.id] }]}>{l.label}</Text>
          </TouchableOpacity>
        ))}
        {loadingData && <ActivityIndicator size="small" color={accentColor} style={{ marginLeft: 4 }} />}
        <TouchableOpacity style={[mp.chip, { backgroundColor: colors.background, borderColor: '#3B82F6' }]} onPress={onRequestLocate} disabled={locating}>
          {locating
            ? <ActivityIndicator size="small" color="#3B82F6" />
            : <><Ionicons name="locate" size={10} color="#3B82F6" /><Text style={[mp.chipTxt, { color:'#3B82F6' }]}>GPS</Text></>
          }
        </TouchableOpacity>
      </ScrollView>

      {/* Map */}
      {Platform.OS === 'web'
        ? <WebMap html={html} height={isExpanded ? '100%' : 195} />
        : (
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
        )
      }
    </View>
  );
};

const mp = StyleSheet.create({
  chip:        { flexDirection:'row', alignItems:'center', gap:3, paddingHorizontal:8, paddingVertical:4, borderRadius:12, borderWidth:1.5 },
  chipTxt:     { fontSize:10, fontWeight:'700' },
  nativeFallback: { alignItems:'center', justifyContent:'center', borderRadius:10 },
});

// ══════════════════════════════════════════════════════
//  MapAndAlertsSection — EXPORTED — used by dashboards
//  Renders [MAP | ALERTS] side by side
// ══════════════════════════════════════════════════════
interface MapAndAlertsSectionProps {
  profile: Profile;
  alerts: any[];
  alertSectionTitle?: string;
  onAlertPress?: (alert: any) => void;
  emptyTitle?: string;
  emptySubtitle?: string;
}

export const MapAndAlertsSection: React.FC<MapAndAlertsSectionProps> = ({
  profile,
  alerts,
  alertSectionTitle = 'Active Alerts',
  onAlertPress,
  emptyTitle = 'No Active Alerts',
  emptySubtitle = 'All systems are clear.',
}) => {
  const { colors, isDark } = useTheme();
  const [expanded,    setExpanded   ] = useState(false);
  const [userLat,     setUserLat    ] = useState<number | undefined>(getCachedLocation()?.lat);
  const [userLon,     setUserLon    ] = useState<number | undefined>(getCachedLocation()?.lon);
  const [locating,    setLocating   ] = useState(false);
  const [showLocPrompt, setShowLocPrompt] = useState(false);
  const mounted = useRef(false);

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

  const requestGPS = useCallback(async () => {
    setLocating(true);
    try {
      if (Platform.OS === 'web') {
        await new Promise<void>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            pos => {
              _cachedLat = pos.coords.latitude;
              _cachedLon = pos.coords.longitude;
              setUserLat(pos.coords.latitude);
              setUserLon(pos.coords.longitude);
              resolve();
            },
            reject,
            { timeout: 12000 }
          )
        );
      } else {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          _cachedLat = pos.coords.latitude;
          _cachedLon = pos.coords.longitude;
          setUserLat(pos.coords.latitude);
          setUserLon(pos.coords.longitude);
        }
      }
    } catch {}
    setLocating(false);
  }, []);

  const accentColor = '#3B82F6';

  return (
    <>
      {/* ── Location permission — MODAL POPUP on first load ── */}
      <Modal visible={showLocPrompt} transparent animationType="fade" onRequestClose={() => setShowLocPrompt(false)}>
        <View style={s.popupOverlay}>
          <View style={[s.popup, {
            backgroundColor: isDark ? 'rgba(10,10,10,0.97)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(59,130,246,0.3)',
          }]}>
            {isDark && (
              <LinearGradient
                colors={['rgba(59,130,246,0.08)', 'rgba(0,0,0,0)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
            )}
            {/* Icon */}
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
              <TouchableOpacity
                style={s.popupAllow}
                onPress={() => { setShowLocPrompt(false); requestGPS(); }}
              >
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

      {/* ── Side-by-side row ── */}
      <View style={[s.row, { borderColor: colors.border }]}>
        {/* ── Left: Map ── */}
        <View style={[s.mapPanel, { backgroundColor: colors.card, borderRightColor: colors.border, overflow: 'hidden' }]}>
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
          <MapPanel
            profile={profile}
            alerts={alerts}
            userLat={userLat}
            userLon={userLon}
            onRequestLocate={requestGPS}
            locating={locating}
          />
          <TouchableOpacity style={[s.expandBtn, { backgroundColor: accentColor + '18', borderColor: accentColor }]} onPress={() => setExpanded(true)}>
            <Ionicons name="expand" size={12} color={accentColor} />
            <Text style={[s.expandTxt, { color: accentColor }]}>Expand Map</Text>
          </TouchableOpacity>
        </View>

        {/* ── Right: Alerts ── */}
        <View style={[s.alertPanel, { backgroundColor: colors.card, overflow: 'hidden' }]}>
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
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
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
        </View>
      </View>

      {/* ── Full-screen modal ── */}
      <Modal visible={expanded} animationType="fade" onRequestClose={() => setExpanded(false)}>
        <View style={[s.modal, { backgroundColor: isDark ? '#0a0a0a' : '#f1f5f9' }]}>
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
            />
          </View>
        </View>
      </Modal>
    </>
  );
};

const SCREEN_W = Dimensions.get('window').width;

const s = StyleSheet.create({
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

  // Side-by-side row
  row:        { flexDirection:'row', marginHorizontal:16, marginBottom:12, minHeight:280, borderRadius:16, overflow:'hidden', borderWidth:1 },
  mapPanel:   { flex:1.1, padding:10, borderRightWidth:1, minWidth:0 },
  alertPanel: { flex:1, padding:10, minWidth:0 },
  panelHeader:{ flexDirection:'row', alignItems:'center', gap:5, marginBottom:8 },
  panelTitle: { fontSize:13, fontWeight:'700', flex:1 },
  countBadge: { minWidth:20, height:20, borderRadius:10, alignItems:'center', justifyContent:'center', paddingHorizontal:4 },
  expandBtn:  { flexDirection:'row', alignItems:'center', gap:4, justifyContent:'center', borderRadius:8, paddingVertical:5, marginTop:6, borderWidth:1 },
  expandTxt:  { fontSize:11, fontWeight:'600' },

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
