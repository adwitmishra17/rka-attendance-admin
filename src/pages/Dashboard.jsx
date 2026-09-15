import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { supabase, supabaseAdmin } from '../lib/supabase'
import { applyBranchFilterNullable } from '../lib/branchQuery'
import { BRANCHES, branchLabel } from '../lib/branch'
import {
  useTodayRoster, todayInKolkata, nowInKolkata,
  STATUS_ORDER, STATUS_META, countRows,
} from '../lib/todayRoster'
import FleetExpiryWidget from '../components/FleetExpiryWidget'
// Document expiry widget stays off the dashboard (2026-07-26, user request);
// the fleet expiry prompt was restored the same day.

// ============================================================================
// DASHBOARD — "today" command centre.
//
// Layout (Direction A, shared with the Tracker redesign):
//   page head  → date · greeting · scope · primary actions
//   glance     → who is in today: one segmented bar (+ per-branch rows when
//                viewing All Branches)
//   body       → left: Needs attention queue + fleet expiries
//                right rail: kiosk devices · live punches · upcoming holidays ·
//                services
// Exception-driven: raw counts live inside the glance card; everything else
// on the page is something that may need a human.
// ============================================================================

// The Hostinger Hikvision receiver sees every device heartbeat (they never
// reach the database) and publishes per-branch liveness here.
const KIOSK_STATUS_URL = 'https://teacher.rkacademyballia.in/hik/status'

// Shared card chrome — white surface, hairline border, 14px radius.
const card = {
  background: 'var(--white)',
  border: '1px solid var(--gray-200)',
  borderRadius: 14,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

export default function Dashboard() {
  const { user, isSuperAdmin, currentBranch, effectiveBranches } = useAuth()
  const navigate = useNavigate()
  const narrow = useMediaQuery('(max-width: 1080px)')
  const compact = useMediaQuery('(max-width: 640px)')

  const roster = useTodayRoster(effectiveBranches)
  const transfers = usePendingTransfers(effectiveBranches)
  const upcoming = useUpcomingHolidays(effectiveBranches)
  const kiosks = useKioskStatus(effectiveBranches)

  const totals = useMemo(() => countRows(roster.rows), [roster.rows])
  const multiBranch = effectiveBranches.length > 1
  const perBranch = useMemo(() => {
    if (!multiBranch) return []
    return effectiveBranches.map(code => ({
      code,
      counts: countRows(roster.rows, r => (r.employee.branch_codes || []).includes(code)),
    }))
  }, [roster.rows, effectiveBranches, multiBranch])

  const firstName = user?.displayName?.split(' ')[0] || 'Admin'
  const roleLabel = isSuperAdmin ? 'Super Admin' : 'Admin'

  return (
    <div style={{
      padding: compact ? '20px 16px 32px' : '28px 32px 40px',
      maxWidth: 1280,
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {/* ---------------------------------------------------------------- */}
      {/* Page head                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            {longDateLabel()}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1.15, marginBottom: 6 }}>
            {greeting()}, {firstName}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{roleLabel}</span>
            <Dot />
            <span>Viewing <strong style={{ color: currentBranch === null ? 'var(--gold-dark)' : 'var(--green-dark)', fontWeight: 600 }}>{branchLabel(currentBranch)}</strong></span>
            <Dot />
            <LiveBadge updatedAt={roster.updatedAt} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SecondaryButton onClick={() => navigate('/reports/monthly')}>Monthly report</SecondaryButton>
          <PrimaryButton onClick={() => navigate('/attendance')}>Open attendance</PrimaryButton>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Today at a glance                                                 */}
      {/* ---------------------------------------------------------------- */}
      <GlanceCard
        loading={roster.loading}
        error={roster.error}
        totals={totals}
        perBranch={perBranch}
        holidays={roster.holidays}
        compact={compact}
        onStatus={(s) => navigate(`/attendance?status=${s}`)}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Body: queue + right rail                                          */}
      {/* ---------------------------------------------------------------- */}
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0,1fr) 340px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <NeedsAttention
            roster={roster}
            totals={totals}
            transfers={transfers}
            kiosks={kiosks}
            multiBranch={multiBranch}
            onOpen={navigate}
          />
          <FleetExpiryWidget />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <KioskCard kiosks={kiosks} />
          <PunchFeedCard events={roster.events} loading={roster.loading} multiBranch={multiBranch} onOpen={navigate} />
          <UpcomingHolidaysCard items={upcoming} multiBranch={multiBranch} onOpen={() => navigate('/holidays')} />
          <ServicesCard supabaseState={roster.error ? `error: ${roster.error}` : roster.loading ? 'checking' : 'connected'} />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Today at a glance
// ============================================================================
function GlanceCard({ loading, error, totals, perBranch, holidays, compact, onStatus }) {
  const inNow = totals.present + totals.late + totals.half_day
  const away = totals.absent + totals.not_marked
  const onLeave = totals.on_leave + totals.school_leave
  const counted = totals.total - totals.holiday
  const pct = counted > 0 ? Math.round((inNow / counted) * 100) : 0
  const allHoliday = totals.total > 0 && totals.holiday === totals.total
  const holidayName = holidays[0]?.name

  return (
    <section style={{ ...card }}>
      <CardHead
        title="Today at a glance"
        sub={allHoliday ? `Holiday — ${holidayName || 'no attendance expected'}` : 'Counted staff only · exempt employees are never included'}
        right={
          !loading && !error && !allHoliday && counted > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0, background: pct >= 90 ? 'var(--green-light)' : pct >= 70 ? 'var(--gold-light)' : 'var(--crimson-light)', color: pct >= 90 ? 'var(--green-dark)' : pct >= 70 ? 'var(--gold-dark)' : 'var(--crimson)' }}>
              {pct}% in
            </span>
          )
        }
      />
      <div style={{ padding: compact ? '16px 16px 18px' : '18px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? (
          <div style={{ fontSize: 12.5, color: 'var(--crimson)' }}>Couldn’t load today’s roster: {error}</div>
        ) : loading ? (
          <Skeleton lines={2} />
        ) : totals.total === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No counted employees in this scope.</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 700, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.01em' }}>
                {allHoliday ? '—' : inNow}
                <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>/ {counted} in</span>
              </div>
              {!allHoliday && (
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {onLeave > 0 && <><strong style={{ color: 'var(--text)', fontWeight: 600 }}>{onLeave}</strong> on leave <Dot /> </>}
                  <strong style={{ color: away > 0 ? 'var(--crimson)' : 'var(--text)', fontWeight: 600 }}>{away}</strong> not in
                  {totals.late > 0 && <> <Dot /> <strong style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>{totals.late}</strong> late</>}
                </div>
              )}
            </div>

            <SegmentBar counts={totals} height={12} />

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUS_ORDER.map(s => (
                <StatusChip key={s} status={s} count={totals[s]} onClick={() => onStatus(s)} />
              ))}
              {totals.holiday > 0 && <StatusChip status="holiday" count={totals.holiday} />}
            </div>

            {perBranch.length > 1 && (
              <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 14, display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0,1fr))', gap: 14 }}>
                {perBranch.map(b => {
                  const c = b.counts
                  const bIn = c.present + c.late + c.half_day
                  const bCounted = c.total - c.holiday
                  const bAway = c.absent + c.not_marked
                  return (
                    <div key={b.code} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{branchLabel(b.code)}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{bIn}</strong> / {bCounted} in
                          {bAway > 0 && <> <Dot /> <span style={{ color: 'var(--crimson)', fontWeight: 600 }}>{bAway}</span> not in</>}
                        </div>
                      </div>
                      <SegmentBar counts={c} height={8} />
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function SegmentBar({ counts, height = 10 }) {
  const total = counts.total || 0
  if (total === 0) return null
  const segs = [...STATUS_ORDER, 'holiday'].filter(s => counts[s] > 0)
  return (
    <div style={{ display: 'flex', width: '100%', height, borderRadius: 999, overflow: 'hidden', background: 'var(--gray-100)', gap: 2 }}>
      {segs.map(s => (
        <div key={s} title={`${STATUS_META[s].label}: ${counts[s]}`} style={{
          flex: `${counts[s]} 0 auto`,
          minWidth: 4,
          background: STATUS_META[s].bar,
          transition: 'flex 0.4s ease',
        }} />
      ))}
    </div>
  )
}

function StatusChip({ status, count, onClick }) {
  const m = STATUS_META[status]
  const zero = !count
  return (
    <button onClick={zero ? undefined : onClick} disabled={zero} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '5px 10px 5px 8px',
      background: zero ? 'transparent' : m.bg,
      border: `1px solid ${zero ? 'var(--gray-100)' : 'transparent'}`,
      borderRadius: 999,
      fontSize: 12, fontWeight: 600,
      color: zero ? 'var(--gray-400)' : m.fg,
      cursor: zero ? 'default' : 'pointer',
      fontFamily: 'var(--font-body)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: zero ? 'var(--gray-200)' : m.bar }} />
      <span>{m.label}</span>
      <span style={{ fontWeight: 700 }}>{count}</span>
    </button>
  )
}

// ============================================================================
// Needs attention — everything on the page that may need a human.
// ============================================================================
function NeedsAttention({ roster, totals, transfers, kiosks, multiBranch, onOpen }) {
  const [expanded, setExpanded] = useState({ away: true })
  const toggle = k => setExpanded(e => ({ ...e, [k]: !e[k] }))

  const away = useMemo(
    () => roster.rows.filter(r => r.status === 'absent' || r.status === 'not_marked'),
    [roster.rows],
  )
  const late = useMemo(
    () => roster.rows
      .filter(r => r.status === 'late')
      .sort((a, b) => (b.daily?.late_minutes || 0) - (a.daily?.late_minutes || 0)),
    [roster.rows],
  )
  // Only the heartbeat feed can tell an outage from a quiet night; the
  // punch-recency fallback would flag both devices every morning.
  const offline = (kiosks.rows || []).filter(k => k.beat && !k.beat.online)
  const { hour } = nowInKolkata()
  // Before 10:00 IST "not in yet" is routine; after that it reads as absence.
  const awaySeverity = totals.absent > 0 || hour >= 10 ? 'crimson' : 'gold'

  const items = []
  if (!roster.loading && !roster.error && away.length > 0) {
    items.push({
      key: 'away',
      severity: awaySeverity,
      title: `${away.length} staff not in today`,
      sub: [totals.absent > 0 && `${totals.absent} marked absent`, totals.not_marked > 0 && `${totals.not_marked} not punched yet`].filter(Boolean).join(' · '),
      action: { label: 'Attendance', to: '/attendance?status=not_marked' },
      list: away,
    })
  }
  if (late.length > 0) {
    items.push({
      key: 'late',
      severity: 'gold',
      title: `${late.length} late arrival${late.length === 1 ? '' : 's'}`,
      sub: `Latest by ${late[0].daily?.late_minutes || 0} min · ${late.slice(0, 3).map(r => r.employee.full_name.split(' ')[0]).join(', ')}${late.length > 3 ? ` +${late.length - 3}` : ''}`,
      action: { label: 'Attendance', to: '/attendance?status=late' },
      list: late,
    })
  }
  if (offline.length > 0) {
    items.push({
      key: 'kiosk',
      severity: 'crimson',
      title: `${offline.length === 1 ? 'Biometric device offline' : `${offline.length} biometric devices offline`}`,
      sub: offline.map(k => `${branchLabel(k.code)} — heartbeat ${k.beat.secondsAgo != null ? `${relTime(Math.floor(k.beat.secondsAgo / 60))}` : 'lost'} · last punch ${relTime(minutesAgo(k.lastPunch))}`).join(' · '),
    })
  }
  if ((transfers.count ?? 0) > 0) {
    items.push({
      key: 'transfers',
      severity: 'ink',
      title: `${transfers.count} transfer request${transfers.count === 1 ? '' : 's'} waiting`,
      sub: transfers.preview.map(t => `${t.name} · ${t.from} → ${t.to}`).join(' · '),
      action: { label: 'Review', to: '/transfers' },
    })
  }

  return (
    <section style={{ ...card }}>
      <CardHead
        title="Needs attention"
        right={
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: items.length ? 'var(--text)' : 'var(--gray-100)', color: items.length ? 'var(--white)' : 'var(--text-muted)' }}>
            {items.length}
          </span>
        }
      />
      {roster.loading ? (
        <div style={{ padding: '16px 18px' }}><Skeleton lines={3} /></div>
      ) : roster.error ? (
        <div style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--crimson)' }}>Couldn’t load: {roster.error}</div>
      ) : items.length === 0 ? (
        <div style={{ padding: '22px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--green-light)', color: 'var(--green-dark)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Nothing needs you right now</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Everyone is accounted for, devices are up and there are no pending requests.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((it, i) => (
            <AttentionItem
              key={it.key}
              item={it}
              isLast={i === items.length - 1}
              expanded={!!expanded[it.key]}
              onToggle={it.list ? () => toggle(it.key) : null}
              onOpen={onOpen}
              multiBranch={multiBranch}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AttentionItem({ item, isLast, expanded, onToggle, onOpen, multiBranch }) {
  const dot = item.severity === 'crimson' ? 'var(--crimson)' : item.severity === 'gold' ? 'var(--gold)' : 'var(--gray-400)'
  const MAX = 12
  const list = item.list || []
  const shown = expanded ? list.slice(0, MAX) : []
  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--gray-100)' }}>
      <div style={{ display: 'flex', gap: 12, padding: '12px 18px', alignItems: 'flex-start' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 6, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.title}</div>
          {item.sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sub}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {onToggle && (
            <button onClick={onToggle} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {expanded ? 'Hide' : 'Names'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="m6 9 6 6 6-6" /></svg>
            </button>
          )}
          {item.action && (
            <button onClick={() => onOpen(item.action.to)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--green)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
              {item.action.label} →
            </button>
          )}
        </div>
      </div>
      {expanded && shown.length > 0 && (
        <div style={{ padding: '0 18px 12px 38px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '4px 12px' }}>
          {shown.map(r => (
            <PersonRow key={r.employee.id} row={r} multiBranch={multiBranch} onClick={() => onOpen(`/employees/${r.employee.id}`)} />
          ))}
          {list.length > MAX && (
            <button onClick={() => onOpen(item.action?.to || '/attendance')} style={{ background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--green)', fontFamily: 'var(--font-body)', textAlign: 'left' }}>
              and {list.length - MAX} more in Attendance →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function PersonRow({ row, multiBranch, onClick }) {
  const { employee: e, status, daily } = row
  const m = STATUS_META[status] || STATUS_META.not_marked
  const detail =
    status === 'late' ? `${daily?.late_minutes || 0} min late · in ${fmtTime(daily?.in_time)}` :
      status === 'absent' ? 'Absent' :
        'Not in yet'
  const branches = multiBranch && Array.isArray(e.branch_codes) ? e.branch_codes.map(shortBranch).join('·') : null
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 6px', borderRadius: 8, cursor: 'pointer', minWidth: 0 }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <Avatar name={e.full_name} bg={m.bg} fg={m.fg} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {e.full_name}
          {branches && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--gray-400)' }}>{branches}</span>}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.employee_code} · {detail}</div>
      </div>
    </div>
  )
}

// ============================================================================
// Right rail
// ============================================================================
function KioskCard({ kiosks }) {
  return (
    <section style={{ ...card }}>
      <CardHead title="Biometric devices" sub="Heartbeat from the receiver; punches as fallback" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {(kiosks.rows || kiosks.branches.map(code => ({ code, loading: true }))).map((d, i, arr) => (
          <DeviceRow key={d.code} device={d} isLast={i === arr.length - 1} />
        ))}
      </div>
    </section>
  )
}

function DeviceRow({ device, isLast }) {
  const border = isLast ? 'none' : '1px solid var(--gray-100)'
  if (device.loading) {
    return (
      <div style={{ padding: '12px 18px', borderBottom: border, fontSize: 12, color: 'var(--text-muted)' }}>
        {branchLabel(device.code)} — checking…
      </div>
    )
  }
  const s = device.status
  const color = s === 'Online' || s === 'Active' ? 'var(--green)' : s === 'Idle' ? 'var(--gold-dark)' : s === 'Offline' ? 'var(--crimson)' : 'var(--text-muted)'
  const bg = s === 'Online' || s === 'Active' ? 'var(--green-light)' : s === 'Idle' ? 'var(--gold-light)' : s === 'Offline' ? 'var(--crimson-light)' : 'var(--gray-100)'
  const punchMins = minutesAgo(device.lastPunch)
  const lastPunchLabel = device.lastPunch
    ? new Date(device.lastPunch).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <div style={{ padding: '11px 18px', borderBottom: border, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{branchLabel(device.code)}</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 9px', background: bg, color, borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
          {s}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        {device.beat ? <>Heartbeat {device.beat.secondsAgo}s ago</> : <>No heartbeat feed</>}
        <Dot />
        {device.lastPunch
          ? <>{device.punchesToday} punch{device.punchesToday === 1 ? '' : 'es'} today · last {lastPunchLabel} ({relTime(punchMins)})</>
          : <>no punches yet</>}
      </div>
    </div>
  )
}

function PunchFeedCard({ events, loading, multiBranch, onOpen }) {
  return (
    <section style={{ ...card }}>
      <CardHead title="Live punches" sub="Latest first · updates as the device syncs" />
      {loading ? (
        <div style={{ padding: '14px 18px' }}><Skeleton lines={3} /></div>
      ) : events.length === 0 ? (
        <div style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--text-muted)' }}>No punches recorded yet today.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {events.slice(0, 8).map((ev, i, arr) => {
            const name = ev.employees?.full_name || 'Unknown'
            const isIn = ev.event_type === 'in'
            const time = new Date(ev.event_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
            return (
              <div key={ev.id} onClick={() => ev.employee_id && onOpen(`/employees/${ev.employee_id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--gray-100)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <Avatar name={name} bg={isIn ? 'var(--green-light)' : 'var(--gray-100)'} fg={isIn ? 'var(--green-dark)' : 'var(--text-muted)'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    {methodLabel(ev.identification_method)}{multiBranch && ev.branch_code ? ` · ${shortBranch(ev.branch_code)}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: isIn ? 'var(--green-dark)' : 'var(--text-muted)' }}>{isIn ? 'In' : 'Out'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{time}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function UpcomingHolidaysCard({ items, multiBranch, onOpen }) {
  return (
    <section style={{ ...card }}>
      <CardHead title="Upcoming holidays" right={<LinkButton onClick={onOpen}>All →</LinkButton>} />
      {items == null ? (
        <div style={{ padding: '14px 18px' }}><Skeleton lines={2} /></div>
      ) : items.length === 0 ? (
        <div style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--text-muted)' }}>Nothing scheduled in the next 45 days.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((h, i) => {
            const d = new Date(h.date + 'T00:00:00')
            const days = daysUntil(h.date)
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px', borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--gray-100)' }}>
                <div style={{ width: 40, textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{d.getDate()}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{d.toLocaleDateString('en-IN', { month: 'short' })}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    {d.toLocaleDateString('en-IN', { weekday: 'long' })}
                    {h.end_date && h.end_date !== h.date ? ` → ${fmtShortDate(h.end_date)}` : ''}
                    {multiBranch ? ` · ${h.branch_code ? branchLabel(h.branch_code) : 'Both branches'}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: days === 0 ? 'var(--green-dark)' : 'var(--text-muted)', flexShrink: 0 }}>
                  {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ServicesCard({ supabaseState }) {
  return (
    <section style={{ ...card }}>
      <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <ServiceDot label="Firebase Auth" state="connected" />
        <ServiceDot label="Supabase" state={supabaseState} />
      </div>
    </section>
  )
}

function ServiceDot({ label, state }) {
  const ok = state === 'connected'
  const loading = state === 'checking'
  const color = ok ? 'var(--green)' : loading ? 'var(--gold-dark)' : 'var(--crimson)'
  const halo = ok ? 'var(--green-light)' : loading ? 'var(--gold-light)' : 'var(--crimson-light)'
  return (
    <span title={ok ? 'Connected' : state} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-muted)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 0 3px ${halo}` }} />
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ color: ok ? 'var(--text-muted)' : color, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ok ? 'connected' : loading ? 'checking…' : state}</span>
    </span>
  )
}

// ============================================================================
// Data hooks (rail + queue)
// ============================================================================

// Pending transfer requests touching any branch in scope. Table is anon-revoked,
// so this needs the admin client; without it the item simply doesn't render.
function usePendingTransfers(effectiveBranches) {
  const [state, setState] = useState({ count: null, preview: [] })
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!supabaseAdmin) return
      const list = effectiveBranches.join(',')
      const { data, error } = await supabaseAdmin
        .from('employee_transfers')
        .select('id, from_branch, to_branch, requested_at, employees(full_name)')
        .eq('status', 'pending')
        .or(`from_branch.in.(${list}),to_branch.in.(${list})`)
        .order('requested_at', { ascending: true })
        .limit(50)
      if (cancelled || error) return
      setState({
        count: data.length,
        preview: data.slice(0, 3).map(t => ({
          name: t.employees?.full_name || 'Employee',
          from: shortBranch(t.from_branch), to: shortBranch(t.to_branch),
        })),
      })
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [effectiveBranches])
  return state
}

// Next few holidays (today → +45 days) for the branches in scope.
function useUpcomingHolidays(effectiveBranches) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const today = todayInKolkata()
      const until = new Date(Date.now() + 45 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      let q = supabase.from('holidays')
        .select('id, date, end_date, name, branch_code')
        .gte('date', today)
        .lte('date', until)
        .order('date', { ascending: true })
        .limit(4)
      q = applyBranchFilterNullable(q, effectiveBranches)
      const { data, error } = await q
      if (cancelled) return
      setItems(error ? [] : (data || []))
    }
    load()
    return () => { cancelled = true }
  }, [effectiveBranches])
  return items
}

// Kiosk liveness — heartbeat (authoritative) merged with last-punch recency.
function useKioskStatus(effectiveBranches) {
  const branches = effectiveBranches.length > 0 ? effectiveBranches : BRANCHES.map(b => b.code)
  const branchesKey = branches.join(',')
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      let beats = {}
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 4000)
        const r = await fetch(KIOSK_STATUS_URL, { signal: ctl.signal })
        clearTimeout(timer)
        if (r.ok) {
          const j = await r.json()
          for (const d of j.devices || []) beats[d.branch] = d
        }
      } catch { /* receiver unreachable — punch data still renders */ }

      const today = todayInKolkata()
      const dayStartUtc = new Date(`${today}T00:00:00+05:30`).toISOString()

      const out = await Promise.all(branches.map(async code => {
        const [last, count] = await Promise.all([
          supabase.from('attendance_events').select('event_time').eq('branch_code', code)
            .order('event_time', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('attendance_events').select('id', { count: 'exact', head: true })
            .eq('branch_code', code).gte('event_time', dayStartUtc),
        ])
        const beat = beats[code] ?? null
        const lastPunch = last.data?.event_time ?? null
        const punchMins = minutesAgo(lastPunch)
        // Heartbeat wins; punches are the fallback for devices on the old path.
        const status =
          beat && beat.online ? 'Online' :
            beat ? 'Offline' :
              punchMins == null ? 'Not deployed' :
                punchMins < 30 ? 'Active' :
                  punchMins < 480 ? 'Idle' : 'Offline'
        return { code, lastPunch, punchesToday: count.count ?? 0, beat, status }
      }))
      if (!cancelled) setRows(out)
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchesKey])

  return { rows, branches }
}

// ============================================================================
// Small shared pieces
// ============================================================================
function CardHead({ title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--gray-100)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

function PrimaryButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px', background: 'var(--text)', color: 'var(--white)',
      border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      fontFamily: 'var(--font-body)',
    }}>{children}</button>
  )
}

function SecondaryButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px', background: 'var(--white)', color: 'var(--text)',
      border: '1px solid var(--gray-200)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      fontFamily: 'var(--font-body)',
    }}>{children}</button>
  )
}

function LinkButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--green)', fontFamily: 'var(--font-body)' }}>
      {children}
    </button>
  )
}

function Avatar({ name, bg, fg }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span style={{ width: 26, height: 26, borderRadius: '50%', background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </span>
  )
}

function LiveBadge({ updatedAt }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15_000); return () => clearInterval(t) }, [])
  const mins = updatedAt ? Math.floor((Date.now() - updatedAt) / 60000) : null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite' }} />
      {mins == null ? 'connecting…' : mins < 1 ? 'live' : `updated ${mins}m ago`}
    </span>
  )
}

function Dot() {
  return <span style={{ margin: '0 6px', color: 'var(--gray-300)' }}>·</span>
}

function Skeleton({ lines = 2 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ height: 12, borderRadius: 6, background: 'var(--gray-100)', width: `${90 - i * 18}%` }} />
      ))}
    </div>
  )
}

function useMediaQuery(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = e => setM(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}

// ---- formatting helpers ------------------------------------------------------
function greeting() {
  const { hour } = nowInKolkata()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function longDateLabel() {
  return new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function shortBranch(code) {
  return code === 'MAIN' ? 'Main' : code === 'CITY' ? 'City' : code
}

function methodLabel(m) {
  if (!m) return 'Punch'
  if (m === 'fingerprint') return 'Fingerprint'
  if (m === 'face') return 'Face'
  if (m === 'manual') return 'Manual entry'
  return m.charAt(0).toUpperCase() + m.slice(1)
}

function fmtTime(t) {
  if (!t) return '—'
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function fmtShortDate(iso) {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) } catch { return iso }
}

function daysUntil(iso) {
  const today = todayInKolkata()
  return Math.round((new Date(iso + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000)
}

function minutesAgo(isoString) {
  if (!isoString) return null
  const t = new Date(isoString).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 60000)
}

function relTime(mins) {
  if (mins == null) return '—'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
