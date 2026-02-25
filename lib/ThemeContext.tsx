// =====================================================
// THEME CONTEXT - Professional Medical Theme
// =====================================================
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Professional Medical Color Palette
export const colors = {
  // Primary - Medical Blue (Trust, Professionalism)
  primary: {
    50: '#E3F2FD',
    100: '#BBDEFB',
    200: '#90CAF9',
    300: '#64B5F6',
    400: '#42A5F5',
    500: '#1976D2', // Main primary
    600: '#1565C0',
    700: '#0D47A1',
    800: '#0A3D8F',
    900: '#072B6B',
  },
  // Secondary - Teal (Health, Vitality)
  secondary: {
    50: '#E0F2F1',
    100: '#B2DFDB',
    200: '#80CBC4',
    300: '#4DB6AC',
    400: '#26A69A',
    500: '#00897B', // Main secondary
    600: '#00796B',
    700: '#00695C',
    800: '#004D40',
    900: '#003D33',
  },
  // Success - Green (Recovery, Positive)
  success: {
    50: '#E8F5E9',
    100: '#C8E6C9',
    200: '#A5D6A7',
    300: '#81C784',
    400: '#66BB6A',
    500: '#43A047',
    600: '#388E3C',
    700: '#2E7D32',
    800: '#1B5E20',
    900: '#0D3E10',
  },
  // Warning - Amber (Caution, Attention)
  warning: {
    50: '#FFF8E1',
    100: '#FFECB3',
    200: '#FFE082',
    300: '#FFD54F',
    400: '#FFCA28',
    500: '#FFB300',
    600: '#FFA000',
    700: '#FF8F00',
    800: '#FF6F00',
    900: '#E65100',
  },
  // Danger - Red (Critical, Emergency)
  danger: {
    50: '#FFEBEE',
    100: '#FFCDD2',
    200: '#EF9A9A',
    300: '#E57373',
    400: '#EF5350',
    500: '#E53935',
    600: '#D32F2F',
    700: '#C62828',
    800: '#B71C1C',
    900: '#8B0000',
  },
  // Info - Light Blue
  info: {
    50: '#E1F5FE',
    100: '#B3E5FC',
    200: '#81D4FA',
    300: '#4FC3F7',
    400: '#29B6F6',
    500: '#039BE5',
    600: '#0288D1',
    700: '#0277BD',
    800: '#01579B',
    900: '#003F6B',
  },
  // Neutral colors
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#EEEEEE',
    300: '#E0E0E0',
    400: '#BDBDBD',
    500: '#9E9E9E',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
  },
};

// Extended Theme Interface
export interface Theme {
  mode: 'light' | 'dark';
  background: string;
  surface: string;
  surfaceVariant: string;
  card: string;
  cardHover: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  primaryVariant: string;
  onPrimary: string;
  secondary: string;
  secondaryLight: string;
  onSecondary: string;
  accent: string;
  success: string;
  successLight: string;
  successBg: string;
  warning: string;
  warningLight: string;
  warningBg: string;
  error: string;
  danger: string;
  dangerLight: string;
  dangerBg: string;
  info: string;
  infoLight: string;
  infoBg: string;
  border: string;
  borderLight: string;
  borderDark: string;
  shadow: string;
  shadowMedium: string;
  shadowDark: string;
  disabled: string;
  sidebar: string;
  sidebarText: string;
  sidebarTextActive: string;
  sidebarHover: string;
  sidebarActive: string;
  navBackground: string;
  navBorder: string;
  inputBackground: string;
  inputBorder: string;
  inputFocus: string;
  placeholder: string;
  chartLine: string;
  chartArea: string;
  chartGrid: string;
  severityCritical: string;
  severityHigh: string;
  severityMedium: string;
  severityLow: string;
  waterSafe: string;
  waterModerate: string;
  waterUnsafe: string;
  waterCritical: string;
  overlay: string;
  badgeActive: string;
  badgePending: string;
  badgeInactive: string;
  elevation: {
    low: string;
    medium: string;
    high: string;
  };
  alert: string;
  campaign: string;
}

export const themes = {
  light: {
    mode: 'light' as const,
    // Backgrounds — off-white palette (easier on eyes than pure white)
    background: '#F1F5F9',
    surface: '#F8FAFC',
    surfaceVariant: '#EEF2F7',
    card: '#FFFFFF',
    cardHover: '#F8FAFC',
    
    // Text
    text: '#1E293B',
    textSecondary: '#64748B',
    textTertiary: '#94A3B8',
    textInverse: '#FFFFFF',
    
    // Primary actions
    primary: colors.primary[500],
    primaryLight: colors.primary[100],
    primaryDark: colors.primary[700],
    primaryVariant: colors.primary[600],
    onPrimary: '#FFFFFF',
    
    // Secondary
    secondary: colors.secondary[500],
    secondaryLight: colors.secondary[100],
    onSecondary: '#FFFFFF',
    
    // Accent
    accent: colors.danger[500],
    
    // Status colors
    success: colors.success[600],
    successLight: colors.success[50],
    successBg: colors.success[100],
    
    warning: colors.warning[600],
    warningLight: colors.warning[50],
    warningBg: colors.warning[100],
    
    error: colors.danger[600],
    danger: colors.danger[600],
    dangerLight: colors.danger[50],
    dangerBg: colors.danger[100],
    
    info: colors.info[600],
    infoLight: colors.info[50],
    infoBg: colors.info[100],
    
    // Borders
    border: '#E2E8F0',
    borderLight: '#F1F5F9',
    borderDark: '#CBD5E1',
    
    // Sidebar
    sidebar: '#0F172A',
    sidebarText: '#E2E8F0',
    sidebarTextActive: '#FFFFFF',
    sidebarHover: '#1E293B',
    sidebarActive: colors.primary[600],
    
    // Navigation
    navBackground: '#F8FAFC',
    navBorder: '#E2E8F0',
    
    // Input
    inputBackground: '#F1F5F9',
    inputBorder: '#CBD5E1',
    inputFocus: colors.primary[500],
    placeholder: '#94A3B8',
    
    // Charts
    chartLine: colors.primary[500],
    chartArea: colors.primary[100],
    chartGrid: '#E2E8F0',
    
    // Severity indicators
    severityCritical: colors.danger[600],
    severityHigh: colors.warning[600],
    severityMedium: colors.warning[500],
    severityLow: colors.success[600],
    
    // Water quality
    waterSafe: colors.success[600],
    waterModerate: colors.warning[500],
    waterUnsafe: colors.danger[500],
    waterCritical: colors.danger[700],
    
    // Shadow
    shadow: 'rgba(15, 23, 42, 0.08)',
    shadowMedium: 'rgba(15, 23, 42, 0.12)',
    shadowDark: 'rgba(15, 23, 42, 0.16)',
    
    // Overlay
    overlay: 'rgba(15, 23, 42, 0.5)',
    
    // Status badges
    badgeActive: colors.success[500],
    badgePending: colors.warning[500],
    badgeInactive: colors.gray[500],
    
    disabled: '#94A3B8',
    elevation: {
      low: 'rgba(0,0,0,0.1)',
      medium: 'rgba(0,0,0,0.2)',
      high: 'rgba(0,0,0,0.3)',
    },
    alert: colors.danger[500],
    campaign: colors.success[500],
  } as Theme,
  
  dark: {
    mode: 'dark' as const,
    // Backgrounds
    background: '#0F172A',
    surface: '#1E293B',
    surfaceVariant: '#334155',
    card: '#1E293B',
    cardHover: '#334155',
    
    // Text
    text: '#F1F5F9',
    textSecondary: '#94A3B8',
    textTertiary: '#64748B',
    textInverse: '#0F172A',
    
    // Primary actions
    primary: colors.primary[400],
    primaryLight: colors.primary[900],
    primaryDark: colors.primary[300],
    primaryVariant: colors.primary[500],
    onPrimary: '#0F172A',
    
    // Secondary
    secondary: colors.secondary[400],
    secondaryLight: colors.secondary[900],
    onSecondary: '#0F172A',
    
    // Accent
    accent: colors.danger[400],
    
    // Status colors
    success: colors.success[400],
    successLight: '#0D3E10',
    successBg: '#1B4332',
    
    warning: colors.warning[400],
    warningLight: '#78350F',
    warningBg: '#713F12',
    
    error: colors.danger[400],
    danger: colors.danger[400],
    dangerLight: '#450A0A',
    dangerBg: '#7F1D1D',
    
    info: colors.info[400],
    infoLight: '#003F6B',
    infoBg: '#0C4A6E',
    
    // Borders
    border: '#334155',
    borderLight: '#1E293B',
    borderDark: '#475569',
    
    // Sidebar
    sidebar: '#020617',
    sidebarText: '#94A3B8',
    sidebarTextActive: '#FFFFFF',
    sidebarHover: '#1E293B',
    sidebarActive: colors.primary[600],
    
    // Navigation
    navBackground: '#1E293B',
    navBorder: '#334155',
    
    // Input
    inputBackground: '#1E293B',
    inputBorder: '#475569',
    inputFocus: colors.primary[400],
    placeholder: '#64748B',
    
    // Charts
    chartLine: colors.primary[400],
    chartArea: colors.primary[900],
    chartGrid: '#334155',
    
    // Severity indicators
    severityCritical: colors.danger[400],
    severityHigh: colors.warning[400],
    severityMedium: colors.warning[300],
    severityLow: colors.success[400],
    
    // Water quality
    waterSafe: colors.success[400],
    waterModerate: colors.warning[400],
    waterUnsafe: colors.danger[400],
    waterCritical: colors.danger[300],
    
    // Shadow
    shadow: 'rgba(0, 0, 0, 0.3)',
    shadowMedium: 'rgba(0, 0, 0, 0.4)',
    shadowDark: 'rgba(0, 0, 0, 0.5)',
    
    // Overlay
    overlay: 'rgba(0, 0, 0, 0.7)',
    
    // Status badges
    badgeActive: colors.success[400],
    badgePending: colors.warning[400],
    badgeInactive: colors.gray[500],
    
    disabled: '#64748B',
    elevation: {
      low: 'rgba(255,255,255,0.1)',
      medium: 'rgba(255,255,255,0.2)',
      high: 'rgba(255,255,255,0.3)',
    },
    alert: colors.danger[400],
    campaign: colors.success[400],
  } as Theme,
};

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: 'light' | 'dark';
  themeMode: ThemeMode;
  colors: Theme;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@health_drop_theme';

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Helper function to get severity color
export function getSeverityColor(severity: string, themeColors: Theme): string {
  switch (severity) {
    case 'critical':
      return themeColors.severityCritical;
    case 'high':
      return themeColors.severityHigh;
    case 'medium':
      return themeColors.severityMedium;
    case 'low':
      return themeColors.severityLow;
    default:
      return themeColors.textSecondary;
  }
}

// Helper function to get water quality color
export function getWaterQualityColor(quality: string, themeColors: Theme): string {
  switch (quality) {
    case 'safe':
      return themeColors.waterSafe;
    case 'moderate':
      return themeColors.waterModerate;
    case 'unsafe':
      return themeColors.waterUnsafe;
    case 'critical':
      return themeColors.waterCritical;
    default:
      return themeColors.textSecondary;
  }
}

// Helper function to get status color
export function getStatusColor(status: string, themeColors: Theme): string {
  switch (status) {
    case 'resolved':
    case 'completed':
    case 'safe':
    case 'verified':
      return themeColors.success;
    case 'ongoing':
    case 'in_treatment':
    case 'investigating':
    case 'moderate':
      return themeColors.warning;
    case 'reported':
    case 'planned':
    case 'pending':
      return themeColors.info;
    case 'critical':
    case 'unsafe':
    case 'dismissed':
    case 'cancelled':
      return themeColors.danger;
    default:
      return themeColors.textSecondary;
  }
}

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved theme preference
  useEffect(() => {
    loadThemePreference();
  }, []);

  const loadThemePreference = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
        setThemeModeState(savedTheme as ThemeMode);
      }
    } catch (error) {
      console.log('Error loading theme preference:', error);
    } finally {
      setIsLoaded(true);
    }
  };

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (error) {
      console.log('Error saving theme preference:', error);
    }
  };

  // Determine actual theme based on mode
  const isDark = themeMode === 'system' 
    ? systemColorScheme === 'dark' 
    : themeMode === 'dark';

  const theme: 'light' | 'dark' = isDark ? 'dark' : 'light';

  const toggleTheme = () => {
    const newMode = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    setThemeMode(newMode);
  };

  const value: ThemeContextType = {
    theme,
    themeMode,
    colors: themes[theme],
    setThemeMode,
    toggleTheme,
    isDark,
  };

  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeContext;