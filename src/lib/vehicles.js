// ============================================================================
// VEHICLES
//
// CRUD operations on the vehicles table + small helpers (RC normalisation,
// display formatting, validation). Used by:
//   - Vehicles page (list, add, edit, delete)
//   - VehicleProfile page (when added in Phase 3 for documents)
//
// Mirrors src/lib/departments.js conventions:
//   - All writes go through supabaseAdmin (service role bypasses RLS)
//   - Soft-delete via deleted_at / deleted_by
//   - Audit log via fleet_audit_log (mirrors employee_audit_log pattern)
// ============================================================================

import { supabaseAdmin } from './supabase'


// ----------------------------------------------------------------------------
// Enumerations (also exported for use in form dropdowns)
// ----------------------------------------------------------------------------

export const FUEL_TYPES = [
  'Diesel', 'Petrol', 'CNG', 'LPG', 'Electric', 'Hybrid', 'Other',
]

export const VEHICLE_TYPES = [
  { value: 'bus',   label: 'Bus',           description: 'Has driver + conductor slots' },
  { value: 'small', label: 'Small vehicle', description: 'Driver only (no conductor)' },
]

export const VEHICLE_STATUSES = [
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'sold',     label: 'Sold' },
  { value: 'scrapped', label: 'Scrapped' },
]


// ----------------------------------------------------------------------------
// RC number helpers
// ----------------------------------------------------------------------------

/**
 * Normalise RC: uppercase + strip all whitespace. Matches the DB trigger,
 * so client and server agree on the canonical form.
 */
export function normalizeRc(rc) {
  if (!rc) return ''
  return String(rc).toUpperCase().replace(/\s+/g, '')
}

/**
 * Format an RC number for display with a space in the middle.
 * Cosmetic only — DB stores the normalised form.
 *   UP60AB1234 → "UP60 AB1234"
 *   Unknown layouts pass through unchanged.
 */
export function formatRcForDisplay(rc) {
  const n = normalizeRc(rc)
  const m = n.match(/^([A-Z]{2}\d{1,2})([A-Z]{1,3}\d{1,4})$/)
  return m ? `${m[1]} ${m[2]}` : n
}

/**
 * Validate RC number format. Indian RCs vary widely, so we accept any
 * 6–12 alphanumeric characters after normalisation. Returns null if valid,
 * error string if not.
 */
export function validateRc(rc) {
  if (!rc || !String(rc).trim()) return 'RC number is required'
  const n = normalizeRc(rc)
  if (n.length < 6 || n.length > 12) return 'RC number must be 6–12 characters'
  if (!/^[A-Z0-9]+$/.test(n)) return 'RC number can only contain letters and digits'
  return null
}


// ----------------------------------------------------------------------------
// LIST
// ----------------------------------------------------------------------------

/**
 * Fetch all non-deleted vehicles visible to the current branch context.
 * Pulls active assignments + employee names in a single query so the list
 * page can show driver/conductor names without N+1 queries.
 *
 *   { effectiveBranches }  — required; from useAuth()
 */
export async function listVehicles({ effectiveBranches }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!effectiveBranches || effectiveBranches.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('vehicles')
    .select(`
      *,
      assignments:vehicle_assignments!vehicle_id (
        id, role, status, employee_id, deleted_at,
        employee:employees ( id, full_name, employee_code )
      )
    `)
    .is('deleted_at', null)
    .in('branch_code', effectiveBranches)
    .order('rc_number', { ascending: true })

  if (error) throw error

  // Decorate each vehicle with .driver and .conductor for easy rendering.
  // We filter on the client because PostgREST nested filters can't filter
  // a child collection while still returning the parent row.
  for (const v of (data || [])) {
    const active = (v.assignments || []).filter(
      a => a.status === 'active' && a.deleted_at === null
    )
    v.driver    = active.find(a => a.role === 'driver')?.employee    || null
    v.conductor = active.find(a => a.role === 'conductor')?.employee || null
  }

  return data || []
}


/**
 * Fetch a single vehicle by id, including all non-deleted assignments
 * (active + historical). For the detail page once it exists.
 */
export async function getVehicle(id) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const { data, error } = await supabaseAdmin
    .from('vehicles')
    .select(`
      *,
      assignments:vehicle_assignments!vehicle_id (
        id, role, status, employee_id, assigned_from, assigned_to,
        notes, created_at, deleted_at,
        employee:employees ( id, full_name, employee_code, department_id )
      )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error) throw error
  if (data) {
    data.assignments = (data.assignments || []).filter(a => a.deleted_at === null)
  }
  return data
}


// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------

export async function createVehicle({ form, createdByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const payload = sanitiseForm(form)
  validatePayload(payload)
  payload.created_by = createdByEmail || null
  payload.updated_by = createdByEmail || null

  const { data, error } = await supabaseAdmin
    .from('vehicles')
    .insert(payload)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error(`A vehicle with RC ${payload.rc_number} already exists`)
    }
    throw error
  }

  await logAudit({
    entityType: 'vehicle',
    entityId: data.id,
    changedByEmail: createdByEmail,
    action: 'create',
    fieldName: null,
    oldValue: null,
    newValue: data.rc_number,
  })

  return data
}


// ----------------------------------------------------------------------------
// UPDATE
// ----------------------------------------------------------------------------

/**
 * Update a vehicle. If `originalForm` is provided, one audit row per changed
 * field is written. Otherwise a single 'update' audit row is written.
 */
export async function updateVehicle({ id, form, originalForm, updatedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const payload = sanitiseForm(form)
  validatePayload(payload)
  payload.updated_by = updatedByEmail || null
  payload.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('vehicles')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Another vehicle with RC ${payload.rc_number} already exists`)
    }
    throw error
  }

  if (originalForm) {
    const changes = diffFields(originalForm, payload)
    for (const [field, [oldVal, newVal]] of Object.entries(changes)) {
      await logAudit({
        entityType: 'vehicle',
        entityId: id,
        changedByEmail: updatedByEmail,
        action: 'update',
        fieldName: field,
        oldValue: oldVal == null ? null : String(oldVal),
        newValue: newVal == null ? null : String(newVal),
      })
    }
  } else {
    await logAudit({
      entityType: 'vehicle',
      entityId: id,
      changedByEmail: updatedByEmail,
      action: 'update',
      fieldName: null,
      oldValue: null,
      newValue: data.rc_number,
    })
  }

  return data
}


// ----------------------------------------------------------------------------
// SOFT DELETE
// ----------------------------------------------------------------------------

/**
 * Soft-delete a vehicle. Refuses if there are active driver/conductor
 * assignments — those must be unassigned first.
 */
export async function softDeleteVehicle({ id, deletedByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  // Block delete if any active assignments remain.
  const { count, error: countErr } = await supabaseAdmin
    .from('vehicle_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', id)
    .eq('status', 'active')
    .is('deleted_at', null)
  if (countErr) throw countErr
  if (count && count > 0) {
    throw new Error(
      `Cannot delete: ${count} active assignment${count === 1 ? '' : 's'}. ` +
      `Unassign driver/conductor first.`
    )
  }

  const nowIso = new Date().toISOString()

  // Cascade the soft-delete to this vehicle's documents FIRST. Expiry widgets
  // and the alert digest filter on the document's OWN deleted_at, so unless
  // the document rows are hidden too, a deleted vehicle's documents keep
  // showing as "expiring soon". Doing this first makes a failed delete safe to
  // retry — the .is('deleted_at', null) filter just no-ops on already-done rows.
  const { error: docErr } = await supabaseAdmin
    .from('vehicle_documents')
    .update({ deleted_at: nowIso, deleted_by: deletedByEmail || null })
    .eq('vehicle_id', id)
    .is('deleted_at', null)
  if (docErr) throw docErr

  const { data, error } = await supabaseAdmin
    .from('vehicles')
    .update({
      deleted_at: nowIso,
      deleted_by: deletedByEmail || null,
      updated_at: nowIso,
      updated_by: deletedByEmail || null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  await logAudit({
    entityType: 'vehicle',
    entityId: id,
    changedByEmail: deletedByEmail,
    action: 'delete',
    fieldName: null,
    oldValue: data.rc_number,
    newValue: null,
  })

  return data
}


// ----------------------------------------------------------------------------
// Audit log helper
// ----------------------------------------------------------------------------

async function logAudit({ entityType, entityId, changedByEmail, action, fieldName, oldValue, newValue }) {
  if (!supabaseAdmin) return
  try {
    await supabaseAdmin.from('fleet_audit_log').insert({
      entity_type: entityType,
      entity_id: entityId,
      changed_by_email: changedByEmail || 'unknown',
      action,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
    })
  } catch (e) {
    // Never let an audit failure mask the primary error.
    console.warn('fleet_audit_log insert failed:', e)
  }
}


// ----------------------------------------------------------------------------
// Form sanitisation + validation
// ----------------------------------------------------------------------------

const EDITABLE_FIELDS = [
  'rc_number', 'branch_code', 'vehicle_type',
  'make', 'model', 'year_of_manufacture', 'seating_capacity', 'fuel_type',
  'chassis_number', 'engine_number', 'owner_name',
  'registration_date', 'status', 'notes',
]

/**
 * Trim strings, coerce empty → null, normalise rc_number, parse numbers.
 * Only EDITABLE_FIELDS are kept (defends against accidental over-posting).
 */
function sanitiseForm(form) {
  const out = {}
  for (const k of EDITABLE_FIELDS) {
    let v = form[k]
    if (typeof v === 'string') v = v.trim()
    if (v === '' || v === undefined) v = null
    out[k] = v
  }
  if (out.rc_number)  out.rc_number  = normalizeRc(out.rc_number)
  if (out.fuel_type)  out.fuel_type  = String(out.fuel_type).trim()

  // Coerce numeric fields if they came in as strings (HTML inputs do that)
  if (out.year_of_manufacture != null) {
    const n = parseInt(out.year_of_manufacture, 10)
    out.year_of_manufacture = Number.isFinite(n) ? n : null
  }
  if (out.seating_capacity != null) {
    const n = parseInt(out.seating_capacity, 10)
    out.seating_capacity = Number.isFinite(n) ? n : null
  }

  return out
}

/**
 * Server-side validation gate. Mirrors UI-side validation; protects against
 * direct API calls that skip the form.
 */
function validatePayload(p) {
  const rcErr = validateRc(p.rc_number)
  if (rcErr) throw new Error(rcErr)
  if (!p.branch_code || !['MAIN', 'CITY'].includes(p.branch_code)) {
    throw new Error('Branch is required')
  }
  if (!p.vehicle_type || !['bus', 'small'].includes(p.vehicle_type)) {
    throw new Error('Vehicle type is required')
  }
  if (p.year_of_manufacture != null) {
    const now = new Date().getFullYear()
    if (p.year_of_manufacture < 1980 || p.year_of_manufacture > now + 1) {
      throw new Error(`Year of manufacture must be between 1980 and ${now + 1}`)
    }
  }
  if (p.seating_capacity != null && p.seating_capacity <= 0) {
    throw new Error('Seating capacity must be greater than zero')
  }
}

/**
 * Returns { fieldName: [oldVal, newVal] } for fields that actually changed.
 * Used to generate per-field audit log rows on update.
 */
function diffFields(oldForm, newForm) {
  const changes = {}
  for (const k of EDITABLE_FIELDS) {
    const a = oldForm[k] ?? null
    const b = newForm[k] ?? null
    if (a !== b && !(a == null && b == null)) {
      changes[k] = [a, b]
    }
  }
  return changes
}
