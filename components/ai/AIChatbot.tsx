// =====================================================
// AI CHATBOT — "Prakash" design system.
// Indigo = intelligence: the launcher FAB, assistant
// avatar and assistant bubbles use the ai/aiBg tokens.
// Flat opaque surfaces, 1px borders, no gradients or
// blur, 48dp touch targets, body text >= 15px.
// =====================================================
import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { Profile } from '../../types';
import { getChatResponse } from '../../lib/services/gemini';

// The sheet is measured at render time, not at module load, so a rotation or
// a resized web window re-lays it out instead of keeping a stale height.
const PANEL_HEIGHT_RATIO = 0.62;

// FAB sits just above the tab bar + existing add buttons
const FAB_BOTTOM = 96;

interface AIChatbotProps {
  profile: Profile;
  activeTab?: string; // hide FAB on profile tab
}

const AI_EXTERNAL_PROCESSING_CONSENT_KEY = 'healthdrop_ai_external_processing_consent';

export interface LocalChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: Date;
}

export const AIChatbot: React.FC<AIChatbotProps> = ({ profile, activeTab }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const panelHeight = Math.round(windowHeight * PANEL_HEIGHT_RATIO);
  const { t, i18n } = useTranslation();
  const messageCounterRef = useRef(0);
  const createMessageId = () => {
    messageCounterRef.current += 1;
    return `msg-${Date.now()}-${messageCounterRef.current}`;
  };

  const createLocalMessage = (role: 'user' | 'assistant', text: string): LocalChatMessage => ({
    id: createMessageId(),
    role,
    text,
    timestamp: new Date(),
  });

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<LocalChatMessage[]>(() => [
    { id: createMessageId(), role: 'assistant', text: t('ai.welcome'), timestamp: new Date() },
  ]);
  const [inputText, setInputText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [consentToExternalProcessing, setConsentToExternalProcessing] = useState<boolean | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let mounted = true;

    const loadConsent = async () => {
      try {
        const stored = await AsyncStorage.getItem(AI_EXTERNAL_PROCESSING_CONSENT_KEY);
        if (!mounted) return;
        if (stored === 'granted') setConsentToExternalProcessing(true);
        else if (stored === 'denied') setConsentToExternalProcessing(false);
      } catch (error) {
        console.warn('Failed to load AI privacy consent:', error);
      }
    };

    loadConsent();
    return () => {
      mounted = false;
    };
  }, []);

  // Keep the greeting in the app language until the conversation starts —
  // once the user has sent anything, history is never rewritten.
  useEffect(() => {
    setMessages((prev) =>
      prev.length === 1 && prev[0].role === 'assistant'
        ? [{ ...prev[0], text: t('ai.welcome') }]
        : prev
    );
  }, [i18n.language, t]);

  const persistConsent = async (consent: boolean) => {
    setConsentToExternalProcessing(consent);
    try {
      await AsyncStorage.setItem(
        AI_EXTERNAL_PROCESSING_CONSENT_KEY,
        consent ? 'granted' : 'denied'
      );
    } catch (error) {
      console.warn('Failed to persist AI privacy consent:', error);
    }
  };

  const openChat = () => setIsOpen(true);
  const closeChat = () => setIsOpen(false);

  const toggleChat = () => { if (isOpen) closeChat(); else openChat(); };

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduceMotion }), 100);
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isTyping) return;

    const userMsg = createLocalMessage('user', text);
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInputText('');
    setIsTyping(true);
    scrollToBottom();

    try {
      const reply = await getChatResponse(newMessages, {
        role: profile.role,
        district: profile.district,
        state: profile.state,
        fullName: profile.full_name,
        consentToExternalProcessing: consentToExternalProcessing === true,
      });
      setMessages(prev => [...prev, createLocalMessage('assistant', reply)]);
    } catch (err) {
      console.error('[AIChatbot.sendMessage] Failed to fetch assistant response', {
        error: err,
        activeTab,
        userRole: profile.role,
        messageLength: text.length,
      });
      setMessages(prev => [...prev, createLocalMessage('assistant', t('ai.errorReply'))]);
    } finally {
      setIsTyping(false);
      scrollToBottom();
    }
  };

  const canSend = !!inputText.trim() && !isTyping;

  return (
    <>
      <Modal
        visible={isOpen}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        onRequestClose={closeChat}
      >
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kav}>
            <View
              style={[
                styles.sheet,
                { height: panelHeight, backgroundColor: colors.card, borderColor: colors.border },
                !isDark && styles.cardShadow,
              ]}
            >
              {/* Panel header — flat card band, AI identity chip */}
              <View style={[styles.panelHeader, { borderBottomColor: colors.border }]}>
                <View style={styles.panelHeaderLeft}>
                  <View style={[styles.aiAvatarWrap, { backgroundColor: colors.aiBg }]}>
                    <Ionicons name="sparkles" size={24} color={colors.ai} />
                  </View>
                  <View style={styles.panelTitleWrap}>
                    <Text style={[styles.panelTitle, { color: colors.text }]} numberOfLines={1}>
                      {t('ai.assistantTitle')}
                    </Text>
                    <View style={styles.onlineRow}>
                      <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />
                      <Text
                        style={[styles.onlineText, { color: colors.textSecondary }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {t('ai.online')}
                      </Text>
                    </View>
                  </View>
                </View>
                <Pressable
                  onPress={closeChat}
                  accessibilityRole="button"
                  accessibilityLabel={t('ai.closeA11y')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={({ pressed }) => [
                    styles.closeBtn,
                    { backgroundColor: pressed ? colors.cardHover : colors.surfaceVariant },
                  ]}
                >
                  <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
                </Pressable>
              </View>

              {/* Messages */}
              <ScrollView
                ref={scrollRef}
                style={styles.messages}
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={scrollToBottom}
              >
                {messages.map((msg) => (
                  <View
                    key={msg.id}
                    style={[styles.bubbleRow, msg.role === 'user' ? styles.userRow : styles.aiRow]}
                  >
                    {msg.role === 'assistant' && (
                      <View style={[styles.aiAvatarSmall, { backgroundColor: colors.aiBg }]}>
                        <Ionicons name="sparkles" size={16} color={colors.ai} />
                      </View>
                    )}
                    <View
                      style={[
                        styles.bubble,
                        msg.role === 'user'
                          ? { backgroundColor: colors.primary }
                          : { backgroundColor: colors.aiBg, borderWidth: 1, borderColor: colors.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          { color: msg.role === 'user' ? colors.onPrimary : colors.text },
                        ]}
                      >
                        {msg.text}
                      </Text>
                      {msg.timestamp && (
                        <Text
                          style={[
                            styles.timeText,
                            {
                              color: msg.role === 'user' ? colors.onPrimary : colors.textSecondary,
                              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            },
                          ]}
                          maxFontSizeMultiplier={1.3}
                        >
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}

                {/* Typing indicator */}
                {isTyping && (
                  <View style={[styles.bubbleRow, styles.aiRow]}>
                    <View style={[styles.aiAvatarSmall, { backgroundColor: colors.aiBg }]}>
                      <Ionicons name="sparkles" size={16} color={colors.ai} />
                    </View>
                    <View
                      style={[
                        styles.bubble,
                        { backgroundColor: colors.aiBg, borderWidth: 1, borderColor: colors.border },
                      ]}
                      accessibilityLabel={t('ai.typingA11y')}
                    >
                      <View style={styles.typingDots}>
                        {[0, 1, 2].map(i => (
                          <BouncingDot key={i} delay={i * 150} color={colors.ai} animate={!reduceMotion} />
                        ))}
                      </View>
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* Input area */}
              <View style={[styles.inputArea, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
                {consentToExternalProcessing === null && (
                  <View style={[styles.privacyBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.privacyText, { color: colors.text }]}>
                      {t('ai.consentBody')}
                    </Text>
                    <View style={styles.privacyActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('ai.consentDecline')}
                        style={({ pressed }) => [
                          styles.privacyButton,
                          styles.privacyButtonSecondary,
                          {
                            borderColor: colors.inputBorder,
                            backgroundColor: pressed ? colors.cardHover : colors.card,
                          },
                        ]}
                        onPress={() => persistConsent(false)}
                      >
                        <Text style={[styles.privacyButtonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                          {t('ai.consentDecline')}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('ai.consentAllow')}
                        style={({ pressed }) => [
                          styles.privacyButton,
                          { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                        ]}
                        onPress={() => persistConsent(true)}
                      >
                        <Text style={[styles.privacyButtonText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                          {t('ai.consentAllow')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: inputFocused ? colors.inputFocusBorder : colors.inputBorder,
                    borderWidth: inputFocused ? 2 : 1.5,
                  }]}
                  placeholder={t('ai.inputPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  value={inputText}
                  onChangeText={setInputText}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onSubmitEditing={sendMessage}
                  returnKeyType="send"
                  multiline={false}
                  editable={!isTyping}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('ai.sendA11y')}
                  accessibilityState={{ disabled: !canSend }}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    { backgroundColor: pressed && canSend ? colors.aiBg : colors.ai },
                    !canSend && styles.disabledBtn,
                  ]}
                  onPress={sendMessage}
                  disabled={!canSend}
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="arrow-up"
                      size={20}
                      color={pressed && canSend ? colors.ai : colors.textInverse}
                    />
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── FLOATING ACTION BUTTON — indigo AI launcher ── */}
      {activeTab === 'home' && !isOpen && (
        <View style={[styles.fabContainer, { bottom: FAB_BOTTOM }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ai.openA11y')}
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: pressed ? colors.aiBg : colors.ai },
              !isDark && styles.cardShadow,
            ]}
            onPress={toggleChat}
          >
            {({ pressed }) => (
              <Ionicons name="sparkles" size={24} color={pressed ? colors.ai : colors.textInverse} />
            )}
          </Pressable>
        </View>
      )}
    </>
  );
};


// ── Bouncing dot — native-driver translateY, static when reduce-motion ──
const BouncingDot: React.FC<{ delay: number; color: string; animate: boolean }> = ({ delay, color, animate }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) {
      anim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -5, duration: 280, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.delay(600 - delay),
      ])
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [delay, animate]);
  return <Animated.View style={[styles.dot, { backgroundColor: color, transform: [{ translateY: anim }] }]} />;
};

const styles = StyleSheet.create({
  /* ── Light-mode-only shadow (single recipe) ── */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  /* ── Modal ── */
  overlay: { flex: 1, justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  panelHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  panelTitleWrap: { flexShrink: 1 },
  aiAvatarWrap: {
    width: 44, height: 44, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  panelTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  onlineText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  closeBtn: {
    width: 44, height: 44, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center',
  },

  /* ── Messages ── */
  messages: { flex: 1 },
  messagesContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start' },
  aiAvatarSmall: {
    width: 28, height: 28, borderRadius: radii.sm,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 80,
  },
  bubbleText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  timeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: spacing.xs },

  /* ── Typing ── */
  typingDots: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },

  /* ── Input area ── */
  inputArea: {
    flexDirection: 'row', alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
  },
  privacyBanner: {
    width: '100%',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  privacyText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  privacyActions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  privacyButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  privacyButtonSecondary: { borderWidth: 1.5 },
  privacyButtonText: { fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
  sendBtn: {
    width: 48, height: 48, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  disabledBtn: { opacity: 0.4 },

  /* ── FAB — indigo AI launcher ── */
  fabContainer: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 999,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AIChatbot;
