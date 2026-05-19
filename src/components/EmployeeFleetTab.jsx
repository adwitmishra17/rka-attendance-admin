import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from './Toast'
import { supabaseAdmin } from '../lib/supabase'
import FleetDocumentsSection from './FleetDocumentsSection'

// ============================================================================
// EMPLOYEE FLEET TAB
//
// Shown on the EmployeeProfile page for staff in the Drivers / Conductors
// departments. Two parts:
//   1. Vehicle assignment — current + past assignments for this person
//      (read-only here; assignment management lives on the vehicle profile).
//   2. Driver documents — DL and Aadhaar, via the shared FleetDocumentsSection
//      with ownerType="driver".
//
// Props: employee  (needs .id, .full_name)
// ============================================================================

export default function EmployeeFleetTab({ employee }) {
  const navigate = useNavigate()
  const toast = useToast()

  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [employee?.id])

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabaseAdmin
        .from('vehicle_assignments')
        .select(`
          id, role, status, assigned_from, assigned_to, notes,
          vehicle:vehicles ( id, rc_number, vehicle_type, make, model )
        `)
        .eq('employee_id', employee.id)
        .is('deleted_at', null)
        .order('status', { ascending: true })
        .order('assigned_from', { ascending: false })
      if (error) throw error
      setAssignments(data || [])
    } catch (e) {
      toast.show('Failed to load assignments: ' + e.message, 'error')
      setAssignments([])
    }
    setLoading(false)
  }

  const active = assignments.filter(a => a.status === 'active')
  const past   = assignments.filter(a => a.status !== 'active')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ---- Vehicle assignment ---- */}
      <div>
        <SectionTitle
          title="Vehicle assignment"
          subtitle="Where this person is assigned in the fleet. Manage assignments from the vehicle's own page."
        />

        {loading ? (
          <Muted>Loading…</Muted>
        ) : active.length === 0 ? (
          <div style={emptyCard}>Not currently assigned to any vehicle.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active.map(a => (
              <div
                key={a.id}
                onClick={() => a.vehicle && navigate(`/vehicles/${a.vehicle.id}`)}
                style={{
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--white)',
                  padding: '14px 16px',
                  cursor: a.vehicle ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{
                  flex: '0 0 auto', padding: '2px 9px', borderRadius: 999,
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                  background: 'var(--green-light)', color: 'var(--green-dark)',
                }}>
                  {a.role}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-dark)' }}>
                    {a.vehicle ? formatRc(a.vehicle.rc_number) : '(vehicle removed)'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {a.vehicle && [a.vehicle.make, a.vehicle.model].filter(Boolean).join(' ')}
                    {a.vehicle && (a.vehicle.make || a.vehicle.model) ? ' · ' : ''}
                    Assigned since {fmtDate(a.assigned_from)}
                  </div>
                </div>
                {a.vehicle && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Open →</span>
                )}
              </div>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
            }}>
              Past assignments
            </div>
            <div style={{ border: '1px solid var(--gray-100)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {past.map((a, idx) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', fontSize: 12, background: 'var(--gray-50)',
                  borderBottom: idx === past.length - 1 ? 'none' : '1px solid var(--gray-100)',
                }}>
                  <span style={{ width: 64, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {a.role}
                  </span>
                  <span style={{ flex: '0 0 130px', color: 'var(--text)' }}>
                    {a.vehicle ? formatRc(a.vehicle.rc_number) : '(removed)'}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {fmtDate(a.assigned_from)} – {a.assigned_to ? fmtDate(a.assigned_to) : 'present'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---- Driver documents ---- */}
      <div>
        <SectionTitle
          title="Driver documents"
          subtitle="Driving licence and Aadhaar. Licence expiry feeds the fleet expiry digest."
        />
        <FleetDocumentsSection
          ownerType="driver"
          ownerId={employee.id}
          ownerLabel={employee.full_name}
        />
      </div>
    </div>
  )
}


// ----------------------------------------------------------------------------
// Bits
// ----------------------------------------------------------------------------
function SectionTitle({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{
        fontSize: 13, fontWeight: 600, color: 'var(--green-dark)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {title}
      </h3>
      {subtitle && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

function Muted({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{children}</div>
}

const emptyCard = {
  padding: '16px', border: '1px dashed var(--gray-200)',
  borderRadius: 'var(--radius-lg)', background: 'var(--gray-50)',
  fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center',
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatRc(rc) {
  if (!rc) return ''
  const n = String(rc).toUpperCase().replace(/\s+/g, '')
  const m = n.match(/^([A-Z]{2}\d{1,2})([A-Z]{1,3}\d{1,4})$/)
  return m ? `${m[1]} ${m[2]}` : n
}
