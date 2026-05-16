// =========================================================================
// Edge Function: presign-my-document-download
//
// Generates a short-lived signed R2 download URL for ONE specific document,
// but only if that document belongs to the signed-in teacher.
//
// Mirror of the admin's presign-download function, with these differences:
//   - Auth via Firebase ID token (not admin shared secret)
//   - Verifies document.employee_id matches the caller's employee_id
//     (this is the critical security check — without it, any teacher could
//     download any document by guessing IDs)
//   - Logs to employee_audit_log with action='self_view_document' so admin
//     can see who viewed their own files
// =========================================================================

import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.17";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface FirebaseTokenPayload {
  email?: string;
  email_verified?: boolean;
}

async function verifyFirebaseToken(token: string): Promise<FirebaseTokenPayload> {
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  return payload as FirebaseTokenPayload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    // 1. Verify Firebase token
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "missing_token" }, 401);
    }
    const token = authHeader.slice(7).trim();

    let payload: FirebaseTokenPayload;
    try {
      payload = await verifyFirebaseToken(token);
    } catch (err) {
      console.warn("Firebase token verification failed:", err);
      return jsonResponse({ error: "invalid_token" }, 401);
    }

    const email = payload.email?.toLowerCase().trim();
    if (!email || !payload.email_verified) {
      return jsonResponse({ error: "email_not_verified" }, 401);
    }

    // 2. Parse body
    let body: { documentId?: number };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "bad_json" }, 400);
    }
    const documentId = body?.documentId;
    if (!documentId || !Number.isFinite(documentId)) {
      return jsonResponse({ error: "documentId required (number)" }, 400);
    }

    // 3. Look up employee by personal_email
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: emp, error: empErr } = await sb
      .from("employees")
      .select("id, is_active")
      .eq("personal_email", email)
      .maybeSingle();

    if (empErr) {
      console.error("employees lookup error:", empErr);
      return jsonResponse({ error: "db_error", message: empErr.message }, 500);
    }
    if (!emp) {
      return jsonResponse({ error: "no_linked_employee" }, 404);
    }
    if (!emp.is_active) {
      return jsonResponse({ error: "inactive_employee" }, 403);
    }

    // 4. Look up the document
    const { data: doc, error: docErr } = await sb
      .from("employee_documents")
      .select("id, employee_id, filename, r2_key, mime_type, deleted_at")
      .eq("id", documentId)
      .single();

    if (docErr || !doc) {
      return jsonResponse({ error: "document not found" }, 404);
    }
    if (doc.deleted_at) {
      return jsonResponse({ error: "document was deleted" }, 410);
    }

    // 5. CRITICAL SECURITY CHECK: document must belong to this employee.
    //    Without this, any teacher could download any document by guessing IDs.
    if (doc.employee_id !== emp.id) {
      console.warn(
        `Cross-employee document access blocked: email=${email}, ` +
        `caller_emp_id=${emp.id}, doc_emp_id=${doc.employee_id}, doc_id=${doc.id}`,
      );
      // Return 404 (not 403) to avoid leaking the existence of other employees' docs
      return jsonResponse({ error: "document not found" }, 404);
    }

    // 6. Sign R2 GET URL (mirror of admin presign-download).
    //    aws4fetch's signQuery puts X-Amz-Signature in the URL query string.
    //    Adding X-Amz-Expires sets the validity window.
    const aws = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    });

    const url =
      `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${doc.r2_key}` +
      `?X-Amz-Expires=300`;
    const signed = await aws.sign(
      new Request(url, { method: "GET" }),
      { aws: { signQuery: true } },
    );

    // 7. Audit log — distinguish from admin downloads with action='self_view_document'
    await sb.from("employee_audit_log").insert({
      employee_id: doc.employee_id,
      changed_by_email: email,
      action: "self_view_document",
      field_name: `document:${doc.filename}`,
      old_value: null,
      new_value: null,
    });

    return jsonResponse({
      downloadUrl: signed.url,
      filename: doc.filename,
      mimeType: doc.mime_type,
      expiresIn: 300,
    });
  } catch (err) {
    console.error("Unhandled error in presign-my-document-download:", err);
    return jsonResponse({ error: "internal_error", message: String(err) }, 500);
  }
});
