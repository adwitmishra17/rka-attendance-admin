import React, { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import { applyBranchFilter, applyBranchFilterArray, applyBranchFilterNullable } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'
import Modal from '../components/Modal'
import { STATUS_ORDER, STATUS_META } from '../lib/todayRoster'
import {
  Page, PageHead, Card, CardHead, PrimaryButton, SecondaryButton, StatusChip, Chip,
  SegmentBar, SearchInput, Avatar, Pill, Dot, LoadingBlock, EmptyBlock, PlusIcon,
} from '../components/ui'

const STATUS_STYLES = {
  present: { bg: 'var(--green-light)', color: 'var(--green-dark)', label: 'Present' },
  late: { bg: 'var(--gold-light)', color: 'var(--gold-dark)', label: 'Late' },
  absent: { bg: 'var(--crimson-light)', color: 'var(--crimson)', label: 'Absent' },
  half_day: { bg: 'var(--info-light)', color: 'var(--info)', label: 'Half day' },
  on_leave: { bg: 'var(--leave-light)', color: 'var(--leave)', label: 'On leave' },
  school_leave: { bg: 'var(--teal-light)', color: 'var(--teal)', label: 'School Leave' },
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
  // Deep links from the dashboard (/attendance?status=late) pre-select a filter.
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(() => {
    const s = searchParams.get('status')
    return s && STATUS_STYLES[s] ? s : 'all'
  })
  const [exemptEmployees, setExemptEmployees] = useState([])
  const [exemptOpen, setExemptOpen] = useState(false)

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
      // `attendance_counted_employees` is the single source of truth for who
      // counts toward attendance: active AND not attendance-exempt. The
      // exclusion rule lives in that DB view, not here.
      let empQ = supabaseAdmin
        .from('attendance_counted_employees')
        .select('id, full_name, employee_code, biometric_code, email, branch_codes')
        .order('full_name', { ascending: true })
      empQ = applyBranchFilterArray(empQ, effectiveBranches)

      // Exempt employees — still active, punches still recorded, but never
      // counted. Loaded separately only to render the collapsed exempt section.
      let exemptQ = supabaseAdmin
        .from('employees')
        .select('id, full_name, employee_code, biometric_code, email, branch_codes, attendance_exempt_reason')
        .eq('is_active', true)
        .eq('attendance_exempt', true)
        .order('full_name', { ascending: true })
      exemptQ = applyBranchFilterArray(exemptQ, effectiveBranches)

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

      const [empRes, dailyRes, eventsRes, holidayRes, exemptRes] = await Promise.all([
        empQ, dailyQ, eventsP, holQ, exemptQ,
      ])

      if (empRes.error) throw empRes.error
      if (dailyRes.error) throw dailyRes.error
      if (holidayRes.error) throw holidayRes.error
      if (exemptRes.error) throw exemptRes.error

      setEmployees(empRes.data || [])
      setDailyRecords(dailyRes.data || [])
      setRecentEvents(eventsRes.data || [])
      setHolidaysOnDate(holidayRes.data || [])
      setExemptEmployees(exemptRes.data || [])
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

  // Realtime: reload the moment a punch lands instead of waiting for the
  // 30s poll (which stays as a fallback). Bursts — in/out pairs, a queue of
  // staff at the device — coalesce into one reload via the 800ms timer.
  useEffect(() => {
    if (!isToday) return
    let timer = null
    const channel = supabase
      .channel('attendance-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_events' },
        () => {
          if (timer) return
          timer = setTimeout(() => { timer = null; loadData() }, 800)
        })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [selectedDate, isToday, effectiveBranches])

  // Build a map for fast lookup
  const dailyByEmployee = useMemo(() => {
    const m = new Map()
    for (const d of dailyRecords) m.set(d.employee_id, d)
    return m
  }, [dailyRecords])

  // Combine employees with their daily records.
  // Holiday handling: an employee is "on holiday" if any holiday applies to
  // any of their branches (NULL = global, or branch_code matches one of theirs).
  // Build both rosters from one place so the counted roster and the exempt
  // roster apply identical status logic. Stats only ever read `roster`.
  const { roster, exemptRoster } = useMemo(() => {
    function holidayAppliesTo(emp) {
      if (!holidaysOnDate.length) return null
      // NULL holidays apply to everyone
      const global = holidaysOnDate.find(h => h.branch_code === null)
      if (global) return global
      // Otherwise, find one matching any of the employee's branches
      const branches = Array.isArray(emp.branch_codes) ? emp.branch_codes : []
      return holidaysOnDate.find(h => branches.includes(h.branch_code)) || null
    }
    function buildRow(e) {
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
    }
    return {
      roster: employees.map(buildRow),
      exemptRoster: exemptEmployees.map(buildRow),
    }
  }, [employees, exemptEmployees, dailyByEmployee, holidaysOnDate, isToday])

  // Stats
  const stats = useMemo(() => {
    const out = {
      total: roster.length, present: 0, late: 0, absent: 0,
      not_marked: 0, on_leave: 0, half_day: 0, school_leave: 0, holiday: 0,
    }
    for (const r of roster) {
      if (r.status === 'present') out.present++
      else if (r.status === 'late') out.late++
      else if (r.status === 'absent') out.absent++
      else if (r.status === 'not_marked') out.not_marked++
      else if (r.status === 'on_leave') out.on_leave++
      else if (r.status === 'half_day') out.half_day++
      else if (r.status === 'school_leave') out.school_leave++
      else if (r.status === 'holiday') out.holiday++
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

  // Exempt section is search-aware but not status-filtered — it is its own
  // category, separate from present / late / absent.
  const filteredExempt = useMemo(() => {
    if (!search.trim()) return exemptRoster
    const s = search.toLowerCase()
    return exemptRoster.filter(r =>
      r.employee.full_name?.toLowerCase().includes(s) ||
      r.employee.employee_code?.toLowerCase().includes(s) ||
      r.employee.biometric_code?.toLowerCase().includes(s)
    )
  }, [exemptRoster, search])

  // Glance figures — same arithmetic as the dashboard.
  const inNow = stats.present + stats.late + stats.half_day
  const away = stats.absent + stats.not_marked
  const onLeave = stats.on_leave + stats.school_leave
  const counted = stats.total - stats.holiday
  const pct = counted > 0 ? Math.round((inNow / counted) * 100) : 0
  const pctTone = pct >= 90 ? ['var(--green-light)', 'var(--green-dark)'] : pct >= 70 ? ['var(--gold-light)', 'var(--gold-dark)'] : ['var(--crimson-light)', 'var(--crimson)']
  const chipStatuses = [...STATUS_ORDER, 'holiday'].filter(st => stats[st] > 0 || statusFilter === st)

  return (
    <Page>
      <PageHead
        eyebrow={`${fullDateLabel(selectedDate)}${isToday ? ' · Today' : ''}`}
        title="Attendance"
        sub={isToday
          ? 'Live roster — updates as staff punch. Click a person to mark or edit their attendance.'
          : 'Click a person to mark or edit their attendance for this date.'}
        actions={(
          <>
            <DateNav value={selectedDate} onChange={setSelectedDate} isToday={isToday} />
            {!isToday && (
              <SecondaryButton onClick={() => setSelectedDate(formatDate(new Date()))}>Today</SecondaryButton>
            )}
            <PrimaryButton
              icon={<PlusIcon />}
              onClick={() => setManualPunch({ employee: null, daily: null })}
              title="Manually mark attendance for a staff member on this date"
            >
              Mark attendance
            </PrimaryButton>
          </>
        )}
      />

      {/* Holiday banner — one line per holiday that applies to current branch view */}
      {holidaysOnDate.length > 0 && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--gold-light)',
          borderRadius: 12,
          fontSize: 13,
          color: 'var(--gold-dark)',
          fontWeight: 500,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {holidaysOnDate.map((h, i) => (
            <div key={i}>
              {h.name} — {formatDateLabel(selectedDate)} is a holiday
              {h.branch_code !== null && (
                <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.85 }}>({branchLabel(h.branch_code)} only)</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* At a glance — figures, bar, and status chips that double as the roster filter */}
      <Card>
        <CardHead
          title={isToday ? 'Today at a glance' : 'At a glance'}
          sub="Counted staff only · exempt employees are never included"
          right={!loading && counted > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0, background: pctTone[0], color: pctTone[1] }}>
              {pct}% in
            </span>
          )}
        />
        <div style={{ padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</div>
          ) : stats.total === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No counted employees in this scope.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.01em' }}>
                  {inNow}
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>/ {counted} in</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {onLeave > 0 && <><strong style={{ color: 'var(--text)', fontWeight: 600 }}>{onLeave}</strong> on leave<Dot /></>}
                  <strong style={{ color: away > 0 ? 'var(--crimson)' : 'var(--text)', fontWeight: 600 }}>{away}</strong> {isToday ? 'not in' : 'absent'}
                  {stats.late > 0 && <><Dot /><strong style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>{stats.late}</strong> late</>}
                </div>
              </div>
              <SegmentBar counts={stats} order={[...STATUS_ORDER, 'holiday']} height={12} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} count={stats.total}>All</Chip>
                {chipStatuses.map(st => (
                  <StatusChip
                    key={st}
                    status={st}
                    count={stats[st]}
                    active={statusFilter === st}
                    onClick={() => setStatusFilter(statusFilter === st ? 'all' : st)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
        {/* Roster */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <Card>
            <CardHead
              title="Roster"
              sub={loading ? 'Loading…' : `${filtered.length} of ${roster.length} counted staff${statusFilter !== 'all' ? ` · ${STATUS_META[statusFilter]?.label || statusFilter}` : ''}`}
              right={<SearchInput value={search} onChange={setSearch} placeholder="Search name or code…" width={240} />}
            />
            {loading ? (
              <LoadingBlock label="Loading attendance…" />
            ) : filtered.length === 0 ? (
              <EmptyBlock title="No one matches" sub="Try another status chip or clear the search." />
            ) : (
              filtered.map((row, idx) => (
                <RosterRow
                  key={row.employee.id}
                  row={row}
                  isLast={idx === filtered.length - 1}
                  onClick={() => setManualPunch({ employee: row.employee, daily: row.daily || null })}
                />
              ))
            )}
          </Card>

          {/* Exempt employees — collapsed, never counted in the stats above */}
          <ExemptSection
            rows={filteredExempt}
            open={exemptOpen}
            onToggle={() => setExemptOpen(o => !o)}
            onRowClick={(row) => setManualPunch({ employee: row.employee, daily: row.daily || null })}
          />
        </div>

        {/* Live feed rail */}
        <Card>
          <CardHead
            title={isToday ? 'Live activity' : 'Activity'}
            sub={isToday ? 'Latest punches first' : 'Available for today only'}
          />
          {recentEvents.length === 0 ? (
            <div style={{ padding: '18px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {isToday ? 'No punches yet today.' : 'The live feed is only available for today.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentEvents.map((ev, i) => (
                <EventRow key={ev.id} event={ev} isLast={i === recentEvents.length - 1} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Manual punch modal */}
      {manualPunch && (
        <ManualPunchModal
          date={selectedDate}
          employees={[...employees, ...exemptEmployees]}
          preEmployee={manualPunch.employee}
          existingDaily={manualPunch.daily}
          adminEmail={user?.email}
          currentBranch={currentBranch}
          onClose={() => setManualPunch(null)}
          onSaved={() => { setManualPunch(null); loadData() }}
        />
      )}
    </Page>
  )
}

function fullDateLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// Prev · date · next — a 36px control group that sits with the page actions.
function DateNav({ value, onChange, isToday }) {
  const shift = (days) => {
    const d = new Date(value + 'T00:00:00')
    d.setDate(d.getDate() + days)
    const next = formatDate(d)
    if (next <= formatDate(new Date())) onChange(next)
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', height: 36, background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '0 4px' }}>
      <button onClick={() => shift(-1)} style={navButtonStyle} title="Previous day">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        max={formatDate(new Date())}
        style={{ border: 'none', background: 'transparent', padding: '0 4px', fontSize: 13, color: 'var(--text)', outline: 'none', minWidth: 130, fontFamily: 'var(--font-body)' }}
      />
      <button disabled={isToday} onClick={() => shift(1)} style={{ ...navButtonStyle, opacity: isToday ? 0.3 : 1, cursor: isToday ? 'not-allowed' : 'pointer' }} title="Next day">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </div>
  )
}

const navButtonStyle = {
  background: 'transparent',
  border: 'none',
  padding: '4px 8px',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
}

function RosterRow({ row, isLast, onClick }) {
  const { employee: e, daily, status } = row
  const style = STATUS_STYLES[status] || STATUS_STYLES.not_marked
  const meta = STATUS_META[status] || STATUS_META.not_marked

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '11px 18px',
        borderBottom: isLast ? 'none' : '1px solid var(--gray-100)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.12s',
      }}
      onMouseEnter={onClick ? ev => { ev.currentTarget.style.background = 'var(--gray-50)' } : undefined}
      onMouseLeave={onClick ? ev => { ev.currentTarget.style.background = 'transparent' } : undefined}
      title={onClick ? 'Click to mark / edit attendance' : undefined}
    >
      <Avatar name={e.full_name} bg={meta.bg} fg={meta.fg} size={32} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.full_name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {e.employee_code}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 12 }}>
        <div style={{ minWidth: 78, textAlign: 'right' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>In</div>
          <div style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeForDisplay(daily?.in_time)}
            {daily?.late_minutes > 0 && (
              <span style={{ color: 'var(--gold-dark)', fontSize: 10, marginLeft: 4, fontWeight: 600 }}>+{daily.late_minutes}m</span>
            )}
          </div>
        </div>
        <div style={{ minWidth: 78, textAlign: 'right' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Out</div>
          <div style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeForDisplay(daily?.out_time)}
            {daily?.early_leave_minutes > 0 && (
              <span style={{ color: 'var(--crimson)', fontSize: 10, marginLeft: 4, fontWeight: 600 }}>−{daily.early_leave_minutes}m</span>
            )}
          </div>
        </div>
        <Pill bg={style.bg} fg={style.color} style={{ minWidth: 76, justifyContent: 'center' }}>{style.label}</Pill>
      </div>
    </div>
  )
}

function EventRow({ event, isLast }) {
  const isIn = event.event_type === 'in'
  const employeeName = event.employees?.full_name || 'Unknown'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: isLast ? 'none' : '1px solid var(--gray-100)' }}>
      <Avatar name={employeeName} size={26} bg={isIn ? 'var(--green-light)' : 'var(--gray-100)'} fg={isIn ? 'var(--green-dark)' : 'var(--text-muted)'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {employeeName}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>
          {relativeTime(event.event_time)}
          {event.face_confidence && (
            <span style={{ marginLeft: 6, opacity: 0.7 }}>· {Math.round(event.face_confidence * 100)}% conf</span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: isIn ? 'var(--green-dark)' : 'var(--text-muted)', flexShrink: 0 }}>
        {isIn ? 'In' : 'Out'}
      </div>
    </div>
  )
}

// ============================================================
// EXEMPT SECTION
//
// Employees marked attendance-exempt. Collapsed by default. These rows are
// never part of the stat cards or the present / absent counts — exclusion is
// defined by the `attendance_counted_employees` DB view, which omits them
// from the main roster query entirely.
// ============================================================
function ExemptSection({ rows, open, onToggle, onRowClick }) {
  if (!rows || rows.length === 0) return null
  return (
    <Card>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 18px',
          background: 'transparent',
          border: 'none',
          borderBottom: open ? '1px solid var(--gray-100)' : 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
          textAlign: 'left',
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          Exempt from attendance
        </span>
        <Pill bg="var(--gold-light)" fg="var(--gold-dark)">{rows.length}</Pill>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
          Not included in the counts above
        </span>
      </button>
      {open && rows.map((row, idx) => (
        <RosterRow
          key={row.employee.id}
          row={row}
          isLast={idx === rows.length - 1}
          onClick={() => onRowClick(row)}
        />
      ))}
    </Card>
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
  { value: 'school_leave', label: 'School Leave', hint: 'School-declared paid off — salary NOT deducted', needsTimes: false },
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
