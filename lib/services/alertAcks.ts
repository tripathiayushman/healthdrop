// =====================================================
// ALERT ACKNOWLEDGEMENTS SERVICE — Bharosa B·03 / D·02
// public.alert_acknowledgements (alert_id, user_id,
// acked_at, PK(alert_id, user_id)). RLS: SELECT for all
// authenticated users, INSERT own rows only.
// Acknowledging is a promise — "I'll inform my area" —
// and the ack count is the officer's real-time reach.
// =====================================================
import { supabase } from '../supabase';
import { ApiResponse } from '../../types';
import { track, events } from './analytics';

/** Field roles that count as "staff" for alert reach (D·02). */
const FIELD_STAFF_ROLES = ['clinic', 'asha_worker', 'volunteer'] as const;

/**
 * Resolve the signed-in user id — getSession() first (reads local
 * storage, no network), falling back to getUser() only when the
 * cached session is missing.
 */
async function currentUserId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) return session.user.id;
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

const isDuplicateKeyError = (error: { code?: string; message?: string | null }): boolean => {
  if (error?.code === '23505') return true;
  const msg = String(error?.message ?? '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('already exists');
};

export const alertAcks = {
  /**
   * Record the current user's acknowledgement of an alert.
   * Idempotent: acknowledging twice is a success, not an error —
   * the PK(alert_id, user_id) makes the promise single-count.
   */
  async acknowledge(alertId: string): Promise<ApiResponse<null>> {
    try {
      const userId = await currentUserId();
      if (!userId) throw new Error('You must be signed in to acknowledge an alert.');

      const { error } = await supabase
        .from('alert_acknowledgements')
        .upsert(
          { alert_id: alertId, user_id: userId },
          { onConflict: 'alert_id,user_id', ignoreDuplicates: true },
        );

      // Some schemas surface the conflict instead of ignoring it —
      // a duplicate PK means the ack already exists: success.
      if (error && !isDuplicateKeyError(error)) throw error;
      track(events.ALERT_ACKED);
      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error acknowledging alert:', error);
      return { data: null, error: error.message ?? 'Failed to acknowledge alert' };
    }
  },

  /**
   * Which of these alerts has the current user already acknowledged?
   * Returns a Set of alert ids for cheap membership checks in lists.
   * No session → empty set (the list simply shows no ack captions).
   */
  async myAckFor(alertIds: string[]): Promise<ApiResponse<Set<string>>> {
    try {
      if (!alertIds || alertIds.length === 0) {
        return { data: new Set<string>(), error: null };
      }
      const userId = await currentUserId();
      if (!userId) return { data: new Set<string>(), error: null };

      const { data, error } = await supabase
        .from('alert_acknowledgements')
        .select('alert_id')
        .eq('user_id', userId)
        .in('alert_id', alertIds);
      if (error) throw error;

      return {
        data: new Set<string>((data ?? []).map((r: { alert_id: string }) => r.alert_id)),
        error: null,
      };
    } catch (error: any) {
      console.error('Error fetching my alert acknowledgements:', error);
      return { data: null, error: error.message };
    }
  },

  /** Total acknowledgements for one alert (head-only count). */
  async ackStats(alertId: string): Promise<ApiResponse<{ acked: number }>> {
    try {
      const { count, error } = await supabase
        .from('alert_acknowledgements')
        .select('alert_id', { count: 'exact', head: true })
        .eq('alert_id', alertId);
      if (error) throw error;
      return { data: { acked: count ?? 0 }, error: null };
    } catch (error: any) {
      console.error('Error counting alert acknowledgements:', error);
      return { data: null, error: error.message };
    }
  },

  /**
   * D·02 reach: how many acknowledged vs. how many active field
   * staff (clinic / asha_worker / volunteer) are in the district.
   * If profiles RLS blocks the staff count for this role, staff
   * degrades to null — the caller shows "{acked} acknowledged"
   * and never a fake percent. (Note: a permissive-but-filtered
   * profiles policy can also return a too-small count without an
   * error; treat small denominators with suspicion upstream.)
   */
  async reachForDistrict(
    alertId: string,
    district: string,
  ): Promise<ApiResponse<{ acked: number; staff: number | null }>> {
    try {
      const stats = await this.ackStats(alertId);
      if (stats.error || !stats.data) {
        throw new Error(stats.error ?? 'Failed to count acknowledgements');
      }

      let staff: number | null = null;
      try {
        const { count, error } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .in('role', [...FIELD_STAFF_ROLES])
          .eq('district', district);
        // RLS denial or any failure → null, never a guessed number.
        staff = error ? null : count ?? null;
      } catch {
        staff = null;
      }

      return { data: { acked: stats.data.acked, staff }, error: null };
    } catch (error: any) {
      console.error('Error computing alert reach:', error);
      return { data: null, error: error.message };
    }
  },
};

export default alertAcks;
