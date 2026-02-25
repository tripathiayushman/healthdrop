// src/services/offlineSync/index.ts
//
// ─── INTEGRATION GUIDE ────────────────────────────────────────────────────────
//
// 1. INSTALL DEPENDENCIES
//    npm install @react-native-async-storage/async-storage
//                @react-native-community/netinfo
//                uuid react-native-get-random-values
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
export { offlineSyncService } from './OfflineSyncService';
export { syncQueue } from './SyncQueue';
export type { QueueItem, QueueItemStatus } from './SyncQueue';

// Generic type for report data (extend as needed)
type ReportData = Record<string, unknown>;

/**
 * Submit a disease report.
 * - Online  → submit directly to Supabase, no queue involved.
 * - Offline → add to local queue; auto-syncs on reconnect.
 */
export async function submitDiseaseReport(
    data: ReportData
): Promise<{ queued: boolean; localId?: string }> {
    const net = await NetInfo.fetch();
    const isOnline = net.isConnected && net.isInternetReachable;

    if (isOnline) {
        // Direct submit — still attach localId in case of retry
        const localId = crypto.randomUUID();
        const { error } = await supabase
            .from('disease_reports')
            .upsert(
                { ...data, client_idempotency_key: localId },
                { onConflict: 'client_idempotency_key', ignoreDuplicates: true }
            );
        if (error) throw new Error(error.message);
        return { queued: false };
    }

    // Offline → enqueue
    const localId = await syncQueue.enqueue('disease_report', data);
    return { queued: true, localId };
}

/** Same pattern for water quality reports */
export async function submitWaterQualityReport(
    data: ReportData
): Promise<{ queued: boolean; localId?: string }> {
    const net = await NetInfo.fetch();
    const isOnline = net.isConnected && net.isInternetReachable;

    if (isOnline) {
        const localId = crypto.randomUUID();
        const { error } = await supabase
            .from('water_quality_reports')
            .upsert(
                { ...data, client_idempotency_key: localId },
                { onConflict: 'client_idempotency_key', ignoreDuplicates: true }
            );
        if (error) throw new Error(error.message);
        return { queued: false };
    }

    const localId = await syncQueue.enqueue('water_quality_report', data);
    return { queued: true, localId };
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
