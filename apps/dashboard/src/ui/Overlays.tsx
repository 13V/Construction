import type { ReactNode } from 'react'
import { money } from '../format'
import { statusColor, theme } from '../theme'
import type { CrewSnapshot, ExceptionKind, JobSite, WorkerState } from '../types'

/** Milliseconds on the clock today, including any shift still running. */
function liveMsFor(state: WorkerState, now: number): number {
  return (
    state.bankedMs +
    (state.clockedInAt !== null ? Math.max(0, now - state.clockedInAt) : 0)
  )
}

const panel = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  boxShadow: '0 2px 10px rgba(26,29,33,.10)',
} as const

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

const hoursLabel = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function StatStrip({ snapshot }: { snapshot: CrewSnapshot }) {
  const needsReview = snapshot.crew.filter((w) => w.exception !== null).length

  const cells: Array<{ label: string; value: string; dot?: string; alert?: boolean }> = [
    { label: 'ON THE CLOCK', value: String(snapshot.onClock), dot: theme.success },
    { label: 'HOURS TODAY', value: snapshot.hoursToday.toFixed(1) },
    { label: 'LABOUR COST TODAY', value: money(snapshot.labourCostToday) },
    { label: 'NEEDS REVIEW', value: String(needsReview), dot: theme.alert, alert: true },
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        boxShadow: '0 2px 10px rgba(26,29,33,.1)',
        overflow: 'hidden',
      }}
    >
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '8px 12px',
            borderLeft: i === 0 ? 'none' : `1px solid ${theme.border}`,
            flex: cell.alert ? 1 : 'none',
            background: cell.alert ? '#FFF9E8' : 'transparent',
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '.08em',
              color: '#8B9096',
              whiteSpace: 'nowrap',
            }}
          >
            {cell.label}
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              color: cell.alert ? theme.alert : theme.ink,
            }}
          >
            {cell.dot && (
              <span
                style={{ width: 7, height: 7, borderRadius: '50%', background: cell.dot }}
              />
            )}
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Short, human labels for the roster's red exception pill. */
const exceptionLabel: Record<ExceptionKind, string> = {
  outside_geofence: 'Outside geofence',
  signal_lost: 'Signal lost',
  no_clock_out: 'No clock-out',
}

function RosterRow({
  state,
  now,
  selected,
  onSelect,
}: {
  state: WorkerState
  now: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const dot = statusColor[state.status] ?? theme.inkFaint
  const ms = liveMsFor(state, now)
  const flag = state.exception ? (state.note ?? exceptionLabel[state.exception]) : null

  return (
    <button
      type="button"
      onClick={() => onSelect(state.worker.id)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 9,
        width: '100%',
        padding: '9px 13px',
        border: 'none',
        borderBottom: '1px solid #F1F3F5',
        borderLeft: `2px solid ${selected ? theme.accent : 'transparent'}`,
        background: selected ? theme.accentFill : 'transparent',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          position: 'relative',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: theme.railSoft,
          color: '#fff',
          fontSize: 10.5,
          fontWeight: 700,
        }}
      >
        {state.worker.initials}
        <span
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: '50%',
            border: '2px solid #fff',
            background: dot,
          }}
        />
      </span>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, color: theme.ink }}>
          {state.worker.name}
        </span>
        <span style={{ fontSize: 11.5, color: theme.inkSoft }}>{state.worker.trade}</span>
        {flag && (
          <span
            style={{
              marginTop: 3,
              display: 'inline-flex',
              alignSelf: 'flex-start',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              borderRadius: 9,
              background: '#FDECEE',
              color: theme.alert,
              fontSize: 10.5,
              fontWeight: 600,
            }}
          >
            {flag}
          </span>
        )}
      </div>

      <span
        style={{
          flex: 'none',
          fontSize: 12,
          color: '#4A5057',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ms > 0 ? hoursLabel(ms) : '—'}
      </span>
    </button>
  )
}

function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        color: '#4A5057',
        whiteSpace: 'nowrap',
      }}
    >
      {swatch}
      {label}
    </span>
  )
}

export function RosterPanel({
  snapshot,
  sites,
  selectedId,
  onSelect,
}: {
  snapshot: CrewSnapshot
  sites: JobSite[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'On site'
  const groups = new Map<string, WorkerState[]>()
  for (const state of snapshot.crew) {
    const key = state.exception
      ? 'Needs review'
      : state.siteId
        ? siteName(state.siteId)
        : state.status === 'off'
          ? 'Not scheduled'
          : 'En route'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(state)
  }

  // Problems first — that's what the office is scanning for.
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === 'Needs review' ? -1 : b === 'Needs review' ? 1 : a.localeCompare(b),
  )

  return (
    <div
      style={{
        width: 302,
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        boxShadow: '0 3px 14px rgba(26,29,33,.13)',
      }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 13px',
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: theme.ink }}>Crew right now</span>
        <span
          style={{ fontSize: 11.5, color: '#8B9096', fontVariantNumeric: 'tabular-nums' }}
        >
          {snapshot.crew.length} total
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {ordered.map(([label, members]) => (
          <div key={label}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 13px 6px',
                background: '#FAFBFC',
                borderBottom: '1px solid #EDEFF1',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: '.03em',
                  color: label === 'Needs review' ? theme.alert : '#4A5057',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
              <span
                style={{ fontSize: 11, color: '#8B9096', fontVariantNumeric: 'tabular-nums' }}
              >
                {members.length} {members.length === 1 ? 'person' : 'people'}
              </span>
            </div>
            {members.map((state) => (
              <RosterRow
                key={state.worker.id}
                state={state}
                now={snapshot.now}
                selected={selectedId === state.worker.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>

      <div
        style={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 13px',
          borderTop: `1px solid ${theme.border}`,
          background: '#FAFBFC',
        }}
      >
        <div
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 11, rowGap: 6 }}
        >
          <LegendItem
            swatch={
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: theme.railSoft,
                  border: `2px solid ${theme.success}`,
                }}
              />
            }
            label="On clock"
          />
          <LegendItem
            swatch={
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: theme.railSoft,
                  border: `2px solid ${theme.warning}`,
                }}
              />
            }
            label="Travelling"
          />
          <LegendItem
            swatch={
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: theme.railSoft,
                  border: `2px solid ${theme.alert}`,
                }}
              />
            }
            label="Exception"
          />
          <LegendItem
            swatch={
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: 'rgba(0,123,255,.16)',
                  border: `1px solid ${theme.accent}`,
                }}
              />
            }
            label="Geofence"
          />
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
        >
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{ fontSize: 12.5, fontWeight: 500, color: theme.accent }}
          >
            Open full crew list →
          </a>
          {/*
            The design draws a "500 ft" scale bar here. It was hardcoded and
            wired to nothing, so it stated a scale the map wasn't at — and in
            imperial, for an Australian builder. The map now carries MapLibre's
            real metric ScaleControl instead.
          */}
        </div>
      </div>

      <div style={{ flex: 'none', padding: '10px 13px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 11px',
            background: theme.panel,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(26,29,33,.08)',
          }}
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 16 16"
            fill="none"
            stroke={theme.success}
            strokeWidth={1.5}
            style={{ flex: 'none' }}
          >
            <rect x={3.4} y={7} width={9.2} height={6.4} rx={1.2} />
            <path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 12, color: '#4A5057' }}>
            Location tracked{' '}
            <b style={{ fontWeight: 600, color: theme.ink }}>
              6:00 AM – 4:00 PM on scheduled shifts only.
            </b>{' '}
            Never off the clock.
          </span>
        </div>
      </div>
    </div>
  )
}

export function EventLog({ snapshot }: { snapshot: CrewSnapshot }) {
  if (snapshot.events.length === 0) return null

  return (
    <div style={{ ...panel, width: 340, maxHeight: 190, overflowY: 'auto' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          padding: '8px 12px',
          background: theme.panel,
          borderBottom: `1px solid ${theme.border}`,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '.1em',
          color: theme.inkFaint,
        }}
      >
        GEOFENCE ACTIVITY
      </div>
      {snapshot.events.map((event) => (
        <div
          key={event.id}
          style={{
            display: 'flex',
            gap: 8,
            padding: '6px 12px',
            fontSize: 11.5,
            lineHeight: 1.35,
            color: theme.ink,
            borderBottom: `1px solid ${theme.appBg}`,
          }}
        >
          <span
            style={{
              flex: 'none',
              width: 4,
              borderRadius: 2,
              background:
                event.kind === 'clock_in'
                  ? theme.success
                  : event.kind === 'drive_by_rejected'
                    ? theme.warning
                    : event.kind === 'clock_out'
                      ? theme.inkFaint
                      : theme.alert,
            }}
          />
          <span>{event.message}</span>
        </div>
      ))}
    </div>
  )
}

function RailButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        background: active ? '#3D434A' : 'transparent',
        border: 0,
        borderRadius: 4,
        cursor: 'pointer',
        color: '#fff',
      }}
    >
      {children}
    </button>
  )
}

export function ToolRail({
  onZoomIn,
  onZoomOut,
  onFitSites,
  onFullscreen,
  fencesOn,
  onToggleFences,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitSites: () => void
  onFullscreen: () => void
  fencesOn: boolean
  onToggleFences: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 4,
        background: theme.rail,
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,.28)',
      }}
    >
      <RailButton title="Fullscreen" onClick={onFullscreen}>
        <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <path d="M2.5 5.8V2.5h3.3M10.2 2.5h3.3v3.3M13.5 10.2v3.3h-3.3M5.8 13.5H2.5v-3.3" />
        </svg>
      </RailButton>
      <RailButton title="Zoom in" onClick={onZoomIn}>
        <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <path d="M8 3.2v9.6M3.2 8h9.6" />
        </svg>
      </RailButton>
      <RailButton title="Zoom out" onClick={onZoomOut}>
        <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <path d="M3.2 8h9.6" />
        </svg>
      </RailButton>
      <div style={{ height: 1, background: '#454A50', margin: '4px 5px' }} />
      <RailButton title="Show all job sites" onClick={onFitSites}>
        <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
          <path d="M2 4h12M4.2 8h7.6M6.4 12h3.2" />
        </svg>
      </RailButton>
      <RailButton title={fencesOn ? 'Hide geofences' : 'Show geofences'} active={fencesOn} onClick={onToggleFences}>
        <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
          <path d="M8 2.2l5.6 3.1L8 8.4 2.4 5.3z" />
          <path d="M2.4 9.2L8 12.3l5.6-3.1" />
        </svg>
      </RailButton>
      <RailButton title="Recentre on your sites" onClick={onFitSites}>
        <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
          <circle cx={8} cy={8} r={4.4} />
          <path d="M8 1.4v2.2M8 12.4v2.2M1.4 8h2.2M12.4 8h2.2" />
        </svg>
      </RailButton>
    </div>
  )
}

export function Playback({
  now,
  speed,
  onSpeed,
}: {
  now: number
  speed: number
  onSpeed: (n: number) => void
}) {
  const speeds = [30, 90, 240]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        borderRadius: 6,
        background: theme.rail,
        color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,.28)',
      }}
    >
      <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {hhmm(now)}
      </span>
      <span style={{ fontSize: 9.5, letterSpacing: '.1em', color: '#8B9096' }}>
        SIMULATED DAY
      </span>
      <span style={{ display: 'flex', gap: 3 }}>
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            style={{
              padding: '2px 7px',
              borderRadius: 3,
              border: 'none',
              background: s === speed ? theme.accent : 'rgba(255,255,255,.12)',
              color: '#fff',
              font: 'inherit',
              fontSize: 10.5,
              cursor: 'pointer',
            }}
          >
            {s}×
          </button>
        ))}
      </span>
    </div>
  )
}
