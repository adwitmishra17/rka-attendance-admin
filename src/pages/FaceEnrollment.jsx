import React from 'react'

export default function FaceEnrollment() {
  return (
    <div style={{ padding:'32px 36px', maxWidth:1200 }}>
      <div className="fade-in" style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:600, color:'var(--green-dark)', marginBottom:6 }}>
          Face Enrollment
        </h1>
        <p style={{ fontSize:13, color:'var(--text-muted)' }}>
          Capture each teacher's face for kiosk recognition.
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
          Face enrollment flow — comes after Employees module is ready.
        </p>
      </div>
    </div>
  )
}
