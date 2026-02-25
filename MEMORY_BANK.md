# 🏥 HealthDrop Surveillance System — Memory Bank

> **Single source of truth for the current state of the codebase.**
> Last updated: 2026-02-25 (Prompt 18: UI Polish, AllAlertsScreen, Clinic Permissions, Campaign Roles, SQL Cleanup)

---

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [File & Directory Map](#3-file--directory-map)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Role Function Table](#5-role-function-table)
6. [Database Schema](#6-database-schema)
7. [RLS Policies Summary](#7-rls-policies-summary)
8. [PostgreSQL Triggers](#8-postgresql-triggers)
9. [App Navigation & Screens](#9-app-navigation--screens)
10. [Dashboards](#10-dashboards)
11. [Forms](#11-forms)
12. [Services Layer](#12-services-layer)
13. [SQL Files (database_structure/)](#13-sql-files-database_structure)
14. [Change History](#14-change-history)
15. [Known Issues / TODOs](#15-known-issues--todos)

---

## 1. Project Overview

**HealthDrop Surveillance System** — cross-platform React Native + Expo app (Android/iOS/Web) backed by Supabase (PostgreSQL + Auth + RLS).

**Supabase URL:** `https://ekfdimdlxifatsaubvbh.supabase.co`

**Core use cases:**
- Disease outbreak reporting and tracking
- Water quality monitoring
- Health alert broadcasting (urgency-graded)
- Health campaign management with enrollment
- User and data governance (admin panel)
- AI health insights (Gemini 2.0)
- Push notifications (Expo)
- Offline sync

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Mobile Framework | React Native 0.81.5 + Expo ~54.0.33 |
| Web Support | react-native-web ^0.21.2 |
| Language | TypeScript ~5.9.2 |
| Backend | Supabase (PostgreSQL + Auth + RLS) |
| Supabase Client | @supabase/supabase-js ^2.39.7 |
| Session Storage | expo-secure-store (native) / AsyncStorage (web) |
| Icons | @expo/vector-icons ^15.0.3 (Ionicons, MaterialCommunityIcons) |
| Date Utilities | date-fns ^4.1.0 |
| Gradient | expo-linear-gradient |
| AI | Google Gemini REST API (gemini-2.0-flash-lite → fallback) |
| Location | expo-location + Nominatim reverse geocoding |
| Theming | Custom ThemeContext (Dark/Light) via AsyncStorage |

---

## 3. File & Directory Map

```
Health-Drop-Surveillance-System-main/
├── index.ts                          ← App entry
├── App.tsx                           ← Root (ThemeProvider, Auth)
├── app.json                          ← Expo config
├── .env                              ← EXPO_PUBLIC_SUPABASE_URL/KEY + GEMINI_API_KEY
│
├── types/
│   ├── index.ts                      ← ALL TypeScript types
│   └── profile.ts                    ← Lightweight Profile type
│
├── lib/
│   ├── supabase.ts
│   ├── ThemeContext.tsx
│   └── services/
│       ├── index.ts
│       ├── diseaseReports.ts
│       ├── waterQuality.ts
│       ├── campaigns.ts
│       ├── users.ts
│       └── notifications.ts
│
├── components/
│   ├── MainApp.tsx                   ← Tab nav + screen router + AIChatbot overlay
│   ├── AuthScreen.tsx                ← Sign in / Sign up / OTP
│   ├── Navbar.tsx
│   ├── Sidebar.tsx
│   │
│   ├── ai/
│   │   ├── AIInsightsPanel.tsx       ← Location-aware Gemini insights card
│   │   └── AIChatbot.tsx             ← Floating FAB + chat panel
│   │
│   ├── dashboards/
│   │   ├── DashboardShared.tsx       ← Shared: Header, StatCard, QuickActionBtn, ToolCard, AlertCard
│   │   ├── DashboardRouter.tsx       ← Routes to correct dashboard by role
│   │   ├── SuperAdminDashboard.tsx
│   │   ├── HealthAdminDashboard.tsx
│   │   ├── DistrictOfficerDashboard.tsx
│   │   ├── ClinicDashboard.tsx       ← Report+verify only (no campaign/alert creation)
│   │   ├── AshaWorkerDashboard.tsx
│   │   └── VolunteerDashboard.tsx
│   │
│   ├── forms/
│   │   ├── DiseaseReportForm.tsx
│   │   ├── WaterQualityReportForm.tsx
│   │   ├── CampaignForm.tsx          ← status: 'planned' (DB constraint)
│   │   ├── AlertForm.tsx
│   │   └── index.ts
│   │
│   └── screens/
│       ├── ReportsScreen.tsx         ← Role-aware filters, stacked status badges
│       ├── CampaignsScreen.tsx       ← Campaign list + enroll; create/manage: admin/DO only
│       ├── AdminManagementScreen.tsx ← Legacy admin screen
│       ├── ApprovalQueueScreen.tsx   ← Verify/Approve/Reject (admin+clinic); Delete (admin only)
│       ├── UserManagementScreen.tsx  ← User role management (super_admin only)
│       ├── ProfileScreen.tsx
│       ├── AllAlertsScreen.tsx       ← Full alert list with search + urgency filter + detail modal
│       └── DashboardScreen.tsx       ← (Legacy — now DashboardRouter is used)
│
├── database_structure/               ← ALL SQL migration files (see §13)
│
└── mesc/
    ├── DATABASE_SCHEMA.sql
    ├── Documentation.md
    └── user_guide.md
```

---

## 4. User Roles & Permissions

### Roles (6 total)

| Role | DB Value | Description |
|---|---|---|
| Super Admin | `super_admin` | Full system control |
| Health Admin | `health_admin` | Operational admin (no user role changes) |
| District Officer | `district_officer` | District-scoped admin |
| Clinic | `clinic` | Report + verify disease/water reports |
| ASHA Worker | `asha_worker` | Field commmunity health worker |
| Volunteer | `volunteer` | Community participant |

### Permissions Matrix

| Action | super_admin | health_admin | district_officer | clinic | asha_worker | volunteer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Disease Reports** | | | | | | |
| Submit report | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View all reports | ✅ | ✅ | district | district | own+district | approved only |
| Verify (status) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve/Reject | ✅ | ✅ | district | district | ❌ | ❌ |
| Delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Water Reports** | | | | | | |
| Submit report | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View all reports | ✅ | ✅ | district | district | own+district | approved only |
| Verify/Approve | ✅ | ✅ | district | district | ❌ | ❌ |
| Delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Campaigns** | | | | | | |
| Create campaign | ✅ | ✅ | ✅ | ❌ | ✅ (submit) | ❌ |
| Approve/Cancel/Delete | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Enroll in campaign | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| View campaigns | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Health Alerts** | | | | | | |
| Create alert | ✅ | ✅ | district | ❌ | ❌ | ❌ |
| Approve/Reject alert | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View all alerts | ✅ | ✅ | district | district | district | district |
| **User Management** | | | | | | |
| View all users | ✅ | ✅ | district | ❌ | ❌ | ❌ |
| Change user roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Deactivate users | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Approval Queue** | | | | | | |
| See queue | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete items | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **AI Insights** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 5. Role Function Table

| Role | Primary Function | Creates | Approves | Sees | Cannot |
|---|---|---|---|---|---|
| **Super Admin** | Full system control | Everything | Everything globally | Everything | Nothing |
| **Health Admin** | Operational management | Reports, alerts, campaigns | Everything globally | Everything | Change user roles |
| **District Officer** | District-level governance | Reports, campaigns (own district) | Reports & campaigns in own district | Own district data only | Access other districts, delete, manage users |
| **Clinic** | Medical verification | Disease + water reports only | Verify/approve district reports | District reports + all approved | Create campaigns/alerts, delete anything |
| **ASHA Worker** | Field reporting | Disease + water reports, submit campaigns | Own reports (auto-approved) | Own + district approved | Approve others, create alerts/campaigns |
| **Volunteer** | Community participation | Nothing | Nothing | Approved alerts+campaigns nationwide | Submit reports, approve, manage |

---

## 6. Database Schema

### `profiles`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| email | text | |
| full_name | text | |
| role | text | CHECK: super_admin/health_admin/district_officer/clinic/asha_worker/volunteer |
| phone | text | |
| district | text | |
| state | text | |
| is_active | boolean | false = deactivated |
| expo_push_token | text | for push notifications |
| created_at | timestamptz | |

### `disease_reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| reporter_id | uuid → profiles | |
| disease_name | text | |
| cases_count | int | |
| severity | text | mild/moderate/severe/critical |
| status | text | reported/verified |
| approval_status | text | pending_approval/approved/rejected |
| approved_by | uuid | |
| approved_at | timestamptz | |
| rejection_reason | text | |
| district, state | text | |
| location_name | text | |
| latitude, longitude | float | |
| patient_age, patient_gender | | |
| symptoms | text[] | |
| notes | text | |
| client_idempotency_key | text | offline sync dedup |
| created_at | timestamptz | |

### `water_quality_reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| reporter_id | uuid → profiles | |
| source_name | text | |
| source_type | text | |
| overall_quality | text | safe/unsafe/critical |
| status | text | reported/verified |
| approval_status | text | pending_approval/approved/rejected |
| approved_by, approved_at, rejection_reason | | |
| ph_level, turbidity, chlorine_level, tds_level, bacteria_count | numeric | |
| district, state, location_name, latitude, longitude | | |
| client_idempotency_key | text | |
| created_at | timestamptz | |

### `health_campaigns`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name / title | text | |
| description | text | |
| campaign_type | text | vaccination/awareness/health_checkup/etc |
| status | text | planned/active/completed/cancelled |
| approval_status | text | pending_approval/approved/rejected |
| approved_by, approved_at, rejection_reason | | |
| start_date, end_date | date | |
| district, state, location_name | text | |
| target_audience, target_beneficiaries | | |
| max_participants, current_participants | int | |
| organizer_id | uuid → profiles | |
| created_at | timestamptz | |

### `health_alerts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| description | text | |
| alert_type | text | |
| urgency_level | text | low/medium/high/critical |
| status | text | active/resolved/expired |
| approval_status | text | pending_approval/approved/rejected |
| approved_by, approved_at, rejection_reason | | |
| district, state, location_name | text | |
| latitude, longitude | float | |
| created_by | uuid → profiles | |
| created_at | timestamptz | |

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| recipient_id | uuid → profiles | |
| sender_id | uuid → profiles | |
| title, message | text | |
| type | text | |
| is_read | boolean | |
| created_at | timestamptz | |

### `campaign_enrollments`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_id | uuid → health_campaigns | |
| user_id | uuid → profiles | |
| enrolled_at | timestamptz | |

### `user_feedback`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid → profiles | |
| feedback_type | text | |
| message | text | |
| rating | int 1–5 | |
| created_at | timestamptz | |

### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid → profiles | |
| action | text | |
| table_name | text | |
| record_id | uuid | |
| old_data, new_data | jsonb | |
| created_at | timestamptz | |

---

## 7. RLS Policies Summary

### Key Principles
- All tables have RLS enabled
- Roles are read from `profiles` table via `auth.uid()`
- SECURITY DEFINER helpers avoid recursive RLS queries: `get_my_role()`, `get_my_district()`
- District officers are district-scoped on all tables
- Clinics have UPDATE (verify/approve) on disease + water reports only
- Only super_admin/health_admin can DELETE reports
- Only super_admin can change user roles

### Policy files in `database_structure/`:
- `DISTRICT_OFFICER_RLS.sql` — Complete district_officer implementation
- `FIX_CLINIC_RLS_POLICIES.sql` — Clinic UPDATE on disease/water; removes clinic from campaigns
- `FIX_REPORT_SUBMISSION_RLS.sql` — Fixes stale trigger, idempotent policies
- `FIX_PROFILES_RLS_RECURSION.sql` — SECURITY DEFINER helpers
- `APPROVAL_SYSTEM.sql` — Core approval workflow policies
- `ALERT_APPROVAL_WORKFLOW.sql` — Alert-specific approval policies

---

## 8. PostgreSQL Triggers

| Trigger | Table | Function | Behaviour |
|---|---|---|---|
| `set_reporter_id` | disease_reports | `auto_approve_reporter_id_report()` | Sets reporter_id = auth.uid(); auto-approves for admin/DO |
| `set_created_by_water` | water_quality_reports | `auto_approve_created_by_report()` | Sets reporter_id; auto-approves for admin/DO |
| `set_organizer_id` | health_campaigns | `auto_approve_organizer_id_report()` | Sets organizer_id; auto-approves for admin/DO |
| `set_alert_created_by` | health_alerts | `auto_approve_alert_fn()` | Sets created_by; auto-approves for admin |

---

## 9. App Navigation & Screens

### ScreenType Union (MainApp.tsx)
```ts
type ScreenType = 'tabs' | 'new-disease-report' | 'new-water-report' |
  'new-campaign' | 'new-alert' | 'admin-management' | 'user-management' |
  'approval-queue' | 'all-alerts';
```

### Tab Bar (all roles)
1. **Home** → DashboardRouter (role-specific dashboard)
2. **Reports** → ReportsScreen
3. **Campaigns** → CampaignsScreen
4. **Profile** → ProfileScreen

### Full-screen overlays (navigateToForm)
- `new-disease-report` → DiseaseReportForm
- `new-water-report` → WaterQualityReportForm
- `new-campaign` → CampaignForm
- `new-alert` → AlertForm
- `admin-management` → AdminManagementScreen (tab: initialTab param)
- `user-management` → UserManagementScreen
- `approval-queue[:tab]` → ApprovalQueueScreen (deep-link tab)
- `all-alerts` → AllAlertsScreen

### AllAlertsScreen Features
- Search bar + urgency filter chips (All/Critical/High/Medium/Low)
- Pull-to-refresh
- Left-border color coded by urgency
- Tap to open detail modal
- Volunteers see district-filtered results only

### ApprovalQueueScreen
- Tabs: Disease | Water | Campaigns | Alerts (clinic sees all 4; DO sees disease/water/campaigns)
- Verify/Unverify: admin + clinic (on disease/water only)
- Approve/Reject with reason: admin + clinic
- Delete: super_admin + health_admin only
- Campaign manage (cancel/complete): admin + district_officer only (NOT clinic)

### ReportsScreen
- Role-aware status filter chips (volunteer: reported/verified only; admin/clinic: + approval filters)
- Card footer: status badge stacked above approval badge, date pinned right
- Modal shows approval_status + rejection_reason to reporters and admins

### UserManagementScreen
- Role filter chips: horizontal scroll, centered text, alignItems: center
- Role assignment buttons: width 46% (2-per-row grid), text centered
- Role labels from ROLE_DISPLAY map (e.g. "Health Admin", not "health admin")
- Change role: super_admin only

---

## 10. Dashboards

| Dashboard | Role | Quick Actions | Approval Tools |
|---|---|---|---|
| SuperAdminDashboard | super_admin | Reports, Alerts, Campaign, User Mgmt | Disease + Water + Campaign + Alert queues |
| HealthAdminDashboard | health_admin | Reports, Alerts, Campaign | Disease + Water + Campaign queues |
| DistrictOfficerDashboard | district_officer | Disease, Water, Campaign (own district) | District reports + campaigns |
| ClinicDashboard | clinic | Disease Report, Water Report, Review Queue | Disease Reports queue + Water Reports queue |
| AshaWorkerDashboard | asha_worker | Disease Report, Water Report | Own submissions list |
| VolunteerDashboard | volunteer | Campaigns | Enrolled campaigns |

**ClinicDashboard specifics:**
- No Campaign or Alert creation buttons
- Approval tools navigate to `approval-queue:disease` and `approval-queue:water`

---

## 11. Forms

| Form | File | Notes |
|---|---|---|
| Disease Report | DiseaseReportForm.tsx | GPS auto-fill |
| Water Quality | WaterQualityReportForm.tsx | Chemical params |
| Campaign | CampaignForm.tsx | status: 'planned' (DB constraint) |
| Alert | AlertForm.tsx | Role-aware (admin/DO only) |

---

## 12. Services Layer

| Service | File | Key Functions |
|---|---|---|
| Disease Reports | diseaseReports.ts | CRUD, stats, filter by severity/status/district/date |
| Water Quality | waterQuality.ts | CRUD, stats, filter |
| Campaigns | campaigns.ts | CRUD, enroll, withdraw |
| Users | users.ts | list, changeRole, deactivate |
| Notifications | notifications.ts | list, send, markRead |

---

## 13. SQL Files (database_structure/)

| File | Purpose | Status |
|---|---|---|
| `DATABASE_SCHEMA.sql` | Full schema definition | ✅ Current |
| `APPROVAL_SYSTEM.sql` | Core approval workflow policies | ✅ Current |
| `ALERT_APPROVAL_WORKFLOW.sql` | Health alerts approval policies + trigger | ✅ Current |
| `AUDIT_LOG.sql` | audit_logs table + triggers | ✅ Current |
| `DISTRICT_OFFICER_RLS.sql` | Complete district_officer RLS | ✅ Current |
| `ENUM_MIGRATION.sql` | Role enum updates | ✅ Applied |
| `FIX_CLINIC_RLS_POLICIES.sql` | Clinic UPDATE (disease/water); removes clinic from campaigns | ✅ Needs applying |
| `FIX_PROFILES_RLS_RECURSION.sql` | SECURITY DEFINER helpers | ✅ Current |
| `FIX_REPORT_SUBMISSION_RLS.sql` | Fixes stale trigger + idempotent policies | ✅ Current |
| `FIX_VERIFICATION_AND_VISIBILITY.sql` | Visibility + verify update policies | ✅ Needs applying |
| `GEOGRAPHIC_HEATMAP.sql` | Materialized view for heatmap analytics | ✅ Optional |
| `OFFLINE_SYNC_SCHEMA.sql` | Idempotency keys for offline sync | ✅ Current |
| `OUTBREAK_DETECTION.sql` | Outbreak detection function | ✅ Optional |
| `PERFORMANCE_INDEXES.sql` | 20+ query optimization indexes | ✅ Current |
| `PUSH_NOTIFICATIONS.sql` | expo_push_token column + edge function schema | ✅ Current |
| `USER_FEEDBACK_TABLE.sql` | user_feedback table definition | ✅ Current |

> **To apply pending fixes:** Run `FIX_CLINIC_RLS_POLICIES.sql` and `FIX_VERIFICATION_AND_VISIBILITY.sql` in Supabase SQL Editor.

---

## 14. Change History

| Prompt | Date | Summary |
|---|---|---|
| 1–8 | 2026-02-22 | Core schema, RLS, basic dashboards, reports, campaigns, alerts |
| 9 | 2026-02-22 | Performance indexes (`PERFORMANCE_INDEXES.sql`) |
| 10 | 2026-02-22 | Push notifications (`PUSH_NOTIFICATIONS.sql`) |
| 11 | 2026-02-22 | Offline sync (`OFFLINE_SYNC_SCHEMA.sql`) |
| 12 | 2026-02-22 | GPS + reverse geocoding |
| 13 | 2026-02-23 | Advanced filtering + search (ReportsScreen, CampaignsScreen) |
| 14 | 2026-02-23 | Alert approval workflow (`ALERT_APPROVAL_WORKFLOW.sql`) |
| 15 | 2026-02-23 | Profiles RLS recursion fix + ProfileSetup removal |
| 16 | 2026-02-23 | Admin role split: super_admin / health_admin (`ADMIN_ROLE_SPLIT.sql`) |
| 17 | 2026-02-24 | district_officer role + complete RLS (`DISTRICT_OFFICER_RLS.sql`) |
| 18 | 2026-02-24 | Gemini AI integration (AIInsightsPanel, AIChatbot) |
| 19 | 2026-02-24 | Role-specific dashboards (DashboardRouter, 6 dashboards, DashboardShared) |
| 20 | 2026-02-24 | ApprovalQueueScreen: deep-link, verify, re-review, clinic reject reason |
| 21 | 2026-02-24 | ReportsScreen: role-aware filters, stacked badges, approval visibility |
| 22 | 2026-02-24 | AshaWorkerDashboard submission count fix; CampaignForm status fix |
| 23 | 2026-02-24 | AllAlertsScreen + MainApp navigation; DashboardScreen View All button |
| 24 | 2026-02-25 | UserManagement button centering; clinic permissions fixed; campaign roles restricted |
| 25 | 2026-02-25 | SQL cleanup (database_structure/); Memory Bank + docs updated; TS module fix |

---

## 15. Known Issues / TODOs

- 🔴 **Action required**: Run `FIX_CLINIC_RLS_POLICIES.sql` in Supabase to enable clinic verify/approve
- 🟡 Push notifications require Expo account + EAS build (edge function already in place)
- 🟡 Offline sync service built but not fully wired to all forms
- 🟢 AllAlertsScreen TS2307 — resolved by named export; restart TS server in VS Code if still shown
