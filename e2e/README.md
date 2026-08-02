# Role-tour harness

**Phase 0, item one** of `docs/REFINEMENT_PLAN.md` §8.

This app once shipped a light-mode header with ~1.5:1 title contrast — unreadable —
because the only visual check anyone ever ran was a screenshot of the **sign-in
screen**. Nobody logged in. Six findings in the refinement plan (INC-01, INC-02,
BRK-22, DEL-01, and the header incident itself) are literally *"nobody logged in as
that role"*.

This harness is the machine that logs in. As every role. Every time.

---

## Run it

```bash
npx expo export --platform web     # build ./dist  (or: npm run export:web)
npx playwright install chromium    # one-time browser download (~150 MB)

npm run e2e:quick                  # 4 sessions  — ~2 min wall (concurrency 2)
npm run e2e                        # 24 sessions — ~4.5 min wall (concurrency 3)
npm run verify                     # contrast gate + tsc + the quick tour
```

Useful flags:

```bash
node e2e/run.cjs --quick --headed            # watch it drive the app
node e2e/run.cjs --roles=clinic,volunteer    # one role at a time
node e2e/run.cjs --concurrency=4             # faster; noisier logs
node e2e/run.cjs --dist=/some/other/build
node e2e/run.cjs --help
```

Outputs (both gitignored):

| Path | What |
| --- | --- |
| `e2e/shots/<role>@<width>-<theme>-<lang>--<screen>.png` | one screenshot per screen per matrix cell |
| `e2e/report.json` | every check, every known failure, machine-readable |

Exit codes: `0` pass **or** skipped · `1` a real failure or a stale known failure ·
`2` the harness could not run (no bundle, bad config).

---

## Credentials

Never hardcoded, never tracked. Resolution order:

1. **`HEALTHDROP_E2E_ACCOUNTS`** — a JSON array in the environment. This is the CI path:

   ```json
   [{ "role": "asha_worker", "email": "…", "password": "…" }]
   ```

2. **`e2e/accounts.local.json`** — same shape, gitignored. Copy
   `e2e/accounts.example.json` and fill it in.

3. **Neither** → the run prints a `SKIPPED` banner, writes
   `report.json` with `"status": "skipped"`, and **exits 0** so a missing secret can
   never redden CI on a fork or a fresh clone.

   A skipped run is not evidence that the UI is healthy. It says so, out loud.

Valid roles: `super_admin`, `health_admin`, `district_officer`, `clinic`,
`asha_worker`, `volunteer`. A role with no credentials is dropped from the run with a
printed note; the rest still run.

---

## What the matrix covers

A **session** is one login, in one matrix cell, walking the five bottom tabs and
(when the session is marked `+screens`) every sub-screen that role can reach.

A **cell** is `width × theme × language`:

* **widths** — `360 px` (the narrowest Android still in the field) and `412 px` (Pixel class)
* **themes** — `light` and `dark`. Dark is reached by pressing the app's **own**
  Profile → *Dark Mode* switch, because the app does **not** follow
  `prefers-color-scheme`. Playwright's OS colour scheme is pinned to *light* in every
  session on purpose, so a "dark" run that renders light is unambiguously a broken
  toggle rather than an ambiguous default — otherwise a silent duplicate light run
  looks exactly like a passing dark test.
* **languages** — `en` and `hi`. Hindi is selected through Profile →
  *Language / भाषा*, and the run then asserts the tab labels actually contain
  Devanagari.

### `--quick` — 4 sessions

| Role | Cell | Screens |
| --- | --- | --- |
| `asha_worker` | 412 light en | yes |
| `asha_worker` | 360 dark hi | tabs only |
| `district_officer` | 412 light en | yes |
| `district_officer` | 360 dark hi | tabs only |

Both widths, both themes, both languages, and the two roles that carry the mission
loop — in about three minutes.

### full — 24 sessions

1. **Every one of the six roles** at 412 light en, walking tabs **and every reachable
   screen**. This is the pass that would have caught the near-black header.
2. **Every one of the six roles** at 360 dark hi (tabs only) — the opposite corner of
   the matrix, where clipped Devanagari matras and dark-on-dark text live.
3. **`asha_worker` and `district_officer`** in the remaining six cells
   (360 light en, 412 dark en, 412 light hi, 360 dark en, 360 light hi, 412 dark hi),
   the first three of them deep.

Tabs walked every session: **Home · Map · Reports · Campaigns · Profile**
(clicked by `role="tab"` index, so the walk survives the Hindi switch).

Screens walked in `+screens` sessions, per role, from
`components/MainApp.tsx`'s `SCREEN_PERMISSIONS` / `CREATE_PERMISSIONS`:
`notifications-inbox`, `sync-outbox`, `my-submissions`, `health-score`,
`widget-customization`, `campaign-intelligence`, `escalation-monitoring`,
`approval-queue`, `user-management`, `water-sources`, `weekly-summary`,
`advisory-composer`, `all-alerts`, `outbreak-signal`, `outbreak-console`,
`admin-management`, and the four create forms
(`new-disease-report`, `new-water-report`, `new-campaign`, `new-alert`).

---

## What fails the run

| Check | Fails when |
| --- | --- |
| `login` | credentials do not reach the tab shell |
| `role-identity` | the dashboard's role pill is not the role the account claims |
| `overflow` | `documentElement.scrollWidth > clientWidth + 2` — the report names the widest offending elements |
| `console-error` / `page-error` | any `console.error` or unhandled exception, grouped by normalised signature |
| `empty-body` | a screen renders fewer than 20 characters of text |
| `theme-applied` | a `dark` session's dominant background is not actually dark |
| `lang-applied` | a `hi` session's tab labels contain no Devanagari |
| `screen-entry` | the entry control for a reachable screen is missing, or navigation does not leave the tab shell |
| `screen-unreachable` | a role is **permitted** to open a screen but no control in the UI navigates there |
| `click-blocked` | a control could only be clicked with `force` — i.e. something invisible is covering it |
| `session` | anything else that aborts the walk |

`screen-unreachable` is the check that encodes the INC-01 / INC-02 class of finding:
`MainApp`'s permission table says a role may open a screen, and no control in the UI
ever offers it. It is the difference between *"the role is allowed"* and *"the role can
get there"*, and only a machine that walks the dashboards can tell them apart.

`console-error` includes browser-emitted resource failures
(`Failed to load resource: … 404`), with the request's origin and path appended so the
failure names an endpoint. That is deliberate: a request the app fires and ignores is
still a request the app fires. Suppress a specific endpoint with a `signature` match,
never by weakening the check.

Entries flagged `optional` in `catalog.cjs` (`all-alerts`'s *Read more alerts*, which
only renders when the alert list overflows; `health_admin`'s route into
`user-management`, which needs a pending verification) record a **skip with a reason**,
never a failure.

---

## Known failures

`e2e/known-failures.json` is **tracked**. It lets the harness run green on today's
`main` while recording real defects honestly, rather than hiding them.

```json
{
  "id": "asha-water-sources-unreachable",
  "finding": "INC-01",
  "reason": "Water Sources has a ToolCard only on DistrictOfficerDashboard.",
  "match": { "kind": "screen-unreachable", "role": "asha_worker", "screen": "water-sources" }
}
```

`match` accepts any subset of `kind`, `role`, `screen`, `width`, `theme`, `lang`, plus
`signature` (a regular expression tested against the failure's normalised message —
this is how console errors are suppressed without pinning a line number). Every field
present must match; `kind` is required. `reason` and `finding` are required too:
a suppression with no plan finding and no explanation does not load.

**A known failure that starts passing fails the run.** The run classifies every entry as:

* *still failing* — suppressed, printed under `KNOWN FAILURES (recorded, not hidden)`.
* *stale* — a check of the same kind and scope **passed**, and nothing matched. That is
  positive evidence the defect is fixed and the suppression is now unguarded rope. The
  run **fails** with `STALE KNOWN FAILURES`; delete the entry.
* *matched nothing* — no match, and no same-kind pass either. Printed loudly, but it
  does not redden the run: it is the normal state under `--quick` / `--roles=`, and it
  is also what a fixed console error looks like (a request that stopped happening
  leaves no passing counterpart to prove it). **Check these by hand** — a rotting
  suppression is the one failure mode this file is supposed to prevent.

Reachability is deliberately recorded as a `screen-unreachable` check that **passes**
when the screen is reachable, precisely so that fixing an entry point produces the
positive evidence stale-detection needs. `overflow` and `empty-body` follow the same
convention: the check is named for the defect and passes when it is absent.

---

## What this harness cannot cover

Say this part out loud, because a green tour is not a shipped-quality signal.

It drives **`react-native-web` in headless Chromium**. That is a different renderer
from the one the ASHA worker holds. It cannot see:

* **The device frame** — notch/cutout, punch-hole, rounded corners, the gesture pill,
  and everything `SafeAreaView` insets around. `MainApp` also hides the status bar and
  the Android navigation bar on native (`REF-05`); web never exercises that path.
* **OS font scale and display size.** `maxFontSizeMultiplier={1.3}` is all over this
  codebase and is never tested here. Set Android font size to Largest and re-walk by hand.
* **Sunlight, cheap panels, and glare** — the whole reason the Bharosa contrast rule
  exists. `scripts/check-contrast.cjs` guards the token pairs; nothing guards the
  physical experience.
* **Touch** — 48 dp targets, thumb reach, one-handed use, gloved or wet fingers.
  Playwright clicks pixel-perfect centres and never mis-taps.
* **Real offline behaviour** — flight mode mid-submit, a 2G stall, a dropped socket on
  a moving bus. The sync queue is exercised by nothing here.
* **Push delivery** — no `expo-notifications` on web. Verify pushes by reading
  `push_notification_outbox`, per the plan's §2.6 rule.
* **Native-only modules** — GPS/`expo-location` (the harness dismisses the location
  prompt), the WebView map (web renders an `<iframe srcDoc>` instead, so SEC-04's
  native sink is untested), `expo-print`, `expo-sharing`, the Android back button.
* **Hindi quality.** It asserts Devanagari *rendered*; it cannot tell you the string is
  good Hindi. `hi.json` still carries `_note: "Machine-drafted Hindi"`.
* **Anything the database refuses.** The tour reads; it does not file a report,
  approve one, or send an alert. Write-path truth belongs to the DB assertion suite
  (Phase 0, item two) and to the SQL before/after discipline in §2.6.
* **Screens with no static entry point** — `outbreak-signal` and `outbreak-console`
  need a live outbreak row. They are reported as unreachable, not walked.
* **Layout collisions inside a row.** The `overflow` check is *page-level*: it asks
  whether the body scrolls sideways. Two text runs sharing a row with a zero-pixel
  gutter do not move the page's scroll width, so they pass. Profile →
  *Language / भाषा* is a live example: the caption column ends at exactly the x where
  the "English" / "हिन्दी" value begins (measured: caption `67..261`, value `261..303`
  at 360 px; `67..313` / `313..355` at 412 px). No overlap, no overflow — and it still
  reads as a collision once the caption wraps to two lines. Eyes are still required.

It also *depends on the live Supabase project*: these are real logins against real
data. A row that disappears can change what a screen renders. Treat data-shaped
failures as data, not as regressions, and say which you concluded.

---

## Adding a role or a screen

**A role.** Add it to `ROLES` and `ROLE_LABEL` in `e2e/catalog.cjs` (the label must be
byte-identical to `ROLE_LABEL` in `components/dashboards/DashboardShared.tsx` — that is
what `role-identity` asserts), add credentials for it, list it in the `permittedRoles`
and `entries` of every screen it can reach, and add sessions to `FULL_SESSIONS`.

**A screen.** Add one entry to `SCREENS` in `e2e/catalog.cjs`:

```js
{
  id: 'my-new-screen',                       // matches the MainApp ScreenType
  permittedRoles: ['district_officer'],      // copy from MainApp SCREEN_PERMISSIONS
  entries: {
    district_officer: { tab: 'home', label: 'My New Screen' },  // the control's accessibilityLabel
  },
}
```

The `label` is matched as `[aria-label="X"]` **or** `[aria-label^="X, "]`, because
`ToolCard` appends `", N pending"` when it carries a badge. Add `optional: true` and a
`why` when the control only renders under a data condition.

If a role is permitted but you deliberately give it no `entries` value, the run reports
`screen-unreachable` for that role — which is the point. Suppress it in
`known-failures.json` with the finding id, or fix the dashboard.

**A new tab** would need a change to `TABS` *and* to `TAB_ORDER` in
`components/MainApp.tsx`; the walk clicks by index.

---

## How it drives the app

Notes for anyone extending it — every one of these was learned the hard way:

* **The tab shell is the state machine.** `MainApp` returns early for sub-screens, so
  "five `role="tab"` elements" means *on a tab* and "zero" means *on a sub-screen*.
  That is the arrival signal, and it is language-independent.
* **The map's *Enable Location* modal covers the whole viewport** and eats every tap.
  It is dismissed after login and again after every navigation. Without that, clicks
  fail with a stability timeout that looks like a hang.
* **Clicks are normal clicks first.** An element that can only be `force`-clicked is
  covered by something, which is a defect — so it is recorded as `click-blocked`
  rather than silently forced. Three retries with a modal sweep between them come
  first, so this is not a flake generator.
* **No hardcoded sleeps.** Loading is "wait until the rendered text and element count
  stop changing"; navigation is "wait until the tab count flips". `networkidle` is a
  hint with a 6 s ceiling, never the thing waited on — the Supabase client keeps
  chattering, and waiting on it cost ~20 s per screen before it was demoted.
* **Entry labels resolve exact-first.** `DashboardShared` renders three label shapes:
  `"Alert"` (QuickActionBtn), `"Disease Reports, 3 pending"` (badged ToolCard) and
  `"Water Reports: 12"` (StatCard). A loose prefix match grabs an AlertCard
  (`"Alert, urgency high: …"`) when the catalog asked for the Alert quick action, then
  hangs waiting for a navigation that never happens.
* **The static server survives `dist/` being rebuilt underneath it.** An unhandled
  stream `error` used to take the whole runner down with `EPERM` when someone ran
  `expo export` mid-tour. A dead request is recoverable; a dead runner loses the
  entire matrix.
* **`toggleTheme` cycles light → dark → *system* → light.** A fresh context always
  boots at `light`, so exactly one press lands on dark. Two presses would land on
  `system`, which — with the OS pinned to light — silently renders light again.
