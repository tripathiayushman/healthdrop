// src/hooks/useLocation.ts
//
// Reusable hook for GPS auto-fetch + reverse geocoding.
// After getting coordinates, it calls Expo's reverseGeocodeAsync()
// to resolve the address, district, state, and city.

import { useState, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LocationStatus =
    | 'idle'
    | 'requesting'
    | 'fetching'
    | 'geocoding'     // reverse geocoding in progress
    | 'success'
    | 'manual'
    | 'denied'
    | 'error'
    | 'skipped';

export interface LocationCoords {
    latitude: number;
    longitude: number;
    accuracy: number | null;
}

export interface GeocodedAddress {
    /** Full human-readable address line */
    formattedAddress: string;
    /** Location / area / village name */
    locationName: string;
    /** District / county / subregion */
    district: string;
    /** State / region */
    state: string;
    /** City / town */
    city: string;
    /** Postal code */
    postalCode: string;
    /** Country */
    country: string;
}

export interface UseLocationReturn {
    coords: LocationCoords | null;
    address: GeocodedAddress | null;
    status: LocationStatus;
    errorMsg: string | null;

    requestLocation: () => Promise<void>;
    setManual: (lat: number, lng: number) => void;
    clearLocation: () => void;
    skip: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCATION_OPTIONS: Location.LocationOptions = {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5000,
};

const FETCH_TIMEOUT_MS = 15_000;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLocation(autoFetch = false): UseLocationReturn {
    const [coords, setCoords] = useState<LocationCoords | null>(null);
    const [address, setAddress] = useState<GeocodedAddress | null>(null);
    const [status, setStatus] = useState<LocationStatus>('idle');
    const [errorMsg, setError] = useState<string | null>(null);

    // ── Reverse geocode helper ──────────────────────────────────────────────

    const reverseGeocode = useCallback(async (lat: number, lng: number) => {
        try {
            setStatus('geocoding');

            // Try Expo's built-in reverse geocoding first (works on native)
            let resolved = false;
            try {
                const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                if (results && results.length > 0) {
                    const r = results[0];
                    // Check if we got meaningful data (not just empty strings)
                    if (r.region || r.subregion || r.city) {
                        const parts = [r.name, r.street, r.city, r.subregion, r.region, r.postalCode].filter(Boolean);
                        const uniqueParts = parts.filter((p, i) => i === 0 || p !== parts[i - 1]);
                        const locParts = [r.street || r.name, r.city].filter(Boolean);

                        setAddress({
                            formattedAddress: uniqueParts.join(', '),
                            locationName: locParts.length > 0 ? locParts.join(', ') : r.subregion || '',
                            district: r.subregion || r.city || '',
                            state: r.region || '',
                            city: r.city || '',
                            postalCode: r.postalCode || '',
                            country: r.country || '',
                        });
                        resolved = true;
                    }
                }
            } catch (expoErr) {
                console.warn('[useLocation] Expo geocoding failed, trying Nominatim:', expoErr);
            }

            // Fallback: Nominatim (OpenStreetMap) — works on web, free, no API key
            if (!resolved) {
                try {
                    const resp = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
                        { headers: { 'Accept-Language': 'en' } }
                    );
                    const data = await resp.json();
                    if (data && data.address) {
                        const a = data.address;
                        const district = a.state_district || a.county || a.city_district || a.city || '';
                        const state = a.state || '';
                        const city = a.city || a.town || a.village || a.hamlet || '';
                        const locName = [a.road || a.neighbourhood || a.suburb || '', city].filter(Boolean).join(', ');

                        const addrParts = [
                            a.road || a.neighbourhood,
                            city,
                            district,
                            state,
                            a.postcode,
                            a.country,
                        ].filter(Boolean);

                        setAddress({
                            formattedAddress: addrParts.join(', '),
                            locationName: locName || district,
                            district,
                            state,
                            city,
                            postalCode: a.postcode || '',
                            country: a.country || '',
                        });
                        resolved = true;
                    }
                } catch (nomErr) {
                    console.warn('[useLocation] Nominatim geocoding also failed:', nomErr);
                }
            }

            setStatus('success');
        } catch (err) {
            console.warn('[useLocation] Reverse geocoding failed:', err);
            setStatus('success');
        }
    }, []);

    // ── Core GPS fetch ──────────────────────────────────────────────────────

    const requestLocation = useCallback(async () => {
        setStatus('requesting');
        setError(null);
        setAddress(null);

        const { status: permStatus } =
            await Location.requestForegroundPermissionsAsync();

        if (permStatus !== 'granted') {
            setStatus('denied');
            setError(
                'Location access was denied. Enable it in Settings or enter coordinates manually.'
            );
            return;
        }

        setStatus('fetching');

        try {
            const position = (await Promise.race([
                Location.getCurrentPositionAsync(LOCATION_OPTIONS),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error('GPS_TIMEOUT')),
                        FETCH_TIMEOUT_MS
                    )
                ),
            ])) as Location.LocationObject;

            const newCoords: LocationCoords = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
            };
            setCoords(newCoords);

            // Now reverse geocode to get address
            await reverseGeocode(newCoords.latitude, newCoords.longitude);
        } catch (err: unknown) {
            const isTimeout = err instanceof Error && err.message === 'GPS_TIMEOUT';
            const isNoSignal =
                err instanceof Error &&
                (err.message.includes('no location provider') ||
                    err.message.includes('unavailable'));

            if (isTimeout || isNoSignal) {
                setStatus('error');
                setError(
                    'Could not get your location — GPS signal may be weak or unavailable indoors. ' +
                    'You can enter coordinates manually.'
                );
            } else {
                setStatus('error');
                setError('Location fetch failed. Please try again or enter manually.');
            }
        }
    }, [reverseGeocode]);

    // ── Auto-fetch on mount ─────────────────────────────────────────────────

    useEffect(() => {
        if (autoFetch) {
            requestLocation();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Manual override ─────────────────────────────────────────────────────

    const setManual = useCallback(async (lat: number, lng: number) => {
        setCoords({ latitude: lat, longitude: lng, accuracy: null });
        setError(null);
        // Reverse geocode manual coords too
        await reverseGeocode(lat, lng);
        setStatus('manual');
    }, [reverseGeocode]);

    // ── Reset ───────────────────────────────────────────────────────────────

    const clearLocation = useCallback(() => {
        setCoords(null);
        setAddress(null);
        setStatus('idle');
        setError(null);
    }, []);

    const skip = useCallback(() => {
        setCoords(null);
        setAddress(null);
        setStatus('skipped');
        setError(null);
    }, []);

    return { coords, address, status, errorMsg, requestLocation, setManual, clearLocation, skip };
}
