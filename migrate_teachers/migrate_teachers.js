// ============================================================================
// MIGRATE TEACHERS — tracker → HRMS
//
// Reads all teachers from rka-academic-tracker Firestore `teachers` collection,
// inserts each as a stub employee in HRMS Supabase `employees` table with:
//   - full_name from tracker fullName
//   - email from tracker email
//   - department_id = Teachers UUID
//   - is_active = true
//
// Idempotent: checks each email in HRMS first, skips if already present.
// Saves a mapping file (tracker_id ↔ hrms_uuid) for future Phase A use.
//
// Usage:
//   node migrate_teachers.js --dry-run    # prints what would happen, writes nothing
//   node migrate_teachers.js              # actually performs the migration
// ============================================================================

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import admin from 'firebase-admin'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local from the parent directory (rka-attendance-admin/)
dotenv.config({ path: join(__dirname, '..', '.env.local') })

// Service account JSON path. Must be absolute or relative to this script.
// You'll override this via SERVICE_ACCOUNT_PATH env var if needed.
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH ||
  join(__dirname, '..', 'secrets', 'rka-academic-tracker-firebase-adminsdk.json')

// Teachers department UUID in HRMS
const TEACHERS_DEPARTMENT_ID = '67c56fb0-3daa-432b-a3f3-f2f2c9c3546f'

// Supabase config from .env.local
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

// CLI flag
const DRY_RUN = process.argv.includes('--dry-run')

// ----------------------------------------------------------------------------
// Sanity checks
// ----------------------------------------------------------------------------

function bail(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

if (!SUPABASE_URL) bail('VITE_SUPABASE_URL not found in .env.local')
if (!SUPABASE_SERVICE_ROLE_KEY) bail('VITE_SUPABASE_SERVICE_ROLE_KEY not found in .env.local')

let serviceAccount
try {
  const raw = readFileSync(SERVICE_ACCOUNT_PATH, 'utf8')
  serviceAccount = JSON.parse(raw)
  if (!serviceAccount.project_id || !serviceAccount.private_key) {
    bail(`Service account file looks invalid (missing project_id or private_key): ${SERVICE_ACCOUNT_PATH}`)
  }
} catch (err) {
  bail(`Could not load service account JSON.\n   Path tried: ${SERVICE_ACCOUNT_PATH}\n   Error: ${err.message}\n   Set SERVICE_ACCOUNT_PATH env var or place file at the default location.`)
}

console.log('━'.repeat(70))
console.log('  Teacher Migration: tracker → HRMS')
console.log('━'.repeat(70))
console.log(`  Mode:              ${DRY_RUN ? '🔍 DRY RUN (no writes)' : '✏️  LIVE (will write)'}`)
console.log(`  Firebase project:  ${serviceAccount.project_id}`)
console.log(`  Supabase URL:      ${SUPABASE_URL}`)
console.log(`  Teachers dept ID:  ${TEACHERS_DEPARTMENT_ID}`)
console.log('━'.repeat(70))
console.log()

// ----------------------------------------------------------------------------
// Initialize clients
// ----------------------------------------------------------------------------

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})
const firestore = admin.firestore()

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ----------------------------------------------------------------------------
// Main migration logic
// ----------------------------------------------------------------------------

async function fetchTrackerTeachers() {
  console.log('📥 Reading teachers from tracker Firestore...')
  const snapshot = await firestore.collection('teachers').get()
  const teachers = []
  snapshot.forEach(doc => {
    teachers.push({
      _docId: doc.id,
      ...doc.data(),
    })
  })
  console.log(`   Found ${teachers.length} teachers`)
  console.log()
  return teachers
}

async function fetchExistingHrmsEmails() {
  console.log('📥 Reading existing HRMS employee emails...')
  const { data, error } = await supabase
    .from('employees')
    .select('id, email')
    .not('email', 'is', null)
  if (error) bail(`Supabase read failed: ${error.message}`)
  const emailMap = new Map()
  for (const row of data) {
    if (row.email) emailMap.set(row.email.toLowerCase().trim(), row.id)
  }
  console.log(`   Found ${emailMap.size} existing employees with email`)
  console.log()
  return emailMap
}

function classifyTeacher(t, existingEmails) {
  // Returns: { action: 'insert' | 'skip-no-name' | 'skip-no-email' | 'skip-exists', reason }
  const name = (t.fullName || '').trim()
  const email = (t.email || '').trim().toLowerCase()

  if (!name) return { action: 'skip-no-name', reason: 'tracker doc has no fullName' }
  if (!email) return { action: 'skip-no-email', reason: 'tracker doc has no email' }
  if (existingEmails.has(email)) {
    return { action: 'skip-exists', reason: `email already in HRMS as employee ${existingEmails.get(email)}` }
  }
  return { action: 'insert', reason: null }
}

async function insertEmployee(t) {
  const { data, error } = await supabase
    .from('employees')
    .insert({
      full_name: t.fullName.trim(),
      email: t.email.trim().toLowerCase(),
      department_id: TEACHERS_DEPARTMENT_ID,
      is_active: true,
      created_by: 'migration-script',
      updated_by: 'migration-script',
    })
    .select('id, full_name, email')
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function main() {
  const teachers = await fetchTrackerTeachers()

  if (teachers.length === 0) {
    console.log('No teachers found in tracker. Nothing to do.')
    process.exit(0)
  }

  const existingEmails = await fetchExistingHrmsEmails()

  // Plan
  const plan = teachers.map(t => ({ teacher: t, ...classifyTeacher(t, existingEmails) }))
  const toInsert = plan.filter(p => p.action === 'insert')
  const skipped = plan.filter(p => p.action !== 'insert')

  console.log('━'.repeat(70))
  console.log('  Migration Plan')
  console.log('━'.repeat(70))
  console.log(`  Total tracker teachers:   ${teachers.length}`)
  console.log(`  Will insert into HRMS:    ${toInsert.length}`)
  console.log(`  Will skip:                ${skipped.length}`)
  console.log()

  if (toInsert.length > 0) {
    console.log('  ➕ TO INSERT:')
    for (const p of toInsert) {
      console.log(`     ✓  ${p.teacher.fullName.padEnd(32)} ${p.teacher.email}`)
    }
    console.log()
  }

  if (skipped.length > 0) {
    console.log('  ⏭  TO SKIP:')
    for (const p of skipped) {
      const name = (p.teacher.fullName || '(no name)').padEnd(32)
      const tag = p.action === 'skip-exists' ? '[exists]'
                : p.action === 'skip-no-email' ? '[no email]'
                : p.action === 'skip-no-name' ? '[no name]'
                : '[?]'
      console.log(`     -  ${name} ${tag} ${p.reason}`)
    }
    console.log()
  }

  console.log('━'.repeat(70))

  if (DRY_RUN) {
    console.log()
    console.log('  🔍 DRY RUN — no changes were written.')
    console.log()
    console.log('  Review the plan above. If it looks right, run without --dry-run:')
    console.log('     node migrate_teachers.js')
    console.log()
    process.exit(0)
  }

  // Execute writes
  console.log()
  console.log('  ✏️  Writing to HRMS...')
  console.log()

  const mapping = {}  // tracker docId → hrms employee uuid
  let inserted = 0
  let failed = 0

  for (const p of toInsert) {
    try {
      const employee = await insertEmployee(p.teacher)
      mapping[p.teacher._docId] = employee.id
      console.log(`     ✓  ${employee.full_name.padEnd(32)} → ${employee.id}`)
      inserted++
    } catch (err) {
      console.log(`     ✗  ${p.teacher.fullName.padEnd(32)} FAILED: ${err.message}`)
      failed++
    }
  }

  // Save mapping file
  const mappingPath = join(__dirname, 'tracker_to_hrms_id.json')
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2))

  console.log()
  console.log('━'.repeat(70))
  console.log('  Summary')
  console.log('━'.repeat(70))
  console.log(`  Inserted:     ${inserted}`)
  console.log(`  Skipped:      ${skipped.length}`)
  console.log(`  Failed:       ${failed}`)
  console.log(`  Mapping file: ${mappingPath}`)
  console.log()

  if (failed > 0) {
    console.log('  ⚠️  Some inserts failed. Review above and address.')
    process.exit(1)
  }

  console.log('  ✓ Migration complete.')
  console.log()
  process.exit(0)
}

main().catch(err => {
  console.error()
  console.error('━'.repeat(70))
  console.error(`  ❌ Unhandled error: ${err.message}`)
  console.error('━'.repeat(70))
  console.error(err.stack)
  process.exit(1)
})
