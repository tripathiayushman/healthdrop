// =====================================================
// ANALYTICS SERVICE — privacy-first, first-party events
// public.app_events (id, user_id nullable, event ≤64,
// props jsonb, created_at). RLS: INSERT own-or-null for
// authenticated; SELECT admins only. 180-day auto-purge.
// Deliberately minimal: no device IDs, no third-party
// SDK, no fingerprinting — an event name plus tiny
// structured props (district strings and counts only,
// never free text, names, coordinates, or health data).
// track() is fire-and-forget: analytics must NEVER
// break or delay the feature that calls it, so every
// failure is swallowed with a logger warn.
// =====================================================
import { supabase } from '../supabase';
import { log } from '../logger';

/** Canonical event names (the DB caps `event` at 64 chars). */
export const events = {
  REPORT_SUBMITTED: 'report_submitted',
  REPORT_QUEUED: 'report_queued',
  SYNC_COMPLETED: 'sync_completed',
  ALERT_ACKED: 'alert_acked',
  ALERT_CREATED: 'alert_created',
  APP_LANGUAGE_CHANGED: 'app_language_changed',
} as const;

/** Tiny structured props only — flat scalar values, nothing sensitive. */
export type EventProps = Record<string, string | number | boolean | null>;

/**
 * Record one analytics event. Fire-and-forget by design:
 * returns void immediately, never throws, never rejects.
 * User id comes from the locally cached session (getSession
 * reads storage, no network); null is fine — the RLS insert
 * policy accepts own-or-null user_id.
 */
export function track(event: string, props: EventProps = {}): void {
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.from('app_events').insert({
        user_id: session?.user?.id ?? null,
        event: event.slice(0, 64),
        props,
      });
      if (error) log.warn('Analytics', `event '${event}' not recorded`, error.message);
    } catch (err) {
      log.warn('Analytics', `event '${event}' not recorded`, err);
    }
  })();
}

export const analyticsService = { track, events };
export default analyticsService;
