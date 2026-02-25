import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
  ActivityIndicator, Image, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Profile } from '../types/profile';

interface AuthScreenProps { onAuthSuccess: () => void; }

// ── Indian States List ─────────────────────────────────
const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu',
  'Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry',
];

// ── Roles available at sign-up ─────────────────────────
const SIGNUP_ROLES: { value: Profile['role']; label: string; icon: string; desc: string }[] = [
  { value: 'clinic',      label: 'Clinic',       icon: 'medical',    desc: 'Healthcare facility' },
  { value: 'asha_worker', label: 'ASHA Worker',  icon: 'heart',      desc: 'Community health worker' },
  { value: 'volunteer',   label: 'Volunteer',    icon: 'hand-left',  desc: 'Community participant' },
];

const BRAND_GRADIENT: [string, string, string] = ['#1565C0', '#0D47A1', '#0A3068'];
const BRAND_PRIMARY = '#1565C0';

// ── Dark inset-shadow input field ─────────────────────
interface FieldProps {
  icon: string;
  value: string;
  onChange: (t: string) => void;
  placeholder: string;
  keyboardType?: any;
  secure?: boolean;
  autoCapitalize?: any;
  autoComplete?: any;
  rightElement?: React.ReactNode;
}
const Field: React.FC<FieldProps> = ({ icon, value, onChange, placeholder, keyboardType, secure, autoCapitalize = 'none', autoComplete, rightElement }) => (
  <View style={f.field}>
    <Ionicons name={icon as any} size={17} color="#fff" style={f.icon} />
    <TextInput
      style={f.input}
      placeholder={placeholder}
      placeholderTextColor="#6b7280"
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
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 25, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#171717', boxShadow: 'inset 2px 5px 10px #050505', marginBottom: 10 },
  icon:  { width: 20 },
  input: { flex: 1, color: '#d3d3d3', fontSize: 14, outlineStyle: 'none' } as any,
});

// ── States dropdown modal ─────────────────────────────
const StatesDropdown: React.FC<{ value: string; onSelect: (s: string) => void }> = ({ value, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = INDIAN_STATES.filter(s => s.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <TouchableOpacity style={f.field} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Ionicons name="map-outline" size={17} color="#fff" style={f.icon} />
        <Text style={[f.input, { paddingVertical: 2, color: value ? '#d3d3d3' : '#6b7280' }]}>{value || 'Select State'}</Text>
        <Ionicons name="chevron-down" size={16} color="#6b7280" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={dd.panel}>
          <Text style={dd.heading}>Select State</Text>
          <View style={dd.searchWrap}>
            <Ionicons name="search" size={15} color="#9ca3af" />
            <TextInput
              style={dd.searchInput}
              placeholder="Search states..."
              placeholderTextColor="#6b7280"
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={i => i}
            style={{ maxHeight: 320 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[dd.item, item === value && dd.itemActive]}
                onPress={() => { onSelect(item); setSearch(''); setOpen(false); }}
              >
                <Text style={[dd.itemText, item === value && dd.itemTextActive]}>{item}</Text>
                {item === value && <Ionicons name="checkmark" size={16} color="#3b82f6" />}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </>
  );
};

const dd = StyleSheet.create({
  backdrop:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  panel:         { position: 'absolute', left: 20, right: 20, top: '15%', backgroundColor: '#1f2937', borderRadius: 16, padding: 16, maxHeight: '70%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 20 },
  heading:       { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 12 },
  searchWrap:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111827', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
  searchInput:   { flex: 1, color: '#d3d3d3', fontSize: 14, outlineStyle: 'none' } as any,
  item:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#374151' },
  itemActive:    { backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 8 },
  itemText:      { color: '#d3d3d3', fontSize: 14 },
  itemTextActive:{ color: '#60a5fa', fontWeight: '700' },
});

// ── Main Component ────────────────────────────────────
export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin]           = useState(true);
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [confirmPassword, setConfirm]   = useState('');
  const [fullName, setFullName]         = useState('');
  const [phone, setPhone]               = useState('');
  const [role, setRole]                 = useState<Profile['role']>('volunteer');
  const [district, setDistrict]         = useState('');
  const [userState, setUserState]       = useState('');
  const [loading, setLoading]           = useState(false);
  const [fetchingLocation, setFetchLoc] = useState(false);

  // Show/hide password
  const [showPw,   setShowPw]   = useState(false);
  const [showCPw,  setShowCPw]  = useState(false);

  // OTP / success
  const [showOtpModal, setShowOtpModal]         = useState(false);
  const [otpCode, setOtpCode]                   = useState('');
  const [otpLoading, setOtpLoading]             = useState(false);
  const [showSuccessModal, setShowSuccessModal]  = useState(false);
  const [userEmail, setUserEmail]               = useState('');

  // Message modal
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

  // ── GPS fetch ────────────────────────────────────────
  const fetchLocation = async () => {
    setFetchLoc(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { showMsg('error', 'Permission Denied', 'Location permission is required.'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (geo.length > 0) {
        const g = geo[0];
        setDistrict(g.city || g.subregion || '');
        setUserState(g.region || '');
      }
    } catch { showMsg('error', 'Location Error', 'Could not fetch location. Please enter manually.'); }
    finally { setFetchLoc(false); }
  };

  // ── Auth ─────────────────────────────────────────────
  const handleAuth = async () => {
    if (isLogin) {
      if (!email || !password) { showMsg('error', 'Missing Fields', 'Please enter your email and password.'); return; }
      if (!isValidEmail(email)) { showMsg('error', 'Invalid Email', 'Please enter a valid email address.'); return; }
    } else {
      if (!email || !password || !fullName || !district || !userState) {
        showMsg('error', 'Missing Fields', 'Please fill in all required fields.'); return;
      }
      if (!isValidEmail(email)) { showMsg('error', 'Invalid Email', 'Please enter a valid email address.'); return; }
      if (password !== confirmPassword) { showMsg('error', 'Passwords Don\'t Match', 'Please make sure both password fields match.'); return; }
      if (password.length < 8) { showMsg('error', 'Weak Password', 'Password must be at least 8 characters.'); return; }
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        setLoading(false);
        if (error) {
          if (error.message.includes('Invalid login credentials'))
            showMsg('error', 'Login Failed', 'Incorrect email or password. Please try again.');
          else if (error.message.includes('Email not confirmed'))
            showMsg('error', 'Email Not Verified', 'Please confirm your email before signing in.');
          else showMsg('error', 'Login Error', error.message);
          return;
        }
        if (data?.session) onAuthSuccess();
        else showMsg('error', 'Login Failed', 'Unable to sign in. Please try again.');
      } else {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName, role, district, state: userState, phone } },
        });
        if (signUpError) { setLoading(false); showMsg('error', 'Sign Up Error', signUpError.message); return; }
        if (signUpData?.user) {
          if (signUpData.session) {
            try {
              await supabase.from('profiles').upsert({
                id: signUpData.user.id, email, full_name: fullName, role,
                phone: phone || null, district: district || null, state: userState || null,
                is_active: true, created_at: new Date().toISOString(),
              }, { onConflict: 'id' });
              await new Promise(r => setTimeout(r, 500));
            } catch {}
            setLoading(false);
            showMsg('success', 'Account Created!', 'Welcome to HealthDrop. You are now logged in.', () => onAuthSuccess());
          } else {
            setLoading(false);
            showMsg('success', 'Check Your Email', 'We sent a confirmation link to your inbox. Click it to verify your account.', () => setIsLogin(true));
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
      if (error) { showMsg('error', 'OTP Error', error.message); }
      else if (data.user) {
        const { error: pErr } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
        if (pErr?.code === 'PGRST116') {
          await supabase.from('profiles').insert({ id: data.user.id, full_name: fullName, role, district, state: userState, is_active: true, created_at: new Date().toISOString() });
        }
        setShowOtpModal(false); setShowSuccessModal(true); setOtpCode('');
      }
    } catch { showMsg('error', 'Error', 'An unexpected error occurred.'); }
    finally { setOtpLoading(false); }
  };

  const handleSuccessNext = () => {
    setShowSuccessModal(false);
    setEmail(''); setPassword(''); setConfirm(''); setFullName(''); setDistrict(''); setUserState(''); setPhone('');
    setIsLogin(true); onAuthSuccess();
  };

  const switchMode = () => {
    setIsLogin(m => !m);
    setEmail(''); setPhone(''); setPassword(''); setConfirm(''); setFullName(''); setDistrict(''); setUserState('');
  };

  // ── Render ────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Hero Header ── */}
        <LinearGradient colors={BRAND_GRADIENT} style={s.hero}>
          <View style={s.circle1} />
          <View style={s.circle2} />
          <View style={s.logoWrap}>
            <View style={s.logoBox}>
              <Image source={require('../assets/app_logo.png')} style={s.logo} resizeMode="contain" />
            </View>
          </View>
          <Text style={s.heroTitle}>HealthDrop</Text>
          <Text style={s.heroSub}>Public Health Surveillance System</Text>

          {/* Tab switcher */}
          <View style={s.tabBar}>
            {(['Sign In', 'Sign Up'] as const).map((label, i) => {
              const active = (i === 0) === isLogin;
              return (
                <TouchableOpacity key={label} style={[s.tab, active && s.tabActive]} onPress={() => i === 0 ? setIsLogin(true) : setIsLogin(false)}>
                  <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </LinearGradient>

        {/* ── Dark Form Card (Uiverse style) ── */}
        <View style={s.card}>
          <Text style={s.heading}>{isLogin ? 'Login' : 'Sign Up'}</Text>

          {isLogin ? (
            /* ── SIGN IN ─────────────────────────── */
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
                    <Ionicons name={showPw ? 'eye-off' : 'eye'} size={18} color="#6b7280" />
                  </TouchableOpacity>
                }
              />

              {/* Action buttons */}
              <View style={s.btnRow}>
                <TouchableOpacity style={s.btn1} onPress={handleAuth} disabled={loading}>
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.btnText}>&nbsp;&nbsp;Login&nbsp;&nbsp;</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.btn2} onPress={switchMode}>
                  <Text style={s.btnText}>Sign Up</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={s.btn3}>
                <Text style={s.btn3Text}>Forgot Password</Text>
              </TouchableOpacity>
            </>
          ) : (
            /* ── SIGN UP ─────────────────────────── */
            <>
              <Field icon="person" value={fullName} onChange={setFullName} placeholder="Full name" autoCapitalize="words" />
              <Field icon="at" value={email} onChange={setEmail} placeholder="Email address" keyboardType="email-address" autoComplete="email" />
              <Field icon="call" value={phone} onChange={setPhone} placeholder="Phone (optional)" keyboardType="phone-pad" autoComplete="tel" />

              {/* Role selector */}
              <View style={s.roleWrap}>
                {SIGNUP_ROLES.map(r => {
                  const active = role === r.value;
                  return (
                    <TouchableOpacity
                      key={r.value}
                      style={[s.roleRow, active && s.roleRowActive]}
                      onPress={() => setRole(r.value)}
                    >
                      <View style={[s.roleIcon, active && s.roleIconActive]}>
                        <Ionicons name={r.icon as any} size={16} color={active ? '#fff' : '#9ca3af'} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.roleLabel, active && s.roleLabelActive]}>{r.label}</Text>
                        <Text style={s.roleDesc}>{r.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={18} color="#3b82f6" />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Location section */}
              <View style={s.locationHeader}>
                <Text style={s.locationLabel}>Location</Text>
                <TouchableOpacity style={s.gpsBtn} onPress={fetchLocation} disabled={fetchingLocation}>
                  {fetchingLocation
                    ? <ActivityIndicator size="small" color="#3b82f6" />
                    : <><Ionicons name="locate" size={14} color="#3b82f6" /><Text style={s.gpsBtnText}>Auto-fill GPS</Text></>
                  }
                </TouchableOpacity>
              </View>

              <Field icon="business" value={district} onChange={setDistrict} placeholder="District / City" autoCapitalize="words" />
              <StatesDropdown value={userState} onSelect={setUserState} />

              {/* Password */}
              <View style={s.pwSection}>
                <Field
                  icon="lock-closed"
                  value={password}
                  onChange={setPassword}
                  placeholder="Create password (min 8 chars)"
                  secure={!showPw}
                  autoComplete="new-password"
                  rightElement={
                    <TouchableOpacity onPress={() => setShowPw(p => !p)} style={{ padding: 4 }}>
                      <Ionicons name={showPw ? 'eye-off' : 'eye'} size={18} color="#6b7280" />
                    </TouchableOpacity>
                  }
                />
                <Field
                  icon="lock-closed"
                  value={confirmPassword}
                  onChange={setConfirm}
                  placeholder="Confirm password"
                  secure={!showCPw}
                  autoComplete="new-password"
                  rightElement={
                    <TouchableOpacity onPress={() => setShowCPw(p => !p)} style={{ padding: 4 }}>
                      <Ionicons name={showCPw ? 'eye-off' : 'eye'} size={18} color={confirmPassword && confirmPassword !== password ? '#ef4444' : '#6b7280'} />
                    </TouchableOpacity>
                  }
                />
                {confirmPassword.length > 0 && confirmPassword !== password && (
                  <Text style={s.pwMismatch}>Passwords don't match</Text>
                )}
              </View>

              {/* Action buttons */}
              <View style={s.btnRow}>
                <TouchableOpacity style={s.btn2} onPress={switchMode}>
                  <Text style={s.btnText}>Sign In</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btn1} onPress={handleAuth} disabled={loading}>
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.btnText}>&nbsp;Create Account&nbsp;</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Ionicons name="shield-checkmark-outline" size={13} color="#6b7280" />
          <Text style={s.footerText}>Secured by Supabase · Data encrypted at rest</Text>
        </View>
      </ScrollView>

      {/* ── OTP Modal ── */}
      <Modal visible={showOtpModal} transparent animationType="slide" onRequestClose={() => setShowOtpModal(false)}>
        <View style={mod.overlay}>
          <View style={mod.card}>
            <View style={[mod.iconWrap, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="keypad-outline" size={32} color={BRAND_PRIMARY} />
            </View>
            <Text style={mod.title}>Enter Verification Code</Text>
            <Text style={mod.sub}>We sent a 6-digit code to {userEmail}</Text>
            <TextInput style={mod.otpInput} value={otpCode} onChangeText={setOtpCode} placeholder="000000" keyboardType="numeric" maxLength={6} />
            <TouchableOpacity style={[mod.btn, otpLoading && { opacity: 0.6 }]} onPress={handleOtpVerification} disabled={otpLoading}>
              {otpLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={mod.btnText}>Verify Code</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={mod.cancel} onPress={() => setShowOtpModal(false)}>
              <Text style={mod.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Success Modal ── */}
      <Modal visible={showSuccessModal} transparent animationType="fade" onRequestClose={() => setShowSuccessModal(false)}>
        <View style={mod.overlay}>
          <View style={mod.card}>
            <View style={[mod.iconWrap, { backgroundColor: '#ECFDF5' }]}>
              <Ionicons name="checkmark-circle" size={40} color="#10B981" />
            </View>
            <Text style={mod.title}>Account Created!</Text>
            <Text style={mod.sub}>Your account has been verified. You can now start using HealthDrop.</Text>
            <TouchableOpacity style={[mod.btn, { backgroundColor: '#10B981' }]} onPress={handleSuccessNext}>
              <Text style={mod.btnText}>Get Started</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Message Modal ── */}
      <Modal visible={msgVisible} transparent animationType="fade" onRequestClose={closeMsg}>
        <View style={mod.overlay}>
          <View style={mod.card}>
            <View style={[mod.iconWrap, { backgroundColor: msgType === 'error' ? '#FEF2F2' : '#ECFDF5' }]}>
              <Ionicons name={msgType === 'error' ? 'alert-circle' : 'checkmark-circle'} size={40} color={msgType === 'error' ? '#EF4444' : '#10B981'} />
            </View>
            <Text style={mod.title}>{msgTitle}</Text>
            <Text style={mod.sub}>{msgText}</Text>
            <TouchableOpacity style={[mod.btn, { backgroundColor: msgType === 'error' ? '#EF4444' : '#10B981' }]} onPress={closeMsg}>
              <Text style={mod.btnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Main Styles ─────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f0f0f' },
  scroll: { flexGrow: 1, paddingBottom: 32 },

  // Hero
  hero:       { paddingTop: 56, paddingBottom: 44, paddingHorizontal: 24, alignItems: 'center', overflow: 'hidden' },
  circle1:    { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.05)', top: -60, right: -60 },
  circle2:    { position: 'absolute', width: 160, height: 160, borderRadius: 80,  backgroundColor: 'rgba(255,255,255,0.04)', bottom: -40, left: -40 },
  logoWrap:   { marginBottom: 14 },
  logoBox:    { width: 70, height: 70, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  logo:       { width: 50, height: 50 },
  heroTitle:  { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5, marginBottom: 4 },
  heroSub:    { fontSize: 13, color: 'rgba(255,255,255,0.68)', marginBottom: 26, textAlign: 'center' },
  tabBar:     { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, padding: 4, width: '80%' },
  tab:        { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  tabActive:  { backgroundColor: '#FFFFFF' },
  tabText:    { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  tabTextActive: { color: '#1565C0' },

  // Dark form card
  card:    { marginHorizontal: 16, marginTop: -22, backgroundColor: '#171717', borderRadius: 25, paddingHorizontal: 22, paddingVertical: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 20, elevation: 14 },
  heading: { textAlign: 'center', color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 18 },

  // Role selector
  roleWrap:       { marginBottom: 12 },
  roleRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 14, borderWidth: 1.5, borderColor: '#2d2d2d', backgroundColor: '#1f1f1f', marginBottom: 7 },
  roleRowActive:  { borderColor: '#3b82f6', backgroundColor: '#172554' },
  roleIcon:       { width: 36, height: 36, borderRadius: 10, backgroundColor: '#2d2d2d', alignItems: 'center', justifyContent: 'center' },
  roleIconActive: { backgroundColor: '#1d4ed8' },
  roleLabel:      { fontSize: 13, fontWeight: '700', color: '#d1d5db' },
  roleLabelActive:{ color: '#60a5fa' },
  roleDesc:       { fontSize: 11, color: '#6b7280', marginTop: 1 },

  // Location
  locationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  locationLabel:  { fontSize: 12, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  gpsBtn:         { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#172554', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  gpsBtnText:     { color: '#3b82f6', fontSize: 12, fontWeight: '600' },

  // Password
  pwSection:  { marginTop: 4 },
  pwMismatch: { color: '#ef4444', fontSize: 12, marginTop: -6, marginBottom: 6, marginLeft: 8 },

  // Uiverse-style buttons
  btnRow:  { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 22, marginBottom: 8 },
  btn1:    { backgroundColor: '#252525', borderRadius: 5, paddingVertical: 9, paddingHorizontal: 22 },
  btn2:    { backgroundColor: '#252525', borderRadius: 5, paddingVertical: 9, paddingHorizontal: 22 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btn3:    { alignSelf: 'center', backgroundColor: '#252525', borderRadius: 5, paddingVertical: 7, paddingHorizontal: 18, marginBottom: 8 },
  btn3Text:{ color: '#fff', fontSize: 13 },

  // Footer
  footer:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18, marginBottom: 8 },
  footerText: { fontSize: 11, color: '#4b5563' },
});

// ── Modal Styles ─────────────────────────────────────────
const mod = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:      { backgroundColor: '#1f2937', borderRadius: 24, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 24, elevation: 16 },
  iconWrap:  { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title:     { fontSize: 20, fontWeight: '800', color: '#f9fafb', textAlign: 'center', marginBottom: 8 },
  sub:       { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  otpInput:  { width: '100%', borderWidth: 2, borderColor: '#374151', borderRadius: 14, padding: 18, textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: '700', color: '#f9fafb', backgroundColor: '#111827', marginBottom: 20 },
  btn:       { backgroundColor: '#1565C0', width: '100%', paddingVertical: 15, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancel:    { marginTop: 14, padding: 10 },
  cancelText:{ color: '#6b7280', fontSize: 14, fontWeight: '500' },
});