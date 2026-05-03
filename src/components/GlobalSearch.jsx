import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseAdmin } from '../lib/supabase'

// ============================================================================
// GLOBAL SEARCH
//
// Top-bar search across:
//   - Employees (by full_name, employee_code, biometric_code, email)
//   - Documents (by filename, display_name)
//   - Audit log (by field_name, changed_by_email)
//
// Keyboard:
//   Cmd+K (Ctrl+K) — focus the search box
//   Esc            — clear and close
//   Up / Down      — navigate results
//   Enter          — open selected
//
// Drop-in: <GlobalSearch />  (lives in Layout's top bar)
// ============================================================================

const DEBOUNCE_MS = 200
const MAX_RESULTS_PER_GROUP = 5

export default function GlobalSearch() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState({ employees: [], documents: [], audits: [] })
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  // Cmd+K focus shortcut
  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
        setQuery('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Click outside to close
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults({ employees: [], documents: [], audits: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    const handle = setTimeout(() => doSearch(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [query])

  const doSearch = useCallback(async (q) => {
    if (!supabaseAdmin) {
      setLoading(false)
      return
    }
    try {
      const escaped = q.replace(/[%_]/g, '\\$&')

      // Parallel queries for speed
      const [empRes, docRes, audRes] = await Promise.all([
        supabaseAdmin
          .from('employees')
          .select('id, full_name, employee_code, biometric_code, email, designation, is_active')
          .or([
            `full_name.ilike.%${escaped}%`,
            `employee_code.ilike.%${escaped}%`,
            `biometric_code.ilike.%${escaped}%`,
            `email.ilike.%${escaped}%`,
            `designation.ilike.%${escaped}%`,
          ].join(','))
          .limit(MAX_RESULTS_PER_GROUP),
        supabaseAdmin
          .from('employee_documents')
          .select(`
            id, filename, display_name, category, employee_id,
            employee:employees (id, full_name)
          `)
          .is('deleted_at', null)
          .or(`filename.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
          .limit(MAX_RESULTS_PER_GROUP),
        supabaseAdmin
          .from('employee_audit_log')
          .select(`
            id, action, field_name, changed_by_email, changed_at, employee_id,
            employee:employees (id, full_name)
          `)
          .or(`field_name.ilike.%${escaped}%,changed_by_email.ilike.%${escaped}%`)
          .order('changed_at', { ascending: false })
          .limit(MAX_RESULTS_PER_GROUP),
      ])

      setResults({
        employees: empRes.data || [],
        documents: docRes.data || [],
        audits: audRes.data || [],
      })
      setActiveIndex(-1)
    } catch (e) {
      console.error('Search failed:', e)
    }
    setLoading(false)
  }, [])

  // Flatten results for keyboard navigation
  const flatResults = [
    ...results.employees.map(r => ({ kind: 'employee', data: r })),
    ...results.documents.map(r => ({ kind: 'document', data: r })),
    ...results.audits.map(r => ({ kind: 'audit', data: r })),
  ]

  function handleKeyDown(e) {
    if (!open || flatResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(flatResults[activeIndex])
    }
  }

  function handleSelect(item) {
    if (!item) return
    if (item.kind === 'employee') {
      navigate(`/employees/${item.data.id}`)
    } else if (item.kind === 'document') {
      navigate(`/employees/${item.data.employee_id}?tab=documents`)
    } else if (item.kind === 'audit') {
      navigate(`/employees/${item.data.employee_id}?tab=history`)
    }
    setOpen(false)
    setQuery('')
  }

  const hasAnyResults =
    results.employees.length > 0 ||
    results.documents.length > 0 ||
    results.audits.length > 0

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
      <div style={{ position: 'relative' }}>
        <svg
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="var(--gray-400)" strokeWidth="2"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        >
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search… (⌘K)"
          style={{
            width: '100%',
            padding: '7px 12px 7px 34px',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12.5,
            background: 'var(--gray-50)',
            color: 'var(--text)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 4, color: 'var(--gray-400)',
            }}
            title="Clear"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0, right: 0,
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          maxHeight: 480,
          overflowY: 'auto',
          zIndex: 200,
        }}>
          {loading ? (
            <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Searching…
            </div>
          ) : !hasAnyResults ? (
            <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No results for "{query}"
            </div>
          ) : (
            <div>
              {results.employees.length > 0 && (
                <ResultGroup title="Employees" count={results.employees.length}>
                  {results.employees.map((r, i) => {
                    const idx = i  // employees are first
                    return (
                      <ResultRow
                        key={r.id}
                        active={activeIndex === idx}
                        onClick={() => handleSelect({ kind: 'employee', data: r })}
                        title={r.full_name}
                        subtitle={[r.designation, r.employee_code, r.email].filter(Boolean).join(' · ')}
                        badge={r.is_active ? null : 'Inactive'}
                        badgeColor="crimson"
                      />
                    )
                  })}
                </ResultGroup>
              )}

              {results.documents.length > 0 && (
                <ResultGroup title="Documents" count={results.documents.length}>
                  {results.documents.map((r, i) => {
                    const idx = results.employees.length + i
                    return (
                      <ResultRow
                        key={r.id}
                        active={activeIndex === idx}
                        onClick={() => handleSelect({ kind: 'document', data: r })}
                        title={r.display_name || r.filename}
                        subtitle={`${r.employee?.full_name || '—'}${r.category ? ' · ' + r.category : ''}`}
                      />
                    )
                  })}
                </ResultGroup>
              )}

              {results.audits.length > 0 && (
                <ResultGroup title="Activity" count={results.audits.length}>
                  {results.audits.map((r, i) => {
                    const idx = results.employees.length + results.documents.length + i
                    return (
                      <ResultRow
                        key={r.id}
                        active={activeIndex === idx}
                        onClick={() => handleSelect({ kind: 'audit', data: r })}
                        title={`${r.action}${r.field_name ? ' · ' + r.field_name : ''}`}
                        subtitle={`${r.employee?.full_name || '—'} · by ${r.changed_by_email}`}
                      />
                    )
                  })}
                </ResultGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function ResultGroup({ title, count, children }) {
  return (
    <div>
      <div style={{
        padding: '8px 14px 4px',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--gray-400)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: 'var(--gray-50)',
        borderTop: '1px solid var(--gray-100)',
      }}>
        {title} <span style={{ color: 'var(--gray-400)', fontWeight: 500 }}>({count})</span>
      </div>
      {children}
    </div>
  )
}

function ResultRow({ title, subtitle, active, onClick, badge, badgeColor }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 14px',
        cursor: 'pointer',
        background: active ? 'var(--gray-50)' : 'transparent',
        borderLeft: active ? '2px solid var(--green)' : '2px solid transparent',
        transition: 'background 0.1s',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
      onMouseLeave={(e) => e.currentTarget.style.background = active ? 'var(--gray-50)' : 'transparent'}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', marginTop: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {badge && (
        <span style={{
          fontSize: 9, fontWeight: 600,
          padding: '2px 7px',
          background: badgeColor === 'crimson' ? 'var(--crimson-light)' : 'var(--gray-100)',
          color: badgeColor === 'crimson' ? 'var(--crimson)' : 'var(--text-muted)',
          borderRadius: 4,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          {badge}
        </span>
      )}
    </div>
  )
}
