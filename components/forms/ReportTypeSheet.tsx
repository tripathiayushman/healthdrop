// =====================================================
// REPORT TYPE SHEET — Bharosa Flow A·01
// "What are you reporting?" bottom sheet: three verb
// rows (72dp, pictogram + words), offline notice INSIDE
// the sheet, Cancel. Token colors only, reduce-motion
// aware, works on web + Hermes.
// =====================================================
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii, Theme } from '../../lib/ThemeContext';

export type ReportTypeTarget =
  | 'new-disease-report'
  | 'new-water-report'
  | 'new-campaign'
  | 'new-alert';

interface ReportTypeSheetProps {
  visible: boolean;
  /** Create targets the current role is allowed to open (from MainApp permissions). */
  allowedTargets: ReportTypeTarget[];
  onSelect: (target: ReportTypeTarget) => void;
  onClose: () => void;
}

// ── One 72dp verb row: pictogram + words ─────────────────────────────────────

const SheetRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
  colors: Theme;
  onPress?: () => void;
  disabled?: boolean;
  disabledNote?: string;
}> = ({ icon, title, caption, colors, onPress, disabled = false, disabledNote }) => (
  <Pressable
    onPress={disabled ? undefined : onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={disabledNote ? `${title} — ${disabledNote}` : title}
    accessibilityState={{ disabled }}
    style={({ pressed }) => [
      styles.row,
      {
        backgroundColor: pressed && !disabled ? colors.cardHover : colors.card,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : 1,
      },
    ]}
  >
    <View style={[styles.rowIcon, { backgroundColor: colors.surfaceVariant }]}>
      <Ionicons name={icon} size={28} color={disabled ? colors.disabled : colors.primary} />
    </View>
    <View style={styles.rowText}>
      <Text
        style={[styles.rowTitle, { color: colors.text }]}
        maxFontSizeMultiplier={1.3}
      >
        {title}
      </Text>
      <Text style={[styles.rowCaption, { color: colors.textSecondary }]}>
        {caption}
      </Text>
      {disabledNote ? (
        <Text style={[styles.rowNote, { color: colors.textTertiary }]}>{disabledNote}</Text>
      ) : null}
    </View>
    {!disabled && (
      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
    )}
  </Pressable>
);

// ── Sheet ────────────────────────────────────────────────────────────────────

export const ReportTypeSheet: React.FC<ReportTypeSheetProps> = ({
  visible,
  allowedTargets,
  onSelect,
  onClose,
}) => {
  const { colors, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const netInfo = useNetInfo();
  // Tolerant null check — isInternetReachable === null before the first probe
  // must never read as offline.
  const isOffline =
    netInfo.isConnected === false || netInfo.isInternetReachable === false;

  const can = (target: ReportTypeTarget) => allowedTargets.includes(target);
  const showExtras = can('new-campaign') || can('new-alert');

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop — tap to dismiss */}
      <View style={styles.overlayRoot}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close report type sheet"
        />

        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.borderDark }]} />

          {/* Offline notice — the fact travels with the task */}
          {isOffline && (
            <View
              style={[styles.offlineNotice, { backgroundColor: colors.offlineBg }]}
              accessibilityLiveRegion="polite"
            >
              <Ionicons name="cloud-offline-outline" size={18} color={colors.offline} />
              <Text style={[styles.offlineText, { color: colors.offline }]}>
                {t('reportSheet.offlineNotice')}
              </Text>
            </View>
          )}

          <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {t('reportSheet.title')}
          </Text>

          {can('new-disease-report') && (
            <SheetRow
              icon="medkit-outline"
              title={t('reportSheet.sicknessTitle')}
              caption={t('reportSheet.sicknessCaption')}
              colors={colors}
              onPress={() => onSelect('new-disease-report')}
            />
          )}
          {can('new-water-report') && (
            <SheetRow
              icon="water-outline"
              title={t('reportSheet.waterTitle')}
              caption={t('reportSheet.waterCaption')}
              colors={colors}
              onPress={() => onSelect('new-water-report')}
            />
          )}
          <SheetRow
            icon="refresh-circle-outline"
            title={t('reportSheet.followUpTitle')}
            caption={t('reportSheet.followUpCaption')}
            colors={colors}
            disabled
            disabledNote={t('reportSheet.comingSoon')}
          />

          {showExtras && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
                {t('reportSheet.officials')}
              </Text>
              {can('new-campaign') && (
                <SheetRow
                  icon="megaphone-outline"
                  title={t('reportSheet.campaignTitle')}
                  caption={t('reportSheet.campaignCaption')}
                  colors={colors}
                  onPress={() => onSelect('new-campaign')}
                />
              )}
              {can('new-alert') && (
                <SheetRow
                  icon="warning-outline"
                  title={t('reportSheet.alertTitle')}
                  caption={t('reportSheet.alertCaption')}
                  colors={colors}
                  onPress={() => onSelect('new-alert')}
                />
              )}
            </>
          )}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancelBtn,
              {
                backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                borderColor: colors.inputBorder,
              },
            ]}
          >
            <Text style={[styles.cancelText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlayRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl + spacing.sm : spacing.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    marginBottom: spacing.md,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    marginBottom: spacing.md,
  },
  offlineText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    lineHeight: 30, // ×1.35+ — Devanagari matras must not clip
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  rowCaption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    marginTop: 2,
  },
  rowNote: {
    fontSize: 12,
    lineHeight: 17, // ×1.35+ — Devanagari matras must not clip
    fontWeight: '600',
    marginTop: 2,
  },
  divider: { height: 1, marginVertical: spacing.sm },
  eyebrow: {
    fontSize: 12,
    lineHeight: 17, // ×1.35+ — Devanagari matras must not clip
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  cancelBtn: {
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  cancelText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
});

export default ReportTypeSheet;
