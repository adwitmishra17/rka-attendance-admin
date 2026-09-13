// ============================================================================
// presign-my-document-upload
//
// Teacher self-service: the Teacher PWA asks for a signed URL to upload one of
// their own onboarding documents. Mirrors presign-upload, but instead of the
// shared admin secret it authenticates the TEACHER via their Firebase ID token
// (same pattern as get-my-documents) and scopes the R2 key to that teacher's
// own employee_id — a teacher can only ever upload into their own folder.
//
// Returns: { uploadUrl, r2Key, method, headers, expiresIn }
// ============================================================================

// @ts-nocheck — Deno runtime
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.17";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

// jpg + pdf are what teachers submit; images get optimised to jpeg client-side,
// but accept the common phone formats in case a device sends png/heic.
const ALLOWED_MIMES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (PDF cap; optimised images are far smaller)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function sanitiseFilename(name: string): string {
  const base = String(name).split(/[\\/]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // 1 — verify the teacher's Firebase ID token
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "missing_token" }, 401);
    let payload;
    try {
      ({ payload } = await jwtVerify(authHeader.slice(7).trim(), FIREBASE_JWKS, {
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
        audience: FIREBASE_PROJECT_ID,
      }));
    } catch {
      return json({ error: "invalid_token" }, 401);
    }
    const email = (payload.email as string | undefined)?.toLowerCase().trim();
    if (!email || !payload.email_verified) return json({ error: "email_not_verified" }, 401);

    // 2 — resolve the teacher's own employee record
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: emp, error: empErr } = await sb
      .from("employees").select("id, is_active, documents_locked").eq("personal_email", email).maybeSingle();
    if (empErr) return json({ error: "db_error", detail: empErr.message }, 500);
    if (!emp) return json({ error: "no_linked_employee", email }, 404);
    if (!emp.is_active) return json({ error: "inactive_employee" }, 403);
    // Once the super admin locks the set, teachers can't add/replace files.
    if (emp.documents_locked) return json({ error: "documents_locked", message: "Your documents were locked by the office. Contact the admin to make changes." }, 423);

    // 3 — validate the requested file
    const { filename, sizeBytes, mimeType } = (await req.json()) || {};
    if (!filename || typeof filename !== "string" || filename.length > 255) return json({ error: "filename required" }, 400);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) return json({ error: `file must be 1 – ${MAX_BYTES} bytes` }, 400);
    if (!mimeType || !ALLOWED_MIMES.has(mimeType)) return json({ error: `mime not allowed: ${mimeType}` }, 400);

    // 4 — sign a PUT into this teacher's own folder
    const r2Key = `employees/${emp.id}/${Date.now()}_${sanitiseFilename(filename)}`;
    const aws = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
    const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${r2Key}`;
    const signed = await aws.sign(new Request(url, { method: "PUT", headers: { "Content-Type": mimeType } }), { aws: { signQuery: true } });

    return json({ uploadUrl: signed.url, r2Key, method: "PUT", headers: { "Content-Type": mimeType }, expiresIn: 300 });
  } catch (e) {
    console.error("presign-my-document-upload error:", e);
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500);
  }
});
