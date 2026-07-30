import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Supabase configuration - uses environment variables with fallback
// EXPO_PUBLIC_SUPABASE_KEY is the modern publishable key (sb_publishable_...);
// EXPO_PUBLIC_SUPABASE_ANON_KEY is the legacy JWT anon key kept as fallback.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ekfdimdlxifatsaubvbh.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_pne9mF-cDQ_IPKJKn8a3AQ_Vm4Aa5x0';

// Use AsyncStorage for native, localStorage wrapper for web
const storage = Platform.OS === 'web' ? {
  getItem: (key: string) => {
    try {
      const value = localStorage.getItem(key);
      return Promise.resolve(value);
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
      return Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  },
} : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});