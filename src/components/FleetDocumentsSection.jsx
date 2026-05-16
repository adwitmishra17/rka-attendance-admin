import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../App'
import { useToast } from './Toast'
import Modal from './Modal'
import {
  listFleetDocuments,
  uploadFleetDocument,
  downloadFleetDocument,
  softDeleteFleetDocument,
  docTypesFor,
  docTypeMeta,
  expiryStatus,
  formatBytes,
} from '../lib/fleetDocuments'

// ============================================================================
// FLEET DOCUMENTS SECTION
//
// Reusable for vehicle_documents (RC, Insurance, PUC, Permit, Fitness)
// and driver_documents (DL, Aadhaar). One card per doc_type. Upload, Replace,
// View (download), Delete actions per card.
//
// Props:
//   ownerType: 'vehicle' | 'driver'
//   ownerId:   uuid
//   ownerLabel: string (just for upload modal context, optional)
// ============================================================================

const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx'
const MAX_BYTES = 10 * 1024 * 1024  // 10 MB

export default function FleetDocumentsSection({ ownerType, ownerId, ownerLabel }) {
  const { user } = useAuth()
  const toast = useToast()

  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadFor, setUploadFor] = useState(null)   // null | { docType, existingDoc? }
  const [deleting, setDeleting] = useState(null)     // null | doc

  async function reload() {
    setLoading(true)
    try {
      const list = await listFleetDocuments({ ownerType, ownerId })
      setDocs(list)
    } catch (e) {
      toast.show('Failed to load documents: ' + e.message, 'error')
      setDocs([])
    }
    setLoading(false)
  }

  useEffect(() => { reload() }, [ownerType, ownerId])

  // Group docs by type — at most one active per type because of the DB constraint
  const docsByType = useMemo(() => {
    const m = {}
    for (const d of docs) m[d.doc_type] = d
    return m
  }, [docs])

  const types = docTypesFor(ownerType)

  async function handleDownload(doc) {
    try {
      await downloadFleetDocument({ ownerType, documentId: doc.id, requestedByEmail: user.email })
      toast.show('Download started')
    } catch (e) {
      toast.show('Download failed: ' + e.message, 'error')
    }
  }

  async function handleDeleteConfirm() {
    if (!deleting) return
    try {
      await softDeleteFleetDocument({
        ownerType,
        documentId: deleting.id,
        deletedByEmail: user.email,
      })
      toast.show('Document deleted')
      setDeleting(null)
      reload()
    } catch (e) {
      toast.show('Delete failed: ' + e.message, 'error')
    }
  }

  // ---- Render ----
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {types.map(t => (
          <DocCard
            key={t.key}
            typeMeta={t}
            doc={docsByType[t.key] || null}
            onUpload={() => setUploadFor({ docType: t.key, existingDoc: null })}
            onReplace={(d) => setUploadFor({ docType: t.key, existingDoc: d })}
            onDownload={handleDownload}
            onDelete={(d) => setDeleting(d)}
          />
        ))}
      </div>

      {loading && docs.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Loading documents…
        </div>
      )}

      {uploadFor && (
        <UploadModal
          ownerType={ownerType}
          ownerId={ownerId}
          ownerLabel={ownerLabel}
          docType={uploadFor.docType}
          existingDoc={uploadFor.existingDoc}
          onClose={() => setUploadFor(null)}
          onUploaded={() => { setUploadFor(null); reload() }}
        />
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title="Delete document?">
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
            <strong>{deleting.doc_type}</strong> — <em>{deleting.filename}</em> will be soft-deleted.
            The file in storage is retained for now; only the record is hidden.
            You can upload a fresh document of the same type afterwards.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setDeleting(null)} style={btnSecondary}>Cancel</button>
            <button onClick={handleDeleteConfirm} style={btnDanger}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}


// ============================================================================
// One card per doc_type
// ============================================================================
function DocCard({ typeMeta, doc, onUpload, onReplace, onDownload, onDelete }) {
  const exp = doc ? expiryStatus(doc.expires_at) : null

  return (
    <div style={{
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--white)',
      padding: '14px 16px',
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
    }}>
      {/* Left — type label */}
      <div style={{ flex: '0 0 170px', paddingTop: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {typeMeta.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
          {typeMeta.description}
        </div>
      </div>

      {/* Middle — current document or empty state */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {doc ? (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                {doc.display_name || doc.filename}
              </span>
              <span style={{ color: 'var(--gray-400)', fontSize: 11 }}>{formatBytes(doc.size_bytes)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {doc.document_number && <span>#{doc.document_number}</span>}
              {doc.issuing_authority && <span>· {doc.issuing_authority}</span>}
              {doc.issue_date && <span>· Issued {fmtDate(doc.issue_date)}</span>}
            </div>
            {doc.expires_at ? (
              <div style={{ marginTop: 6 }}>
                <ExpiryBadge expiresAt={doc.expires_at} status={exp} />
              </div>
            ) : typeMeta.expiryRequired ? (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--crimson)' }}>
                ⚠ No expiry date recorded
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--gray-400)', fontStyle: 'italic', paddingTop: 4 }}>
            Not uploaded
          </div>
        )}
      </div>

      {/* Right — actions */}
      <div style={{ flex: '0 0 auto', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        {doc ? (
          <>
            <button onClick={() => onDownload(doc)}  style={btnSecondary}>View</button>
            <button onClick={() => onReplace(doc)}   style={btnSecondary}>Replace</button>
            <button onClick={() => onDelete(doc)}    style={btnSecondaryDanger}>Delete</button>
          </>
        ) : (
          <button onClick={onUpload} style={btnPrimary}>Upload</button>
        )}
      </div>
    </div>
  )
}


// ============================================================================
// Expiry badge
// ============================================================================
function ExpiryBadge({ expiresAt, status }) {
  const { state, days } = status
  const map = {
    expired:  { bg: 'var(--crimson-light)', fg: 'var(--crimson)',    label: `Expired ${Math.abs(days)}d ago` },
    critical: { bg: 'var(--crimson-light)', fg: 'var(--crimson)',    label: `Expires in ${days} day${days === 1 ? '' : 's'}` },
    warning:  { bg: 'var(--gold-light)',    fg: 'var(--gold-dark)',  label: `Expires in ${days} days` },
    ok:       { bg: 'var(--green-light)',   fg: 'var(--green-dark)', label: `Expires ${fmtDate(expiresAt)}` },
    none:     { bg: 'var(--gray-100)',      fg: 'var(--text-muted)', label: 'No expiry' },
  }
  const s = map[state] || map.none
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 8px', fontSize: 10.5, fontWeight: 600,
      borderRadius: 999, background: s.bg, color: s.fg,
      letterSpacing: '0.02em',
    }}>
      {s.label}
    </span>
  )
}


// ============================================================================
// Upload / Replace modal
// ============================================================================
function UploadModal({ ownerType, ownerId, ownerLabel, docType, existingDoc, onClose, onUploaded }) {
  const { user } = useAuth()
  const toast = useToast()
  const fileInputRef = useRef(null)

  const typeMeta = docTypeMeta(ownerType, docType)
  const isReplace = !!existingDoc

  const [file, setFile] = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [issuingAuthority, setIssuingAuthority] = useState('')
  const [notes, setNotes] = useState('')

  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [errors, setErrors] = useState({})

  function pickFile(f) {
    if (!f) return
    if (f.size > MAX_BYTES) {
      setErrors(e => ({ ...e, file: `File too large (max ${formatBytes(MAX_BYTES)})` }))
      return
    }
    setFile(f)
    setErrors(e => ({ ...e, file: null }))
    if (!displayName) setDisplayName(f.name)
  }

  function validate() {
    const errs = {}
    if (!file) errs.file = 'Pick a file'
    if (typeMeta?.expiryRequired && !expiresAt) {
      errs.expiresAt = `${typeMeta.label} requires an expiry date`
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setUploading(true)
    setProgress(0)
    try {
      await uploadFleetDocument({
        ownerType,
        ownerId,
        file,
        docType,
        displayName: displayName.trim() || null,
        documentNumber: documentNumber.trim() || null,
        issueDate: issueDate || null,
        expiresAt: expiresAt || null,
        issuingAuthority: issuingAuthority.trim() || null,
        notes: notes.trim() || null,
        uploadedByEmail: user.email,
        replaceExistingId: isReplace ? existingDoc.id : null,
        onProgress: setProgress,
      })
      toast.show(isReplace ? `${typeMeta.label} replaced` : `${typeMeta.label} uploaded`)
      onUploaded()
    } catch (e) {
      toast.show('Upload failed: ' + e.message, 'error')
      setUploading(false)
      setProgress(0)
    }
  }

  return (
    <Modal
      open
      onClose={uploading ? () => {} : onClose}
      title={`${isReplace ? 'Replace' : 'Upload'} ${typeMeta?.label || docType}${ownerLabel ? ` — ${ownerLabel}` : ''}`}
      maxWidth={560}
    >
      {/* File picker */}
      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          if (!uploading) pickFile(e.dataTransfer.files?.[0])
        }}
        style={{
          padding: '20px 16px',
          border: `1.5px dashed ${errors.file ? 'var(--crimson)' : 'var(--gray-200)'}`,
          borderRadius: 'var(--radius-sm)',
          textAlign: 'center',
          cursor: uploading ? 'default' : 'pointer',
          background: 'var(--gray-50)',
          marginBottom: 14,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS}
          style={{ display: 'none' }}
          onChange={e => pickFile(e.target.files?.[0])}
          disabled={uploading}
        />
        {file ? (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{file.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {formatBytes(file.size)} · {file.type || 'unknown type'}
            </div>
            {!uploading && (
              <div style={{ fontSize: 11, color: 'var(--gold-dark)', marginTop: 8 }}>
                Click to pick a different file
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              Click to choose, or drag a file here
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              PDF, JPG, PNG, WEBP, HEIC, DOC, DOCX · max 10 MB
            </div>
          </div>
        )}
      </div>
      {errors.file && (
        <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: -10, marginBottom: 10 }}>
          {errors.file}
        </div>
      )}

      {/* Form fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Display name" colSpan={2}>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Defaults to filename"
            style={inputStyle(false)}
            disabled={uploading}
          />
        </Field>

        <Field label="Document number">
          <input
            type="text"
            value={documentNumber}
            onChange={e => setDocumentNumber(e.target.value)}
            placeholder={docNumberPlaceholder(docType)}
            style={inputStyle(false)}
            disabled={uploading}
          />
        </Field>
        <Field label="Issuing authority">
          <input
            type="text"
            value={issuingAuthority}
            onChange={e => setIssuingAuthority(e.target.value)}
            placeholder={authorityPlaceholder(docType)}
            style={inputStyle(false)}
            disabled={uploading}
          />
        </Field>

        <Field label="Issue date">
          <input
            type="date"
            value={issueDate}
            onChange={e => setIssueDate(e.target.value)}
            style={inputStyle(false)}
            disabled={uploading}
          />
        </Field>
        <Field
          label={`Expires at${typeMeta?.expiryRequired ? ' *' : ''}`}
          error={errors.expiresAt}
        >
          <input
            type="date"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            style={inputStyle(!!errors.expiresAt)}
            disabled={uploading}
          />
        </Field>

        <Field label="Notes" colSpan={2}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Internal notes — anything worth recording"
            style={{ ...inputStyle(false), resize: 'vertical', fontFamily: 'inherit' }}
            disabled={uploading}
          />
        </Field>
      </div>

      {/* Progress bar */}
      {uploading && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            Uploading… {Math.round(progress * 100)}%
          </div>
          <div style={{ height: 4, background: 'var(--gray-100)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: 'var(--green-dark)',
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--gray-100)' }}>
        <button onClick={onClose} disabled={uploading} style={btnSecondary}>Cancel</button>
        <button onClick={handleSubmit} disabled={uploading || !file} style={btnPrimary}>
          {uploading ? 'Uploading…' : (isReplace ? 'Replace document' : 'Upload')}
        </button>
      </div>
    </Modal>
  )
}


// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function docNumberPlaceholder(docType) {
  switch (docType) {
    case 'RC':        return 'Same as vehicle RC'
    case 'Insurance': return 'Policy number'
    case 'PUC':       return 'PUC certificate number'
    case 'Permit':    return 'Permit number'
    case 'Fitness':   return 'Fitness certificate number'
    case 'DL':        return 'Driving licence number'
    case 'Aadhaar':   return 'Last 4 digits only'
    default:          return ''
  }
}

function authorityPlaceholder(docType) {
  switch (docType) {
    case 'RC':
    case 'Permit':
    case 'Fitness':   return 'Issuing RTO'
    case 'Insurance': return 'Insurance company'
    case 'PUC':       return 'Pollution testing centre'
    case 'DL':        return 'Issuing RTO'
    case 'Aadhaar':   return 'UIDAI'
    default:          return ''
  }
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Field({ label, error, colSpan = 1, children }) {
  return (
    <div style={{ gridColumn: colSpan === 2 ? 'span 2' : 'span 1' }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        {label}
      </label>
      {children}
      {error && <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

function inputStyle(hasError) {
  return {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: `1px solid ${hasError ? 'var(--crimson)' : 'var(--gray-200)'}`,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--white)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    outline: 'none',
  }
}

const btnPrimary = {
  padding: '7px 16px', background: 'var(--green-dark)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}

const btnSecondary = {
  padding: '6px 12px', background: 'var(--white)', color: 'var(--text)',
  border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}

const btnSecondaryDanger = { ...btnSecondary, color: 'var(--crimson)' }

const btnDanger = {
  padding: '7px 16px', background: 'var(--crimson)', color: 'white',
  border: 'none', borderRadius: 'var(--radius-sm)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
