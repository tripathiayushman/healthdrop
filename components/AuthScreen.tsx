import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
  ActivityIndicator, FlatList, ImageBackground, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Profile } from '../types/profile';

interface AuthScreenProps { onAuthSuccess: () => void; }

const SCREEN_HEIGHT = Dimensions.get('window').height;
const BRAND_PRIMARY = '#1565C0';

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

// ── Roles ─────────────────────────────────────────────
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

// ── Dark inset-shadow field (no browser outline) ──────
const Field: React.FC<{
  icon: string; value: string; onChange: (t: string) => void;
  placeholder: string; keyboardType?: any; secure?: boolean;
  autoCapitalize?: any; autoComplete?: any; rightElement?: React.ReactNode;
}> = ({ icon, value, onChange, placeholder, keyboardType, secure, autoCapitalize = 'none', autoComplete, rightElement }) => (
  <View style={f.field}>
    <Ionicons name={icon as any} size={16} color="#9ca3af" />
    <TextInput
      style={f.input}
      placeholder={placeholder}
      placeholderTextColor="#4b5563"
      value={value}
      onChangeText={onChange}
      keyboardType={keyboardType}
      secureTextEntry={secure}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
      // Remove browser default outline / box
      {...(Platform.OS === 'web' ? { style: [f.input, { outline: 'none' } as any] } : {})}
    />
    {rightElement}
  </View>
);

const f = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 25, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#171717',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.8, shadowRadius: 6, elevation: 4,
    marginBottom: 10,
  },
  input: {
    flex: 1, color: '#d3d3d3', fontSize: 14,
    // suppress web outline globally where possible
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outline: 'none' } as any : {}),
  },
});

// ── District + inline GPS button ──────────────────────
const DistrictField: React.FC<{
  value: string; onChange: (t: string) => void;
  loading: boolean; onGPS: () => void;
}> = ({ value, onChange, loading, onGPS }) => (
  <View style={g.row}>
    <View style={[f.field, { flex: 1, marginBottom: 0 }]}>
      <Ionicons name="business-outline" size={16} color="#9ca3af" />
      <TextInput
        style={[f.input, Platform.OS === 'web' ? { outline: 'none' } as any : {}]}
        placeholder="District / City"
        placeholderTextColor="#4b5563"
        value={value}
        onChangeText={onChange}
        autoCapitalize="words"
      />
    </View>
    <TouchableOpacity style={g.btn} onPress={onGPS} disabled={loading} activeOpacity={0.8}>
      {loading
        ? <ActivityIndicator size="small" color="#3b82f6" />
        : <><Ionicons name="locate" size={14} color="#3b82f6" /><Text style={g.txt}>GPS</Text></>
      }
    </TouchableOpacity>
  </View>
);

const g = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#172554', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10 },
  txt: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },
});

// ── States searchable dropdown ─────────────────────────
const StatesDropdown: React.FC<{ value: string; onSelect: (s: string) => void }> = ({ value, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = INDIAN_STATES.filter(s => s.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <TouchableOpacity style={[f.field, { marginBottom: 10 }]} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Ionicons name="map-outline" size={16} color="#9ca3af" />
        <Text style={{ flex: 1, color: value ? '#d3d3d3' : '#4b5563', fontSize: 14 }}>{value || 'Select State'}</Text>
        <Ionicons name="chevron-down" size={15} color="#4b5563" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={dd.panel}>
          <Text style={dd.heading}>Select State</Text>
          <View style={dd.searchBox}>
            <Ionicons name="search" size={14} color="#9ca3af" />
            <TextInput
              style={[{ flex: 1, color: '#d3d3d3', fontSize: 14 }, Platform.OS === 'web' ? { outline: 'none' } as any : {}]}
              placeholder="Search states…"
              placeholderTextColor="#6b7280"
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={i => i}
            style={{ maxHeight: 300 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[dd.item, item === value && dd.itemActive]}
                onPress={() => { onSelect(item); setSearch(''); setOpen(false); }}
              >
                <Text style={[dd.itemTxt, item === value && dd.itemTxtActive]}>{item}</Text>
                {item === value && <Ionicons name="checkmark" size={15} color="#3b82f6" />}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </>
  );
};

const dd = StyleSheet.create({
  backdrop:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' },
  panel:        { position: 'absolute', left: 20, right: 20, top: '10%', backgroundColor: '#1f2937', borderRadius: 16, padding: 16, maxHeight: '75%', elevation: 20 },
  heading:      { color: '#f9fafb', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  searchBox:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  item:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#374151' },
  itemActive:   { backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 8 },
  itemTxt:      { color: '#d3d3d3', fontSize: 14 },
  itemTxtActive:{ color: '#60a5fa', fontWeight: '700' },
});

// ══════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════
export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
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

  // Modals
  const [showOtpModal, setShowOtpModal]           = useState(false);
  const [otpCode, setOtpCode]                     = useState('');
  const [otpLoading, setOtpLoading]               = useState(false);
  const [showSuccessModal, setShowSuccessModal]   = useState(false);
  const [userEmail, setUserEmail]                 = useState('');
  const [msgVisible, setMsgVisible]               = useState(false);
  const [msgType, setMsgType]                     = useState<'error' | 'success'>('error');
  const [msgTitle, setMsgTitle]                   = useState('');
  const [msgText, setMsgText]                     = useState('');
  const [msgCallback, setMsgCallback]             = useState<(() => void) | null>(null);

  const showMsg = (type: 'error' | 'success', title: string, text: string, cb?: () => void) => {
    setMsgType(type); setMsgTitle(title); setMsgText(text);
    setMsgCallback(() => cb ?? null); setMsgVisible(true);
  };
  const closeMsg = () => { setMsgVisible(false); msgCallback?.(); };
  const isValidEmail = (t: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);

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

      if (geo.district) setDistrict(geo.district);
      if (geo.state) {
        const matched = INDIAN_STATES.find(s => s.toLowerCase() === geo.state.toLowerCase())
          || INDIAN_STATES.find(s => s.toLowerCase().includes(geo.state.toLowerCase()));
        setUserState(matched || geo.state);
      }
      if (geo.pincode) setPincode(geo.pincode);
    } catch {
      showMsg('error', 'Location Error', 'Could not access GPS. Please enter location manually.');
    } finally {
      setFetchLoc(false);
    }
  };

  // ── Auth ──────────────────────────────────────────────
  const handleAuth = async () => {
    if (isLogin) {
      if (!email || !password) { showMsg('error', 'Missing Fields', 'Please enter your email and password.'); return; }
      if (!isValidEmail(email)) { showMsg('error', 'Invalid Email', 'Please enter a valid email address.'); return; }
    } else {
      if (!email || !password || !fullName || !district || !userState) {
        showMsg('error', 'Missing Fields', 'Name, Email, Password, District and State are required.'); return;
      }
      if (!isValidEmail(email)) { showMsg('error', 'Invalid Email', 'Please enter a valid email address.'); return; }
      if (password.length < 8) { showMsg('error', 'Weak Password', 'Password must be at least 8 characters.'); return; }
      if (password !== confirmPw) { showMsg('error', 'Password Mismatch', 'Passwords do not match.'); return; }
    }

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
            try {
              await supabase.from('profiles').upsert({
                id: sd.user.id, email, full_name: fullName, role,
                phone: phone || null, district: district || null,
                state: userState || null, is_active: true, created_at: new Date().toISOString(),
              }, { onConflict: 'id' });
              await new Promise(r => setTimeout(r, 500));
            } catch {}
            setLoading(false);
            showMsg('success', 'Account Created!', 'Welcome to HealthDrop!', () => onAuthSuccess());
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

  const handleOtpVerification = async () => {
    if (!otpCode || otpCode.length !== 6) { showMsg('error', 'Invalid OTP', 'Please enter the 6-digit code.'); return; }
    setOtpLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: userEmail, token: otpCode, type: 'email' });
      if (error) showMsg('error', 'OTP Error', error.message);
      else if (data.user) {
        const { error: pErr } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
        if (pErr?.code === 'PGRST116') {
          await supabase.from('profiles').insert({
            id: data.user.id, full_name: fullName, role, district,
            state: userState, is_active: true, created_at: new Date().toISOString(),
          });
        }
        setShowOtpModal(false); setShowSuccessModal(true); setOtpCode('');
      }
    } catch { showMsg('error', 'Error', 'An unexpected error occurred.'); }
    finally { setOtpLoading(false); }
  };

  const handleSuccessNext = () => {
    setShowSuccessModal(false);
    setEmail(''); setPassword(''); setConfirmPw(''); setFullName('');
    setDistrict(''); setUserState(''); setPincode(''); setPhone('');
    setIsLogin(true); onAuthSuccess();
  };

  const switchMode = () => {
    setIsLogin(m => !m);
    setEmail(''); setPassword(''); setConfirmPw(''); setFullName('');
    setDistrict(''); setUserState(''); setPincode(''); setPhone('');
  };

  // ── Render ────────────────────────────────────────────
  return (
    <ImageBackground
      source={require('../mesc/images/44472001_grey_hexagons_on_black_background.jpg')}
      style={s.bg}
      imageStyle={{ opacity: 0.35 }}
    >
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Top Tab Switcher ── */}
        <View style={s.topBar}>
          {(['Sign In', 'Sign Up'] as const).map((label, i) => {
            const active = (i === 0) === isLogin;
            return (
              <TouchableOpacity
                key={label}
                style={[s.topTab, active && s.topTabActive]}
                onPress={() => i === 0 ? setIsLogin(true) : setIsLogin(false)}
              >
                <Text style={[s.topTabTxt, active && s.topTabTxtActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Centered Scroll ── */}
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.card}>
            <Text style={s.heading}>{isLogin ? 'Login' : 'Sign Up'}</Text>

            {isLogin ? (
              /* ══ SIGN IN ══════════════════════════════ */
              <>
                <Field icon="at" value={email} onChange={setEmail} placeholder="Email address" keyboardType="email-address" autoComplete="email" />
                <Field
                  icon="lock-closed"
                  value={password}
                  onChange={setPassword}
                  placeholder="Password"
                  secure={!showPw}
                  autoComplete="password"
                  rightElement={
                    <TouchableOpacity onPress={() => setShowPw(p => !p)} style={{ padding: 4 }}>
                      <Ionicons name={showPw ? 'eye-off' : 'eye'} size={17} color="#6b7280" />
                    </TouchableOpacity>
                  }
                />
                <TouchableOpacity style={s.submitBtn} onPress={handleAuth} disabled={loading} activeOpacity={0.85}>
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitTxt}>Login</Text>}
                </TouchableOpacity>
              </>

            ) : (
              /* ══ SIGN UP ══════════════════════════════ */
              <>
                <Field icon="person" value={fullName} onChange={setFullName} placeholder="Full name" autoCapitalize="words" />
                <Field icon="at" value={email} onChange={setEmail} placeholder="Email address" keyboardType="email-address" autoComplete="email" />
                <Field icon="call" value={phone} onChange={setPhone} placeholder="Phone (optional)" keyboardType="phone-pad" autoComplete="tel" />

                {/* Role */}
                <View style={s.roleWrap}>
                  {SIGNUP_ROLES.map(r => {
                    const active = role === r.value;
                    return (
                      <TouchableOpacity key={r.value} style={[s.roleRow, active && s.roleRowActive]} onPress={() => setRole(r.value)}>
                        <View style={[s.roleIcon, active && s.roleIconActive]}>
                          <Ionicons name={r.icon as any} size={15} color={active ? '#fff' : '#9ca3af'} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.roleLabel, active && s.roleLabelActive]}>{r.label}</Text>
                          <Text style={s.roleDesc}>{r.desc}</Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={17} color="#3b82f6" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Location */}
                <Text style={s.sectionLabel}>Location</Text>
                <DistrictField value={district} onChange={setDistrict} loading={fetchingLoc} onGPS={fetchLocation} />
                <StatesDropdown value={userState} onSelect={setUserState} />
                <Field icon="pin" value={pincode} onChange={setPincode} placeholder="Pincode (optional)" keyboardType="numeric" />

                {/* Password */}
                <Text style={s.sectionLabel}>Password</Text>
                <Field
                  icon="lock-closed"
                  value={password}
                  onChange={setPassword}
                  placeholder="Create password (min 8 chars)"
                  secure={!showPw}
                  autoComplete="new-password"
                  rightElement={
                    <TouchableOpacity onPress={() => setShowPw(p => !p)} style={{ padding: 4 }}>
                      <Ionicons name={showPw ? 'eye-off' : 'eye'} size={17} color="#6b7280" />
                    </TouchableOpacity>
                  }
                />
                <Field
                  icon="lock-closed"
                  value={confirmPw}
                  onChange={setConfirmPw}
                  placeholder="Confirm password"
                  secure={!showCPw}
                  autoComplete="new-password"
                  rightElement={
                    <TouchableOpacity onPress={() => setShowCPw(p => !p)} style={{ padding: 4 }}>
                      <Ionicons name={showCPw ? 'eye-off' : 'eye'} size={17} color={confirmPw && confirmPw !== password ? '#ef4444' : '#6b7280'} />
                    </TouchableOpacity>
                  }
                />
                {confirmPw.length > 0 && confirmPw !== password && (
                  <Text style={s.pwMismatch}>Passwords don't match</Text>
                )}

                <TouchableOpacity style={s.submitBtn} onPress={handleAuth} disabled={loading} activeOpacity={0.85}>
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitTxt}>Create Account</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Footer */}
          <View style={s.footer}>
            <Ionicons name="shield-checkmark-outline" size={12} color="#374151" />
            <Text style={s.footerTxt}>Secured by Supabase · Encrypted at rest</Text>
          </View>
        </ScrollView>

        {/* ── OTP Modal ── */}
        <Modal visible={showOtpModal} transparent animationType="slide" onRequestClose={() => setShowOtpModal(false)}>
          <View style={mod.overlay}>
            <View style={mod.card}>
              <Ionicons name="keypad-outline" size={36} color={BRAND_PRIMARY} style={{ marginBottom: 12 }} />
              <Text style={mod.title}>Enter Verification Code</Text>
              <Text style={mod.sub}>We sent a 6-digit code to {userEmail}</Text>
              <TextInput style={mod.otpInput} value={otpCode} onChangeText={setOtpCode} placeholder="000000" keyboardType="numeric" maxLength={6} />
              <TouchableOpacity style={[mod.btn, otpLoading && { opacity: 0.6 }]} onPress={handleOtpVerification} disabled={otpLoading}>
                {otpLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={mod.btnTxt}>Verify Code</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={mod.cancel} onPress={() => setShowOtpModal(false)}>
                <Text style={mod.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── Success Modal ── */}
        <Modal visible={showSuccessModal} transparent animationType="fade" onRequestClose={() => setShowSuccessModal(false)}>
          <View style={mod.overlay}>
            <View style={mod.card}>
              <Ionicons name="checkmark-circle" size={48} color="#10B981" style={{ marginBottom: 12 }} />
              <Text style={mod.title}>Account Created!</Text>
              <Text style={mod.sub}>Welcome to HealthDrop. Let's get started.</Text>
              <TouchableOpacity style={[mod.btn, { backgroundColor: '#10B981' }]} onPress={handleSuccessNext}>
                <Text style={mod.btnTxt}>Get Started</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ── Message Modal ── */}
        <Modal visible={msgVisible} transparent animationType="fade" onRequestClose={closeMsg}>
          <View style={mod.overlay}>
            <View style={mod.card}>
              <Ionicons
                name={msgType === 'error' ? 'alert-circle' : 'checkmark-circle'}
                size={48} color={msgType === 'error' ? '#EF4444' : '#10B981'}
                style={{ marginBottom: 12 }}
              />
              <Text style={mod.title}>{msgTitle}</Text>
              <Text style={mod.sub}>{msgText}</Text>
              <TouchableOpacity style={[mod.btn, { backgroundColor: msgType === 'error' ? '#EF4444' : '#10B981' }]} onPress={closeMsg}>
                <Text style={mod.btnTxt}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

// ── Styles ─────────────────────────────────────────────
const s = StyleSheet.create({
  bg:    { flex: 1, backgroundColor: '#0a0a0a' },
  root:  { flex: 1 },

  // Tabs at top
  topBar:          { flexDirection: 'row', paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingHorizontal: 24, backgroundColor: 'transparent' },
  topTab:          { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  topTabActive:    { borderBottomColor: '#3b82f6' },
  topTabTxt:       { fontSize: 15, fontWeight: '600', color: '#4b5563' },
  topTabTxtActive: { color: '#3b82f6' },

  // Centered scroll
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    minHeight: SCREEN_HEIGHT * 0.75,
  },

  // Dark card
  card: {
    backgroundColor: 'rgba(23,23,23,0.97)',
    borderRadius: 25,
    paddingHorizontal: 22,
    paddingVertical: 26,
    borderWidth: 1,
    borderColor: '#2d2d2d',
  },
  heading: { textAlign: 'center', color: '#ffffff', fontSize: 20, fontWeight: '700', marginBottom: 20 },

  // Section labels
  sectionLabel: { color: '#6b7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },

  // Role selector
  roleWrap:       { marginBottom: 14 },
  roleRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: '#2d2d2d', backgroundColor: '#1f1f1f', marginBottom: 7 },
  roleRowActive:  { borderColor: '#3b82f6', backgroundColor: '#172554' },
  roleIcon:       { width: 34, height: 34, borderRadius: 10, backgroundColor: '#2d2d2d', alignItems: 'center', justifyContent: 'center' },
  roleIconActive: { backgroundColor: '#1d4ed8' },
  roleLabel:      { fontSize: 13, fontWeight: '700', color: '#d1d5db' },
  roleLabelActive:{ color: '#60a5fa' },
  roleDesc:       { fontSize: 11, color: '#6b7280', marginTop: 1 },

  // Password mismatch
  pwMismatch: { color: '#ef4444', fontSize: 12, marginTop: -6, marginBottom: 6, marginLeft: 14 },

  // Submit
  submitBtn: { marginTop: 16, backgroundColor: '#252525', borderRadius: 8, alignItems: 'center', paddingVertical: 13 },
  submitTxt: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  // Footer
  footer:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  footerTxt: { fontSize: 11, color: '#374151' },
});

const mod = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:      { backgroundColor: '#1f2937', borderRadius: 24, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', elevation: 20 },
  title:     { fontSize: 20, fontWeight: '800', color: '#f9fafb', textAlign: 'center', marginBottom: 8 },
  sub:       { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  otpInput:  { width: '100%', borderWidth: 2, borderColor: '#374151', borderRadius: 14, padding: 18, textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: '700', color: '#f9fafb', backgroundColor: '#111827', marginBottom: 20 },
  btn:       { backgroundColor: '#1565C0', width: '100%', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnTxt:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancel:    { marginTop: 14, padding: 10 },
  cancelTxt: { color: '#6b7280', fontSize: 14 },
});