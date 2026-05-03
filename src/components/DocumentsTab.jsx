import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../App'
import { useToast } from './Toast'
import {
  listDocuments,
  uploadDocument,
  downloadDocument,
  deleteDocument,
  DOCUMENT_CATEGORIES,
  getCategoryMeta,
} from '../lib/documents'

// ============================================================================
// DOCUMENTS TAB — for the Employee Profile page
// Phase 3 — Cloudflare R2 backed.
// ============================================================================

const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx'
const MAX_BYTES = 10 * 1024 * 1024  // 10 MB

export default function DocumentsTab({ employee }) {
  const { user } = useAuth()
  const toast = useToast()

  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => { reload() }, [employee.id])

  async function reload() {
    setLoading(true)
    try {
      const list = await listDocuments(employee.id)
      setDocs(list)
    } catch (e) {
      toast.show('Failed to load documents: ' + e.message, 'error')
    }
    setLoading(false)
  }

  const filtered = filter === 'all'
    ? docs
    : filter === 'expiring'
      ? docs.filter(d => isExpiringSoon(d.expires_at))
      : docs.filter(d => d.category === filter)

  const counts = {
    all: docs.length,
    expiring: docs.filter(d => isExpiringSoon(d.expires_at)).length,
  }
  for (const cat of DOCUMENT_CATEGORIES) {
    counts[cat.key] = docs.filter(d => d.category === cat.key).length
  }

  async function handleDownload(doc) {
    try {
      await downloadDocument(doc.id, user.email)
      toast.show('Download started')
    } catch (e) {
      toast.show('Download failed: ' + e.message, 'error')
    }
  }

  async function handleDeleteConfirm() {
    if (!deleting) return
    try {
      await deleteDocument({
        documentId: deleting.id,
        employeeId: employee.id,
        deletedByEmail: user.email,
      })
      toast.show('Document deleted')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.show('Delete failed: ' + e.message, 'error')
    }
  }

  return (
    <div>
      {/* Header — filter chips + upload button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <FilterChips
          categories={DOCUMENT_CATEGORIES}
          counts={counts}
          active={filter}
          onChange={setFilter}
        />
        <button
          onClick={() => setUploadOpen(true)}
          style={btnPrimary}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: 6 }}>
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Upload document
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Spinner />
          <div style={{ fontSize: 12, marginTop: 8 }}>Loading documents…</div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} onUpload={() => setUploadOpen(true)} />
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}>
          {filtered.map(doc => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              onDownload={() => handleDownload(doc)}
              onDelete={() => setDeleting(doc)}
            />
          ))}
        </div>
      )}

      {/* Upload modal */}
      {uploadOpen && (
        <UploadModal
          employee={employee}
          uploadedByEmail={user.email}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); reload() }}
        />
      )}

      {/* Delete confirm modal */}
      {deleting && (
        <DeleteConfirmModal
          doc={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  )
}


// ============================================================================
// FILTER CHIPS
// ============================================================================
function FilterChips({ categories, counts, active, onChange }) {
  const chips = [
    { key: 'all', label: 'All', count: counts.all },
    ...(counts.expiring > 0 ? [{ key: 'expiring', label: 'Expiring soon', count: counts.expiring, warn: true }] : []),
    ...categories.filter(c => counts[c.key] > 0).map(c => ({ key: c.key, label: c.label, count: counts[c.key] })),
  ]
  return (
    <div style={{
      display: 'inline-flex',
      flexWrap: 'wrap',
      gap: 6,
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-md)',
      padding: 4,
    }}>
      {chips.map(chip => (
        <button
          key={chip.key}
          onClick={() => onChange(chip.key)}
          style={{
            padding: '5px 11px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: active === chip.key
              ? (chip.warn ? 'var(--gold)' : 'var(--green-dark)')
              : 'transparent',
            color: active === chip.key
              ? (chip.warn ? 'var(--green-dark)' : 'white')
              : (chip.warn ? 'var(--gold-dark)' : 'var(--text-muted)'),
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'inherit',
          }}
        >
          {chip.label}
          <span style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 999,
            background: active === chip.key ? 'rgba(255,255,255,0.2)' : 'var(--gray-100)',
            color: active === chip.key ? 'inherit' : 'var(--text-muted)',
          }}>{chip.count}</span>
        </button>
      ))}
    </div>
  )
}


// ============================================================================
// DOCUMENT CARD
// ============================================================================
function DocumentCard({ doc, onDownload, onDelete }) {
  const meta = getCategoryMeta(doc.category)
  const expiringSoon = isExpiringSoon(doc.expires_at)
  const expired = doc.expires_at && new Date(doc.expires_at) < new Date()
  const [menuOpen, setMenuOpen] = useState(false)

  // Click outside to close menu
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [menuOpen])

  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      position: 'relative',
      cursor: 'pointer',
    }}
      onClick={onDownload}
    >
      {/* File-icon shape */}
      <div style={{
        width: 36, height: 44,
        background: expired ? 'var(--crimson-light)' : (expiringSoon ? 'var(--gold-light)' : 'var(--green-light)'),
        borderRadius: 4,
        marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: expired ? 'var(--crimson)' : (expiringSoon ? 'var(--gold-dark)' : 'var(--green-dark)'),
        position: 'relative',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>

      {/* Filename */}
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text)',
        marginBottom: 3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }} title={doc.display_name || doc.filename}>
        {doc.display_name || doc.filename}
      </div>

      {/* Meta */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        {fmtSize(doc.size_bytes)} · {fmtRelative(doc.uploaded_at)}
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Tag>{meta.label}</Tag>
        {doc.is_teacher_visible
          ? <Tag green>Visible to teacher</Tag>
          : <Tag crimson>Admin only</Tag>}
        {expired && <Tag crimson>Expired</Tag>}
        {!expired && expiringSoon && (
          <Tag gold>Expires {fmtDate(doc.expires_at)}</Tag>
        )}
      </div>

      {/* Menu (3 dots) */}
      <div ref={menuRef} style={{ position: 'absolute', top: 10, right: 10 }}>
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--gray-400)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
          title="More"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--white)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            minWidth: 140,
            zIndex: 10,
            overflow: 'hidden',
          }}>
            <MenuItem onClick={e => { e.stopPropagation(); setMenuOpen(false); onDownload() }}>
              Download
            </MenuItem>
            <MenuItem danger onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete() }}>
              Delete
            </MenuItem>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        fontSize: 12,
        color: danger ? 'var(--crimson)' : 'var(--text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {children}
    </button>
  )
}

function Tag({ children, green, gold, crimson }) {
  let bg = 'var(--gray-100)'
  let color = 'var(--text-muted)'
  if (green)   { bg = 'var(--green-light)';   color = 'var(--green-dark)' }
  if (gold)    { bg = 'var(--gold-light)';    color = 'var(--gold-dark)' }
  if (crimson) { bg = 'var(--crimson-light)'; color = 'var(--crimson)' }
  return (
    <span style={{
      fontSize: 10,
      padding: '2px 7px',
      borderRadius: 4,
      background: bg,
      color,
      fontWeight: 500,
    }}>{children}</span>
  )
}


// ============================================================================
// EMPTY STATE
// ============================================================================
function EmptyState({ filter, onUpload }) {
  const isFiltered = filter !== 'all'
  return (
    <div style={{
      padding: '60px 24px',
      textAlign: 'center',
      background: 'var(--white)',
      border: '1px dashed var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 16px',
        borderRadius: '50%',
        background: 'var(--gold-light)',
        border: '1px solid rgba(201,162,39,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
        {isFiltered ? 'No matching documents' : 'No documents yet'}
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        {isFiltered
          ? 'Try a different category or upload a new document.'
          : 'Upload Aadhaar, certificates, salary slips, and other employee documents.'}
      </p>
      {!isFiltered && (
        <button onClick={onUpload} style={btnPrimary}>Upload first document</button>
      )}
    </div>
  )
}


// ============================================================================
// UPLOAD MODAL
// ============================================================================
function UploadModal({ employee, uploadedByEmail, onClose, onUploaded }) {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [category, setCategory] = useState('other')
  const [isTeacherVisible, setIsTeacherVisible] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [neverExpires, setNeverExpires] = useState(false)
  const [notes, setNotes] = useState('')
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Auto-set is_teacher_visible based on category default
  useEffect(() => {
    const meta = getCategoryMeta(category)
    setIsTeacherVisible(meta.defaultTeacherVisible)
  }, [category])

  function pickFile(f) {
    if (!f) return
    if (f.size > MAX_BYTES) {
      toast.show(`File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)`, 'error')
      return
    }
    setFile(f)
    if (!displayName) {
      // Default display name = filename without extension
      setDisplayName(f.name.replace(/\.[^/.]+$/, ''))
    }
  }

  async function handleUpload() {
    if (!file) {
      toast.show('Pick a file first', 'error')
      return
    }
    setUploading(true)
    try {
      await uploadDocument({
        file,
        employeeId: employee.id,
        category,
        displayName: displayName || null,
        isTeacherVisible,
        expiresAt: expiresAt || null,
        notes: notes || null,
        uploadedByEmail,
        onProgress: setProgress,
      })
      toast.show('Document uploaded')
      onUploaded()
    } catch (e) {
      toast.show('Upload failed: ' + e.message, 'error')
      setUploading(false)
    }
  }

  return (
    <Backdrop onClose={() => !uploading && onClose()}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--green-dark)' }}>
            Upload document
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            for {employee.full_name}
          </div>
        </div>

        <div style={modalBody}>
          {/* Drop zone */}
          <div
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              if (uploading) return
              const f = e.dataTransfer.files?.[0]
              pickFile(f)
            }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--gold)' : 'var(--gray-200)'}`,
              borderRadius: 'var(--radius-md)',
              padding: 20,
              textAlign: 'center',
              cursor: uploading ? 'not-allowed' : 'pointer',
              background: dragOver ? 'var(--gold-light)' : 'var(--gray-50)',
              transition: 'all 0.15s',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXTENSIONS}
              onChange={e => pickFile(e.target.files?.[0])}
              style={{ display: 'none' }}
              disabled={uploading}
            />
            {file ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {fmtSize(file.size)} · {file.type || 'unknown type'}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                  Drop a file here, or click to browse
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  PDF, JPG, PNG, DOCX · max 10 MB
                </div>
              </div>
            )}
          </div>

          {/* Upload progress */}
          {uploading && (
            <div>
              <div style={{ height: 4, background: 'var(--gray-100)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round(progress * 100)}%`,
                  background: 'linear-gradient(90deg, var(--green), var(--gold))',
                  transition: 'width 0.2s',
                }}/>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Uploading… {Math.round(progress * 100)}%
              </div>
            </div>
          )}

          {/* Form fields */}
          <FormRow label="Display name">
            <Input value={displayName} onChange={setDisplayName} placeholder="Defaults to filename" disabled={uploading} />
          </FormRow>

          <FormRow label="Category">
            <Select value={category} onChange={setCategory} disabled={uploading}>
              {DOCUMENT_CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </Select>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {getCategoryMeta(category).description}
            </div>
          </FormRow>

          <FormRow label="Expiry">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 13, marginBottom: neverExpires ? 0 : 8 }}>
              <input
                type="checkbox"
                checked={neverExpires}
                onChange={e => {
                  setNeverExpires(e.target.checked)
                  if (e.target.checked) setExpiresAt('')
                }}
                disabled={uploading}
              />
              <span>Document never expires</span>
            </label>
            {!neverExpires && (
              <>
                <Input type="date" value={expiresAt} onChange={setExpiresAt} disabled={uploading} />
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  Optional. We'll alert you 30 days before expiry.
                </div>
              </>
            )}
          </FormRow>

          <FormRow label="Visibility">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={isTeacherVisible}
                onChange={e => setIsTeacherVisible(e.target.checked)}
                disabled={uploading}
              />
              <span>Visible to teacher in desk app (when launched)</span>
            </label>
          </FormRow>

          <FormRow label="Notes">
            <Textarea value={notes} onChange={setNotes} rows={2} placeholder="Internal notes (optional)" disabled={uploading} />
          </FormRow>
        </div>

        <div style={modalFooter}>
          <button onClick={onClose} disabled={uploading} style={btnSecondary}>Cancel</button>
          <button onClick={handleUpload} disabled={!file || uploading} style={{
            ...btnPrimary,
            opacity: (!file || uploading) ? 0.5 : 1,
            background: 'var(--green)',
          }}>
            {uploading ? `Uploading… ${Math.round(progress * 100)}%` : 'Upload'}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}


// ============================================================================
// DELETE CONFIRM MODAL
// ============================================================================
function DeleteConfirmModal({ doc, onCancel, onConfirm }) {
  const [working, setWorking] = useState(false)
  async function go() {
    setWorking(true)
    await onConfirm()
    setWorking(false)
  }
  return (
    <Backdrop onClose={() => !working && onCancel()}>
      <div style={{ ...modalStyle, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--crimson)' }}>
            Delete document?
          </div>
        </div>
        <div style={{ ...modalBody, paddingTop: 4 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
            <strong>{doc.display_name || doc.filename}</strong> will be removed from the employee's record.
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            This is logged in the activity history.
          </p>
        </div>
        <div style={modalFooter}>
          <button onClick={onCancel} disabled={working} style={btnSecondary}>Cancel</button>
          <button onClick={go} disabled={working} style={{
            ...btnPrimary,
            background: 'var(--crimson)',
          }}>
            {working ? 'Deleting…' : 'Yes, delete'}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}


// ============================================================================
// SHARED MODAL UI
// ============================================================================
function Backdrop({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
      }}
    >
      {children}
    </div>
  )
}

const modalStyle = {
  background: 'var(--white)',
  borderRadius: 'var(--radius-lg)',
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
}

const modalHeader = {
  padding: '18px 22px 8px',
  borderBottom: '1px solid var(--gray-100)',
}

const modalBody = {
  padding: '14px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflowY: 'auto',
}

const modalFooter = {
  padding: '12px 22px 18px',
  borderTop: '1px solid var(--gray-100)',
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
}


function FormRow({ label, children }) {
  return (
    <div>
      <label style={{
        fontSize: 11,
        color: 'var(--gray-400)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: 4,
        display: 'block',
      }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder, disabled }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={inputStyle}
    />
  )
}

function Textarea({ value, onChange, rows = 2, placeholder, disabled }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
    />
  )
}

function Select({ value, onChange, children, disabled }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...inputStyle, cursor: 'pointer' }}>
      {children}
    </select>
  )
}

const inputStyle = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  background: 'var(--white)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
}

const btnPrimary = {
  padding: '8px 16px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
}

const btnSecondary = {
  padding: '8px 16px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function Spinner() {
  return (
    <div style={{
      width: 24, height: 24,
      border: '2px solid var(--green-muted)',
      borderTopColor: 'var(--green)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
      margin: '0 auto',
    }} />
  )
}


// ============================================================================
// HELPERS
// ============================================================================
function fmtSize(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return d }
}

function fmtRelative(t) {
  if (!t) return ''
  const diff = Math.floor((Date.now() - new Date(t).getTime()) / 1000)
  if (diff < 60)         return 'just now'
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)  return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false
  const days = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 86400)
  return days >= 0 && days <= 30
}
