# HealthDrop Operations Runbook

How to watch, fix, and roll back the running system. Everything here was verified against the live Supabase project (`ekfdimdlxifatsaubvbh`), the deployed edge functions, and the repo as of 2026-07-31. Companion documents: [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) (launch blockers, owner actions) and the [README](../README.md).

## 1. Monitoring cadence

| When | What | Where |
| --- | --- | --- |
| After **every** schema change | Run the Supabase advisors, **both** `security` and `performance` lenses, and triage new findings | Supabase dashboard → Advisors (or MCP `get_advisors`) |
| On any incident | Pull recent logs for the affected service (`api`, `postgres`, `auth`, `edge-function`) | Supabase dashboard → Logs (or MCP `get_logs`; ~1 min window, so reproduce then fetch) |
| After every push to `main` | Confirm the CI run went green and the release has an APK attached | GitHub → Actions → "Build APK on Push"; GitHub → Releases |
| When a build misbehaves | Read the EAS build logs (Gradle output, env var resolution) | expo.dev → project `health-drop` → Builds |
| Weekly (pre-launch) | Skim advisor baseline drift and the push outbox for `failed` rows | Advisors + `push_notification_outbox` |

Known advisor baseline: a backlog of mutable-`search_path` functions, SECURITY DEFINER views, and permissive-policy findings exists and is tracked in PRODUCTION_READINESS.md — the point of the cadence is to stop the baseline growing silently.

## 2. Playbook: false or mistaken outbreak alert

Scenario: an alert went out (or an outbreak signal fired) that turns out to be wrong.

**Who can act** (verified against live RLS on `health_alerts`):

- Update alerts (retract/edit): `super_admin`, `health_admin`, `clinic`
- Delete alerts: `super_admin`, `health_admin`
- Approve/reject in the Approval Queue UI: alerts tab is admin-only; reports also `district_officer`/`clinic`
- Outbreak console status changes: `super_admin`, `health_admin`, `district_officer` (screen-gated)

**Steps:**

1. **Stop the spread.** In the Approval Queue, reject the alert (sets `approval_status = 'rejected'` with a reason) — the public `SELECT` policy only shows approved alerts, so it disappears from every field device's inbox immediately. Equivalently, an admin can `UPDATE health_alerts SET approval_status = 'rejected', rejection_reason = ...` directly. Deleting the row also works but destroys the record; prefer rejection so the audit trail survives.
2. **Dismiss the signal.** If a detector-created outbreak row exists, open the Outbreak Console and set its status to `resolved` with a note explaining the false positive. `outbreaksService.updateStatus` stamps `resolved_by`/`resolved_at` and appends an audit-stamped response note; reopening later honestly clears the resolved stamps.
3. **Tell the people who saw it.** The retraction itself does **not** push (only alert *inserts* trigger push — verified: `trg_push_on_alert_created` is `AFTER INSERT`; there is no update trigger). Send a correction advisory:
   - Post a new low-urgency advisory alert ("Earlier alert for X was withdrawn — no action needed"). As a new insert it flows through the normal DB trigger pipeline and reaches the same district audience; or
   - Have a `super_admin`/`health_admin` call the `dispatch_push_notification` RPC (role-checked server-side) for a targeted manual push without creating an alert row.
4. **Afterwards:** check `push_notification_outbox` to confirm the correction was delivered (section 3), and note the root cause (bad report? threshold too sensitive?) against the outbreak row's response notes.

## 3. Push pipeline anatomy

```text
DB event ──► trigger ──► notify_users_push() ──► push_notification_outbox (pending rows)
                                   │
                                   └─ pg_net POST ──► push-notifications edge function
                                                            │  (only sends tokens that have
                                                            │   a PENDING outbox row)
                                                            ▼
                                                     Expo push API ──► device
                                                            │
                                       tickets written back via update_push_outbox_status()
```

Verified live components:

- **Triggers:** `trg_push_on_alert_created` (AFTER INSERT on `health_alerts`), `trg_push_on_report_approved` (AFTER UPDATE OF `approval_status` on `disease_reports`, fires only on the transition to `approved`, targets the reporter), `trg_notify_on_unsafe_water` (AFTER INSERT on `water_quality_reports` for `unsafe`/`critical` — writes in-app `notifications` rows for officers/clinic/admin and pushes to the district's officers).
- **`notify_users_push()`** (SECURITY DEFINER): resolves target tokens from `user_push_tokens` plus the legacy `profiles.expo_push_token`, filtered by user/role/district; inserts one **pending** outbox row per token; then calls the edge function via `pg_net.http_post`. Errors never block the parent transaction (they downgrade to warnings).
- **`push-notifications` edge function** (deployed v2, `verify_jwt` on): any project JWT can invoke it, but it **refuses to send to any token without a pending `push_notification_outbox` row** — rows only the trusted DB layer creates. Callers can therefore only accelerate DB-authorized deliveries, never relay arbitrary pushes or probe tokens. Sends in chunks of 100, then records Expo ticket results via `update_push_outbox_status` (which only touches pending rows less than 1 hour old). Note: the repo copy at `supabase/functions/push-notifications/index.ts` is the older v1 without this outbox gate — the deployed version is authoritative until the file is synced.
- **`dispatch_push_notification()` RPC:** manual sends; requires caller role `super_admin`/`health_admin` (checked server-side).
- **Client side:** `src/services/pushSetup.ts` creates the Android channels the pipeline targets (`health-alerts` MAX importance, `report-updates`, `default`) at app start; `App.tsx` registers the Expo token after login (physical devices, not Expo Go).

**The outbox is the audit trail.** Every attempted push is a row in `push_notification_outbox` with `status` (`pending` / `sent` / `failed` / `skipped`), `expo_ticket_id`, `error_message`, `attempt_count`, trigger type and source-row reference. Debugging "the push never arrived" starts there: a missing row means the trigger/targeting never fired; a stuck `pending` row means the edge function was never reached (check pg_net and edge-function logs); a `failed` row carries Expo's error message.

## 4. Backup posture

**There are currently no database backups.** The project runs on the Supabase free tier: no automated backups, no PITR. A destructive migration or trigger bug is unrecoverable today. This is a known launch blocker with an owner decision attached (upgrade to Pro for daily backups, plus an interim nightly-dump workflow) — see item 38 in [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md). Until that lands, treat every `apply_migration` against the live project as irreversible and prefer additive, idempotent SQL.

## 5. Release rollback

- Every CI build publishes its APK to **GitHub Releases** (`v<version>-build.<n>`); previous releases keep their APKs, so any older build remains downloadable forever.
- `versionCode` is the **git commit count** — strictly monotonic. Android will refuse to *update* to an older APK, so a rollback on a device means **uninstall, then install the older APK** (not an in-place update). Uninstalling wipes local app data, including any unsynced offline queue — have the user open the Sync Outbox and sync first if at all possible.
- The cleaner path is **roll forward**: revert the offending commit on `main` and let CI ship a new, higher-versioned APK that users can install as a normal update.
- `[skip build]` in a commit message suppresses the CI build (doc-only changes are auto-skipped via `paths-ignore`).

## 6. Secrets — where they live, what never enters the repo

| Secret | Lives in | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` | Local `.env`; EAS environment (`preview` + `production`) | Publishable key — client-safe by design; RLS is the security boundary |
| `EXPO_TOKEN` | GitHub repo secret | Lets Actions run EAS builds |
| `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`) | Supabase Edge Function secrets | Powers `openrouter-proxy`; the client-side `EXPO_PUBLIC_OPENROUTER_*` fallback should be retired once this is set |
| `EXPO_ACCESS_TOKEN` (optional) | Supabase Edge Function secrets | Authenticated Expo push from `push-notifications` |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | Auto-injected into edge functions by Supabase | Never copy the service-role key anywhere else |

**Never commit:** the service-role key, any OpenRouter/API key, `SUPABASE_DB_URL`/database passwords, or a real `.env`. `.env` is gitignored; `.env.example` carries placeholders only. History note: earlier commits of this repo did leak keys — rotation and a history purge are open owner actions in PRODUCTION_READINESS.md; assume anything ever committed is compromised until rotated.

Auth email note: the in-app password reset (email OTP) only works if the Supabase **Magic Link** email template includes `{{ .Token }}`, and the built-in SMTP is rate-limited to a couple of emails per hour — custom SMTP is the production path (owner action).
