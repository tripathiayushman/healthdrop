// =====================================================
// THEME CONTEXT — "Prakash" design system tokens
// Ink-on-paper light mode, opaque-surface dark mode.
// Keys are never renamed; values follow DESIGN_SPEC.md.
// =====================================================
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme, AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Spacing & shape scales (strict 4pt grid) ────────
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

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
  ai: string;
  aiBg: string;
  headerBg: string;
  skeleton: string;
  skeletonHighlight: string;
  offline: string;
  offlineBg: string;
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
  inputFocusBorder: string;
  inputFilledBorder: string;
  inputErrorBorder: string;
  inputPlaceholderColor: string;
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
    // Backgrounds — ink on paper, opaque solids
    background: '#EEF2F6',
    surface: '#F8FAFC',
    surfaceVariant: '#E3EAF1',
    card: '#FFFFFF',
    cardHover: '#F1F5F9',

    // Text
    text: '#0C1D2E',
    textSecondary: '#3D5568',
    textTertiary: '#64788A',
    textInverse: '#FFFFFF',

    // Primary actions — deep institutional blue
    primary: '#0B5FA5',
    primaryLight: '#D8E9F7',
    primaryDark: '#083D6E',
    primaryVariant: '#0A5290',
    onPrimary: '#FFFFFF',

    // Secondary
    secondary: '#0F766E',
    secondaryLight: '#D6EDEA',
    onSecondary: '#FFFFFF',

    // Accent — warm saffron
    accent: '#C2410C',

    // Status colors
    success: '#15803D',
    successLight: '#EAF7EF',
    successBg: '#DCF2E3',

    warning: '#B45309',
    warningLight: '#FEF6E8',
    warningBg: '#FDEED6',

    error: '#B91C1C',
    danger: '#B91C1C',
    dangerLight: '#FDEFEF',
    dangerBg: '#FBE2E2',

    info: '#0369A1',
    infoLight: '#EAF6FC',
    infoBg: '#DDF0FA',

    // AI — indigo means "the system inferred this"
    ai: '#4F46E5',
    aiBg: '#E7E8FB',

    // Borders
    border: '#C3CFDA',
    borderLight: '#D8E1E9',
    borderDark: '#8CA0B0',

    // Header — flat navy band
    headerBg: '#083D6E',

    // Sidebar
    sidebar: '#0C1D2E',
    sidebarText: '#A7B8C7',
    sidebarTextActive: '#FFFFFF',
    sidebarHover: '#16324A',
    sidebarActive: '#53A6E3',

    // Navigation
    navBackground: '#F8FAFC',
    navBorder: '#C3CFDA',

    // Input
    inputBackground: '#FFFFFF',
    inputBorder: '#64788A',
    inputFocus: '#0B5FA5',
    inputFocusBorder: '#0B5FA5',
    inputFilledBorder: '#3D5568',
    inputErrorBorder: '#B91C1C',
    inputPlaceholderColor: '#64788A',
    placeholder: '#64788A',

    // Skeleton loading
    skeleton: '#E3EAF1',
    skeletonHighlight: '#F2F6FA',

    // Offline / sync
    offline: '#C2410C',
    offlineBg: '#FDE8D8',

    // Charts — one ink series, hairline grid
    chartLine: '#0B5FA5',
    chartArea: '#D8E9F7',
    chartGrid: '#E3EAF1',

    // Severity indicators
    severityCritical: '#B91C1C',
    severityHigh: '#C2410C',
    severityMedium: '#B45309',
    severityLow: '#15803D',

    // Water quality
    waterSafe: '#15803D',
    waterModerate: '#B45309',
    waterUnsafe: '#B91C1C',
    waterCritical: '#7F1D1D',

    // Shadow — single recipe (opacity 0.06)
    shadow: 'rgba(12, 29, 46, 0.06)',
    shadowMedium: 'rgba(12, 29, 46, 0.10)',
    shadowDark: 'rgba(12, 29, 46, 0.14)',

    // Overlay
    overlay: 'rgba(12, 29, 46, 0.50)',

    // Status badges
    badgeActive: '#15803D',
    badgePending: '#B45309',
    badgeInactive: '#64788A',

    disabled: '#8CA0B0',
    elevation: {
      low: 'rgba(12, 29, 46, 0.06)',
      medium: 'rgba(12, 29, 46, 0.10)',
      high: 'rgba(12, 29, 46, 0.14)',
    },
    alert: '#B91C1C',
    campaign: '#15803D',
  } as Theme,
  
  dark: {
    mode: 'dark' as const,
    // ── Opaque surface ladder: background → surface → card → cardHover ──
    background:     '#0B1219',
    surface:        '#111A24',
    surfaceVariant: '#1B2733',
    card:           '#16212E',
    cardHover:      '#1D2938',

    // Text
    text:          '#F2F7FB',
    textSecondary: '#A7B8C7',
    textTertiary:  '#7C8FA0',
    textInverse:   '#0C1D2E',

    // Primary — lifted institutional blue
    primary:        '#53A6E3',
    primaryLight:   '#123A5C',
    primaryDark:    '#3584C8',
    primaryVariant: '#3584C8',
    onPrimary:      '#06263F',

    // Secondary
    secondary:      '#2DD4BF',
    secondaryLight: '#123B36',
    onSecondary:    '#06263F',

    // Accent — warm saffron
    accent: '#FB923C',

    // Status
    success:      '#4ADE80',
    successLight: '#0E2A1D',
    successBg:    '#123324',

    warning:      '#FBBF24',
    warningLight: '#2E230B',
    warningBg:    '#3A2C0D',

    error:       '#F87171',
    danger:      '#F87171',
    dangerLight: '#301111',
    dangerBg:    '#3D1717',

    info:      '#4FC3F7',
    infoLight: '#0B2534',
    infoBg:    '#0E2E40',

    // AI — indigo means "the system inferred this"
    ai:   '#818CF8',
    aiBg: '#232A4E',

    // Borders
    border:      '#2B3B4B',
    borderLight: '#22303D',
    borderDark:  '#3E5163',

    // Header — flat surface band with bottom border
    headerBg: '#111A24',

    // Sidebar
    sidebar:           '#0B1219',
    sidebarText:       '#7C8FA0',
    sidebarTextActive: '#F2F7FB',
    sidebarHover:      '#1B2733',
    sidebarActive:     '#53A6E3',

    // Navigation
    navBackground: '#111A24',
    navBorder:     '#2B3B4B',

    // Input
    inputBackground: '#111A24',
    inputBorder:     '#4E6478',
    inputFocus:      '#53A6E3',
    inputFocusBorder:'#53A6E3',
    inputFilledBorder:'#7C8FA0',
    inputErrorBorder:'#F87171',
    inputPlaceholderColor:'#7C8FA0',
    placeholder:     '#7C8FA0',

    // Skeleton loading
    skeleton:          '#1B2733',
    skeletonHighlight: '#263442',

    // Offline / sync
    offline:   '#FB923C',
    offlineBg: '#3B2312',

    // Charts — one ink series, hairline grid
    chartLine: '#53A6E3',
    chartArea: '#123A5C',
    chartGrid: '#1E2732',

    // Severity
    severityCritical: '#F87171',
    severityHigh:     '#FB923C',
    severityMedium:   '#FBBF24',
    severityLow:      '#4ADE80',

    // Water quality
    waterSafe:     '#4ADE80',
    waterModerate: '#FBBF24',
    waterUnsafe:   '#F87171',
    waterCritical: '#FCA5A5',

    // Shadow — zero shadows in dark mode (surface ladder is the elevation)
    shadow:       'rgba(0,0,0,0)',
    shadowMedium: 'rgba(0,0,0,0)',
    shadowDark:   'rgba(0,0,0,0)',

    // Overlay
    overlay: 'rgba(0,0,0,0.60)',

    // Badges
    badgeActive:   '#4ADE80',
    badgePending:  '#FBBF24',
    badgeInactive: '#7C8FA0',

    disabled: '#4E6478',
    elevation: {
      low:    'rgba(0,0,0,0)',
      medium: 'rgba(0,0,0,0)',
      high:   'rgba(0,0,0,0)',
    },
    alert:    '#F87171',
    campaign: '#4ADE80',
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
  /** OS "reduce motion" setting — collapse all animation to static when true */
  reduceMotion: boolean;
  spacing: typeof spacing;
  radii: typeof radii;
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
// Legacy vocab: 'poor' (needs treatment) maps to unsafe,
// 'contaminated' (do not consume) maps to critical.
export function getWaterQualityColor(quality: string, themeColors: Theme): string {
  switch (quality) {
    case 'safe':
      return themeColors.waterSafe;
    case 'moderate':
      return themeColors.waterModerate;
    case 'poor':
    case 'unsafe':
      return themeColors.waterUnsafe;
    case 'contaminated':
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
  const [reduceMotion, setReduceMotion] = useState(false);

  // Load saved theme preference
  useEffect(() => {
    loadThemePreference();
  }, []);

  // Read OS reduce-motion once at start and subscribe to changes
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(!!enabled);
      })
      .catch(() => {
        /* not available on this platform — animations stay enabled */
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(!!enabled),
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
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
    reduceMotion,
    spacing,
    radii,
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