export interface Profile {
  id: string;
  full_name: string;
  role: 'super_admin' | 'health_admin' | 'clinic' | 'asha_worker' | 'volunteer' | 'district_officer';

  organization: string;
  location: string;
  created_at?: string;
  is_active?: boolean;
}