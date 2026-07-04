import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../App'
import { supabase } from '../lib/supabase'
import { branchLabel } from '../lib/branch'

// "Today" computed in Asia/Kolkata so the default month boundary matches the
// device's local clock and the daily-rollup trigger.
function todayInKolkata() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

// Build [start, end) ISO date strings from a "YYYY-MM" string.
// end is the FIRST day of the next month (exclusive), so callers can use < not <=.
function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const start = `${yyyyMm}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start, end }
}

// "2026-05" -> "May 2026"
function prettyMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Mon-Sat day count between two ISO dates [start, end). Excludes Sundays.
// (Indian school 6-day work week.)
function countWorkingDays(startIso, endIso) {
  let n = 0
  const start = new Date(startIso + 'T00:00:00')
  const end = new Date(endIso + 'T00:00:00')
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) n++  // 0 = Sunday
  }
  return n
}

export default function MonthlyReport() {
  const { effectiveBranches, currentBranch } = useAuth()

  // Default to current month in Asia/Kolkata. yyyy-MM controls the month picker.
  const [month, setMonth] = useState(todayInKolkata().slice(0, 7))
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState({ workingDays: 0, holidays: 0, expected: 0 })
  const [holidayDates, setHolidayDates] = useState([])   // ISO dates, for the per-employee day grid
  const [empId, setEmpId] = useState('')                 // per-employee CSV picker
  const [empBusy, setEmpBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { start: monthStart, end: monthEnd } = monthBounds(month)

        // 1. Active employees in the current branch scope.
        // employees.branch_codes is an ARRAY of branches the employee is in.
        let empQ = supabase.from('employees')
          .select('id, full_name, biometric_code, branch_codes')
          .eq('is_active', true)
        if (effectiveBranches.length > 0) empQ = empQ.overlaps('branch_codes', effectiveBranches)

        // 2. Attendance rollup rows for the month, for those employees.
        let adQ = supabase.from('attendance_daily')
          .select('employee_id, date, status, in_time, out_time, late_minutes, early_leave_minutes')
          .gte('date', monthStart)
          .lt('date', monthEnd)
        if (effectiveBranches.length > 0) adQ = adQ.in('branch_code', effectiveBranches)

        // 3. Holidays in the month, in scope.
        // holidays.branch_code is nullable: NULL means "applies to all branches".
        const holQ = supabase.from('holidays')
          .select('date, branch_code')
          .gte('date', monthStart)
          .lt('date', monthEnd)

        const [empRes, adRes, holRes] = await Promise.all([empQ, adQ, holQ])
        if (cancelled) return
        if (empRes.error) throw empRes.error
        if (adRes.error) throw adRes.error
        if (holRes.error) throw holRes.error

        // Filter holidays to the in-scope branches client-side (NULL applies anywhere).
        const inScopeHolidays = (holRes.data || []).filter(h =>
          h.branch_code === null || effectiveBranches.length === 0 || effectiveBranches.includes(h.branch_code)
        )
        // Distinct holiday dates (a holiday in BOTH branches shouldn't double count)
        // and exclude any that fall on Sunday (already a weekly off).
        const holidayDateSet = new Set(
          inScopeHolidays
            .filter(h => new Date(h.date + 'T00:00:00').getDay() !== 0)
            .map(h => h.date)
        )

        const workingDays = countWorkingDays(monthStart, monthEnd)
        const expected = Math.max(0, workingDays - holidayDateSet.size)

        // Aggregate per employee. LEFT JOIN semantics: every employee shows up,
        // even those with zero punches in the month (zero present, zero late).
        const perEmp = new Map()
        for (const e of empRes.data || []) {
          perEmp.set(e.id, {
            id: e.id,
            name: e.full_name || '(unnamed)',
            biometric_code: e.biometric_code || '—',
            branch: (e.branch_codes && e.branch_codes[0]) || '—',
            expected,
            present: 0,
            inOnly: 0,
            lateMins: 0,
            earlyMins: 0,
          })
        }
        for (const ad of adRes.data || []) {
          const r = perEmp.get(ad.employee_id)
          if (!r) continue  // ad row for an employee outside scope, skip
          if (ad.status === 'present') r.present++
          if (ad.in_time && !ad.out_time) r.inOnly++
          r.lateMins += ad.late_minutes || 0
          r.earlyMins += ad.early_leave_minutes || 0
        }

        const result = Array.from(perEmp.values())
          .map(r => ({ ...r, absent: Math.max(0, r.expected - r.present) }))
          .sort((a, b) => (a.branch || '').localeCompare(b.branch || '') || a.name.localeCompare(b.name))

        if (!cancelled) {
          setRows(result)
          setStats({ workingDays, holidays: holidayDateSet.size, expected })
          setHolidayDates([...holidayDateSet])
          setLoading(false)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setError(e.message || String(e))
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [month, effectiveBranches])

  // CSV download — opens the browser's save dialog.
  // We escape double-quotes by doubling them (Excel-safe quoting).
  function downloadCsv() {
    const headers = [
      'Name', 'Biometric Code', 'Branch',
      'Expected Days', 'Present', 'Absent',
      'Days In-Only', 'Total Late Mins', 'Total Early Leave Mins',
    ]
    const escape = (v) => {
      const s = v == null ? '' : String(v)
      // Always quote: simpler and safe for any commas/newlines/quotes.
      return `"${s.replace(/"/g, '""')}"`
    }
    const lines = [headers.map(escape).join(',')]
    for (const r of rows) {
      lines.push([
        r.name, r.biometric_code, r.branch,
        r.expected, r.present, r.absent,
        r.inOnly, r.lateMins, r.earlyMins,
      ].map(escape).join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-report-${month}-${branchLabel(currentBranch).toLowerCase().replace(/\s+/g, '-')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Per-employee PDF — a branded day-by-day sheet for ONE employee
  // (payroll / disputes), as opposed to the collective summary above.
  const STATUS_LABEL = {
    present: 'Present', late: 'Late', half_day: 'Half day',
    on_leave: 'On leave', absent: 'Absent', not_marked: 'Not marked',
  }
  const fmtT = (t) => (t ? String(t).slice(0, 5) : '')

  // Downscale /crest.png to a small data-URL so the PDF stays light.
  async function loadCrest(maxDim = 240) {
    try {
      const img = new Image()
      img.src = '/crest.png'
      await img.decode()
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL('image/png')
    } catch { return null }  // no logo → PDF still generates
  }

  async function downloadEmployeePdf() {
    const emp = rows.find(r => r.id === empId)
    if (!emp) return
    setEmpBusy(true)
    try {
      const { start: monthStart, end: monthEnd } = monthBounds(month)
      const { data: adRows, error: adErr } = await supabase
        .from('attendance_daily')
        .select('date, status, in_time, out_time, late_minutes, early_leave_minutes, notes')
        .eq('employee_id', empId)
        .gte('date', monthStart)
        .lt('date', monthEnd)
        .order('date', { ascending: true })
      if (adErr) throw adErr

      const byDate = new Map((adRows || []).map(r => [r.date, r]))
      const holidaySet = new Set(holidayDates)
      const today = todayInKolkata()

      // Build the day grid (stop at today — no future rows) + per-status tallies.
      const body = []       // table rows
      const kinds = []      // per-row kind for styling: status key | 'sunday' | 'holiday' | 'unmarked'
      const tally = { present: 0, late: 0, half_day: 0, on_leave: 0, absent: 0 }
      let lateMins = 0, earlyMins = 0
      for (let d = new Date(monthStart + 'T00:00:00'); ; d.setDate(d.getDate() + 1)) {
        const iso = d.toLocaleDateString('en-CA')
        if (iso >= monthEnd || iso > today) break
        const dow = d.getDay()
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
        const ad = byDate.get(iso)
        let status, kind
        if (ad?.status) {
          status = STATUS_LABEL[ad.status] || ad.status
          kind = ad.status
          if (tally[ad.status] != null) tally[ad.status]++
        } else if (dow === 0) { status = 'Sunday — weekly off'; kind = 'sunday' }
        else if (holidaySet.has(iso)) { status = 'Holiday'; kind = 'holiday' }
        else { status = 'Absent (not marked)'; kind = 'unmarked'; tally.absent++ }
        lateMins += ad?.late_minutes || 0
        earlyMins += ad?.early_leave_minutes || 0
        const dd = String(d.getDate()).padStart(2, '0')
        body.push([`${dd} ${d.toLocaleDateString('en-US', { month: 'short' })}`, dayName, status,
          fmtT(ad?.in_time) || '—', fmtT(ad?.out_time) || '—',
          ad?.late_minutes || 0, ad?.early_leave_minutes || 0, ad?.notes || ''])
        kinds.push(kind)
      }
      if (body.length === 0) throw new Error('No attendance days in this month yet.')

      // PDF libs are dynamically imported so the main bundle stays lean.
      const [{ jsPDF }, autoTableMod, crest] = await Promise.all([
        import('jspdf'), import('jspdf-autotable'), loadCrest(),
      ])
      const autoTable = autoTableMod.default

      const GREEN = [26, 74, 46], GOLD = [201, 162, 39], GRAY = [120, 126, 120]
      const STATUS_COLOR = {
        present: [10, 125, 58], late: [165, 91, 0], half_day: [165, 91, 0],
        on_leave: [30, 64, 175], absent: [139, 26, 26], unmarked: [139, 26, 26],
        not_marked: [139, 26, 26], sunday: GRAY, holiday: GRAY,
      }
      const M = 14                               // page margin (mm)
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()

      // ── Header: crest + school name + report meta ──
      if (crest) doc.addImage(crest, 'PNG', M, 11, 21, 21)
      doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...GREEN)
      doc.text('RADHAKRISHNA ACADEMY', M + 26, 19)
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GRAY)
      doc.text('Employee Attendance Report', M + 26, 25.5)
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(40, 40, 40)
      doc.text(prettyMonth(month), pageW - M, 19, { align: 'right' })
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GRAY)
      doc.text(branchLabel(currentBranch), pageW - M, 25, { align: 'right' })
      doc.setDrawColor(...GOLD).setLineWidth(0.8)
      doc.line(M, 35, pageW - M, 35)

      // ── Employee info band ──
      const info = [
        ['EMPLOYEE', emp.name], ['CODE', emp.biometric_code],
        ['BRANCH', emp.branch], ['GENERATED', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })],
      ]
      let ix = M
      const colW = (pageW - 2 * M) / info.length
      info.forEach(([label, value]) => {
        doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GRAY)
        doc.text(label, ix, 41.5)
        doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(30, 30, 30)
        doc.text(String(value ?? '—'), ix, 46.5)
        ix += colW
      })

      // ── Day-by-day table ──
      autoTable(doc, {
        startY: 51,
        margin: { left: M, right: M, bottom: 18 },
        head: [['Date', 'Day', 'Status', 'In', 'Out', 'Late (min)', 'Early-out (min)', 'Notes']],
        body,
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 8.3, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: [45, 45, 45], lineColor: [225, 229, 225], lineWidth: { bottom: 0.15 } },
        headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8.4, lineWidth: 0 },
        alternateRowStyles: { fillColor: [247, 249, 247] },
        columnStyles: {
          0: { cellWidth: 18, fontStyle: 'bold' }, 1: { cellWidth: 22 }, 2: { cellWidth: 34 },
          3: { cellWidth: 13, halign: 'center' }, 4: { cellWidth: 13, halign: 'center' },
          5: { cellWidth: 17, halign: 'right' }, 6: { cellWidth: 22, halign: 'right' },
        },
        didParseCell: (d) => {
          if (d.section !== 'body') return
          const kind = kinds[d.row.index]
          if (kind === 'sunday' || kind === 'holiday') {
            d.cell.styles.fillColor = [240, 242, 240]
            d.cell.styles.textColor = GRAY
            d.cell.styles.fontStyle = d.column.index === 2 ? 'italic' : 'normal'
          } else if (d.column.index === 2) {
            d.cell.styles.textColor = STATUS_COLOR[kind] || [45, 45, 45]
            d.cell.styles.fontStyle = 'bold'
          }
        },
        didDrawPage: () => {
          const ph = doc.internal.pageSize.getHeight()
          doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY)
          doc.text('Radhakrishna Academy · HRMS', M, ph - 9)
          doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageW - M, ph - 9, { align: 'right' })
        },
      })

      // ── Summary band ──
      let y = doc.lastAutoTable.finalY + 7
      const ph = doc.internal.pageSize.getHeight()
      if (y > ph - 46) { doc.addPage(); y = 24 }
      doc.setFillColor(237, 243, 238)
      doc.roundedRect(M, y, pageW - 2 * M, 13, 2, 2, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GRAY)
      doc.text('SUMMARY', M + 4, y + 5)
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...GREEN)
      const absent = Math.max(tally.absent, Math.max(0, stats.expected - (tally.present + tally.late + tally.half_day + tally.on_leave)))
      doc.text(
        `Expected ${stats.expected}   ·   Present ${tally.present}   ·   Late ${tally.late}   ·   Half-day ${tally.half_day}   ·   On leave ${tally.on_leave}   ·   Absent ${absent}   ·   Late ${lateMins} min   ·   Early-out ${earlyMins} min`,
        M + 4, y + 10.2,
      )

      // ── Signatures ──
      y += 30
      if (y > ph - 24) { doc.addPage(); y = 40 }
      doc.setDrawColor(150, 150, 150).setLineWidth(0.3)
      doc.line(M, y, M + 55, y)
      doc.line(pageW - M - 55, y, pageW - M, y)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY)
      doc.text('Prepared by (HR)', M, y + 4.5)
      doc.text('Principal / Manager', pageW - M - 55, y + 4.5)

      const nameSlug = emp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      doc.save(`attendance-${emp.biometric_code !== '—' ? emp.biometric_code : nameSlug}-${month}.pdf`)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setEmpBusy(false)
    }
  }

  const totalPresent = useMemo(() => rows.reduce((s, r) => s + r.present, 0), [rows])
  const totalLateMins = useMemo(() => rows.reduce((s, r) => s + r.lateMins, 0), [rows])

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1400 }}>
      <div className="fade-in" style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28, fontWeight: 600,
          color: 'var(--green-dark)',
          marginBottom: 6,
        }}>
          Monthly Attendance Report
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Per-employee summary for payroll. Viewing: <strong style={{ color: currentBranch === null ? 'var(--gold-dark)' : 'var(--green-dark)' }}>{branchLabel(currentBranch)}</strong>
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
      </div>

      {/* Toolbar: month picker + CSV export */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        background: 'var(--white)', border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: 16,
      }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Month
        </label>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          style={{
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
            color: 'var(--text)',
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
          {prettyMonth(month)}
        </span>
        <div style={{ flex: 1 }} />

        {/* Per-employee day-by-day export */}
        <select
          value={empId}
          onChange={e => setEmpId(e.target.value)}
          disabled={loading || rows.length === 0}
          style={{
            border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
            padding: '7px 10px', fontSize: 13, fontFamily: 'inherit',
            color: 'var(--text)', maxWidth: 240, background: 'var(--white)',
          }}
        >
          <option value="">Employee…</option>
          {rows.map(r => (
            <option key={r.id} value={r.id}>
              {r.name}{r.biometric_code !== '—' ? ` (${r.biometric_code})` : ''}
            </option>
          ))}
        </select>
        <button
          onClick={downloadEmployeePdf}
          disabled={loading || !empId || empBusy}
          title="Branded day-by-day attendance PDF for the selected employee"
          style={{
            background: 'var(--white)', color: 'var(--green-dark)',
            border: '1px solid var(--green-dark)', borderRadius: 'var(--radius-sm)',
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            cursor: loading || !empId || empBusy ? 'not-allowed' : 'pointer',
            opacity: loading || !empId || empBusy ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
        >
          {empBusy ? 'Preparing…' : '↓ Employee PDF'}
        </button>

        <button
          onClick={downloadCsv}
          disabled={loading || rows.length === 0}
          style={{
            background: 'var(--green-dark)', color: 'var(--white)',
            border: 'none', borderRadius: 'var(--radius-sm)',
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            cursor: loading || rows.length === 0 ? 'not-allowed' : 'pointer',
            opacity: loading || rows.length === 0 ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
        >
          ↓ All employees CSV
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
        <SummaryCard label="Working Days" value={stats.workingDays} hint="Mon-Sat in month" />
        <SummaryCard label="Holidays" value={stats.holidays} hint="Excludes Sundays" />
        <SummaryCard label="Expected Days" value={stats.expected} hint="Per active employee" />
        <SummaryCard label="Total Present" value={totalPresent} hint="Across all employees" />
        <SummaryCard label="Total Late Mins" value={totalLateMins} hint="Sum across employees" />
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--white)', border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
      }}>
        {loading && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: 20, color: 'var(--crimson)', background: 'var(--crimson-light)' }}>
            Error: {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            No active employees in scope.
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50, #f6f7f5)', borderBottom: '1px solid var(--gray-200)' }}>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Branch</Th>
                <Th align="right">Expected</Th>
                <Th align="right">Present</Th>
                <Th align="right">Absent</Th>
                <Th align="right">In-Only</Th>
                <Th align="right">Late mins</Th>
                <Th align="right">Early-out mins</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--gray-200)' : 'none' }}>
                  <Td bold>{r.name}</Td>
                  <Td muted>{r.biometric_code}</Td>
                  <Td muted>{r.branch}</Td>
                  <Td align="right">{r.expected}</Td>
                  <Td align="right" color="var(--green-dark)">{r.present}</Td>
                  <Td align="right" color={r.absent > 0 ? 'var(--crimson)' : 'var(--text-muted)'}>{r.absent}</Td>
                  <Td align="right" color={r.inOnly > 0 ? 'var(--gold-dark)' : 'var(--text-muted)'}>{r.inOnly}</Td>
                  <Td align="right" color={r.lateMins > 0 ? 'var(--gold-dark)' : 'var(--text-muted)'}>{r.lateMins}</Td>
                  <Td align="right" muted>{r.earlyMins}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16, lineHeight: 1.5 }}>
        Note: assumes a 6-day work week (Sundays only weekly off). "Absent" treats any non-present day as absent, including approved leave — leave reconciliation arrives with the Leave module. Late/early-out minutes are 0 until shift expectations are configured.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, hint }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--green-dark)', lineHeight: 1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      padding: '10px 14px',
      textAlign: align,
      fontSize: 10.5,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      fontWeight: 600,
    }}>
      {children}
    </th>
  )
}

function Td({ children, align = 'left', bold, muted, color }) {
  return (
    <td style={{
      padding: '10px 14px',
      textAlign: align,
      fontWeight: bold ? 600 : 400,
      color: color || (muted ? 'var(--text-muted)' : 'var(--text)'),
      fontVariantNumeric: align === 'right' ? 'tabular-nums' : 'normal',
    }}>
      {children}
    </td>
  )
}
