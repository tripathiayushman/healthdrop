// =====================================================
// BUTTON COMPONENT — "Prakash" design system
// 56dp primary actions, pressed = background change
// (never opacity fade or scale), 40% opacity disabled.
// =====================================================
import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { useTheme, radii } from '../../lib/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
}) => {
  const { colors } = useTheme();

  const getBackgroundColor = (pressed: boolean) => {
    switch (variant) {
      case 'primary':
        return pressed ? colors.primaryDark : colors.primary;
      case 'danger':
        // waterCritical is the deep-red step of the same scale — visible pressed shift
        return pressed ? colors.waterCritical : colors.danger;
      case 'secondary':
      case 'outline':
      case 'ghost':
        return pressed ? colors.surfaceVariant : 'transparent';
      default:
        return pressed ? colors.primaryDark : colors.primary;
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'primary':
      case 'danger':
        return colors.onPrimary;
      case 'secondary':
      case 'outline':
        return colors.text;
      case 'ghost':
        return colors.primary;
      default:
        return colors.onPrimary;
    }
  };

  const getBorderColor = () => {
    switch (variant) {
      case 'secondary':
      case 'outline':
        return colors.inputBorder;
      default:
        return 'transparent';
    }
  };

  const hasBorder = variant === 'secondary' || variant === 'outline';

  const sizeStyles = {
    small:  { minHeight: 44, paddingHorizontal: 16, fontSize: 14 },
    medium: { minHeight: 52, paddingHorizontal: 20, fontSize: 15 },
    large:  { minHeight: 56, paddingHorizontal: 24, fontSize: 16 },
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      hitSlop={size === 'small' ? { top: 2, bottom: 2, left: 0, right: 0 } : undefined}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: getBackgroundColor(pressed && !disabled && !loading),
          borderColor: getBorderColor(),
          borderWidth: hasBorder ? 1.5 : 0,
          minHeight: sizeStyles[size].minHeight,
          paddingHorizontal: sizeStyles[size].paddingHorizontal,
        },
        (disabled || loading) && styles.disabled,
        fullWidth && styles.fullWidth,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' && (
            <View style={styles.iconLeft}>{icon}</View>
          )}
          <Text
            style={[
              styles.text,
              { color: getTextColor(), fontSize: sizeStyles[size].fontSize },
            ]}
            maxFontSizeMultiplier={1.3}
          >
            {title}
          </Text>
          {icon && iconPosition === 'right' && (
            <View style={styles.iconRight}>{icon}</View>
          )}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  fullWidth: {
    width: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontWeight: '700',
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
});

export default Button;
