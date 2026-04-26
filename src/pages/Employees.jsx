import React from 'react'

export default function Employees() {
  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>
          Employees
        </h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>
          Register teachers whose attendance will be tracked by the kiosk.
        </p>
        <div style={{ width:40, height:2, background:'linear-gradient(90deg, var(--gold), transparent)', marginTop:8, borderRadius:1 }} />
      </div>

      <Placeholder title="Employees module" body="This is where you'll add, edit and manage teachers — name, employee code, biometric code, custom reporting times. Coming next." />
    </div>
  )
}

function Placeholder({ title, body }) {
  return (
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
        background:'var(--gold-light)',
        border:'1px solid rgba(201,162,39,0.3)',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h2 style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>
        {title}
      </h2>
      <p style={{ fontSize:13, color:'var(--text-muted)', maxWidth:420, margin:'0 auto', lineHeight:1.6 }}>
        {body}
      </p>
    </div>
  )
}
