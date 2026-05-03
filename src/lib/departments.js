// ============================================================================
// DEPARTMENTS
//
// CRUD operations on the departments table. Used by:
//   - DepartmentsPage (admin management)
//   - EmployeeProfile (dropdown in edit form)
//   - Employees list (filter chips)
// ============================================================================

import { supabaseAdmin } from './supabase'

/**
 * Fetch all active (non-deleted) departments, ordered by display_order then name.
 */
export async function listDepartments() {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, name, display_order, created_at, updated_at')
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Create a new department. display_order defaults to "after the last".
 */
export async function createDepartment({ name, displayOrder, createdByEmail }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const trimmed = name?.trim()
  if (!trimmed) throw new Error('Department name is required')

  // Resolve display order if not provided
  let order = displayOrder
  if (order == null) {
    const { data: max } = await supabaseAdmin
      .from('departments')
      .select('display_order')
      .is('deleted_at', null)
      .order('display_order', { ascending: false })
      .limit(1)
    order = ((max?.[0]?.display_order || 0) + 10)
  }

  const { data, error } = await supabaseAdmin
    .from('departments')
    .insert({ name: trimmed, display_order: order })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Rename / re-order a department.
 */
export async function updateDepartment({ id, name, displayOrder }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const updates = {}
  if (name != null) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Department name cannot be empty')
    updates.name = trimmed
  }
  if (displayOrder != null) updates.display_order = displayOrder
  if (Object.keys(updates).length === 0) return null

  const { data, error } = await supabaseAdmin
    .from('departments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Soft-delete a department. If employees are still assigned, throws.
 * (FK uses ON DELETE SET NULL, but soft-delete preserves history.)
 */
export async function deleteDepartment({ id }) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')

  // Check assignment count before deleting
  const { count, error: countErr } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('department_id', id)
    .eq('is_active', true)
  if (countErr) throw countErr
  if (count && count > 0) {
    throw new Error(`Cannot delete: ${count} active employee(s) still assigned. Reassign them first.`)
  }

  const { data, error } = await supabaseAdmin
    .from('departments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Swap display_order between two departments (used for up/down reorder).
 */
export async function reorderDepartments(idA, orderA, idB, orderB) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  // Run as two separate updates; not transactional but acceptable for low scale
  const r1 = await supabaseAdmin.from('departments').update({ display_order: orderB }).eq('id', idA)
  if (r1.error) throw r1.error
  const r2 = await supabaseAdmin.from('departments').update({ display_order: orderA }).eq('id', idB)
  if (r2.error) throw r2.error
}

/**
 * Count active employees per department. For the manage page badge.
 */
export async function countEmployeesByDepartment() {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('department_id')
    .eq('is_active', true)
    .not('department_id', 'is', null)
  if (error) throw error
  const counts = {}
  for (const row of (data || [])) {
    counts[row.department_id] = (counts[row.department_id] || 0) + 1
  }
  return counts
}
