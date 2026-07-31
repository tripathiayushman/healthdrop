# HealthDrop

**Rural disease-outbreak and water-quality surveillance, built on trust.**

HealthDrop is a cross-platform (Android-first) app that connects the people who see public-health problems first — ASHA workers, volunteers, clinics — with the district officers and health admins who can act on them. It is built for low-connectivity rural India: reports work offline, alerts read like posters, and every signal passes through a human before it reaches the public.

React Native (Expo SDK 54) + Supabase (Postgres, RLS, Edge Functions). TypeScript throughout.

> **Status: pre-launch.** The app is feature-complete for its pilot scope but not yet in the field. Launch blockers — including owner-only actions like secret rotation, database backups, and a hosted privacy policy — are tracked item-by-item in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## The trust loop

Surveillance systems fail when field workers stop believing their reports matter. HealthDrop closes the loop at every step:

1. **Report** — a worker files a disease or water-quality report, online or offline (queued in the Sync Outbox).
2. **Human approval** — clinic / district officer / admin verifies it in the Approval Queue; rejections carry a reason and can be refiled from My Submissions.
3. **Signal** — approved disease reports feed a DB-trigger outbreak detector; officers review signals in the Outbreak Signal screen and manage confirmed ones in the Outbreak Console (with audit-stamped status notes).
4. **Alert** — approved health alerts push to affected districts and render as bilingual posters; field staff acknowledge ("I'll inform my area"), and the ack count shows officers their real-time reach.
5. **Promise** — a flagged water source is a promise: flag → fix → retest → reopen, tracked as a visible stepper in Water Sources.
6. **Digest** — officers share a weekly district summary to WhatsApp (or PDF) so the work is seen.

## Features by role

Six roles, routed to role-specific dashboards (`components/dashboards/DashboardRouter.tsx`); screen access is enforced in `components/MainApp.tsx` and by Postgres RLS.

**Every role gets:**

- Role dashboard with customizable widgets, plus Map, Reports, Campaigns, and Profile tabs
- All Alerts inbox with poster view and alert acknowledgements
- Water Sources registry with the promise-loop stepper
- District Health Score, My Submissions, and the Sync Outbox (offline queue inspector)
- AI chatbot and AI insights panel (optional — requires OpenRouter config)
- Dark mode, English/Hindi language toggle, and password recovery via email OTP

**On top of that:**

| Role | Adds |
| --- | --- |
| **Volunteer** | View-and-acknowledge role; no record creation |
| **ASHA worker** | Create disease reports, water-quality reports, and campaigns (offline-first); campaign intelligence |
| **Clinic** | Create disease/water reports; Approval Queue (verify/approve/reject); escalation monitoring; weekly summary; admin management |
| **District officer** | All report/campaign/alert creation; Approval Queue; Outbreak Signal review and Outbreak Console; escalation monitoring; weekly WhatsApp digest; campaign intelligence |
| **Health admin** | Everything above plus user management and alert approvals |
| **Super admin** | Every screen, including user management and pending-alert approvals |

## Tech stack

| Layer | Technology |
| --- | --- |
| App | Expo SDK 54 · React Native 0.81 · React 19 · TypeScript 5.9 |
| Design system | "Bharosa" tokens via `lib/ThemeContext.tsx` · NativeWind 4 (Tailwind 3.4) · react-native-reusables-style primitives in `components/ui/` |
| Backend | Supabase — Postgres + RLS, Auth, Edge Functions (`openrouter-proxy`, `push-notifications`), pg_net trigger-driven push |
| Offline | AsyncStorage sync queue + NetInfo (`src/services/offlineSync/`) |
| Push | expo-notifications + Expo push service; fan-out happens server-side from DB triggers |
| AI (optional) | OpenRouter chat completions, proxy-first through the `openrouter-proxy` edge function |
| i18n | i18next / react-i18next — English + Hindi (phase 1) |
| Maps | Leaflet 1.9 inside react-native-webview |
| Charts / PDF | react-native-chart-kit + react-native-svg · expo-print + expo-sharing |
| CI/CD | GitHub Actions → EAS Build → GitHub Releases |

## Getting started

```bash
npm install
cp .env.example .env    # then fill in your values
npx expo start
```

`.env` (see [.env.example](.env.example) for the commented version):

- **Required:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` (the `sb_publishable_...` key; the legacy `EXPO_PUBLIC_SUPABASE_ANON_KEY` name still works as a fallback)
- **Optional (AI):** `EXPO_PUBLIC_OPENROUTER_API_KEY`, `EXPO_PUBLIC_OPENROUTER_MODEL` — only used as a direct-API fallback when the `openrouter-proxy` edge function isn't configured; AI panels degrade gracefully without them
- **Optional (flag):** `EXPO_PUBLIC_OFFLINE_SYNC_ENABLED` (default `true`)

Run on a device with Expo Go or a development build. Note: remote push tokens do not register in Expo Go on this SDK — use an APK build to test push.

## Builds & releases

CI lives in [.github/workflows/](.github/workflows/):

- **`build-on-push.yml`** — every push to `main` (except changes only to Markdown, `database_structure/`, or `mesc/`) builds an Android APK on EAS (`preview` profile) and publishes a GitHub Release tagged `v<version>-build.<n>` with the APK attached. Include `[skip build]` in the commit message to skip. Superseded queued builds are cancelled.
- **`versionCode` = git commit count** — strictly increasing across all builds, so Android always accepts the newest APK as an update.
- **`prepare-release.yml`** (manual dispatch) bumps `package.json`/`app.json` and pushes a `v*` tag; **`build-android-release.yml`** builds and releases from that tag.

Manual build: `eas build --platform android --profile preview` (`preview` = APK, `production` = app-bundle; see `eas.json`).

CI needs the `EXPO_TOKEN` repo secret, and the app's `EXPO_PUBLIC_*` variables must be set in the EAS environment — builds do not read `.env`. Operational details (rollback, monitoring, push pipeline) are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Project structure

```text
App.tsx                  # auth/session shell, offline-profile cache, push registration
index.ts                 # Expo entry
components/
  AuthScreen.tsx         # sign in / sign up / OTP password reset
  MainApp.tsx            # tab shell, role-gated screen routing
  dashboards/            # one dashboard per role + DashboardRouter
  screens/               # 19 sub-screens (alerts, approvals, outbreaks, water, digest, ...)
  forms/                 # disease / water / campaign / alert forms
  shared/                # buttons, inputs, map, badges, tables
  ai/                    # AIChatbot, AIInsightsPanel
  charts/                # TrendChart
  ui/                    # react-native-reusables-style primitives
lib/
  supabase.ts            # client (env-driven)
  ThemeContext.tsx       # Bharosa design tokens (source of truth)
  i18n/                  # i18next setup + en/hi locales
  services/              # data services (reports, alerts, outbreaks, digest, ...)
src/
  services/offlineSync/  # queue, sync service
  services/pushSetup.ts  # Android channels + foreground handler
  hooks/ · components/   # useLocation, LocationField
supabase/functions/      # openrouter-proxy, push-notifications edge functions
database_structure/      # SQL schema, RLS, triggers, outbreak detection, push pipeline
scripts/                 # sync-version.cjs (CI version stamping)
types/ · utils/ · assets/
.github/workflows/       # CI (see Builds & releases)
docs/                    # OPERATIONS.md runbook
```

## Design system — "Bharosa"

Calm paper and ink, one action teal, flat and printable. Color is spent like money: severity and water-quality ladders, sync truths, and a reserved AI violet appear only when they mean something.

- **Tokens live in `lib/ThemeContext.tsx`** — semantic colors (light + dark), a strict 4pt `spacing` scale, and `radii`. Theme keys are never renamed.
- NativeWind (`global.css`, `tailwind.config.js`) and the `components/ui/` primitives are available alongside token-driven styles.
- [DESIGN_SPEC.md](DESIGN_SPEC.md) is the **previous** design iteration ("Prakash") and is kept for its still-valid craft rules; Bharosa superseded it and its full canvas is maintained outside the repo (Claude Design). When the two disagree, `ThemeContext.tsx` and shipped screens win.

## Languages

English is the default UI language. **Hindi (phase 1)** covers the worker-facing chrome and is selectable in Profile → Language. The current Hindi strings are machine-drafted and awaiting native-speaker review (an open item in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)) — treat them as beta.

## Contributing

- **Type gate:** `npx tsc --noEmit` must pass before a commit.
- **Token discipline:** no hex literals in component files — every color comes from `useTheme()`; severity/water colors resolve through their helper functions; spacing and radii from the exported scales.
- **Four-state data regions:** every data region renders loading (skeleton twin), error, empty (the "quiet zero"), and content. No blank zeros, no silent `catch {}`, no conflating empty with error.
- **Schema changes:** commit the SQL to `database_structure/` and run the Supabase advisors afterwards (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).
- Doc-only commits are already excluded from CI builds; use `[skip build]` for anything else that shouldn't ship an APK.

## Further reading

- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) — the verified launch plan (59 items) and outstanding owner actions
- [ROADMAP_FEATURES.md](ROADMAP_FEATURES.md) — ranked feature backlog
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — operating runbook: monitoring, incident playbooks, push pipeline, rollback, secrets

## License

[MIT](LICENSE)
