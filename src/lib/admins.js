// ============================================================================
// ADMINS
//
// CRUD on the `admins` Firestore collection in the rka-academic-tracker
// project. Both this app (HRMS) and the Academic Tracker read from this
// same collection for authorisation. This module is the single source of
// write logic.
//
// Document shape (matches the existing schema written by the legacy
// tracker admin page — DO NOT change field names without updating the
// tracker's read code too):
//
//   admins/{lowercase_email}
//     email:          string
//     fullName:       string
//     role:           'admin' | 'receptionist'
//     branchCode:     'MAIN' | 'CITY'
//     modules:        string[]  — subset of ['tracker', 'hrms']
//                     A receptionist is always ['hrms'] (no tracker access).
//                     Legacy docs missing this field are treated as having
//                     both modules at read time.
//     isActive:       boolean
//     addedById:      string  (uid)
//     addedByName:    string  (displayName or email)
//     addedAt:        Timestamp
//     updatedById:    string  (uid, written on first edit)
//     updatedByName:  string
//     updatedAt:      Timestamp
//
// The hardcoded super admin (adwit@rkacademyballia.in) is NEVER stored
// in this collection. It's recognised by email match in src/App.jsx.
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
export const MODULES = ['tracker', 'hrms']
export const DEFAULT_MODULES = ['tracker', 'hrms']

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
 * Create a new admin. Validates input, prevents duplicates, and stamps
 * the creating user. Throws a user-readable Error on failure.
 */
export async function createAdmin({ email, fullName, role, branchCode, modules, currentUser }) {
  const e = (email || '').trim().toLowerCase()
  const n = (fullName || '').trim()
  if (!e) throw new Error('Email is required')
  if (!n) throw new Error('Full name is required')
  if (!e.includes('@')) throw new Error('Invalid email format')
  if (e === SUPER_ADMIN_EMAIL) throw new Error('This email is already the super admin')
  if (!ROLES.includes(role)) throw new Error('Pick a role')
  if (!BRANCHES.includes(branchCode)) throw new Error('Pick a branch')
  if (!currentUser?.uid) throw new Error('Not signed in')

  const cleanModules = normaliseModules(role, modules)

  const ref = doc(db, 'admins', e)
  const existing = await getDoc(ref)
  if (existing.exists()) throw new Error('This email is already an admin')

  await setDoc(ref, {
    email: e,
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
 * Update name, role, and/or branch on an existing admin. Email/id is
 * fixed (it's the document key). Pass only the fields that should change;
 * others are left alone.
 */
export async function updateAdmin({ id, fullName, role, branchCode, modules, currentUser }) {
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
