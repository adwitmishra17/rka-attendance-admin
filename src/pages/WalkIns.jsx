import React, { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import Modal from '../components/Modal'
import {
  listCandidates,
  createCandidate,
  uploadCandidateDocument,
  listCandidateTags,
} from '../lib/candidates'

// ============================================================================
// WALK-INS LIST PAGE
//
// Roles:
//   Admin        — sees all candidates, all filters, can navigate to detail.
//   Receptionist — sees only their own captures from last 30 days. No filters.
//                  Big "+ Add walk-in" button for capture.
//
// Layout adapts to mobile (receptionist primary device).
// ============================================================================

export default function WalkIns() {
  const { user, isReceptionist, isAdmin, currentBranch, effectiveBranches } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [items, setItems] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('active')  // 'active' | 'all' | specific status
  const [tagFilter, setTagFilter] = useState(null)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => { reload() }, [effectiveBranches])
  useEffect(() => {
    listCandidateTags().then(setTags).catch(() => setTags([]))
  }, [])

  async function reload() {
    setLoading(true)
    try {
      // Receptionists: scoped to their captures, last 30 days only
      const opts = isReceptionist
        ? { onlyRecent: true, capturedByEmail: user?.email, includeArchived: false, effectiveBranches }
        : { includeArchived: statusFilter === 'all' || statusFilter === 'archived', effectiveBranches }
      const data = await listCandidates(opts)
      setItems(data)
    } catch (e) {
      toast.show('Could not load: ' + e.message, 'error')
    }
    setLoading(false)
  }

  // Apply client-side filters (for admin)
  const filtered = useMemo(() => {
    let list = items
    if (!isReceptionist) {
      if (statusFilter === 'active') {
        list = list.filter(c => !['hired', 'rejected', 'archived'].includes(c.status))
      } else if (statusFilter !== 'all') {
        list = list.filter(c => c.status === statusFilter)
      }
      if (tagFilter) list = list.filter(c => c.tag_id === tagFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        (c.full_name || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.tag?.name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, statusFilter, tagFilter, search, isReceptionist])

  return (
    <div style={{ padding: '24px 20px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 20,
        flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--green-dark)', margin: 0 }}>
            Walk-ins
          </h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {isReceptionist
              ? 'Walk-ins you have captured in the last 30 days'
              : 'Candidate walk-ins. Tag, review, and convert to employees.'}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} style={btnPrimary}>
          + Add walk-in
        </button>
      </div>

      {/* Admin filters */}
      {isAdmin && !isReceptionist && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={pillContainer}>
              {[
                { k: 'active', label: 'Active' },
                { k: 'applied', label: 'Applied' },
                { k: 'shortlisted', label: 'Shortlisted' },
                { k: 'interviewing', label: 'Interviewing' },
                { k: 'offered', label: 'Offered' },
                { k: 'hired', label: 'Hired' },
                { k: 'rejected', label: 'Rejected' },
                { k: 'all', label: 'All' },
              ].map(opt => (
                <button key={opt.k} onClick={() => setStatusFilter(opt.k)} style={pillBtn(statusFilter === opt.k)}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
              <input
                type="text"
                placeholder="Search by name, phone, email, role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={searchInputStyle}
              />
            </div>
          </div>
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>
                Role
              </span>
              <button onClick={() => setTagFilter(null)} style={chipStyle(!tagFilter)}>All</button>
              {tags.map(t => (
                <button key={t.id} onClick={() => setTagFilter(t.id)} style={chipStyle(tagFilter === t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filtered.map(c => (
            <CandidateRow key={c.id} candidate={c} showBranch={effectiveBranches.length > 1} onClick={() => navigate(`/walkins/${c.id}`)} />
          ))}
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <AddWalkinModal
          tags={tags}
          user={user}
          currentBranch={currentBranch}
          onClose={() => setShowAdd(false)}
          onSaved={(newId) => {
            setShowAdd(false)
            reload()
            // For receptionist on mobile: stay on list. For admin: jump to detail.
            if (!isReceptionist) navigate(`/walkins/${newId}`)
          }}
        />
      )}
    </div>
  )
}


// ----------------------------------------------------------------------------
// LIST ROW
// ----------------------------------------------------------------------------

function CandidateRow({ candidate, showBranch, onClick }) {
  const ago = relativeTime(candidate.walked_in_at)
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--white)',
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        transition: 'border-color 0.12s, transform 0.12s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--green)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--gray-200)' }}
    >
      {/* Avatar (initials) */}
      <div style={{
        width: 36, height: 36,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--green), var(--gold))',
        color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 600,
        flexShrink: 0,
      }}>
        {initials(candidate.full_name)}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
            {candidate.full_name}
          </div>
          {showBranch && candidate.branch_code && (
            <span style={{
              fontSize: 9.5, fontWeight: 600,
              padding: '1px 7px',
              background: 'var(--green-light)',
              color: 'var(--green-dark)',
              borderRadius: 999,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              {candidate.branch_code}
            </span>
          )}
          {candidate.tag?.name && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              padding: '2px 8px',
              background: 'var(--gold-light)',
              color: 'var(--gold-dark)',
              borderRadius: 999,
              letterSpacing: '0.04em',
            }}>
              {candidate.tag.name}
            </span>
          )}
          <StatusBadge status={candidate.status} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
          {candidate.phone || ''} {candidate.phone && candidate.email && '·'} {candidate.email || ''}
        </div>
      </div>

      {/* Time + chevron */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ago}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    applied:      { label: 'Applied',      bg: 'var(--gray-100)',   color: 'var(--text-muted)' },
    shortlisted:  { label: 'Shortlisted',  bg: 'var(--gold-light)', color: 'var(--gold-dark)' },
    interviewing: { label: 'Interviewing', bg: 'var(--gold-light)', color: 'var(--gold-dark)' },
    offered:      { label: 'Offered',      bg: 'var(--green-light)',color: 'var(--green-dark)' },
    hired:        { label: 'Hired',        bg: 'var(--green-light)',color: 'var(--green-dark)' },
    rejected:     { label: 'Rejected',     bg: 'var(--crimson-light)', color: 'var(--crimson)' },
    archived:     { label: 'Archived',     bg: 'var(--gray-100)',   color: 'var(--gray-400)' },
  }
  const m = map[status] || map.applied
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      padding: '2px 8px',
      background: m.bg,
      color: m.color,
      borderRadius: 4,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}>
      {m.label}
    </span>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px dashed var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: 32,
      textAlign: 'center',
    }}>
      <div style={{
        width: 48, height: 48, margin: '0 auto 12px',
        borderRadius: '50%',
        background: 'var(--gold-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold-dark)" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="8.5" cy="7" r="4"/>
          <line x1="20" y1="8" x2="20" y2="14"/>
          <line x1="23" y1="11" x2="17" y2="11"/>
        </svg>
      </div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--green-dark)', margin: '0 0 4px' }}>
        No walk-ins yet
      </h3>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 16px' }}>
        Capture your first walk-in candidate.
      </p>
      <button onClick={onAdd} style={btnPrimary}>+ Add walk-in</button>
    </div>
  )
}


// ============================================================================
// ADD WALK-IN MODAL
// ============================================================================

function AddWalkinModal({ tags, user, currentBranch, onClose, onSaved }) {
  const toast = useToast()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [tagId, setTagId] = useState('')
  const [files, setFiles] = useState([])  // captured photos / uploaded CV
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef(null)

  // Branch must be set to capture a walk-in. Super admin on All Branches
  // sees a banner asking them to pick a branch first.
  const branchMissing = !currentBranch

  function handleFilesPicked(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    setFiles(prev => [...prev, ...picked])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function submit() {
    if (!fullName.trim()) {
      toast.show('Name is required', 'error')
      return
    }
    if (!user?.email) {
      toast.show('Not logged in', 'error')
      return
    }
    if (branchMissing) {
      toast.show('Switch to a specific branch in the topbar first', 'error')
      return
    }
    setSubmitting(true)
    try {
      // 1. Create candidate — branch_code stamped from current branch context
      const candidate = await createCandidate({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        tagId: tagId || null,
        capturedByEmail: user.email,
        branchCode: currentBranch,
      })

      // 2. Upload files (sequentially, simple)
      for (const f of files) {
        // Determine kind: image = photo of CV/form, others = cv
        const kind = (f.type || '').startsWith('image/') ? 'photo' : 'cv'
        await uploadCandidateDocument({
          file: f,
          candidateId: candidate.id,
          docKind: kind,
          uploadedByEmail: user.email,
        })
      }

      toast.show('Walk-in saved')
      onSaved?.(candidate.id)
    } catch (e) {
      toast.show('Save failed: ' + e.message, 'error')
    }
    setSubmitting(false)
  }

  return (
    <Modal open={true} onClose={onClose} title="New walk-in">
      <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {branchMissing && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--crimson-light)',
            border: '1px solid rgba(139,26,26,0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12, color: 'var(--crimson)', lineHeight: 1.5,
          }}>
            Switch to a specific branch in the topbar before capturing a walk-in. Walk-ins are tied to one branch.
          </div>
        )}
        <Field label="Full name" required>
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Candidate's name"
            autoFocus
            disabled={submitting}
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Phone">
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+91…"
              disabled={submitting}
              style={inputStyle}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="optional"
              disabled={submitting}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Role applying for">
          <select
            value={tagId}
            onChange={e => setTagId(e.target.value)}
            disabled={submitting}
            style={inputStyle}
          >
            <option value="">— Select role —</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

        <Field label="CV / Photo of walk-in form" hint="Capture from camera or upload from gallery. You can add multiple.">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx"
            capture="environment"  // hints to mobile to use rear camera
            multiple
            onChange={handleFilesPicked}
            disabled={submitting}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            style={cameraBtnStyle}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span>Take photo / Upload</span>
          </button>

          {files.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => (
                <div key={i} style={fileRowStyle}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name || `photo-${i + 1}`}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    onClick={() => removeFile(i)}
                    disabled={submitting}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--crimson)',
                      padding: 2,
                      fontSize: 14,
                      fontFamily: 'inherit',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>

        {/* Action row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} disabled={submitting} style={btnSecondary}>Cancel</button>
          <button onClick={submit} disabled={submitting || !fullName.trim() || branchMissing} style={{ ...btnPrimary, flex: 1, opacity: branchMissing ? 0.5 : 1 }}>
            {submitting ? 'Saving…' : 'Save walk-in'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function initials(name) {
  if (!name) return '?'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

function relativeTime(iso) {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch { return '' }
}

function Field({ label, required, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        {label} {required && <span style={{ color: 'var(--crimson)' }}>*</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </label>
  )
}


// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const btnPrimary = {
  padding: '8px 18px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
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

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  background: 'var(--white)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const searchInputStyle = {
  ...inputStyle,
  padding: '8px 12px',
}

const cameraBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  width: '100%',
  padding: '14px',
  background: 'var(--gold-light)',
  border: '2px dashed var(--gold)',
  color: 'var(--gold-dark)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const fileRowStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 10px',
  background: 'var(--gray-50)',
  border: '1px solid var(--gray-100)',
  borderRadius: 'var(--radius-sm)',
}

const pillContainer = {
  display: 'inline-flex',
  background: 'var(--white)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-md)',
  padding: 3,
  gap: 2,
  flexWrap: 'wrap',
}

function pillBtn(active) {
  return {
    padding: '5px 12px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--green-dark)' : 'transparent',
    color: active ? 'white' : 'var(--text-muted)',
    fontSize: 11.5,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

function chipStyle(active) {
  return {
    padding: '4px 11px',
    background: active ? 'var(--green-dark)' : 'var(--gray-50)',
    color: active ? 'white' : 'var(--text-muted)',
    border: '1px solid ' + (active ? 'var(--green-dark)' : 'var(--gray-200)'),
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
