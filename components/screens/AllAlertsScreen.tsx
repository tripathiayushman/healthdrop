// =====================================================
// ALL ALERTS SCREEN — Bharosa B·02 inbox + B·03 poster
// Full list of active health alerts with search, filter,
// and a detail view restyled as THE POSTER: the block
// designed to be shown across a doorway. Directive first,
// disease second; verification is a stamp with a human
// name; acknowledging is a promise ("I'll inform my
// area") — that count is what the officer watches.
// =====================================================
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ScrollView, TextInput, RefreshControl, Pressable,
  Linking, useWindowDimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Profile } from '../../types';
import { format } from 'date-fns';
import {
  ALERT_RADIUS_KM, filterAlertsForProfile, isRadiusScopedRole, isWithinAlertRadius,
} from '../../lib/services/alertRadius';
import { computeCompleteness } from '../../lib/services/profileCompleteness';
import { sanitizeSearchTerm } from '../../lib/services/searchSanitize';
import { alertAcks } from '../../lib/services/alertAcks';
import {
  SkeletonBlock, ErrorCard, EmptyState, getSeverityColor, VerifiedStamp,
} from '../dashboards/DashboardShared';
import { StatusBadge } from '../shared/StatusBadge';

interface Props { profile: Profile; onBack: () => void; }

interface Alert {
  id: string;
  title: string;
  description: string;
  alert_type: string;
  urgency_level: string;
  district: string;
  state: string;
  location_name: string;
  /** 'active' | 'resolved'. There is no CHECK constraint on this column
   *  (verified in pg_constraint), so treat anything that is not 'resolved'
   *  as still live rather than assuming a closed vocabulary. */
  status: string;
  created_at: string;
  updated_at?: string | null;
  disease_or_issue?: string | null;
  precautionary_measures?: string | null;
  immediate_actions?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  approval_status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** "№A1B2C3D4" — the alert's short, quotable number. */
const shortAlertNo = (id: string): string => `№${id.slice(0, 8).toUpperCase()}`;

/** Honest relative time; falls back to the date past a month. */
const relativeTime = (iso?: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days <= 30) return `${days}d ago`;
  return format(new Date(t), 'dd MMM yyyy');
};

/**
 * B·03 "DO THESE THREE THINGS" — split precautionary_measures /
 * immediate_actions on newlines & semicolons, strip any manual
 * numbering, keep the first 3. A block that won't split falls
 * back to its full text as a single step; nothing → no section.
 */
const parseDirectiveSteps = (
  ...sources: (string | null | undefined)[]
): string[] => {
  const steps: string[] = [];
  for (const source of sources) {
    if (typeof source !== 'string' || !source.trim()) continue;
    const parts = source
      .split(/[\n;]+/)
      .map((s) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
    if (parts.length === 0) parts.push(source.trim());
    for (const p of parts) {
      if (!steps.some((s) => s.toLowerCase() === p.toLowerCase())) steps.push(p);
      if (steps.length >= 3) return steps;
    }
  }
  return steps;
};

const stepsHeading = (n: number): string =>
  n >= 3 ? 'DO THESE THREE THINGS' : n === 2 ? 'DO THESE TWO THINGS' : 'DO THIS ONE THING';

/** metadata.directive_hindi, only when it's a real non-empty string. */
const directiveHindiOf = (alert: Alert): string | null => {
  const raw = alert.metadata?.['directive_hindi'];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
};

// ─────────────────────────────────────────────────────────────────────────
// BRK-23(i) — STAND-DOWN
//
// An advisory that was right and has ended had no way to say so. The only
// close available was to re-review and *reject* it, which reads as "this was
// wrong", carries no closing note, and makes the alert vanish silently from
// every device — the district that ended its outbreak could not tell anyone.
//
// Schema reality, read from information_schema/pg_constraint on the live
// project before any of this was designed:
//   · health_alerts.status  text, DEFAULT 'active', NO check constraint
//   · health_alerts.metadata jsonb, DEFAULT '{}'
//   · there is NO resolved_at / resolved_by / resolution_note column, and
//     no updated_at trigger (pg_trigger lists only auto_approve_alert_trigger,
//     trg_push_on_alert_approved, trg_push_on_alert_created,
//     trg_set_created_bucket) — so updated_at is stamped by this client.
// The closing note therefore lives in `metadata` today. Proper first-class
// columns are reported as migration SQL rather than applied here.
// ─────────────────────────────────────────────────────────────────────────

/** The one status value that means "this advisory has ended". */
const STATUS_RESOLVED = 'resolved';

/** How long a stood-down advisory keeps a place in the list.
 *  The point is to tell the people who saw the alarm that it is over; after
 *  two weeks that message has landed and the row is just noise. */
const STAND_DOWN_VISIBLE_DAYS = 14;

/** A closing note is required, and one word is not a note. */
const STAND_DOWN_NOTE_MIN = 10;
const STAND_DOWN_NOTE_MAX = 500;

/**
 * BRK-22+23 P6 — ended advisories get their OWN page budget.
 *
 * The first cut fetched active and resolved rows in one `.in('status', …)`
 * query under a single .limit(200). Resolved rows never expire from the table,
 * so every advisory ever closed would eventually compete for the same 200 slots
 * as the live ones — and rawActive drives hiddenByScope, the header count and
 * the empty-state branch, so live alerts would silently start going missing
 * from all three the moment the table passed 200 rows. That is a correctness
 * cliff, not a style note, so the two kinds of row are now two queries with two
 * independent budgets and two independent failure states.
 *
 * 14 days of closures is what the window admits; 60 is generous headroom for it.
 */
const STAND_DOWN_FETCH_LIMIT = 60;

/**
 * Roles that can actually stand an alert down — not the roles we wish could.
 *
 * Verified against live RLS, rolled back: policy `alerts_update` is
 * USING role = ANY('super_admin','health_admin','clinic') AND is_active.
 * A probe UPDATE as the live health_admin resolved 4 rows; the identical
 * probe as the live district_officer resolved 0.
 *
 * `clinic` passes RLS but is deliberately NOT offered the control: that
 * policy carries no district predicate at all, so a self-registered clinic
 * could close another district's advisory (the standing SEC-05 finding).
 * Handing that a button would turn a known hole into a shipped feature.
 *
 * district_officer is the role that most needs this and cannot have it —
 * the RLS change is reported as migration SQL, not applied here. Until it
 * lands, a district officer asks an admin. The button is hidden rather than
 * shown-and-failing, because a control that always errors is a worse lie
 * than an absent one.
 */
const STAND_DOWN_ROLES: ReadonlySet<string> = new Set(['super_admin', 'health_admin']);
const canStandDown = (role?: string | null): boolean =>
  STAND_DOWN_ROLES.has(String(role ?? ''));

interface StandDown {
  note: string | null;
  at: string | null;
  byName: string | null;
}

/** Reads the stand-down record off an alert, or null if it is still live. */
const standDownOf = (alert: Alert): StandDown | null => {
  if (alert.status !== STATUS_RESOLVED) return null;
  const meta = alert.metadata ?? {};
  const str = (key: string): string | null => {
    const v = meta[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  return {
    note: str('stand_down_note'),
    // updated_at is the fallback for a row closed by some other path.
    at: str('stood_down_at') ?? alert.updated_at ?? null,
    byName: str('stood_down_by_name'),
  };
};

/**
 * Inside the "recently ended" window?
 *
 * When the timestamp is missing or unparseable we KEEP the row. Dropping it
 * would silently hide the fact that an advisory ended, which is the exact
 * failure this whole item exists to fix; showing it undated is honest and
 * the caption says so.
 */
const withinStandDownWindow = (sd: StandDown | null): boolean => {
  if (!sd) return false;
  if (!sd.at) return true;
  const t = new Date(sd.at).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= STAND_DOWN_VISIBLE_DAYS * 86400000;
};

/**
 * P7(a) — "Recently ended" is ordered by when it ENDED, not when it was raised.
 * created_at is the age of the alarm and says nothing about the closure, so an
 * advisory stood down an hour ago could sit below one closed a week ago.
 *
 * Rows whose closing time was never recorded sort FIRST, matching
 * withinStandDownWindow's rule of keeping rather than hiding them: an
 * undated closure is the one most in need of being looked at, and the card
 * says "date not recorded" in place of a time it does not have.
 *
 * A finite sentinel, not Infinity: two undated rows would subtract to NaN, and
 * a NaN comparator is a footgun even where the spec happens to coerce it to 0.
 */
const STAND_DOWN_UNDATED_FIRST = Number.MAX_SAFE_INTEGER;
const standDownSortKey = (a: Alert): number => {
  const at = standDownOf(a)?.at;
  if (!at) return STAND_DOWN_UNDATED_FIRST;
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? STAND_DOWN_UNDATED_FIRST : t;
};

const AllAlertsScreen: React.FC<Props> = ({ profile, onBack }) => {
  const { colors, isDark, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  // title-1 poster scale — 24/700, up to 28 on wide screens.
  // Devanagari gets ~1.3× line-height headroom.
  const wide = width >= 480;
  const directiveSize = wide ? 28 : 24;

  // Everything the server returned for the current search/urgency query, BEFORE
  // the client-side radius filter. Keeping it is what lets this screen say how
  // many alerts it is hiding instead of rendering a green all-clear over them.
  //
  // Two lists, two queries, two budgets, two failure states (P6). A live alert
  // and an ended advisory are opposite claims and must never share a limit.
  const [rawActive, setRawActive] = useState<Alert[]>([]);
  const [rawStoodDown, setRawStoodDown] = useState<Alert[]>([]);
  // Opt-in reveal: the radius filter is a relevance filter, not a permission
  // boundary (RLS already allows any approved alert to be read), so the user
  // may always ask to see what was scoped away.
  const [showOutsideArea, setShowOutsideArea] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // The "Recently ended" region is a data region and owes the same four states
  // as the main list. Its failure is NOT the main list's failure and must not
  // be reported as one — nor may it be swallowed into an empty section, which
  // would make "nothing ended recently" and "we could not find out" identical.
  //
  // A flag, not a translated string: keeping the words out of state keeps `t`
  // out of load()'s dependency array, so a language change can never re-enter
  // the fetch, and the message is always rendered in the CURRENT language
  // rather than the one that was active when the request failed.
  const [endedFailed, setEndedFailed] = useState(false);

  // ── Acknowledgement state (B·03 promise loop) ──
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set());
  const [ackSaving, setAckSaving] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  // ── Approver for the stamp — fetched, never faked ──
  const [approver, setApprover] = useState<{ name: string; role?: string } | null>(null);

  // ── Stand-down composer (BRK-23) — a human decision, typed by a human ──
  const [standDownOpen, setStandDownOpen] = useState(false);
  const [standDownNote, setStandDownNote] = useState('');
  const [standDownSaving, setStandDownSaving] = useState(false);
  const [standDownError, setStandDownError] = useState<string | null>(null);
  // Shown to the officer who just pressed the button, and only to them: the
  // one moment where an honest account of what a stand-down actually does is
  // worth more than any amount of before-the-fact copy.
  const [standDownDone, setStandDownDone] = useState(false);

  const load = useCallback(async () => {
    setFetchError(null);
    setEndedFailed(false);
    try {
      const term = sanitizeSearchTerm(search);

      // ── Query 1: the live alerts. This one owns the whole 200-row page. ──
      let activeQ = supabase
        .from('health_alerts')
        .select('*')
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(200);
      if (urgencyFilter) activeQ = activeQ.eq('urgency_level', urgencyFilter);
      if (term) activeQ = activeQ.ilike('title', `%${term}%`);

      // ── Query 2: recently stood-down advisories, separately bounded. ──
      // The people who were warned are exactly the people who must be told it
      // is over, so these are fetched — but on their own budget, ordered by
      // when they were CLOSED (updated_at is what the stand-down write stamps;
      // the column is DEFAULT now() and is non-null on every live row, checked
      // in information_schema). `approval_status='approved'` still gates both:
      // an alert no human approved is not shown in either group.
      let endedQ = supabase
        .from('health_alerts')
        .select('*')
        .eq('status', STATUS_RESOLVED)
        .eq('approval_status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(STAND_DOWN_FETCH_LIMIT);
      if (urgencyFilter) endedQ = endedQ.eq('urgency_level', urgencyFilter);
      if (term) endedQ = endedQ.ilike('title', `%${term}%`);

      // allSettled, not all: a failure in one region may not erase the other.
      const [activeSettled, endedSettled] = await Promise.allSettled([activeQ, endedQ]);

      if (activeSettled.status === 'rejected' || activeSettled.value.error) {
        console.error('Failed to load alerts:',
          activeSettled.status === 'rejected' ? activeSettled.reason : activeSettled.value.error);
        setFetchError("Couldn't load alerts — check connection");
      } else if (!activeSettled.value.data) {
        // AL-N6 — a 200 with no error AND no body is a failure, not a zero.
        // `else if (data)` used to drop straight through here and leave
        // rawActive=[] with fetchError=null, i.e. a green all-clear over an
        // answer we never actually received.
        console.error('Failed to load alerts: response carried neither error nor data');
        setFetchError("Couldn't read the alert list — the server sent no answer. Try again.");
      } else {
        const rows = activeSettled.value.data as Alert[];
        // Scoping happens at render time, not here: the raw result is the only
        // evidence we have for "the server does have alerts, we hid them".
        setRawActive(rows);
        // Batch: which of these has this user already acknowledged?
        // Failure degrades quietly — captions simply don't render.
        const ackRes = await alertAcks.myAckFor(rows.map((a) => a.id));
        if (ackRes.data) setAckedIds(ackRes.data);
      }

      if (endedSettled.status === 'rejected' || endedSettled.value.error) {
        console.error('Failed to load ended advisories:',
          endedSettled.status === 'rejected' ? endedSettled.reason : endedSettled.value.error);
        setEndedFailed(true);
      } else if (!endedSettled.value.data) {
        // AL-N6, same shape, same rule: no error and no body is a failure.
        console.error('Failed to load ended advisories: response carried neither error nor data');
        setEndedFailed(true);
      } else {
        setRawStoodDown(
          (endedSettled.value.data as Alert[]).filter(a => withinStandDownWindow(standDownOf(a))),
        );
      }
    } catch (err: any) {
      console.error('Failed to load alerts:', err);
      setFetchError("Couldn't load alerts — check connection");
      setEndedFailed(true);
    }
    finally { setLoading(false); }
  }, [urgencyFilter, search]);

  // ── Scope bookkeeping ──────────────────────────────────────────────
  // filterAlertsForProfile is an exact district match widened to
  // ALERT_RADIUS_KM only for districts that appear in a hardcoded gazetteer, so
  // it silently drops real, live, approved alerts (Kovilancheri and Moolacheri
  // are not in that table at all). Every number below is derived from the same
  // rows, so the copy can never quote a count it did not verify.
  const scopedRole = isRadiusScopedRole(profile.role);
  const districtNotSet =
    scopedRole && computeCompleteness(profile).missing.includes('district');

  // BRK-23 — the two kinds of row arrive from two queries and are never mixed.
  // Every "n alerts" sentence on this screen is a claim about *live* alerts and
  // must stay one: a stood-down advisory is the opposite of an active alert and
  // may never be added to it.
  const inScopeAlerts = useMemo(
    () => filterAlertsForProfile(rawActive, profile),
    [rawActive, profile.role, profile.district, profile.state],
  );
  const inScopeStoodDown = useMemo(
    () => filterAlertsForProfile(rawStoodDown, profile),
    [rawStoodDown, profile.role, profile.district, profile.state],
  );

  const hiddenByScope = rawActive.length - inScopeAlerts.length;
  // P7(b) — ended advisories can be scoped out too, and until now that was the
  // one thing this screen hid without ever admitting to it: the reveal control
  // only rendered when hiddenByScope > 0, so an advisory that ended outside the
  // radius was unreachable AND unmentioned. Counted, confessed, revealable.
  const hiddenStoodDown = rawStoodDown.length - inScopeStoodDown.length;
  const alerts = showOutsideArea ? rawActive : inScopeAlerts;
  // P7(a) — ordered by when it ended, not by when it was raised.
  const standDownList = useMemo(
    () => [...(showOutsideArea ? rawStoodDown : inScopeStoodDown)]
      .sort((x, y) => standDownSortKey(y) - standDownSortKey(x)),
    [showOutsideArea, rawStoodDown, inScopeStoodDown],
  );
  // AL-N3 — these are two different filters and they need two different
  // sentences. `isFiltered` alone produced copy about "your search" for a user
  // who had only tapped the Critical chip and typed nothing.
  const hasSearch = !!search;
  const hasUrgencyFilter = !!urgencyFilter;
  const isFiltered = hasSearch || hasUrgencyFilter;
  const scopeArea = t('alertScope.whereDistrict', {
    defaultValue: '{{district}} and {{km}} km around it',
    district: profile.district,
    km: ALERT_RADIUS_KM,
  });

  // The subtitle is a claim about how many alerts exist, so it may never read
  // "0 alerts found" while a fetch is in flight, while a fetch has failed, or
  // while rows are sitting behind the radius filter.
  const headerSubText = loading
    ? t('alertScope.listLoading', { defaultValue: 'Checking for active alerts…' })
    : fetchError
      ? (rawActive.length > 0 || rawStoodDown.length > 0
          ? t('alertScope.listCountStale', { defaultValue: 'Showing the last list that loaded — the refresh failed' })
          : t('alertScope.listCountUnavailable', { defaultValue: 'Count unavailable — the list did not load' }))
      : hiddenByScope > 0
        ? districtNotSet
          ? (showOutsideArea
              ? t('alertScope.listCountNoDistrictShown', {
                  defaultValue: '{{n}} active — none matched to you until your district is set',
                  n: alerts.length,
                })
              : t('alertScope.listCountNoDistrictHidden', {
                  defaultValue: "0 shown — your district isn't set · {{hidden}} active",
                  hidden: hiddenByScope,
                }))
          : (showOutsideArea
              ? t('alertScope.listCountRevealed', {
                  defaultValue: '{{n}} shown · {{hidden}} outside your area',
                  n: alerts.length, hidden: hiddenByScope,
                })
              : t('alertScope.listCountScoped', {
                  defaultValue: '{{n}} in your area · {{hidden}} more outside',
                  n: alerts.length, hidden: hiddenByScope,
                }))
        : alerts.length === 1
          ? t('alertScope.listCountOne', { defaultValue: '1 alert found' })
          : t('alertScope.listCountMany', { defaultValue: '{{n}} alerts found', n: alerts.length });

  const linkColor = isDark ? colors.primary : colors.primaryDark;

  // ── Who owns the reveal control right now ──────────────────────────────
  // The scoped empty-state carries its own "Show them anyway" button, so the
  // strip stands down when that branch is on screen rather than printing a
  // second one. Everywhere else the strip owns it — INCLUDING while a refresh
  // has failed (AL-N2): the strip used to be gated on !fetchError, which took
  // the reveal away in the one state where a user most needs to go looking.
  const emptyStateOwnsReveal = !fetchError && rawActive.length > 0 && alerts.length === 0;
  const showScopeStrip =
    !loading && (hiddenByScope > 0 || hiddenStoodDown > 0) && !emptyStateOwnsReveal;
  // Live alerts hidden = a warning. Only ended advisories hidden = not a
  // warning; colour is spent on meaning, so that strip is calm paper.
  const stripIsWarning = hiddenByScope > 0;

  /** The way back to the alerts the radius filter removed. */
  const revealButton = (label: string, a11y: string) => (
    <TouchableOpacity
      style={[as.revealBtn, { borderColor: colors.warning, backgroundColor: colors.surface }]}
      onPress={() => setShowOutsideArea(true)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Ionicons name="eye-outline" size={16} color={linkColor} />
      <Text style={[as.revealBtnText, { color: linkColor }]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </TouchableOpacity>
  );

  useEffect(() => { load(); }, [load]);

  // Fetch the approving officer's name for the stamp. The stamp is
  // only ever applied with a human name — on failure it is omitted.
  useEffect(() => {
    setApprover(null);
    const sel = selected;
    if (!sel || sel.approval_status !== 'approved' || !sel.approved_by) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', sel.approved_by)
          .single();
        if (!cancelled && !error && data?.full_name) {
          setApprover({
            name: data.full_name,
            role: data.role ? String(data.role).replace(/_/g, ' ') : undefined,
          });
        }
      } catch { /* omit the stamp — never fake it */ }
    })();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openDetail = (a: Alert) => {
    setAckError(null);
    setStandDownOpen(false);
    setStandDownNote('');
    setStandDownError(null);
    setStandDownDone(false);
    setSelected(a);
  };

  /**
   * One way out of the sheet, used by the close button and by Android's
   * hardware back (P7(d)).
   *
   * Back steps back ONE level: with the composer open it closes the composer
   * and keeps the typed note in state, so reopening restores it — the same
   * contract "Keep it active" already honours. It does nothing at all while a
   * stand-down write is in flight; yanking the sheet out from under an
   * in-flight write is how a user ends up not knowing whether it landed.
   */
  const closeDetail = () => {
    if (standDownSaving) return;
    setSelected(null);
  };
  const dismissDetail = () => {
    if (standDownSaving) return;
    if (standDownOpen) {
      setStandDownOpen(false);
      setStandDownError(null);
      return;
    }
    closeDetail();
  };

  /**
   * BRK-23 — stand an advisory down.
   *
   * THE MISSION RULE holds here by construction. This runs only from a
   * button an official pressed, after that official typed a closing note:
   * the decision is human. And it fires nothing at the public — verified,
   * rolled back, against the live database: the update touches `status`,
   * `updated_at` and `metadata` but NOT `approval_status`, and the only push
   * trigger on this table is `trg_push_on_alert_approved`, declared
   * AFTER UPDATE **OF approval_status**. A probe stand-down of all four live
   * alerts produced 0 rows in push_notification_outbox.
   *
   * The flip side of that, and the thing the copy must never soften (P1): the
   * stand-down is delivered NOWHERE except this screen. Every other surface
   * filters status='active' and simply drops the row — six dashboards,
   * MapTabScreen, HealthMapComponent (twice) and AIInsightsPanel, all
   * re-grepped. No notifications row is written and no push fires. So the
   * officer is told, in the composer and again in the receipt afterwards,
   * that she still has to tell people herself.
   */
  const submitStandDown = async () => {
    if (!selected || standDownSaving) return;
    const note = standDownNote.trim();
    if (note.length < STAND_DOWN_NOTE_MIN) return;

    setStandDownSaving(true);
    setStandDownError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();
      const nextMeta = {
        ...(selected.metadata ?? {}),
        stand_down_note: note,
        stood_down_at: nowIso,
        stood_down_by: user?.id ?? null,
        stood_down_by_name: profile.full_name ?? null,
      };

      const { data, error } = await supabase
        .from('health_alerts')
        .update({ status: STATUS_RESOLVED, updated_at: nowIso, metadata: nextMeta })
        .eq('id', selected.id)
        // Two officials closing the same advisory must not overwrite each
        // other's note — whoever is second gets told it is already closed.
        .eq('status', 'active')
        .select('id,status,metadata,updated_at');

      if (error) {
        setStandDownError(t('alertStandDown.errorSave', {
          defaultValue: "Couldn't stand this alert down — check your connection and try again. Nothing was changed.",
        }));
        return;
      }

      // BRK-01's lesson, applied: a returned row count is NOT proof a write
      // landed. Believe only what the database says it kept.
      const row = (data as Alert[] | null)?.[0];
      if (!row || row.status !== STATUS_RESOLVED) {
        setStandDownError(t('alertStandDown.errorNotApplied', {
          defaultValue: 'Nothing was changed — this alert may already have been stood down by someone else, or your account is not permitted to close it. Pull to refresh.',
        }));
        return;
      }

      // The row has changed kind, so it moves between the two lists rather
      // than being rewritten in place. Both are bounded and de-duplicated by
      // id, so a second stand-down of the same alert cannot double-insert.
      const updated: Alert = { ...selected, ...row };
      setRawActive(prev => prev.filter(a => a.id !== updated.id));
      setRawStoodDown(prev => [updated, ...prev.filter(a => a.id !== updated.id)]);
      setSelected(updated);
      setStandDownOpen(false);
      setStandDownNote('');
      setStandDownDone(true);
    } catch {
      setStandDownError(t('alertStandDown.errorSave', {
        defaultValue: "Couldn't stand this alert down — check your connection and try again. Nothing was changed.",
      }));
    } finally {
      setStandDownSaving(false);
    }
  };

  const acknowledge = async () => {
    if (!selected || ackSaving) return;
    setAckSaving(true);
    setAckError(null);
    const res = await alertAcks.acknowledge(selected.id);
    setAckSaving(false);
    if (res.error) {
      setAckError("Couldn't record your acknowledgement — check connection and try again.");
      return;
    }
    setAckedIds(prev => new Set(prev).add(selected.id));
  };

  const callHelpline = (phone: string) => {
    // tel: is a no-op link on web — guard so a blocked scheme never throws.
    try {
      const tel = phone.replace(/[^\d+]/g, '');
      if (tel) Linking.openURL(`tel:${tel}`).catch(() => {});
    } catch { /* unsupported platform — quietly do nothing */ }
  };

  const formatSafeDate = (value: string | null | undefined, pattern: string, fallback = ''): string => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return fallback;
    return format(parsed, pattern);
  };

  // Soft background for a severity pill — solid fill is CRITICAL's privilege alone.
  const severitySoftBg = (level: string): string => {
    switch (level?.toLowerCase()) {
      case 'critical': return colors.dangerBg;
      case 'high': return colors.offlineBg;
      case 'medium': return colors.warningBg;
      case 'low': return colors.successBg;
      default: return colors.surfaceVariant;
    }
  };

  const SeverityPill: React.FC<{ level: string; suffix?: string }> = ({ level, suffix }) => {
    const key = level?.toLowerCase() ?? '';
    const isCritical = key === 'critical';
    const fg = isCritical ? colors.textInverse : getSeverityColor(key, colors);
    const bg = isCritical ? colors.danger : severitySoftBg(key);
    return (
      <View style={[as.severityPill, { backgroundColor: bg }]} accessibilityLabel={`Urgency: ${key || 'unknown'}`}>
        {!isCritical && <View style={[as.severityDot, { backgroundColor: fg }]} />}
        <Text style={[as.severityPillText, { color: fg }]} maxFontSizeMultiplier={1.3}>
          {(level ?? '').toUpperCase()}{suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
    );
  };

  // headerBg is a mode-appropriate SURFACE (paper in light, dark surface in
  // dark), so the ordinary ink tiers read correctly in BOTH modes.
  // textInverse here would be white-on-paper — invisible — and is banned.
  const headerText = colors.text;
  const headerSub = colors.textSecondary;

  // ── Poster derivations for the selected alert ──
  const selHindi = selected ? directiveHindiOf(selected) : null;
  const selSteps = selected
    ? parseDirectiveSteps(selected.precautionary_measures, selected.immediate_actions)
    : [];
  const selAcked = !!selected && ackedIds.has(selected.id);
  // BRK-23 — has this advisory been stood down, and may this user do it?
  const selStandDown = selected ? standDownOf(selected) : null;
  const selEnded = !!selStandDown;
  const canOfferStandDown = !!selected && !selEnded && canStandDown(profile.role);
  const noteLen = standDownNote.trim().length;
  const noteReady = noteLen >= STAND_DOWN_NOTE_MIN;
  /** Attribution for the stand-down — every branch states only what is known. */
  const selEndedByLine: string | null = !selStandDown ? null : (() => {
    const when = selStandDown.at ? formatSafeDate(selStandDown.at, 'dd MMM yyyy · HH:mm') : '';
    const who = selStandDown.byName;
    if (who && when) return t('alertStandDown.byWhoWhen', { defaultValue: 'Stood down by {{name}} · {{when}}', name: who, when });
    if (who) return t('alertStandDown.byWho', { defaultValue: 'Stood down by {{name}}', name: who });
    if (when) return t('alertStandDown.byWhen', { defaultValue: 'Stood down {{when}}', when });
    return t('alertStandDown.byUnknown', { defaultValue: 'Stood down — the officer and time were not recorded' });
  })();

  return (
    <View style={[as.container, { backgroundColor: colors.background }]}>
      {/* Header — flat headerBg surface. No Role Ribbon on this screen, so the
          1px hairline is the only separator and must render in both modes. */}
      <View
        style={[
          as.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={as.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={[as.headerTitle, { color: headerText }]}>Active Alerts</Text>
          <Text style={[as.headerSub, { color: headerSub }]} maxFontSizeMultiplier={1.3}>
            {headerSubText}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={[as.searchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[as.searchInput, { color: colors.text }]}
          placeholder="Search alerts..."
          placeholderTextColor={colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Urgency filter chips — selected = solid fill + check, never tint alone */}
      <View style={as.chipRow}>
        {(['', 'critical', 'high', 'medium', 'low'] as const).map(u => {
          const active = urgencyFilter === u;
          const color = u === '' ? colors.primary : getSeverityColor(u, colors);
          const selectedText = u === '' ? colors.onPrimary : colors.textInverse;
          return (
            <TouchableOpacity
              key={u || 'all'}
              style={[
                as.chip,
                active
                  ? { backgroundColor: color, borderColor: color }
                  : { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => setUrgencyFilter(u)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={u === '' ? 'All urgencies' : `Urgency ${u}`}
            >
              {active && <Ionicons name="checkmark" size={14} color={selectedText} />}
              <Text style={[as.chipText, { color: active ? selectedText : colors.text }]} maxFontSizeMultiplier={1.3}>
                {u === '' ? 'All' : u.charAt(0).toUpperCase() + u.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Scope confession — when rows ARE listed but the radius filter is also
          holding some back, the list must admit it; a count that silently omits
          live alerts is the same lie as a green all-clear over them. */}
      {showScopeStrip && (
        <View
          style={[as.scopeStrip, stripIsWarning
            ? { backgroundColor: colors.warningBg, borderColor: colors.warning }
            : { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}
          accessibilityLiveRegion="polite"
        >
          {/* AL-N2 — while a refresh has failed, every count in this strip is a
              claim about the last list that loaded. Say so; do not let a stale
              number pass as a current one, and do not remove the strip. */}
          {!!fetchError && (
            <Text style={[as.scopeStripStale, { color: colors.textSecondary }]}>
              {t('alertScope.stripStale', {
                defaultValue: 'From the last list that loaded — the refresh failed:',
              })}
            </Text>
          )}
          {hiddenByScope > 0 && (
          <View style={as.scopeStripRow}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            <Text style={[as.scopeStripText, { color: colors.text }]}>
              {showOutsideArea
                ? (districtNotSet
                    ? t('alertScope.stripRevealedNoDistrict', {
                        defaultValue: "Showing every active alert. Your district isn't set, so none of them are matched to you.",
                      })
                    : hiddenByScope === 1
                      ? t('alertScope.stripRevealedOne', {
                          defaultValue: 'Showing 1 alert from outside {{area}}.', area: scopeArea,
                        })
                      : t('alertScope.stripRevealedMany', {
                          defaultValue: 'Showing {{hidden}} alerts from outside {{area}}.',
                          hidden: hiddenByScope, area: scopeArea,
                        }))
                : hiddenByScope === 1
                  ? t('alertScope.stripHiddenOne', {
                      defaultValue: '1 more active alert is outside {{area}} and is not listed here.', area: scopeArea,
                    })
                  : t('alertScope.stripHiddenMany', {
                      defaultValue: '{{hidden}} more active alerts are outside {{area}} and are not listed here.',
                      hidden: hiddenByScope, area: scopeArea,
                    })}
            </Text>
          </View>
          )}
          {/* P7(b) — the ended advisories the radius filter is holding back.
              A separate sentence with a separate glyph: an advisory that has
              ENDED outside your area is not an alarm and must not borrow one. */}
          {hiddenStoodDown > 0 && (
            <View style={as.scopeStripRow}>
              <Ionicons name="checkmark-done-outline" size={16} color={colors.textSecondary} />
              <Text style={[as.scopeStripText, { color: colors.text }]}>
                {showOutsideArea
                  ? (hiddenStoodDown === 1
                      ? t('alertStandDown.stripRevealedOne', {
                          defaultValue: 'Also showing 1 advisory that ended outside {{area}}.', area: scopeArea,
                        })
                      : t('alertStandDown.stripRevealedMany', {
                          defaultValue: 'Also showing {{hidden}} advisories that ended outside {{area}}.',
                          hidden: hiddenStoodDown, area: scopeArea,
                        }))
                  : (hiddenStoodDown === 1
                      ? t('alertStandDown.stripHiddenOne', {
                          defaultValue: '1 advisory that ended recently is outside {{area}} and is not listed here.',
                          area: scopeArea,
                        })
                      : t('alertStandDown.stripHiddenMany', {
                          defaultValue: '{{hidden}} advisories that ended recently are outside {{area}} and are not listed here.',
                          hidden: hiddenStoodDown, area: scopeArea,
                        }))}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[as.revealBtn, {
              borderColor: stripIsWarning ? colors.warning : colors.borderStrong,
              backgroundColor: colors.surface,
            }]}
            onPress={() => setShowOutsideArea(v => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showOutsideArea }}
            /* The count spoken here must be everything the toggle reveals —
               live alerts AND ended advisories — or the label promises fewer
               rows than appear (P7(b)). */
            accessibilityLabel={showOutsideArea
              ? t('alertScope.hideOutsideA11y', { defaultValue: 'Hide alerts from outside my area' })
              : hiddenByScope + hiddenStoodDown === 1
                ? t('alertScope.showOutsideA11yOne', { defaultValue: 'Show the 1 alert outside my area' })
                : t('alertScope.showOutsideA11yMany', {
                    defaultValue: 'Show the {{hidden}} alerts outside my area',
                    hidden: hiddenByScope + hiddenStoodDown,
                  })}
          >
            <Ionicons name={showOutsideArea ? 'eye-off-outline' : 'eye-outline'} size={16} color={linkColor} />
            <Text style={[as.revealBtnText, { color: linkColor }]} maxFontSizeMultiplier={1.3}>
              {showOutsideArea
                ? t('alertScope.hideOutside', { defaultValue: 'Hide them' })
                : t('alertScope.showOutside', { defaultValue: 'Show them' })}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* List — skeleton / error / quiet-zero / content */}
      {fetchError && !loading && (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorCard message={fetchError} onRetry={load} />
        </View>
      )}
      {loading ? (
        <View style={as.skeletonWrap} accessibilityElementsHidden>
          <SkeletonBlock height={104} radius={radii.md} />
          <SkeletonBlock height={104} radius={radii.md} />
          <SkeletonBlock height={104} radius={radii.md} />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={a => a.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            /* Four distinct empty meanings, and only the last is calm:
               the fetch failed (ErrorCard above owns it) / the server really
               returned nothing / no district to match against / the radius
               filter ate a non-empty result. */
            /* rawActive only: the ended advisories live in their own state,
               and a screen holding only those has NOT got live alerts hidden
               behind a filter — it is genuinely clear. */
            fetchError ? null : rawActive.length > 0 ? (
              districtNotSet ? (
                <View accessibilityLiveRegion="polite">
                  <EmptyState
                    icon="location-outline"
                    color={colors.warning}
                    title={t('alertScope.listNoDistrictTitle', { defaultValue: "Your district isn't set" })}
                    subtitle={rawActive.length === 1
                      ? t('alertScope.listNoDistrictBodyOne', {
                          defaultValue: '1 active alert is live, but alerts are matched to your district and yours is not set. This is not an all-clear — open Profile and set your district.',
                        })
                      : t('alertScope.listNoDistrictBodyMany', {
                          defaultValue: '{{n}} active alerts are live, but alerts are matched to your district and yours is not set. This is not an all-clear — open Profile and set your district.',
                          n: rawActive.length,
                        })}
                  />
                  {revealButton(
                    t('alertScope.showAllAction', { defaultValue: 'Show all active alerts' }),
                    t('alertScope.showAllA11y', { defaultValue: 'Show all active alerts, including ones not matched to a district' }),
                  )}
                </View>
              ) : (
                <View accessibilityLiveRegion="polite">
                  {/* AL-N3 — under a search or a chip, hiddenByScope counts
                      only the rows that survived the filter, so the title may
                      not speak of the true active total. Filtered titles say
                      "matching", and the subtitle names the filter the user
                      actually set instead of asserting a search they may never
                      have typed. */}
                  <EmptyState
                    icon="alert-circle-outline"
                    color={colors.warning}
                    title={isFiltered
                      ? (hiddenByScope === 1
                          ? t('alertScope.listScopedTitleFilteredOne', {
                              defaultValue: '1 matching alert — not in your area',
                            })
                          : t('alertScope.listScopedTitleFilteredMany', {
                              defaultValue: '{{n}} matching alerts — none in your area', n: hiddenByScope,
                            }))
                      : (hiddenByScope === 1
                          ? t('alertScope.listScopedTitleOne', { defaultValue: '1 active alert — not in your area' })
                          : t('alertScope.listScopedTitleMany', { defaultValue: '{{n}} active alerts — none in your area', n: hiddenByScope }))}
                    subtitle={hasSearch && hasUrgencyFilter
                      ? t('alertScope.listScopedBodyFilteredBoth', {
                          defaultValue: 'Of the alerts matching your search and urgency filter, none are inside {{area}}. Other active alerts may be hidden by that filter, so this is not an all-clear.',
                          area: scopeArea,
                        })
                      : hasSearch
                        ? t('alertScope.listScopedBodyFiltered', {
                            defaultValue: 'Of the alerts matching your search, none are inside {{area}}. Other active alerts may be hidden by that search, so this is not an all-clear.',
                            area: scopeArea,
                          })
                        : hasUrgencyFilter
                          ? t('alertScope.listScopedBodyFilteredUrgency', {
                              defaultValue: 'Of the {{level}} alerts, none are inside {{area}}. Alerts at other urgencies are hidden by that filter, so this is not an all-clear.',
                              area: scopeArea, level: urgencyFilter,
                            })
                          : t('alertScope.listScopedBody', {
                              defaultValue: 'This list only covers {{area}}, so this is not an all-clear.',
                              area: scopeArea,
                            })}
                  />
                  {revealButton(
                    t('alertScope.showOutsideAnyway', { defaultValue: 'Show them anyway' }),
                    hiddenByScope === 1
                      ? t('alertScope.showOutsideA11yOne', { defaultValue: 'Show the 1 alert outside my area' })
                      : t('alertScope.showOutsideA11yMany', { defaultValue: 'Show the {{hidden}} alerts outside my area', hidden: hiddenByScope }),
                  )}
                </View>
              )
            ) : (
              /* The query itself came back with nothing — a verified zero. */
              <EmptyState
                icon={isFiltered ? 'search-outline' : 'checkmark-circle-outline'}
                color={isFiltered ? colors.textSecondary : colors.success}
                title={isFiltered
                  ? t('alertScope.listNoMatch', { defaultValue: 'No alerts match — try a different search or filter.' })
                  : t('alertScope.listAllClear', { defaultValue: 'All clear — no active health alerts right now.' })}
              />
            )
          }
          /* ── BRK-23 "Recently ended" ──
             The stand-down has to reach the people who saw the alarm, so it
             is rendered in the same list they check, under the same radius
             scoping, styled as the opposite of an alert: no severity colour,
             no left rule, the closing note in the officer's own words. It sits
             BELOW the active alerts and is never mixed into their count. */
          ListFooterComponent={
            loading ? null : endedFailed ? (
              /* Its own query, so its own failure. Silence here would say
                 "nothing has ended recently", which is a different sentence
                 from "we could not find out" — the two may never look alike. */
              <View style={as.standDownSection} accessibilityLiveRegion="polite">
                <View style={[as.standDownHead, { borderTopColor: colors.borderStrong }]}>
                  <Ionicons name="cloud-offline-outline" size={18} color={colors.textSecondary} />
                  <Text style={[as.standDownHeadText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {t('alertStandDown.sectionTitle', { defaultValue: 'Recently ended' })}
                  </Text>
                </View>
                <Text style={[as.standDownHeadSub, { color: colors.textSecondary }]}>
                  {t('alertStandDown.errorLoad', {
                    defaultValue: "Couldn't check which advisories have ended.",
                  })}{' '}
                  {t('alertStandDown.errorLoadTail', {
                    defaultValue: 'An advisory shown above as active may already have been stood down.',
                  })}
                </Text>
                <Pressable
                  onPress={load}
                  accessibilityRole="button"
                  accessibilityLabel={t('alertStandDown.errorRetryA11y', {
                    defaultValue: 'Try again to check which advisories have ended',
                  })}
                  style={({ pressed }) => [
                    as.revealBtn,
                    { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardHover : colors.surface },
                  ]}
                >
                  <Ionicons name="refresh-outline" size={16} color={linkColor} />
                  <Text style={[as.revealBtnText, { color: linkColor }]} maxFontSizeMultiplier={1.3}>
                    {t('alertStandDown.errorRetry', { defaultValue: 'Try again' })}
                  </Text>
                </Pressable>
              </View>
            ) : standDownList.length === 0 ? null : (
              <View style={as.standDownSection} accessibilityLiveRegion="polite">
                <View style={[as.standDownHead, { borderTopColor: colors.borderStrong }]}>
                  <Ionicons name="checkmark-done-outline" size={18} color={colors.success} />
                  <Text style={[as.standDownHeadText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                    {t('alertStandDown.sectionTitle', { defaultValue: 'Recently ended' })}
                  </Text>
                </View>
                <Text style={[as.standDownHeadSub, { color: colors.textSecondary }]}>
                  {standDownList.length === 1
                    ? t('alertStandDown.sectionSubOne', {
                        defaultValue: 'An official stood down 1 advisory. It is no longer in force.',
                      })
                    : t('alertStandDown.sectionSubMany', {
                        defaultValue: 'An official stood down {{n}} advisories. They are no longer in force.',
                        n: standDownList.length,
                      })}
                </Text>
                {standDownList.map(a => {
                  const sd = standDownOf(a);
                  const when = sd?.at ? relativeTime(sd.at) : '';
                  return (
                    <Pressable
                      key={a.id}
                      style={({ pressed }) => [
                        as.standDownCard,
                        { backgroundColor: pressed ? colors.cardHover : colors.surface, borderColor: colors.border },
                      ]}
                      onPress={() => openDetail(a)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        t('alertStandDown.cardA11y', {
                          defaultValue: 'Ended advisory: {{title}}. This alert is no longer in force.',
                          title: a.title,
                        })
                      }
                    >
                      <View style={as.standDownTagRow}>
                        <View style={[as.standDownTag, { backgroundColor: colors.successBg }]}>
                          <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                          <Text style={[as.standDownTagText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                            {t('alertStandDown.tag', { defaultValue: 'STOOD DOWN' })}
                          </Text>
                        </View>
                        <Text style={[as.cardDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                          {when || t('alertStandDown.whenUnknown', { defaultValue: 'date not recorded' })}
                        </Text>
                      </View>
                      <Text style={[as.standDownCardTitle, { color: colors.textSecondary }]} numberOfLines={2}>
                        {a.title}
                      </Text>
                      {sd?.note ? (
                        <Text style={[as.standDownCardNote, { color: colors.text }]} numberOfLines={3}>
                          {sd.note}
                        </Text>
                      ) : (
                        /* Never invent a reason. The note is required going
                           forward, so this only shows for a row closed by some
                           path that did not record one. */
                        <Text style={[as.standDownCardNoteMissing, { color: colors.textTertiary }]}>
                          {t('alertStandDown.noNote', { defaultValue: 'No closing note was recorded.' })}
                        </Text>
                      )}
                      <View style={as.cardFooter}>
                        <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                        <Text style={[as.cardLoc, { color: colors.textSecondary }]} numberOfLines={1}>
                          {a.location_name}, {a.district}
                        </Text>
                        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )
          }
          renderItem={({ item: a }) => {
            // Only meaningful once the user has asked to see beyond the radius:
            // an unlabelled far-away alert would read as local news.
            const outsideArea =
              showOutsideArea && scopedRole && !districtNotSet && !isWithinAlertRadius(a, profile);
            return (
            <Pressable
              style={({ pressed }) => [
                as.card,
                {
                  backgroundColor: pressed ? colors.cardHover : colors.card,
                  borderColor: colors.border,
                  borderLeftColor: getSeverityColor(a.urgency_level, colors),
                },
                !isDark && as.cardShadow,
              ]}
              onPress={() => openDetail(a)}
              accessibilityRole="button"
              /* AL-N5 — the whole label goes through t(), not just the new
                 clause. Translating '. Outside your area.' on its own would
                 have produced a half-Hindi sentence bolted onto hardcoded
                 English; a screen reader reads one sentence, so one language. */
              accessibilityLabel={[
                t('alertScope.cardA11y', {
                  defaultValue: 'Alert, urgency {{urgency}}: {{title}}',
                  urgency: a.urgency_level, title: a.title,
                }),
                outsideArea
                  ? t('alertScope.cardA11yOutside', { defaultValue: 'Outside your area.' })
                  : '',
                ackedIds.has(a.id)
                  ? t('alertScope.cardA11yAcked', { defaultValue: 'Acknowledged.' })
                  : '',
              ].filter(Boolean).join(' ')}
            >
              <View style={as.cardTop}>
                <SeverityPill level={a.urgency_level} />
                <Text style={[as.cardDate, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                  {formatSafeDate(a.created_at, 'dd MMM yyyy', '—')}
                </Text>
              </View>
              {outsideArea && (
                <View style={as.outsideTagRow}>
                  <Ionicons name="navigate-outline" size={14} color={colors.textSecondary} />
                  <Text style={[as.outsideTagText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    {t('alertScope.outsideAreaTag', { defaultValue: 'outside your area' })}
                  </Text>
                </View>
              )}
              <Text style={[as.cardTitle, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
              <Text style={[as.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>{a.description}</Text>
              {ackedIds.has(a.id) && (
                <View style={as.ackCaptionRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={[as.ackCaptionText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                    acknowledged ✓
                  </Text>
                </View>
              )}
              <View style={as.cardFooter}>
                <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                <Text style={[as.cardLoc, { color: colors.textSecondary }]} numberOfLines={1}>
                  {a.location_name}, {a.district}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </View>
            </Pressable>
            );
          }}
        />
      )}

      {/* ── Detail — B·03 THE POSTER ──
          Severity pill row, then the strong-bordered poster block:
          directive at title-1 scale (Hindi first when present),
          description, the numbered "do these things" list, helpline
          with a Call button, the stamp, provenance. Then the
          acknowledge zone — a promise, not a dismissal. */}
      <Modal
        visible={!!selected}
        animationType={reduceMotion ? 'none' : 'slide'}
        transparent
        /* P7(d) — Android hardware back. Pre-existing gap, but the sheet can
           now hold a typed, unsaved closing note, so back steps back one level
           at a time: composer first (the note survives in state and is still
           there when it reopens), sheet second. It refuses to move mid-write. */
        onRequestClose={dismissDetail}
      >
        {/* P3 — iOS never resizes a modal window for the keyboard, and this
            overlay is justifyContent:'flex-end' with the stand-down composer as
            the last element in the ScrollView: its 112dp note field and BOTH
            its buttons would sit under the keyboard with no way to scroll them
            up. Android resizes the window itself, hence no behavior there —
            the same wrap AdvisoryComposerScreen, AIChatbot and AuthScreen use. */}
        <KeyboardAvoidingView
          style={as.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        <View style={[as.overlay, { backgroundColor: colors.overlay }]}>
          {selected && (
            <View style={[as.sheet, { backgroundColor: colors.card }]}>
              <View style={[as.modalTopRule, { backgroundColor: getSeverityColor(selected.urgency_level, colors) }]} />
              <View style={[as.modalHeader, { borderBottomColor: colors.borderLight }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[as.modalHeadTitle, { color: colors.text }]} numberOfLines={1}>
                    Alert {shortAlertNo(selected.id)}
                  </Text>
                  <Text style={[as.modalHeadSub, { color: colors.textSecondary }]} numberOfLines={1}>
                    {selected.location_name}, {selected.district}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={closeDetail}
                  disabled={standDownSaving}
                  style={[as.modalCloseBtn, { backgroundColor: colors.surfaceVariant }]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: standDownSaving }}
                  accessibilityLabel="Close alert details"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ paddingHorizontal: spacing.lg }} contentContainerStyle={{ paddingVertical: spacing.lg }}>
                {/* ── BRK-23 — the stand-down comes FIRST ──
                    Whoever opens an ended advisory must learn it is over
                    before they read a single instruction. This block sits
                    above the severity row and above the poster. */}
                {selEnded && (
                  <View
                    style={[as.endedBanner, { backgroundColor: colors.successBg, borderColor: colors.success }]}
                    accessibilityLiveRegion="polite"
                  >
                    <View style={as.endedBannerHead}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                      <Text style={[as.endedBannerTitle, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                        {t('alertStandDown.posterTitle', { defaultValue: 'This advisory has ended' })}
                      </Text>
                    </View>
                    <Text style={[as.endedBannerBody, { color: colors.text }]}>
                      {selStandDown?.note
                        ?? t('alertStandDown.noNote', { defaultValue: 'No closing note was recorded.' })}
                    </Text>
                    {!!selEndedByLine && (
                      <Text style={[as.endedBannerMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                        {selEndedByLine}
                      </Text>
                    )}
                    <Text style={[as.endedBannerFoot, { color: colors.textSecondary }]}>
                      {t('alertStandDown.posterFoot', {
                        defaultValue: 'What follows is kept for the record. Do not act on it and do not pass it on.',
                      })}
                    </Text>
                  </View>
                )}

                {/* P1 — the receipt. Shown once, to the official who just
                    pressed the button, in the one moment where an accurate
                    account of the reach is worth more than any amount of
                    before-the-fact copy: she is about to decide whether she
                    still needs to ring the ASHA workers herself. */}
                {standDownDone && (
                  <View
                    style={[as.doneNotice, { backgroundColor: colors.surfaceVariant, borderColor: colors.borderStrong }]}
                    accessibilityLiveRegion="polite"
                  >
                    <View style={as.endedBannerHead}>
                      <Ionicons name="megaphone-outline" size={18} color={colors.text} />
                      <Text style={[as.doneNoticeTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {t('alertStandDown.doneTitle', { defaultValue: 'Stood down. Nobody has been told yet.' })}
                      </Text>
                    </View>
                    <Text style={[as.doneNoticeBody, { color: colors.text }]}>
                      {t('alertStandDown.doneBody', {
                        defaultValue: 'The alert is off the map and out of every alert list. No notification was sent — your note appears under "Recently ended" here, for 14 days, and only for people who open this screen.',
                      })}
                    </Text>
                    <Text style={[as.doneNoticeBody, { color: colors.textSecondary }]}>
                      {t('alertStandDown.doneAsk', {
                        defaultValue: 'Anyone who acted on this alert still needs to hear it from you.',
                      })}
                    </Text>
                  </View>
                )}

                {/* Severity pill row — word + shape, never color alone.
                    Once stood down the urgency is history, so it is labelled
                    as history rather than shown as a live severity. */}
                <View style={as.modalPillRow}>
                  {selEnded ? (
                    <Text style={[as.modalTypeText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                      {t('alertStandDown.wasUrgency', {
                        defaultValue: 'WAS {{level}}',
                        level: (selected.urgency_level ?? '').toUpperCase(),
                      })}
                    </Text>
                  ) : (
                    <StatusBadge status={selected.urgency_level} type="severity" size="medium" />
                  )}
                  <Text style={[as.modalTypeText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                    {selected.alert_type?.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>

                {/* THE POSTER — full-strength 2px ink border: the thing
                    to show across a doorway, in sun or on a dim verandah.
                    An ended advisory loses the strong ink border: it is no
                    longer a thing to show across a doorway. */}
                <View style={[
                  as.poster,
                  { borderColor: selEnded ? colors.border : colors.text, backgroundColor: colors.card },
                  selEnded && as.posterEnded,
                ]}>
                  {selHindi ? (
                    <>
                      <Text
                        style={[as.posterDirective, {
                          color: colors.text,
                          fontSize: directiveSize,
                          lineHeight: Math.round(directiveSize * 1.4),
                        }]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {selHindi}
                      </Text>
                      <Text style={[as.posterEnglish, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {selected.title}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={[as.posterDirective, {
                        color: colors.text,
                        fontSize: directiveSize,
                        lineHeight: Math.round(directiveSize * 1.25),
                      }]}
                      maxFontSizeMultiplier={1.3}
                    >
                      {selected.title}
                    </Text>
                  )}

                  {!!selected.description && (
                    <Text style={[as.posterBody, { color: colors.textSecondary }]}>
                      {selected.description}
                    </Text>
                  )}

                  {selSteps.length > 0 && (
                    <View style={as.stepsBlock}>
                      <Text style={[as.stepsHeading, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {stepsHeading(selSteps.length)}
                      </Text>
                      {selSteps.map((step, i) => (
                        <View key={i} style={as.stepRow}>
                          <View style={[as.stepNum, { borderColor: colors.text }]}>
                            <Text style={[as.stepNumText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                              {i + 1}
                            </Text>
                          </View>
                          <Text style={[as.stepText, { color: colors.text }]}>{step}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {!!selected.contact_phone && (
                    <View style={[as.helplineRow, { borderTopColor: colors.borderStrong }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[as.helplinePhone, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                          {selected.contact_phone}
                        </Text>
                        <Text style={[as.helplineMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                          {selected.contact_person ? `${selected.contact_person} · helpline` : 'health helpline'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => callHelpline(selected.contact_phone!)}
                        accessibilityRole="button"
                        accessibilityLabel={`Call helpline ${selected.contact_phone}`}
                        style={({ pressed }) => [
                          as.callBtn,
                          { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
                        ]}
                      >
                        <Ionicons name="call" size={16} color={colors.onPrimary} />
                        <Text style={[as.callBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                          Call
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {/* The stamp — only with a fetched human name, never faked */}
                  {selected.approval_status === 'approved' && approver && (
                    <View style={{ marginTop: spacing.lg }}>
                      <VerifiedStamp
                        verifierName={approver.name}
                        role={approver.role}
                        timestamp={formatSafeDate(selected.approved_at, 'dd MMM yyyy · HH:mm')}
                      />
                    </View>
                  )}

                  {/* Provenance — disease taxonomy is literally the last line */}
                  <Text style={[as.posterProvenance, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                    {shortAlertNo(selected.id)}
                    {relativeTime(selected.created_at) ? ` · ${relativeTime(selected.created_at)}` : ''}
                    {selected.disease_or_issue ? ` · ${selected.disease_or_issue}` : ''}
                  </Text>
                </View>

                {/* ── Acknowledge zone — the promise ──
                    Hidden once the advisory has ended: "I'll inform my area"
                    is a promise to spread a warning, and there is no longer a
                    warning to spread. Asking for it would be asking a worker
                    to carry stale alarm door to door. */}
                {!selEnded && (selAcked ? (
                  <View
                    style={[as.ackDoneRow, { backgroundColor: colors.successBg }]}
                    accessible
                    accessibilityLabel="Acknowledged. You promised to inform your area."
                  >
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[as.ackDoneText, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                      Acknowledged ✓ · you promised to inform your area
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={acknowledge}
                    disabled={ackSaving}
                    accessibilityRole="button"
                    accessibilityLabel="I've seen this — I'll inform my area"
                    /* P4 — no opacity dimming. "Saving…" is what says it is
                       busy; the label stays at onPrimary-on-primary
                       (6.39 light / 9.29 dark) instead of being composited
                       down to something nobody can read. */
                    style={({ pressed }) => [
                      as.ackBtn,
                      { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
                    ]}
                  >
                    <Text style={[as.ackBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                      {ackSaving ? 'Saving…' : "I've seen this — I'll inform my area"}
                    </Text>
                  </Pressable>
                ))}
                {!selEnded && !!ackError && !selAcked && (
                  <View style={as.ackErrorRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <Text style={[as.ackErrorText, { color: colors.danger }]}>{ackError}</Text>
                  </View>
                )}

                {/* ── BRK-23 — STAND DOWN ──
                    The lifecycle close that did not exist. Before this, the
                    only way to retire a correct-but-finished advisory was to
                    re-review and REJECT it: a label that reads "this was
                    wrong", with no closing note and no way to tell anyone.
                    Shown only to roles the database will actually accept the
                    write from (see STAND_DOWN_ROLES). */}
                {canOfferStandDown && !standDownOpen && (
                  <View style={[as.standDownZone, { borderTopColor: colors.borderLight }]}>
                    {/* P1 — REACH, STATED AS IT ACTUALLY IS.
                        The removal half is total and verified: every other
                        surface filters status='active' (six dashboards,
                        MapTabScreen, HealthMapComponent ×2, AIInsightsPanel),
                        so the alert disappears from all of them.
                        The TELLING half is not. The closing note renders in
                        exactly one place — "Recently ended" on this screen —
                        and no push fires: the only push trigger on this table
                        is trg_push_on_alert_approved, AFTER UPDATE **OF
                        approval_status**, and this write does not touch that
                        column. The old copy claimed "tells everyone who was
                        warned"; nobody is told anything until they come here. */}
                    <Text style={[as.standDownZoneHint, { color: colors.textSecondary }]}>
                      {t('alertStandDown.zoneHint', {
                        defaultValue: 'Is this over? Standing it down removes the alert from the map and from every alert list, everywhere. Your closing note then sits under "Recently ended" on this screen for 14 days.',
                      })}
                    </Text>
                    <Text style={[as.standDownZoneWarn, { color: colors.textSecondary }]}>
                      {t('alertStandDown.zoneReach', {
                        defaultValue: 'No notification is sent. Nobody learns it has ended until they next open this screen, so tell the people who acted on it yourself.',
                      })}
                    </Text>
                    <Pressable
                      onPress={() => { setStandDownError(null); setStandDownOpen(true); }}
                      accessibilityRole="button"
                      accessibilityLabel={t('alertStandDown.openA11y', {
                        defaultValue: 'Stand down this alert — opens a form for the closing note',
                      })}
                      style={({ pressed }) => [
                        as.standDownBtn,
                        { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardHover : colors.surface },
                      ]}
                    >
                      <Ionicons name="checkmark-done-outline" size={18} color={colors.text} />
                      <Text style={[as.standDownBtnText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {t('alertStandDown.openAction', { defaultValue: 'Stand down this alert' })}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* The composer. An in-app decision surface built from tokens —
                    never Alert.alert, which is a no-op on web and cannot carry
                    a required text field anyway. */}
                {canOfferStandDown && standDownOpen && (
                  <View style={[as.standDownForm, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
                    <Text style={[as.standDownFormTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {t('alertStandDown.formTitle', { defaultValue: 'Why is this over?' })}
                    </Text>
                    {/* P1 — "Everyone who saw this alert will read what you
                        write here" was false, and false in the direction that
                        makes an officer stop telling people herself. */}
                    <Text style={[as.standDownFormHint, { color: colors.textSecondary }]}>
                      {t('alertStandDown.formHint', {
                        defaultValue: 'Say what changed — the outbreak is contained, the water tested clean, the source was repaired.',
                      })}
                    </Text>
                    <Text style={[as.standDownFormHint, { color: colors.textSecondary }]}>
                      {t('alertStandDown.formReach', {
                        defaultValue: 'Your note is not sent to anyone. It appears under "Recently ended" on this screen, for 14 days, to people whose area this alert covered — only when they next open it.',
                      })}
                    </Text>
                    <TextInput
                      style={[as.standDownInput, {
                        color: colors.text,
                        backgroundColor: colors.inputBackground,
                        borderColor: standDownError ? colors.inputErrorBorder : colors.inputBorder,
                      }]}
                      value={standDownNote}
                      onChangeText={setStandDownNote}
                      placeholder={t('alertStandDown.formPlaceholder', {
                        defaultValue: 'e.g. No new cases for 14 days. Handpump repaired and retested clean on 28 July.',
                      })}
                      placeholderTextColor={colors.placeholder}
                      multiline
                      numberOfLines={4}
                      maxLength={STAND_DOWN_NOTE_MAX}
                      editable={!standDownSaving}
                      textAlignVertical="top"
                      accessibilityLabel={t('alertStandDown.formInputA11y', {
                        defaultValue: 'Closing note — required, at least {{min}} characters',
                        min: STAND_DOWN_NOTE_MIN,
                      })}
                    />
                    <Text style={[as.standDownCount, { color: noteReady ? colors.textSecondary : colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
                      {noteReady
                        ? t('alertStandDown.countOk', {
                            defaultValue: '{{n}} / {{max}}', n: noteLen, max: STAND_DOWN_NOTE_MAX,
                          })
                        : t('alertStandDown.countShort', {
                            defaultValue: 'A closing note is required — {{more}} more character(s)',
                            more: STAND_DOWN_NOTE_MIN - noteLen,
                          })}
                    </Text>

                    {!!standDownError && (
                      <View style={as.ackErrorRow} accessibilityLiveRegion="polite">
                        <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                        <Text style={[as.ackErrorText, { color: colors.danger }]}>{standDownError}</Text>
                      </View>
                    )}

                    <View style={as.standDownFormBtnRow}>
                      <Pressable
                        onPress={() => { setStandDownOpen(false); setStandDownError(null); }}
                        disabled={standDownSaving}
                        accessibilityRole="button"
                        accessibilityLabel={t('alertStandDown.cancelA11y', { defaultValue: 'Cancel — leave this alert active' })}
                        style={({ pressed }) => [
                          as.standDownCancelBtn,
                          { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardHover : 'transparent' },
                        ]}
                      >
                        {/* Demoted with a token, not with opacity:
                            textTertiary on surface is 5.24 light / 6.71 dark. */}
                        <Text
                          style={[as.standDownCancelText, { color: standDownSaving ? colors.textTertiary : colors.text }]}
                          maxFontSizeMultiplier={1.3}
                        >
                          {t('alertStandDown.cancel', { defaultValue: 'Keep it active' })}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={submitStandDown}
                        disabled={!noteReady || standDownSaving}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !noteReady || standDownSaving }}
                        accessibilityLabel={t('alertStandDown.confirmA11y', {
                          defaultValue: 'Confirm — stand this alert down. No notification is sent.',
                        })}
                        /* P4 — THE STATE THIS FORM OPENS INTO.
                           `opacity: 0.4` on the Pressable composites the fill
                           AND the label against the sheet: measured 1.35 light
                           / 1.44 dark for a 15px/700 label against a 4.5 floor,
                           i.e. the primary action was unreadable from the
                           moment the composer opened until 10 characters were
                           typed. check:contrast cannot see it — it tests raw
                           token pairs and never opacity.
                           Now the not-yet state is a real token pair at full
                           opacity: textSecondary on surfaceVariant, 6.73 light
                           / 7.97 dark, with a border so it still reads as a
                           button rather than as a filled primary. */
                        style={({ pressed }) => [
                          as.standDownConfirmBtn,
                          noteReady
                            ? { backgroundColor: pressed ? colors.primaryPressed : colors.primary }
                            : [as.standDownConfirmWaiting, {
                                backgroundColor: colors.surfaceVariant,
                                borderColor: colors.borderStrong,
                              }],
                        ]}
                      >
                        <Text
                          style={[as.standDownConfirmText, { color: noteReady ? colors.onPrimary : colors.textSecondary }]}
                          maxFontSizeMultiplier={1.3}
                        >
                          {standDownSaving
                            ? t('alertStandDown.confirmSaving', { defaultValue: 'Standing down…' })
                            : t('alertStandDown.confirm', { defaultValue: 'Stand down' })}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          )}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const as = StyleSheet.create({
  container: { flex: 1 },
  /* Light-mode-only shadow — the single recipe */
  cardShadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  /* No status-bar inset here — MainApp already wraps this route in a SafeAreaView. */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  /* -8 pulls the 44dp target back so the glyph optically sits on the 16dp gutter */
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, minHeight: 52,
    borderRadius: radii.md, borderWidth: 1.5, gap: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.lg, minHeight: 44,
    borderRadius: radii.pill, borderWidth: 1.5,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  skeletonWrap: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.xs },
  /* Scope confession strip — the sentence is the whole point of it, so it
     wraps onto as many lines as it needs and the control sits below it
     rather than competing for width at 360dp. */
  scopeStrip: {
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderWidth: 1, borderRadius: radii.md, gap: spacing.sm,
  },
  scopeStripRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  scopeStripText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  /* "From the last list that loaded" — a qualifier over the counts below it */
  scopeStripStale: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.3 },
  revealBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, minHeight: 48, paddingHorizontal: spacing.lg,
    borderWidth: 1.5, borderRadius: radii.md, marginTop: spacing.sm,
  },
  revealBtnText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  /* "outside your area" card caption — shown only on revealed alerts */
  outsideTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
  outsideTagText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  card: {
    borderRadius: radii.md, borderWidth: 1, borderLeftWidth: 3,
    padding: spacing.lg, marginBottom: spacing.md, minHeight: 64,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: spacing.xs },
  severityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
  },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  severityPillText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  cardDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.sm },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardLoc: { fontSize: 13, lineHeight: 18, flex: 1 },
  cardDate: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  /* "acknowledged ✓" list caption — B·02 */
  ackCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.sm },
  ackCaptionText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  // Modal
  /* KeyboardAvoidingView must fill the modal for `padding` to have anything to
     shrink — a zero-height wrapper would silently do nothing on iOS. */
  modalRoot: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '88%', overflow: 'hidden' },
  modalTopRule: { height: 3, width: '100%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1,
  },
  modalHeadTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800', letterSpacing: -0.2 },
  modalHeadSub: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },
  modalPillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  modalTypeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  modalCloseBtn: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },

  /* ── THE POSTER — strong 2px border, calm paper, no fill tricks ── */
  poster: { borderWidth: 2, borderRadius: radii.md, padding: spacing.lg },
  posterDirective: { fontWeight: '700', letterSpacing: -0.3 },
  posterEnglish: { fontSize: 17, lineHeight: 22, fontWeight: '600', marginTop: spacing.xs },
  posterBody: { fontSize: 15, lineHeight: 22, fontWeight: '400', marginTop: spacing.md },
  stepsBlock: { marginTop: spacing.lg },
  stepsHeading: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.sm },
  stepRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginTop: spacing.sm },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNumText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  helplineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderTopWidth: 1, marginTop: spacing.lg, paddingTop: spacing.lg,
  },
  helplinePhone: { fontSize: 20, lineHeight: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
  helplineMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },
  callBtn: {
    minHeight: 48, minWidth: 88, borderRadius: radii.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.lg,
  },
  callBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  posterProvenance: { fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: spacing.lg, fontVariant: ['tabular-nums'] },

  /* ── Acknowledge zone ── */
  ackBtn: {
    minHeight: 56, borderRadius: radii.md, marginTop: spacing.lg,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  ackBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700', textAlign: 'center' },
  ackDoneRow: {
    minHeight: 56, borderRadius: radii.md, marginTop: spacing.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  ackDoneText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  ackErrorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
  ackErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  /* There is deliberately no `btnDisabled: { opacity: 0.4 }` here any more.
     Opacity on a Pressable composites its fill and its label together against
     whatever is behind it, which took the confirm button to 1.35:1 — a control
     nobody can read is not a disabled control, it is a hidden one. Every
     not-yet / busy state on this screen is a token pair at full opacity. */

  /* ── BRK-23 stand-down ──────────────────────────────────────────────
     Calm by design. An ended advisory is the one piece of good news this
     screen ever carries, so it gets the success token and none of the
     alarm furniture: no left severity rule, no 2px ink poster border. */

  /* "Recently ended" list footer */
  standDownSection: { marginTop: spacing.sm },
  standDownHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderTopWidth: 1, paddingTop: spacing.lg, marginTop: spacing.sm,
  },
  standDownHeadText: { fontSize: 15, lineHeight: 22, fontWeight: '800', letterSpacing: -0.2 },
  standDownHeadSub: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.xs, marginBottom: spacing.md },
  standDownCard: {
    borderRadius: radii.md, borderWidth: 1,
    padding: spacing.lg, marginBottom: spacing.md, minHeight: 64,
  },
  standDownTagRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm,
  },
  standDownTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
  },
  standDownTagText: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6 },
  /* The title is demoted: the closing note is the news, not the old alarm */
  standDownCardTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: spacing.xs },
  standDownCardNote: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginBottom: spacing.sm },
  standDownCardNoteMissing: { fontSize: 13, lineHeight: 18, fontWeight: '500', fontStyle: 'italic', marginBottom: spacing.sm },

  /* Poster banner on an ended advisory */
  posterEnded: { borderWidth: 1 },
  endedBanner: {
    borderWidth: 1.5, borderRadius: radii.md,
    padding: spacing.lg, marginBottom: spacing.md, gap: spacing.xs,
  },
  endedBannerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  endedBannerTitle: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: '800', letterSpacing: -0.2 },
  endedBannerBody: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginTop: spacing.xs },
  endedBannerMeta: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  endedBannerFoot: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.xs },

  /* Post-stand-down receipt — calm paper, no success green: "it worked" and
     "nobody was told" are one message and the second half is not good news. */
  doneNotice: {
    borderWidth: 1.5, borderRadius: radii.md,
    padding: spacing.lg, marginBottom: spacing.md, gap: spacing.xs,
  },
  doneNoticeTitle: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '800', letterSpacing: -0.2 },
  doneNoticeBody: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  /* The action + composer */
  standDownZone: { borderTopWidth: 1, marginTop: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },
  standDownZoneHint: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  standDownZoneWarn: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  standDownBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.lg,
    borderWidth: 1.5, borderRadius: radii.md,
  },
  standDownBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  standDownForm: {
    borderWidth: 1.5, borderRadius: radii.md,
    padding: spacing.lg, marginTop: spacing.lg, gap: spacing.xs,
  },
  standDownFormTitle: { fontSize: 17, lineHeight: 24, fontWeight: '800', letterSpacing: -0.2 },
  standDownFormHint: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.sm },
  standDownInput: {
    minHeight: 112, borderWidth: 1.5, borderRadius: radii.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: 15, lineHeight: 22, fontWeight: '500',
  },
  standDownCount: { fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: spacing.xs },
  /* Wraps at 360dp rather than squeezing either target below 48dp */
  standDownFormBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  standDownCancelBtn: {
    flexGrow: 1, flexBasis: 140, minHeight: 56, borderWidth: 1.5, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  standDownCancelText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  standDownConfirmBtn: {
    flexGrow: 1, flexBasis: 140, minHeight: 56, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  /* Not-yet state: still obviously a button, just not yet the primary one.
     The border is what carries that once the teal fill is gone. */
  standDownConfirmWaiting: { borderWidth: 1.5 },
  standDownConfirmText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
});

export { AllAlertsScreen };
export default AllAlertsScreen;
