import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseAdmin } from '../lib/supabase'

// ============================================================================
// EXPIRY WIDGET
//
// Dashboard panel showing documents expiring in the next 30 days, sorted by
// soonest. Each row links to the employee's Documents tab.
//
// Drop-in: <ExpiryWidget />  (no props needed)
// ============================================================================

export default function ExpiryWidget() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    if (!supabaseAdmin) {
      setError('Admin client not initialised')
      setLoading(false)
      return
    }
    try {
      const today = new Date().toISOString().slice(0, 10)
      const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

      // Join documents with employees (Postgres FK select)
      const { data, error: e } = await supabaseAdmin
        .from('employee_documents')
        .select(`
          id, filename, display_name, category, expires_at,
          employee:employees (id, full_name, employee_code)
        `)
        .is('deleted_at', null)
        .not('expires_at', 'is', null)
        .gte('expires_at', today)
        .lte('expires_at', in30)
        .order('expires_at', { ascending: true })
        .limit(20)
      if (e) throw e
      setItems(data || [])
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
            Expiring Soon
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
            Documents expiring in the next 30 days
          </div>
        </div>
        {!loading && items.length > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            padding: '3px 10px',
            background: 'var(--gold-light)',
            color: 'var(--gold-dark)',
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
          ✓ All documents are current. Nothing expiring in the next 30 days.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(it => (
            <ExpiryRow
              key={it.id}
              item={it}
              onClick={() => navigate(`/employees/${it.employee?.id}?tab=documents`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExpiryRow({ item, onClick }) {
  const days = Math.ceil((new Date(item.expires_at).getTime() - Date.now()) / 86400000)
  const urgent = days <= 7
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
        background: urgent ? 'var(--crimson)' : 'var(--gold)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.display_name || item.filename}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {item.employee?.full_name || 'Unknown'}
          {item.employee?.employee_code && (
            <span style={{ color: 'var(--gray-400)' }}> · {item.employee.employee_code}</span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: urgent ? 'var(--crimson)' : 'var(--gold-dark)',
        }}>
          {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`}
        </div>
        <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 1 }}>
          {fmtDate(item.expires_at)}
        </div>
      </div>
    </div>
  )
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short',
    })
  } catch { return d }
}
