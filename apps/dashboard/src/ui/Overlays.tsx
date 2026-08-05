import type { CrewSnapshot } from '../state/useCrew'
import { liveMsFor } from '../state/useCrew'
import { siteById } from '../data/seed'
import { statusColor, statusLabel, theme } from '../theme'
import type { WorkerState } from '../types'

const panel = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  boxShadow: '0 2px 10px rgba(26,29,33,.10)',
} as const

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const hoursLabel = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function StatStrip({ snapshot }: { snapshot: CrewSnapshot }) {
  const cells: Array<[string, string, string?]> = [
    ['On the clock', String(snapshot.onClock), theme.success],
    ['Active sites', String(snapshot.activeSites)],
    ['Hours today', snapshot.hoursToday.toFixed(1)],
    ['Labour cost today', `$${Math.round(snapshot.labourCostToday).toLocaleString()}`],
  ]

  return (
    <div style={{ ...panel, display: 'flex', overflow: 'hidden' }}>
      {cells.map(([label, value, dot], i) => (
        <div
          key={label}
          style={{
            padding: '8px 16px',
            borderLeft: i === 0 ? 'none' : `1px solid ${theme.border}`,
            minWidth: 104,
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '.1em',
              color: theme.inkFaint,
              textTransform: 'uppercase',
            }}
          >
            {label}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 3,
              fontSize: 19,
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {dot && (
              <span
                style={{ width: 7, height: 7, borderRadius: '50%', background: dot }}
              />
            )}
            {value}
          </div>
        </div>
      ))}
    </div>
  )
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

  return (
    <button
      onClick={() => onSelect(state.worker.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '7px 12px',
        border: 'none',
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
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: theme.railSoft,
          color: '#fff',
          fontSize: 10,
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

      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 12.5,
            fontWeight: 500,
            color: theme.ink,
          }}
        >
          {state.worker.name}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: state.exception ? theme.alert : theme.inkSoft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {state.note ??
            (state.clockedInAt
              ? `${state.worker.trade} · in ${hhmm(state.clockedInAt)}`
              : `${state.worker.trade} · ${statusLabel[state.status]}`)}
        </span>
      </span>

      <span
        style={{
          flex: 'none',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          color: ms > 0 ? theme.ink : theme.inkFaint,
        }}
      >
        {ms > 0 ? hoursLabel(ms) : '—'}
      </span>
    </button>
  )
}

export function RosterPanel({
  snapshot,
  selectedId,
  onSelect,
}: {
  snapshot: CrewSnapshot
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const groups = new Map<string, WorkerState[]>()
  for (const state of snapshot.crew) {
    const key = state.exception
      ? 'Needs review'
      : state.siteId
        ? (siteById(state.siteId)?.name ?? 'On site')
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
        ...panel,
        width: 300,
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 'none',
          padding: '10px 12px',
          borderBottom: `1px solid ${theme.border}`,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Crew
        <span style={{ marginLeft: 6, color: theme.inkFaint, fontWeight: 400 }}>
          {snapshot.crew.length}
        </span>
      </div>

      <div style={{ overflowY: 'auto' }}>
        {ordered.map(([label, members]) => (
          <div key={label}>
            <div
              style={{
                padding: '7px 12px 4px',
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: label === 'Needs review' ? theme.alert : theme.inkFaint,
                background: theme.appBg,
              }}
            >
              {label}
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
          padding: '8px 12px',
          borderTop: `1px solid ${theme.border}`,
          fontSize: 10.5,
          color: theme.inkSoft,
          lineHeight: 1.4,
        }}
      >
        Location tracked 6:00 AM – 4:00 PM on scheduled shifts only.
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

export function ToolRail() {
  const icons = ['⤢', '＋', '−', '◎', '⛭']
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: theme.rail,
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,.28)',
      }}
    >
      {icons.map((icon, i) => (
        <span
          key={icon}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            color: '#fff',
            fontSize: 13,
            borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,.10)',
            cursor: 'pointer',
          }}
        >
          {icon}
        </span>
      ))}
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
