-- =====================================================
-- FIX: Infinite recursion on profiles SELECT policy
-- =====================================================
-- The profiles_select_policy from DISTRICT_OFFICER_RLS.sql uses
-- "SELECT 1 FROM profiles" inside a policy ON profiles, causing
-- PostgreSQL error 42P17: infinite recursion.
--
-- Fix: use get_my_role() (SECURITY DEFINER — bypasses RLS) for
-- the admin check, and a new SECURITY DEFINER helper for the
-- district-officer district match.
-- =====================================================

-- ── Helper: get current user's district (SECURITY DEFINER = no RLS) ─────────
CREATE OR REPLACE FUNCTION get_my_district()
RETURNS TEXT AS $$
DECLARE
    d TEXT;
BEGIN
    SELECT district INTO d FROM profiles WHERE id = auth.uid();
    RETURN d;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_my_district() TO authenticated;

-- ── Replace the recursive SELECT policy ─────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;

CREATE POLICY "profiles_select_policy"
ON profiles
FOR SELECT
TO authenticated
USING (
    -- Own profile (always)
    auth.uid() = id

    OR

    -- Admin: see all profiles
    get_my_role() = 'admin'

    OR

    -- District Officer: see profiles in their own district
    (
        get_my_role() = 'district_officer'
        AND district = get_my_district()
    )
);

-- =====================================================
-- DONE! Login should now work without infinite recursion.
-- =====================================================
