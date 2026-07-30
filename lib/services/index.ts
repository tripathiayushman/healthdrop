// =====================================================
// SERVICES INDEX - Export all services
// =====================================================

export { diseaseReportsService } from './diseaseReports';
export { waterQualityService } from './waterQuality';
export { campaignsService } from './campaigns';
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
