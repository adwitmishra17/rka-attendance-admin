import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import { getVehicle, formatRcForDisplay, VEHICLE_TYPES, VEHICLE_STATUSES } from '../lib/vehicles'
import FleetDocumentsSection from '../components/FleetDocumentsSection'
import VehicleAssignmentsSection from '../components/VehicleAssignmentsSection'
import { branchLabel } from '../lib/branch'

// ============================================================================
// VEHICLE PROFILE
//
// Per-vehicle detail page. Shows:
//   - Header (RC, type, branch, status)
//   - Vehicle info card (read-only — to edit, go back to the list and use the
//     edit modal; keeps this page focused on documents and assignments)
//   - Documents section (RC, Insurance, PUC, Permit, Fitness)
//   - Assignments placeholder (Phase 4 — driver + conductor)
//
// Route: /vehicles/:id
// ============================================================================

export default function VehicleProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { effectiveBranches } = useAuth()

  const [vehicle, setVehicle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    setNotFound(false)
    try {
      const v = await getVehicle(id)
      if (!v) {
        setNotFound(true)
      } else if (!effectiveBranches.includes(v.branch_code)) {
        // Cross-branch protection: branch admins shouldn't see other branches'
        // vehicles even via direct URL.
        setNotFound(true)
      } else {
        setVehicle(v)
      }
    } catch (e) {
      if (e.code === 'PGRST116' || /no rows/i.test(e.message || '')) {
        setNotFound(true)
      } else {
        toast.show('Failed to load vehicle: ' + e.message, 'error')
      }
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ padding: '32px 36px', maxWidth: 1100, fontSize: 13, color: 'var(--text-muted)' }}>
        Loading…
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={{ padding: '32px 36px', maxWidth: 700 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--green-dark)', marginBottom: 8 }}>
          Vehicle not found
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          The vehicle either doesn't exist, was deleted, or belongs to a branch you don't have access to.
        </p>
        <Link to="/vehicles" style={{ fontSize: 13, color: 'var(--green-dark)', textDecoration: 'none', fontWeight: 500 }}>
          ← Back to all vehicles
        </Link>
      </div>
    )
  }

  const v = vehicle
  const typeMeta = VEHICLE_TYPES.find(t => t.value === v.vehicle_type)
  const statusMeta = VEHICLE_STATUSES.find(s => s.value === v.status)

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1100 }}>
      {/* Breadcrumb */}
      <Link to="/vehicles" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 14 }}>
        ← All vehicles
      </Link>

      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: 'var(--green-dark)', letterSpacing: '0.02em' }}>
              {formatRcForDisplay(v.rc_number)}
            </h1>
            <TypeBadge type={v.vehicle_type} />
            <StatusBadge status={v.status} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {[v.make, v.model].filter(Boolean).join(' ') || 'Vehicle details'}
            {v.year_of_manufacture && <span> · {v.year_of_manufacture}</span>}
            <span> · {branchLabel(v.branch_code)}</span>
          </div>
          <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 10, borderRadius: 1 }} />
        </div>
        <button onClick={() => navigate('/vehicles')} style={btnSecondary}>
          Edit details on list page
        </button>
      </div>

      {/* Vehicle info card */}
      <Section title="Vehicle details">
        <InfoGrid>
          <InfoCell label="Make" value={v.make} />
          <InfoCell label="Model" value={v.model} />
          <InfoCell label="Year" value={v.year_of_manufacture} />
          <InfoCell label="Fuel type" value={v.fuel_type} />
          <InfoCell label="Seating capacity" value={v.seating_capacity} />
          <InfoCell label="Registration date" value={fmtDate(v.registration_date)} />
          <InfoCell label="Chassis number" value={v.chassis_number} mono />
          <InfoCell label="Engine number" value={v.engine_number} mono />
          <InfoCell label="Owner (as on RC)" value={v.owner_name} colSpan={2} />
          {v.notes && <InfoCell label="Notes" value={v.notes} colSpan={2} />}
        </InfoGrid>
      </Section>

      {/* Documents */}
      <Section title="Documents" subtitle="RC, Insurance, PUC, Permit, and Fitness certificates. Expiries are tracked for renewal alerts.">
        <FleetDocumentsSection
          ownerType="vehicle"
          ownerId={v.id}
          ownerLabel={formatRcForDisplay(v.rc_number)}
        />
      </Section>

      {/* Assignments — Phase 4 placeholder */}
      <Section
        title="Driver & conductor"
        subtitle={v.vehicle_type === 'bus' ? 'Assign one driver and one conductor from HRMS employees.' : 'Assign one driver from HRMS employees.'}
      >
        <div style={{
          padding: '18px 16px',
          border: '1px dashed var(--gray-200)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--gray-50)',
          fontSize: 12.5,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}>
          Assignment management coming in Phase 4.
        </div>
      </Section>
    </div>
  )
}


// ============================================================================
// Helpers
// ============================================================================
function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-dark)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function InfoGrid({ children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 0,
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--white)',
      overflow: 'hidden',
    }}>
      {children}
    </div>
  )
}

function InfoCell({ label, value, mono, colSpan }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderBottom: '1px solid var(--gray-100)',
      borderRight: '1px solid var(--gray-100)',
      gridColumn: colSpan ? `span ${colSpan}` : undefined,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        color: value == null || value === '' ? 'var(--gray-400)' : 'var(--text)',
        fontFamily: mono ? 'var(--font-mono, ui-monospace, monospace)' : 'inherit',
        fontStyle: (value == null || value === '') ? 'italic' : 'normal',
      }}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  )
}

function TypeBadge({ type }) {
  const isBus = type === 'bus'
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 9px', fontSize: 10, fontWeight: 600,
      borderRadius: 999,
      background: isBus ? 'var(--green-light)' : 'var(--gold-light)',
      color: isBus ? 'var(--green-dark)' : 'var(--gold-dark)',
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      {isBus ? 'Bus' : 'Small'}
    </span>
  )
}

function StatusBadge({ status }) {
  const map = {
    active: { bg: 'var(--green-light)', fg: 'var(--green-dark)', label: 'Active' },
    inactive: { bg: 'var(--gray-100)', fg: 'var(--text-muted)', label: 'Inactive' },
    sold: { bg: 'var(--gold-light)', fg: 'var(--gold-dark)', label: 'Sold' },
    scrapped: { bg: 'var(--crimson-light)', fg: 'var(--crimson)', label: 'Scrapped' },
  }
  const s = map[status] || map.inactive
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 9px', fontSize: 10, fontWeight: 600,
      borderRadius: 999, background: s.bg, color: s.fg,
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  )
}

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const btnSecondary = {
  padding: '7px 14px', background: 'var(--white)', color: 'var(--text)',
  border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
