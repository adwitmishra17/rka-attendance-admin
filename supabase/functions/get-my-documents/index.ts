// =========================================================================
// Edge Function: get-my-documents
//
// Lists employee documents for the signed-in teacher's own record.
//
// Auth flow (same as get-my-attendance):
//   - PWA sends Firebase ID token in Authorization: Bearer ...
//   - We verify the token against Google's JWKS for project rka-academic-tracker
//   - We look up the employee by personal_email (the Gmail teachers sign in with)
//   - We return that employee's documents from employee_documents
//
// We never accept a documentId here — listing is bulk. The companion
// presign-my-document-download function handles per-document signed URLs.
// =========================================================================

import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  name?: string;
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

  try {
    // 1. Verify Firebase token (same pattern as get-my-attendance)
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(
        { error: "missing_token", message: "Authorization: Bearer <token> required." },
        401,
      );
    }
    const token = authHeader.slice(7).trim();

    let payload: FirebaseTokenPayload;
    try {
      payload = await verifyFirebaseToken(token);
    } catch (err) {
      console.warn("Firebase token verification failed:", err);
      return jsonResponse(
        { error: "invalid_token", message: "Sign-in token is invalid or expired." },
        401,
      );
    }

    const email = payload.email?.toLowerCase().trim();
    if (!email || !payload.email_verified) {
      return jsonResponse(
        { error: "email_not_verified", message: "Your Google email is not verified." },
        401,
      );
    }

    // 2. Look up employee by personal_email
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, full_name, is_active")
      .eq("personal_email", email)
      .maybeSingle();

    if (empErr) {
      console.error("employees lookup error:", empErr);
      return jsonResponse({ error: "db_error", message: empErr.message }, 500);
    }

    if (!emp) {
      return jsonResponse(
        {
          error: "no_linked_employee",
          message:
            "Your Gmail isn't linked to an HRMS record yet. Please ask the admin to set " +
            email + " as your personal email in HRMS.",
          email,
        },
        404,
      );
    }

    if (!emp.is_active) {
      return jsonResponse(
        {
          error: "inactive_employee",
          message: "Your HRMS record is marked inactive. Please contact admin.",
        },
        403,
      );
    }

    // 3. Fetch documents
    //    Policy A: return ALL non-deleted documents for this employee.
    //    Newest first.
    //
    //    The DB column is `uploaded_at`. We alias it to `created_at` in the
    //    response to match what the PWA expects, so the frontend doesn't need
    //    to change.
    const { data: docs, error: docsErr } = await supabase
      .from("employee_documents")
      .select("id, filename, mime_type, created_at:uploaded_at")
      .eq("employee_id", emp.id)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });

    if (docsErr) {
      console.error("employee_documents query error:", docsErr);
      return jsonResponse({ error: "db_error", message: docsErr.message }, 500);
    }

    return jsonResponse({
      employee: { id: emp.id, name: emp.full_name },
      documents: docs ?? [],
    });
  } catch (err) {
    console.error("Unhandled error in get-my-documents:", err);
    return jsonResponse({ error: "internal_error", message: String(err) }, 500);
  }
});
