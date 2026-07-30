// src/services/offlineSync/SyncQueue.ts
//
// Persistent queue stored in AsyncStorage.
// Each item has a stable localId (UUID) generated once on creation.
// This localId is the deduplication key — Supabase checks it before INSERT.
//
// All read-modify-write cycles are serialized through a promise-chain mutex
// so an interleaved stale saveAll can never resurrect a deleted item (F9).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import { generateUUID } from './uuid';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueueItemType =
    | 'disease_report'
    | 'water_quality_report'
    | 'campaign'
    | 'health_alert'
    | 'feedback';

export type QueueItemStatus =
    | 'pending'    // waiting for network
    | 'syncing'    // currently being uploaded
    | 'synced'     // successfully uploaded
    | 'failed'     // max retries exceeded
    | 'cancelled'; // tombstone: user deleted it before upload — never sync (F9)

export interface QueueItem<T = Record<string, unknown>> {
    localId: string;          // stable UUID — used as idempotency key
    type: QueueItemType;
    payload: T;               // the full form data
    status: QueueItemStatus;
    createdAt: string;          // ISO timestamp
    attempts: number;          // how many sync attempts have failed
    lastAttempt: string | null;   // ISO timestamp of last attempt
    error: string | null;   // last error message
    /**
     * id of the signed-in user who queued this item (F13).
     * null/undefined on items persisted before owner stamping existed —
     * those legacy items are treated as belonging to the current user.
     */
    ownerId?: string | null;
}

/** Queue tallies for the Sync Pebble (F5). */
export interface SyncCounts {
    /** Items that will still be attempted (pending / uploading / retryable). */
    pending: number;
    /** Items permanently out of retries — need a manual "Sync now". */
    failed: number;
}

// ── Storage key ───────────────────────────────────────────────────────────────

const QUEUE_KEY = '@healthdrop/sync_queue';
const DEFAULT_MAX_ATTEMPTS = 3;

// ── SyncQueue class ───────────────────────────────────────────────────────────

type QueueChangeListener = () => void;

export class SyncQueue {
    /** Listeners invoked whenever the queue mutates (enqueue / removal). */
    private changeListeners: QueueChangeListener[] = [];

    /**
     * Promise-chain mutex (F9): every storage read-modify-write runs strictly
     * after the previous one, so concurrent mutations can't clobber each other.
     */
    private mutex: Promise<void> = Promise.resolve();

    private withLock<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.mutex.then(fn);
        this.mutex = run.then(() => undefined, () => undefined);
        return run;
    }

    /**
     * Subscribe to queue mutations. Used by OfflineSyncService to re-notify
     * pending-count subscribers the moment an item is queued or removed.
     * Returns an unsubscribe function.
     */
    onChange(listener: QueueChangeListener): () => void {
        this.changeListeners.push(listener);
        return () => {
            this.changeListeners = this.changeListeners.filter((l) => l !== listener);
        };
    }

    private emitChange(): void {
        this.changeListeners.forEach((listener) => {
            try {
                listener();
            } catch (err) {
                console.warn('[SyncQueue] change listener failed:', err);
            }
        });
    }

    /** Raw storage read — internal; callers outside the lock use getAll(). */
    private async readAll(): Promise<QueueItem[]> {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as QueueItem[];
    }

    /** Persist the entire queue */
    private async saveAll(items: QueueItem[]): Promise<void> {
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    }

    /**
     * Current signed-in user id from the locally cached session (F13).
     * getSession() reads local storage, so this works offline. Falls back to
     * null when there is no readable session.
     */
    private async currentUserId(): Promise<string | null> {
        try {
            const { data } = await supabase.auth.getSession();
            return data.session?.user?.id ?? null;
        } catch (err) {
            console.warn('[SyncQueue] could not read session for owner scoping:', err);
            return null;
        }
    }

    /** Legacy items (no ownerId stamp) are grandfathered as owned. */
    private ownedBy(item: QueueItem, userId: string | null): boolean {
        if (item.ownerId == null) return true;
        return userId != null && item.ownerId === userId;
    }

    /** Read the entire queue from AsyncStorage (serialized behind the mutex). */
    async getAll(): Promise<QueueItem[]> {
        return this.withLock(() => this.readAll());
    }

    /**
     * Read one item fresh from storage (F9): OfflineSyncService calls this
     * immediately before uploading so a deletion that happened after the sync
     * pass snapshotted the queue is still honoured.
     */
    async getItem(localId: string): Promise<QueueItem | null> {
        const items = await this.getAll();
        return items.find((i) => i.localId === localId) ?? null;
    }

    /**
    * Enqueue a new item.
     * Returns the localId — callers should show this as a "draft ID" to the user.
     */
    async enqueue<T>(type: QueueItemType, payload: T): Promise<string> {
        const localId = generateUUID();
        // Stamp the enqueuing user (F13) BEFORE taking the lock — getSession is
        // async and we never hold the mutex across unrelated awaits.
        const ownerId = await this.currentUserId();
        const item: QueueItem<T> = {
            localId,
            type,
            payload,
            status: 'pending',
            createdAt: new Date().toISOString(),
            attempts: 0,
            lastAttempt: null,
            error: null,
            ownerId,
        };

        await this.withLock(async () => {
            const items = await this.readAll();
            await this.saveAll([...items, item as QueueItem]);
        });
        this.emitChange();
        return localId;
    }

    /**
     * Update a specific item's status/error by localId.
     * Cancelled tombstones are terminal (F9): a late status patch from an
     * in-flight sync pass must not resurrect a deleted item.
     */
    async updateItem(
        localId: string,
        patch: Partial<Pick<QueueItem, 'status' | 'attempts' | 'lastAttempt' | 'error'>>
    ): Promise<void> {
        await this.withLock(async () => {
            const items = await this.readAll();
            const updated = items.map((item) => {
                if (item.localId !== localId) return item;
                if (item.status === 'cancelled') return item; // tombstone is terminal
                return { ...item, ...patch };
            });
            await this.saveAll(updated);
        });
    }

    /**
     * Tombstone an item the user deleted before it uploaded (F9).
     * The row stays in storage as status 'cancelled' so an in-flight sync pass
     * (which re-reads right before upload) skips it; removeSynced() purges it.
     */
    async cancelItem(localId: string): Promise<void> {
        await this.withLock(async () => {
            const items = await this.readAll();
            const updated = items.map((item) =>
                item.localId === localId
                    ? { ...item, status: 'cancelled' as QueueItemStatus }
                    : item
            );
            await this.saveAll(updated);
        });
        this.emitChange();
    }

    /** Remove synced items and cancelled tombstones (call after a sync pass). */
    async removeSynced(): Promise<void> {
        await this.withLock(async () => {
            const items = await this.readAll();
            await this.saveAll(
                items.filter((i) => i.status !== 'synced' && i.status !== 'cancelled')
            );
        });
        this.emitChange();
    }

    /**
     * Reset items stranded in 'syncing' back to 'pending' (F6) — happens when
     * the app is killed mid-sync. olderThanMs = 0 resets unconditionally
     * (safe at cold start); a positive window only resets items whose last
     * attempt is older than the window. Returns how many items were reset.
     */
    async resetStuckSyncing(olderThanMs = 0): Promise<number> {
        const now = Date.now();
        let reset = 0;
        await this.withLock(async () => {
            const items = await this.readAll();
            const updated = items.map((item) => {
                if (item.status !== 'syncing') return item;
                const last = item.lastAttempt ? new Date(item.lastAttempt).getTime() : 0;
                if (olderThanMs > 0 && last && now - last < olderThanMs) return item;
                reset++;
                return { ...item, status: 'pending' as QueueItemStatus };
            });
            if (reset > 0) await this.saveAll(updated);
        });
        if (reset > 0) this.emitChange();
        return reset;
    }

    /**
     * Remove a signed-out user's queued items — and legacy items with no owner
     * stamp — so the next account on this device can't read them (F13).
     * WARNING: discards that user's not-yet-synced reports.
     */
    async clearForUser(userId: string): Promise<void> {
        await this.withLock(async () => {
            const items = await this.readAll();
            await this.saveAll(
                items.filter((i) => i.ownerId != null && i.ownerId !== userId)
            );
        });
        this.emitChange();
    }

    /**
     * All items waiting to be synced (pending + failed with retries remaining),
     * scoped to the current signed-in user (F13).
     */
    async getPendingItems(maxAttempts = DEFAULT_MAX_ATTEMPTS): Promise<QueueItem[]> {
        const userId = await this.currentUserId();
        const items = await this.getAll();
        return items.filter(
            (i) => this.ownedBy(i, userId) &&
                (i.status === 'pending' ||
                    (i.status === 'failed' && i.attempts < maxAttempts))
        );
    }

    /**
     * Pending + permanently-failed tallies for the current user (F5).
     * 'failed' here means out of retries — it needs a manual retry, and the
     * Sync Pebble must not claim "All synced" while it is non-zero.
     */
    async counts(maxAttempts = DEFAULT_MAX_ATTEMPTS): Promise<SyncCounts> {
        const userId = await this.currentUserId();
        const items = await this.getAll();
        let pending = 0;
        let failed = 0;
        for (const i of items) {
            if (!this.ownedBy(i, userId)) continue;
            if (
                i.status === 'pending' ||
                i.status === 'syncing' ||
                (i.status === 'failed' && i.attempts < maxAttempts)
            ) {
                pending++;
            } else if (i.status === 'failed') {
                failed++;
            }
        }
        return { pending, failed };
    }

    /** Count of queued items (for UI badge) */
    async pendingCount(): Promise<number> {
        const { pending } = await this.counts();
        return pending;
    }
}

export const syncQueue = new SyncQueue();
