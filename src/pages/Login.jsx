import React, { useState } from 'react'
import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

export default function Login({ authError }) {
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  async function handleSignIn() {
    setError('')
    setSigning(true)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      console.error(e)
      if (e.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled.')
      } else if (e.code === 'auth/popup-blocked') {
        setError('Pop-up blocked. Please allow pop-ups and try again.')
      } else {
        setError(`Sign-in failed: ${e.message}`)
      }
    }
    setSigning(false)
  }

  return (
    <div style={{
      minHeight:'100vh',
      display:'flex',
      alignItems:'center',
      justifyContent:'center',
      background: 'linear-gradient(135deg, var(--green-dark) 0%, #2a6b44 100%)',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--white)',
        borderRadius: 'var(--radius-lg)',
        padding: '40px 36px',
        maxWidth: 420,
        width: '100%',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Logo */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, marginBottom:28 }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            border: '2px solid var(--gold)',
            background: 'var(--green-dark)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gold)',
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
          }}>
            RKA
          </div>
          <div style={{ textAlign:'center' }}>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--green-dark)',
              marginBottom: 4,
            }}>
              Radhakrishna Academy
            </h1>
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 500,
            }}>
              HR · Attendance Portal
            </div>
          </div>
        </div>

        <div style={{ height:1, background:'var(--gray-100)', margin:'0 auto 24px', width:'60%' }} />

        <p style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          textAlign: 'center',
          marginBottom: 24,
          lineHeight: 1.6,
        }}>
          Sign in with your <strong style={{ color:'var(--green-dark)' }}>@rkacademyballia.in</strong> Google account to manage attendance.
        </p>

        <button
          onClick={handleSignIn}
          disabled={signing}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'var(--white)',
            color: 'var(--text)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
            fontWeight: 500,
            cursor: signing ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            transition: 'all 0.15s',
          }}
        >
          {signing ? (
            <div style={{ width:16, height:16, border:'2px solid var(--gray-300)', borderTopColor:'var(--green)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {signing ? 'Signing in…' : 'Sign in with Google'}
        </button>

        {(error || authError) && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--crimson-light)',
            border: '1px solid rgba(139,26,26,0.2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            color: 'var(--crimson)',
            lineHeight: 1.5,
          }}>
            {error || authError}
          </div>
        )}

        <div style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: '1px solid var(--gray-100)',
          fontSize: 11,
          color: 'var(--gray-400)',
          textAlign: 'center',
        }}>
          Use the same admin account as the Academic Tracker.
        </div>
      </div>
    </div>
  )
}
