// ============================================================================
// DOCUMENTS CLIENT LIBRARY
//
// Wraps the three Phase 3 Edge Functions plus list/delete which use the
// regular supabaseAdmin client.
//
// Flow for upload:
//   1. presignUpload(file, employeeId) → { uploadUrl, r2Key }
//   2. PUT the file directly to uploadUrl (browser → R2)
//   3. confirmUpload(r2Key, metadata) → DB row created
//
// Flow for download:
//   1. presignDownload(documentId) → { downloadUrl, filename }
//   2. trigger browser download from downloadUrl
//
// ============================================================================

import { supabaseAdmin } from './supabase'
import { auth } from './firebase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ADMIN_SHARED_SECRET = import.meta.env.VITE_HRMS_ADMIN_SECRET

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function fnUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`
}

async function callFn(name, body) {
  if (!ADMIN_SHARED_SECRET) {
    throw new Error('VITE_HRMS_ADMIN_SECRET not set in .env.local')
  }
  const headers = {
    'Content-Type': 'application/json',
    'x-admin-secret': ADMIN_SHARED_SECRET,
    // Supabase functions require the anon key in Authorization
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  }
  // Attach the signed-in admin's verifiable Firebase identity so server-side
  // gates (e.g. the document lock in presign-download) can trust who's calling.
  try {
    const t = await auth?.currentUser?.getIdToken?.()
    if (t) headers['x-firebase-token'] = t
  } catch { /* no user / token unavailable — server enforces */ }
  const resp = await fetch(fnUrl(name), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`${name} failed (${resp.status}): ${text}`)
  }
  return resp.json()
}


// ----------------------------------------------------------------------------
// LIST documents for an employee
// ----------------------------------------------------------------------------
export async function listDocuments(employeeId) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('employee_documents')
    .select('*')
    .eq('employee_id', employeeId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data || []
}


// ----------------------------------------------------------------------------
// UPLOAD — orchestrates the 3-step flow
// ----------------------------------------------------------------------------
export async function uploadDocument({
  file,
  employeeId,
  category,
  displayName,
  isTeacherVisible,
  expiresAt,
  notes,
  uploadedByEmail,
  onProgress,
}) {
  // Step 1 — get presigned upload URL
  const presigned = await callFn('presign-upload', {
    employeeId,
    filename: file.name,
    sizeBytes: file.size,
    mimeType: file.type,
  })
  const { uploadUrl, r2Key, headers } = presigned

  // Step 2 — PUT the file directly to R2
  // Use XHR for upload progress; fetch() doesn't support it.
  const checksum = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(ev.loaded / ev.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || null
        resolve(etag ? etag.replace(/"/g, '') : null)
      } else {
        reject(new Error(`R2 upload failed: ${xhr.status} ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('R2 upload network error'))
    xhr.send(file)
  })

  // Step 3 — confirm the upload, create the DB row
  const { document } = await callFn('confirm-upload', {
    employeeId,
    r2Key,
    filename: file.name,
    displayName: displayName || null,
    category: category || 'other',
    sizeBytes: file.size,
    mimeType: file.type,
    checksum,
    isTeacherVisible: !!isTeacherVisible,
    expiresAt: expiresAt || null,
    notes: notes || null,
    uploadedByEmail,
  })

  return document
}


// ----------------------------------------------------------------------------
// DOWNLOAD — get a presigned URL and trigger browser download
// ----------------------------------------------------------------------------
export async function downloadDocument(documentId, requestedByEmail) {
  const { downloadUrl, filename } = await callFn('presign-download', {
    documentId,
    requestedByEmail,
  })
  // Trigger the download via a hidden <a>
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = filename
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}


// ----------------------------------------------------------------------------
// DELETE — soft delete (sets deleted_at). R2 cleanup is a future job.
// ----------------------------------------------------------------------------
export async function deleteDocument({ documentId, employeeId, deletedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const { data, error } = await supabaseAdmin
    .from('employee_documents')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: deletedByEmail,
    })
    .eq('id', documentId)
    .select()
    .single()

  if (error) throw error

  // Audit
  await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employeeId,
    changed_by_email: deletedByEmail,
    action: 'delete',
    field_name: `document_deleted:${data.filename}`,
    old_value: data.category,
    new_value: null,
  })

  return data
}


// ----------------------------------------------------------------------------
// SUPER-ADMIN LOCK — freeze an employee's document set.
// When locked, only the super admin + allow-listed emails can download
// (enforced in presign-download) or view the list (gated in the UI). The
// teacher's own PWA view is unaffected; teacher uploads are blocked while locked.
// ----------------------------------------------------------------------------
export async function setEmployeeDocumentLock({ employeeId, locked, allowedEmails = [], byEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const clean = [...new Set(
    (allowedEmails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean),
  )]
  const patch = locked
    ? {
        documents_locked: true,
        documents_locked_by: byEmail || null,
        documents_locked_at: new Date().toISOString(),
        documents_lock_allowed: clean,
      }
    : {
        documents_locked: false,
        documents_locked_by: null,
        documents_locked_at: null,
        documents_lock_allowed: [],
      }
  const { data, error } = await supabaseAdmin
    .from('employees')
    .update(patch)
    .eq('id', employeeId)
    .select('documents_locked, documents_locked_by, documents_locked_at, documents_lock_allowed')
    .single()
  if (error) throw error

  await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employeeId,
    changed_by_email: byEmail || null,
    action: 'update',
    field_name: locked ? 'documents_locked' : 'documents_unlocked',
    old_value: null,
    new_value: locked ? (clean.join(', ') || 'locked') : null,
  })
  return data
}

// True if the given user may view a locked employee's documents.
export function canViewLocked({ employee, isSuperAdmin, userEmail }) {
  if (!employee?.documents_locked) return true
  if (isSuperAdmin) return true
  const email = String(userEmail || '').toLowerCase()
  return (employee.documents_lock_allowed || []).map(e => String(e).toLowerCase()).includes(email)
}


// ----------------------------------------------------------------------------
// CATEGORY METADATA — for filter chips and UI
// ----------------------------------------------------------------------------
export const DOCUMENT_CATEGORIES = [
  { key: 'id_proof',      label: 'ID Proof',      defaultTeacherVisible: true,  description: 'Aadhaar, PAN, Passport, Voter ID' },
  { key: 'education',     label: 'Education',     defaultTeacherVisible: true,  description: 'Degrees, certificates, mark sheets' },
  { key: 'employment',    label: 'Employment',    defaultTeacherVisible: true,  description: 'Offer letter, contract, increment letter' },
  { key: 'tax',           label: 'Tax',           defaultTeacherVisible: true,  description: 'Form 16, ITR, TDS' },
  { key: 'bank',          label: 'Bank',          defaultTeacherVisible: false, description: 'Cancelled cheque, statement' },
  { key: 'verification',  label: 'Verification',  defaultTeacherVisible: false, description: 'Police verification, medical, character' },
  { key: 'salary_slip',   label: 'Salary slip',   defaultTeacherVisible: true,  description: 'Monthly pay slips' },
  { key: 'performance',   label: 'Performance',   defaultTeacherVisible: false, description: 'Reviews, evaluations (admin only by default)' },
  { key: 'photograph',    label: 'Photo',         defaultTeacherVisible: true,  description: 'Profile photos' },
  { key: 'other',         label: 'Other',         defaultTeacherVisible: false, description: 'Anything else' },
]

export function getCategoryMeta(key) {
  return DOCUMENT_CATEGORIES.find(c => c.key === key) || DOCUMENT_CATEGORIES.at(-1)
}
