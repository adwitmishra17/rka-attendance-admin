import { supabase } from './supabase'

// ============================================================================
// Employee branch transfers (migration 022).
// Any admin RAISES a request; only a super admin decides. Approval calls the
// apply_employee_transfer RPC, which swaps the branch inside
// employees.branch_codes and stamps the request in one transaction.
// ============================================================================

const TRANSFER_COLS =
  'id, employee_id, from_branch, to_branch, reason, effective_date, status, ' +
  'requested_by, requested_at, decided_by, decided_at, decision_note, applied_at, ' +
  'employees ( full_name, employee_code, biometric_code, designation )'

// Branch admins see transfers touching their branches; super admin sees all.
export async function listTransfers({ effectiveBranches = [], status } = {}) {
  let q = supabase
    .from('employee_transfers')
    .select(TRANSFER_COLS)
    .order('requested_at', { ascending: false })
  if (status) q = q.eq('status', status)
  if (effectiveBranches.length > 0) {
    const list = `(${effectiveBranches.join(',')})`
    q = q.or(`from_branch.in.${list},to_branch.in.${list}`)
  }
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function pendingTransferFor(employeeId) {
  const { data, error } = await supabase
    .from('employee_transfers')
    .select(TRANSFER_COLS)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function requestTransfer({ employeeId, fromBranch, toBranch, reason, effectiveDate, requestedBy }) {
  const { data, error } = await supabase
    .from('employee_transfers')
    .insert({
      employee_id: employeeId,
      from_branch: fromBranch,
      to_branch: toBranch,
      reason: reason || null,
      effective_date: effectiveDate || undefined,
      requested_by: requestedBy,
    })
    .select('id')
    .single()
  if (error) {
    if (String(error.message || '').includes('employee_transfers_one_pending')) {
      throw new Error('This employee already has a pending transfer request.')
    }
    throw error
  }
  return data
}

// Super admin only (gated in the UI). Atomic: branch swap + stamp.
export async function approveTransfer(id, decidedBy, note) {
  const { error } = await supabase.rpc('apply_employee_transfer', {
    p_transfer_id: id,
    p_decided_by: decidedBy,
    p_note: note || null,
  })
  if (error) throw error
}

export async function rejectTransfer(id, decidedBy, note) {
  const { error } = await supabase
    .from('employee_transfers')
    .update({ status: 'rejected', decided_by: decidedBy, decided_at: new Date().toISOString(), decision_note: note || null })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) throw error
}

export async function cancelTransfer(id, decidedBy) {
  const { error } = await supabase
    .from('employee_transfers')
    .update({ status: 'cancelled', decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) throw error
}
