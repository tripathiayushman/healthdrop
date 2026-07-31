# HealthDrop Production Readiness Plan

_59 items, every one verified against the live repo and database by the cross-check fleet (2026-07-31)._
_Owner = requires dashboard/account access or a policy decision only the owner can make._

## CRITICAL (16)

### 1. Fix profiles RLS privilege escalation: any user can self-promote to super_admin
**Status:** DONE — migration applied live (profiles privilege escalation closed) · **Effort:** M · **Doable by agent:** yes

VERIFIED LIVE (pg_policies): legacy permissive policies 'Allow users to manage own profile' and 'Users manage own profile' (FOR ALL, WITH CHECK auth.uid()=id only) and 'profiles_update' (UPDATE with NO with_check) OR together with profiles_self_update, defeating its role-pinning WITH CHECK — any authenticated user can PATCH their own row to role='super_admin' via PostgREST. profiles_insert_policy is WITH CHECK (auth.uid()=id OR super_admin) with no role restriction, so the 3-role limit in AuthScreen SIGNUP_ROLES is client-side only. 'profiles_delete' and 'profiles_update' still reference the extinct role='admin'. Merged duplicate of the onboarding-dimension item covering the same holes.

- Write database_structure/FIX_PROFILES_PRIVILEGE_ESCALATION.sql: DROP legacy policies 'Allow users to manage own profile', 'Users manage own profile', 'Users can view own profile', 'Users can insert their own profile', 'profiles_update', 'profiles_delete' — leaving one policy per command
- Keep profiles_self_update as the only self-UPDATE policy but extend its WITH CHECK to also pin is_active and supervisor_id (via subselect / SECURITY DEFINER helpers to avoid recursion); add an explicit WITH CHECK to profiles_super_admin_update
- Replace profiles_insert_policy: WITH CHECK ((auth.uid() = id AND role IN ('clinic','asha_worker','volunteer')) OR get_my_role() = 'super_admin')
- Apply to the live DB via Supabase MCP apply_migration and commit the SQL file
- Verify with a volunteer JWT that UPDATE profiles SET role='super_admin' fails with 42501, and that signup, ProfileScreen edit, and UserManagementScreen role change still work

_Files: database_structure/FIX_PROFILES_PRIVILEGE_ESCALATION.sql, database_structure/FIX_PROFILES_RLS_RECURSION.sql, components/AuthScreen.tsx, components/screens/UserManagementScreen.tsx_

### 2. Move push fan-out to the deployed edge function and stop exposing expo_push_token via profiles
**Status:** DONE — user_push_tokens table + claim RPC; client fan-out deleted; dispatcher v2 outbox-gated · **Effort:** L · **Doable by agent:** yes

VERIFIED: lib/services/notifications.ts sendAlertPushNotifications (lines 209-294) and components/forms/AlertForm.tsx sendPushNotifications (lines 202, 239) SELECT expo_push_token,role,district from profiles on the client and POST directly to exp.host — silently no-ops for field roles under RLS, pulls every reachable user's token for admin roles, and double-sends alerts because trg_push_on_alert_created already fans out. supabase/functions/push-notifications/index.ts (read in full) accepts arbitrary {tokens,title,body} from ANY valid user JWT with zero role check. CORRECTION: dispatch_push_notification() already accepts super_admin/health_admin (verified live) — only the 'Admins can read push outbox' SELECT policy still checks the extinct role='admin'.

- Delete both client fan-out paths; let alert pushes flow only through the DB trigger -> notify_users_push -> push-notifications edge function pipeline
- Fix the 'Admins can read push outbox' policy to super_admin/health_admin; route the AI-alert-acceptance push through dispatch_push_notification() instead of client fetch
- Harden supabase/functions/push-notifications/index.ts: honor raw token lists only when the bearer equals SUPABASE_SERVICE_ROLE_KEY; for user JWTs resolve the caller with auth.getUser(), require super_admin/health_admin, and resolve tokens server-side from targeting params
- Migrate expo_push_token out of profiles into user_push_tokens (user_id PK, token, updated_at) with owner-only RLS + service-role access; update lib/services/users.ts registerExpoPushToken (line 276+) and notify_users_push(), then drop profiles.expo_push_token
- Redeploy via MCP deploy_edge_function and update database_structure/PUSH_NOTIFICATIONS.sql to match

_Files: lib/services/notifications.ts, components/forms/AlertForm.tsx, lib/services/users.ts, supabase/functions/push-notifications/index.ts, database_structure/PUSH_NOTIFICATIONS.sql_

### 7. Publish a real DPDP-grounded privacy policy: hosted URL (Play hard requirement) + in-app notice
**Status:** DEFERRED — no longer a store gate; an in-app privacy notice replaces the hosted URL · **Effort:** M · **Doable by agent:** no (owner)

VERIFIED: the only policy text is the PRIVACY_TEXT constant in ProfileScreen.tsx (line 59) rendered in a modal — generic bullets, no hosted URL for the Play Console, and it understates real flows (AI chat to OpenRouter via gemini.ts, expo push token in profiles, GPS coordinates to Nominatim as reverse-geocode fallback — AuthScreen.tsx:57 and src/hooks/useLocation.ts:113). Merged from two overlapping proposals (DPDP notice + Play privacy URL); the separate 'Nominatim disclosure' item was PRUNED as already done — AuthScreen line 597 already shows 'Your location is sent to OpenStreetMap...', both call sites already send an identifying User-Agent, and native geocoding is already tried first — its only residual (mention Nominatim in the notice) lives here.

- Draft the policy from actual data flows: signup PII (full_name, email, phone, role, district, state, pincode), transient fine location for district autofill (coordinates not persisted; OpenStreetMap Nominatim as fallback processor), disease/water report contents, Expo push token, AI chat messages relayed to OpenRouter, Supabase as processor, retention windows, deletion mechanism, grievance-contact placeholder for the owner
- Host at a stable URL: static privacy.html included in the web deploy or GitHub Pages from this repo
- Replace/augment the hardcoded PRIVACY_TEXT modal with the canonical content and a Linking.openURL to the hosted page so app and store policy never diverge; add a one-line notice with link above the signup button in AuthScreen
- Owner: fill legal/grievance contact details and enter the URL under Play Console -> App content -> Privacy policy

_Files: components/screens/ProfileScreen.tsx, components/AuthScreen.tsx, lib/services/gemini.ts, src/hooks/useLocation.ts_

### 8. Build account deletion: in-app flow + delete-account edge function + web deletion-request page (Play blocker)
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: no delete-account code exists anywhere in components/ or lib/services; ProfileScreen only claims 'You can request data deletion at any time' with no mechanism. Google Play requires in-app deletion plus a web deletion-request URL for apps with account creation (AuthScreen.signUp exists), and DPDP expects erasure. Merged from two overlapping proposals (DPDP deletion + Play deletion item).

- Create supabase/functions/delete-account: verify caller JWT, then use the auto-injected SUPABASE_SERVICE_ROLE_KEY to anonymize the profile (incl. push token), delete notifications, and call auth.admin.deleteUser(uid); deploy via MCP to project ekfdimdlxifatsaubvbh
- Decide report handling explicitly: anonymize reporter_id on approved disease/water reports so surveillance statistics survive erasure (document in the function)
- Add a 'Delete account' entry in ProfileScreen settings with typed-confirmation; on success signOut, purge AsyncStorage and the offline sync queue, return to AuthScreen
- Add a static web deletion-request page (pairs with privacy.html); owner enters its URL in Play Console Data safety -> Data deletion

_Files: supabase/functions/delete-account/index.ts, components/screens/ProfileScreen.tsx, lib/services/users.ts, src/services/offlineSync/SyncQueue.ts_

### 11. Global error capture: ErrorBoundary + native/web fatal handlers + client_error_logs table
**Status:** DONE — ErrorBoundary + global JS error hooks · **Effort:** M · **Doable by agent:** yes

VERIFIED: no ErrorBoundary/componentDidCatch/ErrorUtils exists anywhere in the codebase and package.json has no crash-reporting dependency — one render crash white-screens the app in the field with zero trace, and queued offline reports become unreachable until relaunch. Merged duplicate (reliability ErrorBoundary item + operations client_error_logs item): one boundary implementation, one logging sink; Sentry (separate item) later wraps rather than replaces this.

- Create components/shared/AppErrorBoundary.tsx: class component with getDerivedStateFromError + componentDidCatch, plain-styled recovery screen (no ThemeContext dependency) with 'Try again' remount-key reset and a note that saved offline reports are safe on the phone
- Wrap <AppContent /> in App.tsx (inside SafeAreaProvider, outside ThemeProvider); add a second boundary around the screen-switch region in MainApp.tsx keyed by currentScreen so one crashing screen falls back to home instead of killing the shell
- Register ErrorUtils.setGlobalHandler on native and window.onerror + unhandledrejection on web in lib/errorReporting.ts, initialized in App.tsx before auth init
- Migration: client_error_logs table (message, stack truncated ~4KB, error_hash dedup, component_stack, platform, app_version, role, district — no email/name PII); RLS: INSERT authenticated, SELECT super_admin/health_admin; commit to database_structure/CLIENT_ERROR_LOGS.sql
- lib/services/errorLogs.ts: fire-and-forget insert with AsyncStorage buffer for offline crashes and error_hash throttling to survive crash loops; add a 'Client errors (24h)' tile to SuperAdminDashboard
- Manually test: throw inside a dashboard render and inside ThemeProvider to confirm both recovery paths

_Files: components/shared/AppErrorBoundary.tsx, App.tsx, components/MainApp.tsx, lib/errorReporting.ts, lib/services/errorLogs.ts, database_structure/CLIENT_ERROR_LOGS.sql, components/dashboards/SuperAdminDashboard.tsx_

### 12. Create the Android notification channels the push pipeline already targets, and add a foreground notification handler
**Status:** DONE — Android notification channels + foreground handler · **Effort:** S · **Doable by agent:** yes

VERIFIED GAP: supabase/functions/push-notifications/index.ts sends channelId 'health-alerts' / 'report-updates' / 'default' (lines 111-113, 179) but setNotificationChannelAsync appears nowhere in the client — on Android 8+ notifications posted to a never-created channel are silently dropped, so outbreak pushes may never display. No Notifications.setNotificationHandler exists either, so foreground pushes show nothing. CORRECTION: android/ is gitignored (a local prebuild artifact), not committed — no prebuild-sync caveat needed beyond the next EAS build picking up app.json.

- Create src/services/notifications/setupNotifications.ts that (on Android, skipping Expo Go) calls setNotificationChannelAsync for 'health-alerts' (importance MAX, sound, strong vibration), 'report-updates' (DEFAULT), and 'default' (DEFAULT)
- Call it once at app start in App.tsx — not gated on login — so channels exist before the first push arrives
- Add Notifications.setNotificationHandler so foreground pushes display (banner + sound, no badge)
- Add addNotificationResponseReceivedListener reading data from the push payload and at minimum opening the All Alerts screen via a callback passed to MainApp
- Add the expo-notifications config plugin (white monochrome small icon + brand color) to app.json so alerts don't render a grey square (coordinates with the app.json cleanup item)
- Verify end-to-end: insert a test health_alert row on the live project and confirm the device shows the notification on the health-alerts channel with sound (needs a new EAS build)

_Files: src/services/notifications/setupNotifications.ts, App.tsx, components/MainApp.tsx, app.json, supabase/functions/push-notifications/index.ts_

### 13. Hydrate a cached profile on offline cold-start so logged-in field users are not dumped to the login screen
**Status:** DONE — offline profile cache on cold start · **Effort:** M · **Doable by agent:** yes

VERIFIED BUG: App.tsx fetchProfile does a network query with no offline fallback; on a cold start without signal the catch (line 189) leaves profile=null and line 274 renders AuthScreen despite a valid persisted session — an ASHA worker offline in the field is locked out of the app including the Sync Outbox built precisely for that situation. Each fetch also carries built-in 500ms/1000ms sleeps (line 114) that slow every cold start.

- On every successful profile fetch in App.tsx, persist the normalized profile JSON to AsyncStorage under '@healthdrop/profile/<userId>'
- In fetchProfile's catch and after retries exhaust on network-type errors, hydrate the cached profile for session.user.id; if found, render MainApp with a 'working offline' banner state
- Only sign out for a confirmed server-side missing profile (PGRST116 / 0 rows while online) — never on fetch/timeout errors; distinguish with error codes + NetInfo
- Hydrate cache-first immediately (skip the retry sleeps when a cached profile exists) and refresh from network in the background — also improves cold-start time
- Clear the cached profile in handleSignOut and on the deactivated-account path so shared devices don't leak the previous user's profile
- Test matrix: cold start online, airplane-mode with cache, airplane-mode without cache (AuthScreen), deactivated user online

_Files: App.tsx, components/MainApp.tsx_

### 27. i18n foundation: i18next + react-i18next with AsyncStorage-persisted language picker (no native module)
**Status:** DONE — i18next wired app-wide, Hermes-safe, persisted language picker · **Effort:** M · **Doable by agent:** yes

VERIFIED: package.json has no i18n dependency and no t()/useTranslation usage exists — the app is 100% English with hundreds of hardcoded <Text> nodes. i18next + react-i18next is pure JS (works on Hermes/RN 0.81, Expo Go, react-native-web, no config plugin or rebuild). A manual picker beats expo-localization for ASHA users whose phones often run English OS locale; bundled require()'d JSON locales are inherently offline-capable.

- npm install i18next react-i18next
- Create lib/i18n/index.ts: init with resources { en, hi } from bundled JSON, fallbackLng 'en'
- Create lib/i18n/locales/en.json with namespaces per surface (common, forms, dashboard, sync, auth, profile)
- Add a LanguageProvider mirroring the existing ThemeContext AsyncStorage pattern; read '@healthdrop/language' before first render to avoid an English flash
- Wrap App.tsx tree with LanguageProvider next to ThemeProvider
- Add a 'Language / भाषा' row in ProfileScreen's Preferences section beside the Dark Mode toggle
- Document the rule (translations ship bundled in the APK, never fetched) in an I18N.md

_Files: package.json, lib/i18n/index.ts, lib/i18n/locales/en.json, lib/i18n/locales/hi.json, App.tsx, components/screens/ProfileScreen.tsx_

### 28. String extraction phase 1: field-worker surfaces (forms, shared dashboard kit, ASHA/volunteer path, sync screens)
**Status:** DONE — phase 1: tabs, report sheet, disease wizard, sync outbox · **Effort:** L · **Doable by agent:** yes

VALID (file inventory verified: all four forms, DashboardShared, Asha/Volunteer dashboards, MainApp, AuthScreen, SubmissionModal, MySubmissionsScreen, SyncOutboxScreen exist). The users who cannot read English are field workers, not admins — convert their surfaces first. Critical detail confirmed in DiseaseReportForm (lines 111-152): chip option arrays must translate label while keeping value as the canonical English string stored in Supabase, or outbreak-detection grouping by disease_name breaks.

- Convert the four components/forms/ files to t(): labels, placeholders, section eyebrows, validation messages, modal messages, and option-array label fields (never value fields)
- Convert DashboardShared.tsx: SyncPebble label AND a11yLabel strings, ErrorCard, EmptyState copy, section headers
- Convert MainApp tab labels + create-menu, AuthScreen, SubmissionModal, MySubmissionsScreen, SyncOutboxScreen, AshaWorkerDashboard, VolunteerDashboard
- Extract every accessibilityLabel through t() in the same pass — otherwise TalkBack keeps speaking English to Hindi users
- Add scripts/check-hardcoded-strings.js failing CI on new raw literals inside <Text> in converted files
- Populate en.json as extraction proceeds; hi.json mirrors keys with English fallback until translated

_Files: components/forms/DiseaseReportForm.tsx, components/forms/WaterQualityReportForm.tsx, components/forms/AlertForm.tsx, components/forms/CampaignForm.tsx, components/dashboards/DashboardShared.tsx, components/dashboards/AshaWorkerDashboard.tsx, components/dashboards/VolunteerDashboard.tsx, components/MainApp.tsx, components/AuthScreen.tsx, components/shared/SubmissionModal.tsx, components/screens/MySubmissionsScreen.tsx, components/screens/SyncOutboxScreen.tsx, lib/i18n/locales/en.json_

### 29. Hindi locale pack with reviewed health glossary and dual-script disease names
**Status:** DONE — Hindi pack shipped and natively reviewed by the owner · **Effort:** M · **Doable by agent:** no (owner)

VALID: a machine-drafted hi.json is 90% of the work but health terminology errors are dangerous in outbreak surveillance; disease chips should render dual-script ('हैज़ा (Cholera)') because ASHA training materials and clinic paperwork use English disease names, and the stored value must stay English (verified: outbreak grouping keys on disease_name). Alert-directive strings carry the highest translation-quality bar. Needs a native Hindi speaker with health-domain familiarity — not fully agent-completable.

- Agent drafts lib/i18n/locales/hi.json for all phase-1 keys plus GLOSSARY.md mapping every disease name, severity level, water-quality state, and alert directive to its chosen Hindi term with rationale
- Render commonDiseases chips dual-script via per-disease keys while storing the English value in disease_reports.disease_name
- Owner/process: native Hindi speaker (ideally an ASHA supervisor) reviews GLOSSARY.md and alert-directive strings before Hindi ships beyond a beta flag
- Ship Hindi behind the ProfileScreen picker only (no auto-detection)

_Files: lib/i18n/locales/hi.json, lib/i18n/GLOSSARY.md, components/forms/DiseaseReportForm.tsx_

### 38. Database backups: currently zero recoverability for a live public-health dataset
**Status:** DONE — encrypted daily pg_dump via CI (Pro plan declined); verified working · **Effort:** S · **Doable by agent:** no (owner)

VALID with one correction: the proposal claimed all domain tables are empty — live counts are 6 profiles, 4 disease reports, 4 alerts, 5 campaigns, so real (if small) data ALREADY exists unprotected, which strengthens the urgency. Free-tier Supabase takes no automated backups and no PITR posture exists; a bad migration or the known auto_approve_*/trigger quirks corrupting data is unrecoverable.

- Owner decision: upgrade to Pro (daily backups; PITR add-on) — recommended before first real field data; document the decision
- Until then, commit .github/workflows/db-backup.yml: nightly supabase db dump against a DATABASE_URL repo secret, uploaded as an encrypted artifact with 30-day retention (lands disabled; owner adds the secret to activate)
- Document the restore procedure (psql into a fresh project, re-point EXPO_PUBLIC_SUPABASE_URL) in OPERATIONS.md
- Enable PITR when daily active reporting starts — outbreak data loss tolerance is near zero

_Files: .github/workflows/db-backup.yml, OPERATIONS.md_

### 39. False-outbreak-alert incident playbook + alert retraction capability
**Status:** DONE — playbook in docs/OPERATIONS.md · **Effort:** M · **Doable by agent:** yes

VERIFIED LIVE: push_on_alert_created fires notify_users_push on every health_alerts INSERT with no approval_status gate (function body read), and resolve_outbreak's permission check tests v_caller_role = 'admin' — a role that no longer exists — so super_admin/health_admin literally cannot resolve an outbreak today, and there is no way to tell recipients an alert was false. This app's worst credibility event currently has no response path.

- Migration: fix resolve_outbreak role check ('admin' -> super_admin/health_admin) and gate push_on_alert_created on the approved/active status transition instead of raw INSERT (or explicitly document why alerts insert pre-approved); commit updated SQL
- Add retract_alert(p_alert_id, p_reason) SECURITY DEFINER RPC: set status 'retracted', write an audit_logs row, call notify_users_push with a correction message to the same district
- Wire a 'Retract with reason' action in AllAlertsScreen.tsx for super_admin/health_admin/district_officer
- Write INCIDENT_PLAYBOOK.md: detect -> verify with district_officer -> retract -> correction push -> threshold tuning -> postmortem, with per-role responsibilities and a Hindi/English correction template
- Test end-to-end: insert fake alert, confirm push, retract, confirm correction push and audit row

_Files: INCIDENT_PLAYBOOK.md, database_structure/OUTBREAK_DETECTION.sql, database_structure/PUSH_NOTIFICATIONS.sql, components/screens/AllAlertsScreen.tsx_

### 53. Fix the outbreak alert dead-end: notifications target a role nobody has, no push fires, and admins cannot resolve outbreaks
**Status:** DONE — outbreak notifications retargeted to real roles; console + signal screens shipped · **Effort:** M · **Doable by agent:** yes · missing-critical

The first real outbreak will be detected and then seen by no one. detect_outbreak_after_report inserts notifications with target_role='admin', but no profile has role 'admin' (actual roles: super_admin, health_admin, ...), and lib/services/notifications.ts:77 filters target_role !== profile.role, so the admin notification is invisible to every user; clinic/district_officer rows depend on exact district-string match. The trigger sends zero push notifications (notify_users_push is only wired to health_alerts inserts and report approvals). resolve_outbreak's privileged path checks role='admin', so super_admin/health_admin get 'Permission denied' trying to resolve the first (possibly false) outbreak.

- Migrate detect_outbreak_after_report to insert notifications for real roles (super_admin, health_admin) and to call notify_users_push district-scoped on outbreak creation
- Fix resolve_outbreak (and audit auto_approve_report, which still checks 'admin','clinic') to use the actual role names
- Run an end-to-end outbreak fire drill in a test district: insert reports past threshold, verify each role actually sees the in-app notification and receives the push, then resolve the outbreak as super_admin
- Add the drill to the pre-launch checklist and the false-alert playbook item

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\lib\services\notifications.ts_

### 54. Configure Android FCM credentials for EAS builds — production APKs currently register zero push tokens, silently
**Status:** DONE — FCM V1 service account key uploaded to EAS; google-services.json wired · **Effort:** M · **Doable by agent:** no (owner) · missing-critical

There is no google-services.json in the repo, no android.googleServicesFile or expo-notifications plugin in app.json, and no FCM V1 service account implied anywhere. On EAS-built Android binaries, Notifications.getExpoPushTokenAsync requires Firebase; without it the call throws and App.tsx:228-230 swallows the error with console.log('[Push] Token registration skipped.'). Result: in the field, no device ever gets a token, the entire repaired push pipeline sends to an empty list, and nothing surfaces the failure. Separately, devices without Google services can never receive FCM push, so in-app alert surfacing on app-open must be the guaranteed fallback path.

- Owner: create a Firebase project for com.tripathiayushman.healthdrop, download google-services.json, upload the FCM V1 service-account key to EAS credentials
- Wire google-services.json via EAS file env var and set android.googleServicesFile plus the expo-notifications plugin in app.json
- Replace the silent catch in App.tsx registerPushToken with a logged/diagnosable failure state visible in the runbook
- Guarantee a no-push fallback: refresh the alerts/notifications region on every app foreground so GMS-free and token-less devices still see outbreak alerts on next open
- Verify a preview APK on a physical device actually writes an ExponentPushToken to the database before launch

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\app.json, D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\App.tsx, D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\eas.json_

### 55. Set up custom SMTP and decide the email-confirmation policy — first 100 signups will stall on Supabase's default mailer
**Status:** DONE — Gmail SMTP live and verified; email rate limit raised · **Effort:** S · **Doable by agent:** no (owner) · missing-critical

Signup requires email confirmation (AuthScreen.tsx shows 'Check Your Email' after signUp and blocks sign-in on 'Email not confirmed'), but no plan item configures SMTP. Supabase's built-in mailer is rate-limited to a few emails per hour and, on current projects, only delivers to project team-member addresses — so real users' confirmation emails simply never arrive and their accounts are permanently stuck at 'Email Not Verified'. The planned forgot-password flow depends on the same broken channel. Many ASHA workers also have no usable email at all, which makes the confirmation requirement itself questionable for field roles.

- Owner: configure custom SMTP (Resend/SES/etc.) in the Supabase Auth dashboard and raise the email rate limits
- Send a test confirmation and a test recovery email to a non-team address before onboarding day
- Decide explicitly whether field-worker roles need confirm-email at all, or whether admin-provisioned/invite accounts (already a plan item) bypass it
- Document the SMTP provider and sending domain in the operations runbook

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\components\AuthScreen.tsx_

### 56. Introduce a canonical district registry — free-text district strings are the join key for outbreak detection, alert targeting, and permissions
**Status:** PLANNED · **Effort:** L · **Doable by agent:** yes · missing-critical

District is typed free-text or autofilled from Nominatim in DiseaseReportForm/ProfileSetup, yet exact string equality on it drives everything: outbreak aggregation (dr.district = NEW.district), push targeting (district = p_target_district), client notification filtering (notifications.ts:78), and resolve_outbreak's permission check. 'Ballia' vs 'ballia' vs 'Ballia District' (Nominatim returns varying forms) splinters case counts so thresholds never trip, mis-scopes the first real alert, and blocks the district officer from resolving their own outbreak. With 100 self-signed-up users this diverges in week 1 and silently corrupts surveillance aggregates.

- Add a canonical state-to-district picker (LGD codes/names) to ProfileSetup and all report forms; map Nominatim reverse-geocode output onto the registry instead of storing raw strings
- Normalize existing profiles/reports/alerts rows to canonical names in a migration
- Change DB comparisons (outbreak trigger, notify_users_push, resolve_outbreak) and the client notification filter to the canonical key
- Reject or flag non-canonical district values at insert so drift cannot re-enter

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\components\forms\DiseaseReportForm.tsx, D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\components\forms\WaterQualityReportForm.tsx, D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\components\ProfileSetup.tsx_

## HIGH (23)

### 3. Replace the two always-true RLS policies (ai_recommendations anon-writable, campaign_participants free-for-all)
**Status:** DONE — always-true policies replaced (ai_recommendations, campaign_participants, campaigns SELECT) · **Effort:** M · **Doable by agent:** yes

VERIFIED LIVE: ai_recommendations 'act on recommendations' is UPDATE USING(true) WITH CHECK(true) for {public} and anon holds a live UPDATE grant (information_schema confirmed) — anyone with the publishable key can rewrite AI outbreak recommendations unauthenticated. campaign_participants 'allow_all_authenticated' is FOR ALL USING(true) WITH CHECK(true) — any signed-in user can delete or forge any other user's participation rows. Both re-confirmed today by the security advisors (rls_policy_always_true x2).

- ai_recommendations: replace the UPDATE policy with one scoped to officials (get_my_role() IN super_admin/health_admin, or district_officer with district = get_my_district()), same WITH CHECK; REVOKE write grants from anon
- campaign_participants: own-row INSERT/UPDATE/DELETE (user_id = auth.uid()); SELECT for own rows plus organizers and admin roles; keep aggregate participant counts working for CampaignsScreen (counter or security-invoker view if needed)
- Audit callers before applying: components/screens/CampaignsScreen.tsx join/leave/attendance and lib/services/advancedAnalytics.ts must still pass
- Apply via MCP apply_migration, commit SQL under database_structure/, re-run advisors to confirm both rls_policy_always_true findings clear

_Files: database_structure/DATABASE_SCHEMA.sql, components/screens/CampaignsScreen.tsx, lib/services/advancedAnalytics.ts_

### 4. Convert the 9 SECURITY DEFINER vw_* views to security_invoker and revoke anon access (plus mv_campaign_effectiveness)
**Status:** DONE — 9 views security_invoker + anon revoked · **Effort:** S · **Doable by agent:** yes

VERIFIED LIVE: all nine vw_* views (approval_activity, campaign_effectiveness, disease_heatmap, disease_trends, district_health_score, district_health_summary, outbreak_warnings, recent_audit_activity, water_heatmap) have reloptions NULL — no security_invoker — and advisors re-confirm 9 security_definer_view findings today. The audit/approval views expose actor identities to the anon key, bypassing table RLS. Advisors also flag materialized view public.mv_campaign_effectiveness as selectable by anon/authenticated — fix in the same pass.

- ALTER VIEW ... SET (security_invoker = true) for all nine vw_* views
- REVOKE ALL on the nine views FROM anon; GRANT SELECT to authenticated only; also REVOKE anon SELECT on mv_campaign_effectiveness
- Smoke-test HealthScoreScreen, EscalationMonitoringScreen, and advancedAnalytics.ts fallback chains with a non-admin JWT
- Re-run MCP get_advisors(security) and confirm the 9 view findings plus the materialized-view finding clear

_Files: database_structure/GEOGRAPHIC_HEATMAP.sql, database_structure/AUDIT_LOG.sql, database_structure/APPROVAL_SYSTEM.sql, lib/services/advancedAnalytics.ts_

### 5. Drop the bundled OpenRouter API key and direct-call fallback from the client
**Status:** DONE — OPENROUTER_API_KEY is an edge secret; direct-call fallback deleted; EAS vars removed · **Effort:** S · **Doable by agent:** no (owner)

VERIFIED: lib/services/gemini.ts line 20 bakes EXPO_PUBLIC_OPENROUTER_API_KEY into every bundle and callOpenRouterDirect (lines 173-219) sends it to openrouter.ai from user devices; the fallback branch in callOpenRouter (lines 230-238) only survives because the proxy secret is not yet set. The proxy path via the deployed openrouter-proxy edge function exists (lines 150-170, function confirmed ACTIVE on the project). The key is one of the 4 known-leaked keys.

- Owner: set the OPENROUTER_API_KEY secret on the openrouter-proxy edge function and rotate the leaked key at openrouter.ai
- Delete callOpenRouterDirect and the fallback branch in callOpenRouter; on proxy failure fall through to the existing local non-AI fallback content
- Remove EXPO_PUBLIC_OPENROUTER_API_KEY from .env.example and from EAS env vars for preview and production (owner's Expo account)
- Rebuild the web dist/ so no bundle still contains the key string; verify AI insights and chatbot work proxy-only

_Files: lib/services/gemini.ts, .env.example, eas.json_

### 6. Add a password reset flow (none exists), an app URL scheme, and a unified password policy
**Status:** DONE — email-OTP reset flow shipped and verified live end-to-end · **Effort:** M · **Doable by agent:** no (owner)

VERIFIED: resetPasswordForEmail/PASSWORD_RECOVERY appear nowhere in the repo and AuthScreen has no forgot-password UI — a locked-out ASHA worker has no self-service recovery. CORRECTION to one proposal's steps: app.json has NO "scheme" key (verified), so recovery deep links cannot return to the Android app until one is added. Policy is inconsistent: signup enforces 8+ chars (AuthScreen.tsx:357) but ProfileScreen change-password accepts 6 (line 218). Merged duplicate of the onboarding-dimension forgot-password item.

- Add 'Forgot password?' link on the Sign In card calling supabase.auth.resetPasswordForEmail(email, { redirectTo }) with an inline confirmation state
- Add "scheme": "healthdrop" to app.json; handle the recovery deep link via expo-linking and the PASSWORD_RECOVERY auth event in App.tsx with a Set New Password screen (reuse ProfileScreen's change-password UI); on web, redirectTo the hosted web URL (or use the 6-digit OTP + verifyOtp flow to avoid redirects on low-end Android)
- Raise ProfileScreen change-password minimum to 8 chars to match signup
- Owner: add healthdrop://reset-password and the web URL to the Supabase Auth redirect allowlist and confirm the reset email template
- Test end-to-end on web and an Android preview APK (scheme change requires a new native build)

_Files: components/AuthScreen.tsx, components/screens/ProfileScreen.tsx, app.json, App.tsx_

### 14. Extend sync idempotency to campaign/health_alert/feedback and recover items stranded in 'syncing' after a mid-sync kill
**Status:** DONE — idempotency keys on all five queue tables; stale-syncing recovery · **Effort:** M · **Doable by agent:** yes

VERIFIED: OfflineSyncService.ts TABLE_MAP (lines 38-40) marks campaign/health_alert/feedback usesIdempotencyKey:false with plain insert — a client-side timeout that committed server-side duplicates on retry, and a duplicate health_alerts row re-fires trg_push_on_alert_created (confirmed live on health_alerts), double-blasting a district. Live DB confirms client_idempotency_key exists ONLY on disease_reports and water_quality_reports. SyncQueue.getPendingItems (lines 125-131) excludes status 'syncing', so an item stranded by an app kill mid-upload is invisible to automatic sync forever; SyncOutboxScreen already has the STALE_SYNCING_MS pattern (line 26) to reuse. SyncQueue.updateItem also never emits change events.

- Migration adding client_idempotency_key TEXT + partial unique index to health_campaigns, health_alerts, user_feedback (mirror into database_structure/OFFLINE_SYNC_SCHEMA.sql)
- Flip usesIdempotencyKey to true for the three types so uploadItem uses upsert(onConflict:'client_idempotency_key', ignoreDuplicates:true)
- Attach the same key on the ONLINE direct-submit paths in AlertForm.tsx and CampaignForm.tsx (mirroring lib/services/diseaseReports.ts:132) so user-retried online submits also dedupe
- In OfflineSyncService.start(), reconcile the queue before subscribing to NetInfo: reset stale 'syncing' items (same STALE_SYNCING_MS logic) back to 'pending'
- Call emitChange() from SyncQueue.updateItem so the Sync Pebble badge updates on per-item status changes
- Verify: enqueue a health_alert offline, sync twice against the live DB, confirm exactly one row and one push outbox batch

_Files: src/services/offlineSync/OfflineSyncService.ts, src/services/offlineSync/SyncQueue.ts, components/forms/AlertForm.tsx, components/forms/CampaignForm.tsx, database_structure/OFFLINE_SYNC_SCHEMA.sql, components/screens/SyncOutboxScreen.tsx_

### 15. Fix the push-token lifecycle: clear on sign-out, claim uniquely per device, prune dead tokens
**Status:** PARTIAL — clear-on-signout + unique device claim done; dead-token pruning open · **Effort:** M · **Doable by agent:** yes

VERIFIED: App.tsx handleSignOut (lines 241-251) never clears the push token and usersService.registerExpoPushToken (line 276+) is a plain own-row update with no uniqueness — on shared phones the previous user keeps receiving the next user's district alerts and approval notices. Expo DeviceNotRegistered failures are recorded by update_push_outbox_status but nothing prunes the dead token. NOTE: implement against the token store chosen in the push fan-out item (user_push_tokens table if that lands first) — same lifecycle logic either way.

- In App.tsx handleSignOut, before supabase.auth.signOut(), best-effort null the current user's push token (while still authenticated under RLS); never block sign-out on failure
- Migration: claim_push_token(p_token TEXT) SECURITY DEFINER RPC (fixed search_path) that nulls the token on any other row holding it, then sets it for auth.uid(); switch registerExpoPushToken to the RPC
- Add a partial unique index on the token column WHERE token IS NOT NULL once the RPC lands
- Extend update_push_outbox_status (or the edge function ticket loop) so a DeviceNotRegistered ticket error nulls that token — closing the dead-token leak
- Add Notifications.addPushTokenListener in App.tsx to re-register when Expo rotates the token mid-session
- Mirror SQL into database_structure/PUSH_NOTIFICATIONS.sql; test the shared-device flow: login A, logout, login B, insert district alert, confirm only B receives it

_Files: App.tsx, lib/services/users.ts, database_structure/PUSH_NOTIFICATIONS.sql, supabase/functions/push-notifications/index.ts_

### 16. Harden the AsyncStorage sync queue against corruption and quota exhaustion
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: SyncQueue.getAll (line 74) does an unguarded JSON.parse of the single '@healthdrop/sync_queue' key — one corrupted write makes every getAll AND enqueue throw, silently breaking all offline submission paths at once. The queue is unbounded against AsyncStorage's ~6MB Android quota, and a setItem failure inside enqueue/saveAll loses the submission with no user feedback. This one key holds the field program's most irreplaceable data.

- Wrap the parse in try/catch; on failure copy the raw value to '@healthdrop/sync_queue_quarantine_<timestamp>' (never silently delete field data), log, return [] so the app keeps working
- Validate each parsed item's shape (localId string, known type, payload object); quarantine malformed entries
- Catch AsyncStorage.setItem failures in enqueue/saveAll and rethrow a typed QueueStorageError; in the four forms show 'couldn't save on this phone — storage may be full' instead of a generic failure
- Cap the queue (~200 items): refuse past the cap with a clear message — never silently evict unsent reports
- Surface quarantined-data presence in SyncOutboxScreen ('some saved reports could not be read') so data loss is visible
- Add a dev-only test script that writes garbage to the queue key and confirms the app still enqueues and syncs

_Files: src/services/offlineSync/SyncQueue.ts, src/services/offlineSync/OfflineSyncService.ts, components/screens/SyncOutboxScreen.tsx, components/forms/DiseaseReportForm.tsx, components/forms/WaterQualityReportForm.tsx_

### 17. Wire Supabase session auto-refresh to AppState and defuse the onAuthStateChange deadlock pattern
**Status:** DONE — AppState-driven session auto-refresh · **Effort:** S · **Doable by agent:** yes

VERIFIED: zero AppState usage anywhere in components/lib/src (grep confirmed), so the app skips the startAutoRefresh/stopAutoRefresh wiring Supabase's RN guide requires — after Android doze, users resume to expired tokens and queries 401 until a refresh. App.tsx lines 91-99 call fetchProfile (a Supabase query) synchronously inside onAuthStateChange — the documented deadlock-risk pattern — and refire a full profile refetch (with built-in sleeps) on every TOKEN_REFRESHED.

- In lib/supabase.ts (native only), add AppState.addEventListener('change') calling supabase.auth.startAutoRefresh() when active and stopAutoRefresh() otherwise
- In App.tsx's onAuthStateChange callback, defer all work with setTimeout(..., 0) so no supabase call runs inside the callback stack
- Gate fetchProfile to SIGNED_IN, INITIAL_SESSION, USER_UPDATED; on TOKEN_REFRESHED only update session state
- Manually verify: background the app past token expiry, foreground, confirm the first dashboard fetch succeeds without a 401

_Files: lib/supabase.ts, App.tsx_

### 20. Gate clinic/ASHA data visibility behind admin verification of self-claimed roles
**Status:** PLANNED · **Effort:** L · **Doable by agent:** yes

VERIFIED LIVE: the full disease_reports_select policy gives any active clinic profile ALL reports in profiles.district regardless of approval_status (third OR-branch), and district_officer likewise; district is self-typed at signup and freely self-editable (profiles_self_update pins only role) — so anyone can sign up as 'Clinic', roam districts, and read unapproved disease reports. The core 'who vouches for this account' gap.

- Add profiles.verification_status TEXT CHECK IN ('pending','verified') — default 'pending' for clinic/asha_worker/district_officer, 'verified' for volunteer; backfill existing rows as 'verified'
- Update disease_reports/water_quality_reports SELECT policies so district-wide and unapproved-report branches for elevated roles additionally require verification_status='verified' (approved-report visibility stays)
- Add a 'Pending verification' section to UserManagementScreen (super_admin/health_admin) with Verify/Reject, and a pending banner in MainApp for unverified elevated roles
- Send an in-app notification when an account is verified
- Document the vetting expectation in SETUP_GUIDE.md

_Files: database_structure/APPROVAL_SYSTEM.sql, components/screens/UserManagementScreen.tsx, components/MainApp.tsx, components/AuthScreen.tsx, SETUP_GUIDE.md_

### 21. Attach and fix the handle_new_user trigger (it exists but is orphaned and unsafe) and remove the 'sign up again' lockout
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

CORRECTED FINDING: public.handle_new_user() ALREADY EXISTS in the live DB but NO trigger on auth.users is attached (verified — zero auth-schema triggers), so profiles are created only by the client upsert in AuthScreen (lines 398-402), and the email-confirmation path (sd.session null, line 416) never writes a profile at all. Worse, the existing function must NOT be attached as-is: it maps district from metadata key 'location' and state from 'organization' (AuthScreen sends district/state/pincode — mismatched) and takes role straight from client-controlled raw_user_meta_data with no whitelist — attaching it unmodified would let a signup self-provision super_admin via metadata. App.tsx lines 180-187 then sign out no-profile users with 'Please sign up again', which fails with 'already registered' — a permanent lockout.

- Rewrite handle_new_user(): read full_name/district/state/phone/pincode from the metadata keys AuthScreen actually sends, WHITELIST role to clinic/asha_worker/volunteer (default volunteer), SET search_path, keep ON CONFLICT DO NOTHING
- CREATE TRIGGER on auth.users AFTER INSERT executing it; apply via MCP apply_migration and commit the SQL
- Keep the AuthScreen upsert as a tolerant fallback
- In App.tsx, replace the 'Profile Not Found -> sign out' dead end with a 'Complete your profile' repair screen that upserts the missing row for the current session
- Backfill any existing auth.users without a profiles row

_Files: database_structure/DATABASE_SCHEMA.sql, App.tsx, components/AuthScreen.tsx_

### 22. Build an invite/provisioning path for district_officer and health_admin accounts
**Status:** PLANNED · **Effort:** L · **Doable by agent:** yes

VERIFIED: no invite mechanism exists anywhere — privileged accounts require self-registering as a lower role then manual promotion in UserManagementScreen, documented nowhere. A district rollout needs 'super_admin invites the district officer', not word-of-mouth promotion.

- Write an admin-invite-user edge function: verify caller JWT is super_admin (or health_admin for sub-district roles), then use the auto-injected SUPABASE_SERVICE_ROLE_KEY with auth.admin.inviteUserByEmail, inserting the profiles row with target role/district/state (verification_status='verified')
- Deploy via MCP deploy_edge_function
- Add an 'Invite User' button + modal (email, role, district, state) to UserManagementScreen calling supabase.functions.invoke
- Handle invite-acceptance via the same deep-link path as password recovery (set password on first open)
- Document the full account matrix in SETUP_GUIDE.md: who creates super_admin (one-time SQL), who invites health_admin/district_officer, who verifies clinic/ASHA, volunteers self-serve

_Files: supabase/functions/admin-invite-user/index.ts, components/screens/UserManagementScreen.tsx, SETUP_GUIDE.md_

### 35. Localize server-generated notifications: preferred_language on profiles + template-key/params payloads
**Status:** PLANNED · **Effort:** L · **Doable by agent:** yes

VERIFIED LIVE: profiles has NO preferred_language column and notifications has NO template_key/params/language columns (information_schema read); OUTBREAK_DETECTION.sql concatenates English prose ('⚠️ Outbreak Detected: ...', 'Immediate review required.' — lines 404-414 confirmed) straight into notifications, and the push path forwards it verbatim. A Hindi-mode user would get a fully Hindi app whose most safety-critical messages arrive in English. Sequenced after the i18n foundation lands.

- Migration: ALTER TABLE profiles ADD preferred_language text NOT NULL DEFAULT 'en' CHECK (IN ('en','hi')); ALTER TABLE notifications ADD template_key text, ADD params jsonb
- Refactor the two outbreak trigger functions to also write template_key + params (disease_name, district, total_cases, threshold, max_severity) alongside the English title/message kept as fallback
- Client notification screens render from template_key+params through t(), falling back to the English text when template_key is null
- Push path: join recipient preferred_language and select between en/hi server-side templates for push title/body (push text renders outside the app)
- ProfileScreen language picker writes profiles.preferred_language as well as AsyncStorage
- Mirror all SQL into database_structure/OUTBREAK_DETECTION.sql and DATABASE_SCHEMA.sql

_Files: database_structure/OUTBREAK_DETECTION.sql, database_structure/DATABASE_SCHEMA.sql, database_structure/PUSH_NOTIFICATIONS.sql, supabase/functions/push-notifications/index.ts, lib/services/notifications.ts, components/screens/ProfileScreen.tsx, components/screens/AllAlertsScreen.tsx_

### 37. Adopt @sentry/react-native with the Expo config plugin (sentry-expo is deprecated)
**Status:** OWNER ACTION · **Effort:** M · **Doable by agent:** no (owner)

VERIFIED: package.json has no crash-reporting dependency. Evaluation stands: @sentry/react-native is the current SDK-54 path with a first-class Expo plugin, Hermes symbolication, and a free tier covering this user base; GlitchTip means self-hosting ops the project cannot absorb; Crashlytics has weak JS symbolication. Complements (does not replace) the in-house ErrorBoundary + client_error_logs item.

- Owner: create Sentry org/project, obtain DSN + auth token; add SENTRY_AUTH_TOKEN to EAS secrets and EXPO_PUBLIC_SENTRY_DSN to EAS env
- npx expo install @sentry/react-native; add the '@sentry/react-native/expo' plugin block to app.json
- Sentry.init in App.tsx gated on DSN presence, with beforeSend scrubbing email/full_name; release set to the synced version
- Forward ErrorBoundary/global-handler captures to Sentry.captureException so both sinks receive them
- Add source-map upload to .github/workflows/build-android-release.yml after the EAS build step

_Files: package.json, app.json, App.tsx, .github/workflows/build-android-release.yml_

### 40. pg_cron jobs: push-outbox retry, data-retention purges, and outbox visibility
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED LIVE: cron.job contains exactly one job (escalate-reports-job). notify_users_push fire-and-forgets via pg_net — a failed edge call leaves outbox rows 'pending' forever, so a district alert can silently reach nobody; nothing purges sent outbox rows or read notifications; and the 'Admins can read push outbox' policy still checks the extinct role='admin' (verified in pg_policies), so no living admin can see delivery status. Absorbs the retention-cron steps from the dissolved DPDP item.

- Migration: cron job retry_push_outbox every 10 min — pending/failed rows with attempt_count < 5 and created_at > now()-'24h', batch tokens, re-POST to the push-notifications edge function via pg_net using the vault-stored key (pattern already in notify_users_push)
- Migration: daily purge jobs — outbox sent > 30d / failed > 90d, read notifications > 30-90d, push tokens untouched > 180d, old audit_logs per retention decision
- Fix the outbox SELECT policy to super_admin/health_admin (same shape as feedback_admin_select) — coordinate with the push fan-out item so it lands once
- Extend update_push_outbox_status's 1-hour window or match on outbox row id so retried rows get status recorded
- Commit SQL to database_structure/CRON_JOBS.sql, apply via MCP; add a 'Push delivery (7d): sent/failed' stat to SuperAdminDashboard

_Files: database_structure/CRON_JOBS.sql, database_structure/PUSH_NOTIFICATIONS.sql, components/dashboards/SuperAdminDashboard.tsx_

### 41. Schema-as-code baseline + staging environment strategy (single prod project today)
**Status:** PLANNED · **Effort:** L · **Doable by agent:** yes

VERIFIED: supabase_migrations.schema_migrations holds exactly 5 rows while the real schema was pasted from database_structure/*.sql which has drifted badly — live user_feedback carries BOTH the working feedback_admin_* policies AND four dead get_my_role()='admin' legacy policies (pg_policies read), and USER_FEEDBACK_TABLE.sql still creates the legacy versions. lib/supabase.ts (lines 9-13) hardcodes the prod URL and publishable key as fallback, so a misconfigured staging build would silently write to prod.

- Generate a baseline: supabase db dump --linked (or MCP introspection) into supabase/migrations/<ts>_baseline.sql; verify it recreates cleanly on local supabase start; add supabase/config.toml
- Sweep drift artifacts as a follow-up migration: drop the dead legacy-role policies on user_feedback and the push outbox
- Mark database_structure/*.sql as historical reference; adopt the rule that all future DDL lands as supabase/migrations files
- Change lib/supabase.ts to fail fast when EXPO_PUBLIC_SUPABASE_URL is missing in non-production builds instead of falling back to prod; add staging env blocks to the eas.json preview profile
- Owner: create the staging project (free tier; note 7-day pause on inactivity), run migrations against it, point preview builds at it; document the promotion flow in OPERATIONS.md

_Files: supabase/migrations/, supabase/config.toml, lib/supabase.ts, eas.json, .env.example, database_structure/README.md_

### 46. Make versionCode deterministic — fix the dual GITHUB_RUN_NUMBER counters
**Status:** DONE — versionCode derives from git commit count · **Effort:** S · **Doable by agent:** yes

VERIFIED: scripts/sync-version.cjs line 16-18 falls back to GITHUB_RUN_NUMBER (or 1 locally); prepare-release.yml commits a versionCode from ITS run_number while build-android-release.yml re-runs sync-version with the build workflow's independent run_number (never committed) — released APK versionCodes diverge from the repo and the two counters can regress relative to each other, risking INSTALL_FAILED_VERSION_DOWNGRADE for sideload users migrating to a Play build. app.json currently sits at versionCode 4.

- Derive versionCode deterministically from the semver argument (major*10000 + minor*100 + patch) in sync-version.cjs and delete the GITHUB_RUN_NUMBER fallback
- Add a guard exiting non-zero if the computed versionCode <= android.versionCode already in app.json
- In build-android-release.yml, stop passing ${{ github.run_number }} — drop the sync step or call with version only so it recomputes the identical code
- In prepare-release.yml, remove the buildNumber input/run_number fallback
- Reconcile current state: check the latest GitHub Release APK's actual versionCode and choose the next semver so the derived code exceeds it

_Files: scripts/sync-version.cjs, .github/workflows/build-android-release.yml, .github/workflows/prepare-release.yml, app.json, package.json_

### 47. Add a production app-bundle lane to CI (tag builds currently produce only preview APKs)
**Status:** NOT APPLICABLE — no Play Store submission, APK lane is sufficient · **Effort:** M · **Doable by agent:** yes

VERIFIED: build-android-release.yml runs eas build --profile preview and attaches the APK to a public GitHub Release; the production app-bundle profile in eas.json is never exercised by CI. Play requires an .aab, so submission would depend on ad-hoc local builds. Impact adjusted critical->high: a manual `eas build --profile production` remains possible, so this blocks repeatability, not capability.

- Add a second job (or play-release.yml on the same v* tag + workflow_dispatch) running npx eas build --platform android --profile production --non-interactive --wait --json, reusing EXPO_TOKEN
- Upload the .aab as a private workflow artifact — do NOT attach it to the public GitHub Release
- Add an optional eas submit -p android --latest step gated on a PLAY_SERVICE_ACCOUNT_JSON secret existing; skip gracefully when absent
- Verify both jobs produce the same versionCode (depends on the deterministic sync-version item)
- Document the release flow (prepare-release -> tag -> APK release + AAB artifact -> Play upload) in README.md

_Files: .github/workflows/build-android-release.yml, .github/workflows/play-release.yml, eas.json, README.md_

### 48. app.json cleanup: drop deprecated sdkVersion, fix the 108px splash via plugin, add expo-notifications icon config, block legacy permissions
**Status:** PARTIAL — googleServicesFile + expo-notifications plugin added; deprecated sdkVersion still present · **Effort:** M · **Doable by agent:** yes

VERIFIED: app.json pins "sdkVersion": "54.0.0" and uses the legacy top-level splash key pointing at assets/splash-icon.png which is literally 108x108 px (PNG header read) while an unused 1024x1024 assets/splash-ico.png sits beside it. No expo-notifications plugin block exists despite a working push pipeline. The local prebuild manifest confirms READ/WRITE_EXTERNAL_STORAGE and SYSTEM_ALERT_WINDOW (android/app/src/main/AndroidManifest.xml lines 5-8) which nothing uses and Play reviewers flag.

- Remove "sdkVersion" from app.json
- Replace the top-level splash block with the expo-splash-screen plugin entry after swapping in the 1024px art (then delete the stray splash-ico.png and unused app_lo.png)
- Add the expo-notifications plugin (96x96 white-on-transparent monochrome icon, Prakash brand color, defaultChannel) — coordinates with the notification-channels item
- Add android.blockedPermissions for READ/WRITE_EXTERNAL_STORAGE and SYSTEM_ALERT_WINDOW — location + INTERNET + VIBRATE are all the code needs
- Validate with npx expo-doctor and npx expo config --type prebuild

_Files: app.json, assets/splash-icon.png, assets/splash-ico.png, assets/app_lo.png_

### 49. Adopt expo-updates + EAS Update channels for OTA delivery (evaluation: yes, adopt)
**Status:** OWNER ACTION · **Effort:** M · **Doable by agent:** no (owner)

VERIFIED: expo-updates is not in package.json and distribution is sideloaded APKs from GitHub Releases — no update channel exists, yet nearly every change in this repo is JS-only and ASHA workers will not re-download 50MB APKs for JS fixes. runtimeVersion policy 'appVersion' lines up with the sync-version scheme; the EAS projectId is already in app.json extra.eas.

- npx expo install expo-updates
- Add to app.json: updates.url https://u.expo.dev/3a4f36a3-4383-4310-8e55-c85c2f28ab08, checkAutomatically ON_LOAD, fallbackToCacheTimeout 0, and runtimeVersion { policy: 'appVersion' }
- Add channel 'preview' / 'production' to the matching eas.json build profiles
- Add a workflow step or documented command npx eas update --channel preview --message "$GITHUB_SHA" for JS-only releases
- Owner: cut one new binary per channel after this lands (OTA only reaches builds compiled with expo-updates), then verify an update round-trip on a physical low-end device

_Files: package.json, app.json, eas.json, .github/workflows/build-android-release.yml_

### 50. Play submission checklist: verify target API 36, fill Data safety from actual flows, produce listing assets
**Status:** NOT APPLICABLE — owner has ruled out Play Store distribution · **Effort:** L · **Doable by agent:** no (owner)

VALID process item: Expo SDK 54 targets API 36 (satisfies Play's Aug 2026 requirement) but must be verified in the actual production build — the stale local android/ (gitignored) proves nothing. The Data safety form must match real flows (verified: name/email/phone/district/state/pincode at signup, health report contents, transient fine location, push token in profiles, AI chat text to OpenRouter) and the repo has zero store-listing assets beyond the icon. Impact adjusted critical->high: owner-driven process contingent on the Play decision, not a code blocker.

- Verify targetSdkVersion 36 in the production build's EAS logs; only add expo-build-properties if an override is needed
- Complete Data safety grounded in code: personal info, health info, location (used transiently, not stored server-side), device IDs (push token), app activity shared with OpenRouter, HTTPS, deletion mechanism
- Complete the Health apps declaration and content-rating questionnaire
- Produce assets: 512px icon, 1024x500 feature graphic in the Prakash design language, 4-8 phone screenshots from the preview APK
- Owner: create the Play listing, upload the AAB from the production CI lane to internal testing first

_Files: assets/icon.png, DESIGN_SPEC.md_

### 52. Keystore hygiene: verify/back up the EAS-managed keystore and neutralize the stale debug-signed local android/ dir
**Status:** DONE — keystore verified intact (JKS, alias 61b72c7f…) during FCM setup · **Effort:** S · **Doable by agent:** no (owner)

VERIFIED: eas.json has no credentialsSource (EAS-managed remote keystore, never verified or backed up — losing it before Play App Signing enrollment permanently bricks the app identity for sideload users). The gitignored local android/ configures release builds with the DEBUG keystore (android/app/build.gradle:110/115 'signingConfig signingConfigs.debug') and hardcodes versionCode 1 / versionName 1.0.0 (lines 95-96) — any local release build is an undistributable, misversioned binary.

- Owner: run eas credentials -p android — confirm the keystore exists, download a backup to secure offline storage, record SHA-1/SHA-256 fingerprints
- Owner: on first Play upload, enroll in Play App Signing so the EAS keystore becomes the (recoverable) upload key
- Confirm GitHub-Release preview APKs are signed by the same EAS keystore as production AABs (keytool -printcert -jarfile against the recorded fingerprint)
- Delete the stale local android/ directory (gitignored; CI builds via EAS prebuild from app.json) and note in README that npx expo run:android regenerates it; never distribute a locally built release variant
- Confirm .gitignore keystore patterns (*.jks, *.p12, *.key) remain intact

_Files: eas.json, .gitignore, README.md_

### 57. Gate outbreak detection on approved data, bound cases_count, and recompute on rejection — one typo currently creates a permanent outbreak
**Status:** DONE — detection gated on approved reports, counts bounded, recompute-on-rejection trigger · **Effort:** M · **Doable by agent:** yes · missing-critical

detect_outbreak_after_report counts every report where approval_status != 'rejected', which includes ASHA submissions still pending_approval — so unreviewed data drives outbreak declaration despite the human-review pipeline. cases_count has no upper bound anywhere (client just strips non-digits, DB CHECKs only enforce deaths<=cases), so an ASHA worker typing 500 instead of 50 instantly creates an 'active' outbreak and urgent notifications. The trigger fires AFTER INSERT only: rejecting the bad report afterwards never recomputes or retracts the outbreak. The planned false-alert playbook is reactive; this is the prevention side, and it will bite during week-1 training sessions when practice reports hit the live trigger.

- Change the trigger's window query to count only approved reports (or make the policy decision explicit if pending must count)
- Add a sane upper bound on cases_count/deaths_count as a DB CHECK plus a client-side confirm step for unusually large numbers
- Add an AFTER UPDATE recompute path: when a counted report is rejected or edited, recalculate the outbreak's totals and auto-downgrade/resolve it below threshold
- Verify with the fire drill: approve, reject, and confirm the outbreak row updates accordingly

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\components\forms\DiseaseReportForm.tsx_

### 58. Alert on unsafe water-quality results — the app's core signal currently notifies no one
**Status:** DONE — trg_notify_on_unsafe_water live · **Effort:** S · **Doable by agent:** yes · missing-critical

water_quality_reports has only auto-approve, audit-log, and geo-sync triggers; a report with overall_quality='unsafe' produces no notification, no push, no alert — it only increments a dashboard stat (waterQuality.ts unsafeSources count). For a waterborne-disease surveillance app, the first contaminated hand-pump found in week 1 sits silently in a table until an official happens to browse the dashboard, while villagers keep drinking from the source. Every other alert path (disease outbreak, manual health alerts) is covered by plan items; this one is absent.

- Add an AFTER INSERT/UPDATE trigger: when overall_quality lands on 'unsafe', insert district-scoped notifications and call notify_users_push targeting district_officer, clinic, and ASHA workers of that district
- Include the water source name/location in the payload so field workers can act without opening dashboards
- Decide the escalation rule for repeat-unsafe sources and add it to the incident playbook
- Test end-to-end with a real device during the outbreak fire drill

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\lib\services\waterQuality.ts_

## MEDIUM (18)

### 9. Pin search_path on the 37 flagged database functions
**Status:** DONE — search_path pinned on all app-owned functions · **Effort:** S · **Doable by agent:** yes

RE-VERIFIED TODAY: get_advisors(security) reports exactly 37 function_search_path_mutable findings, and get_my_role() (read live) has no SET search_path while being the SECURITY DEFINER helper the whole RLS layer depends on; postgis + pg_net sit in the public schema (2 extension_in_public findings). Newer functions like dispatch_push_notification already do this correctly — it is a consistency backfill.

- Pull the exact function list from MCP get_advisors(security)
- Generate one migration of ALTER FUNCTION ... SET search_path = public, pg_temp for all 37 (schema-qualify postgis calls in bodies if breakage appears)
- Update the canonical CREATE FUNCTION definitions in database_structure/*.sql (FIX_PROFILES_RLS_RECURSION.sql, OUTBREAK_DETECTION.sql, APPROVAL_SYSTEM.sql) so re-running them does not regress
- Apply via MCP apply_migration, re-run advisors to confirm zero findings, smoke-test login (get_my_role is on the auth hot path)

_Files: database_structure/FIX_PROFILES_RLS_RECURSION.sql, database_structure/OUTBREAK_DETECTION.sql, database_structure/APPROVAL_SYSTEM.sql, database_structure/PUSH_NOTIFICATIONS.sql_

### 10. Enable leaked-password protection and align Auth settings (owner, dashboard)
**Status:** OWNER ACTION · **Effort:** S · **Doable by agent:** no (owner)

RE-VERIFIED TODAY: get_advisors(security) still reports auth_leaked_password_protection disabled. A password is the only factor protecting accounts that can approve outbreak reports and trigger district-wide pushes. Dashboard-only toggle (Pro plan), unreachable from repo or MCP.

- Dashboard -> Authentication -> Passwords: enable leaked-password protection
- Set minimum password length to 8 server-side to match the client
- Review recovery/OTP token expiry in the same screen (relevant once the password-reset flow ships)
- Re-run security advisors to confirm the finding clears

### 18. Make the health map survive flaky networks: bundle Leaflet locally, halve tile traffic, degrade gracefully on tile errors
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: HealthMapComponent.tsx loads leaflet.js/css from unpkg.com in the WebView HTML (lines 458-459) and stacks TWO Carto tile layers (lines 482, 492), doubling tile requests on 2G. The offline case shows an honest notice, but the common rural case — online with a terrible connection — hangs on the CDN fetch and renders a blank map even though markers and district circles are locally computed.

- Vendor leaflet 1.9.4 dist JS+CSS into assets/leaflet/ and inline them into buildLeafletHtml's template, removing both unpkg tags — the map engine then loads with zero network
- Replace the two tile layers with a single Carto light_all/dark_all layer (labels included); keep maxNativeZoom/keepBuffer settings
- Add a 'tileerror' listener that after N consecutive failures shows an in-map banner 'Map background unavailable — markers still accurate' over a plain background
- Set the WebView's onError/onHttpError to fall back to the existing nativeFallback district-list rendering
- Confirm bundle impact (~160KB gzipped) and test airplane mode: markers render over a blank canvas when data is cached in state

_Files: components/shared/HealthMapComponent.tsx, assets/leaflet/_

### 19. Remove expo-blur and orphaned legacy components; lazy-mount the map WebView for low-memory devices
**Status:** DONE — expo-blur and orphaned components removed · **Effort:** M · **Doable by agent:** yes

CORRECTED: the proposal claimed expo-navigation-bar has zero imports — FALSE: MainApp.tsx dynamically imports it at lines 169 and 182, so it must stay. expo-blur genuinely has zero imports (verified repo-wide) and HelloWorld/HeroSection/Navbar/Sidebar/Card.tsx have no importers (verified). android/ is gitignored, not committed, so no prebuild-sync caveat applies. The lazy-map rationale stands: every role's home dashboard auto-mounts a Leaflet WebView at first paint — the heaviest memory consumer on 1-2GB devices.

- Remove expo-blur from package.json (KEEP expo-navigation-bar — it is used) and delete the orphaned component files after a final reference re-check
- In MapAndAlertsSection, render a lightweight placeholder card ('Tap to load map' with counts from already-fetched data) and only mount the WebView after user tap or an InteractionManager idle callback
- Extend the existing full-screen-map pause pattern to tab switches away from home so the inline WebView unmounts
- Run npx expo-doctor to confirm no config drift (hermesEnabled/newArchEnabled already true in the local prebuild)
- Owner compares APK size and cold-start memory on the next EAS preview build

_Files: package.json, components/HelloWorld.tsx, components/HeroSection.tsx, components/Navbar.tsx, components/Sidebar.tsx, components/Card.tsx, components/shared/HealthMapComponent.tsx_

### 23. Enforce deactivation server-side and fix its broken web UX
**Status:** PARTIAL — soft-delete unified in admin screens; server-side enforcement open · **Effort:** S · **Doable by agent:** yes

VERIFIED LIVE: get_my_role() returns the role with no is_active check, so every get_my_role-based policy still honors a deactivated admin's permissions — deactivation only blocks the app UI. That UI block uses Alert.alert (App.tsx:164), a no-op on react-native-web: a deactivated web user is silently bounced to login with no explanation.

- Change get_my_role() to return 'none' unless is_active = true (single-point hardening; disease_reports policies already check is_active inline) — coordinate with the search_path backfill item
- Replace the Alert.alert in App.tsx fetchProfile with a themed full-screen 'Account deactivated' state (web + native) with support contact and Sign Out
- Do the same for the 'Profile Not Found' Alert.alert (superseded by the repair screen from the handle_new_user item)
- Verify a deactivated test user can no longer read campaigns/alerts via the REST API and sees the new screen in-app

_Files: database_structure/FIX_PROFILES_RLS_RECURSION.sql, App.tsx_

### 24. Stop silently discarding profile data; add role-aware profile completeness
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: signup collects pincode and passes it only into auth metadata (AuthScreen:392) — the profiles upsert (lines 398-402) drops it, and live profiles has no pincode column. ProfileScreen's Update Location modal collects village + pincode but handleUpdateLocation (lines 252-258) writes only district/state. Live profiles DOES have unused organization and assigned_area columns (verified) — clinics have no facility-name field even though the column exists.

- Add pincode column to profiles (village maps to existing assigned_area); migrate via MCP
- Persist pincode from signup and pincode/village from ProfileScreen's Update Location handler
- When role=clinic is selected at signup, show a required 'Facility name' field saved to profiles.organization; add to Edit Profile too
- For asha_worker, surface assigned_area ('Village/Area you serve') at signup as optional
- Show a profile-completeness nudge card on the dashboard when organization/assigned_area/phone are missing for roles that need them

_Files: components/AuthScreen.tsx, components/screens/ProfileScreen.tsx, database_structure/DATABASE_SCHEMA.sql, components/screens/DashboardScreen.tsx, types/index.ts_

### 26. First-run guidance for ASHA workers and real training/help content
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: no onboarding/first-run/tour component exists anywhere (grep confirmed); the only in-app guidance is the hard-coded Help & FAQ modal in ProfileScreen (line 418+), English only, and TERMS_TEXT/PRIVACY_TEXT are placeholder constants (lines 56-60). ASHA workers get dropped onto a dashboard with no explanation of the report -> approval -> alert flow.

- Add a lightweight role-aware first-login checklist: 3-4 static cards (what to report, how offline Sync Outbox works, what 'pending approval' means, where My Submissions lives), shown once per role, dismissal in AsyncStorage; no animation, respects reduceMotion
- Extract help content into lib/helpContent.ts keyed by role, with English + Hindi strings for ASHA/volunteer entries
- Rewrite FAQ entries to match current navigation labels and the offline-sync and rejection-feedback flows
- Add a printable one-page ASHA field guide (docs/ASHA_FIELD_GUIDE.md, Hindi+English) linked from README
- Replace placeholder TERMS_TEXT/PRIVACY_TEXT with real reviewed text (owner review; coordinates with the privacy-policy item)

_Files: components/MainApp.tsx, lib/helpContent.ts, components/screens/ProfileScreen.tsx, docs/ASHA_FIELD_GUIDE.md, README.md_

### 30. Centralize date/number formatting in a locale-aware lib/format.ts (~12 scattered en-IN call sites)
**Status:** PLANNED · **Effort:** S · **Doable by agent:** yes

VERIFIED: 12 toLocaleDateString/toLocaleString call sites across components/lib (grep count) with the en-IN pattern copy-pasted per file. Hermes on RN 0.81 ships Intl so hi-IN month names work natively; hi-IN keeps Latin digits by default (correct — cross-checking against paper registers); Indian lakh/crore grouping should apply to stat values. Impact adjusted high->medium: it is a localization enabler, not a user-facing defect on its own.

- Create lib/format.ts exporting formatShortDate, formatDateTime, formatNumber reading the active language from the i18n instance (en->'en-IN', hi->'hi-IN')
- Replace all call sites (grep: toLocaleDateString|toLocaleString under components/)
- Use Intl.NumberFormat('en-IN'/'hi-IN') for stat values so lakh grouping renders; keep tabular-nums intact
- Add date-fns/locale/hi only if relative time is wanted (date-fns 4.1.0 already a dependency)
- Verify on web and Android Hermes (spot-check hi-IN output)

_Files: lib/format.ts, components/charts/TrendChart.tsx, components/ai/AIInsightsPanel.tsx, components/dashboards/DashboardShared.tsx, components/screens/DashboardScreen.tsx, components/screens/MySubmissionsScreen.tsx, components/screens/ReportsScreen.tsx, components/screens/SyncOutboxScreen.tsx, components/screens/AdminManagementScreen.tsx_

### 31. Voice input (hi-IN speech-to-text) on symptoms and notes fields via expo-speech-recognition
**Status:** OWNER ACTION · **Effort:** M · **Doable by agent:** no (owner)

VALID as an evaluated adoption: the symptoms/notes free-text fields (verified in DiseaseReportForm ~line 397) are the biggest literacy barrier; everything else is tap-to-select chips. expo-speech-recognition drives Android's on-device SpeechRecognizer (hi-IN, offline with the Google Hindi pack) but requires RECORD_AUDIO and a NEW native build, and many low-end devices lack an on-device recognizer — feature-detection with typing fallback is mandatory. Impact adjusted high->medium: an enhancement, not a production blocker.

- npm install expo-speech-recognition; add its config plugin + RECORD_AUDIO usage strings to app.json
- Build components/shared/VoiceInputButton.tsx: 44dp mic Pressable that feature-detects recognizer availability and hides itself when unsupported
- Wire into symptoms/notes TextInputs of both report forms: start recognition with lang matching the app language, append final transcript, show a listening state (respect reduceMotion)
- No schema or sync-queue changes — transcription happens before enqueue
- OWNER: trigger an EAS preview APK build and field-test on a low-end device with and without the offline Hindi pack

_Files: package.json, app.json, components/shared/VoiceInputButton.tsx, components/forms/DiseaseReportForm.tsx, components/forms/WaterQualityReportForm.tsx_

### 32. 1.3x font-scale hardening: convert text-bearing fixed heights to minHeight and audit numberOfLines={1} for Hindi growth
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED SAMPLES: MainApp.tsx:648 createFab has fixed height:56 holding a text label, and 58 numberOfLines={1} sites exist across components (grep count matches the claim); the codebase is clean of allowFontScaling={false}. DESIGN_SPEC.md mandates minHeight-not-height at 1.3x scale. Devanagari matras + 15-30% longer strings make both clipping and truncation worse. Impact adjusted high->medium: cosmetic-to-a11y clipping, no data loss.

- Grep fixed heights under components/, classify icon-box (keep) vs text-bearing container (convert to minHeight) — confirmed sites include MainApp createFab, SubmissionModal, AdminManagementScreen, CampaignsScreen, ProfileScreen, ReportsScreen rows
- Audit the 58 numberOfLines={1} sites: keep for tabular numerals and SyncPebble, raise to 2 or remove for translatable labels
- Make letterSpacing conditional on language: spec's negative/eyebrow letterSpacing only when language === 'en'; 0 for Devanagari
- Verify includeFontPadding:false usages don't clip Devanagari top matras at Display sizes; gate on language if they do
- Manual pass: Android emulator at Font size Largest + Display size Large, walk DiseaseReportForm, dashboard, ProfileScreen, tab bar in en and hi

_Files: components/MainApp.tsx, components/shared/SubmissionModal.tsx, components/screens/AdminManagementScreen.tsx, components/screens/CampaignsScreen.tsx, components/screens/ProfileScreen.tsx, components/screens/ReportsScreen.tsx, components/shared/StatCard.tsx, components/dashboards/DashboardShared.tsx_

### 33. Close screen-reader gaps: TrendChart is silent to TalkBack; sweep icon-only touchables and map markers
**Status:** PLANNED · **Effort:** S · **Doable by agent:** yes

VERIFIED: components/charts/TrendChart.tsx contains ZERO accessibility props (grep count 0) — the SVG chart is skipped entirely by TalkBack even though the summary data (min/max/latest) is already computed. HealthMapComponent has 21 a11y occurrences but marker-level coverage needs verification against spec rule 19. Broad coverage elsewhere is good, so this is a targeted sweep, not a rewrite.

- TrendChart.tsx: wrap the chart in an accessible View with an accessibilityLabel built from the existing summary memo ('Case trend, N points: minimum X, maximum Y, latest Z'); set importantForAccessibility='no-hide-descendants' on the LineChart
- HealthMapComponent.tsx: verify each severity marker/callout exposes disease + count + severity in its label; add where missing
- Repo-wide sweep: Pressable/TouchableOpacity blocks containing only <Ionicons> without accessibilityLabel; fix hits
- Add accessibilityLabel to TextInputs in the four forms (the label-above pattern is visual only)
- Add scripts/a11y-lint.js grep script so regressions fail fast

_Files: components/charts/TrendChart.tsx, components/shared/HealthMapComponent.tsx, components/forms/DiseaseReportForm.tsx, components/forms/WaterQualityReportForm.tsx, components/forms/AlertForm.tsx, components/forms/CampaignForm.tsx, scripts/a11y-lint.js_

### 34. Low-literacy iconography: pictogram-paired selection chips, severity glyph ladder, and directive icons on alerts
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: SelectChip (DiseaseReportForm.tsx:31-60, read directly) renders only a label + checkmark — every selection in both report forms is text-only, so the form is unreadable for a low-literacy user even in Hindi. Ionicons has semantic matches for every category (water/cloud/bug/restaurant); icons add redundancy without replacing text, complying with the spec.

- Extend SelectChip with an optional icon prop (16dp Ionicons tinted to label color) and add icons to diseaseTypes, severityLevels (filled-bar ladder), and treatmentStatus arrays in both report forms
- Add an iconFor(diseaseType|severity|waterState) map in lib/ so forms, alert cards, and map callouts share one pictogram vocabulary
- AlertCard/AllAlertsScreen: prefix the plain-language directive line with its directive icon (boil water / avoid source / seek clinic)
- Keep chips within spec constraints: minHeight 44, solid fill on selection, checkmark stays
- Field-validate icon comprehension with 2-3 ASHA users before locking the vocabulary (process step)

_Files: components/forms/DiseaseReportForm.tsx, components/forms/WaterQualityReportForm.tsx, components/dashboards/DashboardShared.tsx, components/screens/AllAlertsScreen.tsx, components/shared/HealthMapComponent.tsx_

### 36. Hindi-capable AI surfaces: language-aware prompts for AIChatbot and AIInsightsPanel
**Status:** PLANNED · **Effort:** S · **Doable by agent:** yes

VERIFIED: lib/services/gemini.ts hardcodes an English-only system prompt (line 294) and the AIInsightsPanel promptMap (lines 248-252) likewise — after UI translation, AI answers would still arrive in English. The OpenRouter-proxied models handle Hindi natively; this is a prompt change only. AI is online-only by design, so no offline complication.

- Thread the active app language into geminiService calls (parameter or read from the i18n instance)
- When language === 'hi', append to the system prompt: respond in simple Hindi (Devanagari), disease names dual-script, same 3-4 sentence limit; users may write Hindi, Hinglish, or English
- Apply the same clause to the insights promptMap
- Translate the chatbot's static UI shell (greeting, placeholder, suggestion chips) via the phase-1 t() pass
- Confirm openrouter-proxy needs no change (it is a passthrough) by reading it during implementation

_Files: lib/services/gemini.ts, components/ai/AIChatbot.tsx, components/ai/AIInsightsPanel.tsx, supabase/functions/openrouter-proxy/index.ts_

### 42. Operations runbook + monitoring cadence (advisors, get_logs, release checks)
**Status:** DONE — docs/OPERATIONS.md runbook · **Effort:** S · **Doable by agent:** yes

VERIFIED: no markdown file in the repo mentions backups, incidents, monitoring, or crash handling. Advisor baseline re-confirmed today: 37 mutable-search_path functions, 9 SECURITY DEFINER views, 2 always-true RLS policies, leaked-password protection off, postgis+pg_net in public, plus 1 materialized view exposed to the API — this baseline will silently grow without a review cadence.

- Write OPERATIONS.md: weekly get_advisors review with the recorded known-issue baseline (so new findings stand out), post-release get_logs checks for postgres + both edge functions, EAS build verification, and the owner-pending key-rotation checklist
- Define alert-worthy signals: outbox failed-rate spike, client_error_logs volume, cron.job_run_details failures
- Add a scheduled cloud agent (schedule skill) or calendar entry running get_advisors + cron.job_run_details weekly, summarizing deltas for the owner
- Fold the backup/restore procedure and incident-playbook pointer into the same doc

_Files: OPERATIONS.md_

### 43. Structured client logger replacing ~130 scattered console.* calls
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VERIFIED: 130 console.log/warn/error calls across components/lib/src/App.tsx (grep count; proposal said 119 — same order) ship to production with ad-hoc tags, noisy on low-end Android and invisible after the fact; some interpolate user data. A tiny logger gives levels, __DEV__ gating, and a ring buffer that makes crash reports and user feedback actionable.

- Create lib/logger.ts: createLogger(module) with debug/info/warn/error; debug/info no-op unless __DEV__; all levels append {ts, level, module, msg} to a capped ring buffer (~200 entries, no payload objects to avoid PII retention)
- Expose logger.getRecent() and attach to client_error_logs inserts and optionally to user_feedback behind an explicit 'include diagnostics' checkbox
- Mechanically migrate the files (highest value first: OfflineSyncService, lib/services/*, App.tsx, DashboardScreen), preserving module tags
- Add a convention note: no raw console.* outside lib/logger.ts

_Files: lib/logger.ts, src/services/offlineSync/OfflineSyncService.ts, src/services/offlineSync/SyncQueue.ts, lib/services/users.ts, lib/services/diseaseReports.ts, App.tsx, components/screens/DashboardScreen.tsx_

### 44. Close the feedback loop: notify admins on new feedback, notify users on status change, drop dead policies
**Status:** PLANNED · **Effort:** S · **Doable by agent:** yes

VERIFIED LIVE: user_feedback has only an updated_at trigger — no notify triggers — so admins see feedback only if they open the dashboard and submitters never hear back on pending -> resolved. The table carries four dead legacy policies gated on get_my_role()='admin' (feedback_select/update/delete/insert variants confirmed in pg_policies) alongside the working feedback_admin_* ones, and the repo SQL still creates the legacy versions.

- Migration: AFTER INSERT trigger on user_feedback calling notify_users_push per admin role with category + first 80 chars (reuses the deployed outbox/edge pipeline)
- Migration: AFTER UPDATE OF status trigger pushing to the submitter: 'Your feedback was reviewed/resolved'
- Migration: DROP the dead get_my_role()='admin' policies; rewrite database_structure/USER_FEEDBACK_TABLE.sql to match live reality (coordinate with the schema-baseline drift sweep)
- Add a read-only 'My feedback' status list under the feedback form in ProfileScreen (RLS already permits own-row SELECT)

_Files: database_structure/USER_FEEDBACK_TABLE.sql, components/screens/ProfileScreen.tsx_

### 51. Deploy the web export and configure Supabase auth redirects for the hosted origin
**Status:** OWNER ACTION · **Effort:** M · **Doable by agent:** no (owner)

VERIFIED: dist/ exists but is gitignored and hosted nowhere, so 'also runs on web' has no URL; lib/supabase.ts sets detectSessionInUrl only on web, and signup email-confirmation links resolve against the project's Site URL — until the deployed origin is set, confirmation links strand users. The web deploy is also the natural host for the privacy-policy and deletion pages two other items require.

- Pick a static host: GitHub Pages via actions/deploy-pages keys off the existing repo
- Add .github/workflows/web-deploy.yml: on push to main, npm ci && npx expo export --platform web, upload dist/ as the Pages artifact (single index.html SPA, no rewrite rules needed)
- Copy static privacy.html and delete-account.html into dist/ before upload
- Owner: enable Pages, then set Supabase Auth URL Configuration: Site URL = deployed origin, add to Additional Redirect URLs
- Smoke-test on the hosted URL: signup confirmation round-trip, login, one dashboard per role, offline outbox behavior on web

_Files: .github/workflows/web-deploy.yml, lib/supabase.ts_

### 59. Stand up a week-1 APK distribution channel — Play's closed-testing gate means the store cannot be the launch path
**Status:** DONE — GitHub Releases is the distribution channel (CI publishes every APK) · **Effort:** M · **Doable by agent:** yes · missing-critical

Personal Play Console accounts must run a closed test with 12 testers for 14 continuous days before production access, so Play is structurally unavailable for a week-1 field deployment even if the listing were perfect. The repo builds preview APKs in CI (build-android-release.yml) but there is no distribution path for 100 ASHA workers: no stable download URL, no QR/install guidance for 'unknown sources', and no in-app binary version check — so the field ends up with a WhatsApp-forwarded zoo of stale APKs that no OTA (expo-updates covers JS only) can recall. The existing Play-checklist plan item covers store compliance, not how the app physically reaches users this week.

- Owner: start the Play closed-testing clock now so the 14-day requirement burns down in parallel
- Publish each tagged preview APK to a stable URL (GitHub Releases or EAS internal distribution) and generate a QR poster plus a short Hindi install guide covering the unknown-sources prompt
- Add a lightweight in-app version check (compare versionCode against a Supabase config row) that nags on outdated sideloaded builds
- Define in the runbook who hands the APK/QR to ASHA workers and how a bad binary gets recalled

_Files: D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\.github\workflows\build-android-release.yml, D:\Projects\Health-Drop-Surveillance-System-main\Health-Drop-Surveillance-System-main\eas.json_

## LOW (2)

### 25. Seed/demo data strategy plus first-action CTAs for a brand-new district
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

CORRECTED: the proposal claimed 0 campaigns and empty tables — live DB actually holds 6 profiles, 4 disease reports, 4 alerts, and 5 campaigns, so the 'empty states everywhere' premise is overstated. The residual value is real but smaller: no seed script exists (scripts/ contains only sync-version.cjs — verified), so trainings/demos for a NEW district have no safe, labeled sample data, and empty-state regions don't point at a first action. Impact downgraded to low.

- Create scripts/seed-demo.sql: idempotent inserts of demo content (reports, water tests, one campaign, one alert) under a fixed 'Demo District'/'Demo State' so RLS district scoping keeps it out of real districts; attribute rows to a dedicated demo reporter
- Add scripts/reset-demo.sql deleting only Demo District rows
- Wire role-specific first-action CTAs into existing EmptyState usages: ASHA/clinic 'Submit your first report', district_officer 'Invite your ASHA workers', health_admin 'Create your first campaign'
- Document in SETUP_GUIDE.md when to load demo data (training) and when not to (production go-live)

_Files: scripts/seed-demo.sql, scripts/reset-demo.sql, components/dashboards/DashboardShared.tsx, components/screens/DashboardScreen.tsx, SETUP_GUIDE.md_

### 45. Privacy-respecting product analytics: first-party minimal events, no third-party SDK
**Status:** PLANNED · **Effort:** M · **Doable by agent:** yes

VALID: no analytics exist anywhere. Users are government-adjacent health workers handling disease data on low-end Android — a third-party tracking SDK is a DPDP liability and a performance tax. Most product questions are already answerable from domain tables; only a thin funnel layer is missing.

- Migration: analytics_events table (enum-checked event_name: report_started, report_submitted, report_queued_offline, sync_failed, screen_view; role, district, platform, app_version, created_at — deliberately no user_id); INSERT-only for authenticated, SELECT for admins
- lib/services/telemetry.ts: fire-and-forget batched insert (flush every 30s or 20 events via the existing NetInfo listener), dropped offline beyond a small cap; respect an analytics_opt_out AsyncStorage flag with a ProfileScreen toggle
- Instrument the 4 forms and MainApp screen switches only — no per-tap tracking
- Add a pg_cron purge of events > 180d to CRON_JOBS.sql

_Files: database_structure/ANALYTICS_EVENTS.sql, lib/services/telemetry.ts, components/screens/ProfileScreen.tsx, components/MainApp.tsx_



---

_Statuses reconciled against the live project and repository on 2026-07-31._
