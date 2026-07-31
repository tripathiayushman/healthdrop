// =====================================================
// PROFILE COMPLETENESS — small pure helper
// Scores the four profile fields the field workflows
// depend on (full_name, phone, district, state).
// Empty, whitespace-only and 'Not specified' placeholder
// values (provisioning defaults) all count as missing.
// No I/O, no React — safe to call on every render.
// =====================================================

export type CompletenessField = 'full_name' | 'phone' | 'district' | 'state';

/** Structural input — Profile is assignable; partial rows are tolerated. */
export interface CompletenessInput {
  full_name?: string | null;
  phone?: string | null;
  district?: string | null;
  state?: string | null;
}

export interface CompletenessResult {
  /** Whole number 0–100. */
  pct: number;
  /** Fields still missing, in display order (drives the "add …" caption). */
  missing: CompletenessField[];
}

/** Display order: most useful to complete first. */
const FIELDS: CompletenessField[] = ['full_name', 'phone', 'district', 'state'];

const isMissing = (value: string | null | undefined): boolean => {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === 'not specified';
};

export const computeCompleteness = (
  profile: CompletenessInput | null | undefined,
): CompletenessResult => {
  const missing = FIELDS.filter((field) => isMissing(profile?.[field]));
  const pct = Math.round(((FIELDS.length - missing.length) / FIELDS.length) * 100);
  return { pct, missing };
};
