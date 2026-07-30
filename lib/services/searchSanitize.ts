// =====================================================
// SEARCH TERM SANITIZER
// Strips PostgREST-reserved characters from user-entered
// search text before it is interpolated into .or()/.ilike()
// filter strings. Commas separate conditions, parentheses
// group them, and * / % are wildcard tokens — any of them
// typed by a user could break out of the intended filter.
// =====================================================

export function sanitizeSearchTerm(input: string | null | undefined): string {
  return String(input ?? '')
    .replace(/[,()*%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
