// ============================================================================
// BRANCH QUERY HELPERS
//
// Three helpers for adding branch filters to Supabase queries. Pick the right
// one per table:
//
//   applyBranchFilter(query, effectiveBranches)
//     For tables with scalar branch_code NOT NULL.
//     Used by: attendance_daily, attendance_events, candidates.
//
//   applyBranchFilterNullable(query, effectiveBranches)
//     For tables where branch_code is nullable and NULL means "applies to
//     both branches" (rows visible to everyone).
//     Used by: holidays.
//
//   applyBranchFilterArray(query, effectiveBranches)
//     For tables with branch_codes ARRAY (a row can belong to multiple
//     branches simultaneously).
//     Used by: employees.
//
// All three are safe against an empty `effectiveBranches` (returns no rows
// rather than all rows — fail closed).
// ============================================================================

/**
 * Filter by scalar branch_code IN (effectiveBranches).
 * Use for tables where every row belongs to exactly one branch.
 */
export function applyBranchFilter(query, effectiveBranches) {
  if (!effectiveBranches || effectiveBranches.length === 0) {
    // Defensive: no allowed branches → no rows visible
    return query.eq('branch_code', '__no_access__')
  }
  return query.in('branch_code', effectiveBranches)
}

/**
 * Filter by scalar branch_code IN (effectiveBranches) OR IS NULL.
 * Use for tables where NULL = "applies to both branches" (e.g. holidays
 * where a national holiday like Republic Day has branch_code=NULL).
 */
export function applyBranchFilterNullable(query, effectiveBranches) {
  if (!effectiveBranches || effectiveBranches.length === 0) {
    // Only show "applies to both" rows when user has no specific branch access
    return query.is('branch_code', null)
  }
  // PostgREST OR syntax: comma-separated filters, evaluated as OR
  const list = effectiveBranches.join(',')
  return query.or(`branch_code.is.null,branch_code.in.(${list})`)
}

/**
 * Filter by ANY overlap between row's branch_codes ARRAY and effectiveBranches.
 * Use for tables where a row can belong to multiple branches (e.g. employees
 * with branch_codes = ['MAIN','CITY'] for cross-campus teachers).
 *
 * "Overlaps" returns rows where AT LEAST ONE of branch_codes is in
 * effectiveBranches — correct semantics for "show this employee if any of
 * their branches matches the current view".
 */
export function applyBranchFilterArray(query, effectiveBranches) {
  if (!effectiveBranches || effectiveBranches.length === 0) {
    // Defensive: contains an impossible value → no rows
    return query.contains('branch_codes', ['__no_access__'])
  }
  return query.overlaps('branch_codes', effectiveBranches)
}

/**
 * Defensive check: does a single record (already fetched) belong to the
 * current branch context? Use after a single-record fetch to prevent a
 * branch-locked admin from accessing a record from another branch via URL
 * tampering.
 *
 *   For scalar branch_code:    isAccessible(record.branch_code, effectiveBranches)
 *   For nullable branch_code:  isAccessible(record.branch_code, effectiveBranches, { nullable: true })
 *   For array branch_codes:    isAccessibleArray(record.branch_codes, effectiveBranches)
 */
export function isAccessible(branchCode, effectiveBranches, { nullable = false } = {}) {
  if (nullable && branchCode === null) return true
  if (!branchCode) return false
  return effectiveBranches.includes(branchCode)
}

export function isAccessibleArray(branchCodes, effectiveBranches) {
  if (!Array.isArray(branchCodes) || branchCodes.length === 0) return false
  return branchCodes.some(b => effectiveBranches.includes(b))
}
