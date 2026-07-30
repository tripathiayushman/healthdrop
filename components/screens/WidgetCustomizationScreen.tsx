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
import { EmptyState, SkeletonBlock } from '../dashboards/DashboardShared';
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
  const { colors, isDark } = useTheme();
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

  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="chevron-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: headerText }]}>Customize Widgets</Text>
          <Text style={[styles.headerSubtitle, { color: headerSub }]}>Choose which dashboard modules you want to see</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.info },
            !isDark && styles.cardShadow,
          ]}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.info} />
          <Text style={[styles.infoText, { color: colors.text }]}>Your widget preferences are saved per account and applied to your role dashboard automatically.</Text>
        </View>

        {loading ? (
          <View style={{ gap: 8 }}>
            <SkeletonBlock height={64} radius={8} />
            <SkeletonBlock height={64} radius={8} />
            <SkeletonBlock height={64} radius={8} />
            <SkeletonBlock height={64} radius={8} />
          </View>
        ) : availableWidgets.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            color={colors.success}
            title="Nothing to customize"
            subtitle="No customizable widgets are available for your role."
          />
        ) : (
          <View
            style={[
              styles.listCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              !isDark && styles.cardShadow,
            ]}
          >
            {availableWidgets.map((widget, index) => (
              <View
                key={widget.key}
                style={[
                  styles.itemRow,
                  index < availableWidgets.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                ]}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.itemTitle, { color: colors.text }]}>{widget.label}</Text>
                  <Text style={[styles.itemDescription, { color: colors.textSecondary }]}>{widget.description}</Text>
                </View>
                <Switch
                  value={preferences[widget.key] !== false}
                  onValueChange={(value) => handleToggle(widget.key, value)}
                  thumbColor={colors.card}
                  trackColor={{ false: colors.disabled, true: colors.primary }}
                  accessibilityLabel={`${widget.label}${preferences[widget.key] !== false ? ', shown' : ', hidden'}`}
                />
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.resetBtn, { borderColor: colors.inputBorder }, (saving || loading) && styles.btnDisabled]}
          onPress={handleReset}
          disabled={saving || loading}
          accessibilityRole="button"
          accessibilityLabel="Reset widgets to default"
        >
          {saving ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="refresh-outline" size={16} color={colors.text} />}
          <Text style={[styles.resetText, { color: colors.text }]}>Reset To Default</Text>
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
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  infoCard: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  listCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  itemRow: {
    paddingVertical: 12,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 2,
  },
  itemDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  resetBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  resetText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
});

export default WidgetCustomizationScreen;
