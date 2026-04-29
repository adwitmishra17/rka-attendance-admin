import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth, SUPER_ADMIN_EMAIL } from '../App'

const NAV = [
  { to: '/', label: 'Dashboard', end: true, icon:
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  },
  { to: '/employees', label: 'Employees', icon:
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  },
  { to: '/attendance', label: 'Attendance', icon:
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  },
  { to: '/face-enrollment', label: 'Face Enrollment', icon:
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  },
  { to: '/holidays', label: 'Holidays', icon:
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  },
  { to: '/reporting-time', label: 'Reporting Time', icon:
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>
  },
]

const SIDEBAR_W = 232

export default function Layout() {
  const { user, adminRole, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('rka-attn-theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    try { localStorage.setItem('rka-attn-theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  async function handleLogout() {
    await signOut(auth)
    navigate('/login')
  }

  const initials = (user?.displayName || user?.email || 'A')
    .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  const SidebarContent = () => (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div onClick={() => navigate('/')} style={{
        padding:'24px 16px 18px',
        borderBottom:'1px solid rgba(255,255,255,0.07)',
        display:'flex',
        flexDirection:'column',
        alignItems:'center',
        gap:8,
        cursor:'pointer',
      }}>
        <img src="/banner.png" alt="Radhakrishna Academy" style={{
          width: '100%',
          maxWidth: 184,
          height: 'auto',
          display: 'block',
        }} />
        <div style={{
          fontSize: 8,
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 500,
          marginTop: 4,
        }}>
          Attendance Portal
        </div>
      </div>

      <nav style={{ flex:1, padding:'10px 0', overflowY:'auto' }}>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} style={({ isActive }) => ({
            display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
            color: isActive ? 'var(--gold)' : 'rgba(255,255,255,0.65)',
            textDecoration:'none', fontSize:13, fontWeight:500,
            background: isActive ? 'rgba(201,162,39,0.1)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
            transition:'all 0.15s', whiteSpace:'nowrap',
          })}>
            <span style={{ flexShrink:0 }}>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <div style={{ borderTop:'1px solid rgba(255,255,255,0.07)', padding:'12px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:10 }}>
          <div style={{
            width: 30, height: 30,
            borderRadius: '50%',
            border: '1px solid rgba(201,162,39,0.4)',
            background: 'linear-gradient(135deg, var(--gold), var(--crimson))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 11, fontWeight: 600,
            flexShrink: 0,
          }}>{initials}</div>
          <div style={{ overflow:'hidden', flex:1 }}>
            <div style={{ fontSize:12, color:'white', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {user?.displayName || 'Admin'}
              {isSuperAdmin && <span style={{ marginLeft:6, fontSize:9, color:'var(--gold)' }}>★</span>}
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.email}</div>
          </div>
        </div>
        <button onClick={handleLogout} style={{
          width:'100%',
          background:'rgba(139,26,26,0.2)',
          border:'none',
          borderRadius:6,
          padding:'7px',
          color:'rgba(255,180,180,0.8)',
          cursor:'pointer',
          fontSize:12,
        }}>
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      {!isMobile && (
        <aside style={{
          width:SIDEBAR_W,
          background:'var(--green-dark)',
          flexShrink:0,
          position:'sticky',
          top:0,
          height:'100vh',
          zIndex:100,
        }}>
          <SidebarContent />
        </aside>
      )}

      {isMobile && mobileOpen && (
        <div style={{ position:'fixed', inset:0, zIndex:200 }}>
          <div onClick={() => setMobileOpen(false)} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.5)' }} />
          <aside style={{ position:'absolute', top:0, left:0, width:SIDEBAR_W, height:'100%', background:'var(--green-dark)', overflowY:'auto' }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        {isMobile && (
          <div style={{
            background:'var(--green-dark)',
            padding:'10px 16px',
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            position:'sticky',
            top:0,
            zIndex:50,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, color:'#fff' }}>
              <img src="/banner.png" alt="RKA" style={{
                height: 28,
                width: 'auto',
                display: 'block',
              }} />
            </div>
            <button onClick={() => setMobileOpen(o => !o)} style={{
              background:'rgba(255,255,255,0.1)', border:'none', borderRadius:8,
              padding:'8px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                {mobileOpen ? <path d="M18 6L6 18M6 6l12 12"/> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
              </svg>
            </button>
          </div>
        )}
        {!isMobile && (
          <div style={{
            background:'var(--white)',
            borderBottom:'1px solid var(--gray-100)',
            padding:'8px 24px',
            display:'flex',
            alignItems:'center',
            justifyContent:'flex-end',
            position:'sticky',
            top:0,
            zIndex:50,
          }}>
            <button onClick={() => setDark(d => !d)} style={{
              display:'flex',
              alignItems:'center',
              gap:7,
              padding:'6px 14px',
              background:'var(--gray-50)',
              border:'1px solid var(--gray-200)',
              borderRadius:'var(--radius-sm)',
              cursor:'pointer',
              fontSize:12,
              color:'var(--text-muted)',
            }}>
              {dark ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
              {dark ? 'Light' : 'Dark'}
            </button>
          </div>
        )}

        <main style={{ flex:1, overflowY:'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
