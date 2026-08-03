// ============================================================================
// DEPARTMENT-WISE REPORTING TIME
//
// A per-(branch, department) override layer that sits between the branch
// default (reporting_time_config) and the per-employee custom timing. Each
// override has a MODE — override_custom:
//   false → "All except custom-timing employees" (custom → dept → branch)
//   true  → "All employees in the department"     (dept → branch; custom ignored)
// Any of in_time / out_time / grace_minutes may be null to inherit the branch
// default for that one field. Read by the DB resolver recompute_attendance_daily
// (migration 024). Snapshot semantics: only new punches pick up a change.
// ============================================================================

import { supabaseAdmin } from './supabase'

/**
 * Departments (active) joined with their override for `branchCode`.
 * Returns [{ department_id, name, employees, in_time, out_time,
 *            grace_minutes, override_custom, hasOverride }].
 */
export async function listDepartmentReportingTime(branchCode) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!branchCode) return []

  const [{ data: depts, error: dErr }, { data: cfgs, error: cErr }, { data: emps, error: eErr }] = await Promise.all([
    supabaseAdmin.from('departments')
      .select('id, name, display_order')
      .is('deleted_at', null)
      .order('display_order', { ascending: true }).order('name', { ascending: true }),
    supabaseAdmin.from('reporting_time_department_config')
      .select('department_id, in_time, out_time, grace_minutes, override_custom')
      .eq('branch_code', branchCode),
    // Active employee count per department AT THIS BRANCH (for context).
    supabaseAdmin.from('employees')
      .select('department_id, branch_codes')
      .eq('is_active', true).not('department_id', 'is', null),
  ])
  if (dErr) throw dErr
  if (cErr) throw cErr
  if (eErr) throw eErr

  const cfgById = new Map((cfgs || []).map(c => [c.department_id, c]))
  const countById = {}
  for (const e of (emps || [])) {
    if ((e.branch_codes || []).includes(branchCode)) {
      countById[e.department_id] = (countById[e.department_id] || 0) + 1
    }
  }

  return (depts || []).map(d => {
    const c = cfgById.get(d.id)
    return {
      department_id: d.id,
      name: d.name,
      employees: countById[d.id] || 0,
      in_time: c?.in_time?.slice(0, 5) || '',
      out_time: c?.out_time?.slice(0, 5) || '',
      grace_minutes: c?.grace_minutes ?? '',
      override_custom: c?.override_custom ?? false,
      hasOverride: !!c,
    }
  })
}

/**
 * Save one department's override for a branch. If in/out/grace are ALL blank,
 * the override row is deleted (that department inherits the branch default).
 * Otherwise it's upserted. Returns 'saved' | 'cleared'.
 */
export async function saveDepartmentReportingTime(branchCode, row, actor) {
  if (!supabaseAdmin) throw new Error('Admin client not initialised')
  if (!branchCode || !row?.department_id) throw new Error('Branch and department required')

  const inT  = row.in_time?.trim()  || null
  const outT = row.out_time?.trim() || null
  const grace = (row.grace_minutes === '' || row.grace_minutes == null) ? null : Number(row.grace_minutes)

  if (grace != null && (Number.isNaN(grace) || grace < 0 || grace > 60)) {
    throw new Error('Grace must be between 0 and 60 minutes')
  }
  if (inT && outT && inT >= outT) throw new Error('Out time must be after In time')

  // Nothing set → clear the override (inherit the branch default).
  if (!inT && !outT && grace == null) {
    const { error } = await supabaseAdmin.from('reporting_time_department_config')
      .delete().eq('branch_code', branchCode).eq('department_id', row.department_id)
    if (error) throw error
    return 'cleared'
  }

  const { error } = await supabaseAdmin.from('reporting_time_department_config')
    .upsert({
      branch_code: branchCode,
      department_id: row.department_id,
      in_time: inT,
      out_time: outT,
      grace_minutes: grace,
      override_custom: !!row.override_custom,
      updated_by: actor || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_code,department_id' })
  if (error) throw error
  return 'saved'
}
