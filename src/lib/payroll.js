// ============================================================================
// payroll.js — payroll data access (service-role admin client).
//
// Advances are NOT stored in HRMS: they live in SMS (v_salary_advances). We read
// the outstanding balance from there minus recoveries already taken via payroll.
// Attendance summary mirrors MonthlyReport (paid days = any non-'absent' record;
// absent = elapsed working dates with no record; Sundays + holidays excluded).
// ============================================================================

import { supabaseAdmin } from './supabase'
import { smsSupabase } from './smsSupabase'
import { computePayrollItem } from './payrollEngine'

const EMP_COLS = [
  'id', 'full_name', 'employee_code', 'designation', 'department', 'department_id',
  'branch_codes', 'attendance_exempt', 'is_active',
  'basic_salary', 'hra', 'other_allowances',
  'pay_mode', 'fixed_salary', 'epf_enabled', 'esi_enabled', 'lop_enabled', 'paid_leaves_per_month',
  'bank_account_number', 'bank_ifsc', 'bank_name',
  'pf_number', 'esi_number', 'uan_number', 'pan_number',
].join(', ')

const db = () => { if (!supabaseAdmin) throw new Error('Admin client not initialised'); return supabaseAdmin }

// ── Salary structure + config (edited from the employee's Salary tab) ────────
const SALARY_FIELDS = ['basic_salary', 'hra', 'other_allowances', 'pay_mode', 'fixed_salary',
  'epf_enabled', 'esi_enabled', 'lop_enabled', 'paid_leaves_per_month']

export async function saveSalaryProfile(employeeId, patch, actor) {
  const clean = { updated_by: actor || null, updated_at: new Date().toISOString() }
  for (const k of SALARY_FIELDS) {
    if (!(k in patch)) continue
    const v = patch[k]
    if (['basic_salary', 'hra', 'other_allowances', 'fixed_salary', 'paid_leaves_per_month'].includes(k)) {
      clean[k] = v === '' || v == null ? (k === 'fixed_salary' ? null : 0) : Number(v)
    } else if (['epf_enabled', 'esi_enabled', 'lop_enabled'].includes(k)) {
      clean[k] = !!v
    } else if (k === 'pay_mode') {
      clean[k] = v === 'fixed' ? 'fixed' : 'structured'
    }
  }
  const { data, error } = await db().from('employees').update(clean).eq('id', employeeId).select(EMP_COLS).single()
  if (error) throw error
  return data
}

// Employee details for payslips (name, code, designation, statutory ids, bank).
export async function getEmployeeDetails(ids = []) {
  const out = {}
  if (!ids.length) return out
  const { data, error } = await db().from('employees')
    .select('id, full_name, employee_code, designation, department, pf_number, esi_number, uan_number, bank_account_number, bank_ifsc, bank_name')
    .in('id', ids)
  if (error) throw error
  for (const e of data || []) out[e.id] = e
  return out
}

// ── Active employees for a branch (payroll roster) ───────────────────────────
export async function listPayrollEmployees(branchCode) {
  let q = db().from('employees').select(EMP_COLS).eq('is_active', true).order('full_name')
  if (branchCode) q = q.overlaps('branch_codes', [branchCode])
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// ── Advance balances: SMS advances given − recoveries taken via payroll ──────
export async function getAdvanceBalances(employeeIds = []) {
  const out = {}
  for (const id of employeeIds) out[id] = { advanced: 0, recovered: 0, balance: 0 }
  if (!employeeIds.length) return out

  // Advances GIVEN (SMS v_salary_advances; employee_id is the HRMS uuid as text).
  try {
    const idsAsText = employeeIds.map(String)
    let from = 0
    for (;;) {
      const { data, error } = await smsSupabase.from('v_salary_advances')
        .select('employee_id, amount').in('employee_id', idsAsText).range(from, from + 999)
      if (error) throw error
      for (const r of data || []) { const o = out[r.employee_id]; if (o) o.advanced += Number(r.amount || 0) }
      if (!data || data.length < 1000) break
      from += 1000
    }
  } catch (e) { console.warn('[payroll] advances read failed:', e?.message || e) }

  // Recoveries already taken (finalized/paid runs only — a draft is still being decided).
  const { data: runs } = await db().from('payroll_runs').select('id').in('status', ['finalized', 'paid'])
  const runIds = (runs || []).map((r) => r.id)
  if (runIds.length) {
    let from = 0
    for (;;) {
      const { data, error } = await db().from('payroll_items')
        .select('employee_id, advance_recovery').in('run_id', runIds).in('employee_id', employeeIds).range(from, from + 999)
      if (error) throw error
      for (const r of data || []) { const o = out[r.employee_id]; if (o) o.recovered += Number(r.advance_recovery || 0) }
      if (!data || data.length < 1000) break
      from += 1000
    }
  }
  for (const id of employeeIds) out[id].balance = Math.max(0, Math.round(out[id].advanced - out[id].recovered))
  return out
}

// ── Monthly attendance summary (mirrors MonthlyReport) ───────────────────────
// Returns { [employeeId]: { workingDays, paidDays, absent } } for the period.
export async function monthlyAttendanceSummary(branchCode, period /* 'YYYY-MM' */) {
  const monthStart = `${period}-01`
  const [y, m] = period.split('-').map(Number)
  const monthEnd = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  const todayIso = new Date().toLocaleDateString('en-CA')

  const holQ = db().from('holidays').select('date, branch_code').gte('date', monthStart).lt('date', monthEnd)
  const { data: hols, error: he } = await holQ
  if (he) throw he
  const holidayDates = new Set(
    (hols || [])
      .filter((h) => h.branch_code === null || h.branch_code === branchCode)
      .filter((h) => new Date(h.date + 'T00:00:00').getDay() !== 0)
      .map((h) => h.date),
  )
  // Elapsed working dates: Mon–Sat, not a holiday, not in the future.
  const workDates = []
  for (let d = new Date(monthStart + 'T00:00:00'), E = new Date(monthEnd + 'T00:00:00'); d < E; d.setDate(d.getDate() + 1)) {
    const iso = d.toLocaleDateString('en-CA')
    if (iso > todayIso) break
    if (d.getDay() === 0) continue
    if (holidayDates.has(iso)) continue
    workDates.push(iso)
  }
  const workingDays = workDates.length

  const attended = {}  // empId -> Set(dates)
  let from = 0
  for (;;) {
    let adQ = db().from('attendance_daily')
      .select('employee_id, date, status').gte('date', monthStart).lt('date', monthEnd).range(from, from + 999)
    if (branchCode) adQ = adQ.eq('branch_code', branchCode)
    const { data, error } = await adQ
    if (error) throw error
    for (const ad of data || []) {
      if (ad.status && ad.status !== 'absent') (attended[ad.employee_id] ||= new Set()).add(ad.date)
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
  const summary = {}
  const allIds = new Set(Object.keys(attended))
  for (const id of allIds) {
    const paid = workDates.reduce((n, d) => n + (attended[id].has(d) ? 1 : 0), 0)
    summary[id] = { workingDays, paidDays: paid, absent: workingDays - paid }
  }
  summary.__workingDays = workingDays
  return summary
}

// ── Runs ─────────────────────────────────────────────────────────────────────
export async function listRuns(branchCodes = []) {
  let q = db().from('payroll_runs').select('*').order('period', { ascending: false }).order('branch_code')
  if (branchCodes.length) q = q.in('branch_code', branchCodes)
  const { data, error } = await q
  if (error) throw error
  return data || []
}
export async function getRun(runId) {
  const { data, error } = await db().from('payroll_runs').select('*').eq('id', runId).single()
  if (error) throw error
  return data
}
export async function getOrCreateRun({ branchCode, period, actor }) {
  const { data: existing } = await db().from('payroll_runs').select('*').eq('branch_code', branchCode).eq('period', period).maybeSingle()
  if (existing) return existing
  const { data, error } = await db().from('payroll_runs')
    .insert({ branch_code: branchCode, period, status: 'draft', created_by: actor || null }).select('*').single()
  if (error) throw error
  return data
}
export async function getRunItems(runId) {
  const { data, error } = await db().from('payroll_items').select('*').eq('run_id', runId)
  if (error) throw error
  return data || []
}

// Recompute totals for an item row from its parts (LOP already reduces earnings).
function withTotals(row) {
  const earned = Number(row.gross || 0) - Number(row.lop_amount || 0)
  const total = Number(row.epf || 0) + Number(row.esi || 0) + Number(row.advance_recovery || 0) + Number(row.other_deduction || 0)
  return { ...row, total_deductions: Math.round(total), net_pay: Math.round(earned - total) }
}

// Seed / refresh a DRAFT run: compute a line for every active employee. Existing
// lines that were manually overridden are left as-is; others are refreshed.
export async function seedRun({ run, actor }) {
  if (run.status !== 'draft') throw new Error('Only a draft run can be recomputed.')
  const [emps, existingItems, att] = await Promise.all([
    listPayrollEmployees(run.branch_code),
    getRunItems(run.id),
    monthlyAttendanceSummary(run.branch_code, run.period),
  ])
  const workingDays = att.__workingDays || 0
  const balances = await getAdvanceBalances(emps.map((e) => e.id))
  const existingByEmp = Object.fromEntries(existingItems.map((it) => [it.employee_id, it]))

  // persist working_days on the run for reference
  await db().from('payroll_runs').update({ working_days: workingDays }).eq('id', run.id)

  const toUpsert = []
  for (const e of emps) {
    const prev = existingByEmp[e.id]
    if (prev && prev.is_overridden) continue  // respect manual edits
    const a = att[e.id] || { workingDays, paidDays: e.attendance_exempt ? workingDays : 0 }
    const calc = computePayrollItem({
      employee: e,
      attendance: { workingDays, paidDays: e.attendance_exempt ? workingDays : a.paidDays },
      advance: { balance: balances[e.id]?.balance || 0, monthlyInstallment: 0 },
      manual: prev ? { otherDeduction: prev.other_deduction, otherDeductionNote: prev.other_deduction_note, advanceRecovery: prev.advance_recovery } : {},
    })
    toUpsert.push({
      ...(prev ? { id: prev.id } : {}),
      run_id: run.id, employee_id: e.id,
      ...calc,
      bank_account_number: e.bank_account_number || null, bank_ifsc: e.bank_ifsc || null, bank_name: e.bank_name || null,
      is_overridden: false, updated_at: new Date().toISOString(), updated_by: actor || null,
    })
  }
  if (toUpsert.length) {
    const { error } = await db().from('payroll_items').upsert(toUpsert, { onConflict: 'run_id,employee_id' })
    if (error) throw error
  }
  return getRunItems(run.id)
}

// Save a manual edit to one line (marks it overridden; recomputes totals).
export async function saveItem(itemId, patch, actor) {
  const { data: cur, error: e0 } = await db().from('payroll_items').select('*').eq('id', itemId).single()
  if (e0) throw e0
  const merged = withTotals({ ...cur, ...patch })
  const { data, error } = await db().from('payroll_items')
    .update({ ...patch, total_deductions: merged.total_deductions, net_pay: merged.net_pay, is_overridden: true, updated_at: new Date().toISOString(), updated_by: actor || null })
    .eq('id', itemId).select('*').single()
  if (error) throw error
  return data
}

export async function setRunStatus(runId, status, actor) {
  const patch = { status }
  if (status === 'finalized') { patch.finalized_at = new Date().toISOString(); patch.finalized_by = actor || null }
  if (status === 'paid') { patch.paid_at = new Date().toISOString(); patch.paid_by = actor || null }
  const { data, error } = await db().from('payroll_runs').update(patch).eq('id', runId).select('*').single()
  if (error) throw error
  return data
}

export async function deleteRun(runId) {
  const { error } = await db().from('payroll_runs').delete().eq('id', runId)  // cascades items
  if (error) throw error
}
