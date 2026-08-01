// =====================================================
// THEME CONTEXT — "Bharosa" design language tokens
// Calm paper, ink, and one teal — flat, high-contrast,
// printable. Color is spent like money: severity and
// water ladders, sync truths, and the reserved AI violet
// appear only when they mean something.
// Keys are never renamed; values follow the Bharosa
// field manual §2.1 (light / dark specced per token).
// =====================================================
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme, AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Spacing & shape scales (strict 4pt grid) ────────
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

// Bharosa reference ramps (action teal leads; ramps kept
// for chart/ornament use — semantic tokens live below)
export const colors = {
  // Primary - Bharosa Action Teal (one teal, spent carefully)
  primary: {
    50: '#EAF7F4',
    100: '#D9F0EC',
    200: '#AFE5DC',
    300: '#7BE2D3',
    400: '#53D6C3',
    500: '#0B6B60', // Main primary (light-mode action teal)
    600: '#095E54',
    700: '#08554C',
    800: '#064239',
    900: '#06231F',
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
  /** §2.1 primary-pressed — state, not shadow */
  primaryPressed: string;
  /** §2.1 primary-container — selected chips, rows (alias of primaryLight) */
  primaryContainer: string;
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
  /** §2.1 ai-border — dashed = inferred; violet is reserved for AI alone */
  aiBorder: string;
  /**
   * §2.1 header surface — a MODE-APPROPRIATE SURFACE, never an ink slab:
   * paper in light, dark surface in dark. Header ink is therefore `text`
   * (titles) and `textSecondary` (subtitles) in BOTH modes; `textInverse`
   * is illegal here. Separation comes from a 1px `border` bottom hairline.
   */
  headerBg: string;
  skeleton: string;
  skeletonHighlight: string;
  offline: string;
  offlineBg: string;
  border: string;
  borderLight: string;
  borderDark: string;
  /** §2.1 border-strong — dividers with meaning */
  borderStrong: string;
  /** §2.1 border-input — quiet at rest; 2px teal ring on focus */
  borderInput: string;
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
  /** Soft container for the §9.1 tinted-pill tier (sev-high / water-unsafe hue) */
  severityHighBg: string;
  waterSafe: string;
  waterModerate: string;
  waterUnsafe: string;
  waterCritical: string;
  /** §2.1 sync ladder — state is sacred, never silent */
  syncSynced: string;
  syncSaving: string;
  syncQueued: string;
  syncFailed: string;
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
    // Canvas — calm paper: pure white screen, faint grey wash for grouped bg
    background: '#FFFFFF',
    surface: '#F7F7F8',
    surfaceVariant: '#EFEFF1',
    card: '#FFFFFF',
    cardHover: '#F4F4F5',

    // Ink tiers on paper — measured: body 19.8:1, secondary 7.7:1,
    // meta 5.6:1 (≥12px only). textInverse is legal ONLY on a filled
    // saturated surface (primary button, filled CRITICAL pill).
    text: '#0A0A0B',
    textSecondary: '#52525B',
    textTertiary: '#67676F',
    textInverse: '#FFFFFF',

    // Action — one teal; pressed is a state, not a shadow
    primary: '#0B6B60',
    primaryLight: '#D9F0EC',
    primaryDark: '#08554C',
    primaryVariant: '#08554C',
    primaryPressed: '#08554C',
    primaryContainer: '#D9F0EC',
    onPrimary: '#FFFFFF',

    // Secondary — RNR default button ink (zinc-950 family)
    secondary: '#18181B',
    secondaryLight: '#F4F4F5',
    onSecondary: '#FFFFFF',

    // Accent — warm sev-high hue (saffron duty, ladder-sourced)
    accent: '#BC3D08',

    // Semantic status
    success: '#157A3C',
    successLight: '#E8F6EE',
    successBg: '#DCF0E5',

    warning: '#8A5800',
    warningLight: '#FAF3DF',
    warningBg: '#F5E9C9',

    error: '#B3261E',
    danger: '#B3261E',
    dangerLight: '#FBECEB',
    dangerBg: '#F8DFDD',

    info: '#0B5FA5',
    infoLight: '#EAF3FB',
    infoBg: '#DCEBF8',

    // AI — reserved violet; nothing else may use it
    ai: '#6D28D9',
    aiBg: '#F1EBFC',
    aiBorder: '#CBB6F2',

    // Header — paper, not an ink slab. Bharosa is "calm paper, ink and one
    // teal": the masthead is the same canvas as the page, separated by a 1px
    // border hairline (+ the 4px Role Ribbon). Header ink is `text` /
    // `textSecondary` — 19.8:1 and 7.7:1 here.
    headerBg: '#FFFFFF',

    // Sidebar — ink panel (wide/web shell only; the mobile shell has none)
    sidebar: '#18181B',
    sidebarText: '#A1A1AA',
    sidebarTextActive: '#FFFFFF',
    sidebarHover: '#27272A',
    sidebarActive: '#53D6C3',

    // Navigation
    navBackground: '#FFFFFF',
    navBorder: '#E4E4E7',

    // Input — quiet at rest, 2px teal ring on focus
    inputBackground: '#FFFFFF',
    inputBorder: '#A1A1AA',
    inputFocus: '#0B6B60',
    inputFocusBorder: '#0B6B60',
    inputFilledBorder: '#52525B',
    inputErrorBorder: '#B3261E',
    inputPlaceholderColor: '#71717A',
    placeholder: '#71717A',

    // Skeleton — static grey blocks (no shimmer)
    skeleton: '#E4E4E7',
    skeletonHighlight: '#F4F4F5',

    // Offline is a place, not an error — queued amber, never red
    offline: '#8A5800',
    offlineBg: '#F5E9C9',

    // Charts — one teal series, hairline grid
    chartLine: '#0B6B60',
    chartArea: '#D9F0EC',
    chartGrid: '#ECECEE',

    // Severity ladder — outline → tinted → filled
    severityCritical: '#9B1C1C',
    severityHigh: '#BC3D08',
    severityMedium: '#8A5800',
    severityLow: '#71717A',
    severityHighBg: '#FBE7DC',

    // Water ladder — safe is CYAN, never the action teal
    waterSafe: '#0E7490',
    waterModerate: '#8A5800',
    waterUnsafe: '#BC3D08',
    waterCritical: '#7F1D1D',

    // Sync — state is sacred
    syncSynced: '#157A3C',
    syncSaving: '#0B5FA5',
    syncQueued: '#8A5800',
    syncFailed: '#B3261E',

    // Shadow — none; borders do the work (Bharosa is printable)
    shadow: 'rgba(0, 0, 0, 0)',
    shadowMedium: 'rgba(0, 0, 0, 0)',
    shadowDark: 'rgba(0, 0, 0, 0)',

    // Overlay
    overlay: 'rgba(10, 10, 11, 0.50)',

    // Status badges
    badgeActive: '#157A3C',
    badgePending: '#8A5800',
    badgeInactive: '#71717A',

    // Borders — zinc hairlines; strong = dividers with meaning
    border: '#E4E4E7',
    borderLight: '#ECECEE',
    borderDark: '#D4D4D8',
    borderStrong: '#D4D4D8',
    borderInput: '#A1A1AA',

    disabled: '#A1A1AA',
    elevation: {
      low: 'rgba(0, 0, 0, 0)',
      medium: 'rgba(0, 0, 0, 0)',
      high: 'rgba(0, 0, 0, 0)',
    },
    alert: '#B3261E',
    campaign: '#157A3C',
  } as Theme,
  
  dark: {
    mode: 'dark' as const,
    // ── Canvas ladder (zinc-black): background → surface → card → cardHover ──
    background:     '#0B0B0D',
    surface:        '#131316',
    surfaceVariant: '#1F1F23',
    card:           '#19191D',
    cardHover:      '#202025',

    // Ink tiers on the dark canvas — measured on surface/headerBg #131316:
    // body 17.8:1, secondary 9.0:1, meta 6.3:1 (on card).
    text:          '#FAFAFA',
    textSecondary: '#B4B4BC',
    textTertiary:  '#9B9BA1',
    textInverse:   '#0B0B0D',

    // Action — lifted teal; pressed lifts further (state, not shadow)
    primary:        '#53D6C3',
    primaryLight:   '#123B34',
    primaryDark:    '#7BE2D3',
    primaryVariant: '#7BE2D3',
    primaryPressed: '#7BE2D3',
    primaryContainer: '#123B34',
    onPrimary:      '#06231F',

    // Secondary — inverted ink button
    secondary:      '#E4E4E7',
    secondaryLight: '#26262B',
    onSecondary:    '#0B0B0D',

    // Accent — warm sev-high hue
    accent: '#F59B6E',

    // Semantic status
    success:      '#6BD695',
    successLight: '#11291C',
    successBg:    '#153524',

    warning:      '#E8B54A',
    warningLight: '#2A2008',
    warningBg:    '#33280C',

    error:       '#F58E85',
    danger:      '#F58E85',
    dangerLight: '#2E1311',
    dangerBg:    '#3A1815',

    info:      '#7CC0F5',
    infoLight: '#0E2336',
    infoBg:    '#122C44',

    // AI — reserved violet; nothing else may use it
    ai:   '#C7B3F7',
    aiBg: '#2B2150',
    aiBorder: '#4A3B7E',

    // Header — the dark twin of paper: the surface tier, separated by a 1px
    // border hairline. Header ink is `text` / `textSecondary` (17.8:1 / 9.0:1).
    headerBg: '#131316',

    // Sidebar
    sidebar:           '#0B0B0D',
    sidebarText:       '#9B9BA1',
    sidebarTextActive: '#FAFAFA',
    sidebarHover:      '#1F1F23',
    sidebarActive:     '#53D6C3',

    // Navigation
    navBackground: '#131316',
    navBorder:     '#27272A',

    // Input — quiet at rest, 2px teal ring on focus
    inputBackground: '#131316',
    inputBorder:     '#52525B',
    inputFocus:      '#53D6C3',
    inputFocusBorder:'#53D6C3',
    inputFilledBorder:'#B4B4BC',
    inputErrorBorder:'#F58E85',
    inputPlaceholderColor:'#9B9BA1',
    placeholder:     '#9B9BA1',

    // Skeleton — static grey blocks (no shimmer)
    skeleton:          '#27272A',
    skeletonHighlight: '#303036',

    // Offline is a place, not an error — queued amber, never red
    offline:   '#E8B54A',
    offlineBg: '#33280C',

    // Charts — one teal series, hairline grid
    chartLine: '#53D6C3',
    chartArea: '#123B34',
    chartGrid: '#1F1F23',

    // Severity ladder
    severityCritical: '#F87171',
    severityHigh:     '#F59B6E',
    severityMedium:   '#E8B54A',
    severityLow:      '#A6A6AD',
    severityHighBg:   '#33190D',

    // Water ladder — safe is CYAN, never the action teal
    waterSafe:     '#67D3EE',
    waterModerate: '#E8B54A',
    waterUnsafe:   '#F59B6E',
    waterCritical: '#FCA5A5',

    // Sync — state is sacred
    syncSynced: '#6BD695',
    syncSaving: '#7CC0F5',
    syncQueued: '#E8B54A',
    syncFailed: '#F58E85',

    // Shadow — none; borders do the work
    shadow:       'rgba(0,0,0,0)',
    shadowMedium: 'rgba(0,0,0,0)',
    shadowDark:   'rgba(0,0,0,0)',

    // Overlay
    overlay: 'rgba(0,0,0,0.60)',

    // Badges
    badgeActive:   '#6BD695',
    badgePending:  '#E8B54A',
    badgeInactive: '#9B9BA1',

    // Borders — hairlines; strong = dividers with meaning
    border:      '#27272A',
    borderLight: '#1F1F23',
    borderDark:  '#4A5A54',
    borderStrong:'#4A5A54',
    borderInput: '#52525B',

    disabled: '#5C6B66',
    elevation: {
      low:    'rgba(0,0,0,0)',
      medium: 'rgba(0,0,0,0)',
      high:   'rgba(0,0,0,0)',
    },
    alert:    '#F58E85',
    campaign: '#6BD695',
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