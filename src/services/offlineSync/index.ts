// src/services/offlineSync/index.ts
//
// ─── INTEGRATION GUIDE ────────────────────────────────────────────────────────
//
// 1. INSTALL DEPENDENCIES
//    npm install @react-native-async-storage/async-storage
//                @react-native-community/netinfo
//    (UUIDs come from the local ./uuid helper — no uuid package needed)
//
// 2. START THE SERVICE (App.tsx)
// ──────────────────────────────────────────────────────────────────────────────

// // App.tsx
// import { useEffect } from 'react';
// import { offlineSyncService } from './src/services/offlineSync';
//
// export default function App() {
//   useEffect(() => {
//     offlineSyncService.start();
//     return () => offlineSyncService.stop();
//   }, []);
//   ...
// }

// ─── 3. MODIFY YOUR REPORT SUBMISSION SERVICE ─────────────────────────────────
//
// BEFORE (online-only):
// ──────────────────────────────────────────────────────────────────────────────
//
// export async function submitDiseaseReport(data: ReportData) {
//   const { error } = await supabase.from('disease_reports').insert(data);
//   if (error) throw error;
// }
//
// AFTER (offline-first):
// ──────────────────────────────────────────────────────────────────────────────

import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../../lib/supabase';
import { syncQueue } from './SyncQueue';
import { generateUUID } from './uuid';
export { offlineSyncService } from './OfflineSyncService';
export { syncQueue } from './SyncQueue';
export type { QueueItem, QueueItemStatus } from './SyncQueue';

// Generic type for report data (extend as needed)
type ReportData = Record<string, unknown>;

/** Heuristic: did this failure happen at the transport layer (not the server)? */
function isNetworkError(error: unknown): boolean {
    const message = String((error as any)?.message ?? error ?? '').toLowerCase();
    return (
        message.includes('network') ||
        message.includes('failed to fetch') ||
        message.includes('fetch failed') ||
        message.includes('fetcherror') ||
        message.includes('timed out') ||
        message.includes('timeout') ||
        message.includes('abort') ||
        message.includes('socket') ||
        message.includes('econn')
    );
}

/**
 * Shared submit path:
 * - NetInfo says definitively offline → enqueue immediately.
 * - Otherwise (online, or isInternetReachable === null meaning "not probed
 *   yet") → attempt direct submit; if the attempt fails at the network layer,
 *   fall back to the queue instead of throwing. Server rejections (RLS,
 *   validation) still throw so callers can surface them.
 */
async function submitOrQueue(
    table: 'disease_reports' | 'water_quality_reports',
    queueType: 'disease_report' | 'water_quality_report',
    data: ReportData
): Promise<{ queued: boolean; localId?: string }> {
    const net = await NetInfo.fetch();
    const maybeOnline = net.isConnected !== false && net.isInternetReachable !== false;

    if (maybeOnline) {
        // Direct submit — still attach localId in case of retry
        const localId = generateUUID();
        let failure: unknown = null;

        try {
            const { error } = await supabase
                .from(table)
                .upsert(
                    { ...data, client_idempotency_key: localId },
                    { onConflict: 'client_idempotency_key', ignoreDuplicates: true }
                );
            if (!error) return { queued: false, localId };
            failure = new Error(error.message);
        } catch (err) {
            failure = err;
        }

        if (!isNetworkError(failure)) throw failure;
        // Transport failed mid-flight → fall through to the offline queue.
    }

    const queuedId = await syncQueue.enqueue(queueType, data);
    return { queued: true, localId: queuedId };
}

/**
 * Submit a disease report.
 * - Online (or connectivity unknown) → submit directly to Supabase.
 * - Offline / network failure → add to local queue; auto-syncs on reconnect.
 */
export async function submitDiseaseReport(
    data: ReportData
): Promise<{ queued: boolean; localId?: string }> {
    return submitOrQueue('disease_reports', 'disease_report', data);
}

/** Same pattern for water quality reports */
export async function submitWaterQualityReport(
    data: ReportData
): Promise<{ queued: boolean; localId?: string }> {
    return submitOrQueue('water_quality_reports', 'water_quality_report', data);
}

// ─── 4. UI HOOK — pending sync count for badge ────────────────────────────────

import { useState, useEffect } from 'react';
import { offlineSyncService } from './OfflineSyncService';

/**
 * Returns the current number of reports waiting to sync.
 * Updates in real-time as items are queued / synced.
 *
 * Usage:
 *   const pendingCount = usePendingSync();
 *   // Show <Badge count={pendingCount} /> in tab bar
 */
export function usePendingSync(): number {
    const [count, setCount] = useState(0);

    useEffect(() => {
        // Init
        offlineSyncService.getPendingCount().then(setCount);
        // Subscribe to changes
        return offlineSyncService.onPendingCountChange(setCount);
    }, []);

    return count;
}

// ─── 5. UI PATTERN — show "saved offline" feedback ───────────────────────────

// In your form's onSubmit handler:
//
// const handleSubmit = async (data) => {
//   try {
//     const result = await submitDiseaseReport(data);
//     if (result.queued) {
//       Toast.show({
//         type: 'info',
//         text1: 'Saved Offline',
//         text2: 'Your report will sync when you are back online.',
//       });
//     } else {
//       Toast.show({ type: 'success', text1: 'Report Submitted' });
//     }
//   } catch (err) {
//     Toast.show({ type: 'error', text1: 'Submission Failed', text2: err.message });
//   }
// };

// ─── 6. CONFLICT RESOLUTION STRATEGY ─────────────────────────────────────────
//
// Strategy: SERVER-WINS with client-side deduplication
//
// Scenario A — simple offline submission:
//   Client creates report offline → queued → network returns → sync uploads it.
//   Because client_idempotency_key is set on the first attempt, any retry
//   (e.g. user taps submit again) silently no-ops via the UNIQUE constraint.
//
// Scenario B — report submitted offline AND online simultaneously:
//   User submits form while offline (queued).
//   Network comes back. User impatiently taps submit again before sync fires.
//   The online path inserts the row with the new localId.
//   The sync path tries to upsert the queued item; ON CONFLICT DO NOTHING.
//   Result: one row in DB. ✅
//
// Scenario C — stale data conflict:
//   Not applicable here because users CREATE reports, never edit existing ones.
//   If editing is added later: compare updated_at; whichever is more recent wins.
//   Implement via:
//     .upsert({ ...data }, { onConflict: 'id' })
//     Only if local updated_at > server updated_at (fetch first, compare, then upsert)
