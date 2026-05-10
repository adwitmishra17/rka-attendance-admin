import React, { useEffect, useState, useMemo } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { useNavigate } from 'react-router-dom'
import { listDepartments } from '../lib/departments'
import { applyBranchFilterArray } from '../lib/branchQuery'
import { branchLabel, BRANCHES } from '../lib/branch'

export default function Employees() {
  const { user, effectiveBranches } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active') // 'active' | 'inactive' | 'all'
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null | {} | employee object
  const [deleting, setDeleting] = useState(null) // null | employee object

  // Departments (Phase 4.5)
  const [departments, setDepartments] = useState([])
  const [filterDepartmentId, setFilterDepartmentId] = useState(null)

  async function load() {
    setLoading(true)
    let q = supabaseAdmin
      .from('employees')
      .select('*')
      .order('full_name', { ascending: true })
    q = applyBranchFilterArray(q, effectiveBranches)
    const { data, error } = await q
    if (error) {
      toast.show('Failed to load employees: ' + error.message, 'error')
      setEmployees([])
    } else {
      setEmployees(data || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [effectiveBranches])

  // Load departments once on mount
  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => setDepartments([]))
  }, [])

  const filtered = useMemo(() => {
    let list = employees
    if (filter === 'active') list = list.filter(e => e.is_active)
    else if (filter === 'inactive') list = list.filter(e => !e.is_active)
    if (filterDepartmentId) {
      list = list.filter(e => e.department_id === filterDepartmentId)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        (e.full_name || '').toLowerCase().includes(q) ||
        (e.employee_code || '').toLowerCase().includes(q) ||
        (e.biometric_code || '').toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [employees, filter, search, filterDepartmentId])

  const counts = useMemo(() => ({
    active: employees.filter(e => e.is_active).length,
    inactive: employees.filter(e => !e.is_active).length,
    all: employees.length,
  }), [employees])

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1200 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
            Employees
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Register teachers whose attendance will be tracked by the kiosk.
          </p>
          <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
        </div>
        <button
          onClick={() => setEditing({})}
          style={{
            padding: '10px 18px',
            background: 'var(--green-dark)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add employee
        </button>
      </div>

      {/* Filter tabs + search */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{
          display: 'inline-flex',
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          padding: 3,
          gap: 2,
        }}>
          {[
            { k: 'active', label: 'Active', count: counts.active },
            { k: 'inactive', label: 'Inactive', count: counts.inactive },
            { k: 'all', label: 'All', count: counts.all },
          ].map(opt => (
            <button key={opt.k} onClick={() => setFilter(opt.k)} style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: filter === opt.k ? 'var(--green-dark)' : 'transparent',
              color: filter === opt.k ? 'white' : 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {opt.label}
              <span style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 999,
                background: filter === opt.k ? 'rgba(255,255,255,0.2)' : 'var(--gray-100)',
                color: filter === opt.k ? 'white' : 'var(--text-muted)',
              }}>{opt.count}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, code, or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 34px',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              background: 'var(--white)',
              color: 'var(--text)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Department filter chips (Phase 4.5) */}
      {departments.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>
            Department
          </span>
          <button
            onClick={() => setFilterDepartmentId(null)}
            style={deptChipStyle(!filterDepartmentId)}
          >
            All
          </button>
          {departments.map(d => (
            <button
              key={d.id}
              onClick={() => setFilterDepartmentId(d.id)}
              style={deptChipStyle(filterDepartmentId === d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ width: 24, height: 24, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
            <div style={{ fontSize: 12 }}>Loading employees…</div>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState search={search} filter={filter} onAdd={() => setEditing({})} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={th}>Name</th>
                  <th style={th}>Codes</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Custom timing</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, idx) => (
                  <tr
                    key={e.id}
                    onClick={() => navigate(`/employees/${e.id}`)}
                    style={{
                      borderTop: idx === 0 ? 'none' : '1px solid var(--gray-100)',
                      cursor: 'pointer',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(ev) => ev.currentTarget.style.background = 'var(--gray-50)'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
                  >                    <td style={td}>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{e.full_name}</div>
                      {e.email && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{e.email}</div>}
                      {Array.isArray(e.branch_codes) && e.branch_codes.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          {e.branch_codes.map(bc => (
                            <span key={bc} style={branchChip}>{branchLabel(bc)}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {e.employee_code && (
                          <span style={codePill}>{e.employee_code}</span>
                        )}
                        {e.biometric_code && (
                          <span style={{ ...codePill, background: 'var(--gold-light)', color: 'var(--gold-dark)' }}>
                            B: {e.biometric_code}
                          </span>
                        )}
                        {!e.employee_code && !e.biometric_code && (
                          <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>—</span>
                        )}
                      </div>
                    </td>
                    <td style={td}>
                      {e.phone || <span style={{ color: 'var(--gray-400)' }}>—</span>}
                    </td>
                    <td style={td}>
                      {e.custom_in_time || e.custom_out_time ? (
                        <span style={{ fontSize: 12, color: 'var(--text)' }}>
                          {e.custom_in_time?.slice(0, 5) || '—'} → {e.custom_out_time?.slice(0, 5) || '—'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>School default</span>
                      )}
                    </td>
                    <td style={td}>
                      {e.is_active ? (
                        <span style={statusPillActive}>Active</span>
                      ) : (
                        <span style={statusPillInactive}>Inactive</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={(ev) => { ev.stopPropagation(); setEditing(e) }} style={iconBtn} title="Edit">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button onClick={(ev) => { ev.stopPropagation(); setDeleting(e) }} style={{ ...iconBtn, marginLeft: 4, color: 'var(--crimson)' }} title={e.is_active ? 'Deactivate' : 'Reactivate'}>
                    {e.is_active ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    )}
                  </button>
                    </td>
            </tr>
                ))}
          </tbody>
            </table>
    </div>
        )}
      </div>

      {/* Edit/Create Modal */}
      {editing !== null && (
        <EmployeeForm
          employee={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          adminEmail={user?.email}
        />
      )}

      {/* Deactivate/Reactivate confirm */}
      {deleting && (
        <ConfirmDeactivate
          employee={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null); load() }}
        />
      )}
    </div>
  )
}

const th = {
  textAlign: 'left',
  padding: '11px 16px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--gray-200)',
}

const td = {
  padding: '12px 16px',
  fontSize: 13,
  color: 'var(--text)',
  verticalAlign: 'middle',
}

const codePill = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontFamily: 'ui-monospace, "SF Mono", monospace',
  background: 'var(--gray-100)',
  color: 'var(--text)',
  borderRadius: 4,
  fontWeight: 500,
}

const branchChip = {
  display: 'inline-block',
  padding: '1px 6px',
  fontSize: 10,
  background: 'var(--green-light)',
  color: 'var(--green-dark)',
  borderRadius: 4,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const statusPillActive = {
  display: 'inline-block',
  padding: '2px 10px',
  fontSize: 10.5,
  fontWeight: 600,
  background: 'var(--green-light)',
  color: 'var(--green-dark)',
  borderRadius: 999,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const statusPillInactive = {
  display: 'inline-block',
  padding: '2px 10px',
  fontSize: 10.5,
  fontWeight: 600,
  background: 'var(--gray-100)',
  color: 'var(--text-muted)',
  borderRadius: 999,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const iconBtn = {
  background: 'transparent',
  border: '1px solid var(--gray-200)',
  borderRadius: 6,
  padding: '6px 8px',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

function EmptyState({ search, filter, onAdd }) {
  const isFiltered = search || filter !== 'active'
  return (
    <div style={{ padding: '50px 24px', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 16px',
        borderRadius: '50%',
        background: 'var(--gold-light)',
        border: '1px solid rgba(201,162,39,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.8">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
        </svg>
      </div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
        {isFiltered ? 'No matching employees' : 'No employees yet'}
      </h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        {isFiltered ? 'Try adjusting filters or search.' : 'Add your first teacher to start tracking attendance.'}
      </p>
      {!isFiltered && (
        <button onClick={onAdd} style={{
          padding: '9px 18px',
          background: 'var(--green-dark)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}>
          Add first employee
        </button>
      )}
    </div>
  )
}

// ============================================================
// EMPLOYEE FORM (Add / Edit)
// ============================================================
function EmployeeForm({ employee, onClose, onSaved, adminEmail }) {
  const isEdit = !!employee.id
  const toast = useToast()
  const { currentBranch } = useAuth()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    full_name: employee.full_name || '',
    email: employee.email || '',
    employee_code: employee.employee_code || '',
    biometric_code: employee.biometric_code || '',
    phone: employee.phone || '',
    custom_in_time: employee.custom_in_time?.slice(0, 5) || '',
    custom_out_time: employee.custom_out_time?.slice(0, 5) || '',
    custom_grace_minutes: employee.custom_grace_minutes ?? '',
    is_active: employee.is_active ?? true,
    // Branches the employee belongs to (array — supports dual-branch teachers).
    // Pre-fill: existing employee → their current branches; new employee
    // when sidebar is on a specific branch → that branch; "All Branches" → empty
    // (validation will require user to pick).
    branch_codes: (employee.branch_codes && employee.branch_codes.length > 0)
      ? employee.branch_codes
      : (currentBranch ? [currentBranch] : []),
  })
  const [errors, setErrors] = useState({})

  function update(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.full_name.trim()) errs.full_name = 'Name is required'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Invalid email'
    }
    // If any custom timing field is filled, validate the pair
    if (form.custom_in_time || form.custom_out_time) {
      if (!form.custom_in_time) errs.custom_in_time = 'In time required if Out time set'
      if (!form.custom_out_time) errs.custom_out_time = 'Out time required if In time set'
    }
    // Must belong to at least one branch
    if (!form.branch_codes || form.branch_codes.length === 0) {
      errs.branch_codes = 'Pick at least one branch'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    if (!supabaseAdmin) {
      toast.show('Admin client not initialised. Add VITE_SUPABASE_SERVICE_ROLE_KEY.', 'error')
      return
    }
    setSaving(true)

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      employee_code: form.employee_code.trim() || null,
      biometric_code: form.biometric_code.trim() || null,
      phone: form.phone.trim() || null,
      custom_in_time: form.custom_in_time || null,
      custom_out_time: form.custom_out_time || null,
      custom_grace_minutes: form.custom_grace_minutes === '' ? null : Number(form.custom_grace_minutes),
      is_active: form.is_active,
      branch_codes: form.branch_codes,
    }

    let res
    if (isEdit) {
      res = await supabaseAdmin.from('employees').update(payload).eq('id', employee.id)
    } else {
      res = await supabaseAdmin.from('employees').insert({
        ...payload,
        created_by: adminEmail,
      })
    }

    if (res.error) {
      const msg = res.error.message
      // Friendly errors for unique constraints
      if (msg.includes('employees_employee_code_key')) {
        setErrors({ employee_code: 'This employee code is already used' })
      } else if (msg.includes('employees_biometric_code_key')) {
        setErrors({ biometric_code: 'This biometric code is already used' })
      } else if (msg.includes('employees_email_key')) {
        setErrors({ email: 'This email is already used' })
      } else {
        toast.show('Save failed: ' + msg, 'error')
      }
      setSaving(false)
      return
    }

    toast.show(isEdit ? 'Employee updated' : 'Employee added')
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open={true}
      onClose={() => !saving && onClose()}
      title={isEdit ? `Edit ${employee.full_name}` : 'Add new employee'}
      footer={
        <>
          <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add employee')}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Full name" required error={errors.full_name}>
          <input type="text" value={form.full_name} onChange={e => update('full_name', e.target.value)}
            style={inputStyle} placeholder="e.g. Amit Gupta" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Email" error={errors.email} hint="Optional">
            <input type="email" value={form.email} onChange={e => update('email', e.target.value)}
              style={inputStyle} placeholder="amit@..." />
          </Field>
          <Field label="Phone" hint="Optional">
            <input type="text" value={form.phone} onChange={e => update('phone', e.target.value)}
              style={inputStyle} placeholder="+91..." />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Employee code" error={errors.employee_code} hint="School-assigned, optional">
            <input type="text" value={form.employee_code} onChange={e => update('employee_code', e.target.value)}
              style={inputStyle} placeholder="e.g. RKA-T-001" />
          </Field>
          <Field label="Biometric code" error={errors.biometric_code} hint="From biometric machine">
            <input type="text" value={form.biometric_code} onChange={e => update('biometric_code', e.target.value)}
              style={inputStyle} placeholder="e.g. 118" />
          </Field>
        </div>

        <Field label="Branches" required error={errors.branch_codes}
          hint="Pick one or both. Most teachers belong to a single branch; cross-campus teachers (e.g. principal) can be in both.">
          <div style={{ display: 'flex', gap: 16, paddingTop: 4 }}>
            {BRANCHES.map(bc => {
              const checked = form.branch_codes.includes(bc.code)
              return (
                <label key={bc.code} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
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
                    onChange={() => {
                      const next = checked
                        ? form.branch_codes.filter(b => b !== bc.code)
                        : [...form.branch_codes, bc.code]
                      update('branch_codes', next)
                    }}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  {bc.label}
                </label>
              )
            })}
          </div>
        </Field>

        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginTop: 4,
            marginBottom: 10,
          }}>
            Custom reporting time (optional override)
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Leave blank to use the school default. Set these only if this teacher follows a different schedule.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="In time" error={errors.custom_in_time}>
              <input type="time" value={form.custom_in_time} onChange={e => update('custom_in_time', e.target.value)}
                style={inputStyle} />
            </Field>
            <Field label="Out time" error={errors.custom_out_time}>
              <input type="time" value={form.custom_out_time} onChange={e => update('custom_out_time', e.target.value)}
                style={inputStyle} />
            </Field>
            <Field label="Grace (min)">
              <input type="number" min="0" max="60" value={form.custom_grace_minutes}
                onChange={e => update('custom_grace_minutes', e.target.value)}
                style={inputStyle} placeholder="—" />
            </Field>
          </div>
        </div>

        {isEdit && (
          <div style={{
            paddingTop: 12,
            borderTop: '1px solid var(--gray-100)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Active</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Inactive teachers are excluded from kiosk recognition</div>
            </div>
            <Switch on={form.is_active} onChange={v => update('is_active', v)} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, required, error, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
          {label}
          {required && <span style={{ color: 'var(--crimson)', marginLeft: 3 }}>*</span>}
        </span>
        {hint && !error && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{hint}</span>}
      </div>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>{error}</div>
      )}
    </label>
  )
}

function Switch({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 38, height: 22,
      background: on ? 'var(--green)' : 'var(--gray-300)',
      borderRadius: 999,
      position: 'relative',
      border: 'none',
      cursor: 'pointer',
      transition: 'background 0.2s',
      padding: 0,
    }}>
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

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  background: 'var(--white)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
}

const btnPrimary = {
  padding: '8px 18px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const btnSecondary = {
  padding: '8px 18px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

// ============================================================
// CONFIRM DEACTIVATE / REACTIVATE
// ============================================================
function ConfirmDeactivate({ employee, onClose, onDone }) {
  const toast = useToast()
  const [working, setWorking] = useState(false)
  const willDeactivate = employee.is_active

  async function handleConfirm() {
    if (!supabaseAdmin) {
      toast.show('Admin client not available', 'error')
      return
    }
    setWorking(true)
    const { error } = await supabaseAdmin
      .from('employees')
      .update({ is_active: !employee.is_active })
      .eq('id', employee.id)
    if (error) {
      toast.show('Failed: ' + error.message, 'error')
      setWorking(false)
      return
    }
    toast.show(willDeactivate ? 'Employee deactivated' : 'Employee reactivated')
    setWorking(false)
    onDone()
  }

  return (
    <Modal open={true} onClose={() => !working && onClose()}
      title={willDeactivate ? 'Deactivate employee?' : 'Reactivate employee?'}
      footer={
        <>
          <button onClick={onClose} disabled={working} style={btnSecondary}>Cancel</button>
          <button onClick={handleConfirm} disabled={working} style={{
            ...btnPrimary,
            background: willDeactivate ? 'var(--crimson)' : 'var(--green-dark)',
          }}>
            {working ? 'Working…' : (willDeactivate ? 'Yes, deactivate' : 'Yes, reactivate')}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
        {willDeactivate ? (
          <>
            <strong>{employee.full_name}</strong> will no longer be recognised by the kiosk and will not appear in active employee lists. <strong>Their attendance history is preserved</strong> and can be reviewed any time. You can reactivate them later if needed.
          </>
        ) : (
          <>
            <strong>{employee.full_name}</strong> will be reactivated and start appearing in active lists and kiosk recognition again.
          </>
        )}
      </p>
    </Modal>
  )
}

// Helper for department filter chips (Phase 4.5)
function deptChipStyle(active) {
  return {
    padding: '5px 12px',
    background: active ? 'var(--green-dark)' : 'var(--gray-50)',
    color: active ? 'white' : 'var(--text-muted)',
    border: '1px solid ' + (active ? 'var(--green-dark)' : 'var(--gray-200)'),
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
