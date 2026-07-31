// =====================================================
// STAFF ADVISORIES + NOTIFICATIONS INBOX — Bharosa B·02 / §10
// "ADVISORY · TO FIELD STAFF · internal — never shown
// to public." Advisories are IN-APP rows in
// public.notifications — there is no officer-accessible
// push path (the dispatch RPC is admin-only), so staff
// see an advisory the next time they open HealthDrop.
//
// Marker convention: the notifications.type CHECK has no
// 'advisory' value, so an advisory is the row shape
//   user_id NULL (broadcast) + type 'info'
//   + related_type 'user' + related_id = sender's id.
// Nothing else in the app writes that shape.
//
// RLS reality (verified live):
// - SELECT: own rows OR any broadcast — role/district
//   targeting is enforced client-side in listInbox.
// - UPDATE: own rows ONLY. A broadcast row is shared, so
//   its per-user read state lives on this device
//   (AsyncStorage ledger), never in the shared row.
// - INSERT: super_admin / health_admin unscoped;
//   district_officer only when target_district equals
//   their own district — the DB enforces the scope.
// =====================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { notificationsService } from './notifications';
import { ApiResponse, Notification, Profile } from '../../types';

/** Audience for one advisory — null means all field staff (one null-role broadcast row). */
export type AdvisoryTargetRole = 'asha_worker' | 'volunteer' | 'clinic' | null;

export interface SendAdvisoryInput {
  title: string;
  message: string;
  targetRole: AdvisoryTargetRole;
  /** District to reach, or null for every district. Officers MUST pass their own district — the DB rejects anything else. */
  targetDistrict: string | null;
}

/** An inbox row: the notification plus its resolved read state and advisory flag. */
export type InboxItem = Notification & {
  isAdvisory: boolean;
  /** Effective read state: DB is_read for own rows, on-device ledger for broadcasts. */
  read: boolean;
};

export const ADVISORY_SENDER_ROLES: Profile['role'][] = [
  'super_admin', 'health_admin', 'district_officer',
];

/** The advisory marker convention, in one place. */
export const isAdvisoryNotification = (n: Notification): boolean =>
  n.user_id == null && n.type === 'info' && n.related_type === 'user';

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

// ── On-device read ledger for broadcast rows ─────────
// Keyed per user so shared devices don't leak read state.
const readLedgerKey = (userId: string) => `@healthdrop_inbox_read:${userId}`;
// Oldest ids are dropped past this cap — by then the rows have
// long scrolled out of the inbox's pages.
const READ_LEDGER_CAP = 500;

async function loadReadLedger(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(readLedgerKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    // Unreadable ledger → treat everything as unread; never crash the inbox.
    return new Set();
  }
}

async function appendToReadLedger(userId: string, id: string): Promise<void> {
  const ledger = await loadReadLedger(userId);
  if (ledger.has(id)) return;
  const next = [...ledger, id].slice(-READ_LEDGER_CAP);
  await AsyncStorage.setItem(readLedgerKey(userId), JSON.stringify(next));
}

/** Does this broadcast row target this profile? (Mirrors the intended scoping the loose SELECT policy leaves to the client.) */
const broadcastMatchesProfile = (n: Notification, profile: Profile): boolean => {
  if (n.target_role && n.target_role !== profile.role) return false;
  if (n.target_district && n.target_district !== profile.district) return false;
  return true;
};

export const advisoriesService = {
  /**
   * Send a staff advisory as one in-app notification row.
   * - targetRole null → a single broadcast row with target_role NULL
   *   (the SELECT policy treats a null role as matching everyone, so
   *   one row reaches all field staff in scope).
   * - Officers: the DB INSERT policy requires target_district to equal
   *   their own district; pass it exactly and never null.
   * Advisories are in-app only — this sends no push notification.
   */
  async sendAdvisory(input: SendAdvisoryInput): Promise<ApiResponse<Notification>> {
    try {
      const title = input.title.trim();
      const message = input.message.trim();
      if (!title) throw new Error('Advisory needs a short title.');
      if (!message) throw new Error('Advisory needs a message.');

      const senderId = await currentUserId();
      if (!senderId) throw new Error('You must be signed in to send an advisory.');

      // Reuse the existing notifications service; the related_* pair is
      // the advisory marker + provenance (sender's profile id).
      const result = await notificationsService.create({
        title,
        message,
        type: 'info',
        priority: 'normal',
        targetRole: input.targetRole ?? undefined,
        targetDistrict: input.targetDistrict ?? undefined,
        relatedType: 'user',
        relatedId: senderId,
      });
      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Failed to send advisory');
      }
      return { data: result.data, error: null };
    } catch (error: any) {
      console.error('Error sending advisory:', error);
      return { data: null, error: error.message ?? 'Failed to send advisory' };
    }
  },

  /**
   * §10 — the non-alert inbox: everything visible to this user except
   * type 'alert' rows (those live in the Alerts inbox, B·02).
   * Server pages by created_at; role/district targeting of broadcast
   * rows is applied client-side, so a page may come back shorter than
   * pageSize — hasMore is judged on the raw page, never the filtered one.
   */
  async listInbox(options: {
    profile: Profile;
    page?: number;
    pageSize?: number;
  }): Promise<ApiResponse<{ items: InboxItem[]; hasMore: boolean }>> {
    try {
      const { profile, page = 1, pageSize = 20 } = options;
      const offset = (page - 1) * pageSize;

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .or(`user_id.eq.${profile.id},user_id.is.null`)
        .neq('type', 'alert')
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;

      const raw = (data ?? []) as Notification[];
      const ledger = await loadReadLedger(profile.id);

      const items: InboxItem[] = raw
        .filter((n) => n.user_id === profile.id || broadcastMatchesProfile(n, profile))
        .map((n) => ({
          ...n,
          isAdvisory: isAdvisoryNotification(n),
          read: n.user_id === profile.id ? !!n.is_read : ledger.has(n.id),
        }));

      return { data: { items, hasMore: raw.length === pageSize }, error: null };
    } catch (error: any) {
      console.error('Error loading notifications inbox:', error);
      return { data: null, error: error.message ?? 'Failed to load notifications' };
    }
  },

  /**
   * Mark one inbox row read. Own rows go through the existing
   * notifications service (DB is_read); broadcast rows are shared and
   * RLS-locked, so their read state is recorded on this device only.
   */
  async markRead(profile: Profile, item: Notification): Promise<ApiResponse<null>> {
    try {
      if (item.user_id === profile.id) {
        const result = await notificationsService.markAsRead(item.id);
        if (result.error) throw new Error(result.error);
      } else {
        await appendToReadLedger(profile.id, item.id);
      }
      return { data: null, error: null };
    } catch (error: any) {
      console.error('Error marking notification read:', error);
      return { data: null, error: error.message ?? 'Failed to mark as read' };
    }
  },
};

export default advisoriesService;
