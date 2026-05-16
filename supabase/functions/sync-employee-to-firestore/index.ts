// =========================================================================
// Edge Function: sync-employee-to-firestore
//
// Triggered by a Supabase Database Webhook on the `employees` table for
// INSERT / UPDATE / DELETE events. For rows that represent teachers
// (department.name = 'Teachers'), it writes a synced subset of fields
// to the rka-academic-tracker Firestore `teachers` collection.
//
// Field ownership:
//   HRMS owns identity:  fullName, email, personalEmail, phone, isActive,
//                        branchCodes, hrmsEmployeeId
//   Tracker owns academic: subjectsTaught, classesAssigned
//
// Sync only writes the HRMS-owned fields. The tracker-owned fields are
// preserved on update (we do a partial document update, not a full set).
//
// Lookup key: `hrmsEmployeeId` field on each Firestore doc, equal to the
// Supabase employees.id UUID. We don't use the Supabase UUID as the
// Firestore doc ID because existing tracker docs already have their own
// IDs that are referenced by lessonPlans/tests/etc., and rewriting those
// FKs is more invasive than this query-by-field approach.
//
// Required env vars (`supabase secrets set`):
//   FIREBASE_SERVICE_ACCOUNT_JSON   the entire JSON file as a string
//   TEACHER_DEPT_NAME               default 'Teachers' — only set if the
//                                   department row uses a different name
//   WEBHOOK_SECRET                  shared secret in the webhook header
//                                   (X-Webhook-Secret) so random callers
//                                   can't poke this endpoint
//   SUPABASE_URL                    auto-injected
//   SUPABASE_SERVICE_ROLE_KEY       auto-injected
// =========================================================================

import { importPKCS8, SignJWT } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ---------- env / constants ---------------------------------------------

const SERVICE_ACCOUNT = JSON.parse(
  Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "{}",
);
const FIREBASE_PROJECT_ID = SERVICE_ACCOUNT.project_id;
const TEACHER_DEPT_NAME = Deno.env.get("TEACHER_DEPT_NAME") ?? "Teachers";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!FIREBASE_PROJECT_ID) {
  console.error(
    "FIREBASE_SERVICE_ACCOUNT_JSON env var missing or malformed — aborting.",
  );
}

// ---------- Firebase access token (cached) -------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(SERVICE_ACCOUNT.private_key, "RS256");

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/datastore",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(SERVICE_ACCOUNT.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to mint Google access token: ${res.status} ${text}`);
  }
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000, // 5 min safety
  };
  return data.access_token;
}

// ---------- Firestore helpers (REST API, no Admin SDK) -------------------

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/** Convert a JS object into Firestore REST `fields` map. */
function toFirestoreFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFirestoreValue(v);
  }
  return out;
}

function toFirestoreValue(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: toFirestoreFields(v as Record<string, unknown>) } };
  }
  return { stringValue: String(v) };
}

/** Find a teacher doc by hrmsEmployeeId. Returns the doc name or null. */
async function findTeacherDocName(hrmsEmployeeId: string): Promise<string | null> {
  const token = await getFirebaseAccessToken();
  const res = await fetch(`${FS_BASE}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "teachers" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "hrmsEmployeeId" },
            op: "EQUAL",
            value: { stringValue: hrmsEmployeeId },
          },
        },
        limit: 1,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`runQuery failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  for (const item of json) {
    if (item.document?.name) return item.document.name as string;
  }
  return null;
}

/**
 * Patch a doc by name with the given identity fields. updateMask ensures
 * only the listed fields are touched — subjectsTaught / classesAssigned
 * are preserved.
 */
async function patchDoc(docName: string, fields: Record<string, unknown>) {
  const token = await getFirebaseAccessToken();
  const updateMask = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join("&");
  const url = `https://firestore.googleapis.com/v1/${docName}?${updateMask}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    throw new Error(`patchDoc failed: ${res.status} ${await res.text()}`);
  }
}

/** Create a new doc in `teachers` with auto-generated ID. Returns the doc name. */
async function createTeacherDoc(fields: Record<string, unknown>): Promise<string> {
  const token = await getFirebaseAccessToken();
  const res = await fetch(`${FS_BASE}/teachers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    throw new Error(`createTeacherDoc failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.name as string;
}

// ---------- userBranches collection helpers ------------------------------
//
// `userBranches/{email}` is a lookup collection used by Firestore security
// rules to determine which branches a signed-in teacher can access.
// Teacher docs are keyed by hrmsEmployeeId, not email, so rules cannot do
// `get(/databases/.../teachers/$(token.email))` to look up branchCodes
// directly. This collection bridges that gap: keyed by lowercase email,
// stores { branchCodes, teacherId, role, updatedAt }.
//
// Maintenance: every teacher upsert here also writes userBranches entries
// for the school email and (if different) the personal email. On
// soft-delete or email change, stale entries are removed so deactivated
// teachers can't authenticate.

/** Lowercase + trim. Returns '' for null/undefined. */
function cleanEmail(s: string | null | undefined): string {
  return (s ?? "").toString().toLowerCase().trim();
}

/** Collect all login emails for an employee row (school + personal, deduped). */
function collectEmails(row: EmployeeRow | null): string[] {
  if (!row) return [];
  const result = new Set<string>();
  const school = cleanEmail(row.email);
  const personal = cleanEmail(row.personal_email);
  if (school) result.add(school);
  if (personal) result.add(personal);
  return Array.from(result);
}

/** Upsert a userBranches doc keyed by email. Overwrites the full document. */
async function setUserBranchesDoc(
  email: string,
  branchCodes: string[],
  teacherId: string,
) {
  const cleaned = cleanEmail(email);
  if (!cleaned) return;
  const token = await getFirebaseAccessToken();
  // Email may contain '@' and '.' — both are valid Firestore doc IDs but
  // need URL encoding in the REST path.
  const docPath = `userBranches/${encodeURIComponent(cleaned)}`;
  const url = `${FS_BASE}/${docPath}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: toFirestoreFields({
        branchCodes: branchCodes && branchCodes.length > 0 ? branchCodes : ["MAIN"],
        teacherId,
        role: "teacher",
        updatedAt: new Date(),
      }),
    }),
  });
  if (!res.ok) {
    throw new Error(`setUserBranchesDoc(${cleaned}) failed: ${res.status} ${await res.text()}`);
  }
}

/** Delete a userBranches doc. 404 (already gone) is treated as success. */
async function deleteUserBranchesDoc(email: string) {
  const cleaned = cleanEmail(email);
  if (!cleaned) return;
  const token = await getFirebaseAccessToken();
  const docPath = `userBranches/${encodeURIComponent(cleaned)}`;
  const url = `${FS_BASE}/${docPath}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404 means the doc didn't exist — fine, idempotent
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteUserBranchesDoc(${cleaned}) failed: ${res.status} ${await res.text()}`);
  }
}

/** Extract the doc ID from a full Firestore doc name. */
function extractDocId(docName: string): string {
  return docName.split("/").pop() ?? "";
}

// ---------- Mapping employee row -> Firestore identity fields ------------

interface EmployeeRow {
  id: string;
  full_name: string;
  email: string | null;
  personal_email: string | null;
  phone: string | null;
  is_active: boolean;
  branch_codes: string[] | null;
  department_id: string | null;
}

function mapToFirestoreFields(row: EmployeeRow): Record<string, unknown> {
  return {
    hrmsEmployeeId: row.id,
    fullName: row.full_name ?? "",
    email: row.email ?? "",
    personalEmail: row.personal_email ?? "",
    phone: row.phone ?? "",
    isActive: row.is_active,
    branchCodes: row.branch_codes ?? [],
    syncedAt: new Date(),
  };
}

// ---------- Cached Teachers dept_id --------------------------------------

let cachedTeachersDeptId: string | null | undefined; // undefined = not looked up

async function getTeachersDeptId(supabase: ReturnType<typeof createClient>) {
  if (cachedTeachersDeptId !== undefined) return cachedTeachersDeptId;
  const { data, error } = await supabase
    .from("departments")
    .select("id")
    .eq("name", TEACHER_DEPT_NAME)
    .maybeSingle();
  if (error) {
    console.error("departments lookup error:", error);
    cachedTeachersDeptId = null;
    return null;
  }
  cachedTeachersDeptId = data?.id ?? null;
  if (!cachedTeachersDeptId) {
    console.warn(`No department row found with name='${TEACHER_DEPT_NAME}'`);
  }
  return cachedTeachersDeptId;
}

// ---------- Core sync logic ----------------------------------------------

/** Decide what to do with an employee given old + new state. */
async function handleEmployee(
  supabase: ReturnType<typeof createClient>,
  newRow: EmployeeRow | null,
  oldRow: EmployeeRow | null,
  eventType: "INSERT" | "UPDATE" | "DELETE",
) {
  const teachersDeptId = await getTeachersDeptId(supabase);
  if (!teachersDeptId) {
    return { skipped: true, reason: "Teachers dept not configured" };
  }

  const wasTeacher = oldRow?.department_id === teachersDeptId;
  const isTeacher = newRow?.department_id === teachersDeptId;
  const hrmsId = (newRow ?? oldRow)?.id;
  if (!hrmsId) return { skipped: true, reason: "No id" };

  // DELETE path, or moved out of Teachers dept → soft-delete in Firestore
  if (eventType === "DELETE" || (wasTeacher && !isTeacher)) {
    const docName = await findTeacherDocName(hrmsId);
    if (!docName) return { skipped: true, reason: "no Firestore doc to soft-delete" };
    await patchDoc(docName, {
      isActive: false,
      hrmsEmployeeId: hrmsId,
      syncedAt: new Date(),
    });
    // Lock out from rules: delete userBranches entries for both old emails.
    // We use oldRow because newRow may be null (DELETE) or no longer in Teachers (move-out).
    const oldEmails = collectEmails(oldRow);
    for (const e of oldEmails) {
      await deleteUserBranchesDoc(e);
    }
    return { action: "soft-deleted", lockedOut: oldEmails };
  }

  // Not a teacher and never was — nothing to do
  if (!isTeacher) return { skipped: true, reason: "not a teacher" };

  // At this point newRow is a teacher (or just became one). Upsert.
  const docName = await findTeacherDocName(hrmsId);
  const fields = mapToFirestoreFields(newRow!);
  let teacherDocName: string;
  let action: "updated" | "created";
  if (docName) {
    await patchDoc(docName, fields);
    teacherDocName = docName;
    action = "updated";
  } else {
    // First time we've seen this teacher — create with empty academic
    // arrays so tracker UI renders cleanly until subjects are assigned.
    teacherDocName = await createTeacherDoc({
      ...fields,
      subjectsTaught: [],
      classesAssigned: [],
      createdAt: new Date(),
    });
    action = "created";
  }

  // Sync userBranches: delete entries for emails removed since last sync,
  // upsert entries for current emails. This keeps the lookup collection
  // (used by Firestore rules) consistent with the teacher's current email
  // and branchCodes.
  const teacherId = extractDocId(teacherDocName);
  const newEmails = collectEmails(newRow);
  // For UPDATEs the previous record is in oldRow; if oldRow was a teacher we
  // already had userBranches entries for its emails. If it wasn't (just
  // promoted into Teachers dept), there were none, but deleteUserBranchesDoc
  // is idempotent so trying to delete is harmless.
  const oldEmails = wasTeacher ? collectEmails(oldRow) : [];
  const staleEmails = oldEmails.filter((e) => !newEmails.includes(e));

  for (const e of staleEmails) {
    await deleteUserBranchesDoc(e);
  }
  const branchCodes = newRow!.branch_codes && newRow!.branch_codes.length > 0
    ? newRow!.branch_codes
    : ["MAIN"];
  for (const e of newEmails) {
    await setUserBranchesDoc(e, branchCodes, teacherId);
  }

  return {
    action,
    docName: teacherDocName,
    userBranches: { upserted: newEmails, deleted: staleEmails },
  };
}

// ---------- HTTP entrypoint ----------------------------------------------

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: EmployeeRow | null;
  old_record: EmployeeRow | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Shared-secret check — without this, the function URL is a public
  // write to Firestore.
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get("x-webhook-secret") ?? "";
    if (provided !== WEBHOOK_SECRET) {
      console.warn("Webhook secret mismatch");
      return new Response("Forbidden", { status: 403 });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (payload.table !== "employees") {
    return new Response(JSON.stringify({ skipped: "wrong table" }), {
      status: 200,
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const result = await handleEmployee(
      supabase,
      payload.record,
      payload.old_record,
      payload.type,
    );
    console.log("sync result:", payload.type, result);
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sync error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
