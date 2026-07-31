// =====================================================
// LOCALE FORMATTING — the one source of truth for dates,
// times and numbers on screen. Locale follows the app
// language ('hi' → 'hi-IN', everything else → 'en-IN').
//
// Implementation contract:
// - Intl.* first, every call wrapped in try/catch with a
//   date-fns fallback, so Hermes variants shipped without
//   full ICU degrade gracefully instead of crashing.
// - Absolute-short style per the design spec:
//   "14 Jul 09:32" / "14 जुल॰ 09:32" — timestamps render
//   in tabular-nums at the call site, never here.
// - Invalid/absent input returns '' — the caller decides
//   what an honest empty looks like (never a fake zero).
// =====================================================
import { format as dateFnsFormat } from 'date-fns';
import { hi as dateFnsHi } from 'date-fns/locale';

import { getAppLanguage } from './i18n';

export type DateInput = Date | string | number | null | undefined;

type AppLocale = 'en-IN' | 'hi-IN';

const resolveLocale = (): AppLocale =>
  String(getAppLanguage() || 'en').toLowerCase().startsWith('hi') ? 'hi-IN' : 'en-IN';

/** Parse defensively: '' / null / undefined / invalid → null. */
const toDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ── Intl caches ──────────────────────────────────────
// Formatter construction is expensive and these run inside
// FlatList rows; cache per locale+shape. A failed construction
// is never cached, so ICU-less engines just take the fallback
// path every call.
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const nfCache = new Map<string, Intl.NumberFormat>();

const getDateTimeFormatter = (
  locale: AppLocale,
  key: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const cacheKey = `${locale}|${key}`;
  let formatter = dtfCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dtfCache.set(cacheKey, formatter);
  }
  return formatter;
};

/** date-fns fallback — Hindi month names via the bundled `hi` locale. */
const fallbackFormat = (d: Date, pattern: string, locale: AppLocale): string =>
  dateFnsFormat(d, pattern, locale === 'hi-IN' ? { locale: dateFnsHi } : undefined);

// ── Dates & times ────────────────────────────────────

/** Absolute date with year — "14 Jul 2026" / "14 जुल॰ 2026". */
export const formatDate = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return '';
  const locale = resolveLocale();
  try {
    return getDateTimeFormatter(locale, 'date', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return fallbackFormat(d, 'd MMM yyyy', locale);
  }
};

/** Absolute-short timestamp — "14 Jul 09:32" / "14 जुल॰ 09:32". */
export const formatDateTime = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return '';
  const locale = resolveLocale();
  try {
    const date = getDateTimeFormatter(locale, 'dateShort', {
      day: 'numeric',
      month: 'short',
    }).format(d);
    const time = getDateTimeFormatter(locale, 'time', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return `${date} ${time}`;
  } catch {
    return fallbackFormat(d, 'd MMM HH:mm', locale);
  }
};

/** Time of day — "09:32". */
export const formatTime = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return '';
  const locale = resolveLocale();
  try {
    return getDateTimeFormatter(locale, 'time', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return fallbackFormat(d, 'HH:mm', locale);
  }
};

// ── Numbers ──────────────────────────────────────────

/** Indian-system digit grouping without ICU — 123456 → "1,23,456". */
const groupIndian = (n: number): string => {
  const negative = n < 0;
  const [int, frac] = String(Math.abs(n)).split('.');
  if (!/^\d+$/.test(int)) return String(n); // exponent notation etc. — pass through
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
};

/** Data numeral — Indian grouping ("1,23,456"); '' for absent/non-finite. */
export const formatNumber = (n: number | null | undefined): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const locale = resolveLocale();
  try {
    const cached = nfCache.get(locale);
    const formatter = cached ?? new Intl.NumberFormat(locale);
    if (!cached) nfCache.set(locale, formatter);
    return formatter.format(n);
  } catch {
    return groupIndian(n);
  }
};

// ── Relative time ────────────────────────────────────

/**
 * Honest relative time — "just now" / "5m ago" / "3h ago" / "12d ago",
 * falling back to the absolute date past a month ("14 Jul 2026").
 * Hand-rolled (not Intl.RelativeTimeFormat) so the compact English
 * strings the UI already renders stay byte-identical, and Hindi gets
 * the same compact shapes without needing ICU at all.
 */
export const formatRelative = (value: DateInput): string => {
  const d = toDate(value);
  if (!d) return '';
  const hindi = resolveLocale() === 'hi-IN';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return hindi ? 'अभी' : 'just now';
  if (mins < 60) return hindi ? `${mins} मि॰ पहले` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hindi ? `${hours} घं॰ पहले` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return hindi ? `${days} दिन पहले` : `${days}d ago`;
  return formatDate(d);
};
