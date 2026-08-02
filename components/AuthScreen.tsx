// =====================================================
// AUTH SCREEN — "Prakash" design system
// Flat headerBg band, ink-on-paper card, labels above
// 52dp inputs, inline field errors (no Alert.alert),
// solid-fill role selection, honest signup errors.
// In-app password recovery: 3-step email-OTP flow
// (email → emailed code → new password) on an isolated
// auth client — see lib/services/authRecovery.ts.
// Fully translated (EN/हिन्दी) with the language toggle
// in the header band — the first screen a Hindi speaker
// sees must not require English to get past (INC-06).
// Everything held in state is stored as a translation KEY
// (see MsgSpec) and resolved at render, so the toggle also
// re-languages errors that are already on screen. The one
// exception is raw SERVER text, which is shown verbatim.
// =====================================================
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
  ActivityIndicator, FlatList, SafeAreaView, StatusBar,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import {
  requestResetCode, verifyResetCode, setNewPassword, cancelRecovery,
} from '../lib/services/authRecovery';
import { setAppLanguage, type AppLanguage } from '../lib/i18n';
import { Profile } from '../types';
import { useTheme, spacing, radii } from '../lib/ThemeContext';

interface AuthScreenProps { onAuthSuccess: () => void; }

// ── Indian States ─────────────────────────────────────
/**
 * Email OTP length is a SERVER setting (Supabase → Authentication → Email
 * OTP Length), configurable from 6 to 10 digits.
 *
 * The project is now set to 6 — the shortest code a field worker has to copy
 * off a screen — and OTP_EXPECTED_LENGTH below is what the UI tells them.
 *
 * The ACCEPTED range stays 6..10 on purpose, and is deliberately wider than
 * the message. A hard-coded 6 is what broke this before: the project was
 * issuing 8-digit codes, the input silently truncated them to 6, and every
 * reset failed as "incorrect code" with nothing on screen to explain why. If
 * the server setting ever changes again, a longer code still types and still
 * verifies; only the hint goes stale, which is a copy fix rather than a
 * lockout.
 */
const OTP_MIN_LENGTH = 6;
const OTP_MAX_LENGTH = 10;
const OTP_EXPECTED_LENGTH = 6;

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
// `label` stays English in both languages: these are the account-type names
// used verbatim across the app and by district administrators. Only the
// one-line description — the part that actually explains the choice — is
// translated.
const SIGNUP_ROLES: { value: Profile['role']; label: string; icon: string; descKey: string }[] = [
  { value: 'clinic',      label: 'Clinic',       icon: 'medical',   descKey: 'auth.roles.clinicDesc' },
  { value: 'asha_worker', label: 'ASHA Worker',  icon: 'heart',     descKey: 'auth.roles.ashaDesc' },
  { value: 'volunteer',   label: 'Volunteer',    icon: 'hand-left', descKey: 'auth.roles.volunteerDesc' },
];

// ── Language toggle — EN / हिन्दी, one 48dp target each ──
// Each option is written in its own script, so it is legible to the person
// who needs it without knowing the other language.
const LANGUAGE_CHOICES: { value: AppLanguage; label: string; a11y: string }[] = [
  { value: 'en', label: 'EN',     a11y: 'English' },
  { value: 'hi', label: 'हिन्दी', a11y: 'हिन्दी' },
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

// ── Language toggle (header band) ─────────────────────
// Before this existed the only picker was in Profile — behind sign-in AND
// sign-up — so a Hindi reader had to be walked through an English form by
// someone else before she could ever change the language.
// Same mechanism as the ProfileScreen picker, deliberately: setAppLanguage()
// switches i18next and persists 'healthdrop:language', which survives
// sign-out, so the choice made here is still in force at the next cold start.
const LanguageToggle: React.FC = () => {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const current: AppLanguage = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  // Fourth state for this control: the switch can fail, and a tap that does
  // nothing at all is indistinguishable from a dead button. Previously the
  // only output was console.warn.
  const [switchFailed, setSwitchFailed] = useState(false);

  const pick = (lang: AppLanguage) => {
    if (lang === current) return;
    setSwitchFailed(false);
    setAppLanguage(lang).catch(() => {
      // changeLanguage failed — the screen stays in the current language
      // rather than half-switching, and says so. Storage failures are already
      // swallowed inside setAppLanguage (the in-session switch still worked).
      setSwitchFailed(true);
    });
  };

  return (
    <View style={s.langCol}>
      <View
        style={[s.langWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('auth.languageA11y')}
      >
        {LANGUAGE_CHOICES.map(opt => {
          const active = current === opt.value;
          return (
            <Pressable
              key={opt.value}
              style={({ pressed }) => [
                s.langBtn,
                active
                  ? { backgroundColor: colors.primaryLight }
                  : pressed && { backgroundColor: colors.cardHover },
              ]}
              onPress={() => pick(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={opt.a11y}
            >
              <Text
                style={[
                  s.langTxt,
                  {
                    // `primaryDark` is the STRONGER teal in both themes (it
                    // darkens on paper, brightens on ink), so one token clears
                    // the 7:1 body floor on the primaryLight fill in both:
                    // light 7.30:1, dark 8.03:1. The old dark-mode branch used
                    // `primary` on `primaryLight` = 6.92:1 — under the floor,
                    // and at 14px/700 this is NOT WCAG "large text", so 4.5
                    // does not apply. scripts/check-contrast.cjs now guards
                    // this pair so it cannot drift back.
                    color: active ? colors.primaryDark : colors.textSecondary,
                    fontWeight: active ? '700' : '600',
                  },
                ]}
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {switchFailed && (
        <View style={s.langErrRow} accessibilityLiveRegion="polite">
          {/* Colour carries the meaning on the icon; the sentence itself stays
              `text` because `danger` on the header band is 6.54:1 in light
              mode — under the 7:1 body floor. */}
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Text style={[s.langErrTxt, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {t('auth.languageSwitchFailed')}
          </Text>
        </View>
      )}
    </View>
  );
};

// ── Deferred message ──────────────────────────────────
// Anything held in state is stored as a translation KEY (plus params), never
// as a finished sentence. Resolving with t() at validation time froze the
// message in whatever language was active then: tapping EN/हिन्दी re-renders
// every live t() call but cannot touch a string already sitting in state, so
// the red field errors stayed English on a Hindi screen until the field was
// edited or the form resubmitted — exactly the moment she is deciding whether
// this app speaks her language. `{ text }` is the deliberate escape hatch for
// raw SERVER strings, which have no key and are shown verbatim rather than
// guessed at.
type MsgSpec =
  | { key: string; params?: Record<string, string | number> }
  | { text: string };

const msgKey = (key: string, params?: Record<string, string | number>): MsgSpec => ({ key, params });

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
  label: string; icon: string; value: string; onChange: (text: string) => void;
  placeholder: string; keyboardType?: any; secure?: boolean;
  autoCapitalize?: any; autoComplete?: any; rightElement?: React.ReactNode;
  error?: string; onLayout?: (e: LayoutChangeEvent) => void;
}> = ({ label, icon, value, onChange, placeholder, keyboardType, secure, autoCapitalize = 'none', autoComplete, rightElement, error, onLayout }) => {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.inputErrorBorder : focused ? colors.inputFocusBorder : colors.inputBorder;
  const borderWidth = error || focused ? 2 : 1.5;
  return (
    <View style={s.fieldWrap} onLayout={onLayout}>
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
  value: string; onChange: (text: string) => void;
  loading: boolean; onGPS: () => void; error?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
}> = ({ value, onChange, loading, onGPS, error, onLayout }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.inputErrorBorder : focused ? colors.inputFocusBorder : colors.inputBorder;
  const borderWidth = error || focused ? 2 : 1.5;
  return (
    <View style={s.fieldWrap} onLayout={onLayout}>
      <Text style={[s.fieldLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        {t('auth.districtLabel')}
      </Text>
      <View style={s.gpsRow}>
        <View style={[s.fieldRow, { flex: 1, backgroundColor: colors.inputBackground, borderColor, borderWidth }]}>
          <Ionicons name="business-outline" size={16} color={colors.textSecondary} />
          <TextInput
            style={[s.fieldInput, { color: colors.text }, WEB_NO_OUTLINE]}
            placeholder={t('auth.districtPlaceholder')}
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
          accessibilityLabel={t('auth.gpsA11y')}
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
const StatesDropdown: React.FC<{
  value: string; onSelect: (st: string) => void; error?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
}> = ({ value, onSelect, error, onLayout }) => {
  const { colors, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // State names themselves stay in English in both languages — they are the
  // values written to profiles.state and matched against reverse-geocoding.
  const filtered = INDIAN_STATES.filter(st => st.toLowerCase().includes(search.toLowerCase()));
  const borderColor = error ? colors.inputErrorBorder : colors.inputBorder;
  return (
    <View style={s.fieldWrap} onLayout={onLayout}>
      <Text style={[s.fieldLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
        {t('auth.stateLabel')}
      </Text>
      <TouchableOpacity
        style={[s.fieldRow, { backgroundColor: colors.inputBackground, borderColor, borderWidth: error ? 2 : 1.5 }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={value ? t('auth.changeStateA11y', { state: value }) : t('auth.selectStateA11y')}
      >
        <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
        <Text
          style={[s.fieldInput, { color: value ? colors.text : colors.placeholder }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {value || t('auth.selectState')}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
      <FieldError message={error} />

      <Modal visible={open} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[s.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={t('auth.closeStateList')}
        />
        <View style={[s.ddPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.ddHeading, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {t('auth.selectState')}
          </Text>
          <View style={[s.ddSearch, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={[s.fieldInput, { color: colors.text }, WEB_NO_OUTLINE]}
              placeholder={t('auth.searchStates')}
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
  const { t, i18n } = useTranslation();
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

  // ── Password recovery (3-step inline flow, same screen) ──
  const [resetStep, setResetStep]   = useState<'email' | 'code' | 'password' | null>(null);
  const [rEmail, setREmail]         = useState('');
  const [rCode, setRCode]           = useState('');
  const [rPw, setRPw]               = useState('');
  const [rPw2, setRPw2]             = useState('');
  const [showRPw, setShowRPw]       = useState(false);
  const [showRPw2, setShowRPw2]     = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [resendIn, setResendIn]     = useState(0);
  // A flag, not a sentence — the note re-renders in the current language.
  const [resendSent, setResendSent] = useState(false);
  // Quiet success row after a completed reset, shown on the sign-in card
  const [pwChanged, setPwChanged]   = useState(false);

  // Inline field-validation errors (spec: no alert modals for validation).
  // Keys, not sentences — see MsgSpec above.
  const [errors, setErrors] = useState<Record<string, MsgSpec>>({});
  const scrollRef = useRef<ScrollView>(null);
  // Field y-positions (relative to the card) for scroll-to-first-error
  const fieldYRef = useRef<Record<string, number>>({});
  const cardYRef = useRef(0);
  const trackY = (key: string) => (e: LayoutChangeEvent) => {
    fieldYRef.current[key] = e.nativeEvent.layout.y;
  };

  // Resend countdown — one tick per second while > 0
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(v => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Message modal — server/system responses only, never field validation
  const [msgVisible, setMsgVisible]   = useState(false);
  const [msgType, setMsgType]         = useState<'error' | 'success'>('error');
  const [msgTitle, setMsgTitle]       = useState<MsgSpec | null>(null);
  const [msgText, setMsgText]         = useState<MsgSpec | null>(null);
  const [msgCallback, setMsgCallback] = useState<(() => void) | null>(null);

  const showMsg = (type: 'error' | 'success', title: MsgSpec, text: MsgSpec, cb?: () => void) => {
    setMsgType(type); setMsgTitle(title); setMsgText(text);
    setMsgCallback(() => cb ?? null); setMsgVisible(true);
  };
  const closeMsg = () => { setMsgVisible(false); msgCallback?.(); };

  /** Resolve a stored message at RENDER time, so it follows the language toggle. */
  const say = (m?: MsgSpec | null): string | undefined =>
    m == null ? undefined : 'key' in m ? t(m.key, m.params) : m.text;

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
          showMsg('error', msgKey('auth.msgPermissionTitle'), msgKey('auth.msgPermissionBody'));
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }

      const geo = await reverseGeocode(lat, lon);
      if (!geo || (!geo.district && !geo.state)) {
        showMsg('error', msgKey('auth.msgLocationUnavailableTitle'), msgKey('auth.msgLocationUnavailableBody'));
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
      showMsg('error', msgKey('auth.msgLocationErrorTitle'), msgKey('auth.msgLocationErrorBody'));
    } finally {
      setFetchLoc(false);
    }
  };

  // ── Validation — inline errors, scroll to the FIRST errored field ──
  const scrollToFirstError = (next: Record<string, MsgSpec>, order: string[]) => {
    const first = order.find(k => next[k]);
    const fieldY = first != null ? fieldYRef.current[first] : undefined;
    const y = fieldY != null ? Math.max(0, cardYRef.current + fieldY - spacing.md) : 0;
    scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
  };

  const validate = (): boolean => {
    const next: Record<string, MsgSpec> = {};
    if (!email.trim()) next.email = msgKey('auth.errEmailRequired');
    else if (!isValidEmail(email)) next.email = msgKey('auth.errEmailInvalid');
    if (!password) next.password = msgKey('auth.errPasswordRequired');
    if (!isLogin) {
      if (!fullName.trim()) next.fullName = msgKey('auth.errNameRequired');
      if (password && password.length < 8) next.password = msgKey('auth.errPasswordShort');
      if (password && confirmPw !== password) next.confirmPw = msgKey('auth.errPasswordMismatch');
      if (!district.trim()) next.district = msgKey('auth.errDistrictRequired');
      if (!userState) next.state = msgKey('auth.errStateRequired');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      scrollToFirstError(
        next,
        isLogin
          ? ['email', 'password']
          : ['fullName', 'email', 'district', 'state', 'password', 'confirmPw'],
      );
      return false;
    }
    return true;
  };

  // ── Password recovery handlers ────────────────────────
  const resetRecoveryState = () => {
    setRCode(''); setRPw(''); setRPw2('');
    setShowRPw(false); setShowRPw2(false);
    setResendIn(0); setResendSent(false);
    setErrors({});
  };

  const openReset = () => {
    setResetStep('email');
    setREmail(email.trim());
    setPwChanged(false);
    resetRecoveryState();
  };

  const exitReset = () => {
    cancelRecovery(); // drops any half-finished recovery session (best-effort)
    setResetStep(null);
    resetRecoveryState();
  };

  const handleSendCode = async (isResend: boolean) => {
    if (!rEmail.trim()) { setErrors({ rEmail: msgKey('auth.errEmailRequired') }); return; }
    if (!isValidEmail(rEmail.trim())) { setErrors({ rEmail: msgKey('auth.errEmailInvalid') }); return; }
    setLoading(true);
    const res = await requestResetCode(rEmail);
    setLoading(false);
    if (!res.ok) {
      // Same surface the user is looking at: email field on step 1,
      // under the code input on a resend.
      const failure = msgKey(res.messageKey);
      setErrors(isResend ? { rCode: failure } : { rEmail: failure });
      return;
    }
    setErrors({});
    setResendIn(60);
    if (isResend) {
      setResendSent(true);
    } else {
      setRCode('');
      setResendSent(false);
      setResetStep('code');
    }
  };

  const handleVerifyCode = async () => {
    const code = rCode.trim();
    // Length is a SERVER setting (Supabase Auth "Email OTP Length", 6-10).
    // Hard-coding 6 here locked users out whenever the project was configured
    // for longer codes — the field silently truncated an 8-digit email code to
    // 6 and every attempt failed. Accept whatever the server issues.
    if (!new RegExp(`^\\d{${OTP_MIN_LENGTH},${OTP_MAX_LENGTH}}$`).test(code)) {
      // Accept 6..10, but name the length the server actually issues — being
      // told "6–10 digits" when every code is 6 reads like the app is unsure.
      setErrors({ rCode: msgKey('auth.errCodeFormat', { n: OTP_EXPECTED_LENGTH }) });
      return;
    }
    setLoading(true);
    const res = await verifyResetCode(rEmail, code);
    setLoading(false);
    if (!res.ok) { setErrors({ rCode: msgKey(res.messageKey) }); return; }
    setErrors({});
    setResendSent(false);
    setResetStep('password');
  };

  const handleSetNewPassword = async () => {
    const next: Record<string, MsgSpec> = {};
    if (!rPw) next.rPw = msgKey('auth.errPasswordRequired');
    else if (rPw.length < 8) next.rPw = msgKey('auth.errPasswordShort');
    if (rPw && rPw2 !== rPw) next.rPw2 = msgKey('auth.errPasswordMismatch');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setLoading(true);
    const res = await setNewPassword(rPw);
    setLoading(false);
    if (!res.ok) { setErrors({ rPw: msgKey(res.messageKey) }); return; }
    // The service signed the temporary recovery session out — the normal
    // sign-in flow now completes with the new password.
    setEmail(rEmail.trim());
    setPassword('');
    setResetStep(null);
    resetRecoveryState();
    setIsLogin(true);
    setPwChanged(true);
    scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion });
  };

  // ── Auth ──────────────────────────────────────────────
  const handleAuth = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setLoading(false);
          if (error.message.includes('Invalid login credentials'))
            showMsg('error', msgKey('auth.msgLoginFailedTitle'), msgKey('auth.msgLoginFailedBody'));
          else if (error.message.includes('Email not confirmed'))
            showMsg('error', msgKey('auth.msgEmailUnverifiedTitle'), msgKey('auth.msgEmailUnverifiedBody'));
          // Unrecognised server text is shown verbatim, in English — a
          // translated guess about an unknown failure would be a lie.
          else showMsg('error', msgKey('auth.msgLoginErrorTitle'), { text: error.message });
          return;
        }
        if (data?.session) {
          // Deactivated accounts get a human next step, not a dead end.
          // App-level auth still owns the actual sign-out; this check only
          // adds the message (and fails open if the lookup itself fails).
          let deactivated = false;
          try {
            const { data: prof } = await supabase
              .from('profiles')
              .select('is_active')
              .eq('id', data.session.user.id)
              .maybeSingle();
            deactivated = prof?.is_active === false;
          } catch { /* fail open */ }
          setLoading(false);
          if (deactivated) {
            showMsg('error', msgKey('auth.msgDeactivatedTitle'), msgKey('auth.msgDeactivatedBody'));
            return;
          }
          onAuthSuccess();
        } else {
          setLoading(false);
          showMsg('error', msgKey('auth.msgLoginFailedTitle'), msgKey('auth.msgSignInUnavailableBody'));
        }
      } else {
        const { data: sd, error: se } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName, role, district, state: userState, phone, pincode } },
        });
        if (se) { setLoading(false); showMsg('error', msgKey('auth.msgSignUpErrorTitle'), { text: se.message }); return; }
        if (sd?.user) {
          if (sd.session) {
            // Surface the profile write honestly — never pretend success.
            //
            // preferred_language records the choice made on THIS screen so the
            // account starts out matching the toggle instead of the 'en'
            // column default. It does NOT drive what Profile shows: that reads
            // AsyncStorage (ProfileScreen.tsx:149-157, the same key
            // setAppLanguage writes), so the toggle already survives to the
            // next screen and the next cold start without this column.
            // That is the WHOLE of what it does today: verified 2026-08-02 on
            // ekfdimdlxifatsaubvbh, NOTHING server-side reads this column —
            // 0 functions/procedures, 0 views and 0 RLS policies mention it,
            // and none of the four deployed edge functions
            // (push-notifications, openrouter-proxy, delete-account,
            // bright-action) do either. push-notifications takes its title and
            // body straight from the caller. An earlier version of this comment
            // claimed pushes would "reach her in the language she signed up
            // in"; they will not until something actually reads the column, so
            // the claim is gone rather than left here as decoration.
            const { error: profileError } = await supabase.from('profiles').upsert({
              id: sd.user.id, email, full_name: fullName, role,
              phone: phone || null, district: district || null,
              state: userState || null, is_active: true, created_at: new Date().toISOString(),
              preferred_language: i18n.language?.startsWith('hi') ? 'hi' : 'en',
            }, { onConflict: 'id' });
            if (profileError) {
              setLoading(false);
              showMsg(
                'error',
                msgKey('auth.msgProfileNotSavedTitle'),
                msgKey('auth.msgProfileNotSavedBody', { reason: profileError.message }),
                () => setIsLogin(true)
              );
              return;
            }
            await new Promise(r => setTimeout(r, 500));
            setLoading(false);
            showMsg('success', msgKey('auth.msgAccountCreatedTitle'), msgKey('auth.msgAccountCreatedBody'), () => onAuthSuccess());
          } else {
            setLoading(false);
            showMsg('success', msgKey('auth.msgCheckEmailTitle'), msgKey('auth.msgCheckEmailBody'), () => setIsLogin(true));
          }
        } else {
          setLoading(false);
          showMsg('error', msgKey('auth.msgSignUpErrorTitle'), msgKey('auth.msgSignUpErrorBody'));
        }
      }
    } catch {
      setLoading(false);
      showMsg('error', msgKey('auth.msgUnexpectedTitle'), msgKey('auth.msgUnexpectedBody'));
    }
  };

  const switchMode = (login: boolean) => {
    if (resetStep) cancelRecovery(); // abandoning recovery mid-flow
    setResetStep(null);
    resetRecoveryState();
    setPwChanged(false);
    setIsLogin(login);
    setErrors({});
    setEmail(''); setPassword(''); setConfirmPw(''); setFullName('');
    setDistrict(''); setUserState(''); setPincode(''); setPhone('');
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so header ink is plain `text` / `textSecondary` in BOTH modes.
  // ── Render ────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.root, { backgroundColor: colors.background }]}>
      {/* The header band is the same paper as the canvas in light mode, so the
          status bar must carry dark icons there and light icons in dark mode. */}
      {Platform.OS === 'ios' && <ExpoStatusBar style={isDark ? 'light' : 'dark'} />}
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* ── Header band — surface + 1px hairline (both modes) ── */}
        <View
          style={[
            s.header,
            { backgroundColor: colors.headerBg, borderBottomWidth: 1, borderBottomColor: colors.border },
          ]}
        >
          <View style={s.headerRow}>
            <View style={s.headerTextWrap}>
              {/* Product name — never translated */}
              <Text style={[s.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                HealthDrop
              </Text>
              <Text style={[s.headerSub, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {t('auth.tagline')}
              </Text>
            </View>
            <LanguageToggle />
          </View>
        </View>

        {/* ── Sign In / Sign Up switcher ── */}
        <View style={[s.topBar, { borderBottomColor: colors.border }]}>
          {(['signIn', 'signUp'] as const).map((key, i) => {
            const active = (i === 0) === isLogin;
            const label = t(`auth.${key}`);
            return (
              <TouchableOpacity
                key={key}
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
          <View
            style={[s.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}
            onLayout={(e) => { cardYRef.current = e.nativeEvent.layout.y; }}
          >
            {/* Quiet success row after a completed password reset */}
            {pwChanged && !resetStep && isLogin && (
              <View style={[s.successRow, { backgroundColor: colors.successLight, borderColor: colors.success }]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={[s.successRowTxt, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.passwordChanged')}
                </Text>
              </View>
            )}

            {resetStep && (
              <TouchableOpacity
                style={s.backRow}
                onPress={exitReset}
                accessibilityRole="button"
                accessibilityLabel={t('auth.backToSignIn')}
              >
                <Ionicons name="arrow-back" size={18} color={colors.textSecondary} />
                <Text style={[s.backTxt, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.backToSignIn')}
                </Text>
              </TouchableOpacity>
            )}

            {resetStep && (
              <Text style={[s.sectionLabel, { color: colors.textTertiary, marginTop: 0 }]} maxFontSizeMultiplier={1.3}>
                {t('auth.stepOf', { n: resetStep === 'email' ? 1 : resetStep === 'code' ? 2 : 3 })}
              </Text>
            )}

            <Text style={[s.heading, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {resetStep
                ? t('auth.resetHeading')
                : isLogin ? t('auth.signInHeading') : t('auth.signUpHeading')}
            </Text>

            {resetStep === 'email' ? (
              /* ══ RECOVERY 1/3 — EMAIL ═════════════════ */
              <>
                <Text style={[s.disclosure, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.resetEmailHelp')}
                </Text>
                <LabeledField
                  label={t('auth.emailLabel')} icon="at-outline" value={rEmail}
                  onChange={(txt) => { setREmail(txt); clearError('rEmail'); }}
                  placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoComplete="email"
                  error={say(errors.rEmail)}
                />
              </>

            ) : resetStep === 'code' ? (
              /* ══ RECOVERY 2/3 — CODE ══════════════════ */
              <>
                <Text style={[s.disclosure, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.codeSentTo', { email: rEmail.trim() })}
                </Text>
                <View style={s.fieldWrap}>
                  <Text style={[s.fieldLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    {t('auth.codeLabel')}
                  </Text>
                  <TextInput
                    style={[
                      s.codeInput,
                      {
                        color: colors.text,
                        backgroundColor: colors.inputBackground,
                        borderColor: errors.rCode
                          ? colors.inputErrorBorder
                          : codeFocused ? colors.inputFocusBorder : colors.inputBorder,
                        borderWidth: errors.rCode || codeFocused ? 2 : 1.5,
                      },
                      WEB_NO_OUTLINE,
                    ]}
                    value={rCode}
                    onChangeText={(txt) => { setRCode(txt.replace(/\D/g, '').slice(0, OTP_MAX_LENGTH)); clearError('rCode'); }}
                    placeholder="••••••"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="number-pad"
                    maxLength={OTP_MAX_LENGTH}
                    textContentType="oneTimeCode"
                    onFocus={() => setCodeFocused(true)}
                    onBlur={() => setCodeFocused(false)}
                    accessibilityLabel={t('auth.codeLabel')}
                  />
                  <FieldError message={say(errors.rCode)} />
                </View>
                {resendSent && (
                  <View style={s.errorRow}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                    <Text style={[s.errorText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                      {t('auth.resendSent')}
                    </Text>
                  </View>
                )}
                <Text style={[s.disclosure, { color: colors.textTertiary, marginTop: spacing.xs }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.spamHint')}
                </Text>
                <TouchableOpacity
                  style={s.resendBtn}
                  onPress={() => handleSendCode(true)}
                  disabled={resendIn > 0 || loading}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: resendIn > 0 || loading }}
                  accessibilityLabel={resendIn > 0 ? t('auth.resendInA11y', { n: resendIn }) : t('auth.resend')}
                >
                  <Text
                    style={[s.resendTxt, { color: resendIn > 0 ? colors.textTertiary : colors.primary }]}
                    maxFontSizeMultiplier={1.3}
                  >
                    {resendIn > 0 ? t('auth.resendIn', { n: resendIn }) : t('auth.resend')}
                  </Text>
                </TouchableOpacity>
              </>

            ) : resetStep === 'password' ? (
              /* ══ RECOVERY 3/3 — NEW PASSWORD ══════════ */
              <>
                <Text style={[s.disclosure, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.newPasswordHelp')}
                </Text>
                <LabeledField
                  label={t('auth.newPasswordLabel')} icon="lock-closed-outline" value={rPw}
                  onChange={(txt) => { setRPw(txt); clearError('rPw'); }}
                  placeholder={t('auth.newPasswordPlaceholder')} secure={!showRPw} autoComplete="new-password"
                  error={say(errors.rPw)}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowRPw(p => !p)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={showRPw ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      <Ionicons name={showRPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
                <LabeledField
                  label={t('auth.confirmNewPasswordLabel')} icon="lock-closed-outline" value={rPw2}
                  onChange={(txt) => { setRPw2(txt); clearError('rPw2'); }}
                  placeholder={t('auth.confirmNewPasswordPlaceholder')} secure={!showRPw2} autoComplete="new-password"
                  error={say(errors.rPw2) || (rPw2.length > 0 && rPw2 !== rPw ? t('auth.errPasswordMismatch') : undefined)}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowRPw2(p => !p)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={showRPw2 ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      <Ionicons name={showRPw2 ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
              </>

            ) : isLogin ? (
              /* ══ SIGN IN ══════════════════════════════ */
              <>
                <LabeledField
                  label={t('auth.emailLabel')} icon="at-outline" value={email}
                  onChange={(txt) => { setEmail(txt); clearError('email'); }}
                  placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoComplete="email"
                  error={say(errors.email)}
                  onLayout={trackY('email')}
                />
                <LabeledField
                  label={t('auth.passwordLabel')} icon="lock-closed-outline" value={password}
                  onChange={(txt) => { setPassword(txt); clearError('password'); }}
                  placeholder={t('auth.passwordPlaceholder')} secure={!showPw} autoComplete="password"
                  error={say(errors.password)}
                  onLayout={trackY('password')}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowPw(p => !p)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
                <TouchableOpacity
                  style={s.forgotBtn}
                  onPress={openReset}
                  accessibilityRole="button"
                  accessibilityLabel={t('auth.forgotA11y')}
                >
                  <Text style={[s.forgotTxt, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                    {t('auth.forgot')}
                  </Text>
                </TouchableOpacity>
              </>

            ) : (
              /* ══ SIGN UP ══════════════════════════════ */
              <>
                <LabeledField
                  label={t('auth.fullNameLabel')} icon="person-outline" value={fullName}
                  onChange={(txt) => { setFullName(txt); clearError('fullName'); }}
                  placeholder={t('auth.fullNamePlaceholder')} autoCapitalize="words"
                  error={say(errors.fullName)}
                  onLayout={trackY('fullName')}
                />
                <LabeledField
                  label={t('auth.emailLabel')} icon="at-outline" value={email}
                  onChange={(txt) => { setEmail(txt); clearError('email'); }}
                  placeholder={t('auth.emailPlaceholder')} keyboardType="email-address" autoComplete="email"
                  error={say(errors.email)}
                  onLayout={trackY('email')}
                />
                <LabeledField
                  label={t('auth.phoneLabel')} icon="call-outline" value={phone}
                  onChange={setPhone}
                  placeholder={t('auth.phonePlaceholder')} keyboardType="phone-pad" autoComplete="tel"
                />

                {/* Role */}
                <Text style={[s.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.roleSection')}
                </Text>
                <Text style={[s.disclosure, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.roleNote')}
                </Text>
                <View style={s.roleWrap}>
                  {SIGNUP_ROLES.map(r => {
                    const active = role === r.value;
                    const desc = t(r.descKey);
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
                        accessibilityLabel={t('auth.roleA11y', { role: r.label, desc })}
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
                            {desc}
                          </Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={20} color={colors.onPrimary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Location */}
                <Text style={[s.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.locationSection')}
                </Text>
                <Text style={[s.disclosure, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.locationNote')}
                </Text>
                <DistrictField
                  value={district}
                  onChange={(txt) => { setDistrict(txt); clearError('district'); }}
                  loading={fetchingLoc}
                  onGPS={fetchLocation}
                  error={say(errors.district)}
                  onLayout={trackY('district')}
                />
                <StatesDropdown
                  value={userState}
                  onSelect={(st) => { setUserState(st); clearError('state'); }}
                  error={say(errors.state)}
                  onLayout={trackY('state')}
                />
                <LabeledField
                  label={t('auth.pincodeLabel')} icon="pin-outline" value={pincode}
                  onChange={setPincode}
                  placeholder={t('auth.pincodePlaceholder')} keyboardType="numeric"
                />

                {/* Password */}
                <Text style={[s.sectionLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {t('auth.passwordSection')}
                </Text>
                <LabeledField
                  label={t('auth.passwordLabel')} icon="lock-closed-outline" value={password}
                  onChange={(txt) => { setPassword(txt); clearError('password'); }}
                  placeholder={t('auth.createPasswordPlaceholder')} secure={!showPw} autoComplete="new-password"
                  error={say(errors.password)}
                  onLayout={trackY('password')}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowPw(p => !p)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  }
                />
                <LabeledField
                  label={t('auth.confirmPasswordLabel')} icon="lock-closed-outline" value={confirmPw}
                  onChange={(txt) => { setConfirmPw(txt); clearError('confirmPw'); }}
                  placeholder={t('auth.confirmPasswordPlaceholder')} secure={!showCPw} autoComplete="new-password"
                  error={say(errors.confirmPw) || (confirmPw.length > 0 && confirmPw !== password ? t('auth.errPasswordMismatch') : undefined)}
                  onLayout={trackY('confirmPw')}
                  rightElement={
                    <TouchableOpacity
                      onPress={() => setShowCPw(p => !p)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={showCPw ? t('auth.hidePassword') : t('auth.showPassword')}
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
              onPress={
                resetStep === 'email' ? () => handleSendCode(false)
                : resetStep === 'code' ? handleVerifyCode
                : resetStep === 'password' ? handleSetNewPassword
                : handleAuth
              }
              disabled={loading}
              accessibilityRole="button"
              // Sentence-case action labels, separate from the Title-Case
              // button text: screen readers announce these, and the e2e login
              // driver matches [aria-label="Sign in"] exactly.
              accessibilityLabel={
                resetStep === 'email' ? t('auth.a11ySendCode')
                : resetStep === 'code' ? t('auth.a11yVerifyCode')
                : resetStep === 'password' ? t('auth.a11ySetNewPassword')
                : isLogin ? t('auth.a11ySignIn') : t('auth.a11yCreateAccount')
              }
            >
              {loading
                ? <ActivityIndicator size="small" color={colors.onPrimary} />
                : (
                  <Text style={[s.submitTxt, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                    {resetStep === 'email' ? t('auth.sendCode')
                      : resetStep === 'code' ? t('auth.verifyCode')
                      : resetStep === 'password' ? t('auth.setNewPassword')
                      : isLogin ? t('auth.signIn') : t('auth.createAccount')}
                  </Text>
                )}
            </Pressable>
          </View>

          {/* Footer */}
          <View style={s.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textTertiary} />
            <Text style={[s.footerTxt, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
              {t('auth.footer')}
            </Text>
          </View>
        </ScrollView>

        {/* ── Message Modal — server/system responses only ── */}
        <Modal visible={msgVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={closeMsg}>
          <View style={[s.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[s.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons
                name={msgType === 'error' ? 'alert-circle' : 'checkmark-circle'}
                size={48}
                color={msgType === 'error' ? colors.danger : colors.success}
                style={{ marginBottom: spacing.md }}
              />
              <Text style={[s.modalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {say(msgTitle)}
              </Text>
              <Text style={[s.modalSub, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                {say(msgText)}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  s.modalBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                ]}
                onPress={closeMsg}
                accessibilityRole="button"
                accessibilityLabel={t('common.ok')}
              >
                <Text style={[s.submitTxt, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {t('common.ok')}
                </Text>
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
    // Android has no safe-area inset here (RN's SafeAreaView is iOS-only), so the
    // status-bar height is added manually; iOS already gets its inset from SafeAreaView.
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? spacing.xl) + spacing.sm : spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub:   { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },

  /* Language toggle — segmented, one 48dp target per language */
  langCol: { alignItems: 'flex-end' },
  langWrap: {
    flexDirection: 'row',
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  langBtn: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  langTxt: { fontSize: 14, lineHeight: 20 },
  /* Capped at 152 so the failure line cannot squeeze "HealthDrop" out of the
     header: at the 360dp floor that still leaves 164dp for the title block
     (328 content − 12 gap − 152). Deliberately NOT numberOfLines-clamped —
     truncating an error message is its own failure; the band grows instead. */
  langErrRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginTop: spacing.xs, maxWidth: 152,
  },
  langErrTxt: { fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },

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

  /* Forgot password — 48dp target, right-aligned under the field */
  forgotBtn: {
    alignSelf: 'flex-end',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    marginTop: -spacing.sm,
  },
  forgotTxt: { fontSize: 14, lineHeight: 20, fontWeight: '700' },

  /* Recovery flow */
  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingRight: spacing.sm,
  },
  backTxt: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  codeInput: {
    borderRadius: radii.md,
    minHeight: 64,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: 10,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  resendBtn: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  resendTxt: { fontSize: 14, lineHeight: 20, fontWeight: '700' },

  /* Quiet success row (post-reset) */
  successRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radii.md, borderWidth: 1,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  successRowTxt: { fontSize: 13, lineHeight: 18, fontWeight: '600', flexShrink: 1 },

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
