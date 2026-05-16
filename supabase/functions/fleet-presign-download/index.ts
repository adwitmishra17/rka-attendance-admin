// ============================================================================
// fleet-presign-download
//
// Looks up a fleet document (vehicle or driver) and returns a signed GET URL.
// Writes a fleet_audit_log entry with action='view_sensitive' for traceability.
// ============================================================================

// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.17"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!
const R2_BUCKET = Deno.env.get("R2_BUCKET")!
const ADMIN_SHARED_SECRET = Deno.env.get("ADMIN_SHARED_SECRET")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

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
    const { ownerType, documentId, requestedByEmail } = body || {}

    if (ownerType !== "vehicle" && ownerType !== "driver") {
      return json({ error: "ownerType must be 'vehicle' or 'driver'" }, 400)
    }
    if (!documentId || typeof documentId !== "string") {
      return json({ error: "documentId required (uuid)" }, 400)
    }
    if (!requestedByEmail || typeof requestedByEmail !== "string") {
      return json({ error: "requestedByEmail required" }, 400)
    }

    const tableName = ownerType === "vehicle" ? "vehicle_documents" : "driver_documents"

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: doc, error: e1 } = await sb
      .from(tableName)
      .select("id, doc_type, filename, r2_key, mime_type, deleted_at")
      .eq("id", documentId)
      .single()

    if (e1 || !doc) {
      return json({ error: "document not found" }, 404)
    }
    if (doc.deleted_at) {
      return json({ error: "document was deleted" }, 410)
    }

    const aws = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    })

    const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${doc.r2_key}`
    const signed = await aws.sign(
      new Request(url, { method: "GET" }),
      { aws: { signQuery: true } },
    )

    // Audit log
    await sb.from("fleet_audit_log").insert({
      entity_type: ownerType === "vehicle" ? "vehicle_document" : "driver_document",
      entity_id: doc.id,
      changed_by_email: requestedByEmail,
      action: "update",            // 'update' covers reads in our enum; we tag via field_name
      field_name: `download:${doc.doc_type}:${doc.filename}`,
      old_value: null,
      new_value: null,
    })

    return json({
      downloadUrl: signed.url,
      filename: doc.filename,
      mimeType: doc.mime_type,
      expiresIn: 300,
    })
  } catch (e) {
    console.error("fleet-presign-download error:", e)
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
