import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { branchLabel } from '../lib/branch'
import { listTransfers, approveTransfer, rejectTransfer, cancelTransfer } from '../lib/transfers'

// ============================================================================
// Employee transfers — CITY ⇄ MAIN with super-admin approval.
// Requests are raised from an employee's profile (or here, super admin sees
// everything); this screen is the approval queue + history.
// After approval the employee's future punches attribute to the new branch
// automatically, but the FINGERPRINT lives on the physical device — the
// approver is reminded to enrol at the destination and remove at the source.
// ============================================================================

const STATUS_STYLE = {
  pending:   { color: 'var(--gold-dark)', bg: 'var(--gold-light)' },
  approved:  { color: 'var(--green)', bg: 'var(--green-light)' },
  rejected:  { color: 'var(--crimson)', bg: 'var(--crimson-light)' },
  cancelled: { color: 'var(--text-muted)', bg: 'var(--gray-100)' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function Transfers() {
  const { user, isSuperAdmin, effectiveBranches } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)          // transfer id being acted on
  const [decision, setDecision] = useState(null)  // { transfer, kind: 'approve'|'reject' }
  const [note, setNote] = useState('')

  const me = user?.email || user?.phone || 'admin'

  const load = useCallback(async () => {
    try {
      setRows(await listTransfers({ effectiveBranches }))
    } catch (e) {
      toast.show('Failed to load transfers: ' + e.message, 'error')
      setRows([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranches.join(',')])

  useEffect(() => { load() }, [load])

  async function decide() {
    const { transfer, kind } = decision
    setBusy(transfer.id)
    try {
      if (kind === 'approve') {
        await approveTransfer(transfer.id, me, note)
        toast.show(
          `Transfer approved — ${transfer.employees?.full_name} is now ${branchLabel(transfer.to_branch)}. ` +
          `Remember: enrol their fingerprint on the ${transfer.to_branch} device and remove it from ${transfer.from_branch}.`,
          'success',
        )
      } else {
        await rejectTransfer(transfer.id, me, note)
        toast.show('Transfer rejected', 'success')
      }
      setDecision(null); setNote('')
      await load()
    } catch (e) {
      toast.show(`Failed to ${kind}: ` + e.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function onCancel(t) {
    setBusy(t.id)
    try {
      await cancelTransfer(t.id, me)
      toast.show('Request cancelled', 'success')
      await load()
    } catch (e) {
      toast.show('Failed to cancel: ' + e.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const pending = (rows ?? []).filter(r => r.status === 'pending')
  const history = (rows ?? []).filter(r => r.status !== 'pending')

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="fade-in" style={{ marginBottom: 8 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
          Employee Transfers
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Branch transfers need super-admin approval. Requests are raised from an employee's profile.
        </p>
      </div>

      {/* Pending queue */}
      <div style={panel}>
        <div style={panelTitle}>Awaiting approval {pending.length > 0 && <span style={{ color: 'var(--gold-dark)' }}>· {pending.length}</span>}</div>
        {rows == null ? (
          <div style={muted}>Loading…</div>
        ) : pending.length === 0 ? (
          <div style={muted}>No pending requests.</div>
        ) : pending.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--gray-100)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text)' }}>
                {t.employees?.full_name || '—'}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                  {t.employees?.designation || ''}{t.employees?.biometric_code ? ` · bio ${t.employees.biometric_code}` : ''}
                </span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 3, color: 'var(--text-muted)' }}>
                <b style={{ color: 'var(--text)' }}>{branchLabel(t.from_branch)}</b>
                <span style={{ margin: '0 7px' }}>→</span>
                <b style={{ color: 'var(--green)' }}>{branchLabel(t.to_branch)}</b>
                <span style={{ margin: '0 7px' }}>·</span>effective {fmtDate(t.effective_date)}
              </div>
              {t.reason && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Reason: {t.reason}</div>}
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>Requested by {t.requested_by} · {fmtDateTime(t.requested_at)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isSuperAdmin && (
                <>
                  <button disabled={busy === t.id} onClick={() => { setDecision({ transfer: t, kind: 'approve' }); setNote('') }} style={btn('var(--green)', 'var(--green-light)')}>Approve</button>
                  <button disabled={busy === t.id} onClick={() => { setDecision({ transfer: t, kind: 'reject' }); setNote('') }} style={btn('var(--crimson)', 'var(--crimson-light)')}>Reject</button>
                </>
              )}
              {(t.requested_by === me || isSuperAdmin) && (
                <button disabled={busy === t.id} onClick={() => onCancel(t)} style={btn('var(--text-muted)', 'var(--gray-100)')}>Cancel</button>
              )}
            </div>
          </div>
        ))}
        {!isSuperAdmin && pending.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10 }}>
            Only a super admin can approve or reject these.
          </div>
        )}
      </div>

      {/* History */}
      <div style={panel}>
        <div style={panelTitle}>History</div>
        {rows == null ? (
          <div style={muted}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={muted}>No decided transfers yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {['Employee', 'Move', 'Status', 'Decided by', 'When', 'Note'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(t => {
                  const st = STATUS_STYLE[t.status] || STATUS_STYLE.cancelled
                  return (
                    <tr key={t.id}>
                      <td style={td}><b>{t.employees?.full_name || '—'}</b></td>
                      <td style={td}>{t.from_branch} → {t.to_branch}</td>
                      <td style={td}>
                        <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: st.color, background: st.bg }}>
                          {t.status}
                        </span>
                      </td>
                      <td style={td}>{t.decided_by || '—'}</td>
                      <td style={td}>{fmtDateTime(t.decided_at)}</td>
                      <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.decision_note || t.reason || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Decision modal */}
      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'approve' ? 'Approve transfer' : 'Reject transfer'}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setDecision(null)} style={btn('var(--text-muted)', 'var(--gray-100)')}>Back</button>
            <button onClick={decide} disabled={busy != null} style={btn('#fff', decision?.kind === 'approve' ? 'var(--green)' : 'var(--crimson)', true)}>
              {decision?.kind === 'approve' ? 'Approve & apply' : 'Reject request'}
            </button>
          </div>
        }
      >
        {decision && (
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
            <p style={{ marginBottom: 10 }}>
              <b>{decision.transfer.employees?.full_name}</b> — {branchLabel(decision.transfer.from_branch)} → <b>{branchLabel(decision.transfer.to_branch)}</b>
            </p>
            {decision.kind === 'approve' && (
              <div style={{ padding: '10px 12px', background: 'var(--gold-light)', border: '1px solid var(--gold)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, marginBottom: 12, color: 'var(--text)' }}>
                Punches will attribute to {decision.transfer.to_branch} immediately. The fingerprint lives on the
                physical device — move it with <b>fp-export.sh</b> (on the {decision.transfer.from_branch} device) and
                <b>fp-import.sh</b> (on the {decision.transfer.to_branch} one), then <b>fp-delete.sh</b> on the source —
                or re-enrol by finger at the destination.
              </div>
            )}
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', background: 'var(--white)', color: 'var(--text)', fontSize: 13, resize: 'vertical' }}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}

const panel = {
  background: 'var(--white)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-lg)',
  padding: '20px 24px',
}
const panelTitle = {
  fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600, marginBottom: 12,
}
const muted = { fontSize: 13, color: 'var(--text-muted)' }
const th = {
  textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-muted)', fontWeight: 600, padding: '6px 10px', borderBottom: '1px solid var(--gray-200)',
}
const td = { padding: '8px 10px', borderBottom: '1px solid var(--gray-100)', color: 'var(--text)' }

function btn(color, bg, solid = false) {
  return {
    padding: '7px 14px',
    background: bg,
    color,
    border: solid ? 'none' : '1px solid transparent',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  }
}
