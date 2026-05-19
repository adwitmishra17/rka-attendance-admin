import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import {
  listRecipients,
  createRecipient,
  updateRecipient,
  softDeleteRecipient,
  sendTestDigest,
  isValidEmail,
  BRANCH_FILTERS,
  DOC_CATEGORY_OPTIONS,
} from '../lib/fleetAlerts'

// ============================================================================
// FLEET SETTINGS
//
// Manages fleet_alert_recipients — who receives the daily document expiry
// digest, scoped by branch and document category. Includes a per-recipient
// "Send test" that invokes the fleet-expiry-digest edge function immediately.
// ============================================================================

export default function FleetSettings() {
  const { user } = useAuth()
  const toast = useToast()

  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // null | {} | recipient
  const [deleting, setDeleting] = useState(null)
  const [testingId, setTestingId] = useState(null)

  async function load() {
    setLoading(true)
    try {
      setRecipients(await listRecipients())
    } catch (e) {
      toast.show('Failed to load recipients: ' + e.message, 'error')
      setRecipients([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSave(form) {
    try {
      if (editing && editing.id) {
        await updateRecipient({ id: editing.id, form, updatedByEmail: user.email })
        toast.show('Recipient updated')
      } else {
        await createRecipient({ form, createdByEmail: user.email })
        toast.show('Recipient added')
      }
      setEditing(null)
      await load()
    } catch (e) {
      toast.show(e.message, 'error')
    }
  }

  async function handleDelete() {
    if (!deleting) return
    try {
      await softDeleteRecipient({ id: deleting.id, deletedByEmail: user.email })
      toast.show('Recipient removed')
      setDeleting(null)
      await load()
    } catch (e) {
      toast.show(e.message, 'error')
      setDeleting(null)
    }
  }

  async function handleTest(recipient) {
    setTestingId(recipient.id)
    try {
      const res = await sendTestDigest(recipient.id)
      if (res.errors && res.errors.length > 0) {
        toast.show('Send failed: ' + res.errors.join('; '), 'error')
      } else if (res.sent > 0) {
        toast.show(`Test email sent to ${recipient.email}`)
      } else {
        toast.show('Function ran but no email was sent — check recipient is active', 'error')
      }
    } catch (e) {
      toast.show('Test failed: ' + e.message, 'error')
    }
    setTestingId(null)
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1000 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
            Fleet Settings
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Who receives the daily document expiry digest. Each recipient can be scoped
            to a branch and to vehicle and/or driver documents.
          </p>
          <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
        </div>
        <button onClick={() => setEditing({})} style={btnPrimary}>+ Add recipient</button>
      </div>

      {/* Info banner */}
      <div style={{
        marginBottom: 18, padding: '12px 16px',
        background: 'var(--green-light)', border: '1px solid var(--green-muted)',
        borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6,
      }}>
        The digest runs automatically every morning at 7:00 AM IST. It only emails a
        recipient when there are documents expired or expiring within 30 days that match
        their branch and category filters — no "all clear" noise. Use <strong>Send test</strong>
        to preview what a recipient would receive right now.
      </div>

      {/* List */}
      <div style={{
        background: 'var(--white)', border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : recipients.length === 0 ? (
          <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No recipients yet. Add one to start receiving expiry digests.
          </div>
        ) : (
          <>
            <div style={tableHeader}>
              <div style={{ flex: 1, minWidth: 0 }}>Recipient</div>
              <div style={{ flex: '0 0 130px' }}>Branch</div>
              <div style={{ flex: '0 0 150px' }}>Categories</div>
              <div style={{ flex: '0 0 80px' }}>Status</div>
              <div style={{ flex: '0 0 200px', textAlign: 'right' }}>Actions</div>
            </div>
            {recipients.map((r, idx) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 18px', fontSize: 13,
                borderBottom: idx === recipients.length - 1 ? 'none' : '1px solid var(--gray-100)',
                opacity: r.is_active ? 1 : 0.55,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.email}
                  </div>
                  {r.name && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{r.name}</div>
                  )}
                </div>
                <div style={{ flex: '0 0 130px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {BRANCH_FILTERS.find(b => b.value === r.branch_filter)?.label || r.branch_filter}
                </div>
                <div style={{ flex: '0 0 150px', fontSize: 11, color: 'var(--text-muted)' }}>
                  {(r.doc_categories || []).map(c => c === 'vehicle' ? 'Vehicle' : 'Driver').join(' + ')}
                </div>
                <div style={{ flex: '0 0 80px' }}>
                  <span style={{
                    display: 'inline-flex', padding: '2px 9px', fontSize: 10, fontWeight: 600,
                    borderRadius: 999, letterSpacing: '0.04em', textTransform: 'uppercase',
                    background: r.is_active ? 'var(--green-light)' : 'var(--gray-100)',
                    color: r.is_active ? 'var(--green-dark)' : 'var(--text-muted)',
                  }}>
                    {r.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <div style={{ flex: '0 0 200px', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => handleTest(r)}
                    disabled={testingId === r.id}
                    style={btnSecondary}
                  >
                    {testingId === r.id ? 'Sending…' : 'Send test'}
                  </button>
                  <button onClick={() => setEditing(r)} style={btnSecondary}>Edit</button>
                  <button onClick={() => setDeleting(r)} style={btnSecondaryDanger}>Remove</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {editing && (
        <RecipientModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Remove recipient?">
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
            <strong>{deleting.email}</strong> will stop receiving fleet expiry digests.
            You can add them again later.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setDeleting(null)} style={btnSecondary}>Cancel</button>
            <button onClick={handleDelete} style={btnDanger}>Remove</button>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ============================================================================
// Add / edit modal
// ============================================================================
function RecipientModal({ initial, onClose, onSave }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(() => ({
    email:          initial?.email          || '',
    name:           initial?.name           || '',
    branch_filter:  initial?.branch_filter  || 'ALL',
    doc_categories: initial?.doc_categories || ['vehicle', 'driver'],
    is_active:      initial?.is_active != null ? initial.is_active : true,
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: null }))
  }

  function toggleCategory(cat) {
    setForm(f => {
      const has = f.doc_categories.includes(cat)
      const next = has ? f.doc_categories.filter(c => c !== cat) : [...f.doc_categories, cat]
      return { ...f, doc_categories: next }
    })
  }

  function validate() {
    const errs = {}
    if (!isValidEmail(form.email)) errs.email = 'Enter a valid email address'
    if (form.doc_categories.length === 0) errs.doc_categories = 'Pick at least one category'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit recipient' : 'Add recipient'} maxWidth={520}>
      <div style={{ marginBottom: 14 }}>
        <Label>Email address *</Label>
        <input
          type="email"
          value={form.email}
          onChange={e => update('email', e.target.value)}
          placeholder="name@rkacademyballia.in"
          style={inputStyle(!!errors.email)}
          disabled={saving}
          autoFocus={!isEdit}
        />
        {errors.email && <ErrText>{errors.email}</ErrText>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Name (optional)</Label>
        <input
          type="text"
          value={form.name}
          onChange={e => update('name', e.target.value)}
          placeholder="e.g. Akansha Mishra — Principal"
          style={inputStyle(false)}
          disabled={saving}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Branch scope</Label>
        <select
          value={form.branch_filter}
          onChange={e => update('branch_filter', e.target.value)}
          style={inputStyle(false)}
          disabled={saving}
        >
          {BRANCH_FILTERS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <Hint>Which branch's documents this person should be alerted about</Hint>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Document categories *</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {DOC_CATEGORY_OPTIONS.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.doc_categories.includes(opt.value)}
                onChange={() => toggleCategory(opt.value)}
                disabled={saving}
                style={{ marginTop: 2 }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        {errors.doc_categories && <ErrText>{errors.doc_categories}</ErrText>}
      </div>

      <div style={{ marginBottom: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={e => update('is_active', e.target.checked)}
            disabled={saving}
          />
          <span>Active — receives the daily digest</span>
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--gray-100)' }}>
        <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add recipient')}
        </button>
      </div>
    </Modal>
  )
}


// ----------------------------------------------------------------------------
// Bits
// ----------------------------------------------------------------------------
function Label({ children }) {
  return (
    <label style={{
      display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
      marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{children}</label>
  )
}
function Hint({ children }) {
  return <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 3 }}>{children}</div>
}
function ErrText({ children }) {
  return <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>{children}</div>
}
function inputStyle(hasError) {
  return {
    width: '100%', padding: '8px 10px', fontSize: 13,
    border: `1px solid ${hasError ? 'var(--crimson)' : 'var(--gray-200)'}`,
    borderRadius: 'var(--radius-sm)', background: 'var(--white)',
    color: 'var(--text)', fontFamily: 'inherit', outline: 'none',
  }
}

const tableHeader = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
  background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)',
  fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}
const btnPrimary = {
  padding: '7px 16px', background: 'var(--green-dark)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const btnSecondary = {
  padding: '6px 12px', background: 'var(--white)', color: 'var(--text)',
  border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const btnSecondaryDanger = { ...btnSecondary, color: 'var(--crimson)' }
const btnDanger = {
  padding: '7px 16px', background: 'var(--crimson)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
