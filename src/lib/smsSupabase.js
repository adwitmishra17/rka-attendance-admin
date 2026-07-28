import { createClient } from '@supabase/supabase-js'

/* ============================================================
   Read-only client pointed at the SMS (rka-sms) project — the
   mirror of how SMS reads HRMS. Used only to pull the
   salary-advance ledger: public.v_salary_advances, a view that
   exposes ONLY salary-advance expenses (every other expense
   category stays private to SMS). HR sees who was paid an advance.

   The anon key is PUBLIC by design and safe in the bundle; the
   view's WHERE clause is the privacy boundary, and this client
   only ever reads.
   ============================================================ */

const url     = import.meta.env.VITE_SMS_SUPABASE_URL
const anonKey = import.meta.env.VITE_SMS_SUPABASE_ANON_KEY

if ((!url || !anonKey) && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    '[smsSupabase] VITE_SMS_SUPABASE_URL / VITE_SMS_SUPABASE_ANON_KEY are not set. ' +
    'The advances report will be empty until they are filled in .env / Vercel envs.'
  )
}

export const smsSupabase = (url && anonKey)
  ? createClient(url, anonKey, { auth: { persistSession: false } })
  : null
