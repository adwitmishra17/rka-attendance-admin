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

// hd            — hints Google to prefer @rkacademyballia.in accounts.
// prompt        — 'select_account' forces the Google account chooser on
//                 EVERY sign-in. Without this, Google silently reuses
//                 whatever Google session is already active in the browser.
//                 On a shared machine, that means the next person to sign in
//                 can silently ride the previous user's Google session,
//                 which leaves Firebase Auth in a tangled state and throws
//                 auth/provider-already-linked. Forcing the chooser makes a
//                 normal browser behave like an incognito window: the user
//                 always explicitly picks their own account.
googleProvider.setCustomParameters({
  hd: 'rkacademyballia.in',
  prompt: 'select_account',
})
