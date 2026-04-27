import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

// Public client — used for reads, respects RLS
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
})

// Admin client — bypasses RLS, used for writes from admin pages.
// Only initialised if service key is present (which it should be in admin app).
// In v2 we'll move this to a server-side proxy for better security.
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })
  : null

if (!supabaseAdmin && import.meta.env.DEV) {
  console.warn('VITE_SUPABASE_SERVICE_ROLE_KEY not set — admin writes will fail.')
}
