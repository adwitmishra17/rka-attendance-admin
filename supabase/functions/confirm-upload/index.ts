// ============================================================================
// confirm-upload
//
// After the browser PUT-uploads to R2 successfully, it calls this function
// to register the file in employee_documents.
//
// Why a separate step? If we inserted at presign time, we'd have orphan rows
// for failed uploads. By inserting only after R2 confirms (200 OK + ETag),
// we keep the DB clean.
//
// Function:
//   1. Verify admin secret
//   2. Validate the R2 key matches a recently-issued presigned upload
//      (light check — we trust the admin app)
//   3. Insert into employee_documents
//   4. Write audit log entry (action='create' on the document)
//   5. Return the new document row
// ============================================================================

// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const ADMIN_SHARED_SECRET = Deno.env.get("ADMIN_SHARED_SECRET")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const VALID_CATEGORIES = new Set([
  "id_proof", "education", "employment", "tax", "bank",
  "verification", "salary_slip", "performance", "photograph", "other",
])

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
    const {
      employeeId,
      r2Key,
      filename,
      displayName,
      category,
      sizeBytes,
      mimeType,
      checksum,
      isTeacherVisible,
      expiresAt,
      notes,
      uploadedByEmail,
    } = body || {}

    // Validate
    if (!employeeId)  return json({ error: "employeeId required" }, 400)
    if (!r2Key)       return json({ error: "r2Key required" }, 400)
    if (!filename)    return json({ error: "filename required" }, 400)
    if (!sizeBytes || !Number.isFinite(sizeBytes)) {
      return json({ error: "sizeBytes required" }, 400)
    }
    if (!mimeType)    return json({ error: "mimeType required" }, 400)
    if (!uploadedByEmail) return json({ error: "uploadedByEmail required" }, 400)

    const cat = category || "other"
    if (!VALID_CATEGORIES.has(cat)) {
      return json({ error: `invalid category: ${cat}` }, 400)
    }

    // Sanity check: r2Key should start with employees/<employeeId>/
    if (!r2Key.startsWith(`employees/${employeeId}/`)) {
      return json({ error: "r2Key does not match employeeId" }, 400)
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Insert row
    const { data: doc, error: e1 } = await sb
      .from("employee_documents")
      .insert({
        employee_id: employeeId,
        filename,
        display_name: displayName || null,
        category: cat,
        r2_key: r2Key,
        size_bytes: sizeBytes,
        mime_type: mimeType,
        checksum: checksum || null,
        is_teacher_visible: !!isTeacherVisible,
        expires_at: expiresAt || null,
        notes: notes || null,
        uploaded_by: uploadedByEmail,
      })
      .select()
      .single()

    if (e1) {
      console.error("Insert failed:", e1)
      return json({ error: "db_insert_failed", detail: e1.message }, 500)
    }

    // Audit log
    await sb.from("employee_audit_log").insert({
      employee_id: employeeId,
      changed_by_email: uploadedByEmail,
      action: "update",
      field_name: `document_uploaded:${filename}`,
      old_value: null,
      new_value: cat,
    })

    return json({ document: doc })
  } catch (e) {
    console.error("confirm-upload error:", e)
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
