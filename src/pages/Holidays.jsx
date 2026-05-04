import React, { useEffect, useState, useMemo } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import { applyBranchFilterNullable } from '../lib/branchQuery'
import { branchLabel } from '../lib/branch'
import Modal from '../components/Modal'

export default function Holidays() {
  const { user, effectiveBranches } = useAuth()
  const toast = useToast()
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [filter, setFilter] = useState('upcoming') // upcoming | past | all

  async function load() {
    setLoading(true)
    let q = supabase.from('holidays').select('*').order('date', { ascending: true })
    q = applyBranchFilterNullable(q, effectiveBranches)
    const { data, error } = await q
    if (error) {
      toast.show('Failed to load holidays: ' + error.message, 'error')
      setHolidays([])
    } else {
      setHolidays(data || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [effectiveBranches])

  const today = new Date().toISOString().slice(0, 10)

  const filtered = useMemo(() => {
    if (filter === 'upcoming') return holidays.filter(h => h.date >= today)
    if (filter === 'past') return holidays.filter(h => h.date < today)
    return holidays
  }, [holidays, filter, today])

  const counts = useMemo(() => ({
    upcoming: holidays.filter(h => h.date >= today).length,
    past: holidays.filter(h => h.date < today).length,
    all: holidays.length,
  }), [holidays, today])

  // Group by month for nicer display
  const grouped = useMemo(() => {
    const groups = {}
    for (const h of filtered) {
      const monthKey = h.date.slice(0, 7) // YYYY-MM
      if (!groups[monthKey]) groups[monthKey] = []
      groups[monthKey].push(h)
    }
    return groups
  }, [filtered])

  return (
    <div style={{ padding: '32px 36px', maxWidth: 920 }}>
      {/* Header */}
      <div className="fade-in" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
            Holidays
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Mark school holidays so the kiosk doesn't expect attendance on those days.
          </p>
          <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
        </div>
        <button onClick={() => setAdding(true)} style={{
          padding: '10px 18px',
          background: 'var(--green-dark)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add holiday
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          display: 'inline-flex',
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          padding: 3,
          gap: 2,
        }}>
          {[
            { k: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { k: 'past', label: 'Past', count: counts.past },
            { k: 'all', label: 'All', count: counts.all },
          ].map(opt => (
            <button key={opt.k} onClick={() => setFilter(opt.k)} style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: filter === opt.k ? 'var(--green-dark)' : 'transparent',
              color: filter === opt.k ? 'white' : 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {opt.label}
              <span style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 999,
                background: filter === opt.k ? 'rgba(255,255,255,0.2)' : 'var(--gray-100)',
                color: filter === opt.k ? 'white' : 'var(--text-muted)',
              }}>{opt.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading holidays…</div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} onAdd={() => setAdding(true)} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(grouped).map(([monthKey, items]) => (
            <MonthGroup key={monthKey} monthKey={monthKey} items={items} today={today}
              onEdit={setEditing} onDelete={setDeleting} />
          ))}
        </div>
      )}

      {/* Modals */}
      {(adding || editing) && (
        <HolidayForm
          holiday={editing}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSaved={() => { setAdding(false); setEditing(null); load() }}
          adminEmail={user?.email}
        />
      )}

      {deleting && (
        <ConfirmDelete
          holiday={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null); load() }}
        />
      )}
    </div>
  )
}

function MonthGroup({ monthKey, items, today, onEdit, onDelete }) {
  const monthLabel = new Date(monthKey + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 18px',
        background: 'var(--gray-50)',
        borderBottom: '1px solid var(--gray-100)',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        {monthLabel}
        <span style={{ marginLeft: 8, color: 'var(--gray-400)' }}>· {items.length}</span>
      </div>
      <div>
        {items.map((h, idx) => (
          <HolidayRow key={h.id} holiday={h} today={today}
            isLast={idx === items.length - 1}
            onEdit={() => onEdit(h)} onDelete={() => onDelete(h)} />
        ))}
      </div>
    </div>
  )
}

function HolidayRow({ holiday, today, isLast, onEdit, onDelete }) {
  const date = new Date(holiday.date)
  const day = date.getDate()
  const dayOfWeek = date.toLocaleDateString('en-IN', { weekday: 'short' })
  const isPast = holiday.date < today
  const isToday = holiday.date === today

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '14px 18px',
      borderBottom: isLast ? 'none' : '1px solid var(--gray-100)',
      opacity: isPast ? 0.55 : 1,
    }}>
      {/* Date badge */}
      <div style={{
        width: 48,
        height: 52,
        flexShrink: 0,
        background: isToday ? 'var(--green-dark)' : 'var(--gold-light)',
        border: `1px solid ${isToday ? 'var(--green-dark)' : 'rgba(201,162,39,0.3)'}`,
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: isToday ? 'white' : 'var(--gold-dark)',
      }}>
        <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85 }}>
          {dayOfWeek}
        </div>
        <div style={{
          fontSize: 19,
          fontWeight: 700,
          lineHeight: 1,
          marginTop: 1,
          fontFamily: 'var(--font-display)',
        }}>
          {day}
        </div>
      </div>

      {/* Name & meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{holiday.name}</span>
          <BranchScopeChip branchCode={holiday.branch_code} />
          {isToday && (
            <span style={{
              fontSize: 10,
              padding: '1px 7px',
              background: 'var(--green-light)',
              color: 'var(--green-dark)',
              borderRadius: 999,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>Today</span>
          )}
        </div>
        {holiday.notes && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>{holiday.notes}</div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button onClick={onEdit} title="Edit" style={iconBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button onClick={onDelete} title="Delete" style={iconBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Small chip showing the branch scope of a holiday.
 *   NULL → "Both branches" (gold)
 *   MAIN → "Main Campus" (green)
 *   CITY → "City Branch" (green)
 */
function BranchScopeChip({ branchCode }) {
  if (branchCode === null || branchCode === undefined) {
    return (
      <span style={{
        fontSize: 10, padding: '1px 7px',
        background: 'var(--gold-light)', color: 'var(--gold-dark)',
        borderRadius: 999, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>Both</span>
    )
  }
  return (
    <span style={{
      fontSize: 10, padding: '1px 7px',
      background: 'var(--green-light)', color: 'var(--green-dark)',
      borderRadius: 999, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{branchLabel(branchCode)}</span>
  )
}

function EmptyState({ filter, onAdd }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px dashed var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: '40px 24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
        {filter === 'past' ? 'No past holidays in view' : filter === 'upcoming' ? 'No upcoming holidays in view' : 'No holidays yet'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        {filter === 'all' ? 'Add your first holiday to get started.' : 'Switch filters or add a new holiday.'}
      </div>
      {filter !== 'past' && (
        <button onClick={onAdd} style={{
          padding: '8px 18px',
          background: 'var(--green-dark)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}>
          Add holiday
        </button>
      )}
    </div>
  )
}

const iconBtn = {
  background: 'transparent',
  border: '1px solid var(--gray-200)',
  borderRadius: 6,
  padding: '6px 8px',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

// ============================================================
// FORM
// ============================================================
function HolidayForm({ holiday, onClose, onSaved, adminEmail }) {
  const isEdit = !!holiday
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    date: holiday?.date || '',
    name: holiday?.name || '',
    notes: holiday?.notes || '',
  })
  const [errors, setErrors] = useState({})

  function update(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.date) errs.date = 'Date is required'
    if (!form.name.trim()) errs.name = 'Name is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    if (!supabaseAdmin) {
      toast.show('Admin client not initialised', 'error')
      return
    }
    setSaving(true)

    // NOTE: branch_code is not yet selectable from this form — it's stamped in
    // sub-phase 2d. Until then, new holidays default to NULL = applies to both
    // branches (preserving existing behaviour). On edit, the existing branch_code
    // is preserved (we don't include it in the payload, so update() leaves it).
    const payload = {
      date: form.date,
      name: form.name.trim(),
      notes: form.notes.trim() || null,
    }

    let res
    if (isEdit) {
      res = await supabaseAdmin.from('holidays').update(payload).eq('id', holiday.id)
    } else {
      res = await supabaseAdmin.from('holidays').insert({
        ...payload,
        created_by: adminEmail,
      })
    }

    if (res.error) {
      if (res.error.message.includes('holidays_date_key') || res.error.message.includes('holidays_date_branch_unique')) {
        setErrors({ date: 'A holiday already exists on this date for this branch' })
      } else {
        toast.show('Save failed: ' + res.error.message, 'error')
      }
      setSaving(false)
      return
    }

    toast.show(isEdit ? 'Holiday updated' : 'Holiday added')
    setSaving(false)
    onSaved()
  }

  return (
    <Modal
      open={true}
      onClose={() => !saving && onClose()}
      title={isEdit ? 'Edit holiday' : 'Add holiday'}
      footer={
        <>
          <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={btnPrimary}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add holiday')}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Date" required error={errors.date}>
          <input type="date" value={form.date}
            onChange={e => update('date', e.target.value)}
            style={inputStyle} />
        </Field>

        <Field label="Holiday name" required error={errors.name}>
          <input type="text" value={form.name}
            onChange={e => update('name', e.target.value)}
            style={inputStyle}
            placeholder="e.g. Holi, Diwali, Independence Day" />
        </Field>

        <Field label="Notes" hint="Optional">
          <textarea value={form.notes}
            onChange={e => update('notes', e.target.value)}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
            placeholder="Any additional context — half-day, sub-event, etc." />
        </Field>

        {/* Branch scope info banner — selector comes in sub-phase 2d */}
        <div style={{
          padding: '10px 12px',
          background: 'var(--gold-light)',
          border: '1px solid rgba(201,162,39,0.25)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 11.5,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}>
          {isEdit ? (
            <>This holiday's branch scope: <strong style={{ color: 'var(--text)' }}><BranchScopeChip branchCode={holiday.branch_code} /></strong>. Per-branch editing comes in the next phase.</>
          ) : (
            <>New holidays currently default to <strong style={{ color: 'var(--text)' }}>both branches</strong>. Per-branch creation comes in the next phase.</>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, required, error, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
          {label}
          {required && <span style={{ color: 'var(--crimson)', marginLeft: 3 }}>*</span>}
        </span>
        {hint && !error && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{hint}</span>}
      </div>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 4 }}>{error}</div>
      )}
    </label>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  background: 'var(--white)',
  color: 'var(--text)',
  outline: 'none',
  fontFamily: 'inherit',
}

const btnPrimary = {
  padding: '8px 18px',
  background: 'var(--green-dark)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const btnSecondary = {
  padding: '8px 18px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

// ============================================================
// CONFIRM DELETE
// ============================================================
function ConfirmDelete({ holiday, onClose, onDone }) {
  const toast = useToast()
  const [working, setWorking] = useState(false)

  async function handleConfirm() {
    if (!supabaseAdmin) {
      toast.show('Admin client not available', 'error')
      return
    }
    setWorking(true)
    const { error } = await supabaseAdmin.from('holidays').delete().eq('id', holiday.id)
    if (error) {
      toast.show('Delete failed: ' + error.message, 'error')
      setWorking(false)
      return
    }
    toast.show('Holiday removed')
    setWorking(false)
    onDone()
  }

  const date = new Date(holiday.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Modal open={true} onClose={() => !working && onClose()}
      title="Delete holiday?"
      footer={
        <>
          <button onClick={onClose} disabled={working} style={btnSecondary}>Cancel</button>
          <button onClick={handleConfirm} disabled={working} style={{
            ...btnPrimary,
            background: 'var(--crimson)',
          }}>
            {working ? 'Deleting…' : 'Yes, delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
        Remove <strong>{holiday.name}</strong> on <strong>{date}</strong>?
      </p>
    </Modal>
  )
}
