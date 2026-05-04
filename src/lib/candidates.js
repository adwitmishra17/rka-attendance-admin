// ============================================================================
// CANDIDATES (RECRUITMENT)
//
// CRUD for the candidates table + candidate_documents + candidate_audit_log.
// Uses Supabase Storage (private bucket 'candidate-documents') for files.
// Reads use 5-minute signed URLs.
// ============================================================================

import { supabaseAdmin } from './supabase'

const BUCKET_ID = 'candidate-documents'
const SIGNED_URL_TTL_SECONDS = 300  // 5 minutes


// ----------------------------------------------------------------------------
// TAGS
// ----------------------------------------------------------------------------

export async function listCandidateTags() {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('candidate_tags')
    .select('id, name, display_order')
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createCandidateTag({ name, displayOrder }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const trimmed = name?.trim()
  if (!trimmed) throw new Error('Tag name required')
  let order = displayOrder
  if (order == null) {
    const { data: max } = await supabaseAdmin
      .from('candidate_tags').select('display_order')
      .is('deleted_at', null)
      .order('display_order', { ascending: false }).limit(1)
    order = ((max?.[0]?.display_order || 0) + 10)
  }
  const { data, error } = await supabaseAdmin
    .from('candidate_tags')
    .insert({ name: trimmed, display_order: order })
    .select().single()
  if (error) throw error
  return data
}

export async function updateCandidateTag({ id, name, displayOrder }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const updates = {}
  if (name != null) {
    const t = name.trim(); if (!t) throw new Error('Name cannot be empty')
    updates.name = t
  }
  if (displayOrder != null) updates.display_order = displayOrder
  if (Object.keys(updates).length === 0) return null
  const { data, error } = await supabaseAdmin
    .from('candidate_tags').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteCandidateTag({ id }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { count, error: countErr } = await supabaseAdmin
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .eq('tag_id', id)
    .is('deleted_at', null)
  if (countErr) throw countErr
  if (count && count > 0) {
    throw new Error(`Cannot delete: ${count} candidate(s) tagged. Reassign first.`)
  }
  const { data, error } = await supabaseAdmin
    .from('candidate_tags')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}


// ----------------------------------------------------------------------------
// CANDIDATES — list/get/create/update
// ----------------------------------------------------------------------------

/**
 * List candidates. Options:
 *   onlyRecent: true           — limit to last 30 days (for receptionists)
 *   capturedByEmail            — only those captured by this user
 *   status                     — filter by status
 *   includeArchived            — include status='archived'
 *   effectiveBranches: string[] — REQUIRED for callers that need branch
 *                                 isolation. Pass auth.effectiveBranches.
 *                                 If omitted, no branch filter is applied
 *                                 (only safe for trusted internal calls).
 */
export async function listCandidates(options = {}) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  let q = supabaseAdmin
    .from('candidates')
    .select(`
      id, full_name, phone, email, status, walked_in_at,
      captured_by_email, tag_id, converted_to_employee_id, source, branch_code,
      tag:candidate_tags (id, name)
    `)
    .is('deleted_at', null)
    .order('walked_in_at', { ascending: false })

  if (options.onlyRecent) {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    q = q.gte('walked_in_at', cutoff)
  }
  if (options.capturedByEmail) {
    q = q.eq('captured_by_email', options.capturedByEmail)
  }
  if (options.status) {
    q = q.eq('status', options.status)
  }
  if (!options.includeArchived) {
    q = q.neq('status', 'archived')
  }
  if (Array.isArray(options.effectiveBranches)) {
    if (options.effectiveBranches.length === 0) {
      // Defensive: empty means "no access" — return zero rows
      q = q.eq('branch_code', '__no_access__')
    } else {
      q = q.in('branch_code', options.effectiveBranches)
    }
  }

  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function getCandidate(id) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .select(`
      *,
      tag:candidate_tags (id, name)
    `)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

/**
 * Create a candidate (initial walk-in capture).
 *
 * branchCode is REQUIRED — every walk-in happens at exactly one branch.
 * The caller derives it from the current branch context (a receptionist's
 * single branch, or the super admin's currently-selected branch).
 */
export async function createCandidate({ fullName, phone, email, tagId, capturedByEmail, source = 'walk_in', branchCode }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!fullName?.trim()) throw new Error('Name is required')
  if (!capturedByEmail) throw new Error('Captured-by email required')
  if (!branchCode || !['MAIN', 'CITY'].includes(branchCode)) {
    throw new Error('Branch is required — switch to a specific branch first')
  }

  const insert = {
    full_name: fullName.trim(),
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    tag_id: tagId || null,
    captured_by_email: capturedByEmail,
    source,
    status: 'applied',
    branch_code: branchCode,
  }
  const { data, error } = await supabaseAdmin
    .from('candidates').insert(insert).select().single()
  if (error) throw error

  // Audit
  await supabaseAdmin.from('candidate_audit_log').insert({
    candidate_id: data.id,
    changed_by_email: capturedByEmail,
    action: 'create',
  })
  return data
}

/**
 * Update fields on a candidate (status, notes, tag).
 */
export async function updateCandidate({ id, updates, changedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!id || !updates || Object.keys(updates).length === 0) return null

  // Get current state so we can audit changed fields
  const before = await getCandidate(id)

  const { data: after, error } = await supabaseAdmin
    .from('candidates').update(updates).eq('id', id).select().single()
  if (error) throw error

  // Write per-field audit entries
  const auditRows = []
  for (const [key, newVal] of Object.entries(updates)) {
    const oldVal = before?.[key]
    if (oldVal !== newVal) {
      let action = 'update'
      if (key === 'status') action = 'status_change'
      else if (key === 'tag_id') action = 'tag_change'
      else if (key === 'admin_notes') action = 'note_update'
      auditRows.push({
        candidate_id: id,
        changed_by_email: changedByEmail,
        action,
        field_name: key,
        old_value: oldVal == null ? null : String(oldVal),
        new_value: newVal == null ? null : String(newVal),
      })
    }
  }
  if (auditRows.length > 0) {
    await supabaseAdmin.from('candidate_audit_log').insert(auditRows)
  }
  return after
}

/**
 * Soft-delete (archive) a candidate.
 */
export async function archiveCandidate({ id, archivedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('candidates')
    .update({ status: 'archived', deleted_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  await supabaseAdmin.from('candidate_audit_log').insert({
    candidate_id: id, changed_by_email: archivedByEmail, action: 'archive',
  })
  return data
}


// ----------------------------------------------------------------------------
// DOCUMENTS — upload/list/download (Supabase Storage)
// ----------------------------------------------------------------------------

/**
 * Upload a document (CV/photo) for a candidate.
 * @param {File|Blob} file
 * @param {string} candidateId
 * @param {string} docKind - 'cv' | 'photo' | 'walkin_form' | 'other'
 * @param {string} uploadedByEmail
 * @returns {Promise<{ id, storage_path }>}
 */
export async function uploadCandidateDocument({ file, candidateId, docKind = 'cv', displayName, uploadedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!file) throw new Error('No file')

  // Storage path: <candidate_id>/<kind>-<timestamp>.<ext>
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const ts = Date.now()
  const storagePath = `${candidateId}/${docKind}-${ts}.${ext}`

  // Upload to Storage
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET_ID)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })
  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  // Insert metadata row
  const { data: row, error: rowErr } = await supabaseAdmin
    .from('candidate_documents')
    .insert({
      candidate_id: candidateId,
      storage_path: storagePath,
      doc_kind: docKind,
      filename: file.name || `${docKind}.${ext}`,
      display_name: displayName || null,
      mime_type: file.type || null,
      size_bytes: file.size || null,
      uploaded_by_email: uploadedByEmail,
    })
    .select().single()

  if (rowErr) {
    // Best-effort cleanup
    await supabaseAdmin.storage.from(BUCKET_ID).remove([storagePath]).catch(() => {})
    throw rowErr
  }

  // Audit
  await supabaseAdmin.from('candidate_audit_log').insert({
    candidate_id: candidateId,
    changed_by_email: uploadedByEmail,
    action: 'document_upload',
    field_name: docKind,
    new_value: row.filename,
  })

  return row
}

export async function listCandidateDocuments(candidateId) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', candidateId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Generate a signed URL (5min TTL) to view/download a candidate document.
 */
export async function getCandidateDocumentUrl(storagePath) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_ID)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data?.signedUrl || null
}


// ----------------------------------------------------------------------------
// CONVERT TO EMPLOYEE
// ----------------------------------------------------------------------------

/**
 * Converts a candidate into an employee. Creates a stub employee record with
 * the candidate's basic info, links the candidate via converted_to_employee_id,
 * and copies the most recent CV + photo to employee_documents (logical copy:
 * we duplicate the metadata; files stay in candidate-documents bucket since
 * employees can also access via signed URLs of the same path through admin).
 *
 * Actually, simpler approach: we just copy the metadata into employee_documents
 * pointing to the same storage_path. Employee-side download flow uses Supabase
 * Storage signed URLs too (well, currently it uses R2 — but we can have
 * candidate documents hang on the employee record via a special category).
 *
 * Cleanest behavior:
 *   1. Create new employee row with name/phone/email from candidate
 *   2. Mark candidate.status='hired', set converted_to_employee_id, converted_at, converted_by_email
 *   3. Don't auto-copy documents — admin will see "view candidate's CV" link
 *      from the new employee profile (Phase R3 polish), or admin can re-upload
 *      to employee documents in R2 if needed.
 *   4. Audit log entries on both sides.
 *
 * Returns: { employee, candidate }
 */
export async function convertToEmployee({ candidateId, convertedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const candidate = await getCandidate(candidateId)
  if (!candidate) throw new Error('Candidate not found')
  if (candidate.converted_to_employee_id) {
    throw new Error('This candidate has already been converted')
  }

  // 1. Create stub employee — inherit branch from the candidate
  const { data: employee, error: empErr } = await supabaseAdmin
    .from('employees')
    .insert({
      full_name: candidate.full_name,
      phone: candidate.phone || null,
      personal_phone: candidate.phone || null,  // safe default
      email: null,                              // work email assigned later
      personal_email: candidate.email || null,
      is_active: true,
      branch_codes: [candidate.branch_code],
      created_by: convertedByEmail,
      updated_by: convertedByEmail,
    })
    .select().single()
  if (empErr) throw new Error(`Could not create employee: ${empErr.message}`)

  // 2. Link candidate
  const nowIso = new Date().toISOString()
  const { error: linkErr } = await supabaseAdmin
    .from('candidates')
    .update({
      status: 'hired',
      converted_to_employee_id: employee.id,
      converted_at: nowIso,
      converted_by_email: convertedByEmail,
    })
    .eq('id', candidateId)
  if (linkErr) {
    // Best-effort rollback: remove the employee we just created
    await supabaseAdmin.from('employees').delete().eq('id', employee.id).catch(() => {})
    throw new Error(`Could not link candidate: ${linkErr.message}`)
  }

  // 3. Audit
  await supabaseAdmin.from('candidate_audit_log').insert({
    candidate_id: candidateId,
    changed_by_email: convertedByEmail,
    action: 'convert',
    new_value: employee.id,
  })
  await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employee.id,
    changed_by_email: convertedByEmail,
    action: 'create',
    field_name: 'converted_from_candidate',
    new_value: candidateId,
  })

  return { employee, candidate }
}


// ----------------------------------------------------------------------------
// AUDIT LOG (read)
// ----------------------------------------------------------------------------

export async function listCandidateAuditLog(candidateId) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('candidate_audit_log')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('changed_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data || []
}
