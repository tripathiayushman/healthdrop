import React, { useState } from 'react';
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
  Image,
  Dimensions,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { Profile } from '../types/profile';
import { Ionicons } from '@expo/vector-icons';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

const { width } = Dimensions.get('window');

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Signup form fields
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Profile['role']>('volunteer');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('');

  // OTP related state
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // Error/Success Modal for web compatibility
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageModalType, setMessageModalType] = useState<'error' | 'success'>('error');
  const [messageModalTitle, setMessageModalTitle] = useState('');
  const [messageModalText, setMessageModalText] = useState('');
  const [messageModalCallback, setMessageModalCallback] = useState<(() => void) | null>(null);

  // Helper function to show messages (works on both web and mobile)
  const showMessage = (type: 'error' | 'success', title: string, message: string, callback?: () => void) => {
    setMessageModalType(type);
    setMessageModalTitle(title);
    setMessageModalText(message);
    setMessageModalCallback(() => callback || null);
    setShowMessageModal(true);
  };

  const handleMessageModalClose = () => {
    setShowMessageModal(false);
    if (messageModalCallback) {
      messageModalCallback();
    }
  };

  const roles: { value: Profile['role']; label: string }[] = [
    { value: 'clinic', label: 'Clinic' },
    { value: 'asha_worker', label: 'ASHA Worker' },
    { value: 'volunteer', label: 'Volunteer' },
  ];

  const isValidEmail = (text: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  };

  const isValidPhone = (text: string) => {
    return /^\+?[\d\s-()]{10,15}$/.test(text.replace(/\s/g, ''));
  };

  const handleAuth = async () => {
    if (isLogin) {
      // For login, only use email (remove phone login for now)
      if (!email || !password) {
        showMessage('error', 'Error', 'Please enter email and password');
        return;
      }
      if (!isValidEmail(email)) {
        showMessage('error', 'Error', 'Please enter a valid email address');
        return;
      }
    } else {
      if (!email || !password || !fullName || !district || !state) {
        showMessage('error', 'Error', 'Please fill in all required fields');
        return;
      }
      if (!isValidEmail(email)) {
        showMessage('error', 'Error', 'Please enter a valid email address');
        return;
      }
    }

    setLoading(true);
    
    try {
      if (isLogin) {
        // Login with email only
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        
        if (error) {
          setLoading(false);
          // Show clear error message for wrong credentials
          if (error.message.includes('Invalid login credentials')) {
            showMessage('error', 'Login Failed', 'Invalid email or password. Please check your credentials and try again. If you don\'t have an account, please sign up first.');
          } else if (error.message.includes('Email not confirmed')) {
            showMessage('error', 'Email Not Verified', 'Please check your email and click the confirmation link before signing in.');
          } else {
            showMessage('error', 'Login Error', error.message);
          }
          return;
        }
        
        // Only proceed if we actually got a session
        if (data?.session) {
          onAuthSuccess();
        } else {
          setLoading(false);
          showMessage('error', 'Login Failed', 'Unable to sign in. Please try again.');
        }
      } else {
        // Sign up with email and password
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              role,
              district,
              state,
              phone,
            }
          }
        });

        if (signUpError) {
          console.error('Sign Up Error:', signUpError);
          setLoading(false);
          showMessage('error', 'Sign Up Error', signUpError.message);
          return;
        }

        // Check if user was created successfully
        if (signUpData?.user) {
          // If email confirmation is disabled, user will be logged in automatically
          if (signUpData.session) {
            // User is logged in, create profile and wait for it
            try {
              const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                  id: signUpData.user.id,
                  email: email,
                  full_name: fullName,
                  role,
                  phone: phone || null,
                  district: district || null,
                  state: state || null,
                  location: `${district}, ${state}`,
                  organization: 'Not specified',
                  is_active: true,
                  created_at: new Date().toISOString(),
                }, { onConflict: 'id' });

              if (profileError) {
                console.error('Profile creation error:', profileError);
                // Don't block signup, profile can be completed later
              }
              
              // Wait a moment for the database to sync
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (profileErr) {
              console.error('Profile error:', profileErr);
            }

            setLoading(false);
            showMessage('success', 'Success!', 'Account created successfully! You are now logged in.', () => onAuthSuccess());
          } else {
            // Email confirmation is required
            setLoading(false);
            showMessage('success', 'Check Your Email', 'We sent a confirmation link to your email. Please check your inbox and click the link to verify your account.', () => setIsLogin(true));
          }
        } else {
          setLoading(false);
          showMessage('error', 'Sign Up Error', 'Unable to create account. Please try again.');
        }
      }
    } catch (error) {
      setLoading(false);
      showMessage('error', 'Error', 'An unexpected error occurred');
      console.error('Auth error:', error);
    }
  };

  const handleOtpVerification = async () => {
    if (!otpCode || otpCode.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    setOtpLoading(true);
    
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: userEmail,
        token: otpCode,
        type: 'email'
      });
      
      if (error) {
        Alert.alert('OTP Error', error.message);
      } else if (data.user) {
        // Check if profile already exists (might be created by trigger)
        const { data: existingProfile, error: profileCheckError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileCheckError && profileCheckError.code === 'PGRST116') {
          // Profile doesn't exist, create it
           const { error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: data.user.id,
              full_name: fullName,
              role,
              district,
              state,
              created_at: new Date().toISOString(),
              is_active: true,
            });

          if (profileError) {
            console.error('Profile creation error:', profileError);
          }
        }

        setShowOtpModal(false);
        setShowSuccessModal(true);
        setOtpCode('');
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
      console.error('OTP verification error:', error);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSuccessNext = () => {
    setShowSuccessModal(false);
    // Reset form
    setEmail('');
    setPassword('');
    setFullName('');
    setDistrict('');
    setState('');
    setPhone('');
    setIsLogin(true);
    onAuthSuccess();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerContainer}>
          <Image 
            source={require('../assets/app_logo.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Health Drop</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'Welcome Back!' : 'Join Our Community'}
          </Text>
        </View>

        <View style={styles.formContainer}>
          {isLogin ? (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="password"
                />
              </View>
            </>
          ) : (
            <>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your full name"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email Address *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your phone number"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Role *</Text>
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

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>District *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your district"
                  value={district}
                  onChangeText={setDistrict}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>State *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your state"
                  value={state}
                  onChangeText={setState}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Create a strong password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="password"
                />
              </View>
            </>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={loading}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => {
              setIsLogin(!isLogin);
              // Clear form when switching
              setEmail('');
              setPhone('');
              setPassword('');
              setFullName('');
              setDistrict('');
              setState('');
            }}
          >
            <Text style={styles.switchText}>
              {isLogin
                ? "Don't have an account? "
                : 'Already have an account? '}
              <Text style={styles.switchTextBold}>
                {isLogin ? 'Sign Up' : 'Sign In'}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* OTP Verification Modal */}
      <Modal
        visible={showOtpModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOtpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Enter Verification Code</Text>
            <Text style={styles.modalSubtitle}>
              We've sent a 6-digit verification code to {userEmail}
            </Text>
            
            <View style={styles.otpContainer}>
              <TextInput
                style={styles.otpInput}
                value={otpCode}
                onChangeText={setOtpCode}
                placeholder="000000"
                keyboardType="numeric"
                maxLength={6}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, otpLoading && styles.buttonDisabled]}
              onPress={handleOtpVerification}
              disabled={otpLoading}
            >
              {otpLoading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text style={styles.primaryButtonText}>Verify OTP</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowOtpModal(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSuccessModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.successIcon}>
              <Text style={styles.successCheckmark}>✓</Text>
            </View>
            
            <Text style={styles.modalTitle}>Account Created Successfully!</Text>
            <Text style={styles.modalSubtitle}>
              Your account has been created and verified. You can now start using HealthDrop.
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleSuccessNext}
            >
              <Text style={styles.primaryButtonText}>Next</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Message Modal (Web Compatible - replaces Alert.alert) */}
      <Modal visible={showMessageModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={[
              styles.messageIconContainer, 
              { backgroundColor: messageModalType === 'error' ? '#EF4444' : '#10B981' }
            ]}>
              <Ionicons 
                name={messageModalType === 'error' ? 'close' : 'checkmark'} 
                size={40} 
                color="#FFFFFF" 
              />
            </View>
            <Text style={styles.modalTitle}>{messageModalTitle}</Text>
            <Text style={styles.modalSubtitle}>{messageModalText}</Text>
            <TouchableOpacity
              style={[
                styles.primaryButton, 
                { backgroundColor: messageModalType === 'error' ? '#EF4444' : '#10B981' }
              ]}
              onPress={handleMessageModalClose}
            >
              <Text style={styles.primaryButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafe',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 65,
    paddingBottom: 30,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: {
    width: 70,
    height: 70,
    marginBottom: 0,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#438edaff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
  },
  formContainer: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 25,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  inputContainer: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e1e8ed',
    padding: 15,
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: '#f8fafe',
    color: '#2c3e50',
  },
  orText: {
    textAlign: 'center',
    color: '#7f8c8d',
    fontSize: 14,
    fontWeight: '500',
    marginVertical: 10,
  },
  roleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e1e8ed',
    backgroundColor: '#f8fafe',
  },
  roleButtonSelected: {
    backgroundColor: '#3498db',
    borderColor: '#3498db',
  },
  roleButtonText: {
    color: '#7f8c8d',
    fontSize: 14,
    fontWeight: '500',
  },
  roleButtonTextSelected: {
    color: 'white',
  },
  primaryButton: {
    backgroundColor: '#27ae60',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#27ae60',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonDisabled: {
    backgroundColor: '#bdc3c7',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  switchButton: {
    marginTop: 25,
    alignItems: 'center',
  },
  switchText: {
    color: '#7f8c8d',
    fontSize: 16,
  },
  switchTextBold: {
    color: '#3498db',
    fontWeight: 'bold',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 30,
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 10,
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 22,
  },
  otpContainer: {
    width: '100%',
    marginBottom: 25,
  },
  otpInput: {
    borderWidth: 2,
    borderColor: '#e1e8ed',
    borderRadius: 12,
    padding: 20,
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 8,
    fontWeight: 'bold',
    color: '#2c3e50',
    backgroundColor: '#f8fafe',
  },
  cancelButton: {
    marginTop: 15,
    padding: 15,
  },
  cancelButtonText: {
    color: '#7f8c8d',
    fontSize: 16,
    fontWeight: '500',
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#27ae60',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successCheckmark: {
    color: 'white',
    fontSize: 40,
    fontWeight: 'bold',
  },
  messageIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
});