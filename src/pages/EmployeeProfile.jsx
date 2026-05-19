import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import { validateProfileForm, normaliseProfileForm } from '../lib/validators'
import { logProfileUpdate, logSensitiveReveal } from '../lib/auditLog'
import { uploadProfilePhoto } from '../lib/profilePhoto'
import { listDepartments } from '../lib/departments'
import { applyBranchFilterArray, isAccessibleArray } from '../lib/branchQuery'
import { BRANCHES, branchLabel } from '../lib/branch'
import DocumentsTab from '../components/DocumentsTab'
import EmployeeAttendance from './EmployeeAttendance'
import EmployeeFleetTab from '../components/EmployeeFleetTab'

// ============================================================================
// EMPLOYEE PROFILE PAGE
//
// Phase 1: read-only. Phase 2: adds inline edit mode, sensitive reveal with
// audit logging, photo upload UI shell (disabled until Phase 3 / R2).
//
// Edit mode is controlled by ?edit=1 query param so refresh preserves mode.
// ============================================================================

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, isSuperAdmin, effectiveBranches } = useAuth()
  const toast = useToast()

  const isEditing = searchParams.get('edit') === '1'

  const [employee, setEmployee] = useState(null)        // last-saved snapshot from DB
  const [reportingManager, setReportingManager] = useState(null)
  const [allEmployees, setAllEmployees] = useState([])  // for reporting-manager dropdown

  const [form, setForm] = useState(null)                // working copy in edit mode
  const [errors, setErrors] = useState({})
  const [revealed, setRevealed] = useState(new Set())   // field names currently unmasked
  const [saving, setSaving] = useState(false)

  // Photo upload state (Phase 4)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoInputRef = React.useRef(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  // Departments (Phase 4.5)
  const [departments, setDepartments] = useState([])

  // Branch reporting-time defaults — shown as fallback hint next to per-employee
  // custom timing fields, so admin can see what the override is overriding.
  const [reportingTimeConfigs, setReportingTimeConfigs] = useState([])

  useEffect(() => { loadEmployee() }, [id])

  // Load departments once on mount (used in edit dropdown + name lookup)
  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => setDepartments([]))
  }, [])

  // Load branch reporting-time configs once on mount
  useEffect(() => {
    if (!supabaseAdmin) return
    ;(async () => {
      const { data } = await supabaseAdmin
        .from('reporting_time_config')
        .select('branch_code, default_in_time, default_out_time, default_grace_minutes')
      setReportingTimeConfigs(data || [])
    })()
  }, [])

  // When entering edit mode, seed the form from the latest employee snapshot
  useEffect(() => {
    if (isEditing && employee && !form) {
      setForm({ ...employee })
      setErrors({})
      // Reveals reset on entering edit (each session)
      setRevealed(new Set())
    }
    if (!isEditing) {
      setForm(null)
      setErrors({})
    }
  }, [isEditing, employee])

  async function loadEmployee() {
    setLoading(true)
    setError('')
    if (!supabaseAdmin) {
      setError('Admin client not initialised. Add VITE_SUPABASE_SERVICE_ROLE_KEY to .env.local.')
      setLoading(false)
      return
    }
    try {
      const { data, error: e1 } = await supabaseAdmin
        .from('employees')
        .select('*')
        .eq('id', id)
        .single()
      if (e1) throw e1

      // Defensive: prevent URL-tampering access. A branch admin who guesses
      // the URL of an employee at the other branch should be blocked here.
      if (!isAccessibleArray(data.branch_codes, effectiveBranches)) {
        toast.show("You don't have access to this employee", 'error')
        navigate('/employees')
        return
      }

      setEmployee(data)

      if (data?.reporting_manager_id) {
        const { data: mgr } = await supabaseAdmin
          .from('employees')
          .select('id, full_name, designation')
          .eq('id', data.reporting_manager_id)
          .single()
        setReportingManager(mgr)
      } else {
        setReportingManager(null)
      }

      // Lazy-load all employees only when needed (for reporting-manager select)
      // We'll fetch on demand in entering edit mode below
    } catch (e) {
      setError('Could not load employee: ' + e.message)
      toast.show('Failed to load employee: ' + e.message, 'error')
    }
    setLoading(false)
  }

  // Fetch employee list for reporting-manager dropdown — only when entering edit mode
  useEffect(() => {
    if (!isEditing || allEmployees.length > 0 || !supabaseAdmin) return
      ; (async () => {
        // Only show managers the current user can see (branch-scoped)
        let q = supabaseAdmin
          .from('employees')
          .select('id, full_name, designation, is_active, branch_codes')
          .eq('is_active', true)
          .order('full_name', { ascending: true })
        q = applyBranchFilterArray(q, effectiveBranches)
        const { data } = await q
        setAllEmployees(data || [])
      })()
  }, [isEditing, effectiveBranches])

  function enterEdit() {
    setSearchParams({ edit: '1' })
  }
  function cancelEdit() {
    setSearchParams({})
    setForm(null)
    setErrors({})
  }
  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const e = { ...prev }; delete e[field]; return e
      })
    }
  }

  async function reveal(fieldName) {
    if (revealed.has(fieldName)) return
    if (!user?.email) {
      toast.show('Could not record reveal — not logged in', 'error')
      return
    }
    const result = await logSensitiveReveal({
      employeeId: id,
      fieldName,
      changedByEmail: user.email,
    })
    if (!result.ok) {
      toast.show('Reveal failed: ' + (result.error || 'unknown'), 'error')
      return
    }
    setRevealed(prev => new Set([...prev, fieldName]))
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!user?.email) {
      toast.show('Cannot upload — not logged in', 'error')
      return
    }
    setPhotoUploading(true)
    try {
      const { employee: updated } = await uploadProfilePhoto({
        file,
        employeeId: id,
        uploadedByEmail: user.email,
      })
      setEmployee(updated)
      toast.show('Photo updated')
    } catch (err) {
      toast.show('Photo upload failed: ' + err.message, 'error')
    }
    setPhotoUploading(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  async function saveChanges() {
    if (!form) return
    const normalised = normaliseProfileForm(form)
    const { errors: errs, isValid } = validateProfileForm(normalised)
    // Local supplemental validation — validators.js doesn't know about branch_codes yet
    const branchCodes = Array.isArray(form.branch_codes) ? form.branch_codes : []
    if (branchCodes.length === 0) {
      errs.branch_codes = 'Pick at least one branch'
    }
    if (!isValid || errs.branch_codes) {
      setErrors(errs)
      toast.show('Please fix the errors below', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...normalised,
        // Defensive: ensure branch_codes survives even if normaliseProfileForm
        // strips unknown fields. This keeps the column current with the form.
        branch_codes: branchCodes,
        updated_by: user?.email || null,
        updated_at: new Date().toISOString(),
      }

      // Attendance-exempt audit stamping. normaliseProfileForm may strip these
      // unknown fields, so set them explicitly. Stamp by/at only on the
      // false → true transition; clear all three when un-exempting.
      const wasExempt = !!employee?.attendance_exempt
      const nowExempt = !!form.attendance_exempt
      payload.attendance_exempt = nowExempt
      if (nowExempt) {
        payload.attendance_exempt_reason = form.attendance_exempt_reason?.trim() || null
        payload.attendance_exempt_by = wasExempt
          ? (employee.attendance_exempt_by || user?.email || null)
          : (user?.email || null)
        payload.attendance_exempt_at = wasExempt
          ? (employee.attendance_exempt_at || new Date().toISOString())
          : new Date().toISOString()
      } else {
        payload.attendance_exempt_reason = null
        payload.attendance_exempt_by = null
        payload.attendance_exempt_at = null
      }

      // Don't try to write fields that aren't columns (defensive)
      delete payload.id  // never overwrite the PK
      delete payload.created_at
      delete payload.created_by

      const { data: updated, error: e1 } = await supabaseAdmin
        .from('employees')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (e1) throw e1

      // Audit log — fire and forget, but capture failures into a toast
      const auditResult = await logProfileUpdate({
        employeeId: id,
        oldEmployee: employee,
        newEmployee: updated,
        changedByEmail: user?.email || 'unknown',
      })
      if (!auditResult.ok) {
        console.warn('Audit log skipped:', auditResult.error)
      }

      // Pattern 1 — snapshot at write time. We do NOT bulk-recompute existing
      // attendance_daily rows for this employee. Each past row keeps the
      // schedule it was written against. New punches will snapshot the new
      // custom timings via the trigger. If admin needs to apply the change
      // retroactively, they edit past days via the Attendance tab.

      setEmployee(updated)
      setSearchParams({})
      setForm(null)
      setErrors({})
      toast.show('Changes saved')
    } catch (e) {
      toast.show('Save failed: ' + e.message, 'error')
    }
    setSaving(false)
  }

  if (loading) return <PageLoader />
  if (error) return <PageError msg={error} onBack={() => navigate('/employees')} />
  if (!employee) return <PageError msg="Employee not found" onBack={() => navigate('/employees')} />

  // Use form values when editing, snapshot otherwise
  const display = isEditing ? form || employee : employee

  // Fleet tab is shown only for staff in the Drivers / Conductors departments
  const _fleetDeptName = departments?.find(d => d.id === employee?.department_id)?.name
  const isFleetStaff = _fleetDeptName === 'Drivers' || _fleetDeptName === 'Conductors'

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1200, margin: '0 auto' }} className="fade-in">

      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)' }}>
        <Link to="/employees" style={{ color: 'var(--text-muted)' }}>← Employees</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--text)' }}>{employee.full_name}</span>
      </div>

      <ProfileHeader
        employee={display}
        isEditing={isEditing}
        saving={saving}
        photoUploading={photoUploading}
        photoInputRef={photoInputRef}
        onPhotoSelected={handlePhotoSelected}
        departments={departments}
        onEdit={enterEdit}
        onCancel={cancelEdit}
        onSave={saveChanges}
      />

      {/* Tabs (hidden in edit mode for focus) */}
      {!isEditing && (
        <div style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--gray-200)',
          marginBottom: 24,
          marginTop: 24,
          overflowX: 'auto',
        }}>
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'documents', label: 'Documents' },
            { key: 'attendance', label: 'Attendance' },
            { key: 'history', label: 'History' },
            ...(isFleetStaff ? [{ key: 'fleet', label: 'Fleet' }] : []),
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '10px 18px',
                fontSize: 13,
                fontWeight: 500,
                color: activeTab === t.key ? 'var(--green-dark)' : 'var(--text-muted)',
                borderBottom: activeTab === t.key
                  ? '2px solid var(--green-dark)'
                  : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {isEditing ? (
        <EditMode
          form={form || {}}
          errors={errors}
          revealed={revealed}
          allEmployees={allEmployees}
          departments={departments}
          reportingTimeConfigs={reportingTimeConfigs}
          canSeeSensitive={isSuperAdmin}
          onUpdate={update}
          onReveal={reveal}
        />
      ) : (
        <>
          {activeTab === 'overview' && (
            <OverviewTab
              employee={employee}
              reportingManager={reportingManager}
              departments={departments}
              canSeeSensitive={isSuperAdmin}
              revealed={revealed}
              onReveal={reveal}
            />
          )}
          {activeTab === 'documents' && <DocumentsTab employee={employee} />}
          {activeTab === 'fleet' && <EmployeeFleetTab employee={employee} />}
          {activeTab === 'attendance' && <EmployeeAttendance employeeId={employee?.id} />}
          {activeTab === 'history' && <HistoryTab employee={employee} />}
        </>
      )}
    </div>
  )
}


// ============================================================================
// HEADER
// ============================================================================
function ProfileHeader({ employee, isEditing, saving, photoUploading, photoInputRef, onPhotoSelected, departments, onEdit, onCancel, onSave }) {
  // Resolve department name from FK if present, else fall back to legacy text field
  const departmentName = employee.department_id
    ? (departments?.find(d => d.id === employee.department_id)?.name || null)
    : null
  const displayDepartment = departmentName || employee.department || null
  const initials = (employee.full_name || 'E')
    .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      padding: '20px 24px',
      background: 'var(--white)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--gray-200)',
    }}>
      {/* Photo / initials with disabled upload affordance */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: 84, height: 84,
          borderRadius: '50%',
          background: employee.profile_photo_url
            ? `url(${employee.profile_photo_url}) center/cover`
            : 'linear-gradient(135deg, var(--green-dark), var(--gold))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: 28,
          fontWeight: 600,
          fontFamily: 'var(--font-display)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          {!employee.profile_photo_url && initials}
        </div>
        {isEditing && (
          <>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onPhotoSelected}
              style={{ display: 'none' }}
              disabled={photoUploading}
            />
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={photoUploading}
              title={photoUploading ? "Uploading…" : "Change photo"}
              style={{
                position: 'absolute',
                bottom: -2, right: -2,
                width: 28, height: 28,
                borderRadius: '50%',
                background: 'var(--green)',
                color: 'white',
                border: '2px solid var(--white)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: photoUploading ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                padding: 0,
              }}
            >
              {photoUploading ? (
                <div style={{
                  width: 12, height: 12,
                  border: '2px solid white',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
            </button>
          </>
        )}
      </div>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2,
          fontFamily: 'var(--font-display)',
        }}>
          <span style={{
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--text)',
          }}>
            {employee.full_name}
          </span>
          {isEditing && <EditingPill />}
          {!isEditing && !employee.is_active && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              background: 'var(--crimson-light)',
              color: 'var(--crimson)',
              borderRadius: 4,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-body)',
            }}>
              Inactive
            </span>
          )}
          {!isEditing && employee.attendance_exempt && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              background: 'var(--gold-light)',
              color: 'var(--gold-dark)',
              borderRadius: 4,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-body)',
            }}>
              Attendance exempt
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
          {employee.designation || 'No designation set'}
          {displayDepartment && <span> · {displayDepartment}</span>}
        </div>
        <div style={{
          display: 'flex',
          gap: 14,
          fontSize: 11,
          color: 'var(--gray-400)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          flexWrap: 'wrap',
        }}>
          {employee.employee_code && <span>Code: {employee.employee_code}</span>}
          {employee.biometric_code && <span>Bio: {employee.biometric_code}</span>}
          {employee.email && <span>{employee.email}</span>}
        </div>
        {!isEditing && employee.updated_by && (
          <div style={{
            fontSize: 10,
            color: 'var(--gray-400)',
            marginTop: 8,
            letterSpacing: '0.03em',
          }}>
            Last edited by {employee.updated_by} · {fmtRelative(employee.updated_at)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        {!isEditing ? (
          <button onClick={onEdit} style={btnPrimary}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit profile
          </button>
        ) : (
          <>
            <button onClick={onCancel} disabled={saving} style={btnSecondary}>Cancel</button>
            <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, background: 'var(--green)' }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function EditingPill() {
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      padding: '3px 9px',
      background: 'var(--green)',
      color: 'white',
      borderRadius: 999,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-body)',
    }}>
      Editing
    </span>
  )
}


// ============================================================================
// EDIT MODE — full form, all fields
// ============================================================================
function EditMode({ form, errors, revealed, allEmployees, departments, reportingTimeConfigs, canSeeSensitive, onUpdate, onReveal }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>

      <Section title="Personal info">
        <FormField label="Full name" required error={errors.full_name}>
          <Input value={form.full_name} onChange={v => onUpdate('full_name', v)} />
        </FormField>
        <FormField label="Date of birth">
          <Input type="date" value={fmtDateForInput(form.date_of_birth)} onChange={v => onUpdate('date_of_birth', v || null)} />
        </FormField>
        <FormField label="Gender">
          <Select value={form.gender || ''} onChange={v => onUpdate('gender', v || null)} options={[
            { v: '', l: '—' },
            { v: 'male', l: 'Male' },
            { v: 'female', l: 'Female' },
            { v: 'other', l: 'Other' },
            { v: 'prefer_not_to_say', l: 'Prefer not to say' },
          ]} />
        </FormField>
        <FormField label="Blood group">
          <Select value={form.blood_group || ''} onChange={v => onUpdate('blood_group', v || null)} options={[
            { v: '', l: '—' },
            { v: 'A+', l: 'A+' }, { v: 'A-', l: 'A−' },
            { v: 'B+', l: 'B+' }, { v: 'B-', l: 'B−' },
            { v: 'AB+', l: 'AB+' }, { v: 'AB-', l: 'AB−' },
            { v: 'O+', l: 'O+' }, { v: 'O-', l: 'O−' },
            { v: 'unknown', l: 'Unknown' },
          ]} />
        </FormField>
        <FormField label="Marital status">
          <Select value={form.marital_status || ''} onChange={v => onUpdate('marital_status', v || null)} options={[
            { v: '', l: '—' },
            { v: 'single', l: 'Single' },
            { v: 'married', l: 'Married' },
            { v: 'divorced', l: 'Divorced' },
            { v: 'widowed', l: 'Widowed' },
            { v: 'separated', l: 'Separated' },
          ]} />
        </FormField>
        {form.marital_status === 'married' && (
          <FormField label="Spouse name">
            <Input value={form.spouse_name} onChange={v => onUpdate('spouse_name', v)} />
          </FormField>
        )}
        <FormField label="Father's name">
          <Input value={form.father_name} onChange={v => onUpdate('father_name', v)} />
        </FormField>
        <FormField label="Mother's name">
          <Input value={form.mother_name} onChange={v => onUpdate('mother_name', v)} />
        </FormField>
      </Section>

      <Section title="Contact">
        <FormField label="Work email" error={errors.email}>
          <Input type="email" value={form.email} onChange={v => onUpdate('email', v)} />
        </FormField>
        <FormField label="Personal email" error={errors.personal_email}>
          <Input type="email" value={form.personal_email} onChange={v => onUpdate('personal_email', v)} />
        </FormField>
        <FormField label="Work phone" error={errors.phone}>
          <Input value={form.phone} onChange={v => onUpdate('phone', v)} placeholder="+91…" />
        </FormField>
        <FormField label="Personal phone" error={errors.personal_phone}>
          <Input value={form.personal_phone} onChange={v => onUpdate('personal_phone', v)} placeholder="+91…" />
        </FormField>
        <FormField label="Permanent address">
          <Textarea value={form.permanent_address} onChange={v => onUpdate('permanent_address', v)} rows={2} />
        </FormField>
        <FormField label="Current address">
          <Textarea value={form.current_address} onChange={v => onUpdate('current_address', v)} rows={2} />
        </FormField>
        <FormField label="Emergency contact name">
          <Input value={form.emergency_contact_name} onChange={v => onUpdate('emergency_contact_name', v)} />
        </FormField>
        <FormField label="Emergency contact phone" error={errors.emergency_contact_phone}>
          <Input value={form.emergency_contact_phone} onChange={v => onUpdate('emergency_contact_phone', v)} />
        </FormField>
        <FormField label="Emergency contact relation">
          <Input value={form.emergency_contact_relation} onChange={v => onUpdate('emergency_contact_relation', v)} placeholder="e.g. spouse, parent" />
        </FormField>
      </Section>

      <Section title="Employment">
        <FormField label="Employee code">
          <Input value={form.employee_code} onChange={v => onUpdate('employee_code', v)} placeholder="RKA-T-001" />
        </FormField>
        <FormField label="Biometric code">
          <Input value={form.biometric_code} onChange={v => onUpdate('biometric_code', v)} />
        </FormField>
        <FormField label="Designation">
          <Input value={form.designation} onChange={v => onUpdate('designation', v)} placeholder="Accountancy Teacher" />
        </FormField>
        <FormField label="Branches" error={errors.branch_codes}>
          <BranchesPicker
            value={Array.isArray(form.branch_codes) ? form.branch_codes : []}
            onChange={v => onUpdate('branch_codes', v)}
          />
        </FormField>
        <FormField label="Department">
          <Select
            value={form.department_id || ''}
            onChange={v => onUpdate('department_id', v || null)}
            options={[
              { v: '', l: '— Select department —' },
              ...(departments || []).map(d => ({ v: d.id, l: d.name })),
            ]}
          />
          {form.department && !form.department_id && (
            <div style={{ fontSize: 10.5, color: 'var(--gold-dark)', marginTop: 4 }}>
              Legacy value: "{form.department}". Pick from the list to migrate.
            </div>
          )}
        </FormField>
        <FormField label="Employment type">
          <Select value={form.employment_type || ''} onChange={v => onUpdate('employment_type', v || null)} options={[
            { v: '', l: '—' },
            { v: 'permanent', l: 'Permanent' },
            { v: 'contract', l: 'Contract' },
            { v: 'probation', l: 'Probation' },
            { v: 'temporary', l: 'Temporary' },
            { v: 'consultant', l: 'Consultant' },
          ]} />
        </FormField>
        <FormField label="Joining date">
          <Input type="date" value={fmtDateForInput(form.joining_date)} onChange={v => onUpdate('joining_date', v || null)} />
        </FormField>
        <FormField label="Confirmation date">
          <Input type="date" value={fmtDateForInput(form.confirmation_date)} onChange={v => onUpdate('confirmation_date', v || null)} />
        </FormField>
        <FormField label="Reporting manager">
          <Select
            value={form.reporting_manager_id || ''}
            onChange={v => onUpdate('reporting_manager_id', v || null)}
            options={[
              { v: '', l: '— None —' },
              ...allEmployees
                .filter(e => e.id !== form.id)  // can't report to self
                .map(e => ({ v: e.id, l: `${e.full_name}${e.designation ? ' (' + e.designation + ')' : ''}` })),
            ]}
          />
        </FormField>
        <FormField label="Leaving date">
          <Input type="date" value={fmtDateForInput(form.leaving_date)} onChange={v => onUpdate('leaving_date', v || null)} />
        </FormField>
        {form.leaving_date && (
          <FormField label="Leaving reason">
            <Textarea value={form.leaving_reason} onChange={v => onUpdate('leaving_reason', v)} rows={2} />
          </FormField>
        )}
      </Section>

      <Section title="Teaching">
        <FormField label="Subjects taught" hint="Comma-separated">
          <Input
            value={(form.subjects_taught || []).join(', ')}
            onChange={v => onUpdate('subjects_taught', v ? v.split(',').map(s => s.trim()).filter(Boolean) : null)}
            placeholder="e.g. Accountancy, Business Studies"
          />
        </FormField>
        <FormField label="Classes assigned" hint="Comma-separated">
          <Input
            value={(form.classes_assigned || []).join(', ')}
            onChange={v => onUpdate('classes_assigned', v ? v.split(',').map(s => s.trim()).filter(Boolean) : null)}
            placeholder="e.g. Class 11 Comm, Class 12 Comm"
          />
        </FormField>
      </Section>

      <Section title="Education">
        <FormField label="Highest qualification">
          <Input value={form.highest_qualification} onChange={v => onUpdate('highest_qualification', v)} placeholder="M.Com, B.Ed" />
        </FormField>
        <FormField label="Year" error={errors.qualification_year}>
          <Input type="number" min="1950" max="2030" value={form.qualification_year || ''} onChange={v => onUpdate('qualification_year', v ? parseInt(v, 10) : null)} />
        </FormField>
        <FormField label="Institution">
          <Input value={form.qualification_institution} onChange={v => onUpdate('qualification_institution', v)} />
        </FormField>
        <FormField label="Years of experience">
          <Input type="number" min="0" max="50" step="0.5" value={form.years_of_experience ?? ''} onChange={v => onUpdate('years_of_experience', v ? parseFloat(v) : null)} />
        </FormField>
      </Section>

      <Section title="Identifiers">
        <SensitiveField
          label="Aadhaar"
          field="aadhaar_number"
          value={form.aadhaar_number}
          revealed={revealed.has('aadhaar_number')}
          error={errors.aadhaar_number}
          onReveal={() => onReveal('aadhaar_number')}
          onChange={v => onUpdate('aadhaar_number', v)}
          maskFn={maskAadhaar}
          placeholder="12 digits"
        />
        <SensitiveField
          label="PAN"
          field="pan_number"
          value={form.pan_number}
          revealed={revealed.has('pan_number')}
          error={errors.pan_number}
          onReveal={() => onReveal('pan_number')}
          onChange={v => onUpdate('pan_number', v)}
          maskFn={maskPan}
          placeholder="ABCDE1234F"
        />
        <AuditNotice />
      </Section>

      <Section title="Custom timing">
        <CustomTimingHint
          form={form}
          reportingTimeConfigs={reportingTimeConfigs}
        />
        <FormField
          label="In time"
          hint={timingHint(form, reportingTimeConfigs, 'in')}
        >
          <Input
            type="time"
            value={form.custom_in_time?.slice(0, 5) || ''}
            onChange={v => onUpdate('custom_in_time', v || null)}
            placeholder="Uses branch default"
          />
        </FormField>
        <FormField
          label="Out time"
          hint={timingHint(form, reportingTimeConfigs, 'out')}
        >
          <Input
            type="time"
            value={form.custom_out_time?.slice(0, 5) || ''}
            onChange={v => onUpdate('custom_out_time', v || null)}
            placeholder="Uses branch default"
          />
        </FormField>
        <FormField
          label="Grace minutes"
          hint={timingHint(form, reportingTimeConfigs, 'grace')}
        >
          <Input
            type="number"
            min="0"
            max="60"
            value={form.custom_grace_minutes ?? ''}
            onChange={v => onUpdate('custom_grace_minutes', v === '' ? null : parseInt(v, 10))}
            placeholder="Uses branch default"
          />
        </FormField>
      </Section>

      {canSeeSensitive && (
        <Section title="Attendance" badge="Super admin only">
          <ExemptToggleField
            exempt={!!form.attendance_exempt}
            reason={form.attendance_exempt_reason || ''}
            stampedBy={form.attendance_exempt_by}
            stampedAt={form.attendance_exempt_at}
            onToggle={v => onUpdate('attendance_exempt', v)}
            onReason={v => onUpdate('attendance_exempt_reason', v)}
          />
        </Section>
      )}

      {canSeeSensitive && (
        <Section title="Bank account" badge="Super admin only">
          <FormField label="Bank">
            <Input value={form.bank_name} onChange={v => onUpdate('bank_name', v)} />
          </FormField>
          <FormField label="Branch">
            <Input value={form.bank_branch} onChange={v => onUpdate('bank_branch', v)} />
          </FormField>
          <SensitiveField
            label="Account no"
            field="bank_account_number"
            value={form.bank_account_number}
            revealed={revealed.has('bank_account_number')}
            error={errors.bank_account_number}
            onReveal={() => onReveal('bank_account_number')}
            onChange={v => onUpdate('bank_account_number', v)}
            maskFn={maskAccount}
            placeholder="9–18 digits"
          />
          <FormField label="IFSC" error={errors.bank_ifsc}>
            <Input value={form.bank_ifsc} onChange={v => onUpdate('bank_ifsc', v)} placeholder="SBIN0001234" />
          </FormField>
        </Section>
      )}

      {canSeeSensitive && (
        <Section title="Compensation" badge="Super admin only">
          <FormField label="Basic salary" hint="₹ per month">
            <Input type="number" min="0" value={form.basic_salary ?? ''} onChange={v => onUpdate('basic_salary', v === '' ? null : parseFloat(v))} />
          </FormField>
          <FormField label="HRA" hint="₹ per month">
            <Input type="number" min="0" value={form.hra ?? ''} onChange={v => onUpdate('hra', v === '' ? null : parseFloat(v))} />
          </FormField>
          <FormField label="Other allowances" hint="₹ per month">
            <Input type="number" min="0" value={form.other_allowances ?? ''} onChange={v => onUpdate('other_allowances', v === '' ? null : parseFloat(v))} />
          </FormField>
          <FormField label="PF number">
            <Input value={form.pf_number} onChange={v => onUpdate('pf_number', v)} />
          </FormField>
          <FormField label="ESI number">
            <Input value={form.esi_number} onChange={v => onUpdate('esi_number', v)} />
          </FormField>
          <FormField label="UAN">
            <Input value={form.uan_number} onChange={v => onUpdate('uan_number', v)} />
          </FormField>
        </Section>
      )}

      <Section title="Admin notes" badge="Internal" fullWidth>
        <Textarea
          value={form.admin_notes}
          onChange={v => onUpdate('admin_notes', v)}
          rows={3}
          placeholder="Internal notes — only visible to admins."
        />
      </Section>
    </div>
  )
}


function SensitiveField({ label, field, value, revealed, error, onReveal, onChange, maskFn, placeholder }) {
  const masked = maskFn(value)
  return (
    <FormField label={label} error={error}>
      {revealed ? (
        <Input
          value={value || ''}
          onChange={onChange}
          mono
          placeholder={placeholder}
          autoFocus
        />
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input
            value={masked || ''}
            disabled
            mono
            placeholder={value ? '' : '— not set —'}
          />
          <button onClick={onReveal} style={revealBtn}>
            {value ? 'Reveal to edit' : 'Add'}
          </button>
        </div>
      )}
    </FormField>
  )
}

function AuditNotice() {
  return (
    <div style={{
      fontSize: 11,
      color: 'var(--text-muted)',
      background: 'var(--gold-light)',
      border: '1px solid rgba(201,162,39,0.3)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      lineHeight: 1.5,
      marginTop: 4,
    }}>
      <strong style={{ color: 'var(--gold-dark)' }}>Logged:</strong> Revealing or changing these fields adds an entry to the activity log.
    </div>
  )
}


function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 38, height: 22,
        background: on ? 'var(--green)' : 'var(--gray-300)',
        borderRadius: 999,
        position: 'relative',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s',
        padding: 0,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: on ? 18 : 2,
        width: 18, height: 18,
        background: 'white',
        borderRadius: '50%',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}

// Attendance-exempt control. Super-admin only (gated by the caller). When on,
// the employee is dropped from rosters and stats via the
// `attendance_counted_employees` DB view. Punches are still recorded.
function ExemptToggleField({ exempt, reason, stampedBy, stampedAt, onToggle, onReason }) {
  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            Exempt from attendance
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
            Excludes this employee from attendance rosters and present / absent
            stats. Their punches are still recorded.
          </div>
        </div>
        <Toggle on={exempt} onChange={onToggle} />
      </div>
      {exempt && (
        <>
          <FormField label="Reason" hint="Why this employee is exempt">
            <Textarea
              value={reason}
              onChange={onReason}
              rows={2}
              placeholder="e.g. Senior management, off-site role, no fixed schedule"
            />
          </FormField>
          {stampedBy && (
            <div style={{ fontSize: 10.5, color: 'var(--gray-400)', letterSpacing: '0.03em' }}>
              Marked exempt by {stampedBy}
              {stampedAt && <> · {fmtRelative(stampedAt)}</>}
            </div>
          )}
        </>
      )}
    </>
  )
}


// ============================================================================
// READ-ONLY OVERVIEW (unchanged from Phase 1, but reveal() supported here too)
// ============================================================================
function OverviewTab({ employee, reportingManager, departments, canSeeSensitive, revealed, onReveal }) {
  const hasTeaching = (employee.subjects_taught?.length || employee.classes_assigned?.length)
  // Resolve department name from FK, fall back to legacy free-text
  const deptName = employee.department_id
    ? (departments?.find(d => d.id === employee.department_id)?.name || null)
    : null
  const departmentDisplay = deptName || employee.department || null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Section title="Personal info">
        <Field label="Full name" value={employee.full_name} />
        <Field label="Date of birth" value={fmtDate(employee.date_of_birth)} />
        <Field label="Gender" value={fmtGender(employee.gender)} />
        <Field label="Blood group" value={employee.blood_group} />
        <Field label="Marital status" value={fmtTitle(employee.marital_status)} />
        {employee.marital_status === 'married' && (
          <Field label="Spouse name" value={employee.spouse_name} />
        )}
        <Field label="Father's name" value={employee.father_name} />
        <Field label="Mother's name" value={employee.mother_name} />
      </Section>

      <Section title="Contact">
        <Field label="Work email" value={employee.email} />
        <Field label="Personal email" value={employee.personal_email} />
        <Field label="Work phone" value={employee.phone} />
        <Field label="Personal phone" value={employee.personal_phone} />
        <Field label="Permanent address" value={employee.permanent_address} multiline />
        <Field label="Current address" value={employee.current_address} multiline />
        <Field label="Emergency contact" multiline value={
          employee.emergency_contact_name
            ? `${employee.emergency_contact_name} (${employee.emergency_contact_relation || 'relative'}) — ${employee.emergency_contact_phone || 'no phone'}`
            : null
        } />
      </Section>

      <Section title="Employment">
        <Field label="Employee code" value={employee.employee_code} />
        <Field label="Biometric code" value={employee.biometric_code} />
        <Field label="Designation" value={employee.designation} />
        <Field label="Department" value={departmentDisplay} />
        <Field label="Employment type" value={fmtTitle(employee.employment_type)} />
        <Field label="Joining date" value={fmtDate(employee.joining_date)} />
        <Field label="Confirmation date" value={fmtDate(employee.confirmation_date)} />
        {employee.leaving_date && (
          <Field label="Leaving date" value={fmtDate(employee.leaving_date)} />
        )}
        {employee.leaving_reason && (
          <Field label="Leaving reason" value={employee.leaving_reason} multiline />
        )}
        <Field
          label="Reporting manager"
          value={reportingManager
            ? `${reportingManager.full_name} (${reportingManager.designation || 'no title'})`
            : null}
        />
      </Section>

      {hasTeaching && (
        <Section title="Teaching">
          <Field label="Subjects taught" value={employee.subjects_taught?.join(', ')} />
          <Field label="Classes assigned" value={employee.classes_assigned?.join(', ')} />
        </Section>
      )}

      <Section title="Education">
        <Field label="Highest qualification" value={employee.highest_qualification} />
        <Field label="Year" value={employee.qualification_year} />
        <Field label="Institution" value={employee.qualification_institution} />
        <Field
          label="Years of experience"
          value={employee.years_of_experience != null
            ? `${employee.years_of_experience} years`
            : null}
        />
      </Section>

      <Section title="Identifiers">
        <RevealableField
          label="Aadhaar"
          field="aadhaar_number"
          value={employee.aadhaar_number}
          revealed={revealed.has('aadhaar_number')}
          maskFn={maskAadhaar}
          onReveal={onReveal}
        />
        <RevealableField
          label="PAN"
          field="pan_number"
          value={employee.pan_number}
          revealed={revealed.has('pan_number')}
          maskFn={maskPan}
          onReveal={onReveal}
        />
      </Section>

      <Section title="Custom timing">
        <Field label="In time" value={fmtTime(employee.custom_in_time)} />
        <Field label="Out time" value={fmtTime(employee.custom_out_time)} />
        <Field label="Grace minutes" value={employee.custom_grace_minutes} />
      </Section>

      {employee.attendance_exempt && (
        <Section title="Attendance" badge="Exempt">
          <Field label="Status" value="Exempt from attendance tracking" />
          <Field label="Reason" value={employee.attendance_exempt_reason} multiline />
          <Field label="Marked by" value={employee.attendance_exempt_by} />
          <Field label="Marked on" value={fmtDate(employee.attendance_exempt_at)} />
        </Section>
      )}

      {canSeeSensitive && (
        <Section title="Bank account" badge="Super admin only">
          <Field label="Bank" value={employee.bank_name} />
          <Field label="Branch" value={employee.bank_branch} />
          <RevealableField
            label="Account no"
            field="bank_account_number"
            value={employee.bank_account_number}
            revealed={revealed.has('bank_account_number')}
            maskFn={maskAccount}
            onReveal={onReveal}
          />
          <Field label="IFSC" value={employee.bank_ifsc} />
        </Section>
      )}

      {canSeeSensitive && (
        <Section title="Compensation" badge="Super admin only">
          <Field label="Basic salary" value={fmtMoney(employee.basic_salary)} />
          <Field label="HRA" value={fmtMoney(employee.hra)} />
          <Field label="Other allowances" value={fmtMoney(employee.other_allowances)} />
          <Field label="Total" value={
            (employee.basic_salary != null || employee.hra != null || employee.other_allowances != null)
              ? fmtMoney(
                Number(employee.basic_salary || 0) +
                Number(employee.hra || 0) +
                Number(employee.other_allowances || 0)
              )
              : null
          } />
          <Field label="PF number" value={employee.pf_number} />
          <Field label="ESI number" value={employee.esi_number} />
          <Field label="UAN" value={employee.uan_number} />
        </Section>
      )}

      {employee.admin_notes && (
        <Section title="Admin notes" badge="Internal" fullWidth>
          <div style={{
            fontSize: 13,
            color: 'var(--text)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}>
            {employee.admin_notes}
          </div>
        </Section>
      )}
    </div>
  )
}

function RevealableField({ label, field, value, revealed, maskFn, onReveal }) {
  const display = !value ? null : (revealed ? value : maskFn(value))
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0' }}>
      <div style={{
        flex: '0 0 130px',
        fontSize: 11,
        color: 'var(--gray-400)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>{label}</div>
      <div style={{
        flex: 1,
        fontSize: 13,
        color: display ? 'var(--text)' : 'var(--gray-400)',
        fontFamily: 'ui-monospace, "SF Mono", monospace',
      }}>
        {display || '—'}
        {value && !revealed && (
          <button onClick={() => onReveal(field)} style={revealLinkBtn}>reveal</button>
        )}
      </div>
    </div>
  )
}


// ============================================================================
// PLACEHOLDERS — Attendance, History
// ============================================================================

function AttendanceTab() {
  return (
    <PlaceholderPanel
      title="Attendance"
      subtitle="View this employee's attendance history and patterns"
      phase="Pending Hikvision integration"
      details="Daily attendance, patterns, overtime, leaves. Full view comes after the Hikvision device is integrated."
    />
  )
}

function HistoryTab({ employee }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!supabaseAdmin) { setLoading(false); return }
      const { data } = await supabaseAdmin
        .from('employee_audit_log')
        .select('*')
        .eq('employee_id', employee.id)
        .order('changed_at', { ascending: false })
        .limit(100)
      setLogs(data || [])
      setLoading(false)
    }
    load()
  }, [employee.id])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
  }

  if (logs.length === 0) {
    return (
      <PlaceholderPanel
        title="No history yet"
        subtitle="Changes to this employee's record will appear here"
        phase="Activity log"
        details="Edits, document uploads, document downloads, and sensitive-field reveals are all logged for audit. Once you make changes via the Edit button above, entries will appear here."
      />
    )
  }

  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {logs.map((log, i) => (
        <div key={log.id} style={{
          padding: '12px 18px',
          borderBottom: i < logs.length - 1 ? '1px solid var(--gray-100)' : 'none',
          fontSize: 13,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
            <span style={{ fontWeight: 500 }}>
              {fmtAuditAction(log.action)}
              {log.field_name && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {fmtFieldName(log.field_name)}</span>
              )}
            </span>
            <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>
              {fmtRelative(log.changed_at)}
            </span>
          </div>
          {log.action === 'update' && (log.old_value || log.new_value) && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'ui-monospace, "SF Mono", monospace' }}>
              {log.old_value || <em style={{ color: 'var(--gray-400)' }}>—</em>}
              <span style={{ margin: '0 6px', color: 'var(--gray-400)' }}>→</span>
              {log.new_value || <em style={{ color: 'var(--gray-400)' }}>—</em>}
            </div>
          )}
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>
            by {log.changed_by_email}
          </div>
        </div>
      ))}
    </div>
  )
}


// ============================================================================
// SHARED UI
// ============================================================================
function Section({ title, badge, children, fullWidth }) {
  return (
    <div style={{
      gridColumn: fullWidth ? '1 / -1' : 'auto',
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: '18px 22px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--green-dark)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {title}
        </div>
        {badge && (
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            padding: '2px 7px',
            background: 'var(--gold-light)',
            color: 'var(--gold-dark)',
            borderRadius: 4,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

// Read-only field (used in Overview tab)
function Field({ label, value, multiline }) {
  const display = (value === null || value === undefined || value === '') ? '—' : value
  const isEmpty = display === '—'
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: multiline ? 'flex-start' : 'baseline', padding: '4px 0' }}>
      <div style={{
        flex: '0 0 130px',
        fontSize: 11,
        color: 'var(--gray-400)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        paddingTop: multiline ? 2 : 0,
      }}>
        {label}
      </div>
      <div style={{
        flex: 1,
        fontSize: 13,
        color: isEmpty ? 'var(--gray-400)' : 'var(--text)',
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
        wordBreak: 'break-word',
      }}>
        {display}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Custom-timing helpers (Pass 4)
// Show admins what the branch default is, so the override field is meaningful
// rather than just a blank box.
// ----------------------------------------------------------------------------

function fmtHHMM(t) {
  if (!t) return null
  return typeof t === 'string' ? t.slice(0, 5) : null
}

// One-line hint placed in the FormField header, e.g. "Default: 08:00"
function timingHint(form, configs, kind) {
  const branchCodes = Array.isArray(form?.branch_codes) ? form.branch_codes : []
  if (branchCodes.length === 0 || !configs || configs.length === 0) return null
  const cfgs = configs.filter(c => branchCodes.includes(c.branch_code))
  if (cfgs.length === 0) return null

  const key = kind === 'in' ? 'default_in_time' : kind === 'out' ? 'default_out_time' : 'default_grace_minutes'
  const fmt = kind === 'grace' ? (v => `${v} min`) : fmtHHMM

  // If one branch, single value. If both, "MAIN: 08:00 · CITY: 09:00" if different,
  // or just one value if both branches share it.
  if (cfgs.length === 1) {
    const v = fmt(cfgs[0][key])
    return v ? `Default: ${v}` : null
  }
  const vals = cfgs.map(c => fmt(c[key]))
  if (vals[0] === vals[1]) return `Default: ${vals[0]}`
  return cfgs.map(c => `${c.branch_code}: ${fmt(c[key])}`).join(' · ')
}

// Banner shown above the three timing fields — clearly explains what override
// means and what happens when fields are left blank.
function CustomTimingHint({ form, reportingTimeConfigs }) {
  const branchCodes = Array.isArray(form?.branch_codes) ? form.branch_codes : []
  const hasAnyOverride = !!(form?.custom_in_time || form?.custom_out_time || form?.custom_grace_minutes != null)

  return (
    <div style={{
      padding: '10px 12px',
      background: hasAnyOverride ? 'var(--gold-light)' : 'var(--gray-50)',
      border: `1px solid ${hasAnyOverride ? 'rgba(201,162,39,0.25)' : 'var(--gray-200)'}`,
      borderRadius: 'var(--radius-sm)',
      fontSize: 11.5,
      color: 'var(--text-muted)',
      lineHeight: 1.55,
      marginBottom: 6,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: hasAnyOverride ? 'var(--gold-dark)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {hasAnyOverride ? 'Custom schedule active' : 'Using branch default'}
      </div>
      Leave fields blank to follow the branch default set under <strong style={{ color: 'var(--text)' }}>Reporting Time</strong>.
      Fill any field to override it for this teacher only — useful for part-time or KG staff with a different schedule.
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed rgba(0,0,0,0.08)', fontSize: 11, lineHeight: 1.5 }}>
        Changes here apply to <strong>new punches from now on</strong>. Past attendance records keep the schedule they were originally written against.
      </div>
      {branchCodes.length === 0 && (
        <div style={{ marginTop: 4, color: 'var(--crimson)' }}>
          Branch not set on this employee — defaults can't be resolved yet.
        </div>
      )}
    </div>
  )
}

// Edit-mode field wrapper with label, error, hint
function FormField({ label, required, error, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}>
        <label style={{
          fontSize: 11,
          color: 'var(--gray-400)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {label}
          {required && <span style={{ color: 'var(--crimson)', marginLeft: 3 }}>*</span>}
        </label>
        {hint && !error && (
          <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 2 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder, disabled, mono, autoFocus, min, max, step }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      min={min}
      max={max}
      step={step}
      style={{
        width: '100%',
        padding: '7px 10px',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        background: disabled ? 'var(--gray-50)' : 'var(--white)',
        color: 'var(--text)',
        outline: 'none',
        fontFamily: mono ? 'ui-monospace, "SF Mono", monospace' : 'inherit',
      }}
    />
  )
}

function Textarea({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: '100%',
        padding: '7px 10px',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        background: 'var(--white)',
        color: 'var(--text)',
        outline: 'none',
        fontFamily: 'inherit',
        resize: 'vertical',
      }}
    />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      style={{
        width: '100%',
        padding: '7px 10px',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
        background: 'var(--white)',
        color: 'var(--text)',
        outline: 'none',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {options.map(opt => (
        <option key={opt.v} value={opt.v}>{opt.l}</option>
      ))}
    </select>
  )
}

// Multi-select for branches. Renders one toggle button per branch in BRANCHES.
// `value` is an array of branch codes; `onChange(nextArray)` fires on toggle.
// At least one branch is enforced by the parent's validator.
function BranchesPicker({ value, onChange }) {
  const arr = Array.isArray(value) ? value : []
  function toggle(code) {
    const next = arr.includes(code) ? arr.filter(b => b !== code) : [...arr, code]
    onChange?.(next)
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 2 }}>
      {BRANCHES.map(bc => {
        const checked = arr.includes(bc.code)
        return (
          <label key={bc.code} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px',
            border: `1px solid ${checked ? 'var(--green-dark)' : 'var(--gray-200)'}`,
            borderRadius: 'var(--radius-sm)',
            background: checked ? 'var(--green-light)' : 'var(--white)',
            color: checked ? 'var(--green-dark)' : 'var(--text)',
            fontSize: 13,
            fontWeight: checked ? 500 : 400,
            cursor: 'pointer',
            userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(bc.code)}
              style={{ margin: 0, cursor: 'pointer' }}
            />
            {bc.label}
          </label>
        )
      })}
    </div>
  )
}

function PlaceholderPanel({ title, subtitle, phase, details }) {
  return (
    <div style={{
      padding: '60px 24px',
      textAlign: 'center',
      background: 'var(--white)',
      border: '1px dashed var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        fontWeight: 600,
        color: 'var(--text)',
        marginBottom: 6,
      }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{subtitle}</div>
      {phase && (
        <div style={{
          display: 'inline-block',
          fontSize: 10,
          fontWeight: 600,
          padding: '3px 10px',
          background: 'var(--gold-light)',
          color: 'var(--gold-dark)',
          borderRadius: 999,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: 14,
        }}>{phase}</div>
      )}
      <div style={{
        fontSize: 12,
        color: 'var(--gray-400)',
        maxWidth: 420,
        margin: '0 auto',
        lineHeight: 1.6,
      }}>{details}</div>
    </div>
  )
}

function PageLoader() {
  return (
    <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{
        width: 24, height: 24,
        border: '2px solid var(--green-muted)',
        borderTopColor: 'var(--green)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        margin: '0 auto 10px',
      }} />
      <div style={{ fontSize: 12 }}>Loading employee…</div>
    </div>
  )
}

function PageError({ msg, onBack }) {
  return (
    <div style={{ padding: 80, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--crimson)', marginBottom: 16 }}>{msg}</div>
      <button onClick={onBack} style={btnPrimary}>Back to employees</button>
    </div>
  )
}


// ============================================================================
// STYLES
// ============================================================================
const btnPrimary = {
  padding: '8px 16px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
}

const btnSecondary = {
  padding: '8px 16px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const revealBtn = {
  padding: '7px 12px',
  background: 'var(--white)',
  color: 'var(--green-dark)',
  border: '1px solid var(--green-muted)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 11.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
}

const revealLinkBtn = {
  marginLeft: 8,
  background: 'none',
  border: 'none',
  color: 'var(--green)',
  fontSize: 11,
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textUnderlineOffset: '3px',
  fontFamily: 'inherit',
}


// ============================================================================
// FORMATTERS
// ============================================================================
function fmtDate(d) {
  if (!d) return null
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch { return d }
}

// HTML date inputs need ISO format yyyy-mm-dd
function fmtDateForInput(d) {
  if (!d) return ''
  try {
    const dt = new Date(d)
    if (isNaN(dt)) return ''
    return dt.toISOString().slice(0, 10)
  } catch { return '' }
}

function fmtTime(t) {
  if (!t) return null
  return t.slice(0, 5)
}

function fmtGender(g) {
  if (!g) return null
  return ({ male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: 'Prefer not to say' }[g]) || g
}

function fmtTitle(s) {
  if (!s) return null
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}

function fmtMoney(n) {
  if (n == null) return null
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function maskAadhaar(a) {
  if (!a) return null
  const digits = String(a).replace(/\D/g, '')
  if (digits.length !== 12) return digits || null
  return `XXXX XXXX ${digits.slice(-4)}`
}

function maskPan(p) {
  if (!p) return null
  if (String(p).length !== 10) return p
  return `${p.slice(0, 3)}XXXXXX${p.slice(-1)}`
}

function maskAccount(a) {
  if (!a) return null
  const digits = String(a).replace(/\D/g, '')
  if (digits.length < 4) return digits || null
  return `XXXX${digits.slice(-4)}`
}

function fmtAuditAction(a) {
  return ({
    create: 'Created',
    update: 'Updated',
    delete: 'Deactivated',
    restore: 'Reactivated',
    view_sensitive: 'Viewed sensitive field',
  })[a] || a
}

function fmtFieldName(f) {
  return f.replace(/_/g, ' ')
}

function fmtRelative(t) {
  if (!t) return ''
  const now = Date.now()
  const then = new Date(t).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
