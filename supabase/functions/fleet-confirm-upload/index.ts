// ============================================================================
// fleet-confirm-upload
//
// Called after R2 PUT succeeds. Inserts a row into either vehicle_documents
// or driver_documents (depending on ownerType), and writes a fleet_audit_log
// entry.
//
// For "replace" semantics, the client soft-deletes the existing row of the
// same (vehicle_id|employee_id, doc_type) BEFORE calling this function. The
// uq_*_doc_type_active partial unique index would otherwise reject the
// insert with a duplicate-key error.
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

const VEHICLE_DOC_TYPES = new Set(["RC", "Insurance", "PUC", "Permit", "Fitness"])
const DRIVER_DOC_TYPES  = new Set(["DL", "Aadhaar"])

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
      ownerType,        // 'vehicle' | 'driver'
      ownerId,          // vehicleId or employeeId
      r2Key,
      filename,
      displayName,
      docType,          // 'RC' | 'Insurance' | 'PUC' | 'Permit' | 'Fitness' | 'DL' | 'Aadhaar'
      documentNumber,
      issueDate,
      expiresAt,
      issuingAuthority,
      notes,
      sizeBytes,
      mimeType,
      checksum,
      uploadedByEmail,
    } = body || {}

    // ---- Validate ----
    if (ownerType !== "vehicle" && ownerType !== "driver") {
      return json({ error: "ownerType must be 'vehicle' or 'driver'" }, 400)
    }
    if (!ownerId)        return json({ error: "ownerId required" }, 400)
    if (!r2Key)          return json({ error: "r2Key required" }, 400)
    if (!filename)       return json({ error: "filename required" }, 400)
    if (!docType)        return json({ error: "docType required" }, 400)
    if (!sizeBytes || !Number.isFinite(sizeBytes)) {
      return json({ error: "sizeBytes required" }, 400)
    }
    if (!mimeType)       return json({ error: "mimeType required" }, 400)
    if (!uploadedByEmail) return json({ error: "uploadedByEmail required" }, 400)

    // doc_type must match ownerType's allowed set
    const allowedSet = ownerType === "vehicle" ? VEHICLE_DOC_TYPES : DRIVER_DOC_TYPES
    if (!allowedSet.has(docType)) {
      return json({ error: `docType '${docType}' not valid for ownerType '${ownerType}'` }, 400)
    }

    // Sanity check the R2 key prefix
    const expectedPrefix = ownerType === "vehicle"
      ? `vehicles/${ownerId}/`
      : `drivers/${ownerId}/`
    if (!r2Key.startsWith(expectedPrefix)) {
      return json({ error: `r2Key does not match expected prefix ${expectedPrefix}` }, 400)
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ---- Insert into the right table ----
    const tableName = ownerType === "vehicle" ? "vehicle_documents" : "driver_documents"
    const ownerColumn = ownerType === "vehicle" ? "vehicle_id" : "employee_id"

    const insertPayload: Record<string, any> = {
      [ownerColumn]: ownerId,
      doc_type: docType,
      filename,
      display_name: displayName || null,
      r2_key: r2Key,
      size_bytes: sizeBytes,
      mime_type: mimeType,
      checksum: checksum || null,
      document_number: documentNumber || null,
      issue_date: issueDate || null,
      expires_at: expiresAt || null,
      issuing_authority: issuingAuthority || null,
      notes: notes || null,
      uploaded_by: uploadedByEmail,
    }

    const { data: doc, error: e1 } = await sb
      .from(tableName)
      .insert(insertPayload)
      .select()
      .single()

    if (e1) {
      console.error("Insert failed:", e1)
      // Surface duplicate-key error nicely
      if (e1.code === "23505") {
        return json({
          error: "duplicate_active_document",
          detail: `An active ${docType} document already exists. Delete the existing one first, then replace.`,
        }, 409)
      }
      return json({ error: "db_insert_failed", detail: e1.message }, 500)
    }

    // ---- Audit log ----
    await sb.from("fleet_audit_log").insert({
      entity_type: ownerType === "vehicle" ? "vehicle_document" : "driver_document",
      entity_id: doc.id,
      changed_by_email: uploadedByEmail,
      action: "create",
      field_name: `${docType}:${filename}`,
      old_value: null,
      new_value: docType,
    })

    return json({ document: doc })
  } catch (e) {
    console.error("fleet-confirm-upload error:", e)
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500)
  }
})

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
