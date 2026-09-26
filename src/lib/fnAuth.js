import { auth } from './firebase'

// Headers for calling the HRMS admin edge functions (documents, fleet).
// Authorization carries the Supabase anon key for the functions gateway; the
// function itself authorises the caller from the signed-in admin's Firebase ID
// token in x-firebase-token (verified server-side against the admins list).
export async function adminFnHeaders() {
  const token = await auth?.currentUser?.getIdToken?.()
  if (!token) throw new Error('Not signed in')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    'x-firebase-token': token,
  }
}
