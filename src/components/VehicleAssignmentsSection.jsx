import React, { useEffect, useState, useMemo } from 'react'
import { useAuth } from '../App'
import { useToast } from './Toast'
import Modal from './Modal'
import {
  listAssignments,
  listEligibleEmployees,
  createAssignment,
  endAssignment,
  isActive,
  fmtDateDDMMYY,
  fmtDateRange,
} from '../lib/vehicleAssignments'

// ============================================================================
// VEHICLE ASSIGNMENTS SECTION
//
// Renders the "Driver & conductor" area on the vehicle profile.
//   - Bus  → driver row + conductor row
//   - Small → driver row only
//
// Each role row shows: current active assignment OR "Not assigned" + button.
// Below the role rows, a collapsible history of past assignments.
// ============================================================================

export default function VehicleAssignmentsSection({ vehicle }) {
  const { user } = useAuth()
  const toast = useToast()

  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [assignFor, setAssignFor] = useState(null)   // null | role string
  const [endingForRole, setEndingForRole] = useState(null) // null | { role, assignment }
  const [historyOpen, setHistoryOpen] = useState(false)

  async function reload() {
    setLoading(true)
    try {
      const list = await listAssignments(vehicle.id)
      setAssignments(list)
    } catch (e) {
      toast.show('Failed to load assignments: ' + e.message, 'error')
      setAssignments([])
    }
    setLoading(false)
  }

  useEffect(() => { reload() }, [vehicle.id])

  const active = useMemo(() => ({
    driver:    assignments.find(a => isActive(a) && a.role === 'driver')    || null,
    conductor: assignments.find(a => isActive(a) && a.role === 'conductor') || null,
  }), [assignments])

  const history = useMemo(() => assignments.filter(a => !isActive(a)), [assignments])

  // ---- Actions ----
  async function handleEndConfirm() {
    if (!endingForRole) return
    const { assignment } = endingForRole
    try {
      await endAssignment({
        assignmentId: assignment.id,
        endedByEmail: user.email,
      })
      toast.show(`${assignment.role === 'driver' ? 'Driver' : 'Conductor'} assignment ended`)
      setEndingForRole(null)
      await reload()
    } catch (e) {
      toast.show('Failed to end: ' + e.message, 'error')
    }
  }

  // ---- Render ----
  const showConductor = vehicle.vehicle_type === 'bus'

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <RoleRow
          role="driver"
          assignment={active.driver}
          onAssign={() => setAssignFor('driver')}
          onEnd={() => setEndingForRole({ role: 'driver', assignment: active.driver })}
        />
        {showConductor && (
          <RoleRow
            role="conductor"
            assignment={active.conductor}
            onAssign={() => setAssignFor('conductor')}
            onEnd={() => setEndingForRole({ role: 'conductor', assignment: active.conductor })}
          />
        )}
      </div>

      {loading && assignments.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Loading assignments…
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button
            onClick={() => setHistoryOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span>{historyOpen ? '▾' : '▸'}</span>
            <span>History ({history.length})</span>
          </button>
          {historyOpen && (
            <div style={{
              marginTop: 10,
              border: '1px solid var(--gray-100)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
            }}>
              {history.map((h, idx) => (
                <HistoryRow key={h.id} a={h} last={idx === history.length - 1} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assign modal */}
      {assignFor && (
        <AssignModal
          role={assignFor}
          vehicle={vehicle}
          onClose={() => setAssignFor(null)}
          onAssigned={() => { setAssignFor(null); reload() }}
        />
      )}

      {/* End confirm modal */}
      {endingForRole && (
        <Modal open onClose={() => setEndingForRole(null)} title="End assignment?">
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
            End the {endingForRole.role} assignment of <strong>{endingForRole.assignment.employee?.full_name}</strong>?
            Today's date will be recorded as the end date and the row stays in history.
            You can then assign someone else to this role.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setEndingForRole(null)} style={btnSecondary}>Cancel</button>
            <button onClick={handleEndConfirm} style={btnDanger}>End assignment</button>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ============================================================================
// One row per role (driver / conductor)
// ============================================================================
function RoleRow({ role, assignment, onAssign, onEnd }) {
  const label = role === 'driver' ? 'Driver' : 'Conductor'

  return (
    <div style={{
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--white)',
      padding: '14px 16px',
      display: 'flex', gap: 14, alignItems: 'flex-start',
    }}>
      <div style={{ flex: '0 0 170px', paddingTop: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
          {role === 'driver'
            ? 'From the Drivers department in HRMS'
            : 'From the Conductors department in HRMS'}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {assignment ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
              {assignment.employee?.full_name || '(employee not found)'}
              {assignment.employee?.employee_code && (
                <span style={{ color: 'var(--gray-400)', fontWeight: 400, marginLeft: 8 }}>
                  #{assignment.employee.employee_code}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
              Assigned since {fmtDateDDMMYY(assignment.assigned_from)}
              {assignment.notes && (
                <span style={{ color: 'var(--gray-400)' }}> · {assignment.notes}</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--gray-400)', fontStyle: 'italic', paddingTop: 4 }}>
            Not assigned
          </div>
        )}
      </div>

      <div style={{ flex: '0 0 auto' }}>
        {assignment ? (
          <button onClick={onEnd} style={btnSecondaryDanger}>End assignment</button>
        ) : (
          <button onClick={onAssign} style={btnPrimary}>Assign {label.toLowerCase()}</button>
        )}
      </div>
    </div>
  )
}


// ============================================================================
// History row (collapsed)
// ============================================================================
function HistoryRow({ a, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      borderBottom: last ? 'none' : '1px solid var(--gray-100)',
      fontSize: 12, background: 'var(--gray-50)',
    }}>
      <span style={{
        display: 'inline-block', width: 60, fontSize: 10, fontWeight: 600,
        color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {a.role}
      </span>
      <span style={{ flex: '0 0 200px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.employee?.full_name || '(unknown)'}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>
        {fmtDateRange(a.assigned_from, a.assigned_to)}
      </span>
      {a.notes && (
        <span style={{ marginLeft: 8, color: 'var(--gray-400)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          · {a.notes}
        </span>
      )}
    </div>
  )
}


// ============================================================================
// Assign modal — pick employee + date + notes
// ============================================================================
function AssignModal({ role, vehicle, onClose, onAssigned }) {
  const { user } = useAuth()
  const toast = useToast()

  const [eligible, setEligible] = useState([])
  const [loadingEligible, setLoadingEligible] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [assignedFrom, setAssignedFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoadingEligible(true)
    listEligibleEmployees({ role })
      .then(list => { if (!cancelled) setEligible(list) })
      .catch(e => { if (!cancelled) setError(e.message); setEligible([]) })
      .finally(() => { if (!cancelled) setLoadingEligible(false) })
    return () => { cancelled = true }
  }, [role])

  async function handleSubmit() {
    if (!employeeId) {
      setError('Pick an employee first')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createAssignment({
        vehicleId: vehicle.id,
        employeeId,
        role,
        assignedFrom,
        notes: notes.trim() || null,
        createdByEmail: user.email,
      })
      toast.show(`${role === 'driver' ? 'Driver' : 'Conductor'} assigned`)
      onAssigned()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const roleLabel = role === 'driver' ? 'driver' : 'conductor'
  const deptLabel = role === 'driver' ? 'Drivers' : 'Conductors'

  return (
    <Modal open onClose={saving ? () => {} : onClose} title={`Assign ${roleLabel}`} maxWidth={520}>
      {loadingEligible ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading eligible employees…
        </div>
      ) : eligible.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          No eligible employees in the <strong>{deptLabel}</strong> department.
          <div style={{ marginTop: 10, fontSize: 12 }}>
            Either there are no active employees in that department, or all of them already
            have an active vehicle assignment. End an existing assignment, or add an employee
            to <strong>{deptLabel}</strong> from the Employees page.
          </div>
        </div>
      ) : (
        <>
          <Field label="Employee *">
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              style={inputStyle(!!error && !employeeId)}
              disabled={saving}
            >
              <option value="">— select —</option>
              {eligible.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}{emp.employee_code ? ` (#${emp.employee_code})` : ''}
                </option>
              ))}
            </select>
            <Hint>
              {eligible.length} {deptLabel.toLowerCase()} available
              (active employees in {deptLabel} not already assigned elsewhere)
            </Hint>
          </Field>

          <Field label="Assigned from">
            <input
              type="date"
              value={assignedFrom}
              onChange={e => setAssignedFrom(e.target.value)}
              style={inputStyle(false)}
              disabled={saving}
            />
            <Hint>Defaults to today</Hint>
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Internal note — context for why, route, etc."
              style={{ ...inputStyle(false), resize: 'vertical', fontFamily: 'inherit' }}
              disabled={saving}
            />
          </Field>
        </>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--crimson-light)', color: 'var(--crimson)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--gray-100)' }}>
        <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving || eligible.length === 0} style={btnPrimary}>
          {saving ? 'Assigning…' : `Assign ${roleLabel}`}
        </button>
      </div>
    </Modal>
  )
}


// ----------------------------------------------------------------------------
// Shared bits (kept local to mirror DocumentsSection style)
// ----------------------------------------------------------------------------
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Hint({ children }) {
  return (
    <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 3 }}>{children}</div>
  )
}

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
