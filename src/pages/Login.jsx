// ============================================================================
// LOGIN
//
// Sign-in for the HRMS admin portal — Google sign-in and SMS-OTP sign-in.
//
// This component does ONE thing: sign the user in and show errors.
// It does NOT decide who is allowed in — that is handled entirely by
// onAuthStateChanged in App.jsx, which reads the `admins` Firestore collection
// and routes the user (or signs them back out with a message).
//
// Past mistakes — do not re-introduce them:
//   * Use signInWithPopup ONLY for Google. Never linkWithPopup /
//     linkWithCredential here. This is a sign-in screen, not an
//     account-linking screen; a link call on an already-linked account is
//     what produced auth/provider-already-linked.
//   * The SMS-OTP flow uses signInWithCustomToken — that is also a sign-in,
//     NOT a link. The same rules apply: no pre-checks, no signOut(), no
//     retry loops.
//   * Do NOT pre-check auth.currentUser or signOut() before signing in.
//   * No "self-heal" retry loops. If sign-in fails, show the error and let
//     the user act again with a fresh gesture.
//   * The Google provider must not use prompt:'select_account' (see firebase.js).
// ============================================================================

import React, { useState } from 'react'
import { signInWithPopup, signInWithCustomToken } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

// Supabase Edge Functions base URL (rka-attendance project).
const FUNCTIONS_URL = 'https://yegxwxutdalmdubrozrm.supabase.co/functions/v1'

// Builds the phone string sent to the backend. It MUST match the format
// stored in employees.phone exactly — the lookup is an exact string match.
// Currently sends +91 followed by the 10 digits.
// If employees.phone is stored as bare 10 digits, change this to: return tenDigits
function toBackendPhone(tenDigits) {
  return '+91' + tenDigits
}

// Map a Firebase Auth error to a short, human-readable message.
function messageForError(e) {
  switch (e && e.code) {
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled.'
    case 'auth/cancelled-popup-request':
      return '' // a newer popup replaced this one — nothing to show
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.'
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and try again.'
    case 'auth/unauthorized-domain':
      return 'This site is not authorised for sign-in. Contact Adwit Mishra.'
    case 'auth/invalid-custom-token':
    case 'auth/custom-token-mismatch':
      return 'Sign-in token was rejected. Please try again.'
    case 'auth/internal-error':
      return 'Sign-in hit an unexpected error. Please try again.'
    default:
      return `Sign-in failed: ${(e && e.message) || 'Unknown error'}`
  }
}

// Action-button style (white CTA). `incomplete` dims it; `isSigning` keeps it
// white with a wait cursor — matching the Google button's behaviour.
function actionBtn(incomplete, isSigning) {
  return {
    width: '100%', padding: '12px 16px',
    background: incomplete ? 'rgba(255,255,255,0.14)' : '#ffffff',
    color: incomplete ? 'rgba(245,245,243,0.45)' : '#1a1a1a',
    border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500,
    cursor: incomplete ? 'not-allowed' : (isSigning ? 'wait' : 'pointer'),
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    transition: 'all 0.15s',
    boxShadow: incomplete ? 'none' : '0 4px 14px rgba(0,0,0,0.25)',
  }
}

function Spinner() {
  return (
    <div style={{ width: 16, height: 16, border: '2px solid rgba(0,0,0,0.15)', borderTopColor: 'var(--green-dark, #1b3d1b)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
  )
}

export default function Login({ authError }) {
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('google')   // 'google' | 'phone'
  const [step, setStep] = useState('phone')     // 'phone' | 'otp'
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [info, setInfo] = useState('')

  async function handleSignIn() {
    setError('')
    setSigning(true)
    try {
      await signInWithPopup(auth, googleProvider)
      // Success. onAuthStateChanged in App.jsx now verifies the admins doc.
    } catch (e) {
      console.error('Sign-in error:', e.code, e.message)
      setError(messageForError(e))
    } finally {
      setSigning(false)
    }
  }

  async function handleSendOtp() {
    if (phone.length !== 10 || signing) return
    setError(''); setInfo(''); setSigning(true)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: toBackendPhone(phone) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not send the OTP. Please try again.')
      } else {
        setInfo(`Code sent to +91 ${phone.slice(0, 5)} ${phone.slice(5)}`)
        setStep('otp'); setOtp('')
      }
    } catch (e) {
      console.error('request-otp error:', e)
      setError('Network problem. Check your connection and try again.')
    } finally {
      setSigning(false)
    }
  }

  async function handleVerifyOtp() {
    if (otp.length !== 6 || signing) return
    setError(''); setSigning(true)
    try {
      const res = await fetch(`${FUNCTIONS_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: toBackendPhone(phone), code: otp }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(data.error || 'Verification failed. Please try again.')
        return
      }
      // signInWithCustomToken is a sign-in (like signInWithPopup), NOT a link.
      // onAuthStateChanged in App.jsx then verifies the admins doc and routes.
      await signInWithCustomToken(auth, data.customToken)
    } catch (e) {
      console.error('verify-otp error:', e.code, e.message)
      setError(messageForError(e))
    } finally {
      setSigning(false)
    }
  }

  function switchToPhone() { setMode('phone'); setStep('phone'); setError(''); setInfo(''); setOtp('') }
  function switchToGoogle() { setMode('google'); setError(''); setInfo('') }
  function changeNumber() { setStep('phone'); setError(''); setInfo(''); setOtp('') }

  const linkBtn = {
    background: 'none', border: 'none', color: 'var(--gold-light, #e6c557)',
    fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 4, fontFamily: 'inherit',
  }
  const fieldFocus = (el, on) => { el.style.borderColor = on ? 'var(--gold-light, #e6c557)' : 'rgba(255,255,255,0.12)' }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0d2818 0%, #1b3d1b 50%, #0d2818 100%)',
      padding: 20, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '60%', height: '70%', background: 'radial-gradient(circle, rgba(201,162,39,0.08) 0%, transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: '50%', height: '60%', background: 'radial-gradient(circle, rgba(192,0,12,0.06) 0%, transparent 60%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 460, position: 'relative', zIndex: 1 }}>
        {/* Banner */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <img src="/banner.png" alt="Radhakrishna Academy" style={{ width: '100%', maxWidth: 400, height: 'auto', display: 'inline-block', filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.4))' }} />
        </div>

        {/* Glass-card form */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: '32px 30px 28px',
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: '#ffffff', textAlign: 'center', marginBottom: 4 }}>
            Sign in
          </div>
          <div style={{ fontSize: 11, color: 'rgba(245,245,243,0.6)', letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 500, textAlign: 'center', marginBottom: 22 }}>
            Employee Management System
          </div>

          {/* ---- GOOGLE MODE ---- */}
          {mode === 'google' && (
            <>
              <p style={{ fontSize: 13, color: 'rgba(245,245,243,0.7)', textAlign: 'center', marginBottom: 22, lineHeight: 1.6 }}>
                Sign in with your <strong style={{ color: 'var(--gold-light, #e6c557)' }}>@rkacademyballia.in</strong> Google account to access the Human Resource Management System.
              </p>

              <button onClick={handleSignIn} disabled={signing} style={{
                width: '100%', padding: '12px 16px', background: '#ffffff', color: '#1a1a1a',
                border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500,
                cursor: signing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 12, transition: 'all 0.15s', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
              }}>
                {signing ? <Spinner /> : (
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                {signing ? 'Signing in…' : 'Sign in with Google'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <span style={{ fontSize: 11, color: 'rgba(245,245,243,0.4)' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
              </div>

              <button onClick={switchToPhone} disabled={signing} style={{
                width: '100%', padding: '11px 16px', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10,
                color: 'rgba(245,245,243,0.85)', fontSize: 13.5, fontWeight: 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="2" width="10" height="20" rx="2" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
                Sign in with mobile OTP
              </button>
            </>
          )}

          {/* ---- PHONE MODE: enter number ---- */}
          {mode === 'phone' && step === 'phone' && (
            <>
              <p style={{ fontSize: 13, color: 'rgba(245,245,243,0.7)', textAlign: 'center', marginBottom: 18, lineHeight: 1.6 }}>
                Enter your registered mobile number and we'll send a one-time code.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
                <span style={{ padding: '12px 12px', color: 'rgba(245,245,243,0.55)', fontSize: 14, borderRight: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}>+91</span>
                <input
                  type="tel" inputMode="numeric" autoFocus value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp() }}
                  onFocus={(e) => fieldFocus(e.target.parentElement, true)}
                  onBlur={(e) => fieldFocus(e.target.parentElement, false)}
                  placeholder="10-digit mobile number"
                  style={{ flex: 1, padding: '12px 14px', background: 'transparent', border: 'none', color: '#fff', fontSize: 14, outline: 'none' }}
                />
              </div>
              <button onClick={handleSendOtp} disabled={signing || phone.length !== 10} style={actionBtn(phone.length !== 10, signing)}>
                {signing ? <><Spinner />Sending…</> : 'Send OTP'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button onClick={switchToGoogle} disabled={signing} style={linkBtn}>Use Google sign-in instead</button>
              </div>
            </>
          )}

          {/* ---- PHONE MODE: enter OTP ---- */}
          {mode === 'phone' && step === 'otp' && (
            <>
              <p style={{ fontSize: 13, color: 'rgba(245,245,243,0.7)', textAlign: 'center', marginBottom: 18, lineHeight: 1.6 }}>
                Enter the 6-digit code sent to<br />+91 {phone.slice(0, 5)} {phone.slice(5)}
              </p>
              <input
                type="tel" inputMode="numeric" autoFocus value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp() }}
                onFocus={(e) => fieldFocus(e.target, true)}
                onBlur={(e) => fieldFocus(e.target, false)}
                placeholder="6-digit code"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#fff', fontSize: 17, letterSpacing: '0.4em', textAlign: 'center', outline: 'none', boxSizing: 'border-box', marginBottom: 14 }}
              />
              <button onClick={handleVerifyOtp} disabled={signing || otp.length !== 6} style={actionBtn(otp.length !== 6, signing)}>
                {signing ? <><Spinner />Verifying…</> : 'Verify & sign in'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14, display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}>
                <button onClick={handleSendOtp} disabled={signing} style={linkBtn}>Resend code</button>
                <span style={{ color: 'rgba(245,245,243,0.25)', fontSize: 12 }}>·</span>
                <button onClick={changeNumber} disabled={signing} style={linkBtn}>Change number</button>
              </div>
            </>
          )}

          {/* ---- shared error / info ---- */}
          {(error || authError) && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#fca5a5', lineHeight: 1.5, textAlign: 'center' }}>
              {error || authError}
            </div>
          )}
          {info && !error && !authError && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(201,162,39,0.12)', border: '1px solid rgba(201,162,39,0.3)', borderRadius: 8, fontSize: 12, color: 'var(--gold-light, #e6c557)', lineHeight: 1.5, textAlign: 'center' }}>
              {info}
            </div>
          )}

          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(245,245,243,0.4)', textAlign: 'center' }}>
            Use the same admin account as the Academic Tracker.
          </div>
        </div>
      </div>
    </div>
  )
}
