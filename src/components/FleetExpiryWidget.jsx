import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'

// ============================================================================
// FLEET EXPIRY WIDGET
//
// Dashboard panel showing FLEET documents (vehicle_documents +
// driver_documents) that are already expired OR will expire in the next
// 30 days. Sorted soonest-first so the oldest overdue items surface at the
// top. Branch-aware via useAuth().effectiveBranches.
//
// Click a row → navigate to the vehicle or employee page.
//
// Drop-in: <FleetExpiryWidget />  (no props)
// ============================================================================

export default function FleetExpiryWidget() {
  const navigate = useNavigate()
  const { effectiveBranches } = useAuth()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [effectiveBranches])

  async function load() {
    setLoading(true)
    setError('')
    if (!supabaseAdmin) {
      setError('Admin client not initialised')
      setLoading(false)
      return
    }
    try {
      const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

      // Vehicle documents — expired OR expiring within 30 days
      const { data: vehDocs, error: ve } = await supabaseAdmin
        .from('vehicle_documents')
        .select(`
          id, doc_type, filename, display_name, expires_at,
          vehicle:vehicles ( id, rc_number, branch_code )
        `)
        .is('deleted_at', null)
        .not('expires_at', 'is', null)
        .lte('expires_at', in30)
        .order('expires_at', { ascending: true })
        .limit(40)
      if (ve) throw ve

      // Driver documents — same
      const { data: drvDocs, error: de } = await supabaseAdmin
        .from('driver_documents')
        .select(`
          id, doc_type, filename, display_name, expires_at,
          employee:employees ( id, full_name, employee_code, branch_codes )
        `)
        .is('deleted_at', null)
        .not('expires_at', 'is', null)
        .lte('expires_at', in30)
        .order('expires_at', { ascending: true })
        .limit(40)
      if (de) throw de

      // Branch-filter client-side. The active set ranges from no-vehicle (the
      // vehicle row was soft-deleted) to mismatched branch.
      const vehItems = (vehDocs || [])
        .filter(d => d.vehicle && effectiveBranches.includes(d.vehicle.branch_code))
        .map(d => ({
          kind: 'vehicle',
          id: d.id,
          ownerId:    d.vehicle.id,
          ownerLabel: formatRc(d.vehicle.rc_number),
          docType:    d.doc_type,
          title:      d.doc_type,
          subtitle:   formatRc(d.vehicle.rc_number),
          expires_at: d.expires_at,
        }))

      const drvItems = (drvDocs || [])
        .filter(d => d.employee && Array.isArray(d.employee.branch_codes) &&
                     d.employee.branch_codes.some(bc => effectiveBranches.includes(bc)))
        .map(d => ({
          kind: 'driver',
          id: d.id,
          ownerId:    d.employee.id,
          ownerLabel: d.employee.full_name,
          docType:    d.doc_type,
          title:      `${d.doc_type} — ${d.employee.full_name}`,
          subtitle:   d.employee.employee_code ? `#${d.employee.employee_code}` : 'Driver document',
          expires_at: d.expires_at,
        }))

      // Combine, sort, cap
      const combined = [...vehItems, ...drvItems]
        .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
        .slice(0, 20)

      setItems(combined)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      marginBottom: 20,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            fontWeight: 600,
          }}>
            Fleet — Expiring Soon
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
            Vehicle and driver documents expired or expiring in the next 30 days
          </div>
        </div>
        {!loading && items.length > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            padding: '3px 10px',
            background: items.some(i => daysUntil(i.expires_at) < 0)
              ? 'var(--crimson-light)'
              : 'var(--gold-light)',
            color: items.some(i => daysUntil(i.expires_at) < 0)
              ? 'var(--crimson)'
              : 'var(--gold-dark)',
            borderRadius: 999,
            letterSpacing: '0.04em',
          }}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ padding: 16, fontSize: 12, color: 'var(--crimson)' }}>
          {error}
        </div>
      ) : items.length === 0 ? (
        <div style={{
          padding: '20px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 12,
          background: 'var(--green-light)',
          border: '1px solid var(--green-muted)',
          borderRadius: 'var(--radius-sm)',
        }}>
          ✓ All fleet documents are current. Nothing expiring in the next 30 days.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(it => (
            <FleetExpiryRow
              key={`${it.kind}-${it.id}`}
              item={it}
              onClick={() => {
                if (it.kind === 'vehicle') navigate(`/vehicles/${it.ownerId}`)
                else                       navigate(`/employees/${it.ownerId}`)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}


// ----------------------------------------------------------------------------
// Row
// ----------------------------------------------------------------------------
function FleetExpiryRow({ item, onClick }) {
  const days = daysUntil(item.expires_at)
  const expired = days < 0
  const urgent  = days >= 0 && days <= 7

  // Bar colour: red for expired or ≤7 days, gold otherwise
  const barColor = (expired || urgent) ? 'var(--crimson)' : 'var(--gold)'
  // Right-side text colour matches
  const fgColor  = (expired || urgent) ? 'var(--crimson)' : 'var(--gold-dark)'

  let rightLabel
  if (expired)       rightLabel = days === -1 ? 'yesterday' : `${Math.abs(days)} days ago`
  else if (days === 0) rightLabel = 'today'
  else if (days === 1) rightLabel = 'tomorrow'
  else                 rightLabel = `${days} days`

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        border: '1px solid var(--gray-100)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{
        width: 6, height: 30,
        borderRadius: 3,
        background: barColor,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{
            display: 'inline-block', minWidth: 70,
            fontSize: 10, fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            marginRight: 8,
          }}>
            {item.kind === 'vehicle' ? 'Vehicle' : 'Driver'}
          </span>
          {item.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {item.subtitle}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: fgColor,
        }}>
          {expired ? `expired ${rightLabel}` : rightLabel}
        </div>
        <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 1 }}>
          {fmtDate(item.expires_at)}
        </div>
      </div>
    </div>
  )
}


// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function daysUntil(iso) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(iso)
  exp.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch { return d }
}

/** Same RC display formatting as the vehicles list */
function formatRc(rc) {
  if (!rc) return ''
  const n = String(rc).toUpperCase().replace(/\s+/g, '')
  const m = n.match(/^([A-Z]{2}\d{1,2})([A-Z]{1,3}\d{1,4})$/)
  return m ? `${m[1]} ${m[2]}` : n
}
