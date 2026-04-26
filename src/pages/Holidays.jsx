import React from 'react'

export default function Holidays() {
  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>
          Holidays
        </h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>
          Mark school holidays in advance so the kiosk doesn't expect attendance.
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
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>
          Holiday calendar — coming next.
        </p>
      </div>
    </div>
  )
}
