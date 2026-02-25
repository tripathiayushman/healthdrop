// =====================================================
// DASHBOARD ROUTER — picks the right dashboard by role
// Replaces the old monolithic DashboardScreen.tsx logic
// =====================================================
import React from 'react';
import { Profile } from '../../types';
import { SuperAdminDashboard }     from './SuperAdminDashboard';
import { HealthAdminDashboard }    from './HealthAdminDashboard';
import { ClinicDashboard }         from './ClinicDashboard';
import { AshaWorkerDashboard }     from './AshaWorkerDashboard';
import { VolunteerDashboard }      from './VolunteerDashboard';
import { DistrictOfficerDashboard } from './DistrictOfficerDashboard';

interface Props {
  profile: Profile;
  onNavigate: (screen: string) => void;
}

export const DashboardRouter: React.FC<Props> = ({ profile, onNavigate }) => {
  switch (profile.role) {
    case 'super_admin':
      return <SuperAdminDashboard profile={profile} onNavigate={onNavigate} />;
    case 'health_admin':
      return <HealthAdminDashboard profile={profile} onNavigate={onNavigate} />;
    case 'clinic':
      return <ClinicDashboard profile={profile} onNavigate={onNavigate} />;
    case 'asha_worker':
      return <AshaWorkerDashboard profile={profile} onNavigate={onNavigate} />;
    case 'district_officer':
      return <DistrictOfficerDashboard profile={profile} onNavigate={onNavigate} />;
    case 'volunteer':
    default:
      return <VolunteerDashboard profile={profile} onNavigate={onNavigate} />;
  }
};

export default DashboardRouter;
