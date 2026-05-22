// ============================================================================
// ADMINS
//
// CRUD on the `admins` Firestore collection in the rka-academic-tracker
// project. HRMS, the Academic Tracker, and the SMS module all read from
// this same collection for authorisation. This module is the single
// source of write logic.
//
// Document shape:
//
//   admins/{id}            // id = lowercase email OR a UUID for phone-only admins
//     email:          string | null    // optional; required for Google sign-in
//     phone:          string | null    // E.164 (+91XXXXXXXXXX); required for OTP sign-in
//     fullName:       string
//     role:           'admin' | 'receptionist'
//     branchCode:     'MAIN' | 'CITY'
//     modules:        string[]  — subset of ['tracker', 'hrms', 'sms']
//                     A receptionist is always ['hrms'].
//     isActive:       boolean
//     addedById:      string  (uid)
//     addedByName:    string  (displayName or email)
//     addedAt:        Timestamp
//     updatedById:    string  (uid, written on first edit)
//     updatedByName:  string
//     updatedAt:      Timestamp
//
// Each admin must have at least one of email or phone. Phone-only admins
// get a generated UUID as their doc id (since the email-as-id convention
// can't apply). SMS module's auth-sync queries the collection by the
// `phone` field for OTP sign-in.
//
// The hardcoded super admin (adwit@rkacademyballia.in) is NEVER stored
// in this collection. It's recognised by email or phone match in the
// SMS auth-sync function and in src/App.jsx of each app.
// ============================================================================

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { SUPER_ADMIN_EMAIL } from '../App'

const ROLES = ['admin', 'receptionist']
const BRANCHES = ['MAIN', 'CITY']
export const MODULES = ['tracker', 'hrms', 'sms']
export const DEFAULT_MODULES = ['tracker', 'hrms']

/**
 * Normalise an Indian mobile to E.164 (+91XXXXXXXXXX) or return null.
 * Accepts: "9876543210", "+91 98765 43210", "+919876543210", "91 9876543210".
 */
export function normalisePhone(input) {
  if (input == null) return null
  const digits = String(input).replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (String(input).startsWith('+') && digits.length >= 11) return `+${digits}`
  return null
}

// Display order: admin (MAIN, then CITY) → receptionist (MAIN, then CITY)
//                → legacy super_admin → unknown
const ROLE_ORDER = { admin: 0, receptionist: 1, super_admin: 2 }
const BRANCH_ORDER = { MAIN: 0, CITY: 1 }

/**
 * Validate and normalise a modules array. Receptionists are forced to ['hrms']
 * regardless of input — front-desk staff never need tracker access. Other
 * roles must specify at least one valid module.
 */
function normaliseModules(role, modules) {
  if (role === 'receptionist') return ['hrms']
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error('Pick at least one app this admin can access')
  }
  const cleaned = [...new Set(modules.filter(m => MODULES.includes(m)))]
  if (cleaned.length === 0) throw new Error('Invalid module selection')
  return cleaned
}

/**
 * Read modules off an admin doc with backwards-compat. Legacy docs missing
 * the field are treated as having both modules — preserves existing access
 * for admins added before module support was introduced.
 */
export function adminModules(adminDoc) {
  if (!adminDoc) return []
  if (Array.isArray(adminDoc.modules) && adminDoc.modules.length > 0) {
    return adminDoc.modules.filter(m => MODULES.includes(m))
  }
  return [...DEFAULT_MODULES]
}

/**
 * Fetch all admins from Firestore. Returns a stable-sorted list, each
 * item containing id (= lowercase email).
 *
 * The hardcoded super admin is NOT included — callers should render him
 * separately if needed.
 */
export async function listAdmins() {
  const snap = await getDocs(collection(db, 'admins'))
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  docs.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99
    const rb = ROLE_ORDER[b.role] ?? 99
    if (ra !== rb) return ra - rb
    const ba = BRANCH_ORDER[a.branchCode] ?? 99
    const bb = BRANCH_ORDER[b.branchCode] ?? 99
    if (ba !== bb) return ba - bb
    return (a.email || a.id || '').localeCompare(b.email || b.id || '')
  })
  return docs.filter(d => d.email !== SUPER_ADMIN_EMAIL && d.id !== SUPER_ADMIN_EMAIL)
}

/**
 * Create a new admin. At least one of email or phone is required.
 * - Email-only or email+phone admins → doc id is the lowercase email.
 * - Phone-only admins → doc id is a random UUID (since the email-as-id
 *   convention can't apply when email is null).
 */
export async function createAdmin({ email, phone, fullName, role, branchCode, modules, currentUser }) {
  const e = (email || '').trim().toLowerCase()
  const n = (fullName || '').trim()
  const p = phone ? normalisePhone(phone) : null

  if (!n) throw new Error('Full name is required')
  if (!e && !p) throw new Error('Provide an email, a mobile number, or both')
  if (e && !e.includes('@')) throw new Error('Invalid email format')
  if (phone && !p) throw new Error('Invalid mobile number. Use a 10-digit Indian number.')
  if (e === SUPER_ADMIN_EMAIL) throw new Error('This email is already the super admin')
  if (!ROLES.includes(role)) throw new Error('Pick a role')
  if (!BRANCHES.includes(branchCode)) throw new Error('Pick a branch')
  if (!currentUser?.uid) throw new Error('Not signed in')

  const cleanModules = normaliseModules(role, modules)

  // Choose doc id. Email-keyed wins when present (preserves existing convention).
  const id = e || `phone_${(crypto.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 24)}`

  const ref = doc(db, 'admins', id)
  const existing = await getDoc(ref)
  if (existing.exists()) {
    throw new Error(e ? 'This email is already an admin' : 'Duplicate admin id — retry')
  }

  // If phone is set, also guard against duplicate phone across the collection.
  if (p) {
    const dupe = await findAdminIdByPhone(p)
    if (dupe) throw new Error('This mobile number is already used by another admin')
  }

  await setDoc(ref, {
    email: e || null,
    phone: p,
    fullName: n,
    role,
    branchCode,
    modules: cleanModules,
    isActive: true,
    addedById: currentUser.uid,
    addedByName: currentUser.displayName || currentUser.email,
    addedAt: Timestamp.now(),
  })
}

/**
 * Find a Firestore admin doc id by its `phone` field (lowercase preferred,
 * `Phone` legacy fallback). Used to enforce phone uniqueness.
 */
async function findAdminIdByPhone(phoneE164) {
  // Simple client-side scan — admins are usually a small set (< 50).
  // Avoids needing a composite index for two-field equality.
  const snap = await getDocs(collection(db, 'admins'))
  for (const d of snap.docs) {
    const data = d.data()
    if (data.phone === phoneE164 || data.Phone === phoneE164) return d.id
  }
  return null
}

/**
 * Update name, role, and/or branch on an existing admin. Email/id is
 * fixed (it's the document key). Pass only the fields that should change;
 * others are left alone.
 */
export async function updateAdmin({ id, fullName, role, branchCode, modules, phone, email, currentUser }) {
  if (!id) throw new Error('Admin id is required')
  if (id === SUPER_ADMIN_EMAIL) throw new Error('Super admin cannot be modified')
  if (role && !ROLES.includes(role)) throw new Error('Pick a role')
  if (branchCode && !BRANCHES.includes(branchCode)) throw new Error('Pick a branch')
  if (!currentUser?.uid) throw new Error('Not signed in')

  const updates = {
    updatedById: currentUser.uid,
    updatedByName: currentUser.displayName || currentUser.email,
    updatedAt: Timestamp.now(),
  }
  if (fullName != null) {
    const trimmed = fullName.trim()
    if (!trimmed) throw new Error('Full name cannot be empty')
    updates.fullName = trimmed
  }
  if (role) updates.role = role
  if (branchCode) updates.branchCode = branchCode

  // Email may be added (or cleared) on phone-only admins only. The doc id of
  // an email-keyed admin IS the email, so changing it would orphan the doc.
  if (email !== undefined) {
    const existing = (await getDoc(doc(db, 'admins', id))).data()
    const isEmailKeyed = existing?.email && existing.email === id
    if (isEmailKeyed) {
      throw new Error("Can't change email on an email-keyed admin — it's the permanent identifier.")
    }
    const raw = (email ?? '').toString().trim().toLowerCase()
    if (raw === '') {
      // Clearing email on a phone-only admin — only allowed if phone exists.
      const willHavePhone = phone !== undefined
        ? !!normalisePhone((phone ?? '').toString())
        : !!(existing?.phone || existing?.Phone)
      if (!willHavePhone) {
        throw new Error('Admin must have at least one of email or phone.')
      }
      updates.email = null
    } else {
      if (!raw.includes('@')) throw new Error('Invalid email format')
      if (raw === SUPER_ADMIN_EMAIL) throw new Error('This email is reserved for the super admin')
      // Guard duplicate: another admin already has this as its doc id or email field.
      const ref = doc(db, 'admins', raw)
      const dupDoc = await getDoc(ref)
      if (dupDoc.exists()) throw new Error('Another admin already uses this email.')
      updates.email = raw
    }
  }

  // Phone may be added, changed, or cleared. Empty string → null.
  if (phone !== undefined) {
    const raw = (phone ?? '').toString().trim()
    if (raw === '') {
      // Caller wants to clear the phone. Only allowed if email is present
      // (admin must still have at least one identifier).
      const existing = (await getDoc(doc(db, 'admins', id))).data()
      if (!existing?.email) {
        throw new Error('Cannot clear phone on a phone-only admin. Add an email first.')
      }
      updates.phone = null
      // Also clear any legacy Phone-cased field on the same doc.
      updates.Phone = null
    } else {
      const p = normalisePhone(raw)
      if (!p) throw new Error('Invalid mobile number. Use a 10-digit Indian number.')
      const dupe = await findAdminIdByPhone(p)
      if (dupe && dupe !== id) {
        throw new Error('This mobile number is already used by another admin')
      }
      updates.phone = p
      // Wipe legacy `Phone` (capital P) so we don't have stale duplicate fields.
      updates.Phone = null
    }
  }

  // Modules: caller passes them when they change. If role flips to
  // receptionist mid-update without an explicit modules value, force
  // ['hrms'] defensively (receptionist must never have tracker access).
  if (modules !== undefined) {
    const effectiveRole = role || (await getDoc(doc(db, 'admins', id))).data()?.role
    updates.modules = normaliseModules(effectiveRole, modules)
  } else if (role === 'receptionist') {
    updates.modules = ['hrms']
  }

  await setDoc(doc(db, 'admins', id), updates, { merge: true })
}

/**
 * Toggle isActive. The tracker treats `isActive !== false` as "active",
 * so undefined defaults to active; this writes an explicit boolean.
 */
export async function setAdminActive({ id, isActive, currentUser }) {
  if (!id) throw new Error('Admin id is required')
  if (id === SUPER_ADMIN_EMAIL) throw new Error('Super admin cannot be deactivated')
  if (!currentUser?.uid) throw new Error('Not signed in')

  await setDoc(doc(db, 'admins', id), {
    isActive: !!isActive,
    updatedById: currentUser.uid,
    updatedByName: currentUser.displayName || currentUser.email,
    updatedAt: Timestamp.now(),
  }, { merge: true })
}

/**
 * Permanently remove an admin. Hard delete — there's no soft-delete
 * column on this collection, and the tracker's existing code does the
 * same. For temporary access removal, prefer setAdminActive(false).
 */
export async function deleteAdmin({ id }) {
  if (!id) throw new Error('Admin id is required')
  if (id === SUPER_ADMIN_EMAIL) throw new Error('Super admin cannot be removed')
  await deleteDoc(doc(db, 'admins', id))
}
