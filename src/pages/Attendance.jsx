import React, { useEffect, useState, useMemo } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import { applyBranchFilter, applyBranchFilterArray, applyBranchFilterNullable } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'
import Modal from '../components/Modal'

const STATUS_STYLES = {
  present: { bg: 'var(--green-light)', color: 'var(--green-dark)', label: 'Present' },
  late: { bg: 'var(--gold-light)', color: 'var(--gold-dark)', label: 'Late' },
  absent: { bg: 'var(--crimson-light)', color: 'var(--crimson)', label: 'Absent' },
  half_day: { bg: 'rgba(96, 165, 250, 0.15)', color: '#1e40af', label: 'Half day' },
  on_leave: { bg: 'rgba(168, 85, 247, 0.15)', color: '#6b21a8', label: 'On leave' },
  holiday: { bg: 'var(--gray-100)', color: 'var(--text-muted)', label: 'Holiday' },
  not_marked: { bg: 'var(--gray-100)', color: 'var(--text-muted)', label: 'Not marked' },
}

function formatTimeForDisplay(timeStr) {
  if (!timeStr) return '—'
  const [h, m] = timeStr.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function formatDate(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0,0,0,0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const dStr = formatDate(d)
  if (dStr === formatDate(today)) return 'Today'
  if (dStr === formatDate(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function relativeTime(isoStr) {
  const d = new Date(isoStr)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function Attendance() {
  const { effectiveBranches, currentBranch, user } = useAuth()
  const toast = useToast()
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()))
  const [employees, setEmployees] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [holidaysOnDate, setHolidaysOnDate] = useState([])  // can be 0, 1, or 2 holidays (per branch + global)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Manual punch modal — either { employee, daily } (edit) or { employee: null } (new)
  const [manualPunch, setManualPunch] = useState(null)

  const isToday = selectedDate === formatDate(new Date())

  async function loadData() {
    setLoading(true)
    try {
      // Build all queries with branch filtering applied.
      // employees:           ARRAY column → overlaps
      // attendance_daily:    scalar NOT NULL → in
      // attendance_events:   scalar NOT NULL → in
      // holidays:            scalar nullable → NULL or in
      let empQ = supabaseAdmin
        .from('employees')
        .select('id, full_name, employee_code, biometric_code, email, branch_codes')
        .eq('is_active', true)
        .order('full_name', { ascending: true })
      empQ = applyBranchFilterArray(empQ, effectiveBranches)

      let dailyQ = supabaseAdmin
        .from('attendance_daily')
        .select('*')
        .eq('date', selectedDate)
      dailyQ = applyBranchFilter(dailyQ, effectiveBranches)

      let eventsP
      if (isToday) {
        let eventsQ = supabaseAdmin
          .from('attendance_events')
          .select('*, employees(full_name, employee_code)')
          .gte('event_time', selectedDate + 'T00:00:00')
          .lt('event_time', selectedDate + 'T23:59:59')
          .order('event_time', { ascending: false })
          .limit(20)
        eventsQ = applyBranchFilter(eventsQ, effectiveBranches)
        eventsP = eventsQ
      } else {
        eventsP = Promise.resolve({ data: [] })
      }

      // Holiday lookup. Multi-branch view can return up to 2 rows
      // (e.g. one for MAIN, one for CITY). Use list query, not maybeSingle.
      let holQ = supabaseAdmin
        .from('holidays')
        .select('name, branch_code')
        .eq('date', selectedDate)
      holQ = applyBranchFilterNullable(holQ, effectiveBranches)

      const [empRes, dailyRes, eventsRes, holidayRes] = await Promise.all([
        empQ, dailyQ, eventsP, holQ,
      ])

      if (empRes.error) throw empRes.error
      if (dailyRes.error) throw dailyRes.error
      if (holidayRes.error) throw holidayRes.error

      setEmployees(empRes.data || [])
      setDailyRecords(dailyRes.data || [])
      setRecentEvents(eventsRes.data || [])
      setHolidaysOnDate(holidayRes.data || [])
    } catch (e) {
      toast.show('Failed to load attendance: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [selectedDate, effectiveBranches])

  // Auto-refresh every 30 seconds when viewing today
  useEffect(() => {
    if (!isToday) return
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [selectedDate, isToday])

  // Build a map for fast lookup
  const dailyByEmployee = useMemo(() => {
    const m = new Map()
    for (const d of dailyRecords) m.set(d.employee_id, d)
    return m
  }, [dailyRecords])

  // Combine employees with their daily records.
  // Holiday handling: an employee is "on holiday" if any holiday applies to
  // any of their branches (NULL = global, or branch_code matches one of theirs).
  const roster = useMemo(() => {
    function holidayAppliesTo(emp) {
      if (!holidaysOnDate.length) return null
      // NULL holidays apply to everyone
      const global = holidaysOnDate.find(h => h.branch_code === null)
      if (global) return global
      // Otherwise, find one matching any of the employee's branches
      const branches = Array.isArray(emp.branch_codes) ? emp.branch_codes : []
      return holidaysOnDate.find(h => branches.includes(h.branch_code)) || null
    }
    return employees.map(e => {
      const daily = dailyByEmployee.get(e.id)
      const empHoliday = holidayAppliesTo(e)
      let effectiveStatus = 'not_marked'
      if (empHoliday) {
        effectiveStatus = 'holiday'
      } else if (daily) {
        effectiveStatus = daily.status || 'present'
        // Sub-classification: a "present" row with computed late_minutes > 0
        // is displayed as "Late". Other statuses (half_day, on_leave, absent)
        // keep their explicit value regardless of late_minutes.
        if (effectiveStatus === 'present' && (daily.late_minutes || 0) > 0) {
          effectiveStatus = 'late'
        }
      } else if (!isToday) {
        effectiveStatus = 'absent'
      }
      return { employee: e, daily, status: effectiveStatus, holiday: empHoliday }
    })
  }, [employees, dailyByEmployee, holidaysOnDate, isToday])

  // Stats
  const stats = useMemo(() => {
    const out = {
      total: roster.length, present: 0, late: 0, absent: 0,
      not_marked: 0, on_leave: 0, half_day: 0,
    }
    for (const r of roster) {
      if (r.status === 'present') out.present++
      else if (r.status === 'late') out.late++
      else if (r.status === 'absent') out.absent++
      else if (r.status === 'not_marked') out.not_marked++
      else if (r.status === 'on_leave') out.on_leave++
      else if (r.status === 'half_day') out.half_day++
    }
    return out
  }, [roster])

  // Filter
  const filtered = useMemo(() => {
    let list = roster
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(r =>
        r.employee.full_name?.toLowerCase().includes(s) ||
        r.employee.employee_code?.toLowerCase().includes(s) ||
        r.employee.biometric_code?.toLowerCase().includes(s)
      )
    }
    return list
  }, [roster, statusFilter, search])

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1280 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 600,
          color: 'var(--green-dark)',
          marginBottom: 6,
        }}>
          Attendance
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 620, lineHeight: 1.5 }}>
          {isToday ? 'Live attendance for today, auto-refreshes every 30 seconds.' : `Attendance records for ${formatDateLabel(selectedDate)}.`}
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {/* Date selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex',
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          alignItems: 'center',
          gap: 4,
          padding: 4,
        }}>
          <button onClick={() => {
            const d = new Date(selectedDate + 'T00:00:00')
            d.setDate(d.getDate() - 1)
            setSelectedDate(formatDate(d))
          }} style={navButtonStyle}>
            ←
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              padding: '7px 4px',
              fontSize: 13,
              color: 'var(--text)',
              outline: 'none',
              minWidth: 130,
            }}
            max={formatDate(new Date())}
          />
          <button
            disabled={isToday}
            onClick={() => {
              const d = new Date(selectedDate + 'T00:00:00')
              d.setDate(d.getDate() + 1)
              const newStr = formatDate(d)
              if (newStr <= formatDate(new Date())) setSelectedDate(newStr)
            }}
            style={{ ...navButtonStyle, opacity: isToday ? 0.3 : 1, cursor: isToday ? 'not-allowed' : 'pointer' }}
          >
            →
          </button>
        </div>
        {!isToday && (
          <button onClick={() => setSelectedDate(formatDate(new Date()))} style={{
            padding: '7px 14px',
            background: 'var(--green-dark)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}>
            Jump to today
          </button>
        )}
        {isToday && (
          <span style={{
            fontSize: 11,
            color: 'var(--green-dark)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            background: 'var(--green-light)',
            borderRadius: 999,
            fontWeight: 500,
          }}>
            <span style={{
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'var(--green)',
              animation: 'pulse 2s infinite',
            }} />
            Live
          </span>
        )}

        {/* Mark attendance — opens manual punch modal for the selected date */}
        <button
          onClick={() => setManualPunch({ employee: null, daily: null })}
          style={{
            marginLeft: 'auto',
            padding: '7px 14px',
            background: 'var(--white)',
            color: 'var(--green-dark)',
            border: '1px solid var(--green-muted)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Manually mark attendance for a teacher on this date"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Mark attendance
        </button>
      </div>

      {/* Holiday banner — one line per holiday that applies to current branch view */}
      {holidaysOnDate.length > 0 && (
        <div style={{
          padding: '14px 18px',
          background: 'linear-gradient(135deg, rgba(201,162,39,0.12), rgba(201,162,39,0.04))',
          border: '1px solid rgba(201,162,39,0.3)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--gold-dark)',
          fontWeight: 500,
        }}>
          {holidaysOnDate.map((h, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>
              ⓘ {h.name} — {formatDateLabel(selectedDate)} is a holiday
              {h.branch_code !== null && (
                <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.85 }}>
                  ({branchLabel(h.branch_code)} only)
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        marginBottom: 20,
      }}>
        <StatCard label="Total" value={stats.total} accent="default" />
        <StatCard label="Present" value={stats.present} accent="green" />
        <StatCard label="Late" value={stats.late} accent="gold" />
        {isToday ? (
          <StatCard label="Not yet marked" value={stats.not_marked} accent="muted" />
        ) : (
          <StatCard label="Absent" value={stats.absent} accent="crimson" />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18 }}>
        {/* Roster */}
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search teacher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, minWidth: 180,
                padding: '8px 12px',
                border: '1px solid var(--gray-200)',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                outline: 'none',
                background: 'var(--white)',
              }}
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--gray-200)',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                background: 'var(--white)',
                color: 'var(--text)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All statuses</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              {isToday ? <option value="not_marked">Not marked</option> : <option value="absent">Absent</option>}
              <option value="on_leave">On leave</option>
              <option value="holiday">Holiday</option>
            </select>
          </div>

          {/* Roster table */}
          {loading ? (
            <LoadingState />
          ) : filtered.length === 0 ? (
            <EmptyState message="No teachers match this filter." />
          ) : (
            <div style={{
              background: 'var(--white)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              {filtered.map((row, idx) => (
                <RosterRow
                  key={row.employee.id}
                  row={row}
                  isLast={idx === filtered.length - 1}
                  onClick={() => setManualPunch({ employee: row.employee, daily: row.daily || null })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Live feed sidebar */}
        <div>
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 10,
            }}>
              {isToday ? 'Live activity' : 'Activity feed'}
            </div>
            {recentEvents.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
                {isToday ? 'No activity yet today' : 'Live feed only available for today'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentEvents.map(ev => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Manual punch modal */}
      {manualPunch && (
        <ManualPunchModal
          date={selectedDate}
          employees={employees}
          preEmployee={manualPunch.employee}
          existingDaily={manualPunch.daily}
          adminEmail={user?.email}
          currentBranch={currentBranch}
          onClose={() => setManualPunch(null)}
          onSaved={() => { setManualPunch(null); loadData() }}
        />
      )}
    </div>
  )
}

const navButtonStyle = {
  background: 'transparent',
  border: 'none',
  padding: '6px 10px',
  fontSize: 14,
  cursor: 'pointer',
  color: 'var(--text-muted)',
  borderRadius: 4,
}

function StatCard({ label, value, accent }) {
  const colors = {
    default: { bg: 'var(--white)', border: 'var(--gray-200)', valueColor: 'var(--green-dark)' },
    green: { bg: 'var(--green-light)', border: 'rgba(27,61,27,0.2)', valueColor: 'var(--green-dark)' },
    gold: { bg: 'var(--gold-light)', border: 'rgba(201,162,39,0.3)', valueColor: 'var(--gold-dark)' },
    crimson: { bg: 'var(--crimson-light)', border: 'rgba(192,0,12,0.2)', valueColor: 'var(--crimson)' },
    muted: { bg: 'var(--gray-50)', border: 'var(--gray-200)', valueColor: 'var(--text-muted)' },
  }
  const c = colors[accent] || colors.default
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 10.5,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        fontWeight: 700,
        color: c.valueColor,
        lineHeight: 1,
      }}>{value}</div>
    </div>
  )
}

function RosterRow({ row, isLast, onClick }) {
  const { employee: e, daily, status } = row
  const style = STATUS_STYLES[status] || STATUS_STYLES.not_marked
  const initials = (e.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--gray-100)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onMouseEnter={onClick ? ev => { ev.currentTarget.style.background = 'var(--gray-50)' } : undefined}
      onMouseLeave={onClick ? ev => { ev.currentTarget.style.background = 'transparent' } : undefined}
      title={onClick ? 'Click to mark / edit attendance' : undefined}
    >
      <div style={{
        width: 34, height: 34,
        borderRadius: '50%',
        background: status === 'present' || status === 'late'
          ? 'linear-gradient(135deg, var(--green), var(--green-dark))'
          : 'var(--gray-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: status === 'present' || status === 'late' ? 'white' : 'var(--text-muted)',
        fontSize: 11.5,
        fontWeight: 600,
        flexShrink: 0,
      }}>{initials}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
          {e.full_name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {e.employee_code}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 12 }}>
        <div style={{ minWidth: 78, textAlign: 'right' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>IN</div>
          <div style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeForDisplay(daily?.in_time)}
            {daily?.late_minutes > 0 && (
              <span style={{ color: 'var(--gold-dark)', fontSize: 10, marginLeft: 4 }}>+{daily.late_minutes}m</span>
            )}
          </div>
        </div>
        <div style={{ minWidth: 78, textAlign: 'right' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>OUT</div>
          <div style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeForDisplay(daily?.out_time)}
            {daily?.early_leave_minutes > 0 && (
              <span style={{ color: 'var(--crimson)', fontSize: 10, marginLeft: 4 }}>−{daily.early_leave_minutes}m</span>
            )}
          </div>
        </div>
        <div style={{
          padding: '4px 10px',
          background: style.bg,
          color: style.color,
          borderRadius: 999,
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          minWidth: 64,
          textAlign: 'center',
        }}>{style.label}</div>
      </div>
    </div>
  )
}

function EventRow({ event }) {
  const isIn = event.event_type === 'in'
  const employeeName = event.employees?.full_name || 'Unknown'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '8px 0',
      borderBottom: '1px solid var(--gray-100)',
    }}>
      <div style={{
        width: 8, height: 8,
        borderRadius: '50%',
        background: isIn ? 'var(--green)' : '#60a5fa',
        marginTop: 6,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>
          {employeeName}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
          Marked {isIn ? 'IN' : 'OUT'} · {relativeTime(event.event_time)}
          {event.face_confidence && (
            <span style={{ marginLeft: 6, opacity: 0.7 }}>
              · {Math.round(event.face_confidence * 100)}% conf
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: 50,
      textAlign: 'center',
    }}>
      <div style={{
        width: 24, height: 24,
        border: '2px solid var(--green-muted)',
        borderTopColor: 'var(--green)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        margin: '0 auto 10px',
      }} />
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading attendance…</div>
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: '50px 24px',
      textAlign: 'center',
    }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{message}</p>
    </div>
  )
}

// ============================================================
// MANUAL PUNCH MODAL
//
// Lets admin mark / edit attendance on a teacher's behalf — for cases
// where the biometric failed, the teacher was on approved leave, etc.
//
// Writes directly to attendance_daily (NOT attendance_events) and tags
// the row with source = 'manual-admin' so it's auditable. Then calls
// recompute_attendance_daily(employee_id, date) so late_minutes /
// early_leave_minutes / is_holiday all update against the schedule.
// ============================================================

const STATUS_OPTIONS = [
  { value: 'present',  label: 'Present',  hint: 'Came in normally', needsTimes: true  },
  { value: 'late',     label: 'Late',     hint: 'Marked late by admin', needsTimes: true  },
  { value: 'half_day', label: 'Half day', hint: 'Half-day attendance', needsTimes: true  },
  { value: 'on_leave', label: 'On leave', hint: 'Approved leave', needsTimes: false },
  { value: 'absent',   label: 'Absent',   hint: 'Did not come in', needsTimes: false },
]

function ManualPunchModal({ date, employees, preEmployee, existingDaily, adminEmail, currentBranch, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = !!existingDaily

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [employeeId, setEmployeeId] = useState(preEmployee?.id || '')
  const [status, setStatus] = useState(existingDaily?.status || 'present')
  const [inTime, setInTime] = useState(existingDaily?.in_time?.slice(0, 5) || '')
  const [outTime, setOutTime] = useState(existingDaily?.out_time?.slice(0, 5) || '')
  const [notes, setNotes] = useState(existingDaily?.notes || '')
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState({})

  // Employee picker is locked when editing an existing row. When adding,
  // it shows a searchable list of employees in the current branch view.
  const selectedEmployee = useMemo(
    () => employees.find(e => e.id === employeeId) || preEmployee || null,
    [employees, employeeId, preEmployee]
  )

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return employees
    const s = search.trim().toLowerCase()
    return employees.filter(e =>
      (e.full_name || '').toLowerCase().includes(s)
      || (e.employee_code || '').toLowerCase().includes(s)
    )
  }, [employees, search])

  const statusMeta = STATUS_OPTIONS.find(s => s.value === status)

  // Date label
  const dateLabel = useMemo(() => {
    const d = new Date(date + 'T00:00:00')
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }, [date])

  // Resolve the branch_code to stamp on the row.
  //   Editing: keep the existing row's branch_code (immutable per record).
  //   New: pick a branch — currentBranch if set; else employee's primary branch.
  function resolveBranchCode(emp) {
    if (existingDaily?.branch_code) return existingDaily.branch_code
    if (currentBranch) return currentBranch
    const codes = Array.isArray(emp?.branch_codes) ? emp.branch_codes : []
    return codes[0] || null
  }

  function validate() {
    const errs = {}
    if (!employeeId && !preEmployee) errs.employee = 'Pick a teacher'
    if (statusMeta?.needsTimes && !inTime && !outTime) {
      errs.times = 'Set at least an In or Out time (or switch status to On leave / Absent)'
    }
    if (inTime && outTime && inTime > outTime) {
      errs.times = 'Out time must be after In time'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    if (!supabaseAdmin) {
      toast.show('Admin client not initialised', 'error')
      return
    }
    const emp = selectedEmployee
    if (!emp) {
      setErrors({ employee: 'Pick a teacher' })
      return
    }
    const branchCode = resolveBranchCode(emp)
    if (!branchCode) {
      toast.show('Cannot resolve branch for this entry. Set a branch first.', 'error')
      return
    }

    setSaving(true)
    const dayOfWeek = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
    const payload = {
      employee_id: emp.id,
      date,
      day_of_week: dayOfWeek,
      branch_code: branchCode,
      status,
      in_time:  statusMeta?.needsTimes && inTime  ? inTime  + ':00' : null,
      out_time: statusMeta?.needsTimes && outTime ? outTime + ':00' : null,
      source: 'admin',
      notes: notes.trim() || null,
      updated_by: adminEmail || 'admin',
      updated_at: new Date().toISOString(),
    }

    // UPSERT on (employee_id, date) — matches the trigger's conflict target.
    const { error: e1 } = await supabaseAdmin
      .from('attendance_daily')
      .upsert(payload, { onConflict: 'employee_id,date' })
    if (e1) {
      toast.show('Save failed: ' + e1.message, 'error')
      setSaving(false)
      return
    }

    // Recompute derived fields (late_minutes, early_leave_minutes, is_holiday)
    const { error: rcErr } = await supabaseAdmin
      .rpc('recompute_attendance_daily', { p_employee_id: emp.id, p_date: date })
    if (rcErr) {
      toast.show(`Saved, but recompute failed: ${rcErr.message}`, 'error')
    } else {
      toast.show(isEdit ? 'Attendance updated' : 'Attendance marked')
    }

    setSaving(false)
    onSaved()
  }

  async function handleDelete() {
    if (!existingDaily || !supabaseAdmin) return
    if (!window.confirm('Remove this attendance entry? The day will go back to its default status (Absent on working days, Holiday otherwise).')) return
    setDeleting(true)
    const { error } = await supabaseAdmin
      .from('attendance_daily')
      .delete()
      .eq('employee_id', existingDaily.employee_id || selectedEmployee?.id)
      .eq('date', date)
    if (error) {
      toast.show('Delete failed: ' + error.message, 'error')
      setDeleting(false)
      return
    }
    toast.show('Attendance entry removed')
    setDeleting(false)
    onSaved()
  }

  const branchCodePreview = resolveBranchCode(selectedEmployee)

  return (
    <Modal
      open={true}
      onClose={() => !saving && !deleting && onClose()}
      title={isEdit ? 'Edit attendance' : 'Mark attendance'}
      maxWidth={560}
      footer={
        <>
          {isEdit && (
            <button
              onClick={handleDelete}
              disabled={saving || deleting}
              style={{
                marginRight: 'auto',
                padding: '8px 14px',
                background: 'transparent',
                color: 'var(--crimson)',
                border: '1px solid rgba(139,26,26,0.25)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {deleting ? 'Removing…' : 'Remove entry'}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={saving || deleting}
            style={{
              padding: '8px 16px',
              background: 'var(--white)',
              color: 'var(--text)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || deleting}
            style={{
              padding: '8px 18px',
              background: 'var(--green-dark)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Mark attendance')}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>

        {/* Date context banner */}
        <div style={{
          padding: '10px 12px',
          background: 'var(--green-light)',
          border: '1px solid rgba(26,74,46,0.15)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12.5,
          color: 'var(--green-dark)',
        }}>
          For <strong>{dateLabel}</strong>
          {branchCodePreview && (
            <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.85 }}>
              · {branchLabel(branchCodePreview)}
            </span>
          )}
        </div>

        {/* Employee picker */}
        {isEdit || preEmployee ? (
          <div style={{
            padding: '10px 12px',
            background: 'var(--gray-50)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <div style={{
              width: 32, height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--green), var(--green-dark))',
              color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, flexShrink: 0,
            }}>
              {(selectedEmployee?.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{selectedEmployee?.full_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedEmployee?.employee_code}</div>
            </div>
          </div>
        ) : (
          <ModalField label="Teacher" required error={errors.employee}>
            <input
              type="text"
              placeholder="Search by name or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={modalInputStyle}
            />
            <div style={{
              marginTop: 6,
              maxHeight: 180,
              overflow: 'auto',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--white)',
            }}>
              {filteredEmployees.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No matches
                </div>
              ) : filteredEmployees.slice(0, 50).map(e => {
                const chosen = e.id === employeeId
                return (
                  <div
                    key={e.id}
                    onClick={() => setEmployeeId(e.id)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: chosen ? 'var(--green-light)' : 'transparent',
                      borderBottom: '1px solid var(--gray-100)',
                    }}
                    onMouseEnter={ev => { if (!chosen) ev.currentTarget.style.background = 'var(--gray-50)' }}
                    onMouseLeave={ev => { if (!chosen) ev.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: chosen ? 600 : 400 }}>
                      {e.full_name}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      {e.employee_code}
                    </div>
                  </div>
                )
              })}
            </div>
          </ModalField>
        )}

        {/* Status */}
        <ModalField label="Status" required>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 6 }}>
            {STATUS_OPTIONS.map(opt => {
              const checked = status === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    background: checked ? 'var(--green-light)' : 'var(--white)',
                    border: `1px solid ${checked ? 'var(--green)' : 'var(--gray-200)'}`,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.12s',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: checked ? 'var(--green-dark)' : 'var(--text)' }}>{opt.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{opt.hint}</div>
                </button>
              )
            })}
          </div>
        </ModalField>

        {/* Times (only when status needs them) */}
        {statusMeta?.needsTimes && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <ModalField label="In time" hint="Leave blank if unknown">
              <input
                type="time"
                value={inTime}
                onChange={e => setInTime(e.target.value)}
                style={modalInputStyle}
              />
            </ModalField>
            <ModalField label="Out time" hint="Leave blank if unknown">
              <input
                type="time"
                value={outTime}
                onChange={e => setOutTime(e.target.value)}
                style={modalInputStyle}
              />
            </ModalField>
            {errors.times && (
              <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--crimson)', marginTop: -6 }}>
                {errors.times}
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <ModalField label="Notes" hint="Optional — explain why manual entry">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Biometric failed, on approved leave, etc."
            style={{ ...modalInputStyle, minHeight: 56, resize: 'vertical' }}
          />
        </ModalField>

        {/* Audit hint */}
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
          padding: '8px 10px',
          borderTop: '1px dashed var(--gray-200)',
        }}>
          This entry will be tagged as a manual admin entry by <strong>{adminEmail || 'you'}</strong>. Late / early-leave minutes are computed automatically from the schedule.
        </div>
      </div>
    </Modal>
  )
}

function ModalField({ label, required, error, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
          {label}
          {required && <span style={{ color: 'var(--crimson)', marginLeft: 3 }}>*</span>}
        </span>
        {hint && !error && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{hint}</span>}
      </div>
      {children}
      {error && <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>{error}</div>}
    </label>
  )
}

const modalInputStyle = {
  width: '100%',
  padding: '8px 11px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  background: 'var(--white)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
