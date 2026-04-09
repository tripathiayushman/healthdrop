import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Profile } from '../../types';
import { useTheme } from '../../lib/ThemeContext';
import {
  WidgetPreferenceKey,
  getRoleWidgetDefinitions,
  loadWidgetPreferences,
  resetWidgetPreferences,
  persistWidgetPreferences,
} from '../../lib/services/widgetPreferences';

interface WidgetCustomizationScreenProps {
  profile: Profile;
  onBack: () => void;
}

const WidgetCustomizationScreen: React.FC<WidgetCustomizationScreenProps> = ({ profile, onBack }) => {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<Record<WidgetPreferenceKey, boolean>>({} as Record<WidgetPreferenceKey, boolean>);

  const availableWidgets = useMemo(() => getRoleWidgetDefinitions(profile.role), [profile.role]);

  const loadPreferences = async () => {
    setLoading(true);
    const next = await loadWidgetPreferences(profile.id, profile.role);
    setPreferences(next);
    setLoading(false);
  };

  useEffect(() => {
    loadPreferences();
  }, [profile.id, profile.role]);

  const handleToggle = async (key: WidgetPreferenceKey, value: boolean) => {
    const next = {
      ...preferences,
      [key]: value,
    };

    setPreferences(next);
    setSaving(true);
    await persistWidgetPreferences(profile.id, next);
    setSaving(false);
  };

  const handleReset = async () => {
    setSaving(true);
    const defaults = await resetWidgetPreferences(profile.id, profile.role);
    setPreferences(defaults);
    setSaving(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { backgroundColor: colors.primary }]}> 
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Customize Widgets</Text>
          <Text style={styles.headerSubtitle}>Choose which dashboard modules you want to see</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>Your widget preferences are saved per account and applied to your role dashboard automatically.</Text>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading widget preferences...</Text>
          </View>
        ) : availableWidgets.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No customizable widgets are available for your role.</Text>
          </View>
        ) : (
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            {availableWidgets.map((widget) => (
              <View key={widget.key} style={[styles.itemRow, { borderColor: colors.border }]}> 
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.itemTitle, { color: colors.text }]}>{widget.label}</Text>
                  <Text style={[styles.itemDescription, { color: colors.textSecondary }]}>{widget.description}</Text>
                </View>
                <Switch
                  value={preferences[widget.key] !== false}
                  onValueChange={(value) => handleToggle(widget.key, value)}
                  thumbColor={preferences[widget.key] !== false ? colors.primary : '#9CA3AF'}
                  trackColor={{ false: '#D1D5DB', true: `${colors.primary}77` }}
                />
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.resetBtn, { borderColor: colors.primary, backgroundColor: `${colors.primary}12` }]}
          onPress={handleReset}
          disabled={saving || loading}
        >
          {saving ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="refresh" size={16} color={colors.primary} />}
          <Text style={[styles.resetText, { color: colors.primary }]}>Reset To Default</Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  loadingWrap: {
    paddingVertical: 30,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  emptyText: {
    fontSize: 12,
  },
  listCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  itemRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  itemDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  resetBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  resetText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export default WidgetCustomizationScreen;
