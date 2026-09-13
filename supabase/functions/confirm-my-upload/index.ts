// ============================================================================
// confirm-my-upload
//
// Teacher self-service companion to presign-my-document-upload. After the PWA
// PUTs the file to R2, it calls this to register the row in employee_documents.
// Auth = teacher's Firebase ID token; the row is always scoped to the teacher's
// own employee_id, category is derived from the fixed slot, and the doc is
// marked teacher-visible (their own upload) + uploaded_via='teacher'.
//
// Re-uploading the same slot soft-deletes the previous row for that slot so a
// teacher always has one current file per required document.
// ============================================================================

// @ts-nocheck — Deno runtime
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

// The 7 teacher onboarding slots → HRMS category + display name.
const SLOTS = {
  class_10:         { category: "education", label: "Class 10 Marksheet" },
  class_12:         { category: "education", label: "Class 12 Marksheet" },
  graduation:       { category: "education", label: "Graduation — Final-Year Marksheet / Degree" },
  post_graduation:  { category: "education", label: "Post-Graduation — Final-Year Marksheet / Degree" },
  bed:              { category: "education", label: "B.Ed — Final-Year Marksheet / Degree" },
  aadhaar:          { category: "id_proof", label: "Aadhaar Card" },
  pan:              { category: "id_proof", label: "PAN Card" },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
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

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: emp, error: empErr } = await sb
      .from("employees").select("id, is_active, documents_locked").eq("personal_email", email).maybeSingle();
    if (empErr) return json({ error: "db_error", detail: empErr.message }, 500);
    if (!emp) return json({ error: "no_linked_employee", email }, 404);
    if (!emp.is_active) return json({ error: "inactive_employee" }, 403);
    if (emp.documents_locked) return json({ error: "documents_locked", message: "Your documents were locked by the office." }, 423);

    const { r2Key, filename, docType, sizeBytes, mimeType, checksum } = (await req.json()) || {};
    const slot = SLOTS[docType];
    if (!slot) return json({ error: `invalid docType: ${docType}` }, 400);
    if (!r2Key || !filename || !mimeType || !Number.isFinite(sizeBytes)) return json({ error: "missing fields" }, 400);
    // Enforce the key belongs to THIS teacher — presign issued it under their id.
    if (!String(r2Key).startsWith(`employees/${emp.id}/`)) return json({ error: "r2Key does not match employee" }, 400);

    // One current file per slot: soft-delete any prior row for this slot.
    await sb.from("employee_documents")
      .update({ deleted_at: new Date().toISOString(), deleted_by: email })
      .eq("employee_id", emp.id).eq("doc_type", docType).is("deleted_at", null);

    const { data: doc, error: insErr } = await sb.from("employee_documents").insert({
      employee_id: emp.id,
      filename,
      display_name: slot.label,
      category: slot.category,
      doc_type: docType,
      r2_key: r2Key,
      size_bytes: sizeBytes,
      mime_type: mimeType,
      checksum: checksum || null,
      is_teacher_visible: true,
      uploaded_by: email,
      uploaded_via: "teacher",
    }).select().single();
    if (insErr) return json({ error: "db_insert_failed", detail: insErr.message }, 500);

    await sb.from("employee_audit_log").insert({
      employee_id: emp.id,
      changed_by_email: email,
      action: "update",
      field_name: `document_uploaded:${slot.label}`,
      old_value: null,
      new_value: docType,
    });

    return json({ document: doc });
  } catch (e) {
    console.error("confirm-my-upload error:", e);
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500);
  }
});
