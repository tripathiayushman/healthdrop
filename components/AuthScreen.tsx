// =====================================================
// AUTH SCREEN — "Prakash" design system
// Flat headerBg band, ink-on-paper card, labels above
// 52dp inputs, inline field errors (no Alert.alert),
// solid-fill role selection, honest signup errors.
// =====================================================
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
  ActivityIndicator, FlatList, SafeAreaView, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { useTheme, spacing, radii } from '../lib/ThemeContext';

interface AuthScreenProps { onAuthSuccess: () => void; }

// ── Indian States ─────────────────────────────────────
const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi',
  'Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry',
];

// ── Roles (icon = Ionicons base name; outline at rest, filled selected) ──
const SIGNUP_ROLES: { value: Profile['role']; label: string; icon: string; desc: string }[] = [
  { value: 'clinic',      label: 'Clinic',       icon: 'medical',   desc: 'Healthcare facility' },
  { value: 'asha_worker', label: 'ASHA Worker',  icon: 'heart',     desc: 'Community health worker' },
  { value: 'volunteer',   label: 'Volunteer',    icon: 'hand-left', desc: 'Community participant' },
];

// ── GPS: Nominatim reverse-geocode (works on web too) ─
const reverseGeocode = async (lat: number, lon: number) => {
  try {
    // Try expo-location first (native only — will throw on web)
    if (Platform.OS !== 'web') {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (results?.length) {
        const g = results[0];
        return {
          district: g.subregion || g.district || g.city || g.name || '',
          state:    g.region || '',
          pincode:  g.postalCode || '',
        };
      }
    }
    // Fallback: Nominatim (free, no API key, works on web and native)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en-IN,en', 'User-Agent': 'HealthDropSurveillanceApp/1.0' } }
    );
    const data = await res.json();
    const addr = data?.address || {};
    return {
      district: addr.county || addr.state_district || addr.city || addr.town || addr.village || '',
      state:    addr.state || '',
      pincode:  addr.postcode || '',
    };
  } catch {
    return null;
  }
};

const WEB_NO_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none', outline: 'none' } as any) : null;

// ── Inline field error (spec: no Alert.alert for validation) ──
const FieldError: React.FC<{ message?: string }> = ({ message }) => {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View style={s.errorRow}>
      <Ionicons name="alert-circle" size={14} color={colors.danger} />
      <Text style={[s.errorText, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
        {message}
      </Text>
    </View>
  );
};

// ── Labeled input — label ABOVE, 52dp field, 1.5px border ──
const LabeledField: React.FC<{
  label: string; icon: string; value: string; onChange: (t: string) => void;
  placeholder: string; keyboardType?: any; secure?: boolean;
  autoCapitalize?: any; autoComplete?: any; rightElement?: React.ReactNode;
  error?: string;
}> = ({ label, icon, value, onChange, placeholder, keyboardType, secure, autoCapitalize = 'none', autoComplete, rightElement, error }) => {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.inputErrorBorder : focused ? colors.inputFocusBorder : colors.inputBorder;
  const borderWidth = error || focused ? 2 : 1.5;
  return (
    <View style={s.fieldWrap}>
      <Text style={[s.fieldLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      <View style={[s.fieldRow, { backgroundColor: colors.inputBackground, borderColor, borderWidth }]}>
        <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.fieldInput, { color: colors.text }, WEB_NO_OUTLINE]}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightElement}
      </View>
      <FieldError message={error} />
    </View>
  );
};

// ── District + inline GPS button ──────────────────────
const DistrictField: React.FC<{
  value: string; onChange: (t: string) => void;
  loading: boolean; onGPS: () => void; error?: string;
}> = ({ value, onChange, loading, onGPS, error }) => {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.inputErrorBorder : focused ? colors.inputFocusBorder : colors.inputBorder;
  const borderWidth = error || focused ? 2 : 1.5;
  return (
    <View style={s.fieldWrap}>
      <Text style={[s.fieldLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        District
      </Text>
      <View style={s.gpsRow}>
        <View style={[s.fieldRow, { flex: 1, backgroundColor: colors.inputBackground, borderColor, borderWidth }]}>
          <Ionicons name="business-outline" size={16} color={colors.textSecondary} />
          <TextInput
            style={[s.fieldInput, { color: colors.text }, WEB_NO_OUTLINE]}
            placeholder="District / City"
            placeholderTextColor={colors.placeholder}
            value={value}
            onChangeText={onChange}
            autoCapitalize="words"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </View>
        <TouchableOpacity
          style={[s.gpsBtn, { borderColor: colors.inputBorder }]}
          onPress={onGPS}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Use GPS to fill district and state"
        >
          {loading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : (
              <>
                <Ionicons name="locate-outline" size={16} color={colors.text} />
                <Text style={[s.gpsTxt, { color: colors.text }]} maxFontSizeMultiplier={1.3}>GPS</Text>
              </>
            )}
        </TouchableOpacity>
      </View>
      <FieldError message={error} />
    </View>
  );
};

// ── States searchable dropdown ─────────────────────────
const StatesDropdown: React.FC<{ value: string; onSelect: (st: string) => void; error?: string }> = ({ value, onSelect, error }) => {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = INDIAN_STATES.filter(st => st.toLowerCase().includes(search.toLowerCase()));
  const borderColor = error ? colors.inputErrorBorder : colors.inputBorder;
  return (
    <View style={s.fieldWrap}>
      <Text style={[s.fieldLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        State
      </Text>
      <TouchableOpacity
        style={[s.fieldRow, { backgroundColor: colors.inputBackground, borderColor, borderWidth: error ? 2 : 1.5 }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={value ? `State: ${value}. Change state` : 'Select state'}
      >
        <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
        <Text
          style={[s.fieldInput, { color: value ? colors.text : colors.placeholder }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {value || 'Select State'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
      <FieldError message={error} />

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[s.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close state list"
        />
        <View style={[s.ddPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.ddHeading, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Select State</Text>
          <View style={[s.ddSearch, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={[s.fieldInput, { color: colors.text }, WEB_NO_OUTLINE]}
              placeholder="Search states…"
              placeholderTextColor={colors.placeholder}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={i => i}
            style={{ maxHeight: 320 }}
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <TouchableOpacity
                  style={[s.ddItem, { borderBottomColor: colors.borderLight }]}
                  onPress={() => { onSelect(item); setSearch(''); setOpen(false); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item}
                >
                  <Text
                    style={[s.ddItemTxt, { color: selected ? colors.primary : colors.text, fontWeight: selected ? '700' : '500' }]}
                    maxFontSizeMultiplier={1.3}
                  >
                    {item}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
};

// ══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════
export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const { colors, isDark, reduceMotion } = useTheme();
  const [isLogin, setIsLogin]       = useState(true);
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [fullName, setFullName]     = useState('');
  const [phone, setPhone]           = useState('');
  const [role, setRole]             = useState<Profile['role']>('volunteer');
  const [district, setDistrict]     = useState('');
  const [userState, setUserState]   = useState('');
  const [pincode, setPincode]       = useState('');
  const [loading, setLoading]       = useState(false);
  const [fetchingLoc, setFetchLoc]  = useState(false);
  const [showPw, setShowPw]         = useState(false);
  const [showCPw, setShowCPw]       = useState(false);

  // Inline field-validation errors (spec: no alert modals for validation)
  const [errors, setErrors] = useState<Record<string, string>>({});
  const scrollRef = useRef<ScrollView>(null);

  // Message modal — server/system responses only, never field validation
  const [msgVisible, setMsgVisible]   = useState(false);
  const [msgType, setMsgType]         = useState<'error' | 'success'>('error');
  const [msgTitle, setMsgTitle]       = useState('');
  const [msgText, setMsgText]         = useState('');
  const [msgCallback, setMsgCallback] = useState<(() => void) | null>(null);

  const showMsg = (type: 'error' | 'success', title: string, text: string, cb?: () => void) => {
    setMsgType(type); setMsgTitle(title); setMsgText(text);
    setMsgCallback(() => cb ?? null); setMsgVisible(true);
  };
  const closeMsg = () => { setMsgVisible(false); msgCallback?.(); };
  const isValidEmail = (t: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);

  const clearError = (key: string) => {
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── GPS fetch (Nominatim works on both web + native) ──
  const fetchLocation = async () => {
    setFetchLoc(true);
    try {
      let lat: number, lon: number;

      if (Platform.OS === 'web') {
        // Use the browser's native Geolocation API on web
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
        );
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          showMsg('error', 'Permission Denied', 'Location permission is required to auto-fill.');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }

      const geo = await reverseGeocode(lat, lon);
      if (!geo || (!geo.district && !geo.state)) {
        showMsg('error', 'Location Unavailable', 'Could not resolve your address. Please enter manually.');
        return;
      }

      if (geo.district) { setDistrict(geo.district); clearError('district'); }
      if (geo.state) {
        const matched = INDIAN_STATES.find(st => st.toLowerCase() === geo.state.toLowerCase())
          || INDIAN_STATES.find(st => st.toLowerCase().includes(geo.state.toLowerCase()));
        setUserState(matched || geo.state);
        clearError('state');
      }
      if (geo.pincode) setPincode(geo.pincode);
    } catch {
      showMsg('error', 'Location Error', 'Could not access GPS. Please enter location manually.');
    } finally {
      setFetchLoc(false);
    }
  };

  // ── Validation — inline errors, scroll to the form top ──
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = 'Email is required';
    else if (!isValidEmail(email)) next.email = 'Enter a valid email address';
    if (!password) next.password = 'Password is required';
    if (!isLogin) {
      if (!fullName.trim()) next.fullName = 'Full name is required';
      if (password && password.length < 8) next.password = 'Password must be at least 8 characters';
      if (password && confirmPw !== password) next.confirmPw = "Passwords don't match";
      if (!district.trim()) next.district = 'District is required';
      if (!userState) next.state = 'State is required';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion });
      return false;
    }
    return true;
  };

  // ── Auth ──────────────────────────────────────────────
  const handleAuth = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        setLoading(false);
        if (error) {
          if (error.message.includes('Invalid login credentials'))
            showMsg('error', 'Login Failed', 'Incorrect email or password.');
          else if (error.message.includes('Email not confirmed'))
            showMsg('error', 'Email Not Verified', 'Please confirm your email before signing in.');
          else showMsg('error', 'Login Error', error.message);
          return;
        }
        if (data?.session) onAuthSuccess();
        else showMsg('error', 'Login Failed', 'Unable to sign in. Please try again.');
      } else {
        const { data: sd, error: se } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName, role, district, state: userState, phone, pincode } },
        });
        if (se) { setLoading(false); showMsg('error', 'Sign Up Error', se.message); return; }
        if (sd?.user) {
          if (sd.session) {
            // Surface the profile write honestly — never pretend success.
            const { error: profileError } = await supabase.from('profiles').upsert({
              id: sd.user.id, email, full_name: fullName, role,
              phone: phone || null, district: district || null,
              state: userState || null, is_active: true, created_at: new Date().toISOString(),
            }, { onConflict: 'id' });
            if (profileError) {
              setLoading(false);
              showMsg(
                'error',
                'Profile Not Saved',
                `Your account was created, but your profile details could not be saved (${profileError.message}). Please sign in to try again.`,
                () => setIsLogin(true)
              );
              return;
            }
            await new Promise(r => setTimeout(r, 500));
            setLoading(false);
            showMsg('success', 'Account Created', 'Welcome to HealthDrop.', () => onAuthSuccess());
          } else {
            setLoading(false);
            showMsg('success', 'Check Your Email', 'Click the confirmation link we sent to verify your account.', () => setIsLogin(true));
          }
        } else {
          setLoading(false);
          showMsg('error', 'Sign Up Error', 'Unable to create account. Please try again.');
        }
      }
    } catch {
      setLoading(false);
      showMsg('error', 'Unexpected Error', 'Something went wrong. Please try again.');
    }
  };

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setErrors({});
    setEmail(''); setPassword(''); setConfirmPw(''); setFullName('');
    setDistrict(''); setUserState(''); setPincode(''); setPhone('');
  };

  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub  = isDark ? colors.textSecondary : colors.primaryLight;

  // ── Render ────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Flat header band ── */}
        <View
          style={[
            s.header,
            { backgroundColor: colors.headerBg },
            isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
          ]}
        >
          <Text style={[s.headerTitle, { color: headerText }]} maxFontSizeMultiplier={1.3}>
            HealthDrop
          </Text>
          <Text style={[s.headerSub, { color: headerSub }]} maxFontSizeMultiplier={1.3}>
            Community health surveillance
          </Text>
        </View>

        {/* ── Sign In / Sign Up switcher ── */}
        <View style={[s.topBar, { borderBottomColor: colors.border }]}>
          {(['Sign In', 'Sign Up'] as const).map((label, i) => {
            const active = (i === 0) === isLogin;
            return (
              <TouchableOpacity
                key={label}
                style={[s.topTab, active && { borderBottomColor: colors.primary }]}
                onPress={() => switchMode(i === 0)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
              >
                <Text
                  style={[s.topTabTxt, { color: active ? colors.primary : colors.textSecondary, fontWeight: active ? '700' : '600' }]}
                  maxFontSizeMultiplier={1.3}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Scroll ── */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}>
            <Text style={[s.heading, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {isLogin ? 'Sign in to continue' : 'Create your account'}
            </Text>

            {isLogin ? (
              /* ══ SIGN IN ══════════════════════════════ */
              <>
                <LabeledField
                  label="Email" icon="at-outline" value={email}
                  onChange={(t) => { setEmail(t); clearError('email'); }}
                  placeholder="Email address" keyboardType="email-address" autoComplete="email"
                  error={errors.email}
                />
                <LabeledField
                  label="Password" icon="lock-closed-outline" value={password}
                  onChange={(t) => { setPassword(t); clearError('password'); }}
                  placeholder="Password" secure={!showPw} autoComplete="password"
                  error={errors.password}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowPw(p => !p)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
                    >
                      <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
              </>

            ) : (
              /* ══ SIGN UP ══════════════════════════════ */
              <>
                <LabeledField
                  label="Full Name" icon="person-outline" value={fullName}
                  onChange={(t) => { setFullName(t); clearError('fullName'); }}
                  placeholder="Full name" autoCapitalize="words"
                  error={errors.fullName}
                />
                <LabeledField
                  label="Email" icon="at-outline" value={email}
                  onChange={(t) => { setEmail(t); clearError('email'); }}
                  placeholder="Email address" keyboardType="email-address" autoComplete="email"
                  error={errors.email}
                />
                <LabeledField
                  label="Phone (Optional)" icon="call-outline" value={phone}
                  onChange={setPhone}
                  placeholder="Phone number" keyboardType="phone-pad" autoComplete="tel"
                />

                {/* Role */}
                <Text style={[s.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Role
                </Text>
                <View style={s.roleWrap}>
                  {SIGNUP_ROLES.map(r => {
                    const active = role === r.value;
                    return (
                      <TouchableOpacity
                        key={r.value}
                        style={[
                          s.roleRow,
                          active
                            ? { backgroundColor: colors.primary, borderColor: colors.primary }
                            : { backgroundColor: colors.card, borderColor: colors.border },
                        ]}
                        onPress={() => setRole(r.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Role: ${r.label}. ${r.desc}`}
                      >
                        <Ionicons
                          name={(active ? r.icon : `${r.icon}-outline`) as any}
                          size={20}
                          color={active ? colors.onPrimary : colors.textSecondary}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[s.roleLabel, { color: active ? colors.onPrimary : colors.text }]}
                            maxFontSizeMultiplier={1.3}
                          >
                            {r.label}
                          </Text>
                          <Text
                            style={[s.roleDesc, { color: active ? colors.onPrimary : colors.textSecondary }]}
                            maxFontSizeMultiplier={1.3}
                          >
                            {r.desc}
                          </Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={20} color={colors.onPrimary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Location */}
                <Text style={[s.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Location
                </Text>
                <Text style={[s.disclosure, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  Your location is sent to OpenStreetMap to fill district/state.
                </Text>
                <DistrictField
                  value={district}
                  onChange={(t) => { setDistrict(t); clearError('district'); }}
                  loading={fetchingLoc}
                  onGPS={fetchLocation}
                  error={errors.district}
                />
                <StatesDropdown
                  value={userState}
                  onSelect={(st) => { setUserState(st); clearError('state'); }}
                  error={errors.state}
                />
                <LabeledField
                  label="Pincode (Optional)" icon="pin-outline" value={pincode}
                  onChange={setPincode}
                  placeholder="Pincode" keyboardType="numeric"
                />

                {/* Password */}
                <Text style={[s.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  Password
                </Text>
                <LabeledField
                  label="Password" icon="lock-closed-outline" value={password}
                  onChange={(t) => { setPassword(t); clearError('password'); }}
                  placeholder="Create password (min 8 chars)" secure={!showPw} autoComplete="new-password"
                  error={errors.password}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowPw(p => !p)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
                    >
                      <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
                <LabeledField
                  label="Confirm Password" icon="lock-closed-outline" value={confirmPw}
                  onChange={(t) => { setConfirmPw(t); clearError('confirmPw'); }}
                  placeholder="Confirm password" secure={!showCPw} autoComplete="new-password"
                  error={errors.confirmPw || (confirmPw.length > 0 && confirmPw !== password ? "Passwords don't match" : undefined)}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowCPw(p => !p)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel={showCPw ? 'Hide password' : 'Show password'}
                    >
                      <Ionicons name={showCPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
              </>
            )}

            {/* Primary action — 56dp, background-change press state */}
            <Pressable
              style={({ pressed }) => [
                s.submitBtn,
                { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                loading && { opacity: 0.4 },
              ]}
              onPress={handleAuth}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={isLogin ? 'Sign in' : 'Create account'}
            >
              {loading
                ? <ActivityIndicator size="small" color={colors.onPrimary} />
                : (
                  <Text style={[s.submitTxt, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                    {isLogin ? 'Sign In' : 'Create Account'}
                  </Text>
                )}
            </Pressable>
          </View>

          {/* Footer */}
          <View style={s.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textTertiary} />
            <Text style={[s.footerTxt, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
              Secured by Supabase · Encrypted at rest
            </Text>
          </View>
        </ScrollView>

        {/* ── Message Modal — server/system responses only ── */}
        <Modal visible={msgVisible} transparent animationType="fade" onRequestClose={closeMsg}>
          <View style={[s.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[s.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons
                name={msgType === 'error' ? 'alert-circle' : 'checkmark-circle'}
                size={48}
                color={msgType === 'error' ? colors.danger : colors.success}
                style={{ marginBottom: spacing.md }}
              />
              <Text style={[s.modalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {msgTitle}
              </Text>
              <Text style={[s.modalSub, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {msgText}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  s.modalBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                ]}
                onPress={closeMsg}
                accessibilityRole="button"
                accessibilityLabel="OK"
              >
                <Text style={[s.submitTxt, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>OK</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles — 4pt grid, radii/spacing tokens only ───────
const s = StyleSheet.create({
  root: { flex: 1 },

  /* Header band — clears the translucent Android status bar manually
     (this screen uses the core RN SafeAreaView, which only insets on iOS) */
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? spacing.xl) + spacing.md : spacing.xl,
    paddingBottom: spacing.lg,
  },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub:   { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  /* Mode switcher */
  topBar: { flexDirection: 'row', borderBottomWidth: 1 },
  topTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  topTabTxt: { fontSize: 15, lineHeight: 22 },

  /* Scroll + card */
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: spacing.lg },

  /* Fields */
  fieldWrap: { marginBottom: spacing.lg },
  fieldLabel: {
    fontSize: 13, lineHeight: 18, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: spacing.xs + 2,
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg - 2,
    minHeight: 52,
  },
  fieldInput: { flex: 1, fontSize: 15, lineHeight: 22, paddingVertical: spacing.sm },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.xs + 2,
  },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', flexShrink: 1 },

  /* Section eyebrow + disclosure */
  sectionLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  disclosure: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginBottom: spacing.sm },

  /* Role selector */
  roleWrap: { marginBottom: spacing.sm },
  roleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.md, borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  roleLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  roleDesc:  { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },

  /* GPS */
  gpsRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    minHeight: 52, minWidth: 72,
    borderRadius: radii.md, borderWidth: 1.5,
    paddingHorizontal: spacing.md,
  },
  gpsTxt: { fontSize: 13, lineHeight: 18, fontWeight: '700' },

  /* Submit */
  submitBtn: {
    marginTop: spacing.sm,
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitTxt: { fontSize: 16, lineHeight: 22, fontWeight: '700' },

  /* Footer */
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs + 2, marginTop: spacing.lg, minHeight: 24,
  },
  footerTxt: { fontSize: 12, lineHeight: 16, fontWeight: '600' },

  /* States dropdown modal */
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  ddPanel: {
    position: 'absolute', left: spacing.xl, right: spacing.xl, top: '12%',
    borderRadius: radii.lg, borderWidth: 1,
    padding: spacing.lg, maxHeight: '72%',
  },
  ddHeading: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: spacing.md },
  ddSearch: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radii.md, borderWidth: 1.5,
    paddingHorizontal: spacing.md, minHeight: 48,
    marginBottom: spacing.md,
  },
  ddItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ddItemTxt: { fontSize: 15, lineHeight: 22, flexShrink: 1 },

  /* Message modal */
  modalCard: {
    borderRadius: radii.lg, borderWidth: 1,
    padding: spacing.xl, width: '100%', maxWidth: 380,
    alignItems: 'center',
  },
  modalTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm },
  modalSub:   { fontSize: 15, lineHeight: 22, fontWeight: '500', textAlign: 'center', marginBottom: spacing.xl },
  modalBtn:   {
    minHeight: 56, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'stretch',
  },
});
