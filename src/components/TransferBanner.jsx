import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { useToast } from './Toast'
import Modal from './Modal'
import { BRANCHES, branchLabel } from '../lib/branch'
import { pendingTransferFor, requestTransfer, cancelTransfer } from '../lib/transfers'

// ============================================================================
// Branch-transfer strip on the employee profile.
// Raises a request (any admin) and shows the pending state; approval and
// rejection live on the Transfers page (super admin). Approval swaps
// employees.branch_codes atomically — see lib/transfers.js / migration 022.
// ============================================================================

export default function TransferBanner({ employee }) {
  const { user, isSuperAdmin } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [pending, setPending] = useState(undefined)   // undefined = loading
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fromBranch, setFromBranch] = useState(null)
  const [reason, setReason] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')

  const me = user?.email || user?.phone || 'admin'
  const codes = Array.isArray(employee?.branch_codes) ? employee.branch_codes : []

  const load = useCallback(async () => {
    try { setPending(await pendingTransferFor(employee.id)) }
    catch { setPending(null) }
  }, [employee.id])

  useEffect(() => { load() }, [load])

  if (!employee?.is_active || codes.length === 0 || pending === undefined) return null

  const from = fromBranch || codes[0]
  const to = BRANCHES.map(b => b.code).find(c => c !== from) || null

  async function submit() {
    if (!to) return
    setBusy(true)
    try {
      await requestTransfer({
        employeeId: employee.id,
        fromBranch: from,
        toBranch: to,
        reason,
        effectiveDate: effectiveDate || undefined,
        requestedBy: me,
      })
      toast.show(isSuperAdmin
        ? 'Transfer requested — approve it on the Transfers page.'
        : 'Transfer requested — awaiting super-admin approval.', 'success')
      setOpen(false); setReason(''); setEffectiveDate('')
      await load()
    } catch (e) {
      toast.show('Failed to request transfer: ' + e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function onCancel() {
    setBusy(true)
    try {
      await cancelTransfer(pending.id, me)
      toast.show('Transfer request cancelled', 'success')
      await load()
    } catch (e) {
      toast.show('Failed to cancel: ' + e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {pending ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '12px 16px',
          background: 'var(--gold-light)',
          border: '1px solid var(--gold)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12.5, color: 'var(--text)',
        }}>
          <span style={{ fontWeight: 650, color: 'var(--gold-dark)', textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.06em' }}>
            Transfer pending
          </span>
          <span>
            {branchLabel(pending.from_branch)} → <b>{branchLabel(pending.to_branch)}</b>
            <span style={{ color: 'var(--text-muted)' }}> · requested by {pending.requested_by}</span>
          </span>
          <span style={{ flex: 1 }} />
          {isSuperAdmin && (
            <button onClick={() => navigate('/transfers')} style={chipBtn('var(--green)', 'var(--green-light)')}>
              Review on Transfers
            </button>
          )}
          {(pending.requested_by === me || isSuperAdmin) && (
            <button disabled={busy} onClick={onCancel} style={chipBtn('var(--text-muted)', 'var(--gray-100)')}>
              Cancel request
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => { setFromBranch(codes[0]); setOpen(true) }} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '7px 14px',
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 999,
          fontSize: 12, fontWeight: 600, color: 'var(--text)',
          cursor: 'pointer',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
            <path d="M8 3 4 7l4 4" /><path d="M4 7h16" />
            <path d="m16 21 4-4-4-4" /><path d="M20 17H4" />
          </svg>
          Request branch transfer
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request branch transfer"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)} style={chipBtn('var(--text-muted)', 'var(--gray-100)')}>Back</button>
            <button onClick={submit} disabled={busy || !to} style={{ ...chipBtn('#fff', 'var(--green)'), border: 'none' }}>
              {busy ? 'Requesting…' : 'Submit request'}
            </button>
          </div>
        }
      >
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          <p style={{ marginBottom: 12 }}>
            <b>{employee.full_name}</b> — currently {codes.map(branchLabel).join(' + ')}
          </p>
          {codes.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Move out of</label>
              <select value={from} onChange={e => setFromBranch(e.target.value)} style={field}>
                {codes.map(c => <option key={c} value={c}>{branchLabel(c)}</option>)}
              </select>
            </div>
          )}
          <p style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
            {branchLabel(from)} → <b style={{ color: 'var(--green)' }}>{to ? branchLabel(to) : '—'}</b>
            {' '}· needs super-admin approval before anything changes.
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Effective date (optional — defaults to today)</label>
            <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} style={field} />
          </div>
          <div>
            <label style={lbl}>Reason</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ ...field, resize: 'vertical' }} placeholder="Why is this transfer needed?" />
          </div>
        </div>
      </Modal>
    </div>
  )
}

const lbl = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }
const field = {
  width: '100%', padding: '9px 11px',
  border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
  background: 'var(--white)', color: 'var(--text)', fontSize: 13,
}
function chipBtn(color, bg) {
  return {
    padding: '6px 13px', background: bg, color,
    border: '1px solid transparent', borderRadius: 999,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}
