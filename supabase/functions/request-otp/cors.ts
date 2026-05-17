// Shared CORS headers for the OTP edge functions.
// Add/adjust the HRMS domain below to match your actual deployment.
const ALLOWED_ORIGINS = [
  "https://tracker.rkacademyballia.in",
  "https://teacher.rkacademyballia.in",
  "https://hrms.rkacademyballia.in", // <-- CONFIRM/EDIT: actual HRMS domain
  "http://localhost:5173",
  "http://localhost:3000",
];

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
