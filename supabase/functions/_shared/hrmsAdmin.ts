// Verify that a request comes from a signed-in, ACTIVE HRMS admin.
//
// Replaces the x-admin-secret check on the document / fleet functions: that
// secret was baked into the public HRMS bundle, so it authenticated nobody.
// The HRMS client sends the signed-in user's Firebase ID token in the
// `x-firebase-token` header (Authorization carries the Supabase anon key for
// the gateway). We verify it against Google's JWKS and then apply the same
// rules as the HRMS App.jsx gate:
//   * the hardcoded super admin email, or
//   * admins/{email} or admins/{uid} (phone-login admins), with
//     isActive !== false and an HRMS level (moduleRoles.hrms, or legacy
//     modules[] containing 'hrms').

import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { getGoogleAccessToken, PROJECT_ID } from "./firebase.ts";

export const SUPER_ADMIN_EMAIL = "adwit@rkacademyballia.in";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

export interface HrmsAdmin {
  uid: string;
  email: string | null;
  level: string; // 'super_admin' | 'admin' | 'receptionist' | …
}

// deno-lint-ignore no-explicit-any
async function getAdminDoc(id: string): Promise<Record<string, any> | null> {
  const token = await getGoogleAccessToken(
    "https://www.googleapis.com/auth/datastore",
  );
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/${
      encodeURIComponent(id)
    }`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`admins get failed: ${await res.text()}`);
  return (await res.json())?.fields ?? {};
}

export interface HrmsAccess {
  level: string; // 'super_admin' | 'admin' | 'receptionist'
  branches: string[];
}

const BRANCH_CODES = ["MAIN", "CITY"];

/** HRMS access for a Firebase identity, from the admins collection — the same
 *  rules as HRMS App.jsx (active doc, per-platform level with legacy
 *  modules[] fallback, branchCodes[] → branchCode → MAIN). null = no access. */
export async function resolveHrmsAccess(
  uid: string,
  email: string | null,
): Promise<HrmsAccess | null> {
  if (email === SUPER_ADMIN_EMAIL) {
    return { level: "super_admin", branches: [...BRANCH_CODES] };
  }
  const fields = (email ? await getAdminDoc(email) : null) ??
    (uid ? await getAdminDoc(uid) : null);
  if (!fields) return null;
  if (fields.isActive?.booleanValue === false) return null;

  const mr = fields.moduleRoles?.mapValue?.fields;
  let level: string | null = null;
  if (mr) {
    level = mr.hrms?.stringValue || null;
  } else {
    const modules: string[] = (fields.modules?.arrayValue?.values ?? [])
      .map((v: { stringValue?: string }) => v.stringValue)
      .filter(Boolean);
    if (modules.includes("hrms")) {
      level = fields.role?.stringValue === "receptionist" ? "receptionist" : "admin";
    }
  }
  if (!level) return null;

  const arr: string[] = (fields.branchCodes?.arrayValue?.values ?? [])
    .map((v: { stringValue?: string }) => v.stringValue)
    .filter((c: string | undefined) => !!c && BRANCH_CODES.includes(c));
  const single = fields.branchCode?.stringValue;
  const branches = arr.length > 0
    ? arr
    : (single && BRANCH_CODES.includes(single) ? [single] : ["MAIN"]);
  return { level, branches };
}

/** Verify a Firebase ID token; returns { uid, email } or null. */
export async function verifyFirebaseIdToken(
  token: string,
): Promise<{ uid: string; email: string | null } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    const uid = String(payload.sub || "");
    if (!uid) return null;
    const email = (payload.email as string | undefined)?.toLowerCase().trim() || null;
    return { uid, email };
  } catch {
    return null;
  }
}

/** Returns the verified admin, or null when the caller isn't one. */
export async function verifyHrmsAdmin(req: Request): Promise<HrmsAdmin | null> {
  const who = await verifyFirebaseIdToken(
    (req.headers.get("x-firebase-token") || "").trim(),
  );
  if (!who) return null;
  const access = await resolveHrmsAccess(who.uid, who.email);
  if (!access) return null;
  return { uid: who.uid, email: who.email, level: access.level };
}
