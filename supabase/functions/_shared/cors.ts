// Shared CORS headers for the OTP edge functions.
// Reflects the caller's origin when it belongs to a school surface:
// any *.rkacademyballia.in host, Vercel preview/prod deployments of the
// admin apps, and local dev servers.
const ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)*rkacademyballia\.in$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];
const FALLBACK_ORIGIN = "https://hrms.rkacademyballia.in";

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ORIGIN_PATTERNS.some((re) => re.test(origin))
    ? origin
    : FALLBACK_ORIGIN;
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
