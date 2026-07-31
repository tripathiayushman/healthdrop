// =====================================================
// USER MANAGEMENT SERVICE
// =====================================================
import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { Profile, ApiResponse } from '../../types';
import { sanitizeSearchTerm } from './searchSanitize';

export const usersService = {
  // Get all users (Admin only)
  async getAll(options?: {
    page?: number;
    pageSize?: number;
    role?: string;
    district?: string;
    isActive?: boolean;
    searchQuery?: string;
  }): Promise<ApiResponse<Profile[]>> {
    try {
      const { page = 1, pageSize = 20, role, district, isActive, searchQuery } = options || {};
      const offset = (page - 1) * pageSize;

      let query = supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (role) query = query.eq('role', role);
      if (district) query = query.eq('district', district);
      if (isActive !== undefined) query = query.eq('is_active', isActive);
      if (searchQuery) {
        const term = sanitizeSearchTerm(searchQuery);
        if (term) {
          query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
        }
      }

      const { data, error, count } = await query;

      if (error) throw error;

      return { data: data as Profile[], error: null, count: count || 0 };
    } catch (error: any) {
      console.error('Error fetching users:', error);
      return { data: null, error: error.message };
    }
  },

  // Get user by ID
  async getById(id: string): Promise<ApiResponse<Profile>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      return { data: data as Profile, error: null };
    } catch (error: any) {
      console.error('Error fetching user:', error);
      return { data: null, error: error.message };
    }
  },

  // Get current user profile
  async getCurrentUser(): Promise<ApiResponse<Profile>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      return this.getById(user.id);
    } catch (error: any) {
      console.error('Error fetching current user:', error);
      return { data: null, error: error.message };
    }
  },

  // Update user profile
  async update(id: string, updates: Partial<Profile>): Promise<ApiResponse<Profile>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as Profile, error: null };
    } catch (error: any) {
      console.error('Error updating user:', error);
      return { data: null, error: error.message };
    }
  },

  // Update current user profile
  async updateCurrentUser(updates: Partial<Profile>): Promise<ApiResponse<Profile>> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      return this.update(user.id, updates);
    } catch (error: any) {
      console.error('Error updating current user:', error);
      return { data: null, error: error.message };
    }
  },

  // Toggle user active status (Admin only)
  async toggleActive(id: string): Promise<ApiResponse<Profile>> {
    try {
      const { data: user, error: fetchError } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      const { data, error } = await supabase
        .from('profiles')
        .update({ is_active: !user.is_active })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as Profile, error: null };
    } catch (error: any) {
      console.error('Error toggling user status:', error);
      return { data: null, error: error.message };
    }
  },

  // Change user role (Admin only)
  async changeRole(id: string, role: Profile['role']): Promise<ApiResponse<Profile>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { data: data as Profile, error: null };
    } catch (error: any) {
      console.error('Error changing user role:', error);
      return { data: null, error: error.message };
    }
  },

  // Get user statistics
  async getStatistics(): Promise<ApiResponse<{
    totalUsers: number;
    activeUsers: number;
    adminCount: number;
    clinicCount: number;
    ashaCount: number;
    volunteerCount: number;
  }>> {
    try {
      const { count: total } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });

      const { count: active } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);

      const { count: adminCount } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('role', ['super_admin', 'health_admin']);

      const { count: clinicCount } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'clinic');

      const { count: ashaCount } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'asha_worker');

      const { count: volunteerCount } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'volunteer');

      return {
        data: {
          totalUsers: total || 0,
          activeUsers: active || 0,
          adminCount: adminCount || 0,
          clinicCount: clinicCount || 0,
          ashaCount: ashaCount || 0,
          volunteerCount: volunteerCount || 0,
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error fetching user statistics:', error);
      return { data: null, error: error.message };
    }
  },

  // Get users by role
  async getByRole(role: Profile['role']): Promise<ApiResponse<Profile[]>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', role)
        .eq('is_active', true)
        .order('full_name', { ascending: true });

      if (error) throw error;

      return { data: data as Profile[], error: null };
    } catch (error: any) {
      console.error('Error fetching users by role:', error);
      return { data: null, error: error.message };
    }
  },

  // Get users by district
  async getByDistrict(district: string): Promise<ApiResponse<Profile[]>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('district', district)
        .eq('is_active', true)
        .order('full_name', { ascending: true });

      if (error) throw error;

      return { data: data as Profile[], error: null };
    } catch (error: any) {
      console.error('Error fetching users by district:', error);
      return { data: null, error: error.message };
    }
  },

  // Search users
  async search(query: string): Promise<ApiResponse<Profile[]>> {
    try {
      const term = sanitizeSearchTerm(query);
      if (!term) {
        return { data: [], error: null };
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(20);

      if (error) throw error;

      return { data: data as Profile[], error: null };
    } catch (error: any) {
      console.error('Error searching users:', error);
      return { data: null, error: error.message };
    }
  },

  // Register Expo push token — call after login on physical device.
  // Transition period: writes BOTH the legacy profiles.expo_push_token column
  // (one token per user — the current server-side send path) AND the new
  // multi-device user_push_tokens table (token is the PK, so re-registering a
  // token under a new account MOVES it via upsert on token). Each write fails
  // soft on its own so the old path keeps working if the new table is missing.
  async registerExpoPushToken(token: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !token) return;

      await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', user.id);

      // claim_push_token is a SECURITY DEFINER RPC: unlike a direct upsert
      // (blocked by owner-only RLS when the token row belongs to another
      // user), it can MOVE a shared device's token to the current account.
      const { error: tokenTableError } = await supabase.rpc('claim_push_token', {
        p_token: token,
        p_platform: Platform.OS,
      });
      if (tokenTableError) {
        // Non-critical — the legacy profiles column above remains the fallback
        console.warn('[Push] claim_push_token failed:', tokenTableError.message);
      }
    } catch (err) {
      // Non-critical — never block the login flow
      console.warn('[Push] Failed to register token:', err);
    }
  },
};

// Clear the Expo push token on the caller's own profile row — call BEFORE
// supabase.auth.signOut() so the signed-out device stops receiving pushes for
// the previous account. Uses getSession() (local read, works offline) because
// during sign-out we must not depend on a network auth round-trip.
export async function clearExpoPushToken(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    await supabase
      .from('profiles')
      .update({ expo_push_token: null })
      .eq('id', userId);

    // Transition period: also drop this user's rows from the new multi-device
    // table. Fail-soft — RLS lets a user delete only their own rows anyway.
    const { error: tokenTableError } = await supabase
      .from('user_push_tokens')
      .delete()
      .eq('user_id', userId);
    if (tokenTableError) {
      console.warn('[Push] user_push_tokens delete failed:', tokenTableError.message);
    }
  } catch (err) {
    // Non-critical — never block the sign-out flow
    console.warn('[Push] Failed to clear token:', err);
  }
}

export default usersService;
