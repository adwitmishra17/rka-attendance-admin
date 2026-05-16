// =========================================================================
// backfill_firestore_teachers.js
//
// One-time script. Walks every employee in HRMS where department.name =
// 'Teachers', and for each one upserts the synced identity fields into
// the rka-academic-tracker Firestore `teachers` collection.
//
// Idempotent: re-running is safe. Existing tracker docs are matched by
// the mapping JSON saved during the original tracker→HRMS migration
// (`tracker_to_hrms_id.json`). After this runs, every Firestore teacher
// doc has hrmsEmployeeId set, which is the lookup key the live sync
// function uses thereafter.
//
// Usage:
//   node backfill_firestore_teachers.js --dry-run
//   node backfill_firestore_teachers.js
//
// Required env (in .env.local next to this script, or actual env):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   FIREBASE_SERVICE_ACCOUNT_PATH    path to the service account JSON
//   TRACKER_TO_HRMS_MAPPING_PATH     path to tracker_to_hrms_id.json
//   TEACHER_DEPT_NAME                default 'Teachers'
// =========================================================================

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, ".env.local") });

const DRY_RUN = process.argv.includes("--dry-run");
const TEACHER_DEPT_NAME = process.env.TEACHER_DEPT_NAME || "Teachers";

// ---------- init ---------------------------------------------------------

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const serviceAccount = JSON.parse(
  readFileSync(resolve(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT_PATH), "utf8"),
);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Mapping: tracker doc id -> hrms employee uuid
let trackerToHrms = {};
try {
  trackerToHrms = JSON.parse(
    readFileSync(resolve(__dirname, process.env.TRACKER_TO_HRMS_MAPPING_PATH), "utf8"),
  );
  console.log(`Loaded ${Object.keys(trackerToHrms).length} mappings from ${process.env.TRACKER_TO_HRMS_MAPPING_PATH}`);
} catch (e) {
  console.warn(`No mapping file loaded (${e.message}). New teachers will create fresh docs.`);
}
// Reverse: hrms uuid -> tracker doc id
const hrmsToTracker = Object.fromEntries(
  Object.entries(trackerToHrms).map(([trackerId, hrmsId]) => [hrmsId, trackerId]),
);

// ---------- main --------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN — no writes will be made" : "✏️  LIVE RUN — writing to Firestore");
  console.log("");

  // 1. Resolve Teachers dept_id
  const { data: dept, error: deptErr } = await supabase
    .from("departments")
    .select("id")
    .eq("name", TEACHER_DEPT_NAME)
    .maybeSingle();
  if (deptErr || !dept) {
    throw new Error(`Could not find department '${TEACHER_DEPT_NAME}': ${deptErr?.message ?? "no row"}`);
  }
  const teachersDeptId = dept.id;

  // 2. Pull all teacher employees
  const { data: employees, error: empErr } = await supabase
    .from("employees")
    .select("id, full_name, email, personal_email, phone, is_active, branch_codes, department_id")
    .eq("department_id", teachersDeptId);
  if (empErr) throw empErr;

  console.log(`Found ${employees.length} teachers in HRMS.`);
  console.log("");

  // 3. For each, locate or create the Firestore doc
  let created = 0;
  let updatedExisting = 0;
  let stampedHrmsId = 0;
  let failed = 0;
  const failures = [];

  for (const emp of employees) {
    try {
      const fields = {
        hrmsEmployeeId: emp.id,
        fullName: emp.full_name ?? "",
        email: emp.email ?? "",
        personalEmail: emp.personal_email ?? "",
        phone: emp.phone ?? "",
        isActive: emp.is_active,
        branchCodes: emp.branch_codes ?? [],
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Resolution order:
      //   a) doc whose hrmsEmployeeId already matches (idempotent re-run)
      //   b) doc whose ID matches the tracker side of the mapping JSON
      //   c) doc whose email or personalEmail matches (last-ditch)
      //   d) create fresh
      let docRef = null;

      const byHrms = await db
        .collection("teachers")
        .where("hrmsEmployeeId", "==", emp.id)
        .limit(1)
        .get();
      if (!byHrms.empty) {
        docRef = byHrms.docs[0].ref;
      }

      if (!docRef && hrmsToTracker[emp.id]) {
        const trackerDocId = hrmsToTracker[emp.id];
        const candidate = await db.collection("teachers").doc(trackerDocId).get();
        if (candidate.exists) {
          docRef = candidate.ref;
          stampedHrmsId++;
        }
      }

      if (!docRef && emp.personal_email) {
        const byPersonal = await db
          .collection("teachers")
          .where("personalEmail", "==", emp.personal_email)
          .limit(1)
          .get();
        if (!byPersonal.empty) docRef = byPersonal.docs[0].ref;
      }

      if (!docRef && emp.email) {
        const bySchool = await db
          .collection("teachers")
          .where("email", "==", emp.email)
          .limit(1)
          .get();
        if (!bySchool.empty) docRef = bySchool.docs[0].ref;
      }

      if (docRef) {
        if (DRY_RUN) {
          console.log(`  WOULD UPDATE  ${emp.full_name} (${emp.id})  -> ${docRef.path}`);
        } else {
          await docRef.set(fields, { merge: true });
        }
        updatedExisting++;
      } else {
        const newDoc = {
          ...fields,
          subjectsTaught: [],
          classesAssigned: [],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (DRY_RUN) {
          console.log(`  WOULD CREATE  ${emp.full_name} (${emp.id})  -> teachers/<new>`);
        } else {
          await db.collection("teachers").add(newDoc);
        }
        created++;
      }
    } catch (e) {
      failed++;
      failures.push({ employee: emp.full_name, hrmsId: emp.id, error: e.message });
      console.error(`  FAILED  ${emp.full_name}: ${e.message}`);
    }
  }

  console.log("");
  console.log("─────── Summary ───────");
  console.log(`Updated existing tracker docs : ${updatedExisting}`);
  console.log(`  (of which stamped via map)  : ${stampedHrmsId}`);
  console.log(`Created new tracker docs      : ${created}`);
  console.log(`Failed                        : ${failed}`);
  if (failures.length) {
    console.log("");
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f.employee} (${f.hrmsId}): ${f.error}`);
  }
  console.log("");
  console.log(DRY_RUN ? "Run again without --dry-run to apply." : "Backfill complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
