// ============================================================================
// FIREBASE
//
// Firebase app, Auth, and Firestore for the HRMS admin portal.
// Project: rka-academic-tracker (shared with the Academic Tracker — Auth and
// the `admins` collection live here).
//
// Google provider config — IMPORTANT, do not change without reading this:
//
//   hd      — hints Google to prefer @rkacademyballia.in Workspace accounts
//             in the chooser. Genuine Workspace accounts pass it fine; it was
//             present the whole time sign-in worked, so it stays.
//
//   prompt  — we deliberately DO NOT set prompt:'select_account'. Forcing the
//             account chooser on every sign-in inserts a mandatory interactive
//             step inside the OAuth popup. That step fails for any admin who
//             isn't already signed into their Workspace account in the browser
//             — which is exactly what broke non-super-admin sign-in. Leaving
//             prompt unset lets Google complete a valid session silently.
//
// Authorisation (who may enter, branch, modules) is enforced by
// onAuthStateChanged in App.jsx against the `admins` Firestore collection —
// NOT by anything in the Google popup.
// ============================================================================

import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ hd: 'rkacademyballia.in' })
