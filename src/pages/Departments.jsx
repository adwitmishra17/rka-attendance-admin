import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  reorderDepartments,
  countEmployeesByDepartment,
} from '../lib/departments'

// ============================================================================
// DEPARTMENTS PAGE
//
// Manage the list of departments (Teachers, Drivers, Maids, Office Staff, ...).
// Add, rename, reorder, and (soft-)delete. Delete blocked if employees are
// still assigned.
// ============================================================================

export default function Departments() {
  const { user } = useAuth()
  const toast = useToast()

  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Add form
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Rename inline
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  // Delete confirm
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [list, c] = await Promise.all([
        listDepartments(),
        countEmployeesByDepartment(),
      ])
      setItems(list)
      setCounts(c)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      await createDepartment({ name: newName.trim(), createdByEmail: user?.email })
      toast.show('Department added')
      setNewName('')
      setAdding(false)
      await load()
    } catch (e) {
      toast.show('Add failed: ' + e.message, 'error')
    }
    setSubmitting(false)
  }

  async function handleRename(id) {
    const trimmed = editName.trim()
    if (!trimmed) {
      toast.show('Name cannot be empty', 'error')
      return
    }
    try {
      await updateDepartment({ id, name: trimmed })
      toast.show('Renamed')
      setEditingId(null)
      setEditName('')
      await load()
    } catch (e) {
      toast.show('Rename failed: ' + e.message, 'error')
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDepartment({ id })
      toast.show('Department deleted')
      setDeletingId(null)
      await load()
    } catch (e) {
      toast.show(e.message, 'error')
      setDeletingId(null)
    }
  }

  async function handleMove(idx, direction) {
    const a = items[idx]
    const b = items[idx + direction]
    if (!a || !b) return
    try {
      await reorderDepartments(a.id, a.display_order, b.id, b.display_order)
      await load()
    } catch (e) {
      toast.show('Reorder failed: ' + e.message, 'error')
    }
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 720 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
          Departments
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Curated list of staff groups. Used in employee profiles and the Employees list filter.
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {/* List */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 20, color: 'var(--crimson)', fontSize: 12 }}>
            {error}
          </div>
        ) : (
          <>
            {items.map((d, idx) => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 18px',
                  borderBottom: idx < items.length - 1 ? '1px solid var(--gray-100)' : 'none',
                }}
              >
                {/* Reorder buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button
                    onClick={() => handleMove(idx, -1)}
                    disabled={idx === 0}
                    style={iconBtnSmall(idx === 0)}
                    title="Move up"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="18 15 12 9 6 15"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMove(idx, 1)}
                    disabled={idx === items.length - 1}
                    style={iconBtnSmall(idx === items.length - 1)}
                    title="Move down"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                </div>

                {/* Name (editable) */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === d.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(d.id)
                        if (e.key === 'Escape') { setEditingId(null); setEditName('') }
                      }}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        border: '1px solid var(--green)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 14, fontWeight: 500,
                        background: 'var(--white)', color: 'var(--text)',
                        outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                      {d.name}
                    </div>
                  )}
                </div>

                {/* Employee count badge */}
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  padding: '3px 9px',
                  background: 'var(--gray-50)',
                  border: '1px solid var(--gray-100)',
                  borderRadius: 999,
                  fontWeight: 500,
                }}>
                  {counts[d.id] || 0} {(counts[d.id] || 0) === 1 ? 'employee' : 'employees'}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {editingId === d.id ? (
                    <>
                      <button onClick={() => handleRename(d.id)} style={btnPrimary} title="Save">
                        Save
                      </button>
                      <button onClick={() => { setEditingId(null); setEditName('') }} style={btnSecondary} title="Cancel">
                        Cancel
                      </button>
                    </>
                  ) : deletingId === d.id ? (
                    <>
                      <button onClick={() => handleDelete(d.id)} style={btnDanger} title="Confirm delete">
                        Confirm delete
                      </button>
                      <button onClick={() => setDeletingId(null)} style={btnSecondary} title="Cancel">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditingId(d.id); setEditName(d.name) }}
                        style={btnSecondary}
                        title="Rename"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => setDeletingId(d.id)}
                        style={btnSecondaryDanger}
                        title="Delete"
                        disabled={(counts[d.id] || 0) > 0}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No departments yet. Add one below.
              </div>
            )}

            {/* Add row */}
            <div style={{
              padding: '14px 18px',
              background: 'var(--gray-50)',
              borderTop: items.length > 0 ? '1px solid var(--gray-100)' : 'none',
            }}>
              {adding ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Security, Hostel Wardens"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') { setAdding(false); setNewName('') }
                    }}
                    disabled={submitting}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      border: '1px solid var(--green)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13,
                      background: 'var(--white)', color: 'var(--text)',
                      outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <button onClick={handleAdd} disabled={submitting || !newName.trim()} style={btnPrimary}>
                    {submitting ? 'Adding…' : 'Add'}
                  </button>
                  <button onClick={() => { setAdding(false); setNewName('') }} disabled={submitting} style={btnSecondary}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px',
                    background: 'transparent',
                    color: 'var(--green-dark)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 13, fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add department
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tip */}
      <div style={{
        marginTop: 14,
        padding: '12px 14px',
        background: 'var(--gold-light)',
        border: '1px solid rgba(201,162,39,0.25)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 11.5,
        color: 'var(--text)',
        lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--gold-dark)' }}>Tip:</strong> Delete is only available when no employees are assigned to the department. Reassign first, then delete. Old data is preserved as a soft-delete (recoverable from the database).
      </div>
    </div>
  )
}


// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const btnPrimary = {
  padding: '6px 14px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500,
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

const btnSecondaryDanger = {
  ...btnSecondary,
  color: 'var(--crimson)',
}

const btnDanger = {
  padding: '6px 14px',
  background: 'var(--crimson)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function iconBtnSmall(disabled) {
  return {
    width: 20, height: 16,
    background: disabled ? 'var(--gray-50)' : 'var(--gray-100)',
    border: 'none',
    borderRadius: 3,
    color: disabled ? 'var(--gray-400)' : 'var(--text-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    fontFamily: 'inherit',
  }
}
