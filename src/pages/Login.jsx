// ============================================================================
// LOGIN
//
// Google sign-in for the HRMS admin portal.
//
// This component does ONE thing: run the Google popup sign-in and show errors.
// It does NOT decide who is allowed in — that is handled entirely by
// onAuthStateChanged in App.jsx, which reads the `admins` Firestore collection
// and routes the user (or signs them back out with a message).
//
// Past mistakes — do not re-introduce them:
//   * Use signInWithPopup ONLY. Never linkWithPopup / linkWithCredential here.
//     This is a sign-in screen, not an account-linking screen; a link call on
//     an already-linked account is what produced auth/provider-already-linked.
//   * Do NOT pre-check auth.currentUser or signOut() before signing in.
//     signInWithPopup works regardless of any existing session — it simply
//     signs in the chosen account. A pre-check only turns one tap into two.
//   * No "self-heal" retry loops. If sign-in fails, show the error and let the
//     user tap again with a fresh gesture.
//   * The Google provider must not use prompt:'select_account' (see firebase.js).
// ============================================================================

import React, { useState } from 'react'
import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

// Map a Firebase Auth error to a short, human-readable message.
// Returns '' for cases that need no message (e.g. a superseded popup).
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
    case 'auth/internal-error':
      return 'Sign-in hit an unexpected error. Please try again.'
    default:
      return `Sign-in failed: ${(e && e.message) || 'Unknown error'}`
  }
}

export default function Login({ authError }) {
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  async function handleSignIn() {
    setError('')
    setSigning(true)
    try {
      await signInWithPopup(auth, googleProvider)
      // Success. onAuthStateChanged in App.jsx now verifies the admins doc
      // and routes the user; on a valid admin this component unmounts.
      // (We still clear `signing` in finally so the button is never stuck
      //  spinning if App.jsx signs the user back out for an authz failure.)
    } catch (e) {
      console.error('Sign-in error:', e.code, e.message)
      setError(messageForError(e))
    } finally {
      setSigning(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0d2818 0%, #1b3d1b 50%, #0d2818 100%)',
      padding: 20,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle gold glow accent (top-right) */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        right: '-10%',
        width: '60%',
        height: '70%',
        background: 'radial-gradient(circle, rgba(201,162,39,0.08) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />
      {/* Subtle crimson glow accent (bottom-left) */}
      <div style={{
        position: 'absolute',
        bottom: '-20%',
        left: '-10%',
        width: '50%',
        height: '60%',
        background: 'radial-gradient(circle, rgba(192,0,12,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: '100%',
        maxWidth: 460,
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Banner — sits directly on green, no card, no black box */}
        <div style={{
          textAlign: 'center',
          marginBottom: 36,
        }}>
          <img src="/banner.png" alt="Radhakrishna Academy" style={{
            width: '100%',
            maxWidth: 400,
            height: 'auto',
            display: 'inline-block',
            filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.4))',
          }} />
        </div>

        {/* Glass-card form */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '32px 30px 28px',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 600,
            color: '#ffffff',
            textAlign: 'center',
            marginBottom: 4,
          }}>
            Sign in
          </div>
          <div style={{
            fontSize: 11,
            color: 'rgba(245,245,243,0.6)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 500,
            textAlign: 'center',
            marginBottom: 22,
          }}>
            Employee Management System
          </div>

          <p style={{
            fontSize: 13,
            color: 'rgba(245,245,243,0.7)',
            textAlign: 'center',
            marginBottom: 22,
            lineHeight: 1.6,
          }}>
            Sign in with your <strong style={{ color: 'var(--gold-light, #e6c557)' }}>@rkacademyballia.in</strong> Google account to access the Human Resource Management System.
          </p>

          <button
            onClick={handleSignIn}
            disabled={signing}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: '#ffffff',
              color: '#1a1a1a',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: signing ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              transition: 'all 0.15s',
              boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            }}
          >
            {signing ? (
              <div style={{
                width: 16, height: 16,
                border: '2px solid rgba(0,0,0,0.15)',
                borderTopColor: 'var(--green-dark, #1b3d1b)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            {signing ? 'Signing in…' : 'Sign in with Google'}
          </button>

          {(error || authError) && (
            <div style={{
              marginTop: 16,
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8,
              fontSize: 12,
              color: '#fca5a5',
              lineHeight: 1.5,
              textAlign: 'center',
            }}>
              {error || authError}
            </div>
          )}

          <div style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,0.08)',
            fontSize: 11,
            color: 'rgba(245,245,243,0.4)',
            textAlign: 'center',
          }}>
            Use the same admin account as the Academic Tracker.
          </div>
        </div>
      </div>
    </div>
  )
}
