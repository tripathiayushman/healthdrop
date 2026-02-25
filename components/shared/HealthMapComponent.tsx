// =====================================================
// HEALTH MAP COMPONENT
// Interactive Leaflet map (web) / district list (native)
// Shows: Alerts · Disease Reports · Water Reports · Campaigns
// Color-coded by district, layer-switchable, GPS locate-me
// =====================================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';

// ── Types ────────────────────────────────────────────
type Layer = 'alerts' | 'disease' | 'water' | 'campaigns';

interface Props {
  profile: Profile;
  /** Pre-loaded alerts from the parent dashboard (avoid double fetch) */
  alerts?: any[];
  miniHeight?: number;
}

// ── District centroid lookup (major Indian districts) ─
// lat/lon centroids for ~250 major districts
const DISTRICT_CENTROIDS: Record<string, [number, number]> = {
  // Andhra Pradesh
  'visakhapatnam': [17.686, 83.218], 'vijayawada': [16.506, 80.648],
  'guntur': [16.300, 80.436], 'nellore': [14.442, 79.987],
  'kurnool': [15.828, 78.037], 'anantapur': [14.682, 77.600],
  'kadapa': [14.467, 78.822], 'tirupati': [13.628, 79.419],
  // Telangana
  'hyderabad': [17.385, 78.487], 'warangal': [17.977, 79.600],
  'nizamabad': [18.672, 78.094], 'karimnagar': [18.438, 79.128],
  'khammam': [17.247, 80.150], 'nalgonda': [17.056, 79.268],
  'medak': [17.998, 78.258],
  // Maharashtra
  'mumbai': [19.076, 72.877], 'pune': [18.520, 73.856],
  'nagpur': [21.145, 79.088], 'nashik': [19.997, 73.791],
  'aurangabad': [19.876, 75.343], 'solapur': [17.687, 75.906],
  'kolhapur': [16.705, 74.243], 'satara': [17.686, 74.010],
  'thane': [19.218, 72.978], 'amravati': [20.932, 77.749],
  // Karnataka
  'bengaluru': [12.972, 77.594], 'mysuru': [12.295, 76.644],
  'hubli': [15.365, 75.124], 'mangaluru': [12.914, 74.856],
  'belagavi': [15.850, 74.497], 'kalaburagi': [17.328, 76.819],
  'ballari': [15.146, 76.924], 'davanagere': [14.468, 75.921],
  // Tamil Nadu
  'chennai': [13.083, 80.270], 'coimbatore': [11.017, 76.954],
  'madurai': [9.924, 78.119], 'tiruchirappalli': [10.790, 78.706],
  'salem': [11.667, 78.146], 'tirunelveli': [8.730, 77.695],
  'vellore': [12.916, 79.131], 'erode': [11.341, 77.728],
  // Kerala
  'thiruvananthapuram': [8.524, 76.936], 'kochi': [9.931, 76.267],
  'kozhikode': [11.258, 75.776], 'thrissur': [10.527, 76.213],
  'kollam': [8.887, 76.591], 'palakkad': [10.777, 76.652],
  'malappuram': [11.073, 76.073], 'kannur': [11.868, 75.371],
  // Gujarat
  'ahmedabad': [23.033, 72.585], 'surat': [21.170, 72.831],
  'vadodara': [22.307, 73.180], 'rajkot': [22.303, 70.802],
  'bhavnagar': [21.762, 72.152], 'jamnagar': [22.468, 70.058],
  'gandhinagar': [23.223, 72.650], 'junagadh': [21.517, 70.457],
  // Rajasthan
  'jaipur': [26.912, 75.787], 'jodhpur': [26.292, 73.023],
  'kota': [25.182, 75.839], 'bikaner': [28.022, 73.312],
  'ajmer': [26.450, 74.635], 'udaipur': [24.585, 73.712],
  'alwar': [27.564, 76.601], 'bharatpur': [27.215, 77.490],
  // Uttar Pradesh
  'lucknow': [26.847, 80.947], 'kanpur': [26.449, 80.331],
  'agra': [27.177, 78.008], 'varanasi': [25.317, 82.971],
  'allahabad': [25.435, 81.846], 'meerut': [28.984, 77.707],
  'ghaziabad': [28.667, 77.454], 'noida': [28.535, 77.391],
  'bareilly': [28.347, 79.419], 'aligarh': [27.881, 78.081],
  'gorakhpur': [26.760, 83.373], 'mathura': [27.492, 77.673],
  // Madhya Pradesh
  'bhopal': [23.259, 77.412], 'indore': [22.719, 75.857],
  'jabalpur': [23.166, 79.934], 'gwalior': [26.218, 78.182],
  'ujjain': [23.183, 75.772], 'sagar': [23.838, 78.739],
  'rewa': [24.531, 81.296], 'satna': [24.601, 80.831],
  // Bihar
  'patna': [25.594, 85.137], 'gaya': [24.796, 85.007],
  'bhagalpur': [25.240, 86.980], 'muzaffarpur': [26.120, 85.390],
  'darbhanga': [26.152, 85.897], 'purnia': [25.777, 87.473],
  // West Bengal
  'kolkata': [22.573, 88.363], 'howrah': [22.588, 88.304],
  'durgapur': [23.480, 87.320], 'asansol': [23.683, 86.983],
  'siliguri': [26.716, 88.426], 'bardhaman': [23.233, 87.862],
  // Delhi
  'delhi': [28.704, 77.102], 'new delhi': [28.613, 77.209],
  'north delhi': [28.732, 77.168], 'south delhi': [28.527, 77.213],
  'east delhi': [28.659, 77.291], 'west delhi': [28.677, 77.055],
  'central delhi': [28.636, 77.224],
  // Punjab
  'ludhiana': [30.901, 75.857], 'amritsar': [31.634, 74.872],
  'jalandhar': [31.326, 75.576], 'patiala': [30.339, 76.387],
  'bathinda': [30.210, 74.944],
  // Haryana
  'gurugram': [28.459, 77.026], 'faridabad': [28.408, 77.318],
  'ambala': [30.378, 76.778], 'hisar': [29.154, 75.722],
  'rohtak': [28.893, 76.607],
  // Himachal Pradesh
  'shimla': [31.104, 77.173], 'dharamsala': [32.220, 76.324],
  'solan': [30.908, 77.096],
  // Uttarakhand
  'dehradun': [30.316, 78.032], 'haridwar': [29.945, 78.163],
  'nainital': [29.381, 79.463],
  // Jharkhand
  'ranchi': [23.344, 85.310], 'jamshedpur': [22.805, 86.203],
  'dhanbad': [23.800, 86.433],
  // Odisha
  'bhubaneswar': [20.296, 85.822], 'cuttack': [20.463, 85.882],
  'rourkela': [22.260, 84.853],
  // Assam
  'guwahati': [26.144, 91.736], 'silchar': [24.826, 92.798],
  'dibrugarh': [27.480, 94.912],
  // Chhattisgarh
  'raipur': [21.251, 81.630], 'bilaspur': [22.088, 82.144],
  'durg': [21.192, 81.282],
  // Goa
  'panaji': [15.499, 73.826], 'margao': [15.274, 73.958],
  'vasco': [15.398, 73.812],
  // Jammu & Kashmir
  'srinagar': [34.083, 74.797], 'jammu': [32.726, 74.857],
  'anantnag': [33.730, 75.146],
  // Default fallback — India center
  '__default__': [20.593, 78.963],
};

function getDistrictCoords(district?: string | null): [number, number] {
  if (!district) return DISTRICT_CENTROIDS['__default__'];
  const key = district.toLowerCase().trim();
  return DISTRICT_CENTROIDS[key] ?? DISTRICT_CENTROIDS['__default__'];
}

// ── Color Config ─────────────────────────────────────
const ALERT_URGENCY_COLOR: Record<string, string> = {
  critical: '#DC2626',
  high:     '#EA580C',
  medium:   '#D97706',
  low:      '#16A34A',
};
const LAYER_COLORS: Record<Layer, string> = {
  alerts:    '#F59E0B',
  disease:   '#EF4444',
  water:     '#3B82F6',
  campaigns: '#10B981',
};
const MULTI_COLOR = '#7C3AED';

// ── Build Leaflet HTML ───────────────────────────────
function buildLeafletHtml(markers: MapMarker[], userLat?: number, userLon?: number): string {
  const markersJs = JSON.stringify(markers);
  const userJs = userLat && userLon ? `[${userLat},${userLon}]` : 'null';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#111; font-family:sans-serif; }
  #map { width:100%; height:100vh; }
  .legend { background:rgba(17,17,17,0.92); border-radius:8px; padding:8px 12px; font-size:11px; color:#e5e7eb; border:1px solid #374151; }
  .legend-item { display:flex; align-items:center; gap:6px; margin:3px 0; }
  .legend-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl:true, attributionControl:false }).setView([20.5937,78.9629],5);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom:18, subdomains:'abcd'
  }).addTo(map);

  var markers = ${markersJs};
  var userPos = ${userJs};

  // Color to label map
  var colorLabels = {
    '#DC2626':'Critical Alert','#EA580C':'High Alert','#D97706':'Medium Alert',
    '#16A34A':'Low Alert','#EF4444':'Disease Report','#3B82F6':'Water Report',
    '#10B981':'Campaign','#7C3AED':'Multiple Types'
  };
  var seenColors = {};

  markers.forEach(function(m) {
    var circ = L.circle([m.lat, m.lon], {
      color: m.color, fillColor: m.color,
      fillOpacity: 0.45, opacity: 0.9,
      radius: 25000 + (m.count * 5000),
      weight: 2
    }).addTo(map);
    circ.bindPopup(
      '<div style="color:#111;font-size:13px;min-width:140px">' +
        '<strong>' + m.district + '</strong><br/>' +
        m.label + '<br/>' +
        '<span style="font-size:11px;color:#555">' + m.count + ' item' + (m.count>1?'s':'') + '</span>' +
      '</div>'
    );
    seenColors[m.color] = colorLabels[m.color] || m.layer;
  });

  // User location
  if (userPos) {
    var userIcon = L.divIcon({
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#3B82F6;border:2px solid white;box-shadow:0 0 8px rgba(59,130,246,0.8)"></div>',
      className:'', iconAnchor:[7,7]
    });
    L.marker(userPos, {icon:userIcon}).addTo(map).bindPopup('<strong>Your Location</strong>');
    map.setView(userPos, 7);
  }

  // Legend
  var legendHtml = '<div class="legend">';
  Object.keys(seenColors).forEach(function(c) {
    legendHtml += '<div class="legend-item"><div class="legend-dot" style="background:' + c + '"></div>' + seenColors[c] + '</div>';
  });
  if (Object.keys(seenColors).length === 0) {
    legendHtml += '<div style="color:#9ca3af;font-size:11px">No data for this layer</div>';
  }
  legendHtml += '</div>';
  var legend = L.control({position:'bottomright'});
  legend.onAdd = function() { var div=L.DomUtil.create('div'); div.innerHTML=legendHtml; return div; };
  legend.addTo(map);

  // Communication back to React Native (if needed)
  window.addEventListener('message', function(e) {
    try { var d=JSON.parse(e.data); if(d.type==='locate'&&d.lat) map.setView([d.lat,d.lon],10); } catch(x){}
  });
</script>
</body>
</html>`;
}

interface MapMarker {
  lat: number; lon: number; district: string;
  color: string; count: number; label: string; layer: string;
}

// ── Build markers for a given dataset ────────────────
function buildAlertMarkers(alerts: any[]): MapMarker[] {
  const byDistrict: Record<string, { colors: Set<string>; count: number; urgencies: string[] }> = {};
  alerts.forEach(a => {
    const d = (a.district || 'Unknown').toLowerCase();
    if (!byDistrict[d]) byDistrict[d] = { colors: new Set(), count: 0, urgencies: [] };
    byDistrict[d].count++;
    const col = ALERT_URGENCY_COLOR[a.urgency_level] ?? '#D97706';
    byDistrict[d].colors.add(col);
    byDistrict[d].urgencies.push(a.urgency_level ?? 'unknown');
  });
  return Object.entries(byDistrict).map(([dist, info]) => {
    const [lat, lon] = getDistrictCoords(dist);
    const colorArr = Array.from(info.colors);
    const color = colorArr.length > 1 ? MULTI_COLOR : colorArr[0] ?? '#D97706';
    const label = info.urgencies.map(u => u.charAt(0).toUpperCase() + u.slice(1)).join(', ') + ' Alert' + (info.count > 1 ? 's' : '');
    return { lat, lon, district: dist.charAt(0).toUpperCase() + dist.slice(1), color, count: info.count, label, layer: 'alerts' };
  });
}

function buildDiseaseMarkers(data: any[]): MapMarker[] {
  const byDistrict: Record<string, { count: number; names: string[] }> = {};
  data.forEach(r => {
    const d = (r.district || 'Unknown').toLowerCase();
    if (!byDistrict[d]) byDistrict[d] = { count: 0, names: [] };
    byDistrict[d].count++;
    if (r.disease_name) byDistrict[d].names.push(r.disease_name);
  });
  return Object.entries(byDistrict).map(([dist, info]) => {
    const [lat, lon] = getDistrictCoords(dist);
    const unique = [...new Set(info.names)].slice(0, 3);
    return {
      lat, lon, district: dist.charAt(0).toUpperCase() + dist.slice(1),
      color: LAYER_COLORS.disease,
      count: info.count,
      label: unique.join(', ') || 'Disease Reports',
      layer: 'disease',
    };
  });
}

function buildWaterMarkers(data: any[]): MapMarker[] {
  const byDistrict: Record<string, { count: number; qualities: string[] }> = {};
  data.forEach(r => {
    const d = (r.district || 'Unknown').toLowerCase();
    if (!byDistrict[d]) byDistrict[d] = { count: 0, qualities: [] };
    byDistrict[d].count++;
    if (r.overall_quality) byDistrict[d].qualities.push(r.overall_quality);
  });
  return Object.entries(byDistrict).map(([dist, info]) => {
    const [lat, lon] = getDistrictCoords(dist);
    const q = [...new Set(info.qualities)].slice(0, 2).join(', ') || 'Quality Report';
    return {
      lat, lon, district: dist.charAt(0).toUpperCase() + dist.slice(1),
      color: LAYER_COLORS.water, count: info.count, label: q, layer: 'water',
    };
  });
}

function buildCampaignMarkers(data: any[]): MapMarker[] {
  const byDistrict: Record<string, { count: number; types: string[] }> = {};
  data.forEach(r => {
    const d = (r.district || 'Unknown').toLowerCase();
    if (!byDistrict[d]) byDistrict[d] = { count: 0, types: [] };
    byDistrict[d].count++;
    if (r.campaign_type) byDistrict[d].types.push(r.campaign_type.replace(/_/g, ' '));
  });
  return Object.entries(byDistrict).map(([dist, info]) => {
    const [lat, lon] = getDistrictCoords(dist);
    const types = [...new Set(info.types)].slice(0, 2).join(', ') || 'Campaign';
    return {
      lat, lon, district: dist.charAt(0).toUpperCase() + dist.slice(1),
      color: LAYER_COLORS.campaigns, count: info.count, label: types, layer: 'campaigns',
    };
  });
}

// ── Web iframe Map ────────────────────────────────────
function WebMap({ html, height }: { html: string; height: number }) {
  // Render iframe with srcDoc on web
  const ref = React.useRef<any>(null);
  return (
    <View style={{ height, width: '100%' }}>
      <iframe
        ref={ref}
        srcDoc={html}
        style={{ width: '100%', height: '100%', border: 'none' } as any}
        title="HealthMap"
        sandbox="allow-scripts allow-same-origin"
      />
    </View>
  );
}

// ── Native Text Fallback ──────────────────────────────
function NativeDistrictList({ markers, colors }: { markers: MapMarker[]; colors: any }) {
  if (markers.length === 0) {
    return (
      <View style={{ alignItems: 'center', padding: 24 }}>
        <Ionicons name="map-outline" size={36} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary, marginTop: 8, fontSize: 13 }}>No data for this layer</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {markers.map((m, i) => (
        <View key={i} style={[nativeStyles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[nativeStyles.dot, { backgroundColor: m.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{m.district}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{m.label}</Text>
          </View>
          <View style={[nativeStyles.badge, { backgroundColor: m.color + '22' }]}>
            <Text style={{ color: m.color, fontSize: 12, fontWeight: '700' }}>{m.count}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const nativeStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10, borderWidth: 1, gap: 10 },
  dot:   { width: 10, height: 10, borderRadius: 5 },
  badge: { minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});

// ══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════
const LAYERS: { id: Layer; label: string; icon: string }[] = [
  { id: 'alerts',    label: 'Alerts',    icon: 'warning'         },
  { id: 'disease',   label: 'Disease',   icon: 'fitness'         },
  { id: 'water',     label: 'Water',     icon: 'water'           },
  { id: 'campaigns', label: 'Campaigns', icon: 'megaphone'       },
];

export const HealthMapComponent: React.FC<Props> = ({ profile, alerts = [], miniHeight = 210 }) => {
  const { colors, isDark } = useTheme();
  const [activeLayer, setActiveLayer]   = useState<Layer>('alerts');
  const [expanded, setExpanded]         = useState(false);
  const [loadingData, setLoadingData]   = useState(false);
  const [userLat, setUserLat]           = useState<number | undefined>();
  const [userLon, setUserLon]           = useState<number | undefined>();
  const [locating, setLocating]         = useState(false);

  const [diseaseData,   setDiseaseData]   = useState<any[]>([]);
  const [waterData,     setWaterData]     = useState<any[]>([]);
  const [campaignData,  setCampaignData]  = useState<any[]>([]);

  // Build markers from active layer
  const markers = React.useMemo((): MapMarker[] => {
    switch (activeLayer) {
      case 'alerts':    return buildAlertMarkers(alerts);
      case 'disease':   return buildDiseaseMarkers(diseaseData);
      case 'water':     return buildWaterMarkers(waterData);
      case 'campaigns': return buildCampaignMarkers(campaignData);
    }
  }, [activeLayer, alerts, diseaseData, waterData, campaignData]);

  const html = React.useMemo(() => buildLeafletHtml(markers, userLat, userLon), [markers, userLat, userLon]);

  // Fetch non-alert layers lazily on first expand
  const fetchLayerData = useCallback(async () => {
    if (diseaseData.length || waterData.length || campaignData.length) return;
    setLoadingData(true);
    try {
      const [d, w, c] = await Promise.all([
        supabase.from('disease_reports').select('district,disease_name,severity,latitude,longitude').eq('approval_status', 'approved').limit(200),
        supabase.from('water_quality_reports').select('district,overall_quality,latitude,longitude').eq('approval_status', 'approved').limit(200),
        supabase.from('health_campaigns').select('district,campaign_type,status').eq('status', 'active').limit(200),
      ]);
      if (d.data) setDiseaseData(d.data);
      if (w.data) setWaterData(w.data);
      if (c.data) setCampaignData(c.data);
    } catch {}
    setLoadingData(false);
  }, [diseaseData, waterData, campaignData]);

  const handleExpand = () => {
    fetchLayerData();
    setExpanded(true);
  };

  // GPS locate me
  const locateMe = async () => {
    setLocating(true);
    try {
      if (Platform.OS === 'web') {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            pos => { setUserLat(pos.coords.latitude); setUserLon(pos.coords.longitude); resolve(); },
            () => reject(), { timeout: 10000 }
          );
        });
      } else {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserLat(pos.coords.latitude);
          setUserLon(pos.coords.longitude);
        }
      }
    } catch {}
    setLocating(false);
  };

  const accentColor = LAYER_COLORS[activeLayer];

  // ── Legend for native ─────────────────────────────
  const legendItems = React.useMemo(() => {
    const colors_: { color: string; label: string }[] = [];
    if (activeLayer === 'alerts') {
      colors_.push(
        { color: '#DC2626', label: 'Critical' }, { color: '#EA580C', label: 'High' },
        { color: '#D97706', label: 'Medium' }, { color: '#16A34A', label: 'Low' },
        { color: MULTI_COLOR, label: 'Multi-type' },
      );
    } else {
      colors_.push({ color: accentColor, label: LAYERS.find(l => l.id === activeLayer)?.label ?? activeLayer });
    }
    return colors_;
  }, [activeLayer, accentColor]);

  // ── Mini-map card ─────────────────────────────────
  const MapCard = (
    <View style={[m.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={m.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="map" size={15} color={accentColor} />
          <Text style={[m.headerTitle, { color: colors.text }]}>Health Map</Text>
          {loadingData && <ActivityIndicator size="small" color={accentColor} style={{ marginLeft: 4 }} />}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[m.iconBtn, { backgroundColor: accentColor + '22' }]} onPress={locateMe} disabled={locating}>
            {locating
              ? <ActivityIndicator size="small" color={accentColor} />
              : <Ionicons name="locate" size={15} color={accentColor} />
            }
          </TouchableOpacity>
          <TouchableOpacity style={[m.iconBtn, { backgroundColor: accentColor + '22' }]} onPress={handleExpand}>
            <Ionicons name="expand" size={15} color={accentColor} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Layer chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
        {LAYERS.map(l => (
          <TouchableOpacity
            key={l.id}
            style={[m.chip, { backgroundColor: activeLayer === l.id ? LAYER_COLORS[l.id] : colors.background, borderColor: LAYER_COLORS[l.id] }]}
            onPress={() => { setActiveLayer(l.id); if (l.id !== 'alerts') fetchLayerData(); }}
          >
            <Ionicons name={l.icon as any} size={11} color={activeLayer === l.id ? '#fff' : LAYER_COLORS[l.id]} />
            <Text style={[m.chipText, { color: activeLayer === l.id ? '#fff' : LAYER_COLORS[l.id] }]}>{l.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Map area */}
      <TouchableOpacity activeOpacity={0.95} onPress={handleExpand} style={{ borderRadius: 10, overflow: 'hidden' }}>
        {Platform.OS === 'web'
          ? <WebMap html={html} height={miniHeight} />
          : (
            <View style={[m.nativePreview, { backgroundColor: isDark ? '#1a1a1a' : '#f1f5f9', height: miniHeight }]}>
              <Ionicons name="map" size={32} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6 }}>Tap to view full map</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{markers.length} district{markers.length !== 1 ? 's' : ''} with data</Text>
            </View>
          )
        }
      </TouchableOpacity>

      {/* Compact legend */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {legendItems.slice(0, 5).map((li, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: li.color }} />
            <Text style={{ color: colors.textSecondary, fontSize: 10 }}>{li.label}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  // ── Full-screen modal ─────────────────────────────
  return (
    <>
      {MapCard}

      <Modal visible={expanded} animationType="slide" onRequestClose={() => setExpanded(false)}>
        <View style={[m.modal, { backgroundColor: isDark ? '#0a0a0a' : '#f1f5f9' }]}>
          {/* Modal header */}
          <View style={[m.modalHeader, { backgroundColor: isDark ? '#111' : '#fff', borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setExpanded(false)} style={m.closeBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={[m.modalTitle, { color: colors.text }]}>Health Map — India</Text>
            <TouchableOpacity style={[m.iconBtn, { backgroundColor: accentColor + '22' }]} onPress={locateMe} disabled={locating}>
              {locating
                ? <ActivityIndicator size="small" color={accentColor} />
                : <Ionicons name="locate" size={16} color={accentColor} />
              }
            </TouchableOpacity>
          </View>

          {/* Layer chips */}
          <View style={[m.modalLayerBar, { backgroundColor: isDark ? '#111' : '#fff', borderBottomColor: colors.border }]}>
            {LAYERS.map(l => (
              <TouchableOpacity
                key={l.id}
                style={[m.modalChip, { backgroundColor: activeLayer === l.id ? LAYER_COLORS[l.id] : 'transparent', borderColor: LAYER_COLORS[l.id] }]}
                onPress={() => { setActiveLayer(l.id); if (l.id !== 'alerts') fetchLayerData(); }}
              >
                <Ionicons name={l.icon as any} size={13} color={activeLayer === l.id ? '#fff' : LAYER_COLORS[l.id]} />
                <Text style={[m.modalChipTxt, { color: activeLayer === l.id ? '#fff' : LAYER_COLORS[l.id] }]}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Map or native list */}
          <View style={{ flex: 1 }}>
            {Platform.OS === 'web'
              ? <WebMap html={html} height={10000} />  /* flex fills */
              : (
                <ScrollView style={{ flex: 1, padding: 16 }}>
                  <NativeDistrictList markers={markers} colors={colors} />
                  <View style={{ height: 40 }} />
                </ScrollView>
              )
            }
          </View>
        </View>
      </Modal>
    </>
  );
};

const m = StyleSheet.create({
  card:          { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, borderWidth: 1, padding: 12 },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headerTitle:   { fontSize: 14, fontWeight: '700' },
  iconBtn:       { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1.5 },
  chipText:      { fontSize: 11, fontWeight: '600' },
  nativePreview: { alignItems: 'center', justifyContent: 'center', borderRadius: 10 },

  modal:          { flex: 1 },
  modalHeader:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, paddingTop: Platform.OS === 'ios' ? 52 : 12, borderBottomWidth: 1, gap: 8 },
  modalTitle:     { flex: 1, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  closeBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalLayerBar:  { flexDirection: 'row', justifyContent: 'center', gap: 8, padding: 10, borderBottomWidth: 1, flexWrap: 'wrap' },
  modalChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1.5 },
  modalChipTxt:   { fontSize: 13, fontWeight: '600' },
});

export default HealthMapComponent;
