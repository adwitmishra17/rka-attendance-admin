// ============================================================================
// fleet-presign-upload
//
// Mirrors presign-upload but routes uploads under fleet-specific R2 prefixes:
//   ownerType='vehicle' → vehicles/<vehicleId>/<ts>_<safe_name>
//   ownerType='driver'  → drivers/<employeeId>/<ts>_<safe_name>
//
// Same allow-list, same 10 MB cap, same admin-secret auth as the employee
// version. Returns { uploadUrl, r2Key, headers, expiresIn }.
// ============================================================================

// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.17"

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!
const R2_BUCKET = Deno.env.get("R2_BUCKET")!
const ADMIN_SHARED_SECRET = Deno.env.get("ADMIN_SHARED_SECRET")!

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

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

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
    const adminSecret = req.headers.get("x-admin-secret")
    if (!ADMIN_SHARED_SECRET || adminSecret !== ADMIN_SHARED_SECRET) {
      return json({ error: "unauthorized" }, 401)
    }

    const body = await req.json()
    const { ownerType, ownerId, filename, sizeBytes, mimeType } = body || {}

    // ownerType drives the R2 prefix
    if (ownerType !== "vehicle" && ownerType !== "driver") {
      return json({ error: "ownerType must be 'vehicle' or 'driver'" }, 400)
    }
    if (!ownerId || typeof ownerId !== "string") {
      return json({ error: "ownerId required" }, 400)
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

    const safeName = sanitiseFilename(filename)
    const timestamp = Date.now()
    const prefix = ownerType === "vehicle" ? "vehicles" : "drivers"
    const r2Key = `${prefix}/${ownerId}/${timestamp}_${safeName}`

    const aws = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    })

    const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${r2Key}`
    const signed = await aws.sign(
      new Request(url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
      }),
      { aws: { signQuery: true } },
    )

    return json({
      uploadUrl: signed.url,
      r2Key,
      method: "PUT",
      headers: { "Content-Type": mimeType },
      expiresIn: 300,
    })
  } catch (e) {
    console.error("fleet-presign-upload error:", e)
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
  const base = name.split(/[\\/]/).pop() || "file"
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
}
