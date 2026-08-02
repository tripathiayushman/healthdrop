// =====================================================
// MY REPORTS — Bharosa A·06 (status & the WHY)
// Personal timeline of everything the signed-in user
// has filed — merged, newest first:
//   · still on this phone   → the offline SyncQueue
//   · with the officials    → disease reports (reporter_id),
//     water quality reports (reporter_id) and health
//     alerts (created_by)
// Rejection is "Not accepted" + the officer's exact words,
// name and time — and always a path forward (Fix & refile).
// Approval pays her back: the stamp, and — when the
// report fell inside an outbreak window — proof it
// became protection. 4-state data region.
//
// BRK-15 — one honest answer to "where is my report?".
// A field worker has no reason to know the difference
// between "saved on the phone" and "reached the server",
// so both live on this screen. The distinction still
// matters enormously — it is the difference between the
// district officer being able to see her report and only
// her being able to — so a queued row is triple-coded:
// an amber rail, an amber icon well, and a band that says
// it in words. Retry ("Sync now") runs the SAME recovery
// path as the Outbox (retryQueuedUploads → attempts reset
// to 0), so a report can never be stranded here at 3
// failed attempts. Delete and the full sync ledger stay
// on the Sync Outbox screen.
// =====================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Pressable,
  RefreshControl, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { formatDateTime, formatTime } from '../../lib/format';
import { SkeletonBlock, ErrorCard, EmptyState, SyncPebble, VerifiedStamp, ROLE_ACCENT } from '../dashboards/DashboardShared';
import { syncQueue, QueueItem } from '../../src/services/offlineSync/SyncQueue';
import {
  MAX_ATTEMPTS, QUEUE_TYPE_ICON, QUEUE_TYPE_LABEL_KEY, QueueStatusPill,
  isPermanentlyFailed, queuePayloadTitle, retryQueuedUploads, visibleQueueItems,
} from './SyncOutboxScreen';
import { Profile } from '../../types';

type SubmissionKind = 'disease' | 'water' | 'alert';

/** Which server query failed — translated at render, never stored in English. */
type SubmissionSource = 'disease' | 'water' | 'alerts';

interface SubmissionRow {
  key: string;
  id: string;
  kind: SubmissionKind;
  /** Raw server text; '' when the row has none — translated at render, so a
   *  language switch never re-fetches. */
  title: string;
  meta: string;
  created_at: string;
  updated_at: string | null;
  approval_status: string | null;
  rejection_reason: string | null;
  approver_name: string | null;
  approved_at: string | null;
}

/** A·06 payback — the approved disease report fed an outbreak window. */
interface OutbreakPayback {
  district: string;
  disease: string;
  /**
   * The detection rule filed in-app notices to district officials.
   * NOT "a public alert went out" — see OutbreakLite.alert_sent.
   */
  officialsNotified: boolean;
}

interface OutbreakLite {
  disease_name: string | null;
  district: string | null;
  window_start: string | null;
  window_end: string | null;
  /**
   * BRK-10: this column is misnamed. `detect_outbreak_after_report()` runs
   * `UPDATE outbreaks SET alert_sent = TRUE` immediately after inserting
   * `notifications` rows for super_admin / health_admin (unscoped) and
   * clinic / district_officer (district-scoped) — before any human decides
   * anything, and without creating a `health_alerts` row. It is the only
   * function in the schema that writes the column, and the app never sends
   * it in an update. So TRUE means exactly one thing: officials got an
   * in-app notice. It says nothing about whether the public was warned, and
   * this screen must never render it as "district alert issued".
   *
   * Whether an approved public alert exists is a separate fact, resolved by
   * lib/services/outbreaks.ts from `health_alerts.metadata->>'outbreak_id'`.
   * This screen deliberately does not make that claim: it would need its own
   * query with its own four states, and getting it wrong here — on the ASHA
   * worker's own screen — is the most expensive place in the app to lie.
   */
  alert_sent: boolean | null;
  triggered_by_report_id: string | null;
}

// The queue speaks the same vocabulary — reuse its already-bilingual keys so
// "Disease report" is one string in one place for both halves of the screen.
const KIND_LABEL_KEY: Record<SubmissionKind, string> = {
  disease: QUEUE_TYPE_LABEL_KEY.disease_report,
  water:   QUEUE_TYPE_LABEL_KEY.water_quality_report,
  alert:   QUEUE_TYPE_LABEL_KEY.health_alert,
};

const KIND_ICON: Record<SubmissionKind, keyof typeof Ionicons.glyphMap> = {
  disease: 'medkit-outline',
  water:   'water-outline',
  alert:   'alert-circle-outline',
};

const SOURCE_LABEL: Record<SubmissionSource, { key: string; en: string }> = {
  disease: { key: 'submissions.sourceDisease', en: 'disease reports' },
  water:   { key: 'submissions.sourceWater',   en: 'water reports' },
  alerts:  { key: 'submissions.sourceAlerts',  en: 'health alerts' },
};

// Defensive readers — rejection_reason and approval_status are selected via
// select('*') and may be absent on older schemas.
const str = (row: Record<string, unknown>, key: string): string | null => {
  const v = row[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
};

const approverNameOf = (row: Record<string, unknown>): string | null => {
  const a = row.approver as { full_name?: unknown } | null | undefined;
  return a && typeof a.full_name === 'string' && a.full_name.trim().length > 0
    ? a.full_name.trim()
    : null;
};

const buildMeta = (row: Record<string, unknown>): string =>
  [str(row, 'location_name'), str(row, 'district')].filter(Boolean).join(', ');

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

// ─────────────────────────────────────────────────────
//  The merged timeline: queued items first (they still
//  need her), then everything that reached the server.
// ─────────────────────────────────────────────────────
type ListEntry =
  | { entry: 'queuedHeader'; key: string; count: number }
  | { entry: 'queued'; key: string; item: QueueItem }
  | { entry: 'serverHeader'; key: string; count: number }
  | { entry: 'server'; key: string; row: SubmissionRow };

// ─────────────────────────────────────────────────────
//  Approval pill — dot + UPPERCASE label on *Bg token
// ─────────────────────────────────────────────────────
const ApprovalPill: React.FC<{ status: string | null }> = ({ status }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const s = (status ?? '').toLowerCase();

  let bg = colors.surfaceVariant;
  let fg = colors.textSecondary;
  let label = t('submissions.statusSubmitted', { defaultValue: 'SUBMITTED' });
  let spoken = 'submitted';

  if (s === 'pending_approval' || s === 'pending') {
    bg = colors.warningBg; fg = colors.warning;
    label = t('submissions.statusPending', { defaultValue: 'PENDING' });
    spoken = 'pending review';
  } else if (s === 'approved') {
    bg = colors.successBg; fg = colors.success;
    label = t('submissions.statusApproved', { defaultValue: 'APPROVED' });
    spoken = 'approved';
  } else if (s === 'rejected') {
    bg = colors.dangerBg; fg = colors.danger;
    label = t('submissions.statusRejected', { defaultValue: 'NOT ACCEPTED' });
    spoken = 'not accepted';
  }

  return (
    <View style={[ms.pill, { backgroundColor: bg }]} accessibilityLabel={`Review status: ${spoken}`}>
      <View style={[ms.pillDot, { backgroundColor: fg }]} />
      <Text style={[ms.pillText, { color: fg }]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────
export default function MySubmissionsScreen({
  profile,
  onBack,
  onRefile,
  onOpenOutbox,
}: {
  profile: Profile;
  onBack: () => void;
  /** A·06 — "Fix & refile" on rejected disease/water reports. */
  onRefile?: (type: 'disease' | 'water', reportId: string) => void;
  /**
   * BRK-15 — jump to the Sync Outbox for the sync mechanics this screen
   * deliberately does not duplicate (delete a saved report, full ledger).
   * MainApp owns navigation; until it passes this, the link is not rendered
   * and the Outbox stays reachable from the header Sync Pebble and the
   * Profile-tab quick link.
   */
  onOpenOutbox?: () => void;
}) {
  const { colors, isDark, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const netInfo = useNetInfo();
  const accent = ROLE_ACCENT[profile.role] ?? ROLE_ACCENT.volunteer;

  // NetInfo reports isInternetReachable === null before its first probe — treat as online.
  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;

  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [queued, setQueued] = useState<QueueItem[]>([]);
  const [payback, setPayback] = useState<Record<string, OutbreakPayback>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failedSources, setFailedSources] = useState<SubmissionSource[]>([]);
  const [queueFailed, setQueueFailed] = useState(false);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<{ kind: 'ok' | 'warn' | 'fail'; text: string } | null>(null);

  // One entrance fade, 200ms, static under reduce-motion.
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduceMotion]);

  // How many items the phone held at the last successful read — lets a queue
  // change tell "she just filed one" (count up: no network needed) from "one
  // just uploaded" (count down: its server twin is now the only record).
  const queuedCountRef = useRef(0);

  // ── The phone's own copy: cheap, no network — reloaded on every queue
  //    mutation. A read failure is NEVER an empty queue: `queueFailed` drives
  //    its own error-with-retry, because "nothing saved here" and "I couldn't
  //    read what is saved here" must not look the same.
  //    Returns the new count, or null when the read itself failed.
  const loadQueue = useCallback(async (): Promise<number | null> => {
    try {
      const all = await syncQueue.getAll();
      const visible = visibleQueueItems(all, profile.id);
      setQueued(visible);
      setQueueFailed(false);
      queuedCountRef.current = visible.length;
      return visible.length;
    } catch (err) {
      console.error('[MySubmissions] failed to read the on-phone queue:', err);
      setQueued([]);
      setQueueFailed(true);
      return null;
    }
  }, [profile.id]);

  const loadServer = useCallback(async () => {
    const failures: SubmissionSource[] = [];
    const collected: SubmissionRow[] = [];
    let paybackNext: Record<string, OutbreakPayback> = {};

    // Approver join (WHY — the officer's name); falls back to plain columns
    // on older schemas without the approved_by relationship.
    const queryOwn = async (
      table: 'disease_reports' | 'water_quality_reports' | 'health_alerts',
      ownerCol: string,
    ) => {
      const withApprover = await supabase.from(table)
        .select('*, approver:profiles!approved_by(full_name)')
        .eq(ownerCol, profile.id)
        .order('created_at', { ascending: false }).limit(100);
      if (!withApprover.error) return withApprover;
      return supabase.from(table)
        .select('*')
        .eq(ownerCol, profile.id)
        .order('created_at', { ascending: false }).limit(100);
    };

    try {
      const [diseaseRes, waterRes, alertRes] = await Promise.all([
        queryOwn('disease_reports', 'reporter_id'),
        queryOwn('water_quality_reports', 'reporter_id'),
        queryOwn('health_alerts', 'created_by'),
      ]);

      const pushRow = (
        r: Record<string, unknown>,
        kind: SubmissionKind,
        title: string,
      ) => {
        collected.push({
          key: `${kind}-${String(r.id ?? collected.length)}`,
          id: String(r.id ?? ''),
          kind,
          title,
          meta: buildMeta(r),
          created_at: str(r, 'created_at') ?? '',
          updated_at: str(r, 'updated_at'),
          approval_status: str(r, 'approval_status'),
          rejection_reason: str(r, 'rejection_reason'),
          approver_name: approverNameOf(r),
          approved_at: str(r, 'approved_at'),
        });
      };

      if (diseaseRes.error) {
        console.error('[MySubmissions] disease query failed:', diseaseRes.error);
        failures.push('disease');
      } else {
        for (const r of (diseaseRes.data ?? []) as Record<string, unknown>[]) {
          pushRow(r, 'disease', str(r, 'disease_name') ?? '');
        }
      }

      if (waterRes.error) {
        console.error('[MySubmissions] water query failed:', waterRes.error);
        failures.push('water');
      } else {
        for (const r of (waterRes.data ?? []) as Record<string, unknown>[]) {
          pushRow(r, 'water', str(r, 'source_name') ?? '');
        }
      }

      if (alertRes.error) {
        console.error('[MySubmissions] alerts query failed:', alertRes.error);
        failures.push('alerts');
      } else {
        for (const r of (alertRes.data ?? []) as Record<string, unknown>[]) {
          pushRow(r, 'alert', str(r, 'title') ?? '');
        }
      }

      // ── A·06 payback — did an approved disease report feed an outbreak
      // window? One batched outbreaks query, matched client-side; degrades
      // silently when nothing matches or the table is unreachable.
      try {
        if (!diseaseRes.error) {
          const approvedDisease = ((diseaseRes.data ?? []) as Record<string, unknown>[])
            .filter((r) => norm(str(r, 'approval_status')) === 'approved');
          const districts = Array.from(new Set(
            approvedDisease.map((r) => str(r, 'district')).filter((d): d is string => !!d),
          ));

          if (approvedDisease.length > 0 && districts.length > 0) {
            const { data: outbreaks, error: obError } = await supabase
              .from('outbreaks')
              .select('disease_name, district, window_start, window_end, alert_sent, triggered_by_report_id')
              .in('district', districts)
              .order('created_at', { ascending: false })
              .limit(100);

            if (obError) {
              // Not surfaced as a failed source: the payback caption is a
              // bonus badge, and its absence claims nothing. Logged so the
              // failure is not invisible.
              console.error('[MySubmissions] outbreak payback query failed:', obError);
            }
            if (!obError && outbreaks) {
              for (const r of approvedDisease) {
                const id = String(r.id ?? '');
                if (!id) continue;
                const reportTime = new Date(str(r, 'created_at') ?? '').getTime();
                const match = (outbreaks as OutbreakLite[]).find((o) => {
                  if (o.triggered_by_report_id && String(o.triggered_by_report_id) === id) return true;
                  if (norm(o.disease_name) !== norm(str(r, 'disease_name'))) return false;
                  if (norm(o.district) !== norm(str(r, 'district'))) return false;
                  if (!Number.isFinite(reportTime)) return false;
                  const start = o.window_start ? new Date(o.window_start).getTime() : -Infinity;
                  const end = o.window_end ? new Date(o.window_end).getTime() : Infinity;
                  return reportTime >= start && reportTime <= end;
                });
                if (match) {
                  paybackNext[id] = {
                    district: (match.district ?? str(r, 'district') ?? '').trim(),
                    disease: (match.disease_name ?? str(r, 'disease_name') ?? '').trim(),
                    officialsNotified: match.alert_sent === true,
                  };
                }
              }
            }
          }
        }
      } catch (err) {
        // Payback is a bonus, never a blocker.
        console.error('[MySubmissions] outbreak payback check failed:', err);
        paybackNext = {};
      }
    } catch (err) {
      console.error('[MySubmissions] load failed:', err);
      failures.length = 0;
      failures.push('disease', 'water', 'alerts');
    }

    collected.sort((a, b) => {
      const ta = new Date(a.created_at).getTime() || 0;
      const tb = new Date(b.created_at).getTime() || 0;
      return tb - ta;
    });

    setRows(collected);
    setPayback(paybackNext);
    setFailedSources(failures);
    setAsOf(new Date());
  }, [profile.id]);

  const load = useCallback(async () => {
    try {
      await Promise.all([loadServer(), loadQueue()]);
    } finally {
      // Never leave her on a skeleton: whatever happened, the region has to
      // resolve to content, quiet-zero or an error she can retry.
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadServer, loadQueue]);

  useEffect(() => { load(); }, [load]);

  // The queue emits on enqueue / removal.
  //  · count went UP  — she just filed one offline; re-read the phone only,
  //    so a report appears here without spending her data.
  //  · count went DOWN — an item uploaded (or was removed in the Outbox).
  //    Its server twin is now the only record of it, so refresh that half
  //    too; otherwise a report she was watching would vanish from BOTH
  //    sections until the next pull-to-refresh — the exact anxiety this
  //    merge exists to end.
  useEffect(() => syncQueue.onChange(() => {
    void (async () => {
      const before = queuedCountRef.current;
      const after = await loadQueue();
      if (after !== null && after < before) await loadServer();
    })();
  }), [loadQueue, loadServer]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // ── Retry — the Outbox's own recovery path, not a copy of it ──
  const handleSyncNow = async () => {
    if (syncing || offline) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const res = await retryQueuedUploads(profile.id);
      if (res.busy) {
        setLastResult({ kind: 'warn', text: t('outbox.syncInProgress') });
      } else if (res.failed > 0) {
        setLastResult({
          kind: 'warn',
          text: t('outbox.syncPartial', { synced: res.synced, failed: res.failed }),
        });
      } else if (res.synced > 0) {
        setLastResult({
          kind: 'ok',
          text: res.synced === 1
            ? t('outbox.syncUploadedOne', { n: res.synced })
            : t('outbox.syncUploadedMany', { n: res.synced }),
        });
      } else {
        setLastResult({ kind: 'ok', text: t('outbox.syncUpToDate') });
      }
    } catch (err) {
      console.error('[MySubmissions] sync failed:', err);
      setLastResult({ kind: 'fail', text: t('outbox.syncFailed') });
    } finally {
      setSyncing(false);
      // Full reload: what just uploaded stops being "on this phone" and
      // reappears below with its review status.
      load();
    }
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark) — so plain ink tokens are correct in BOTH modes. textInverse here
  // would render white-on-paper.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  const anyFailure = failedSources.length > 0 || queueFailed;
  const totalFailure = anyFailure && rows.length === 0 && queued.length === 0;

  const serverErrorMessage = failedSources.length === 3
    ? t('submissions.loadErrorAll', {
        defaultValue: "Couldn't load your submissions — check connection",
      })
    : t('submissions.loadErrorSome', {
        defaultValue: "Couldn't load {{sources}} — check connection",
        sources: failedSources
          .map((s) => t(SOURCE_LABEL[s].key, { defaultValue: SOURCE_LABEL[s].en }))
          .join(', '),
      });

  const errorCards = (
    <>
      {failedSources.length > 0 && (
        <ErrorCard message={serverErrorMessage} onRetry={load} />
      )}
      {queueFailed && (
        <ErrorCard message={t('outbox.loadError')} onRetry={load} />
      )}
    </>
  );

  const entries = useMemo<ListEntry[]>(() => {
    const out: ListEntry[] = [];
    if (queued.length > 0) {
      out.push({ entry: 'queuedHeader', key: 'header-queued', count: queued.length });
      for (const item of queued) out.push({ entry: 'queued', key: `queued-${item.localId}`, item });
    }
    if (rows.length > 0) {
      out.push({ entry: 'serverHeader', key: 'header-server', count: rows.length });
      for (const row of rows) out.push({ entry: 'server', key: `server-${row.key}`, row });
    }
    return out;
  }, [queued, rows]);

  const resultColor = lastResult?.kind === 'ok'
    ? colors.success
    : lastResult?.kind === 'warn'
      ? colors.warning
      : colors.danger;
  const resultIcon: keyof typeof Ionicons.glyphMap = lastResult?.kind === 'ok'
    ? 'checkmark-circle-outline'
    : 'alert-circle-outline';

  // ── Row: still on this phone ──
  const renderQueued = (item: QueueItem) => {
    const permanentlyFailed = isPermanentlyFailed(item);
    const typeKey = QUEUE_TYPE_LABEL_KEY[item.type] as string | undefined;
    const typeLabel = typeKey ? t(typeKey) : t('outbox.savedReport');
    const title = queuePayloadTitle(item) ?? typeLabel;
    const savedLine = t('outbox.savedAt', { when: formatDateTime(item.createdAt) || '—' });

    return (
      <View
        style={[
          ms.card,
          ms.queuedCard,
          { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: colors.syncQueued },
          !isDark && ms.cardShadow,
        ]}
      >
        {/* The whole point of the merge: this one is not with the officials
            yet. Rail + tinted well + these words — three codes, so it never
            depends on colour alone. */}
        <View style={[ms.phoneBand, { backgroundColor: colors.warningBg }]}>
          <Ionicons name="phone-portrait-outline" size={16} color={colors.warning} />
          <Text style={[ms.phoneBandText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
            {t('submissions.onlyOnPhone', {
              defaultValue: "Only on this phone — officials can't see it yet.",
            })}
          </Text>
        </View>

        <View style={ms.cardRow}>
          <View style={[ms.iconWrap, { backgroundColor: colors.warningBg }]}>
            <Ionicons
              name={QUEUE_TYPE_ICON[item.type] ?? 'document-text-outline'}
              size={24}
              color={colors.syncQueued}
            />
          </View>
          <View style={ms.cardBody}>
            <Text style={[ms.cardTitle, { color: colors.text }]} numberOfLines={2}>{title}</Text>
            <Text style={[ms.cardMeta, { color: colors.textSecondary }]} numberOfLines={2}>
              {`${typeLabel} · ${savedLine}`}
            </Text>
          </View>
          <QueueStatusPill status={item.status} permanentlyFailed={permanentlyFailed} />
        </View>

        {(item.status === 'failed' || item.error) && (
          <View style={[ms.failBox, { backgroundColor: colors.dangerBg }]}>
            <View style={ms.failRow}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
              <Text style={[ms.failTitle, { color: colors.text }]}>
                {permanentlyFailed
                  ? t('outbox.failedPermanent', { n: item.attempts })
                  : t('outbox.failedWillRetry')}
              </Text>
            </View>
            {!!item.error && (
              <Text style={[ms.failDetail, { color: colors.textSecondary }]} numberOfLines={2}>
                {item.error}
              </Text>
            )}
          </View>
        )}

        {item.attempts > 0 && (
          <Text style={[ms.cardDate, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
            {item.attempts === 1
              ? t('outbox.triedOne', { n: item.attempts, max: MAX_ATTEMPTS })
              : t('outbox.triedMany', { n: item.attempts, max: MAX_ATTEMPTS })}
          </Text>
        )}
      </View>
    );
  };

  // ── Row: with the officials ──
  const renderServer = (item: SubmissionRow) => {
    const statusLower = (item.approval_status ?? '').toLowerCase();
    const rejected = statusLower === 'rejected';
    const approved = statusLower === 'approved';
    const paybackInfo = approved && item.kind === 'disease' ? payback[item.id] : undefined;
    const canRefile =
      rejected && !!onRefile && !!item.id && (item.kind === 'disease' || item.kind === 'water');
    const decidedAt = formatDateTime(item.approved_at ?? item.updated_at);
    const kindLabel = t(KIND_LABEL_KEY[item.kind]);
    const officerName = item.approver_name
      ?? t('submissions.reviewingOfficer', { defaultValue: 'Reviewing officer' });

    return (
      <View style={[ms.card, { backgroundColor: colors.card, borderColor: colors.border }, !isDark && ms.cardShadow]}>
        <View style={ms.cardRow}>
          <View style={[ms.iconWrap, { backgroundColor: colors.surfaceVariant }]}>
            <Ionicons name={KIND_ICON[item.kind]} size={24} color={colors.textSecondary} />
          </View>
          <View style={ms.cardBody}>
            <Text style={[ms.cardTitle, { color: colors.text }]} numberOfLines={2}>
              {item.title || kindLabel}
            </Text>
            <Text style={[ms.cardMeta, { color: colors.textSecondary }]} numberOfLines={2}>
              {kindLabel}{item.meta ? ` · ${item.meta}` : ''}
            </Text>
          </View>
          <ApprovalPill status={item.approval_status} />
        </View>

        <Text style={[ms.cardDate, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
          {t('submissions.submittedAt', {
            defaultValue: 'Submitted {{when}}',
            when: formatDateTime(item.created_at) || '—',
          })}
        </Text>

        {/* ── A·06 — the WHY: the officer's exact words, name and time ── */}
        {rejected && (
          <View style={[ms.rejectBox, { backgroundColor: colors.dangerBg }]}>
            <Text style={[ms.whyEyebrow, { color: colors.danger }]} maxFontSizeMultiplier={1.3}>
              {`${t('submissions.why', { defaultValue: 'WHY' })} — ${officerName.toUpperCase()}${decidedAt ? ` · ${decidedAt}` : ''}`}
            </Text>
            <Text style={[ms.rejectReason, { color: colors.text }]}>
              {item.rejection_reason
                ? `“${item.rejection_reason}”`
                : t('submissions.noReason', {
                    defaultValue: 'No reason was recorded — ask your reviewing officer for details.',
                  })}
            </Text>
            {canRefile && (
              <Pressable
                onPress={() => {
                  if (item.kind === 'disease' || item.kind === 'water') {
                    onRefile?.(item.kind, item.id);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Fix and refile this ${kindLabel.toLowerCase()}`}
                style={({ pressed }) => [
                  ms.refileBtn,
                  { backgroundColor: pressed ? colors.primaryDark : colors.primary },
                ]}
              >
                <Ionicons name="create-outline" size={18} color={colors.onPrimary} />
                <Text style={[ms.refileBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                  {t('submissions.refile', { defaultValue: 'Fix & refile' })}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* ── A·06 — the payback: stamp + proof the report became protection ── */}
        {paybackInfo && (
          <View style={ms.paybackBox}>
            <VerifiedStamp
              verifierName={officerName}
              timestamp={formatDateTime(item.approved_at) || undefined}
            />
            <Text style={[ms.paybackCaption, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
              {t('submissions.paybackCounted', {
                defaultValue: 'Counted toward the {{district}} {{disease}} outbreak signal',
                district: paybackInfo.district,
                disease: paybackInfo.disease.toLowerCase(),
              })}
              {paybackInfo.officialsNotified
                ? ` · ${t('submissions.paybackNotified', {
                    defaultValue: 'district officials were notified in the app',
                  })}`
                : ''}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderItem = ({ item }: { item: ListEntry }) => {
    if (item.entry === 'queued') return renderQueued(item.item);
    if (item.entry === 'server') return renderServer(item.row);

    const onPhone = item.entry === 'queuedHeader';
    return (
      <View style={ms.eyebrowRow}>
        <Text style={[ms.eyebrow, { color: onPhone ? colors.warning : colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
          {onPhone
            ? t('submissions.eyebrowOnPhone', { defaultValue: 'ON THIS PHONE · NOT SENT YET' })
            : t('submissions.eyebrowSent', { defaultValue: 'SENT TO OFFICIALS' })}
          <Text style={ms.eyebrowCount}>{` · ${item.count}`}</Text>
        </Text>
        {onPhone ? (
          onOpenOutbox ? (
            <TouchableOpacity
              onPress={onOpenOutbox}
              accessibilityRole="button"
              accessibilityLabel="Manage saved reports in the sync outbox"
              // 17dp of text + 2×16 = 49dp of tappable height.
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Text style={[ms.asOf, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                {t('submissions.manageInOutbox', { defaultValue: 'Manage' })}
              </Text>
            </TouchableOpacity>
          ) : null
        ) : (
          asOf && (
            <Text style={[ms.asOf, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
              {t('submissions.asOf', { defaultValue: 'As of {{when}}', when: formatTime(asOf) })}
            </Text>
          )
        )}
      </View>
    );
  };

  return (
    <View style={[ms.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg band + Role Ribbon */}
      <View
        style={[
          ms.header,
          {
            backgroundColor: colors.headerBg,
            // Paper-on-paper still needs a hairline to read as separated.
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={ms.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={ms.headerTextWrap}>
          <Text style={[ms.headerTitle, { color: headerText }]} numberOfLines={1}>
            {t('submissions.title', { defaultValue: 'My Submissions' })}
          </Text>
          <Text style={[ms.headerSub, { color: headerSub }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {t('submissions.headerSub', {
              defaultValue: "Everything you've filed — on this phone and with the officials",
            })}
          </Text>
        </View>
        <SyncPebble />
      </View>
      <View style={[ms.roleRibbon, { backgroundColor: accent }]} />

      <Animated.View style={{ flex: 1, opacity: fade }}>
        {/* 4-state region: skeleton / error / quiet zero / content */}
        {loading ? (
          <View style={ms.skeletonWrap}>
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
            <SkeletonBlock height={104} radius={radii.md} />
          </View>
        ) : totalFailure ? (
          <View style={ms.errorWrap}>{errorCards}</View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            contentContainerStyle={[ms.listContent, queued.length > 0 && ms.listContentWithBar]}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            ListHeaderComponent={anyFailure ? <View style={ms.errorHeader}>{errorCards}</View> : null}
            ListEmptyComponent={
              anyFailure ? null : (
                <View style={{ paddingTop: spacing.lg }}>
                  <EmptyState
                    icon="document-text-outline"
                    color={colors.textSecondary}
                    title={t('submissions.emptyTitle', { defaultValue: 'Nothing filed yet.' })}
                    subtitle={t('submissions.emptySubtitle', {
                      defaultValue: 'Reports you file appear here — first as saved on this phone, then with their review status once they reach the officials.',
                    })}
                  />
                </View>
              )
            }
          />
        )}
      </Animated.View>

      {/* One-Hand Action Bar — docked Sync now, shown only while something
          is still on this phone. Same recovery path as the Sync Outbox. */}
      {!loading && !totalFailure && queued.length > 0 && (
        <View style={[ms.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {offline && (
            <View style={ms.barNoteRow}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.offline} />
              <Text style={[ms.barNote, { color: colors.offline }]} maxFontSizeMultiplier={1.3}>
                {t('outbox.offlineBar')}
              </Text>
            </View>
          )}
          {!offline && lastResult && (
            <View style={ms.barNoteRow}>
              <Ionicons name={resultIcon} size={16} color={resultColor} />
              <Text style={[ms.barNote, { color: resultColor }]} maxFontSizeMultiplier={1.3}>
                {lastResult.text}
              </Text>
            </View>
          )}
          <Pressable
            onPress={handleSyncNow}
            disabled={offline || syncing}
            accessibilityRole="button"
            accessibilityLabel={syncing ? 'Syncing now' : `Sync now, ${queued.length} waiting`}
            style={({ pressed }) => [
              ms.syncBtn,
              {
                backgroundColor: pressed ? colors.primaryDark : colors.primary,
                opacity: offline || syncing ? 0.4 : 1,
              },
            ]}
          >
            <Text style={[ms.syncBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
              {syncing ? t('outbox.syncing') : t('outbox.syncNow', { n: queued.length })}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────
const ms = StyleSheet.create({
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
    // Rendered inside MainApp's SafeAreaView, which already supplies the
    // status-bar inset — the old paddingTop: 42 double-counted it.
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, lineHeight: 30 /* ×1.35+ — Devanagari matras */, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2 },
  roleRibbon: { height: 4, width: '100%' },

  /* Eyebrow-and-count section header + as-of caption */
  eyebrowRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.sm, marginBottom: spacing.md, minHeight: 20, gap: spacing.sm,
  },
  eyebrow: { fontSize: 12, lineHeight: 17 /* ×1.35+ — Devanagari matras */, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', flexShrink: 1 },
  eyebrowCount: { fontVariant: ['tabular-nums'] },
  asOf: { fontSize: 12, lineHeight: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },

  /* Skeleton + full-failure column */
  skeletonWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  errorHeader: { gap: spacing.md, paddingTop: spacing.md },

  /* List */
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  // Clear the docked Sync-now bar so the last card is never trapped under it.
  listContentWithBar: { paddingBottom: 140 },

  /* Card */
  card: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.md,
    minHeight: 64,
  },
  /* Still-on-this-phone: an amber rail down the edge, visible at arm's length */
  queuedCard: { borderLeftWidth: 4, paddingLeft: spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  cardMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  cardDate: { fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: spacing.sm, fontVariant: ['tabular-nums'] },

  /* "Only on this phone" band — the sentence that carries the whole merge */
  phoneBand: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.md,
  },
  phoneBandText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },

  /* Failed-upload framing (mirrors the Sync Outbox card) */
  failBox: { borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  failRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  failTitle: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  failDetail: { fontSize: 12, lineHeight: 16, fontWeight: '600' },

  /* Approval pill */
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill, alignSelf: 'flex-start',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 12, lineHeight: 17, fontWeight: '800', letterSpacing: 0.6 },

  /* A·06 WHY card — the officer's exact words, then a path forward */
  rejectBox: { borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.md, gap: spacing.sm },
  whyEyebrow: { fontSize: 12, lineHeight: 17, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  rejectReason: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  refileBtn: {
    minHeight: 48, borderRadius: radii.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.xs,
  },
  refileBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },

  /* A·06 payback — stamp + "counted toward the signal" caption */
  paybackBox: { marginTop: spacing.md, gap: spacing.sm, alignItems: 'flex-start' },
  paybackCaption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* One-Hand Action Bar — docked Sync now */
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
});
