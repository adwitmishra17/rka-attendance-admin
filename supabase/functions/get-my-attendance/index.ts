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
      .select("id, full_name, biometric_code, branch_codes, is_active, department_id, custom_in_time, custom_out_time, custom_grace_minutes")
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

    // 5. Per-day summary rows for the same window — attendance_daily carries
    //    the RESOLVED expected reporting time snapshotted per day
    //    (custom → department → branch, by recompute_attendance_daily),
    //    plus late/early minutes and holiday flags.
    const fromDay = fromDate.toISOString().slice(0, 10);
    const toDay = toDate.toISOString().slice(0, 10);
    const { data: daily, error: dailyErr } = await supabase
      .from("attendance_daily")
      .select("date, in_time, out_time, expected_in_time, expected_out_time, grace_minutes, late_minutes, early_leave_minutes, status, is_holiday, branch_code")
      .eq("employee_id", emp.id)
      .gte("date", fromDay)
      .lte("date", toDay)
      .order("date", { ascending: true });
    if (dailyErr) {
      console.error("attendance_daily query error:", dailyErr);
      // daily summary is an enrichment — events alone still render a page
    }

    // 6. The employee's reporting time AS CONFIGURED TODAY, resolved with the
    //    same precedence recompute_attendance_daily uses:
    //    department override_custom → dept wins; else custom → dept → branch.
    let reporting: Record<string, unknown> | null = null;
    try {
      const homeBranch = (emp.branch_codes ?? [])[0] ?? null;
      const [{ data: rtc }, { data: dtc }] = await Promise.all([
        homeBranch
          ? supabase.from("reporting_time_config")
              .select("default_in_time, default_out_time, default_grace_minutes")
              .eq("branch_code", homeBranch).maybeSingle()
          : Promise.resolve({ data: null }),
        homeBranch && emp.department_id
          ? supabase.from("reporting_time_department_config")
              .select("in_time, out_time, grace_minutes, override_custom")
              .eq("branch_code", homeBranch).eq("department_id", emp.department_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const deptWins = Boolean(dtc?.override_custom);
      reporting = {
        in_time: deptWins
          ? (dtc?.in_time ?? rtc?.default_in_time ?? null)
          : (emp.custom_in_time ?? dtc?.in_time ?? rtc?.default_in_time ?? null),
        out_time: deptWins
          ? (dtc?.out_time ?? rtc?.default_out_time ?? null)
          : (emp.custom_out_time ?? dtc?.out_time ?? rtc?.default_out_time ?? null),
        grace_minutes: deptWins
          ? (dtc?.grace_minutes ?? rtc?.default_grace_minutes ?? null)
          : (emp.custom_grace_minutes ?? dtc?.grace_minutes ?? rtc?.default_grace_minutes ?? null),
        source: deptWins ? "department" : (emp.custom_in_time ? "custom" : (dtc?.in_time ? "department" : "branch")),
        branch_code: homeBranch,
      };
    } catch (e) {
      console.warn("reporting-time resolve failed:", e);
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
      daily: daily ?? [],
      reporting,
    });
  } catch (err) {
    console.error("Unhandled error in get-my-attendance:", err);
    return jsonResponse({ error: "internal_error", message: String(err) }, 500);
  }
});
