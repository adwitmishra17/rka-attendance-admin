import { createClient } from '@supabase/supabase-js'
import { auth } from './firebase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ONE client, authorised by the signed-in admin's own Firebase ID token.
//
// Supabase Third-Party Auth (Firebase, project rka-academic-tracker) accepts
// that token as the access token; RLS (migration 030) grants HRMS tables from
// its hrms_level claim, which the hrms-claims edge function stamps from the
// Firestore `admins` collection at sign-in (see lib/hrmsSession.js).
//
// The browser no longer holds the service_role key — it shipped in the public
// bundle, so anyone could bypass RLS. Signed out (no token) the client falls
// back to the anon key and RLS gives it only the public directory reads.
const client = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => (await auth.currentUser?.getIdToken()) ?? null,
})

// Both names point at the same token-authorised client; `supabaseAdmin` is
// kept so the ~25 call sites needn't change.
export const supabase = client
export const supabaseAdmin = client
