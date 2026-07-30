// =====================================================
// SYNC OUTBOX SCREEN ("Prakash" design)
// Reports saved on this phone, waiting to upload.
// Reads the offline queue (SyncQueue), supports
// retry-all (Sync now) and per-item delete.
// 4-state data region; offline is a reassuring
// first-class mode, never an error.
// =====================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  Modal, RefreshControl, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { syncQueue, QueueItem, QueueItemType, QueueItemStatus } from '../../src/services/offlineSync/SyncQueue';
import { offlineSyncService } from '../../src/services/offlineSync/OfflineSyncService';
import { SkeletonBlock, ErrorCard, EmptyState, SyncPebble, ROLE_ACCENT } from '../dashboards/DashboardShared';
import { Profile } from '../../types';

// Mirrors MAX_ATTEMPTS in OfflineSyncService.ts (not exported there).
const MAX_ATTEMPTS = 3;
// A 'syncing' item whose last attempt is older than this is considered
// stuck (app killed mid-sync) and is safe to reset to 'pending'.
const STALE_SYNCING_MS = 2 * 60 * 1000;

const TYPE_LABEL: Record<QueueItemType, string> = {
  disease_report:       'Disease report',
  water_quality_report: 'Water quality report',
  campaign:             'Campaign',
  health_alert:         'Health alert',
  feedback:             'Feedback',
};

const TYPE_ICON: Record<QueueItemType, keyof typeof Ionicons.glyphMap> = {
  disease_report:       'medkit-outline',
  water_quality_report: 'water-outline',
  campaign:             'megaphone-outline',
  health_alert:         'alert-circle-outline',
  feedback:             'chatbox-ellipses-outline',
};

const formatShortDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
};

/** Best-effort human title from the queued payload — read defensively. */
const payloadTitle = (item: QueueItem): string | null => {
  const p = item.payload as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object') return null;
  for (const key of ['disease_name', 'source_name', 'title', 'name']) {
    const v = p[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
};

// ─────────────────────────────────────────────────────
//  Status pill — dot + UPPERCASE label on *Bg token.
//  (Solid fill stays reserved for CRITICAL severity.)
// ─────────────────────────────────────────────────────
const QueueStatusPill: React.FC<{ status: QueueItemStatus; permanentlyFailed: boolean }> = ({
  status, permanentlyFailed,
}) => {
  const { colors } = useTheme();
  let bg = colors.surfaceVariant;
  let fg = colors.textSecondary;
  let label = 'SAVED';
  let spoken = 'saved on phone';

  if (status === 'pending') {
    bg = colors.warningBg; fg = colors.warning; label = 'QUEUED'; spoken = 'queued, waiting to upload';
  } else if (status === 'syncing') {
    bg = colors.infoBg; fg = colors.info; label = 'UPLOADING'; spoken = 'uploading now';
  } else if (status === 'failed') {
    bg = colors.dangerBg; fg = colors.danger;
    label = permanentlyFailed ? 'NEEDS RETRY' : 'RETRYING';
    spoken = permanentlyFailed ? 'upload failed, needs retry' : 'upload failed, retrying';
  } else if (status === 'synced') {
    bg = colors.successBg; fg = colors.success; label = 'SYNCED'; spoken = 'synced';
  }

  return (
    <View style={[st.pill, { backgroundColor: bg }]} accessibilityLabel={`Status: ${spoken}`}>
      <View style={[st.pillDot, { backgroundColor: fg }]} />
      <Text style={[st.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────
export default function SyncOutboxScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { colors, isDark, reduceMotion } = useTheme();
  const netInfo = useNetInfo();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  // NetInfo reports isInternetReachable === null before its first probe — treat as online.
  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<{ kind: 'ok' | 'warn' | 'fail'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QueueItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // One entrance fade, 200ms, static under reduce-motion.
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const all = await syncQueue.getAll();
      const visible = all
        .filter((i) => i.status !== 'synced')
        .sort((a, b) => {
          const ta = new Date(a.createdAt).getTime() || 0;
          const tb = new Date(b.createdAt).getTime() || 0;
          return tb - ta;
        });
      setItems(visible);
    } catch (err) {
      console.error('[SyncOutbox] failed to read queue:', err);
      setLoadError("Couldn't read the reports saved on this phone");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Queue emits on enqueue / removal; per-item status patches are
    // picked up on the post-sync reload and pull-to-refresh.
    const unsubscribe = syncQueue.onChange(() => { load(); });
    return unsubscribe;
  }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // ── Retry-all: revive permanently-failed + stuck items, then sync ──
  const handleSyncNow = async () => {
    if (syncing || offline) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const now = Date.now();
      const all = await syncQueue.getAll();
      for (const item of all) {
        if (item.status === 'failed' && item.attempts >= MAX_ATTEMPTS) {
          await syncQueue.updateItem(item.localId, { status: 'pending', attempts: 0, error: null });
        } else if (item.status === 'syncing') {
          const last = item.lastAttempt ? new Date(item.lastAttempt).getTime() : 0;
          if (!last || now - last > STALE_SYNCING_MS) {
            await syncQueue.updateItem(item.localId, { status: 'pending' });
          }
        }
      }
      const res = await offlineSyncService.triggerSync();
      if (res.failed > 0) {
        setLastResult({
          kind: 'warn',
          text: `${res.synced} uploaded · ${res.failed} still waiting — will keep retrying`,
        });
      } else if (res.synced > 0) {
        setLastResult({
          kind: 'ok',
          text: `Uploaded ${res.synced} ${res.synced === 1 ? 'report' : 'reports'}`,
        });
      } else {
        setLastResult({ kind: 'ok', text: 'Already up to date' });
      }
    } catch (err) {
      console.error('[SyncOutbox] sync failed:', err);
      setLastResult({ kind: 'fail', text: "Couldn't sync — will retry automatically when connection improves" });
    } finally {
      setSyncing(false);
      load();
    }
  };

  // ── Delete one item (mark synced, then purge synced) ──
  const confirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await syncQueue.updateItem(deleteTarget.localId, { status: 'synced' });
      await syncQueue.removeSynced(); // drops it from storage + notifies listeners
      setDeleteTarget(null);
      await load();
    } catch (err) {
      console.error('[SyncOutbox] delete failed:', err);
      setDeleteError("Couldn't remove it — try again");
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Header copy — reassuring, honest ──
  const headerText = isDark ? colors.text : colors.textInverse;
  const headerSub = isDark ? colors.textSecondary : colors.primaryLight;
  const n = items.length;
  const headerLine = loading
    ? 'Checking saved reports…'
    : n === 0
      ? 'Everything is safely uploaded'
      : offline
        ? `${n} ${n === 1 ? 'report' : 'reports'} saved on phone — will sync when online`
        : `${n} ${n === 1 ? 'report' : 'reports'} saved on phone — syncing automatically`;

  const resultColor = lastResult?.kind === 'ok'
    ? colors.success
    : lastResult?.kind === 'warn'
      ? colors.warning
      : colors.danger;
  const resultIcon: keyof typeof Ionicons.glyphMap = lastResult?.kind === 'ok'
    ? 'checkmark-circle-outline'
    : 'alert-circle-outline';

  // ── Row ──
  const renderItem = ({ item }: { item: QueueItem }) => {
    const permanentlyFailed = item.status === 'failed' && item.attempts >= MAX_ATTEMPTS;
    const title = payloadTitle(item) ?? TYPE_LABEL[item.type] ?? 'Saved report';
    const subtitle = payloadTitle(item)
      ? `${TYPE_LABEL[item.type] ?? 'Report'} · Saved ${formatShortDateTime(item.createdAt) || '—'}`
      : `Saved ${formatShortDateTime(item.createdAt) || '—'}`;

    return (
      <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && st.cardShadow]}>
        <View style={st.cardRow}>
          <View style={[st.iconWrap, { backgroundColor: colors.surfaceVariant }]}>
            <Ionicons
              name={TYPE_ICON[item.type] ?? 'document-text-outline'}
              size={24}
              color={colors.textSecondary}
            />
          </View>
          <View style={st.cardBody}>
            <Text style={[st.cardTitle, { color: colors.text }]} numberOfLines={2}>{title}</Text>
            <Text
              style={[st.cardSub, { color: colors.textSecondary }]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.3}
            >
              {subtitle}
            </Text>
          </View>
          <QueueStatusPill status={item.status} permanentlyFailed={permanentlyFailed} />
        </View>

        {(item.status === 'failed' || item.error) && (
          <View style={[st.failBox, { backgroundColor: colors.dangerBg }]}>
            <View style={st.failRow}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
              <Text style={[st.failTitle, { color: colors.text }]}>
                {permanentlyFailed
                  ? `Couldn't upload after ${item.attempts} tries — tap Sync now to retry.`
                  : "Last upload didn't go through — it will be retried."}
              </Text>
            </View>
            {!!item.error && (
              <Text style={[st.failDetail, { color: colors.textSecondary }]} numberOfLines={2}>
                {item.error}
              </Text>
            )}
          </View>
        )}

        <View style={st.cardFooter}>
          {item.attempts > 0 ? (
            <Text style={[st.attemptsText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
              Tried {item.attempts} of {MAX_ATTEMPTS} {item.attempts === 1 ? 'time' : 'times'}
            </Text>
          ) : <View />}
          <TouchableOpacity
            onPress={() => { setDeleteError(null); setDeleteTarget(item); }}
            style={st.deleteBtn}
            accessibilityRole="button"
            accessibilityLabel={`Delete saved ${TYPE_LABEL[item.type] ?? 'report'}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
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
          <Text style={[st.headerTitle, { color: headerText }]} numberOfLines={1}>Sync Outbox</Text>
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
            <SkeletonBlock height={96} radius={radii.md} />
            <SkeletonBlock height={96} radius={radii.md} />
            <SkeletonBlock height={96} radius={radii.md} />
          </View>
        ) : loadError ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <ErrorCard message={loadError} onRetry={load} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.localId}
            renderItem={renderItem}
            contentContainerStyle={st.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListHeaderComponent={
              items.length > 0 ? (
                <View style={st.eyebrowRow}>
                  <Text style={[st.eyebrow, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    SAVED ON THIS PHONE
                    <Text style={st.eyebrowCount}>{` · ${items.length}`}</Text>
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ paddingTop: spacing.lg }}>
                <EmptyState
                  icon="checkmark-circle-outline"
                  color={colors.success}
                  title="All synced — nothing waiting on this phone."
                  subtitle="Reports you file while offline are saved here first, then uploaded automatically."
                />
              </View>
            }
          />
        )}
      </Animated.View>

      {/* One-Hand Action Bar — docked Sync now */}
      {!loading && !loadError && items.length > 0 && (
        <View style={[st.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {offline && (
            <View style={st.barNoteRow}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.offline} />
              <Text style={[st.barNote, { color: colors.offline }]} maxFontSizeMultiplier={1.3}>
                You're offline — reports are safe here and will sync automatically.
              </Text>
            </View>
          )}
          {!offline && lastResult && (
            <View style={st.barNoteRow}>
              <Ionicons name={resultIcon} size={16} color={resultColor} />
              <Text style={[st.barNote, { color: resultColor }]} maxFontSizeMultiplier={1.3}>
                {lastResult.text}
              </Text>
            </View>
          )}
          <Pressable
            onPress={handleSyncNow}
            disabled={offline || syncing}
            accessibilityRole="button"
            accessibilityLabel={syncing ? 'Syncing now' : `Sync now, ${items.length} waiting`}
            style={({ pressed }) => [
              st.syncBtn,
              {
                backgroundColor: pressed ? colors.primaryDark : colors.primary,
                opacity: offline || syncing ? 0.4 : 1,
              },
            ]}
          >
            <Text style={[st.syncBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
              {syncing ? 'Syncing…' : `Sync now (${items.length})`}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Confirm delete — destructive, irreversible */}
      <Modal
        visible={!!deleteTarget}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => { if (!deleteBusy) setDeleteTarget(null); }}
      >
        <View style={[st.overlay, { backgroundColor: colors.overlay }]}>
          <View style={[st.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[st.confirmTitle, { color: colors.text }]}>Remove this saved report?</Text>
            <Text style={[st.confirmBody, { color: colors.textSecondary }]}>
              It hasn't been uploaded yet. Removing it deletes the information from this phone — this can't be undone.
            </Text>
            {!!deleteError && (
              <View style={st.barNoteRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={[st.barNote, { color: colors.danger }]}>{deleteError}</Text>
              </View>
            )}
            <View style={st.confirmBtnRow}>
              <Pressable
                onPress={() => { if (!deleteBusy) setDeleteTarget(null); }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [
                  st.confirmBtn,
                  {
                    backgroundColor: pressed ? colors.cardHover : colors.card,
                    borderWidth: 1.5,
                    borderColor: colors.inputBorder,
                  },
                ]}
              >
                <Text style={[st.confirmBtnText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={deleteBusy}
                accessibilityRole="button"
                accessibilityLabel="Remove saved report permanently"
                style={({ pressed }) => [
                  st.confirmBtn,
                  {
                    backgroundColor: pressed ? colors.severityCritical : colors.danger,
                    opacity: deleteBusy ? 0.4 : 1,
                  },
                ]}
              >
                <Text style={[st.confirmBtnText, { color: colors.textInverse }]} maxFontSizeMultiplier={1.3}>
                  {deleteBusy ? 'Removing…' : 'Remove'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1 },

  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: 42, paddingBottom: spacing.xl,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2 },
  roleRibbon: { height: 4, width: '100%' },

  /* Eyebrow section header */
  eyebrowRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.sm, marginBottom: spacing.md, minHeight: 20,
  },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  eyebrowCount: { fontVariant: ['tabular-nums'] },

  /* Skeleton */
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },

  /* List */
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },

  /* Card row */
  card: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.md,
    minHeight: 64,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  cardSub: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2, fontVariant: ['tabular-nums'] },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  attemptsText: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  deleteBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm, marginBottom: -spacing.sm },

  /* Failed-upload framing */
  failBox: { borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  failRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  failTitle: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  failDetail: { fontSize: 12, lineHeight: 16, fontWeight: '600' },

  /* Status pill */
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill, alignSelf: 'flex-start',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },

  /* One-Hand Action Bar */
  actionBar: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  barNoteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barNote: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  syncBtn: {
    minHeight: 56, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  syncBtnText: { fontSize: 16, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },

  /* Confirm-delete modal */
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: {
    width: '100%', maxWidth: 420,
    borderRadius: radii.lg, borderWidth: 1,
    padding: spacing.xl, gap: spacing.md,
  },
  confirmTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  confirmBody: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  confirmBtnRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  confirmBtn: {
    flex: 1, minHeight: 48, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  confirmBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
});
