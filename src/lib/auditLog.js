// ============================================================================
// AUDIT LOG
//
// Writes entries to employee_audit_log when:
//   1. A profile is updated (one entry per changed field)
//   2. A sensitive field is revealed (one entry per reveal)
//
// Sensitive field values are redacted in old_value/new_value to avoid
// storing full Aadhaar/PAN/account numbers in the audit log itself.
// ============================================================================

import { supabaseAdmin } from './supabase'

/**
 * Fields whose old/new values should be REDACTED in the audit log.
 * The fact that the field changed is logged, but the values are masked.
 */
const SENSITIVE_FIELDS = new Set([
  'aadhaar_number',
  'pan_number',
  'bank_account_number',
  'basic_salary',
  'hra',
  'other_allowances',
])

function redactValue(field, value) {
  if (value === null || value === undefined || value === '') return null
  if (!SENSITIVE_FIELDS.has(field)) return String(value).slice(0, 200)
  // Sensitive — show only last 4 chars
  const str = String(value)
  if (str.length <= 4) return '••••'
  return '••••' + str.slice(-4)
}

/**
 * Compute a diff between two objects.
 * Returns array of { field, oldValue, newValue } for changed fields only.
 * Skips system fields and unchanged values.
 */
const SKIP_FIELDS = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by'])

function computeDiff(oldObj, newObj) {
  const changes = []
  const keys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})])
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue
    const oldVal = oldObj?.[key]
    const newVal = newObj?.[key]
    // Normalise nulls / empty strings as equivalent
    const oldNorm = (oldVal === '' || oldVal === undefined) ? null : oldVal
    const newNorm = (newVal === '' || newVal === undefined) ? null : newVal
    // For arrays, do a JSON compare
    if (Array.isArray(oldNorm) || Array.isArray(newNorm)) {
      if (JSON.stringify(oldNorm || []) !== JSON.stringify(newNorm || [])) {
        changes.push({ field: key, oldValue: oldNorm, newValue: newNorm })
      }
      continue
    }
    if (oldNorm !== newNorm) {
      changes.push({ field: key, oldValue: oldNorm, newValue: newNorm })
    }
  }
  return changes
}

/**
 * Write update audit entries — one row per changed field.
 * Returns { ok, count, error }.
 */
export async function logProfileUpdate({ employeeId, oldEmployee, newEmployee, changedByEmail }) {
  if (!supabaseAdmin) return { ok: false, error: 'Admin client not initialised' }
  if (!employeeId || !changedByEmail) return { ok: false, error: 'Missing employeeId or email' }

  const changes = computeDiff(oldEmployee, newEmployee)
  if (changes.length === 0) return { ok: true, count: 0 }

  const rows = changes.map(c => ({
    employee_id: employeeId,
    changed_by_email: changedByEmail,
    action: 'update',
    field_name: c.field,
    old_value: redactValue(c.field, c.oldValue),
    new_value: redactValue(c.field, c.newValue),
  }))

  const { error } = await supabaseAdmin.from('employee_audit_log').insert(rows)
  if (error) {
    console.error('Audit log write failed:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, count: rows.length }
}

/**
 * Write a single audit entry for a sensitive-field reveal.
 * Called from the profile page when admin clicks "Reveal" on Aadhaar/PAN/etc.
 */
export async function logSensitiveReveal({ employeeId, fieldName, changedByEmail }) {
  if (!supabaseAdmin) return { ok: false, error: 'Admin client not initialised' }
  if (!employeeId || !fieldName || !changedByEmail) {
    return { ok: false, error: 'Missing required params' }
  }
  const { error } = await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employeeId,
    changed_by_email: changedByEmail,
    action: 'view_sensitive',
    field_name: fieldName,
    old_value: null,
    new_value: null,
  })
  if (error) {
    console.error('Reveal audit log write failed:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Convenience: log creation of a new employee record.
 * (Not used in Phase 2 — Add Employee flow lives in Employees.jsx and we'll
 *  wire this in when we touch that file. For now it's exported for completeness.)
 */
export async function logProfileCreate({ employeeId, changedByEmail }) {
  if (!supabaseAdmin) return { ok: false, error: 'Admin client not initialised' }
  const { error } = await supabaseAdmin.from('employee_audit_log').insert({
    employee_id: employeeId,
    changed_by_email: changedByEmail,
    action: 'create',
    field_name: null,
    old_value: null,
    new_value: null,
  })
  return { ok: !error, error: error?.message }
}
