import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { supabase } from '../lib/supabase'
import ExpiryWidget from '../components/ExpiryWidget'

export default function Dashboard() {
  const { user, isSuperAdmin } = useAuth()
  const [stats, setStats] = useState({ employees: '—', holidays: '—' })
  const [supabaseStatus, setSupabaseStatus] = useState('checking')

  useEffect(() => {
    (async () => {
      try {
        const [emp, hol] = await Promise.all([
          supabase.from('employees').select('id', { count: 'exact', head: true }),
          supabase.from('holidays').select('id', { count: 'exact', head: true }),
        ])
        if (emp.error) throw emp.error
        if (hol.error) throw hol.error
        setStats({
          employees: emp.count ?? 0,
          holidays: hol.count ?? 0,
        })
        setSupabaseStatus('connected')
      } catch (e) {
        console.error(e)
        setSupabaseStatus('error: ' + e.message)
      }
    })()
  }, [])

  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:28 }}>
        <h1 style={{
          fontFamily:'var(--font-display)',
          fontSize:28, fontWeight:600,
          color:'var(--green-dark)',
          marginBottom:6,
        }}>
          Welcome, {user?.displayName?.split(' ')[0] || 'Admin'}
        </h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>
          {isSuperAdmin ? 'Super Admin · Full system control' : 'Admin · HR & Attendance'}
        </p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:10, borderRadius:1 }} />
      </div>

      {/* Status panel */}
      <div style={{
        background:'var(--white)',
        border:'1px solid var(--gray-200)',
        borderRadius:'var(--radius-lg)',
        padding:'20px 24px',
        marginBottom:20,
      }}>
        <div style={{ fontSize:11, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600, marginBottom:14 }}>
          System Status
        </div>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          <StatusPill label="Firebase Auth" status="connected" />
          <StatusPill label="Supabase Database" status={supabaseStatus} />
        </div>
      </div>
<ExpiryWidget />

      {/* Quick stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:14 }}>
        <StatCard label="Employees" value={stats.employees} hint="Tracked teachers" />
        <StatCard label="Holidays" value={stats.holidays} hint="Marked this year" />
        <StatCard label="Today's attendance" value="—" hint="Coming soon" />
        <StatCard label="Kiosk status" value="Not deployed" hint="Coming soon" />
      </div>

      <div style={{
        marginTop:24,
        padding:'20px 24px',
        background:'var(--gold-light)',
        border:'1px solid rgba(201,162,39,0.25)',
        borderRadius:'var(--radius-md)',
      }}>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--gold-dark)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>
          v1 — Foundation Phase
        </div>
        <p style={{ fontSize:13, color:'var(--text)', lineHeight:1.6 }}>
          Login and database wiring are working. Next we'll add the Employees page so you can register teachers, then build the kiosk PWA for face recognition.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }) {
  return (
    <div style={{
      background:'var(--white)',
      border:'1px solid var(--gray-200)',
      borderRadius:'var(--radius-md)',
      padding:'16px 18px',
    }}>
      <div style={{ fontSize:10.5, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600, marginBottom:6 }}>
        {label}
      </div>
      <div style={{ fontSize:26, fontWeight:600, fontFamily:'var(--font-display)', color:'var(--green-dark)', lineHeight:1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize:10.5, color:'var(--text-muted)', marginTop:4 }}>{hint}</div>}
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
      display:'flex',
      alignItems:'center',
      gap:8,
      padding:'6px 12px',
      background:bg,
      borderRadius:999,
      fontSize:12,
      color,
      fontWeight:500,
    }}>
      <span style={{ width:7, height:7, borderRadius:'50%', background:color }} />
      {label}: {isOk ? '✓' : isLoading ? '…' : status}
    </div>
  )
}
