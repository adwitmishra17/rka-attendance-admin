import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import {
  listCandidateTags,
  createCandidateTag,
  updateCandidateTag,
  deleteCandidateTag,
} from '../lib/candidates'

// ============================================================================
// RECRUITMENT TAGS PAGE
//
// Manage the controlled list of role tags (Physics PGT, Games Teacher, ...).
// Used in the walk-in capture form and detail page.
// Mirrors the Departments page pattern.
// ============================================================================

export default function RecruitmentTags() {
  const { user } = useAuth()
  const toast = useToast()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      setItems(await listCandidateTags())
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      await createCandidateTag({ name: newName.trim() })
      toast.show('Tag added')
      setNewName(''); setAdding(false)
      await load()
    } catch (e) { toast.show('Add failed: ' + e.message, 'error') }
    setSubmitting(false)
  }

  async function handleRename(id) {
    const t = editName.trim()
    if (!t) { toast.show('Name cannot be empty', 'error'); return }
    try {
      await updateCandidateTag({ id, name: t })
      toast.show('Renamed')
      setEditingId(null); setEditName('')
      await load()
    } catch (e) { toast.show('Rename failed: ' + e.message, 'error') }
  }

  async function handleDelete(id) {
    try {
      await deleteCandidateTag({ id })
      toast.show('Deleted')
      setDeletingId(null)
      await load()
    } catch (e) {
      toast.show(e.message, 'error')
      setDeletingId(null)
    }
  }

  return (
    <div style={{ padding: '32px 36px', maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
          Recruitment Tags
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Role types receptionists can pick from when capturing a walk-in. (Physics PGT, Games Teacher, Driver, etc.)
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 20, color: 'var(--crimson)' }}>{error}</div>
        ) : (
          <>
            {items.map((d, idx) => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                borderBottom: idx < items.length - 1 ? '1px solid var(--gray-100)' : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === d.id ? (
                    <input
                      type="text" value={editName} autoFocus
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(d.id)
                        if (e.key === 'Escape') { setEditingId(null); setEditName('') }
                      }}
                      style={{
                        width: '100%', padding: '6px 10px',
                        border: '1px solid var(--green)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 13, fontWeight: 500,
                        background: 'var(--white)', color: 'var(--text)',
                        outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{d.name}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {editingId === d.id ? (
                    <>
                      <button onClick={() => handleRename(d.id)} style={btnPrimary}>Save</button>
                      <button onClick={() => { setEditingId(null); setEditName('') }} style={btnSecondary}>Cancel</button>
                    </>
                  ) : deletingId === d.id ? (
                    <>
                      <button onClick={() => handleDelete(d.id)} style={btnDanger}>Confirm</button>
                      <button onClick={() => setDeletingId(null)} style={btnSecondary}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(d.id); setEditName(d.name) }} style={btnSecondary}>Rename</button>
                      <button onClick={() => setDeletingId(d.id)} style={btnSecondaryDanger}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}

            <div style={{
              padding: '12px 16px',
              background: 'var(--gray-50)',
              borderTop: items.length > 0 ? '1px solid var(--gray-100)' : 'none',
            }}>
              {adding ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text" value={newName} autoFocus
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Music Teacher, Lab Assistant"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAdd()
                      if (e.key === 'Escape') { setAdding(false); setNewName('') }
                    }}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: '7px 10px',
                      border: '1px solid var(--green)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13, background: 'var(--white)',
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
                <button onClick={() => setAdding(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px',
                  background: 'transparent',
                  color: 'var(--green-dark)',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                  + Add tag
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const btnPrimary = {
  padding: '6px 12px', background: 'var(--green-dark)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const btnSecondary = {
  padding: '6px 11px', background: 'var(--white)', color: 'var(--text)',
  border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const btnSecondaryDanger = { ...btnSecondary, color: 'var(--crimson)' }
const btnDanger = {
  padding: '6px 12px', background: 'var(--crimson)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
