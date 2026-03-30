export const ALERT_RADIUS_KM = 10;

export const RADIUS_SCOPED_ROLES = new Set([
  'district_officer',
  'clinic',
  'asha_worker',
  'volunteer',
]);

export interface RadiusLocation {
  role?: string | null;
  district?: string | null;
  state?: string | null;
  location_name?: string | null;
}

const DISTRICT_CENTROIDS: Record<string, [number, number]> = {
  visakhapatnam: [17.686, 83.218],
  vijayawada: [16.506, 80.648],
  guntur: [16.3, 80.436],
  nellore: [14.442, 79.987],
  kurnool: [15.828, 78.037],
  tirupati: [13.628, 79.419],
  hyderabad: [17.385, 78.487],
  warangal: [17.977, 79.6],
  nizamabad: [18.672, 78.094],
  karimnagar: [18.438, 79.128],
  khammam: [17.247, 80.15],
  nalgonda: [17.056, 79.268],
  mumbai: [19.076, 72.877],
  pune: [18.52, 73.856],
  nagpur: [21.145, 79.088],
  nashik: [19.997, 73.791],
  aurangabad: [19.876, 75.343],
  thane: [19.218, 72.978],
  bengaluru: [12.972, 77.594],
  mysuru: [12.295, 76.644],
  hubli: [15.365, 75.124],
  mangaluru: [12.914, 74.856],
  belagavi: [15.85, 74.497],
  kalaburagi: [17.328, 76.819],
  chengalpattu: [12.6819, 79.9836],
  chengalpet: [12.6819, 79.9836],
  kanchipuram: [12.8342, 79.7036],
  chennai: [13.083, 80.27],
  coimbatore: [11.017, 76.954],
  madurai: [9.924, 78.119],
  tiruchirappalli: [10.79, 78.706],
  salem: [11.667, 78.146],
  tirunelveli: [8.73, 77.695],
  vellore: [12.916, 79.131],
  erode: [11.341, 77.728],
  thanjavur: [10.787, 79.139],
  thiruvananthapuram: [8.524, 76.936],
  kochi: [9.931, 76.267],
  kozhikode: [11.258, 75.776],
  thrissur: [10.527, 76.213],
  kollam: [8.887, 76.591],
  palakkad: [10.777, 76.652],
  ahmedabad: [23.033, 72.585],
  surat: [21.17, 72.831],
  vadodara: [22.307, 73.18],
  rajkot: [22.303, 70.802],
  bhavnagar: [21.762, 72.152],
  jamnagar: [22.468, 70.058],
  gandhinagar: [23.223, 72.65],
  junagadh: [21.517, 70.457],
  jaipur: [26.912, 75.787],
  jodhpur: [26.292, 73.023],
  kota: [25.182, 75.839],
  bikaner: [28.022, 73.312],
  ajmer: [26.45, 74.635],
  udaipur: [24.585, 73.712],
  lucknow: [26.847, 80.947],
  kanpur: [26.449, 80.331],
  agra: [27.177, 78.008],
  varanasi: [25.317, 82.971],
  allahabad: [25.435, 81.846],
  meerut: [28.984, 77.707],
  ghaziabad: [28.667, 77.454],
  noida: [28.535, 77.391],
  bareilly: [28.347, 79.419],
  gorakhpur: [26.76, 83.373],
  mathura: [27.492, 77.673],
  bhopal: [23.259, 77.412],
  indore: [22.719, 75.857],
  jabalpur: [23.166, 79.934],
  gwalior: [26.218, 78.182],
  ujjain: [23.183, 75.772],
  patna: [25.594, 85.137],
  gaya: [24.796, 85.007],
  bhagalpur: [25.24, 86.98],
  muzaffarpur: [26.12, 85.39],
  darbhanga: [26.152, 85.897],
  kolkata: [22.573, 88.363],
  howrah: [22.588, 88.304],
  durgapur: [23.48, 87.32],
  asansol: [23.683, 86.983],
  siliguri: [26.716, 88.426],
  delhi: [28.704, 77.102],
  'new delhi': [28.613, 77.209],
  ludhiana: [30.901, 75.857],
  amritsar: [31.634, 74.872],
  jalandhar: [31.326, 75.576],
  gurugram: [28.459, 77.026],
  faridabad: [28.408, 77.318],
  ambala: [30.378, 76.778],
  shimla: [31.104, 77.173],
  dehradun: [30.316, 78.032],
  ranchi: [23.344, 85.31],
  jamshedpur: [22.805, 86.203],
  bhubaneswar: [20.296, 85.822],
  cuttack: [20.463, 85.882],
  guwahati: [26.144, 91.736],
  silchar: [24.826, 92.798],
  raipur: [21.251, 81.63],
  bilaspur: [22.088, 82.144],
  panaji: [15.499, 73.826],
  margao: [15.274, 73.958],
  srinagar: [34.083, 74.797],
  jammu: [32.726, 74.857],
};

const DISTRICT_ALIASES: Record<string, string> = {
  chengalpattu: 'chengalpattu',
  chengalpet: 'chengalpattu',
  'chengalpattu district': 'chengalpattu',
  chelungpattu: 'chengalpattu',
  chelpungpattu: 'chengalpattu',
  chenglapattu: 'chengalpattu',
  kanchipuram: 'kanchipuram',
  kancheepuram: 'kanchipuram',
  madras: 'chennai',
};

export function normalizePlaceKey(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ district\b/g, '')
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

  for (const [alias, canonical] of Object.entries(DISTRICT_ALIASES)) {
    if (locationKey.includes(alias)) return canonical;
  }

  for (const key of Object.keys(DISTRICT_CENTROIDS)) {
    if (locationKey.includes(key)) return key;
  }

  return null;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(a: [number, number], b: [number, number]): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const lat1 = toRadians(a[0]);
  const lat2 = toRadians(b[0]);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function getDistrictCoords(location: RadiusLocation): [number, number] | null {
  const districtKey = resolveDistrictKey(location.district, location.location_name);
  if (!districtKey) return null;
  return DISTRICT_CENTROIDS[districtKey] ?? null;
}

export function isRadiusScopedRole(role?: string | null): boolean {
  return RADIUS_SCOPED_ROLES.has(String(role ?? '').toLowerCase());
}

export function isWithinAlertRadius(
  alertLocation: RadiusLocation,
  targetLocation: RadiusLocation,
  radiusKm: number = ALERT_RADIUS_KM
): boolean {
  const sourceDistrict = normalizePlaceKey(alertLocation.district);
  const targetDistrict = normalizePlaceKey(targetLocation.district);

  if (!sourceDistrict || !targetDistrict) return false;

  const sourceCanonical = DISTRICT_ALIASES[sourceDistrict] ?? sourceDistrict;
  const targetCanonical = DISTRICT_ALIASES[targetDistrict] ?? targetDistrict;

  if (sourceCanonical === targetCanonical) return true;

  const sourceCoords = getDistrictCoords(alertLocation);
  const targetCoords = getDistrictCoords(targetLocation);

  if (!sourceCoords || !targetCoords) return false;

  return haversineDistanceKm(sourceCoords, targetCoords) <= radiusKm;
}

export function shouldReceiveAlert(
  alertLocation: RadiusLocation,
  userLocation: RadiusLocation,
  radiusKm: number = ALERT_RADIUS_KM
): boolean {
  if (!isRadiusScopedRole(userLocation.role)) return true;
  return isWithinAlertRadius(alertLocation, userLocation, radiusKm);
}

export function filterAlertsForProfile<T extends RadiusLocation>(
  alerts: T[],
  profile: RadiusLocation,
  radiusKm: number = ALERT_RADIUS_KM
): T[] {
  if (!isRadiusScopedRole(profile.role)) return alerts;
  if (!profile.district) return [];
  return alerts.filter((alert) => isWithinAlertRadius(alert, profile, radiusKm));
}
