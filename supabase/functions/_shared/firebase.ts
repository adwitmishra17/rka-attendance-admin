// Firebase Admin helpers implemented with raw JWTs (via `jose`) so they run
// cleanly on Deno without the heavy `firebase-admin` npm package.
//
// Operations:
//   1. getUidByEmail()      — resolve a Firebase UID from an email.
//   2. createUserWithEmail()— admin-create a Firebase user for an email
//                             (staff/admins who never did a Google sign-in).
//   3. mintCustomToken()    — issue a custom token the client signs in with.
//   4. getGoogleAccessToken(scope) — SA-signed OAuth token; also used with
//                             the datastore scope to read the Firestore
//                             `admins` directory (phone-only admin login).
//
// Service-account fields live as Supabase secrets:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

import { importPKCS8, SignJWT } from "npm:jose@5";

export const PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
const CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL") ?? "";
// The private key in the service-account JSON contains literal "\n" sequences
// when pasted into an env var — convert them back to real newlines.
const PRIVATE_KEY = (Deno.env.get("FIREBASE_PRIVATE_KEY") ?? "").replace(
  /\\n/g,
  "\n",
);

const CUSTOM_TOKEN_AUDIENCE =
  "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

async function privateKey() {
  if (!PRIVATE_KEY || !CLIENT_EMAIL || !PROJECT_ID) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY",
    );
  }
  return await importPKCS8(PRIVATE_KEY, "RS256");
}

/** Exchange a signed service-account JWT for a Google OAuth2 access token. */
export async function getGoogleAccessToken(
  scope = "https://www.googleapis.com/auth/identitytoolkit",
): Promise<string> {
  const key = await privateKey();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(CLIENT_EMAIL)
    .setSubject(CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

/** Resolve a Firebase Auth UID from an email address. Returns null if none. */
export async function getUidByEmail(email: string): Promise<string | null> {
  const token = await getGoogleAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: [email] }),
    },
  );
  if (!res.ok) {
    throw new Error(`accounts:lookup failed: ${await res.text()}`);
  }
  const data = await res.json();
  return data.users?.[0]?.localId ?? null;
}

/**
 * Admin-create a Firebase Auth user for an email (no password — they sign in
 * via custom token / Google). Lets OTP work for staff and admins who have
 * never done a Google sign-in. Returns the new UID.
 */
export async function createUserWithEmail(email: string): Promise<string> {
  const token = await getGoogleAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, emailVerified: false }),
    },
  );
  if (!res.ok) {
    throw new Error(`accounts create failed: ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.localId) throw new Error("accounts create returned no localId");
  return data.localId as string;
}

/** Mint a Firebase custom token for a UID. The client calls signInWithCustomToken(). */
export async function mintCustomToken(uid: string): Promise<string> {
  const key = await privateKey();
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ uid })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(CLIENT_EMAIL)
    .setSubject(CLIENT_EMAIL)
    .setAudience(CUSTOM_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600) // custom tokens may live at most 1 hour
    .sign(key);
}
