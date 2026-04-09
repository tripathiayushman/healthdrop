import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Profile } from '../../types';

export type WidgetPreferenceKey =
  | 'admin_panel'
  | 'overview_stats'
  | 'approval_tools'
  | 'quick_actions'
  | 'alerts_map'
  | 'ai_insights'
  | 'district_tools'
  | 'operations_tools'
  | 'my_stats'
  | 'campaigns'
  | 'community_stats';

export interface WidgetDefinition {
  key: WidgetPreferenceKey;
  label: string;
  description: string;
  roles: Profile['role'][];
  defaultEnabled: boolean;
}

const STORAGE_PREFIX = 'healthdrop:widget-preferences';

const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    key: 'admin_panel',
    label: 'Admin Panel',
    description: 'User management and high-priority operational controls.',
    roles: ['super_admin'],
    defaultEnabled: true,
  },
  {
    key: 'overview_stats',
    label: 'Overview Stats',
    description: 'Role-specific health and activity summary cards.',
    roles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
    defaultEnabled: true,
  },
  {
    key: 'approval_tools',
    label: 'Approval Tools',
    description: 'Pending review queues for reports, campaigns, and alerts.',
    roles: ['health_admin', 'district_officer', 'clinic'],
    defaultEnabled: true,
  },
  {
    key: 'quick_actions',
    label: 'Quick Actions',
    description: 'Create reports, campaigns, and alerts quickly.',
    roles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
    defaultEnabled: true,
  },
  {
    key: 'alerts_map',
    label: 'Alerts And Map',
    description: 'Combined map intelligence and active alert stream.',
    roles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
    defaultEnabled: true,
  },
  {
    key: 'ai_insights',
    label: 'AI Insights',
    description: 'Role-scoped AI insights and trend cards.',
    roles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
    defaultEnabled: true,
  },
  {
    key: 'district_tools',
    label: 'District Tools',
    description: 'District-level report and campaign moderation tools.',
    roles: ['district_officer'],
    defaultEnabled: true,
  },
  {
    key: 'operations_tools',
    label: 'Operations Intelligence',
    description: 'Health score, campaign intelligence, escalation monitoring, and customization entry.',
    roles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker', 'volunteer'],
    defaultEnabled: true,
  },
  {
    key: 'my_stats',
    label: 'My Submission Stats',
    description: 'Personal submission and approval counters.',
    roles: ['asha_worker'],
    defaultEnabled: true,
  },
  {
    key: 'campaigns',
    label: 'Campaign Highlights',
    description: 'Featured active campaigns and participation cards.',
    roles: ['volunteer'],
    defaultEnabled: true,
  },
  {
    key: 'community_stats',
    label: 'Community Stats',
    description: 'Community-level alert and campaign metrics.',
    roles: ['volunteer'],
    defaultEnabled: true,
  },
];

const storageKeyForUser = (profileId: string): string => `${STORAGE_PREFIX}:${profileId}`;

export const getRoleWidgetDefinitions = (role: Profile['role']): WidgetDefinition[] =>
  WIDGET_DEFINITIONS.filter((widget) => widget.roles.includes(role));

export const getDefaultWidgetPreferences = (role: Profile['role']): Record<WidgetPreferenceKey, boolean> => {
  const defaults = {} as Record<WidgetPreferenceKey, boolean>;
  getRoleWidgetDefinitions(role).forEach((widget) => {
    defaults[widget.key] = widget.defaultEnabled;
  });
  return defaults;
};

export const loadWidgetPreferences = async (
  profileId: string,
  role: Profile['role']
): Promise<Record<WidgetPreferenceKey, boolean>> => {
  const defaults = getDefaultWidgetPreferences(role);

  try {
    const raw = await AsyncStorage.getItem(storageKeyForUser(profileId));
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as Partial<Record<WidgetPreferenceKey, boolean>>;
    return {
      ...defaults,
      ...parsed,
    };
  } catch {
    return defaults;
  }
};

export const persistWidgetPreferences = async (
  profileId: string,
  preferences: Partial<Record<WidgetPreferenceKey, boolean>>
): Promise<void> => {
  await AsyncStorage.setItem(storageKeyForUser(profileId), JSON.stringify(preferences));
};

export const resetWidgetPreferences = async (
  profileId: string,
  role: Profile['role']
): Promise<Record<WidgetPreferenceKey, boolean>> => {
  const defaults = getDefaultWidgetPreferences(role);
  await persistWidgetPreferences(profileId, defaults);
  return defaults;
};

export const useDashboardWidgetVisibility = (
  profile: Pick<Profile, 'id' | 'role'>
): {
  loading: boolean;
  preferences: Record<WidgetPreferenceKey, boolean>;
  isWidgetVisible: (key: WidgetPreferenceKey) => boolean;
} => {
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<Record<WidgetPreferenceKey, boolean>>(
    getDefaultWidgetPreferences(profile.role)
  );

  const allowedWidgetKeys = useMemo(
    () => new Set(getRoleWidgetDefinitions(profile.role).map((widget) => widget.key)),
    [profile.role]
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const next = await loadWidgetPreferences(profile.id, profile.role);
      if (!active) return;
      setPreferences(next);
      setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, [profile.id, profile.role]);

  const isWidgetVisible = useCallback(
    (key: WidgetPreferenceKey) => allowedWidgetKeys.has(key) && preferences[key] !== false,
    [allowedWidgetKeys, preferences]
  );

  return {
    loading,
    preferences,
    isWidgetVisible,
  };
};
