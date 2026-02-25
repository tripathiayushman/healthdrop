// src/services/offlineSync/SyncQueue.ts
//
// Persistent queue stored in AsyncStorage.
// Each item has a stable localId (UUID) generated once on creation.
// This localId is the deduplication key — Supabase checks it before INSERT.

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueueItemType =
    | 'disease_report'
    | 'water_quality_report'
    | 'feedback';

export type QueueItemStatus =
    | 'pending'    // waiting for network
    | 'syncing'    // currently being uploaded
    | 'synced'     // successfully uploaded
    | 'failed';    // max retries exceeded

export interface QueueItem<T = Record<string, unknown>> {
    localId: string;          // stable UUID — used as idempotency key
    type: QueueItemType;
    payload: T;               // the full form data
    status: QueueItemStatus;
    createdAt: string;          // ISO timestamp
    attempts: number;          // how many sync attempts have failed
    lastAttempt: string | null;   // ISO timestamp of last attempt
    error: string | null;   // last error message
}

// ── Storage key ───────────────────────────────────────────────────────────────

const QUEUE_KEY = '@healthdrop/sync_queue';

// ── SyncQueue class ───────────────────────────────────────────────────────────

export class SyncQueue {
    /** Read the entire queue from AsyncStorage */
    async getAll(): Promise<QueueItem[]> {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as QueueItem[];
    }

    /** Persist the entire queue */
    private async saveAll(items: QueueItem[]): Promise<void> {
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    }

    /**
     * Enqueue a new report.
     * Returns the localId — callers should show this as a "draft ID" to the user.
     */
    async enqueue<T>(type: QueueItemType, payload: T): Promise<string> {
        const localId = crypto.randomUUID();
        const item: QueueItem<T> = {
            localId,
            type,
            payload,
            status: 'pending',
            createdAt: new Date().toISOString(),
            attempts: 0,
            lastAttempt: null,
            error: null,
        };

        const items = await this.getAll();

        // Deduplication guard: never queue the same localId twice
        if (items.some((i) => i.localId === localId)) {
            return localId;
        }

        await this.saveAll([...items, item as QueueItem]);
        return localId;
    }

    /** Update a specific item's status/error by localId */
    async updateItem(
        localId: string,
        patch: Partial<Pick<QueueItem, 'status' | 'attempts' | 'lastAttempt' | 'error'>>
    ): Promise<void> {
        const items = await this.getAll();
        const updated = items.map((item) =>
            item.localId === localId ? { ...item, ...patch } : item
        );
        await this.saveAll(updated);
    }

    /** Remove successfully synced items (call after successful upload) */
    async removeSynced(): Promise<void> {
        const items = await this.getAll();
        await this.saveAll(items.filter((i) => i.status !== 'synced'));
    }

    /** All items waiting to be synced (pending + failed with retries remaining) */
    async getPendingItems(maxAttempts = 3): Promise<QueueItem[]> {
        const items = await this.getAll();
        return items.filter(
            (i) => i.status === 'pending' ||
                (i.status === 'failed' && i.attempts < maxAttempts)
        );
    }

    /** Count of queued items (for UI badge) */
    async pendingCount(): Promise<number> {
        const items = await this.getPendingItems();
        return items.length;
    }
}

export const syncQueue = new SyncQueue();
