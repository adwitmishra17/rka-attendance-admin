import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import { useToast } from './Toast'
import { Card, CardHead, PrimaryButton, Segment, Pill } from './ui'
import { saveSalaryProfile, getAdvanceBalances } from '../lib/payroll'

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const inStyle = { width: '100%', height: 38, padding: '0 12px', border: '1px solid var(--gray-200)', borderRadius: 10, fontSize: 14, background: 'var(--white)', color: 'var(--text)', fontFamily: 'var(--font-body)', textAlign: 'right' }

// A read-only field row (statutory / bank reference).
function Ref({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  )
}

function Toggle({ on, onChange, label, sub }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', cursor: 'pointer' }}>
      <button type="button" onClick={() => onChange(!on)} aria-pressed={on} style={{
        width: 40, height: 24, borderRadius: 999, border: 'none', flexShrink: 0, cursor: 'pointer',
        background: on ? 'var(--green)' : 'var(--gray-200)', position: 'relative', transition: 'background 0.15s',
      }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
      </button>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</div>}
      </span>
    </label>
  )
}

function NumField({ label, value, onChange, hint }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>{label}</div>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={inStyle} />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </label>
  )
}

export default function SalaryTab({ employee, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const actor = user?.email || 'admin'

  const init = () => ({
    pay_mode: employee.pay_mode === 'fixed' ? 'fixed' : 'structured',
    basic_salary: employee.basic_salary ?? 0,
    hra: employee.hra ?? 0,
    other_allowances: employee.other_allowances ?? 0,
    fixed_salary: employee.fixed_salary ?? 0,
    epf_enabled: !!employee.epf_enabled,
    esi_enabled: !!employee.esi_enabled,
    lop_enabled: employee.lop_enabled !== false,
    paid_leaves_per_month: employee.paid_leaves_per_month ?? 0,
  })
  const [f, setF] = useState(init)
  const [saving, setSaving] = useState(false)
  const [advance, setAdvance] = useState(null)
  useEffect(() => { setF(init()) }, [employee.id]) // eslint-disable-line
  useEffect(() => {
    let live = true
    getAdvanceBalances([employee.id]).then((m) => { if (live) setAdvance(m[employee.id] || null) }).catch(() => {})
    return () => { live = false }
  }, [employee.id])

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const gross = f.pay_mode === 'fixed' ? Number(f.fixed_salary || 0) : (Number(f.basic_salary || 0) + Number(f.hra || 0) + Number(f.other_allowances || 0))

  async function save() {
    setSaving(true)
    try {
      const updated = await saveSalaryProfile(employee.id, f, actor)
      onSaved?.(updated)
      toast.show('Salary structure saved')
    } catch (e) { toast.show('Save failed: ' + e.message, 'error') }
    setSaving(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <CardHead title="Salary structure" sub="Drives the monthly payroll run for this employee." right={<PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>} />
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Pay mode</div>
              <Segment value={f.pay_mode} onChange={(v) => set('pay_mode', v)} options={[{ value: 'structured', label: 'Structured' }, { value: 'fixed', label: 'Fixed amount' }]} />
            </div>

            {f.pay_mode === 'structured' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <NumField label="Basic" value={f.basic_salary} onChange={(v) => set('basic_salary', v)} />
                  <NumField label="HRA" value={f.hra} onChange={(v) => set('hra', v)} />
                  <NumField label="Other allowances" value={f.other_allowances} onChange={(v) => set('other_allowances', v)} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--gray-50)', borderRadius: 10 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Gross (monthly)</span>
                  <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{inr(gross)}</span>
                </div>
                <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 4 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0' }}>Deductions & attendance</div>
                  <Toggle on={f.epf_enabled} onChange={(v) => set('epf_enabled', v)} label="EPF (Provident Fund)" sub="12% of earned basic; employer share tracked for the register." />
                  <Toggle on={f.esi_enabled} onChange={(v) => set('esi_enabled', v)} label="ESI" sub="0.75% of earned wages — only while gross ≤ ₹21,000." />
                  <Toggle on={f.lop_enabled} onChange={(v) => set('lop_enabled', v)} label="Attendance affects pay (LOP)" sub="Absences beyond the paid-leave quota are docked at gross ÷ 30." />
                  {f.lop_enabled && (
                    <div style={{ maxWidth: 220, marginTop: 8 }}>
                      <NumField label="Paid leaves / month" value={f.paid_leaves_per_month} onChange={(v) => set('paid_leaves_per_month', v)} hint="Absences beyond this many are LOP." />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ maxWidth: 280 }}>
                <NumField label="Fixed monthly salary" value={f.fixed_salary} onChange={(v) => set('fixed_salary', v)} hint="Flat pay — no automatic EPF / ESI / LOP. Advance recovery and manual deductions still apply in the run." />
              </div>
            )}
          </div>
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <CardHead title="Salary advances" />
          <div style={{ padding: 18 }}>
            {advance == null ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Advanced (SMS)</span><span style={{ fontSize: 13 }}>{inr(advance.advanced)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Recovered</span><span style={{ fontSize: 13 }}>{inr(advance.recovered)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--gray-100)' }}><span style={{ fontSize: 13, fontWeight: 600 }}>Outstanding</span><span style={{ fontSize: 15, fontWeight: 700, color: advance.balance > 0 ? 'var(--crimson)' : 'var(--text)' }}>{inr(advance.balance)}</span></div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10 }}>
                  Advances are recorded in SMS. The payroll run recovers against this balance. <Link to="/reports/advances" style={{ color: 'var(--green)' }}>View advances →</Link>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Statutory & bank" sub="Edited on the Overview tab." />
          <div style={{ padding: '6px 18px 14px' }}>
            <Ref label="PF number" value={employee.pf_number} />
            <Ref label="ESI number" value={employee.esi_number} />
            <Ref label="UAN" value={employee.uan_number} />
            <Ref label="PAN" value={employee.pan_number} />
            <Ref label="Bank A/C" value={employee.bank_account_number} />
            <Ref label="IFSC" value={employee.bank_ifsc} />
            <Ref label="Bank" value={employee.bank_name} />
          </div>
        </Card>
      </div>
    </div>
  )
}
