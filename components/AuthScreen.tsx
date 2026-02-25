import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
  ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Profile } from '../types/profile';

interface AuthScreenProps { onAuthSuccess: () => void; }

const BRAND_PRIMARY = '#1565C0';

// ── Indian States List ─────────────────────────────────
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
  { value: 'clinic',      label: 'Clinic',       icon: 'medical',    desc: 'Healthcare facility' },
  { value: 'asha_worker', label: 'ASHA Worker',  icon: 'heart',      desc: 'Community health worker' },
  { value: 'volunteer',   label: 'Volunteer',    icon: 'hand-left',  desc: 'Community participant' },
];

// ── Inset-shadow dark field ────────────────────────────
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
    />
    {rightElement}
  </View>
);

const f = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 25, paddingHorizontal: 16, paddingVertical: 13,
    backgroundColor: '#171717',
    shadowColor: '#050505', shadowOffset: { width: 2, height: 5 },
    shadowOpacity: 1, shadowRadius: 10, elevation: 4,
    marginBottom: 10,
  },
  input: { flex: 1, color: '#d3d3d3', fontSize: 14 } as any,
});

// ── District field with inline GPS button ──────────────
const DistrictField: React.FC<{
  value: string; onChange: (t: string) => void;
  loading: boolean; onGPS: () => void;
}> = ({ value, onChange, loading, onGPS }) => (
  <View style={g.wrap}>
    <View style={[f.field, { flex: 1, marginBottom: 0 }]}>
      <Ionicons name="business-outline" size={16} color="#9ca3af" />
      <TextInput
        style={f.input}
        placeholder="District / City"
        placeholderTextColor="#4b5563"
        value={value}
        onChangeText={onChange}
        autoCapitalize="words"
      />
    </View>
    <TouchableOpacity style={g.gpsBtn} onPress={onGPS} disabled={loading}>
      {loading
        ? <ActivityIndicator size="small" color="#3b82f6" />
        : <><Ionicons name="locate" size={15} color="#3b82f6" /><Text style={g.gpsTxt}>GPS</Text></>
      }
    </TouchableOpacity>
  </View>
);

const g = StyleSheet.create({
  wrap:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#172554', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10 },
  gpsTxt: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },
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
        <Text style={[f.input, { paddingVertical: 1, color: value ? '#d3d3d3' : '#4b5563' }]}>{value || 'Select State'}</Text>
        <Ionicons name="chevron-down" size={15} color="#4b5563" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={dd.panel}>
          <Text style={dd.heading}>Select State</Text>
          <View style={dd.searchBox}>
            <Ionicons name="search" size={14} color="#9ca3af" />
            <TextInput style={dd.searchInput as any} placeholder="Search..." placeholderTextColor="#6b7280" value={search} onChangeText={setSearch} autoFocus />
          </View>
          <FlatList
            data={filtered} keyExtractor={i => i} style={{ maxHeight: 320 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={[dd.item, item === value && dd.itemActive]} onPress={() => { onSelect(item); setSearch(''); setOpen(false); }}>
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
  backdrop:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' },
  panel:       { position: 'absolute', left: 20, right: 20, top: '12%', backgroundColor: '#1f2937', borderRadius: 16, padding: 16, maxHeight: '72%', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 18 },
  heading:     { color: '#f9fafb', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  searchBox:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  searchInput: { flex: 1, color: '#d3d3d3', fontSize: 14 },
  item:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#374151' },
  itemActive:  { backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 8 },
  itemTxt:     { color: '#d3d3d3', fontSize: 14 },
  itemTxtActive: { color: '#60a5fa', fontWeight: '700' },
});

// ── Pincode field ──────────────────────────────────────
// (reuses generic Field)

// ──────────────────────────────────────────────────────
//  MAIN COMPONENT
// ──────────────────────────────────────────────────────
export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin]           = useState(true);
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [confirmPw, setConfirmPw]       = useState('');
  const [fullName, setFullName]         = useState('');
  const [phone, setPhone]               = useState('');
  const [role, setRole]                 = useState<Profile['role']>('volunteer');

  // Location fields
  const [district, setDistrict]         = useState('');
  const [userState, setUserState]       = useState('');
  const [pincode, setPincode]           = useState('');

  const [loading, setLoading]           = useState(false);
  const [fetchingLoc, setFetchingLoc]   = useState(false);

  // Show/hide password toggles
  const [showPw,  setShowPw]  = useState(false);
  const [showCPw, setShowCPw] = useState(false);

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

  // ── GPS Auto-fill ──────────────────────────────────
  const fetchLocation = async () => {
    setFetchingLoc(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showMsg('error', 'Permission Denied', 'Location permission is required to auto-fill.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const results = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (results && results.length > 0) {
        const geo = results[0];
        // district: try subregion → city → district
        const districtVal = geo.subregion || geo.district || geo.city || geo.name || '';
        // state: region field
        const stateVal = geo.region || '';
        // pincode: postalCode field
        const postcodeVal = geo.postalCode || '';

        if (districtVal) setDistrict(districtVal);
        if (stateVal) {
          // Match against known Indian states (case-insensitive)
          const matched = INDIAN_STATES.find(s => s.toLowerCase() === stateVal.toLowerCase());
          setUserState(matched || stateVal);
        }
        if (postcodeVal) setPincode(postcodeVal);

        if (!districtVal && !stateVal) {
          showMsg('error', 'Location Unavailable', 'Could not resolve address from GPS. Please enter manually.');
        }
      } else {
        showMsg('error', 'Location Error', 'No address found for your position. Please enter manually.');
      }
    } catch (err) {
      showMsg('error', 'Location Error', 'Could not access GPS. Please enter location manually.');
    } finally {
      setFetchingLoc(false);
    }
  };

  // ── Auth ───────────────────────────────────────────
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
                state: userState || null, is_active: true,
                created_at: new Date().toISOString(),
              }, { onConflict: 'id' });
              await new Promise(r => setTimeout(r, 500));
            } catch {}
            setLoading(false);
            showMsg('success', 'Account Created!', 'Welcome to HealthDrop. You are now logged in.', () => onAuthSuccess());
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

  // ── Render ─────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

      {/* ── Top Tab Switcher ── */}
      <View style={s.topBar}>
        {(['Sign In', 'Sign Up'] as const).map((label, i) => {
          const active = (i === 0) === isLogin;
          return (
            <TouchableOpacity
              key={label}
              style={[s.topTab, active && s.topTabActive]}
              onPress={() => (i === 0 ? setIsLogin(true) : setIsLogin(false))}
            >
              <Text style={[s.topTabText, active && s.topTabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Form Card ── */}
        <View style={s.card}>
          <Text style={s.heading}>{isLogin ? 'Login' : 'Sign Up'}</Text>

          {isLogin ? (
            /* ══ SIGN IN ════════════════════════════ */
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

              {/* Submit */}
              <TouchableOpacity style={s.submitBtn} onPress={handleAuth} disabled={loading}>
                {loading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.submitTxt}>Login</Text>
                }
              </TouchableOpacity>
            </>

          ) : (
            /* ══ SIGN UP ════════════════════════════ */
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

              {/* ── Location section ── */}
              <Text style={s.sectionLabel}>Location</Text>

              {/* District + GPS inline */}
              <DistrictField value={district} onChange={setDistrict} loading={fetchingLoc} onGPS={fetchLocation} />

              {/* State dropdown */}
              <StatesDropdown value={userState} onSelect={setUserState} />

              {/* Pincode */}
              <Field icon="pin" value={pincode} onChange={setPincode} placeholder="Pincode (optional)" keyboardType="numeric" />

              {/* ── Passwords ── */}
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

              {/* Submit */}
              <TouchableOpacity style={s.submitBtn} onPress={handleAuth} disabled={loading}>
                {loading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.submitTxt}>Create Account</Text>
                }
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
            <Text style={mod.sub}>Welcome to HealthDrop. You can now explore the app.</Text>
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
  );
}

// ── Styles ──────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f0f0f' },
  scroll: { flexGrow: 1, paddingBottom: 40 },

  // Top tabs
  topBar:         { flexDirection: 'row', backgroundColor: '#0f0f0f', paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingHorizontal: 24, paddingBottom: 0 },
  topTab:         { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  topTabActive:   { borderBottomColor: '#3b82f6' },
  topTabText:     { fontSize: 15, fontWeight: '600', color: '#4b5563' },
  topTabTextActive:{ color: '#3b82f6' },

  // Card
  card:    { marginHorizontal: 20, marginTop: 20, backgroundColor: '#171717', borderRadius: 25, paddingHorizontal: 22, paddingVertical: 24 },
  heading: { textAlign: 'center', color: '#ffffff', fontSize: 20, fontWeight: '700', marginBottom: 20, marginTop: 4 },

  // Section label
  sectionLabel: { color: '#6b7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },

  // Role
  roleWrap:       { marginBottom: 14 },
  roleRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: '#2d2d2d', backgroundColor: '#1f1f1f', marginBottom: 7 },
  roleRowActive:  { borderColor: '#3b82f6', backgroundColor: '#172554' },
  roleIcon:       { width: 34, height: 34, borderRadius: 10, backgroundColor: '#2d2d2d', alignItems: 'center', justifyContent: 'center' },
  roleIconActive: { backgroundColor: '#1d4ed8' },
  roleLabel:      { fontSize: 13, fontWeight: '700', color: '#d1d5db' },
  roleLabelActive:{ color: '#60a5fa' },
  roleDesc:       { fontSize: 11, color: '#6b7280', marginTop: 1 },

  // Password
  pwMismatch: { color: '#ef4444', fontSize: 12, marginTop: -6, marginBottom: 6, marginLeft: 14 },

  // Submit
  submitBtn: { marginTop: 14, backgroundColor: '#252525', borderRadius: 5, alignItems: 'center', paddingVertical: 12 },
  submitTxt: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  // Footer
  footer:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
  footerTxt: { fontSize: 11, color: '#374151' },
});

const mod = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:      { backgroundColor: '#1f2937', borderRadius: 24, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', elevation: 16 },
  title:     { fontSize: 20, fontWeight: '800', color: '#f9fafb', textAlign: 'center', marginBottom: 8 },
  sub:       { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  otpInput:  { width: '100%', borderWidth: 2, borderColor: '#374151', borderRadius: 14, padding: 18, textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: '700', color: '#f9fafb', backgroundColor: '#111827', marginBottom: 20 },
  btn:       { backgroundColor: '#1565C0', width: '100%', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnTxt:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancel:    { marginTop: 14, padding: 10 },
  cancelTxt: { color: '#6b7280', fontSize: 14 },
});