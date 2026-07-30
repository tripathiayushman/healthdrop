// src/services/offlineSync/OfflineSyncService.ts
//
// Singleton service that:
//   1. Monitors network connectivity (via @react-native-community/netinfo)
//   2. On reconnect: drains the SyncQueue by uploading pending items
//   3. Handles conflict resolution with a server-wins strategy
//   4. Prevents duplicate submissions using the localId idempotency key
//
// Usage:
//   import { offlineSyncService } from './OfflineSyncService';
//   offlineSyncService.start(); // call once in App.tsx useEffect

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { supabase } from '../../../lib/supabase';
import { syncQueue, QueueItem, SyncCounts } from './SyncQueue';

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;   // base delay for exponential back-off
const SYNC_DEBOUNCE_MS = 1500; // wait after reconnect before starting sync
// A 'syncing' item whose last attempt is older than this is considered stuck
// (app killed mid-sync) and is safe to reset to 'pending' (F6).
const STALE_SYNCING_MS = 2 * 60 * 1000;

// ── Result type ───────────────────────────────────────────────────────────────

export interface SyncResult {
    synced: number;
    failed: number;
    /** True when the call was skipped because another sync pass was already
     *  running (F12) — the counts above are meaningless in that case. */
    busy?: boolean;
}

// ── Type-specific uploaders ───────────────────────────────────────────────────

/**
 * Map each queue item type to the Supabase table it syncs to.
 * The localId is stored as `client_idempotency_key` on the server so
 * Supabase can detect and silently ignore duplicate submissions.
 *
 * All five tables now carry a client_idempotency_key column with a full
 * (non-partial) UNIQUE constraint, so every type dedupes via upsert (F8).
 */
interface QueueUploadConfig {
    table: string;
    usesIdempotencyKey: boolean;
}

const TABLE_MAP: Record<string, QueueUploadConfig> = {
    disease_report: { table: 'disease_reports', usesIdempotencyKey: true },
    water_quality_report: { table: 'water_quality_reports', usesIdempotencyKey: true },
    campaign: { table: 'health_campaigns', usesIdempotencyKey: true },
    health_alert: { table: 'health_alerts', usesIdempotencyKey: true },
    feedback: { table: 'user_feedback', usesIdempotencyKey: true },
};

// Schema-drift armor (F1): the live DB has full UNIQUE constraints on
// client_idempotency_key, but a drifted schema (partial index, or a table
// missing the column) makes the upsert fail with one of these messages.
// Mirrors isLegacySchemaConflict in lib/services/diseaseReports.ts.
const LEGACY_SCHEMA_FALLBACK_PATTERNS = [
    'client_idempotency_key',
    'on conflict',
    'no unique or exclusion constraint',
    'constraint matching the on conflict specification',
] as const;

const isLegacySchemaError = (message: string): boolean => {
    const lower = message.toLowerCase();
    return LEGACY_SCHEMA_FALLBACK_PATTERNS.some((token) => lower.includes(token));
};

/**
 * Upload one queue item to Supabase.
 * Throws on network/server error so the caller can record the failure.
 */
async function uploadItem(item: QueueItem): Promise<void> {
    const config = TABLE_MAP[item.type];
    if (!config) throw new Error(`Unknown queue item type: ${item.type}`);

    if (config.usesIdempotencyKey) {
        const payload = {
            ...item.payload,
            // Attach stable localId as idempotency key where schema supports it.
            client_idempotency_key: item.localId,
        };

        const { error } = await supabase
            .from(config.table)
            .upsert(payload, {
                onConflict: 'client_idempotency_key',
                ignoreDuplicates: true,
            });

        if (!error) return;

        // Not a schema problem — surface it (RLS, validation, network …).
        if (!isLegacySchemaError(error.message)) throw new Error(error.message);

        // F1 fallback #1: constraint missing/partial but the column exists —
        // plain insert, keeping the key so future dedupe still has the data.
        const { error: insertError } = await supabase
            .from(config.table)
            .insert(payload);
        if (!insertError) return;

        // F1 fallback #2: the column itself is missing on this schema —
        // insert the raw payload without the key.
        if (insertError.message.toLowerCase().includes('client_idempotency_key')) {
            const { error: rawError } = await supabase
                .from(config.table)
                .insert(item.payload as Record<string, unknown>);
            if (rawError) throw new Error(rawError.message);
            return;
        }
        throw new Error(insertError.message);
    }

    const { error } = await supabase
        .from(config.table)
        .insert(item.payload as Record<string, unknown>);

    if (error) throw new Error(error.message);
}

// ── OfflineSyncService ────────────────────────────────────────────────────────

class OfflineSyncService {
    private unsubscribeNetInfo: (() => void) | null = null;
    private isSyncing = false;
    private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners: Array<(pendingCount: number) => void> = [];
    private countsListeners: Array<(counts: SyncCounts) => void> = [];

    constructor() {
        // Any queue mutation (enqueue from a form, removal after sync)
        // immediately re-notifies pending-count subscribers so UI badges
        // update without waiting for the next sync pass.
        syncQueue.onChange(() => {
            void this.notifyListeners();
        });
    }

    /** True while a sync pass is in flight (F12) — UI can avoid double-triggering. */
    get busy(): boolean {
        return this.isSyncing;
    }

    /** Start monitoring network. Call once in App.tsx. */
    start(): void {
        if (this.unsubscribeNetInfo) return; // already started

        // F6: recover items stranded in 'syncing' by an app kill, and purge
        // leftover synced/cancelled rows, before the first sync pass runs.
        void this.recoverStaleItems();

        this.unsubscribeNetInfo = NetInfo.addEventListener(
            this.handleNetworkChange.bind(this)
        );

        console.log('[OfflineSync] Service started');
    }

    /** Stop monitoring. Call on app logout / cleanup. */
    stop(): void {
        this.unsubscribeNetInfo?.();
        this.unsubscribeNetInfo = null;
        if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
        console.log('[OfflineSync] Service stopped');
    }

    /**
     * Cold-start recovery (F6): no sync pass can be in flight yet, so any
     * 'syncing' item is a leftover from a killed app — reset it to 'pending'
     * so automatic reconnect sync and the pebble count both see it again.
     */
    private async recoverStaleItems(): Promise<void> {
        try {
            if (!this.isSyncing) {
                const reset = await syncQueue.resetStuckSyncing();
                if (reset > 0) {
                    console.log(`[OfflineSync] Recovered ${reset} item(s) stuck in 'syncing'`);
                }
            }
            await syncQueue.removeSynced(); // purge stale tombstones + synced rows
        } catch (err) {
            console.warn('[OfflineSync] Stale-item recovery failed:', err);
        }
    }

    /**
     * Subscribe to pending-count changes (e.g. for a sync badge in the UI).
     * Returns an unsubscribe function.
     */
    onPendingCountChange(listener: (count: number) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    /**
     * Subscribe to {pending, failed} count changes (F5) — the failure-aware
     * feed the Sync Pebble uses. Returns an unsubscribe function.
     */
    onCountsChange(listener: (counts: SyncCounts) => void): () => void {
        this.countsListeners.push(listener);
        return () => {
            this.countsListeners = this.countsListeners.filter((l) => l !== listener);
        };
    }

    /** Notify all subscribers of the current pending/failed counts. */
    private async notifyListeners(): Promise<void> {
        const counts = await syncQueue.counts(MAX_ATTEMPTS);
        this.listeners.forEach((l) => l(counts.pending));
        this.countsListeners.forEach((l) => l(counts));
    }

    // ── Network change handler ─────────────────────────────────────────────────

    private handleNetworkChange(state: NetInfoState): void {
        const isOnline = state.isConnected && state.isInternetReachable;

        if (isOnline) {
            // Debounce: wait briefly to let the connection stabilise
            if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
            this.syncDebounceTimer = setTimeout(() => {
                this.syncAll();
            }, SYNC_DEBOUNCE_MS);
        }
    }

    // ── Main sync loop ─────────────────────────────────────────────────────────

    /**
     * Process all pending queue items in order (oldest first).
     * Items that fail are kept in the queue with an incremented attempt count.
     * Items that exceed MAX_ATTEMPTS are marked as 'failed' permanently.
     * Returns { busy: true } instead of running when a pass is in flight (F12).
     */
    async syncAll(): Promise<SyncResult> {
        if (this.isSyncing) {
            console.log('[OfflineSync] Sync already in progress — skipping');
            return { synced: 0, failed: 0, busy: true };
        }

        // Claim the lock BEFORE the first await so two overlapping calls
        // (e.g. NetInfo reconnect + manual pull-to-refresh) can't both pass
        // the guard while the queue read is in flight.
        this.isSyncing = true;

        try {
            // F6: revive items stranded in 'syncing' by a previous killed run
            // (with this pass holding the lock, none can be legitimately active
            // in this process — the window guards other tabs on web).
            await syncQueue.resetStuckSyncing(STALE_SYNCING_MS);

            const pending = await syncQueue.getPendingItems(MAX_ATTEMPTS);
            if (pending.length === 0) return { synced: 0, failed: 0 };

            console.log(`[OfflineSync] Starting sync of ${pending.length} items`);

            let synced = 0;
            let failed = 0;

            for (const item of pending) {
                const outcome = await this.syncItem(item);
                if (outcome === 'synced') synced++;
                else if (outcome === 'failed') failed++;
                // 'skipped' = deleted/cancelled mid-pass — counts as neither.
            }

            // Remove synced items (and cancelled tombstones) from storage
            await syncQueue.removeSynced();
            await this.notifyListeners();

            console.log(`[OfflineSync] Sync complete. synced=${synced} failed=${failed}`);
            return { synced, failed };
        } finally {
            this.isSyncing = false;
        }
    }

    // ── Single item sync with exponential back-off ─────────────────────────────

    private async syncItem(item: QueueItem): Promise<'synced' | 'failed' | 'skipped'> {
        await syncQueue.updateItem(item.localId, {
            status: 'syncing',
            lastAttempt: new Date().toISOString(),
        });

        // Exponential back-off: 2s, 4s, 8s …
        const delay = RETRY_DELAY_MS * Math.pow(2, item.attempts);
        if (item.attempts > 0) {
            await sleep(delay);
        }

        // F9: the user may have deleted this item while we held it in memory
        // (or during the back-off sleep) — re-read it fresh from storage right
        // before uploading and skip if it is gone or tombstoned.
        const fresh = await syncQueue.getItem(item.localId);
        if (!fresh || fresh.status === 'cancelled') {
            console.log(`[OfflineSync] Skipped ${item.type} (deleted before upload, localId: ${item.localId})`);
            return 'skipped';
        }

        try {
            await uploadItem(fresh);
            await syncQueue.updateItem(fresh.localId, { status: 'synced' });
            console.log(`[OfflineSync] ✅ Synced ${fresh.type} (localId: ${fresh.localId})`);
            return 'synced';
        } catch (err) {
            const newAttempts = fresh.attempts + 1;
            const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

            await syncQueue.updateItem(fresh.localId, {
                status: permanentlyFailed ? 'failed' : 'pending',
                attempts: newAttempts,
                error: String(err),
            });

            console.warn(
                `[OfflineSync] ❌ Failed ${fresh.type} (attempt ${newAttempts}/${MAX_ATTEMPTS})`,
                err
            );
            return 'failed';
        }
    }

    // ── Public: manual trigger (e.g. pull-to-refresh) ─────────────────────────

    async triggerSync(): Promise<SyncResult> {
        return this.syncAll();
    }

    // ── Public: get pending count (for badge) ─────────────────────────────────

    async getPendingCount(): Promise<number> {
        return syncQueue.pendingCount();
    }

    /** Current {pending, failed} tallies for the signed-in user (F5). */
    async getCounts(): Promise<SyncCounts> {
        return syncQueue.counts(MAX_ATTEMPTS);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const offlineSyncService = new OfflineSyncService();
