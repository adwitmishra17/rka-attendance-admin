import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { applyBranchFilter, applyBranchFilterArray, applyBranchFilterNullable } from '../lib/branchQuery'
import { BRANCHES, branchLabel } from '../lib/branch'
import FleetExpiryWidget from '../components/FleetExpiryWidget'
// Document expiry widget stays off the dashboard (2026-07-26, user request);
// the fleet expiry prompt was restored the same day.

// The Hostinger Hikvision receiver sees every device heartbeat (they never
// reach the database) and publishes per-branch liveness here.
const KIOSK_STATUS_URL = 'https://teacher.rkacademyballia.in/hik/status'

// "Today" computed in Asia/Kolkata so the date boundary matches the device's
// local clock and the trigger that populates attendance_daily.
function todayInKolkata() {
  // 'en-CA' formats as YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

// Minutes since a UTC ISO timestamp string. Returns null if input is null/invalid.
function minutesAgo(isoString) {
  if (!isoString) return null
  const t = new Date(isoString).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 60000)
}

// "5m ago", "2h ago", "yesterday" — humanized relative time
function relTime(mins) {
  if (mins == null) return '—'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export default function Dashboard() {
  const { user, isSuperAdmin, currentBranch, effectiveBranches } = useAuth()
  const [stats, setStats] = useState({
    employees: '—',
    holidays: '—',
    presentToday: null,        // number of employees with status='present' today
    totalActive: null,         // total active employees in scope
  })
  const [supabaseStatus, setSupabaseStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const today = todayInKolkata()

        // employees: branch_codes is an ARRAY, use overlaps()
        let empQ = supabase.from('employees').select('id', { count: 'exact', head: true })
        empQ = applyBranchFilterArray(empQ, effectiveBranches)

        // active, non-exempt employees — denominator for "X of Y present".
        // Reads the attendance_counted_employees view (active AND not exempt)
        // so exempt staff never inflate the attendance ratio.
        let activeQ = supabase.from('attendance_counted_employees').select('id', { count: 'exact', head: true })
        activeQ = applyBranchFilterArray(activeQ, effectiveBranches)

        // holidays: branch_code nullable, NULL = applies to both
        let holQ = supabase.from('holidays').select('id', { count: 'exact', head: true })
        holQ = applyBranchFilterNullable(holQ, effectiveBranches)

        // present today: count of attendance_daily rows for today with
        // status='present'. The employees!inner join + exempt filter drops
        // exempt staff so they can't inflate the numerator — their punches
        // are still recorded, just not counted here.
        // attendance_daily.branch_code is NOT NULL single-value, so .in() with
        // the effective branch list handles single-branch and All-Branches.
        let presentQ = supabase
          .from('attendance_daily')
          .select('id, employees!inner(attendance_exempt)', { count: 'exact', head: true })
          .eq('date', today)
          .eq('status', 'present')
          .eq('employees.attendance_exempt', false)
        if (effectiveBranches.length > 0) presentQ = presentQ.in('branch_code', effectiveBranches)

        // Per-device liveness moved to KioskStatusPanel (per-branch cards).

        const [emp, active, hol, present] = await Promise.all([empQ, activeQ, holQ, presentQ])
        if (cancelled) return
        if (emp.error) throw emp.error
        if (active.error) throw active.error
        if (hol.error) throw hol.error
        if (present.error) throw present.error

        setStats({
          employees: emp.count ?? 0,
          holidays: hol.count ?? 0,
          presentToday: present.count ?? 0,
          totalActive: active.count ?? 0,
        })
        setSupabaseStatus('connected')
      } catch (e) {
        console.error(e)
        if (!cancelled) setSupabaseStatus('error: ' + e.message)
      }
    }
    load()
    // Refresh every 30s so the dashboard reflects punches without manual reload.
    // Cheap — counts + a 50-row select. Aligns with the Attendance page cadence.
    const interval = setInterval(load, 30_000)
    // Realtime: refresh immediately when a punch lands (30s poll = fallback).
    // 800ms timer coalesces bursts into a single reload.
    let rtTimer = null
    const channel = supabase
      .channel('dashboard-attendance-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_events' },
        () => {
          if (rtTimer) return
          rtTimer = setTimeout(() => { rtTimer = null; load() }, 800)
        })
      .subscribe()
    return () => {
      cancelled = true
      clearInterval(interval)
      if (rtTimer) clearTimeout(rtTimer)
      supabase.removeChannel(channel)
    }
  }, [effectiveBranches])

  // Derive attendance display
  const attendanceValue =
    stats.presentToday == null || stats.totalActive == null ? '—' :
      `${stats.presentToday} / ${stats.totalActive}`
  const attendanceHint =
    stats.presentToday == null ? 'Loading…' :
      stats.totalActive === 0 ? 'No active employees' :
        'Marked in today'

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="fade-in" style={{ marginBottom: 8 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28, fontWeight: 600,
          color: 'var(--green-dark)',
          marginBottom: 6,
        }}>
          Welcome, {user?.displayName?.split(' ')[0] || 'Admin'}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {isSuperAdmin ? 'Super Admin · Full system control' : 'Admin · HR & Attendance'}
          <span style={{ margin: '0 8px', color: 'var(--gray-300)' }}>·</span>
          Viewing: <strong style={{ color: currentBranch === null ? 'var(--gold-dark)' : 'var(--green-dark)' }}>{branchLabel(currentBranch)}</strong>
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
      </div>

      {/* Status panel */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 14 }}>
          System Status
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <StatusPill label="Firebase Auth" status="connected" />
          <StatusPill label="Supabase Database" status={supabaseStatus} />
        </div>
      </div>
      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <StatCard label="Employees" value={stats.employees} hint={`In ${branchLabel(currentBranch)}`} />
        <StatCard label="Holidays" value={stats.holidays} hint={`Applicable to ${branchLabel(currentBranch)}`} />
        <StatCard label="Today's attendance" value={attendanceValue} hint={attendanceHint} />
      </div>

      {/* Non-exempt employees who aren't present today. */}
      <AbsentTodayPanel effectiveBranches={effectiveBranches} />

      {/* Per-device biometric kiosk status — one card per branch in scope;
          "All Branches" shows both devices. */}
      <KioskStatusPanel effectiveBranches={effectiveBranches} />

      <FleetExpiryWidget />
    </div>
  )
}

// ============================================================================
// Absent today — non-exempt employees who are not present for the day.
//
// Mirrors the Attendance page's status logic so the two never disagree:
//   · roster = attendance_counted_employees (active AND not attendance-exempt),
//     so exempt staff can never appear here.
//   · a holiday that applies to the employee (global NULL row, or one matching
//     any of their branches) removes them — a holiday isn't an absence.
//   · "absent" = an explicit attendance_daily.status = 'absent' row, OR — for
//     today — no punch yet ('Not marked'). Present / late / half-day / on-leave
//     / school-leave are all excluded.
// Reads via supabaseAdmin (employee names are anon-restricted, migration 021) —
// the same client the Attendance page uses; falls back to the public client.
// ============================================================================
function AbsentTodayPanel({ effectiveBranches }) {
  const [rows, setRows] = useState(null)   // null = loading
  const [err, setErr] = useState(null)
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
          .select('employee_id, status')
          .eq('date', today)
        dailyQ = applyBranchFilter(dailyQ, effectiveBranches)

        let holQ = supabase.from('holidays').select('branch_code').eq('date', today)
        holQ = applyBranchFilterNullable(holQ, effectiveBranches)

        const [rosterRes, dailyRes, holRes] = await Promise.all([rosterQ, dailyQ, holQ])
        if (cancelled) return
        if (rosterRes.error) throw rosterRes.error
        if (dailyRes.error) throw dailyRes.error
        if (holRes.error) throw holRes.error

        const dailyByEmp = new Map((dailyRes.data || []).map(d => [d.employee_id, d]))
        const holidays = holRes.data || []
        const holidayApplies = (emp) => {
          if (!holidays.length) return false
          if (holidays.some(h => h.branch_code === null)) return true
          const b = Array.isArray(emp.branch_codes) ? emp.branch_codes : []
          return holidays.some(h => b.includes(h.branch_code))
        }

        const absentees = []
        for (const e of rosterRes.data || []) {
          if (holidayApplies(e)) continue
          const daily = dailyByEmp.get(e.id)
          const status = daily ? (daily.status || 'present') : 'not_marked'
          if (status === 'absent' || status === 'not_marked') absentees.push({ ...e, status })
        }
        setRows(absentees)
        setErr(null)
      } catch (e) {
        if (!cancelled) setErr(e.message)
      }
    }
    load()
    // Same cadence as the rest of the dashboard: 30s poll + realtime nudge so a
    // name drops off the moment that employee punches in.
    const interval = setInterval(load, 30_000)
    let rtTimer = null
    const channel = supabase
      .channel('dashboard-absent-live')
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
    // db is derived from a module-level client and is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranches])

  const count = rows?.length ?? null

  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Absent today
        </div>
        {count != null && count > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 9px', borderRadius: 999, background: 'var(--crimson-light)', color: 'var(--crimson)' }}>{count}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-muted)' }}>Non-exempt staff · updates live</span>
      </div>
      {err ? (
        <div style={{ fontSize: 12, color: 'var(--crimson)' }}>Couldn’t load absentees: {err}</div>
      ) : rows == null ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Everyone’s accounted for — no absentees today.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 340, overflowY: 'auto' }}>
          {rows.map((r, i) => (
            <AbsentRow key={r.id} emp={r} isLast={i === rows.length - 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function AbsentRow({ emp, isLast }) {
  const chip = emp.status === 'absent'
    ? { bg: 'var(--crimson-light)', color: 'var(--crimson)', label: 'Absent' }
    : { bg: 'var(--gray-100)', color: 'var(--text-muted)', label: 'Not marked' }
  const initials = (emp.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderBottom: isLast ? 'none' : '1px solid var(--gray-100)' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--gray-200)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.full_name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.employee_code}</div>
      </div>
      <span style={{ padding: '3px 9px', background: chip.bg, color: chip.color, borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{chip.label}</span>
    </div>
  )
}

// ============================================================================
// Biometric kiosk status — one card per branch device.
// Two signals, merged:
//   1. Heartbeat (authoritative "online"): the Hostinger receiver absorbs a
//      keepalive every few seconds and republishes per-branch liveness.
//      A device still pointed at the old Supabase edge function has no
//      heartbeat feed until it is switched over.
//   2. Last punch from attendance_events (works on either path) — recency +
//      today's punch count as the fallback signal.
// ============================================================================
function KioskStatusPanel({ effectiveBranches }) {
  const branches = effectiveBranches.length > 0
    ? effectiveBranches
    : BRANCHES.map(b => b.code)
  const branchesKey = branches.join(',')

  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Heartbeat feed — best effort; the dashboard must not hang on it.
      let beats = {}
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 4000)
        const r = await fetch(KIOSK_STATUS_URL, { signal: ctl.signal })
        clearTimeout(timer)
        if (r.ok) {
          const j = await r.json()
          for (const d of j.devices || []) beats[d.branch] = d
        }
      } catch { /* receiver unreachable — punch data still renders */ }

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const dayStartUtc = new Date(`${today}T00:00:00+05:30`).toISOString()

      const out = await Promise.all(branches.map(async code => {
        const [last, count] = await Promise.all([
          supabase.from('attendance_events')
            .select('event_time')
            .eq('branch_code', code)
            .order('event_time', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('attendance_events')
            .select('id', { count: 'exact', head: true })
            .eq('branch_code', code)
            .gte('event_time', dayStartUtc),
        ])
        return {
          code,
          lastPunch: last.data?.event_time ?? null,
          punchesToday: count.count ?? 0,
          beat: beats[code] ?? null,
        }
      }))
      if (!cancelled) setRows(out)
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchesKey])

  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 14 }}>
        Biometric kiosk status
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {(rows ?? branches.map(code => ({ code, loading: true }))).map(d => (
          <DeviceCard key={d.code} device={d} />
        ))}
      </div>
    </div>
  )
}

function DeviceCard({ device }) {
  if (device.loading) {
    return (
      <div style={{ border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '13px 15px', color: 'var(--text-muted)', fontSize: 12 }}>
        {branchLabel(device.code)} — checking…
      </div>
    )
  }
  const beatFresh = device.beat && device.beat.online
  const punchMins = minutesAgo(device.lastPunch)

  // Heartbeat wins; punches are the fallback signal for devices still on the
  // old cloud-function path (no heartbeat feed).
  const status =
    beatFresh ? 'Online' :
      device.beat ? 'Offline' :               // had a heartbeat feed, went quiet
        punchMins == null ? 'Not deployed' :
          punchMins < 30 ? 'Active' :
            punchMins < 480 ? 'Idle' : 'Offline'
  const color =
    status === 'Online' || status === 'Active' ? 'var(--green)' :
      status === 'Idle' ? 'var(--gold-dark)' :
        status === 'Offline' ? 'var(--crimson)' : 'var(--text-muted)'
  const bg =
    status === 'Online' || status === 'Active' ? 'var(--green-light)' :
      status === 'Idle' ? 'var(--gold-light)' :
        status === 'Offline' ? 'var(--crimson-light)' : 'var(--gray-100)'

  const lastPunchLabel = device.lastPunch
    ? new Date(device.lastPunch).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{ border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>{branchLabel(device.code)}</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: bg, color, borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
          {status}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        {device.beat
          ? <>Heartbeat {device.beat.secondsAgo}s ago</>
          : <>No heartbeat feed (device on cloud path)</>}
        <br />
        {device.lastPunch
          ? <>{device.punchesToday} punch{device.punchesToday === 1 ? '' : 'es'} today · last at {lastPunchLabel} ({relTime(punchMins)})</>
          : <>No punches recorded yet</>}
      </div>
    </div>
  )
}

function StatCard({ label, value, hint, accent }) {
  // accent recolours the value text when set: green/gold/crimson/muted.
  // Default keeps the existing green-dark for backwards compat with other cards.
  const accentColor =
    accent === 'green' ? 'var(--green)' :
      accent === 'gold' ? 'var(--gold-dark)' :
        accent === 'crimson' ? 'var(--crimson)' :
          accent === 'muted' ? 'var(--text-muted)' :
            'var(--green-dark)'
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-md)',
      padding: '16px 18px',
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, fontFamily: 'var(--font-display)', color: accentColor, lineHeight: 1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// House-style status chip: quiet neutral chip, a haloed status dot, the
// service name in ink and the state as a word — tinted treatment is
// reserved for the error state so problems are the only thing that pops.
function StatusPill({ label, status }) {
  const isOk = status === 'connected'
  const isLoading = status === 'checking'
  const dot = isOk ? 'var(--green)' : isLoading ? 'var(--gold-dark)' : 'var(--crimson)'
  const halo = isOk ? 'var(--green-light)' : isLoading ? 'var(--gold-light)' : 'var(--crimson-light)'
  const word = isOk ? 'Connected' : isLoading ? 'Checking…' : status
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 13px 6px 10px',
      background: isOk || isLoading ? 'var(--gray-50)' : 'var(--crimson-light)',
      border: `1px solid ${isOk || isLoading ? 'var(--gray-100)' : 'var(--crimson)'}`,
      borderRadius: 999,
      fontSize: 12,
      lineHeight: 1,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, boxShadow: `0 0 0 3px ${halo}`, flexShrink: 0 }} />
      <span style={{ fontWeight: 650, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontWeight: 500, color: isOk || isLoading ? 'var(--text-muted)' : 'var(--crimson)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{word}</span>
    </div>
  )
}
