// ============================================================================
// TODAY'S ROSTER — shared data hook for the dashboard.
//
// One loader, one poll, one realtime channel. Produces the same effective
// status per employee as the Attendance page (roster = the
// attendance_counted_employees view, so exempt staff never count; a holiday
// that applies to the employee wins; a 'present' row with late_minutes > 0
// is displayed as 'late'; no row yet today = 'not_marked').
//
// Also returns today's punch feed (attendance_events, newest first) so the
// dashboard can show a live stream without a second subscription.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase, supabaseAdmin } from './supabase'
import { applyBranchFilter, applyBranchFilterArray, applyBranchFilterNullable } from './branchQuery'

// "Today" in Asia/Kolkata so the date boundary matches the device clock and
// the trigger that populates attendance_daily. 'en-CA' formats YYYY-MM-DD.
export function todayInKolkata() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

export function nowInKolkata() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date())
  const get = t => Number(parts.find(p => p.type === t)?.value ?? 0)
  return { hour: get('hour'), minute: get('minute') }
}

// Display order for bars / legends. 'holiday' is handled separately.
export const STATUS_ORDER = ['present', 'late', 'half_day', 'on_leave', 'school_leave', 'absent', 'not_marked']

// Same colour assignments as Attendance.jsx STATUS_STYLES, plus a solid
// `bar` colour for the segmented meter.
export const STATUS_META = {
  present:      { label: 'Present',      bar: 'var(--green)',    bg: 'var(--green-light)',   fg: 'var(--green-dark)' },
  late:         { label: 'Late',         bar: 'var(--gold)',     bg: 'var(--gold-light)',    fg: 'var(--gold-dark)' },
  half_day:     { label: 'Half day',     bar: 'var(--info)',     bg: 'var(--info-light)',    fg: 'var(--info)' },
  on_leave:     { label: 'On leave',     bar: 'var(--leave)',    bg: 'var(--leave-light)',   fg: 'var(--leave)' },
  school_leave: { label: 'School leave', bar: 'var(--teal)',     bg: 'var(--teal-light)',    fg: 'var(--teal)' },
  absent:       { label: 'Absent',       bar: 'var(--crimson)',  bg: 'var(--crimson-light)', fg: 'var(--crimson)' },
  not_marked:   { label: 'Not in yet',   bar: 'var(--gray-300)', bg: 'var(--gray-100)',      fg: 'var(--text-muted)' },
  holiday:      { label: 'Holiday',      bar: 'var(--gray-200)', bg: 'var(--gray-100)',      fg: 'var(--text-muted)' },
}

export function emptyCounts() {
  const c = { total: 0, holiday: 0 }
  for (const s of STATUS_ORDER) c[s] = 0
  return c
}

// Count rows by effective status. `pick` lets callers scope to a branch.
export function countRows(rows, pick = () => true) {
  const c = emptyCounts()
  for (const r of rows) {
    if (!pick(r)) continue
    c.total++
    if (r.status === 'holiday') c.holiday++
    else if (c[r.status] != null) c[r.status]++
  }
  return c
}

export function useTodayRoster(effectiveBranches) {
  const [state, setState] = useState({
    loading: true, error: null, rows: [], holidays: [], events: [], updatedAt: null,
  })
  const db = supabaseAdmin || supabase

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const today = todayInKolkata()

        let rosterQ = db.from('attendance_counted_employees')
          .select('id, full_name, employee_code, branch_codes')
          .order('full_name', { ascending: true })
        rosterQ = applyBranchFilterArray(rosterQ, effectiveBranches)

        let dailyQ = db.from('attendance_daily')
          .select('employee_id, status, in_time, out_time, late_minutes, expected_in_time, source')
          .eq('date', today)
        dailyQ = applyBranchFilter(dailyQ, effectiveBranches)

        let holQ = supabase.from('holidays').select('name, branch_code').eq('date', today)
        holQ = applyBranchFilterNullable(holQ, effectiveBranches)

        let eventsQ = db.from('attendance_events')
          .select('id, employee_id, event_time, event_type, identification_method, branch_code, employees(full_name, employee_code)')
          .gte('event_time', new Date(`${today}T00:00:00+05:30`).toISOString())
          .order('event_time', { ascending: false })
          .limit(12)
        eventsQ = applyBranchFilter(eventsQ, effectiveBranches)

        const [rosterRes, dailyRes, holRes, evRes] = await Promise.all([rosterQ, dailyQ, holQ, eventsQ])
        if (cancelled) return
        if (rosterRes.error) throw rosterRes.error
        if (dailyRes.error) throw dailyRes.error
        if (holRes.error) throw holRes.error
        // The feed is decorative — a failure there must not blank the page.
        const events = evRes.error ? [] : (evRes.data || [])

        const dailyByEmp = new Map((dailyRes.data || []).map(d => [d.employee_id, d]))
        const holidays = holRes.data || []
        const globalHoliday = holidays.find(h => h.branch_code === null) || null
        const holidayFor = (emp) => {
          if (globalHoliday) return globalHoliday
          const b = Array.isArray(emp.branch_codes) ? emp.branch_codes : []
          return holidays.find(h => b.includes(h.branch_code)) || null
        }

        const rows = (rosterRes.data || []).map(e => {
          const daily = dailyByEmp.get(e.id) || null
          const holiday = holidayFor(e)
          let status = 'not_marked'
          if (holiday) status = 'holiday'
          else if (daily) {
            status = daily.status || 'present'
            if (status === 'present' && (daily.late_minutes || 0) > 0) status = 'late'
          }
          return { employee: e, daily, status, holiday }
        })

        setState({ loading: false, error: null, rows, holidays, events, updatedAt: Date.now() })
      } catch (e) {
        console.error(e)
        if (!cancelled) setState(s => ({ ...s, loading: false, error: e.message }))
      }
    }
    load()
    // 30s poll = fallback; realtime nudge coalesces punch bursts into one reload.
    const interval = setInterval(load, 30_000)
    let rtTimer = null
    const channel = supabase
      .channel('dashboard-today-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_events' },
        () => { if (rtTimer) return; rtTimer = setTimeout(() => { rtTimer = null; load() }, 800) })
      .subscribe()
    return () => {
      cancelled = true
      clearInterval(interval)
      if (rtTimer) clearTimeout(rtTimer)
      supabase.removeChannel(channel)
    }
    // db is a module-level client, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranches])

  return state
}
