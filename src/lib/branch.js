// ============================================================================
// BRANCH
//
// Branch-awareness primitives. Single source of truth for:
//   - the two valid branch codes
//   - the localStorage key holding the user's last-selected branch
//   - helpers for normalising / persisting branch selections
//
// Higher-level branch *context* (which branches the current user is allowed
// to see, what's currently selected) lives in src/App.jsx via useAuth().
// ============================================================================

export const BRANCHES = [
  { code: 'MAIN', label: 'Main Campus', sub: 'Sawarubandh / Akhar' },
  { code: 'CITY', label: 'City Branch', sub: 'Japlinganj' },
]

export const BRANCH_CODES = BRANCHES.map(b => b.code)
// Type semantically: 'MAIN' | 'CITY'

const LS_KEY = 'rka-hrms-current-branch'

/**
 * Read the user's last-selected branch from localStorage.
 *
 *   'MAIN' or 'CITY'  →  branch code
 *   'ALL'             →  null  (user explicitly chose All Branches)
 *   missing/invalid   →  null  (first sign-in or corrupted)
 *
 * The 'ALL' string lets us distinguish "user picked All" from "user has
 * never picked anything" — both surface as null here, which is correct
 * because resolveBranch() handles the difference based on allowedBranches.
 */
export function readStoredBranch() {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v === 'ALL') return null
    if (BRANCH_CODES.includes(v)) return v
    return null
  } catch {
    return null
  }
}

/**
 * Persist a branch selection. Pass null for All Branches.
 * Silently no-ops if localStorage is unavailable (private mode, etc.).
 */
export function writeStoredBranch(branchCode) {
  try {
    localStorage.setItem(LS_KEY, branchCode === null ? 'ALL' : branchCode)
  } catch { /* localStorage unavailable — fine */ }
}

/**
 * Given a desired branch and the set of branches the user is allowed to
 * see, return what currentBranch should actually be.
 *
 *   - User has only one allowed branch  → that branch (no choice)
 *   - User wants All AND has multiple   → null (All)
 *   - User wants a specific allowed     → that branch
 *   - User wants something not allowed  → null (defensive default for super
 *                                          admin; branch admin would already
 *                                          have been caught by single-branch
 *                                          path above)
 *
 * Defensive: a stale localStorage value (e.g. user was demoted from super
 * admin to MAIN-only) is silently corrected.
 */
export function resolveBranch(desired, allowedBranches) {
  if (!allowedBranches || allowedBranches.length === 0) return null
  if (allowedBranches.length === 1) return allowedBranches[0]
  if (desired === null) return null
  if (allowedBranches.includes(desired)) return desired
  return null
}

/**
 * Compute the set of branches a query should actually filter by, given
 * the current branch selection and the user's allowed branches.
 *
 *   currentBranch === null  →  all allowed (super admin viewing All)
 *   currentBranch is set    →  just that one
 *
 * Returns an array suitable for `.in('branch_code', effectiveBranches(...))`.
 * Always non-empty (signed-in users always have at least one allowed branch).
 */
export function effectiveBranches(currentBranch, allowedBranches) {
  if (currentBranch === null) return allowedBranches
  return [currentBranch]
}

/**
 * Human label for a branch code or null.
 */
export function branchLabel(code) {
  if (code === null) return 'All Branches'
  return BRANCHES.find(b => b.code === code)?.label || code
}
