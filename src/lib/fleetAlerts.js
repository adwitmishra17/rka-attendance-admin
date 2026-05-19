// ============================================================================
// FLEET ALERTS
//
// Data layer for fleet_alert_recipients (the configurable email digest list)
// plus the helper that invokes the fleet-expiry-digest edge function for a
// one-off test send.
// ============================================================================

import { supabaseAdmin } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ADMIN_SHARED_SECRET = import.meta.env.VITE_HRMS_ADMIN_SECRET

export const BRANCH_FILTERS = [
  { value: 'ALL',  label: 'All branches' },
  { value: 'MAIN', label: 'Main Campus only' },
  { value: 'CITY', label: 'City Branch only' },
]

export const DOC_CATEGORY_OPTIONS = [
  { value: 'vehicle', label: 'Vehicle documents (RC, Insurance, PUC, Permit, Fitness)' },
  { value: 'driver',  label: 'Driver documents (DL, Aadhaar)' },
]


// ----------------------------------------------------------------------------
// LIST
// ----------------------------------------------------------------------------
export async function listRecipients() {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('fleet_alert_recipients')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}


// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------
export async function createRecipient({ form, createdByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const payload = sanitise(form)
  payload.created_by = createdByEmail || null
  payload.updated_by = createdByEmail || null

  const { data, error } = await supabaseAdmin
    .from('fleet_alert_recipients')
    .insert(payload)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      throw new Error(`${payload.email} is already on the recipient list`)
    }
    throw error
  }
  await logAudit(data.id, createdByEmail, 'create', 'recipient', null, data.email)
  return data
}


// ----------------------------------------------------------------------------
// UPDATE
// ----------------------------------------------------------------------------
export async function updateRecipient({ id, form, updatedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const payload = sanitise(form)
  payload.updated_by = updatedByEmail || null
  payload.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('fleet_alert_recipients')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      throw new Error(`${payload.email} is already on the recipient list`)
    }
    throw error
  }
  await logAudit(id, updatedByEmail, 'update', 'recipient', null, data.email)
  return data
}


// ----------------------------------------------------------------------------
// SOFT DELETE
// ----------------------------------------------------------------------------
export async function softDeleteRecipient({ id, deletedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('fleet_alert_recipients')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: deletedByEmail || null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit(id, deletedByEmail, 'delete', 'recipient', data.email, null)
  return data
}


// ----------------------------------------------------------------------------
// TEST SEND — invoke the digest function for a single recipient
// ----------------------------------------------------------------------------
export async function sendTestDigest(recipientId) {
  if (!ADMIN_SHARED_SECRET) {
    throw new Error('VITE_HRMS_ADMIN_SECRET not set in .env.local')
  }
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/fleet-expiry-digest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': ADMIN_SHARED_SECRET,
    },
    body: JSON.stringify({ test: true, recipientId }),
  })
  const result = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(result.detail || result.error || `digest function failed (${resp.status})`)
  }
  return result   // { sent, skipped, errors, totalItems }
}


// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
const EDITABLE = ['email', 'name', 'branch_filter', 'doc_categories', 'is_active']

function sanitise(form) {
  const out = {}
  for (const k of EDITABLE) {
    let v = form[k]
    if (typeof v === 'string') v = v.trim()
    out[k] = v
  }
  if (out.email) out.email = String(out.email).toLowerCase().trim()
  if (!Array.isArray(out.doc_categories) || out.doc_categories.length === 0) {
    out.doc_categories = ['vehicle', 'driver']
  }
  if (out.branch_filter == null) out.branch_filter = 'ALL'
  if (typeof out.is_active !== 'boolean') out.is_active = true
  return out
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

async function logAudit(entityId, byEmail, action, _t, oldV, newV) {
  if (!supabaseAdmin) return
  try {
    await supabaseAdmin.from('fleet_audit_log').insert({
      entity_type: 'recipient',
      entity_id: entityId,
      changed_by_email: byEmail || 'unknown',
      action,
      field_name: null,
      old_value: oldV,
      new_value: newV,
    })
  } catch (e) {
    console.warn('fleet_audit_log insert failed:', e)
  }
}
