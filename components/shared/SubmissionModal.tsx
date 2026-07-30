// =====================================================
// SUBMISSION MODAL — Success/Error Confirmation UI
// Flat opaque card, token colors, single 200ms fade
// (static under reduce-motion). No glass, no springs.
// =====================================================
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radii } from '../../lib/ThemeContext';

const { width } = Dimensions.get('window');

interface SubmissionModalProps {
  visible: boolean;
  type: 'success' | 'error' | 'loading';
  title: string;
  message: string;
  onClose: () => void;
  onRetry?: () => void;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

export const SubmissionModal: React.FC<SubmissionModalProps> = ({
  visible,
  type,
  title,
  message,
  onClose,
  onRetry,
  autoClose = false,
  autoCloseDelay = 3000,
}) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        opacityAnim.setValue(1);
      } else {
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }

      // Auto close for success
      if (autoClose && type === 'success') {
        const timer = setTimeout(() => {
          handleClose();
        }, autoCloseDelay);
        return () => clearTimeout(timer);
      }
    } else {
      opacityAnim.setValue(0);
    }
  }, [visible, type, reduceMotion]);

  const handleClose = () => {
    if (reduceMotion) {
      opacityAnim.setValue(0);
      onClose();
      return;
    }
    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const getIconConfig = () => {
    switch (type) {
      case 'success':
        return { name: 'checkmark-circle', color: colors.success, bgColor: colors.successBg };
      case 'error':
        return { name: 'close-circle', color: colors.danger, bgColor: colors.dangerBg };
      case 'loading':
        return { name: 'hourglass-outline', color: colors.info, bgColor: colors.infoBg };
      default:
        return { name: 'information-circle-outline', color: colors.primary, bgColor: colors.primaryLight };
    }
  };

  const iconConfig = getIconConfig();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View
        style={[
          styles.overlay,
          {
            backgroundColor: colors.overlay,
            opacity: opacityAnim,
          },
        ]}
      >
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[
            styles.modalContainer,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
            !isDark && styles.cardShadow,
          ]}
        >
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: iconConfig.bgColor }]}>
            <Ionicons
              name={iconConfig.name as any}
              size={40}
              color={iconConfig.color}
            />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {title}
          </Text>

          {/* Message */}
          <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            {type === 'error' && onRetry && (
              <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel="Try Again"
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                ]}
              >
                <Ionicons name="refresh" size={20} color={colors.onPrimary} />
                <Text style={[styles.buttonText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  Try Again
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                type === 'error' && onRetry
                  ? {
                      backgroundColor: pressed ? colors.surfaceVariant : 'transparent',
                      borderWidth: 1.5,
                      borderColor: colors.inputBorder,
                    }
                  : { backgroundColor: pressed ? colors.primaryDark : colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: type === 'error' && onRetry ? colors.text : colors.onPrimary },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {type === 'success' ? 'Done' : type === 'error' && onRetry ? 'Cancel' : 'Close'}
              </Text>
            </Pressable>
          </View>

          {/* Auto close indicator for success */}
          {autoClose && type === 'success' && (
            <Text style={[styles.autoCloseText, { color: colors.textTertiary }]}>
              Auto-closing in a few seconds…
            </Text>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: width - 40,
    maxWidth: 400,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: radii.md,
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  autoCloseText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 16,
  },
});

export default SubmissionModal;
