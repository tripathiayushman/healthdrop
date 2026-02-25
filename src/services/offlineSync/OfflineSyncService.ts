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
import { syncQueue, QueueItem } from './SyncQueue';

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;   // base delay for exponential back-off
const SYNC_DEBOUNCE_MS = 1500; // wait after reconnect before starting sync

// ── Type-specific uploaders ───────────────────────────────────────────────────

/**
 * Map each queue item type to the Supabase table it syncs to.
 * The localId is stored as `client_idempotency_key` on the server so
 * Supabase can detect and silently ignore duplicate submissions.
 */
const TABLE_MAP: Record<string, string> = {
    disease_report: 'disease_reports',
    water_quality_report: 'water_quality_reports',
    feedback: 'feedback',
};

/**
 * Upload one queue item to Supabase.
 * Throws on network/server error so the caller can record the failure.
 */
async function uploadItem(item: QueueItem): Promise<void> {
    const table = TABLE_MAP[item.type];
    if (!table) throw new Error(`Unknown queue item type: ${item.type}`);

    const payload = {
        ...item.payload,
        // Attach the stable localId as an idempotency key.
        // Supabase handles duplicates via the DB constraint or upsert ON CONFLICT.
        client_idempotency_key: item.localId,
    };

    const { error } = await supabase
        .from(table)
        .upsert(payload, {
            // `client_idempotency_key` has a UNIQUE constraint on the table.
            // ON CONFLICT DO NOTHING means a retry never creates a duplicate row.
            onConflict: 'client_idempotency_key',
            ignoreDuplicates: true,
        });

    if (error) throw new Error(error.message);
}

// ── OfflineSyncService ────────────────────────────────────────────────────────

class OfflineSyncService {
    private unsubscribeNetInfo: (() => void) | null = null;
    private isSyncing = false;
    private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners: Array<(pendingCount: number) => void> = [];

    /** Start monitoring network. Call once in App.tsx. */
    start(): void {
        if (this.unsubscribeNetInfo) return; // already started

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
     * Subscribe to pending-count changes (e.g. for a sync badge in the UI).
     * Returns an unsubscribe function.
     */
    onPendingCountChange(listener: (count: number) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    /** Notify all subscribers of the current pending count. */
    private async notifyListeners(): Promise<void> {
        const count = await syncQueue.pendingCount();
        this.listeners.forEach((l) => l(count));
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
     */
    async syncAll(): Promise<{ synced: number; failed: number }> {
        if (this.isSyncing) {
            console.log('[OfflineSync] Sync already in progress — skipping');
            return { synced: 0, failed: 0 };
        }

        const pending = await syncQueue.getPendingItems(MAX_ATTEMPTS);
        if (pending.length === 0) return { synced: 0, failed: 0 };

        this.isSyncing = true;
        console.log(`[OfflineSync] Starting sync of ${pending.length} items`);

        let synced = 0;
        let failed = 0;

        for (const item of pending) {
            const success = await this.syncItem(item);
            if (success) synced++;
            else failed++;
        }

        // Remove synced items from storage
        await syncQueue.removeSynced();
        await this.notifyListeners();

        this.isSyncing = false;
        console.log(`[OfflineSync] Sync complete. synced=${synced} failed=${failed}`);
        return { synced, failed };
    }

    // ── Single item sync with exponential back-off ─────────────────────────────

    private async syncItem(item: QueueItem): Promise<boolean> {
        await syncQueue.updateItem(item.localId, {
            status: 'syncing',
            lastAttempt: new Date().toISOString(),
        });

        // Exponential back-off: 2s, 4s, 8s …
        const delay = RETRY_DELAY_MS * Math.pow(2, item.attempts);
        if (item.attempts > 0) {
            await sleep(delay);
        }

        try {
            await uploadItem(item);
            await syncQueue.updateItem(item.localId, { status: 'synced' });
            console.log(`[OfflineSync] ✅ Synced ${item.type} (localId: ${item.localId})`);
            return true;
        } catch (err) {
            const newAttempts = item.attempts + 1;
            const permanentlyFailed = newAttempts >= MAX_ATTEMPTS;

            await syncQueue.updateItem(item.localId, {
                status: permanentlyFailed ? 'failed' : 'pending',
                attempts: newAttempts,
                error: String(err),
            });

            console.warn(
                `[OfflineSync] ❌ Failed ${item.type} (attempt ${newAttempts}/${MAX_ATTEMPTS})`,
                err
            );
            return false;
        }
    }

    // ── Public: manual trigger (e.g. pull-to-refresh) ─────────────────────────

    async triggerSync(): Promise<{ synced: number; failed: number }> {
        return this.syncAll();
    }

    // ── Public: get pending count (for badge) ─────────────────────────────────

    async getPendingCount(): Promise<number> {
        return syncQueue.pendingCount();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const offlineSyncService = new OfflineSyncService();
