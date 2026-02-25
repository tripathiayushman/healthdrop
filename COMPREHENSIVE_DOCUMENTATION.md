# HealthDrop Surveillance System — Comprehensive Documentation

> **Last Updated:** 2026-02-25
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

---

## 1. Application Overview

**HealthDrop** is a cross-platform React Native + Expo mobile surveillance application backed by Supabase (PostgreSQL + Auth + RLS). It enables rapid detection, reporting, and coordinated response to public health threats.

### Core Features

| Feature | Description |
|---|---|
| Disease reporting | Document and track new disease cases with severity, location, patient details |
| Water quality monitoring | Report contaminated water sources with chemical parameters |
| Health alert broadcasting | Urgency-graded alerts (Low/Medium/High/Critical) to relevant geographic zones |
| Campaign management | Create, manage, and enroll in vaccination/awareness/sanitation campaigns |
| Admin governance | User management, approval queues, analytics |
| AI Health Insights | Gemini 2.0-powered contextual health insights per district/state |
| Offline sync | Reports queued locally and synced when connectivity resumes |
| Push notifications | Expo push notifications for alerts and approvals |

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
| Storage | expo-secure-store / AsyncStorage | |
| AI | Google Gemini REST API (gemini-2.0-flash-lite) | |
| Location | expo-location + Nominatim | |
| Notifications | Expo Push Notifications | |

---

## 3. Architecture

```
┌───────────────────────────────────────┐
│            React Native App            │
│  ┌──────────────┐  ┌───────────────┐  │
│  │  Tab Bar     │  │  Overlay Nav  │  │
│  │  Home        │  │  Forms        │  │
│  │  Reports     │  │  Approval Q   │  │
│  │  Campaigns   │  │  User Mgmt    │  │
│  │  Profile     │  │  All Alerts   │  │
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
│  Edge Functions (push notifications)  │
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
| View all | ✅ | ✅ | 🔵 district | 🔵 district | 🔵 district | 🔵 district |
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
disease_name text, cases_count int, severity text (mild/moderate/severe/critical),
status text DEFAULT 'reported' (reported/verified),
approval_status text DEFAULT 'pending_approval' (pending_approval/approved/rejected),
approved_by uuid, approved_at timestamptz, rejection_reason text,
district text, state text, location_name text, latitude float, longitude float,
patient_age int, patient_gender text, symptoms text[], notes text,
client_idempotency_key text UNIQUE, created_at timestamptz
```

#### `water_quality_reports`
```sql
id uuid PK, reporter_id uuid→profiles,
source_name text, source_type text, overall_quality text (safe/unsafe/critical),
status text DEFAULT 'reported' (reported/verified),
approval_status text DEFAULT 'pending_approval' (pending_approval/approved/rejected),
approved_by uuid, approved_at timestamptz, rejection_reason text,
ph_level numeric, turbidity numeric, chlorine_level numeric, tds_level numeric, bacteria_count numeric,
district text, state text, location_name text, latitude float, longitude float,
client_idempotency_key text UNIQUE, created_at timestamptz
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
created_by uuid→profiles, created_at timestamptz
```

#### `notifications`
```sql
id uuid PK, recipient_id uuid→profiles, sender_id uuid→profiles,
title text, message text, type text, is_read boolean DEFAULT false,
created_at timestamptz
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
3. Triggers set `reporter_id`/`created_by` on INSERT so users can't spoof
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

---

## 9. Approval Workflow

### States
```
pending_approval → approved
pending_approval → rejected
approved → rejected (re-review, admin/clinic)
rejected → approved (re-review, admin/clinic)
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
| Re-review (change approved→rejected etc.) | admin + clinic (always shown, not just pending) |

### Campaign Approval
- Created with `status: 'planned'`, `approval_status: 'pending_approval'`
- Approve/Cancel/Complete: super_admin, health_admin, district_officer (own district)
- **Clinic cannot manage campaigns**

---

## 10. Screens & Navigation

### Screen Types
```typescript
type ScreenType = 'tabs' | 'new-disease-report' | 'new-water-report' |
  'new-campaign' | 'new-alert' | 'admin-management' | 'user-management' |
  'approval-queue' | 'all-alerts';
```

### Tab Bar (visible to all roles)
| Tab | Screen | Notes |
|---|---|---|
| Home | DashboardRouter | Routes to role-specific dashboard |
| Reports | ReportsScreen | Role-aware status + approval filters |
| Campaigns | CampaignsScreen | Create/manage: admin+DO only; Enroll: asha+volunteer |
| Profile | ProfileScreen | Settings, theme, logout |

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

### ApprovalQueueScreen
- Deep-link: `navigateToForm('approval-queue:water')` pre-selects Water tab
- **Clinic tabs:** Disease, Water, Campaigns, Alerts
- **District Officer tabs:** Disease, Water, Campaigns
- **Delete:** super_admin, health_admin only
- **Verify/Approve/Reject:** admin + clinic

### AllAlertsScreen
- Search bar + urgency filter chips (All / Critical / High / Medium / Low)
- Pull-to-refresh
- Left-border urgency color coding
- Detail modal with description, location, date
- Volunteers: own district only

### ReportsScreen
- Status filter chips: volunteers see Reported/Verified only
- Admin/clinic: additional Approval Status section (Pending/Approved/Rejected)
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
| asha_worker | AshaWorkerDashboard | Disease Report, Water Report |
| volunteer | VolunteerDashboard | Browse Campaigns, View Alerts |

### DashboardShared Components
- `DashboardHeader` — LinearGradient header with role badge + greeting
- `Section` — titled content section with optional style
- `StatCard` — icon + number + label card
- `QuickActionBtn` — icon + label button grid item
- `AlertCard` — alert with urgency left-border color
- `ToolCard` — icon + title + subtitle + chevron + optional badge
- `EmptyState` — icon + title + subtitle
- `SectionDivider` — visual separator

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
| Alert | `AlertForm.tsx` | admin+district_officer only; role-aware messaging |

---

## 13. AI Integration

### Gemini API (`lib/services/gemini.ts`)
- Model cascade: `gemini-2.0-flash-lite` → `gemini-1.5-flash-8b` → `gemini-1.5-flash`
- 30-minute insight cache per location scope
- Retry backoff on rate limiting
- 2-second chat cooldown

### AIInsightsPanel (`components/ai/AIInsightsPanel.tsx`)
- Scope: district → state → global (based on profile)
- Shimmer skeleton loading state
- Expand/collapse detail view
- Mounted in all 6 dashboards

### AIChatbot (`components/ai/AIChatbot.tsx`)
- Floating action button (bottom-right)
- Slide-up chat panel
- `useNativeDriver: false` for web compatibility
- Mounted as absolute overlay in `MainApp.tsx`

---

## 14. SQL Files Reference (`database_structure/`)

| File | Purpose | Status |
|---|---|---|
| `DATABASE_SCHEMA.sql` | Full schema with all tables, constraints, indexes | ✅ Canonical |
| `APPROVAL_SYSTEM.sql` | Core approval workflow RLS policies | ✅ Applied |
| `ALERT_APPROVAL_WORKFLOW.sql` | Health alerts approval + trigger | ✅ Applied |
| `AUDIT_LOG.sql` | audit_logs table + audit triggers | ✅ Applied |
| `DISTRICT_OFFICER_RLS.sql` | Complete district_officer RLS across all tables | ✅ Applied |
| `ENUM_MIGRATION.sql` | Role type enum updates | ✅ Applied |
| `FIX_CLINIC_RLS_POLICIES.sql` | Clinic UPDATE (disease/water); removes clinic from campaign management | ⚠️ **Apply in Supabase** |
| `FIX_PROFILES_RLS_RECURSION.sql` | SECURITY DEFINER helpers (get_my_role, get_my_district) | ✅ Applied |
| `FIX_REPORT_SUBMISSION_RLS.sql` | Stale trigger fix + idempotent policy recreation | ✅ Applied |
| `FIX_VERIFICATION_AND_VISIBILITY.sql` | Visibility + verify update policies | ⚠️ **Apply in Supabase** |
| `GEOGRAPHIC_HEATMAP.sql` | Materialized view for geographic heatmap analytics | 🔵 Optional |
| `OFFLINE_SYNC_SCHEMA.sql` | client_idempotency_key columns for offline sync | ✅ Applied |
| `OUTBREAK_DETECTION.sql` | Outbreak detection PostgreSQL function | 🔵 Optional |
| `PERFORMANCE_INDEXES.sql` | 20+ composite and partial indexes | ✅ Applied |
| `PUSH_NOTIFICATIONS.sql` | expo_push_token column + edge function schema | ✅ Applied |
| `USER_FEEDBACK_TABLE.sql` | user_feedback table definition | ✅ Applied |

---

## 15. Environment & Setup

### `.env` file
```
EXPO_PUBLIC_SUPABASE_URL=https://ekfdimdlxifatsaubvbh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
EXPO_PUBLIC_GEMINI_API_KEY=<gemini_key>
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
7. Run `FIX_REPORT_SUBMISSION_RLS.sql`
8. Run `FIX_VERIFICATION_AND_VISIBILITY.sql`
9. Run `FIX_CLINIC_RLS_POLICIES.sql`
10. Run `PERFORMANCE_INDEXES.sql`
11. Run `AUDIT_LOG.sql`
12. Optionally: `GEOGRAPHIC_HEATMAP.sql`, `OUTBREAK_DETECTION.sql`, `OFFLINE_SYNC_SCHEMA.sql`, `PUSH_NOTIFICATIONS.sql`

> **Supabase SQL Editor:** https://supabase.com/dashboard/project/ekfdimdlxifatsaubvbh/sql
