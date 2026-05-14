import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// "Today" computed in Asia/Kolkata to match the daily-rollup trigger.
function todayInKolkata() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const start = `${yyyyMm}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start, end }
}

function prettyMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Build the full list of dates in a month as { iso, day, dow, dowName }.
// Useful for "calendar-style" rendering even on days the employee didn't punch.
function daysInMonth(yyyyMm) {
  const { start, end } = monthBounds(yyyyMm)
  const out = []
  const startD = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  for (let d = new Date(startD); d < endD; d.setDate(d.getDate() + 1)) {
    out.push({
      iso: d.toLocaleDateString('en-CA'),  // YYYY-MM-DD in local time
      day: d.getDate(),
      dow: d.getDay(),  // 0 = Sunday
      dowName: d.toLocaleDateString('en-US', { weekday: 'short' }),
    })
  }
  return out
}

// "21:34:18" -> "9:34 AM"
function fmtTime(t) {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/**
 * Per-employee attendance tab.
 * Renders month picker + summary stats + day-by-day table for the selected month.
 *
 * Requires the parent to pass `employeeId`. The component fetches its own data
 * from attendance_daily and holidays. Self-contained — drop in wherever.
 */
export default function EmployeeAttendance({ employeeId }) {
  const [month, setMonth] = useState(todayInKolkata().slice(0, 7))
  const [adRows, setAdRows] = useState([])      // attendance_daily for this employee
  const [holidays, setHolidays] = useState([])  // holiday dates in the month
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { start, end } = monthBounds(month)

        const adP = supabase.from('attendance_daily')
          .select('date, in_time, out_time, status, late_minutes, early_leave_minutes, source')
          .eq('employee_id', employeeId)
          .gte('date', start)
          .lt('date', end)
          .order('date', { ascending: true })

        // Holidays in the month — branch_code NULL means applies everywhere,
        // so we fetch all and the parent's branch context isn't needed here.
        // (We don't filter by branch because the holiday calendar is a property
        // of the employee's branch, but employees.branch_codes might span both.)
        const holP = supabase.from('holidays')
          .select('date, name, branch_code')
          .gte('date', start)
          .lt('date', end)

        const [adRes, holRes] = await Promise.all([adP, holP])
        if (cancelled) return
        if (adRes.error) throw adRes.error
        if (holRes.error) throw holRes.error
        setAdRows(adRes.data || [])
        setHolidays(holRes.data || [])
        setLoading(false)
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
  }, [employeeId, month])

  // Build the month grid with all days, joining attendance + holidays.
  const grid = useMemo(() => {
    const adByDate = new Map(adRows.map(r => [r.date, r]))
    const holByDate = new Map(holidays.map(h => [h.date, h]))
    return daysInMonth(month).map(d => {
      const ad = adByDate.get(d.iso)
      const hol = holByDate.get(d.iso)
      // Status precedence for display:
      //   Sunday → 'sunday'
      //   Holiday (non-Sunday) → 'holiday'
      //   Has attendance row → ad.status (usually 'present')
      //   Future date → 'future'
      //   Else → 'absent' (no punch on a working day in the past)
      const today = todayInKolkata()
      let status = 'absent'
      if (d.dow === 0) status = 'sunday'
      else if (hol) status = 'holiday'
      else if (ad) {
        status = ad.status || 'present'
        // Sub-classification: a "present" row with computed late_minutes > 0
        // is displayed as "Late". Other statuses keep their explicit value.
        if (status === 'present' && (ad.late_minutes || 0) > 0) {
          status = 'late'
        }
      }
      else if (d.iso > today) status = 'future'
      return {
        ...d,
        ad: ad || null,
        holiday: hol || null,
        status,
      }
    })
  }, [adRows, holidays, month])

  // Summary derived from the grid.
  const summary = useMemo(() => {
    let workingDays = 0
    let holidayCount = 0
    let presentDays = 0
    let absentDays = 0
    let inOnlyDays = 0
    let lateMins = 0
    let earlyMins = 0
    const today = todayInKolkata()
    for (const c of grid) {
      if (c.dow === 0) continue          // skip Sundays
      if (c.holiday) { holidayCount++; continue }
      // Working day past or present
      if (c.iso > today) continue        // skip future days
      workingDays++
      if (c.status === 'present') presentDays++
      else absentDays++
      if (c.ad) {
        if (c.ad.in_time && !c.ad.out_time) inOnlyDays++
        lateMins += c.ad.late_minutes || 0
        earlyMins += c.ad.early_leave_minutes || 0
      }
    }
    return { workingDays, holidayCount, presentDays, absentDays, inOnlyDays, lateMins, earlyMins }
  }, [grid])

  return (
    <div>
      {/* Toolbar */}
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
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Stat label="Present" value={summary.presentDays} accent="green" />
        <Stat label="Absent" value={summary.absentDays} accent={summary.absentDays > 0 ? 'crimson' : 'muted'} />
        <Stat label="In-Only" value={summary.inOnlyDays} accent={summary.inOnlyDays > 0 ? 'gold' : 'muted'} hint="Forgot to punch out" />
        <Stat label="Holidays" value={summary.holidayCount} accent="muted" />
        <Stat label="Late mins" value={summary.lateMins} accent={summary.lateMins > 0 ? 'gold' : 'muted'} />
      </div>

      {/* Day-by-day table */}
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
        {!loading && !error && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50, #f6f7f5)', borderBottom: '1px solid var(--gray-200)' }}>
                <Th>Date</Th>
                <Th>Day</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th>Status</Th>
                <Th align="right">Late</Th>
                <Th align="right">Early-out</Th>
              </tr>
            </thead>
            <tbody>
              {grid.map((c, i) => (
                <DayRow key={c.iso} cell={c} last={i === grid.length - 1} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function DayRow({ cell, last }) {
  const isWeekend = cell.dow === 0
  const isFuture = cell.status === 'future'
  const isHoliday = cell.status === 'holiday'

  // Subtle row background to visually distinguish non-working days
  const bg =
    isWeekend  ? 'rgba(0,0,0,0.015)' :
    isHoliday  ? 'var(--gold-light)' :
    isFuture   ? 'rgba(0,0,0,0.005)' :
                 'transparent'

  return (
    <tr style={{
      borderBottom: last ? 'none' : '1px solid var(--gray-200)',
      background: bg,
    }}>
      <Td bold>
        {cell.iso.slice(8)}{' '}
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {cell.iso.slice(0, 7)}
        </span>
      </Td>
      <Td muted={isWeekend || isFuture}>
        {cell.dowName}
      </Td>
      <Td muted={!cell.ad?.in_time}>{fmtTime(cell.ad?.in_time)}</Td>
      <Td muted={!cell.ad?.out_time}>{fmtTime(cell.ad?.out_time)}</Td>
      <Td>
        <StatusBadge status={cell.status} holidayName={cell.holiday?.name} />
      </Td>
      <Td align="right" muted={!cell.ad?.late_minutes} color={cell.ad?.late_minutes > 0 ? 'var(--gold-dark)' : null}>
        {cell.ad?.late_minutes || 0}
      </Td>
      <Td align="right" muted={!cell.ad?.early_leave_minutes}>
        {cell.ad?.early_leave_minutes || 0}
      </Td>
    </tr>
  )
}

function StatusBadge({ status, holidayName }) {
  const map = {
    present: { label: 'Present',  bg: 'var(--green-light)', fg: 'var(--green-dark)' },
    absent:  { label: 'Absent',   bg: 'var(--crimson-light)', fg: 'var(--crimson)' },
    sunday:  { label: 'Sunday',   bg: 'rgba(0,0,0,0.04)',   fg: 'var(--text-muted)' },
    holiday: { label: holidayName || 'Holiday', bg: 'var(--gold-light)', fg: 'var(--gold-dark)' },
    future:  { label: '—',        bg: 'transparent',        fg: 'var(--text-muted)' },
    late:    { label: 'Late',     bg: 'var(--gold-light)',  fg: 'var(--gold-dark)' },
  }
  const m = map[status] || map.absent
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 500,
      background: m.bg,
      color: m.fg,
    }}>
      {m.label}
    </span>
  )
}

function Stat({ label, value, accent = 'green', hint }) {
  const color =
    accent === 'green'   ? 'var(--green-dark)' :
    accent === 'crimson' ? 'var(--crimson)' :
    accent === 'gold'    ? 'var(--gold-dark)' :
                            'var(--text-muted)'
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
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-display)', color, lineHeight: 1 }}>
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
