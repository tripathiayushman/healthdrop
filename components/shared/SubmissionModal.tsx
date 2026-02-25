// =====================================================
// SUBMISSION MODAL - Success/Error Confirmation UI
// =====================================================
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';

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
  const { colors, isDark } = useTheme();
  const scaleAnim = React.useRef(new Animated.Value(0)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto close for success
      if (autoClose && type === 'success') {
        const timer = setTimeout(() => {
          handleClose();
        }, autoCloseDelay);
        return () => clearTimeout(timer);
      }
    } else {
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
    }
  }, [visible, type]);

  const handleClose = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  };

  const getIconConfig = () => {
    switch (type) {
      case 'success':
        return { name: 'checkmark-circle', color: '#10B981', bgColor: '#10B98120' };
      case 'error':
        return { name: 'close-circle', color: '#EF4444', bgColor: '#EF444420' };
      case 'loading':
        return { name: 'hourglass', color: '#3B82F6', bgColor: '#3B82F620' };
      default:
        return { name: 'information-circle', color: colors.primary, bgColor: colors.primary + '20' };
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
            backgroundColor: 'rgba(0,0,0,0.6)',
            opacity: opacityAnim,
          }
        ]}
      >
        <Animated.View
          style={[
            styles.modalContainer,
            {
              backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: iconConfig.bgColor }]}>
            <Ionicons
              name={iconConfig.name as any}
              size={60}
              color={iconConfig.color}
            />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

          {/* Message */}
          <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            {type === 'error' && onRetry && (
              <TouchableOpacity
                style={[styles.button, styles.retryButton, { backgroundColor: '#EF4444' }]}
                onPress={onRetry}
              >
                <Ionicons name="refresh" size={20} color="#FFFFFF" />
                <Text style={styles.buttonText}>Try Again</Text>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity
              style={[
                styles.button,
                type === 'success' 
                  ? { backgroundColor: '#10B981' }
                  : type === 'error' && onRetry
                    ? { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }
                    : { backgroundColor: colors.primary }
              ]}
              onPress={handleClose}
            >
              <Text style={[
                styles.buttonText,
                type === 'error' && onRetry && { color: colors.text }
              ]}>
                {type === 'success' ? 'Done' : type === 'error' && onRetry ? 'Cancel' : 'Close'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Auto close indicator for success */}
          {autoClose && type === 'success' && (
            <Text style={[styles.autoCloseText, { color: colors.textSecondary }]}>
              Auto-closing in a few seconds...
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
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 25,
    paddingHorizontal: 10,
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
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  retryButton: {
    backgroundColor: '#EF4444',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  autoCloseText: {
    fontSize: 12,
    marginTop: 15,
  },
});

export default SubmissionModal;
