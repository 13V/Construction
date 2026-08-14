/**
 * Home — the Simple design's opening screen, as drawn.
 *
 * Dark calendar card carrying today and tomorrow, the ON SITE and ATTENTION
 * counters, then today's jobs with their colour edges and honest chips. The
 * one thing on this screen the drawings are silent about is the clock — the
 * geofence tracker is the product's core and predates this design — so it
 * rides as the strip under the header: state-coloured, one tap to the full
 * tracker. Everything else is the drawing.
 */
import type { ReactNode } from 'react'
import type { JobSiteRow, WorkerRow } from '../../data/supabase'
import { jobColour, s } from './stheme'
import type { SimpleData } from './data'

const DAY = 86_400_000

function dayLabel(offset: number): string {
  const d = new Date(Date.now() + offset * DAY)
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

const clockTime = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
    .replace(' ', ' ')

/** The calendar card's per-day column: first two sites, then "+n more". */
function CalendarDay({
  label,
  date,
  rows,
}: {
  label: string
  date: string
  rows: Array<{ name: string; time: string; colour: string }>
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', color: s.onDarkFaint }}>
          {label.toUpperCase()}
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 600, color: s.onDark }}>{date}</span>
      </div>
      {rows.slice(0, 2).map((r) => (
        <div key={r.name + r.time} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ flex: 'none', width: 3, alignSelf: 'stretch', borderRadius: 2, background: r.colour }} />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: s.onDark,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {r.name}
            </span>
            <span style={{ fontSize: 12, color: s.onDarkMuted }}>{r.time}</span>
          </div>
        </div>
      ))}
      {rows.length > 2 && (
        <span style={{ fontSize: 12, color: s.onDarkFaint }}>+{rows.length - 2} more</span>
      )}
      {rows.length === 0 && <span style={{ fontSize: 12.5, color: s.onDarkFaint }}>Nothing booked</span>}
    </div>
  )
}

function Counter({
  label,
  value,
  tone,
  onTap,
}: {
  label: string
  value: number
  tone: 'plain' | 'alert'
  onTap?: () => void
}) {
  const alert = tone === 'alert' && value > 0
  return (
    <button
      onClick={onTap}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 16px',
        background: s.panel,
        border: `1px solid ${alert ? '#EEC7CB' : s.border}`,
        borderRadius: 14,
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.09em',
          color: alert ? s.red : s.muted,
        }}
      >
        {label.toUpperCase()}
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={s.ghost} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.05, color: alert ? s.red : s.ink }}>
        {value}
      </span>
    </button>
  )
}

export function HomeScreen({
  me,
  data,
  clockStrip,
  onOpenJob,
  onOpenSchedule,
  onOpenClock,
  onShowAccount,
}: {
  me: WorkerRow
  data: SimpleData
  /** The tracker's live state, rendered by the shell — colour and copy vary. */
  clockStrip: ReactNode
  onOpenJob: (site: JobSiteRow) => void
  onOpenSchedule: () => void
  onOpenClock: () => void
  onShowAccount: () => void
}) {
  const byId = new Map(data.sites.map((x) => [x.id, x]))
  const dayRows = (list: typeof data.today) => {
    const seen = new Map<string, { name: string; time: string; colour: string }>()
    for (const b of list) {
      const site = byId.get(b.site_id)
      if (!site || seen.has(site.id)) continue
      seen.set(site.id, { name: site.name, time: `${clockTime(b.starts_at)} – ${clockTime(b.ends_at)}`, colour: jobColour(site.id) })
    }
    return [...seen.values()]
  }

  const attention =
    data.pendingVariations + [...data.openDefects.values()].reduce((a, b) => a + b, 0)

  const active = data.sites.filter((x) => x.status === 'active')

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: s.appBg }}>
      {/* Header, as drawn: big Home, bell, initials. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 10px' }}>
        <span style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: s.ink }}>Home</span>
        <button
          onClick={onShowAccount}
          aria-label="Account"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 0,
            background: s.charcoal,
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {me.initials}
        </button>
      </div>

      {clockStrip}

      {/* The dark calendar card. */}
      <div style={{ margin: '10px 20px 0', borderRadius: 14, background: s.inkDeep, padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: s.onDarkMuted }}>CALENDAR</span>
          <button
            onClick={onOpenSchedule}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 0, padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: s.onDark, cursor: 'pointer' }}
          >
            Open schedule
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={s.onDarkMuted} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          <CalendarDay label="Today" date={dayLabel(0)} rows={dayRows(data.today)} />
          <span style={{ flex: 'none', width: 1, background: 'rgba(255,255,255,.09)' }} />
          <CalendarDay label="Tomorrow" date={dayLabel(1)} rows={dayRows(data.tomorrow)} />
        </div>
      </div>

      {/* Counters. */}
      <div style={{ display: 'flex', gap: 10, margin: '12px 20px 0' }}>
        <Counter label="On site" value={data.onSiteTotal} tone="plain" onTap={onOpenClock} />
        <Counter label="Attention" value={attention} tone="alert" />
      </div>

      {/* Today's jobs. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '18px 20px 8px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: s.muted }}>TODAY</span>
        <span style={{ fontSize: 12.5, color: s.muted }}>
          {active.length} active job{active.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 20px 20px' }}>
        {active.map((site) => {
          const defects = data.openDefects.get(site.id) ?? 0
          return (
            <button
              key={site.id}
              onClick={() => onOpenJob(site)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 14px 14px 0',
                background: s.panel,
                border: `1px solid ${s.border}`,
                borderRadius: 12,
                overflow: 'hidden',
                textAlign: 'left',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ flex: 'none', width: 4, alignSelf: 'stretch', background: jobColour(site.id) }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: s.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {site.name}
                </span>
                <span style={{ fontSize: 13, color: s.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[site.address || site.job_type, site.schedule_note].filter(Boolean).join(' · ') || site.job_type}
                </span>
              </div>
              {defects > 0 && (
                <span
                  style={{
                    flex: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 12,
                    background: s.redFill,
                    color: s.red,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.red }} />
                  {defects} defect{defects === 1 ? '' : 's'}
                </span>
              )}
              <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
                <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={s.ghost} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )
        })}
        {active.length === 0 && !data.loading && (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 13.5, lineHeight: 1.5, color: s.muted }}>
            No active jobs yet. Jobs the office adds show up here, and tapping one opens
            everything about it — photos, plans, waterproofing, chat.
          </div>
        )}
      </div>
    </div>
  )
}
