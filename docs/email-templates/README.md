# HealthDrop email templates

Bharosa-styled transactional emails for Supabase Auth. One design, verified to hold
in light mode, dark mode, and at 360 px phone width.

## How to install (5 minutes, once)

1. Open **supabase.com/dashboard** → project **HEALTHDROP** → **Authentication** → **Emails**
   (older UI: Authentication → Email Templates).
2. For each row in the table below: open the template, switch the editor to
   **source/HTML** mode, delete what's there, paste the whole file, **Save**.

| Supabase template | Paste this file | Why it matters |
|---|---|---|
| **Magic Link** | `magic-link.html` | **Required** — the in-app password-reset flow sends this. Without `{{ .Token }}` in it, no code ever arrives and reset is dead. |
| Confirm signup | `confirm-signup.html` | New accounts (only sent when email confirmation is enabled). |
| Reset Password | `reset-password.html` | Fallback path; safe to install now. |
| Invite user | `invite-user.html` | For provisioning officials from the dashboard. |
| Change Email Address | `change-email.html` | Email changes from Profile. |

3. Test: in the app tap **Forgot password?**, enter your address, and confirm a
   6-digit code arrives looking like the design.

> Built-in Supabase SMTP is rate-limited to roughly 2 emails/hour — fine for testing,
> not for real users. See `PRODUCTION_READINESS.md` for the SMTP setup step.

## Design notes (why it survives every client)

- **Tables + inline styles.** No flexbox, grid, or external CSS — Outlook and the
  Gmail app strip or ignore those.
- **Dark mode two ways.** `@media (prefers-color-scheme: dark)` covers Apple Mail
  and iOS; `[data-ogsc]` selectors cover Outlook.com's own dark-mode rewriter.
  Clients that support neither still render the light design correctly.
- **No pure white or pure black.** Off-white paper (`#E9EDF0`) and near-black ink
  (`#14211E`) stay readable even in clients that force-invert colours.
- **The teal header band is explicit, not transparent** — dark bands are the one
  thing every dark-mode engine leaves alone, so branding never breaks.
- **Bilingual, Hindi first** on the action line, matching the app's alert rule that
  the directive comes before the taxonomy. Font stack includes Noto Sans Devanagari.
- **Responsive without media-query support**: the card is `width:600` with
  `max-width:600px`, so narrow clients shrink it even if they ignore the query.
- Preheader text (the grey preview line in the inbox list) is set per template.

## Supabase variables used

`{{ .Token }}` (6-digit code) · `{{ .ConfirmationURL }}` (one-tap link) ·
`{{ .Email }}` · `{{ .NewEmail }}`. Keep these exactly as written — they are
substituted server-side.
