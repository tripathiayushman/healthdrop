// =====================================================
// SERVICES INDEX - Export all services
// =====================================================

export { diseaseReportsService } from './diseaseReports';
export { waterQualityService } from './waterQuality';
// Campaign enrolment lives in components/screens/CampaignsScreen.tsx against
// campaign_participants. The old campaignsService wrote to campaign_volunteers
// (0 rows, nothing read it) and called an increment_volunteers RPC that does
// not exist — a dead parallel implementation. Removed 2026-08-02.
export { usersService } from './users';
export { notificationsService } from './notifications';
export { sanitizeSearchTerm } from './searchSanitize';
export {
	getDistrictHealthRanking,
	getCampaignEffectiveness,
	getCampaignIntelligence,
	getEscalationMonitoring,
	getAIAlerts,
} from './advancedAnalytics';
export {
	getRoleWidgetDefinitions,
	loadWidgetPreferences,
	persistWidgetPreferences,
	resetWidgetPreferences,
	useDashboardWidgetVisibility,
} from './widgetPreferences';
