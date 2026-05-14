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

  // For ranges, the effective "end" is end_date; for single-day, it's date.
  // A holiday is "past" only after its end is behind today.
  const filtered = useMemo(() => {
    const endOf = h => h.end_date || h.date
    if (filter === 'upcoming') return holidays.filter(h => endOf(h) >= today)
    if (filter === 'past') return holidays.filter(h => endOf(h) < today)
    return holidays
  }, [holidays, filter, today])

  const counts = useMemo(() => {
    const endOf = h => h.end_date || h.date
    return {
      upcoming: holidays.filter(h => endOf(h) >= today).length,
      past: holidays.filter(h => endOf(h) < today).length,
      all: holidays.length,
    }
  }, [holidays, today])

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
  const startD = new Date(holiday.date + 'T00:00:00')
  const endD = holiday.end_date ? new Date(holiday.end_date + 'T00:00:00') : null
  const isRange = !!holiday.end_date
  const day = startD.getDate()
  const dayOfWeek = startD.toLocaleDateString('en-IN', { weekday: 'short' })

  // For ranges, "active now" if today falls between start and end (inclusive);
  // otherwise the existing today/past logic.
  const isToday = isRange
    ? (today >= holiday.date && today <= holiday.end_date)
    : (holiday.date === today)
  const isPast = isRange ? holiday.end_date < today : holiday.date < today

  // Range label, e.g. "1 — 15 Jul 2026" or "28 Jun — 15 Jul 2026" depending on
  // whether start and end share month/year. Compact and reads naturally.
  const rangeLabel = useMemo(() => {
    if (!isRange) return null
    const sameYear = startD.getFullYear() === endD.getFullYear()
    const sameMonth = sameYear && startD.getMonth() === endD.getMonth()
    if (sameMonth) {
      const m = startD.toLocaleDateString('en-IN', { month: 'short' })
      return `${startD.getDate()} – ${endD.getDate()} ${m} ${startD.getFullYear()}`
    }
    if (sameYear) {
      const s = startD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      const e = endD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      return `${s} – ${e} ${startD.getFullYear()}`
    }
    const s = startD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    const e = endD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    return `${s} – ${e}`
  }, [isRange, holiday.date, holiday.end_date])

  const dayCount = isRange
    ? Math.round((endD - startD) / 86400000) + 1
    : null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '14px 18px',
      borderBottom: isLast ? 'none' : '1px solid var(--gray-100)',
      opacity: isPast ? 0.55 : 1,
    }}>
      {/* Date badge — for ranges, show start date with a small dash overlay hint */}
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
        position: 'relative',
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
        {isRange && (
          <div style={{
            position: 'absolute',
            bottom: -6,
            right: -6,
            background: isToday ? 'var(--gold)' : 'var(--green-dark)',
            color: 'white',
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 999,
            padding: '1px 6px',
            border: '1.5px solid var(--white)',
            lineHeight: 1.3,
          }}>
            +{dayCount - 1}d
          </div>
        )}
      </div>

      {/* Name & meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{holiday.name}</span>
          <BranchScopeChip branchCode={holiday.branch_code} />
          {isRange && (
            <span style={{
              fontSize: 10,
              padding: '1px 7px',
              background: 'var(--green-light)',
              color: 'var(--green-dark)',
              borderRadius: 999,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>{dayCount} days</span>
          )}
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
            }}>{isRange ? 'Ongoing' : 'Today'}</span>
          )}
        </div>
        {isRange && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: holiday.notes ? 2 : 0 }}>
            {rangeLabel}
          </div>
        )}
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
  const { allowedBranches, isSuperAdmin } = useAuth()
  const [saving, setSaving] = useState(false)

  // Branch scope helper:
  //   Super admin can pick: null (both) | 'MAIN' | 'CITY'
  //   Branch admin can pick: null (both) | their single branch
  // For existing rows from before per-branch was selectable, branch_code may
  // already be NULL or a single code; we preserve it.
  const branchOptions = useMemo(() => {
    const opts = [{ value: null, label: 'Both branches', sub: 'Applies to MAIN and CITY' }]
    for (const code of (isSuperAdmin ? ['MAIN', 'CITY'] : allowedBranches)) {
      opts.push({
        value: code,
        label: code === 'MAIN' ? 'Main Campus' : 'City Branch',
        sub: code === 'MAIN' ? 'Sawarubandh / Akhar' : 'Japlinganj',
      })
    }
    return opts
  }, [isSuperAdmin, allowedBranches])

  const [form, setForm] = useState({
    date: holiday?.date || '',
    end_date: holiday?.end_date || '',
    isRange: !!holiday?.end_date,
    name: holiday?.name || '',
    notes: holiday?.notes || '',
    // === branch_code === Allowed values: null | 'MAIN' | 'CITY'.
    // For new holidays: pre-select user's single branch if branch-locked,
    // else null = both branches.
    branch_code: isEdit
      ? (holiday.branch_code ?? null)
      : (allowedBranches.length === 1 ? allowedBranches[0] : null),
  })
  const [errors, setErrors] = useState({})

  function update(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.date) errs.date = 'Start date is required'
    if (!form.name.trim()) errs.name = 'Name is required'
    if (form.isRange) {
      if (!form.end_date) {
        errs.end_date = 'End date is required for a range'
      } else if (form.end_date < form.date) {
        errs.end_date = 'End date must be on or after the start date'
      } else if (form.end_date === form.date) {
        errs.end_date = 'For a single day, switch off the range toggle'
      }
    }
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

    // Build payload. branch_code is now selectable (Pass 4). For single-day
    // holidays end_date is null; for ranges it's set and >= date.
    const payload = {
      date: form.date,
      end_date: form.isRange ? form.end_date : null,
      name: form.name.trim(),
      notes: form.notes.trim() || null,
      branch_code: form.branch_code, // null = both branches
    }

    let res, savedRow
    if (isEdit) {
      res = await supabaseAdmin
        .from('holidays')
        .update(payload)
        .eq('id', holiday.id)
        .select()
        .single()
      savedRow = res.data
    } else {
      res = await supabaseAdmin
        .from('holidays')
        .insert({ ...payload, created_by: adminEmail })
        .select()
        .single()
      savedRow = res.data
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

    // Pattern 1 — snapshot at write time. New attendance punches on these
    // dates will pick up is_holiday=true via the trigger's holidays lookup.
    // Past attendance records on the same dates are NOT retroactively flagged
    // — admin must edit those rows individually if needed.
    toast.show(isEdit ? 'Holiday updated' : 'Holiday added')
    setSaving(false)
    onSaved()
  }

  // Quick display of the duration when range mode is on
  const rangeDays = useMemo(() => {
    if (!form.isRange || !form.date || !form.end_date || form.end_date < form.date) return null
    const a = new Date(form.date + 'T00:00:00')
    const b = new Date(form.end_date + 'T00:00:00')
    return Math.round((b - a) / 86400000) + 1
  }, [form.isRange, form.date, form.end_date])

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

        {/* Single day vs date range toggle */}
        <div style={{
          display: 'flex',
          background: 'var(--gray-50)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          padding: 3,
          gap: 0,
        }}>
          <ToggleOption
            active={!form.isRange}
            onClick={() => { update('isRange', false); update('end_date', '') }}
            label="Single day"
            sub="One date (Holi, Diwali, etc.)"
          />
          <ToggleOption
            active={form.isRange}
            onClick={() => update('isRange', true)}
            label="Date range"
            sub="Multi-day vacation"
          />
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: form.isRange ? '1fr 1fr' : '1fr', gap: 12 }}>
          <Field label={form.isRange ? 'Start date' : 'Date'} required error={errors.date}>
            <input type="date" value={form.date}
              onChange={e => update('date', e.target.value)}
              style={inputStyle} />
          </Field>
          {form.isRange && (
            <Field label="End date" required error={errors.end_date} hint="Inclusive">
              <input type="date" value={form.end_date}
                onChange={e => update('end_date', e.target.value)}
                min={form.date || undefined}
                style={inputStyle} />
            </Field>
          )}
        </div>

        {form.isRange && rangeDays && (
          <div style={{
            padding: '8px 12px',
            background: 'var(--green-light)',
            border: '1px solid rgba(26,74,46,0.15)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            color: 'var(--green-dark)',
          }}>
            <strong>{rangeDays}</strong> {rangeDays === 1 ? 'day' : 'days'} total (inclusive)
          </div>
        )}

        <Field label={form.isRange ? 'Vacation name' : 'Holiday name'} required error={errors.name}>
          <input type="text" value={form.name}
            onChange={e => update('name', e.target.value)}
            style={inputStyle}
            placeholder={form.isRange
              ? 'e.g. Summer Vacation, Winter Break'
              : 'e.g. Holi, Diwali, Independence Day'} />
        </Field>

        <Field label="Notes" hint="Optional">
          <textarea value={form.notes}
            onChange={e => update('notes', e.target.value)}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
            placeholder="Any additional context — half-day, sub-event, etc." />
        </Field>

        {/* Branch scope selector */}
        <Field label="Applies to" hint={isSuperAdmin ? null : 'Limited to your branch'}>
          <div style={{ display: 'grid', gap: 6 }}>
            {branchOptions.map(opt => {
              const checked = form.branch_code === opt.value
              return (
                <label key={String(opt.value)} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: `1px solid ${checked ? 'var(--green)' : 'var(--gray-200)'}`,
                  background: checked ? 'var(--green-light)' : 'var(--white)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                  <input
                    type="radio"
                    name="branch_scope"
                    checked={checked}
                    onChange={() => update('branch_code', opt.value)}
                    style={{ accentColor: 'var(--green-dark)' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: checked ? 'var(--green-dark)' : 'var(--text)' }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{opt.sub}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </Field>

        {/* Snapshot semantics footer */}
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
          padding: '8px 10px',
          borderTop: '1px dashed var(--gray-200)',
        }}>
          New attendance punches on the selected dates will be flagged as a holiday. Attendance records already saved for these dates will <strong>not</strong> be retroactively flagged — edit those days individually under each teacher's Attendance tab if needed.
        </div>
      </div>
    </Modal>
  )
}

function ToggleOption({ active, onClick, label, sub }) {
  return (
    <button onClick={onClick} type="button" style={{
      flex: 1,
      padding: '10px 12px',
      background: active ? 'var(--white)' : 'transparent',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      boxShadow: active ? 'var(--shadow-sm)' : 'none',
      color: active ? 'var(--text)' : 'var(--text-muted)',
      fontFamily: 'inherit',
      textAlign: 'left',
      transition: 'all 0.15s',
    }}>
      <div style={{ fontSize: 12.5, fontWeight: active ? 600 : 500 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
    </button>
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

    // Pattern 1 — snapshot at write time. New attendance punches on these
    // dates will see no holiday and compute late/early normally. Past
    // attendance rows that were already flagged as is_holiday stay flagged
    // — admin must edit those individually to un-flag.
    toast.show('Holiday removed')
    setWorking(false)
    onDone()
  }

  const isRange = !!holiday.end_date
  const startLabel = new Date(holiday.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const endLabel = isRange
    ? new Date(holiday.end_date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <Modal open={true} onClose={() => !working && onClose()}
      title={isRange ? 'Delete vacation?' : 'Delete holiday?'}
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
        Remove <strong>{holiday.name}</strong>
        {isRange
          ? <> from <strong>{startLabel}</strong> to <strong>{endLabel}</strong>?</>
          : <> on <strong>{startLabel}</strong>?</>
        }
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
        New attendance punches on {isRange ? 'these dates' : 'this date'} will no longer be flagged as a holiday. Existing attendance records that were already saved will keep their original holiday flag — edit those days individually if needed.
      </p>
    </Modal>
  )
}
