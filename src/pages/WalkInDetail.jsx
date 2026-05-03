import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import {
  getCandidate,
  updateCandidate,
  archiveCandidate,
  convertToEmployee,
  listCandidateDocuments,
  getCandidateDocumentUrl,
  uploadCandidateDocument,
  listCandidateTags,
  listCandidateAuditLog,
} from '../lib/candidates'

// ============================================================================
// WALK-IN DETAIL PAGE
//
// Shows full candidate info, documents, status changer, notes, history.
// "Convert to employee" button creates a stub employee row and redirects.
//
// Receptionist with permission: read-only view of their own captures.
// ============================================================================

const STATUSES = ['applied', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected']

export default function WalkInDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin, isReceptionist } = useAuth()
  const toast = useToast()

  const [candidate, setCandidate] = useState(null)
  const [documents, setDocuments] = useState([])
  const [tags, setTags] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const [showConvert, setShowConvert] = useState(false)
  const [converting, setConverting] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const readOnly = isReceptionist && !isAdmin

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [c, docs, t] = await Promise.all([
        getCandidate(id),
        listCandidateDocuments(id),
        listCandidateTags(),
      ])
      setCandidate(c)
      setDocuments(docs)
      setTags(t)
      setNotesDraft(c.admin_notes || '')
      // Audit log loaded lazily for admin only
      if (isAdmin) {
        listCandidateAuditLog(id).then(setAuditLog).catch(() => {})
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  async function changeStatus(newStatus) {
    if (!candidate || candidate.status === newStatus) return
    try {
      const updated = await updateCandidate({
        id: candidate.id,
        updates: { status: newStatus },
        changedByEmail: user?.email,
      })
      setCandidate({ ...candidate, ...updated })
      toast.show(`Status: ${newStatus}`)
      if (isAdmin) listCandidateAuditLog(id).then(setAuditLog).catch(() => {})
    } catch (e) {
      toast.show('Status change failed: ' + e.message, 'error')
    }
  }

  async function changeTag(newTagId) {
    try {
      const updated = await updateCandidate({
        id: candidate.id,
        updates: { tag_id: newTagId || null },
        changedByEmail: user?.email,
      })
      setCandidate({ ...candidate, ...updated, tag: tags.find(t => t.id === newTagId) || null })
      toast.show('Role tag updated')
    } catch (e) {
      toast.show('Tag update failed: ' + e.message, 'error')
    }
  }

  async function saveNotes() {
    setSavingNotes(true)
    try {
      const updated = await updateCandidate({
        id: candidate.id,
        updates: { admin_notes: notesDraft },
        changedByEmail: user?.email,
      })
      setCandidate({ ...candidate, ...updated })
      setEditingNotes(false)
      toast.show('Notes saved')
    } catch (e) {
      toast.show('Save failed: ' + e.message, 'error')
    }
    setSavingNotes(false)
  }

  async function handleConvert() {
    setConverting(true)
    try {
      const { employee } = await convertToEmployee({
        candidateId: candidate.id,
        convertedByEmail: user?.email,
      })
      toast.show(`Converted. Now editing ${employee.full_name}.`)
      navigate(`/employees/${employee.id}?edit=1`)
    } catch (e) {
      toast.show('Conversion failed: ' + e.message, 'error')
      setConverting(false)
    }
  }

  async function handleArchive() {
    setArchiving(true)
    try {
      await archiveCandidate({ id: candidate.id, archivedByEmail: user?.email })
      toast.show('Archived')
      navigate('/walkins')
    } catch (e) {
      toast.show('Archive failed: ' + e.message, 'error')
      setArchiving(false)
    }
  }

  async function handleAddFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const kind = (file.type || '').startsWith('image/') ? 'photo' : 'cv'
      await uploadCandidateDocument({
        file,
        candidateId: candidate.id,
        docKind: kind,
        uploadedByEmail: user?.email,
      })
      toast.show('Document added')
      const docs = await listCandidateDocuments(candidate.id)
      setDocuments(docs)
    } catch (e2) {
      toast.show('Upload failed: ' + e2.message, 'error')
    }
    e.target.value = ''
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
  }
  if (error) {
    return <div style={{ padding: 40, color: 'var(--crimson)' }}>{error}</div>
  }
  if (!candidate) return null

  const isHired = candidate.status === 'hired' || !!candidate.converted_to_employee_id

  return (
    <div style={{ padding: '24px 20px', maxWidth: 900, margin: '0 auto' }}>
      {/* Back link */}
      <div style={{ marginBottom: 14 }}>
        <Link to="/walkins" style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Walk-ins
        </Link>
      </div>

      {/* Header */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
          <div style={{
            width: 60, height: 60,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--green), var(--gold))',
            color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 600,
            flexShrink: 0,
          }}>
            {(candidate.full_name || '?').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--green-dark)', margin: 0 }}>
              {candidate.full_name}
            </h1>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {candidate.tag?.name || 'No role tag'}
              {candidate.phone && <> · {candidate.phone}</>}
              {candidate.email && <> · {candidate.email}</>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
              Walked in {new Date(candidate.walked_in_at).toLocaleString('en-IN')} · Captured by {candidate.captured_by_email}
            </div>
          </div>
        </div>

        {/* Status pills (clickable for admin) */}
        {!readOnly && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => changeStatus(s)}
                disabled={isHired && s !== 'hired'}
                style={{
                  padding: '5px 12px',
                  background: candidate.status === s ? 'var(--green-dark)' : 'var(--gray-50)',
                  color: candidate.status === s ? 'white' : 'var(--text-muted)',
                  border: '1px solid ' + (candidate.status === s ? 'var(--green-dark)' : 'var(--gray-200)'),
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: (isHired && s !== 'hired') ? 'not-allowed' : 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontFamily: 'inherit',
                  opacity: (isHired && s !== 'hired') ? 0.4 : 1,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Conversion + archive actions (admin only) */}
        {!readOnly && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {!isHired ? (
              <button
                onClick={() => setShowConvert(true)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--green-dark)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Convert to employee →
              </button>
            ) : candidate.converted_to_employee_id ? (
              <Link
                to={`/employees/${candidate.converted_to_employee_id}`}
                style={{
                  padding: '8px 16px',
                  background: 'var(--green-light)',
                  color: 'var(--green-dark)',
                  border: '1px solid var(--green)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  textDecoration: 'none',
                  fontFamily: 'inherit',
                  display: 'inline-block',
                }}
              >
                View employee profile →
              </Link>
            ) : null}
            {!isHired && (
              <button
                onClick={() => setShowArchive(true)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--white)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tag changer (admin only) */}
      {!readOnly && (
        <div style={cardStyle}>
          <div style={cardLabelStyle}>Role tag</div>
          <select
            value={candidate.tag_id || ''}
            onChange={e => changeTag(e.target.value)}
            disabled={isHired}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              background: 'var(--white)',
              fontFamily: 'inherit',
            }}
          >
            <option value="">— No tag —</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {/* Documents */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={cardLabelStyle}>Documents ({documents.length})</div>
          {!readOnly && !isHired && (
            <label style={{
              padding: '4px 10px',
              background: 'var(--gold-light)',
              color: 'var(--gold-dark)',
              border: '1px solid var(--gold)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}>
              + Add
              <input
                type="file"
                accept="image/*,application/pdf,.doc,.docx"
                onChange={handleAddFile}
                style={{ display: 'none' }}
              />
            </label>
          )}
        </div>
        {documents.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No documents uploaded yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {documents.map(d => <DocRow key={d.id} doc={d} />)}
          </div>
        )}
      </div>

      {/* Admin notes (admin only) */}
      {!readOnly && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={cardLabelStyle}>Admin notes</div>
            {!editingNotes && (
              <button
                onClick={() => setEditingNotes(true)}
                style={smallLinkBtn}
              >
                {candidate.admin_notes ? 'Edit' : 'Add'}
              </button>
            )}
          </div>
          {editingNotes ? (
            <>
              <textarea
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                rows={4}
                disabled={savingNotes}
                placeholder="Internal notes about this candidate. Visible to admins only."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  background: 'var(--white)',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => { setEditingNotes(false); setNotesDraft(candidate.admin_notes || '') }}
                  disabled={savingNotes}
                  style={btnSecondaryDetail}
                >
                  Cancel
                </button>
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  style={btnPrimaryDetail}
                >
                  {savingNotes ? 'Saving…' : 'Save notes'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {candidate.admin_notes || <span style={{ color: 'var(--gray-400)' }}>No notes yet.</span>}
            </div>
          )}
        </div>
      )}

      {/* Audit log (admin only) */}
      {!readOnly && auditLog.length > 0 && (
        <div style={cardStyle}>
          <div style={cardLabelStyle}>Activity ({auditLog.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {auditLog.slice(0, 10).map(log => (
              <div key={log.id} style={{
                fontSize: 11.5,
                color: 'var(--text-muted)',
                padding: '5px 0',
                borderBottom: '1px solid var(--gray-100)',
              }}>
                <span style={{ color: 'var(--text)' }}>{log.action}</span>
                {log.field_name && <> · {log.field_name}</>}
                {log.new_value && <> → {log.new_value}</>}
                <span style={{ color: 'var(--gray-400)' }}> · {new Date(log.changed_at).toLocaleString('en-IN')} · {log.changed_by_email}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Convert modal */}
      {showConvert && (
        <Modal open={true} onClose={() => setShowConvert(false)} title="Convert to employee">
          <div style={{ padding: '4px 20px 20px' }}>
            <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>
              This will:
            </p>
            <ul style={{ fontSize: 13, color: 'var(--text-muted)', paddingLeft: 18, lineHeight: 1.6, margin: '8px 0' }}>
              <li>Create a new employee record for <strong style={{ color: 'var(--text)' }}>{candidate.full_name}</strong></li>
              <li>Mark this walk-in as <strong style={{ color: 'var(--text)' }}>Hired</strong></li>
              <li>Take you to the new employee profile to fill in remaining details</li>
            </ul>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
              The walk-in record stays linked for history. Documents stay in this walk-in's folder; re-upload to the employee profile if you need them under documents.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowConvert(false)} disabled={converting} style={btnSecondaryDetail}>
                Cancel
              </button>
              <button onClick={handleConvert} disabled={converting} style={{ ...btnPrimaryDetail, flex: 1 }}>
                {converting ? 'Converting…' : 'Convert to employee'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Archive modal */}
      {showArchive && (
        <Modal open={true} onClose={() => setShowArchive(false)} title="Archive walk-in">
          <div style={{ padding: '4px 20px 20px' }}>
            <p style={{ fontSize: 13, color: 'var(--text)' }}>
              Archive removes this walk-in from active lists. The record is preserved in the database for audit.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowArchive(false)} disabled={archiving} style={btnSecondaryDetail}>
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                style={{
                  ...btnPrimaryDetail,
                  background: 'var(--crimson)',
                  flex: 1,
                }}
              >
                {archiving ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ----------------------------------------------------------------------------
// Document row with on-demand signed URL
// ----------------------------------------------------------------------------

function DocRow({ doc }) {
  const [opening, setOpening] = useState(false)
  async function open() {
    setOpening(true)
    try {
      const url = await getCandidateDocumentUrl(doc.storage_path)
      if (url) window.open(url, '_blank')
    } catch (e) {
      alert('Could not open: ' + e.message)
    }
    setOpening(false)
  }
  const icon = doc.mime_type?.startsWith('image/') ? '🖼' : '📄'
  return (
    <div
      onClick={open}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid var(--gray-100)',
        borderRadius: 'var(--radius-sm)',
        cursor: opening ? 'wait' : 'pointer',
        background: 'var(--white)',
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.filename}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {doc.doc_kind} · {(doc.size_bytes / 1024).toFixed(0)} KB · {new Date(doc.uploaded_at).toLocaleDateString('en-IN')}
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {opening ? '…' : 'open ↗'}
      </span>
    </div>
  )
}


// Styles
const cardStyle = {
  background: 'var(--white)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px 20px',
  marginBottom: 12,
}

const cardLabelStyle = {
  fontSize: 10.5,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  marginBottom: 8,
}

const smallLinkBtn = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--green-dark)',
  fontSize: 12,
  fontWeight: 500,
  padding: 4,
  fontFamily: 'inherit',
}

const btnPrimaryDetail = {
  padding: '8px 14px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const btnSecondaryDetail = {
  padding: '8px 14px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
