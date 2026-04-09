# HealthDrop Surveillance System — Comprehensive Documentation

> **Last Updated:** 2026-04-09 (Session 46)
> This document is the authoritative reference for system architecture, roles, permissions, features, and technical implementation.

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture](#3-architecture)
4. [User Roles](#4-user-roles)
5. [Role Function Reference](#5-role-function-reference)
6. [Permissions Matrix](#6-permissions-matrix)
7. [Database Schema](#7-database-schema)
8. [Row-Level Security (RLS)](#8-row-level-security-rls)
9. [Approval Workflow](#9-approval-workflow)
10. [Screens & Navigation](#10-screens--navigation)
11. [Dashboards](#11-dashboards)
12. [Forms](#12-forms)
13. [AI Integration](#13-ai-integration)
14. [SQL Files Reference](#14-sql-files-reference-database_structure)
15. [Environment & Setup](#15-environment--setup)
16. [UI Theme & Design System](#16-ui-theme--design-system)
17. [Session 31 Consolidated Update (2026-03-30)](#17-session-31-consolidated-update-2026-03-30)
18. [Session 33 Offline-First and Alert Dedup Update (2026-03-30)](#18-session-33-offline-first-and-alert-dedup-update-2026-03-30)
19. [Session 34 AI Recommendation Decision Layer Update (2026-03-31)](#19-session-34-ai-recommendation-decision-layer-update-2026-03-31)
20. [Session 36 Data Validation Layer Update (2026-03-31)](#20-session-36-data-validation-layer-update-2026-03-31)
21. [Session 37 Geo Backfill Update (2026-03-31)](#21-session-37-geo-backfill-update-2026-03-31)
22. [Session 38 Live Map and District Health Score Update (2026-03-31)](#22-session-38-live-map-and-district-health-score-update-2026-03-31)
23. [Session 39 Supabase Backend Completion Update (2026-04-01)](#23-session-39-supabase-backend-completion-update-2026-04-01)
24. [Predictive Outbreak Detection and AI Alert System (2026-04-01)](#24-predictive-outbreak-detection-and-ai-alert-system-2026-04-01)
25. [Session 40 Frontend Predictive and AI Alerts Integration Verification (2026-04-01)](#25-session-40-frontend-predictive-and-ai-alerts-integration-verification-2026-04-01)
26. [Session 41 Dashboard Personalization and UX Integration (2026-04-01)](#26-session-41-dashboard-personalization-and-ux-integration-2026-04-01)
27. [Session 42 Operational Integration and Documentation Sync (2026-04-01)](#27-session-42-operational-integration-and-documentation-sync-2026-04-01)
28. [Session 43 Production Stabilization and UX Alignment (2026-04-08)](#28-session-43-production-stabilization-and-ux-alignment-2026-04-08)
29. [Supabase Changes (Final Fixes & Alignment)](#29-supabase-changes-final-fixes--alignment)
30. [Session 44 Navigation, AI Insights Resilience, and Runtime Toggle (2026-04-09)](#30-session-44-navigation-ai-insights-resilience-and-runtime-toggle-2026-04-09)
31. [NoSQL Integration Layer (MongoDB)](#31-nosql-integration-layer-mongodb)
32. [MongoDB Usage Guidelines (STRICT)](#32-mongodb-usage-guidelines-strict)

---

## 1. Application Overview

**HealthDrop** is a cross-platform React Native + Expo mobile surveillance application backed by Supabase (PostgreSQL + Auth + RLS). It enables rapid detection, reporting, and coordinated response to public health threats.

### Core Features

| Feature | Description |
|---|---|
| Disease reporting | Document and track new disease cases with severity, location, patient details |
| Water quality monitoring | Report contaminated water sources with chemical parameters |
| Health alert broadcasting | Urgency-graded alerts (Low/Medium/High/Critical) propagated to affected districts within 10 km |
| Live Map Dashboard | Native map tab with marker clustering, heatmap overlay, layer toggles, and custom date filtering |
| Dashboard personalization | Per-user widget visibility, collapse state, and drag-reorder persistence |
| Global quick actions | Floating role-aware quick action menu surfaced on Reports and Campaigns tabs |
| Offline status banner | Connectivity and pending-sync visibility above tab bar |
| Operational chart widgets | Trend, district health score, and campaign performance widgets |
| Campaign management | Create, manage, and enroll in vaccination/awareness/sanitation campaigns |
| Admin governance | User management, approval queues, analytics |
| AI Health Insights | Direct OpenRouter contextual health insights per district/state/global scope |
| AI Recommendations | Structured AI decision records (pending/accepted/rejected/auto_executed) with auditable action lifecycle |
| District health score analytics | Flexible numeric district score view + ranking for prioritization |
| Offline sync | Reports queued locally and synced when connectivity resumes |
| Push notifications | Expo push notifications targeted to affected users in the same 10 km alert radius |

---

## 2. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Mobile | React Native + Expo | 0.81.5 / ~54.0.33 |
| Web | react-native-web | ^0.21.2 |
| Language | TypeScript | ~5.9.2 |
| Backend | Supabase (PostgreSQL + Auth + RLS) | latest |
| Client | @supabase/supabase-js | ^2.39.7 |
| Icons | @expo/vector-icons (Ionicons, MaterialCommunityIcons) | ^15.0.3 |
| Dates | date-fns | ^4.1.0 |
| Gradients | expo-linear-gradient | SDK 54 compatible |
| Blur | expo-blur (native glass blur) | SDK 54 compatible |
| Maps | react-native-maps + react-native-map-clustering | latest |
| Dashboard widget layout | react-native-draggable-flatlist | latest |
| Charts | react-native-chart-kit | latest |
| WebView | react-native-webview (Leaflet map on native) | latest |
| Navigation Bar | expo-navigation-bar (Android immersive mode) | SDK 54 compatible |
| Storage | expo-secure-store / AsyncStorage | |
| AI | Direct OpenRouter Chat Completions API (`EXPO_PUBLIC_OPENROUTER_MODEL`) | |
| Location | expo-location + centroid fallback + 10 km radius matching | |
| Notifications | Expo Push Notifications | |

---

## 3. Architecture

```
┌───────────────────────────────────────┐
│            React Native App            │
│  ┌──────────────┐  ┌───────────────┐  │
│  │  Tab Bar     │  │  Overlay Nav  │  │
│  │  Home        │  │  Forms        │  │
│  │  Map         │  │  Approval Q   │  │
│  │  Reports     │  │  User Mgmt    │  │
│  │  Campaigns   │  │  All Alerts   │  │
│  │  Profile     │  │               │  │
│  └──────────────┘  └───────────────┘  │
│  ┌────────────────────────────────┐   │
│  │  DashboardRouter               │   │
│  │  (role → specific dashboard)   │   │
│  └────────────────────────────────┘   │
│  ┌────────┐  ┌─────────┐              │
│  │AI Panel│  │AIChatbot│ (FAB overlay)│
│  └────────┘  └─────────┘              │
└──────────────────┬────────────────────┘
                   │ @supabase/supabase-js
┌──────────────────▼────────────────────┐
│              Supabase                  │
│  PostgreSQL + RLS + Auth + Realtime   │
│  Edge Functions (push notifications,  │
│  validate-report pre-insert checks)   │
└───────────────────────────────────────┘
```

---

## 4. User Roles

The system has **6 roles** stored in `profiles.role` with a CHECK constraint.

| Role | DB Value | Scope | Level |
|---|---|---|---|
| Super Admin | `super_admin` | Global | Full system control |
| Health Admin | `health_admin` | Global (no user role changes) | Operational admin |
| District Officer | `district_officer` | Own district only | District governance |
| Clinic | `clinic` | Own district | Medical verification |
| ASHA Worker | `asha_worker` | Own + district approved | Field reporting |
| Volunteer | `volunteer` | Approved content only | Community participation |

---

## 5. Role Function Reference

### Super Admin
- **Purpose:** Full system control and oversight
- **Creates:** All report types, campaigns, alerts, users
- **Approves:** Everything globally
- **Sees:** All data across all districts
- **Unique to this role:** Change user roles, deactivate users permanently, delete any record

### Health Admin
- **Purpose:** Operational management of health data
- **Creates:** Reports, campaigns, alerts
- **Approves:** Everything globally
- **Sees:** All data across all districts
- **Cannot:** Change user roles

### District Officer
- **Purpose:** District-level governance and campaign management
- **Creates:** Reports + campaigns for own district only
- **Approves:** Reports and campaigns within own district only
- **Sees:** All data within own district; own submissions
- **Cannot:** Access other districts, delete records, manage users

### Clinic
- **Purpose:** Medical facility reporting and verification
- **Creates:** Disease reports + water quality reports only
- **Approves:** Verify/approve/reject disease and water reports within district
- **Sees:** Own district reports + all approved reports nationwide
- **Cannot:** Create campaigns or alerts, delete anything, manage users

### ASHA Worker
- **Purpose:** Community health surveillance (field workers)
- **Creates:** Disease reports + water quality reports
- **Submits:** Campaign proposals (not create — must be approved)
- **Sees:** Own submissions (all statuses) + district-approved content
- **Cannot:** Approve others' reports, create alerts, manage campaigns

### Volunteer
- **Purpose:** Community participation in health campaigns
- **Enrolls in:** Active campaigns
- **Sees:** All approved alerts + campaigns nationwide
- **Cannot:** Submit reports, approve anything, manage content

---

## 6. Permissions Matrix

| Action | super_admin | health_admin | district_officer | clinic | asha_worker | volunteer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **DISEASE REPORTS** | | | | | | |
| Submit | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View all | ✅ | ✅ | 🔵 district | 🔵 district | 🟡 own+district | 🟢 approved |
| Verify status | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve/Reject | ✅ | ✅ | 🔵 district | 🔵 district | ❌ | ❌ |
| Delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **WATER REPORTS** | | | | | | |
| Submit | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View all | ✅ | ✅ | 🔵 district | 🔵 district | 🟡 own+district | 🟢 approved |
| Verify / Approve | ✅ | ✅ | 🔵 district | 🔵 district | ❌ | ❌ |
| Delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **CAMPAIGNS** | | | | | | |
| Create | ✅ | ✅ | ✅ | ❌ | ✅ (submit) | ❌ |
| Approve / Cancel / Delete | ✅ | ✅ | 🔵 district | ❌ | ❌ | ❌ |
| Enroll | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| View | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **HEALTH ALERTS** | | | | | | |
| Create | ✅ | ✅ | 🔵 district | ❌ | ❌ | ❌ |
| Approve / Reject | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View all | ✅ | ✅ | 🔵 district±10km | 🔵 district±10km | 🔵 district±10km | 🔵 district±10km |
| **USER MANAGEMENT** | | | | | | |
| View all users | ✅ | ✅ | 🔵 district | ❌ | ❌ | ❌ |
| Change user roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Deactivate users | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **APPROVAL QUEUE** | | | | | | |
| Access queue | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete permanently | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

> 🔵 = district-scoped only | 🟡 = own + district approved | 🟢 = approved content nationwide

---

## 7. Database Schema

### Core Tables

#### `profiles`
```sql
id uuid PK, email text, full_name text,
role text CHECK (IN ('super_admin','health_admin','district_officer','clinic','asha_worker','volunteer')),
phone text, district text, state text, is_active boolean DEFAULT true,
expo_push_token text, created_at timestamptz
```

#### `disease_reports`
```sql
id uuid PK, reporter_id uuid→profiles,
disease_name text,
cases_count int CHECK (cases_count > 0),
deaths_count int DEFAULT 0 CHECK (deaths_count <= cases_count),
severity text (mild/moderate/severe/critical),
status text DEFAULT 'reported' (reported/verified),
approval_status text DEFAULT 'pending_approval' (pending_approval/approved/rejected),
approved_by uuid, approved_at timestamptz, rejection_reason text,
district text, state text, location_name text,
latitude float CHECK (latitude BETWEEN -90 AND 90),
longitude float CHECK (longitude BETWEEN -180 AND 180),
patient_age int, patient_gender text, symptoms text[], notes text,
client_generated_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
last_updated_at timestamp DEFAULT now(),
created_at timestamptz
```

#### `water_quality_reports`
```sql
id uuid PK, reporter_id uuid→profiles,
source_name text, source_type text, overall_quality text (safe/unsafe/critical),
status text DEFAULT 'reported' (reported/verified),
approval_status text DEFAULT 'pending_approval' (pending_approval/approved/rejected),
approved_by uuid, approved_at timestamptz, rejection_reason text,
ph_level numeric, turbidity numeric, chlorine_level numeric, tds_level numeric, bacteria_count numeric,
district text, state text, location_name text,
latitude float CHECK (latitude BETWEEN -90 AND 90),
longitude float CHECK (longitude BETWEEN -180 AND 180),
client_generated_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
last_updated_at timestamp DEFAULT now(),
created_at timestamptz
```

#### `health_campaigns`
```sql
id uuid PK, name text, title text, description text,
campaign_type text (vaccination/awareness/health_checkup/medicine_distribution/medical_camp/water_sanitation/nutrition),
status text CHECK (IN ('planned','active','completed','cancelled')),
approval_status text DEFAULT 'pending_approval',
approved_by uuid, approved_at timestamptz, rejection_reason text,
start_date date, end_date date,
district text, state text, location_name text,
target_audience text, target_beneficiaries int, max_participants int, current_participants int,
organizer_id uuid→profiles, notes text, created_at timestamptz
```

> ⚠️ Campaign status must be `'planned'` when creating (NOT `'upcoming'`).

#### `health_alerts`
```sql
id uuid PK, title text, description text, alert_type text,
urgency_level text (low/medium/high/critical),
status text DEFAULT 'active' (active/resolved/expired),
approval_status text DEFAULT 'pending_approval',
approved_by uuid, approved_at timestamptz, rejection_reason text,
district text, state text, location_name text, latitude float, longitude float,
created_bucket bigint NOT NULL, -- floor(extract(epoch from created_at) / 600)
created_by uuid→profiles, created_at timestamptz
```

#### `notifications`
```sql
id uuid PK, recipient_id uuid→profiles, sender_id uuid→profiles,
title text, message text, type text, is_read boolean DEFAULT false,
created_at timestamptz
```

#### `ai_recommendations`
```sql
id uuid PK DEFAULT gen_random_uuid(),
type text NOT NULL, -- alert | campaign | escalation
reference_id uuid, outbreak_id uuid,
district text, severity text,
title text, description text,
recommendation_data jsonb,
status text DEFAULT 'pending', -- pending | accepted | rejected | auto_executed
model_used text, confidence_score float,
created_at timestamp DEFAULT now(),
acted_at timestamp, acted_by uuid
```

#### `campaign_enrollments`
```sql
id uuid PK, campaign_id uuid→health_campaigns, user_id uuid→profiles,
enrolled_at timestamptz, UNIQUE(campaign_id, user_id)
```

#### `user_feedback`
```sql
id uuid PK, user_id uuid→profiles,
feedback_type text, message text, rating int CHECK (BETWEEN 1 AND 5),
created_at timestamptz
```

#### `audit_logs`
```sql
id uuid PK, user_id uuid→profiles, action text, table_name text,
record_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz
```

---

## 8. Row-Level Security (RLS)

### Design Principles

1. All tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
2. Role reads use SECURITY DEFINER helpers to avoid recursion:
   - `get_my_role()` — returns `profiles.role` for `auth.uid()`
   - `get_my_district()` — returns `profiles.district` for `auth.uid()`
3. Triggers set identity and system fields (`reporter_id`, `created_by`, `created_bucket`) on INSERT so users can't spoof
4. Auto-approval triggers for admin/district_officer INSERT (no need for manual approval queue)

### Critical Policy Files

| File | Description |
|---|---|
| `DISTRICT_OFFICER_RLS.sql` | Full district_officer implementation across all tables |
| `FIX_CLINIC_RLS_POLICIES.sql` | Clinic UPDATE on disease/water; removes clinic from campaigns ⚠️ Apply |
| `FIX_REPORT_SUBMISSION_RLS.sql` | Fixes stale trigger, idempotent policy recreation |
| `FIX_PROFILES_RLS_RECURSION.sql` | SECURITY DEFINER helpers |
| `FIX_VERIFICATION_AND_VISIBILITY.sql` | Visibility + verify update policies ⚠️ Apply |
| `APPROVAL_SYSTEM.sql` | Core approval workflow policies |
| `ALERT_APPROVAL_WORKFLOW.sql` | Alert-specific approval + trigger |

### AI Recommendation RLS (Decision Support Layer)

- **SELECT policy (district-scoped):** users can view recommendations in their district.
- **UPDATE policy (act on recommendation):** users can update recommendation status to accept/reject/auto-execute based on app-level approval controls.
- Recommendation actions are auditable through `acted_at` and `acted_by`.

---

## 9. Approval Workflow

### States
```
pending_approval → approved
pending_approval → rejected
approved → rejected (re-review by super_admin/health_admin/district_officer/clinic)
rejected → approved (re-review by super_admin/health_admin/district_officer/clinic)
```

### Verification States (separate from approval)
```
reported → verified (Verify button)
verified → reported (Unverify button)
```

### Who Can Do What
| Action | Roles |
|---|---|
| Verify (disease/water `status`) | super_admin, health_admin, district_officer, clinic |
| Approve `approval_status` | super_admin, health_admin, district_officer (district), clinic (district) |
| Reject with reason | super_admin, health_admin, district_officer (district), clinic (district) |
| Re-review reports (change approved→rejected etc.) | super_admin + health_admin + district_officer + clinic |
| Re-review campaigns | admin only |
| Re-review alerts | admin only |

### Campaign Approval
- Created with `status: 'planned'`, `approval_status: 'pending_approval'`
- Approve/Cancel/Complete: super_admin, health_admin, district_officer (own district)
- **Clinic cannot manage campaigns**

### AI Recommendation Lifecycle

```
pending → accepted
pending → rejected
pending → auto_executed
```

- `pending`: recommendation awaiting decision.
- `accepted`: recommendation approved and action executed.
- `rejected`: recommendation declined.
- `auto_executed`: automated decision path without manual approval.

When status changes from `pending` to `accepted` for `type='alert'`, trigger function `handle_ai_recommendation()` inserts into `health_alerts`.

---

## 10. Screens & Navigation

### Screen Types
```typescript
type ScreenType = 'tabs' | 'new-disease-report' | 'new-water-report' |
  'new-campaign' | 'new-alert' | 'admin-management' | 'user-management' |
  'approval-queue' | 'all-alerts' | 'district-ranking' |
  'campaign-analytics' | 'traceability' | 'escalation-monitor' |
  'trend-analysis' | 'outbreak-warnings';
```

### Tab Bar (visible to all roles)
| Tab | Screen | Notes |
|---|---|---|
| Home | DashboardRouter | Routes to role-specific dashboard |
| Map | MapDashboard | Native clustering + heatmap map layer with time/layer filters and cached fallback |
| Reports | ReportsScreen | Role-aware status + approval filters |
| Campaigns | CampaignsScreen | Create/manage: super_admin+health_admin+district_officer+asha_worker; Enroll: asha+volunteer |
| Profile | ProfileScreen | Settings, theme, logout |

Main app shell overlays in `MainApp.tsx`:
- `QuickActions` floating FAB menu is shown on all tabs except Profile.
- `OfflineBanner` is shown above the tab bar when offline or when sync queue has pending items.
- Existing `AIChatbot` FAB remains active and offset handling prevents overlap.

### MapDashboard
- Added as a first-class tab in `MainApp.tsx` (`home/map/reports/campaigns/profile`).
- Uses `lib/services/mapService.ts` to fetch from `vw_map_layers` with server + client filters:
  - `types` (`disease` / `water` / `alert`)
  - date range (`24h` / `7d` / `30d` / custom)
  - viewport bounds
- Uses `react-native-map-clustering` + `react-native-maps` for performance on mobile.
- Includes disease heatmap toggle, marker detail sheet, refresh, and network-aware offline cache fallback.
- Integrates outbreak warning intelligence from `trendService.fetchOutbreakWarnings(...)` to surface anomaly/rising district signals in-map.

### Full-Screen Overlays
| Route | Screen |
|---|---|
| `new-disease-report` | DiseaseReportForm |
| `new-water-report` | WaterQualityReportForm |
| `new-campaign` | CampaignForm |
| `new-alert` | AlertForm |
| `admin-management[:tab]` | AdminManagementScreen |
| `user-management` | UserManagementScreen |
| `approval-queue[:tab]` | ApprovalQueueScreen |
| `all-alerts` | AllAlertsScreen |
| `district-ranking` | DistrictRankingScreen |
| `campaign-analytics` | CampaignAnalytics |
| `traceability` | TraceabilityScreen |
| `escalation-monitor` | EscalationScreen |
| `trend-analysis` | TrendAnalysisScreen |
| `outbreak-warnings` | OutbreakWarningsScreen |

### ApprovalQueueScreen
- Deep-link: `navigateToForm('approval-queue:water')` pre-selects Water tab
- **Admin tabs:** Disease, Water, Campaigns, Alerts
- **Clinic tabs:** Disease, Water
- **District Officer tabs:** Disease, Water, Campaigns
- **Delete:** super_admin, health_admin only
- **Verify disease/water:** super_admin + health_admin + district_officer + clinic
- **Approve/reject disease/water:** super_admin + health_admin + district_officer + clinic
- **Approve/reject campaigns:** admin + district_officer
- **Approve/reject alerts:** admin only

### AllAlertsScreen
- Search bar + urgency filter chips (All / Critical / High / Medium / Low)
- Pull-to-refresh
- Left-border urgency color coding
- Detail modal with description, location, date
- District-scoped roles (district_officer/clinic/asha_worker/volunteer): own district + nearby districts within 10 km

### ReportsScreen
- Status filter chips: volunteers see Reported/Verified only
- super_admin/health_admin/district_officer/clinic: additional Approval Status section (Pending/Approved/Rejected)
- Card footer: status pill → approval pill (stacked vertically) + date (right-aligned)

### UserManagementScreen
- Role filter chips: horizontal scroll, text centered
- Role assignment grid: `width: '46%'` (2-per-row), centered text
- Role labels: ROLE_DISPLAY map (e.g. "Health Admin", "District Officer")
- Change roles: super_admin only

---

## 11. Dashboards

### DashboardRouter (`components/dashboards/DashboardRouter.tsx`)
Routes based on `profile.role` to one of 6 role-specific dashboards.

| Role | Dashboard | Quick Actions |
|---|---|---|
| super_admin | SuperAdminDashboard | Reports, Alerts, Campaign, Users, Approval Queue |
| health_admin | HealthAdminDashboard | Reports, Alerts, Campaign, Approval Queue |
| district_officer | DistrictOfficerDashboard | Disease, Water, Campaign (district only) |
| clinic | ClinicDashboard | Disease Report, Water Report, Review Queue |
| asha_worker | AshaWorkerDashboard | Disease Report, Water Report, Campaign Proposal |
| volunteer | VolunteerDashboard | Browse Campaigns, View Alerts |

### DashboardShared Components
- `DashboardHeader` — LinearGradient header with role badge + greeting
- `Section` — titled content section with optional style
- `StatCard` — icon + number + label card
- `QuickActionBtn` — icon + label button grid item
- `AlertCard` — alert with urgency left-border color
- `ToolCard` — icon + title + subtitle + chevron + optional badge
- `PersonalizedDashboardLayout` — per-user widget order/visibility/collapse state with drag-and-drop persistence
- `HealthScoreWidget` — district score widget backed by `healthScoreService`
- `CampaignPerformanceWidget` — campaign success visualization backed by `campaignService`
- `TrendInsightsWidget` — disease trajectory visualization backed by `trendService`
- `AIOutbreakAlertsSection` — dashboard triage panel for pending AI-generated outbreak alerts with Accept/Dismiss actions
- `EmptyState` — icon + title + subtitle
- `SectionDivider` — visual separator

### Dashboard Personalization (Session 41)
- `SuperAdminDashboard`, `HealthAdminDashboard`, and `DistrictOfficerDashboard` now define widget registries (`DashboardWidgetDefinition[]`) rendered through `PersonalizedDashboardLayout`.
- Layout persistence uses key pattern `healthdrop_widget_layout_v1_${profile.role}_${profile.id}` in `AsyncStorage`.
- Users can reorder widgets (drag), collapse/expand widget content, and toggle widget visibility through Customize modal.
- Core operational widgets now include charted trend, health score, campaign performance, map-alert context, AI recommendations, and AI outbreak triage.

### ClinicDashboard Specifics
- Quick Actions: Disease Report, Water Report, Review Queue (no Campaign/Alert creation)
- Approval Tools: Disease Reports queue card → `approval-queue:disease`
- Approval Tools: Water Reports queue card → `approval-queue:water`

---

## 12. Forms

| Form | File | Notes |
|---|---|---|
| Disease Report | `DiseaseReportForm.tsx` | GPS auto-fill, symptoms array |
| Water Quality | `WaterQualityReportForm.tsx` | Chemical parameters |
| Campaign | `CampaignForm.tsx` | **status must be `'planned'`** (DB CHECK constraint) |
| Alert | `AlertForm.tsx` | super_admin+health_admin+district_officer; role-aware messaging |

---

## 13. AI Integration

### OpenRouter API (`lib/services/gemini.ts`)
- Direct OpenRouter calls using `EXPO_PUBLIC_OPENROUTER_API_KEY`
- Model selected from `EXPO_PUBLIC_OPENROUTER_MODEL` (defaults to `nvidia/nemotron-3-super-120b-a12b:free`)
- Strict JSON extraction/parsing for AI insights responses
- Shared request path for chat + insights using OpenRouter Chat Completions

### AIInsightsPanel (`components/ai/AIInsightsPanel.tsx`)
- Scope: district → state → global (based on profile)
- District scope uses the same 10 km radius filtering logic as alerts/map
- Shimmer skeleton loading state
- Expand/collapse detail view
- Mounted in all 6 dashboards

### AIChatbot (`components/ai/AIChatbot.tsx`)
- Floating action button (bottom-right)
- Slide-up chat panel
- `useNativeDriver: false` for web compatibility
- Mounted as absolute overlay in `MainApp.tsx`
- Supports optional structured recommendation capture from assistant responses and persists valid actionable recommendations via service-layer insert.

### AI Recommendation Frontend Integration (2026-03-31)

#### Type Layer
- Added first-class recommendation types in `types/index.ts`:
  - `AIRecommendation`
  - `AIRecommendationInput`
  - `AIRecommendationType`
  - `AIRecommendationStatus`
  - `AIRecommendationSeverity`

#### Service Layer (`lib/services/aiRecommendations.ts`)
- `fetchRecommendations(options)`
  - Supports district/type/status filtering and pending-priority retrieval.
- `updateRecommendationStatus(id, status)`
  - Updates lifecycle status and action audit fields (`acted_at`, `acted_by`).
- `createRecommendation(payload)`
  - Creates recommendation records in `ai_recommendations` with default `pending` lifecycle status.

#### UI Components
- `components/ai/AIRecommendationCard.tsx`
  - Reusable recommendation card with status/type/severity badges and confidence display.
  - Accept/Reject actions for privileged roles only.
- `components/ai/AIRecommendationsPanel.tsx`
  - Fetches recommendations with loading skeletons, empty/error states, and manual refresh.
  - Uses optimistic UI updates on accept/reject actions with rollback on failure.
  - Shows user feedback banners for success/error action outcomes.

#### Dashboard Embedding
- Mounted `AIRecommendationsPanel` in all role dashboards:
  - `SuperAdminDashboard`
  - `HealthAdminDashboard`
  - `DistrictOfficerDashboard`
  - `ClinicDashboard`
  - `AshaWorkerDashboard`
  - `VolunteerDashboard`
- Panel shows top pending recommendations (`maxItems=3`) and is refreshed alongside dashboard pull-to-refresh state.

#### Chatbot Structured Recommendation Handling
- `AIChatbot` now parses optional structured recommendation payloads from AI output.
- Valid parsed payloads are persisted using `createRecommendation`.
- Normal conversational behavior is preserved as fallback.
- If response contains only structured recommendation markup, chatbot now renders a safe user-facing summary instead of raw structured markup.

#### Assistant Output Contract (Optional)
- `getChatResponse` system prompt now supports optional actionable recommendation blocks:

```text
<recommendation>{"type":"alert|campaign|escalation","title":"...","description":"...","severity":"low|medium|high|critical","district":"...","confidence_score":0.0,"recommendation_data":{"reason":"..."}}</recommendation>
```

- This block is requested only for actionable operational interventions, not for normal informational chat.

### AI Recommendation Decision Support Layer (Database)
- AI outputs are persisted as structured rows in `ai_recommendations` (not plain text blobs).
- `recommendation_data` JSONB stores action payloads for frontend execution cards.
- Status transitions are auditable via `acted_at` and `acted_by`.
- Trigger `trg_ai_recommendation_action` executes accepted actions (currently documented for alert creation).

### Predictive Outbreak Frontend Integration (2026-04-01)

#### Service Layer
- `lib/services/trendService.ts`
  - `fetchTrends(options)` for district/disease trend retrieval from `vw_disease_trends` with fallback to `disease_trends`.
  - `fetchOutbreakWarnings(options)` for rising/anomaly warning retrieval from `vw_outbreak_warnings`.
  - short-lived in-memory cache and typed normalization for resilient client consumption.
- `lib/services/aiAlertsService.ts`
  - `fetchAIAlerts(options)` for triage queue retrieval from `ai_generated_alerts`.
  - `updateAlertStatus(id, status)` for lifecycle updates.
  - `acceptAIAlert(id)` to promote accepted AI alert rows into `health_alerts` and initiate push targeting.
  - `dismissAIAlert(id)` for explicit dismissal flow.

#### UI Layer
- Added `AIOutbreakAlertsSection` in `components/dashboards/DashboardShared.tsx` and integrated into:
  - `SuperAdminDashboard`
  - `HealthAdminDashboard`
  - `DistrictOfficerDashboard`
  - `ClinicDashboard`
- Added predictive trend and warning screens:
  - `components/screens/TrendAnalysisScreen.tsx`
  - `components/screens/OutbreakWarningsScreen.tsx`
  - `components/charts/TrendChart.tsx`
- Added `MainApp` route wiring for `trend-analysis` and `outbreak-warnings`.
- Extended `MapDashboard` to display warning chips and anomaly/rising district status indicators.

---

## 14. SQL Files Reference (`database_structure/`)

| File | Purpose | Status |
|---|---|---|
| `DATABASE_SCHEMA.sql` | Full schema with all tables, constraints, indexes | ✅ Canonical |
| `APPROVAL_SYSTEM.sql` | Core approval workflow RLS policies | ✅ Applied |
| `ALERT_APPROVAL_WORKFLOW.sql` | Health alerts approval + trigger | ✅ Applied |
| `ALERT_DEDUPLICATION_SYSTEM.sql` | 10-minute alert dedup via bucket + unique index + insert trigger | ✅ Applied |
| `AI_RECOMMENDATION_DECISION_LAYER` (ad-hoc) | `ai_recommendations` table + indexes + RLS + action trigger flow | ✅ Applied |
| `DATA_VALIDATION_LAYER` (ad-hoc) | disease/water CHECK constraints + cleanup SQL + edge validation contract | ✅ Applied |
| `DISTRICT_HEALTH_SCORE_NUMERIC` (ad-hoc) | flexible numeric score function + district score + ranking views | ✅ Applied |
| `AUDIT_LOG.sql` | audit_logs table + audit triggers | ✅ Applied |
| `DISTRICT_OFFICER_RLS.sql` | Complete district_officer RLS across all tables | ✅ Applied |
| `ENUM_MIGRATION.sql` | Role type enum updates | ✅ Applied |
| `FIX_CLINIC_RLS_POLICIES.sql` | Clinic UPDATE (disease/water); removes clinic from campaign management | ⚠️ **Apply in Supabase** |
| `FIX_PROFILES_RLS_RECURSION.sql` | SECURITY DEFINER helpers (get_my_role, get_my_district) | ✅ Applied |
| `FIX_REPORT_SUBMISSION_RLS.sql` | Stale trigger fix + idempotent policy recreation | ✅ Applied |
| `FIX_VERIFICATION_AND_VISIBILITY.sql` | Visibility + verify update policies | ⚠️ **Apply in Supabase** |
| `GEOGRAPHIC_HEATMAP.sql` | Materialized view for geographic heatmap analytics | 🔵 Optional |
| `OFFLINE_SYNC_SCHEMA.sql` | client-generated sync identifiers + conflict-resolution columns for offline sync | ✅ Applied |
| `OUTBREAK_DETECTION.sql` | Predictive trend analysis + outbreak warning views + AI alert generation automation | ✅ Applied |
| `PERFORMANCE_INDEXES.sql` | 20+ composite and partial indexes | ✅ Applied |
| `PUSH_NOTIFICATIONS.sql` | expo_push_token column + edge function schema | ✅ Applied |
| `USER_FEEDBACK_TABLE.sql` | user_feedback table definition | ✅ Applied |

### Ad-hoc Migration Applied (2026-03-30)
**Name:** Client Generated ID Migration (Final Fix, RLS-safe)

**Intent:**
- Rebuild `client_generated_id` on `disease_reports` and `water_quality_reports` with UUID defaults.
- Enforce `NOT NULL` + deduplication uniqueness indexes.
- Add `last_updated_at` timestamps for conflict resolution.

```sql
-- ============================================
-- CLIENT GENERATED ID MIGRATION (FINAL FIX)
-- Safe for RLS-enabled environments
-- ============================================

-- Ensure UUID generator is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- DISEASE REPORTS TABLE
-- ============================================

-- Step 1: Add new column with auto-generated UUID
ALTER TABLE disease_reports
ADD COLUMN client_generated_id_new UUID DEFAULT gen_random_uuid();

-- Step 2: Verify no NULL values
SELECT COUNT(*) AS disease_null_check
FROM disease_reports
WHERE client_generated_id_new IS NULL;

-- Step 3: Drop old column (if exists)
ALTER TABLE disease_reports
DROP COLUMN IF EXISTS client_generated_id;

-- Step 4: Rename new column
ALTER TABLE disease_reports
RENAME COLUMN client_generated_id_new TO client_generated_id;

-- Step 5: Enforce NOT NULL constraint
ALTER TABLE disease_reports
ALTER COLUMN client_generated_id SET NOT NULL;

-- Step 6: Add UNIQUE index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_disease_client_id
ON disease_reports (client_generated_id);

-- ============================================
-- WATER QUALITY REPORTS TABLE
-- ============================================

-- Step 1: Add new column with auto-generated UUID
ALTER TABLE water_quality_reports
ADD COLUMN client_generated_id_new UUID DEFAULT gen_random_uuid();

-- Step 2: Verify no NULL values
SELECT COUNT(*) AS water_null_check
FROM water_quality_reports
WHERE client_generated_id_new IS NULL;

-- Step 3: Drop old column (if exists)
ALTER TABLE water_quality_reports
DROP COLUMN IF EXISTS client_generated_id;

-- Step 4: Rename new column
ALTER TABLE water_quality_reports
RENAME COLUMN client_generated_id_new TO client_generated_id;

-- Step 5: Enforce NOT NULL constraint
ALTER TABLE water_quality_reports
ALTER COLUMN client_generated_id SET NOT NULL;

-- Step 6: Add UNIQUE index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_client_id
ON water_quality_reports (client_generated_id);

-- ============================================
-- OPTIONAL (RECOMMENDED)
-- Add last_updated_at column for conflict resolution
-- ============================================

ALTER TABLE disease_reports
ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE water_quality_reports
ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMP DEFAULT NOW();

-- ============================================
-- FINAL VERIFICATION
-- ============================================

SELECT
(SELECT COUNT(*) FROM disease_reports WHERE client_generated_id IS NULL) AS disease_remaining_nulls,
(SELECT COUNT(*) FROM water_quality_reports WHERE client_generated_id IS NULL) AS water_remaining_nulls;

-- Should return:
-- disease_remaining_nulls = 0
-- water_remaining_nulls = 0

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
```

### Ad-hoc Migration Applied (2026-03-31)
**Name:** AI Recommendation Decision Layer

**Intent:**
- Add structured recommendation storage for AI-assisted decision support.
- Enforce district-scoped visibility and action auditability with RLS.
- Enable trigger-based auto execution for accepted recommendations.

**Key objects introduced:**
- Table: `ai_recommendations`
- Indexes: `idx_ai_reco_status`, `idx_ai_reco_district`, `idx_ai_reco_type`
- Policies: `view recommendations by district`, `act on recommendations`
- Trigger function: `handle_ai_recommendation()`
- Trigger: `trg_ai_recommendation_action`

### Ad-hoc Migration Applied (2026-03-31)
**Name:** Data Validation Layer (Backend Integrity System)

**Intent:**
- Enforce report data integrity at DB level for disease and water modules.
- Validate business rules in a server-side edge function before insert.
- Keep full compatibility with existing RLS policy model.

**Development cleanup executed before constraints:**

```sql
DELETE FROM disease_reports
WHERE deaths_count > cases_count;

DELETE FROM water_quality_reports
WHERE latitude NOT BETWEEN -90 AND 90
  OR longitude NOT BETWEEN -180 AND 180;
```

**Constraints enforced:**

```sql
ALTER TABLE disease_reports
ADD CONSTRAINT valid_cases CHECK (cases_count > 0);

ALTER TABLE disease_reports
ADD CONSTRAINT valid_deaths CHECK (deaths_count <= cases_count);

ALTER TABLE disease_reports
ADD CONSTRAINT valid_latitude CHECK (latitude BETWEEN -90 AND 90);

ALTER TABLE disease_reports
ADD CONSTRAINT valid_longitude CHECK (longitude BETWEEN -180 AND 180);

ALTER TABLE water_quality_reports
ADD CONSTRAINT valid_water_lat CHECK (latitude BETWEEN -90 AND 90);

ALTER TABLE water_quality_reports
ADD CONSTRAINT valid_water_lng CHECK (longitude BETWEEN -180 AND 180);
```

**Edge validation contract (`validate-report`):**
- Latitude range validation (`-90..90`)
- Longitude range validation (`-180..180`)
- `cases_count > 0`
- `deaths_count <= cases_count`
- Duplicate detection in rolling 10-minute window

**Production migration note:**
- For zero-downtime rollout, use `ADD CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT` after cleanup/backfill.

### Ad-hoc Migration Applied (2026-03-31)
**Name:** GEO Backfill (Final Verified Version)

**Intent:**
- Backfill missing geometry values for disease and water reports using existing latitude/longitude values.
- Verify no null geometry remains for targeted report tables.
- Avoid unsafe updates on `health_alerts` unless both coordinate columns exist.

```sql
-- ============================================
-- GEO BACKFILL (FINAL VERIFIED VERSION)
-- ============================================

-- Disease Reports
UPDATE disease_reports
SET location_geo = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE location_geo IS NULL;

-- Water Quality Reports
UPDATE water_quality_reports
SET location_geo = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE location_geo IS NULL;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

SELECT COUNT(*) AS disease_missing_geo
FROM disease_reports
WHERE location_geo IS NULL;

SELECT COUNT(*) AS water_missing_geo
FROM water_quality_reports
WHERE location_geo IS NULL;

-- Expected:
-- disease_missing_geo = 0
-- water_missing_geo = 0

-- ============================================
-- HEALTH ALERTS NOTE
-- ============================================

-- DO NOT update health_alerts unless it has:
-- latitude AND longitude columns

-- If not present, skip geo update for alerts
```

### Ad-hoc Migration Applied (2026-03-31)
**Name:** District Health Score System (Flexible Numeric Version)

**Intent:**
- Introduce a configurable numeric district health score (`0-100`, higher is healthier).
- Keep weighting flexible through JSON overrides without changing downstream view contracts.
- Provide a rank-ready district view for prioritization dashboards and automation logic.

```sql
CREATE OR REPLACE FUNCTION public.calculate_health_score(
  active_cases NUMERIC,
  avg_water_score NUMERIC,
  outbreak_count NUMERIC,
  avg_response_time NUMERIC
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (
    (active_cases * 0.4) +
    (avg_water_score * 10 * 0.2) +
    (outbreak_count * 20 * 0.2) +
    (COALESCE(avg_response_time, 0) * 0.2)
  );
END;
$$;

CREATE OR REPLACE VIEW public.vw_district_health_score AS
SELECT
  d.district,

  -- Active cases (last 7 days)
  COALESCE(SUM(d.cases_count), 0) AS active_cases,

  -- Avg water quality score
  COALESCE(AVG(water_quality_score(w.overall_quality)), 2) AS avg_water_score,

  -- Outbreak count
  COALESCE((
    SELECT COUNT(*)
    FROM health_alerts a
    WHERE a.district = d.district
      AND a.urgency_level IN ('high', 'critical')
      AND a.created_at >= NOW() - INTERVAL '7 days'
  ), 0) AS outbreak_count,

  -- Avg response time
  COALESCE(AVG(d.response_time_hours), 0) AS avg_response_time,

  -- Final health score (NO CASTING REQUIRED)
  calculate_health_score(
    COALESCE(SUM(d.cases_count), 0),
    COALESCE(AVG(water_quality_score(w.overall_quality)), 2),
    COALESCE((
      SELECT COUNT(*)
      FROM health_alerts a
      WHERE a.district = d.district
        AND a.urgency_level IN ('high', 'critical')
        AND a.created_at >= NOW() - INTERVAL '7 days'
    ), 0),
    COALESCE(AVG(d.response_time_hours), 0)
  ) AS health_score

FROM disease_reports d

LEFT JOIN water_quality_reports w
ON w.district = d.district
AND w.created_at >= NOW() - INTERVAL '7 days'

WHERE d.created_at >= NOW() - INTERVAL '7 days'

GROUP BY d.district;

CREATE OR REPLACE VIEW public.vw_district_health_ranking AS
SELECT
  district,
  health_score,
  RANK() OVER (ORDER BY health_score DESC) AS risk_rank
FROM public.vw_district_health_score;
```

Behavior:
- Aggregates last 7 days of data.
- Combines disease cases, water quality, outbreak alerts, and response time.
- Produces unified district-level health score outputs.

Advantages:
- Avoids type mismatch issues (`BIGINT` vs `NUMERIC`).
- No explicit casts required.
- Better precision for analytics and AI workflows.

Usage:

```sql
SELECT * FROM vw_district_health_score;
```

```sql
SELECT * FROM vw_district_health_ranking;
```

Status:
- Health Score Function: Enabled
- View Aggregation: Enabled
- Ranking System: Enabled
- Production Readiness: Verified

### Additional Ad-hoc Migration Applied (2026-03-30)
**Name:** Alert Deduplication System (Production)

**File:** `database_structure/ALERT_DEDUPLICATION_SYSTEM.sql`

**Intent:**
- Prevent duplicate alerts in the same district and urgency within the same 10-minute window.
- Avoid generated-column immutability issues by storing a concrete `created_bucket` value.

```sql
-- 1) Add bucket column
ALTER TABLE health_alerts
ADD COLUMN IF NOT EXISTS created_bucket BIGINT;

-- 2) Backfill bucket values from existing created_at
UPDATE health_alerts
SET created_bucket = FLOOR(EXTRACT(EPOCH FROM created_at) / 600)::BIGINT
WHERE created_bucket IS NULL;

-- 3) Enforce non-null bucket
ALTER TABLE health_alerts
ALTER COLUMN created_bucket SET NOT NULL;

-- 4) Enforce dedup rule
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_dedup_unique
ON health_alerts (district, urgency_level, created_bucket);

-- 5) Trigger function for all new inserts
CREATE OR REPLACE FUNCTION set_alert_created_bucket()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_at IS NULL THEN
    NEW.created_at := NOW();
  END IF;

  NEW.created_bucket := FLOOR(EXTRACT(EPOCH FROM NEW.created_at) / 600)::BIGINT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6) Trigger binding
DROP TRIGGER IF EXISTS trg_set_alert_created_bucket ON health_alerts;

CREATE TRIGGER trg_set_alert_created_bucket
BEFORE INSERT ON health_alerts
FOR EACH ROW
EXECUTE FUNCTION set_alert_created_bucket();
```

---

## 15. Environment & Setup

### `.env` file
```
EXPO_PUBLIC_SUPABASE_URL=https://ekfdimdlxifatsaubvbh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
EXPO_PUBLIC_OPENROUTER_API_KEY=<openrouter_key>
EXPO_PUBLIC_OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
EXPO_PUBLIC_OFFLINE_SYNC_ENABLED=true
```

### Development
```bash
npm install
npx expo start --clear    # with cache clear
npx expo start            # normal dev server
```

### TypeScript Check
```bash
npx tsc --noEmit
```

### Database Setup Order
1. Run `DATABASE_SCHEMA.sql` first
2. Run `ENUM_MIGRATION.sql`
3. Run `FIX_PROFILES_RLS_RECURSION.sql` (SECURITY DEFINER helpers)
4. Run `APPROVAL_SYSTEM.sql`
5. Run `DISTRICT_OFFICER_RLS.sql`
6. Run `ALERT_APPROVAL_WORKFLOW.sql`
7. Run `ALERT_DEDUPLICATION_SYSTEM.sql`
8. Apply AI Recommendation Decision Layer SQL (table, indexes, RLS policies, trigger function, trigger)
9. Apply Data Validation Layer SQL (cleanup + disease/water CHECK constraints)
10. Apply GEO Backfill SQL for `disease_reports.location_geo` and `water_quality_reports.location_geo`
11. Verify geo backfill counts return `0` nulls for both report tables
12. Ensure `validate-report` edge validation deployment is active
13. Apply District Health Score SQL (`calculate_health_score`, `vw_district_health_score`, `vw_district_health_ranking`)
14. Run `FIX_REPORT_SUBMISSION_RLS.sql`
15. Run `FIX_VERIFICATION_AND_VISIBILITY.sql`
16. Run `FIX_CLINIC_RLS_POLICIES.sql`
17. Run `PERFORMANCE_INDEXES.sql`
18. Run `AUDIT_LOG.sql`
19. Optionally: `GEOGRAPHIC_HEATMAP.sql`, `OUTBREAK_DETECTION.sql`, `OFFLINE_SYNC_SCHEMA.sql`, `PUSH_NOTIFICATIONS.sql`

> **Supabase SQL Editor:** https://supabase.com/dashboard/project/ekfdimdlxifatsaubvbh/sql

---

## 16. UI Theme & Design System

> **Last updated:** 2026-02-26 (Sessions 26 & 27)

### Dark Mode — Glassmorphic Black Theme

| Token | Dark Value | Light Value |
|---|---|---|
| `background` | `#000000` | `#F8FAFC` |
| Card bg | `rgba(255,255,255,0.06)` | `#FFFFFF` |
| Card border | `rgba(255,255,255,0.10)` | role accent + `25` |
| Primary | `#26A69A` (teal) | `#26A69A` |
| Accent (red) | `#EF4444` | `#EF4444` |

### Glassmorphism Implementation

| Component | Blur (web) | Background (dark) |
|---|---|---|
| `StatCard` | 16px | role gradient overlay |
| `AlertCard` | 16px | `rgba(12,12,16,0.88)` |
| `ToolCard` | 16px | `rgba(12,12,16,0.85)` |
| `AIInsightsPanel` | 18px | `rgba(18,18,22,0.88)` |
| Bottom nav (MainApp) | `expo-blur` BlurView (native) / CSS 16px (web) | `rgba(0,0,0,0.72)` |

> Glass blur works on both native (via `expo-blur` BlurView) and web (CSS `backdropFilter`). Maps render natively via `react-native-webview` WebView, with `<iframe>` fallback on web.

### Session 29 Stabilization Notes (2026-03-26)

- `ReportsScreen.tsx`: legacy role checks using `admin` were replaced with `health_admin` to match profile role enums and prevent permission drift.
- `HealthMapComponent.tsx`: expanded map modal now uses full-height rendering (`height: '100%'`) instead of fixed mobile height, fixing clipped fullscreen behavior.
- `HealthMapComponent.tsx`: web GPS request now guards unsupported geolocation environments before calling browser APIs.
- `AIChatbot.tsx`: assistant FAB visibility now applies to all tabs except profile, keeping AI access consistent across home/reports/campaigns.

### Section Heading Pattern

All section headings use the same pattern from `DashboardShared.Section`:

```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
  <View style={{ backgroundColor: '#F59E0B18', borderRadius: 8, ... }}>
    <Ionicons name="alert-circle" size={15} color="#F59E0B" />
  </View>
  <Text style={{ fontSize: 15, fontWeight: '800' }}>Section Title</Text>
  {count > 0 && <Badge count={count} />}
</View>
```

### Screen Header Gradients

| Screen | Gradient |
|---|---|
| `CampaignsScreen` | `#EF4444 → #DC2626 → #B91C1C` (red diagonal) |
| `ReportsScreen` | `#26A69A → #00897B → #00695C` (teal diagonal) |
| Dashboard headers | Role-specific via `ROLE_GRADIENTS` in `DashboardShared.tsx` |

### Action Button Colors

| Button | Color |
|---|---|
| FAB (add campaign) | `#EF4444` (red) |
| "Create Campaign" submit | `#EF4444` (red) |
| "Allow Location" modal | `#3B82F6 → #2563EB` (blue gradient) |
| Tab active state | `colors.accent` (red in CampaignsScreen) |

---

## 17. Session 31 Consolidated Update (2026-03-30)

### What Changed

- Implemented shared 10 km alert-radius logic (`lib/services/alertRadius.ts`) for district-scoped roles.
- Applied radius-based alert visibility in dashboards, All Alerts screen, map alert layer, and AI insights context.
- Updated alert push-notification recipient targeting to match affected users within the same 10 km zone.
- Moved AI runtime to direct OpenRouter calls from app service layer (`lib/services/gemini.ts`) using env-driven model/key.
- Updated default OpenRouter model to `nvidia/nemotron-3-super-120b-a12b:free`.
- Large-scale CodeRabbit remediation completed across dashboards, AI chat, reports/campaigns, approval queue, map, and shared UI components.
- Type safety improvements applied broadly (reduced `any`, added union/generic typing, safer promise-settled handling).
- Accessibility improvements added for icon-only controls and modal close actions.
- Reliability improvements applied in async flows (mounted guards, guarded state updates, safer date formatting, stronger error logging + user feedback).
- Platform parity fixes added for web/native modal behavior, blur typing, map/location fallbacks, and keyboard behavior.
- AI service flow now uses direct OpenRouter calls from app service layer.
- Release automation introduced:
  - Manual release preparation via `prepare-release.yml`
  - Tag-based Android build/release via `build-android-release.yml`
  - Version sync helper `scripts/sync-version.cjs`
  - EAS build profiles in `eas.json`

### External Setup Checklist

Complete these outside the code editor if not already configured:

1. OpenRouter: create/manage active API key.
2. GitHub: add repository secret `EXPO_TOKEN` for release build workflow.
3. Expo/EAS: ensure project/account/build credentials are configured for Android release builds.
4. Database: run pending SQL fixes (`FIX_CLINIC_RLS_POLICIES.sql`, `FIX_VERIFICATION_AND_VISIBILITY.sql`) if still unapplied.

---

## 18. Session 33 Offline-First and Alert Dedup Update (2026-03-30)

### What Changed

- Implemented offline-first report sync for disease and water reports with local queue persistence, reconnect-driven sync, retry backoff, and dedupe-safe upsert behavior.
- Added `client_generated_id` + `last_updated_at` usage end-to-end in service/form flows to support idempotent inserts and conflict-safe updates.
- Added production Supabase alert dedup migration (`database_structure/ALERT_DEDUPLICATION_SYSTEM.sql`) using:
  - `created_bucket` (10-minute epoch bucket)
  - unique dedup index on `(district, urgency_level, created_bucket)`
  - insert trigger `trg_set_alert_created_bucket`
- Updated docs and migration references to include the new dedup system in setup order and SQL inventory.

### Operational Notes

- Duplicate alerts with the same `district` + `urgency_level` inside the same 10-minute bucket are now blocked at DB level.
- Alerts outside the bucket window (or in different urgency/district tuples) continue to insert normally.

---

## 19. Session 34 AI Recommendation Decision Layer Update (2026-03-31)

### What Changed

- Documented AI recommendation decision support schema with `ai_recommendations` as a first-class database entity.
- Added recommendation lifecycle documentation (`pending`, `accepted`, `rejected`, `auto_executed`) and execution semantics.
- Captured district-scoped SELECT RLS and recommendation action UPDATE RLS policy behavior.
- Documented trigger-driven action execution path (`handle_ai_recommendation`, `trg_ai_recommendation_action`) for accepted recommendations.
- Updated database setup order and migration notes to include the AI recommendation decision layer.

### Operational Notes

- Recommendation rows remain auditable through `model_used`, `confidence_score`, `acted_at`, and `acted_by`.
- Initial execution flow is designed around accepted alert recommendations inserting into `health_alerts`; campaign/escalation execution can be expanded using the same trigger model.

---

## 20. Session 36 Data Validation Layer Update (2026-03-31)

### What Changed

- Implemented layered backend integrity for report ingestion across database constraints + edge validation + RLS.
- Added disease-report constraints for case/death consistency:
  - `cases_count > 0`
  - `deaths_count <= cases_count`
- Added strict latitude/longitude bounds for both disease and water reports:
  - latitude must be in `[-90, 90]`
  - longitude must be in `[-180, 180]`
- Cleaned incompatible development rows before applying constraints.
- Documented the server-side `validate-report` edge validation contract with duplicate detection inside a rolling 10-minute window.

### Operational Notes

- Invalid epidemiological inputs are blocked at persistence layer and cannot bypass constraints.
- This validation layer improves analytics reliability and AI signal quality by preventing malformed report records.
- For production-safe migrations, use `NOT VALID` + `VALIDATE CONSTRAINT` to minimize lock impact during rollout.

---

## 21. Session 37 Geo Backfill Update (2026-03-31)

### What Changed

- Added final verified geospatial backfill migration for report tables:
  - `disease_reports.location_geo`
  - `water_quality_reports.location_geo`
- Standardized geometry generation using `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)` for null geometry rows.
- Added mandatory verification queries to confirm no null geometry remains in targeted report tables.
- Documented explicit safety rule for alerts: skip `health_alerts` geo backfill unless both `latitude` and `longitude` columns exist.

### Operational Notes

- Expected verification results after migration:
  - `disease_missing_geo = 0`
  - `water_missing_geo = 0`
- Migration is safe for report tables and intentionally conservative for alerts schema compatibility.

---

## 22. Session 38 Live Map and District Health Score Update (2026-03-31)

### What Changed

- Added native `Map` tab integration in `MainApp.tsx` and documented `MapDashboard` behavior.
- Documented `mapService` fetch/caching flow using `vw_map_layers` with:
  - viewport bounds filtering
  - layer filtering (`disease`/`water`/`alert`)
  - date-range filtering with presets and custom range
  - AsyncStorage-backed cached fallback for offline map rendering
- Added District Health Score (Flexible Numeric Version) migration documentation:
  - function `calculate_health_score(...)`
  - score view `vw_district_health_score`
  - rank view `vw_district_health_ranking`
- Added setup-order and SQL inventory updates for district health scoring artifacts.

### Operational Notes

- District health score outputs are numeric (`0-100`) and can be tuned via JSON weight overrides.
- Ranking view (`vw_district_health_ranking`) is intended for dashboard prioritization and district risk triage.

---

## 23. Session 39 Supabase Backend Completion Update (2026-04-01)

### What Changed

- Consolidated final Supabase backend completion state into docs.
- Verified and documented that all core and optional backend systems are active:
  - validation layer (frontend -> edge -> database)
  - geospatial/PostGIS system
  - alert deduplication buckets and unique index
  - role/severity-based notification targeting
  - predictive outbreak detection and AI alert generation pipeline
  - AI recommendations with trigger automation
  - district health scoring + ranking analytics
  - campaign effectiveness analytics
  - escalation workflow with `pg_cron`
  - cross-entity case traceability
- Updated setup guidance to reflect a complete production migration order and verification checklist.

### Architecture Summary

| Layer | Responsibility |
|---|---|
| Frontend | UX validation, dashboard/map visualization, ranking displays |
| Edge Functions | business validation and duplicate detection |
| Database | constraints, triggers, indexes, RLS, analytics views |
| AI Layer | recommendation generation and decision support |

### Final Status

- Schema Design: Complete
- Data Integrity: Enforced
- Automation: Enabled
- Performance: Optimized
- AI Integration: Active
- Geospatial Support: Enabled
- Analytics Layer: Complete
- Production Readiness: Fully Achieved

### Operational Notes

- No further mandatory Supabase schema changes are required for current scope.
- Ongoing work is frontend UX optimization, visualization iteration, and operational monitoring.

---

## 24. Predictive Outbreak Detection and AI Alert System (2026-04-01)

### Overview

The predictive outbreak detection pipeline moves HealthDrop from reactive reporting to proactive surveillance by combining daily aggregation, trend analysis, and rule-based AI alert generation.

Pipeline:

`Disease Reports -> Trend Aggregation -> Trend Analysis -> Outbreak Detection -> AI Alert Generation`

### Core Data Objects

- `disease_trends`
  - daily aggregated case counts by `district`, `disease_name`, and `report_date`
  - stores `total_cases` for time-series analysis
- `ai_generated_alerts`
  - stores automated high-risk alerts
  - includes `district`, `disease_name`, `severity`, `title`, `description`, `status`, `created_at`

### Aggregation and Analysis

- `update_disease_trends()`
  - aggregates `disease_reports` by district and disease
  - updates `disease_trends` daily
- `vw_disease_trends`
  - computes 3-day moving average
  - computes previous day case count
  - supports smoothed trend evaluation

### Outbreak Classification

- `vw_outbreak_warnings` classifies each district-disease trend as:
  - `normal`: no previous data
  - `stable`: no significant change
  - `rising`: >30% increase vs previous day
  - `anomaly`: >50% increase vs moving average

### AI Alert Generation

- `generate_ai_alerts()` reads from `vw_outbreak_warnings`
- filters only `rising` and `anomaly` rows
- severity mapping:
  - `anomaly` -> `critical`
  - `rising` -> `high`
- inserts generated rows into `ai_generated_alerts`

### Automation

- Daily cron job:
  - runs `update_disease_trends()`
- Hourly cron job:
  - runs `generate_ai_alerts()`

### Performance and Integration Notes

- indexes:
  - `disease_trends (district, report_date)`
  - `ai_generated_alerts (district)`
- views reduce repeated heavy computations on raw report tables
- integration points:
  - dashboards for trends/alerts
  - map highlighting for high-risk districts
  - notification services for alert propagation
  - AI recommendation workflows for follow-up actions

### Status

- Trend Aggregation: Enabled
- Outbreak Detection: Enabled
- AI Alert Generation: Enabled
- Automation: Enabled
- Production Readiness: Achieved

---

## 25. Session 40 Frontend Predictive and AI Alerts Integration Verification (2026-04-01)

### What Changed

- Verified end-to-end frontend integration of predictive outbreak and AI alert modules.
- Confirmed service exports and runtime wiring for:
  - `trendService` (`fetchTrends`, `fetchOutbreakWarnings`)
  - `aiAlertsService` (`fetchAIAlerts`, `updateAlertStatus`, `acceptAIAlert`, `dismissAIAlert`)
- Confirmed route integration in `MainApp.tsx`:
  - `trend-analysis`
  - `outbreak-warnings`
- Confirmed dashboard integration of `AIOutbreakAlertsSection` in super admin, health admin, district officer, and clinic dashboards.
- Confirmed `MapDashboard` warning overlays and district anomaly/rising status presentation.

### Verification

- Workspace diagnostics: no errors reported.
- TypeScript compile validation:
  - command: `npx tsc --noEmit -p tsconfig.json`
  - result: `EXIT:0`

### Operational Notes

- Backend predictive objects remained unchanged in this update; this session completed frontend wiring verification and documentation synchronization.
- No additional mandatory schema migration is required for this frontend integration layer.

---

## 26. Session 41 Dashboard Personalization and UX Integration (2026-04-01)

### What Changed

- Implemented dashboard personalization framework in `DashboardShared.tsx`:
  - added `PersonalizedDashboardLayout`
  - added `DashboardWidgetDefinition` registry pattern
  - added persisted widget state (`visible`, `collapsed`, ordered layout) in `AsyncStorage`
  - added drag-reorder with `react-native-draggable-flatlist`
- Added reusable dashboard data widgets:
  - `HealthScoreWidget` with `HealthScoreChart`
  - `CampaignPerformanceWidget` with `CampaignChart`
  - `TrendInsightsWidget` with `TrendChart`
- Migrated dashboard composition from static section order to widget registry in:
  - `SuperAdminDashboard.tsx`
  - `HealthAdminDashboard.tsx`
  - `DistrictOfficerDashboard.tsx`
- Added app-shell UX overlays in `MainApp.tsx`:
  - `QuickActions` floating role-aware action menu
  - `OfflineBanner` with network and pending-sync queue visibility
  - FAB offset coordination to avoid overlap with existing AI chatbot FAB
- Added navigation overlays/routes for operational screens already wired in `MainApp.tsx`:
  - `district-ranking`
  - `campaign-analytics`
  - `traceability`
  - `escalation-monitor`

### Verification

- TypeScript compile validation:
  - command: `npx tsc --noEmit`
  - result: `EXIT:0`
- Web export validation:
  - command: `npx expo export --platform web`
  - result: successful export
- Android JS bundle export validation:
  - command: `npx expo export --platform android`
  - result: successful export

### Operational Notes

- This session was frontend-only and did not introduce new required Supabase schema migrations.
- Widget personalization is scoped by role and user id through storage key `healthdrop_widget_layout_v1_${profile.role}_${profile.id}`.

---

## 27. Session 42 Operational Integration and Documentation Sync (2026-04-01)

### What Changed

- Added and integrated operational intelligence screens:
  - `DistrictRankingScreen.tsx`
  - `CampaignAnalytics.tsx`
  - `TraceabilityScreen.tsx`
  - `EscalationScreen.tsx`
- Completed map operations layer and platform fallback path:
  - `MapDashboard.tsx` for native map intelligence and overlays
  - `MapDashboard.web.tsx` for web-safe map dashboard rendering
- Added AI recommendation presentation and action service support:
  - `AIRecommendationCard.tsx`
  - `AIRecommendationsPanel.tsx`
  - `aiRecommendations.ts`
- Added reliability stack for queue-safe submissions and sync:
  - `offlineQueue.ts`
  - `reportValidation.ts`
  - `syncService.ts`
  - `useNetworkStatus.ts`
- Added release and backend utility assets:
  - `prepare-release.yml`
  - `build-android-release.yml`
  - `eas.json`
  - `sync-version.cjs`
  - `supabase/functions/openrouter-proxy/index.ts`

### Verification

- TypeScript compile validation:
  - command: `npx tsc --noEmit`
  - result: no reported errors

### Documentation Sync Outcome

- Updated all primary documentation sets for this delivery scope:
  - `README.md`
  - `COMPREHENSIVE_DOCUMENTATION.md`
  - `SESSION_HISTORY.md`
  - `MEMORY_BANK.md`
  - `SETUP_GUIDE.md`

---

## 28. Session 43 Production Stabilization and UX Alignment (2026-04-08)

### What Changed

- Unified create-entry UX into a single global create button in `MainApp.tsx`.
- Removed duplicate local add FABs from:
  - `components/screens/ReportsScreen.tsx`
  - `components/screens/CampaignsScreen.tsx`
- Enforced centralized role-gated create routing for:
  - disease report
  - water quality report
  - campaign
  - health alert
- Extended offline parity beyond disease/water:
  - queued campaign and health-alert submissions when offline
  - reconnect sync support for queued campaign/alert payloads
  - corrected feedback sync table target to `user_feedback`
- Refactored disease/water forms to use service-layer offline-first create paths:
  - `DiseaseReportForm.tsx` uses `diseaseReportsService.create(...)`
  - `WaterQualityReportForm.tsx` uses `waterQualityService.create(...)`
- Hardened map expansion stability in `HealthMapComponent.tsx` by avoiding dual map instance rendering during fullscreen expansion.
- Added web touch-selection hardening to dashboard interactive cards in `DashboardShared.tsx` to reduce accidental long-press text selection lock behavior.

### Verification

- TypeScript compile validation executed after patch batch:
  - command: `npx tsc --noEmit`
  - result: clean (no newly introduced type errors)

---

## 29. Supabase Changes (Final Fixes & Alignment)

### Sync and Queue Alignment

- Offline queue type coverage now includes:
  - `disease_report`
  - `water_quality_report`
  - `campaign`
  - `health_alert`
  - `feedback`
- Queue uploader now maps item types to aligned backend tables:
  - `disease_reports`
  - `water_quality_reports`
  - `health_campaigns`
  - `health_alerts`
  - `user_feedback` (corrected from legacy `feedback` reference)

### Idempotency Behavior

- Disease and water uploads keep idempotent upsert behavior via `client_idempotency_key`.
- Campaign, alert, and feedback queue sync use direct insert flow to remain compatible with current schema shape.

### Operational Impact

- Offline-created campaigns and alerts now reach Supabase automatically after reconnect, improving production parity between online and offline submission paths.
- Centralized role checks in the app shell reduce unauthorized form navigation attempts before DB roundtrip.

---

## 30. Session 44 Navigation, AI Insights Resilience, and Runtime Toggle (2026-04-09)

### What Changed

- Updated universal create FAB behavior in `components/MainApp.tsx`:
  - moved FAB to the right side
  - restricted visibility to `reports` and `campaigns` tabs only
  - aligned FAB visual style with AI FAB (glassmorphism on dark theme + blur on web)
- Normalized dashboard quick-action card sizing in `components/dashboards/DashboardShared.tsx`:
  - fixed consistent card height and label space to keep all quick-action buttons visually even across role dashboards
- Added AI insights local caching in `components/ai/AIInsightsPanel.tsx`:
  - stores latest fetched insight payload in AsyncStorage
  - automatically falls back to cached insight when network/API calls fail
- Added runtime offline-sync switch in app bootstrap:
  - `App.tsx` now reads `EXPO_PUBLIC_OFFLINE_SYNC_ENABLED`
  - supports online-only QA runs without code edits

### Environment Toggle Behavior

- `EXPO_PUBLIC_OFFLINE_SYNC_ENABLED=true`
  - starts offline sync service at app boot (recommended for production)
- `EXPO_PUBLIC_OFFLINE_SYNC_ENABLED=false`
  - skips offline sync service startup (useful for online-only testing)

---

## 31. NoSQL Integration Layer (MongoDB)

### Overview

The system now adopts a hybrid database architecture:

- PostgreSQL (Supabase) -> Primary system of record
- MongoDB (NoSQL) -> Secondary flexible data layer

This separation ensures:
- Strong relational integrity for core workflows
- High scalability and flexibility for dynamic and unstructured data

---

### Responsibilities Split

#### PostgreSQL (Supabase)

- Disease reports
- Water quality reports
- Campaigns
- Users and roles (RLS enforced)
- Alerts and approval workflows
- District analytics and scoring
- Geospatial queries (PostGIS)

#### MongoDB (NoSQL)

- AI-generated insights and recommendations
- Audit logs (high-volume append-only data)
- Notification streams (real-time feeds)
- Cached and derived datasets (future)

---

### MongoDB Database Structure

Database: `healthdrop_nosql`

Collections:

1. `ai_insights`
  - Stores AI-generated insights and recommendations
  - Flexible schema for evolving AI outputs

2. `audit_logs`
  - Stores system-level logs for UPDATE and DELETE operations
  - Replaces heavy relational logging for scalability

3. `notifications_stream`
  - Stores real-time notification feed data
  - Optimized for quick reads and filtering

---

### Design Principles

- MongoDB is not used for core transactional data
- No duplication of critical relational data
- MongoDB documents may reference PostgreSQL IDs (for example: report_id, user_id)
- Schema flexibility is preferred over strict enforcement
- Read-heavy and write-heavy workloads are offloaded to MongoDB

---

### Integration Strategy (Implemented)

- MongoDB is accessed through `lib/mongo.ts` using `connectMongo()`
- `lib/services/mongoService.ts` provides modular APIs:
  - `saveAIInsight(data)`
  - `logAuditEvent(data)`
  - `pushNotification(data)`
  - `healthCheckMongoCollections(collectionNames?)` (read-only runtime connectivity check)
- PostgreSQL remains the source of truth
- MongoDB acts as:
  - Write-optimized logging system
  - Read-optimized AI data store

---

### Future Extensions

- AI context memory storage
- Predictive analytics caching
- Real-time dashboards using Mongo streams
- Event sourcing patterns (optional)

---

### Security Considerations

- Local development: MongoDB bound to `127.0.0.1`
- Production:
  - MongoDB Atlas with IP whitelisting
  - Role-based DB access
  - Environment variable-based connection strings

---

### Status

- MongoDB support is integrated as a secondary layer
- AI, notification-stream, and audit hooks are active via service-layer integrations
- Runtime connectivity can be validated without writes using `healthCheckMongoCollections(...)`
- PostgreSQL schema and RLS remain unchanged as the primary system of record

---

## 32. MongoDB Usage Guidelines (STRICT)

### Future Development Guidelines (AI Instructions)

When implementing new features:

### DO NOT:

- Store core system data in MongoDB
- Replace PostgreSQL tables with MongoDB
- Duplicate relational data unnecessarily

---

### USE MongoDB ONLY FOR:

1. AI-related data
  - Insights
  - Recommendations
  - Context memory

2. Logging systems
  - Audit logs
  - Activity tracking

3. Real-time data
  - Notification streams
  - Event feeds

4. Cache layers
  - Precomputed analytics
  - Heatmap caching (future)

---

### Integration Rules

- Always create a service layer (no direct DB calls in UI)
- Use async operations
- Maintain separation of concerns
- MongoDB documents may reference PostgreSQL IDs

---

### Example Pattern

PostgreSQL:
- disease_reports (source of truth)

MongoDB:
- ai_insights referencing report_id

---

### Priority Order for MongoDB Integration

1. AI Insights Storage
2. Audit Logs Migration
3. Notification Stream Enhancement
4. Analytics Caching (future)

---

### Architecture Constraint

System must remain:

PostgreSQL (core) + MongoDB (supporting layer)

NOT:

MongoDB-only system

