# HealthDrop — Refinement Plan

**Audience:** an AI agent or engineer with full repository and database access who has never seen this
codebase. Everything below is evidence-backed. Every claim carries a `file:line` citation or the SQL
that produced it. Where a judgement is debatable, the trade-off is stated instead of hidden.

**Audit date:** 2 August 2026 · **Repo:** `github.com/tripathiayushman/healthdrop` (branch `main`) ·
**Live Supabase project:** `ekfdimdlxifatsaubvbh`

**Ground rule for anyone working from this document:** do not restate a fix as done until you have
re-run the evidence. Several items below exist *because* a `PRODUCTION_READINESS.md` item was marked
**DONE** while the code or the database never changed. That failure mode is the single most expensive
pattern in this project's history and it is called out item by item.

---

## 1. Context

### 1.1 What HealthDrop is

A cross-platform (Android-first) disease-outbreak and water-quality surveillance app for rural India,
built with Expo SDK 54 / React Native 0.81 / React 19 / TypeScript 5.9 on Supabase (Postgres + RLS +
Edge Functions). Size, measured from the git index:

| Metric | Value | How measured |
| --- | --- | --- |
| Tracked files | 174 | `git ls-files \| wc -l` |
| Tracked `.ts`/`.tsx` | 93 | `git ls-files '*.ts' '*.tsx' \| wc -l` |
| Source lines | 43,453 | `git ls-files '*.ts' '*.tsx' \| xargs wc -l` |
| Screens | 21 | `ls components/screens` |
| Services | 22 | `ls lib/services` |
| Edge functions deployed | 4 (`bright-action`, `openrouter-proxy`, `push-notifications`, `delete-account`) | `list_edge_functions` |
| Edge functions in repo | 2 (`openrouter-proxy`, `push-notifications`) | `ls supabase/functions` |
| RLS policies | 99 | `select count(*) from pg_policies where schemaname='public'` |

### 1.2 The mission loop

A symptom becomes a field report → **a human official verifies it** → an alert reaches exactly the
people affected → action closes the loop (treatment follow-up, water-source retest).

Automation may accelerate detection and delivery. **It must never speak to the public.** Public alerts
are human-approved, always. Several findings in §3 and §4 are violations of exactly this rule.

### 1.3 Who the users are

Six roles, live counts from `select role, count(*) from profiles group by role`:

| Role | Live accounts | District(s) on file |
| --- | --- | --- |
| `super_admin` | 2 | Moolacheri, Moolacheri |
| `health_admin` | 1 | `chennai` (lowercase — matches nothing else) |
| `district_officer` | 1 | Chengalpattu |
| `clinic` | 1 | Kovilancheri |
| `asha_worker` | 1 | Chengalpattu |
| `volunteer` | 2 | Moolacheri, `Not specified` |

**The primary persona is the ASHA worker**: a community health worker on a low-end Android phone, in
sunlight, on a flaky rural network, whose first language is Hindi. Every design and engineering
decision is judged against her. When a trade-off is close, resolve it in her favour.

### 1.4 Owner constraints (hard — do not propose plans that violate these)

| Constraint | Consequence for your work |
| --- | --- |
| **Not publishing to the Play Store.** Distribution is an APK via GitHub Releases, built by CI on every push to `main` (`.github/workflows/build-on-push.yml`). | No Play policy work. No app-bundle lane. `PRODUCTION_READINESS.md` #47 and #50 are correctly marked NOT APPLICABLE. |
| **Not paying for Supabase Pro.** Free tier: no managed backups, no PITR. An encrypted daily `pg_dump` runs in CI instead (`.github/workflows/db-backup.yml`). | Assume free-tier limits everywhere: 500 MB database ceiling, statement timeouts, no read replicas. Every proposal must be affordable at zero marginal cost. |
| **Mobile Android is what matters.** Web exists only as a build target / inspection tool. | Web-only regressions are low priority; Android regressions are not. |
| **Bilingual: English + Hindi.** Phase 1 covers field-worker chrome. | New field-worker UI ships with `t()` keys in both locales or it does not ship. |

### 1.5 Where the project actually stands

`PRODUCTION_READINESS.md` holds 59 items. Counting the status lines
(`grep -o "^\*\*Status:\*\* [A-Z ]*" PRODUCTION_READINESS.md | sort | uniq -c`):

| Status | Count |
| --- | --- |
| DONE | 27 |
| PLANNED | 21 |
| OWNER ACTION | 5 |
| PARTIAL | 3 |
| NOT APPLICABLE | 2 |
| DEFERRED | 1 |

So **30 of 59 items are open**, not the ~26 sometimes quoted. More importantly, **at least seven items
marked DONE are not done**, each verified below: #3 (campaigns SELECT still `USING true`), #4
(`mv_campaign_effectiveness` still granted to `authenticated`), #5 (`.env.example` still advertises a
client OpenRouter key), #19 (`expo-blur` still in `package.json`), #28 (water form never translated),
#39 (alert-push approval gate never added), #53 (`resolve_outbreak` still keys on `'admin'`), #57
(approval-time detection trigger never added), #58 (unsafe-water notification aborts on every run).
Treat the readiness tracker as a to-do list, never as evidence.

**What genuinely works today**, verified: offline write queue with idempotency keys
(`src/services/offlineSync/SyncQueue.ts`), the token/contrast design system (0 hex literals in
`components/**/*.tsx`), Hindi on the disease-report path, push delivery plumbing (outbox + edge
function + a retry cron with 0 failed runs), the daily encrypted backup, the APK build-and-release
pipeline, email-OTP password reset, and the four-state discipline on most field-worker screens.

**What does not work today**, verified below and summarised here because it is the honest headline:

- A district officer **cannot approve a disease report** — every `UPDATE` on `disease_reports` is
  silently discarded by `trg_conflict_disease`, and the UI shows a success toast (§4, BRK-01).
- An ASHA worker **cannot file a "safe" or "critical" water reading** — three contradictory CHECK
  constraints make four of the six vocabulary values un-insertable (§4, BRK-02).
- **Nobody is notified when water is reported unsafe** — the trigger writes a `related_type` its own
  CHECK constraint forbids, and swallows the error (§4, BRK-03).
- **Outbreak detection never fires for ASHA or volunteer reports** — the trigger is INSERT-only and
  gated on `approved`, and field reports insert as `pending_approval` (§4, BRK-04).
- **Anyone holding the app's publishable key can grant themselves admin** and **push arbitrary text to
  every handset in the system**, unauthenticated (§3, SEC-01 and SEC-02).

In other words: the mission loop is severed in four separate places, and the front door is open. The
app looks finished and is not.

---

## 2. How to work in this codebase

### 2.1 Layout you need to know

```text
App.tsx                     auth/session shell, offline profile cache, push registration
components/MainApp.tsx      tab shell + role-gated screen routing (SCREEN_PERMISSIONS, CREATE_PERMISSIONS)
components/dashboards/      one dashboard per role + DashboardRouter + DashboardShared (the UI kit)
components/screens/         21 sub-screens
components/forms/           disease / water / campaign / alert forms
components/shared/          map, inputs, badges  (HealthMapComponent + a 163 KB vendored Leaflet blob)
lib/ThemeContext.tsx        Bharosa design tokens — the single source of truth for colour/space/radii
lib/services/               22 data services
lib/i18n/                   i18next + locales/en.json, locales/hi.json
src/services/offlineSync/   SyncQueue (AsyncStorage) + OfflineSyncService
supabase/functions/         openrouter-proxy, push-notifications  (2 of the 4 deployed)
database_structure/         17 historical .sql scripts — NOT tracked by git (see BRK-24)
scripts/check-contrast.cjs  the CI design gate
```

There is **no `supabase/migrations/` directory** (`ls supabase` → `functions` only) and no
`supabase/schema.sql` yet — `.github/workflows/schema-snapshot.yml` will create one weekly but only if
the `SUPABASE_DB_URL` secret is set. Until then the live database is the only authority on schema.
Apply DDL through `mcp__claude_ai_Supabase__apply_migration` and **also** commit the SQL, once
`database_structure/` is un-ignored (BRK-24).

### 2.2 The design law — "Bharosa"

Calm paper, ink, one teal. Colour is spent only on meaning: the severity ladder, the water ladder, the
sync truths, and a reserved AI violet. Tokens live in `lib/ThemeContext.tsx` and theme keys are never
renamed.

Rules that are **already enforced and must not be regressed**:

| Rule | Current state (verified) |
| --- | --- |
| Zero hex literals or `rgba()` in components | `grep -rn "'#[0-9A-Fa-f]\{3,8\}'" --include=*.tsx components \| grep -v leafletAssets \| wc -l` → **0**; same for `rgba(` → **0** |
| Body text ≥ 7:1 contrast, secondary ≥ 4.5:1 | Guarded by `scripts/check-contrast.cjs` (16 token pairs × 2 themes), run in CI at `build-on-push.yml:51-52` |
| Four states per data region: skeleton / content / quiet-zero / error-with-retry | Honoured on field-worker screens; **violated systematically** in `lib/services/advancedAnalytics.ts` (BRK-13) |
| No silent catch-and-show-zero | Violated in `advancedAnalytics.ts:163-192` and in three DB functions with `EXCEPTION WHEN OTHERS` (BRK-03, SEC-11) |
| No `Alert.alert` for form validation | Holding |
| 48 dp touch targets | Holding |
| Offline-first with a visible sync ledger | True for **writes**. False for **reads** — see INC-05 |

`DESIGN_SPEC.md` describes the *previous* iteration ("Prakash"). Bharosa superseded it. When they
disagree, `lib/ThemeContext.tsx` and the shipped screens win.

### 2.3 The human-approval boundary

This is not a style preference, it is the product's reason to exist. Concretely:

1. Nothing that reaches a member of the public — a push notification, a poster, an SMS — may be
   produced by a trigger, a cron job, an LLM, or any code path that has not passed through an explicit
   human decision recorded in the database with `approved_by` and `approved_at`.
2. AI output is always labelled and never authoritative. The design system already has the component
   for this — `AILabel` in `components/dashboards/DashboardShared.tsx:935`, whose
   `accessibilityLabel` reads *"AI inferred — not a verified fact"* — and neither AI surface uses it
   (DEL-11).
3. When you add a trigger that sends anything, gate it on the **approval transition**, never on raw
   INSERT. `push_on_report_approved()` is the correct pattern to copy; `push_on_alert_created()` is
   the anti-pattern to fix (SEC-07).

### 2.4 Offline-first rules

- Writes go through `src/services/offlineSync/SyncQueue.ts`. Every queue table has a
  `client_idempotency_key` unique constraint, so a retry of the same queue item cannot double-insert.
- **A second, hand-filed report is not a retry** and will not be deduplicated. This is why hiding
  queued items from "My Submissions" (BRK-14) actively causes duplicate data.
- Do not add a new writable surface without a queue path. Do not add a new read surface that shows an
  error card where a cached answer would do (INC-05).
- `AsyncStorage.setItem` currently has 17 call sites; the only *content* caches are the AI chat
  transcript (`components/ai/AIChatbot.tsx:112`) and the AI insights payload
  (`components/ai/AIInsightsPanel.tsx:132`). Alerts, submissions and water sources are not cached.
  That priority ordering is backwards and is INC-05.

### 2.5 i18n expectations

Exactly nine files call `useTranslation`
(`grep -rln "useTranslation" --include=*.tsx --include=*.ts components src lib App.tsx`):

```text
components/MainApp.tsx            components/ai/AIChatbot.tsx
components/ai/AIInsightsPanel.tsx components/dashboards/AshaWorkerDashboard.tsx
components/dashboards/VolunteerDashboard.tsx
components/forms/DiseaseReportForm.tsx
components/forms/ReportTypeSheet.tsx
components/screens/ProfileScreen.tsx
components/screens/SyncOutboxScreen.tsx
```

`en.json` and `hi.json` match key-for-key (172 keys, 8 namespaces) with one extra key in `hi.json`:
`_note` = *"Machine-drafted Hindi — needs native-speaker review before public launch"*. That contradicts
`PRODUCTION_READINESS.md` #29 ("natively reviewed by the owner") and agrees with `README.md:131`.
Resolve the contradiction before claiming Hindi is reviewed.

**Rule:** any new or edited field-worker surface ships with `t()` keys in both locales. Admin-only
surfaces may stay English for now — that is a declared phase boundary, not a defect. The water-quality
form is a field-worker surface and is the one real gap inside a DONE item (INC-07).

### 2.6 THE VERIFICATION BAR

This project has already shipped one catastrophic visual regression: a near-black light-mode header
with ~1.5:1 title contrast, because the only visual check anyone ever took was a screenshot of the
**sign-in screen** — nobody logged in. The comment at `scripts/check-contrast.cjs:5-13` records it.

Treat **"was this actually verified end to end, logged in, as the affected role?"** as a first-class
question about your own work and about every claim in this document.

**Commands that exist today and must pass:**

```bash
npm run verify          # == node scripts/check-contrast.cjs && tsc --noEmit
npm run check:contrast  # token contrast gate alone (also runs in CI)
npx tsc --noEmit        # type gate alone
```

CI runs the contrast gate at `.github/workflows/build-on-push.yml:51-52` on every push to `main`, then
builds the APK on EAS and publishes a GitHub Release. There is no other automated gate.

**The login-tour harness described in this project's lore does not exist in the repository.** Verified:

```bash
grep -rn "playwright" -i .            # → 0 matches anywhere, including package-lock.json
ls e2e tests test __tests__           # → no such directories
node -p "require('./package.json').scripts"
# → { start, android, ios, web, tunnel, "check:contrast", verify }  — no test script
```

There is **no test runner, no unit test, no E2E test, and no visual regression check in this repo.**
Anyone who told you a Playwright role-tour harness guards this codebase was describing an intention.
Building it is **Phase 0, item one** of the roadmap in §8, and until it exists the following manual bar
applies and is not negotiable:

**Manual verification bar (until the harness lands):**

1. `npm run verify` passes.
2. You **log in as every role your change touches** — not one, all of them — and walk the affected
   screens. `super_admin` seeing a screen is not evidence that `asha_worker` can reach it; six
   findings in §5 are exactly that mistake.
3. You check both themes (in-app dark toggle in Profile) and both languages where the surface is
   translated.
4. At 360 px and 412 px width. No horizontal scroll on the page body.
5. For anything touching the database, you **reproduce the before-state and the after-state with SQL**
   and paste both. "The code looks right" is not verification — BRK-01 is a trigger that returns
   `OLD`, so the client sees `rowcount=1` and a green toast while nothing is written.
6. For anything touching push, you check `push_notification_outbox` for a row, not just the absence of
   an error.

**Anti-pattern to never repeat:** marking a `PRODUCTION_READINESS.md` item DONE because the playbook,
the doc, or half the fix landed. Seven items are currently wrong this way (§1.5).

---

## 3. Security

Ranked by severity, then blast radius. Every grant and policy below was re-confirmed against the live
database on 2 Aug 2026.

| ID | Finding | Severity | Effort |
| --- | --- | --- | --- |
| SEC-01 | `create_admin_user()` is an unauthenticated privilege-escalation RPC | **Critical** | S |
| SEC-02 | `notify_users_push()` is anon-executable — anyone can push to every handset | **Critical** | S |
| SEC-03 | Geo/summary RPCs hand the surveillance dataset to anonymous callers | High | M |
| SEC-04 | Stored XSS into the map WebView via free-text report fields | High | S |
| SEC-05 | `role_verified` gates nothing: a self-declared clinic holds real authority | High | M |
| SEC-06 | Surveillance free text goes to OpenRouter; the consent toggle gates only a first name | High | M |
| SEC-07 | An unapproved alert push-notifies the whole district on raw INSERT | High | S |
| SEC-08 | Volunteers and clinics read approved reports from every district | Medium | S |
| SEC-09 | `notifications` policy leaks any NULL-`target_role` row to every user | Medium | S |
| SEC-10 | `openrouter-proxy` is an open LLM relay with attacker-chosen model | Medium | S |
| SEC-11 | The anon JWT is hardcoded in two DB functions under the name `service_role_key` | Medium | S |
| SEC-12 | `update_push_outbox_status()` is anon-callable — targeted push suppression | Low | S |
| SEC-13 | `mv_campaign_effectiveness` is readable by every authenticated user | Low | S |
| SEC-14 | Live third-party keys in the working tree; `mesc/info.txt` holds a service_role JWT | Low | S |
| SEC-15 | Legacy `campaigns` table readable by `anon`; readiness #3 wrongly claims a fix | Low | S |
| SEC-16 | Two edge functions run with the service-role key and are not in git | Low | M |

### SEC-01 — `create_admin_user()` is an unauthenticated privilege-escalation RPC · Critical

**Evidence.** `pg_get_functiondef` shows `create_admin_user(admin_email text)` is `SECURITY DEFINER`,
`SET search_path TO 'public'`, and its entire body is:

```sql
UPDATE profiles SET role='admin', is_active=true WHERE email = admin_email;
```

with no caller check of any kind. Grants, re-confirmed 2 Aug 2026:

```sql
select has_function_privilege('anon', p.oid,'EXECUTE'), has_function_privilege('authenticated', p.oid,'EXECUTE')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='create_admin_user';
-- → true, true
```

A live unauthenticated probe using only the publishable key hardcoded at `lib/supabase.ts:13`
(`sb_publishable_pne9mF-cDQ_IPKJKn8a3AQ_Vm4Aa5x0`) — `POST /rest/v1/rpc/create_admin_user` with
`{"admin_email":"no-such-user-audit-probe@example.invalid"}` — returned **HTTP 400** with
`{"code":"P0001","message":"User with email ... not found"}`. It executed past every authorization gate
and stopped only because the row did not exist. Origin: `database_structure/APPROVAL_SYSTEM.sql:416`.
The app never calls it (`grep` finds zero call sites).

**Impact.** Anyone who unpacks the APK can flip any profile to `role='admin', is_active=true`. No
profile holds `'admin'` today, but that role still carries live policies: *Admin full access
audit_logs* (ALL — including DELETE, i.e. destroying the record of who approved what), *Admin full
access outbreaks* (ALL), *Admin manage outbreak_thresholds* (ALL — silently retune detection),
`campaigns_delete`, and `feedback_select/update/delete`. It also satisfies
`dispatch_push_notification`'s allowlist and `notify_users_push`'s district bypass. `App.tsx:51-53`
maps `'admin'` → `health_admin`, so the client hands the attacker an admin dashboard. Aimed at a known
official's address, the same call **overwrites their real role**: a `super_admin` becomes `'admin'` and
loses every super-admin-only policy. `is_active=true` also un-deactivates any account an admin just
disabled.

**Fix.** `DROP FUNCTION public.create_admin_user(text);` — role promotion already has a proper path
(`profiles_super_admin_update` + `role_invitations`, honoured by `handle_new_user`). Then audit
`profiles` for any row with `role='admin'` or an unexpected `is_active` flip. As a blanket fix for the
whole class: `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;` then re-GRANT
only the handful the client calls (`claim_push_token`, `update_push_outbox_status` for the edge
function's service role, and the geo RPCs once they are authenticated — see SEC-03), plus
`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` so the next helper
does not inherit `PUBLIC EXECUTE`. Add a regression test asserting
`has_function_privilege('anon', …) = false` for every `SECURITY DEFINER` routine.

### SEC-02 — `notify_users_push()` is anon-executable with zero authorization · Critical

**Evidence.** The full body read from `pg_proc` contains no caller check. It loops
`profiles p JOIN LATERAL (user_push_tokens ∪ p.expo_push_token)` over every `p.is_active = TRUE` row
(all three target parameters default NULL = everyone), inserts a `pending` row per token into
`push_notification_outbox`, then `net.http_post`s to the `push-notifications` edge function.
`has_function_privilege('anon', …, 'EXECUTE')` → **true**, same for `authenticated` (re-confirmed
2 Aug 2026, same query as SEC-01).

The edge function's own security model
(`supabase/functions/push-notifications/index.ts`) is "refuse any token without a PENDING row — rows
only the trusted DB layer creates". **That trusted layer is public**, so the gate is self-defeating.
`dispatch_push_notification` *does* check the caller
(`IF v_caller_role NOT IN ('admin','super_admin','health_admin') THEN RAISE EXCEPTION`) but it is only a
wrapper; the inner function is directly REST-callable one level down.

**Impact.** An unauthenticated caller supplies a title and body and delivers them to every active
user's device, with `triggerType 'alert_created'` routing to the high-priority `health-alerts` Android
channel. That is a fake public-health alert — *"the water in your village is poisoned"*, or the inverse
*"the outbreak alert was a mistake"* — delivered by the real app, with no human in the loop. It breaks
the project's central law. `PRODUCTION_READINESS.md:156` already records that no retraction path
exists. The return value (token count) also leaks the size of the user base.

**Fix.** `REVOKE EXECUTE ON FUNCTION public.notify_users_push(...) FROM anon, authenticated;` — the
triggers (`push_on_alert_created`, `push_on_report_approved`, `notify_on_unsafe_water`) and
`dispatch_push_notification` keep working, because `SECURITY DEFINER` routines execute as owner and
trigger bodies do not need REST grants. Then add defence in depth inside the function
(`IF auth.uid() IS NOT NULL AND get_my_role() NOT IN (...) THEN RAISE EXCEPTION`) so an ambient grant is
never the only thing between a stranger and every handset. Add a CI check that POSTs the RPC with the
anon key and asserts 401/403.

### SEC-03 — SECURITY DEFINER geo/summary RPCs bypass every RLS policy · High

**Evidence.** Reproduced live with only the publishable key from `lib/supabase.ts:13`, no session:

```text
POST /rest/v1/rpc/get_disease_reports_near {"p_latitude":12.68,"p_longitude":79.98,"p_radius_km":500}
→ HTTP 200, four real rows, e.g.
  {"disease_name":"Malaria","severity":"high","cases_count":133,"deaths_count":2,
   "district":"Kovilancheri","state":"Tamil Nadu","latitude":12.84272120,"longitude":80.15637650}
```

The function is `SECURITY DEFINER` with no `auth.uid()` check — it filters only on
`approval_status='approved'` — and the radius is caller-supplied, so a grid of calls sweeps the country.
`anon` EXECUTE confirmed **true** for `get_disease_reports_near`, `get_water_reports_near`,
`get_district_health_summary(integer)` and `get_disease_heatmap_geojson` (re-confirmed 2 Aug 2026).

Separately the table itself leaks: `GET /rest/v1/health_alerts?select=id,title,contact_person,contact_phone,district`
with the same key → HTTP 200, all 4 alerts including `contact_person` and `contact_phone`, because
`alerts_select` is granted to role `public` with qual `approval_status='approved' OR ...`. By contrast
`disease_reports_select` requires an active profile on every branch, so anon gets nothing from the
table directly — **the RPC is the whole bypass.**

**Impact.** Every approved disease report is retrievable by anyone holding the APK's key: disease,
severity, case and death counts, district, and eight-decimal latitude/longitude. In a rural district
that resolves to the house or the handpump the ASHA worker stood at. The table also carries
`age_group`, `gender`, `symptoms` and `notes`, so the RPC is one column change from leaking those too.
"Which village has cholera" is exactly the information that gets water sources vandalised, families
ostracised and reporting suppressed — reachable without an account, without the app, and with no log
tying it to a person. The named official's mobile number on every alert is a direct harassment vector.

**Fix.** `REVOKE EXECUTE ON FUNCTION get_disease_reports_near, get_water_reports_near,
get_district_health_summary, get_disease_heatmap_geojson FROM anon;` plus
`IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;` and a district predicate
matching the table's RLS. Better still, mark them `SECURITY INVOKER` so RLS applies naturally — they
need definer rights only for PostGIS, which invoker also has. Then decide whether raw lat/long should
leave the server for non-admin roles at all: `HealthMapComponent.tsx` already averages coordinates per
district (`groupByDistrict`, ~line 358-372), so district-level aggregates would suffice. For
`health_alerts`, restrict `alerts_select` to role `authenticated` and drop `contact_phone` from what
non-officials can read.

**Trade-off.** Making the geo RPCs authenticated breaks any future public dashboard. There is no such
dashboard today and none in `ROADMAP_FEATURES.md`; the owner should confirm before this is treated as
irreversible.

### SEC-04 — Stored XSS into the map WebView · High

**Evidence.** `components/shared/HealthMapComponent.tsx:458` builds `const markersJs = JSON.stringify(markers);`
and line 547 interpolates it **inside a `<script>` element**: `var markers = ${markersJs};`.
`JSON.stringify` does not escape `<` or `/`, so a value containing `</script>` terminates the element in
the HTML parser before any JS runs — the `escapeHtml()` defined at :551-558 and applied at :582-584
executes too late to matter.

Marker fields come straight from the database: `buildDiseaseMarkers` passes `r.disease_name` as the
label (:390) and `r.district` as the group key (:363, :372). `disease_name` is free text via the
"Other…" branch (`components/forms/DiseaseReportForm.tsx:255` `customDisease`, resolved at :380
`resolvedDiseaseName`), and `pg_constraint` confirms `disease_reports` has CHECKs on `disease_type`,
`severity`, `deaths_count` and lat/long but **none on `disease_name`**. The disease layer renders only
approved rows — and a self-declared clinic's own reports auto-approve
(`auto_approve_reporter_id_report`, verified in `pg_proc`), so one account controls the whole chain.

Sinks, both verified in the file:

```tsx
// native  (HealthMapComponent.tsx:670-679)
<WebViewComponent originWhitelist={['*']} source={{ html }} javaScriptEnabled domStorageEnabled
  onMessage={...} />
// web     (HealthMapComponent.tsx:687-692)
<iframe srcDoc={html} sandbox="allow-scripts allow-same-origin" />
```

For a `srcDoc` frame, `allow-same-origin` is *the parent's own origin* — and `lib/supabase.ts:16-41`
stores the Supabase access and refresh tokens in `localStorage` on web.

**Impact.** One malicious report poisons the map for every user who opens that layer — including the
district officer and health admin whose sessions are the most valuable. On web it is straightforward
session theft. On Android it is arbitrary JS inside the WebView: exfiltrate the visible surveillance
data, or `postMessage`-spoof the app's own tiles-offline channel (`onMessage` at :675-677). Nothing in
the four-states or offline work touches this; the map has never been tested with hostile content.

**Fix.** Stop interpolating data into script source. Either serialize with a `</` → `<\/` escape (plus
`<!--` and U+2028/2029), or better, move the payload out of executable context entirely:

```html
<script type="application/json" id="markers">…</script>
<script>var markers = JSON.parse(document.getElementById('markers').textContent);</script>
```

Drop `allow-same-origin` from the iframe sandbox — the frame needs no origin privileges. Narrow the
native WebView's `originWhitelist` and disable file access. Add a unit test that builds the HTML from a
marker whose district is `</script><script>alert(1)</script>` and asserts the string never appears
unescaped.

### SEC-05 — `role_verified` gates nothing, so a self-declared clinic holds real authority · High

**Evidence.**

```sql
select count(*) filter (where qual ilike '%role_verified%' or with_check ilike '%role_verified%'),
       count(*) from pg_policies where schemaname='public';
-- → 0 of 99   (re-confirmed 2 Aug 2026)
```

`profiles.role_verified` exists `NOT NULL DEFAULT false` and `handle_new_user` sets
`v_verified := (v_role = 'volunteer')` for self-signup — so a clinic starts unverified — and **nothing
reads the column.** `components/AuthScreen.tsx:52-56` offers Clinic in `SIGNUP_ROLES`; :563 passes it
into `signUp` metadata; `profiles_insert_policy` accepts
`role = ANY (ARRAY['clinic','asha_worker','volunteer'])`.

Consequences, read from `pg_proc`/`pg_policies`: `auto_approve_alert_fn` (BEFORE INSERT on
`health_alerts`) sets `approval_status='approved'` when the creator's role is in
`('super_admin','health_admin','clinic','district_officer')`, and `trg_push_on_alert_created` (AFTER
INSERT, **no WHEN clause** — verified in `pg_trigger`) then fans out district-wide;
`auto_approve_reporter_id_report` does the same for the creator's own disease/water reports;
`disease_reports_clinic_update` lets a clinic UPDATE any report in its district *including*
`approval_status`; `alerts_update` lets `role IN ('super_admin','health_admin','clinic')` UPDATE **any**
health alert with **no district predicate at all**.

**Impact.** Sign up with any email, tick "Clinic", and the database treats you as a verified health
facility from the first second: post an alert that approves itself and pushes to every phone in a
district within seconds, approve your own fabricated disease reports, and edit any other district's
alert. The in-app verification queue (`components/screens/UserManagementScreen.tsx`) changes a badge,
not an authority. Same class of failure as the near-black header: the control exists in the UI and was
never verified at the API boundary.

**Note on scope.** `PRODUCTION_READINESS.md` #20 (PLANNED, open) already covers the *data-visibility*
half of this — verbatim, that anyone can sign up as Clinic and read unapproved district reports. What
is filed here is the part #20 does **not** address: auto-approval, auto-push, cross-user approval
flipping, and the unscoped `alerts_update`. Also note #20's remediation adds a **new**
`verification_status` column, which would leave `role_verified` dead. **Reuse `role_verified`.**

**Fix.** (a) require `role_verified = true` *in addition to* role inside `auto_approve_alert_fn` and
`auto_approve_reporter_id_report`, so an unverified account's alerts and reports stay pending;
(b) add `role_verified` to the clinic/district_officer branches of the `*_update` policies; (c) scope
`alerts_update` by district; (d) consider removing `clinic` from `SIGNUP_ROLES` and provisioning it
only through `role_invitations`, which already exists and is admin-only.

### SEC-06 — Real surveillance content goes to OpenRouter; consent gates only a first name · High

**Evidence.** `components/ai/AIInsightsPanel.tsx:237-241` calls `loadInsights()` from a mount
`useEffect`. The panel renders on every role's home dashboard: `AshaWorkerDashboard.tsx:244` and
`SuperAdminDashboard.tsx:194` unconditionally; `ClinicDashboard.tsx:194`,
`DistrictOfficerDashboard.tsx:315` and `HealthAdminDashboard.tsx:215` behind
`isWidgetVisible('ai_insights')`, which is a **layout preference, not consent**.

`loadInsights` selects live alert `title, urgency_level, disease_or_issue, description, district`,
disease `disease_name, severity, district, symptoms` and water `overall_quality, ph_level, source_name,
district` (`AIInsightsPanel.tsx:87-92`) and passes them to `getAIInsights`, which renders them into the
prompt (`lib/services/gemini.ts:100` interpolates `${a.title}: ${trim(a.description)}`, :112 the water
source name) and posts to OpenRouter via `callProxy` (:180-192). **There is no consent prompt anywhere
on this path.**

In the chatbot, the *only* read of the consent flag in the entire codebase is
`lib/services/gemini.ts:263`:

```ts
const userDisplayName = userContext.consentToExternalProcessing ? (userContext.fullName ?? 'user') : 'user';
```

Verified by grep — `consentToExternalProcessing` appears at `AIChatbot.tsx:75`, `:147`, `:295`,
`gemini.ts:256` (the parameter) and `gemini.ts:263` (this line), and nowhere else.
`AIChatbot.tsx:129-160` sends the typed message plus role and district regardless, and the composer is
`editable={!isTyping}` (:350), so it is not disabled while consent is still `null`.

**Impact.** Outbreak-sensitive free text — alert descriptions, disease names, symptoms, whatever the
ASHA worker types about a patient — leaves the country to a US LLM aggregator automatically, before
anyone has been asked. The consent card is decoration: tapping **Decline** still transmits the message
body; it only stops the user's *name* being included. For a user who cannot read the policy, a consent
control that does not control anything is worse than none. `PRODUCTION_READINESS.md` #7 covers
*writing* a privacy policy (DEFERRED); it does not cover the fact that the implemented consent gate is
inert.

**Fix.** Make consent a real gate: block `getChatResponse` and `getAIInsights` until `consent === true`,
disable the composer and show the AI panel's quiet-zero state otherwise, and persist the decision
**per user** (it is currently an AsyncStorage key, i.e. per device). Strip free text before egress —
send counts, severity buckets and district names only, never alert descriptions or symptoms. Bring the
AI panel into the consent decision explicitly; today only the chat asks.

### SEC-07 — An unapproved alert push-notifies the whole district on raw INSERT · High

**Evidence.** From `pg_trigger` (re-confirmed 2 Aug 2026):

```text
CREATE TRIGGER trg_push_on_alert_created AFTER INSERT ON public.health_alerts
  FOR EACH ROW EXECUTE FUNCTION push_on_alert_created()
```

No `WHEN` clause. The function body has **no approval check** — it unconditionally calls
`notify_users_push(… p_target_district := NEW.district)` with title `'🚨 Health Alert: ' || NEW.title`.
`auto_approve_alert_fn()` (BEFORE INSERT) correctly stamps `pending_approval` for any creator outside
`('super_admin','health_admin','clinic','district_officer')` — but that only governs *in-app
visibility*, because `alerts_select` hides non-approved rows from everyone except
super_admin/health_admin/clinic and the author.

Reproduced (rolled back): inserting a `health_alerts` row with `created_by` = the live `asha_worker`
profile produced `approval_status=pending_approval` **and** `push_outbox_rows=1`. A push was queued for
an alert no official had approved.

**Honest scoping — this matters.** An ASHA worker **cannot reach the alert form in the shipped app**:
`components/MainApp.tsx:92` restricts `'new-alert'` to `['super_admin','health_admin','district_officer']`
and `AlertForm` is rendered only at `MainApp.tsx:371` behind that gate. Every role that can reach the
form auto-approves, and all 4 live `health_alerts` rows are `approved`. The residual exposure is the
**API**: RLS `alerts_insert` permits `asha_worker` to INSERT directly. `AlertForm` still carries a dead
`isAshaWorker` branch (:292, :326, :350) written for a path that no longer exists, and its success copy
at :349-355 tells the worker *"health officials will be notified … it will appear inside the app after
approval"* — while, on the API path, every phone in the district has already buzzed.

**Impact.** The human-in-the-loop guarantee holds today **by navigation permission alone**. One line
added to `CREATE_PERMISSIONS`, or one direct REST call from any asha_worker account, turns an unreviewed
alert into a district-wide push seconds after insert, with no recall lever — rejection stops in-app
visibility but cannot recall a delivered push.

**Fix.**

```sql
DROP TRIGGER trg_push_on_alert_created ON public.health_alerts;
-- push when an alert becomes approved, whichever way it gets there
CREATE TRIGGER trg_push_on_alert_approved
  AFTER INSERT OR UPDATE OF approval_status ON public.health_alerts
  FOR EACH ROW
  WHEN (NEW.approval_status = 'approved'
        AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved'))
  EXECUTE FUNCTION push_on_alert_created();
```

Add a separate admin-only notification telling reviewers an alert is waiting. Then delete the dead
`isAshaWorker` branch in `AlertForm`, or restore ASHA alert-raising deliberately once the trigger is
gated. **Reopen `PRODUCTION_READINESS.md` #39** — its checklist contains this exact bullet ("gate
`push_on_alert_created` on the approved/active status transition instead of raw INSERT") and the item is
marked **DONE** because the *playbook* shipped in `docs/OPERATIONS.md`. The code fix never happened.

### SEC-08 — Volunteers and clinics read approved reports from every district · Medium

**Evidence.** Reproduced as volunteer `8f4b467c` (profile district `Moolacheri`), rolled back:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"8f4b467c-9d05-4297-a242-0c7ad11a1a21","role":"authenticated"}';
select count(*), string_agg(distinct district,' | '), sum(cases_count) from disease_reports;
-- → 4 | 'Chengalpattu | Kovilancheri | Moolacheri | Shimla' | 396
rollback;
```

The final disjunct of `disease_reports_select` is
`approval_status='approved' AND EXISTS(... role='volunteer' AND is_active)` with **no district
predicate**; the fourth disjunct does the same for `clinic`. `water_reports_select` has the identical
shape. Three lines above, the `asha_worker` disjunct correctly carries
`profiles.district = disease_reports.district`.

**Impact.** Two of six roles have no tenancy boundary on field data. A volunteer who signed up in Tamil
Nadu reads Shimla's caseload. The inconsistency with the ASHA branch *in the same policy* shows the
omission is accidental. Since volunteer and clinic are both freely self-registerable, anyone with an
email address gets a nationwide read of surveillance data.

**Fix.** Add `AND profiles.district = disease_reports.district` to the volunteer and clinic disjuncts of
`disease_reports_select` and the matching disjuncts of `water_reports_select`. If volunteers are
genuinely meant to see national aggregates, serve that from `vw_district_health_summary` (already
`security_invoker`) rather than row-level access.

**Not a duplicate of readiness #20** — #20 explicitly says "approved-report visibility stays", i.e. it
would deliberately leave this open. This is a separate decision the owner should make knowingly.

### SEC-09 — `notifications` policy leaks NULL-`target_role` rows to everyone · Medium

**Evidence.** *"Users can view own notifications"* qual, verbatim from `pg_policies`:

```sql
(user_id = auth.uid())
OR (user_id IS NULL)
OR EXISTS (SELECT 1 FROM profiles p
           WHERE p.id = auth.uid()
             AND (notifications.target_role IS NULL OR p.role = notifications.target_role))
```

The third disjunct **ignores `user_id` completely**, so any row with `target_role IS NULL` is readable by
every authenticated user regardless of addressee. The second grants every broadcast row unconditionally,
ignoring `target_district`. `notify_on_feedback_status` writes exactly the dangerous shape —
`INSERT INTO notifications (user_id, title, message, …) VALUES (NEW.user_id, 'Your feedback was ' || status, …)`
with no `target_role`. `select count(*) from notifications` → **0**, so this is **latent**; it activates
the first time an admin changes a feedback status. `notify_on_unsafe_water` and
`detect_outbreak_after_report` both write `target_district`, and the policy never tests it.
`lib/services/notifications.ts:37` fetches with `.or('user_id.eq.<id>,user_id.is.null')` and drops
out-of-scope rows **in JS** at :50-56, so the leak is invisible in the UI and visible only over REST.

**Fix.**

```sql
USING (
  user_id = (select auth.uid())
  OR (user_id IS NULL
      AND (target_role IS NULL OR target_role = get_my_role())
      AND (target_district IS NULL OR target_district = get_my_district()))
)
```

A broadcast row must have NULL `user_id` to be a broadcast. Give `notify_on_feedback_status` an explicit
`target_role` so intent is never inferred from NULL. Then delete the client-side filter at
`lib/services/notifications.ts:50-56` so exactly one place decides visibility.

### SEC-10 — `openrouter-proxy` is an open LLM relay with attacker-chosen model · Medium

**Evidence.** `list_edge_functions` shows `verify_jwt=true` — which proves only a valid *project* JWT,
and the legacy anon key is one. Live probe with `Authorization: Bearer <legacy anon JWT>` and body
`{"messages":[{"role":"user","content":"hi"}],"max_tokens":1}` → **HTTP 200**,
`{"content":"Okay","model":"nvidia/nemotron-3-super-120b-a12b:free"}`.

`supabase/functions/openrouter-proxy/index.ts` has no `getUser()` call, no role check, no rate limit and
no message-size cap. Line 72 takes the model straight from the request:
`const model = body.model || Deno.env.get('OPENROUTER_MODEL') || 'meta-llama/llama-3.1-8b-instruct:free'`,
and `lib/services/gemini.ts:181` shows the client already supplies it. CORS is
`Access-Control-Allow-Origin: '*'` (index.ts:23).

**Impact.** Extract the anon key from the APK — trivial, and it is also the fallback literal at
`lib/supabase.ts:13` — and you have a free LLM proxy billed to the owner. Because `model` is
caller-controlled the attacker is not confined to free models and can select a paid frontier model, on a
project whose owner has explicitly declined to pay even for Supabase Pro. It is also a laundering hop
for arbitrary generation attributed to a public-health brand, and `*` CORS lets any web page drive it
from a victim's browser.

**Fix.** Resolve the caller with `supabase.auth.getUser(jwt)` and reject anon-role tokens; allowlist
model names server-side instead of trusting `body.model`; cap message length and `max_tokens`; add a
per-user daily quota (a small counter table keyed on `user_id + day` is enough on the free tier);
restrict CORS to the deployed web origin. The AI features already require a signed-in user, so none of
this costs the ASHA worker anything.

### SEC-11 — The anon JWT is hardcoded in two DB functions as `service_role_key` · Medium

**Evidence.** From `pg_get_functiondef`, `notify_users_push`:

```sql
v_auth_key := COALESCE(current_setting('app.service_role_key', TRUE),
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrZmRpbWRseGlmYXRzYXVidmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzEzMjQsImV4cCI6MjA4Njc0NzMyNH0…');
```

The decoded payload is `{"iss":"supabase","ref":"ekfdimdlxifatsaubvbh","role":"anon",…}` — byte-identical
to the legacy anon key from `get_publishable_keys`. Exactly two routines call `net.http_post`:
`notify_users_push` (hardcoded JWT + GUC fallback) and `retry_pending_push` (hardcoded JWT, **no GUC
fallback**, alongside a hardcoded project URL). `notify_users_push` ends:

```sql
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_users_push failed: % %', SQLERRM, SQLSTATE; RETURN -1;
```

**Impact.** The variable name claims a service-role secret is stored in the database; it is not, which
will mislead the next auditor and may lead someone to actually put the service key there. It also means
`verify_jwt=true` on the push function is not a security boundary — every copy of the app carries a
credential that satisfies it. Operationally worse: the owner's pending anon-key rotation invalidates
this literal, at which point `net.http_post` starts failing — and the blanket handler converts that into
a WARNING and `-1`, so **alerts stop reaching phones with no error surfaced anywhere a human looks.**
That is the "no silent catch" rule violated in the one place where silence costs the most. The JWT also
lands in every encrypted `pg_dump` the CI backup produces.

**Fix.** Replace both literals with `current_setting('app.edge_key', true)` sourced from a Postgres
setting or Vault, rename the GUC away from `service_role_key`, and make the function **RAISE** rather
than swallow when the key is missing or the POST fails. Record the delivery failure into
`push_notification_outbox.error_message` so the outbox reflects reality. Add a CI assertion that the
configured key is present and accepted. Keep the outbox-pending gate in the edge function, but stop
treating `verify_jwt` as authorization anywhere.

### SEC-12 — `update_push_outbox_status()` is anon-callable · Low

**Evidence.** `SECURITY DEFINER`, no caller check, body:

```sql
UPDATE push_notification_outbox
   SET status = p_status, expo_ticket_id = p_ticket_id, error_message = p_error,
       sent_at = CASE WHEN p_status='sent' THEN NOW() ELSE NULL END,
       attempt_count = attempt_count + 1
 WHERE expo_push_token = p_expo_token AND status = 'pending'
   AND created_at >= NOW() - INTERVAL '1 hour';
```

`anon` and `authenticated` EXECUTE both **true** (re-confirmed 2 Aug 2026).

**Impact — bounded.** An attacker who already knows a specific Expo push token can flip that user's
queued pushes to `'sent'` inside the one-hour window, before the dispatcher reads them. The alert is
never delivered and the outbox shows success, so the failure is invisible to the admin who published it.
**Tokens are not readable by anon** — probes of `/rest/v1/user_push_tokens`, `/push_notification_outbox`
and `/profiles` with the publishable key all return `[]` under RLS — so the attacker must obtain a token
out of band (a shared, compromised or discarded device). Blast radius is one token per known token; the
UPDATE is filtered to a single `expo_push_token` and cannot touch other users' rows.

**Fix.** Revoke EXECUTE from `anon` and `authenticated` — only the edge function calls it, and it runs
with the service-role key, which does not need the RPC grant. Add a status-transition guard (pending →
sent/failed only) and match on the outbox row **id** rather than the token, so retried rows are recorded
correctly. Dovetails with the open `PRODUCTION_READINESS.md` #40 bullet about the one-hour window.

### SEC-13 — `mv_campaign_effectiveness` is readable by every authenticated user · Low

**Evidence.** `get_advisors(security)` → `materialized_view_in_api`, WARN. Confirmed by query:
`relkind='m'`, `has_table_privilege('anon', oid,'SELECT')` → **false**,
`has_table_privilege('authenticated', oid,'SELECT')` → **true**. Materialized views never enforce RLS
regardless of `relrowsecurity`. The sibling view `vw_campaign_effectiveness` is correctly
`security_invoker`.

**Impact.** Any logged-in user, including a self-registered volunteer, reads campaign-effectiveness
aggregates for every district, bypassing the district scoping the equivalent view enforces. Low harm in
itself — aggregates, not personal data — but it is an unguarded hole that widens silently if columns are
added.

**Fix.** `REVOKE SELECT ON public.mv_campaign_effectiveness FROM authenticated;` and have clients read
`vw_campaign_effectiveness`. If the MV exists for speed, wrap it in a `security_invoker` view that
re-applies the district predicate. **Correct `PRODUCTION_READINESS.md` #4**, whose title explicitly
includes "(plus `mv_campaign_effectiveness`)" and is marked DONE — the MV half was never done.

### SEC-14 — Live third-party keys in the working tree; `mesc/info.txt` holds a service_role JWT · Low

**Evidence.** `.env` (gitignored; `git log --all -- .env` returns nothing, so it was never committed)
contains `EXPO_PUBLIC_GEMINI_API_KEY=AIzaSyB4…`, `EXPO_PUBLIC_OPENROUTER_API_KEY=sk-or-v1…`,
`EXPO_PUBLIC_OPENROUTER_MODEL` and `MONGO_URI=mongodb:…`. Neither AI key is referenced in code any
more — a repo-wide grep for `EXPO_PUBLIC_` returns only `OFFLINE_SYNC_ENABLED` (`App.tsx:40,163`),
`SUPABASE_URL/KEY/ANON_KEY` (`lib/supabase.ts:7-12`, `lib/services/authRecovery.ts:32-35`) and
`OPENROUTER_MODEL` (`gemini.ts:45`); `gemini.ts:197-209` documents that there is deliberately no
direct-to-OpenRouter path. A grep of the built web bundle for `sk-or-v1|AIzaSyB|mongodb(\+srv)?://`
finds none of them in `dist/`.

**But `.env.example` still carries** the block *"These client vars are only the direct-API fallback used
when the proxy is unavailable"* followed by a commented `# EXPO_PUBLIC_OPENROUTER_API_KEY=sk-or-v1-your_key_here`.

**Separately and more urgently:** `mesc/info.txt` lines 3-4 contain a real, unredacted **service_role
JWT** and anon JWT for Supabase project ref `hzicxykqtlxhaalgqkey`. `mesc/` is gitignored today
(`.gitignore:69`), and `mesc/DATABASE_SCHEMA.sql` is byte-identical to
`database_structure/DATABASE_SCHEMA.sql` (`diff -q` silent). `database_structure/*.sql` itself is clean —
the only key-shaped strings are placeholders at `PUSH_NOTIFICATIONS.sql:184` and `:419`.

**Impact.** Nothing is exposed in the published repo today. The risk is procedural and sequencing-
critical: `EXPO_PUBLIC_` is a contract meaning "this is baked into the APK", two live-looking secrets and
a Mongo connection string sit in that namespace on the owner's machine, and `.env.example` actively
instructs the next person to put an OpenRouter key there. One re-added
`process.env.EXPO_PUBLIC_OPENROUTER_API_KEY` reference — exactly the fallback `.env.example` describes —
would ship the key in a public GitHub Release, and because it is absent today nobody would notice the day
it appears.

**Fix, in this order.** (1) **Delete `mesc/` outright first** — it holds live credentials and its schema
file is a byte-identical duplicate. (2) Rotate the `hzicxykqtlxhaalgqkey` service_role key regardless of
whether `mesc/` was ever pushed. (3) Rotate the Gemini and OpenRouter keys and the Mongo credential, then
delete all three from `.env` (`MONGO_URI` is unused by this codebase entirely). (4) Delete the
direct-API-fallback paragraph and the commented `EXPO_PUBLIC_OPENROUTER_API_KEY` line from
`.env.example` — this closes the last unfinished bullet of readiness #5, which is marked DONE. (5) Add a
CI grep that fails the build if a bundle artifact matches `sk-or-v1|AIza|mongodb(\+srv)?://`, or if any
`EXPO_PUBLIC_` var whose name contains `KEY`/`SECRET` is referenced outside `lib/supabase.ts` and
`authRecovery.ts`.

### SEC-15 — Legacy `campaigns` table is anon-readable; readiness #3 wrongly claims a fix · Low

**Evidence.** No client code queries it: `grep -rn "from('campaigns')"` over
`App.tsx components lib src supabase` returns nothing; every campaign query targets `health_campaigns`.
Live: `public.campaigns` has RLS enabled and **11 policies**, two of which are SELECT `USING true` with
`polroles = '{-}'` (TO PUBLIC, which includes `anon`) — *"Everyone can view campaigns"* and
`campaigns_select` — and `information_schema.role_table_grants` confirms `anon` holds SELECT. The table
has **0 rows**. INSERT is **not** open to anon: both `campaigns_insert` and `campaigns_legacy_insert`
require `created_by = auth.uid()` plus an active profile, which no anon session can satisfy.

**Impact.** No data is exposed today — the table is empty and unwritable by anon. The real cost is that
`PRODUCTION_READINESS.md` #3 is marked *"DONE — always-true policies replaced (ai_recommendations,
campaign_participants, **campaigns SELECT**)"*. `ai_recommendations` is genuinely fixed; the campaigns
half was never done. The tracker cannot be trusted as evidence of RLS state.

**Fix.** Reopen or correct #3, then drop the two `USING true` PUBLIC SELECT policies as part of dropping
`public.campaigns` and `public.campaign_volunteers` outright (DEL-06).

### SEC-16 — Two edge functions run with the service-role key and are not in git · Low

**Evidence.** `list_edge_functions` returns four ACTIVE functions — `bright-action` (v4),
`openrouter-proxy` (v4), `push-notifications` (v6), `delete-account` (v1). `ls supabase/functions`
returns only `openrouter-proxy` and `push-notifications`; there is no `supabase/migrations` directory
either. `bright-action`'s fetched source builds a client with
`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`, queries `disease_reports` for a matching
`disease_name + district` in the last 10 minutes, and returns 409 or 200; its imports are **unpinned**
(`https://deno.land/std/http/server.ts`, `https://esm.sh/@supabase/supabase-js`). Live probe with only
the legacy anon JWT: `POST /functions/v1/bright-action` → HTTP 200 `{"success":true}`. Repo grep finds
zero references to `bright-action` — it is deployed dead code.

`delete-account`'s fetched source is **sound**: it resolves the caller from the JWT via
`admin.auth.getUser`, accepts no id parameter, refuses if the caller is the last active `super_admin`,
then `auth.admin.deleteUser(self)`. It is wired from `components/screens/ProfileScreen.tsx:280`.

**Impact.** Service-role code runs in production that is not in git, not in CI, not reviewed and not
restorable from the repo, with unpinned dependencies that can change under it. `bright-action` is
additionally a narrow RLS-bypassing existence oracle bounded to a 10-minute window: anyone with a
project JWT can ask "was a report of disease X filed in district Y in the last 10 minutes", including
unapproved reports, and read the answer from the status code. `PRODUCTION_READINESS.md` #8 still reads
PLANNED with a bullet to create and deploy `delete-account`, which has in fact shipped.

**Fix.** `supabase functions download bright-action delete-account` into `supabase/functions/`, pin the
imports, commit both. Delete `bright-action` outright — nothing calls it, and its validations
(coordinate ranges, `deaths <= cases`) duplicate CHECK constraints already on `disease_reports`
(`valid_latitude`, `valid_longitude`, `valid_deaths`, confirmed in `pg_constraint`). Update #8 to
DONE-except-committing-source. Add a CI step that diffs `list_edge_functions` against
`supabase/functions/` and fails on drift.

> **Before deleting `bright-action`, read NEW-04.** Its "was this already reported nearby in the last
> 10 minutes" query is the exact primitive a duplicate-report guard needs. Delete the deployment;
> keep the idea.

---

## 4. Broken & incomplete

§4.1 is **broken** — it does not work, or it lies to the user. §4.2 is **incomplete** — it was built and
never finished or never connected.

### 4.1 Broken

| ID | Finding | Severity | Effort |
| --- | --- | --- | --- |
| BRK-01 | Every UPDATE on `disease_reports` is silently discarded — approval is a no-op | **Critical** | S |
| BRK-02 | Three contradicting CHECKs make "safe" and "critical" water readings unsavable | **Critical** | S |
| BRK-03 | Unsafe-water reports notify nobody — forbidden `related_type`, error swallowed | **Critical** | S |
| BRK-04 | Outbreak detection never fires for ASHA or volunteer reports | **Critical** | M |
| BRK-05 | Alerts are filtered away from the workers they target, and the screen says "All clear" | High | L |
| BRK-06 | Policies gate on a legacy `'admin'` role nobody holds | High | M |
| BRK-07 | A unique dedup index refuses legitimate alerts (one per district+urgency per 10 min) | High | S |
| BRK-08 | The hourly escalation cron has failed **960 times** — the function does not exist | High | S |
| BRK-09 | The notification layer never closes the loop | High | M |
| BRK-10 | Outbreak console claims an alert was sent, and borrows another alert's ack rate | High | M |
| BRK-11 | Water sources are flagged from unapproved reports, then stamped "Verified" in the digest | High | M |
| BRK-12 | Advisory composer confirms delivery it cannot verify | High | M |
| BRK-13 | `advancedAnalytics` turns every failure into an empty list — four-states violated | Medium | M |
| BRK-14 | Android Back exits the app and destroys a half-filled report | High | M |
| BRK-15 | Queued offline reports are invisible in "My Submissions" — it says "Nothing filed yet" | High | S |
| BRK-16 | Campaign Intelligence is permanently empty | Medium | M |
| BRK-17 | Campaign GPS check-in has no geofence | Medium | M |
| BRK-18 | The Profile notification switches do nothing | Medium | M |
| BRK-19 | Escalation Monitoring permanently runs its client-side fallback | Medium | M |
| BRK-20 | Water sources are keyed on a free-typed name, so history silently fragments | Medium | M |
| BRK-21 | The approval queue downloads every record ever filed, unbounded | Medium | M |
| BRK-22 | The Super Admin "User Feedback" card dead-ends in the approval queue | Medium | S |
| BRK-23 | An approved alert has no lifecycle close — only "rejected" | Medium | M |
| BRK-24 | `.gitignore` excludes `.env.example` and `database_structure/` | Medium | S |
| BRK-25 | The manual release lane cannot trigger a build | Medium | S |

---

#### BRK-01 — Every UPDATE on `disease_reports` is silently discarded · Critical

**This is the single most important defect in the system.** Fix it before anything else in §4.

**Evidence.**

```text
CREATE TRIGGER trg_conflict_disease BEFORE UPDATE ON public.disease_reports
  FOR EACH ROW EXECUTE FUNCTION resolve_conflict()
```

(confirmed in `pg_trigger`, 2 Aug 2026). The body is:

```sql
IF NEW.last_updated_at > OLD.last_updated_at THEN RETURN NEW; ELSE RETURN OLD; END IF;
```

`disease_reports.last_updated_at` is `timestamp without time zone`, **nullable, no default**, and
**nothing writes it** — the repo only reads it (`lib/services/advancedAnalytics.ts:578`,
`types/index.ts`). `NULL > NULL` is NULL, so the ELSE branch runs, and a BEFORE-UPDATE trigger that
returns `OLD` **writes the old row back**. All 4 live rows have `last_updated_at IS NULL`.

Reproduced, rolled back:

```text
insert as the live asha_worker → approval_status = 'pending_approval'
UPDATE disease_reports SET approval_status='approved', approved_by=…, approved_at=now(), notes='PROBE-APPROVED'
→ update_rowcount=1 | stored_status=pending_approval | stored_notes=NULL | outbreaks before=0 after=0
```

**A second, hidden defect found while reproducing.** The other BEFORE UPDATE trigger,
`trg_response_time` → `calculate_response_time()`, assigns `NEW.response_time_hours`, and **no such
column exists** on `disease_reports` (full `information_schema` column list checked). Today it is masked
because `resolve_conflict` hands it `OLD`, whose `approved_at` is NULL for pending rows so the guard
skips. Updating any row whose `approved_at` is non-null **already fails hard**:
`ERROR: 42703 record "new" has no field "response_time_hours"` — reproduced against a live approved
report. All 4 existing rows are in that state.

Client paths that hit this: `components/screens/ApprovalQueueScreen.tsx:307` (approve), `:325` (reject),
`:294` (verify), `lib/services/diseaseReports.ts:176-183` and `:200-209`,
`components/screens/AdminManagementScreen.tsx:421/447`.

**Impact.** The human step in the mission loop cannot happen. A district officer taps **Approve**, gets a
green "Approved successfully" toast (PostgREST reports 1 row affected, so no error surfaces), the list
reloads, and the report is still pending. Nothing a field worker files can ever be verified, approved,
rejected or edited — and every approved-only downstream path (outbreak detection, approved timelines,
the reporter's "report approved" push, the rejection note in BRK-09) is unreachable as a consequence.

**Fix — both triggers in one migration, or approvals move from silently failing to loudly failing.**

1. `DROP TRIGGER trg_conflict_disease ON public.disease_reports;` — last-write-wins conflict resolution
   is already handled client-side by the sync queue plus the `client_idempotency_key` unique
   constraints. If server-side resolution is genuinely wanted, rewrite as
   `IF NEW.last_updated_at IS NULL OR OLD.last_updated_at IS NULL OR NEW.last_updated_at > OLD.last_updated_at THEN RETURN NEW`,
   stamp `last_updated_at` in a BEFORE trigger, and have the sync queue send it.
2. Either add `response_time_hours numeric` to `disease_reports`, or drop `trg_response_time` and
   `calculate_response_time()`. **As soon as (1) lands, every approval reaches this trigger with
   `approved_at` set and raises 42703.**
3. Add a regression test that approves a report and asserts the *stored* value changed.

#### BRK-02 — Three contradicting CHECKs make half the water ladder unsavable · Critical

**Evidence.** Three CHECK constraints coexist on `water_quality_reports.overall_quality`
(`pg_get_constraintdef`, re-confirmed 2 Aug 2026):

| Constraint | Allowed values |
| --- | --- |
| `chk_overall_quality` | safe, moderate, poor, contaminated, unsafe, critical |
| `valid_quality` | good, moderate, poor, unsafe |
| `water_quality_reports_overall_quality_check` | safe, moderate, unsafe, critical |

Intersect all three: only **`moderate`** and **`unsafe`** satisfy every constraint. Reproduced, rolled
back: inserting with `overall_quality='unsafe'` succeeded; the identical row with `'safe'` gave
`ERROR: 23514 … violates check constraint "valid_quality"`.

The form offers exactly Safe / Moderate / Unsafe / Critical —
`components/forms/WaterQualityReportForm.tsx:307-310`, with the comment at :305 *"Options are exactly
safe / moderate / unsafe / critical"* — and posts the raw value at :409.

**Impact.** An ASHA worker who tests a handpump and reports it **Safe** — the most common outcome — or
**Critical** gets a raw Postgres constraint error and loses the submission. Offline, the row sits in the
sync queue failing forever. Half the water ladder is unreachable, so the dataset is silently censored to
moderate/unsafe only (the single live row is one of those two). Downstream code that filters on the
missing values always returns zero: `lib/services/waterQuality.ts:250` `.eq('overall_quality','safe')`
and `:260` `.eq('overall_quality','critical')`. `notify_on_unsafe_water`'s `'critical'` branch is dead
code.

**Fix.** Drop `valid_quality` and `chk_overall_quality`; keep one canonical constraint matching the app
vocabulary: `CHECK (overall_quality IN ('safe','moderate','unsafe','critical'))`. Normalise any legacy
`poor`/`contaminated` rows first — `WaterQualityReportForm.tsx:248-250` already maps poor→moderate and
contaminated→unsafe on read, so reuse that mapping. Add a CI check that fails when more than one CHECK
constraint targets the same column.

#### BRK-03 — Unsafe-water reports notify nobody · Critical

**Evidence.** `notifications_related_type_check` allows only
`('disease_report','water_report','campaign','user')`. `notify_on_unsafe_water()` inserts
`related_type = 'water_quality_report'` **three times** (two role-scoped inserts in a `FOREACH` loop plus
one for `health_admin`) before it ever reaches `PERFORM notify_users_push(...)`, and the whole body is
wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NEW`.

Reproduced, rolled back: inserting a `water_quality_reports` row with `overall_quality='unsafe'` in
district `__PROBE_DISTRICT__` produced **`notifications=0`, `push_outbox=0`**, against a `notifications`
table holding 0 rows before and after. Control experiment: a probe insert into `user_feedback` (whose
trigger uses the allowed `related_type='user'`) produced **2 notifications** — so the notification path
itself is healthy; it is the forbidden literal that aborts this function.

**Impact.** When a worker reports contaminated drinking water, the district officer, clinic and health
admin receive **nothing** — no in-app notification and no push, because the constraint violation aborts
the function before `notify_users_push` is reached. The only visible effect is a row turning red on a
Water Sources screen that five of six roles cannot open (INC-01). This is the water half of the
surveillance mission failing silently, and the catch-all handler guarantees nobody is told. It also
falsifies `PRODUCTION_READINESS.md` #58 (*"Alert on unsafe water-quality results — the app's core signal
currently notifies no one"*, **Status: DONE — trg_notify_on_unsafe_water live**, line 503): the trigger
is live and does nothing.

**Fix.** One word: change the literal to `'water_report'` (or extend the CHECK to include
`'water_quality_report'` — pick one and use it everywhere). Reopen #58. More importantly, stop
`EXCEPTION WHEN OTHERS` around notification writes from swallowing schema mismatches: log to a durable
table or re-raise on insert-critical paths so a broken fan-out is visible.

#### BRK-04 — Outbreak detection never fires for field-worker reports · Critical

**Evidence.** `CREATE TRIGGER trg_detect_outbreak AFTER INSERT ON public.disease_reports` — **INSERT
only** (confirmed in `pg_trigger`, 2 Aug 2026, alongside seven other triggers on the table). And
`detect_outbreak_after_report()` opens with:

```sql
IF NEW.approval_status IS DISTINCT FROM 'approved' THEN RETURN NEW; END IF;
```

`auto_approve_reporter_id_report()` sets `approval_status := 'pending_approval'` for any reporter whose
role is not in `('super_admin','health_admin','clinic','district_officer')` — i.e. **every asha_worker
and volunteer**. No trigger recomputes detection on the pending→approved transition: the only
`AFTER UPDATE OF approval_status` triggers are `trg_push_on_report_approved` and
`trg_recompute_outbreak_on_rejection`, whose body starts
`IF NOT (OLD.approval_status = 'approved' AND NEW.approval_status = 'rejected') THEN RETURN NEW;`.
Approval is a plain client UPDATE (`ApprovalQueueScreen.tsx` `approve()`).

Reproduced, rolled back: an asha_worker report with `cases_count=999` inserted as pending, then approved
by UPDATE → `outbreaks` in that district **before=0, after=0**. Corroborating live state: all 4
`disease_reports` rows are approved-on-insert official submissions, and `public.outbreaks` holds
**0 rows** despite 5 configured `outbreak_thresholds`.

**Impact.** The mission loop is severed at its hinge. An ASHA worker files 60 diarrhoea cases; the
district officer approves them; no `outbreaks` row is ever created, no urgent notification reaches
super_admin/health_admin/clinic/district_officer, and no alert is proposed. In a district staffed only
by ASHA workers — the designed deployment — automatic outbreak detection is **100% dead**. Downstream,
the Outbreak Signal / Outbreak Console screens and the "your report mattered" payback panel have nothing
to open.

This is the unintended cost of `PRODUCTION_READINESS.md` #57 (**DONE** — "detection gated on approved
reports"): the gate was added to the function but no approval-time trigger was added to replace the lost
INSERT-time path. A closed item created this hole.

**Fix.**

```sql
CREATE TRIGGER trg_detect_outbreak_on_approval
  AFTER UPDATE OF approval_status ON disease_reports FOR EACH ROW
  WHEN (OLD.approval_status IS DISTINCT FROM 'approved' AND NEW.approval_status = 'approved')
  EXECUTE FUNCTION detect_outbreak_after_report();
```

The function already reads only `NEW` fields, so it works unchanged on both paths. Better: factor its
body into a shared `recompute_outbreak(disease_name, district)` used by the insert, approve and reject
paths so the three cannot diverge. **Fix BRK-01 first, or this trigger can never fire either.** Then
verify end to end rather than by inspection: file a report as an ASHA account, approve it as an officer,
and assert an `outbreaks` row plus four `notifications` rows appear.

#### BRK-05 — Alerts are filtered away from the workers they target, and the screen says "All clear" · High

**Evidence.** `lib/services/alertRadius.ts:194-214` — `isWithinAlertRadius` returns true only on exact
normalised district equality (after the `DISTRICT_ALIASES` map), or when **both** places resolve to
entries in the hardcoded `DISTRICT_CENTROIDS` table (lines 17-123, 105 entries) within
`ALERT_RADIUS_KM = 10`. Otherwise `false`. `filterAlertsForProfile` (:226-234) returns `[]` outright
when `profile.district` is falsy, and applies only to `RADIUS_SCOPED_ROLES` — verified as
`district_officer, clinic, asha_worker, volunteer` (`alertRadius.ts:3-8`); admins bypass the filter.

Live data: 4 alerts are `status='active' AND approval_status='approved'` — Chengalpattu ×2, Mambakkam,
Shimla. The canonical `districts` registry contains Shimla, Chengalpattu, Moolacheri, Kovilancheri,
Mambakkam; only `chengalpattu` and `shimla` have centroids (grep confirms kovilancheri / moolacheri /
mambakkam are absent from both the centroid table and the alias map). Live field profiles:
asha_worker `Chengalpattu`, clinic `Kovilancheri`, district_officer `Chengalpattu`, volunteer
`Moolacheri`, volunteer `Not specified`.

So today: the ASHA worker and the district officer in Chengalpattu **do** see their alerts (exact string
match succeeds). The clinic and **both** volunteers resolve to zero alerts, permanently. The Mambakkam
alert reaches **no** radius-scoped account at all — it was pushed only to national admins, via
`notify_users_push`'s role bypass (REF-02).

The filter gates `AshaWorkerDashboard.tsx:109`, `VolunteerDashboard.tsx:100`, `ClinicDashboard.tsx:65`,
`DistrictOfficerDashboard.tsx:94`, `DashboardScreen.tsx:136`, `HealthMapComponent.tsx:830`,
`MapTabScreen.tsx:97`, `AllAlertsScreen.tsx:149-151`, `AIInsightsPanel.tsx:96` and
`advancedAnalytics.ts:744`. When it empties the list, `AllAlertsScreen.tsx:363-372` renders an
`EmptyState` with a **green checkmark** and *"All clear — no active health alerts right now."*;
`AshaWorkerDashboard.tsx:223` says *"District is Clear"*; `VolunteerDashboard.tsx:191-192` says
*"No Active Alerts — Your community is safe!"*.

**Impact.** An outbreak alert raised in Kovilancheri is invisible to the clinic in Kovilancheri's
neighbouring village and vice versa; the volunteer whose district defaulted to `Not specified` sees zero
alerts forever. The app does not say "we couldn't scope this" — it affirmatively tells a field worker,
**in green**, that everything is clear. The constant is named `ALERT_RADIUS_KM = 10`, but for any
district pair missing from the 105-entry gazetteer the radius never runs at all, so "10 km radius" is in
practice "identical district string".

**Fix — two independent pieces.**

1. **Honesty, immediately (S).** Never render the green "All clear" state when the raw server list was
   non-empty and the client filter emptied it — show *"N alerts outside your area"* with a way to see
   them. Render an explicit *"Your district isn't set"* state instead of an empty list when
   `profile.district` is missing or `Not specified`.
2. **Correctness, properly (L).** Stop scoping alerts by a hardcoded client gazetteer. Scope on the
   server using `health_alerts.location_geo` and PostGIS with a real radius; fall back to string match
   only when coordinates are absent. Fold into the open `PRODUCTION_READINESS.md` #56 (canonical
   district registry), which owns the free-text-district root cause but **does not currently mention
   `alertRadius.ts`** — add it there.
3. Add an admin "alert reach" check: for each active alert, how many field profiles would receive it.
   **Zero is a bug, not a quiet day.**

#### BRK-06 — Policies gate on a legacy `'admin'` role nobody holds · High

**Evidence.** `select role, count(*) from profiles group by role` → clinic 1, volunteer 2, asha_worker 1,
super_admin 2, health_admin 1, district_officer 1 — **zero `'admin'`** (re-confirmed 2 Aug 2026). Yet
`pg_policies` still keys on `role='admin'` in: *Admin full access outbreaks* (ALL), *Admin full access
audit_logs* (ALL), *Admin manage outbreak_thresholds* (ALL), `campaigns_delete`, `campaigns_insert`,
`feedback_select/update/delete`, *Admins can read notification logs*, and two `campaign_volunteers`
policies.

Reproduced with rolled-back probe rows:

```sql
begin;
insert into outbreaks(...) values ('AUDIT-PROBE-DELETEME','Chengalpattu',...);
set local role authenticated;
set local request.jwt.claims = '{"sub":"<super_admin uuid>"}';
select count(*) from outbreaks;   -- → 0
rollback;
-- same probe impersonating the Kovilancheri clinic → 1 row, district 'Chengalpattu'
```

`outbreaks` has **no SELECT policy for super_admin or health_admin at all**. Function bodies from
`pg_proc`: `purge_old_audit_logs` and `get_deleted_records` both `IF v_caller_role != 'admin' THEN RAISE
EXCEPTION`; `get_user_audit_log`'s cross-user branch requires `'admin'` (own-log reads are fine for
everyone); `resolve_outbreak`'s ladder is
`IF v_caller_role = 'admin' THEN NULL; ELSIF v_caller_role IN ('clinic','district_officer') THEN <district must match>; ELSE RAISE EXCEPTION`.

**Impact — two failures at once.** The national roles are **blind to the `outbreaks` table**, which is
the output of the detection pipeline this product exists to run; their dashboards render a quiet-zero
that reads as "no outbreaks" rather than "no permission". They also cannot resolve an outbreak (only
clinic and district_officer can, and only in their own district), cannot purge or inspect audit logs,
and cannot list deleted records. Meanwhile *Clinic select outbreaks* has **no district predicate at all**,
so a village clinic sees outbreak records for the entire country. Dead scaffolding from an earlier
three-role schema, never reconciled when the six roles landed.

**Fix.** Sweep the schema for `'admin'`: replace with
`get_my_role() = ANY(ARRAY['super_admin','health_admin'])` in every policy and in `resolve_outbreak`,
`purge_old_audit_logs`, `get_deleted_records`, `get_user_audit_log`, `dispatch_push_notification`,
`auto_approve_report` and `is_admin`, then drop the superseded duplicates. Add district scoping to
*Clinic select outbreaks* and a SELECT policy for super_admin/health_admin. Add a CI assertion that no
policy or routine references a role outside the six in `Profile['role']` — this class of bug is
mechanically detectable.

**Tracker note.** `PRODUCTION_READINESS.md` #53 is marked **DONE** and claims *"Fix `resolve_outbreak` …
to use the actual role names"* — that bullet was never done. #41's drift sweep is scoped only to
`user_feedback` and the push outbox, so `outbreaks`, `audit_logs` and `outbreak_thresholds` are covered
by nothing.

#### BRK-07 — A unique dedup index refuses legitimate alerts · High

**Evidence.**

```sql
CREATE UNIQUE INDEX idx_alert_dedup ON public.health_alerts
  USING btree (district, urgency_level, created_bucket);
-- set_created_bucket() BEFORE INSERT:
NEW.created_bucket := FLOOR(EXTRACT(EPOCH FROM NEW.created_at) / 600);   -- 10-minute buckets
```

Reproduced, rolled back: two alerts in district `__PROBE_DISTRICT__` with urgency `high` but different
titles, descriptions and location names ("Alert A" / "Alert B (different village)") →
`ERROR: 23505 duplicate key value violates unique constraint "idx_alert_dedup", Key (district, urgency_level, created_bucket)=(__PROBE_DISTRICT__, high, 2976115)`.
`components/forms/AlertForm.tsx:339` does a plain `.insert(payload)` and surfaces the raw error. The
table already carries `health_alerts_client_idempotency_key_key`, a UNIQUE index on
`client_idempotency_key`.

**Impact.** Exactly when the system matters most — an escalating outbreak, an officer publishing
back-to-back warnings for two affected villages — the second alert is refused with a raw database error
the officer cannot act on. Offline-queued alerts are worse: several alerts drafted in a dead zone sync
within the same minute and all but one are permanently rejected. `client_idempotency_key` is already the
correct mechanism for retry deduplication; this index deduplicates by content-blind coincidence.

**Fix.** `DROP INDEX idx_alert_dedup;` and rely on `health_alerts_client_idempotency_key_key`. If
content-level dedup is still wanted, make it an advisory client-side check ("a similar alert was
published 4 minutes ago — publish anyway?") rather than a hard database refusal, and include
title/disease in the key.

#### BRK-08 — The hourly escalation cron has failed 960 times · High

**Evidence.** Live, 2 Aug 2026:

```sql
select j.jobid, j.jobname, j.command, j.active,
  (select count(*) from cron.job_run_details d where d.jobid=j.jobid and d.status='failed')
from cron.job j;
-- 1 | escalate-reports-job     | SELECT escalate_pending_reports();  | true | 960
-- 2 | healthdrop-push-retry    | SELECT public.retry_pending_push()  | true | 0
-- 3 | healthdrop-telemetry-purge | …purge_push_telemetry()           | true | 0
-- 4 | healthdrop-events-purge  | …purge_old_app_events()             | true | 0
```

Last error: `ERROR: function escalate_pending_reports() does not exist`. No function matching
`escalat%` exists in any schema. **960 hourly failures is 40 days of continuous, invisible failure.**

**Impact.** Nothing server-side escalates a report that has sat unapproved past its SLA — no
notification, no priority bump, no nudge to a supervisor. `EscalationMonitoringScreen`
(`components/screens/EscalationMonitoringScreen.tsx:58-70`, `lib/services/advancedAnalytics.ts`)
computes "Overdue" and "High escalation" purely client-side from `created_at`, so the screen *looks*
alive and gives an officer the impression a system is watching the clock. Nobody is: if no officer opens
that screen, an overdue report is escalated to no one. A permanently-red job also masks any *future*
cron failure.

**Fix.** Decide intent and close the gap: either implement `escalate_pending_reports()` (find pending
disease/water reports past their SLA tier, notify the district officer at L1-L2 and health_admin at L3)
or `select cron.unschedule(1);`. Either way, add an ops check that fails when any row in
`cron.job_run_details` has `status='failed'` in the last 24 h, surfaced in the daily backup workflow or
on `SuperAdminDashboard`. Fold into open item #40, whose text says *"cron.job contains exactly one job
(escalate-reports-job)"* without noticing it fails every hour — correct that line.

#### BRK-09 — The notification layer never closes the loop · High

Four limbs, one root cause: the app tells people things will reach them, and nothing delivers.

**Evidence.**

| Limb | Evidence |
| --- | --- |
| Rejections are silent | `ApprovalQueueScreen.tsx:325-341` `reject()` updates only `approval_status, approved_by, approved_at, rejection_reason` — no `notifications` insert, no `notify_users_push`. The officer is told at `:830` *"{FirstName} will read your words exactly as written."* and at `:872` *"Logged to the audit trail."*, and the note is **required** (:861). `trg_push_on_report_approved` returns early unless the transition is **to** `'approved'`. |
| Water decisions are silent | `water_quality_reports` has **no approval-side trigger at all** — its five triggers are `auto_approve_reporter_id_water`, `trg_audit_water_quality_reports`, `trg_notify_on_unsafe_water`, `trg_sync_water_report_geo`, `trg_sync_water_source_registry` (verified in `pg_trigger`). |
| The bell has no badge | `MainApp.tsx:634-642` renders a bare Ionicon. `getUnreadCount` exists at `lib/services/notifications.ts:65` with **zero callers** repo-wide. |
| Tapping a push is a dead end | Repo-wide grep for `addNotificationResponseReceivedListener` / `getLastNotificationResponseAsync` → **zero hits**, while `push_on_alert_created()` ships `data {screen:'AlertDetail', alertId, district}`. |

**Impact.** The ASHA files a report and hears nothing. If it was **rejected** — the one outcome that
needs her to act — she finds out only if she opens Profile → My Submissions and scrolls. The
"WHY + Fix & refile" card at `MySubmissionsScreen.tsx:332-362` has no delivery mechanism. At 2 a.m. an
urgent alert push lands her on the Home tab.

**Understated, in fact:** on `disease_reports` the reject UPDATE itself cannot persist today (BRK-01), so
the officer's note may never reach the database, let alone the reporter. And the disease-side *approval*
push is equally inert for the same reason — `v_new_status` inside `push_on_report_approved` is always the
pre-update value, so the function returns early. So the current user-visible symptom is **uniform
silence**, not a water-vs-disease asymmetry.

**Fix, in order.** (1) Fix BRK-01, or nothing below can fire. (2) Generalise `push_on_report_approved` to
take the table and label from `TG_TABLE_NAME` and attach it to `water_quality_reports` as well. (3) Add a
rejection branch firing on the transition **to** `'rejected'` with `p_target_user_id := reporter_id` and a
body of the first 100 chars of `rejection_reason`. (4) Insert a matching `notifications` row so the
decision survives in the inbox for someone with push disabled. (5) Badge the `MainApp` bell from
`notificationsService.getUnreadCount()`. (6) Register `Notifications.addNotificationResponseReceivedListener`
in `App.tsx` and route `data.screen` / `alertId` into MainApp's existing targets (`'all-alerts'`,
`'my-submissions'`, `'open-report:<type>:<id>'`) — the payload contract already exists.

#### BRK-10 — Outbreak console claims an alert was sent, and borrows another alert's reach · High

**Evidence.** `detect_outbreak_after_report()` inserts internal notification rows for
super_admin/health_admin (unscoped) and clinic/district_officer (district-scoped), then
**unconditionally** runs `UPDATE outbreaks SET alert_sent = TRUE WHERE id = v_outbreak_id;` — so
`alert_sent` is TRUE for every trigger-detected outbreak **before any human acts**.
`OutbreakConsoleScreen.tsx:441-452` renders, whenever `outbreak.alert_sent`:

> *"An alert has been sent for this outbreak — field staff in {district} were notified."*

The same flag gates the reach tile at `:437`. And `OutbreakConsoleScreen.tsx:158-166`:

```ts
const linked = (disease && data.find(…title/disease_or_issue contains disease…)) || data[0];
```

— when nothing names the disease it falls back to **the newest approved active alert in the district**
and reports *its* acknowledgements as this outbreak's reach. The honest state already exists at
`:454-467` (*"No alert has been sent … Alerts are issued separately and never fire automatically"*) and
is simply unreachable for trigger-detected outbreaks.

**Impact.** A district officer running a live response reads "field staff were notified" and stops
chasing the broadcast, when no `health_alert` exists and no ASHA has been told anything. The reach tile
can show last month's dengue notice's acknowledgement rate as this outbreak's reach. This is the app's
highest-stakes *"never fake a number"* violation. It misreports nothing **today** only because
`outbreaks` holds 0 rows (BRK-04) — fix BRK-04 and this goes live.

**Fix.** Stop overloading `alert_sent`: rename the trigger's write to `officials_notified_at` (or drop it
and derive from `notifications`), and add `linked_alert_id uuid references health_alerts(id)` on
`outbreaks`, set only when an official issues an alert from the console. Render the banner from
`linked_alert_id`, never from `alert_sent`; when it is null, show the honest state at `:454-467`. Delete
the `|| data[0]` fallback in `loadReach` — with no linked alert the tile must render
`{kind:'unavailable'}`, never another alert's numbers.

#### BRK-11 — Water sources flagged from unapproved reports, then stamped "Verified" · High

**Evidence.** `trg_sync_water_source_registry AFTER INSERT ON public.water_quality_reports`;
`sync_water_source_registry()` upserts `water_sources.current_status` / `flagged_at` from
`NEW.overall_quality` **with no approval check**, and there is **no AFTER UPDATE counterpart**, so a
later approval or rejection never revises the registry. `trg_notify_on_unsafe_water` is likewise AFTER
INSERT and unconditional on approval. Meanwhile `lib/services/weeklySummary.ts:251-262` computes
`waterUnsafe` and `waterRetestedSafe` by counting `water_sources` rows, and the output is stamped
*"✓ Verified data / All figures from human-approved reports only"* (`weeklySummary.ts:511-518`) with the
same claim in the WhatsApp caption (`:403`).

**Impact.** A single unverified reading turns a village well "critical" in the registry, pushes the
district officer, and appears in the IDSP-format PDF the officer forwards up the chain **under a
VERIFIED stamp** — the one artifact that leaves the app and reaches other agencies. The reverse is worse
for trust: when the report is later rejected, nothing un-flags the source.

**Fix.** Guard `sync_water_source_registry` with
`IF NEW.approval_status IS DISTINCT FROM 'approved' THEN RETURN NEW; END IF;` (exactly as
`detect_outbreak_after_report` already does), and add an `AFTER UPDATE OF approval_status` trigger so a
report approved later still flags the source and a rejected one is reconsidered. **Keep**
`notify_on_unsafe_water` on the provisional flag — early warning to officials is the point — but split
the registry into provisional vs confirmed status and have `weeklySummary` count only the confirmed
column. Otherwise drop the "✓ Verified" stamp from the water lines. Readiness #57 gated outbreak
detection and #58 shipped the unsafe-water notification; neither touched the registry. This is the gap
they left between them.

#### BRK-12 — Advisory composer confirms delivery it cannot verify · High

**Evidence.** `AdvisoryComposerScreen.tsx:321-341` renders the target district as a **free-text
TextInput** (placeholder "e.g. Kalahandi") for admins; district officers are pinned to their own district
(:47, :54, :74). `lib/services/advisories.ts:116-145` inserts one broadcast row via
`notificationsService.create` and returns success purely on insert success — **no count of matching
staff**. Targeting is then applied client-side on each recipient's device by exact string equality
(`advisories.ts:99-103`: `if (n.target_district && n.target_district !== profile.district) return false;`).
On success the composer shows a green receipt (:358-364).

The district value is prefilled from `profile.district` — and the live `health_admin`'s district is
**`chennai`** (lowercase, matching no other profile and absent from the `districts` registry), so that
account's default advisory would reach exactly one person: itself. `listInbox` filters broadcasts through
`broadcastMatchesProfile`, so an officer targeting `asha_worker` cannot even see their own advisory.

**Impact.** An officer types "kalahandi" instead of "Kalahandi" — or simply accepts a prefilled district
that matches nobody — gets a green success receipt, and no one receives the advisory. There is no way to
notice: no recipient count, no sent list, no read receipts, no ability to correct what was sent. The one
channel officials have for reaching their own staff is fire-and-forget with a receipt that is not
evidence of anything. (The composer's body copy is at least honest that advisories do not push.)

**Fix.** Replace the free-text district field with the district picker (`districtsService`) so the value
is always canonical. Before insert, count matching active staff and put the number in the receipt —
*"Sent to 14 ASHA workers in Kalahandi"* — and **refuse to send when the count is 0**, saying so. Add a
"Sent advisories" list on the composer showing each advisory and its scope. The read-receipt limb is
already `ROADMAP_FEATURES.md` #8 — reference it, do not re-propose it.

#### BRK-13 — `advancedAnalytics` turns every failure into an empty list · Medium

**Evidence.** `lib/services/advancedAnalytics.ts:163-192` `runSelect` returns `null` for **any**
`{ error }` — RLS denial, timeout, offline, 500 — and only caches the schema-shaped ones
(`isMissingSchemaError` matches "does not exist" / "schema cache" / "could not find").
`selectFirstSuccessful` (:195-203) then returns `[]` when every variant fails. Consumers therefore never
see a rejection: `EscalationMonitoringScreen.tsx:58-70` wraps `getEscalationMonitoring` in try/catch and
sets `error` only on a **throw**, which cannot happen, so a failed load renders the zero state. Identical
shape at `HealthScoreScreen.tsx:42-55` and `CampaignIntelligenceScreen.tsx:36-53`.

**Impact.** Directly violates the four-states law and the "no silent catch-and-show-zero" rule the rest of
the codebase honours. On a flaky rural connection an officer sees "Pending 0 / Overdue 0" and concludes
the queue is clean when the query never completed. The error card and retry button on all three screens
are unreachable code.

**Fix.** Have `runSelect` distinguish schema errors (cache and return null — the legitimate probe case)
from transport and permission errors (propagate). Let `selectFirstSuccessful` throw when every variant
failed for non-schema reasons, so the existing catch blocks light up `ErrorCard` with retry. Do this
together with DEL-09, which deletes most of the probe machinery.

#### BRK-14 — Android Back exits the app and destroys a half-filled report · High

**Evidence.** Repo-wide grep for `BackHandler` returns **exactly two lines**, both in
`components/screens/WaterSourcesScreen.tsx` (:13 import, :265 its own bottom-sheet handler).
`MainApp.tsx` does all navigation with `useState` (`activeTab`/`currentScreen` at :169-171) and registers
no hardware-back subscriber; `package.json` contains no react-navigation (only `expo-navigation-bar`).
Neither form persists anything — grep for `AsyncStorage` or `draft` across `components/forms/` returns
nothing, while the two-step disease wizard and the 1,060-line water form hold everything in component
state. `MainApp.tsx:188-200` additionally calls `StatusBar.setHidden(true,'fade')` and
`NavBar.setVisibilityAsync('hidden')` on mount, so on 3-button devices the visible Back affordance is
gone (REF-05).

**Impact.** Back is the one gesture every Android user knows, and low-confidence users press it as
"undo". Here it closes the app and silently discards a report she has been filling for two minutes. It
also makes the form a trap: no way back to the tabs except the small in-form Back control. Not present
anywhere in `PRODUCTION_READINESS.md`.

**Caveat.** Not verified on a physical device — but with no `BackHandler` and no navigator, the React
Native default (finish the Activity) is the only possible behaviour.

**Fix.** (1) Register a `BackHandler` in `MainApp` mapping hardware back to the existing
`goBackToTabs()` / `setActiveTab('home')` transitions, returning `true` so the Activity is never finished
from a sub-screen. (2) In both forms intercept back with a "Keep this report?" sheet offering **Save
draft** / **Discard**. (3) Autosave form state to AsyncStorage per user + form type and offer to restore
on next open — `SyncQueue` already proves the storage pattern. (4) Reconsider hiding the Android nav bar.

#### BRK-15 — Queued offline reports are invisible in "My Submissions" · High

**Evidence.** `components/screens/MySubmissionsScreen.tsx` imports only `supabase` (:20) — **no import
from `src/services/offlineSync` anywhere in the file** — and loads exclusively from `disease_reports`,
`water_quality_reports` and `health_alerts` (:168-220). Its `ListEmptyComponent` (:459-469) reads:

> *"Nothing filed yet. / Disease reports, water tests and alerts you submit will appear here with their
> review status."*

Offline reports live only in the `SyncQueue` AsyncStorage blob and surface only on the separate Sync
Outbox screen, reachable from the header pebble (`MainApp.tsx:626-633`) or the Profile-tab quick link
(`MainApp.tsx:602-607`).

**Impact.** She files three reports during a village round with no signal, opens the screen whose entire
purpose is "what I filed and where it stands", and is told she has filed nothing. The rational response
is to file them again — producing duplicates once sync runs, since idempotency dedupes *retries of the
same queue item*, not a second hand-filed report. Mitigation worth noting: the Sync Pebble and the
Profile quick link do surface the queue, so the work is not invisible everywhere — but the screen that
explicitly promises "what you've filed and where it stands" states the opposite.

**Fix.** Merge the queue into the timeline: read `syncQueue.getAll()` alongside the server rows and render
queued items as first-class cards at the top with a **SAVED ON PHONE** pill in the same amber the Sync
Pebble uses, plus a link to the Outbox for delete/retry. The Outbox stays as the sync-mechanics screen;
My Submissions becomes the one honest answer to "where is my work".

#### BRK-16 — Campaign Intelligence is permanently empty · Medium

**Evidence.** `pg_views`: `vw_campaign_effectiveness` is defined `… FROM campaigns c`. Live row counts:
`campaigns` = **0**, `health_campaigns` = **5** (re-confirmed 2 Aug 2026). Every write path in the app
targets `health_campaigns` (`components/forms/CampaignForm.tsx`, `lib/services/campaigns.ts`,
`ApprovalQueueScreen.tsx` `approve()` maps `'campaigns'` → `'health_campaigns'`). So the view returns
0 rows, and the other two view names tried by `selectFromFirstAvailableView`
(`'campaign_effectiveness'`, `'vw_campaign_performance'`) **do not exist** in `information_schema` at all.

The fallback (`lib/services/advancedAnalytics.ts:444-451`) then asks `health_campaigns` for
`id, campaign_name, title, name, campaign_type, …, target_population, reached_population, …` — and
`information_schema.columns` confirms `health_campaigns` has **none** of `title`, `name`,
`target_population`, `reached_population`. `runSelect` classifies the resulting 42703 as a dead probe,
caches it and returns null, so `getCampaignEffectiveness` returns `[]`.

**Impact.** `CampaignIntelligenceScreen` shows an empty state on every device forever, even with five real
campaigns in the database. Officials reasonably read "nothing here" as "no campaign data yet" rather than
"this feature has never worked".

**Fix.** Repoint `vw_campaign_effectiveness` at `health_campaigns` (participants from
`campaign_participants`, target from `target_beneficiaries`) and fix the fallback select lists to the real
columns (`campaign_name`, `target_beneficiaries`, `current_participants`, `max_participants`). Then load
the screen **as a district_officer** and confirm the five live campaigns appear.

#### BRK-17 — Campaign GPS check-in has no geofence · Medium

**Evidence.** `components/screens/CampaignsScreen.tsx:274-275`:

```ts
const hasSiteCoords = (campaign: Campaign) =>
  typeof campaign.latitude === 'number' && typeof campaign.longitude === 'number';
```

and the proximity gate at `:321-328` runs only `if (hasSiteCoords(campaign))`. Rows come from
`supabase.from('health_campaigns').select('*')`, and `information_schema.columns` confirms
`health_campaigns` has **no `latitude` and no `longitude` column** — full column list:
`id, organizer_id, campaign_name, campaign_type, description, target_audience, location_name, district,
state, start_date, end_date, target_beneficiaries, contact_person, contact_phone, notes, status,
created_at, updated_at, current_participants, max_participants, approval_status, approved_by,
approved_at, client_idempotency_key`. So `hasSiteCoords` is always false and the *"You're X km away —
check-in opens at the site"* branch is unreachable. TypeScript does not catch it because
`types/index.ts:106-131` `interface Campaign` models the **legacy `campaigns` table**
(`created_by, title, latitude, longitude, reached_population, volunteers_enrolled, spent`) — none of
which the app reads or writes.

**Impact.** "Check in at the site" degrades to a button anyone can press from home; status flips to
`attended` and the GPS fix is appended to notes, so the record looks authoritative. Camp-effectiveness
numbers built on attendance are unverifiable while the caption still promises *"Attendance counts toward
camp effectiveness"*.

**Fix.** Add `latitude`/`longitude` to `health_campaigns` (CampaignForm already collects a location) and
split the `Campaign` type into the real `health_campaigns` shape so the compiler catches this class of
drift. Until coordinates exist, make the check-in copy honest.

#### BRK-18 — The Profile notification switches do nothing · Medium

**Evidence.** `components/screens/ProfileScreen.tsx:46-48` defines `healthdrop:notificationsEnabled` and
`healthdrop:criticalOverridesDnd`; `toggleNotifications` (:164-172) and `toggleCriticalOverride` (:174+)
write them to AsyncStorage. A repo-wide grep for both key strings returns **only ProfileScreen itself**
(lines 46, 48, 89, 609).

Server side, `notify_users_push`'s token query filters on `p.is_active = TRUE` and the three target
parameters only; it never reads `profiles.notification_enabled` or `profiles.min_severity_threshold`,
both of which exist (`information_schema`: `notification_enabled` default true,
`min_severity_threshold` default `'low'`) and are referenced **nowhere in the client**
(verified by grep). The one function that *does* honour them, `get_target_users(alert_uuid)`, is called
by nothing — `push_on_alert_created` calls `notify_users_push` directly, and a repo grep for
`get_target_users` returns zero hits. `health_alerts.target_roles` and `min_severity` are likewise never
written by any code.

**Impact.** A worker who turns notifications off keeps being woken by pushes; the toggle is theatre. The
severity-threshold and role-targeting machinery in the schema is unreachable, so every alert push goes to
every active profile in the district plus every super_admin/health_admin in the country regardless of
role or preference. That both annoys and, worse, trains people to swipe alerts away.

**Fix.** Make the toggle write `profiles.notification_enabled` (and expose `min_severity_threshold`), then
rewrite `push_on_alert_created` to fan out via `get_target_users(NEW.id)` so `notification_enabled`,
`target_roles` and `min_severity_threshold` are actually honoured. If that is out of scope now, **remove
the two dead switches** rather than ship controls that lie.

#### BRK-19 — Escalation Monitoring permanently runs its client-side fallback · Medium

**Evidence.** `information_schema.views` for schema public contains `geography_columns`,
`geometry_columns`, `vw_approval_activity`, `vw_campaign_effectiveness`, `vw_disease_heatmap`,
`vw_disease_trends`, `vw_district_health_score`, `vw_district_health_summary`, `vw_outbreak_warnings`,
`vw_recent_audit_activity`, `vw_water_heatmap` — **none** of `vw_escalation_monitoring`,
`escalation_monitoring` or `vw_pending_escalations` that `lib/services/advancedAnalytics.ts:603-605`
probes. So `getEscalationMonitoring` always takes the fallback at `:612-681`, which recomputes level from
age and hardcodes `is_overdue: pending_hours >= 24` (`:597`). `EscalationMonitoringScreen.tsx:252-277`
renders each row as "DISEASE REPORT · 3f2a91b2" plus district, optional `location_name` (`:270-271`) and
an hour count; "Open Queue" (`:280-288`) calls `onOpenQueue(queueTabForRecord(...))`, which opens the
**tab**, not the item.

**Impact.** There is no server-side notion of escalation at all — the SLA is a client-side 24-hour
constant that no official can tune, and every report type shares it. When an officer does open the
screen, a 60-hour-old critical cholera report and a 60-hour-old routine one are indistinguishable: no
disease, no severity, no reporter, and the action lands them on a tab they must then search.

**Fix.** Enrich the rows with disease/severity/reporter and make the action open the specific item —
MainApp already supports `open-report:{type}:{id}`. Define SLA tiers as data (per severity, per report
type) rather than a hardcoded 24 h. The dead cron is BRK-08, tracked separately.

#### BRK-20 — Water sources are keyed on a free-typed name · Medium

**Evidence.** `sync_water_source_registry()` matches an incoming report to an existing source with
`SELECT * INTO v_existing FROM water_sources WHERE district = NEW.district AND source_name = NEW.source_name`
— exact, case- and space-sensitive — and INSERTs a brand-new source when it does not match.
`waterSourcesService.reportsForSource` (`lib/services/waterSources.ts:208-219`) reads history with the
same two `.eq()` filters. But `source_name` is a bare `TextInput` with no lookup against existing sources
(`WaterQualityReportForm.tsx:666-676`, placeholder *"e.g., Village Well #3, Main Handpump"*), and
`district` is free text with the drift documented in BRK-05.

**Impact.** "Village Well #3", "village well 3" and "Well 3" become three different wells with three
separate flag ladders and three empty histories. The **LAST TIME** comparison card renders nothing, an
unsafe flag raised last month does not carry forward, and a retest assignment points at a source nobody
will file against again. Nothing warns anyone; it just looks like a new, unflagged well.

**Fix.** Turn `source_name` into a picker over `water_sources` scoped to her district (cached offline like
the district list), with "Add a new source" as the deliberate second choice, and submit `source_id` when
one is picked. Add a fuzzy near-match warning ("Did you mean Village Well #3, flagged unsafe on 12 Jan?")
before creating a new source, and give `water_quality_reports` a `source_id` FK so identity stops
depending on spelling. Distinct from #56 (districts) and from `ROADMAP_FEATURES.md` #6, which proposes
grouping by `source_name + location` and therefore **inherits this bug**.

#### BRK-21 — The approval queue downloads every record ever filed · Medium

**Evidence.** `ApprovalQueueScreen.tsx:235, :244, :253, :263` each issue
`supabase.from(...).select('*').order('created_at', {ascending:false})` with **no `.limit()` and no
`.range()`**; the `.eq('district', profile.district)` filter is applied for `district_officer` only
(:236, :245, :254), and `loadAlerts` (:262-268) has no district filter at all. The pending badge and the
"PENDING · n" header come from filtering those in-memory arrays (:241, :250, :260, :268, :530-531), and
the triage sort (:519-529) then orders pending items oldest-first. `disease_reports.select('*')` also
pulls the PostGIS `location_geo` column. Every approve/reject calls `load()` again (:319, :337).

**Impact.** On the ASHA-grade Android phone this app is judged against, a health admin's queue means
parsing the entire national reports table on every open and every action. The fetch is **newest-first**,
so any row cap or statement timeout truncates the tail — precisely where the oldest, longest-waiting
pending items live, the ones the "OLDEST FIRST ↓" header promises to show. The pending counts then
silently under-report, and admins get no district filter, only a free-text search.

**Fix.** Query pending items separately and explicitly:
`.eq('approval_status','pending_approval').order('created_at', {ascending:true})` with a page size, and
take badge counts from `select('id', {count:'exact', head:true})` rather than array length. Load decided
history lazily behind a "Show decided" toggle. Select only the columns the row and modal render, never
`location_geo`. Add a district filter chip row for admin roles.

#### BRK-22 — The Super Admin "User Feedback" card dead-ends · Medium

**Evidence.** `components/dashboards/SuperAdminDashboard.tsx:49` counts pending feedback and `:122`
renders a badged ToolCard *"User Feedback / Pending feedback awaiting review"* (only when
`stats.pendingFeedback > 0`) whose `onPress` is `onNavigate('approval-queue')`. `ApprovalQueueScreen` has
**no feedback tab** — `components/screens/ApprovalQueueScreen.tsx:30` defines
`type QueueTab = 'disease' | 'water' | 'campaigns' | 'alerts'` and `allTabs` at `:174` is built from it.
The only feedback-reading UI ever written lives in the orphaned
`components/screens/DashboardScreen.tsx:182-245` (DEL-01).

Separately, `SyncQueue` carries a `'feedback'` item type (`src/services/offlineSync/SyncQueue.ts:22`) with
a table mapping (`OfflineSyncService.ts:58`), an outbox label (`SyncOutboxScreen.tsx:35`) and an icon
(`:43`) — and **no caller anywhere enqueues it**; `ProfileScreen.tsx:525` inserts straight to Supabase
with no offline path.

**Refuted sub-claim, recorded so nobody re-files it:** feedback is *not* a black hole.
`trg_notify_on_feedback AFTER INSERT ON public.user_feedback` calls `notify_on_feedback()`, which inserts
a notification for super_admin and health_admin carrying the first 180 chars of the feedback text; a
rolled-back probe insert produced `notifications_created=2`. `trg_notify_on_feedback_status` covers the
reply path.

**Impact.** A super admin sees "1 pending feedback", taps it, and lands on the disease approval queue with
no explanation — a navigation lie. Separately, a field worker who sends feedback from a dead zone loses
it.

**Fix.** Route the card to a real destination: either add a Feedback tab to `ApprovalQueueScreen` (the
list + detail + status-update code exists in the dead `DashboardScreen.tsx:182-245`) and navigate to
`approval-queue:feedback`, or point the card at the notifications inbox where `notify_on_feedback` already
delivers. Until one ships, **hide the ToolCard.** Separately, either wire the `'feedback'` SyncQueue type
to ProfileScreen's composer or drop it from `QueueItemType`. Partly duplicates readiness #44 (PLANNED),
already half-shipped in the DB.

#### BRK-23 — An approved alert has no lifecycle close · Medium

**Evidence.** Repo-wide grep for `from('health_alerts')` finds writes in exactly two places: the INSERT at
`AlertForm.tsx:339` and the generic approve/reject/delete in `ApprovalQueueScreen.tsx:307-341` and
`:271-291`, which touch `approval_status` only — **nothing ever writes `health_alerts.status`**, whose
default is `'active'`. Every field consumer filters **both** `status='active'` **and**
`approval_status='approved'` (`AshaWorkerDashboard.tsx:88-91`, `ClinicDashboard.tsx:50-53`,
`VolunteerDashboard.tsx:88-91`, `AllAlertsScreen.tsx:132-136`, `MapTabScreen.tsx:84`,
`HealthMapComponent.tsx:813-815`, `AIInsightsPanel.tsx:88`). But `HealthAdminDashboard.tsx:47` and
`SuperAdminDashboard.tsx:47` count "Active Alerts" on `status` alone.

**Not as bad as it first looks — recorded honestly.** An approved alert *can* be stood down today: an
admin re-reviews it (`canReReviewAlerts`, `ApprovalQueueScreen.tsx:133`; the approve/reject bar stays
visible for decided items at `:574-575`) and rejects it, and because every field consumer filters
`approval_status='approved'`, it disappears from every device. `docs/OPERATIONS.md` line 30 documents
exactly this as the retraction path.

**Impact.** The real gaps: a boil-water advisory that was correct and has ended can only be closed by
marking it *"rejected"* — a decision label that reads as "this was wrong" — with no closing note, no
`resolved_by`/`resolved_at`, and no way to tell staff the advisory has ended. The officials' Active
Alerts tiles keep counting it forever regardless.

**Fix.** Add a **Stand down** action on the alert detail (issuing role and above) setting
`status='resolved'` plus `resolved_by`/`resolved_at` and a required closing note, exactly like
`outbreaksService.resolve()` (`lib/services/outbreaks.ts:301-307`). Push a short "this advisory has
ended" notice to staff who acknowledged it. Fix the two admin tiles to filter
`approval_status='approved'` too. Optionally add `expires_at` so routine advisories self-retire.

#### BRK-24 — `.gitignore` excludes `.env.example` and `database_structure/` · Medium

**Evidence.**

```text
git check-ignore -v .env.example database_structure/ mesc/
.gitignore:38:.env.example
.gitignore:66:database_structure/
.gitignore:69:mesc/
```

`git ls-files` confirms **none** of the 17 SQL files in `database_structure/` (250 KB:
`DISTRICT_OFFICER_RLS.sql`, `OUTBREAK_DETECTION.sql`, `PUSH_NOTIFICATIONS.sql`, `APPROVAL_SYSTEM.sql`,
`AUDIT_LOG.sql`, …) and no `.env.example` are tracked, and `supabase/` tracks only the two edge functions.
`README.md:65` says `cp .env.example .env`; `README.md:69` links `[.env.example](.env.example)`;
`README.md:114` documents `database_structure/` in the repo tree; `README.md:138` instructs *"commit the
SQL to `database_structure/`"*; `PRODUCTION_READINESS.md` repeats that at lines 13, 225, 271 and 290.
`build-on-push.yml:13-14` carries `paths-ignore` entries for `database_structure/**` and `mesc/**` that
**can never match**.

**Impact.** Anyone cloning the public repo hits a 404 on the README's `.env.example` link and cannot
configure the app. Two documents instruct contributors and agents to commit SQL to a directory git
silently refuses, so that instruction can never be followed. The CI `paths-ignore` entries are inert.

**Not as bad as claimed elsewhere:** `.gitignore` is *not* the only copy of the schema —
`.github/workflows/db-backup.yml` runs a daily `pg_dump --no-owner --no-privileges --schema=public -Fc`
(schema **and** data) encrypted as a CI artifact, and readiness #38 records it as DONE and verified. Also
note the `database_structure` SQL is dated Feb–Mar and has drifted from live (it predates the three
conflicting `overall_quality` CHECKs of BRK-02), so it is **historical migration scripts, not an
authoritative schema.**

**Fix, ordered.** Delete `mesc/` **first** (SEC-14: live credentials + byte-identical duplicate schema
file), then remove the `.env.example`, `database_structure/` and `mesc/` lines from `.gitignore` and
commit `.env.example` and `database_structure/*.sql`. Keep `.env` and `.env*.local` ignored. Delete the
now-meaningless `paths-ignore` entries at `build-on-push.yml:13-14`. Confirm `SUPABASE_DB_URL` is set so
`schema-snapshot.yml` actually produces `supabase/schema.sql` — that file is the real fix for
"authoritative schema in the repo".

#### BRK-25 — The manual release lane cannot trigger a build · Medium

**Evidence.** `.github/workflows/prepare-release.yml` checks out with `actions/checkout@v4` and **no
`token:` override** (so credentials are the default `GITHUB_TOKEN`), and its last step runs
`git push origin HEAD`, `git tag -a "$TAG"`, `git push origin "$TAG"`. GitHub does not start workflow runs
for events raised by `GITHUB_TOKEN`, so neither the version-bump commit (`build-on-push.yml`
`on: push: branches: main`) nor the `v*` tag (`build-android-release.yml:3-6`) can trigger.
`README.md:83` nonetheless states: *"prepare-release.yml (manual dispatch) bumps package.json/app.json and
pushes a v* tag; build-android-release.yml builds and releases from that tag."*

`build-android-release.yml` is otherwise a near-verbatim copy of `build-on-push.yml`'s job (same
`eas build --profile preview`, same download, same `softprops/action-gh-release`) **minus the design
gate** — `build-on-push.yml:51-52` runs `node scripts/check-contrast.cjs` and the tag workflow has no
equivalent — and carries a pointless `Setup Java 17` step (lines 24-28) for a build that runs remotely on
EAS.

**Caveat.** The `GITHUB_TOKEN` no-trigger behaviour is documented GitHub Actions semantics; it could not
be executed here, so that link is reasoned rather than reproduced. Everything else was read line by line.

**Impact.** An owner who follows the documented manual procedure gets a version bump and a tag and **no
APK**, silently, with no failed run to notice. If someone ever pushes a `v*` tag from a laptop, that build
**bypasses the contrast gate that exists precisely because an unreadable header once shipped.**

**Fix.** Delete `.github/workflows/build-android-release.yml` and `.github/workflows/prepare-release.yml`,
and delete `README.md:83`. `build-on-push.yml` already does the whole job and fires on every push to
`main`. If a manual semver bump is still wanted, make it a `workflow_dispatch` input on
`build-on-push.yml`. If both are kept instead, `prepare-release` must push with a PAT **and**
`build-android-release` must gain the contrast step.

### 4.2 Incomplete

Built, then never connected or never finished. Six of these are the **same failure**: a screen exists, a
permission grants it, and only one dashboard links it — because the person who built it logged in as one
role and stopped. That is the near-black-header lesson repeating.

| ID | Finding | Severity | Effort |
| --- | --- | --- | --- |
| INC-01 | Water Sources — the whole flag→fix→retest→reopen loop — is reachable only by district_officer | High | S |
| INC-02 | Weekly Summary, Advisory Composer and Outbreak Console are unreachable for health_admin and super_admin | High | M |
| INC-03 | The water report form is entirely English inside a Hindi flow, and asks a field worker for pH and TDS | High | M |
| INC-04 | A water-source retest assignment never reaches the person it is assigned to | High | M |
| INC-05 | Nothing safety-critical is readable offline — only the AI commentary is cached | High | M |
| INC-06 | The sign-in / sign-up screen is English-only with no language switcher | Medium | S |
| INC-07 | The Hindi water form is missing from a phase-1 item marked DONE; the review status is contradicted three ways | Medium | M |
| INC-08 | Report forms never prefill the reporter's own district/state, and the registry has no offline copy | Medium | M |
| INC-09 | Disease names are free text; no thresholds for the two commonest field diseases; two functions disagree on case | Medium | M |
| INC-10 | A flagged well's retest can only be assigned to someone who already reported that exact source | Medium | M |
| INC-11 | `audit_logs` is written on every report change, read by nothing, never purged — and skips the two tables that matter | Medium | M |
| INC-12 | Audit-log reader RPCs exist and are never called; `purge_old_audit_logs` is not scheduled | Low | S |
| INC-13 | "Case follow-up" ships as a permanently disabled "Coming soon" tile for every role | Low | S |

---

#### INC-01 — Water Sources is reachable only by district_officer · High

**Evidence.** `components/MainApp.tsx:110` grants `'water-sources'` to `ALL_ROLES` and routes it at
`MainApp.tsx:485-494`, but the **only navigation call in the entire codebase** is
`components/dashboards/DistrictOfficerDashboard.tsx:224` (a StatCard labelled "Water Reports"). Grep for
`'water-sources'` across `App.tsx components lib src` returns exactly that one call site plus MainApp's
own type (:80), permission (:110), type-guard (:149) and route (:485) lines.

The screen itself is built for all six roles: `components/screens/WaterSourcesScreen.tsx:48-55` defines
`ROLE_TITLE` for every role including `asha_worker` and `volunteer`, and `:41-48` defines `OFFICIAL_ROLES`
as the **write** gate (*"RLS mirror: only these roles may UPDATE water_sources"*). The E·02 retest
hand-off `onNavigateToForm(\`new-water-report:prefill:${src.id}\`)` exists only at
`WaterSourcesScreen.tsx:891` (comment: *"the retest itself, for everyone"*), and `MainApp.tsx:244` handles
that prefix. `AshaWorkerDashboard`'s Operations Intelligence section (`:233-237`) offers health-score,
campaign-intelligence and widget-customization only; `ClinicDashboard.tsx:183-189` and
`VolunteerDashboard` never link it.

**Impact.** The ASHA worker who physically walks back to the well and retests it can never open the
water-source record, never see whether her flag was fixed, and can never start a retest from the source.
1,622 lines of finished, read-safe code that five of six roles cannot reach. **The retest half of the
mission loop is unreachable for the primary persona.**

**Fix — FINISH, cheap.** Add a "Water Sources" ToolCard to the `operations_tools` section of
`AshaWorkerDashboard`, `VolunteerDashboard`, `ClinicDashboard`, `HealthAdminDashboard` and
`SuperAdminDashboard` (same one-liner pattern as the existing "District Health Score" cards), and ideally
a shell quick-link on the Map tab. The screen already role-gates writes via `OFFICIAL_ROLES`, so read
access for ASHA/volunteer is safe as-is.

#### INC-02 — Weekly Summary, Advisory Composer and Outbreak Console are unreachable for admins · High

**Evidence.** `MainApp.tsx:108-113` grants `outbreak-signal` and `outbreak-console` to
`['super_admin','health_admin','district_officer']`, `weekly-summary` to those three plus `clinic`, and
`advisory-composer` to the three. A repo-wide grep for those route names outside MainApp returns hits in
**exactly one file**: `DistrictOfficerDashboard.tsx:57` (`onNavigate('outbreak-signal:${id}')`), `:307`
(Weekly Summary ToolCard) and `:308` (Broadcast to staff ToolCard).
`grep -n 'outbreak' -i components/dashboards/SuperAdminDashboard.tsx components/dashboards/HealthAdminDashboard.tsx`
returns **zero matches**. `HealthAdminDashboard`'s Operations Intelligence section (`:205-210`) and
`SuperAdminDashboard`'s (`:182-187`) contain only health-score, campaign-intelligence,
escalation-monitoring and widget-customization; `ClinicDashboard`'s (`:183-189`) is the same set and omits
weekly-summary despite holding permission.

The screens contradict the routing: `components/screens/AdvisoryComposerScreen.tsx:166` tells a blocked
user *"Staff advisories are sent by district officers and health administrators."* Sizes:
`WeeklySummaryScreen` 796 lines, `AdvisoryComposerScreen` 471, `OutbreakSignalScreen` 784,
`OutbreakConsoleScreen` 894. `WeeklySummaryScreen.tsx:57` hard-binds
`const district = (profile.district ?? '').trim();` and `:325-331` renders "No district on your profile"
with no picker.

**Impact.** A state health administrator cannot produce the weekly IDSP digest, cannot broadcast an
advisory to field staff, and cannot open the response console for an outbreak in any district — the three
tools that make the role operational. The app *tells* her advisories are hers to send and gives her no
button that sends one. The permission table and the UI disagree, which makes role coverage unauditable.

**Fix — FINISH, five lines per dashboard.** Copy `DistrictOfficerDashboard.tsx:307-308` verbatim into the
`operations_tools` section of `HealthAdminDashboard` and `SuperAdminDashboard`, and the Weekly Summary card
into `ClinicDashboard`. Give `WeeklySummaryScreen` an optional district selector (`districtsService`
already exists and `LocationField` consumes it) defaulting to `profile.district` and shown only for
multi-district roles. Add an outbreak list entry point for admins so `outbreak-signal:{id}` is reachable
without a district dashboard. Alternatively, narrow `SCREEN_PERMISSIONS` so the table stops claiming
otherwise — but that is the wrong direction for the product.

**Sequencing note.** The outbreak half is moot until BRK-04 is fixed: `public.outbreaks` holds 0 rows and
detection can never fire for field-worker reports, so there is no signal for **anyone** to review today.

#### INC-03 — The water report form is English-only and asks for pH and TDS · High

**Evidence.** `grep -rl useTranslation` over `components/ src/ lib/ App.tsx` returns exactly nine files
(listed in §2.5). `WaterQualityReportForm.tsx` is **not** among them, yet `ReportTypeSheet.tsx:156-164`
routes to it through `t('reportSheet.waterTitle')` — so a Hindi user taps a Hindi row and lands on
hardcoded English: "Source Name \*", "Overall Water Quality \*", "pH Level", "TDS Level (ppm)", and
contaminant chips Arsenic / Fluoride / Nitrates / E. coli / Turbidity / High TDS
(`WaterQualityReportForm.tsx:313-325`). `src/components/LocationField.tsx` is likewise untranslated
("LOCATION NAME \*" :375, "DISTRICT \*" :391, "STATE \*" :412), so even the Hindi disease form has an English
block in its middle. Grep for `NetInfo` in `WaterQualityReportForm.tsx` returns nothing — **no offline
banner**, unlike `DiseaseReportForm.tsx`. `households_affected` and `contamination_level` have no columns
and are concatenated into `notes` (`:386-399`, with a comment saying so).

**Impact.** Water is one of the two things the mission asks her to report, and it is the half that was
never translated. A Hindi-first ASHA hits a wall of English lab vocabulary she has no kit to measure, with
no offline warning and no "what happens next" reassurance — the disease form gives her all three.

**Fix.** (1) Translate `WaterQualityReportForm` and `LocationField` into the existing `hi.json` — the same
size of job as the disease form already done. (2) Demote pH/TDS to an optional *"If you have a test
strip"* section and lead with colour, smell, taste and whether people nearby are sick. (3) Add the offline
banner and the same confirmation ladder so both report types behave identically. (4) Give
`households_affected` and `contamination_level` real columns instead of stuffing them into `notes` where
no officer can filter on them.

**Tracker note.** `PRODUCTION_READINESS.md` #28 ("String extraction phase 1") lists
`components/forms/WaterQualityReportForm.tsx` in its Files line and its checklist says *"Convert the four
`components/forms/` files to `t()`"*, yet its status reads "DONE — phase 1: tabs, report sheet, disease
wizard, sync outbox". **That item was closed with less than its stated scope. Reopen it.**

#### INC-04 — A retest assignment never reaches the person it is assigned to · High

**Evidence.** `lib/services/waterSources.ts:135-157` `assignRetest` updates only `retest_assigned_to` and
`retest_due_date` on `water_sources` — no `notifications` insert, no `notify_users_push`, no outbox row.
`components/screens/WaterSourcesScreen.tsx:343-364` `saveAssign` calls it and then merely merges the
returned row into local state. A repo-wide grep for `retest_assigned_to` returns **exactly three hits, all
inside `waterSources.ts`** (the type at :42, an assignee join at :59, the update at :145) — it is never
queried for the signed-in user in any dashboard, inbox or list. `water_sources` has **no triggers at all**
(confirmed in `pg_trigger`). The officer's UI meanwhile renders *"Retest due … · assigned to {name}"*
inside a PromiseStep whose subtitle reads *"A retest needs an owner and a date, not a hope."*

**Impact.** The flag → treat → retest → reopen loop the water feature is built around is broken at the
handoff. The district officer sees a named owner and a due date and believes the ASHA worker has been
tasked; she has no notification, no task list, and no way to discover the assignment short of an officer
phoning her. Overdue counters then blame a worker who was never told.

**Fix.** On `assignRetest`, insert a targeted `notifications` row for the assignee
(`user_id = assignedTo`, `related_type 'water_source'`) and call `notify_users_push` with
`p_target_user_id`. Add a **"Retests assigned to you"** region to the ASHA and volunteer dashboards driven
by `water_sources.retest_assigned_to = auth.uid()`, and an "Assigned to me" filter on
`WaterSourcesScreen`.

**Blocker the obvious fix misses:** `notifications_insert` currently restricts inserts to
super_admin/health_admin and same-district district_officer (verified in `pg_policies`), so a
**clinic-initiated** assignment will be rejected. This needs either a `SECURITY DEFINER` RPC or a widened
policy. Note also `related_type` must be an allowed CHECK value — see BRK-03 for what happens when it is
not.

#### INC-05 — Nothing safety-critical is readable offline · High

**Evidence.** `grep` for `AsyncStorage.setItem` across `components/ lib/ src/ App.tsx` returns **17 call
sites**: SyncQueue (×4), the profile cache (`App.tsx:79`), theme, language, widget prefs, notification
toggles, the critical-override flag, the first-run flags (×2), the error log, the advisory read-ledger,
the **AI chat transcript** (`AIChatbot.tsx:112`) and the **AI insights payload**
(`AIInsightsPanel.tsx:132`, rendered as `t('ai.savedOnPhone')` — *"Saved on phone · {{when}}"*).

Health alerts, campaigns, water sources and submissions are **never cached**. Offline,
`AshaWorkerDashboard.load()`'s queries all fail and the region collapses to one `ErrorCard` with the
alerts block rendered null (`:137-141`, `:215-226`); `AllAlertsScreen.load()` sets *"Couldn't load alerts
— check connection"* (`:145-148`). `lib/supabase.ts:43-49` creates the client with **no custom fetch and
no AbortSignal**, so a half-open rural connection leaves these screens in skeleton state indefinitely.

**Impact.** The app is offline-first for **writing** and online-only for **reading**. She walks into the
village with no signal and cannot re-read the cholera alert she saw an hour ago, cannot check which well
was flagged, cannot see what she submitted — but she **can** still read yesterday's AI-generated
commentary about all of it. That priority ordering is backwards for a system whose rule is that automation
must never outrank the human-approved alert. Readiness #13 (DONE) covers only the profile cache on cold
start, so this is not a duplicate.

**Fix.** (1) Cache the last successful fetch of active approved alerts, the user's own submissions and
tracked water sources to AsyncStorage **per user** (a few KB each) and render them with an "as of HH:MM"
stamp plus the offline pebble instead of an error card. (2) Show the cached copy first and revalidate in
the background. (3) Give the Supabase client a fetch wrapper with an ~15 s `AbortSignal` so a half-open
socket becomes a retryable error rather than a permanent skeleton.

#### INC-06 — The sign-in / sign-up screen is English-only with no language switcher · Medium

**Evidence.** `components/AuthScreen.tsx` is 1,277 lines and grep for `useTranslation` / `i18n` /
`language` / `हिन` returns **zero hits** — every string, including the role picker and all field labels,
is hardcoded English, and there is no language control. `lib/i18n/index.ts:41` sets `lng:'en'` and the only
override is the value persisted under `STORAGE_KEY` (`:56-65`). The switcher exists only at
`ProfileScreen.tsx:593-596` — behind sign-in, sign-up **and** the Profile tab.

**Impact.** The primary persona reads Hindi. Her first encounter with HealthDrop is an English sign-up form
asking her to choose a role and type a district, with no visible way to change language, so whoever
onboards her must do it in English.

**Two claims deliberately NOT made here.** (a) *"Seed the language from `expo-localization`"* contradicts a
documented owner decision — readiness #27 states *"A manual picker beats expo-localization for ASHA users
whose phones often run English OS locale"* and #29's checklist says *"Ship Hindi behind the ProfileScreen
picker only (no auto-detection)"*. (b) *"After sign-out she is back to English"* is **false** — sign-out
(`App.tsx:394-399`, `ProfileScreen.tsx:250`) removes only the profile cache key; the language key
survives.

**Fix.** Put a two-option **EN / हिन्दी** toggle in the AuthScreen header — roughly 20 lines and the
highest-leverage translation work left — and translate the AuthScreen strings into `hi.json`. The choice
already persists under `healthdrop:language` independently of the session, so no extra persistence work is
needed. Readiness #28 lists `AuthScreen.tsx` in scope and is marked DONE; reopen it.

#### INC-07 — The Hindi water form gap, and a three-way contradiction about review status · Medium

**Evidence.** Flattening both locale files: `en.json` has 172 keys across 8 namespaces (common, tabs,
reportSheet, diseaseForm, outbox, ai, firstRun, completeness); `hi.json` matches key-for-key with zero
missing and **one extra key**, `_note`: *"Machine-drafted Hindi — needs native-speaker review before
public launch"*. `t()` call counts by file: DiseaseReportForm 64, SyncOutboxScreen 48, AIInsightsPanel 32,
AIChatbot 25, MainApp 22, ProfileScreen 21, ReportTypeSheet 19, AshaWorkerDashboard 15,
VolunteerDashboard 9. `grep -c useTranslation` returns **0** for `WaterQualityReportForm.tsx`,
`AllAlertsScreen.tsx`, `MySubmissionsScreen.tsx`, `NotificationsInboxScreen.tsx`, `WaterSourcesScreen.tsx`
and `CampaignsScreen.tsx`. MainApp's own shell strings are hardcoded English while its tab labels are
translated: "My Submissions" (`MainApp.tsx:604`), "Sync Outbox" (`:606`), "Create" (`:693`).

`PRODUCTION_READINESS.md` #28 is marked *"DONE — phase 1: tabs, report sheet, disease wizard, sync
outbox"* under the title *"field-worker surfaces (**forms**, …)"*, and #29 is marked *"DONE — Hindi pack
shipped and **natively reviewed by the owner**"* — which `hi.json`'s own `_note` **and** `README.md:131`
(*"machine-drafted and awaiting native-speaker review"*) both contradict.

**Impact.** An ASHA worker on Hindi files a disease report in Hindi, taps "Water Quality" and lands in a
fully English form — a field-worker form, inside item #28's stated scope. Separately, two of the three
status sources disagree about whether the Hindi has been natively reviewed, so the tracker cannot be
trusted on this point.

**Fix.** (1) Add a `waterForm` namespace mirroring `diseaseForm` (~49 keys) and wire
`WaterQualityReportForm` — this is the gap inside a DONE item (same work as INC-03's limb 1). (2)
Translate the three hardcoded MainApp shell strings. (3) **Reconcile the review status**: either delete
`hi.json`'s `_note` and `README.md:131`, or reopen #29.

**Explicitly not filed as a defect:** alerts / submissions / inbox being English is **outside** the
declared phase-1 scope. Track it as an explicit phase 2, do not report it as a bug.

#### INC-08 — Report forms never prefill the reporter's own district/state · Medium

**Evidence.** `DiseaseReportForm.tsx:264-270` and `WaterQualityReportForm.tsx:160-166` both initialise
`district`/`state`/`location_name` to `''`. `DiseaseReportFormProps` (`DiseaseReportForm.tsx:29-38`) is
only `{ onSuccess, onCancel, refillReportId }` — the profile is never passed, although MainApp *does* pass
`profile` to `AlertForm` (`MainApp.tsx:371`). All three fields are required
(`DiseaseReportForm.tsx:488-493`; `WaterQualityReportForm.tsx:356-359`). The only autofill is reverse
geocoding, and **both** paths need network — `Location.reverseGeocodeAsync` then a Nominatim fetch
(`src/hooks/useLocation.ts:83-152`). `lib/services/districts.ts:25-28` caches in-module for 5 minutes with
**no AsyncStorage persistence**, and its own header calls the registry *"a SUGGESTION source, never a
gate"*. The live registry has 5 rows, three of which (Kovilancheri, Mambakkam, Moolacheri) are villages.
`en.json:49` `gpsHelp` reads *"GPS works without network"* / `hi.json:50` *"GPS बिना नेटवर्क के भी काम करता
है"* — true of coordinates, **false of the address the form needs**.

**Impact.** On the flaky-network day the app was built for, filing one report means typing a village name,
a district and a state into an English keyboard, several times a day, with a help string that promises the
GPS will handle it. Prefill plus corrected copy turns three typed words into one confirmation tap.

**Fix.** (1) Pass `profile` into both forms and seed `district`/`state`/`location_name` from it — she
reports in her own area almost always, and correcting a prefilled value is one tap. (2) Persist
`districtsService.listAll()` to AsyncStorage so suggestions survive offline, and ship a **bundled seeded
district list** rather than a table backfilled from user typos. (3) Fix the copy: GPS gives coordinates
offline, addresses it does not.

**Do not re-file** the "make district a picker / stop writing free text" limb — that is
`PRODUCTION_READINESS.md` #56 (PLANNED, open), whose checklist already says *"Add a canonical
state-to-district picker (LGD codes/names) to ProfileSetup and all report forms"*.

#### INC-09 — Free-text disease names, missing thresholds, and a case-sensitivity mismatch · Medium

**Evidence.** `information_schema.columns`: `disease_reports.disease_name` / `district` / `state` are
`text NOT NULL` with no FK and no CHECK; `pg_constraint` shows nothing references `districts`.
`detect_outbreak_after_report()` selects thresholds `WHERE ot.disease_name = NEW.disease_name` and
aggregates `dr.disease_name = NEW.disease_name AND dr.district = NEW.district` — exact, **case-sensitive**
— while `recompute_outbreak_on_rejection()` uses `lower(disease_name)` **on both sides**.
`SELECT * FROM outbreak_thresholds` returns only Cholera(10), COVID-19(100), Dengue(30), Malaria(40),
Typhoid(25). `DISEASE_OPTIONS` (`components/forms/DiseaseReportForm.tsx:42-48`) also offers **Diarrhea**,
**Jaundice** and "Other…", which get the hardcoded fallback of **50 cases / 7 days**.

**Impact.** The single most common waterborne complaint an ASHA reports — diarrhoea in a village of a few
hundred — needs 50 cases in 7 days before anything happens, a threshold that will never be crossed before
people die. Jaundice is the same. Separately, detection and recompute-on-rejection key on the disease name
differently, so an outbreak created under "Cholera" can be recomputed under a `lower()`-matched row set and
the two can diverge.

**Fix, in value order.** (1) **Seed `outbreak_thresholds` for every value in `DISEASE_OPTIONS` with
village-scale numbers reviewed by the owner** — a data change, and the highest-value single fix here.
(2) Make `detect_outbreak_after_report()` match the threshold lookup and the aggregation with
`lower(disease_name)`, identical to `recompute_outbreak_on_rejection()`. (3) Add a `diseases` registry
(canonical name, aliases, `disease_type`, default threshold) and normalise `disease_name` on write — this
also removes the free-text vector behind SEC-04.

**Do not re-file** the district half — that is #56.

#### INC-10 — A retest can only be assigned to someone who already reported that exact source · Medium

**Evidence.** `WaterSourcesScreen.tsx:305-314` builds the assignee list **solely from `reports`** — the
reporters of that one source — and the assign sheet (`:973-1017`) renders only those people, falling back
to *"No one has filed a reading for this source yet — ask a field worker to report it first."*
`waterSourcesService.assignRetest` accepts any uuid, so the restriction is purely the picker. Since sources
are keyed on `district + exact source_name` (BRK-20), a spelling variant also empties the picker for a well
that **has** in fact been reported.

**Impact.** The officer cannot hand a retest to the ASHA who actually covers that hamlet unless she happens
to have filed on that well before; if the original reporter has moved or gone inactive there is no one to
assign, and the sheet dead-ends telling the officer to go get a report filed first.

**Fix.** Populate the assignee picker from active `asha_worker`/`volunteer` profiles in the source's
district, keeping the last reporter pinned at the top as the smart default.

**Do not re-file** the overdue-chasing limb (daily cron notifying assignee at due date and officer when
overdue, plus a weekly-summary line) — that is `ROADMAP_FEATURES.md` #6 "Unsafe Water Source Watchlist with
Retest Reminders". Verified: nothing currently reads `retest_due_date` — it appears in no trigger, no
dashboard widget and no weekly-summary figure.

#### INC-11 — `audit_logs` skips the two tables where accountability matters most · Medium

**Evidence.** `information_schema.triggers`: `audit_log_changes()` is attached to exactly four tables —
`trg_audit_campaigns` (a table with 0 rows and no app reference), `trg_audit_disease_reports`,
`trg_audit_health_campaigns`, `trg_audit_water_quality_reports`. **No audit trigger exists on
`health_alerts`, `profiles`, `outbreaks` or `water_sources`** (full trigger listing checked). Repo-wide
grep for `from('audit_logs')`, `vw_approval_activity`, `vw_recent_audit_activity` → **zero hits** in
application code, though both views exist. `audit_logs` holds 115 rows and carries 6 secondary indexes plus
the pkey. `purge_push_telemetry()` covers `push_notification_outbox` + `notification_logs` and
`purge_old_app_events()` covers `app_events`; **nothing purges `audit_logs`**.

**Impact.** The questions an audit log exists to answer — *who approved this public alert*, *who granted
this user the district_officer role* — are precisely the ones it cannot answer, because those tables have
no trigger. Meanwhile every report edit stores two whole-row JSONB snapshots that no human or screen can
read, on a free tier with a 500 MB ceiling and no retention job.

**Fix.** Add audit triggers to `health_alerts` and `profiles` (at minimum `role`, `role_verified`,
`is_active`). Add a retention purge for `audit_logs` to the existing nightly cron. Expose a read path —
surface `vw_approval_activity` as an admin "who decided what this week" panel — so the data earns its
storage.

**Do NOT** drop `idx_audit_logs_table_name` or `idx_audit_logs_record_id` as "redundant prefixes": all
seven `indexdef`s were read, and they are `(table_name, created_at DESC)` and `(record_id, created_at
DESC)`, **neither of which is a prefix of** `(table_name, record_id, created_at DESC)`. Dropping them
removes the only support for the two most likely read patterns.

#### INC-12 — Audit reader RPCs exist and are never called · Low

**Evidence.** Four reader functions exist in `pg_proc`: `get_audit_trail(p_table_name,p_record_id)`,
`get_approval_audit_log(p_table_name,p_days_back)`, `get_user_audit_log(p_user_id,p_days_back)`,
`get_deleted_records(p_table_name,p_days_back)`. The app makes **exactly three RPC calls in total** —
`grep -rn '\.rpc('` over `App.tsx components lib src supabase` returns `lib/services/campaigns.ts:235`
(`increment_volunteers`, **which does not exist**), `lib/services/users.ts:295` (`claim_push_token`) and
`supabase/functions/push-notifications/index.ts:171` (`update_push_outbox_status`).
`purge_old_audit_logs(p_days_to_keep, p_purge_deletes)` exists but is not among the 4 rows in `cron.job`.

**Impact.** The evidence trail that proves who verified what is not surfaced anywhere in the app, so an
approval or rejection cannot be justified from the phone. Growth is negligible today (115 rows) but
unbounded. Note the dispute scenarios this would serve cannot even occur yet, because every UPDATE on
`disease_reports` is discarded (BRK-01) — there are zero approvals and zero rejections of field-worker
reports in the system.

**Fix.** Cheapest useful step: call `get_approval_audit_log` from the report detail sheet in
`ApprovalQueueScreen` / `MySubmissionsScreen` to render a "who changed what, when" timeline — the RPC
already returns that shape. Schedule `purge_old_audit_logs` alongside the existing purge jobs (that half
belongs to readiness #40). If the audit trail is deliberately a DB-forensics tool, say so in
`docs/OPERATIONS.md` and delete the three unused reader RPCs.

#### INC-13 — "Case follow-up" ships as a permanently disabled tile · Low

**Evidence.** `components/forms/ReportTypeSheet.tsx:165-172` renders a `SheetRow` with `disabled`
**hardcoded** and `disabledNote={t('reportSheet.comingSoon')}` — unconditionally, for every role, with no
feature flag and no date, and unlike the two rows above it, **not wrapped in a `can(...)` guard**. The
strings are fully translated in both locales (en: "Case follow-up" / "Update an earlier patient"; hi:
"केस फ़ॉलो-अप" / "पहले के मरीज़ की ताज़ा जानकारी दें"). `grep -rn 'follow_up|followUp|follow-up'` across
`components lib src types` returns only `ReportTypeSheet.tsx:167` and `:168` — there is **no follow-up
model, service, table or screen anywhere**, and no follow-up table exists in `public`.

**Impact.** "Treatment follow-up" is one of the two ways the mission loop is supposed to close, and the app
advertises it **in Hindi** at the exact moment the ASHA worker is choosing what to report, then greys it
out. A disabled row also costs a ~72 dp slot on a 360 px screen where the two real options should dominate.
It is at least honestly labelled "coming soon", which is why this is Low and not Medium.

**Fix.** **REMOVE for now**: delete the row and the three i18n keys so the sheet shows only what works.
FINISH only if it is genuinely being built this cycle — a follow-up needs a link from a disease report to a
follow-up record, a status ladder, and a place in My Submissions. That is a feature, not a form variant
(see NEW-06).

---

## 5. Delete list

Everything here is proven unused. The column **"What breaks"** is the point: read it before deleting.
Deletions are the cheapest quality win available on this codebase — roughly **5,000 lines of source, six
npm dependencies, four config files and seven database objects** — and they make every later audit and
every RLS review smaller.

| ID | What to delete | Proof it is unused | What breaks | Effort |
| --- | --- | --- | --- | --- |
| DEL-01 | `components/screens/DashboardScreen.tsx` (1,294 lines) and `components/screens/AdminManagementScreen.tsx` (1,898 lines) | See below | `admin-management` route becomes dead → remove it too | S |
| DEL-02 | NativeWind / Tailwind / shadcn stack: 6 deps + 4 config files + Metro transform | 0 `className=` props in app JSX | Nothing — all styling is StyleSheet + tokens | S |
| DEL-03 | `expo-blur`, `expo-linear-gradient`, `react-native-reanimated` | 0 source references | Nothing; do it in the same pass as DEL-02 (peer dep) | S |
| DEL-04 | Dead half of `src/services/offlineSync/index.ts` (~200 lines incl. a second submit path) | 0 consumers of the exported submit functions | Nothing; keep `useSyncCounts` + `clearQueueForUser` | S |
| DEL-05 | `components/shared/InputField.tsx`, `SelectDropdown.tsx`, `StateDropdown.tsx` (714 lines) + the map re-export in the barrel | 0 references outside their own files | Map consumers must import `./HealthMapComponent` directly | S |
| DEL-06 | DB: `campaigns`, `campaign_volunteers`, `disease_trends`, `ai_recommendations`, `ai_generated_alerts`, `notification_logs` | All 0 rows, 0 code references | `vw_campaign_effectiveness` must be repointed first (BRK-16) | S |
| DEL-07 | `lib/services/campaigns.ts` + its barrel line | 0 importers; calls a nonexistent RPC | Nothing | S |
| DEL-08 | The AI-alert stack: `generate_ai_alerts()`, `getAIAlerts`, `mapAIAlertRow`, MapTabScreen's AI Signal Feed | 0 rows, unscheduled, unreachable | The Map tab loses a card that can never show a row | M |
| DEL-09 | Dead probe branches in `lib/services/advancedAnalytics.ts` (~60 lines) | Probed relations do not exist | Nothing; do together with BRK-13 | S |
| DEL-10 | `utils/supabase.ts` + `utils/`; 20 unused types; 5 unused aggregate exports | Verified per symbol | Nothing | S |
| DEL-11 | `AICard`, `urgencyColor` in `DashboardShared.tsx` — **after adopting `AILabel`** | 0 references | Adopt `AILabel` first, then delete `AICard` if still unused | S |
| DEL-12 | `.github/workflows/build-android-release.yml`, `prepare-release.yml`, `README.md:83` | Cannot trigger (BRK-25) | Nothing — `build-on-push.yml` is the working lane | S |
| DEL-13 | `mesc/` | Byte-identical duplicate + live credentials | Nothing; **do this first** (SEC-14) | S |
| DEL-14 | Deployed `bright-action` edge function | 0 repo references | Nothing; but read NEW-04 first | S |
| DEL-15 | `ReportTypeSheet` "Case follow-up" row + 3 i18n keys | No follow-up model exists (INC-13) | Nothing | S |

### DEL-01 — `DashboardScreen.tsx` is dead, and it takes `AdminManagementScreen` unreachable with it

`grep -rn 'DashboardScreen'` across `.ts`/`.tsx` returns only the file's own interface (:48), component
(:83), console tags and default export (:1294), plus the comment at
`components/dashboards/DashboardRouter.tsx:3` — *"Replaces the old monolithic DashboardScreen.tsx logic"*.
Its header (lines 1-5) reads *"DASHBOARD SCREEN - Main Home Screen ("Prakash" design)"* — the iteration
`README.md:127` records as superseded.

`DashboardScreen.tsx:413` and `:426` are the **only two** `onNavigateToForm('admin-management')` calls in
the codebase; a raw grep for `'admin-management'` returns exactly those two plus `MainApp.tsx:68` (type),
`:98` (permission: super_admin/health_admin/clinic), `:137` (type-guard) and `:375` (route).
`AdminManagementScreen` is imported at `MainApp.tsx:31` and rendered at `:378`, but **nothing can ever set
`currentScreen` to `'admin-management'`.** Line counts verified: 1,294 and 1,898.

**Impact of keeping it.** 3,192 lines of unreachable UI, including a full users/disease/water/campaigns/
analytics admin console that duplicates `UserManagementScreen` and `ApprovalQueueScreen`. It is
type-checked on every commit, re-read by every audit, and **scheduled for fixes in four still-open
readiness items** — an agent working #43 (logger migration) or #25 (demo seed) would burn effort on a dead
file. Reviewers reading it will believe feedback triage and admin management ship. Readiness #19 (DONE —
"orphaned components removed") swept HelloWorld/HeroSection/Navbar/Sidebar/Card and missed this.

**Fix.** Delete `DashboardScreen.tsx` **after** lifting its feedback-triage block (lines 182-245) if the
ApprovalQueueScreen feedback tab is built (BRK-22). Then decide on `AdminManagementScreen`: its user tab
duplicates `UserManagementScreen` and its report tabs duplicate `ApprovalQueueScreen`, so delete it too and
drop `'admin-management'` from `ScreenType` / `SCREEN_PERMISSIONS` / `isScreenType` in `MainApp.tsx` — or,
if the clinic role genuinely needs it, give it an entry point in `ClinicDashboard`. Strike
`DashboardScreen.tsx` from the `_Files:_` lists at `PRODUCTION_READINESS.md:587, 613, 699, 702, 753`.

### DEL-02 — The NativeWind / Tailwind / shadcn stack is declared inert and still ships

`babel.config.js` lines 1-7 state *"NativeWind is intentionally INERT… The app uses zero `className=`
props and nothing imports the Tailwind scaffolding"*, and the preset/`jsxImportSource` are gone. Confirmed:
a glob-wide grep for `className=` matches only `App.tsx` (the comment at line 4) and the vendored
`components/shared/leafletAssets.ts` blob — no application JSX.

Still in `package.json`: `@rn-primitives/slot` (:19), `class-variance-authority` (:21), `clsx` (:22),
`nativewind` (:36), `tailwind-merge` (:48), and devDependency `tailwindcss`. The first four have **zero
references anywhere in the source tree**. Config still live: `metro.config.js` lines 2 and 6 wrap the
config in `withNativeWind(config, { input: './global.css' })`, plus `global.css`, `tailwind.config.js`,
`nativewind-env.d.ts`, and `components.json` — a shadcn/ui-for-web manifest whose aliases point at
`@/components/ui` and `@/lib/utils`. **`components/ui/` does not exist** (`ls components/`).

`README.md:126` compounds it: *"NativeWind (global.css, tailwind.config.js) and the `components/ui/`
primitives are available alongside token-driven styles"* — directly contradicting `babel.config.js` and
referencing a directory that is not in the repo. That line is the actual trap: a contributor writes
`className="…"`, it is silently ignored, and that is the hardest class of bug to diagnose.

**Fix.** Remove the six packages; reduce `metro.config.js` to `module.exports = getDefaultConfig(__dirname)`;
delete `global.css`, `tailwind.config.js`, `nativewind-env.d.ts`, `components.json`; fix `README.md:126`
(and `README.md:51`, which makes the same claim in the tech-stack table); **keep the `babel.config.js`
comment** as the record of the decision.

### DEL-03 — Three native modules with zero imports

`PRODUCTION_READINESS.md:552` reads **"DONE — expo-blur and orphaned components removed"**, but
`package.json:25` still declares `"expo-blur": "~15.0.8"`, `:27` `"expo-linear-gradient": "~15.0.8"` and
`:42` `"react-native-reanimated": "~4.1.1"`. The orphaned components really were deleted (git status shows
them as `D`); the dependencies were not. A glob-wide grep for
`expo-blur|expo-linear-gradient|react-native-reanimated|BlurView|LinearGradient` matches **only**
`package.json` and `package-lock.json`. All three are installed and autolinked. `DESIGN_SPEC.md`'s own
language (*"all gradients, glass blur … are deleted, both for calm and for GPU cost"*) means they can never
legitimately return.

**Impact.** Three native modules compiled into the APK and initialised at startup for a build that never
calls them. Reanimated installs a JSI/worklets runtime on every launch — real cold-start and memory cost on
the 1-2 GB Android phone this app is judged against, for zero features.

**Ordering.** Do this in the **same pass** as DEL-02: `nativewind` v4 lists `react-native-reanimated` as a
peer dependency, so removing reanimated alone emits a peer warning. Correct #19's status line, re-verify
with `npx expo-doctor`, and compare APK size on the next EAS preview build.

### DEL-04 — The second, unused offline submit path

`src/services/offlineSync/index.ts` exports `submitDiseaseReport` (:114), `submitWaterQualityReport` (:121)
and `usePendingSync` (:140); a whole-tree grep finds **zero consumers** for all three (the only other
occurrences are the file's own comments). The real submit path is `lib/services/diseaseReports.ts:7` and
`lib/services/waterQuality.ts:7`, which import `syncQueue` from `SyncQueue` directly. Everything the app
actually uses comes from the submodules, not this barrel: `App.tsx:27`, `AlertForm.tsx:30`,
`CampaignForm.tsx:23`, `SyncOutboxScreen.tsx:18-19`. Only `DashboardShared.tsx:18` (`useSyncCounts`) and
`ProfileScreen.tsx:244,313` (`clearQueueForUser`, via `require`) use the barrel itself.

Lines 1-37 and 189-231 are an **integration guide** — `npm install` instructions, a "BEFORE (online-only)"
sample, and a `Toast.show(...)` pattern for a Toast library that is not a dependency — and step 2 tells the
reader to wire `offlineSyncService.start()` into `App.tsx`, which `App.tsx:27-28` already does.

Its `isNetworkError` (lines 52-65) is the **second of three copies** of the same heuristic:
`App.tsx:105-120` (`isNetworkishError`, whose comment literally says *"Mirrors
src/services/offlineSync/index.ts"*) and `lib/services/authRecovery.ts:77` are the others.

**Impact.** Two divergent answers to "how does a report get submitted offline?", and the dead one reads
like the canonical documented API. Offline submission is the single most load-bearing behaviour for an ASHA
worker on a flaky network; a change made to the wrong copy silently does nothing.

**Fix.** Delete `submitOrQueue`, `submitDiseaseReport`, `submitWaterQualityReport`, `usePendingSync`,
`isNetworkError` and the comment blocks at 1-37 and 189-231, reducing `index.ts` to the re-exports plus
`useSyncCounts` and `clearQueueForUser`. Move the surviving network heuristic into one shared helper (e.g.
`lib/net.ts`) imported by `App.tsx` and `authRecovery.ts`. Keep the conflict-resolution notes at the end of
the file by moving them to `docs/OPERATIONS.md`.

### DEL-05 — Unused form controls, and a 163 KB blob welded to every form

`InputField`, `SelectDropdown` and `StateDropdown` (`components/shared/index.ts:8-10`; 173 + 238 + 303 =
**714 lines**) have no references anywhere outside their own files and that barrel. The same barrel
re-exports `HealthMapComponent` and `MapAndAlertsSection` (line 12), and `HealthMapComponent.tsx:32`
**statically** imports `{ LEAFLET_CSS, LEAFLET_JS } from './leafletAssets'`.
`components/shared/leafletAssets.ts` is **162,953 bytes** and materialises those as top-level template
literals, so the strings are built in the JS heap at module-eval time. Four form files pull the barrel for
a modal alone: `AlertForm.tsx:27`, `CampaignForm.tsx:21`, `DiseaseReportForm.tsx:25`,
`WaterQualityReportForm.tsx:26`. **Metro does not tree-shake by default**, so the barrel edge is a real
graph edge.

**Impact.** Opening a disease-report form drags Leaflet into the module graph, so the 163 KB payload is
evaluated on a code path with no map — and it blocks any future lazy-loading of the map without first
breaking the barrel.

**Fix.** Delete the three components and their barrel lines. Remove the `HealthMapComponent` /
`MapAndAlertsSection` re-export so map consumers import `./HealthMapComponent` explicitly, then convert
`leafletAssets` to a lazy `require()` inside `buildLeafletHtml`. Verify with an `expo export` bundle-size
diff. This overlaps constructively with open readiness #18 (map resilience / lazy-mount) — **the barrel
break is a prerequisite for that work; do them together.**

### DEL-06 — Orphaned schema

| Table | Rows | Attached objects | Code references |
| --- | --- | --- | --- |
| `campaigns` | 0 | 11 RLS policies, `trg_audit_campaigns`, `auto_approve_campaign_row` | none (`grep "from('campaigns')"` → nothing) |
| `campaign_volunteers` | 0 | 3 policies (gating on the extinct `'admin'` role), FK → `campaigns(id)` | only the dead `lib/services/campaigns.ts` + one fallback probe at `advancedAnalytics.ts:465` |
| `disease_trends` | 0 | 1 SELECT policy | none; the trend chart builds its series client-side from `disease_reports` (`AIInsightsPanel.tsx:161-223` → `TrendChart`) |
| `ai_recommendations` | 0 | `trg_ai_recommendation_action` | none |
| `ai_generated_alerts` | 0 | SELECT policy only (no INSERT policy — nothing can write to it via PostgREST) | read by `getAIAlerts` (DEL-08) |
| `notification_logs` | 0 | — | none |

All counts taken with `count(*)`, **not** `n_live_tup` — `pg_stat_user_tables` is stale on this project and
reports 0 for tables that have rows.

**A purge that is worse than useless.** `purge_push_telemetry()` runs
`DELETE FROM notification_logs WHERE created_at < now() - interval '90 days'` wrapped in
`EXCEPTION WHEN undefined_table OR undefined_column THEN NULL`. `information_schema.columns` confirms
`notification_logs` has columns `id, user_id, alert_id, sent_at, status` — **there is no `created_at`**, so
that DELETE raises `undefined_column` and is swallowed on every nightly run. It reports success nightly
while deleting nothing.

**Impact.** On a free-tier project with no PITR, schema you cannot explain is schema you cannot safely
restore or migrate. Two of these shadow the real tables (`health_campaigns`, `campaign_participants` with
10 rows) closely enough to be picked by mistake — and **the trap has already caught the roadmap**:
`ROADMAP_FEATURES.md` #11 explicitly proposes writing to `campaign_volunteers` via
`lib/services/campaigns.ts`.

**Fix.** Drop all six in one reviewed migration, together with `trg_audit_campaigns`,
`auto_approve_campaign_row`, `trg_ai_recommendation_action` and `handle_ai_recommendation`. Repoint
`vw_campaign_effectiveness` first (BRK-16) — it currently reads `FROM campaigns`. Record the drop in
`docs/OPERATIONS.md` so a restore from an older dump does not silently resurrect them. Correct
`ROADMAP_FEATURES.md` #11 to name the live tables. If any table is kept, fix the purge to use `sent_at`
and remove the exception mask so a wrong column fails loudly.

### DEL-07 — `lib/services/campaigns.ts`

`:20` selects `from('health_campaigns')` with `creator:profiles!created_by(...)` — `health_campaigns` has
`organizer_id`, **no `created_by`**. `:72-80` inserts
`{ ...campaignData, created_by, status:'planned', reached_population:0, volunteers_enrolled:0, spent:0 }`
— none of those four columns exist. `getStatistics` (:182) selects `volunteers_enrolled,
reached_population`. `enrollVolunteer` (:205-235) writes to `campaign_volunteers` (0 rows) and then calls
`supabase.rpc('increment_volunteers', ...)`; a `pg_proc` scan for `increment_volunteers` **in any schema**
returns nothing. The live UI uses `campaign_participants` (10 rows) —
`CampaignsScreen.tsx:132/337/355/494/510/534/597`. Every method is wrapped in try/catch returning
`{ data: null, error }`. `grep -rn campaignsService` returns only `lib/services/campaigns.ts:7`, `:312` and
`lib/services/index.ts:7` — **no screen imports it**.

**Impact.** Zero user impact today. The cost is a loaded gun in the barrel export: the first developer who
wires "enroll" to `campaignsService` gets a PostgREST column error on create, a write to a table nothing
reads on enrol, and a silent `null` instead of a surfaced error.

**Fix.** Delete the file and `lib/services/index.ts:7`. If a campaign service layer is wanted, rewrite it
against `health_campaigns` (`organizer_id` / `current_participants`) + `campaign_participants` and drop the
`increment_volunteers` call — `on_participant_enrolled` / `on_participant_removed` already maintain
`current_participants`.

### DEL-08 — The AI-alert stack is dead end to end

`generate_ai_alerts()` exists (it inserts into `ai_generated_alerts` from `vw_outbreak_warnings` where
`trend_status IN ('rising','anomaly')`) but is **bound to no trigger and no cron job** —
`select * from cron.job` returns exactly 4 rows (escalate, push-retry, telemetry-purge, events-purge) and
`pg_trigger` has no entry for it. `ai_generated_alerts`, `ai_recommendations` and `disease_trends` all hold
**0 rows**, and no client code inserts into any of them. `getAIAlerts`
(`advancedAnalytics.ts:715-749`) reads them and `MapTabScreen.tsx:92` + `245-300` renders the result,
labelling rows *"AI Signal: &lt;disease&gt;"* via `mapAIAlertRow` (`:686`). `types/index.ts` carries
`AIRecommendation`, `AIRecommendationInput`, `AIRecommendationType/Status/Severity` — all with zero
references outside that file. The fallback chain also probes `ai_alerts`, which does not exist.

**Impact.** A user-visible **"AI SIGNAL FEED"** card sits permanently on the Map tab for every role and is
structurally incapable of showing a row — a feature that was never switched on, presented as a quiet zero.
Worse: if `generate_ai_alerts()` were ever scheduled it would begin **authoring alert text straight into a
surface field staff read, with no human approval step** — the exact inversion of the rule that automation
never speaks for a human. Keeping the wiring warm makes that a one-cron-job mistake.

**Fix — decide explicitly.** If AI-generated signals are wanted, they must land in a human-approval queue
before any screen shows them (`ApprovalQueueScreen` already exists) — build that first. If not: drop
`generate_ai_alerts()`, drop the three tables (DEL-06), delete `getAIAlerts` and `mapAIAlertRow`, delete
the `aiAlerts` section from `MapTabScreen.tsx`, and delete the five `AIRecommendation*` types.

### DEL-09 — Dead probes in `advancedAnalytics.ts`

`getDistrictHealthRanking` (`:236-241`) calls
`selectFromFirstAvailableView(['vw_district_health_ranking','district_health_scores','vw_health_scores'], …)`.
Queried against the live project, **none of the three exist**. `getAIAlerts` (`:725`) probes `ai_alerts` —
also absent. `getEscalationMonitoring` (`:602`) probes three escalation views, none of which exist
(BRK-19). `selectFirstSuccessful` appears **12 times**, each with 2-3 candidate select clauses.

**Impact — bounded, and smaller than it first appears.** `deadProbeCache` (`:147`) is **module-level**, so
the misses cost three doomed HTTP requests **per app process**, not per screen open. On a rural 2G
connection that is still seconds of latency for a guaranteed miss on the first HealthScoreScreen open, plus
one more on the Map tab. The probe machinery exists to tolerate schema drift across deployments; there is
exactly **one** deployment.

**Fix.** Pin each query to the relation that exists. In `getDistrictHealthRanking`, **delete the view-probe
branch at `:236-249`** — the base-table computation at `:250-290` already does exactly what a "fallback"
would do and is the only path that ever runs. Drop the `ai_alerts` branch. Collapse the paired select-clause
variants to the live column set. Removing `selectFirstSuccessful` / `selectFromFirstAvailableView`
afterwards deletes ~60 lines. Pair with BRK-13 so error handling is fixed in the same edit.

### DEL-10 — Orphan shim and a long tail of dead declarations

`utils/supabase.ts` is a four-line file whose entire body is `export { supabase } from '../lib/supabase';`;
a scan for importers of `utils/supabase` across `App.tsx components lib src types scripts supabase index.ts`
returns **nothing**, so the whole `utils/` directory is dead. (Its own comment explains it exists to prevent
a duplicate `GoTrueClient` — moot once the file is gone.)

In `types/index.ts`, **20** exported types have zero references outside that file, each verified
individually: `WaterSource`, `CampaignType`, `VolunteerStatus`, `ActivityLog`, `DiseaseStatistics`,
`WaterQualityStatistics`, `DashboardStats`, `WaterQualityInput`, `PaginatedResponse`, `OutbreakWarning`,
`MapPointType`, `MapPoint`, `DistrictHealthScore`, `TraceabilityRecord`, `ValidationResponse`,
`AIRecommendation`, `AIRecommendationInput`, `AIRecommendationType`, `AIRecommendationStatus`,
`AIRecommendationSeverity`.

Also unused: `feedsSignal` (`lib/services/approvalMeta.ts:167` — only the `Batch` variant at `:118` is
imported, by `ApprovalQueueScreen.tsx:24`), the `approvalMetaService` aggregate (`:175`),
`provisioningService` (`lib/services/provisioning.ts:200`) and `INVITABLE_ROLES` (`:20`),
`analyticsService` (`lib/services/analytics.ts:53`), and the `notificationsService` barrel line at
`lib/services/index.ts:9` (the module is consumed directly by `advisories.ts:27`, never through the barrel).

**Do NOT delete `getDefaultWidgetPreferences`** — `lib/services/widgetPreferences.ts` calls it at `:125`,
`:152` and `:166`.

**Impact.** Individually small; together they make `types/index.ts` and the service barrels unreliable as a
map of the system. `DashboardStats` and `MapPoint` read like the app's core shapes and are not, and every
service exposes both named functions and an unused aggregate object, so it is never obvious which import
style is current.

**Fix.** Delete as listed; `npm run verify` confirms nothing breaks. Do the `AIRecommendation*` group
together with DEL-08.

### DEL-11 — Adopt `AILabel`, then delete what is still unused

`components/dashboards/DashboardShared.tsx:935` exports `AILabel` — the reserved violet chip with a
sparkles glyph and `accessibilityLabel="AI inferred — not a verified fact"`, defaulting its text to
"AI — INFERRED" — and `:964` exports `AICard` (which wraps `AILabel`). Grepping `AILabel`/`AICard` across
`App.tsx components lib src` returns **only `DashboardShared.tsx` itself**. The two places that actually
display AI output build their own inline badge with **no disclaimer**: `AIInsightsPanel.tsx:312-313` and
`MapTabScreen.tsx:260-261`, each `<View style={[styles.aiBadge, { backgroundColor: colors.aiBg }]}>` with
the bare text "AI". `DashboardShared.tsx:110` also exports `urgencyColor`, a one-line alias for
`getSeverityColor` with zero references (`AlertForm.tsx:381` defines its own local `urgencyColorFor`, a
different symbol).

**Impact.** The design law reserves AI violet to mean "the system inferred this, a human did not verify
it". The one component that encodes that promise — including the screen-reader wording — is dead, while the
two surfaces that display AI output re-implement a weaker badge. TalkBack users get "AI" instead of "AI
inferred — not a verified fact".

**Fix — FINISH by adoption, not deletion.** Replace the inline badges at `AIInsightsPanel.tsx:312` and
`MapTabScreen.tsx:260` with `<AILabel/>`. Delete `AICard` if it remains unused, and delete the
`urgencyColor` alias. **Note:** the MapTabScreen half becomes moot if the AI Signal Feed is deleted per
DEL-08 — do those two together.

---

## 6. Rebuild & refine

Features that exist and work, or half-work, whose **current shape** is the problem. These are not bug
fixes; they are re-designs.

| ID | Item | Why the current shape fails | Effort |
| --- | --- | --- | --- |
| REF-01 | RLS policy sprawl — 99 policies, 208 advisor lints | Security is decided by the loosest of up to 14 overlapping rules | L |
| REF-02 | Push targeting — every district push also hits every national admin | Admin phones become a firehose; the one push that mattered gets muted | M |
| REF-03 | Alert scoping — client gazetteer instead of server geography | Root cause of BRK-05; unfixable in its current shape | L |
| REF-04 | Timestamp types and vestigial sync columns | Mixed `timestamp`/`timestamptz`; the unwritten column that breaks BRK-01 | M |
| REF-05 | Immersive mode hides the clock, battery and signal bar | The worker cannot judge when she has signal — which the whole offline UX assumes | S |
| REF-06 | Index hygiene — 19 unindexed FKs, 1 literally duplicated index | Write cost and join cost, both paid by the field phone | S |

### REF-01 — Policy sprawl makes the security model unreviewable

**Evidence.** `get_advisors(performance)` returns **208 lints**: 75 `auth_rls_initplan`
(`auth.uid()`/`current_setting` re-evaluated per row instead of wrapped in a scalar subquery), 61
`unused_index`, 52 `multiple_permissive_policies`, 19 `unindexed_foreign_keys`, 1 `duplicate_index`
(*"public.health_alerts has identical indexes {idx_alert_district, idx_alerts_district}"*). Policy counts
from `pg_policies`: `health_campaigns` 14, `campaigns` 11, `disease_reports` 9, `water_quality_reports` 9,
`outbreaks` 7, `user_feedback` 7 — 99 total.

Exact duplicates verified: *"Everyone can view campaigns"* and `campaigns_select` are both `USING (true)`;
*"ASHA own health_campaign update"* and `health_campaigns_asha_update` have identical quals; *"Clinic own
health_campaign update"* and `health_campaigns_clinic_own_update` likewise.

**Why the shape fails — correctness first.** A permissive policy set is an **OR**, so security is decided
by the single loosest of up to fourteen overlapping rules. That is exactly how the cross-district reads in
SEC-08 survived, and how `outbreaks` ended up readable by a village clinic and invisible to super_admin
(BRK-06). No reviewer can hold fourteen overlapping predicates in their head.

**Performance second.** Every SELECT on `disease_reports` evaluates up to nine policies per row, most
containing a correlated `EXISTS (SELECT 1 FROM profiles ...)`, with `auth.uid()` re-planned per row in 75
places — paid for on a free-tier instance by an ASHA worker on a flaky rural link, on every dashboard load.

**Fix.** Collapse each table to **one policy per command**, expressed through `get_my_role()` /
`get_my_district()` (already `SECURITY DEFINER` with `search_path` pinned, so no recursion), and wrap
`auth.uid()` as `(select auth.uid())` to make it an InitPlan. Fold the migrations half into the open
readiness #41 ("Schema-as-code baseline") rather than filing it separately — that item already owns
`supabase/migrations`.

**Severity judgement, stated openly.** This is filed as a **maintainability and latency** item, not a
security item, because every concrete security consequence it gestures at is filed separately in §3. The
counter-argument — that unreviewable policies *are* a security defect — is reasonable; the reason it is not
ranked higher is that collapsing 99 policies is an L-effort change with real regression risk, and doing it
**before** the individual holes are closed would mean rewriting the same policies twice.

### REF-02 — Every district-scoped push also fires at every national admin

**Evidence.** `notify_users_push()` selects recipients with:

```sql
AND (p_target_district IS NULL
     OR p.district = p_target_district
     OR p.role IN ('admin','super_admin','health_admin'))
```

Callers that pass a district still reach every admin: `push_on_alert_created()` (every `health_alerts`
INSERT) and `notify_on_unsafe_water()` (every unsafe/critical water report INSERT, **before approval**).
`detect_outbreak_after_report()` likewise inserts unscoped notification rows with `target_district NULL`
for super_admin and health_admin. `health_alerts.min_severity` exists as a column and a repo-wide grep for
`min_severity` returns **zero hits** in application code. The bypass also lists the extinct `'admin'` role
(BRK-06).

**Why the shape fails.** A health admin covering thirty districts receives a push for every alert filed
anywhere and every unsafe water reading anywhere — including unapproved ones, per the trigger timing
(BRK-11). The predictable outcome is that notifications get muted, and the one push that genuinely needed
their attention is the one they miss. There is no severity floor and no digest option.

**Fix.** Drop the blanket admin bypass and make national reach an **explicit argument**. Push admins only
on events that require them — an outbreak crossing threshold, an alert awaiting their approval, an SLA
breach at L3 — and roll the rest into a once-daily digest. Honour `min_severity` when selecting recipients,
and add a per-user notification preference (`widgetPreferences` is the existing pattern for storing this);
this is the same work as BRK-18's server half.

### REF-03 — Alert scoping belongs on the server

The full evidence is in BRK-05. The **shape** problem, separate from the bug: a 105-entry hardcoded
gazetteer in `lib/services/alertRadius.ts` is a client-side approximation of a question the database can
answer exactly. `health_alerts` already has `location_geo` populated by `trg_sync_*_geo` on insert, and
PostGIS is installed. Ten call sites consume the client filter, so every one of them can silently disagree
with the server's own push targeting (`notify_users_push` filters on `p.district = p_target_district`,
exact string) — two different definitions of "who is affected", neither of which is geography.

**Fix.** One server-side definition of reach, used by both the push fan-out and the client list. Fold into
readiness #56 and add `alertRadius.ts` to its Files list. Until then, ship the honesty fix from BRK-05
limb 1 — that is S-effort and stops the app lying today.

### REF-04 — Timestamp types and vestigial offline-sync columns

**Evidence.** `information_schema.columns` confirms seven naive columns in an otherwise `timestamptz`
schema: `disease_reports.last_updated_at`, `water_quality_reports.last_updated_at`,
`ai_generated_alerts.created_at`, `ai_recommendations.created_at`, `ai_recommendations.acted_at`,
`disease_trends.created_at`, `notification_logs.sent_at` — all `timestamp without time zone`.
`last_updated_at` is nullable with no default and no trigger; a repo-wide grep finds it only at
`lib/services/advancedAnalytics.ts:578/595` and `types/index.ts:449` — **read-only, never written**.
`client_generated_id` is `uuid NOT NULL DEFAULT gen_random_uuid()` with UNIQUE index `idx_disease_client_id`
and appears **nowhere** in the repo.

**Why it matters more than it looks.** `last_updated_at` being unwritten is not latent — it is the direct
cause of BRK-01, the worst defect in the system. Beyond that, any future comparison between a naive and a
tz-aware column is off by the 5 h 30 m IST offset **with no error**.

**Fix.** Convert the naive columns with
`ALTER … TYPE timestamptz USING col AT TIME ZONE 'UTC'` and add a CI assertion that no new `timestamp`
column is created. Then either wire `last_updated_at` and `client_generated_id` into the sync-queue payload
so they mean something, or drop them along with `idx_disease_client_id` once `resolve_conflict` is removed
(BRK-01). Four of the seven columns disappear anyway with DEL-06.

### REF-05 — Immersive mode hides the clock, battery and signal bar

**Evidence.** `MainApp.tsx:188-200` unconditionally calls `StatusBar.setHidden(true,'fade')`,
`StatusBar.setTranslucent(true)` and, on Android, `NavBar.setVisibilityAsync('hidden')` in a mount effect
with **no user setting** (restored only on unmount). This contradicts `App.tsx:447`, which renders
expo-status-bar's `<StatusBar style={statusBarStyle} hidden={false} translucent />` — **two components
driving the same global**. The app's own offline UX assumes she can tell when signal returns: the Sync
Pebble states (`DashboardShared.tsx:822-835`) and the Outbox's "Sync now" button
(`SyncOutboxScreen.tsx:433-449`, disabled while offline).

**Why the shape fails.** A field worker on a long round loses the three pieces of system information she
most needs: **battery, signal and time**. She cannot glance at the signal bars to decide whether it is
worth walking to the ridge to sync, and she loses the notification shade's indicators for the very pushes
this app sends. It also removes the Back affordance on 3-button devices, compounding BRK-14.

**Caveat.** Which of the two components wins at runtime is **asserted, not measured** — MainApp's mount
effect runs after App's render, so `setHidden(true)` very likely wins, but there is no harness that can
check this (§2.6). Treat "verify on a real Android build" as part of the fix.

**Fix.** Drop the immersive calls, or gate them behind an explicit setting defaulting to **off**. If a
full-bleed look is wanted, keep the status bar visible and translucent (which `App.tsx` already asks for)
and remove the conflicting `setHidden` call so the two components stop disagreeing.

### REF-06 — Index hygiene

**Evidence.** The performance advisor reports exactly **19** `unindexed_foreign_keys` and **1**
`duplicate_index`. The 19 include `disease_reports_verified_by_fkey`, `disease_reports_approved_by_fkey`,
`water_quality_reports_verified_by_fkey`, `water_quality_reports_approved_by_fkey`,
`outbreaks_triggered_by_report_id_fkey`, `water_sources_last_report_id_fkey`,
`water_sources_retest_assigned_to_fkey`, `water_sources_reopened_by_fkey`,
`alert_acknowledgements_user_id_fkey` and `profiles_supervisor_id_fkey`. `pg_indexes` confirms
`idx_alert_district` and `idx_alerts_district` are **both** `btree (district)` on `health_alerts`.

**Fix.** Add covering indexes only for the FKs the app actually queries — `verified_by`, `approved_by`,
`retest_assigned_to`, `alert_acknowledgements.user_id`, `water_sources.last_report_id` — not all 19. Drop
`idx_alert_district`; keep the composite `idx_health_alerts_district (district, created_at DESC)`, which
also subsumes `idx_alerts_district`. Review the redundant prefixes on the reports tables:
`idx_disease_reports_district` is covered by `idx_disease_reports_district_approval`,
`idx_notifications_user` by `idx_notifications_user_timeline`. The reports tables carry 14 and 12 indexes
respectively — every one of those is write cost paid on the field phone's sync.

**Severity note.** Low, because every affected table is near-empty today (4 / 1 / 4 / 5 rows). This is
cheap insurance to take **before** the pilot loads data, not an emergency.

---

## 7. New features

Ranked by **impact ÷ effort**. Every one is grounded in something that already exists in the schema or the
code — none of them require paid infrastructure, a Play Store listing, or a new third-party SDK. The bias
throughout is toward the ASHA worker: she is the person whose time this app spends, and today it spends a
lot of it.

Effort scale: **S** ≈ under a day · **M** ≈ 2-4 days · **L** ≈ a week or more.

| Rank | ID | Feature | Solves | Effort | Impact |
| --- | --- | --- | --- | --- | --- |
| 1 | NEW-01 | Draft autosave + "Keep this report?" | Two minutes of work destroyed by one Back press | S | High |
| 2 | NEW-02 | "Your work mattered" payback card | She never learns her report did anything | S | High |
| 3 | NEW-03 | "Assigned to me" home region | A retest task nobody is told about | S | High |
| 4 | NEW-04 | Near-duplicate guard at report time | Two workers file the same cluster; the officer triages twice | M | High |
| 5 | NEW-05 | "Report again here" — one-tap repeat filing | Re-typing the same village, source and location every visit | M | High |
| 6 | NEW-06 | Case follow-up (finish the greyed-out tile honestly) | Half the mission loop — treatment follow-up — does not exist | L | High |
| 7 | NEW-07 | Offline alert poster + WhatsApp share | She must relay the alert to people with no smartphone | M | Medium |
| 8 | NEW-08 | Supervisor line: "ask my supervisor" / escalate a doubt | `supervisor_id` exists and does nothing | M | Medium |
| 9 | NEW-09 | Pictogram symptom & water chips | Low-literacy and low-vision use in sunlight | M | Medium |
| 10 | NEW-10 | Weekly "my village" digest for the ASHA herself | Digests flow upward only | M | Medium |
| 11 | NEW-11 | Alert reach dashboard for officers | "Sent" is not "received" (BRK-12, BRK-10) | M | Medium |
| 12 | NEW-12 | Volunteer intake path ("Raise a concern") | Volunteers can see everything and report nothing | M | **Owner decision** |

---

### NEW-01 — Draft autosave and a "Keep this report?" exit · S · High impact

**Problem.** She has been filling a report for two minutes on a bus with one hand. She presses Back — the
gesture every Android user knows — and the app closes and the work is gone (BRK-14). Nothing in
`components/forms/` persists anything: grep for `AsyncStorage` or `draft` across that directory returns
nothing.

**Sketch.** One `useFormDraft(userId, formKey)` hook: debounced `AsyncStorage.setItem` of the form state
every ~2 s under `healthdrop:draft:<userId>:<formKey>`; on mount, if a draft exists, show a quiet band —
*"You have an unfinished water report from 14:20. Continue / Start fresh"*. Combined with the `BackHandler`
fix from BRK-14, back shows a three-option sheet: **Keep draft** / **Discard** / **Cancel**. Clear the
draft on successful submit or enqueue. `SyncQueue` already proves the storage pattern and the amber "saved
on phone" visual language already exists (`SyncPebble`).

**Why it ranks first.** It is the cheapest thing in this document that directly protects her labour, and it
converts the app's most alarming failure mode into a non-event. It also makes the two long forms
(`WaterQualityReportForm` is 1,060 lines) survivable on a phone that backgrounds aggressively under memory
pressure.

### NEW-02 — "Your work mattered" payback card · S · High impact

**Problem.** Surveillance systems die when field workers stop believing their reports matter. Today she
gets **nothing** back: no approval notification (BRK-09), no outbreak linkage (BRK-04), no visible
consequence. `MySubmissionsScreen` has a payback concept in its header comment (*"Approval pays her back:
the stamp, and — when the report fell inside an outbreak window — proof it became protection"*) and the
data to fill it does not currently exist because approval cannot persist.

**Sketch.** Once BRK-01 and BRK-04 land, add a small home region for `asha_worker`/`volunteer`:

- *"This month: 12 reports filed · 11 verified by Dr. Meena · 1 needs a fix"* (from `disease_reports` /
  `water_quality_reports` where `reporter_id = me`)
- *"Your 3 diarrhoea reports from Melur helped confirm an outbreak on 14 Aug"* — join
  `outbreaks.triggered_by_report_id` (the FK exists) and the disease+district+window match
- *"Handpump #3 was retested safe after you flagged it"* — from `water_sources` where she filed the
  flagging report and `current_status` has since improved

Four states, like everything else. When there is nothing yet, the quiet-zero says *"Your first report will
show its journey here"* — never a fake number.

**Why.** It is the only feature in this list whose purpose is retention of the human, and it is nearly free
once the loop actually works. **Prerequisite: BRK-01, BRK-04, BRK-09.**

### NEW-03 — "Assigned to me" home region · S · High impact

**Problem.** An officer assigns her a retest with a due date; she is never told (INC-04) and there is no
screen that lists it (`retest_assigned_to` is queried nowhere for the current user).

**Sketch.** A home region on the ASHA and volunteer dashboards: `water_sources` where
`retest_assigned_to = auth.uid()`, ordered by `retest_due_date`, **overdue first and coloured by the water
ladder**, each row tapping straight into the prefilled form
(`new-water-report:prefill:<id>` — the route already exists at `WaterSourcesScreen.tsx:891` and
`MainApp.tsx:244`). Add the same as a filter chip on `WaterSourcesScreen`. Cache it offline per INC-05 so
she can see today's task list in the field.

**Why.** It turns an invisible obligation into a visible one, and it is the smallest possible fix for the
broken half of the mission loop. Pairs with INC-01 (making the screen reachable at all) and INC-04 (the
notification). **Prerequisite: INC-01.**

### NEW-04 — Near-duplicate guard at report time · M · High impact

**Problem.** Two workers in adjacent hamlets file the same cluster; the officer triages the same event
twice and the case count double-counts. Water sources fragment on spelling (BRK-20). There is no
duplicate-awareness anywhere in the submit path.

**Sketch.** Reuse the primitive that already exists: the deployed `bright-action` edge function queries
`disease_reports` for a matching `disease_name + district` in the last 10 minutes (SEC-16). Rewrite it as a
proper `SECURITY DEFINER` RPC — authenticated, district-scoped, widened to a configurable window (24 h is
right for disease, longer for water) — and call it on the review step of the form, **not** as a blocker:

> *"Sunita reported 8 diarrhoea cases in Melur 3 hours ago. Is this the same outbreak?"*
> **[Add to that report] [No, this is separate]**

For water, run the same check on `source_name` fuzzy match within the district (BRK-20's picker gives this
for free).

**Why.** It improves data quality at the only moment it can be improved cheaply — before the row exists —
and it respects her judgement rather than refusing her submission the way `idx_alert_dedup` does (BRK-07).
**Delete the current `bright-action` deployment either way (DEL-14); this is a rewrite, not a keep.**

### NEW-05 — "Report again here" — one-tap repeat filing · M · High impact

**Problem.** She visits the same twelve hamlets and the same handful of wells every month, and every single
report makes her re-type `location_name`, `district`, `state` and `source_name` on an English keyboard,
with a help string that falsely promises GPS will handle it offline (INC-08).

**Sketch.** Three layers, cheapest first:

1. **Prefill from profile** (INC-08 limb 1) — district and state seeded, one tap to confirm.
2. **Recent places** — a horizontal chip row above the location field showing her last 5 distinct
   `location_name` values (derived from her own submissions, cached in AsyncStorage so it works offline).
   Tap → fills location + district + state.
3. **"Report again here"** on any row in My Submissions and on any `water_sources` row: opens the correct
   form with location, source and (for water) source identity prefilled, disease and counts blank.

**Why.** This is the single biggest reduction in her per-report typing, it works entirely offline, and
layer 1 alone is a few lines. It also feeds NEW-04 and BRK-20 by making canonical values sticky instead of
retyped.

### NEW-06 — Case follow-up, built honestly · L · High impact

**Problem.** "Treatment follow-up" is one of the two ways the mission loop closes. The app advertises it in
Hindi in the report sheet and greys it out permanently (INC-13). There is no follow-up model, service,
table or screen anywhere.

**Sketch.**

- Table `case_followups`: `id`, `disease_report_id` FK, `reporter_id`, `status`
  (`recovered | ongoing | referred | hospitalised | deceased`), `note`, `followed_up_at`, `latitude`,
  `longitude`, `client_idempotency_key`, plus RLS mirroring `disease_reports` and an audit trigger.
- Form: three taps — which report, what happened, optional note. Reuse the disease wizard's step chrome.
- Surfacing: a "Needs follow-up" region on her home (approved reports of hers older than N days with no
  follow-up), and a follow-up strip on the report detail in My Submissions and the Approval Queue.
- Offline: goes through `SyncQueue` like everything else (add the queue type properly — unlike the dead
  `'feedback'` type in BRK-22).
- Outbreak value: `deceased`/`hospitalised` counts are the severity signal that case counts alone miss, and
  they can feed `detect_outbreak_after_report`'s threshold logic later.

**Why L, and why still worth it.** It is a genuine feature — model, RLS, form, queue type, two surfacing
points, i18n in both locales. But it is the missing half of the product's stated loop, and until it exists
the report sheet should show the row deleted (INC-13), not greyed out. **Do not start it until Phase 1 and
2 of §8 are done** — a follow-up on a report that cannot be approved is meaningless.

### NEW-07 — Offline alert poster + WhatsApp share · M · Medium impact

**Problem.** Her job when an alert lands is to tell people who mostly do not have the app. The alert
already renders as a "poster" in-app, but she cannot read it without a network (INC-05) and cannot hand it
to anyone.

**Sketch.** Cache approved active alerts per INC-05; add a **Share** action on the poster that renders it
via `expo-print` to a PDF/PNG and hands it to `expo-sharing` — both are already dependencies
(`expo-print`, `expo-sharing` in `package.json`) and `weeklySummary.ts` already proves the pattern
(`:403` builds a WhatsApp caption). Poster copy must be bilingual and pictogram-led (pairs with NEW-09).
Log the share as an acknowledgement so officers see reach (`alert_acknowledgements` exists with
`alert_id, user_id, acked_at`).

**Why.** It converts a notification into an actual community action, and it is the only feature here that
helps people who will never install the app. **Prerequisite: INC-05, BRK-05.**

### NEW-08 — The supervisor line · M · Medium impact

**Problem.** `profiles.supervisor_id` exists in the live schema and is referenced in exactly one place in
the entire codebase — `types/index.ts:21` — verified by grep. There is no way for a worker to ask a
question, flag a doubt, or escalate something she is unsure about, so uncertain observations either become
over-confident reports or nothing at all.

**Sketch.** Populate `supervisor_id` from the provisioning/invite flow (`role_invitations` already exists).
Then: (a) a "Ask my supervisor" action on any draft or submitted report that creates a targeted
`notifications` row for the supervisor with a short note and a deep link; (b) a supervisor-side "My team"
region listing their workers' pending and rejected items; (c) `escalate_pending_reports()` — the function
BRK-08's cron has been calling into the void 960 times — routes L1 escalations to the supervisor rather
than the whole district.

**Why.** It gives the escalation cron something real to do, gives `supervisor_id` a purpose, and gives an
uncertain worker a path that is not "file it anyway or drop it". **Prerequisite: BRK-08 decision, INC-04's
notification-policy fix.**

### NEW-09 — Pictogram symptom and water chips · M · Medium impact

**Problem.** The persona may read Hindi slowly and is standing in sunlight. Symptom and water-quality
selection today are text chips. `PRODUCTION_READINESS.md` #34 (PLANNED) already scopes "pictogram-paired
selection chips, severity glyph ladder, directive icons on alerts".

**Sketch.** Pair every symptom and water-quality chip with a glyph from `@expo/vector-icons` (already a
dependency) at ≥ 32 dp, keep the text label, and give the severity ladder a **shape** difference as well as
a colour difference so it survives sunlight and colour-vision differences. Do it inside
`DashboardShared`'s existing chip component so it lands everywhere at once. Must not introduce a hex
literal — glyph colours come from the ladder helpers.

**Why.** Directly serves the primary persona and is already an accepted (if unstarted) readiness item.
Fold this work into INC-03's water-form rewrite so the form is touched once.

### NEW-10 — A weekly "my village" digest for the ASHA herself · M · Medium impact

**Problem.** `WeeklySummaryScreen` (796 lines) produces an IDSP-style digest that flows **upward** —
officer → WhatsApp → district. Nothing flows back down. She is the source of every number in it and never
sees one.

**Sketch.** A cut-down weekly card on her home (and shareable via the same `expo-print` path): reports she
filed, how many were verified, which wells in her area are flagged or due for retest, any active alert in
her area, and one plain-language line about what changed. All from data she is already permitted to read.
No AI-generated prose — this is a factual summary, and per §2.3 it carries no AI badge because it is not
inferred.

**Why.** Same retention logic as NEW-02, at a weekly cadence, and it doubles as the thing she shows her
supervisor. **Prerequisite: NEW-02's data plumbing.**

### NEW-11 — Alert reach dashboard for officers · M · Medium impact

**Problem.** Officers cannot tell whether an alert reached anyone. BRK-12 shows a green receipt with no
recipient count; BRK-10 shows "field staff were notified" when nobody was; BRK-05 means an alert can
legitimately reach **zero** field devices while looking healthy.

**Sketch.** One panel per alert: *targeted* (profiles matching the alert's scope, computed server-side per
REF-03), *pushed* (`push_notification_outbox` rows with status), *delivered* (Expo ticket status),
*acknowledged* (`alert_acknowledgements`). Colour only on the failure states. Add the same numbers to the
advisory composer's receipt (BRK-12) and refuse to send at zero.

**Why.** It makes "sent" auditable, and it is the monitoring surface that would have caught BRK-05 on day
one. **Prerequisite: REF-03 or at least BRK-05 limb 1.**

### NEW-12 — Volunteer intake: "Raise a concern" · M · **Owner decision, not a defect**

**Evidence that today's state is deliberate.** `MainApp.tsx:89-90` — `'volunteer'` is absent from
`CREATE_PERMISSIONS` for `new-disease-report` and `new-water-report`, so `availableCreateActions` is empty
and `showUniversalAddFab` (`MainApp.tsx:586-589`) never renders a Create button.
`ReportsScreen.tsx:104-106` excludes volunteer from `canAccessDiseaseReports` / `canAccessWaterReports` /
`canCreateReports`. `VolunteerDashboard.tsx:293` states it plainly: *"As a volunteer you can view alerts,
campaigns & AI health insights. Contact your clinic for reporting access."* Encoded consistently in three
places — this is a product decision, not a bug.

**The case for.** Volunteers are the widest net for spotting symptoms, and two volunteer accounts already
exist in production reading a nationwide feed (SEC-08) while being able to contribute nothing.

**The case against, stated honestly.** More unverified rows enter an officers' queue that today cannot even
persist a decision (BRK-01), plus more district-scoped notification traffic on a channel that is already a
firehose for admins (REF-02).

**If pursued.** A single-screen "Raise a concern" — what you saw, roughly how many people, where (chips and
steppers, **no free text required**) — writing a `disease_report` with a `community` source flag and
`approval_status='pending_approval'`. Human verification is unchanged and is what makes it safe: it enters
the same officer queue, is excluded from outbreak counts until approved (`detect_outbreak_after_report`
already gates on approved), and can never trigger a public alert on its own.

**Do not build it until §8 Phase 1 and Phase 3 are done**, or the extra volume lands on a queue that cannot
page (BRK-21) and cannot decide (BRK-01).

---

## 8. Sequenced roadmap

Six phases. **Each is independently shippable and each leaves the app working** — no phase depends on a
later phase to be coherent. Within a phase, items are ordered where ordering matters.

The ordering principle: **close the front door, then make the loop work, then stop the app lying, then make
it usable in the field, then clean up, then build.** Deletions are deliberately *not* first — they are
satisfying and low-risk, and doing them first would mean the app still has an unauthenticated
privilege-escalation RPC while looking tidier.

---

### Phase 0 — Verification you can trust · ~2-3 days

Nothing else in this document can be verified without this, and every claim of "fixed" made before it lands
is an assertion.

| Item | Why first |
| --- | --- |
| Build the **role-tour harness** that §2.6 says does not exist: log in as all six roles, walk every tab and every screen the role can reach, at 360 px and 412 px, light and dark, EN and HI; fail on horizontal overflow of the page body and on any unhandled console error | Six findings in this document (INC-01, INC-02, BRK-22, DEL-01 and the near-black header incident itself) are "nobody logged in as that role". A machine that logs in as every role would have caught all of them |
| Add a **DB assertion suite** runnable against a branch: for each of the six roles, impersonate and assert what they can read and write; assert `has_function_privilege('anon', …) = false` for every SECURITY DEFINER routine; assert no policy or routine references a role outside `Profile['role']`; assert no column carries more than one CHECK | SEC-01, SEC-02, SEC-03, SEC-12, BRK-02, BRK-06 are all mechanically detectable |
| Add a **cron health check**: fail if any `cron.job_run_details` row has `status='failed'` in the last 24 h | BRK-08 ran red **960 times** and nobody saw it |
| Wire all three into `build-on-push.yml` alongside the existing contrast gate | The contrast gate is currently the only automated quality signal in the project |

**Ship criterion:** the harness runs green on `main` today, with the *current* bugs recorded as known
failures rather than hidden.

**Trade-off, stated:** three days before a single user-visible fix. Justified because the alternative is
another six months of items marked DONE that are not.

---

### Phase 1 — Close the front door · ~2-3 days

Pure security. No UI changes. Every item is S-effort and independently revertible.

| Order | Item | Note |
| --- | --- | --- |
| 1 | **DEL-13**: delete `mesc/`, then rotate the `hzicxykqtlxhaalgqkey` service_role key | Must precede BRK-24's un-ignore, or live credentials enter git history |
| 2 | **SEC-01**: `DROP FUNCTION create_admin_user(text)` | The single worst hole |
| 3 | **SEC-02**: revoke `notify_users_push` from `anon`/`authenticated`, add an internal caller assertion | Verify pushes still fire from triggers afterwards — this is the one revoke that can break delivery |
| 4 | **SEC-12**: revoke `update_push_outbox_status`; **SEC-13**: revoke `mv_campaign_effectiveness` | Then the blanket `REVOKE EXECUTE … FROM anon, authenticated` + `ALTER DEFAULT PRIVILEGES` sweep from SEC-01, re-granting only what the client calls |
| 5 | **SEC-03**: authenticate the four geo RPCs and tighten `alerts_select` | Owner should confirm no public dashboard is planned |
| 6 | **SEC-04**: fix the map XSS (JSON out of script context, drop `allow-same-origin`) | S, and it protects the highest-value sessions |
| 7 | **SEC-10**: authenticate `openrouter-proxy`, allowlist the model, cap tokens, fix CORS | Protects the owner's wallet |
| 8 | **SEC-14**: rotate the remaining keys, clean `.env` and `.env.example` | Closes readiness #5 properly |
| 9 | **SEC-11**: move the hardcoded JWT to a GUC and make the failure loud | **Must land before the anon key is rotated**, or push silently dies |

**Ship criterion:** the Phase-0 DB assertion suite passes; a real push still reaches a real device.

**Leaves the app working:** yes — none of these touch a code path the app uses, except SEC-04 (map) and
SEC-10 (AI), both of which are exercised by the harness.

---

### Phase 2 — Make the mission loop actually work · ~4-6 days

This is the phase that turns a demo into a system. **Order matters more here than anywhere else.**

| Order | Item | Why this order |
| --- | --- | --- |
| 1 | **BRK-01** — drop `trg_conflict_disease` **and** fix/drop `calculate_response_time` in one migration | Everything downstream is blocked on this. Doing half of it turns a silent failure into a hard 42703 on every approval |
| 2 | **BRK-02** — collapse the three `overall_quality` CHECKs to one, normalise legacy rows | Unblocks the most common field submission there is |
| 3 | **BRK-03** — one-word `related_type` fix, plus remove the `EXCEPTION WHEN OTHERS` mask | Unsafe water starts notifying officials. Reopen readiness #58 |
| 4 | **BRK-04** — add the approval-time outbreak-detection trigger | Only works after (1). Reopen readiness #57 |
| 5 | **SEC-07** — gate the alert push on the approval transition | Reopen readiness #39 |
| 6 | **BRK-11** — gate the water-source registry on approved reports, add the update-side trigger | Stops the "✓ Verified" digest carrying unverified flags |
| 7 | **BRK-09** — rejection + water approval/rejection triggers, notification rows, bell badge, push-tap routing | Only meaningful after (1) |
| 8 | **BRK-07** — `DROP INDEX idx_alert_dedup` | One line; unblocks back-to-back alerts |
| 9 | **BRK-06** — sweep the extinct `'admin'` role out of policies and functions | Gives super_admin/health_admin sight of `outbreaks`, scopes clinic to its district. Correct readiness #53 |
| 10 | **INC-09** limbs 1-2 — seed thresholds for Diarrhea/Jaundice/all `DISEASE_OPTIONS`; make both outbreak functions use `lower()` | Detection that cannot fire for diarrhoea is detection that does not matter |
| 11 | **BRK-08** — implement or unschedule `escalate_pending_reports()` | Either is acceptable; a permanently red cron is not |

**Verify end to end, as the roadmap's acceptance test:** file a disease report as the ASHA account →
approve it as the district officer → assert the stored row changed, an `outbreaks` row appeared, four
`notifications` rows appeared, and a `push_notification_outbox` row exists. Then file an unsafe water
report → assert officials were notified. **Do not mark this phase done on inspection.**

**Ship criterion:** the acceptance test above passes on the live project.

---

### Phase 3 — Stop the app lying · ~3-5 days

Honesty fixes. The app currently tells field workers their district is clear when it is not, tells officers
alerts were sent when they were not, and shows quiet zeros where errors occurred.

| Order | Item |
| --- | --- |
| 1 | **BRK-05 limb 1** — never render green "All clear" when the client filter emptied a non-empty list; explicit "your district isn't set" state |
| 2 | **BRK-10** — stop `alert_sent` claiming an alert was issued; add `linked_alert_id`; delete the `\|\| data[0]` reach fallback |
| 3 | **BRK-12** — canonical district picker in the advisory composer, recipient count in the receipt, refuse-at-zero, sent list |
| 4 | **BRK-13 + DEL-09** — make `advancedAnalytics` distinguish schema errors from transport errors; delete the dead probes |
| 5 | **BRK-15** — merge the sync queue into My Submissions |
| 6 | **BRK-18** — make the notification toggles real, or delete them |
| 7 | **BRK-22** — route or hide the Super Admin feedback card |
| 8 | **BRK-16 + BRK-17** — repoint `vw_campaign_effectiveness`; add campaign coordinates or make the check-in copy honest |
| 9 | **BRK-23** — alert stand-down with a closing note; fix the two admin "Active Alerts" tiles |
| 10 | **BRK-21** — paginate the approval queue, count with `head:true`, stop selecting `location_geo` |

**Ship criterion:** every data region the harness visits shows one of the four legitimate states, and no
screen asserts a fact it has not computed.

---

### Phase 4 — Make it usable in the field · ~5-8 days

Everything here is judged against the ASHA worker on a bus with one bar of signal.

| Order | Item |
| --- | --- |
| 1 | **BRK-14 + NEW-01** — `BackHandler` in MainApp, draft autosave, "Keep this report?" sheet |
| 2 | **INC-01** — Water Sources ToolCard on all five missing dashboards (five one-liners) |
| 3 | **INC-02** — Weekly Summary / Advisory / Outbreak entry points for admins and clinic; district selector on the weekly summary |
| 4 | **INC-05** — offline read cache for alerts, submissions and water sources, with an "as of HH:MM" stamp; 15 s `AbortSignal` on the Supabase client |
| 5 | **INC-04 + NEW-03** — retest assignment notifies the assignee; "Assigned to me" region and filter |
| 6 | **INC-03 + INC-07 + NEW-09** — translate the water form and `LocationField`, demote pH/TDS behind "if you have a test strip", add the offline banner, pictogram chips. Reopen readiness #28 |
| 7 | **INC-06** — EN/हिन्दी toggle on the AuthScreen; translate its strings |
| 8 | **INC-08 + NEW-05** — prefill district/state from profile, persist the district list offline, "recent places" chips, "report again here"; fix the false `gpsHelp` copy |
| 9 | **REF-05** — stop hiding the status bar (verify on a real Android build) |
| 10 | **NEW-02** — the payback card |

**Ship criterion:** a full report can be filed, offline, in Hindi, from a cold start, without typing a
district — and re-read afterwards with no network.

---

### Phase 5 — Delete and consolidate · ~2-3 days

Now that behaviour is correct, remove everything that is not carrying weight. Doing this after Phases 1-4
means no deletion can be confused with a behaviour change.

| Order | Item |
| --- | --- |
| 1 | **DEL-01** — `DashboardScreen.tsx` (+ decide `AdminManagementScreen` and the `admin-management` route). Lift the feedback block first if BRK-22 chose the tab route |
| 2 | **DEL-02 + DEL-03** — NativeWind/Tailwind/shadcn stack and the three unused native modules, in one pass (peer dependency). Fix `README.md:51` and `:126`. Correct readiness #19 |
| 3 | **DEL-04, DEL-05, DEL-07, DEL-10, DEL-11, DEL-15** — dead code, the shared barrel, `campaignsService`, dead types, `AILabel` adoption, the follow-up tile |
| 4 | **DEL-06 + DEL-08** — drop the six orphan tables and the AI-alert stack, in a reviewed migration, after repointing `vw_campaign_effectiveness`. Fix `ROADMAP_FEATURES.md` #11 |
| 5 | **DEL-12 + BRK-25** — delete the dead release lane and `README.md:83` |
| 6 | **BRK-24 + DEL-14** — un-ignore `.env.example` and `database_structure/`; commit them; delete the inert `paths-ignore`; set `SUPABASE_DB_URL` so `schema-snapshot.yml` produces `supabase/schema.sql`; delete the deployed `bright-action` and commit `delete-account`'s source (SEC-16) |
| 7 | **REF-06 + REF-04** — index hygiene and timestamp conversion (four of the seven naive columns disappear with DEL-06) |
| 8 | **INC-11 + INC-12** — audit triggers on `health_alerts` and `profiles`, an `audit_logs` purge, and one read path |

**Ship criterion:** `npm run verify` passes, the harness is green, and the APK is measurably smaller.

---

### Phase 6 — Build · ongoing

Only now. Roughly in impact order, with prerequisites already satisfied by Phases 1-5:

**NEW-04** (near-duplicate guard) → **NEW-07** (offline poster + share) → **NEW-11** (alert reach) →
**NEW-08** (supervisor line) → **NEW-10** (her weekly digest) → **NEW-06** (case follow-up, L) →
**NEW-12** (volunteer intake, owner decision).

Longer-running structural work to schedule alongside, none of it blocking: **REF-01** (policy collapse,
fold into readiness #41), **REF-02** (push targeting), **REF-03** (server-side alert geography, fold into
readiness #56), **BRK-20** (water-source identity), **BRK-19** (escalation SLA as data), **INC-10**
(assignee picker).

---

### Dependency summary

The four hard ordering constraints, restated so they cannot be missed:

1. **BRK-01 before BRK-04, BRK-09, NEW-02, NEW-06** — nothing that depends on approval can work until
   approval persists.
2. **BRK-01's two triggers in the same migration** — fixing `resolve_conflict` alone converts a silent
   no-op into a hard `42703` on every approval.
3. **DEL-13 (`mesc/`) before BRK-24 (un-ignore)** — or live credentials enter git history permanently.
4. **SEC-11 (JWT to a GUC) before the owner rotates the anon key** — or push delivery dies silently.

---

## 9. Explicitly out of scope / rejected

### 9.1 Out of scope by owner constraint

| Not doing | Why |
| --- | --- |
| Play Store submission, data-safety forms, listing assets, an app-bundle CI lane | Owner has ruled out Play Store distribution. Readiness #47 and #50 correctly say NOT APPLICABLE |
| Supabase Pro, PITR, managed backups, read replicas | Owner declined Pro. The CI `pg_dump` is the backup story (readiness #38, DONE and verified) |
| iOS work | Android-first by constraint; web exists only as a build/inspection target |
| Third-party analytics or crash SDKs beyond the already-planned Sentry decision | Readiness #37 and #45 are the owner's calls, not this plan's |
| Languages beyond English and Hindi | Phase-1 bilingual scope is a declared boundary |
| Auto-detecting language from `expo-localization` | **Documented owner decision against it** — readiness #27: *"A manual picker beats expo-localization for ASHA users whose phones often run English OS locale"*; #29: *"Ship Hindi behind the ProfileScreen picker only (no auto-detection)"*. Do not re-propose |
| Translating alerts / submissions / inbox screens right now | Outside declared phase-1 scope. Track as an explicit phase 2, do **not** report as a defect (INC-07) |

### 9.2 Deliberately not filed as defects

- **Volunteers cannot create reports.** Encoded consistently in `MainApp.tsx:89-90`,
  `ReportsScreen.tsx:104-106` and the user-facing copy at `VolunteerDashboard.tsx:293`. This is a product
  decision. It is offered as NEW-12, an **owner decision**, with the cost stated.
- **Alerts / submissions / inbox in English.** See above.
- **`DESIGN_SPEC.md` describing a different design.** It is explicitly the prior "Prakash" iteration,
  retained for its craft rules. Not drift.
- **`COMPREHENSIVE_DOCUMENTATION.md`, `MEMORY_BANK.md`, `SESSION_HISTORY.md`, `SETUP_GUIDE.md`.** Stale
  untracked leftovers. They are not tracked by git (`git ls-files` — none of the four appear). Do not read
  them, do not update them, do not cite them. If anything, delete them.

### 9.3 Rejected during verification — do not re-propose

Seventeen candidate findings were rejected in adversarial verification as unreproducible, already fixed, or
speculation. The ones most likely to be re-discovered and re-filed by a future audit are recorded here with
the reason they failed, so the work is not repeated:

| Rejected claim | Why it was rejected |
| --- | --- |
| *"Feedback is a black hole — admins never see it"* | **Refuted by probe.** `trg_notify_on_feedback` → `notify_on_feedback()` creates notifications for super_admin and health_admin carrying the first 180 chars; a rolled-back probe insert produced `notifications_created=2`. Only the *navigation* is broken (BRK-22) |
| *"Nobody can resolve an outbreak"* | **False.** `resolve_outbreak` explicitly permits `clinic` and `district_officer` within their own district. Only super_admin/health_admin are locked out (BRK-06) |
| *"`get_user_audit_log` denies every real role"* | **False.** Any user can read their own log; only the cross-user branch requires `'admin'` |
| *"The only way to remove an approved alert is Delete Permanently"* | **False.** An admin can re-review and reject it (`canReReviewAlerts`, `ApprovalQueueScreen.tsx:133`), and every field consumer filters `approval_status='approved'`, so it vanishes from all devices. `docs/OPERATIONS.md:30` documents this. The real gap is the missing *semantic* close (BRK-23) |
| *"An ASHA worker's unreviewed alert lands as a push on every phone in the shipped app"* | **Overstated.** `MainApp.tsx:92` prevents any ASHA from reaching `AlertForm`; all 4 live alerts are approved. The exposure is the **REST/RLS path only** — filed as SEC-07 with that scoping |
| *"Push tokens are readable, so anyone can suppress anyone's alerts"* | **Refuted by probe.** `GET /rest/v1/user_push_tokens`, `/push_notification_outbox` and `/profiles` with the publishable key all return `[]` under RLS. SEC-12 is therefore a *targeted* primitive requiring an out-of-band token, not a systemic one |
| *"`update_push_outbox_status` can mark everything failed and cause retry storms"* | **False.** The UPDATE is filtered to a single `expo_push_token`; it cannot touch other users' rows |
| *"`.gitignore` is the only copy of the schema — a laptop failure loses it"* | **False.** `db-backup.yml` runs a daily encrypted `pg_dump` of schema **and** data; readiness #38 records it verified. The real issue is the broken contributor instruction (BRK-24) |
| *"`getDefaultWidgetPreferences` is unused"* | **False.** Called at `lib/services/widgetPreferences.ts:125`, `:152`, `:166` |
| *"Drop `idx_audit_logs_table_name` / `idx_audit_logs_record_id` as redundant prefixes"* | **Actively harmful.** All seven `indexdef`s read: they are `(table_name, created_at DESC)` and `(record_id, created_at DESC)`, neither of which is a prefix of `(table_name, record_id, created_at DESC)` |
| *"`escalation_monitoring` shows no village"* | **False.** `EscalationMonitoringScreen.tsx:270-271` renders `location_name` when present |
| *"Signing out resets the language to English"* | **False.** Sign-out (`App.tsx:394-399`, `ProfileScreen.tsx:250`) removes only the profile cache key; `healthdrop:language` survives |
| *"`delete-account` is unreviewable service-role code"* | **False.** Its source was fetched and read: it resolves the caller from the JWT, accepts no id parameter, refuses if the caller is the last active super_admin, then deletes self. The client half is in the repo at `ProfileScreen.tsx:280`. Only the *source drift* is real (SEC-16) |
| *"Three PostGIS `st_estimatedextent` overloads have mutable `search_path`"* | **Unverifiable.** Today's advisor output contains **no** `function_search_path_mutable` lint at all. The 89 security lints are 42 `anon_security_definer_function_executable` + 42 `authenticated_…` + 2 `extension_in_public` + 1 `rls_disabled_in_public` (`spatial_ref_sys`) + 1 `materialized_view_in_api` + 1 `auth_leaked_password_protection` |
| *"`advancedAnalytics` fires three doomed requests on every screen open"* | **Overstated.** `deadProbeCache` is module-level: three per app **process**, not per open (DEL-09) |
| *"`PRODUCTION_READINESS.md:49` falsely claims `delete-account` does not exist"* | **Misquoted.** The actual sentence is *"no delete-account code exists anywhere in `components/` or `lib/services`"* — a scoped and, at the time, defensible claim |
| *"Volunteers cannot report — a defect"* | Recategorised, not rejected: it is a deliberate product decision (NEW-12) |

### 9.4 Judgement calls where reasonable people could disagree

Stated openly rather than buried, because a future agent will re-litigate them otherwise:

1. **REF-01 (policy sprawl) is ranked Low, not High.** Unreviewable RLS *is* arguably a security defect.
   It is ranked low because every concrete consequence is filed separately in §3, and collapsing 99
   policies before those holes are closed means rewriting the same policies twice.
2. **BRK-05 is High, not Critical.** The primary persona in Chengalpattu **does** see her alerts — exact
   string match succeeds. The clinic and both volunteers see none, and the green "All clear" copy is
   genuinely dangerous. If the pilot district turns out to use village-level district strings, this becomes
   Critical immediately.
3. **SEC-03 is High, not Critical.** It is read-only and limited to already-approved rows. If
   `disease_reports.symptoms`/`notes`/`age_group` were ever added to the RPC's projection, it would be
   Critical.
4. **SEC-07's severity depends on which door you look at.** Through the shipped UI it is currently closed;
   through the REST API it is open to any asha_worker account. It is filed at High on the API path, and
   flagged as a one-line-change away from being wide open.
5. **BRK-25's `GITHUB_TOKEN` claim is reasoned, not executed.** It is documented GitHub Actions behaviour,
   but no run was triggered to observe it. The rest of that finding was read line by line.
6. **REF-05's runtime winner is asserted, not measured.** `MainApp`'s mount effect almost certainly beats
   `App.tsx`'s render, but nothing in this repo can prove it. Verify on a device as part of the fix.
7. **NEW-12 (volunteer intake) is presented as an owner decision, not a recommendation.** The case against
   — more unverified volume on a queue that cannot page or decide — is real.

---

## Appendix — counts at a glance

| Category | Count |
| --- | --- |
| Security findings (§3) | 16 — 2 critical, 5 high, 5 medium, 4 low |
| Broken (§4.1) | 25 — 4 critical, 10 high, 11 medium |
| Incomplete (§4.2) | 13 — 5 high, 6 medium, 2 low |
| Delete items (§5) | 15 |
| Rebuild / refine (§6) | 6 |
| New features (§7) | 12 (1 an owner decision) |
| **Total actionable items** | **87** |
| Readiness items marked DONE that are not done | 9 — #3, #4, #5, #19, #28, #39, #53, #57, #58 |
| Readiness items open | 30 of 59 (21 PLANNED, 5 OWNER ACTION, 3 PARTIAL, 1 DEFERRED) |
| Automated quality gates in the repo today | 1 (`scripts/check-contrast.cjs`) + `tsc --noEmit` |

*End of plan. Every claim above carries its evidence. If you change a claim, change its evidence with it.*
