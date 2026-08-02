// =====================================================
// FORM GUARD SHEETS — BRK-14 / NEW-01
// The two decisions that stand between a half-filled
// report and losing it, as in-app bottom sheets built
// from tokens (never Alert.alert):
//
//   DiscardChangesSheet — "leave without saving?"
//   RestoreDraftSheet   — "continue where you left off?"
//
// Anatomy follows ReportTypeSheet: backdrop, grabber,
// one icon, one question, two stacked 56dp choices. The
// safe choice is the filled teal one; the choice that
// loses something is outlined with ink text (a 6.1:1 red
// label would fail the 7:1 body floor — the loss is said
// in the word and shown in the glyph instead).
// =====================================================
import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii } from './ThemeContext';
import { formatDraftStamp } from './useFormDraft';

interface GuardSheetProps {
  visible: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  iconTone: 'danger' | 'action';
  title: string;
  body: string;
  /** The safe choice — filled, first, and what the backdrop falls back to. */
  primaryLabel: string;
  onPrimary: () => void;
  /** The choice that gives something up. */
  secondaryLabel: string;
  secondaryIcon: keyof typeof Ionicons.glyphMap;
  secondaryIconTone: 'danger' | 'quiet';
  onSecondary: () => void;
  /** Android hardware back while the sheet is up. */
  onRequestClose: () => void;
  /** Tap outside. Off when the sheet asks a question that must be answered. */
  onBackdropPress?: () => void;
}

const GuardSheet: React.FC<GuardSheetProps> = ({
  visible,
  icon,
  iconTone,
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  secondaryIcon,
  secondaryIconTone,
  onSecondary,
  onRequestClose,
  onBackdropPress,
}) => {
  const { colors, reduceMotion } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <View style={styles.overlayRoot}>
        {/*
          Always hidden from the accessibility tree, dismissible or not.
          It was exposed as a viewport-sized button carrying the primary
          label, so a TalkBack sweep landed on a full-screen "Keep editing"
          before it ever reached the question — the first thing she heard was
          an answer. The backdrop is a redundant convenience for a pointing
          finger; the two real choices below are the accessible way out, and
          they say the same things.
        */}
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onBackdropPress}
          disabled={!onBackdropPress}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />

        <View
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.borderDark }]} />

          <View
            style={[
              styles.iconBadge,
              { backgroundColor: iconTone === 'danger' ? colors.dangerBg : colors.surfaceVariant },
            ]}
          >
            <Ionicons
              name={icon}
              size={28}
              color={iconTone === 'danger' ? colors.danger : colors.primary}
            />
          </View>

          <Text
            style={[styles.title, { color: colors.text }]}
            maxFontSizeMultiplier={1.3}
            accessibilityRole="header"
          >
            {title}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>

          <Pressable
            onPress={onPrimary}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: pressed ? colors.primaryDark : colors.primary },
            ]}
          >
            <Text
              style={[styles.primaryText, { color: colors.onPrimary }]}
              maxFontSizeMultiplier={1.3}
            >
              {primaryLabel}
            </Text>
          </Pressable>

          <Pressable
            onPress={onSecondary}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                borderColor: colors.inputBorder,
              },
            ]}
          >
            <Ionicons
              name={secondaryIcon}
              size={20}
              color={secondaryIconTone === 'danger' ? colors.danger : colors.textSecondary}
            />
            <Text
              style={[styles.secondaryText, { color: colors.text }]}
              maxFontSizeMultiplier={1.3}
            >
              {secondaryLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

// ── The two decisions ────────────────────────────────────────────────────────

/**
 * Shown when Back or Cancel is pressed on a form that has been touched.
 * An untouched form closes silently — a confirmation on an empty form only
 * teaches people to tap through dialogs.
 */
export const DiscardChangesSheet: React.FC<{
  visible: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}> = ({ visible, onKeepEditing, onDiscard }) => {
  const { t } = useTranslation();
  return (
    <GuardSheet
      visible={visible}
      icon="alert-circle-outline"
      iconTone="danger"
      title={t('formGuard.discardTitle')}
      body={t('formGuard.discardBody')}
      primaryLabel={t('formGuard.keepEditing')}
      onPrimary={onKeepEditing}
      secondaryLabel={t('formGuard.discard')}
      secondaryIcon="trash-outline"
      secondaryIconTone="danger"
      onSecondary={onDiscard}
      onRequestClose={onKeepEditing}
      onBackdropPress={onKeepEditing}
    />
  );
};

/**
 * Shown when a saved draft is found for this user and this form. Restoring is
 * always her call — silently resurrecting old text is its own bug.
 *
 * No backdrop dismiss: the question has two real answers. Hardware back is the
 * third — "not now" — and it leaves the whole form, keeping the draft on the
 * phone. That is a bigger jump than a sheet dismissal usually is, and it was
 * challenged in review; it stays because the alternative is worse. Closing the
 * sheet in place would leave a BLANK form with autosave re-armed (the write is
 * suppressed only while `offered` is non-null, useFormDraft.ts autosave effect)
 * so her next keystroke would overwrite the very draft she had just declined to
 * decide about. Leaving the screen is the only exit that provably preserves it.
 */
export const RestoreDraftSheet: React.FC<{
  visible: boolean;
  savedAt: Date | null;
  onRestore: () => void;
  onStartFresh: () => void;
  onRequestClose: () => void;
}> = ({ visible, savedAt, onRestore, onStartFresh, onRequestClose }) => {
  const { t } = useTranslation();
  const when = formatDraftStamp(savedAt);
  return (
    <GuardSheet
      visible={visible}
      icon="document-text-outline"
      iconTone="action"
      title={t('formGuard.restoreTitle')}
      body={when ? t('formGuard.restoreBody', { when }) : t('formGuard.restoreBodyPlain')}
      primaryLabel={t('formGuard.restore')}
      onPrimary={onRestore}
      // "Start fresh" DELETES the recovered report, in one tap, with no undo.
      // It was styled as the calm alternative — a refresh glyph in the quiet
      // tone — which reads as "reset the form", not "throw away the work you
      // just came back for". It is the same act as Discard on the other sheet
      // and now carries the same danger-toned trash glyph, so the tap that
      // loses something looks like the tap that loses something.
      secondaryLabel={t('formGuard.startFresh')}
      secondaryIcon="trash-outline"
      secondaryIconTone="danger"
      onSecondary={onStartFresh}
      onRequestClose={onRequestClose}
    />
  );
};

// ── Inline notices (not decisions — statements of fact) ──────────────────────

/**
 * One quiet strip above the action bar. Used for the two things a form has to
 * admit rather than hide: this phone is not keeping your draft, and the dates
 * you just restored are older than today. Warning tint because both are real
 * warnings — colour is spent on meaning, never on decoration.
 *
 * Ink on warningBg measures 16.38:1 light / 13.88:1 dark, clearing the 7:1
 * body floor; the optional action is a 48dp target.
 */
export const InlineNotice: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ icon, message, actionLabel, onAction }) => {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.notice, { backgroundColor: colors.warningBg, borderLeftColor: colors.warning }]}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={icon} size={18} color={colors.warning} style={styles.noticeIcon} />
      <Text style={[styles.noticeText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
        {message}
      </Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.noticeAction,
            { borderColor: colors.warning, backgroundColor: pressed ? colors.surface : 'transparent' },
          ]}
        >
          <Text style={[styles.noticeActionText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
};

/**
 * The draft-persistence state, when it is not "working".
 *
 * Both failure sides used to be silent. A failed READ produced a blank form and
 * no draft offer — indistinguishable from "you have nothing unfinished", which
 * is the one confusion NEW-01 exists to prevent. A failed WRITE (full or
 * corrupt store) meant the low-memory kill would take everything and she would
 * find that out afterwards. Renders nothing when storage is healthy.
 */
export const DraftStorageNotice: React.FC<{
  issue: 'read' | 'write' | null;
  onRetry: () => void;
}> = ({ issue, onRetry }) => {
  const { t } = useTranslation();
  if (!issue) return null;
  return (
    <InlineNotice
      icon={issue === 'read' ? 'help-circle-outline' : 'save-outline'}
      message={
        issue === 'read'
          ? t('formGuard.draftReadFailed', {
              defaultValue:
                "Couldn't check this phone for an unfinished report. There may be one saved.",
            })
          : t('formGuard.draftWriteFailed', {
              defaultValue:
                'This phone is not saving your progress right now. Send before you close the form.',
            })
      }
      actionLabel={t('formGuard.draftRetry', { defaultValue: 'Try again' })}
      onAction={onRetry}
    />
  );
};

/**
 * Shown beside the date fields when a restored draft brings back dates that
 * were "today" and "next week" the day it was written and are simply gone now.
 * The values ARE on screen — they are just silently wrong, and a campaign
 * starting three days ago is the kind of quiet error nobody reads twice.
 */
export const StaleDraftDatesNotice: React.FC<{ visible: boolean }> = ({ visible }) => {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <InlineNotice
      icon="calendar-outline"
      message={t('formGuard.staleDates', {
        defaultValue:
          'These dates came back with your saved draft and are already in the past. Check them before you send.',
      })}
    />
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
    marginBottom: spacing.lg,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    lineHeight: 30, // ×1.35+ — Devanagari matras must not clip
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: spacing.xl,
  },
  primaryBtn: {
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  secondaryText: { fontSize: 16, lineHeight: 22, fontWeight: '700' },

  /* ── Inline notice ── */
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    borderLeftWidth: 3,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  noticeIcon: { marginTop: 1 },
  noticeText: {
    flex: 1,
    minWidth: 180,
    fontSize: 14,
    lineHeight: 20, // ×1.35+ — Devanagari matras must not clip
    fontWeight: '600',
  },
  noticeAction: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderRadius: radii.sm,
  },
  noticeActionText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
});
