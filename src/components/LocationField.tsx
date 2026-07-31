// src/components/LocationField.tsx
//
// Drop-in location component that:
//  1. Auto-fetches GPS on mount
//  2. Reverse-geocodes to show address, district, state
//  3. Lets user edit district/state/location_name manually
//  4. Passes coords + address data back to parent via onChange
//
// "Prakash" restyle: token-driven, Ionicons only, inline
// validation messages (no Alert.alert), labels above fields.
//
// District registry suggestions: typing ≥2 chars in District or
// State shows up to 6 canonical "District, State" rows from
// public.districts; tapping one fills BOTH fields. Free text
// stays valid — the registry steers, it never gates — and the
// list degrades silently to nothing when the lookup fails.

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Theme } from '../../lib/ThemeContext';
import { useLocation } from '../hooks/useLocation';
import { districtsService, DistrictEntry } from '../../lib/services/districts';

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
  const { colors } = useTheme();
  const { coords, address, status, errorMsg, requestLocation, setManual, clearLocation, skip } =
    useLocation(autoFetch);

  const [isManualCoords, setIsManualCoords] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [latError, setLatError] = useState<string | null>(null);
  const [lngError, setLngError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // ── Registry suggestions state ─────────────────────────────────────────
  // Which text field the open suggestion list belongs to. Deliberately NOT
  // closed on blur: in forms without keyboardShouldPersistTaps the tap that
  // dismisses the keyboard blurs the input first, and a blur-close would
  // eat the row tap. The list closes on pick, on <2 chars, on GPS autofill,
  // or when another field gains focus.
  const [suggestField, setSuggestField] = useState<'district' | 'state' | null>(null);
  const [suggestions, setSuggestions] = useState<DistrictEntry[]>([]);
  // The steering caption shows only the first time the list appears.
  const [hintRetired, setHintRetired] = useState(false);
  const searchSeq = useRef(0);
  const listWasVisible = useRef(false);

  const suggestionsVisible = suggestField !== null && suggestions.length > 0;
  useEffect(() => {
    if (listWasVisible.current && !suggestionsVisible) setHintRetired(true);
    listWasVisible.current = suggestionsVisible;
  }, [suggestionsVisible]);

  const closeSuggestions = () => {
    searchSeq.current++; // invalidate any in-flight search
    setSuggestField(null);
    setSuggestions([]);
  };

  const runSuggestions = (field: 'district' | 'state', text: string) => {
    if (text.trim().length < 2) {
      closeSuggestions();
      return;
    }
    const id = ++searchSeq.current;
    setSuggestField(field);
    districtsService
      .search(text)
      .then((rows) => {
        if (searchSeq.current !== id) return;
        setSuggestions(rows.slice(0, 6));
      })
      .catch(() => {
        // Service already degrades to [] — this is belt-and-braces.
        if (searchSeq.current === id) setSuggestions([]);
      });
  };

  const applySuggestion = (entry: DistrictEntry) => {
    onChange({ ...value, district: entry.district, state: entry.state });
    closeSuggestions();
  };

  // Sync GPS + geocoded result back to parent
  useEffect(() => {
    if (coords && (status === 'success' || status === 'manual')) {
      // Fields were just filled programmatically — drop any open list.
      closeSuggestions();
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
    let hasError = false;
    if (isNaN(lat) || lat < -90 || lat > 90) {
      setLatError('Enter a number between -90 and 90.');
      hasError = true;
    } else {
      setLatError(null);
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      setLngError('Enter a number between -180 and 180.');
      hasError = true;
    } else {
      setLngError(null);
    }
    if (hasError) return;
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

  const inputStyle = (fieldKey: string, error?: string | null) => ([
    styles.fieldInput,
    {
      backgroundColor: colors.inputBackground,
      borderColor: colors.inputBorder,
      color: colors.text,
    },
    focusedField === fieldKey && { borderColor: colors.inputFocusBorder, borderWidth: 2 },
    !!error && { borderColor: colors.inputErrorBorder, borderWidth: 2 },
  ]);

  // ── Registry suggestion list (renders under District / State) ──────────

  const renderSuggestions = (field: 'district' | 'state') => {
    if (suggestField !== field || suggestions.length === 0) return null;
    return (
      <View style={[styles.suggestBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {suggestions.map((entry, i) => (
          <TouchableOpacity
            key={entry.id}
            style={[styles.suggestRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}
            onPress={() => applySuggestion(entry)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${entry.district}, ${entry.state}`}
          >
            <Text style={[styles.suggestText, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {entry.district}
              <Text style={[styles.suggestState, { color: colors.textSecondary }]}>, {entry.state}</Text>
            </Text>
          </TouchableOpacity>
        ))}
        {!hintRetired && (
          <Text
            style={[styles.suggestHint, { color: colors.textSecondary, borderTopColor: colors.borderLight }]}
            maxFontSizeMultiplier={1.3}
          >
            Pick from the list when you can — it keeps your reports on the district map
          </Text>
        )}
      </View>
    );
  };

  // ── Status badge ────────────────────────────────────────────────────────

  const renderStatusBadge = () => {
    const badges: Record<string, { icon: keyof typeof Ionicons.glyphMap; text: string; fg: string; bg: string; loading?: boolean }> = {
      requesting: { icon: 'lock-closed-outline',   text: 'Requesting permission…', fg: colors.textSecondary, bg: colors.surfaceVariant, loading: true },
      fetching:   { icon: 'locate-outline',        text: 'Getting GPS location…',  fg: colors.info,          bg: colors.infoBg,         loading: true },
      geocoding:  { icon: 'search-outline',        text: 'Resolving address…',     fg: colors.info,          bg: colors.infoBg,         loading: true },
      denied:     { icon: 'lock-closed-outline',   text: 'Permission denied',      fg: colors.danger,        bg: colors.dangerBg },
      error:      { icon: 'cloud-offline-outline', text: 'No GPS signal',          fg: colors.danger,        bg: colors.dangerBg },
      skipped:    { icon: 'remove-circle-outline', text: 'Location skipped',       fg: colors.textSecondary, bg: colors.surfaceVariant },
    };

    if (status === 'success' || status === 'manual') {
      const prefix = status === 'manual' ? 'Manual' : 'GPS';
      const fg = status === 'manual' ? colors.warning : colors.success;
      const bg = status === 'manual' ? colors.warningBg : colors.successBg;
      return (
        <StatusBadge
          icon={status === 'manual' ? 'create-outline' : 'locate-outline'}
          text={`${prefix}: ${coords!.latitude.toFixed(5)}, ${coords!.longitude.toFixed(5)}${
            coords!.accuracy ? ` (±${Math.round(coords!.accuracy)}m)` : ''
          }`}
          fg={fg}
          bg={bg}
        />
      );
    }

    const b = badges[status];
    if (!b) return null;
    return <StatusBadge icon={b.icon} text={b.text} fg={b.fg} bg={b.bg} loading={b.loading} />;
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>LOCATION</Text>

      {/* GPS Status */}
      {renderStatusBadge()}
      {errorMsg ? (
        <View style={styles.inlineErrorRow}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{errorMsg}</Text>
        </View>
      ) : null}

      {/* Address Card — shown after geocoding */}
      {address && (status === 'success' || status === 'manual') && (
        <View style={[styles.addressCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.success }]}>
          <Ionicons name="location-outline" size={18} color={colors.success} />
          <Text style={[styles.addressText, { color: colors.text }]}>{address.formattedAddress}</Text>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {(status === 'idle' || status === 'error' || status === 'denied') && (
          <TouchableOpacity
            style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel={status === 'idle' ? 'Get location' : 'Retry GPS'}
          >
            <Ionicons name="locate-outline" size={16} color={colors.onPrimary} />
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>
              {status === 'idle' ? 'Get Location' : 'Retry GPS'}
            </Text>
          </TouchableOpacity>
        )}
        {(status === 'success' || status === 'manual') && (
          <TouchableOpacity
            style={[styles.btnOutline, { borderColor: colors.inputBorder }]}
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Re-fetch location"
          >
            <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.btnText, { color: colors.text }]}>Re-fetch</Text>
          </TouchableOpacity>
        )}
        {status !== 'skipped' && (
          <TouchableOpacity
            style={[styles.btnOutline, { borderColor: colors.inputBorder }]}
            onPress={() => setIsManualCoords((m) => !m)}
            accessibilityRole="button"
            accessibilityLabel={isManualCoords ? 'Cancel manual coordinates' : 'Enter coordinates manually'}
          >
            <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.btnText, { color: colors.text }]}>
              {isManualCoords ? 'Cancel' : 'Enter Coords'}
            </Text>
          </TouchableOpacity>
        )}
        {status !== 'skipped' && (
          <TouchableOpacity
            style={styles.btnSkip}
            onPress={() => { skip(); clearLocation(); onChange({ ...value, latitude: null, longitude: null }); }}
            accessibilityRole="button"
            accessibilityLabel="Skip GPS"
          >
            <Text style={[styles.btnText, { color: colors.textSecondary }]}>Skip GPS</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Manual coordinate entry — one field per row */}
      {isManualCoords && (
        <View style={[styles.manualBox, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>LATITUDE</Text>
            <TextInput
              style={inputStyle('manualLat', latError)}
              value={manualLat}
              onChangeText={(t) => { setManualLat(t); if (latError) setLatError(null); }}
              onFocus={() => { setFocusedField('manualLat'); closeSuggestions(); }}
              onBlur={() => setFocusedField(null)}
              keyboardType="numeric"
              placeholder="e.g. 25.5941"
              placeholderTextColor={colors.placeholder}
            />
            {latError && (
              <View style={styles.inlineErrorRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{latError}</Text>
              </View>
            )}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>LONGITUDE</Text>
            <TextInput
              style={inputStyle('manualLng', lngError)}
              value={manualLng}
              onChangeText={(t) => { setManualLng(t); if (lngError) setLngError(null); }}
              onFocus={() => { setFocusedField('manualLng'); closeSuggestions(); }}
              onBlur={() => setFocusedField(null)}
              keyboardType="numeric"
              placeholder="e.g. 85.1376"
              placeholderTextColor={colors.placeholder}
            />
            {lngError && (
              <View style={styles.inlineErrorRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={[styles.inlineErrorText, { color: colors.danger }]}>{lngError}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.btnApply, { backgroundColor: colors.primary }]}
            onPress={handleManualCoordsApply}
            accessibilityRole="button"
            accessibilityLabel="Apply coordinates and look up address"
          >
            <Text style={[styles.btnText, { color: colors.onPrimary }]}>Apply &amp; Lookup Address</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Location name field */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>LOCATION NAME *</Text>
        <TextInput
          style={inputStyle('locationName')}
          value={value.locationName}
          onChangeText={(t) => handleFieldChange('locationName', t)}
          onFocus={() => { setFocusedField('locationName'); closeSuggestions(); }}
          onBlur={() => setFocusedField(null)}
          placeholder="Village, ward, or area name"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
        />
      </View>

      {/* District — auto-filled from GPS, editable */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          DISTRICT *{' '}
          {address?.district ? (
            <Text style={[styles.autoFillHint, { color: colors.success }]}>(auto-filled)</Text>
          ) : null}
        </Text>
        <TextInput
          style={inputStyle('district')}
          value={value.district}
          onChangeText={(t) => { handleFieldChange('district', t); runSuggestions('district', t); }}
          onFocus={() => { setFocusedField('district'); runSuggestions('district', value.district); }}
          onBlur={() => setFocusedField(null)}
          placeholder="District name"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
        />
        {renderSuggestions('district')}
      </View>

      {/* State — auto-filled from GPS, editable */}
      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
          STATE *{' '}
          {address?.state ? (
            <Text style={[styles.autoFillHint, { color: colors.success }]}>(auto-filled)</Text>
          ) : null}
        </Text>
        <TextInput
          style={inputStyle('state')}
          value={value.state}
          onChangeText={(t) => { handleFieldChange('state', t); runSuggestions('state', t); }}
          onFocus={() => { setFocusedField('state'); runSuggestions('state', value.state); }}
          onBlur={() => setFocusedField(null)}
          placeholder="State name"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="words"
        />
        {renderSuggestions('state')}
      </View>
    </View>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({
  icon,
  text,
  fg,
  bg,
  loading = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  fg: string;
  bg: string;
  loading?: boolean;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} accessibilityLiveRegion="polite">
      {loading ? (
        <ActivityIndicator size="small" color={fg} style={{ marginRight: 6 }} />
      ) : (
        <Ionicons name={icon} size={16} color={fg} style={{ marginRight: 6 }} />
      )}
      <Text style={[styles.badgeText, { color: fg }]} maxFontSizeMultiplier={1.3}>{text}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  sectionTitle: {
    fontSize: 12, lineHeight: 16, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 12,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start', marginBottom: 8, minHeight: 28,
  },
  badgeText: { fontSize: 13, lineHeight: 18, fontWeight: '700', flexShrink: 1, fontVariant: ['tabular-nums'] },
  inlineErrorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 6, marginBottom: 8,
  },
  inlineErrorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', flex: 1 },
  addressCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderRadius: 12, padding: 12, marginBottom: 12,
    borderWidth: 1, borderLeftWidth: 3, gap: 8,
  },
  addressText: { fontSize: 13, lineHeight: 18, fontWeight: '500', flex: 1 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, minHeight: 48, borderRadius: 12, gap: 6,
  },
  btnOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, paddingHorizontal: 16, minHeight: 48, borderRadius: 12, gap: 6,
  },
  btnSkip: { paddingHorizontal: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  btnApply: {
    paddingHorizontal: 16, minHeight: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', marginTop: 4,
  },
  btnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  manualBox: {
    borderRadius: 12, padding: 12,
    borderWidth: 1, marginBottom: 12,
  },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 13, lineHeight: 18, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6,
  },
  autoFillHint: { fontSize: 12, lineHeight: 16, fontWeight: '600', textTransform: 'none', letterSpacing: 0 },
  fieldInput: {
    borderWidth: 1.5, borderRadius: 12, minHeight: 52,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
  },
  // Registry suggestion list
  suggestBox: { borderWidth: 1, borderRadius: 12, marginTop: 6, overflow: 'hidden' },
  suggestRow: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' },
  suggestText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  suggestState: { fontWeight: '500' },
  suggestHint: {
    fontSize: 12, lineHeight: 16, fontWeight: '600',
    paddingHorizontal: 14, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
