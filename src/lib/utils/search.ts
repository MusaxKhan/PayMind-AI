/**
 * Prepares a user-typed search term for use inside a Postgres ILIKE
 * pattern (`%term%`), especially one sent through PostgREST's `.or()`
 * filter string (e.g. `column.ilike.%term%,other.ilike.%term%`).
 *
 * ILIKE is already case-insensitive on its own — this isn't about
 * case-folding. It exists because a few other things can make a
 * search silently fail to match and look exactly like a case bug from
 * the outside:
 *
 *  - Extra/doubled whitespace (a typo'd double space, or a stray
 *    leading/trailing space from mobile autocorrect) won't match a
 *    normally-spaced stored value.
 *  - A literal "%" or "_" in the typed term has special meaning in a
 *    LIKE/ILIKE pattern (wildcard / single-char wildcard) unless
 *    escaped, so it wouldn't be matched as a literal character.
 *  - A "," "(" or ")" in the typed term has special meaning in
 *    PostgREST's `.or()` filter *string itself* — it can corrupt the
 *    whole filter and silently return zero or unrelated results,
 *    which is very easy to mistake for "the search doesn't work".
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    // Escape ILIKE's own wildcard characters so they're matched
    // literally rather than acting as wildcards.
    .replace(/[%_]/g, (match) => `\\${match}`)
    // Strip characters that are meaningful to PostgREST's .or() filter
    // DSL — none of these are legitimate parts of a name, CNIC, phone
    // number, or contract code anyway.
    .replace(/[,()]/g, "");
}

/**
 * Same whitespace/trim normalization as sanitizeSearchTerm, but
 * without the ILIKE-wildcard-escaping or PostgREST-character
 * stripping — for the plain `.toLowerCase().includes(term)` matching
 * used client-side (e.g. the offline/cached client list), where those
 * characters have no special meaning and escaping them would corrupt
 * the comparison instead of protecting it.
 */
export function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}