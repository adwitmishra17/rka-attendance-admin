// ============================================================================
// PROFILE PHOTO UPLOAD
//
// Uses Supabase Storage (NOT R2) for profile photos. Photos are public-readable
// for fast page loads; documents stay in R2 with private signed URLs.
//
// Workflow:
//   1. Resize image to ≤200KB JPEG (via photoResize.js)
//   2. Upload to Supabase Storage `profile-photos` bucket
//   3. Update employees.profile_photo_url with the public URL
//   4. Write audit log entry
//
// Storage path: profile-photos/<employee_id>.jpg
// Always overwrites — only one photo per employee.
// ============================================================================

import { supabaseAdmin } from './supabase'
import { resizeImageTo200KB } from './photoResize'

const BUCKET_ID = 'profile-photos'

/**
 * Upload a profile photo for an employee.
 * @param {Object} args
 * @param {File} args.file - source image (will be resized)
 * @param {string} args.employeeId
 * @param {string} args.uploadedByEmail
 * @param {Function} [args.onStatus] - progress callback
 * @returns {Promise<{ publicUrl, employee }>}
 */
export async function uploadProfilePhoto({ file, employeeId, uploadedByEmail, onStatus }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  // Step 1 — resize to ≤200KB JPEG
  onStatus?.({ stage: 'resize_start' })
  const resizedBlob = await resizeImageTo200KB(file, (s) => {
    onStatus?.({ stage: 'resize', detail: s })
  })
  onStatus?.({ stage: 'resize_done', size: resizedBlob.size })

  // Step 2 — upload to Supabase Storage (overwrite if exists)
  // Path: <employee_id>.jpg — one photo per employee, simple lookup
  const path = `${employeeId}.jpg`
  onStatus?.({ stage: 'upload_start' })

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET_ID)
    .upload(path, resizedBlob, {
      contentType: 'image/jpeg',
      upsert: true,         // overwrite existing
      cacheControl: '3600', // 1 hour browser cache
    })

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`)
  }

  // Step 3 — get the public URL
  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET_ID)
    .getPublicUrl(path)
  const publicUrl = urlData.publicUrl

  // Append a timestamp query param to bust browser cache when re-uploading
  const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`

  // Step 4 — update employee record
  onStatus?.({ stage: 'db_update' })
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('employees')
    .update({
      profile_photo_url: cacheBustedUrl,
      updated_by: uploadedByEmail,
      updated_at: new Date().toISOString(),
    })
    .eq('id', employeeId)
    .select()
    .single()

  if (updateError) {
    throw new Error(`DB update failed: ${updateError.message}`)
  }

  // Step 5 — audit log
  await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employeeId,
    changed_by_email: uploadedByEmail,
    action: 'update',
    field_name: 'profile_photo',
    old_value: null,
    new_value: 'uploaded',
  })

  onStatus?.({ stage: 'done', publicUrl: cacheBustedUrl })
  return { publicUrl: cacheBustedUrl, employee: updated }
}

/**
 * Remove an employee's profile photo (deletes from Storage + clears the URL).
 */
export async function removeProfilePhoto({ employeeId, removedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const path = `${employeeId}.jpg`

  // Best-effort delete from Storage (ignore "not found")
  await supabaseAdmin.storage.from(BUCKET_ID).remove([path])

  const { data: updated, error } = await supabaseAdmin
    .from('employees')
    .update({
      profile_photo_url: null,
      updated_by: removedByEmail,
      updated_at: new Date().toISOString(),
    })
    .eq('id', employeeId)
    .select()
    .single()

  if (error) throw error

  await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employeeId,
    changed_by_email: removedByEmail,
    action: 'update',
    field_name: 'profile_photo',
    old_value: 'present',
    new_value: 'removed',
  })

  return updated
}
