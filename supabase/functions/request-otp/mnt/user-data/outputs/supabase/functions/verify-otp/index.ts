// POST /functions/v1/verify-otp   body: { "phone": "...", "code": "123456" }
//
// Verifies the OTP, resolves the caller's Firebase UID, and returns a custom
// token. The client then calls signInWithCustomToken(token).
//
// Deploy with verify_jwt = false — callers are not yet authenticated.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { hashOtp } from "../_shared/otp.ts";
import { getUidByEmail, mintCustomToken } from "../_shared/firebase.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPERADMIN_PHONE = Deno.env.get("SUPERADMIN_PHONE") ?? "";
const SUPERADMIN_UID = Deno.env.get("SUPERADMIN_UID") ?? "";

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return json({ ok: true }, 200, origin);
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }

  try {
    const { phone, code } = await req.json().catch(() => ({}));
    if (!phone || typeof phone !== "string") {
      return json({ error: "Phone number is required." }, 400, origin);
    }
    const submitted = String(code ?? "").trim();
    if (!/^\d{6}$/.test(submitted)) {
      return json({ error: "Enter the 6-digit OTP." }, 400, origin);
    }

    // 1. Load the pending OTP record.
    const { data: rec, error: recErr } = await supabase
      .from("otp_requests")
      .select("otp_hash, expires_at, attempts")
      .eq("phone", phone)
      .maybeSingle();
    if (recErr) throw recErr;
    if (!rec?.otp_hash) {
      return json(
        { error: "No active OTP. Please request a new one." },
        400,
        origin,
      );
    }

    // 2. Expiry.
    if (new Date(rec.expires_at).getTime() < Date.now()) {
      return json(
        { error: "This OTP has expired. Please request a new one." },
        400,
        origin,
      );
    }

    // 3. Attempt cap.
    if ((rec.attempts ?? 0) >= MAX_ATTEMPTS) {
      await supabase.from("otp_requests").update({ otp_hash: null }).eq(
        "phone",
        phone,
      );
      return json(
        { error: "Too many incorrect attempts. Please request a new OTP." },
        429,
        origin,
      );
    }

    // 4. Compare.
    const candidate = await hashOtp(submitted);
    if (candidate !== rec.otp_hash) {
      await supabase
        .from("otp_requests")
        .update({ attempts: (rec.attempts ?? 0) + 1 })
        .eq("phone", phone);
      return json({ error: "Incorrect OTP." }, 401, origin);
    }

    // 5. Resolve the Firebase UID.
    let uid: string | null = null;
    if (SUPERADMIN_PHONE !== "" && phone === SUPERADMIN_PHONE) {
      uid = SUPERADMIN_UID || null;
    } else {
      const { data: emp, error: empErr } = await supabase
        .from("employees") //  <-- CONFIRM table name
        .select("email")
        .eq("mobile", phone) //  <-- CONFIRM phone column name
        .maybeSingle();
      if (empErr) throw empErr;
      if (emp?.email) {
        // employees.email MUST be the exact email used for Google sign-in.
        uid = await getUidByEmail(emp.email);
      }
    }
    if (!uid) {
      return json(
        { error: "Could not match your account. Please use Google sign-in." },
        404,
        origin,
      );
    }

    // 6. Mint the custom token.
    const customToken = await mintCustomToken(uid);

    // 7. Consume the OTP so it cannot be reused.
    await supabase
      .from("otp_requests")
      .update({ otp_hash: null, consumed_at: new Date().toISOString() })
      .eq("phone", phone);

    return json({ ok: true, customToken }, 200, origin);
  } catch (e) {
    console.error("verify-otp error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500, origin);
  }
});
