// =====================================================
// PROVISIONING SERVICE — admin invitations + role verification
// public.role_invitations (id, email, role, district, state,
// invited_by, created_at, claimed_at, claimed_by).
// RLS: super_admin full; health_admin may create/see invites
// for district_officer/clinic/asha_worker only. One open
// invite per lower(email) — the DB enforces uniqueness.
// A DB trigger (handle_new_user) claims the invite at signup:
// the invited email arrives with role/district pre-verified.
// profiles.role_verified: self-signed-up clinic/asha start
// FALSE until an admin verifies; verifying is an UPDATE that
// both super_admin and health_admin RLS permit.
// =====================================================
import { supabase } from '../supabase';
import { ApiResponse } from '../../types';

/** Roles an invitation may carry (matches the DB CHECK constraint). */
export type InvitableRole = 'health_admin' | 'district_officer' | 'clinic' | 'asha_worker';

export const INVITABLE_ROLES: InvitableRole[] = [
  'health_admin',
  'district_officer',
  'clinic',
  'asha_worker',
];

export interface RoleInvitation {
  id: string;
  email: string;
  role: InvitableRole;
  district: string | null;
  state: string | null;
  invited_by: string | null;
  created_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
}

/** Roles whose self-signup starts unverified and needs admin confirmation. */
const UNVERIFIED_SIGNUP_ROLES = ['clinic', 'asha_worker'] as const;

/**
 * Resolve the signed-in user id — getSession() first (reads local
 * storage, no network), falling back to getUser() only when the
 * cached session is missing.
 */
async function currentUserId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) return session.user.id;
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

const isUniqueViolation = (error: { code?: string; message?: string | null }): boolean => {
  if (error?.code === '23505') return true;
  const msg = String(error?.message ?? '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('already exists');
};

/**
 * All invitations the caller is allowed to see (RLS scopes the set),
 * open first (created_at desc), then claimed (claimed_at desc).
 */
export async function listInvitations(): Promise<ApiResponse<RoleInvitation[]>> {
  try {
    const { data, error } = await supabase
      .from('role_invitations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as RoleInvitation[];
    const open = rows.filter(r => !r.claimed_at);
    const claimed = rows
      .filter(r => !!r.claimed_at)
      .sort((a, b) => String(b.claimed_at).localeCompare(String(a.claimed_at)));
    return { data: [...open, ...claimed], error: null };
  } catch (error: any) {
    console.error('Error listing invitations:', error);
    return { data: null, error: error.message ?? 'Failed to load invitations' };
  }
}

/**
 * Create an open invitation. The invited email signs up normally and
 * the DB trigger assigns the role/district pre-verified — no email is
 * sent by this call. Duplicate open invite for the same email surfaces
 * as a friendly error, not an exception.
 */
export async function createInvitation(input: {
  email: string;
  role: InvitableRole;
  district?: string | null;
  state?: string | null;
}): Promise<ApiResponse<RoleInvitation>> {
  try {
    const email = input.email.trim().toLowerCase();
    if (!email) throw new Error('Email is required');

    const invitedBy = await currentUserId();
    if (!invitedBy) throw new Error('You must be signed in to invite an official.');

    const { data, error } = await supabase
      .from('role_invitations')
      .insert({
        email,
        role: input.role,
        district: input.district?.trim() || null,
        state: input.state?.trim() || null,
        invited_by: invitedBy,
      })
      .select()
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        return { data: null, error: 'An open invitation already exists for this email.' };
      }
      throw error;
    }
    return { data: data as RoleInvitation, error: null };
  } catch (error: any) {
    console.error('Error creating invitation:', error);
    return { data: null, error: error.message ?? 'Failed to create invitation' };
  }
}

/**
 * Revoke (delete) an OPEN invite. Claimed invites are history and are
 * never deleted here. If RLS filtered the row away (or it was already
 * claimed), the caller gets an honest error instead of a silent no-op.
 */
export async function revokeInvitation(id: string): Promise<ApiResponse<null>> {
  try {
    const { data, error } = await supabase
      .from('role_invitations')
      .delete()
      .eq('id', id)
      .is('claimed_at', null)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return { data: null, error: 'Invitation was already claimed or removed.' };
    }
    return { data: null, error: null };
  } catch (error: any) {
    console.error('Error revoking invitation:', error);
    return { data: null, error: error.message ?? 'Failed to revoke invitation' };
  }
}

/**
 * Confirm a self-signed-up clinic/ASHA account really holds that role.
 * Sets profiles.role_verified = true — allowed for both super_admin and
 * health_admin by RLS (role itself stays pinned for health_admin).
 */
export async function verifyRole(profileId: string): Promise<ApiResponse<null>> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update({ role_verified: true, updated_at: new Date().toISOString() })
      .eq('id', profileId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return { data: null, error: "Couldn't verify — you may not have permission for this user." };
    }
    return { data: null, error: null };
  } catch (error: any) {
    console.error('Error verifying role:', error);
    return { data: null, error: error.message ?? 'Failed to verify role' };
  }
}

/**
 * How many active clinic/ASHA accounts are still awaiting verification —
 * drives the badge on admin surfaces. RLS scopes the count to what the
 * caller may see; failure returns an error, never a fake zero.
 */
export async function unverifiedCount(): Promise<ApiResponse<number>> {
  try {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('role', [...UNVERIFIED_SIGNUP_ROLES])
      .eq('role_verified', false)
      .eq('is_active', true);
    if (error) throw error;
    return { data: count ?? 0, error: null };
  } catch (error: any) {
    console.error('Error counting unverified users:', error);
    return { data: null, error: error.message ?? 'Failed to count unverified users' };
  }
}

export const provisioningService = {
  listInvitations,
  createInvitation,
  revokeInvitation,
  verifyRole,
  unverifiedCount,
};

export default provisioningService;
