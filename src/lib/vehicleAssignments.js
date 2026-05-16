// ============================================================================
// VEHICLE ASSIGNMENTS
//
// CRUD operations on vehicle_assignments. Drivers and conductors are HRMS
// employees in the "Drivers" and "Conductors" departments respectively.
//
// DB-level guarantees (enforced via partial unique indexes + trigger):
//   - Max 1 active driver + 1 active conductor per vehicle
//   - An employee can hold at most one active assignment at a time
//   - role='conductor' rejected on vehicle_type='small' (via trigger)
//
// "Ending" an assignment = setting assigned_to = today and status = 'inactive'.
// The row stays for history. Soft delete is reserved for actual mistakes.
// ============================================================================

import { supabaseAdmin } from './supabase'


// ----------------------------------------------------------------------------
// LIST — all non-deleted assignments for a vehicle (active + historical)
// ----------------------------------------------------------------------------
export async function listAssignments(vehicleId) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  const { data, error } = await supabaseAdmin
    .from('vehicle_assignments')
    .select(`
      id, vehicle_id, role, status, assigned_from, assigned_to,
      notes, created_at, created_by, updated_at, updated_by,
      employee_id,
      employee:employees ( id, full_name, employee_code, department_id )
    `)
    .eq('vehicle_id', vehicleId)
    .is('deleted_at', null)
    .order('status', { ascending: true })      // active first ('active' < 'inactive')
    .order('assigned_from', { ascending: false })

  if (error) throw error
  return data || []
}


// ----------------------------------------------------------------------------
// LIST ELIGIBLE EMPLOYEES — for the assignment dropdown
// ----------------------------------------------------------------------------
/**
 * Returns active employees in the relevant department (Drivers or Conductors)
 * who are NOT currently assigned to any other vehicle.
 *
 * Employees already actively assigned anywhere are filtered out — the DB
 * unique index would reject the insert anyway, so we hide them upstream to
 * avoid a confusing error.
 *
 *   role: 'driver' | 'conductor'
 */
export async function listEligibleEmployees({ role }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (role !== 'driver' && role !== 'conductor') {
    throw new Error("role must be 'driver' or 'conductor'")
  }

  const departmentName = role === 'driver' ? 'Drivers' : 'Conductors'

  // 1. Find the department row
  const { data: dept, error: dErr } = await supabaseAdmin
    .from('departments')
    .select('id')
    .eq('name', departmentName)
    .is('deleted_at', null)
    .maybeSingle()
  if (dErr) throw dErr
  if (!dept) {
    throw new Error(
      `${departmentName} department missing. Add it via the Departments page, ` +
      `or re-run the fleet migration.`
    )
  }

  // 2. All active employees in that department
  const { data: emps, error: eErr } = await supabaseAdmin
    .from('employees')
    .select('id, full_name, employee_code, branch_codes')
    .eq('department_id', dept.id)
    .eq('is_active', true)
    .order('full_name', { ascending: true })
  if (eErr) throw eErr
  if (!emps || emps.length === 0) return []

  // 3. Subtract anyone with an active assignment elsewhere
  const empIds = emps.map(e => e.id)
  const { data: assigned, error: aErr } = await supabaseAdmin
    .from('vehicle_assignments')
    .select('employee_id, vehicle_id, role')
    .in('employee_id', empIds)
    .eq('status', 'active')
    .is('deleted_at', null)
  if (aErr) throw aErr

  const busyIds = new Set((assigned || []).map(a => a.employee_id))
  return emps.filter(e => !busyIds.has(e.id))
}


// ----------------------------------------------------------------------------
// CREATE — assign an employee to a vehicle in a role
// ----------------------------------------------------------------------------
export async function createAssignment({
  vehicleId,
  employeeId,
  role,
  assignedFrom,        // YYYY-MM-DD; defaults to today
  notes,
  createdByEmail,
}) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!vehicleId)   throw new Error('vehicleId required')
  if (!employeeId)  throw new Error('employeeId required')
  if (role !== 'driver' && role !== 'conductor') {
    throw new Error("role must be 'driver' or 'conductor'")
  }

  const payload = {
    vehicle_id: vehicleId,
    employee_id: employeeId,
    role,
    assigned_from: assignedFrom || new Date().toISOString().slice(0, 10),
    status: 'active',
    notes: notes || null,
    created_by: createdByEmail || null,
    updated_by: createdByEmail || null,
  }

  const { data, error } = await supabaseAdmin
    .from('vehicle_assignments')
    .insert(payload)
    .select(`
      id, vehicle_id, role, status, assigned_from, assigned_to,
      employee_id,
      employee:employees ( id, full_name, employee_code )
    `)
    .single()

  if (error) {
    // Friendly errors for the constraint violations
    if (error.code === '23505') {
      // Partial unique index hit
      if (error.message && error.message.includes('uq_vehicle_assignments_active_employee')) {
        throw new Error('This employee already has an active assignment. End it first.')
      }
      throw new Error(`A ${role} is already assigned to this vehicle. End that assignment first.`)
    }
    // The conductor-on-small-vehicle trigger raises a plain exception
    if (error.message && /conductor.*small vehicle/i.test(error.message)) {
      throw new Error('Small vehicles cannot have a conductor.')
    }
    throw error
  }

  await logAudit({
    entityId: data.id,
    changedByEmail: createdByEmail,
    action: 'create',
    fieldName: `assignment:${role}`,
    oldValue: null,
    newValue: `employee:${employeeId}`,
  })

  return data
}


// ----------------------------------------------------------------------------
// END — close out an active assignment (sets assigned_to + status='inactive')
// ----------------------------------------------------------------------------
export async function endAssignment({
  assignmentId,
  endedDate,           // YYYY-MM-DD; defaults to today
  notes,               // appended to existing notes if provided
  endedByEmail,
}) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!assignmentId) throw new Error('assignmentId required')

  const today = endedDate || new Date().toISOString().slice(0, 10)

  // Fetch existing to preserve notes
  const { data: existing, error: fErr } = await supabaseAdmin
    .from('vehicle_assignments')
    .select('id, notes, role, employee_id')
    .eq('id', assignmentId)
    .single()
  if (fErr) throw fErr
  if (!existing) throw new Error('Assignment not found')

  const mergedNotes = notes
    ? (existing.notes ? `${existing.notes}\n— Ended: ${notes}` : `Ended: ${notes}`)
    : existing.notes

  const { data, error } = await supabaseAdmin
    .from('vehicle_assignments')
    .update({
      status: 'inactive',
      assigned_to: today,
      notes: mergedNotes,
      updated_at: new Date().toISOString(),
      updated_by: endedByEmail || null,
    })
    .eq('id', assignmentId)
    .select()
    .single()

  if (error) throw error

  await logAudit({
    entityId: assignmentId,
    changedByEmail: endedByEmail,
    action: 'update',
    fieldName: `assignment:${existing.role}:ended`,
    oldValue: 'active',
    newValue: `ended_on:${today}`,
  })

  return data
}


// ----------------------------------------------------------------------------
// Audit log helper (mirrors the one in vehicles.js)
// ----------------------------------------------------------------------------
async function logAudit({ entityId, changedByEmail, action, fieldName, oldValue, newValue }) {
  if (!supabaseAdmin) return
  try {
    await supabaseAdmin.from('fleet_audit_log').insert({
      entity_type: 'assignment',
      entity_id: entityId,
      changed_by_email: changedByEmail || 'unknown',
      action,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
    })
  } catch (e) {
    console.warn('fleet_audit_log insert failed:', e)
  }
}


// ----------------------------------------------------------------------------
// Small display helpers
// ----------------------------------------------------------------------------
export function isActive(a) {
  return a && a.status === 'active' && !a.deleted_at
}

export function fmtDateDDMMYY(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Returns "Mar 2024 – present" or "Mar 2024 – May 2025" */
export function fmtDateRange(from, to) {
  const f = fmtDateDDMMYY(from)
  const t = to ? fmtDateDDMMYY(to) : 'present'
  return `${f} – ${t}`
}
