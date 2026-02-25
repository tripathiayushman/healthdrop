// =====================================================
// SELECT DROPDOWN COMPONENT
// =====================================================
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Pressable } from 'react-native';
import { useTheme } from '../../lib/ThemeContext';

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
  const { colors } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(opt => opt.value === value);

  const getBorderColor = () => {
    if (error) return colors.danger;
    if (isOpen) return colors.inputFocus;
    return colors.inputBorder;
  };

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: colors.text }]}>
          {label}
          {required && <Text style={{ color: colors.danger }}> *</Text>}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => !disabled && setIsOpen(true)}
        activeOpacity={0.7}
        style={[
          styles.selectButton,
          {
            backgroundColor: disabled ? colors.surfaceVariant : colors.inputBackground,
            borderColor: getBorderColor(),
          },
        ]}
      >
        <Text
          style={[
            styles.selectText,
            { color: selectedOption ? colors.text : colors.placeholder },
          ]}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <Text style={[styles.arrow, { color: colors.textSecondary }]}>▼</Text>
      </TouchableOpacity>

      {error && (
        <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
      )}

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setIsOpen(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {label || 'Select Option'}
              </Text>
              <TouchableOpacity onPress={() => setIsOpen(false)}>
                <Text style={[styles.closeButton, { color: colors.textSecondary }]}>✕</Text>
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
                  style={[
                    styles.optionItem,
                    { borderBottomColor: colors.border },
                    option.value === value && { backgroundColor: colors.primaryLight },
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      { color: colors.text },
                      option.value === value && { color: colors.primary, fontWeight: '600' },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {option.value === value && (
                    <Text style={[styles.checkmark, { color: colors.primary }]}>✓</Text>
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
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectText: {
    fontSize: 16,
    flex: 1,
  },
  arrow: {
    fontSize: 10,
    marginLeft: 8,
  },
  error: {
    fontSize: 12,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: 16,
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
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    fontSize: 20,
    padding: 4,
  },
  optionsList: {
    maxHeight: 400,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  optionText: {
    fontSize: 16,
  },
  checkmark: {
    fontSize: 18,
    fontWeight: '600',
  },
});

export default SelectDropdown;
