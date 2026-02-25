// =====================================================
// AI CHATBOT — Floating FAB + Slide-up Chat Panel
// Redesigned: no emoji, no AI/Gemini text, modern icons,
// properly positioned above tab bar + existing FABs
// =====================================================
import React, { useState, useRef, useEffect } from 'react';
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
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../lib/ThemeContext';
import { Profile } from '../../types';
import { getChatResponse, ChatMessage } from '../../lib/services/gemini';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const PANEL_HEIGHT = SCREEN_HEIGHT * 0.62;

// FAB sits just above the tab bar (70px) + an extra gap from add buttons (58px)
// Total safe bottom offset = tab bar(70) + add-button-height(56) + gap(12) = 138
const FAB_BOTTOM = 144;

interface AIChatbotProps {
  profile: Profile;
  activeTab?: string; // hide FAB on profile tab
}

const INITIAL_MESSAGE: ChatMessage = {
  role: 'model',
  text: "Hello! I am your HealthDrop assistant.\n\nI can help with disease information, water quality guidance, app navigation, and general health advice. What would you like to know?",
};

export const AIChatbot: React.FC<AIChatbotProps> = ({ profile, activeTab }) => {
  const { colors, isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const slideAnim = useRef(new Animated.Value(PANEL_HEIGHT)).current;
  const scrollRef = useRef<ScrollView>(null);

  const openChat = () => {
    setIsOpen(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: false,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeChat = () => {
    Animated.timing(slideAnim, {
      toValue: PANEL_HEIGHT,
      duration: 260,
      useNativeDriver: false,
    }).start(() => setIsOpen(false));
  };

  const toggleChat = () => { if (isOpen) closeChat(); else openChat(); };

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = { role: 'user', text };
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
      });
      setMessages(prev => [...prev, { role: 'model', text: reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'model',
        text: "Sorry, I could not connect right now. Please try again shortly.",
      }]);
    } finally {
      setIsTyping(false);
      scrollToBottom();
    }
  };

  // Colours
  const panelBg   = isDark ? '#1A1A2E' : '#FFFFFF';
  const aiBubble  = isDark ? '#252540' : '#F0F4FD';
  const aiText    = isDark ? '#E0E0F0' : '#1E293B';
  const userText  = '#FFFFFF';

  return (
    <>
      {/* ── SLIDING CHAT PANEL ───────────────────────────────────── */}
      {isOpen && (
        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: panelBg,
              bottom: FAB_BOTTOM - 4, // panel sits above the FAB
              transform: [{ translateY: slideAnim }],
              borderColor: isDark ? '#2A2A4A' : '#E2E8F0',
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Panel Header */}
          <LinearGradient
            colors={isDark ? ['#1E1B4B', '#312E81'] : ['#1976D2', '#42A5F5']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.panelHeader}
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
          </LinearGradient>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToBottom}
          >
            {messages.map((msg, i) => (
              <View
                key={i}
                style={[styles.bubbleRow, msg.role === 'user' ? styles.userRow : styles.aiRow]}
              >
                {msg.role === 'model' && (
                  <View style={[styles.aiAvatarSmall, { backgroundColor: colors.primary + '25' }]}>
                    <Ionicons name="hardware-chip" size={14} color={colors.primary} />
                  </View>
                )}
                <View
                  style={[
                    styles.bubble,
                    msg.role === 'user'
                      ? [styles.userBubble, { backgroundColor: colors.primary }]
                      : [styles.aiBubble, { backgroundColor: aiBubble }],
                  ]}
                >
                  <Text style={[styles.bubbleText, { color: msg.role === 'user' ? userText : aiText }]}>
                    {msg.text}
                  </Text>
                </View>
              </View>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <View style={[styles.bubbleRow, styles.aiRow]}>
                <View style={[styles.aiAvatarSmall, { backgroundColor: colors.primary + '25' }]}>
                  <Ionicons name="hardware-chip" size={14} color={colors.primary} />
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
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.inputArea, { borderTopColor: isDark ? '#2A2A4A' : '#E2E8F0', backgroundColor: panelBg }]}>
              <TextInput
                style={[styles.input, {
                  backgroundColor: isDark ? '#252540' : '#F1F5F9',
                  color: isDark ? '#E0E0F0' : colors.text,
                  borderColor: isDark ? '#373760' : '#E2E8F0',
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
                style={[styles.sendBtn, { backgroundColor: inputText.trim() && !isTyping ? colors.primary : colors.border }]}
                onPress={sendMessage}
                disabled={!inputText.trim() || isTyping}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      )}

      {/* ── FLOATING ACTION BUTTON ─────────────────────────────── */}
      {/* AI FAB — only on Home tab to avoid stacking with Reports/Campaign add buttons */}
      {activeTab === 'home' && !isOpen && (
        <View style={[styles.fabContainer, { bottom: FAB_BOTTOM }]}>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary }]}
            onPress={toggleChat}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}
    </>
  );
};


// ── Bouncing dot ────────────────────────────────────────────────────────────
const BouncingDot: React.FC<{ delay: number; color: string }> = ({ delay, color }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -5, duration: 280, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 280, useNativeDriver: false }),
        Animated.delay(600 - delay),
      ])
    ).start();
  }, []);
  return <Animated.View style={[styles.dot, { backgroundColor: color, transform: [{ translateY: anim }] }]} />;
};

const styles = StyleSheet.create({
  // ── Panel
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: PANEL_HEIGHT,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 998,
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
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },

  // ── Typing
  typingDots: { flexDirection: 'row', gap: 4, paddingVertical: 4, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },

  // ── Input area
  inputArea: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1,
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
    width: 54,
    height: 54,
    borderRadius: 27,
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
