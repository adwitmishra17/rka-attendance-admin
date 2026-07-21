// POST /functions/v1/verify-otp   body: { "phone": "...", "code": "123456" }
//
// Verifies the OTP, resolves the caller's identity, and returns a Firebase
// custom token. The client then calls signInWithCustomToken(token).
//
// Identity resolution (in order):
//   1. Super admin        — env SUPERADMIN_PHONE → SUPERADMIN_UID.
//   2. Firestore `admins` — phone-field match (phone-only admins). Email-
//      keyed docs resolve to that email's Firebase user (created on the
//      fly if missing); email-less docs sign in as UID = the admins docId,
//      which the apps and firestore.rules recognise directly.
//   3. HRMS `employees`   — last-10-digit phone match → row's email →
//      Firebase user (created on the fly if missing).
//
// { "phone": "...", "dryRun": true } skips the OTP check and reports how
// the phone WOULD resolve ({ resolves, uid_source }) with no side effects
// (no user creation, no token, nothing consumed). Wiring verification only.
//
// Deploy with --no-verify-jwt — callers are not yet authenticated.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { hashOtp } from "../_shared/otp.ts";
import {
  createUserWithEmail,
  getUidByEmail,
  mintCustomToken,
} from "../_shared/firebase.ts";
import {
  findAdminByPhone,
  findEmployeeByPhone,
  phoneForms,
} from "../_shared/identity.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPERADMIN_PHONE = Deno.env.get("SUPERADMIN_PHONE") ?? "";
const SUPERADMIN_UID = Deno.env.get("SUPERADMIN_UID") ?? "";

const MAX_ATTEMPTS = 5;

interface Resolution {
  via: "superadmin" | "admins" | "employees";
  /** Existing Firebase uid, when one already exists. */
  uid: string | null;
  /** Email to create a Firebase user for when uid is null. */
  createEmail: string | null;
  /** Fixed uid to sign in with when there is no email at all. */
  fixedUid: string | null;
}

async function resolveIdentity(
  canonical: string,
  last10: string,
): Promise<Resolution | null> {
  if (
    SUPERADMIN_PHONE && SUPERADMIN_UID &&
    phoneForms(SUPERADMIN_PHONE)?.last10 === last10
  ) {
    return { via: "superadmin", uid: SUPERADMIN_UID, createEmail: null, fixedUid: null };
  }

  const admin = await findAdminByPhone(canonical);
  if (admin?.isActive) {
    if (admin.email) {
      const uid = await getUidByEmail(admin.email);
      return { via: "admins", uid, createEmail: uid ? null : admin.email, fixedUid: null };
    }
    // Email-less admin doc: the docId itself becomes the Firebase UID.
    // signInWithCustomToken auto-creates the user on first login, and the
    // apps + firestore.rules resolve admins/{uid} directly.
    return { via: "admins", uid: null, createEmail: null, fixedUid: admin.docId };
  }

  const emp = await findEmployeeByPhone(supabase, last10);
  if (emp?.email) {
    const email = emp.email.toLowerCase();
    const uid = await getUidByEmail(email);
    return { via: "employees", uid, createEmail: uid ? null : email, fixedUid: null };
  }
  return null;
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
    const { phone, code, dryRun } = await req.json().catch(() => ({}));
    if (!phone || typeof phone !== "string") {
      return json({ error: "Phone number is required." }, 400, origin);
    }
    const forms = phoneForms(phone);
    if (!forms) {
      return json({ error: "Enter a valid 10-digit mobile number." }, 400, origin);
    }
    const { canonical, last10 } = forms;

    if (dryRun === true) {
      const res = await resolveIdentity(canonical, last10);
      return json({
        ok: true,
        dry_run: true,
        resolves: res?.via ?? null,
        uid_source: res
          ? (res.uid ? "existing_user" : res.createEmail ? "will_create_by_email" : "docid_uid")
          : null,
      }, 200, origin);
    }

    const submitted = String(code ?? "").trim();
    if (!/^\d{6}$/.test(submitted)) {
      return json({ error: "Enter the 6-digit OTP." }, 400, origin);
    }

    // 1. Load the pending OTP record.
    const { data: rec, error: recErr } = await supabase
      .from("otp_requests")
      .select("otp_hash, expires_at, attempts")
      .eq("phone", canonical)
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
        canonical,
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
        .eq("phone", canonical);
      return json({ error: "Incorrect OTP." }, 401, origin);
    }

    // 5. Resolve the Firebase identity.
    const res = await resolveIdentity(canonical, last10);
    let uid = res?.uid ?? null;
    if (!uid && res?.createEmail) uid = await createUserWithEmail(res.createEmail);
    if (!uid && res?.fixedUid) uid = res.fixedUid;
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
      .eq("phone", canonical);

    return json({ ok: true, customToken }, 200, origin);
  } catch (e) {
    console.error("verify-otp error:", e);
    return json({ error: "Something went wrong. Please try again." }, 500, origin);
  }
});
