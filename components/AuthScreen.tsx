import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Dimensions,
  Modal, ActivityIndicator, Image, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { Profile } from '../types/profile';

interface AuthScreenProps { onAuthSuccess: () => void; }

const { width, height } = Dimensions.get('window');

const BRAND_PRIMARY  = '#1565C0'; // deep blue
const BRAND_ACCENT   = '#0D47A1';
const BRAND_GRADIENT: [string, string, string] = ['#1565C0', '#0D47A1', '#0A3068'];

// ── Roles available at sign-up ──────────────────────────
const SIGNUP_ROLES: { value: Profile['role']; label: string; icon: string; desc: string }[] = [
  { value: 'clinic',      label: 'Clinic',       icon: 'medical',       desc: 'Healthcare facility' },
  { value: 'asha_worker', label: 'ASHA Worker',  icon: 'heart',         desc: 'Community health worker' },
  { value: 'volunteer',   label: 'Volunteer',    icon: 'hand-left',     desc: 'Community participant' },
];

// ── Labelled input with icon ─────────────────────────────
const Field: React.FC<{
  label: string; icon: string; value: string;
  onChange: (t: string) => void; placeholder: string;
  keyboardType?: any; secure?: boolean; autoCapitalize?: any; autoComplete?: any;
}> = ({ label, icon, value, onChange, placeholder, keyboardType, secure, autoCapitalize = 'none', autoComplete }) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={field.wrap}>
      <Text style={field.label}>{label}</Text>
      <View style={[field.box, focused && field.boxFocused]}>
        <Ionicons name={icon as any} size={16} color={focused ? BRAND_PRIMARY : '#94A3B8'} style={{ marginRight: 10 }} />
        <TextInput
          style={field.input}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
};

const field = StyleSheet.create({
  wrap:       { marginBottom: 12 },
  label:      { fontSize: 12, fontWeight: '700', color: '#475569', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  box:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  boxFocused: { borderColor: BRAND_PRIMARY, backgroundColor: '#EFF6FF' },
  input:      { flex: 1, fontSize: 15, color: '#1E293B' },
});

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [fullName, setFullName]   = useState('');
  const [phone, setPhone]         = useState('');
  const [role, setRole]           = useState<Profile['role']>('volunteer');
  const [district, setDistrict]   = useState('');
  const [userState, setUserState] = useState('');
  const [loading, setLoading]     = useState(false);

  // OTP
  const [showOtpModal, setShowOtpModal]       = useState(false);
  const [otpCode, setOtpCode]                 = useState('');
  const [otpLoading, setOtpLoading]           = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [userEmail, setUserEmail]             = useState('');

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

  const handleAuth = async () => {
    if (isLogin) {
      if (!email || !password) { showMsg('error', 'Missing Fields', 'Please enter your email and password.'); return; }
      if (!isValidEmail(email)) { showMsg('error', 'Invalid Email', 'Please enter a valid email address.'); return; }
    } else {
      if (!email || !password || !fullName || !district || !userState) {
        showMsg('error', 'Missing Fields', 'Please fill in all required fields.'); return;
      }
      if (!isValidEmail(email)) { showMsg('error', 'Invalid Email', 'Please enter a valid email address.'); return; }
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
        const { data: existing, error: pErr } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
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
    setEmail(''); setPassword(''); setFullName(''); setDistrict(''); setUserState(''); setPhone('');
    setIsLogin(true); onAuthSuccess();
  };

  const switchMode = () => {
    setIsLogin(m => !m);
    setEmail(''); setPhone(''); setPassword(''); setFullName(''); setDistrict(''); setUserState('');
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Hero Header ── */}
        <LinearGradient colors={BRAND_GRADIENT} style={s.hero}>
          {/* Decorative circles */}
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

        {/* ── Form Card ── */}
        <View style={s.card}>

          {isLogin ? (
            <>
              <Text style={s.cardTitle}>Welcome back</Text>
              <Text style={s.cardSub}>Sign in to your HealthDrop account</Text>
              <Field label="Email Address" icon="mail-outline" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" />
              <Field label="Password" icon="lock-closed-outline" value={password} onChange={setPassword} placeholder="Your password" secure autoComplete="password" />
            </>
          ) : (
            <>
              <Text style={s.cardTitle}>Create account</Text>
              <Text style={s.cardSub}>Join the HealthDrop community</Text>

              <Field label="Full Name" icon="person-outline" value={fullName} onChange={setFullName} placeholder="Your full name" autoCapitalize="words" />
              <Field label="Email Address" icon="mail-outline" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" />
              <Field label="Phone Number" icon="call-outline" value={phone} onChange={setPhone} placeholder="+91 XXXXX XXXXX" keyboardType="phone-pad" autoComplete="tel" />

              {/* Role selector */}
              <View style={{ marginBottom: 12 }}>
                <Text style={field.label}>Role</Text>
                {SIGNUP_ROLES.map(r => {
                  const active = role === r.value;
                  return (
                    <TouchableOpacity
                      key={r.value}
                      style={[s.roleRow, active && s.roleRowActive]}
                      onPress={() => setRole(r.value)}
                    >
                      <View style={[s.roleIcon, active && s.roleIconActive]}>
                        <Ionicons name={r.icon as any} size={18} color={active ? '#FFFFFF' : '#64748B'} />
                      </View>
                      <View style={s.roleText}>
                        <Text style={[s.roleLabel, active && s.roleLabelActive]}>{r.label}</Text>
                        <Text style={s.roleDesc}>{r.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={BRAND_PRIMARY} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={s.row2}>
                <View style={{ flex: 1 }}>
                  <Field label="District" icon="business-outline" value={district} onChange={setDistrict} placeholder="District" autoCapitalize="words" />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Field label="State" icon="map-outline" value={userState} onChange={setUserState} placeholder="State" autoCapitalize="words" />
                </View>
              </View>

              <Field label="Password" icon="lock-closed-outline" value={password} onChange={setPassword} placeholder="Create a strong password" secure autoComplete="password" />
            </>
          )}

          {/* Submit */}
          <TouchableOpacity
            style={[s.submitBtn, loading && s.submitBtnDisabled]}
            onPress={handleAuth}
            disabled={loading}
            activeOpacity={0.85}
          >
            <LinearGradient colors={loading ? ['#94A3B8','#94A3B8'] : BRAND_GRADIENT} style={s.submitGrad}>
              {loading
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <>
                    <Ionicons name={isLogin ? 'log-in-outline' : 'person-add-outline'} size={18} color="#FFF" />
                    <Text style={s.submitText}>{isLogin ? 'Sign In' : 'Create Account'}</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>

          {/* Switch */}
          <TouchableOpacity style={s.switchRow} onPress={switchMode}>
            <Text style={s.switchText}>
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
              <Text style={s.switchLink}>{isLogin ? 'Sign Up' : 'Sign In'}</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Ionicons name="shield-checkmark-outline" size={13} color="#94A3B8" />
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
            <TextInput
              style={mod.otpInput}
              value={otpCode} onChangeText={setOtpCode}
              placeholder="000000" keyboardType="numeric" maxLength={6}
            />
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
              <Ionicons
                name={msgType === 'error' ? 'alert-circle' : 'checkmark-circle'}
                size={40} color={msgType === 'error' ? '#EF4444' : '#10B981'}
              />
            </View>
            <Text style={mod.title}>{msgTitle}</Text>
            <Text style={mod.sub}>{msgText}</Text>
            <TouchableOpacity
              style={[mod.btn, { backgroundColor: msgType === 'error' ? '#EF4444' : '#10B981' }]}
              onPress={closeMsg}
            >
              <Text style={mod.btnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Main Styles ──────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#F1F5F9' },
  scroll: { flexGrow: 1, paddingBottom: 32 },

  // Hero
  hero:       { paddingTop: 60, paddingBottom: 50, paddingHorizontal: 24, alignItems: 'center', overflow: 'hidden' },
  circle1:    { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.06)', top: -60, right: -60 },
  circle2:    { position: 'absolute', width: 160, height: 160, borderRadius: 80,  backgroundColor: 'rgba(255,255,255,0.04)', bottom: -40, left: -40 },
  logoWrap:   { marginBottom: 16 },
  logoBox:    { width: 72, height: 72, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  logo:       { width: 52, height: 52 },
  heroTitle:  { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5, marginBottom: 4 },
  heroSub:    { fontSize: 13, color: 'rgba(255,255,255,0.72)', marginBottom: 28, textAlign: 'center' },

  // Tab switcher
  tabBar:       { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 4, width: '80%' },
  tab:          { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  tabActive:    { backgroundColor: '#FFFFFF' },
  tabText:      { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  tabTextActive:{ color: BRAND_PRIMARY },

  // Form card
  card:       { marginHorizontal: 16, marginTop: -22, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#1565C0', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 10 },
  cardTitle:  { fontSize: 20, fontWeight: '800', color: '#1E293B', marginBottom: 4 },
  cardSub:    { fontSize: 13, color: '#64748B', marginBottom: 20 },

  // Role selector
  row2:           { flexDirection: 'row' },
  roleRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', marginBottom: 8 },
  roleRowActive:  { borderColor: BRAND_PRIMARY, backgroundColor: '#EFF6FF' },
  roleIcon:       { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  roleIconActive: { backgroundColor: BRAND_PRIMARY },
  roleText:       { flex: 1 },
  roleLabel:      { fontSize: 14, fontWeight: '700', color: '#334155' },
  roleLabelActive:{ color: BRAND_PRIMARY },
  roleDesc:       { fontSize: 12, color: '#94A3B8', marginTop: 1 },

  // Submit button
  submitBtn:      { marginTop: 6, borderRadius: 14, overflow: 'hidden' },
  submitBtnDisabled: { opacity: 0.7 },
  submitGrad:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  submitText:     { fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },

  // Switch
  switchRow:  { marginTop: 20, alignItems: 'center' },
  switchText: { fontSize: 14, color: '#64748B' },
  switchLink: { color: BRAND_PRIMARY, fontWeight: '700' },

  // Footer
  footer:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, marginBottom: 8 },
  footerText: { fontSize: 11, color: '#94A3B8' },
});

// ── Modal Styles ─────────────────────────────────────────
const mod = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:    { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 16 },
  iconWrap:{ width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title:   { fontSize: 20, fontWeight: '800', color: '#1E293B', textAlign: 'center', marginBottom: 8 },
  sub:     { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  otpInput:{ width: '100%', borderWidth: 2, borderColor: '#E2E8F0', borderRadius: 14, padding: 18, textAlign: 'center', fontSize: 28, letterSpacing: 10, fontWeight: '700', color: '#1E293B', backgroundColor: '#F8FAFC', marginBottom: 20 },
  btn:     { backgroundColor: BRAND_PRIMARY, width: '100%', paddingVertical: 15, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancel:  { marginTop: 14, padding: 10 },
  cancelText:{ color: '#94A3B8', fontSize: 14, fontWeight: '500' },
});