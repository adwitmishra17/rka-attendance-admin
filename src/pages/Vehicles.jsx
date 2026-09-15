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
import { listEligibleEmployees } from '../lib/vehicleAssignments'
import {
  Page, PageHead, Card, CardHead, PrimaryButton, Chip, SearchInput, LoadingBlock, EmptyBlock, PlusIcon,
  primaryButtonStyle, secondaryButtonStyle, dangerButtonStyle, smallSecondaryButtonStyle,
} from '../components/ui'

// ============================================================================
// VEHICLES
//
// Two sections:
//   1. Fleet vehicles — list, add, edit, soft-delete. Click an RC to open the
//      detail page (documents, assignments).
//   2. Unassigned drivers & conductors — HRMS staff in the Drivers/Conductors
//      departments not currently assigned to any vehicle.
//
// Branch-aware: super admin sees both branches; branch admins see their own.
// ============================================================================

export default function Vehicles() {
  const { user, effectiveBranches, allowedBranches, canSwitchBranches, currentBranch } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  // Unassigned fleet staff
  const [unassignedDrivers, setUnassignedDrivers] = useState([])
  const [unassignedConductors, setUnassignedConductors] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)

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

  // Unassigned drivers + conductors — reuses listEligibleEmployees, which by
  // definition returns department staff with no active assignment.
  async function loadStaff() {
    setLoadingStaff(true)
    try {
      const inBranch = (emp) =>
        !emp.branch_codes ||
        emp.branch_codes.length === 0 ||
        emp.branch_codes.some(bc => effectiveBranches.includes(bc))

      let drivers = []
      let conductors = []
      try {
        drivers = (await listEligibleEmployees({ role: 'driver' })).filter(inBranch)
      } catch (e) {
        console.warn('drivers fetch:', e.message)
      }
      try {
        conductors = (await listEligibleEmployees({ role: 'conductor' })).filter(inBranch)
      } catch (e) {
        console.warn('conductors fetch:', e.message)
      }
      setUnassignedDrivers(drivers)
      setUnassignedConductors(conductors)
    } finally {
      setLoadingStaff(false)
    }
  }

  useEffect(() => {
    load()
    loadStaff()
  }, [effectiveBranches])

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
    <Page>
      <PageHead
        title="Vehicles"
        sub="School fleet — buses and small vehicles. Open a vehicle to manage its documents and assignments."
        actions={<PrimaryButton icon={<PlusIcon />} onClick={() => setEditing({})}>Add vehicle</PrimaryButton>}
      />

      {/* ============ SECTION 1 — VEHICLES ============ */}
      <Card>
        <CardHead
          title="Fleet vehicles"
          sub={loading ? 'Loading…' : `${filtered.length} shown`}
          right={<SearchInput value={search} onChange={setSearch} placeholder="Search RC, make, model…" width={240} />}
        />
        <div style={{ display: 'flex', gap: 6, padding: '10px 18px', borderBottom: '1px solid var(--gray-100)', flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'active',   label: 'Active',   count: counts.active },
              { value: 'inactive', label: 'Inactive', count: counts.inactive },
              { value: 'sold',     label: 'Sold',     count: counts.sold },
              { value: 'scrapped', label: 'Scrapped', count: counts.scrapped },
              { value: 'all',      label: 'All',      count: counts.all },
            ]}
          />
          <div style={{ width: 1, height: 20, background: 'var(--gray-200)', margin: '0 6px' }} />
          <FilterChips
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all',   label: 'All types' },
              { value: 'bus',   label: 'Buses' },
              { value: 'small', label: 'Small' },
            ]}
          />
        </div>

        {loading ? (
          <LoadingBlock label="Loading vehicles…" />
        ) : filtered.length === 0 ? (
          <EmptyBlock
            title={vehicles.length === 0 ? 'No vehicles yet' : 'No vehicles match'}
            sub={vehicles.length === 0 ? 'Add a vehicle to register it in the fleet.' : 'Try another status or type, or clear the search.'}
            action={vehicles.length === 0 && <PrimaryButton icon={<PlusIcon />} onClick={() => setEditing({})}>Add vehicle</PrimaryButton>}
          />
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
      </Card>

      {/* ============ SECTION 2 — UNASSIGNED STAFF ============ */}
      <Card>
        <CardHead
          title="Unassigned drivers & conductors"
          sub="HRMS staff in the Drivers and Conductors departments not currently assigned to any vehicle."
        />
        <UnassignedFleetSection
          drivers={unassignedDrivers}
          conductors={unassignedConductors}
          loading={loadingStaff}
          onOpenEmployee={(id) => navigate(`/employees/${id}`)}
        />
      </Card>

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
    </Page>
  )
}


// ============================================================================
// Unassigned drivers & conductors — body of the card (head lives in the page)
// ============================================================================
function UnassignedFleetSection({ drivers, conductors, loading, onOpenEmployee }) {
  const total = drivers.length + conductors.length
  const allAssigned = !loading && total === 0

  const rows = [
    ...drivers.map(e => ({ ...e, role: 'driver' })),
    ...conductors.map(e => ({ ...e, role: 'conductor' })),
  ]

  if (loading) return <LoadingBlock label="Loading staff…" />

  if (allAssigned) {
    return (
      <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--green-light)', color: 'var(--green-dark)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>Every driver and conductor in HRMS is assigned to a vehicle.</div>
      </div>
    )
  }

  return (
    <>
      <div style={{
        padding: '9px 18px',
        background: 'var(--gray-50)',
        borderBottom: '1px solid var(--gray-100)',
        fontSize: 11.5, color: 'var(--text-muted)',
      }}>
        {drivers.length} driver{drivers.length === 1 ? '' : 's'}
        {' · '}
        {conductors.length} conductor{conductors.length === 1 ? '' : 's'}
        {' awaiting assignment'}
      </div>
      {rows.map((e, idx) => (
        <div
          key={`${e.role}-${e.id}`}
          onClick={() => onOpenEmployee(e.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 18px', fontSize: 13, cursor: 'pointer',
            borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--gray-100)',
            transition: 'background 0.12s',
          }}
          onMouseEnter={ev => ev.currentTarget.style.background = 'var(--gray-50)'}
          onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}
        >
          <span style={{
            flex: '0 0 auto', padding: '2px 9px', borderRadius: 999,
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            background: e.role === 'driver' ? 'var(--green-light)' : 'var(--gold-light)',
            color: e.role === 'driver' ? 'var(--green-dark)' : 'var(--gold-dark)',
          }}>
            {e.role}
          </span>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.full_name}
          </span>
          {e.employee_code && (
            <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--gray-400)' }}>
              #{e.employee_code}
            </span>
          )}
          <span style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
            Open →
          </span>
        </div>
      ))}
    </>
  )
}


// ============================================================================
// Vehicle row — RC is clickable and navigates to the detail page
// ============================================================================
function VehicleRow({ vehicle, last, showBranch, onOpen, onEdit, onDelete }) {
  const v = vehicle
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 18px',
      borderBottom: last ? 'none' : '1px solid var(--gray-100)',
      fontSize: 13,
    }}>
      <div
        onClick={onOpen}
        style={{
          flex: '0 0 130px',
          fontWeight: 600,
          color: 'var(--text)',
          letterSpacing: '0.02em',
          cursor: 'pointer',
          fontVariantNumeric: 'tabular-nums',
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
        <div style={{ flex: '0 0 100px', fontSize: 11.5, color: 'var(--text-muted)' }}>
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
        <button onClick={onOpen}    style={btnRow}>Open</button>
        <button onClick={onEdit}    style={btnRow}>Edit</button>
        <button onClick={onDelete}  style={btnRowDanger}>Delete</button>
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
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => (
        <Chip key={o.value} active={o.value === value} onClick={() => onChange(o.value)} count={o.count}>
          {o.label}
        </Chip>
      ))}
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
  borderBottom: '1px solid var(--gray-100)',
  fontSize: 10.5,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const btnPrimary = primaryButtonStyle
const btnSecondary = secondaryButtonStyle
const btnDanger = dangerButtonStyle
const btnRow = smallSecondaryButtonStyle
const btnRowDanger = { ...smallSecondaryButtonStyle, color: 'var(--crimson)' }
