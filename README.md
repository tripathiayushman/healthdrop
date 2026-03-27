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
| 🚨 **Health Alerts** | Urgency-graded alerts (Low → Critical) broadcast to relevant zones |
| 📋 **Campaign Management** | Create, manage, and enroll in health campaigns |
| ✅ **Approval Workflow** | Verify → Approve → Reject pipeline with rejection reasons |
| 🤖 **AI Health Insights** | Location-aware insights powered by OpenRouter free models |
| 🔔 **Push Notifications** | Real-time alerts via Expo push notifications |
| 📡 **Offline Sync** | Reports queued locally and synced when connectivity resumes |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native 0.81.5 + Expo SDK 54 |
| Web | react-native-web (Android / iOS / Web) |
| Language | TypeScript 5.9 |
| Backend | Supabase (PostgreSQL + Auth + Row-Level Security) |
| AI | OpenRouter Chat Completions API (`openrouter/free` + free fallbacks) |
| Location | expo-location + Nominatim reverse geocoding |
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
EXPO_PUBLIC_OPENROUTER_MODEL=openrouter/free
```

#### Migration from Gemini
If you are upgrading from the old Gemini setup, update your `.env` as follows:

- Remove: `EXPO_PUBLIC_GEMINI_API_KEY`
- Add/keep: `EXPO_PUBLIC_OPENROUTER_API_KEY`
- Add/keep: `EXPO_PUBLIC_OPENROUTER_MODEL`
- Add/keep: `EXPO_PUBLIC_SUPABASE_URL`
- Add/keep: `EXPO_PUBLIC_SUPABASE_ANON_KEY`

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
- Automatic role-scoping: district officers and clinics see only their geographic data
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

The app uses **OpenRouter free models** to generate contextual health insights:

- **AIInsightsPanel** — Embedded in every dashboard; shows district/state/global health trends
- **AIChatbot** — Floating button → slide-up chat for health Q&A
- 30-minute insight caching, model cascade fallback, 2-second chat cooldown

Model cascade fallback means the app tries a primary model first, then automatically retries with fallback models if the primary is unavailable or rate-limited. Common OpenRouter free models used as fallbacks include `meta-llama/llama-3.1-8b-instruct:free`, `mistralai/mistral-7b-instruct:free`, `google/gemma-2-9b-it:free`, and `qwen/qwen-2.5-7b-instruct:free`. OpenRouter free-tier usage can be constrained by request/throughput limits and availability windows; check OpenRouter docs for current limits: https://openrouter.ai/docs

---

## 🧾 Recent Major Updates (2026-03-27)

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

1. Supabase Edge Function
- Set function secrets: `OPENROUTER_API_KEY` (and optional `OPENROUTER_MODEL`).
- Deploy function: `supabase functions deploy openrouter-proxy`.

2. OpenRouter account
- Create/manage your API key at `https://openrouter.ai/keys`.

3. GitHub repository secrets
- Add `EXPO_TOKEN` for Android release workflow.

4. Expo/EAS project setup
- Ensure EAS project linkage and Android credentials are configured for release builds.

5. Database patching (if pending)
- Execute `database_structure/FIX_CLINIC_RLS_POLICIES.sql`.
- Execute `database_structure/FIX_VERIFICATION_AND_VISIBILITY.sql`.

---

## 📱 Screens

| Screen | Access | Description |
|---|---|---|
| Dashboard | All roles | Role-specific statistics, alerts, quick actions |
| Reports | All roles | Disease + water reports with role-aware filters |
| Campaigns | All roles | Campaign list; create/manage (admin+DO only); enroll (volunteer+asha) |
| All Alerts | All roles | Full alert list with search + urgency filter |
| Approval Queue | Admin + Clinic + DO | Verify/Approve/Reject disease, water, campaign, alert submissions |
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
