import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

interface ProfileSetupProps {
  userId: string;
  onProfileComplete: () => void;
}

type UserRole = 'admin' | 'clinic' | 'asha_worker' | 'volunteer' | 'district_officer';

export default function ProfileSetup({ userId, onProfileComplete }: ProfileSetupProps) {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('volunteer');
  const [phone, setPhone] = useState('');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    const getUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || '');
        if (user.user_metadata) {
          setFullName(user.user_metadata.full_name || '');
          setRole(user.user_metadata.role || 'volunteer');
          setPhone(user.user_metadata.phone || '');
        }
      }
    };
    getUserData();
  }, []);

  const roles: { value: UserRole; label: string }[] = [
    { value: 'clinic', label: 'Clinic' },
    { value: 'asha_worker', label: 'ASHA Worker' },
    { value: 'volunteer', label: 'Volunteer' },
    { value: 'district_officer', label: 'District Officer' },
  ];

  const handleSubmit = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }

    if (!district.trim() || !state.trim()) {
      Alert.alert('Error', 'Please enter your district and state');
      return;
    }

    setLoading(true);

    try {
      // Use upsert to handle both insert and update
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          email: userEmail,
          full_name: fullName.trim(),
          role,
          phone: phone.trim() || null,
          district: district.trim(),
          state: state.trim(),
          location: `${district.trim()}, ${state.trim()}`,
          organization: 'Not specified',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error('Profile upsert error:', error);
        Alert.alert('Error', 'Failed to save profile: ' + error.message);
      } else {
        Alert.alert('Success', 'Profile created successfully!', [
          { text: 'OK', onPress: onProfileComplete }
        ]);
      }
    } catch (error: any) {
      console.error('Profile setup error:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    try {
      const locationValue = district.trim() && state.trim() 
        ? `${district.trim()}, ${state.trim()}` 
        : 'Not specified';
      
      // Create minimal profile with defaults
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          email: userEmail,
          full_name: fullName.trim() || userEmail.split('@')[0] || 'User',
          role: role || 'volunteer',
          phone: phone.trim() || null,
          district: district.trim() || 'Not specified',
          state: state.trim() || 'Not specified',
          location: locationValue,
          organization: 'Not specified',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error('Skip profile error:', error);
        // Try with all required fields explicitly
        const { error: error2 } = await supabase
          .from('profiles')
          .upsert({
            id: userId,
            email: userEmail,
            full_name: fullName.trim() || userEmail.split('@')[0] || 'User',
            role: role || 'volunteer',
            phone: phone.trim() || null,
            district: district.trim() || 'Not specified',
            state: state.trim() || 'Not specified',
            location: locationValue,
            organization: 'Not specified',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'id'
          });
        
        if (error2) {
          Alert.alert('Error', 'Failed to create profile. Please fill in required fields.');
          setLoading(false);
          return;
        }
      }
      onProfileComplete();
    } catch (error: any) {
      console.error('Skip error:', error);
      Alert.alert('Error', 'Failed to skip. Please try completing the profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.formContainer}>
          <View style={styles.headerSection}>
            <Text style={styles.icon}>👤</Text>
            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>
              Please provide your details to get started
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor="#999"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Select Your Role *</Text>
            <View style={styles.roleContainer}>
              {roles.map((roleOption) => (
                <TouchableOpacity
                  key={roleOption.value}
                  style={[
                    styles.roleButton,
                    role === roleOption.value && styles.roleButtonSelected,
                  ]}
                  onPress={() => setRole(roleOption.value)}
                >
                  <Text
                    style={[
                      styles.roleButtonText,
                      role === roleOption.value && styles.roleButtonTextSelected,
                    ]}
                  >
                    {roleOption.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your phone number"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>District *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your district"
              placeholderTextColor="#999"
              value={district}
              onChangeText={setDistrict}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>State *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your state"
              placeholderTextColor="#999"
              value={state}
              onChangeText={setState}
              autoCapitalize="words"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Creating Profile...' : '✓ Complete Setup'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.skipButton, loading && styles.buttonDisabled]}
            onPress={handleSkip}
            disabled={loading}
          >
            <Text style={styles.skipButtonText}>
              Skip for now →
            </Text>
          </TouchableOpacity>

          <Text style={styles.skipNote}>
            You can complete your profile later in Settings
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  formContainer: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 28,
  },
  icon: {
    fontSize: 56,
    marginBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1a365d',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#718096',
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    padding: 14,
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: '#f7fafc',
    color: '#1a202c',
  },
  roleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  roleButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#f7fafc',
  },
  roleButtonSelected: {
    backgroundColor: '#3182ce',
    borderColor: '#3182ce',
  },
  roleButtonText: {
    color: '#4a5568',
    fontSize: 14,
    fontWeight: '600',
  },
  roleButtonTextSelected: {
    color: 'white',
  },
  button: {
    backgroundColor: '#38a169',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: '#a0aec0',
  },
  buttonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
  },
  skipButton: {
    backgroundColor: 'transparent',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#cbd5e0',
  },
  skipButtonText: {
    color: '#718096',
    fontSize: 15,
    fontWeight: '600',
  },
  skipNote: {
    color: '#a0aec0',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
});