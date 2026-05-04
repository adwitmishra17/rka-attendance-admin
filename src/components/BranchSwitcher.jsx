import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../App'
import { BRANCHES, branchLabel } from '../lib/branch'

// ============================================================================
// BRANCH SWITCHER
//
// Header control showing the current branch context. Two modes:
//
//   Super admin (canSwitchBranches=true):
//     Dropdown with All Branches / Main Campus / City Branch.
//     Selection persists to localStorage (handled by setCurrentBranch).
//
//   Branch admin / receptionist (canSwitchBranches=false):
//     Static green badge showing their locked branch. No interaction.
//
// Used in the desktop topbar (Layout.jsx). Not used on mobile — small-screen
// users either rarely switch (super admin → does it on desktop) or are
// branch-locked anyway.
// ============================================================================

export default function BranchSwitcher() {
  const { currentBranch, setCurrentBranch, allowedBranches, canSwitchBranches } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ---- Static badge: branch admin / receptionist (locked) ----
  if (!canSwitchBranches) {
    const branch = BRANCHES.find(b => b.code === allowedBranches[0])
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 12px',
        background: 'var(--green-light)',
        color: 'var(--green-dark)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12, fontWeight: 600,
        whiteSpace: 'nowrap',
        border: '1px solid rgba(26,74,46,0.15)',
      }}>
        <BranchIcon />
        {branch ? branch.label : allowedBranches[0] || '—'}
      </div>
    )
  }

  // ---- Dropdown: super admin ----
  const isAll = currentBranch === null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 12px',
          background: isAll ? 'var(--gold-light)' : 'var(--green-light)',
          color: isAll ? 'var(--gold-dark)' : 'var(--green-dark)',
          border: '1px solid',
          borderColor: isAll ? 'rgba(201,162,39,0.3)' : 'rgba(26,74,46,0.15)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12, fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}
      >
        <BranchIcon />
        {branchLabel(currentBranch)}
        <Caret open={open} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          right: 0,
          minWidth: 200,
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          zIndex: 200,
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}>
          <DropdownItem
            label="All Branches"
            sub="Aggregate view"
            selected={isAll}
            accent="gold"
            onClick={() => { setCurrentBranch(null); setOpen(false) }}
          />
          <Separator />
          {BRANCHES.filter(b => allowedBranches.includes(b.code)).map(b => (
            <DropdownItem
              key={b.code}
              label={b.label}
              sub={b.sub}
              selected={currentBranch === b.code}
              accent="green"
              onClick={() => { setCurrentBranch(b.code); setOpen(false) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function DropdownItem({ label, sub, selected, accent, onClick }) {
  const [hover, setHover] = useState(false)
  const accentColor = accent === 'gold' ? 'var(--gold)' : 'var(--green)'
  const accentBg    = accent === 'gold' ? 'var(--gold-light)' : 'var(--green-light)'
  const bg = selected ? accentBg : (hover ? 'var(--gray-50)' : 'transparent')

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%',
        padding: '10px 14px',
        background: bg,
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
    >
      <div style={{
        width: 16, height: 16, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600,
          color: selected
            ? (accent === 'gold' ? 'var(--gold-dark)' : 'var(--green-dark)')
            : 'var(--text)',
        }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {sub}
        </div>
      </div>
    </button>
  )
}

function Separator() {
  return <div style={{ height: 1, background: 'var(--gray-100)' }} />
}

function BranchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21v-7l9-7 9 7v7" />
      <path d="M9 21v-9h6v9" />
    </svg>
  )
}

function Caret({ open }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ marginLeft: 2, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
