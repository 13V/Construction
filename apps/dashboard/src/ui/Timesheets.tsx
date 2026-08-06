import { useMemo, useState } from 'react'
import { costCodes } from '../data/seed'
import { theme } from '../theme'
import type { CrewSnapshot, JobSite, Shift } from '../types'

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const hours = (ms: number) => (ms / 3_600_000).toFixed(2)

const cell = {
  padding: '7px 10px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
  verticalAlign: 'middle',
} as const

const head = {
  ...cell,
  position: 'sticky' as const,
  top: 0,
  background: theme.appBg,
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
}

/** Auto vs manual is the whole trust story — it gets an icon on every row. */
function Provenance({ shift }: { shift: Shift }) {
  const auto = shift.source === 'auto' && !shift.edited
  return (
    <span
      title={auto ? 'Captured automatically by GPS' : 'Entered or edited by hand'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        borderRadius: 3,
        fontSize: 11,
        background: auto ? theme.accentFill : '#FFF6DF',
        color: auto ? theme.accent : '#8A6100',
      }}
    >
      {auto ? '⌖' : '✎'} {auto ? 'GPS' : 'Manual'}
    </span>
  )
}

export function Timesheets({
  snapshot,
  sites,
}: {
  snapshot: CrewSnapshot
  sites: JobSite[]
}) {
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const siteById = (id: string) => sites.find((s) => s.id === id)

  const rows = useMemo(
    () =>
      [...snapshot.shifts].sort((a, b) => a.startedAt - b.startedAt),
    [snapshot.shifts],
  )

  const nameOf = (workerId: string) =>
    snapshot.crew.find((c) => c.worker.id === workerId)?.worker ?? null

  const msOf = (shift: Shift) =>
    Math.max(0, (shift.endedAt ?? snapshot.now) - shift.startedAt)

  const totalMs = rows.reduce((sum, s) => sum + msOf(s), 0)
  const totalCost = rows.reduce((sum, s) => {
    const worker = nameOf(s.workerId)
    return sum + (msOf(s) / 3_600_000) * (worker?.rate ?? 0)
  }, 0)

  const exceptions = [
    ...snapshot.crew
      .filter((c) => c.exception)
      .map((c) => `${c.worker.name} — ${c.note}`),
    ...snapshot.events
      .filter((e) => e.kind === 'drive_by_rejected')
      .map((e) => e.message),
  ]

  const toggle = (id: string) =>
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const approveAll = () => setApproved(new Set(rows.map((r) => r.id)))

  const today = new Date(snapshot.now).toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1180 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Timesheets</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{today}</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11.5,
              color: theme.inkSoft,
            }}
          >
            Built from geofence events — nobody typed these in.
          </span>
        </div>

        {exceptions.length > 0 && (
          <div
            style={{
              margin: '12px 0',
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderLeft: `3px solid ${theme.alert}`,
              borderRadius: 6,
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '.1em',
                color: theme.alert,
                marginBottom: 6,
              }}
            >
              NEEDS ATTENTION · {exceptions.length}
            </div>
            {exceptions.map((text) => (
              <div
                key={text}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '3px 0',
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1 }}>{text}</span>
                <button style={ghost}>Edit</button>
                <button style={ghost}>Approve</button>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            background: theme.panel,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={head}>Worker</th>
                <th style={head}>Job site</th>
                <th style={head}>Cost code</th>
                <th style={head}>In</th>
                <th style={head}>Out</th>
                <th style={{ ...head, textAlign: 'right' }}>Hours</th>
                <th style={head}>Source</th>
                <th style={{ ...head, textAlign: 'right' }}>Approve</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...cell, color: theme.inkSoft, padding: 24 }}>
                    No shifts yet today — they appear here the moment someone's
                    phone confirms they've settled on site.
                  </td>
                </tr>
              )}

              {rows.map((shift) => {
                const worker = nameOf(shift.workerId)
                const site = siteById(shift.siteId)
                const open = shift.endedAt === null
                const isApproved = approved.has(shift.id)
                // Cost code defaults from the trade until someone sets one.
                const code =
                  shift.costCode ??
                  (worker?.trade === 'Electrician'
                    ? costCodes[5].code
                    : worker?.trade === 'Finish carpenter'
                      ? costCodes[3].code
                      : costCodes[2].code)

                return (
                  <tr key={shift.id}>
                    <td style={{ ...cell, fontWeight: 500 }}>
                      {worker?.name ?? shift.workerId}
                      <span style={{ color: theme.inkFaint, fontWeight: 400 }}>
                        {' '}
                        · {worker?.trade}
                      </span>
                    </td>
                    <td style={cell}>{site?.name ?? '—'}</td>
                    <td style={{ ...cell, color: theme.inkSoft, fontSize: 12 }}>{code}</td>
                    <td style={cell}>{hhmm(shift.startedAt)}</td>
                    <td style={{ ...cell, color: open ? theme.success : theme.ink }}>
                      {open ? 'On the clock' : hhmm(shift.endedAt!)}
                    </td>
                    <td
                      style={{
                        ...cell,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 500,
                      }}
                    >
                      {hours(msOf(shift))}
                    </td>
                    <td style={cell}>
                      <Provenance shift={shift} />
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      <button
                        onClick={() => toggle(shift.id)}
                        style={{
                          ...ghost,
                          borderColor: isApproved ? theme.success : theme.border,
                          background: isApproved ? '#EAF7EE' : theme.panel,
                          color: isApproved ? '#1B7A32' : theme.ink,
                        }}
                      >
                        {isApproved ? '✓ Approved' : 'Approve'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              padding: '10px 14px',
              background: theme.appBg,
              fontSize: 12.5,
            }}
          >
            <span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {hours(totalMs)}
              </strong>{' '}
              hours
            </span>
            <span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                ${Math.round(totalCost).toLocaleString()}
              </strong>{' '}
              labour cost
            </span>
            <span style={{ color: theme.inkSoft }}>
              {approved.size} of {rows.length} approved
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={ghost} onClick={approveAll}>
                Approve all
              </button>
              <button style={cta}>EXPORT TO PAYROLL</button>
            </span>
          </div>
        </div>

        <p style={{ fontSize: 11.5, color: theme.inkFaint, marginTop: 12 }}>
          Export targets: QuickBooks · ADP · Gusto · Xero · MYOB — not wired up yet.
        </p>
      </div>
    </div>
  )
}

const ghost = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const

const cta = {
  padding: '5px 12px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const
