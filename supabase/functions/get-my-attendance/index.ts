// =========================================================================
// Edge Function: get-my-attendance  (UPDATED 2026-05-07)
//
// Changes from the first version:
//   - `staff` table     -> `employees` (HRMS naming)
//   - `linked_gmail`    -> `personal_email` (matches the column that
//                          already exists in HRMS and the tracker)
//   - `staff.id` FK     -> `employee_id` on attendance_events
//                          (verify in your DB; rename here if different)
//   - filters out inactive employees
//   - returns branch_codes so the UI can display where the punch was
//
// Auth flow unchanged: PWA presents a Firebase ID token, function verifies
// it against Google's JWKS, looks up the employee by personal_email, and
// returns that employee's attendance_events for the requested range.
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
    // 1. Verify Firebase ID token
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

    // 2. Parse range
    const url = new URL(req.url);
    const now = new Date();
    const defaultTo = new Date(now);
    defaultTo.setHours(23, 59, 59, 999);
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 29);
    defaultFrom.setHours(0, 0, 0, 0);

    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const fromDate = fromParam ? new Date(fromParam) : defaultFrom;
    const toDate = toParam ? new Date(toParam) : defaultTo;

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return jsonResponse(
        { error: "bad_range", message: "from/to must be valid ISO timestamps." },
        400,
      );
    }
    if (toDate < fromDate) {
      return jsonResponse({ error: "bad_range", message: "to must be on or after from." }, 400);
    }
    const MAX_DAYS = 90;
    const span = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
    if (span > MAX_DAYS) {
      return jsonResponse(
        { error: "range_too_large", message: `Range may not exceed ${MAX_DAYS} days.` },
        400,
      );
    }

    // 3. Look up employee by personal_email
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id, full_name, biometric_code, branch_codes, is_active")
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

    // 4. Fetch attendance events.
    //    NOTE: the FK column on attendance_events here is assumed to be
    //    `employee_id`. If it's different in your schema (e.g. `staff_id`
    //    or a biometric-code-based join), change this single line.
    const { data: events, error: eventsErr } = await supabase
      .from("attendance_events")
      .select("id, event_time, identification_method, kiosk_device_id, branch_code")
      .eq("employee_id", emp.id)
      .gte("event_time", fromDate.toISOString())
      .lte("event_time", toDate.toISOString())
      .order("event_time", { ascending: true });

    if (eventsErr) {
      console.error("attendance_events query error:", eventsErr);
      return jsonResponse({ error: "db_error", message: eventsErr.message }, 500);
    }

    return jsonResponse({
      employee: {
        id: emp.id,
        name: emp.full_name,
        biometric_code: emp.biometric_code,
        branch_codes: emp.branch_codes ?? [],
      },
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      events: events ?? [],
    });
  } catch (err) {
    console.error("Unhandled error in get-my-attendance:", err);
    return jsonResponse({ error: "internal_error", message: String(err) }, 500);
  }
});
