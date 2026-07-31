// =====================================================
// HEALTH DROP SURVEILLANCE SYSTEM - MAIN APP
// =====================================================
import './global.css';
import './lib/i18n';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ActivityIndicator,
  Platform,
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './lib/supabase';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './lib/ThemeContext';
import AuthScreen from './components/AuthScreen';
import ErrorBoundary, { installGlobalErrorHooks } from './components/ErrorBoundary';
import { Session } from '@supabase/supabase-js';
import { Profile } from './types';
import { offlineSyncService } from './src/services/offlineSync/OfflineSyncService';
import { setupPushChannelsAndHandler } from './src/services/pushSetup';
import { usersService } from './lib/services';

// Import Main Dashboard with Navigation
import MainApp from './components/MainApp';

// Install global JS error hooks as early as possible (before first render)
// so fatal errors outside React's render tree leave a trace instead of a
// silent white screen.
installGlobalErrorHooks();

const OFFLINE_SYNC_ENABLED =
  String(process.env.EXPO_PUBLIC_OFFLINE_SYNC_ENABLED ?? 'true').toLowerCase() === 'true';

const VALID_ROLES: Profile['role'][] = [
  'super_admin',
  'health_admin',
  'district_officer',
  'clinic',
  'asha_worker',
  'volunteer',
];

const LEGACY_ROLE_MAP: Record<string, Profile['role']> = {
  admin: 'health_admin',
};

const normalizeProfileRole = (role: unknown): Profile['role'] => {
  if (typeof role !== 'string') {
    return 'volunteer';
  }

  const normalized = role.trim().toLowerCase();
  const mappedRole = LEGACY_ROLE_MAP[normalized] ?? normalized;

  return VALID_ROLES.includes(mappedRole as Profile['role'])
    ? (mappedRole as Profile['role'])
    : 'volunteer';
};

// ─── Offline profile cache ───────────────────────────────
// A logged-in field user on a cold start without signal must not be dumped
// to the login screen: hydrate the last known profile instead. The
// SyncPebble already conveys offline state, so no extra UI is needed.

const PROFILE_CACHE_PREFIX = 'healthdrop:cachedProfile:';

const profileCacheKey = (userId: string) => `${PROFILE_CACHE_PREFIX}${userId}`;

const cacheProfile = (profile: Profile): void => {
  if (!profile?.id) return;
  AsyncStorage.setItem(profileCacheKey(profile.id), JSON.stringify(profile)).catch(() => {
    // Best-effort cache — never block login on storage failures.
  });
};

const readCachedProfile = async (userId: string): Promise<Profile | null> => {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Profile> | null;
    if (!parsed || typeof parsed !== 'object' || parsed.id !== userId) return null;
    return { ...parsed, role: normalizeProfileRole(parsed.role) } as Profile;
  } catch {
    return null;
  }
};

const clearCachedProfile = (userId: string | null | undefined): void => {
  if (!userId) return;
  AsyncStorage.removeItem(profileCacheKey(userId)).catch(() => {
    // Best-effort invalidation.
  });
};

/**
 * Heuristic: did this failure happen at the transport layer (not the server)?
 * Mirrors src/services/offlineSync/index.ts so both paths agree on what
 * "offline" looks like.
 */
const isNetworkishError = (error: unknown): boolean => {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('fetcherror') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('abort') ||
    message.includes('socket') ||
    message.includes('econn')
  );
};

function AppContent() {
  const { colors, isDark } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Remembered so the cached profile can be invalidated on SIGNED_OUT,
  // when the event no longer carries a session.
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 10000)
        );

        const sessionPromise = supabase.auth.getSession();
        const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]) as any;

        if (!isMounted) return;

        setSession(session);
        if (session) {
          lastUserIdRef.current = session.user.id;
          await fetchProfile(session.user.id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    // Controlled by EXPO_PUBLIC_OFFLINE_SYNC_ENABLED in .env
    if (OFFLINE_SYNC_ENABLED) {
      offlineSyncService.start();
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      setSession(session);

      if (!session) {
        const lastUserId = lastUserIdRef.current;
        lastUserIdRef.current = null;
        setProfile(null);
        setLoading(false);
        if (event === 'SIGNED_OUT') {
          // Shared devices must not leak the previous user's profile.
          clearCachedProfile(lastUserId);
        }
        return;
      }

      lastUserIdRef.current = session.user.id;

      // TOKEN_REFRESHED only needs the session state updated above — a full
      // profile refetch (with its built-in sleeps) is unnecessary.
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
        // Defer Supabase work out of the callback stack — awaiting Supabase
        // calls inside onAuthStateChange is the documented deadlock pattern.
        setTimeout(() => {
          if (isMounted) {
            fetchProfile(session.user.id);
          }
        }, 0);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (OFFLINE_SYNC_ENABLED) {
        offlineSyncService.stop();
      }
    };
  }, []);

  // Session lifecycle: keep token auto-refresh running only while the app is
  // active (Supabase's React Native guidance). After Android doze, resuming
  // triggers an immediate refresh instead of queries failing with 401.
  // Web is skipped: AppState is limited there and supabase-js manages its
  // own refresh timer in the browser.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', onAppStateChange);
    supabase.auth.startAutoRefresh();

    return () => {
      appStateSubscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  // Create the Android notification channels the server push pipeline
  // targets (and the foreground handler) before the first push arrives.
  // Guarded internally so Expo Go / missing native module never crash.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      setupPushChannelsAndHandler().catch(() => {});
    }
  }, []);

  const fetchProfile = async (userId: string, retryCount = 0): Promise<void> => {
    try {
      // Wait a bit for the profile to be created
      await new Promise(resolve => setTimeout(resolve, retryCount === 0 ? 500 : 1000));

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
        // Transport-level failure (offline cold start): hydrate the cached
        // profile instead of dumping a logged-in user to the login screen.
        if (isNetworkishError(error)) {
          const cached = await readCachedProfile(userId);
          if (cached) {
            setProfile(cached);
            return;
          }
        }
        // Retry up to 3 times if profile not found (might be race condition from signup)
        if (retryCount < 3) {
          console.log(`Profile not found, retrying... (${retryCount + 1}/3)`);
          return fetchProfile(userId, retryCount + 1);
        }
      } else if (data) {
        const normalizedRole = normalizeProfileRole((data as any).role);
        const normalizedProfile = {
          ...data,
          role: normalizedRole,
        } as Profile;

        if ((data as any).role !== normalizedRole) {
          console.warn('[Auth] Normalized legacy profile role', {
            userId,
            from: (data as any).role,
            to: normalizedRole,
          });

          // Best-effort persistence so legacy users are migrated once and permanently fixed.
          supabase
            .from('profiles')
            .update({ role: normalizedRole, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .then(({ error: roleUpdateError }) => {
              if (roleUpdateError) {
                console.warn('[Auth] Failed to persist normalized role', {
                  userId,
                  roleUpdateError,
                });
              }
            });
        }

        // Block deactivated / deleted users. No Alert here — AuthScreen
        // detects the deactivated profile at sign-in and shows its themed
        // "Account Deactivated" message; this path just signs out.
        if (!data.is_active) {
          console.warn('[Auth] Deactivated user tried to login:', userId);
          clearCachedProfile(userId);
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          return;
        }

        setProfile(normalizedProfile);
        // Persist for offline cold starts (invalidated on sign-out).
        cacheProfile(normalizedProfile);
        // Register Expo push token silently after login (physical device only)
        registerPushToken();
      } else {
        // Profile doesn't exist — retry in case of signup race condition
        if (retryCount < 3) {
          console.log(`Profile not found, retrying... (${retryCount + 1}/3)`);
          return fetchProfile(userId, retryCount + 1);
        }
        setProfile(null);
        clearCachedProfile(userId);
        // No profile after retries — sign out so user can re-register properly
        await supabase.auth.signOut();
        setSession(null);
        Alert.alert(
          'Profile Not Found',
          'No profile exists for this account. Please sign up again with all required information.'
        );
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      // Same offline fallback for thrown transport errors (e.g. timeouts).
      if (isNetworkishError(error)) {
        const cached = await readCachedProfile(userId);
        if (cached) {
          setProfile(cached);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Register Expo push token — runs silently in background
  const registerPushToken = async () => {
    // Only works on physical devices, not simulators or web
    if (Platform.OS === 'web') return;
    try {
      const ConstantsModule = await import('expo-constants').catch(() => null);
      const Constants = ConstantsModule?.default ?? ConstantsModule;
      const constantsAny = Constants as any;
      if (constantsAny?.appOwnership === 'expo') {
        // Expo Go cannot register remote push tokens on this SDK range.
        return;
      }

      const Notifications = await import('expo-notifications').catch(() => null);
      if (!Notifications) return;

      const { status } = await Notifications.getPermissionsAsync();
      const finalStatus = status !== 'granted'
        ? (await Notifications.requestPermissionsAsync()).status
        : status;
      if (finalStatus !== 'granted') return;

      const projectId =
        constantsAny?.expoConfig?.extra?.eas?.projectId ??
        constantsAny?.easConfig?.projectId;
      if (!projectId) {
        // Skip silently when projectId is not configured.
        return;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      await usersService.registerExpoPushToken(tokenData.data);
    } catch (err) {
      console.log('[Push] Token registration skipped.');
    }
  };

  const handleAuthSuccess = () => {};

  const handleProfileComplete = () => {
    if (session) {
      fetchProfile(session.user.id);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Always clear state to redirect to sign in. The SIGNED_OUT event also
      // clears the cache, but do it here too in case signOut() threw before
      // the event fired (e.g. offline sign-out).
      clearCachedProfile(lastUserIdRef.current);
      lastUserIdRef.current = null;
      setSession(null);
      setProfile(null);
    }
  };

  const handleProfileUpdate = (updatedProfile: Profile) => {
    setProfile(updatedProfile);
    cacheProfile(updatedProfile);
  };

  let content: React.ReactElement;
  if (loading) {
    content = (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.loadingCard, { backgroundColor: colors.card }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.primary }]}>Loading HealthDrop...</Text>
        </View>
      </View>
    );
  } else if (!session || !profile) {
    // No ProfileSetup screen — signup collects everything.
    // If somehow profile is null, user was already signed out above.
    content = <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  } else {
    content = (
      <MainApp
        profile={profile}
        onSignOut={handleSignOut}
        onProfileUpdate={handleProfileUpdate}
      />
    );
  }

  // Authenticated screens sit under MainApp's navy header band, so light
  // icons are correct there; the auth/loading screens are paper-light in
  // light mode and need dark icons (iOS renders them over the pale inset).
  const statusBarStyle: 'light' | 'dark' =
    isDark || (session && profile) ? 'light' : 'dark';

  return (
    <>
      {content}
      <StatusBar style={statusBarStyle} hidden={false} translucent />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingCard: {
    padding: 40,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
  },
});
