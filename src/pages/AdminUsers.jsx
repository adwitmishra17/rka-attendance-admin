import React, { useEffect, useState } from 'react'
import { useAuth, SUPER_ADMIN_EMAIL } from '../App'
import { useToast } from '../components/Toast'
import {
  listAdmins,
  createAdmin,
  updateAdmin,
  setAdminActive,
  deleteAdmin,
  adminModules,
  DEFAULT_MODULES,
} from '../lib/admins'

// ============================================================================
// ADMIN USERS PAGE
//
// Manage who can sign in to the HRMS portal. Branch-scoped roles:
//   - admin:        full HRMS access for one branch
//   - receptionist: walk-ins only, for one branch
//
// The hardcoded super admin (adwit@rkacademyballia.in) is shown as a
// banner for context but cannot be edited from the UI.
//
// Writes to the `admins` collection in the shared rka-academic-tracker
// Firestore project — both this app and the Academic Tracker read from
// the same collection for authorisation.
//
// Access: super admin only. Route guard in App.jsx redirects others.
// ============================================================================

const ROLES = [
  { value: 'admin',        label: 'Admin',      desc: 'Full HRMS access for one branch' },
  { value: 'receptionist', label: 'Front desk', desc: 'Walk-ins only, for one branch' },
]
const BRANCHES = [
  { value: 'MAIN', label: 'Main Campus', desc: 'Sawarubandh / Akhar' },
  { value: 'CITY', label: 'City Branch', desc: 'Japlinganj' },
]
const MODULE_INFO = [
  { value: 'tracker', label: 'Academic Tracker', desc: 'Lessons, tests, syllabus' },
  { value: 'hrms',    label: 'HRMS Portal',      desc: 'Employees, attendance, walk-ins' },
  { value: 'sms',     label: 'Student Mgmt',     desc: 'Students, admissions, fees' },
]

export default function AdminUsers() {
  const { user } = useAuth()
  const toast = useToast()

  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add modal state
  const [showAdd, setShowAdd] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('admin')
  const [newBranch, setNewBranch] = useState('MAIN')
  const [newModules, setNewModules] = useState([...DEFAULT_MODULES])
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState('')

  // Edit modal state
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRole, setEditRole] = useState('admin')
  const [editBranch, setEditBranch] = useState('MAIN')
  const [editModules, setEditModules] = useState([...DEFAULT_MODULES])
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState('')

  // Inline delete confirm
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const list = await listAdmins()
      setAdmins(list)
    } catch (e) {
      setError(e.message || 'Failed to load admins')
    }
    setLoading(false)
  }

  function openAdd() {
    setNewEmail(''); setNewPhone(''); setNewName(''); setNewRole('admin'); setNewBranch('MAIN')
    setNewModules([...DEFAULT_MODULES])
    setAddError('')
    setShowAdd(true)
  }

  async function handleAdd() {
    setAddError('')
    setSubmitting(true)
    try {
      await createAdmin({
        email: newEmail,
        phone: newPhone,
        fullName: newName,
        role: newRole,
        branchCode: newBranch,
        modules: newRole === 'receptionist' ? ['hrms'] : newModules,
        currentUser: user,
      })
      toast.show('Admin added')
      setShowAdd(false)
      await load()
    } catch (e) {
      setAddError(e.message)
    }
    setSubmitting(false)
  }

  function openEdit(a) {
    setEditing(a)
    setEditName(a.fullName || '')
    setEditEmail(a.email || '')
    // Pre-fill phone from either lowercase `phone` (preferred) or legacy `Phone`.
    setEditPhone(a.phone || a.Phone || '')
    setEditRole(ROLES.find(r => r.value === a.role) ? a.role : 'admin')
    setEditBranch(BRANCHES.find(b => b.value === a.branchCode) ? a.branchCode : 'MAIN')
    setEditModules(adminModules(a))
    setEditError('')
  }

  async function handleEditSave() {
    if (!editing) return
    setEditError('')
    setEditSubmitting(true)
    try {
      await updateAdmin({
        id: editing.id,
        fullName: editName,
        // Email only sent when the admin is phone-only (UUID doc id). For
        // email-keyed admins the email IS the doc id, so it can't change here.
        email: editing.email ? undefined : editEmail,
        phone: editPhone,    // empty string clears phone (if email is present)
        role: editRole,
        branchCode: editBranch,
        modules: editRole === 'receptionist' ? ['hrms'] : editModules,
        currentUser: user,
      })
      toast.show('Admin updated')
      setEditing(null)
      await load()
    } catch (e) {
      setEditError(e.message)
    }
    setEditSubmitting(false)
  }

  async function handleToggleActive(a) {
    const next = a.isActive === false
    try {
      await setAdminActive({ id: a.id, isActive: next, currentUser: user })
      toast.show(next ? 'Reactivated' : 'Deactivated')
      await load()
    } catch (e) {
      toast.show('Failed: ' + e.message, 'error')
    }
  }

  async function handleDelete(a) {
    try {
      await deleteAdmin({ id: a.id })
      toast.show('Admin removed')
      setDeletingId(null)
      await load()
    } catch (e) {
      toast.show('Failed: ' + e.message, 'error')
      setDeletingId(null)
    }
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
            Admin Users
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Manage who can sign in to HRMS. Branch admins have full access to their campus; front-desk staff see walk-ins only.
          </p>
          <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
        </div>
        <button onClick={openAdd} style={btnPrimaryLarge}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Admin
        </button>
      </div>

      {/* Hardcoded super admin — context only, not editable */}
      <div style={{
        background: 'var(--gold-light)',
        border: '1px solid rgba(201,162,39,0.25)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--gold)', color: 'var(--green-dark)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 14, flexShrink: 0,
        }}>★</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold-dark)' }}>
            Adwit Mishra · Super Admin
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
            <code style={{ background: 'rgba(201,162,39,0.15)', padding: '1px 6px', borderRadius: 3 }}>{SUPER_ADMIN_EMAIL}</code>
            {' · all branches · hardcoded, cannot be removed or modified from this page'}
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 20, color: 'var(--crimson)', fontSize: 12 }}>{error}</div>
        ) : admins.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No admins yet. Click <strong>Add Admin</strong> above to invite the first one.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)' }}>
                {['Admin', 'Role', 'Branch', 'Added', 'Actions'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admins.map(a => {
                const inactive = a.isActive === false
                const branch = BRANCHES.find(b => b.value === a.branchCode)
                const isLegacySuper = a.role === 'super_admin'
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--gray-100)', opacity: inactive ? 0.55 : 1, verticalAlign: 'middle' }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--gold), var(--crimson))',
                          color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 600, flexShrink: 0,
                        }}>
                          {((a.fullName || a.email || '?').split(' ').map(n => n[0] || '').join('').slice(0, 2) || '?').toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            {a.fullName || '—'}
                            {inactive && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--crimson)', fontWeight: 600 }}>· Deactivated</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {a.email || (a.phone || a.Phone) || a.id}
                          </div>
                          {a.email && (a.phone || a.Phone) && (
                            <div style={{ fontSize: 11, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
                              {a.phone || a.Phone}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <RoleBadge role={a.role} />
                      <div style={{ marginTop: 5 }}>
                        <ModuleChips admin={a} />
                      </div>
                      {isLegacySuper && (
                        <div style={{ fontSize: 10, color: 'var(--crimson)', marginTop: 4 }}>Legacy — please edit</div>
                      )}
                    </td>
                    <td style={td}>
                      {branch ? (
                        <span style={pill('var(--gray-50)', 'var(--text)')}>{branch.label}</span>
                      ) : (
                        <span style={pill('var(--crimson-light)', 'var(--crimson)')}>Needs setup</span>
                      )}
                    </td>
                    <td style={{ ...td, color: 'var(--text-muted)', fontSize: 11.5 }}>
                      <div style={{ whiteSpace: 'nowrap' }}>{a.addedByName || 'System'}</div>
                      <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                        {a.addedAt?.toDate ? a.addedAt.toDate().toLocaleDateString() : '—'}
                      </div>
                    </td>
                    <td style={td}>
                      {deletingId === a.id ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => handleDelete(a)} style={btnDanger}>Confirm remove</button>
                          <button onClick={() => setDeletingId(null)} style={btnSecondary}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => openEdit(a)} style={btnSecondary}>Edit</button>
                          <button onClick={() => handleToggleActive(a)} style={btnSecondary}>
                            {inactive ? 'Reactivate' : 'Deactivate'}
                          </button>
                          <button onClick={() => setDeletingId(a.id)} style={btnSecondaryDanger}>Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Tip */}
      <div style={{
        marginTop: 14,
        padding: '12px 14px',
        background: 'var(--gold-light)',
        border: '1px solid rgba(201,162,39,0.25)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11.5,
        color: 'var(--text)',
        lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--gold-dark)' }}>Tip:</strong> Email must match the Google account they sign in with — if the case is wrong (e.g. <code>Priya@…</code> instead of <code>priya@…</code>), Firestore lookup will fail silently. If someone forgets their access, deactivate first (reversible) and only remove if they've left the school.
      </div>

      {/* Add Modal */}
      {showAdd && (
        <Modal title="Add New Admin" onClose={() => !submitting && setShowAdd(false)}>
          <Field label="Email">
            <input
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="e.g. priya@rkacademyballia.in"
              disabled={submitting}
              style={inp}
              autoFocus
            />
            <p style={hint}>Used for Google sign-in. Case-insensitive.</p>
          </Field>
          <Field label="Mobile">
            <input
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              inputMode="numeric"
              autoComplete="tel"
              disabled={submitting}
              style={inp}
            />
            <p style={hint}>Used for OTP sign-in in SMS. 10-digit Indian number. At least one of Email or Mobile is required.</p>
          </Field>
          <Field label="Full Name" required>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Priya Sharma"
              disabled={submitting}
              style={inp}
            />
          </Field>
          <Field label="Role">
            <RoleRadios value={newRole} onChange={setNewRole} disabled={submitting} />
          </Field>
          <Field label="Branch">
            <BranchRadios value={newBranch} onChange={setNewBranch} disabled={submitting} />
          </Field>
          <Field label="Apps">
            <ModulesPicker value={newModules} onChange={setNewModules} role={newRole} disabled={submitting} />
          </Field>
          {addError && <div style={errBox}>{addError}</div>}
          <button
            onClick={handleAdd}
            disabled={submitting || !newName.trim() || (!newEmail.trim() && !newPhone.trim())}
            style={modalSaveBtn(submitting || !newName.trim() || (!newEmail.trim() && !newPhone.trim()))}
          >
            {submitting ? 'Adding…' : 'Add Admin'}
          </button>
        </Modal>
      )}

      {/* Edit Modal */}
      {editing && (
        <Modal title="Edit Admin" onClose={() => !editSubmitting && setEditing(null)}>
          <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {editing.email || (editing.phone || editing.Phone) || editing.id}
            </div>
            <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>
              {editing.email ? 'Email-keyed admin' : 'Phone-only admin'}
            </div>
          </div>
          <Field label="Full Name" required>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              disabled={editSubmitting}
              style={inp}
            />
          </Field>
          <Field label="Email">
            <input
              value={editing.email ? editing.email : editEmail}
              onChange={e => setEditEmail(e.target.value)}
              placeholder="e.g. priya@rkacademyballia.in"
              disabled={editSubmitting || !!editing.email}
              style={{ ...inp, opacity: editing.email ? 0.7 : 1 }}
            />
            <p style={hint}>
              {editing.email
                ? "Can't be changed — email is this admin's permanent identifier."
                : 'Optional. Add to enable Google sign-in for this phone-only admin.'}
            </p>
          </Field>
          <Field label="Mobile">
            <input
              value={editPhone}
              onChange={e => setEditPhone(e.target.value)}
              placeholder="10-digit Indian number"
              inputMode="numeric"
              autoComplete="tel"
              disabled={editSubmitting}
              style={inp}
            />
            <p style={hint}>
              {editing.email
                ? 'Optional. Used for OTP sign-in in SMS. Leave blank to clear.'
                : 'Required for this phone-only admin.'}
            </p>
          </Field>
          <Field label="Role">
            <RoleRadios value={editRole} onChange={setEditRole} disabled={editSubmitting} />
            {editing.role === 'super_admin' && (
              <p style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 6 }}>
                This admin has the legacy <strong>super_admin</strong> role. Saving will convert them to a branch-scoped role. (The hardcoded super admin is unaffected.)
              </p>
            )}
          </Field>
          <Field label="Branch">
            <BranchRadios value={editBranch} onChange={setEditBranch} disabled={editSubmitting} />
          </Field>
          <Field label="Apps">
            <ModulesPicker value={editModules} onChange={setEditModules} role={editRole} disabled={editSubmitting} />
          </Field>
          {editError && <div style={errBox}>{editError}</div>}
          <button
            onClick={handleEditSave}
            disabled={editSubmitting || !editName.trim()}
            style={modalSaveBtn(editSubmitting || !editName.trim())}
          >
            {editSubmitting ? 'Saving…' : 'Save Changes'}
          </button>
        </Modal>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 20,
    }}>
      <div style={{
        background: 'var(--white)',
        borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: 500,
        boxShadow: 'var(--shadow-lg)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--gray-100)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--green-dark)' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>
        {label} {required && <span style={{ color: 'var(--crimson)' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function RoleRadios({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {ROLES.map(r => (
        <label key={r.value} style={radioCard(value === r.value, disabled)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio" name="role-radio" value={r.value}
              checked={value === r.value}
              onChange={() => onChange(r.value)}
              disabled={disabled}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: value === r.value ? 'var(--green-dark)' : 'var(--text)' }}>
              {r.label}
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 22 }}>{r.desc}</span>
        </label>
      ))}
    </div>
  )
}

function BranchRadios({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {BRANCHES.map(b => (
        <label key={b.value} style={radioCard(value === b.value, disabled)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio" name="branch-radio" value={b.value}
              checked={value === b.value}
              onChange={() => onChange(b.value)}
              disabled={disabled}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: value === b.value ? 'var(--green-dark)' : 'var(--text)' }}>
              {b.label}
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 22 }}>{b.desc}</span>
        </label>
      ))}
    </div>
  )
}

function RoleBadge({ role }) {
  const isSuper = role === 'super_admin'
  const isRecep = role === 'receptionist'
  const bg = isSuper ? 'var(--gold-light)' : isRecep ? 'rgba(139,26,26,0.08)' : 'var(--green-light)'
  const fg = isSuper ? 'var(--gold-dark)' : isRecep ? 'var(--crimson)' : 'var(--green)'
  const label = isSuper ? '⭐ Super Admin' : isRecep ? 'Front desk' : 'Admin'
  return <span style={pill(bg, fg)}>{label}</span>
}

/**
 * Multi-select module checkboxes — one card per available app. Disabled
 * (and forced to ['hrms']) when role is receptionist; we show the cards
 * read-only with a helper message in that case so the user understands
 * why they can't pick.
 */
function ModulesPicker({ value, onChange, role, disabled }) {
  const lockedToHrms = role === 'receptionist'
  const effective = lockedToHrms ? ['hrms'] : value

  function toggle(mod) {
    if (lockedToHrms || disabled) return
    const has = effective.includes(mod)
    let next
    if (has) {
      next = effective.filter(m => m !== mod)
      if (next.length === 0) return  // must keep at least one
    } else {
      next = [...effective, mod]
    }
    onChange(next)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        {MODULE_INFO.map(m => {
          const checked = effective.includes(m.value)
          const cardDisabled = lockedToHrms || disabled
          return (
            <label
              key={m.value}
              style={{
                ...radioCard(checked, cardDisabled),
                cursor: cardDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(m.value)}
                  disabled={cardDisabled}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: checked ? 'var(--green-dark)' : 'var(--text)' }}>
                  {m.label}
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 22 }}>{m.desc}</span>
            </label>
          )
        })}
      </div>
      {lockedToHrms && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Front-desk staff are always limited to HRMS only.
        </p>
      )}
    </div>
  )
}

/**
 * Compact chip pair shown under the role badge in the table.
 */
function ModuleChips({ admin }) {
  const mods = adminModules(admin)
  if (mods.length === 0) return null
  if (mods.length === MODULE_INFO.length) {
    return (
      <span style={modChip('var(--green-light)', 'var(--green-dark)')}>
        All apps
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {mods.map(m => {
        const info = MODULE_INFO.find(x => x.value === m)
        return (
          <span key={m} style={modChip('var(--gray-50)', 'var(--text)')}>
            {info ? info.label.replace(' Portal', '').replace('Academic ', '') : m}
          </span>
        )
      })}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const th = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const td = { padding: '12px 16px' }

const inp = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'var(--text)',
  background: 'var(--white)',
  outline: 'none',
  boxSizing: 'border-box',
}

const hint = { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }

const errBox = {
  fontSize: 12,
  color: 'var(--crimson)',
  padding: '9px 12px',
  background: 'var(--crimson-light)',
  borderRadius: 'var(--radius-sm)',
}

function pill(bg, fg) {
  return {
    fontSize: 11, padding: '3px 10px', borderRadius: 12,
    background: bg, color: fg, fontWeight: 600,
    whiteSpace: 'nowrap', display: 'inline-block',
  }
}

function modChip(bg, fg) {
  return {
    fontSize: 10, padding: '1px 7px', borderRadius: 4,
    background: bg, color: fg, fontWeight: 600,
    whiteSpace: 'nowrap', display: 'inline-block',
    border: '1px solid var(--gray-200)',
  }
}

function radioCard(selected, disabled) {
  return {
    flex: 1,
    padding: '12px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid',
    borderColor: selected ? 'var(--green)' : 'var(--gray-200)',
    background: selected ? 'var(--green-light)' : 'var(--white)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', flexDirection: 'column', gap: 4,
    opacity: disabled ? 0.6 : 1,
  }
}

const btnPrimaryLarge = {
  padding: '10px 16px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13, fontWeight: 500,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 7,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const btnSecondary = {
  padding: '5px 12px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 11.5, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const btnSecondaryDanger = { ...btnSecondary, color: 'var(--crimson)' }

const btnDanger = {
  padding: '5px 12px',
  background: 'var(--crimson)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 11.5, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

function modalSaveBtn(disabled) {
  return {
    padding: '12px',
    background: disabled ? 'var(--gray-200)' : 'var(--green-dark)',
    color: disabled ? 'var(--gray-400)' : 'white',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 14, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    marginTop: 4,
    fontFamily: 'inherit',
  }
}
