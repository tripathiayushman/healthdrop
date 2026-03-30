<div align="center">

# 🏥 HealthDrop Surveillance System

**A cross-platform mobile app for real-time public health threat detection, reporting, and coordinated response.**

[![React Native](https://img.shields.io/badge/React_Native-0.81.5-61DAFB?logo=react)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-SDK_54-000020?logo=expo)](https://expo.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_+_RLS-3ECF8E?logo=supabase)](https://supabase.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://typescriptlang.org/)

</div>

---

## 📱 Overview

**HealthDrop** bridges the gap between community-level field workers, healthcare facilities, and public health administrators. It enables rapid detection and coordinated response to disease outbreaks, contaminated water sources, and other public health threats — especially in rural and semi-urban areas.

### Core Features

| Feature | Description |
|---|---|
| 🦠 **Disease Reporting** | Document outbreaks with severity, location, and patient details |
| 💧 **Water Quality Monitoring** | Report contaminated water sources with chemical parameters |
| 🚨 **Health Alerts** | Urgency-graded alerts propagate to affected districts within a 10 km radius |
| 📋 **Campaign Management** | Create, manage, and enroll in health campaigns |
| ✅ **Approval Workflow** | Verify → Approve → Reject pipeline with rejection reasons |
| 🤖 **AI Health Insights** | Location-aware insights powered by direct OpenRouter Chat Completions |
| 🔔 **Push Notifications** | Real-time Expo push notifications sent to users in the affected 10 km alert zone |
| 📡 **Offline Sync** | Reports queued locally and synced when connectivity resumes |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native 0.81.5 + Expo SDK 54 |
| Web | react-native-web (Android / iOS / Web) |
| Language | TypeScript 5.9 |
| Backend | Supabase (PostgreSQL + Auth + Row-Level Security) |
| AI | Direct OpenRouter Chat Completions API (`EXPO_PUBLIC_OPENROUTER_MODEL`) |
| Location | expo-location + district centroid fallback + 10 km radius matching |
| Gradients | expo-linear-gradient |
| Icons | @expo/vector-icons (Ionicons, MaterialCommunityIcons) |
| Dates | date-fns |

---

## 👥 User Roles

| Role | Description |
|---|---|
| 🔴 **Super Admin** | Full system control — manage users, approvals, all data globally |
| 🟠 **Health Admin** | Operational admin — approve reports, manage campaigns, send alerts |
| 🟣 **District Officer** | District-scoped governance — reports, campaigns, alerts within district |
| 🟡 **Clinic** | Medical verification — submit + verify/approve disease & water reports |
| 🔵 **ASHA Worker** | Field worker — submit disease/water reports, view district content |
| 🟢 **Volunteer** | Community participant — enroll in campaigns, view approved alerts |

---

## 📐 Architecture

```
┌──────────────────────────────────────┐
│           React Native App            │
│                                       │
│  ┌─────────────┐  ┌────────────────┐  │
│  │  Tab Bar    │  │  Full-Screen   │  │
│  │  Home       │  │  Overlays      │  │
│  │  Reports    │  │  (Forms, Queue,│  │
│  │  Campaigns  │  │   User Mgmt,  │  │
│  │  Profile    │  │   All Alerts) │  │
│  └─────────────┘  └────────────────┘  │
│                                       │
│  DashboardRouter → role-specific UI   │
│  AIChatbot (floating FAB overlay)     │
└────────────────┬──────────────────────┘
                 │ Supabase JS Client
┌────────────────▼──────────────────────┐
│              Supabase                  │
│  PostgreSQL + RLS + Auth + Realtime   │
│  Edge Functions (Push Notifications)  │
└───────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- A [Supabase](https://supabase.com) project

### 1. Clone
```bash
git clone https://github.com/tripathiayushman/healthdrop.git
cd healthdrop
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Create a `.env` file in the project root:
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_OPENROUTER_API_KEY=your-openrouter-api-key
EXPO_PUBLIC_OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

If you are upgrading from older builds, remove `EXPO_PUBLIC_GEMINI_API_KEY` and keep only OpenRouter variables.

Create your OpenRouter API key at [openrouter.ai](https://openrouter.ai/keys).

> **Supabase:** Create a project at [supabase.com](https://supabase.com)
> **OpenRouter:** Get a key at [openrouter.ai](https://openrouter.ai/keys)

### 4. Run
```bash
npx expo start --clear
```
- Press `a` for Android emulator
- Press `i` for iOS simulator
- Press `w` for web browser
- Scan QR with **Expo Go** app on your phone

---

## 📂 Project Structure

```
healthdrop/
├── App.tsx                     ← Root component
├── index.ts                    ← Entry point
├── .env.example                ← Environment template
│
├── types/                      ← TypeScript types
├── lib/
│   ├── supabase.ts             ← Supabase client
│   ├── ThemeContext.tsx        ← Dark/Light theme
│   └── services/              ← API service layer
│       ├── diseaseReports.ts
│       ├── waterQuality.ts
│       ├── campaigns.ts
│       ├── users.ts
│       └── notifications.ts
│
└── components/
    ├── MainApp.tsx             ← Navigation container
    ├── AuthScreen.tsx          ← Auth (sign in / sign up)
   ├── ai/                     ← OpenRouter-backed AI panel + chatbot
    ├── dashboards/             ← 6 role-specific dashboards
    ├── forms/                  ← Report / campaign / alert forms
    └── screens/                ← Tab screens + overlays
```

---

## 🔐 Security

- **Row-Level Security (RLS)** enforced at database level for all tables
- SECURITY DEFINER functions prevent RLS recursion (`get_my_role()`, `get_my_district()`)
- Automatic geographic scoping for district roles with 10 km alert-radius propagation
- `.env` file never committed to source control
- Auth tokens stored in `expo-secure-store` (encrypted on device)

---

## 🔄 Approval Workflow

```
Disease/Water Report Submitted
        │
        ▼
  [pending_approval]
        │
   ┌────┴────┐
   ▼         ▼
[approved] [rejected] → rejection_reason saved
   │
   ▼
[verified] ← Verify button (clinic / admin)
```

Campaigns and alerts also go through the same `pending_approval → approved/rejected` pipeline.

---

## 🤖 AI Integration

The app uses **direct OpenRouter Chat Completions** for insights and chat:

- **AIInsightsPanel** — Embedded in every dashboard; uses district/state/global context
- **AIChatbot** — Floating button → slide-up chat for health Q&A
- Uses `EXPO_PUBLIC_OPENROUTER_API_KEY` and `EXPO_PUBLIC_OPENROUTER_MODEL` directly
- Radius-filtered alert/report context is used for district-scoped users

OpenRouter free-tier usage can be constrained by request/throughput limits and availability windows; check OpenRouter docs for current limits: https://openrouter.ai/docs

---

## 🧾 Recent Major Updates (2026-03-30)

- Implemented 10 km alert propagation for district-scoped roles (district officer, clinic, ASHA worker, volunteer).
- Unified alert visibility across dashboards, All Alerts screen, map alert layer, and AI insights context.
- Updated push notification targeting so recipients match affected users in the same 10 km zone.
- Moved AI flow to direct OpenRouter calls from app service layer (`lib/services/gemini.ts`) with environment-driven model selection.
- Improved map location fallback with district aliases and centroid-based geographic matching.
- Reduced noisy runtime warnings (Expo push setup and Android navigation behavior).

## 🧾 Previous Major Updates (2026-03-27)

- Consolidated and applied a large CodeRabbit review batch across dashboards, reports, campaigns, queue flows, AI chat, and shared components.
- Added stronger runtime safety and UX handling: loading/error states, guarded async updates, safer date rendering, cleaner logs.
- Improved accessibility for icon-only actions and modal controls.
- Improved type safety in map and approval queue flows with stricter unions/interfaces.
- Added CI/CD release automation:
   - `prepare-release.yml` (manual release prep + tag)
   - `build-android-release.yml` (tag-triggered EAS APK + GitHub release)
   - `eas.json` and `scripts/sync-version.cjs`

## 🌍 External Setup Needed (Outside VS Code)

Only required if you have not already configured these:

1. OpenRouter account
- Create/manage your API key at `https://openrouter.ai/keys`.

2. GitHub repository secrets
- Add `EXPO_TOKEN` for Android release workflow.

3. Expo/EAS project setup
- Ensure EAS project linkage and Android credentials are configured for release builds.

4. Database patching (if pending)
- Execute `database_structure/FIX_CLINIC_RLS_POLICIES.sql`.
- Execute `database_structure/FIX_VERIFICATION_AND_VISIBILITY.sql`.

---

## 📱 Screens

| Screen | Access | Description |
|---|---|---|
| Dashboard | All roles | Role-specific statistics, radius-filtered alerts, quick actions |
| Reports | All roles | Disease + water reports with role-aware filters |
| Campaigns | All roles | Campaign list; create/manage (super_admin+health_admin+district_officer+asha_worker); enroll (volunteer+asha_worker) |
| All Alerts | All roles | Full alert list with search + urgency filter + 10 km radius visibility for district roles |
| Approval Queue | Super Admin + Health Admin + District Officer + Clinic | Verify/Approve/Reject with role-scoped tabs and permissions |
| User Management | Super Admin + Health Admin | User role management and account status |
| Profile | All roles | Settings, theme toggle, logout |

---

## 🌐 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  Built with ❤️ using React Native, Expo, and Supabase
</div>
