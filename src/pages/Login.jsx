import React, { useState } from 'react'
import { signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

export default function Login({ authError }) {
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  async function handleSignIn() {
    setError('')

    // If a residual auth session is still present (stale currentUser), clear
    // it BEFORE attempting a fresh sign-in. A leftover session — which can be
    // caused by a browser extension interfering with the OAuth popup, or by a
    // prior sign-out that didn't fully settle — makes the popup flow throw
    // auth/provider-already-linked.
    //
    // We deliberately do NOT immediately re-open the popup here. A popup
    // opened *after* an awaited call is frequently blocked by the browser
    // (the user-gesture is considered consumed). Instead we clear the state
    // and ask the user for one more tap, which is a fresh gesture.
    if (auth.currentUser) {
      setSigning(true)
      try { await signOut(auth) } catch (_) { /* ignore */ }
      setSigning(false)
      setError('Session refreshed — please tap “Sign in with Google” once more.')
      return
    }

    setSigning(true)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      console.error('Sign-in error:', e.code, e.message)

      // Self-heal: provider-already-linked / credential-already-in-use mean
      // the auth instance is in a dirty state. Clear it fully; the user taps
      // again (fresh gesture → popup won't be blocked) and it succeeds.
      if (
        e.code === 'auth/provider-already-linked' ||
        e.code === 'auth/credential-already-in-use'
      ) {
        try { await signOut(auth) } catch (_) { /* ignore */ }
        setError(
          'Session cleared — please tap “Sign in with Google” once more. ' +
          'If this keeps happening, try a private/incognito window or disable browser extensions.'
        )
      } else if (e.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled.')
      } else if (e.code === 'auth/popup-blocked') {
        setError('Pop-up blocked. Please allow pop-ups and try again.')
      } else if (e.code === 'auth/network-request-failed') {
        setError('Network issue. Check your connection and try again.')
      } else if (e.code === 'auth/unauthorized-domain') {
        setError('This domain is not authorised for sign-in. Contact Adwit Mishra.')
      } else {
        setError(
          `Sign-in failed: ${e.message}. ` +
          'If this persists, try a private/incognito window or disable browser extensions.'
        )
      }
    }
    setSigning(false)
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
