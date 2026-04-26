import React from 'react'

export default function Attendance() {
  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>
          Attendance
        </h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>
          Live view of who's in and out today, and historical attendance.
        </p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      <div style={{
        background:'var(--white)',
        border:'1px solid var(--gray-200)',
        borderRadius:'var(--radius-lg)',
        padding:'32px 28px',
        textAlign:'center',
      }}>
        <div style={{
          width:48, height:48, margin:'0 auto 14px',
          borderRadius:'50%',
          background:'var(--green-light)',
          border:'1px solid var(--green-muted)',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>
          Live attendance dashboard
        </h2>
        <p style={{ fontSize:13, color:'var(--text-muted)', maxWidth:480, margin:'0 auto', lineHeight:1.6 }}>
          Once teachers are enrolled and the kiosk is deployed on the Tab A7, this page will show live punch-ins, a daily roster, and let you do manual overrides.
        </p>
      </div>
    </div>
  )
}
