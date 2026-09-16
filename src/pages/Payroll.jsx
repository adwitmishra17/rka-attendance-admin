import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import {
  Page, PageHead, Card, CardHead, PrimaryButton, SecondaryButton, Segment, Pill,
  SearchInput, LoadingBlock, EmptyBlock, tableHead, tableCell,
} from '../components/ui'
import { BRANCHES } from '../lib/branch'
import {
  getOrCreateRun, getRunItems, seedRun, saveItem, setRunStatus, deleteRun, getEmployeeDetails,
} from '../lib/payroll'
import { generatePayslips } from '../lib/payslipPdf'

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7)
const monthLabel = (p) => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }

const STATUS_PILL = {
  draft: { bg: 'var(--gold-light, #fdf3d8)', fg: 'var(--gold-dark, #8a6d18)', label: 'Draft' },
  finalized: { bg: 'var(--green-light)', fg: 'var(--green)', label: 'Finalized' },
  paid: { bg: 'var(--text)', fg: 'var(--white)', label: 'Paid' },
}

export default function Payroll() {
  const { user, allowedBranches, currentBranch } = useAuth()
  const toast = useToast()
  const actor = user?.email || 'admin'
  const branchOpts = (allowedBranches?.length ? allowedBranches : BRANCHES.map((b) => b.code))

  const [branch, setBranch] = useState(currentBranch || branchOpts[0])
  const [period, setPeriod] = useState(thisMonth())
  const [run, setRun] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)      // item being edited

  const locked = run && run.status !== 'draft'

  async function openRun() {
    setLoading(true); setRun(null); setItems([])
    try {
      const r = await getOrCreateRun({ branchCode: branch, period, actor })
      setRun(r)
      setItems(await getRunItems(r.id))
    } catch (e) { toast.show('Could not open run: ' + e.message, 'error') }
    setLoading(false)
  }

  async function recompute() {
    if (!run) return
    setBusy('compute')
    try { setItems(await seedRun({ run, actor })); toast.show('Payroll computed from salary + attendance') }
    catch (e) { toast.show('Compute failed: ' + e.message, 'error') }
    setBusy('')
  }

  async function changeStatus(status) {
    if (!run) return
    const verb = status === 'finalized' ? 'Finalize' : status === 'paid' ? 'Mark paid' : 'Reopen'
    if (status !== 'draft' && !window.confirm(`${verb} payroll for ${monthLabel(period)} · ${branch}? ${status === 'finalized' ? 'Lines lock; you can reopen before marking paid.' : ''}`)) return
    setBusy(status)
    try { setRun(await setRunStatus(run.id, status, actor)); toast.show(`${verb}d`) }
    catch (e) { toast.show(verb + ' failed: ' + e.message, 'error') }
    setBusy('')
  }

  async function removeRun() {
    if (!run || run.status === 'paid') return
    if (!window.confirm(`Delete this draft run for ${monthLabel(period)} · ${branch}? All its lines are discarded.`)) return
    setBusy('delete')
    try { await deleteRun(run.id); setRun(null); setItems([]); toast.show('Run deleted') }
    catch (e) { toast.show('Delete failed: ' + e.message, 'error') }
    setBusy('')
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    const rows = [...items].sort((a, b) => (b.net_pay || 0) - (a.net_pay || 0))
    if (!t) return rows
    return rows.filter((r) => (r._name || '').toLowerCase().includes(t))
  }, [items, q])

  // enrich items with employee name/code (seed stores bank snapshot but not name) — fetch lazily
  const [empMap, setEmpMap] = useState({})
  useEffect(() => {
    const ids = items.map((i) => i.employee_id).filter((id) => !empMap[id])
    if (!ids.length) return
    import('../lib/supabase').then(({ supabaseAdmin }) => {
      supabaseAdmin.from('employees').select('id, full_name, employee_code, designation, pay_mode, attendance_exempt')
        .in('id', ids).then(({ data }) => {
          if (data) setEmpMap((m) => ({ ...m, ...Object.fromEntries(data.map((e) => [e.id, e])) }))
        })
    })
  }, [items]) // eslint-disable-line

  const totals = useMemo(() => items.reduce((a, i) => ({
    gross: a.gross + Number(i.gross || 0), ded: a.ded + Number(i.total_deductions || 0) + Number(i.lop_amount || 0),
    net: a.net + Number(i.net_pay || 0),
  }), { gross: 0, ded: 0, net: 0 }), [items])

  async function downloadPayslips(subset) {
    const rows = subset || items
    if (!rows.length) return
    setBusy('payslips')
    try {
      const empById = await getEmployeeDetails(rows.map((r) => r.employee_id))
      await generatePayslips({ run, items: rows, empById })
    } catch (e) { toast.show('Payslip failed: ' + e.message, 'error') }
    setBusy('')
  }

  function downloadBankSheet() {
    const rows = items.map((i) => {
      const e = empMap[i.employee_id] || {}
      return [e.full_name || '', e.employee_code || '', i.bank_account_number || '', i.bank_ifsc || '', i.bank_name || '', Math.round(i.net_pay || 0)]
    }).filter((r) => Number(r[5]) > 0)
    const head = ['Employee', 'Emp code', 'Account no', 'IFSC', 'Bank', 'Net amount']
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `salary-bank-transfer-${branch}-${period}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const sp = run ? (STATUS_PILL[run.status] || STATUS_PILL.draft) : null

  return (
    <Page>
      <PageHead
        eyebrow="Payroll"
        title="Monthly Payroll"
        sub="Compute salaries from each employee's structure and this month's attendance, review, finalize and pay."
        actions={run && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill bg={sp.bg} fg={sp.fg}>{sp.label}</Pill>
            {run.status === 'draft' && <SecondaryButton onClick={recompute} disabled={busy === 'compute'}>{busy === 'compute' ? 'Computing…' : items.length ? 'Recompute' : 'Compute'}</SecondaryButton>}
            {items.length > 0 && <SecondaryButton onClick={() => downloadPayslips()} disabled={busy === 'payslips'}>{busy === 'payslips' ? 'Payslips…' : 'Payslips'}</SecondaryButton>}
            {items.length > 0 && <SecondaryButton onClick={downloadBankSheet}>Bank sheet</SecondaryButton>}
            {run.status === 'draft' && items.length > 0 && <PrimaryButton onClick={() => changeStatus('finalized')} disabled={busy === 'finalized'}>Finalize</PrimaryButton>}
            {run.status === 'finalized' && <><SecondaryButton onClick={() => changeStatus('draft')} disabled={busy === 'draft'}>Reopen</SecondaryButton><PrimaryButton onClick={() => changeStatus('paid')} disabled={busy === 'paid'}>Mark paid</PrimaryButton></>}
          </div>
        )}
      />

      <Card>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', padding: '14px 18px', flexWrap: 'wrap' }}>
          {branchOpts.length > 1 && (
            <div>
              <Lbl>Branch</Lbl>
              <Segment value={branch} onChange={setBranch} options={branchOpts.map((c) => ({ value: c, label: c }))} />
            </div>
          )}
          <div>
            <Lbl>Month</Lbl>
            <input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)}
              style={{ height: 36, padding: '0 12px', border: '1px solid var(--gray-200)', borderRadius: 10, fontSize: 13, background: 'var(--white)', color: 'var(--text)', fontFamily: 'var(--font-body)' }} />
          </div>
          <PrimaryButton onClick={openRun} disabled={loading}>{loading ? 'Opening…' : 'Open payroll'}</PrimaryButton>
          {run && run.status === 'draft' && <SecondaryButton onClick={removeRun} disabled={busy === 'delete'} style={{ marginLeft: 'auto' }}>Delete run</SecondaryButton>}
        </div>
      </Card>

      {loading && <Card><LoadingBlock label="Opening payroll…" /></Card>}

      {run && !loading && items.length === 0 && (
        <Card><EmptyBlock
          title="No lines yet"
          sub={`Click Compute to build this month's payroll for ${branchLabelSafe(branch)} — one line per active employee, from their salary structure and attendance.`}
          action={<PrimaryButton onClick={recompute} disabled={busy === 'compute'}>{busy === 'compute' ? 'Computing…' : 'Compute payroll'}</PrimaryButton>}
        /></Card>
      )}

      {run && items.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Stat label="Employees" value={String(items.length)} />
            <Stat label="Gross" value={inr(totals.gross)} />
            <Stat label="Deductions + LOP" value={inr(totals.ded)} tone="var(--crimson)" />
            <Stat label="Net payable" value={inr(totals.net)} tone="var(--green)" />
          </div>

          <Card>
            <CardHead title={`${monthLabel(period)} · ${branchLabelSafe(branch)}`} sub={`Working days: ${run.working_days ?? '—'} · per-day = gross ÷ 30${locked ? ' · locked' : ' · click a row to adjust'}`}
              right={<SearchInput value={q} onChange={setQ} placeholder="Find employee…" width={200} />} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={tableHead}>Employee</th>
                  <th style={{ ...tableHead, textAlign: 'center' }}>Days</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>Gross</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>LOP</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>EPF</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>ESI</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>Advance</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>Other</th>
                  <th style={{ ...tableHead, textAlign: 'right' }}>Net</th>
                </tr></thead>
                <tbody>
                  {filtered.map((i) => {
                    const e = empMap[i.employee_id] || {}
                    return (
                      <tr key={i.id} onClick={() => setEdit({ ...i, _emp: e })}
                        style={{ borderBottom: '1px solid var(--gray-100)', cursor: 'pointer' }}>
                        <td style={tableCell}>
                          <div style={{ fontWeight: 600 }}>{e.full_name || '…'} {i.is_overridden && <Pill bg="var(--gold-light,#fdf3d8)" fg="var(--gold-dark,#8a6d18)" style={{ marginLeft: 6 }}>edited</Pill>}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.employee_code || ''}{i.pay_mode === 'fixed' ? ' · fixed' : ''}{e.attendance_exempt ? ' · attд-exempt' : ''}</div>
                        </td>
                        <td style={{ ...tableCell, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                          {i.pay_mode === 'fixed' ? '—' : <>{i.paid_days}/{i.working_days}{i.lop_days > 0 && <span style={{ color: 'var(--crimson)' }}> · {i.lop_days} LOP</span>}</>}
                        </td>
                        <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(i.gross)}</td>
                        <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: i.lop_amount ? 'var(--crimson)' : 'var(--text-muted)' }}>{i.lop_amount ? '−' + inr(i.lop_amount) : '—'}</td>
                        <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{i.epf ? inr(i.epf) : '—'}</td>
                        <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{i.esi ? inr(i.esi) : '—'}</td>
                        <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{i.advance_recovery ? inr(i.advance_recovery) : '—'}</td>
                        <td style={{ ...tableCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{i.other_deduction ? inr(i.other_deduction) : '—'}</td>
                        <td style={{ ...tableCell, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{inr(i.net_pay)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {edit && <EditItemModal item={edit} actor={actor} locked={locked}
        onPayslip={() => downloadPayslips([edit])}
        onClose={() => setEdit(null)}
        onSaved={(saved) => { setItems((xs) => xs.map((x) => x.id === saved.id ? { ...saved } : x)); setEdit(null) }} />}
    </Page>
  )
}

function EditItemModal({ item, actor, locked, onPayslip, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({
    advance_recovery: item.advance_recovery || 0,
    other_deduction: item.other_deduction || 0,
    other_deduction_note: item.other_deduction_note || '',
    epf: item.epf || 0, esi: item.esi || 0, lop_amount: item.lop_amount || 0, gross: item.gross || 0,
    remarks: item.remarks || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const earned = Number(f.gross || 0) - Number(f.lop_amount || 0)
  const net = Math.round(earned - (Number(f.epf) + Number(f.esi) + Number(f.advance_recovery) + Number(f.other_deduction)))

  async function save() {
    setSaving(true)
    try {
      const patch = {
        gross: Number(f.gross) || 0, lop_amount: Number(f.lop_amount) || 0,
        epf: Number(f.epf) || 0, esi: Number(f.esi) || 0,
        advance_recovery: Number(f.advance_recovery) || 0,
        other_deduction: Number(f.other_deduction) || 0, other_deduction_note: f.other_deduction_note || null,
        remarks: f.remarks || null,
      }
      const saved = await saveItem(item.id, patch, actor)
      onSaved(saved); toast.show('Line updated')
    } catch (e) { toast.show('Save failed: ' + e.message, 'error') }
    setSaving(false)
  }

  return (
    <Modal open onClose={onClose} title={item._emp?.full_name || 'Payroll line'}
      footer={<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ fontSize: 13 }}>Net pay <b style={{ fontSize: 16, marginLeft: 6 }}>{inr(net)}</b></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <SecondaryButton onClick={onPayslip}>Payslip</SecondaryButton>
          {locked
            ? <SecondaryButton onClick={onClose}>Close</SecondaryButton>
            : <><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save line'}</PrimaryButton></>}
        </div>
      </div>}>
      <fieldset disabled={locked} style={{ border: 'none', padding: 0, margin: 0 }}>
      {locked && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>This run is {'finalized'} — reopen it to edit.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Fld label="Advance recovery"><NumIn v={f.advance_recovery} on={(v) => set('advance_recovery', v)} /></Fld>
        <Fld label="Other deduction"><NumIn v={f.other_deduction} on={(v) => set('other_deduction', v)} /></Fld>
        <Fld label="Other deduction note" span2><input value={f.other_deduction_note} onChange={(e) => set('other_deduction_note', e.target.value)} placeholder="e.g. TDS, fine" style={inStyle} /></Fld>
        <Fld label="Remarks" span2><input value={f.remarks} onChange={(e) => set('remarks', e.target.value)} style={inStyle} /></Fld>
      </div>
      <details style={{ marginTop: 14 }}>
        <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>Override computed figures (gross / LOP / EPF / ESI)</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          <Fld label="Gross"><NumIn v={f.gross} on={(v) => set('gross', v)} /></Fld>
          <Fld label="LOP amount"><NumIn v={f.lop_amount} on={(v) => set('lop_amount', v)} /></Fld>
          <Fld label="EPF"><NumIn v={f.epf} on={(v) => set('epf', v)} /></Fld>
          <Fld label="ESI"><NumIn v={f.esi} on={(v) => set('esi', v)} /></Fld>
        </div>
      </details>
      </fieldset>
    </Modal>
  )
}

const inStyle = { width: '100%', height: 36, padding: '0 10px', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 13, background: 'var(--white)', color: 'var(--text)', fontFamily: 'var(--font-body)' }
function NumIn({ v, on }) { return <input type="number" value={v} onChange={(e) => on(e.target.value)} style={{ ...inStyle, textAlign: 'right' }} /> }
function Fld({ label, children, span2 }) { return <label style={{ display: 'block', gridColumn: span2 ? '1 / -1' : 'auto' }}><div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>{label}</div>{children}</label> }
function Lbl({ children }) { return <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>{children}</div> }
function Stat({ label, value, tone }) { return <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 14, padding: '14px 16px' }}><div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 700, color: tone || 'var(--text)', fontFamily: 'var(--font-display)' }}>{value}</div></div> }
function branchLabelSafe(c) { return (BRANCHES.find((b) => b.code === c)?.label) || c }
