import { auth } from './firebase'
import { adminFnHeaders } from './fnAuth'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hrms-claims`

// Make sure the signed-in admin's Firebase token carries the HRMS claims RLS
// needs (role/hrms_level/hrms_branches). hrms-claims recomputes them from the
// admins collection; when they changed, force a token refresh so the next
// Supabase call uses them. Returns the level the server resolved (null = none).
export async function ensureHrmsClaims() {
  const resp = await fetch(FN, { method: 'POST', headers: await adminFnHeaders(), body: '{}' })
  const result = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(result.error || `hrms-claims failed (${resp.status})`)
  const tok = await auth.currentUser.getIdTokenResult()
  if (result.changed || tok.claims.hrms_level !== result.level) {
    await auth.currentUser.getIdToken(true)
  }
  return result.level
}

// Super admin: re-sync another admin's claims after editing / (de)activating /
// deleting them, so their database access follows the admins doc right away
// (removal also revokes their sessions). Best-effort — never blocks the edit.
export async function resyncAdminClaims({ email, uid }) {
  try {
    const body = email ? { targetEmail: email } : { targetUid: uid }
    await fetch(FN, { method: 'POST', headers: await adminFnHeaders(), body: JSON.stringify(body) })
  } catch (e) {
    console.warn('[hrms] claim resync failed', e?.message)
  }
}
