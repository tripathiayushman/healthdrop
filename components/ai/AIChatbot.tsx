// =====================================================
// AI CHATBOT — Floating FAB + Slide-up Chat Panel
// Redesigned: no emoji, no AI/Gemini text, modern icons,
// properly positioned above tab bar + existing FABs
// =====================================================
import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Modal,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/ThemeContext';
import { Profile } from '../../types';
import { getChatResponse } from '../../lib/services/gemini';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PANEL_HEIGHT = SCREEN_HEIGHT * 0.62;

// FAB sits just above the tab bar (70px) + an extra gap from add buttons (58px)
// Total safe bottom offset = tab bar(70) + add-button-height(56) + gap(12) = 138
const FAB_BOTTOM = 144;

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

const INITIAL_MESSAGE: LocalChatMessage = {
  id: 'initial-message',
  role: 'assistant',
  text: "Hello! I am your HealthDrop assistant.\n\nI can help with disease information, water quality guidance, app navigation, and general health advice. What would you like to know?",
};

export const AIChatbot: React.FC<AIChatbotProps> = ({ profile, activeTab }) => {
  const { colors, isDark } = useTheme();
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
    { ...INITIAL_MESSAGE, id: createMessageId(), timestamp: new Date() },
  ]);
  const [inputText, setInputText] = useState('');
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

  // ── Draggable FAB (native only) ──────────────────────────────
  const IS_MOBILE = Platform.OS !== 'web';
  const { width: SW, height: SH } = Dimensions.get('window');
  const FAB_SIZE = 64;
  const defaultFabX = SW - FAB_SIZE - 16;
  const defaultFabY = SH - FAB_BOTTOM - FAB_SIZE;
  const fabPos = useRef(new Animated.ValueXY({ x: defaultFabX, y: defaultFabY })).current;
  const posRef = useRef({ x: defaultFabX, y: defaultFabY });
  const dragStartRef = useRef({ x: defaultFabX, y: defaultFabY });
  const isDragging = useRef(false);
  const fabPanResponder = useRef(
    IS_MOBILE
      ? PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: (_, gs) =>
            Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
          onPanResponderGrant: () => {
            isDragging.current = false;
            dragStartRef.current = { ...posRef.current };
          },
          onPanResponderMove: (_, gs) => {
            if (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5) {
              isDragging.current = true;
            }
            const nextX = dragStartRef.current.x + gs.dx;
            const nextY = dragStartRef.current.y + gs.dy;
            posRef.current = { x: nextX, y: nextY };
            fabPos.setValue({ x: nextX, y: nextY });
          },
          onPanResponderRelease: (_, gs) => {
            if (!isDragging.current) {
              toggleChat();
              return;
            }
            // Snap to nearest horizontal edge
            const currentX = posRef.current.x ?? defaultFabX;
            const snapX = currentX + FAB_SIZE / 2 < SW / 2 ? 16 : SW - FAB_SIZE - 16;
            // Clamp Y within screen
            const rawY = posRef.current.y ?? defaultFabY;
            const clampedY = Math.max(50, Math.min(rawY, SH - FAB_BOTTOM - FAB_SIZE - 8));
            posRef.current = { x: snapX, y: clampedY };
            Animated.spring(fabPos, {
              toValue: { x: snapX, y: clampedY },
              useNativeDriver: false,
              tension: 60,
              friction: 10,
            }).start(() => {
              fabPos.setValue(posRef.current);
            });
          },
        })
      : { panHandlers: {} }
  ).current;

  const openChat = () => setIsOpen(true);
  const closeChat = () => setIsOpen(false);

  const toggleChat = () => { if (isOpen) closeChat(); else openChat(); };

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
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
      setMessages(prev => [...prev, createLocalMessage('assistant', "Sorry, I could not connect right now. Please try again shortly.")]);
    } finally {
      setIsTyping(false);
      scrollToBottom();
    }
  };

  // Colours
  const panelBg   = isDark ? 'rgba(15,15,15,0.75)' : 'rgba(255,255,255,0.85)';
  const aiBubble  = '#000000'; // Black text bubble requested by user
  const userBubble = '#1A1A1A'; // Slightly lighter black for distinction or matching
  const aiText    = '#FFFFFF'; // White text requested by user
  const userText  = '#FFFFFF';

  return (
    <>
      <Modal visible={isOpen} animationType="slide" transparent onRequestClose={closeChat}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
            <View
              style={[
                styles.sheet,
                { backgroundColor: panelBg, borderColor: isDark ? '#2A2A4A' : '#E2E8F0' },
                isDark && Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}
              ]}
            >
          <View
            style={[
              styles.panelHeader, 
              { backgroundColor: isDark ? 'rgba(20,20,20,0.8)' : 'rgba(30,30,30,0.85)' },
              Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}
            ]}
          >
            <View style={styles.panelHeaderLeft}>
              <View style={styles.aiAvatarWrap}>
                <Ionicons name="hardware-chip" size={20} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.panelTitle}>Health Assistant</Text>
                <View style={styles.onlineRow}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.onlineText}>Online</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity onPress={closeChat} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="chevron-down" size={22} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
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
                  <View style={[styles.aiAvatarSmall, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                    <Ionicons name="hardware-chip" size={14} color={isDark ? '#FFFFFF' : '#000000'} />
                  </View>
                )}
                <View
                  style={[
                    styles.bubble,
                    msg.role === 'user'
                      ? [styles.userBubble, { backgroundColor: userBubble }]
                      : [styles.aiBubble, { backgroundColor: aiBubble }],
                  ]}
                >
                  <Text style={[styles.bubbleText, { color: msg.role === 'user' ? userText : aiText }]}>
                    {msg.text}
                  </Text>
                  {msg.timestamp && (
                    <Text style={[styles.timeText, { color: 'rgba(255,255,255,0.6)', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }]}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                </View>
              </View>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <View style={[styles.bubbleRow, styles.aiRow]}>
                <View style={[styles.aiAvatarSmall, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
                  <Ionicons name="hardware-chip" size={14} color={isDark ? '#FFFFFF' : '#000000'} />
                </View>
                <View style={[styles.bubble, styles.aiBubble, { backgroundColor: aiBubble }]}>
                  <View style={styles.typingDots}>
                    {[0, 1, 2].map(i => <BouncingDot key={i} delay={i * 150} color={colors.textSecondary} />)}
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Input Area */}
          <View style={[styles.inputArea, { borderTopColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', backgroundColor: 'transparent' }, Platform.OS === 'web' ? { backdropFilter: 'blur(16px)' } as any : {}]}>
            {consentToExternalProcessing === null && (
              <View style={[styles.privacyBanner, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderColor: colors.border }]}>
                <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
                  Messages are processed by an external AI service. Share your name for personalized responses?
                </Text>
                <View style={styles.privacyActions}>
                  <TouchableOpacity
                    style={[styles.privacyButton, { borderColor: colors.border, backgroundColor: colors.background }]}
                    onPress={() => persistConsent(false)}
                  >
                    <Text style={[styles.privacyButtonText, { color: colors.text }]}>No, stay anonymous</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.privacyButton, { borderColor: '#10B981', backgroundColor: '#10B981' }]}
                    onPress={() => persistConsent(true)}
                  >
                    <Text style={[styles.privacyButtonText, { color: '#FFFFFF' }]}>Allow name</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <TextInput
              style={[styles.input, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                color: isDark ? '#E0E0F0' : colors.text,
                borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
              }]}
              placeholder="Ask a health question..."
              placeholderTextColor={colors.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              multiline={false}
              editable={!isTyping}
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: inputText.trim() && !isTyping ? '#000000' : colors.border }]}
              onPress={sendMessage}
              disabled={!inputText.trim() || isTyping}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── FLOATING ACTION BUTTON ─────────────────────────────── */}
      {activeTab !== 'profile' && !isOpen && (
        IS_MOBILE ? (
          // Draggable FAB — native only
          <Animated.View
            style={[
              styles.fabContainer,
              {
                position: 'absolute',
                transform: fabPos.getTranslateTransform(),
                bottom: undefined, right: undefined, top: 0, left: 0,
              }
            ]}
            {...fabPanResponder.panHandlers}
          >
            <View
              style={[
                styles.fab,
                isDark
                  ? { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 }
                  : { backgroundColor: '#000000' },
              ]}
            >
              <Ionicons name="sparkles" size={30} color={isDark ? '#E0E0F0' : '#FFFFFF'} />
            </View>
          </Animated.View>
        ) : (
          // Fixed FAB — web only
          <View style={[styles.fabContainer, { bottom: FAB_BOTTOM }]}>
            <TouchableOpacity
              style={[
                styles.fab,
                isDark
                  ? { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 }
                  : { backgroundColor: '#000000' },
                { backdropFilter: 'blur(16px)' } as any
              ]}
              onPress={toggleChat}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles" size={30} color={isDark ? '#E0E0F0' : '#FFFFFF'} />
            </TouchableOpacity>
          </View>
        )
      )}
    </>
  );
};


// ── Bouncing dot ────────────────────────────────────────────────────────────
const BouncingDot: React.FC<{ delay: number; color: string }> = ({ delay, color }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -5, duration: 280, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 280, useNativeDriver: false }),
        Animated.delay(600 - delay),
      ])
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [delay]);
  return <Animated.View style={[styles.dot, { backgroundColor: color, transform: [{ translateY: anim }] }]} />;
};

const styles = StyleSheet.create({
  // ── Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end'
  },
  sheet: {
    height: PANEL_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 20,
    width: '100%'
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  panelHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiAvatarWrap: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  panelTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },
  onlineText: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  closeBtn: { padding: 6 },

  // ── Messages
  messages: { flex: 1 },
  messagesContent: { padding: 14, gap: 10, paddingBottom: 8 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start' },
  aiAvatarSmall: {
    width: 28, height: 28, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, minWidth: 80 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  timeText: { fontSize: 10, marginTop: 4 },

  // ── Typing
  typingDots: { flexDirection: 'row', gap: 4, paddingVertical: 4, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },

  // ── Input area
  inputArea: {
    flexDirection: 'row', alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1,
  },
  privacyBanner: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 2,
  },
  privacyText: {
    fontSize: 12,
    lineHeight: 17,
  },
  privacyActions: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  privacyButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  privacyButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    flex: 1, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, borderWidth: 1,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },

  // ── FAB — matches Reports/Campaign add button style
  fabContainer: {
    position: 'absolute',
    right: 16,
    zIndex: 999,
  },
  fab: {
    width: 64, // Increased from 54
    height: 64, // Increased from 54
    borderRadius: 32, // Increased from 27
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
});

export default AIChatbot;
