// The project's server-side (RLS-bypassing) key for edge functions.
//
// Prefers the NEW secret key (sb_secret_…, auto-injected as the JSON env
// SUPABASE_SECRET_KEYS once created in Dashboard → API Keys) and falls back to
// the legacy service_role JWT — so functions keep working before, during and
// after the move off the legacy keys (which leaked in the old HRMS bundle).
export function serviceRoleKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const k = keys?.default ?? Object.values(keys ?? {})[0];
    if (typeof k === "string" && k) return k;
  } catch { /* not set / not JSON */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
