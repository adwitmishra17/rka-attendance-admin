import React, { useEffect, useState } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'

export default function ReportingTime() {
  const { user } = useAuth()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    default_in_time: '09:00',
    default_out_time: '14:30',
    default_grace_minutes: 5,
    sunday_closed: true,
  })
  const [original, setOriginal] = useState(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('reporting_time_config')
      .select('*')
      .eq('id', 1)
      .single()
    if (error) {
      toast.show('Could not load settings: ' + error.message, 'error')
    } else if (data) {
      const loaded = {
        default_in_time: data.default_in_time?.slice(0, 5) || '09:00',
        default_out_time: data.default_out_time?.slice(0, 5) || '14:30',
        default_grace_minutes: data.default_grace_minutes ?? 5,
        sunday_closed: data.sunday_closed ?? true,
      }
      setForm(loaded)
      setOriginal(loaded)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function update(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const isDirty = original && JSON.stringify(form) !== JSON.stringify(original)

  async function handleSave() {
    if (!supabaseAdmin) {
      toast.show('Admin client not configured', 'error')
      return
    }
    if (form.default_grace_minutes < 0 || form.default_grace_minutes > 60) {
      toast.show('Grace period must be between 0 and 60 minutes', 'error')
      return
    }
    if (form.default_in_time >= form.default_out_time) {
      toast.show('Out time must be after In time', 'error')
      return
    }

    setSaving(true)
    const { error } = await supabaseAdmin
      .from('reporting_time_config')
      .update({
        default_in_time: form.default_in_time,
        default_out_time: form.default_out_time,
        default_grace_minutes: Number(form.default_grace_minutes),
        sunday_closed: form.sunday_closed,
        updated_by: user?.email,
      })
      .eq('id', 1)

    if (error) {
      toast.show('Save failed: ' + error.message, 'error')
    } else {
      toast.show('Reporting time saved')
      setOriginal(form)
    }
    setSaving(false)
  }

  function handleReset() {
    if (original) setForm(original)
  }

  // Calculate effective late threshold for display
  const effectiveLateAt = (() => {
    const [h, m] = form.default_in_time.split(':').map(Number)
    const total = h * 60 + m + Number(form.default_grace_minutes || 0)
    const eh = String(Math.floor(total / 60)).padStart(2, '0')
    const em = String(total % 60).padStart(2, '0')
    return `${eh}:${em}`
  })()

  return (
    <div style={{ padding: '32px 36px', maxWidth: 760 }}>
      <div className="fade-in" style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--green-dark)', marginBottom: 6 }}>
          Reporting Time
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Set the school's default in/out times and grace period. The kiosk uses these to calculate late minutes.
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {loading ? (
        <div style={{ background: 'var(--white)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-lg)', padding: 40, textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading settings…</div>
        </div>
      ) : (
        <>
          {/* School default card */}
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-lg)',
            padding: '22px 24px',
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 32, height: 32,
                borderRadius: 8,
                background: 'var(--green-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-dark)" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>School Default</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Applies to all teachers unless overridden individually</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 6 }}>
              <Field label="In time" hint="Daily start">
                <input type="time" value={form.default_in_time}
                  onChange={e => update('default_in_time', e.target.value)}
                  style={inputStyle} />
              </Field>
              <Field label="Out time" hint="Daily end">
                <input type="time" value={form.default_out_time}
                  onChange={e => update('default_out_time', e.target.value)}
                  style={inputStyle} />
              </Field>
              <Field label="Grace period" hint="Minutes before late">
                <div style={{ position: 'relative' }}>
                  <input type="number" min="0" max="60" value={form.default_grace_minutes}
                    onChange={e => update('default_grace_minutes', e.target.value)}
                    style={{ ...inputStyle, paddingRight: 38 }} />
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>min</span>
                </div>
              </Field>
            </div>

            {/* Live preview */}
            <div style={{
              marginTop: 16,
              padding: '12px 14px',
              background: 'var(--gold-light)',
              border: '1px solid rgba(201,162,39,0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12.5,
              color: 'var(--text)',
              lineHeight: 1.6,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--gold-dark)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                How this works
              </div>
              Teachers arriving at or before <strong style={{ color: 'var(--green-dark)' }}>{form.default_in_time}</strong> are <strong>on time</strong>.
              Arriving by <strong style={{ color: 'var(--gold-dark)' }}>{effectiveLateAt}</strong> is still on time (within grace).
              After that, they're marked <strong style={{ color: 'var(--gold-dark)' }}>late</strong>.
              Out by <strong style={{ color: 'var(--green-dark)' }}>{form.default_out_time}</strong> is normal; earlier counts as <strong style={{ color: 'var(--gold-dark)' }}>left early</strong>.
            </div>
          </div>

          {/* Sundays card */}
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 22px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>Close on Sundays</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                When enabled, teachers aren't expected to come in on Sundays. No "absent" markings on those days.
              </div>
            </div>
            <Switch on={form.sunday_closed} onChange={v => update('sunday_closed', v)} />
          </div>

          {/* v2 hint */}
          <div style={{
            padding: '14px 18px',
            background: 'rgba(255,255,255,0.6)',
            border: '1px dashed var(--gray-300)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            marginBottom: 16,
          }}>
            <strong style={{ color: 'var(--text)' }}>Coming later:</strong> day-of-week overrides (e.g. shorter Saturday), per-teacher custom timings (already on the Employees page), and one-off date overrides for special days.
          </div>

          {/* Save bar */}
          {isDirty && (
            <div className="fade-in" style={{
              position: 'sticky',
              bottom: 16,
              background: 'var(--white)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              boxShadow: 'var(--shadow-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />
                You have unsaved changes
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleReset} disabled={saving} style={btnSecondary}>
                  Discard
                </button>
                <button onClick={handleSave} disabled={saving} style={btnPrimary}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>{hint}</span>}
      </div>
      {children}
    </label>
  )
}

function Switch({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 44, height: 26,
      background: on ? 'var(--green)' : 'var(--gray-300)',
      borderRadius: 999,
      position: 'relative',
      border: 'none',
      cursor: 'pointer',
      transition: 'background 0.2s',
      padding: 0,
      flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute',
        top: 2,
        left: on ? 20 : 2,
        width: 22, height: 22,
        background: 'white',
        borderRadius: '50%',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
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
  padding: '8px 16px',
  background: 'var(--white)',
  color: 'var(--text)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}
