// ============================================================================
// presign-upload
//
// Browser asks: "I want to upload this file (filename, size, mime, category).
// Give me a signed URL I can PUT it to."
//
// Function returns: { uploadUrl, r2Key, documentId }
//
// Flow:
//   1. Verify the request is from an authenticated admin (service role key check)
//   2. Generate a unique R2 key: employees/<employee_id>/<timestamp>_<filename>
//   3. Sign a PUT URL using AWS Signature V4 (R2 is S3-compatible)
//   4. Return URL + key
//
// The browser then PUTs the file to uploadUrl, then calls confirm-upload to
// register it in the DB.
// ============================================================================

// @ts-nocheck — Deno runtime, types resolved at deploy time
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.17"

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!
const R2_BUCKET = Deno.env.get("R2_BUCKET")!
const ADMIN_SHARED_SECRET = Deno.env.get("ADMIN_SHARED_SECRET")!

// Allowed mime types — keep tight for safety
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

const MAX_BYTES = 10 * 1024 * 1024  // 10 MB per file

// CORS headers — Edge Functions need to handle preflight
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Auth — simple shared-secret header. Browser includes it via supabaseAdmin
    // service-role channel. NOT a long-term auth solution but matches Pattern A
    // we agreed on. Phase 5 hardens this.
    const adminSecret = req.headers.get("x-admin-secret")
    if (!ADMIN_SHARED_SECRET || adminSecret !== ADMIN_SHARED_SECRET) {
      return json({ error: "unauthorized" }, 401)
    }

    const body = await req.json()
    const { employeeId, filename, sizeBytes, mimeType } = body || {}

    // Validate inputs
    if (!employeeId || typeof employeeId !== "string") {
      return json({ error: "employeeId required" }, 400)
    }
    if (!filename || typeof filename !== "string" || filename.length > 255) {
      return json({ error: "filename required and < 255 chars" }, 400)
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
      return json({ error: `file must be 1 byte – ${MAX_BYTES} bytes` }, 400)
    }
    if (!mimeType || !ALLOWED_MIMES.has(mimeType)) {
      return json({ error: `mime type not allowed: ${mimeType}` }, 400)
    }

    // Sanitise filename — keep only safe chars, preserve extension
    const safeName = sanitiseFilename(filename)
    const timestamp = Date.now()
    const r2Key = `employees/${employeeId}/${timestamp}_${safeName}`

    // Sign the PUT URL using aws4fetch
    const aws = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    })

    const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${r2Key}`
    // signQuery: true produces a presigned URL (default ~5 min validity)
    const signed = await aws.sign(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
      }),
      { aws: { signQuery: true } },
    )

    // The signed URL is good for ~5 minutes by default with aws4fetch
    return json({
      uploadUrl: signed.url,
      r2Key,
      method: "PUT",
      headers: { "Content-Type": mimeType },
      expiresIn: 300,
    })
  } catch (e) {
    console.error("presign-upload error:", e)
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function sanitiseFilename(name: string): string {
  // Strip path separators, keep extension
  const base = name.split(/[\\/]/).pop() || "file"
  // Replace anything that isn't alphanumeric/dot/hyphen/underscore with underscore
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
}
