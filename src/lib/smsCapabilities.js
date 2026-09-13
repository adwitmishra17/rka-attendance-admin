// ============================================================================
// SMS capabilities — MIRROR of rka-sms/src/lib/capabilities.js (Reports family).
// Keep the ids, labels and ADMIN_ONLY set in sync with that file.
//
// Used by the Admin Users screen to edit per-user permission OVERRIDES, stored
// on the Firestore admin doc as `smsPermissions` and folded into the SMS JWT by
// the auth-sync edge function (as app_metadata.sms_perms). Overrides are the
// DIFFERENCE from the role default — an empty map means "role defaults only".
// ============================================================================

export const SMS_CAPABILITIES = [
  { id: 'reports.collection',           module: 'Reports', label: 'Collection register',       db: true },
  { id: 'reports.collection_breakdown', module: 'Reports', label: 'Collector- & caption-wise', db: true },
  { id: 'reports.reconciliation',       module: 'Reports', label: 'End-of-day reconciliation',  db: true },
  { id: 'reports.waivers',              module: 'Reports', label: 'Fee waiver register',        db: true },
  { id: 'reports.late_fees',            module: 'Reports', label: 'Late-fee collection'                  },
  { id: 'reports.defaulters',           module: 'Reports', label: 'Low payers / defaulters'              },
  { id: 'reports.due_list',             module: 'Reports', label: 'Due list'                             },
  { id: 'reports.admissions',           module: 'Reports', label: 'Admissions (YoY)',           db: true },
  { id: 'reports.forms',                module: 'Reports', label: 'Forms sold (YoY)',           db: true },
  { id: 'reports.session_students',     module: 'Reports', label: 'Session-wise students'                },
  { id: 'reports.transport',            module: 'Reports', label: 'Session-wise transport'               },
  { id: 'reports.tc_register',          module: 'Reports', label: 'TC register'                          },
]

// Capabilities non-super-admins do NOT get by default (rest default ON).
const ADMIN_ONLY = new Set([
  'reports.collection', 'reports.collection_breakdown', 'reports.admissions', 'reports.forms',
])

// smsLevel from moduleRoles.sms: 'super_admin' | 'admin' | 'cashier'.
export function smsCapDefault(smsLevel, capId) {
  if (smsLevel === 'super_admin') return true
  return !ADMIN_ONLY.has(capId)
}

// Keep only booleans keyed by a known capability id.
export function normaliseSmsPermissions(input) {
  if (!input || typeof input !== 'object') return {}
  const ids = new Set(SMS_CAPABILITIES.map(c => c.id))
  const out = {}
  for (const k of Object.keys(input)) {
    if (ids.has(k) && typeof input[k] === 'boolean') out[k] = input[k]
  }
  return out
}
