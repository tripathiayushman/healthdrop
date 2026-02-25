// src/components/LocationField.tsx
//
// Drop-in location component that:
//  1. Auto-fetches GPS on mount
//  2. Reverse-geocodes to show address, district, state
//  3. Lets user edit district/state/location_name manually
//  4. Passes coords + address data back to parent via onChange

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocation, LocationCoords, GeocodedAddress } from '../hooks/useLocation';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LocationData {
  latitude: number | null;
  longitude: number | null;
  locationName: string;
  district: string;
  state: string;
  formattedAddress: string;
}

interface LocationFieldProps {
  /** Current location values (from parent form state) */
  value: LocationData;
  /** Called whenever any location field changes */
  onChange: (data: LocationData) => void;
  /** Auto-trigger GPS fetch on mount */
  autoFetch?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LocationField({
  value,
  onChange,
  autoFetch = true,
}: LocationFieldProps) {
  const { coords, address, status, errorMsg, requestLocation, setManual, clearLocation, skip } =
    useLocation(autoFetch);

  const [isManualCoords, setIsManualCoords] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');

  // Sync GPS + geocoded result back to parent
  useEffect(() => {
    if (coords && (status === 'success' || status === 'manual')) {
      onChange({
        latitude: coords.latitude,
        longitude: coords.longitude,
        // When we have geocoded address, always use it to fill fields
        locationName: address ? address.locationName : value.locationName,
        district: address ? address.district : value.district,
        state: address ? address.state : value.state,
        formattedAddress: address?.formattedAddress || '',
      });
    } else if (status === 'skipped') {
      onChange({ ...value, latitude: null, longitude: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, address, status]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleManualCoordsApply = () => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      Alert.alert('Invalid Latitude', 'Enter a number between -90 and 90.');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      Alert.alert('Invalid Longitude', 'Enter a number between -180 and 180.');
      return;
    }
    setManual(lat, lng);
    setIsManualCoords(false);
  };

  const handleRetry = () => {
    setIsManualCoords(false);
    requestLocation();
  };

  const handleFieldChange = (field: keyof LocationData, val: string) => {
    onChange({ ...value, [field]: val });
  };

  // ── Status badge ────────────────────────────────────────────────────────

  const renderStatusBadge = () => {
    const badges: Record<string, { icon: string; text: string; color: string; loading?: boolean }> = {
      requesting: { icon: 'lock-outline', text: 'Requesting permission…', color: '#888', loading: true },
      fetching:   { icon: 'gps-fixed', text: 'Getting GPS location…', color: '#2196F3', loading: true },
      geocoding:  { icon: 'location-searching', text: 'Resolving address…', color: '#FF9800', loading: true },
      denied:     { icon: 'location-off', text: 'Permission denied', color: '#F44336' },
      error:      { icon: 'signal-wifi-off', text: 'No GPS signal', color: '#F44336' },
      skipped:    { icon: 'location-off', text: 'Location skipped', color: '#888' },
    };

    if (status === 'success' || status === 'manual') {
      const prefix = status === 'manual' ? 'Manual' : 'GPS';
      return (
        <StatusBadge
          icon={status === 'manual' ? 'edit-location' : 'gps-fixed'}
          text={`${prefix}: ${coords!.latitude.toFixed(5)}, ${coords!.longitude.toFixed(5)}${
            coords!.accuracy ? ` (±${Math.round(coords!.accuracy)}m)` : ''
          }`}
          color={status === 'manual' ? '#FF9800' : '#4CAF50'}
        />
      );
    }

    const b = badges[status];
    if (!b) return null;
    return <StatusBadge icon={b.icon as any} text={b.text} color={b.color} loading={b.loading} />;
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>📍 Location</Text>

      {/* GPS Status */}
      {renderStatusBadge()}
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

      {/* Address Card — shown after geocoding */}
      {address && (status === 'success' || status === 'manual') && (
        <View style={styles.addressCard}>
          <MaterialIcons name="place" size={18} color="#4CAF50" />
          <Text style={styles.addressText}>{address.formattedAddress}</Text>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {(status === 'idle' || status === 'error' || status === 'denied') && (
          <TouchableOpacity style={styles.btnPrimary} onPress={handleRetry}>
            <MaterialIcons name="my-location" size={16} color="#fff" />
            <Text style={styles.btnText}>
              {status === 'idle' ? 'Get Location' : 'Retry GPS'}
            </Text>
          </TouchableOpacity>
        )}
        {(status === 'success' || status === 'manual') && (
          <TouchableOpacity style={styles.btnOutline} onPress={handleRetry}>
            <MaterialIcons name="refresh" size={16} color="#2196F3" />
            <Text style={[styles.btnText, { color: '#2196F3' }]}>Re-fetch</Text>
          </TouchableOpacity>
        )}
        {status !== 'skipped' && (
          <TouchableOpacity
            style={styles.btnOutline}
            onPress={() => setIsManualCoords((m) => !m)}
          >
            <MaterialIcons name="edit" size={16} color="#2196F3" />
            <Text style={[styles.btnText, { color: '#2196F3' }]}>
              {isManualCoords ? 'Cancel' : 'Enter Coords'}
            </Text>
          </TouchableOpacity>
        )}
        {status !== 'skipped' && (
          <TouchableOpacity style={styles.btnSkip} onPress={() => { skip(); clearLocation(); onChange({ ...value, latitude: null, longitude: null }); }}>
            <Text style={[styles.btnText, { color: '#888' }]}>Skip GPS</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Manual coordinate entry */}
      {isManualCoords && (
        <View style={styles.manualBox}>
          <View style={styles.manualRow}>
            <View style={styles.manualCol}>
              <Text style={styles.fieldLabel}>Latitude</Text>
              <TextInput
                style={styles.fieldInput}
                value={manualLat}
                onChangeText={setManualLat}
                keyboardType="numeric"
                placeholder="e.g. 25.5941"
                placeholderTextColor="#999"
              />
            </View>
            <View style={[styles.manualCol, { marginLeft: 8 }]}>
              <Text style={styles.fieldLabel}>Longitude</Text>
              <TextInput
                style={styles.fieldInput}
                value={manualLng}
                onChangeText={setManualLng}
                keyboardType="numeric"
                placeholder="e.g. 85.1376"
                placeholderTextColor="#999"
              />
            </View>
          </View>
          <TouchableOpacity style={styles.btnApply} onPress={handleManualCoordsApply}>
            <Text style={styles.btnText}>Apply & Lookup Address</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Location name field */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Location Name *</Text>
        <TextInput
          style={styles.fieldInput}
          value={value.locationName}
          onChangeText={(t) => handleFieldChange('locationName', t)}
          placeholder="Village, ward, or area name"
          placeholderTextColor="#999"
          autoCapitalize="words"
        />
      </View>

      {/* District — auto-filled from GPS, editable */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          District *{' '}
          {address?.district ? (
            <Text style={styles.autoFillHint}>(auto-filled)</Text>
          ) : null}
        </Text>
        <TextInput
          style={styles.fieldInput}
          value={value.district}
          onChangeText={(t) => handleFieldChange('district', t)}
          placeholder="District name"
          placeholderTextColor="#999"
          autoCapitalize="words"
        />
      </View>

      {/* State — auto-filled from GPS, editable */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          State *{' '}
          {address?.state ? (
            <Text style={styles.autoFillHint}>(auto-filled)</Text>
          ) : null}
        </Text>
        <TextInput
          style={styles.fieldInput}
          value={value.state}
          onChangeText={(t) => handleFieldChange('state', t)}
          placeholder="State name"
          placeholderTextColor="#999"
          autoCapitalize="words"
        />
      </View>
    </View>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({
  icon,
  text,
  color,
  loading = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  text: string;
  color: string;
  loading?: boolean;
}) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      {loading ? (
        <ActivityIndicator size="small" color={color} style={{ marginRight: 6 }} />
      ) : (
        <MaterialIcons name={icon} size={16} color={color} style={{ marginRight: 6 }} />
      )}
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 10 },
  badge: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start', marginBottom: 8,
  },
  badgeText: { fontSize: 13, flexShrink: 1 },
  errorText: { color: '#F44336', fontSize: 12, marginBottom: 8, lineHeight: 18 },
  addressCard: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(76,175,80,0.1)',
    borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(76,175,80,0.3)',
  },
  addressText: { fontSize: 13, color: '#E0E0E0', marginLeft: 8, flex: 1, lineHeight: 18 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2196F3',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, gap: 4,
  },
  btnOutline: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2196F3',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, gap: 4,
  },
  btnSkip: { paddingHorizontal: 12, paddingVertical: 8 },
  btnApply: {
    backgroundColor: '#4CAF50', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 6, alignSelf: 'flex-start', marginTop: 8,
  },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  manualBox: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', marginBottom: 12,
  },
  manualRow: { flexDirection: 'row' },
  manualCol: { flex: 1 },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#ccc', marginBottom: 6 },
  autoFillHint: { fontSize: 11, fontWeight: '400', color: '#4CAF50', fontStyle: 'italic' },
  fieldInput: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
