// POST /functions/v1/hrms-claims
//
// Keeps a Firebase user's HRMS custom claims in sync with the Firestore
// `admins` collection. HRMS talks to Supabase with the admin's Firebase ID
// token (Supabase Third-Party Auth → Firebase), and RLS reads these claims:
//     role = 'authenticated', hrms_level, hrms_branches
// (migration 030). No claims → the token gets nothing from the HRMS tables.
//
//   {}                                  sync the CALLER (HRMS calls this at login)
//   { targetEmail } | { targetUid }     super admin only: re-sync another
//                                       admin after editing/deactivating them
//
// When access is REMOVED, the user's refresh tokens are revoked too, so a
// stale session can't keep minting tokens.
//
// Auth: x-firebase-token = caller's Firebase ID token. Deploy --no-verify-jwt
// is NOT needed (HRMS sends the anon key in Authorization).

import { json } from "../_shared/cors.ts";
import { getGoogleAccessToken, getUidByEmail, PROJECT_ID } from "../_shared/firebase.ts";
import {
  resolveHrmsAccess,
  SUPER_ADMIN_EMAIL,
  verifyFirebaseIdToken,
} from "../_shared/hrmsAdmin.ts";

const HRMS_KEYS = ["hrms_level", "hrms_branches"];

async function lookupUser(uid: string) {
  const token = await getGoogleAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  if (!res.ok) throw new Error(`accounts:lookup failed: ${await res.text()}`);
  return (await res.json()).users?.[0] ?? null;
}

async function updateUser(uid: string, patch: Record<string, unknown>) {
  const token = await getGoogleAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: uid, ...patch }),
    },
  );
  if (!res.ok) throw new Error(`accounts:update failed: ${await res.text()}`);
}

async function syncClaims(uid: string, email: string | null) {
  const user = await lookupUser(uid);
  if (!user) return { level: null, branches: [], changed: false, missing: true };
  const userEmail = email ?? (user.email ? String(user.email).toLowerCase() : null);
  const access = await resolveHrmsAccess(uid, userEmail);

  let current: Record<string, unknown> = {};
  try { current = user.customAttributes ? JSON.parse(user.customAttributes) : {}; } catch { /* reset */ }
  const next: Record<string, unknown> = { ...current };
  const hadAccess = !!current.hrms_level;
  if (access) {
    next.role = "authenticated";
    next.hrms_level = access.level;
    next.hrms_branches = access.branches;
  } else {
    for (const k of HRMS_KEYS) delete next[k];
    if (next.role === "authenticated") delete next.role;
  }
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) {
    const patch: Record<string, unknown> = { customAttributes: JSON.stringify(next) };
    // Access removed → revoke existing sessions (tokens issued before now).
    if (hadAccess && !access) patch.validSince = String(Math.floor(Date.now() / 1000));
    await updateUser(uid, patch);
  }
  return { level: access?.level ?? null, branches: access?.branches ?? [], changed };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  try {
    const caller = await verifyFirebaseIdToken(
      (req.headers.get("x-firebase-token") || "").trim(),
    );
    if (!caller) return json({ error: "unauthorized" }, 401, origin);

    const body = await req.json().catch(() => ({}));
    const targetEmail = typeof body?.targetEmail === "string" ? body.targetEmail.trim().toLowerCase() : "";
    const targetUid = typeof body?.targetUid === "string" ? body.targetUid.trim() : "";

    if (targetEmail || targetUid) {
      if (caller.email !== SUPER_ADMIN_EMAIL) return json({ error: "forbidden" }, 403, origin);
      const uid = targetUid || (await getUidByEmail(targetEmail));
      if (!uid) return json({ ok: true, missing: true }, 200, origin); // never signed in yet
      return json({ ok: true, ...(await syncClaims(uid, targetEmail || null)) }, 200, origin);
    }
    return json({ ok: true, ...(await syncClaims(caller.uid, caller.email)) }, 200, origin);
  } catch (e) {
    console.error("hrms-claims error:", e);
    return json({ error: "Something went wrong." }, 500, origin);
  }
});
