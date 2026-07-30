# HealthDrop Feature Roadmap (agent-ideated, ranked)

I have grounded myself in the codebase (schema in `database_structure/*.sql`, services in `lib/services/`, offline sync in `src/services/offlineSync/`, 13 screens, 4 forms, shared kit). Key findings that shaped these proposals: an offline queue exists but has zero UI; the `outbreaks` table is written by a DB trigger but has no management screen; `treatment_status`, `rejection_reason`, `images TEXT[]`, and PostGIS `heatmap_view` all exist in the schema but are unused or write-only from the client; there is no i18n despite ASHA-worker users.

FEATURE PROPOSALS — ranked by impact-to-effort ratio

1. Sync Outbox and Connectivity Center
- Rationale: `src/services/offlineSync/` already queues disease and water reports offline with idempotency keys, but workers have no way to see what is pending, failed, or synced — a report silently stuck in AsyncStorage is a missed outbreak signal. A visible outbox turns invisible infrastructure into trust: workers in low-signal areas can confirm "my 3 reports will go when I get network," retry failures, and delete duplicates.
- Implementation: New `components/screens/SyncOutboxScreen.tsx` reading `syncQueue.getAll()` from `src/services/offlineSync/SyncQueue.ts`; add a persistent NetInfo-driven banner + pending-count badge in `components/Navbar.tsx` and `components/dashboards/DashboardShared.tsx`. No new tables — queue is local; server dedup already handled by `client_idempotency_key` (OFFLINE_SYNC_SCHEMA.sql).
- Effort: S. Impact: High.

2. My Submissions Status Tracker with Rejection Feedback
- Rationale: The approval workflow (`approval_status`, `rejection_reason` on disease_reports/health_alerts/campaigns) exists, but rejection reasons are only shown in admin screens (`ApprovalQueueScreen.tsx`, `AdminManagementScreen.tsx`). The ASHA worker who filed the report never learns why it was rejected, so data quality never improves and workers feel ignored. A personal timeline (pending → approved/rejected, with reason and one-tap "fix and resubmit") closes the loop.
- Effort: S. Impact: High.
- Implementation: New `components/screens/MySubmissionsScreen.tsx` querying `disease_reports`, `water_quality_reports`, `health_alerts` filtered by `reporter_id/created_by = auth.uid()` (RLS already permits own-row reads); resubmit pre-fills `DiseaseReportForm.tsx` via initial values. Surface status chips with existing `components/shared/StatusBadge.tsx`.

3. Case Outcome Follow-up Worklist
- Rationale: `disease_reports.treatment_status` ('pending', 'in_treatment', 'recovered', 'deceased') is captured once at entry and never updated — yet outcome data is what distinguishes surveillance from mere counting. A "Follow-ups due" worklist showing the worker's own reports still pending/in_treatment older than N days, with a one-tap outcome update, gives officers real case-fatality and recovery data with zero new schema.
- Implementation: Section in AshaWorkerDashboard/ClinicDashboard (`components/dashboards/`) plus a filter tab in `components/screens/ReportsScreen.tsx`; update via `lib/services/diseaseReports.ts` (RLS "Users can update own reports" already allows it). Sort by `created_at` ascending, badge count in sidebar.
- Effort: S/M. Impact: High.

4. Duplicate and Cluster Warning at Report Entry
- Rationale: Multiple workers reporting the same village outbreak inflate case counts; conversely, a worker has no idea their single cholera case is the fourth within 5 km this week. Before submit, query recent reports for same disease + district (or PostGIS radius via `heatmap_view` / ST_DWithin RPC from GEOGRAPHIC_HEATMAP.sql) and show either "possible duplicate — add cases to existing report?" or "cluster forming: 3 similar reports nearby" — this both cleans data and makes every worker an early-warning sensor.
- Implementation: Pre-submit check in `components/forms/DiseaseReportForm.tsx` calling a new function in `lib/services/diseaseReports.ts` (`disease_reports` table + optional `check_reports_within_radius` RPC); reuse `components/shared/SubmissionModal.tsx` for the warning dialog. Complements the DB-level ALERT_DEDUPLICATION_SYSTEM.sql.
- Effort: M. Impact: High.

5. Outbreak Response Console
- Rationale: OUTBREAK_DETECTION.sql auto-creates rows in `outbreaks` (with status lifecycle active → monitoring → resolved, response tracking columns, and linked trigger report), but no screen manages them — detection fires notifications and then the record dies. District officers need one place to see active outbreaks, the epi curve of linked reports, and to transition status with response notes; this is the core officer job the app claims to do.
- Implementation: New `components/screens/OutbreakConsoleScreen.tsx` reading `outbreaks` (RLS exists), joining `disease_reports` by disease_name + district + window for an epi curve rendered with existing `components/charts/TrendChart.tsx`; status updates via a new `lib/services/outbreaks.ts`. Wire into DistrictOfficerDashboard and HealthAdminDashboard.
- Effort: M. Impact: High.

6. Unsafe Water Source Watchlist with Retest Reminders
- Rationale: `water_quality_reports` has `status = 'action_required'` and `overall_quality` ('unsafe', 'critical'), but nothing tracks whether a contaminated handpump was ever retested — the single most preventable waterborne-disease failure mode. Group reports client-side by source_name + location into a de-facto source registry: each unsafe source shows days-since-last-test, and workers get a "retest due" list; officers see district-level unresolved-source counts.
- Implementation: New `components/screens/WaterWatchlistScreen.tsx` + aggregation logic in `lib/services/waterQuality.ts` (existing `water_quality_reports` table and `water_quality_statistics` view); "Retest now" pre-fills `WaterQualityReportForm.tsx` with the source's details. Optional local notification via expo-notifications.
- Effort: M. Impact: High.

7. One-Tap Weekly District Report Export (IDSP-style)
- Rationale: District officers in India must compile weekly IDSP-format summaries; today they would hand-transcribe from dashboards. Auto-generate a weekly digest — cases/deaths by disease, new unsafe water sources, active outbreaks, campaign reach — as shareable CSV/PDF/text (WhatsApp share is the real distribution channel in Indian health administration), making the app the system of record rather than a parallel toy.
- Implementation: New `components/screens/WeeklyReportScreen.tsx` (or section in DistrictOfficerDashboard) aggregating `disease_reports`, `water_quality_reports`, `outbreaks`, `health_campaigns` for the ISO week; export via expo-print (PDF) + expo-sharing / React Native Share API; reuse `lib/services/advancedAnalytics.ts` scoping helpers.
- Effort: M. Impact: High.

8. District Advisory Broadcasts with Read Receipts
- Rationale: The `notifications` table already supports `target_role` + `target_district` broadcast and `is_read/read_at`, and push infra (PUSH_NOTIFICATIONS.sql outbox + edge function) exists — but only admins can compose. Letting district officers push advisories ("chlorinate all wells in block X before monsoon") to every ASHA in their district, and see who has read them, converts one-way surveillance into two-way command-and-control.
- Implementation: Composer UI in DistrictOfficerDashboard using `lib/services/notifications.ts`; read-receipt tally by querying `notifications` rows. Needs one RLS addition (allow `district_officer` INSERT scoped to own district) — a small migration alongside existing policies; delivery rides the existing `push_notification_outbox` trigger chain.
- Effort: M. Impact: Med-High.

9. Photo Evidence Capture for Water and Disease Reports
- Rationale: `water_quality_reports.images TEXT[]` and campaign `images` columns exist but no form uploads anything — verifiers approve reports blind. A photo of a turbid well, a test strip, or a rash dramatically raises verification confidence and reduces rejected reports; it also works offline (queue the file, upload on sync).
- Implementation: Add expo-image-picker capture to `components/forms/WaterQualityReportForm.tsx` and `DiseaseReportForm.tsx`, upload to a Supabase Storage bucket, write URLs into the existing `images` column; thumbnail strip in `ApprovalQueueScreen.tsx`. Extend `SyncQueue.ts` to hold base64 payloads for offline capture.
- Effort: M. Impact: Med-High.

10. Hindi and Regional Language Mode with Voice Input for Symptoms
- Rationale: The app has zero i18n, yet its primary field users are rural ASHA workers whose working language is not English; every English-only form is a data-quality tax. A lightweight i18n layer (Hindi first, then Assamese/Bengali given the NE-India SIH context) plus speech-to-text on the free-text symptoms/notes fields removes the biggest real-world adoption barrier.
- Implementation: i18n-js or react-i18next with string extraction across `components/forms/*` and `DashboardShared.tsx` first (highest-traffic surfaces); language picker in `ProfileScreen.tsx` persisted to AsyncStorage; voice input via expo-speech-recognition on symptoms/notes fields. No new tables.
- Effort: M/L (M if scoped to forms + dashboard shell). Impact: High.

11. Campaign Field Check-in with GPS Attendance
- Rationale: `campaign_volunteers` already models status ('attended'/'absent'), `hours_contributed`, and `tasks_completed`, but attendance is presumably hand-edited. A "Check in" button visible during an ongoing campaign stamps time + GPS (from the existing `useLocation` hook), giving coordinators live headcounts and honest reach numbers for `reached_population`.
- Implementation: Button in `components/screens/CampaignsScreen.tsx` for enrolled volunteers when campaign status = 'ongoing'; writes to `campaign_volunteers` via `lib/services/campaigns.ts` (RLS "Users can update own enrollment" already permits); coordinator roster view in `CampaignIntelligenceScreen.tsx`.
- Effort: S/M. Impact: Med.

12. Seasonal Disease Preparedness Prompts
- Rationale: Indian disease burden is brutally seasonal (monsoon → cholera/dengue/leptospirosis; winter → respiratory). A small client-side seasonal calendar, cross-referenced with the district's own prior-year pattern from the `disease_statistics` view, prompts officers pre-season ("dengue rose 4x in your district last August — plan larvicide campaign now") and nudges the right campaign templates in `CampaignForm.tsx`.
- Implementation: Static season-disease map in a new `lib/services/seasonal.ts` + historical query against `disease_statistics` view (`disease_reports` underneath); banner card in `DashboardShared.tsx` on district officer/health admin dashboards; "create campaign" deep-link pre-filling `components/forms/CampaignForm.tsx`.
- Effort: S. Impact: Med.

Cross-cutting note: items 1, 2, and 3 are nearly pure client work against already-deployed schema and would visibly transform the ASHA worker experience in one sprint; items 5 and 6 activate server infrastructure (outbreaks table, water status lifecycle) that already exists but is currently dead weight. Only item 8 requires any migration (one RLS policy). Deliberately excluded as poor fit: contact tracing and household line-lists (need new tables, L effort), offline map tiles (L, low marginal value over cached Leaflet), and SMS fallback (requires paid gateway/edge infra beyond existing functions).
