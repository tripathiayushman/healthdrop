// =====================================================
// HEALTH DROP SURVEILLANCE SYSTEM - MAIN APP
// =====================================================
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Platform, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './lib/supabase';
import { ThemeProvider, useTheme } from './lib/ThemeContext';
import AuthScreen from './components/AuthScreen';
import { Session } from '@supabase/supabase-js';
import { Profile } from './types';
import { offlineSyncService } from './src/services/offlineSync/OfflineSyncService';
import { usersService } from './lib/services';

// Import Main Dashboard with Navigation
import MainApp from './components/MainApp';

function AppContent() {
  const { colors } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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

    // Start offline sync service — reconnects on network restore
    offlineSyncService.start();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      offlineSyncService.stop();
    };
  }, []);

  const fetchProfile = async (userId: string, retryCount = 0) => {
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
        // Retry up to 3 times if profile not found (might be race condition from signup)
        if (retryCount < 3) {
          console.log(`Profile not found, retrying... (${retryCount + 1}/3)`);
          return fetchProfile(userId, retryCount + 1);
        }
      } else if (data) {
        // Block deactivated / deleted users
        if (!data.is_active) {
          console.warn('[Auth] Deactivated user tried to login:', userId);
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          Alert.alert(
            'Account Deactivated',
            'Your account has been deactivated by an administrator. Please contact support if you believe this is an error.'
          );
          return;
        }
        setProfile(data);
        // Register Expo push token silently after login (physical device only)
        registerPushToken();
      } else {
        // Profile doesn't exist — retry in case of signup race condition
        if (retryCount < 3) {
          console.log(`Profile not found, retrying... (${retryCount + 1}/3)`);
          return fetchProfile(userId, retryCount + 1);
        }
        setProfile(null);
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
    } finally {
      setLoading(false);
    }
  };

  // Register Expo push token — runs silently in background
  const registerPushToken = async () => {
    // Only works on physical devices, not simulators or web
    if (Platform.OS === 'web') return;
    try {
      const Notifications = await import('expo-notifications').catch(() => null);
      if (!Notifications) return;
      const { status } = await Notifications.getPermissionsAsync();
      const finalStatus = status !== 'granted'
        ? (await Notifications.requestPermissionsAsync()).status
        : status;
      if (finalStatus !== 'granted') return;
      const tokenData = await Notifications.getExpoPushTokenAsync();
      await usersService.registerExpoPushToken(tokenData.data);
    } catch (err) {
      console.warn('[Push] Token registration skipped:', err);
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
      // Always clear state to redirect to sign in
      setSession(null);
      setProfile(null);
    }
  };

  const handleProfileUpdate = (updatedProfile: Profile) => {
    setProfile(updatedProfile);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.loadingCard, { backgroundColor: colors.card }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.primary }]}>Loading HealthDrop...</Text>
        </View>
      </View>
    );
  }

  if (!session) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  // No ProfileSetup screen — signup collects everything.
  // If somehow profile is null, user was already signed out above.
  if (!profile) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <MainApp 
      profile={profile}
      onSignOut={handleSignOut}
      onProfileUpdate={handleProfileUpdate}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
      <StatusBar style="auto" />
    </ThemeProvider>
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
