// =====================================================
// AUTH RECOVERY — in-app password reset via email OTP
// No deep links are configured for this app, so email
// link-based resets are not viable. Instead:
//   1. requestResetCode(email)     → signInWithOtp (emails a numeric code;
//      length is the server-side "Email OTP Length" setting, 6-10 digits)
//   2. verifyResetCode(email,code) → verifyOtp (type: 'email')
//   3. setNewPassword(password)    → updateUser, then sign-out
//
// Runs on an ISOLATED Supabase client with an in-memory,
// never-persisted session. verifyOtp signs the user in —
// doing that on the shared app client would flip App.tsx's
// auth state and drop the user into MainApp mid-flow. The
// isolated client keeps the app's auth flow predictable:
// the main client never sees a session until the user
// signs in normally with their new password.
//
// NOTE (server config): the code only appears in the reset
// email if the "Magic Link" template includes {{ .Token }}
// (Dashboard → Auth → Templates). Its LENGTH is also a
// server setting — Auth → Email OTP Length, 6-10 digits —
// and this project is set to 6, the kindest length for a
// field worker copying it off a phone screen.
// The client still accepts the whole 6-10 range: hard-coding
// one length is what silently truncated the 8-digit codes
// this project used to issue and failed every reset.
// =====================================================
import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Mirrors lib/supabase.ts — kept local because the app client
// module does not export its URL/key, and this client must
// stay a separate instance with its own (in-memory) session.
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ekfdimdlxifatsaubvbh.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_pne9mF-cDQ_IPKJKn8a3AQ_Vm4Aa5x0';

let recoveryClient: SupabaseClient | null = null;

const getRecoveryClient = (): SupabaseClient => {
  if (!recoveryClient) {
    recoveryClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // In-memory only: abandoning the flow leaves nothing behind.
        // Distinct storageKey avoids GoTrue multi-instance clashes
        // with the main app client on web.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'healthdrop-auth-recovery',
      },
    });
  }
  return recoveryClient;
};

// ── Error → message KEY mapping ───────────────────────
// These sentences are the APP's own copy, not server text, and they render on
// a screen that can be in Hindi. Returning finished English here put lines like
// 'Start again from "Forgot password?"' under a button labelled
// "पासवर्ड भूल गए?" — an English instruction pointing at a control the reader
// cannot match. So this module returns i18n KEYS and never a sentence; the
// caller resolves them with t() at RENDER time, which also means the message
// follows the EN/हिन्दी toggle instead of freezing in the language that was
// active when the request failed.
export type RecoveryMessageKey =
  | 'auth.recovery.rateLimit'
  | 'auth.recovery.offline'
  | 'auth.recovery.sendFailed'
  | 'auth.recovery.verifyFailed'
  | 'auth.recovery.updateFailed'
  | 'auth.recovery.sessionExpired'
  | 'auth.recovery.codeIncorrect'
  | 'auth.recovery.samePassword'
  | 'auth.recovery.weakPassword';

export type RecoveryResult = { ok: true } | { ok: false; messageKey: RecoveryMessageKey };

const MSG_RATE_LIMIT: RecoveryMessageKey = 'auth.recovery.rateLimit';
const MSG_OFFLINE: RecoveryMessageKey = 'auth.recovery.offline';
const MSG_SEND_FAIL: RecoveryMessageKey = 'auth.recovery.sendFailed';
const MSG_VERIFY_FAIL: RecoveryMessageKey = 'auth.recovery.verifyFailed';
const MSG_UPDATE_FAIL: RecoveryMessageKey = 'auth.recovery.updateFailed';
const MSG_SESSION_EXPIRED: RecoveryMessageKey = 'auth.recovery.sessionExpired';

const errCode = (error: unknown): string => String((error as any)?.code ?? '');
const errText = (error: unknown): string => String((error as any)?.message ?? error ?? '');
const errStatus = (error: unknown): number => Number((error as any)?.status ?? 0);

const isRateLimited = (error: unknown): boolean =>
  errStatus(error) === 429 ||
  /rate.?limit/i.test(errCode(error)) ||
  /rate limit|too many|security purposes/i.test(errText(error));

const isNetworkish = (error: unknown): boolean =>
  /network|failed to fetch|fetch failed|fetcherror|timed out|timeout|abort|socket|econn/i.test(
    errText(error)
  );

/** Unknown account + shouldCreateUser:false → GoTrue refuses with "Signups not allowed for otp". */
const isUnknownEmail = (error: unknown): boolean =>
  errCode(error) === 'otp_disabled' || /signups not allowed/i.test(errText(error));

/**
 * Step 1 — email a numeric reset code (server decides the length).
 * Anti-enumeration: an unknown email returns the SAME success as a
 * known one; the caller shows "code sent" either way, so this screen
 * never reveals whether an account exists.
 */
export const requestResetCode = async (email: string): Promise<RecoveryResult> => {
  try {
    const { error } = await getRecoveryClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    if (!error || isUnknownEmail(error)) return { ok: true };
    if (isRateLimited(error)) return { ok: false, messageKey: MSG_RATE_LIMIT };
    if (isNetworkish(error)) return { ok: false, messageKey: MSG_OFFLINE };
    return { ok: false, messageKey: MSG_SEND_FAIL };
  } catch (error) {
    return { ok: false, messageKey: isNetworkish(error) ? MSG_OFFLINE : MSG_SEND_FAIL };
  }
};

/**
 * Step 2 — verify the emailed code. On success the RECOVERY client
 * (not the app client) holds a temporary session so the password can
 * be updated in step 3.
 */
export const verifyResetCode = async (email: string, code: string): Promise<RecoveryResult> => {
  try {
    const { data, error } = await getRecoveryClient().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    if (error) {
      if (isRateLimited(error)) return { ok: false, messageKey: MSG_RATE_LIMIT };
      if (errCode(error) === 'otp_expired' || /expired|invalid/i.test(errText(error))) {
        return { ok: false, messageKey: 'auth.recovery.codeIncorrect' };
      }
      if (isNetworkish(error)) return { ok: false, messageKey: MSG_OFFLINE };
      return { ok: false, messageKey: MSG_VERIFY_FAIL };
    }
    if (!data?.session) return { ok: false, messageKey: MSG_VERIFY_FAIL };
    return { ok: true };
  } catch (error) {
    return { ok: false, messageKey: isNetworkish(error) ? MSG_OFFLINE : MSG_VERIFY_FAIL };
  }
};

/**
 * Step 3 — set the new password, then close the temporary recovery
 * session so the user completes the normal sign-in with it.
 */
export const setNewPassword = async (password: string): Promise<RecoveryResult> => {
  const client = getRecoveryClient();
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      if (errCode(error) === 'same_password' || /different from the old/i.test(errText(error))) {
        return { ok: false, messageKey: 'auth.recovery.samePassword' };
      }
      if (errCode(error) === 'weak_password' || /at least|too weak|should contain/i.test(errText(error))) {
        return { ok: false, messageKey: 'auth.recovery.weakPassword' };
      }
      if (/session missing|not authenticated|no user/i.test(errText(error))) {
        return { ok: false, messageKey: MSG_SESSION_EXPIRED };
      }
      if (isRateLimited(error)) return { ok: false, messageKey: MSG_RATE_LIMIT };
      if (isNetworkish(error)) return { ok: false, messageKey: MSG_OFFLINE };
      return { ok: false, messageKey: MSG_UPDATE_FAIL };
    }
    // Password is set — the sign-out is best-effort: even if it fails
    // (e.g. connection dropped right after the update), the in-memory
    // session evaporates with the flow and the reset has succeeded.
    await client.auth.signOut().catch(() => {});
    return { ok: true };
  } catch (error) {
    return { ok: false, messageKey: isNetworkish(error) ? MSG_OFFLINE : MSG_UPDATE_FAIL };
  }
};

/** Best-effort cleanup when the user abandons the flow after verifying a code. */
export const cancelRecovery = (): void => {
  recoveryClient?.auth.signOut().catch(() => {});
};
