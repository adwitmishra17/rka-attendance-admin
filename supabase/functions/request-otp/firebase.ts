// Firebase Admin helpers implemented with raw JWTs (via `jose`) so they run
// cleanly on Deno without the heavy `firebase-admin` npm package.
//
// Two operations are needed:
//   1. getUidByEmail() — resolve a Firebase UID from an email (admin lookup).
//   2. mintCustomToken() — issue a custom token the client signs in with.
//
// Both use the Firebase service account key. Store its three fields as
// Supabase secrets: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.

import { importPKCS8, SignJWT } from "npm:jose@5";

const PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
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

/**
 * Exchange a signed service-account JWT for a Google OAuth2 access token.
 * Used to authorise the admin Identity Toolkit lookup call.
 */
async function getAccessToken(): Promise<string> {
  const key = await privateKey();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    // If the lookup ever returns 403, broaden this to
    // "https://www.googleapis.com/auth/cloud-platform".
    scope: "https://www.googleapis.com/auth/identitytoolkit",
  })
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
  const token = await getAccessToken();
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
