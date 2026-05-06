// ============================================================================
// hik-punch
//
// Receives access-control events pushed by Hikvision DS-K1T320EFWX (and
// compatible terminals) via their built-in HTTP Listening Server.
// Filters down to successful authentications, looks up the matching employee
// by `biometric_code`, derives in/out, and writes to `attendance_events`.
//
// Designed to be the only thing standing between a fingerprint scan and the
// HRMS dashboard — no local sync agent, no port forwarding, no cloud pStor.
//
// Auth options (function accepts either):
//   1. `?token=<secret>` query string — preferred for the device, since
//      Hikvision firmwares vary in whether they send Basic Auth properly.
//   2. HTTP Basic Auth — preferred for curl/manual testing. Username can be
//      anything; password = HIK_SHARED_SECRET (falls back to ADMIN_SHARED_SECRET).
//
// Idempotency: dedupe key is (kiosk_device_id, device_event_id). Webhook
//              retries from the device for the same serialNo are silently
//              merged via upsert.
//
// Branch: derived from the matched employee's branch_codes[0]. If unmatched,
//         falls back to ?branch=MAIN|CITY query parameter on the URL we
//         configure on the device. Default 'MAIN'.
// ============================================================================

// @ts-nocheck — Deno runtime, types resolved at deploy time
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

// ----- env -----------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HIK_SECRET   = Deno.env.get("HIK_SHARED_SECRET") || Deno.env.get("ADMIN_SHARED_SECRET")

// ----- CORS (mostly for manual curl testing from a browser) ---------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Hikvision "minor" event codes that mean "successful authentication".
// We log these to attendance_events. Everything else (failed auths, door
// alarms, tamper, device online/offline pings) is acknowledged but skipped.
// 75 covers the common multi-method authenticated success on K1Tx terminals.
// 38 = legacy successful auth on older firmware. Add more if observed.
const SUCCESS_MINOR_CODES = new Set([75, 38])

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  // -------- 1. Auth -------------------------------------------------------
  // Try URL query token first (most reliable for the device), then Basic Auth
  // header (for curl tests). Either matching HIK_SHARED_SECRET grants access.
  if (!HIK_SECRET) {
    console.error("HIK_SHARED_SECRET not configured")
    return json({ error: "server_misconfigured" }, 500)
  }

  const url = new URL(req.url)
  const queryToken = url.searchParams.get("token") || ""

  const authHeader = req.headers.get("authorization") || ""
  let basicPassword = ""
  if (authHeader.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = atob(authHeader.slice(6).trim())
      basicPassword = decoded.split(":").slice(1).join(":")  // password may contain ':'
    } catch {
      // bad base64 — ignore, fall through to other auth options
    }
  }

  const providedSecret = queryToken || basicPassword
  if (!providedSecret || providedSecret !== HIK_SECRET) {
    // Log what the device IS sending so we can diagnose persistent 401s.
    // Don't log the full Authorization header (it may contain credentials);
    // log just its scheme/length so we can tell Basic vs Digest vs missing.
    const authScheme = authHeader.split(" ")[0] || "(none)"
    const authLen = authHeader.length
    console.log(
      "auth_failed:",
      "scheme=", JSON.stringify(authScheme),
      "header_len=", authLen,
      "query_token_present=", !!queryToken,
    )
    return json({ error: "unauthorized" }, 401)
  }

  // -------- 2. Parse body -------------------------------------------------
  // Hikvision sends multipart/form-data with one JSON part named "event_log"
  // (or sometimes the whole body is JSON if linkage is configured that way).
  const contentType = req.headers.get("content-type") || ""
  let payload: any = null
  try {
    if (contentType.toLowerCase().includes("multipart")) {
      const form = await req.formData()
      // The JSON part is usually labelled "event_log"; some firmwares use
      // "Picture" or unnamed parts. Walk the entries and pick the first that
      // parses as JSON.
      for (const [, value] of form.entries()) {
        let text = ""
        if (typeof value === "string") text = value
        else if (value instanceof File) {
          if (value.type.includes("json") || value.size < 100_000) {
            text = await value.text()
          } else continue  // probably a snapshot image, skip
        }
        try { payload = JSON.parse(text); break } catch { /* try next */ }
      }
    } else if (contentType.toLowerCase().includes("json")) {
      payload = await req.json()
    } else {
      // Last-ditch: read as text and try to JSON.parse
      const text = await req.text()
      try { payload = JSON.parse(text) } catch { /* leave null */ }
    }
  } catch (e) {
    console.error("body parse failed:", e)
    return json({ error: "parse_failed" }, 400)
  }

  if (!payload) {
    return json({ skipped: "no_json_in_body" }, 200)  // 200 so device doesn't retry forever
  }

  // -------- 3. Filter to access-control success events --------------------
  // Top-level shape: { eventType: "AccessControllerEvent", AccessControllerEvent: { ... }, dateTime, macAddress }
  if (payload.eventType !== "AccessControllerEvent") {
    return json({ skipped: "not_access_event", eventType: payload.eventType }, 200)
  }
  const ace = payload.AccessControllerEvent || {}
  const minor = Number(ace.minor || ace.subEventType || 0)
  if (!SUCCESS_MINOR_CODES.has(minor)) {
    return json({ skipped: "not_success_event", minor }, 200)
  }
  const employeeNoString = ace.employeeNoString || (ace.employeeNo ? String(ace.employeeNo) : "")
  if (!employeeNoString) {
    return json({ skipped: "no_employee_id_on_event" }, 200)
  }
  const dateTime = payload.dateTime || ace.time
  if (!dateTime) {
    return json({ skipped: "no_timestamp" }, 200)
  }

  // -------- 4. Branch resolution + employee lookup ------------------------
  const branchFromQuery = (url.searchParams.get("branch") || "MAIN").toUpperCase()

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, branch_codes")
    .eq("biometric_code", employeeNoString)
    .maybeSingle()

  if (empErr) {
    console.error("employee lookup error:", empErr)
    // Don't 500 — let the event log itself with employee_id=null so we can
    // see unmatched punches and clean them up later.
  }

  const employeeId = emp?.id ?? null
  // Branch precedence: matched employee → URL query param → 'MAIN'
  const branchCode = (emp?.branch_codes && emp.branch_codes[0]) || branchFromQuery

  // -------- 5. Derive event_type (in / out) ------------------------------
  // Hikvision sends attendanceStatus = "checkIn" | "checkOut" | "undefined".
  // On the value-series DS-K1T320EFWX without an explicit IN/OUT button,
  // it's almost always "undefined". Fall back to alternation: query the
  // employee's most recent event today, flip from there. First-of-day is "in".
  let eventType: "in" | "out"
  const attStatus = String(ace.attendanceStatus || "").toLowerCase()
  if (attStatus === "checkin") eventType = "in"
  else if (attStatus === "checkout") eventType = "out"
  else if (employeeId) {
    const dayStart = isoDayStart(dateTime)
    const { data: prevList } = await supabase
      .from("attendance_events")
      .select("event_type")
      .eq("employee_id", employeeId)
      .gte("event_time", dayStart)
      .lt("event_time", isoDayEnd(dateTime))
      .order("event_time", { ascending: false })
      .limit(1)
    const prev = prevList && prevList[0]
    eventType = prev?.event_type === "in" ? "out" : "in"
  } else {
    // No employee match → can't alternate. Default 'in'; admin will reconcile.
    eventType = "in"
  }

  // -------- 6. Build dedupe key ------------------------------------------
  // Hikvision serialNo is a per-device monotonic counter, perfect for idempotency.
  // Compose with kiosk_device_id (MAC) so two devices' serialNos can't collide.
  const deviceEventId = String(ace.serialNo || `${dateTime}-${employeeNoString}`)
  const kioskDeviceId =
    payload.macAddress ||
    payload.MACAddr ||
    ace.MACAddr ||
    ace.deviceName ||
    `hik-${branchCode.toLowerCase()}`

  // -------- 7. Insert (upsert on dedupe key) -----------------------------
  const { error: insertErr } = await supabase
    .from("attendance_events")
    .upsert({
      employee_id: employeeId,
      event_time: dateTime,
      event_type: eventType,
      identification_method: "fingerprint",
      face_confidence: null,
      face_snapshot_url: null,
      kiosk_device_id: kioskDeviceId,
      synced_from_offline: false,
      branch_code: branchCode,
      device_event_id: deviceEventId,
    }, { onConflict: "kiosk_device_id,device_event_id", ignoreDuplicates: false })

  if (insertErr) {
    console.error("insert error:", insertErr)
    // Return 500 so the device retries — DB transient errors are usually
    // recoverable, and unique-index violations come back as success via upsert.
    return json({ error: "db_error", detail: insertErr.message }, 500)
  }

  return json({
    ok: true,
    employee_matched: !!employeeId,
    event_type: eventType,
    branch_code: branchCode,
    device_event_id: deviceEventId,
  })
})

// ----- helpers -------------------------------------------------------------

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// "2026-05-05T10:30:00+05:30" → "2026-05-05T00:00:00+05:30"
// We preserve the timezone from the device's timestamp so day boundaries
// match the device's local clock (Asia/Kolkata after we configure it).
function isoDayStart(iso: string): string {
  const tzMatch = iso.match(/([+-]\d\d:?\d\d|Z)$/)
  const tz = tzMatch ? tzMatch[0] : "Z"
  const datePart = iso.slice(0, 10)
  return `${datePart}T00:00:00${tz}`
}

function isoDayEnd(iso: string): string {
  const tzMatch = iso.match(/([+-]\d\d:?\d\d|Z)$/)
  const tz = tzMatch ? tzMatch[0] : "Z"
  const datePart = iso.slice(0, 10)
  return `${datePart}T23:59:59.999${tz}`
}
