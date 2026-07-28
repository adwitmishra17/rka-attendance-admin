import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../App'
import { supabase } from '../lib/supabase'
import { smsSupabase } from '../lib/smsSupabase'
import { branchLabel } from '../lib/branch'

/* ============================================================
   Salary Advances report.

   Advances are recorded in SMS (Expenses → category "Salary
   advance", tagged to an HRMS employee). SMS exposes them through
   the read-only view public.v_salary_advances; we read it here and
   group by employee so HR/payroll can see who owes what.
   ============================================================ */

function todayInKolkata() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}
function startOfMonthKolkata() {
  return todayInKolkata().slice(0, 8) + '01'
}
function inr(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN')
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ctl = {
  padding: '7px 10px', fontSize: 13, borderRadius: 8,
  border: '1px solid var(--gray-200)', background: 'var(--surface, #fff)',
  color: 'var(--text)', fontFamily: 'inherit',
}

export default function AdvancesReport() {
  const { effectiveBranches, currentBranch } = useAuth()

  const [from, setFrom] = useState(startOfMonthKolkata())
  const [to,   setTo]   = useState(todayInKolkata())
  const [rows, setRows] = useState([])       // raw advances from SMS
  const [empMap, setEmpMap] = useState({})   // employee_id -> { employee_code, designation }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        if (!smsSupabase) {
          throw new Error('SMS connection not configured — set VITE_SMS_SUPABASE_URL and VITE_SMS_SUPABASE_ANON_KEY.')
        }
        // 1. Salary advances from SMS (only-advances view).
        let q = smsSupabase.from('v_salary_advances')
          .select('id, employee_id, employee_name, amount, expense_date, branch_code, notes, payment_mode')
          .gte('expense_date', from)
          .lte('expense_date', to)
          .order('expense_date', { ascending: false })
        if (effectiveBranches.length > 0) q = q.in('branch_code', effectiveBranches)
        const { data, error: e1 } = await q
        if (e1) throw e1
        const advances = data ?? []

        // 2. Enrich with HRMS employee code + designation (HRMS's own DB).
        const ids = [...new Set(advances.map(r => r.employee_id).filter(Boolean))]
        let map = {}
        if (ids.length) {
          const { data: emps } = await supabase.from('employees')
            .select('id, employee_code, designation').in('id', ids)
          for (const e of emps ?? []) map[e.id] = { employee_code: e.employee_code, designation: e.designation }
        }
        if (cancelled) return
        setRows(advances); setEmpMap(map); setLoading(false)
      } catch (e) {
        if (!cancelled) { setError(e.message ?? String(e)); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [from, to, effectiveBranches])

  // Group by employee.
  const { byEmployee, totals } = useMemo(() => {
    const g = new Map()
    let total = 0
    for (const r of rows) {
      const amt = Number(r.amount || 0)
      total += amt
      const k = r.employee_id
      if (!g.has(k)) g.set(k, {
        employee_id: k, name: r.employee_name || '—', branch: r.branch_code,
        count: 0, total: 0, latest: r.expense_date,
      })
      const row = g.get(k)
      row.count += 1
      row.total += amt
      if (r.expense_date > row.latest) row.latest = r.expense_date
    }
    return {
      byEmployee: [...g.values()].sort((a, b) => b.total - a.total),
      totals: { total, count: rows.length, staff: g.size },
    }
  }, [rows])

  function exportCSV() {
    const header = ['Date', 'Employee', 'Code', 'Designation', 'Branch', 'Amount', 'Mode', 'Notes']
    const lines = rows.map(r => [
      r.expense_date, r.employee_name || '', empMap[r.employee_id]?.employee_code || '',
      empMap[r.employee_id]?.designation || '', r.branch_code || '', r.amount,
      r.payment_mode || '', (r.notes || '').replace(/[\r\n]+/g, ' '),
    ])
    const csv = [header, ...lines].map(row =>
      row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `salary-advances-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1400 }}>
      <div className="fade-in" style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Salary Advances</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
          Advances paid to staff, recorded in SMS. Viewing:{' '}
          <strong style={{ color: currentBranch === null ? 'var(--gold-dark)' : 'var(--green-dark)' }}>
            {branchLabel(currentBranch)}
          </strong>
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          From <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={ctl} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          To <input type="date" value={to} min={from} max={todayInKolkata()} onChange={e => setTo(e.target.value)} style={ctl} />
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={exportCSV} disabled={!rows.length}
          style={{ ...ctl, cursor: rows.length ? 'pointer' : 'not-allowed', fontWeight: 600, opacity: rows.length ? 1 : 0.5 }}>
          Export CSV
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
        <SummaryCard label="Total advanced" value={inr(totals.total)} tone="var(--crimson)" />
        <SummaryCard label="Staff with advances" value={String(totals.staff)} />
        <SummaryCard label="Advance entries" value={String(totals.count)} />
      </div>

      {/* Per-employee table */}
      <div style={{ background: 'var(--surface, #fff)', border: '1px solid var(--gray-200)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 20, color: 'var(--crimson)', background: 'var(--crimson-light)' }}>{error}</div>
        ) : byEmployee.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            No salary advances in this window.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50, #f6f7f5)', borderBottom: '1px solid var(--gray-200)' }}>
                <th style={th}>Employee</th>
                <th style={th}>Code</th>
                <th style={th}>Designation</th>
                <th style={th}>Branch</th>
                <th style={{ ...th, textAlign: 'right' }}>Advances</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={th}>Latest</th>
              </tr>
            </thead>
            <tbody>
              {byEmployee.map(e => (
                <tr key={e.employee_id} style={{ borderBottom: '1px solid var(--gray-100, #eee)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{e.name}</td>
                  <td style={td}>{empMap[e.employee_id]?.employee_code || '—'}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{empMap[e.employee_id]?.designation || '—'}</td>
                  <td style={td}>{e.branch}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{e.count}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--crimson)' }}>{inr(e.total)}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{fmtDate(e.latest)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--gray-50, #f6f7f5)', borderTop: '2px solid var(--gray-200)' }}>
                <td style={{ ...td, fontWeight: 700 }} colSpan={4}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{totals.count}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: 'var(--crimson)' }}>{inr(totals.total)}</td>
                <td style={td} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  return (
    <div style={{ background: 'var(--surface, #fff)', border: '1px solid var(--gray-200)', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: tone || 'var(--text)', marginTop: 4 }}>{value}</div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '11px 14px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }
const td = { padding: '11px 14px', verticalAlign: 'middle' }
