// POST /functions/v1/request-otp   body: { "phone": "<as stored in employees>" }
//
// Validates the number belongs to a staff member (or the super admin),
// rate-limits, generates a 6-digit OTP, stores its hash, and sends the SMS
// through bulksmsindia using the DLT-registered template.
//
// Deploy with verify_jwt = false — callers are not yet authenticated.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { generateOtp, hashOtp, toSmsNumber } from "../_shared/otp.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BULKSMS_API_KEY = Deno.env.get("BULKSMS_API_KEY") ?? "";
const BULKSMS_SENDER_ID = Deno.env.get("BULKSMS_SENDER_ID") ?? "RKACAD";
const BULKSMS_PEID = Deno.env.get("BULKSMS_PEID") ?? "";
const BULKSMS_TEMPLATE_ID = Deno.env.get("BULKSMS_TEMPLATE_ID") ?? "";
const SUPERADMIN_PHONE = Deno.env.get("SUPERADMIN_PHONE") ?? "";

// --- tunables ---
const OTP_TTL_MIN = 10; // must match the "valid for 10 minutes" template text
const COOLDOWN_SEC = 60; // minimum gap between two OTPs to the same number
const MAX_SENDS_PER_HOUR = 3;

// --- DLT-registered template. Must match the registration character-for-character.
// {#numeric#} is the only variable; everything else is fixed.
function buildMessage(otp: string): string {
  return `Hi! Your one-time login OTP is ${otp}, valid for 10 minutes. Do not share with anyone. RKACAD`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return json({ ok: true }, 200, origin);
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }

  try {
    const { phone } = await req.json().catch(() => ({}));
    if (!phone || typeof phone !== "string") {
      return json({ error: "Phone number is required." }, 400, origin);
    }

    // 1. Confirm the number belongs to a staff member (or the super admin).
    const isSuperAdmin = SUPERADMIN_PHONE !== "" && phone === SUPERADMIN_PHONE;
    if (!isSuperAdmin) {
      const { data: emp, error: empErr } = await supabase
        .from("employees") //  <-- CONFIRM table name
        .select("email")
        .eq("mobile", phone) //  <-- CONFIRM phone column name
        .maybeSingle();
      if (empErr) throw empErr;
      if (!emp?.email) {
        return json(
          {
            error:
              "This mobile number isn't on file. Please use Google sign-in.",
          },
          404,
          origin,
        );
      }
    }

    const now = new Date();

    // 2. Rate limiting (per phone): rolling 1-hour window + send cooldown.
    const { data: existing } = await supabase
      .from("otp_requests")
      .select("send_count, window_start, last_sent_at")
      .eq("phone", phone)
      .maybeSingle();

    let sendCount = 0;
    let windowStart = now;

    if (existing) {
      const winAge = now.getTime() - new Date(existing.window_start).getTime();
      if (winAge < 60 * 60 * 1000) {
        windowStart = new Date(existing.window_start);
        sendCount = existing.send_count ?? 0;
        if (sendCount >= MAX_SENDS_PER_HOUR) {
          return json(
            { error: "Too many OTP requests. Please try again in a while." },
            429,
            origin,
          );
        }
      }
      if (existing.last_sent_at) {
        const sinceLast = now.getTime() -
          new Date(existing.last_sent_at).getTime();
        if (sinceLast < COOLDOWN_SEC * 1000) {
          const wait = Math.ceil((COOLDOWN_SEC * 1000 - sinceLast) / 1000);
          return json(
            { error: `Please wait ${wait}s before requesting another OTP.` },
            429,
            origin,
          );
        }
      }
    }

    // 3. Generate + persist the OTP (hash only).
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MIN * 60 * 1000);

    const { error: upsertErr } = await supabase.from("otp_requests").upsert(
      {
        phone,
        otp_hash: otpHash,
        expires_at: expiresAt.toISOString(),
        attempts: 0,
        send_count: sendCount + 1,
        window_start: windowStart.toISOString(),
        last_sent_at: now.toISOString(),
        consumed_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "phone" },
    );
    if (upsertErr) throw upsertErr;

    // 4. Send via bulksmsindia (POST/JSON endpoint).
    const smsRes = await fetch(
      "https://bulksmsindia.app/V2/http-api-post.php",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apikey: BULKSMS_API_KEY,
          senderid: BULKSMS_SENDER_ID,
          number: toSmsNumber(phone),
          message: buildMessage(otp),
          peid: BULKSMS_PEID,
          templateid: BULKSMS_TEMPLATE_ID,
          format: "json",
        }),
      },
    );
    const smsJson = await smsRes.json().catch(() => null);

    if (!smsJson || smsJson.status !== "OK") {
      // Roll back the stored OTP so the user can retry cleanly.
      await supabase.from("otp_requests").update({ otp_hash: null }).eq(
        "phone",
        phone,
      );
      console.error("bulksms send failed:", smsJson);
      return json(
        { error: "Could not send the OTP right now. Please try again." },
        502,
        origin,
      );
    }

    return json({ ok: true, message: "OTP sent." }, 200, origin);
  } catch (e) {
    console.error("request-otp error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500, origin);
  }
});
