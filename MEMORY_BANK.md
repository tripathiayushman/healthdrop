# 🏥 HealthDrop Surveillance System — Memory Bank

> **Single source of truth for the current state of the codebase.**
> Last updated: 2026-04-09 (Session 47: report submission reliability hardening)

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
- Live map operations (native map tab, clustering, heatmap, cached fallback)
- AI health insights (OpenRouter free models)
- AI recommendation decision support (structured, auditable action proposals)
- District health score analytics (`calculate_health_score`, district score/ranking views)
- Data validation layer (DB constraints + edge validation + RLS compatibility)
- Push notifications (Expo)
- 10 km radius-based alert visibility across eligible roles
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
| Blur | expo-blur (native glass blur on tab bar) |
| Maps | react-native-maps + react-native-map-clustering |
| WebView | react-native-webview (Leaflet map on native) |
| Navigation Bar | expo-navigation-bar (Android immersive mode) |
| AI | OpenRouter Chat Completions API (direct client, env-configured model) |
| Location | expo-location + Nominatim reverse geocoding |
| Theming | Custom ThemeContext (Dark/Light) via AsyncStorage |

---

## 3. File & Directory Map

```
Health-Drop-Surveillance-System-main/
├── index.ts                          ← App entry
├── App.tsx                           ← Root (ThemeProvider, Auth)
├── app.json                          ← Expo config
├── .env                              ← EXPO_PUBLIC_SUPABASE_URL/KEY + EXPO_PUBLIC_OPENROUTER_API_KEY/MODEL
│
├── types/
│   ├── index.ts                      ← ALL TypeScript types
│   └── profile.ts                    ← Lightweight Profile type
│
├── lib/
│   ├── mongo.ts                      ← MongoDB singleton connection helper (`connectMongo`)
│   ├── supabase.ts
│   ├── ThemeContext.tsx
│   └── services/
│       ├── index.ts
│       ├── mongoService.ts
│       ├── diseaseReports.ts
│       ├── waterQuality.ts
│       ├── campaigns.ts
│       ├── users.ts
│       ├── notifications.ts
│       ├── aiAlertsService.ts
│       ├── trendService.ts
│       ├── aiRecommendations.ts
│       ├── mapService.ts
│       ├── offlineQueue.ts
│       ├── reportValidation.ts
│       ├── syncService.ts
│       └── alertRadius.ts
│
├── components/
│   ├── MainApp.tsx                   ← Tab nav + screen router + AIChatbot overlay
│   ├── AuthScreen.tsx                ← Sign in / Sign up / OTP
│   ├── Navbar.tsx
│   ├── Sidebar.tsx
│   │
│   ├── ai/
│   │   ├── AIInsightsPanel.tsx       ← Location-aware OpenRouter insights card
│   │   ├── AIChatbot.tsx             ← Floating FAB + chat panel + recommendation parsing
│   │   ├── AIRecommendationCard.tsx  ← Recommendation card with action controls
│   │   └── AIRecommendationsPanel.tsx← Dashboard recommendation panel (pending/acted)
│   │
│   ├── charts/
│   │   ├── TrendChart.tsx            ← Trend line chart (cases + moving average)
│   │   ├── HealthScoreChart.tsx      ← District health score bar chart
│   │   └── CampaignChart.tsx         ← Campaign performance bar chart
│   │
│   ├── common/
│   │   ├── QuickActions.tsx          ← Floating role-aware quick action menu
│   │   └── OfflineBanner.tsx         ← Connectivity + pending sync status banner
│   │
│   ├── dashboards/
│   │   ├── DashboardShared.tsx       ← Shared + PersonalizedDashboardLayout + data widgets
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
│       ├── MapDashboard.tsx      ← Native map tab (cluster/heatmap/offline cache fallback)
│       ├── DistrictRankingScreen.tsx ← District health ranking view
│       ├── CampaignAnalytics.tsx     ← Campaign effectiveness deep-dive
│       ├── TraceabilityScreen.tsx    ← Report-outbreak-campaign-alert linkage view
│       ├── EscalationScreen.tsx      ← Pending/overdue escalation monitor
│       ├── TrendAnalysisScreen.tsx   ← Trend analytics screen (district/disease/time-series)
│       ├── OutbreakWarningsScreen.tsx← Rising/anomaly outbreak warning triage screen
│       ├── ReportsScreen.tsx         ← Role-aware filters, stacked status badges
│       ├── CampaignsScreen.tsx       ← Campaign list + enroll; create/manage: super_admin+health_admin+DO+ASHA
│       ├── AdminManagementScreen.tsx ← Legacy admin screen
│       ├── ApprovalQueueScreen.tsx   ← Verify/Approve/Reject (admin+clinic); Delete (admin only)
│       ├── UserManagementScreen.tsx  ← User role management (super_admin only)
│       ├── ProfileScreen.tsx
│       ├── AllAlertsScreen.tsx       ← Full alert list + 10 km radius visibility (for field roles)
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

### Hybrid Database Architecture (NEW)

The system now uses a dual-database architecture:

#### Primary Database
- Supabase PostgreSQL
- Handles all core system data with RLS and constraints

#### Secondary Database
- MongoDB (`healthdrop_nosql`)
- Handles flexible, high-volume, and non-relational data

Collections introduced:
- `ai_insights`
- `audit_logs`
- `notifications_stream`

---

### Reason for Adoption

- Avoid schema rigidity for AI-generated data
- Reduce load on PostgreSQL from logging systems
- Improve scalability for real-time features
- Enable future AI-driven features without schema migrations

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
| client_generated_id | uuid | offline sync dedup key (unique) |
| last_updated_at | timestamp | conflict resolution for sync |
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
| client_generated_id | uuid | offline sync dedup key (unique) |
| last_updated_at | timestamp | conflict resolution for sync |
| created_at | timestamptz | |

### Data Validation Layer (Report Integrity)

Applied integrity rules for report ingestion:

- Disease reports:
  - `cases_count > 0`
  - `deaths_count <= cases_count`
  - `latitude BETWEEN -90 AND 90`
  - `longitude BETWEEN -180 AND 180`
- Water quality reports:
  - `latitude BETWEEN -90 AND 90`
  - `longitude BETWEEN -180 AND 180`

Server-side edge validation (`validate-report`) enforces the same business checks plus duplicate detection within a rolling 10-minute window before insert.

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
| created_bucket | bigint | 10-minute dedupe bucket (`floor(epoch(created_at)/600)`) |
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

### `ai_recommendations`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | default `gen_random_uuid()` |
| type | text | `alert` / `campaign` / `escalation` |
| reference_id | uuid | disease_report_id or outbreak_id reference |
| outbreak_id | uuid | optional outbreak link |
| district | text | district-scoped access key |
| severity | text | mapped for action severity/urgency |
| title, description | text | recommendation summary |
| recommendation_data | jsonb | structured action payload |
| status | text | `pending` / `accepted` / `rejected` / `auto_executed` |
| model_used | text | model identifier for explainability |
| confidence_score | float | recommendation confidence |
| created_at | timestamp | default `now()` |
| acted_at | timestamp | action time |
| acted_by | uuid | actor user id |

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
- AI recommendations RLS:
  - district-scoped SELECT policy (`view recommendations by district`)
  - action UPDATE policy (`act on recommendations`)

---

## 8. PostgreSQL Triggers

| Trigger | Table | Function | Behaviour |
|---|---|---|---|
| `set_reporter_id` | disease_reports | `auto_approve_reporter_id_report()` | Sets reporter_id = auth.uid(); auto-approves for admin/DO |
| `set_created_by_water` | water_quality_reports | `auto_approve_created_by_report()` | Sets reporter_id; auto-approves for admin/DO |
| `set_organizer_id` | health_campaigns | `auto_approve_organizer_id_report()` | Sets organizer_id; auto-approves for admin/DO |
| `set_alert_created_by` | health_alerts | `auto_approve_alert_fn()` | Sets created_by; auto-approves for admin |
| `trg_set_alert_created_bucket` | health_alerts | `set_alert_created_bucket()` | Sets `created_bucket` from `created_at` for dedupe uniqueness |
| `trg_ai_recommendation_action` | ai_recommendations | `handle_ai_recommendation()` | Executes accepted recommendation actions (initially alert creation path) |

---

## 9. App Navigation & Screens

### ScreenType Union (MainApp.tsx)
```ts
type ScreenType = 'tabs' | 'new-disease-report' | 'new-water-report' |
  'new-campaign' | 'new-alert' | 'admin-management' | 'user-management' |
  'approval-queue' | 'all-alerts' | 'district-ranking' |
  'campaign-analytics' | 'traceability' | 'escalation-monitor' |
  'trend-analysis' | 'outbreak-warnings';
```

### Tab Bar (all roles)
1. **Home** → DashboardRouter (role-specific dashboard)
2. **Map** → MapDashboard
3. **Reports** → ReportsScreen
4. **Campaigns** → CampaignsScreen
5. **Profile** → ProfileScreen

App shell overlays in `MainApp.tsx`:
- `QuickActions` floating FAB is shown for non-Profile tabs.
- `OfflineBanner` surfaces offline/pending-sync status above tab bar.
- AI chatbot FAB remains mounted with offset handling to avoid overlap.

### Full-screen overlays (navigateToForm)
- `new-disease-report` → DiseaseReportForm
- `new-water-report` → WaterQualityReportForm
- `new-campaign` → CampaignForm
- `new-alert` → AlertForm
- `admin-management` → AdminManagementScreen (tab: initialTab param)
- `user-management` → UserManagementScreen
- `approval-queue[:tab]` → ApprovalQueueScreen (deep-link tab)
- `all-alerts` → AllAlertsScreen
- `district-ranking` → DistrictRankingScreen
- `campaign-analytics` → CampaignAnalytics
- `traceability` → TraceabilityScreen
- `escalation-monitor` → EscalationScreen
- `trend-analysis` → TrendAnalysisScreen
- `outbreak-warnings` → OutbreakWarningsScreen

### AllAlertsScreen Features
- Search bar + urgency filter chips (All/Critical/High/Medium/Low)
- Pull-to-refresh
- Left-border color coded by urgency
- Tap to open detail modal
- Field roles (district_officer/clinic/asha_worker/volunteer) see alerts within 10 km radius

### ApprovalQueueScreen
- Tabs: Disease | Water | Campaigns | Alerts (clinic sees all 4; DO sees disease/water/campaigns)
- Verify/Unverify: super_admin + health_admin + district_officer + clinic (disease/water only)
- Approve/Reject with reason: super_admin + health_admin + district_officer + clinic
- Delete: super_admin + health_admin only
- Campaign manage (cancel/complete): super_admin + health_admin + district_officer only (NOT clinic)

### ReportsScreen
- Role-aware status filter chips (volunteer: reported/verified only; super_admin+health_admin+district_officer+clinic: + approval filters)
- Card footer: status badge stacked above approval badge, date pinned right
- Modal shows approval_status + rejection_reason to reporters and authorized reviewers

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
| AshaWorkerDashboard | asha_worker | Disease Report, Water Report, Campaign Proposal | Own submissions list |
| VolunteerDashboard | volunteer | Campaigns, Alerts, AI Insights | Enrolled campaigns |

All dashboard variants include the AI recommendations panel to surface district-relevant pending actions.

Dashboard personalization (Session 41):
- `PersonalizedDashboardLayout` enables drag reorder, collapse/expand, and widget visibility toggles.
- Layout is persisted per role/user key: `healthdrop_widget_layout_v1_${profile.role}_${profile.id}`.
- Widget-registry composition is implemented in:
  - `SuperAdminDashboard`
  - `HealthAdminDashboard`
  - `DistrictOfficerDashboard`
- New shared data widgets:
  - `HealthScoreWidget`
  - `CampaignPerformanceWidget`
  - `TrendInsightsWidget`

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
| Alert | AlertForm.tsx | Role-aware creation (super_admin/health_admin/district_officer) + radius-based push recipients |

---

## 12. Services Layer

| Service | File | Key Functions |
|---|---|---|
| Disease Reports | diseaseReports.ts | CRUD, stats, filter by severity/status/district/date |
| Water Quality | waterQuality.ts | CRUD, stats, filter |
| Campaigns | campaigns.ts | CRUD, enroll, withdraw |
| Campaign Analytics | campaignService.ts | fetchCampaignEffectiveness, fetchCampaignPerformanceSummary |
| Users | users.ts | list, changeRole, deactivate |
| Notifications | notifications.ts | list, targeted send, role/severity filtering |
| Mongo Support | mongoService.ts | saveAIInsight, logAuditEvent, pushNotification, healthCheckMongoCollections |
| AI Alerts | aiAlertsService.ts | fetchAIAlerts, updateAlertStatus, acceptAIAlert, dismissAIAlert |
| Trends and Warnings | trendService.ts | fetchTrends, fetchOutbreakWarnings |
| AI Recommendations | aiRecommendations.ts | fetchRecommendations, createRecommendation, updateRecommendationStatus |
| Map | mapService.ts | fetchMapData, getCachedMapData, clearMapCache |
| Health Score | healthScoreService.ts | fetchHealthScores, fetchHealthRanking, fetchHighRiskDistricts |
| Escalation | escalationService.ts | fetchEscalationAlerts, fetchEscalationSummary |
| Traceability | traceabilityService.ts | fetchTraceabilityRecords, getTraceabilityByReportId |
| Offline Queue | offlineQueue.ts | addToQueue, getQueue, markQueueItemFailed, resetQueueItemForRetry |
| Sync | syncService.ts | syncOfflineReports, retryFailedQueueItem |
| Validation | reportValidation.ts | validateReportPayload, assertReportValidation, isReportValidationError |
| Alert Radius | alertRadius.ts | filterAlertsForProfile, shouldReceiveAlert, distance-scoped eligibility |

---

## 13. SQL Files (database_structure/)

| File | Purpose | Status |
|---|---|---|
| `DATABASE_SCHEMA.sql` | Full schema definition | ✅ Current |
| `APPROVAL_SYSTEM.sql` | Core approval workflow policies | ✅ Current |
| `ALERT_APPROVAL_WORKFLOW.sql` | Health alerts approval policies + trigger | ✅ Current |
| `ALERT_DEDUPLICATION_SYSTEM.sql` | 10-minute alert dedup via bucket + unique index + insert trigger | ✅ Applied |
| `AI_RECOMMENDATION_DECISION_LAYER` (ad-hoc) | `ai_recommendations` schema + indexes + RLS + trigger-based execution | ✅ Applied |
| `DATA_VALIDATION_LAYER` (ad-hoc) | disease/water cleanup + CHECK constraints + edge validation contract | ✅ Applied |
| `GEO_BACKFILL_FINAL_VERIFIED` (ad-hoc) | backfill `location_geo` for disease/water reports + null-count verification queries | ✅ Applied |
| `DISTRICT_HEALTH_SCORE_NUMERIC` (ad-hoc) | `calculate_health_score` + `vw_district_health_score` + `vw_district_health_ranking` | ✅ Applied |
| `AUDIT_LOG.sql` | audit_logs table + triggers | ✅ Current |
| `DISTRICT_OFFICER_RLS.sql` | Complete district_officer RLS | ✅ Current |
| `ENUM_MIGRATION.sql` | Role enum updates | ✅ Applied |
| `FIX_CLINIC_RLS_POLICIES.sql` | Clinic UPDATE (disease/water); removes clinic from campaigns | ✅ Needs applying |
| `FIX_PROFILES_RLS_RECURSION.sql` | SECURITY DEFINER helpers | ✅ Current |
| `FIX_REPORT_SUBMISSION_RLS.sql` | Fixes stale trigger + idempotent policies | ✅ Current |
| `FIX_VERIFICATION_AND_VISIBILITY.sql` | Visibility + verify update policies | ✅ Needs applying |
| `GEOGRAPHIC_HEATMAP.sql` | Materialized view for heatmap analytics | ✅ Optional |
| `OFFLINE_SYNC_SCHEMA.sql` | Client-generated sync identifiers + conflict-resolution columns for offline sync | ✅ Current |
| `OUTBREAK_DETECTION.sql` | Outbreak detection function | ✅ Optional |
| `PERFORMANCE_INDEXES.sql` | 20+ query optimization indexes | ✅ Current |
| `PUSH_NOTIFICATIONS.sql` | expo_push_token column + edge function schema | ✅ Current |
| `USER_FEEDBACK_TABLE.sql` | user_feedback table definition | ✅ Current |

### Ad-hoc SQL Applied (2026-03-31)
- **AI Recommendation Decision Layer** documented and tracked.
- Added table `ai_recommendations` with structured JSONB payload support (`recommendation_data`).
- Added indexes:
  - `idx_ai_reco_status`
  - `idx_ai_reco_district`
  - `idx_ai_reco_type`
- Added RLS policies:
  - `view recommendations by district`
  - `act on recommendations`
- Added trigger function `handle_ai_recommendation()` and trigger `trg_ai_recommendation_action` for accepted recommendation execution.

### Ad-hoc SQL Applied (2026-03-31)
- **Data Validation Layer (Backend Integrity System)** documented and tracked.
- Development cleanup executed for invalid rows before enforcing constraints.
- Added `disease_reports` constraints:
  - `valid_cases` (`cases_count > 0`)
  - `valid_deaths` (`deaths_count <= cases_count`)
  - `valid_latitude` / `valid_longitude`
- Added `water_quality_reports` coordinate constraints:
  - `valid_water_lat` / `valid_water_lng`
- Edge validation contract documented for `validate-report`:
  - coordinate bounds checks
  - case/death consistency checks
  - 10-minute duplicate detection
- Production migration note captured: `NOT VALID` + `VALIDATE CONSTRAINT` rollout pattern.

### Ad-hoc SQL Applied (2026-03-31)
- **GEO Backfill (Final Verified Version)** documented and tracked.
- Backfilled missing geometry for report tables using:
  - `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`
- Applied to:
  - `disease_reports.location_geo`
  - `water_quality_reports.location_geo`
- Added post-migration verification targets:
  - `disease_missing_geo = 0`
  - `water_missing_geo = 0`
- Added safety note:
  - skip `health_alerts` geo update unless both `latitude` and `longitude` columns exist.

### Ad-hoc SQL Applied (2026-03-30)
- **Client Generated ID Migration (Final Fix, RLS-safe)** executed directly in Supabase SQL Editor.
- Rebuilt `client_generated_id` columns for `disease_reports` and `water_quality_reports` using `gen_random_uuid()`.
- Enforced `NOT NULL` and added unique indexes:
  - `idx_disease_client_id`
  - `idx_water_client_id`
- Added `last_updated_at` (`TIMESTAMP DEFAULT NOW()`) to both report tables for sync conflict resolution.
- Verification query result target documented: `disease_remaining_nulls = 0`, `water_remaining_nulls = 0`.
- **Alert Deduplication System (Production)** added and versioned as `database_structure/ALERT_DEDUPLICATION_SYSTEM.sql`.
- Added `health_alerts.created_bucket` (10-minute epoch bucket) and backfilled existing rows.
- Enforced unique dedup index `idx_alert_dedup_unique` on `(district, urgency_level, created_bucket)`.
- Added insert trigger `trg_set_alert_created_bucket` to auto-compute buckets for all future alerts.

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
| 26 | 2026-02-25 | UI Polish v1: map bug fixes (campaigns display, alert GPS coords, header overlap), dark theme overhaul (black bg, glassmorphism rgba cards, teal primary), gradient headers on CampaignsScreen & ReportsScreen, location prompt → centered Modal popup with gradient button, glass navbar (rgba 0.72), StatCard LinearGradient overlay |
| 27 | 2026-02-26 | UI Polish v2: 'Alerts & Map' section heading, glass blur 16px on cards, AI panel glass fixed, FAB red #EF4444, Chat History 4 |
| 28 | 2026-03-26 | **Mobile UX overhaul**: (1) Swipe-to-switch-tabs fixed (stale closure via activeTabRef), (2) Leaflet map on native via react-native-webview WebView, (3) Map layout responsive (vertical on mobile), (4) Chip/button sizes increased for mobile, (5) Glass blur tab bar via expo-blur BlurView, (6) StatusBar hidden + Android nav bar via expo-navigation-bar, (7) Quick action card widths flex %, (8) Alert/campaign markers fixed on map (removed default-coord filter, fixed fetch guard) |
| 29 | 2026-03-26 | **Regression stabilization**: (1) `ReportsScreen` role checks migrated from legacy `admin` to `health_admin`, (2) expanded map now renders at full height on mobile/web modal view, (3) web geolocation now guarded for unsupported browsers, (4) AI chatbot FAB shown on all non-profile tabs, (5) MainApp unused import cleanup, (6) TypeScript validation passed (`npx tsc --noEmit`) |
| 30 | 2026-03-27 | **CodeRabbit remediation + production hardening**: theme/token cleanup, typed queue/detail models, accessibility labels for icon-only controls, safe date/error handling, web modal blur typing fixes, campaign/report loading-state UX, map typing and web alert fallback modal, AI chat cleanup (imports/animations/logging), OpenRouter server-proxy flow (`supabase/functions/openrouter-proxy`), release pipelines (`prepare-release.yml`, `build-android-release.yml`), EAS config and version sync script |
| 31 | 2026-03-30 | **Documentation + behavior alignment update**: implemented shared radius helper (`lib/services/alertRadius.ts`), switched alert visibility from strict district equality to 10 km distance filtering, aligned alert push recipients to same radius rule, updated AI insights context/mapping and map filtering, and refreshed primary docs (`README.md`, `COMPREHENSIVE_DOCUMENTATION.md`, setup/user guides). |
| 32 | 2026-03-30 | **Database migration (manual SQL run)**: applied Client Generated ID Migration Final Fix for `disease_reports` and `water_quality_reports`, recreated `client_generated_id` as UUID with `gen_random_uuid()`, added unique indexes for dedupe, and introduced `last_updated_at` timestamps for conflict resolution. |
| 33 | 2026-03-30 | **Offline-first sync + alert dedup rollout**: wired disease/water forms to offline-first service flow (queue, reconnect sync, retry backoff, idempotent upsert, timestamp conflict checks), added `database_structure/ALERT_DEDUPLICATION_SYSTEM.sql`, and synchronized all major docs with production dedup behavior. |
| 34 | 2026-03-31 | **AI recommendation decision layer documentation update**: added `ai_recommendations` schema, district/action RLS policy notes, auto-execution trigger flow, lifecycle statuses, and setup/migration guidance across documentation files. |
| 35 | 2026-03-31 | **AI recommendation frontend integration**: added typed recommendation models, recommendation service layer, reusable recommendation UI components, dashboard embedding across all roles, chatbot recommendation parsing/persistence flow, and validation/doc synchronization (`README`, comprehensive docs, setup guide, session history). |
| 36 | 2026-03-31 | **Data Validation Layer (Backend Integrity System)**: documented report cleanup prerequisites, disease/water CHECK constraints, edge validation (`validate-report`) business rules, duplicate window control, and production-safe constraint rollout guidance across all major docs. |
| 37 | 2026-03-31 | **GEO Backfill (Final Verified Version)**: documented geometry backfill SQL for disease/water reports, null-count verification queries, and the `health_alerts` coordinate-column safety condition across major documentation files. |
| 38 | 2026-03-31 | **Live Map + District Health Score docs sync**: documented native `MapDashboard` integration (`MainApp` tab route + `mapService` cache/filter flow) and added flexible numeric district scoring artifacts (`calculate_health_score`, `vw_district_health_score`, `vw_district_health_ranking`) across primary docs. |
| 39 | 2026-04-01 | **Supabase backend completion docs sync**: consolidated final backend status (validation, geospatial, dedup, notifications targeting, AI recommendations, district score, campaign effectiveness, escalation, traceability), repaired malformed `SETUP_GUIDE.md`, and added final completion snapshot in primary docs. |
| 40 | 2026-04-01 | **Predictive frontend + AI alerts verification docs sync**: validated trend/warning services, AI alert triage acceptance flow, MainApp predictive routes, dashboard AI outbreak section integration, MapDashboard anomaly/rising overlays, and recorded clean TypeScript verification (`EXIT:0`) across docs. |
| 41 | 2026-04-01 | **Dashboard personalization + UX integration docs sync**: implemented persisted widget personalization (drag/collapse/visibility) for super/health/district dashboards, added chart widgets (`TrendChart`, `HealthScoreChart`, `CampaignChart`), integrated global `QuickActions` FAB and `OfflineBanner` into `MainApp`, and recorded clean compile + web/android export verification. |
| 42 | 2026-04-01 | **Operational integration + all-docs sync**: documented operational screens (`DistrictRankingScreen`, `CampaignAnalytics`, `Traceability`, `Escalation`, `MapDashboard` web/native), AI recommendation UI/service integration, offline queue/validation/sync reliability stack, release automation assets (`prepare-release.yml`, `build-android-release.yml`, `eas.json`, `sync-version.cjs`), and optional OpenRouter proxy function; completed full docs refresh and commit preparation. |
| 43 | 2026-04-08 | **Production stabilization + Supabase alignment**: centralized global create menu in `MainApp`, removed duplicate Reports/Campaigns FABs, enforced role-gated create routing, extended offline queue/sync to campaign + alert, aligned feedback sync target to `user_feedback`, refactored disease/water forms to service-layer offline-first create, and hardened map expansion by preventing dual map rendering. |
| 44 | 2026-04-09 | **MongoDB NoSQL architecture documentation update**: introduced hybrid PostgreSQL+MongoDB documentation model, defined MongoDB collection scope (`ai_insights`, `audit_logs`, `notifications_stream`), and documented strict SQL/NoSQL separation guidelines for future implementation. |
| 45 | 2026-04-09 | **MongoDB service-layer implementation**: added `lib/mongo.ts` singleton connector + `lib/services/mongoService.ts`; integrated non-blocking AI insight persistence in `gemini.ts`, optional notification stream mirror in `notifications.ts`, optional audit hooks in `users.ts`/`notifications.ts`, and exported Mongo service APIs through `lib/services/index.ts`. |
| 46 | 2026-04-09 | **MongoDB runtime health-check + docs synchronization**: added read-only `healthCheckMongoCollections(...)` in `lib/services/mongoService.ts`, exported it via `lib/services/index.ts`, and updated documentation to reflect implemented Mongo integration and runtime connectivity verification support. |
| 47 | 2026-04-09 | **Report submission reliability hardening**: improved disease/water create services with legacy-schema fallback (`upsert` to `insert` when idempotency column/index is unavailable), improved online detection tolerance, and normalized RLS/trigger errors to actionable messages referencing `database_structure/FIX_REPORT_SUBMISSION_RLS.sql`; form handlers now preserve exact backend error text. |

### Session XX - MongoDB Integration (NoSQL Layer)

- Introduced MongoDB as a secondary data layer
- Created database: `healthdrop_nosql`
- Created collections:
  - `ai_insights`
  - `audit_logs`
  - `notifications_stream`
- Defined hybrid architecture (SQL + NoSQL separation)
- No changes made to existing PostgreSQL schema
- Prepared system for future AI and real-time scalability

---

## 15. Known Issues / TODOs

- 🔴 **Action required**: Run `FIX_CLINIC_RLS_POLICIES.sql` in Supabase to enable clinic verify/approve
- 🔴 **Action required**: Run `FIX_VERIFICATION_AND_VISIBILITY.sql` in Supabase
- 🟡 If report submission still fails with permission/trigger errors, run `FIX_REPORT_SUBMISSION_RLS.sql` in Supabase SQL Editor
- 🟡 Push notifications require Expo account + EAS build (edge function already in place)
- 🟢 Offline sync now covers disease, water, campaign, and alert submissions via queue + reconnect sync
- 🟢 AllAlertsScreen TS2307 — resolved by named export; restart TS server in VS Code if still shown
- 🟢 Glass blur now works on native via `expo-blur` BlurView; web uses CSS `backdropFilter`
- 🟢 Maps now render on native via `react-native-webview`; web uses `<iframe>` with `srcDoc`
- 🟢 StatusBar + Android nav bar hidden for immersive experience via `expo-navigation-bar`
- 🟢 Legacy `admin` string checks removed from `ReportsScreen`; role gating now aligns with `health_admin`
- 🟢 Release automation now documented and wired: manual Prepare Release creates tag; tag triggers Android APK build + GitHub release
- 🟡 External setup still required for CI/CD + OpenRouter API key provisioning (see README external checklist)
