import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { supabase } from '../lib/supabase'
import { applyBranchFilterArray, applyBranchFilterNullable } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'
import ExpiryWidget from '../components/ExpiryWidget'
import FleetExpiryWidget from '../components/FleetExpiryWidget'

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
    deviceLastSeen: null,      // ISO string of most recent event_time
    deviceCount: 0,            // distinct kiosk_device_id count
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

        // device status: most recent event_time + count of distinct devices
        // We grab a small window of recent events and derive both metrics
        // client-side (avoids needing a custom RPC for distinct counts).
        let deviceQ = supabase
          .from('attendance_events')
          .select('event_time, kiosk_device_id')
          .order('event_time', { ascending: false })
          .limit(50)
        if (effectiveBranches.length > 0) deviceQ = deviceQ.in('branch_code', effectiveBranches)

        const [emp, active, hol, present, device] = await Promise.all([empQ, activeQ, holQ, presentQ, deviceQ])
        if (cancelled) return
        if (emp.error) throw emp.error
        if (active.error) throw active.error
        if (hol.error) throw hol.error
        if (present.error) throw present.error
        if (device.error) throw device.error

        const deviceRows = device.data || []
        const distinctDevices = new Set(deviceRows.map(r => r.kiosk_device_id).filter(Boolean))

        setStats({
          employees: emp.count ?? 0,
          holidays: hol.count ?? 0,
          presentToday: present.count ?? 0,
          totalActive: active.count ?? 0,
          deviceLastSeen: deviceRows[0]?.event_time ?? null,
          deviceCount: distinctDevices.size,
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
    return () => { cancelled = true; clearInterval(interval) }
  }, [effectiveBranches])

  // Derive kiosk display from raw stats
  const lastSeenMins = minutesAgo(stats.deviceLastSeen)
  const kioskStatus =
    lastSeenMins == null ? 'Not deployed' :
      lastSeenMins < 2 ? 'Online' :
        lastSeenMins < 30 ? 'Idle' :
          'Offline'
  const kioskHint =
    lastSeenMins == null ? 'No device events yet' :
      lastSeenMins < 2 ? `${stats.deviceCount} device${stats.deviceCount === 1 ? '' : 's'} reachable` :
        `Last event ${relTime(lastSeenMins)}`

  // Derive attendance display
  const attendanceValue =
    stats.presentToday == null || stats.totalActive == null ? '—' :
      `${stats.presentToday} / ${stats.totalActive}`
  const attendanceHint =
    stats.presentToday == null ? 'Loading…' :
      stats.totalActive === 0 ? 'No active employees' :
        'Marked in today'

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1200 }}>
      <div className="fade-in" style={{ marginBottom: 28 }}>
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
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 14 }}>
          System Status
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <StatusPill label="Firebase Auth" status="connected" />
          <StatusPill label="Supabase Database" status={supabaseStatus} />
        </div>
      </div>
      <ExpiryWidget />
      <FleetExpiryWidget />

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <StatCard label="Employees" value={stats.employees} hint={`In ${branchLabel(currentBranch)}`} />
        <StatCard label="Holidays" value={stats.holidays} hint={`Applicable to ${branchLabel(currentBranch)}`} />
        <StatCard label="Today's attendance" value={attendanceValue} hint={attendanceHint} />
        <StatCard
          label="Biometric kiosk"
          value={kioskStatus}
          hint={kioskHint}
          accent={kioskStatus === 'Online' ? 'green' : kioskStatus === 'Idle' ? 'gold' : kioskStatus === 'Offline' ? 'crimson' : 'muted'}
        />
      </div>

      <div style={{
        marginTop: 24,
        padding: '20px 24px',
        background: 'var(--gold-light)',
        border: '1px solid rgba(201,162,39,0.25)',
        borderRadius: 'var(--radius-md)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold-dark)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          v2 — Biometric Attendance Live
        </div>
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          Hikvision device pushes fingerprint punches directly to the HRMS. Daily rollup runs automatically on each event. Next: leave management, salary, and remote enrollment from this dashboard.
        </p>
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

function StatusPill({ label, status }) {
  const isOk = status === 'connected'
  const isLoading = status === 'checking'
  const color = isOk ? 'var(--green)' : isLoading ? 'var(--gold-dark)' : 'var(--crimson)'
  const bg = isOk ? 'var(--green-light)' : isLoading ? 'var(--gold-light)' : 'var(--crimson-light)'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      background: bg,
      borderRadius: 999,
      fontSize: 12,
      color,
      fontWeight: 500,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {label}: {isOk ? '✓' : isLoading ? '…' : status}
    </div>
  )
}
