import React, { useEffect, useState, useRef, useMemo } from 'react'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { useAuth } from '../App'
import { useToast } from '../components/Toast'
import {
  loadFaceModels,
  detectFaceFast,
  detectFaceFull,
  evaluateFaceQuality,
} from '../lib/faceDetection'

// 5-capture standard sequence
const CAPTURE_SEQUENCE = [
  { id: 1, label: 'Look straight ahead', instruction: 'Face the camera directly' },
  { id: 2, label: 'Turn slightly left', instruction: 'Rotate your head a little to the left' },
  { id: 3, label: 'Turn slightly right', instruction: 'Rotate your head a little to the right' },
  { id: 4, label: 'Tilt up slightly', instruction: 'Look up just a bit' },
  { id: 5, label: 'Tilt down slightly', instruction: 'Look down just a bit' },
]

const STABLE_LOCK_MS = 600
const DETECT_INTERVAL_MS = 200

const QUALITY_MESSAGES = {
  no_face: 'Step into frame',
  low_confidence: 'Face the camera',
  too_far: 'Move closer',
  too_close: 'Step back a little',
  off_center: 'Center your face',
  good: 'Hold still…',
}

export default function FaceEnrollment() {
  const { user } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])
  const [enrolledCounts, setEnrolledCounts] = useState({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | enrolled | unenrolled

  const [activeEmployee, setActiveEmployee] = useState(null)

  async function loadEmployees() {
    setLoading(true)
    // 1. Get all active employees
    const { data: emps, error: empErr } = await supabaseAdmin
      .from('employees')
      .select('id, full_name, employee_code, biometric_code, email, is_active')
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    if (empErr) {
      toast.show('Failed to load employees: ' + empErr.message, 'error')
      setLoading(false)
      return
    }

    // 2. For each employee, count active embeddings
    const { data: embs, error: embErr } = await supabaseAdmin
      .from('face_embeddings')
      .select('employee_id, is_active')
      .eq('is_active', true)

    const counts = {}
    if (!embErr && embs) {
      for (const e of embs) {
        counts[e.employee_id] = (counts[e.employee_id] || 0) + 1
      }
    }

    setEmployees(emps || [])
    setEnrolledCounts(counts)
    setLoading(false)
  }

  useEffect(() => { loadEmployees() }, [])

  const filtered = useMemo(() => {
    let list = employees
    if (filter === 'enrolled') list = list.filter(e => (enrolledCounts[e.id] || 0) >= 5)
    else if (filter === 'unenrolled') list = list.filter(e => (enrolledCounts[e.id] || 0) < 5)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(e =>
        e.full_name?.toLowerCase().includes(s) ||
        e.employee_code?.toLowerCase().includes(s) ||
        e.biometric_code?.toLowerCase().includes(s)
      )
    }
    return list
  }, [employees, enrolledCounts, filter, search])

  const stats = useMemo(() => {
    const total = employees.length
    const fullyEnrolled = employees.filter(e => (enrolledCounts[e.id] || 0) >= 5).length
    const partial = employees.filter(e => {
      const c = enrolledCounts[e.id] || 0
      return c > 0 && c < 5
    }).length
    const none = total - fullyEnrolled - partial
    return { total, fullyEnrolled, partial, none }
  }, [employees, enrolledCounts])

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1080 }}>
      <div className="fade-in" style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 600,
          color: 'var(--green-dark)',
          marginBottom: 6,
        }}>
          Face Enrollment
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 620, lineHeight: 1.5 }}>
          Capture each teacher's face from 5 angles to enroll them in the recognition system.
          Once enrolled, the kiosk can identify them automatically.
        </p>
        <div style={{ width: 40, height: 2, background: 'linear-gradient(90deg, var(--gold), transparent)', marginTop: 8, borderRadius: 1 }} />
      </div>

      {/* Stats */}
      {!loading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}>
          <StatCard label="Total teachers" value={stats.total} accent="green" />
          <StatCard label="Fully enrolled" value={stats.fullyEnrolled} accent="green-bold" />
          <StatCard label="Partially enrolled" value={stats.partial} accent="gold" />
          <StatCard label="Not enrolled" value={stats.none} accent="muted" />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by name, employee code, or biometric code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 240,
            padding: '9px 12px',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            background: 'var(--white)',
            color: 'var(--text)',
            outline: 'none',
          }}
        />
        <div style={{
          display: 'inline-flex',
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-md)',
          padding: 3,
        }}>
          {[
            { k: 'all', label: 'All' },
            { k: 'unenrolled', label: 'Not yet' },
            { k: 'enrolled', label: 'Enrolled' },
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
            }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{
          background: 'var(--white)',
          border: '1px solid var(--gray-200)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          {filtered.map((emp, idx) => (
            <EmployeeRow
              key={emp.id}
              employee={emp}
              count={enrolledCounts[emp.id] || 0}
              isLast={idx === filtered.length - 1}
              onEnroll={() => setActiveEmployee(emp)}
            />
          ))}
        </div>
      )}

      {/* Enrollment modal */}
      {activeEmployee && (
        <EnrollmentSession
          employee={activeEmployee}
          existingCount={enrolledCounts[activeEmployee.id] || 0}
          onClose={() => setActiveEmployee(null)}
          onComplete={() => {
            setActiveEmployee(null)
            loadEmployees()
          }}
          adminEmail={user?.email}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, accent }) {
  const colors = {
    'green': { bg: 'var(--white)', border: 'var(--gray-200)', text: 'var(--text)', valueColor: 'var(--green-dark)' },
    'green-bold': { bg: 'var(--green-light)', border: 'var(--green-dark)', text: 'var(--green-dark)', valueColor: 'var(--green-dark)' },
    'gold': { bg: 'var(--gold-light)', border: 'rgba(201,162,39,0.3)', text: 'var(--gold-dark)', valueColor: 'var(--gold-dark)' },
    'muted': { bg: 'var(--gray-50)', border: 'var(--gray-200)', text: 'var(--text-muted)', valueColor: 'var(--text-muted)' },
  }
  const c = colors[accent] || colors.green
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: c.text,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 24,
        fontWeight: 700,
        color: c.valueColor,
        lineHeight: 1,
      }}>{value}</div>
    </div>
  )
}

function EmployeeRow({ employee, count, isLast, onEnroll }) {
  const fullyEnrolled = count >= 5
  const partial = count > 0 && count < 5
  const initials = (employee.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '14px 18px',
      borderBottom: isLast ? 'none' : '1px solid var(--gray-100)',
    }}>
      {/* Avatar */}
      <div style={{
        width: 38, height: 38,
        borderRadius: '50%',
        background: fullyEnrolled
          ? 'linear-gradient(135deg, var(--green), var(--green-dark))'
          : partial
            ? 'linear-gradient(135deg, var(--gold), var(--gold-dark))'
            : 'var(--gray-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: fullyEnrolled || partial ? 'white' : 'var(--text-muted)',
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}>{initials}</div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
          {employee.full_name}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10 }}>
          <span>Code: {employee.employee_code}</span>
          {employee.biometric_code && <span>Biometric: {employee.biometric_code}</span>}
        </div>
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CaptureProgress count={count} total={5} />
        <button onClick={onEnroll} style={{
          padding: '7px 14px',
          background: fullyEnrolled ? 'var(--white)' : 'var(--green-dark)',
          color: fullyEnrolled ? 'var(--green-dark)' : 'white',
          border: fullyEnrolled ? '1px solid var(--green-dark)' : 'none',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          minWidth: 84,
        }}>
          {fullyEnrolled ? 'Re-enroll' : partial ? 'Continue' : 'Enroll'}
        </button>
      </div>
    </div>
  )
}

function CaptureProgress({ count, total }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            width: 8, height: 8,
            borderRadius: '50%',
            background: i < count ? 'var(--green)' : 'var(--gray-200)',
          }} />
        ))}
      </div>
      <span style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        fontVariantNumeric: 'tabular-nums',
        minWidth: 28,
      }}>{count}/{total}</span>
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: 50,
      textAlign: 'center',
    }}>
      <div style={{
        width: 24, height: 24,
        border: '2px solid var(--green-muted)',
        borderTopColor: 'var(--green)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        margin: '0 auto 10px',
      }} />
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading employees…</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      background: 'var(--white)',
      border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)',
      padding: '50px 24px',
      textAlign: 'center',
    }}>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        No employees match this filter.
      </p>
    </div>
  )
}

// ============================================================
// ENROLLMENT SESSION (modal)
// ============================================================
function EnrollmentSession({ employee, existingCount, onClose, onComplete, adminEmail }) {
  const toast = useToast()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const stableSinceRef = useRef(null)

  const [stage, setStage] = useState('init') // init | running | saving | done
  const [permissionState, setPermissionState] = useState('requesting')
  const [error, setError] = useState('')

  const [modelStatus, setModelStatus] = useState('not_loaded')
  const [modelMessage, setModelMessage] = useState('')

  const [currentStep, setCurrentStep] = useState(0) // 0..4 (5 captures)
  const [captures, setCaptures] = useState([]) // collected embeddings + snapshots
  const [qualityState, setQualityState] = useState({ ok: false, reason: 'no_face' })
  const [stableProgress, setStableProgress] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const [showCheckmark, setShowCheckmark] = useState(false)

  // Load models
  useEffect(() => {
    setModelStatus('loading')
    loadFaceModels((m) => setModelMessage(m))
      .then(() => setModelStatus('ready'))
      .catch((e) => {
        setModelStatus('error')
        setModelMessage('Failed to load: ' + e.message)
      })
  }, [])

  // Start camera
  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop())
        }
        const ms = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' }, audio: false,
        })
        if (cancelled) {
          ms.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = ms

        // Wait for video element to be in the DOM (it should be since we always render it)
        let v = videoRef.current
        let waitedMs = 0
        while (!v && waitedMs < 2000) {
          await new Promise(r => setTimeout(r, 50))
          waitedMs += 50
          v = videoRef.current
          if (cancelled) return
        }
        if (!v) {
          setError('Could not find video element')
          setPermissionState('error')
          return
        }

        v.srcObject = ms

        const playWhenReady = async () => {
          if (cancelled) return
          try {
            await v.play()
            if (cancelled) return
            setPermissionState('granted')
            setStage('running')
          } catch (err) {
            console.error('video.play() failed:', err)
            // play() can fail in some browsers but the video might still render
            // Check if we have a valid stream and try to advance anyway
            if (v.videoWidth > 0) {
              setPermissionState('granted')
              setStage('running')
            } else {
              setError('Browser blocked playback. Try clicking the page and retrying.')
              setPermissionState('error')
            }
          }
        }

        // Three paths to start playback:
        // 1. metadata already loaded → play immediately
        // 2. wait for loadedmetadata event
        // 3. safety net timeout in case neither fires
        if (v.readyState >= 2) {
          playWhenReady()
        } else {
          v.addEventListener('loadedmetadata', playWhenReady, { once: true })
          setTimeout(() => {
            if (cancelled) return
            if (videoRef.current && videoRef.current.paused) playWhenReady()
          }, 800)
        }

        // Last-resort fallback: if 3 seconds pass and we still haven't transitioned, assume something failed
        setTimeout(() => {
          if (cancelled) return
          // If state is still requesting, something went wrong silently
          if (videoRef.current && videoRef.current.videoWidth > 0) {
            // Stream is actually active, just transition manually
            setPermissionState(prev => prev === 'requesting' ? 'granted' : prev)
            setStage(prev => prev === 'init' ? 'running' : prev)
          }
        }, 3000)

      } catch (e) {
        if (cancelled) return
        if (e.name === 'NotAllowedError') {
          setError('Camera permission denied. Allow camera access and try again.')
        } else if (e.name === 'NotFoundError') {
          setError('No camera found.')
        } else if (e.name === 'NotReadableError') {
          setError('Camera is busy. Close other apps and retry.')
        } else {
          setError('Camera error: ' + e.message)
        }
        setPermissionState('error')
      }
    }
    start()
    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  // Detection loop — runs while we're not capturing or done
  useEffect(() => {
    if (
      permissionState !== 'granted' ||
      modelStatus !== 'ready' ||
      stage !== 'running' ||
      capturing ||
      showCheckmark ||
      currentStep >= CAPTURE_SEQUENCE.length
    ) return

    let active = true
    async function loop() {
      while (active) {
        const t0 = Date.now()
        const v = videoRef.current
        if (!v || v.paused) {
          await new Promise(r => setTimeout(r, DETECT_INTERVAL_MS))
          continue
        }
        try {
          const det = await detectFaceFast(v)
          if (!active) break
          const q = evaluateFaceQuality(det, v)
          setQualityState(q)
          if (q.ok) {
            if (stableSinceRef.current === null) stableSinceRef.current = Date.now()
            const stableFor = Date.now() - stableSinceRef.current
            const prog = Math.min(stableFor / STABLE_LOCK_MS, 1)
            setStableProgress(prog)
            if (prog >= 1 && !capturing) {
              setCapturing(true)
              break
            }
          } else {
            stableSinceRef.current = null
            setStableProgress(0)
          }
        } catch (err) { console.error(err) }
        const elapsed = Date.now() - t0
        await new Promise(r => setTimeout(r, Math.max(DETECT_INTERVAL_MS - elapsed, 50)))
      }
    }
    loop()
    return () => { active = false }
  }, [permissionState, modelStatus, stage, capturing, currentStep, showCheckmark])

  // When capturing flag is set, run full detection
  useEffect(() => {
    if (!capturing) return
    let cancelled = false
    ;(async () => {
      const v = videoRef.current
      if (!v) return
      try {
        const full = await detectFaceFull(v)
        if (cancelled) return
        if (!full) {
          // Lost face mid-capture — retry by going back to detection
          setCapturing(false)
          stableSinceRef.current = null
          setStableProgress(0)
          return
        }
        // Save the capture
        const newCapture = {
          step: currentStep,
          descriptor: Array.from(full.descriptor),
          score: full.detection.score,
          snapshot: snapshotVideo(v),
        }
        setCaptures(prev => [...prev, newCapture])
        setShowCheckmark(true)
        // Brief checkmark animation, then advance
        setTimeout(() => {
          if (cancelled) return
          setShowCheckmark(false)
          setCapturing(false)
          stableSinceRef.current = null
          setStableProgress(0)
          setCurrentStep(s => s + 1)
        }, 800)
      } catch (err) {
        console.error('Capture error:', err)
        setCapturing(false)
      }
    })()
    return () => { cancelled = true }
  }, [capturing, currentStep])

  function snapshotVideo(v) {
    try {
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
      return c.toDataURL('image/jpeg', 0.7)
    } catch { return null }
  }

  // When all captures done, save to Supabase
  useEffect(() => {
    if (currentStep < CAPTURE_SEQUENCE.length || captures.length < CAPTURE_SEQUENCE.length) return
    if (stage === 'saving' || stage === 'done') return

    setStage('saving')
    ;(async () => {
      try {
        if (!supabaseAdmin) throw new Error('Admin client not configured')

        // 1. Deactivate any existing embeddings for this employee (re-enrollment case)
        if (existingCount > 0) {
          await supabaseAdmin
            .from('face_embeddings')
            .update({ is_active: false })
            .eq('employee_id', employee.id)
        }

        // 2. Insert new ones
        const rows = captures.map(c => ({
          employee_id: employee.id,
          embedding: c.descriptor,
          capture_sequence: c.step + 1, // 1-indexed in DB
          quality_score: c.score,
          is_active: true,
          captured_by: adminEmail,
        }))
        const { error } = await supabaseAdmin.from('face_embeddings').insert(rows)
        if (error) throw error

        toast.show(`${employee.full_name} enrolled successfully`)
        setStage('done')
        setTimeout(() => {
          onComplete()
        }, 1200)
      } catch (e) {
        console.error('Save failed:', e)
        toast.show('Save failed: ' + e.message, 'error')
        setStage('running') // revert so they can retry
      }
    })()
  }, [currentStep, captures, employee, existingCount, adminEmail, onComplete, stage, toast])

  const stepInfo = CAPTURE_SEQUENCE[currentStep]
  const totalSteps = CAPTURE_SEQUENCE.length

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(13, 40, 24, 0.85)',
      backdropFilter: 'blur(8px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: 'var(--white)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: 540,
        maxHeight: '92vh',
        overflow: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--gray-100)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--green-dark)' }}>
              Enrolling {employee.full_name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {stage === 'done' ? 'Complete' : stage === 'saving' ? 'Saving…' : `Step ${Math.min(currentStep + 1, totalSteps)} of ${totalSteps}`}
            </div>
          </div>
          <button onClick={onClose} disabled={stage === 'saving'} style={{
            background: 'transparent',
            border: '1px solid var(--gray-200)',
            borderRadius: 8,
            padding: 6,
            cursor: stage === 'saving' ? 'not-allowed' : 'pointer',
            opacity: stage === 'saving' ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} style={{
                flex: 1,
                height: 5,
                background: i < currentStep ? 'var(--green)' : 'var(--gray-200)',
                borderRadius: 999,
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 22 }}>
          {/* Camera wrapper - ALWAYS rendered so videoRef is stable.
              When permission isn't granted yet, we overlay a "Starting camera…" spinner. */}
          <div style={{
            width: 280, height: 280,
            borderRadius: '50%',
            overflow: 'hidden',
            position: 'relative',
            background: '#000',
            margin: '0 auto 18px',
            boxShadow: showCheckmark
              ? '0 0 40px rgba(74,222,128,0.5), 0 0 0 4px rgba(74,222,128,0.6)'
              : qualityState.ok
                ? '0 0 30px rgba(74,222,128,0.3), 0 0 0 3px rgba(74,222,128,0.4)'
                : '0 0 0 3px var(--gray-200)',
            transition: 'box-shadow 0.3s',
            display: permissionState === 'error' ? 'none' : 'block',
          }}>
            <video ref={videoRef} autoPlay playsInline muted style={{
              width: '100%', height: '100%', objectFit: 'cover',
              transform: 'scaleX(-1)',
            }} />

            {/* Starting-camera spinner overlay */}
            {permissionState === 'requesting' && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32,
                  border: '3px solid rgba(255,255,255,0.2)',
                  borderTopColor: 'var(--gold)',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Starting camera…</p>
              </div>
            )}

                {/* Stability ring */}
                {stage === 'running' && qualityState.ok && stableProgress > 0 && !showCheckmark && (
                  <svg viewBox="0 0 100 100" style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    transform: 'rotate(-90deg)',
                    pointerEvents: 'none',
                  }}>
                    <circle cx="50" cy="50" r="48" fill="none"
                      stroke="#4ade80" strokeWidth="2"
                      strokeDasharray={`${stableProgress * 301.6} 301.6`}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dasharray 0.1s linear' }}
                    />
                  </svg>
                )}

                {/* Capturing spinner */}
                {capturing && !showCheckmark && (
                  <div className="fade-in" style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(74,222,128,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{
                      width: 48, height: 48,
                      border: '3px solid rgba(74,222,128,0.3)',
                      borderTopColor: '#4ade80',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                  </div>
                )}

                {/* Capture success checkmark */}
                {showCheckmark && (
                  <div className="fade-in" style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(74,222,128,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{
                      width: 64, height: 64,
                      borderRadius: '50%',
                      background: '#4ade80',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0d2818" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  </div>
                )}
              </div>

              {/* Error state */}
              {permissionState === 'error' && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <p style={{ fontSize: 13, color: 'var(--crimson)', marginBottom: 16 }}>{error}</p>
                  <button onClick={onClose} style={{
                    padding: '8px 18px',
                    background: 'var(--gray-100)',
                    color: 'var(--text)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}>Close</button>
                </div>
              )}

              {/* Status text */}
              {stage === 'saving' ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 6 }}>Saving captures…</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>This will only take a moment.</p>
                </div>
              ) : stage === 'done' ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{
                    fontSize: 16,
                    fontFamily: 'var(--font-display)',
                    color: 'var(--green-dark)',
                    fontWeight: 600,
                    marginBottom: 6,
                  }}>
                    All done!
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {employee.full_name} is now enrolled.
                  </p>
                </div>
              ) : modelStatus !== 'ready' ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 6 }}>
                    Loading face recognition…
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{modelMessage}</p>
                </div>
              ) : stepInfo ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: 'var(--text)',
                    marginBottom: 6,
                  }}>
                    {stepInfo.label}
                  </p>
                  <p style={{
                    fontSize: 12.5,
                    color: 'var(--text-muted)',
                    marginBottom: 10,
                  }}>
                    {stepInfo.instruction}
                  </p>
                  <div style={{
                    display: 'inline-block',
                    padding: '6px 14px',
                    borderRadius: 999,
                    background: qualityState.ok ? 'var(--green-light)' : 'var(--gray-100)',
                    color: qualityState.ok ? 'var(--green-dark)' : 'var(--text-muted)',
                    fontSize: 11.5,
                    fontWeight: 500,
                    transition: 'all 0.3s',
                  }}>
                    {QUALITY_MESSAGES[qualityState.reason]}
                  </div>
                </div>
              ) : null}
        </div>
      </div>
    </div>
  )
}
