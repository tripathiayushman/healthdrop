// =====================================================
// NOTIFICATIONS INBOX SCREEN — Bharosa §10 (NON-ALERT)
// Same inbox anatomy as B·02 but ink-toned, never
// severity-colored: quiet updates, campaign notices and
// staff advisories. Advisory rows wear the "ADVISORY ·
// TO FIELD STAFF" eyebrow and the quiet "internal —
// never shown to public" caption. Tap expands the row
// and marks it read (own rows in the DB, broadcast rows
// in the on-device ledger). 4-state region,
// pull-to-refresh, load-older pagination.
// =====================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  RefreshControl, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { Profile } from '../../types';
import { advisoriesService, InboxItem } from '../../lib/services/advisories';
import { SkeletonBlock, ErrorCard, EmptyState, SyncPebble, ROLE_ACCENT } from '../dashboards/DashboardShared';

const PAGE_SIZE = 20;

/** Honest relative time; falls back to the date past a month. */
const relativeTime = (iso?: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days <= 30) return `${days}d ago`;
  return format(new Date(t), 'dd MMM yyyy');
};

/** Ink-toned eyebrow per row kind — never a severity word, never a severity color. */
const eyebrowFor = (item: InboxItem): string => {
  if (item.isAdvisory) return 'ADVISORY · TO FIELD STAFF';
  switch (item.type) {
    case 'campaign': return 'CAMPAIGN';
    case 'report':   return 'REPORT';
    case 'warning':  return 'NOTICE';
    case 'success':  return 'UPDATE';
    default:         return 'UPDATE';
  }
};

export default function NotificationsInboxScreen({
  profile, onBack,
}: { profile: Profile; onBack: () => void }) {
  const { colors, isDark, reduceMotion } = useTheme();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // One entrance fade per screen, static under reduce-motion.
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'more', nextPage: number) => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'more') setLoadingMore(true);
    if (mode !== 'more') setLoadError(null);
    try {
      const res = await advisoriesService.listInbox({ profile, page: nextPage, pageSize: PAGE_SIZE });
      if (res.error || !res.data) throw new Error(res.error ?? 'Failed to load');
      const { items: fetched, hasMore: more } = res.data;
      setItems((prev) => {
        if (mode === 'more') {
          // Append, deduped — a row can drift across page boundaries
          // when new notifications arrive between requests.
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...fetched.filter((i) => !seen.has(i.id))];
        }
        return fetched;
      });
      setHasMore(more);
      setPage(nextPage);
    } catch (err: any) {
      console.error('[NotificationsInbox] load failed:', err);
      if (mode === 'more') {
        // Keep the list; surface the miss on the footer instead of nuking content.
        setHasMore(true);
      } else {
        setLoadError("Couldn't load your notifications — check connection.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [profile]);

  useEffect(() => { load('initial', 1); }, [load]);

  const onRefresh = () => { setRefreshing(true); load('refresh', 1); };
  const onLoadMore = () => { if (!loadingMore) load('more', page + 1); };

  // Tap = expand + mark read. Optimistic: the dot leaves at once; a
  // failed write just means it returns on the next refresh.
  const handlePress = (item: InboxItem) => {
    setExpandedId((cur) => (cur === item.id ? null : item.id));
    if (!item.read) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      advisoriesService.markRead(profile, item).then((res) => {
        if (res.error) console.warn('[NotificationsInbox] mark-read failed:', res.error);
      });
    }
  };

  const unreadCount = items.filter((i) => !i.read).length;
  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;
  const headerLine = loading
    ? 'Checking for updates…'
    : unreadCount > 0
      ? `${unreadCount} unread — urgent alerts live in Alerts`
      : 'Quiet updates — urgent alerts live in Alerts';

  const renderItem = ({ item }: { item: InboxItem }) => {
    const expanded = expandedId === item.id;
    const when = relativeTime(item.created_at);
    const a11y =
      `${item.read ? 'Read' : 'Unread'}. ${item.isAdvisory ? 'Staff advisory. ' : ''}` +
      `${item.title}. ${when}. Tap to ${expanded ? 'collapse' : 'read'}.`;

    return (
      <Pressable
        onPress={() => handlePress(item)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={({ pressed }) => [
          st.row,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.border,
          },
          !isDark && st.rowShadow,
        ]}
      >
        {/* Eyebrow · time · unread dot — all ink, never severity-colored */}
        <View style={st.rowTop}>
          <Text style={[st.eyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
            {eyebrowFor(item)}
          </Text>
          <Text style={[st.time, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
            {when}
          </Text>
          {!item.read && <View style={[st.unreadDot, { backgroundColor: colors.primary }]} />}
        </View>

        <Text
          style={[st.title, { color: item.read ? colors.textSecondary : colors.text }]}
          numberOfLines={expanded ? undefined : 2}
        >
          {item.title}
        </Text>
        <Text
          style={[st.message, { color: colors.textSecondary }]}
          numberOfLines={expanded ? undefined : 2}
          maxFontSizeMultiplier={1.3}
        >
          {item.message}
        </Text>

        {item.isAdvisory && (
          <Text style={[st.internalCaption, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
            From the district health office · internal — never shown to public
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg band + Role Ribbon */}
      <View
        style={[
          st.header,
          { backgroundColor: colors.headerBg },
          isDark && { borderBottomWidth: 1, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={st.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={st.headerTextWrap}>
          <Text style={[st.headerTitle, { color: headerText }]} numberOfLines={1}>Notifications</Text>
          <Text style={[st.headerSub, { color: headerSub }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {headerLine}
          </Text>
        </View>
        <SyncPebble />
      </View>
      <View style={[st.roleRibbon, { backgroundColor: accent }]} />

      <Animated.View style={{ flex: 1, opacity: fade }}>
        {/* 4-state region: skeleton / error / quiet zero / content */}
        {loading ? (
          <View style={st.skeletonWrap}>
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
          </View>
        ) : loadError ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <ErrorCard message={loadError} onRetry={() => load('initial', 1)} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={st.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListHeaderComponent={
              items.length > 0 ? (
                <View style={st.listEyebrowRow}>
                  <Text style={[st.listEyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    INBOX<Text style={st.listEyebrowCount}>{` · ${items.length}`}</Text>
                  </Text>
                  {unreadCount > 0 && (
                    <Text style={[st.listEyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                      <Text style={st.listEyebrowCount}>{unreadCount}</Text> UNREAD
                    </Text>
                  )}
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ paddingTop: spacing.lg }}>
                <EmptyState
                  icon="mail-open-outline"
                  color={colors.success}
                  title="You're all caught up"
                  subtitle="Nothing new for your area — advisories and updates land here."
                />
              </View>
            }
            ListFooterComponent={
              hasMore && items.length > 0 ? (
                <Pressable
                  onPress={onLoadMore}
                  disabled={loadingMore}
                  accessibilityRole="button"
                  accessibilityLabel="Load older notifications"
                  style={({ pressed }) => [
                    st.loadMoreBtn,
                    {
                      backgroundColor: pressed ? colors.cardHover : colors.card,
                      borderColor: colors.inputBorder,
                      opacity: loadingMore ? 0.4 : 1,
                    },
                  ]}
                >
                  <Text style={[st.loadMoreText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {loadingMore ? 'Loading…' : 'Load older'}
                  </Text>
                </Pressable>
              ) : null
            }
          />
        )}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: 42, paddingBottom: spacing.xl,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, lineHeight: 30 /* ×1.35+ — Devanagari matras */, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2 },
  roleRibbon: { height: 4, width: '100%' },

  /* Light-mode-only shadow — the single recipe */
  rowShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  /* Skeleton */
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },

  /* List */
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  listEyebrowRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.sm, marginBottom: spacing.md, minHeight: 20,
  },
  listEyebrow: { fontSize: 12, lineHeight: 17 /* ×1.35+ */, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  listEyebrowCount: { fontVariant: ['tabular-nums'] },

  /* Row — B·02 anatomy, ink-toned (§10: never severity-colored) */
  row: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.md,
    minHeight: 64, gap: spacing.xs,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyebrow: {
    flex: 1, fontSize: 12, lineHeight: 17 /* ×1.35+ */, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  time: { fontSize: 12, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  message: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  internalCaption: { fontSize: 12, lineHeight: 17 /* ×1.35+ */, fontWeight: '500', marginTop: 2 },

  /* Load-older footer */
  loadMoreBtn: {
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xs, marginBottom: spacing.sm,
  },
  loadMoreText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
});
