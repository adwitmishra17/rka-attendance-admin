// ============================================================================
// VALIDATORS
//
// Pure functions. Each returns null if valid, or a short error string.
// Phase 2 of HRMS — validation happens on Save (not as-you-type).
// ============================================================================

/**
 * Aadhaar — 12 digits.
 * UIDAI uses Verhoeff's checksum but most schools don't validate that.
 * We accept any 12 digits, with optional spaces or hyphens.
 */
export function validateAadhaar(value) {
  if (!value) return null  // optional field
  const digits = String(value).replace(/[\s-]/g, '')
  if (!/^\d{12}$/.test(digits)) {
    return 'Aadhaar must be 12 digits'
  }
  return null
}

/**
 * PAN — 5 letters + 4 digits + 1 letter (uppercase).
 * Example: ABCDE1234F
 * Format check only; we don't verify against ITD.
 */
export function validatePan(value) {
  if (!value) return null
  const v = String(value).toUpperCase()
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) {
    return 'PAN format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)'
  }
  return null
}

/**
 * IFSC — 4 letters + 0 + 6 alphanumeric.
 * Example: SBIN0001234
 */
export function validateIfsc(value) {
  if (!value) return null
  const v = String(value).toUpperCase()
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) {
    return 'IFSC format: 4 letters, 0, 6 alphanumeric (e.g. SBIN0001234)'
  }
  return null
}

/**
 * Bank account — between 9 and 18 digits.
 * Indian bank account numbers vary widely (SBI 11, HDFC 14, etc.)
 */
export function validateBankAccount(value) {
  if (!value) return null
  const digits = String(value).replace(/[\s-]/g, '')
  if (!/^\d{9,18}$/.test(digits)) {
    return 'Account number must be 9–18 digits'
  }
  return null
}

/**
 * Email — basic format check.
 */
export function validateEmail(value) {
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Invalid email format'
  }
  return null
}

/**
 * Phone — Indian mobile (+91 optional) or 10 digits.
 */
export function validatePhone(value) {
  if (!value) return null
  const digits = String(value).replace(/[\s+\-()]/g, '')
  if (!/^(91)?[6-9]\d{9}$/.test(digits)) {
    return 'Phone must be 10 digits, starting with 6–9'
  }
  return null
}

/**
 * Year — 4 digits, between 1950 and current year + 1.
 */
export function validateYear(value) {
  if (!value && value !== 0) return null
  const y = parseInt(value, 10)
  const now = new Date().getFullYear()
  if (isNaN(y) || y < 1950 || y > now + 1) {
    return `Year must be between 1950 and ${now + 1}`
  }
  return null
}

/**
 * Run all validators against a form object.
 * Returns { errors: { fieldName: 'message' }, isValid: bool }
 */
export function validateProfileForm(form) {
  const errors = {}

  if (!form.full_name || !form.full_name.trim()) {
    errors.full_name = 'Name is required'
  }

  const aadErr = validateAadhaar(form.aadhaar_number); if (aadErr) errors.aadhaar_number = aadErr
  const panErr = validatePan(form.pan_number);          if (panErr) errors.pan_number = panErr
  const ifscErr = validateIfsc(form.bank_ifsc);         if (ifscErr) errors.bank_ifsc = ifscErr
  const accErr = validateBankAccount(form.bank_account_number); if (accErr) errors.bank_account_number = accErr
  const emErr  = validateEmail(form.email);             if (emErr)  errors.email = emErr
  const pemErr = validateEmail(form.personal_email);    if (pemErr) errors.personal_email = pemErr
  const phErr  = validatePhone(form.phone);             if (phErr)  errors.phone = phErr
  const pphErr = validatePhone(form.personal_phone);    if (pphErr) errors.personal_phone = pphErr
  const ecphErr = validatePhone(form.emergency_contact_phone); if (ecphErr) errors.emergency_contact_phone = ecphErr
  const yrErr  = validateYear(form.qualification_year); if (yrErr)  errors.qualification_year = yrErr

  return { errors, isValid: Object.keys(errors).length === 0 }
}

/**
 * Normalisers — clean values before saving to DB.
 * Removes whitespace from sensitive identifiers, uppercases PAN/IFSC, etc.
 */
export function normaliseProfileForm(form) {
  const out = { ...form }
  if (out.aadhaar_number) out.aadhaar_number = String(out.aadhaar_number).replace(/[\s-]/g, '')
  if (out.pan_number)     out.pan_number     = String(out.pan_number).toUpperCase().replace(/\s/g, '')
  if (out.bank_ifsc)      out.bank_ifsc      = String(out.bank_ifsc).toUpperCase().replace(/\s/g, '')
  if (out.bank_account_number) out.bank_account_number = String(out.bank_account_number).replace(/[\s-]/g, '')

  // Convert empty strings to null (so DB stores NULL not '')
  for (const k of Object.keys(out)) {
    if (out[k] === '') out[k] = null
  }
  return out
}
