import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Supabase configuration - uses environment variables with fallback
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ekfdimdlxifatsaubvbh.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrZmRpbWRseGlmYXRzYXVidmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzEzMjQsImV4cCI6MjA4Njc0NzMyNH0.-9yaA0TnwOHsT9Y2xe_65gJO6MoTFD2xhb2xRe6PdRo';

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