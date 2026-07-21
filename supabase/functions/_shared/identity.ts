// Phone → identity resolution shared by request-otp and verify-otp.
//
// A login phone may belong to:
//   1. the hardcoded super admin (env SUPERADMIN_PHONE), or
//   2. a Firestore `admins` doc (phone-only admins — matched on the doc's
//      Phone/phone field, the same pattern SMS auth-sync uses), or
//   3. an HRMS `employees` row (staff with email identity).
//
// Admins take precedence over employees so that an admin who also has a
// staff record still resolves to their admin identity (and to a stable
// UID — the admins docId — instead of an email-derived one).
//
// Phone matching is format-proof: both sides normalise to the LAST 10
// DIGITS, so "+91XXXXXXXXXX", "XXXXXXXXXX" and "0XXXXXXXXXX" all match.

import { getGoogleAccessToken, PROJECT_ID } from "./firebase.ts";

export interface PhoneForms {
  canonical: string; // +91XXXXXXXXXX — storage/rate-limit key
  last10: string;
}

/** Normalise any raw input to Indian mobile forms; null if not 10 digits. */
export function phoneForms(raw: string): PhoneForms | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return null;
  return { canonical: `+91${last10}`, last10 };
}

export interface AdminMatch {
  docId: string;
  fields: Record<string, unknown>;
  isActive: boolean;
  /** email field, else the docId when it is an email-keyed doc. */
  email: string | null;
}

// deno-lint-ignore no-explicit-any
const fsStr = (f: any): string | null => f?.stringValue ?? null;
// deno-lint-ignore no-explicit-any
const fsBool = (f: any): boolean => f?.booleanValue === true;

/**
 * Look up a Firestore `admins` doc by its phone field. Tries the `Phone`
 * and `phone` field spellings (both exist in historical data), matching
 * the canonical +91 form the HRMS admin UI stores.
 */
export async function findAdminByPhone(
  canonical: string,
): Promise<AdminMatch | null> {
  const token = await getGoogleAccessToken(
    "https://www.googleapis.com/auth/datastore",
  );
  for (const fieldPath of ["Phone", "phone"]) {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "admins" }],
            where: {
              fieldFilter: {
                field: { fieldPath },
                op: "EQUAL",
                value: { stringValue: canonical },
              },
            },
            limit: 1,
          },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`admins runQuery failed: ${await res.text()}`);
    }
    const rows = await res.json();
    const doc = Array.isArray(rows)
      ? rows.find((r) => r?.document)?.document
      : null;
    if (doc) {
      const docId = String(doc.name).split("/").pop()!;
      // deno-lint-ignore no-explicit-any
      const fields = (doc as any).fields ?? {};
      const email = fsStr(fields.email) ??
        (docId.includes("@") ? docId.toLowerCase() : null);
      return { docId, fields, isActive: fsBool(fields.isActive), email };
    }
  }
  return null;
}

export interface EmployeeMatch {
  email: string | null;
  full_name: string | null;
}

/**
 * Look up an active HRMS employee by the last 10 digits of their work
 * phone (suffix match — format-proof). Prefers a row that has an email,
 * since OTP login ultimately needs one to mint a Firebase identity.
 */
export async function findEmployeeByPhone(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  last10: string,
): Promise<EmployeeMatch | null> {
  const { data, error } = await supabase
    .from("employees")
    .select("email, full_name, is_active")
    .like("phone", `%${last10}`)
    .eq("is_active", true)
    .limit(5);
  if (error) throw error;
  const rows = (data ?? []) as Array<
    { email: string | null; full_name: string | null }
  >;
  if (rows.length === 0) return null;
  return rows.find((r) => r.email) ?? rows[0];
}
