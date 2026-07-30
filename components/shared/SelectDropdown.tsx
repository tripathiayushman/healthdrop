// =====================================================
// SELECT DROPDOWN COMPONENT — "Prakash" design system
// 52dp trigger styled like an input, label above,
// inline error with icon, Ionicons only.
// =====================================================
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radii } from '../../lib/ThemeContext';

interface SelectOption {
  label: string;
  value: string;
}

interface SelectDropdownProps {
  label?: string;
  value: string;
  options: SelectOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}

export const SelectDropdown: React.FC<SelectDropdownProps> = ({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select an option',
  error,
  disabled = false,
  required = false,
}) => {
  const { colors, reduceMotion } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(opt => opt.value === value);

  const getBorderColor = () => {
    if (error) return colors.inputErrorBorder;
    if (isOpen) return colors.inputFocusBorder;
    if (selectedOption) return colors.inputFilledBorder;
    return colors.inputBorder;
  };

  const borderWidth = error || isOpen ? 2 : 1.5;

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
          {label}
          {required && <Text style={{ color: colors.danger }}> *</Text>}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => !disabled && setIsOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${label || 'Select'}: ${selectedOption?.label || placeholder}`}
        accessibilityState={{ disabled, expanded: isOpen }}
        style={[
          styles.selectButton,
          {
            backgroundColor: disabled ? colors.surfaceVariant : colors.inputBackground,
            borderColor: getBorderColor(),
            borderWidth,
          },
        ]}
      >
        <Text
          style={[
            styles.selectText,
            { color: selectedOption ? colors.text : colors.placeholder },
          ]}
          numberOfLines={1}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {error && (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        </View>
      )}

      <Modal
        visible={isOpen}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setIsOpen(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {label || 'Select Option'}
              </Text>
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.optionsList}>
              {options.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => {
                    onSelect(option.value);
                    setIsOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.value === value }}
                  style={[
                    styles.optionItem,
                    { borderBottomColor: colors.borderLight },
                    option.value === value && { backgroundColor: colors.primaryLight },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: colors.text },
                      option.value === value && { color: colors.primary, fontWeight: '700' },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {option.value === value && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  selectText: {
    fontSize: 16,
    flex: 1,
    marginRight: 8,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  error: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  optionsList: {
    maxHeight: 400,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
    marginRight: 8,
  },
});

export default SelectDropdown;
