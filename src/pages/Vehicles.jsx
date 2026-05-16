import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { BRANCHES, branchLabel } from '../lib/branch'
import {
  listVehicles,
  createVehicle,
  updateVehicle,
  softDeleteVehicle,
  formatRcForDisplay,
  normalizeRc,
  validateRc,
  FUEL_TYPES,
  VEHICLE_TYPES,
  VEHICLE_STATUSES,
} from '../lib/vehicles'

// ============================================================================
// VEHICLES
//
// Fleet vehicles list — add, edit, soft-delete. Branch-aware (super admin
// sees both branches via the global BranchSwitcher; branch admins see only
// their own).
//
// Click an RC number to open the vehicle's detail page (documents,
// assignments).
// ============================================================================

export default function Vehicles() {
  const { user, effectiveBranches, allowedBranches, canSwitchBranches, currentBranch } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // null | {} (add) | vehicle (edit)
  const [deleting, setDeleting] = useState(null) // null | vehicle

  // Filters
  const [statusFilter, setStatusFilter] = useState('active')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [search, setSearch]             = useState('')

  async function load() {
    setLoading(true)
    try {
      const list = await listVehicles({ effectiveBranches })
      setVehicles(list)
    } catch (e) {
      toast.show('Failed to load vehicles: ' + e.message, 'error')
      setVehicles([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [effectiveBranches])

  const filtered = useMemo(() => {
    let list = vehicles
    if (statusFilter !== 'all') list = list.filter(v => v.status === statusFilter)
    if (typeFilter !== 'all')   list = list.filter(v => v.vehicle_type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v =>
        (v.rc_number || '').toLowerCase().includes(q) ||
        (v.make || '').toLowerCase().includes(q) ||
        (v.model || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [vehicles, statusFilter, typeFilter, search])

  const counts = useMemo(() => ({
    active:   vehicles.filter(v => v.status === 'active').length,
    inactive: vehicles.filter(v => v.status === 'inactive').length,
    sold:     vehicles.filter(v => v.status === 'sold').length,
    scrapped: vehicles.filter(v => v.status === 'scrapped').length,
    all:      vehicles.length,
  }), [vehicles])

  async function handleSave(form) {
    try {
      if (editing && editing.id) {
        await updateVehicle({
          id: editing.id,
          form,
          originalForm: editing,
          updatedByEmail: user?.email,
        })
        toast.show('Vehicle updated')
      } else {
        await createVehicle({ form, createdByEmail: user?.email })
        toast.show('Vehicle added')
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
      await softDeleteVehicle({ id: deleting.id, deletedByEmail: user?.email })
      toast.show('Vehicle deleted')
      setDeleting(null)
      await load()
    } catch (e) {
      toast.show(e.message, 'error')
      setDeleting(null)
    }
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1200 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
            Vehicles
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            School fleet — buses and small vehicles. Click an RC to manage documents and assignments.
          </p>
          <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
        </div>
        <button onClick={() => setEditing({})} style={btnPrimary}>
          + Add vehicle
        </button>
      </div>

      {/* Filters row */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterChips
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'active',   label: `Active (${counts.active})` },
            { value: 'inactive', label: `Inactive (${counts.inactive})` },
            { value: 'sold',     label: `Sold (${counts.sold})` },
            { value: 'scrapped', label: `Scrapped (${counts.scrapped})` },
            { value: 'all',      label: `All (${counts.all})` },
          ]}
        />
        <div style={{ width: 1, height: 22, background: 'var(--gray-200)' }} />
        <FilterChips
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: 'all',   label: 'All types' },
            { value: 'bus',   label: 'Buses' },
            { value: 'small', label: 'Small' },
          ]}
        />
        <div style={{ flex: 1 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search RC, make, model…"
          style={{
            padding: '7px 12px',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 13,
            width: 240,
            background: 'var(--white)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* List */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {vehicles.length === 0
              ? 'No vehicles yet. Click + Add vehicle to register one.'
              : 'No vehicles match the current filters.'}
          </div>
        ) : (
          <>
            <div style={tableHeader}>
              <div style={{ flex: '0 0 130px' }}>RC Number</div>
              <div style={{ flex: '0 0 80px' }}>Type</div>
              <div style={{ flex: 1, minWidth: 0 }}>Make / Model</div>
              {canSwitchBranches && (
                <div style={{ flex: '0 0 100px' }}>Branch</div>
              )}
              <div style={{ flex: '0 0 180px', minWidth: 0 }}>Driver / Conductor</div>
              <div style={{ flex: '0 0 80px' }}>Status</div>
              <div style={{ flex: '0 0 170px', textAlign: 'right' }}>Actions</div>
            </div>
            {filtered.map((v, idx) => (
              <VehicleRow
                key={v.id}
                vehicle={v}
                last={idx === filtered.length - 1}
                showBranch={canSwitchBranches}
                onOpen={() => navigate(`/vehicles/${v.id}`)}
                onEdit={() => setEditing(v)}
                onDelete={() => setDeleting(v)}
              />
            ))}
          </>
        )}
      </div>

      {/* Edit/Add modal */}
      {editing && (
        <VehicleFormModal
          initial={editing}
          allowedBranches={allowedBranches}
          defaultBranch={currentBranch || allowedBranches[0]}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {/* Delete confirm modal */}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete vehicle?">
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
            Vehicle <strong>{formatRcForDisplay(deleting.rc_number)}</strong>
            {deleting.make && <> ({deleting.make} {deleting.model})</>} will be soft-deleted.
            Historical records are preserved and the row can be restored later if needed.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setDeleting(null)} style={btnSecondary}>Cancel</button>
            <button onClick={handleDelete} style={btnDanger}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ============================================================================
// Row — RC is clickable and navigates to the detail page
// ============================================================================
function VehicleRow({ vehicle, last, showBranch, onOpen, onEdit, onDelete }) {
  const v = vehicle
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '14px 18px',
      borderBottom: last ? 'none' : '1px solid var(--gray-100)',
      fontSize: 13,
    }}>
      {/* RC number — clickable, navigates to detail page */}
      <div
        onClick={onOpen}
        style={{
          flex: '0 0 130px',
          fontWeight: 600,
          color: 'var(--green-dark)',
          letterSpacing: '0.02em',
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationColor: 'var(--gray-200)',
          textDecorationThickness: 1,
          textUnderlineOffset: 3,
        }}
        title="Open vehicle"
        role="link"
      >
        {formatRcForDisplay(v.rc_number)}
      </div>
      <div style={{ flex: '0 0 80px' }}>
        <TypeBadge type={v.vehicle_type} />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {v.make || v.model
          ? <span>{[v.make, v.model].filter(Boolean).join(' ')}{v.year_of_manufacture ? <span style={{ color: 'var(--gray-400)' }}> · {v.year_of_manufacture}</span> : null}</span>
          : <span style={{ color: 'var(--gray-400)' }}>—</span>}
      </div>
      {showBranch && (
        <div style={{ flex: '0 0 100px', fontSize: 11, color: 'var(--text-muted)' }}>
          {branchLabel(v.branch_code)}
        </div>
      )}
      <div style={{ flex: '0 0 180px', minWidth: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        {v.driver
          ? <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text)' }}>{v.driver.full_name}</span>
            </div>
          : <div style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>No driver</div>}
        {v.vehicle_type === 'bus' && (
          v.conductor
            ? <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--text)' }}>{v.conductor.full_name}</span>
                <span style={{ color: 'var(--gray-400)' }}> (cond.)</span>
              </div>
            : <div style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>No conductor</div>
        )}
      </div>
      <div style={{ flex: '0 0 80px' }}>
        <StatusBadge status={v.status} />
      </div>
      <div style={{ flex: '0 0 170px', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onOpen}    style={btnSecondary}>Open</button>
        <button onClick={onEdit}    style={btnSecondary}>Edit</button>
        <button onClick={onDelete}  style={btnSecondaryDanger}>Delete</button>
      </div>
    </div>
  )
}


// ============================================================================
// Badges
// ============================================================================
function TypeBadge({ type }) {
  const isBus = type === 'bus'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      fontSize: 10,
      fontWeight: 600,
      borderRadius: 999,
      background: isBus ? 'var(--green-light)' : 'var(--gold-light)',
      color: isBus ? 'var(--green-dark)' : 'var(--gold-dark)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      {isBus ? 'Bus' : 'Small'}
    </span>
  )
}

function StatusBadge({ status }) {
  const map = {
    active:   { bg: 'var(--green-light)',   fg: 'var(--green-dark)',   label: 'Active' },
    inactive: { bg: 'var(--gray-100)',      fg: 'var(--text-muted)',   label: 'Inactive' },
    sold:     { bg: 'var(--gold-light)',    fg: 'var(--gold-dark)',    label: 'Sold' },
    scrapped: { bg: 'var(--crimson-light)', fg: 'var(--crimson)',      label: 'Scrapped' },
  }
  const s = map[status] || map.inactive
  return (
    <span style={{
      display: 'inline-flex',
      padding: '2px 9px',
      fontSize: 10,
      fontWeight: 600,
      borderRadius: 999,
      background: s.bg,
      color: s.fg,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  )
}


// ============================================================================
// Filter chips
// ============================================================================
function FilterChips({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid',
              borderColor: active ? 'var(--green-dark)' : 'var(--gray-200)',
              background: active ? 'var(--green-dark)' : 'var(--white)',
              color: active ? 'white' : 'var(--text)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}


// ============================================================================
// Form modal (add + edit)
// ============================================================================
function VehicleFormModal({ initial, allowedBranches, defaultBranch, onClose, onSave }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(() => ({
    rc_number:           initial?.rc_number           || '',
    branch_code:         initial?.branch_code         || defaultBranch || allowedBranches[0],
    vehicle_type:        initial?.vehicle_type        || 'bus',
    make:                initial?.make                || '',
    model:               initial?.model               || '',
    year_of_manufacture: initial?.year_of_manufacture || '',
    seating_capacity:    initial?.seating_capacity    || '',
    fuel_type:           initial?.fuel_type           || 'Diesel',
    chassis_number:      initial?.chassis_number      || '',
    engine_number:       initial?.engine_number       || '',
    owner_name:          initial?.owner_name          || 'Radhakrishna Academy',
    registration_date:   initial?.registration_date   || '',
    status:              initial?.status              || 'active',
    notes:               initial?.notes               || '',
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: null }))
  }

  function clientValidate() {
    const errs = {}
    const rcErr = validateRc(form.rc_number)
    if (rcErr) errs.rc_number = rcErr
    if (!form.branch_code)  errs.branch_code  = 'Branch is required'
    if (!form.vehicle_type) errs.vehicle_type = 'Vehicle type is required'
    if (form.year_of_manufacture !== '' && form.year_of_manufacture != null) {
      const y = parseInt(form.year_of_manufacture, 10)
      const now = new Date().getFullYear()
      if (isNaN(y) || y < 1980 || y > now + 1) {
        errs.year_of_manufacture = `Year must be between 1980 and ${now + 1}`
      }
    }
    if (form.seating_capacity !== '' && form.seating_capacity != null) {
      const c = parseInt(form.seating_capacity, 10)
      if (isNaN(c) || c <= 0) errs.seating_capacity = 'Must be a positive number'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!clientValidate()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit vehicle ${formatRcForDisplay(initial.rc_number)}` : 'Add vehicle'}
      maxWidth={620}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="RC Number *" error={errors.rc_number}>
          <input
            type="text"
            value={form.rc_number}
            onChange={e => update('rc_number', e.target.value)}
            placeholder="e.g. UP60AB1234"
            style={inputStyle(!!errors.rc_number)}
            autoFocus={!isEdit}
            disabled={saving}
          />
        </Field>
        <Field label="Branch *" error={errors.branch_code}>
          <select
            value={form.branch_code}
            onChange={e => update('branch_code', e.target.value)}
            disabled={saving || allowedBranches.length === 1}
            style={inputStyle(!!errors.branch_code)}
          >
            {BRANCHES.filter(b => allowedBranches.includes(b.code)).map(b => (
              <option key={b.code} value={b.code}>{b.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Vehicle type *" error={errors.vehicle_type}>
          <select
            value={form.vehicle_type}
            onChange={e => update('vehicle_type', e.target.value)}
            disabled={saving}
            style={inputStyle(!!errors.vehicle_type)}
          >
            {VEHICLE_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <Hint>{VEHICLE_TYPES.find(t => t.value === form.vehicle_type)?.description}</Hint>
        </Field>
        <Field label="Status">
          <select
            value={form.status}
            onChange={e => update('status', e.target.value)}
            disabled={saving}
            style={inputStyle(false)}
          >
            {VEHICLE_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Make">
          <input
            type="text"
            value={form.make}
            onChange={e => update('make', e.target.value)}
            placeholder="e.g. Tata, Mahindra"
            style={inputStyle(false)}
            disabled={saving}
          />
        </Field>
        <Field label="Model">
          <input
            type="text"
            value={form.model}
            onChange={e => update('model', e.target.value)}
            placeholder="e.g. Starbus, Bolero"
            style={inputStyle(false)}
            disabled={saving}
          />
        </Field>

        <Field label="Year of manufacture" error={errors.year_of_manufacture}>
          <input
            type="number"
            value={form.year_of_manufacture}
            onChange={e => update('year_of_manufacture', e.target.value)}
            placeholder="e.g. 2019"
            style={inputStyle(!!errors.year_of_manufacture)}
            disabled={saving}
            min="1980"
            max="2100"
          />
        </Field>
        <Field label="Seating capacity" error={errors.seating_capacity}>
          <input
            type="number"
            value={form.seating_capacity}
            onChange={e => update('seating_capacity', e.target.value)}
            placeholder="e.g. 32"
            style={inputStyle(!!errors.seating_capacity)}
            disabled={saving}
            min="1"
          />
        </Field>

        <Field label="Fuel type">
          <select
            value={form.fuel_type}
            onChange={e => update('fuel_type', e.target.value)}
            disabled={saving}
            style={inputStyle(false)}
          >
            {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Registration date">
          <input
            type="date"
            value={form.registration_date || ''}
            onChange={e => update('registration_date', e.target.value)}
            style={inputStyle(false)}
            disabled={saving}
          />
        </Field>

        <Field label="Chassis number">
          <input
            type="text"
            value={form.chassis_number}
            onChange={e => update('chassis_number', e.target.value)}
            style={inputStyle(false)}
            disabled={saving}
          />
        </Field>
        <Field label="Engine number">
          <input
            type="text"
            value={form.engine_number}
            onChange={e => update('engine_number', e.target.value)}
            style={inputStyle(false)}
            disabled={saving}
          />
        </Field>

        <Field label="Owner name (as on RC)" colSpan={2}>
          <input
            type="text"
            value={form.owner_name}
            onChange={e => update('owner_name', e.target.value)}
            style={inputStyle(false)}
            disabled={saving}
          />
        </Field>

        <Field label="Notes" colSpan={2}>
          <textarea
            value={form.notes}
            onChange={e => update('notes', e.target.value)}
            rows={2}
            placeholder="Internal notes — anything not covered by the fields above"
            style={{ ...inputStyle(false), resize: 'vertical', fontFamily: 'inherit' }}
            disabled={saving}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)' }}>
        <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add vehicle')}
        </button>
      </div>
    </Modal>
  )
}


// ----------------------------------------------------------------------------
// Field wrapper
// ----------------------------------------------------------------------------
function Field({ label, error, colSpan = 1, children }) {
  return (
    <div style={{ gridColumn: colSpan === 2 ? 'span 2' : 'span 1' }}>
      <label style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-muted)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {label}
      </label>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function Hint({ children }) {
  return (
    <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 3 }}>{children}</div>
  )
}


// ----------------------------------------------------------------------------
// Shared styles
// ----------------------------------------------------------------------------
function inputStyle(hasError) {
  return {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: `1px solid ${hasError ? 'var(--crimson)' : 'var(--gray-200)'}`,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--white)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    outline: 'none',
  }
}

const tableHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 18px',
  background: 'var(--gray-50)',
  borderBottom: '1px solid var(--gray-200)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const btnPrimary = {
  padding: '7px 16px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const btnSecondary = {
  padding: '6px 12px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const btnSecondaryDanger = { ...btnSecondary, color: 'var(--crimson)' }

const btnDanger = {
  padding: '7px 16px',
  background: 'var(--crimson)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
