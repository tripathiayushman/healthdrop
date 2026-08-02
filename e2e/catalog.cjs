// =====================================================
// ROLE-TOUR CATALOG
// -----------------------------------------------------
// The single declarative description of WHAT the harness
// walks. Everything here mirrors a contract that lives in
// app source; when the app changes, this file changes —
// never the other way round.
//
//   permittedRoles  mirrors components/MainApp.tsx
//                   SCREEN_PERMISSIONS / CREATE_PERMISSIONS
//   entries         the UI path a role actually has to the
//                   screen. A screen that is PERMITTED but
//                   has NO entry is a reachability defect,
//                   not a harness gap — the run reports it
//                   as `screen-unreachable`.
//
// Adding a role or a screen: see e2e/README.md.
// =====================================================

const ROLES = [
  'super_admin',
  'health_admin',
  'district_officer',
  'clinic',
  'asha_worker',
  'volunteer',
];

// Full accessibility labels rendered by DashboardShared.ROLE_LABEL.
// Used to assert the session is really logged in AS THAT ROLE — the
// exact mistake §2.6 of the refinement plan is about.
const ROLE_LABEL = {
  super_admin: 'Super Administrator',
  health_admin: 'Health Administrator',
  district_officer: 'District Officer',
  clinic: 'Clinic Staff',
  asha_worker: 'ASHA Worker',
  volunteer: 'Community Volunteer',
};

// The five bottom tabs, in render order (MainApp.TAB_ORDER).
// Clicked by index against role="tab" so the walk is language-independent:
// after the Hindi switch the labels become होम / नक्शा / रिपोर्ट / अभियान / प्रोफ़ाइल.
const TABS = ['home', 'map', 'reports', 'campaigns', 'profile'];

const ALL = ROLES.slice();

/**
 * An entry recipe.
 *   tab       which bottom tab to stand on first (null = any / chrome-level)
 *   label     accessibilityLabel of the control to press. ToolCard appends
 *             ", N pending" when it carries a badge, so matching is
 *             `[aria-label="X"], [aria-label^="X, "]`.
 *   optional  true  => the control only renders under some data condition;
 *             a missing control is a SKIP with a reason, never a failure.
 */
const SCREENS = [
  // ── chrome-level, every role ────────────────────────────────
  {
    id: 'notifications-inbox',
    permittedRoles: ALL,
    entries: Object.fromEntries(ALL.map(r => [r, { tab: 'home', label: 'Open notifications inbox' }])),
  },
  {
    id: 'sync-outbox',
    permittedRoles: ALL,
    entries: Object.fromEntries(ALL.map(r => [r, { tab: 'home', label: 'Open sync outbox' }])),
  },
  {
    id: 'my-submissions',
    permittedRoles: ALL,
    entries: Object.fromEntries(ALL.map(r => [r, { tab: 'reports', label: 'My Submissions' }])),
  },

  // ── dashboard tool cards ────────────────────────────────────
  {
    id: 'health-score',
    permittedRoles: ALL,
    entries: Object.fromEntries(ALL.map(r => [r, { tab: 'home', label: 'District Health Score' }])),
  },
  {
    id: 'widget-customization',
    permittedRoles: ALL,
    entries: Object.fromEntries(ALL.map(r => [r, { tab: 'home', label: 'Customize Widgets' }])),
  },
  {
    id: 'campaign-intelligence',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
    entries: {
      super_admin: { tab: 'home', label: 'Campaign Intelligence' },
      health_admin: { tab: 'home', label: 'Campaign Intelligence' },
      district_officer: { tab: 'home', label: 'Campaign Intelligence' },
      clinic: { tab: 'home', label: 'Campaign Intelligence' },
      asha_worker: { tab: 'home', label: 'Campaign Intelligence' },
    },
  },
  {
    id: 'escalation-monitoring',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'clinic'],
    entries: {
      super_admin: { tab: 'home', label: 'Escalation Monitoring' },
      health_admin: { tab: 'home', label: 'Escalation Monitoring' },
      district_officer: { tab: 'home', label: 'Escalation Monitoring' },
      clinic: { tab: 'home', label: 'Escalation Monitoring' },
    },
  },
  {
    id: 'approval-queue',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'clinic'],
    entries: {
      super_admin: { tab: 'home', label: 'Approval Queue' },
      health_admin: { tab: 'home', label: 'Reports Pending Review' },
      district_officer: { tab: 'home', label: 'Disease Reports' },
      clinic: { tab: 'home', label: 'Disease Reports' },
    },
  },
  {
    id: 'user-management',
    permittedRoles: ['super_admin', 'health_admin'],
    entries: {
      super_admin: { tab: 'home', label: 'User Management' },
      // HealthAdminDashboard only renders the route when stats.unverified > 0.
      health_admin: { tab: 'home', label: 'User Management', optional: true, why: 'HealthAdminDashboard routes here from the unverified-users signal, which only renders when a pending verification exists' },
    },
  },
  {
    id: 'water-sources',
    permittedRoles: ALL,
    entries: {
      // DistrictOfficerDashboard routes here from a StatCard ("Water Reports: N");
      // every other dashboard uses a "Water Sources" ToolCard.
      district_officer: { tab: 'home', label: 'Water Reports' },
      super_admin: { tab: 'home', label: 'Water Sources' },
      health_admin: { tab: 'home', label: 'Water Sources' },
      clinic: { tab: 'home', label: 'Water Sources' },
      asha_worker: { tab: 'home', label: 'Water Sources' },
      volunteer: { tab: 'home', label: 'Water Sources' },
    },
  },
  {
    id: 'weekly-summary',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'clinic'],
    entries: {
      super_admin: { tab: 'home', label: 'Weekly Summary' },
      health_admin: { tab: 'home', label: 'Weekly Summary' },
      district_officer: { tab: 'home', label: 'Weekly Summary' },
      clinic: { tab: 'home', label: 'Weekly Summary' },
    },
  },
  {
    id: 'advisory-composer',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer'],
    entries: {
      super_admin: { tab: 'home', label: 'Broadcast to staff' },
      health_admin: { tab: 'home', label: 'Broadcast to staff' },
      district_officer: { tab: 'home', label: 'Broadcast to staff' },
    },
  },
  {
    id: 'all-alerts',
    permittedRoles: ALL,
    entries: Object.fromEntries(ALL.map(r => [r, {
      tab: 'home',
      label: 'Read more alerts',
      optional: true,
      why: 'MapAndAlertsSection only renders "Read more alerts" when the alert list overflows its viewport',
    }])),
  },
  {
    id: 'outbreak-signal',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer'],
    entries: {},
    unreachableWhy: 'only reachable from a live outbreak signal card on DistrictOfficerDashboard; no static entry point exists',
  },
  {
    id: 'outbreak-console',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer'],
    entries: {},
    unreachableWhy: 'only reachable from outbreak-signal, which itself needs a live outbreak row',
  },
  {
    id: 'admin-management',
    permittedRoles: ['super_admin', 'health_admin', 'clinic'],
    entries: {
      // Was unreachable: the only navigator was DashboardScreen.tsx, which
      // MainApp no longer imports. Now a "Records Console" ToolCard in each
      // permitted role's admin/tools section.
      super_admin: { tab: 'home', label: 'Records Console' },
      health_admin: { tab: 'home', label: 'Records Console' },
      clinic: { tab: 'home', label: 'Records Console' },
    },
  },

  // ── create screens (MainApp.CREATE_PERMISSIONS) ─────────────
  {
    id: 'new-disease-report',
    kind: 'create',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
    entries: {
      super_admin: { tab: 'home', label: 'Report Disease' },
      health_admin: { tab: 'home', label: 'Report Disease' },
      district_officer: { tab: 'home', label: 'Report Disease' },
      clinic: { tab: 'home', label: 'Report Disease' },
      asha_worker: { tab: 'home', label: 'Report Disease' },
    },
  },
  {
    id: 'new-water-report',
    kind: 'create',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'clinic', 'asha_worker'],
    entries: {
      super_admin: { tab: 'home', label: 'Water Quality' },
      health_admin: { tab: 'home', label: 'Water Quality' },
      district_officer: { tab: 'home', label: 'Water Quality' },
      clinic: { tab: 'home', label: 'Water Quality' },
      asha_worker: { tab: 'home', label: 'Water Quality' },
    },
  },
  {
    id: 'new-campaign',
    kind: 'create',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer', 'asha_worker'],
    entries: {
      super_admin: { tab: 'home', label: 'New Campaign' },
      health_admin: { tab: 'home', label: 'Campaign' },
      district_officer: { tab: 'home', label: 'Campaign' },
      asha_worker: { tab: 'home', label: 'New Campaign' },
    },
  },
  {
    id: 'new-alert',
    kind: 'create',
    permittedRoles: ['super_admin', 'health_admin', 'district_officer'],
    entries: {
      super_admin: { tab: 'home', label: 'Send Alert' },
      health_admin: { tab: 'home', label: 'Alert' },
      district_officer: { tab: 'home', label: 'Alert' },
    },
  },
];

// ─────────────────────────────────────────────────────
//  The matrix
// ─────────────────────────────────────────────────────
// A "cell" is one viewport width × one theme × one language.
// A "session" is one login in one cell, walking the tabs and
// (optionally) every screen the role can reach.
//
// 360 px is the narrowest Android phone still in the field;
// 412 px is the Pixel-class default. Dark is reached through
// the app's own Profile toggle — the app does NOT follow
// prefers-color-scheme, so a colorScheme-only run is a
// silent duplicate light run. Hindi is reached through
// Profile -> Language / भाषा.

const cell = (width, theme, lang) => ({ width, theme, lang });

const FULL_SESSIONS = [
  // 1. Every role, deep walk, the reference cell.
  ...ROLES.map(role => ({ role, ...cell(412, 'light', 'en'), screens: true })),
  // 2. Every role, the opposite corner: narrowest + dark + Devanagari.
  //    This is where clipped matras and near-black-on-black live.
  ...ROLES.map(role => ({ role, ...cell(360, 'dark', 'hi'), screens: false })),
  // 3. The two field-critical roles get the remaining six cells.
  ...['asha_worker', 'district_officer'].flatMap(role => [
    { role, ...cell(360, 'light', 'en'), screens: true },
    { role, ...cell(412, 'dark', 'en'), screens: true },
    { role, ...cell(412, 'light', 'hi'), screens: true },
    { role, ...cell(360, 'dark', 'en'), screens: false },
    { role, ...cell(360, 'light', 'hi'), screens: false },
    { role, ...cell(412, 'dark', 'hi'), screens: false },
  ]),
];

// --quick: the smallest set that still touches both widths, both themes,
// both languages and the two roles that carry the mission loop.
const QUICK_SESSIONS = [
  { role: 'asha_worker', ...cell(412, 'light', 'en'), screens: true },
  { role: 'asha_worker', ...cell(360, 'dark', 'hi'), screens: false },
  { role: 'district_officer', ...cell(412, 'light', 'en'), screens: true },
  { role: 'district_officer', ...cell(360, 'dark', 'hi'), screens: false },
];

module.exports = { ROLES, ROLE_LABEL, TABS, SCREENS, FULL_SESSIONS, QUICK_SESSIONS };
