import React from 'react'
import { STATUS_META } from '../lib/todayRoster'

// ============================================================================
// SHARED PAGE PRIMITIVES — the dashboard's visual language, reusable.
//
//   <Page>            28/32px padded column, 1280 max, 18px gap
//   <PageHead>        eyebrow · 24px/700 title · one-line purpose · actions right
//   <Card>/<CardHead> white surface, hairline border, 14px radius; 14px/700 head
//   <PrimaryButton>   ink fill, white text, 10px radius
//   <SecondaryButton> white, hairline border
//   <Segment>         pill track with an ink active segment (Active / Inactive / All)
//   <Chip>            999 radius filter chip; active = ink
//   <StatusChip>      attendance status chip (colour from STATUS_META), optional active ring
//   <SegmentBar>      proportional status bar
//   <SearchInput>     36px search field with leading icon
//   tableHead / tableCell  th/td styles for card tables
//
// Everything reads CSS vars only, so light and dark themes both work.
// ============================================================================

export const card = {
  background: 'var(--white)',
  border: '1px solid var(--gray-200)',
  borderRadius: 14,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

export function Page({ children, maxWidth = 1280, style }) {
  return (
    <div style={{ padding: '28px 32px 40px', maxWidth, display: 'flex', flexDirection: 'column', gap: 18, ...style }}>
      {children}
    </div>
  )
}

export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1.15, marginBottom: sub ? 6 : 0, letterSpacing: '-0.01em' }}>
          {title}
        </h1>
        {sub && <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{sub}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  )
}

export function Card({ children, style }) {
  return <section style={{ ...card, ...style }}>{children}</section>
}

export function CardHead({ title, sub, right, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--gray-100)', ...style }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

const btnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '8px 14px', borderRadius: 10,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'var(--font-body)', lineHeight: 1.2, whiteSpace: 'nowrap',
}

export const primaryButtonStyle = { ...btnBase, background: 'var(--text)', color: 'var(--white)', border: '1px solid var(--text)' }
export const secondaryButtonStyle = { ...btnBase, background: 'var(--white)', color: 'var(--text)', border: '1px solid var(--gray-200)' }
export const dangerButtonStyle = { ...btnBase, background: 'var(--crimson)', color: '#fff', border: '1px solid var(--crimson)' }
export const smallSecondaryButtonStyle = { ...secondaryButtonStyle, padding: '5px 10px', fontSize: 12, borderRadius: 8 }

export function PrimaryButton({ children, onClick, disabled, title, icon, style }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{ ...primaryButtonStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      {icon}{children}
    </button>
  )
}

export function SecondaryButton({ children, onClick, disabled, title, icon, style }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{ ...secondaryButtonStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}>
      {icon}{children}
    </button>
  )
}

export function LinkButton({ children, onClick, style }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--green)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', ...style }}>
      {children}
    </button>
  )
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

// Segmented control: [Active 84] [Inactive 12] [All 96]
export function Segment({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', border: 'none', borderRadius: 8,
            background: active ? 'var(--text)' : 'transparent',
            color: active ? 'var(--white)' : 'var(--text-muted)',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
          }}>
            {o.label}
            {o.count != null && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '0 6px', borderRadius: 999, background: active ? 'rgba(255,255,255,0.18)' : 'var(--gray-100)', color: active ? 'var(--white)' : 'var(--text-muted)' }}>
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Chip({ active, onClick, children, count, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 12px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--text)' : 'var(--gray-200)'}`,
      background: active ? 'var(--text)' : 'var(--white)',
      color: active ? 'var(--white)' : disabled ? 'var(--gray-400)' : 'var(--text)',
      fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-body)',
      whiteSpace: 'nowrap', ...style,
    }}>
      {children}
      {count != null && <span style={{ fontWeight: 700, opacity: active ? 0.85 : 0.7 }}>{count}</span>}
    </button>
  )
}

export function StatusChip({ status, count, active, onClick }) {
  const m = STATUS_META[status] || STATUS_META.not_marked
  const zero = !count
  return (
    <button onClick={zero && !active ? undefined : onClick} disabled={zero && !active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '5px 10px 5px 8px',
      background: zero ? 'transparent' : m.bg,
      border: `1px solid ${zero ? 'var(--gray-100)' : 'transparent'}`,
      boxShadow: active ? '0 0 0 2px var(--text)' : 'none',
      borderRadius: 999,
      fontSize: 12, fontWeight: 600,
      color: zero ? 'var(--gray-400)' : m.fg,
      cursor: zero && !active ? 'default' : 'pointer',
      fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: zero ? 'var(--gray-200)' : m.bar }} />
      <span>{m.label}</span>
      <span style={{ fontWeight: 700 }}>{count ?? 0}</span>
    </button>
  )
}

export function SegmentBar({ counts, order, height = 10 }) {
  const total = counts.total || 0
  if (total === 0) return null
  const segs = order.filter(s => counts[s] > 0)
  return (
    <div style={{ display: 'flex', width: '100%', height, borderRadius: 999, overflow: 'hidden', background: 'var(--gray-100)', gap: 2 }}>
      {segs.map(s => (
        <div key={s} title={`${STATUS_META[s].label}: ${counts[s]}`} style={{ flex: `${counts[s]} 0 auto`, minWidth: 4, background: STATUS_META[s].bar, transition: 'flex 0.4s ease' }} />
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, width = 260, style }) {
  return (
    <div style={{ position: 'relative', width, maxWidth: '100%', ...style }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2" strokeLinecap="round"
        style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', height: 36, padding: '0 12px 0 32px',
          border: '1px solid var(--gray-200)', borderRadius: 10,
          fontSize: 13, background: 'var(--white)', color: 'var(--text)',
          outline: 'none', fontFamily: 'var(--font-body)',
        }}
      />
    </div>
  )
}

export const tableHead = {
  textAlign: 'left',
  padding: '10px 16px',
  fontSize: 10.5,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  background: 'var(--gray-50)',
  borderBottom: '1px solid var(--gray-100)',
  whiteSpace: 'nowrap',
}

export const tableCell = {
  padding: '12px 16px',
  fontSize: 13,
  color: 'var(--text)',
  verticalAlign: 'middle',
}

export function Avatar({ name, bg = 'var(--gray-100)', fg = 'var(--text-muted)', size = 28 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </span>
  )
}

export function Pill({ children, bg = 'var(--gray-100)', fg = 'var(--text-muted)', title, style }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', background: bg, color: fg, whiteSpace: 'nowrap', ...style }}>
      {children}
    </span>
  )
}

export function Dot() {
  return <span style={{ margin: '0 6px', color: 'var(--gray-300)' }}>·</span>
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ width: 22, height: 22, border: '2px solid var(--green-muted)', borderTopColor: 'var(--green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 10px' }} />
      <div style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}

export function EmptyBlock({ title, sub, action }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 420 }}>{sub}</div>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  )
}
