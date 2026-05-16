// ============================================================================
// FLEET DOCUMENTS CLIENT LIBRARY
//
// Mirrors src/lib/documents.js but for the fleet module. Generic across
// 'vehicle' and 'driver' owner types — the same three Edge Functions
// (fleet-presign-upload, fleet-confirm-upload, fleet-presign-download)
// service both, picking the right R2 prefix and DB table based on ownerType.
//
// Flow for upload:
//   1. (Optional) softDelete the existing active doc of the same type
//   2. presignUpload(ownerType, ownerId, file) → { uploadUrl, r2Key }
//   3. PUT file → R2
//   4. confirmUpload → DB row created in vehicle_documents OR driver_documents
// ============================================================================

import { supabaseAdmin } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ADMIN_SHARED_SECRET = import.meta.env.VITE_HRMS_ADMIN_SECRET


// ----------------------------------------------------------------------------
// Edge Function helper
// ----------------------------------------------------------------------------
function fnUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`
}

async function callFn(name, body) {
  if (!ADMIN_SHARED_SECRET) {
    throw new Error('VITE_HRMS_ADMIN_SECRET not set in .env.local')
  }
  const resp = await fetch(fnUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SHARED_SECRET,
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`${name} failed (${resp.status}): ${text}`)
  }
  return resp.json()
}


// ----------------------------------------------------------------------------
// Doc-type metadata
// ----------------------------------------------------------------------------
export const VEHICLE_DOC_TYPES = [
  { key: 'RC',        label: 'Registration Certificate', expiryRequired: false, description: 'Form 23 / Smart Card RC' },
  { key: 'Insurance', label: 'Insurance',                expiryRequired: true,  description: 'Comprehensive or Third-party policy' },
  { key: 'PUC',       label: 'PUC',                      expiryRequired: true,  description: 'Pollution Under Control certificate' },
  { key: 'Permit',    label: 'Permit',                   expiryRequired: true,  description: 'Contract carriage / educational permit' },
  { key: 'Fitness',   label: 'Fitness',                  expiryRequired: true,  description: 'Form 38 fitness certificate' },
]

export const DRIVER_DOC_TYPES = [
  { key: 'DL',      label: 'Driving Licence', expiryRequired: true,  description: 'Transport endorsement required for buses' },
  { key: 'Aadhaar', label: 'Aadhaar',         expiryRequired: false, description: 'For identity verification' },
]

export function docTypesFor(ownerType) {
  return ownerType === 'vehicle' ? VEHICLE_DOC_TYPES : DRIVER_DOC_TYPES
}

export function docTypeMeta(ownerType, key) {
  return docTypesFor(ownerType).find(t => t.key === key) || null
}


// ----------------------------------------------------------------------------
// LIST — all non-deleted documents for a single owner
// ----------------------------------------------------------------------------
export async function listFleetDocuments({ ownerType, ownerId }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const tableName  = ownerType === 'vehicle' ? 'vehicle_documents' : 'driver_documents'
  const ownerCol   = ownerType === 'vehicle' ? 'vehicle_id'        : 'employee_id'

  const { data, error } = await supabaseAdmin
    .from(tableName)
    .select('*')
    .eq(ownerCol, ownerId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })

  if (error) throw error
  return data || []
}


// ----------------------------------------------------------------------------
// UPLOAD — 3-step orchestration
// ----------------------------------------------------------------------------
/**
 * Upload a new document.
 *
 *   replaceExistingId — pass the id of an existing active doc of the same
 *     type to replace it (soft-deletes it first). Required if an active doc
 *     already exists, since the partial unique index would otherwise reject
 *     the insert.
 */
export async function uploadFleetDocument({
  ownerType,
  ownerId,
  file,
  docType,
  displayName,
  documentNumber,
  issueDate,
  expiresAt,
  issuingAuthority,
  notes,
  uploadedByEmail,
  replaceExistingId,
  onProgress,
}) {
  // 0. If replacing, soft-delete the existing first.
  if (replaceExistingId) {
    await softDeleteFleetDocument({
      ownerType,
      documentId: replaceExistingId,
      deletedByEmail: uploadedByEmail,
    })
  }

  // 1. Get presigned upload URL
  const presigned = await callFn('fleet-presign-upload', {
    ownerType,
    ownerId,
    filename: file.name,
    sizeBytes: file.size,
    mimeType: file.type,
  })
  const { uploadUrl, r2Key, headers } = presigned

  // 2. PUT the file directly to R2 (with progress)
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

  // 3. Confirm and insert DB row
  const { document } = await callFn('fleet-confirm-upload', {
    ownerType,
    ownerId,
    r2Key,
    filename: file.name,
    displayName: displayName || null,
    docType,
    documentNumber: documentNumber || null,
    issueDate: issueDate || null,
    expiresAt: expiresAt || null,
    issuingAuthority: issuingAuthority || null,
    notes: notes || null,
    sizeBytes: file.size,
    mimeType: file.type,
    checksum,
    uploadedByEmail,
  })

  return document
}


// ----------------------------------------------------------------------------
// DOWNLOAD — presigned GET URL + trigger browser download
// ----------------------------------------------------------------------------
export async function downloadFleetDocument({ ownerType, documentId, requestedByEmail }) {
  const { downloadUrl, filename } = await callFn('fleet-presign-download', {
    ownerType,
    documentId,
    requestedByEmail,
  })

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
// SOFT DELETE
// ----------------------------------------------------------------------------
export async function softDeleteFleetDocument({ ownerType, documentId, deletedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const tableName = ownerType === 'vehicle' ? 'vehicle_documents' : 'driver_documents'

  const { data, error } = await supabaseAdmin
    .from(tableName)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: deletedByEmail,
    })
    .eq('id', documentId)
    .select()
    .single()

  if (error) throw error

  // Audit
  await supabaseAdmin.from('fleet_audit_log').insert({
    entity_type: ownerType === 'vehicle' ? 'vehicle_document' : 'driver_document',
    entity_id: documentId,
    changed_by_email: deletedByEmail || 'unknown',
    action: 'delete',
    field_name: `${data.doc_type}:${data.filename}`,
    old_value: data.doc_type,
    new_value: null,
  })

  return data
}


// ----------------------------------------------------------------------------
// Expiry helpers
// ----------------------------------------------------------------------------
/**
 * Returns { state, days } where state is one of:
 *   'expired'   — expires_at is in the past
 *   'critical'  — ≤ 7 days
 *   'warning'   — ≤ 30 days
 *   'ok'        — > 30 days
 *   'none'      — expires_at is null
 */
export function expiryStatus(expiresAt) {
  if (!expiresAt) return { state: 'none', days: null }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiresAt)
  exp.setHours(0, 0, 0, 0)
  const days = Math.round((exp - today) / (1000 * 60 * 60 * 24))
  let state
  if (days < 0)       state = 'expired'
  else if (days <= 7) state = 'critical'
  else if (days <= 30) state = 'warning'
  else                state = 'ok'
  return { state, days }
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
