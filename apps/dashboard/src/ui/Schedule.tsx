import { useEffect, useMemo, useState } from 'react'
import { supabase, type AssignmentRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Weekly dispatch board. Assignments are fetched directly against `assignments`
 * for the visible Mon-Sun range rather than threaded through CrewSnapshot —
 * this is a planning view of the future, not a read of what already happened.
 */

function startOfWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = date.getDay()
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day)) // Monday
  return date
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function timeToIso(day: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const date = new Date(day)
  date.setHours(h || 0, m || 0, 0, 0)
  return date.toISOString()
}

function isoToTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Deterministic muted colour per site so the same site always reads the same. */
function siteHue(siteId: string): number {
  let h = 0
  for (let i = 0; i < siteId.length; i++) h = (h * 31 + siteId.charCodeAt(i)) >>> 0
  return h % 360
}

function siteTint(siteId: string) {
  const hue = siteHue(siteId)
  return {
    bg: `hsl(${hue}, 50%, 94%)`,
    border: `hsl(${hue}, 42%, 68%)`,
    text: `hsl(${hue}, 48%, 28%)`,
  }
}

interface EditState {
  workerId: string
  day: Date
  assignmentId: string | null
  siteId: string
  start: string
  end: string
  note: string
}

export function Schedule({
  me,
  sites,
  workers,
  onChanged,
}: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const canEdit = me.is_office

  const [weekOffset, setWeekOffset] = useState(0)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<EditState | null>(null)

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const from = weekStart.toISOString()
      const to = addDays(weekStart, 7).toISOString()
      const { data, error: err } = await supabase()
        .from('assignments')
        .select('*')
        .eq('company_id', me.company_id)
        .gte('starts_at', from)
        .lt('starts_at', to)
        .order('starts_at')
      if (cancelled) return
      if (err) setError(err.message)
      else setAssignments((data ?? []) as AssignmentRow[])
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.company_id, weekOffset])

  async function reload() {
    const from = weekStart.toISOString()
    const to = addDays(weekStart, 7).toISOString()
    const { data, error: err } = await supabase()
      .from('assignments')
      .select('*')
      .eq('company_id', me.company_id)
      .gte('starts_at', from)
      .lt('starts_at', to)
      .order('starts_at')
    if (err) setError(err.message)
    else setAssignments((data ?? []) as AssignmentRow[])
  }

  function openNew(workerId: string, day: Date) {
    if (!canEdit) return
    setError(null)
    setEdit({
      workerId,
      day,
      assignmentId: null,
      siteId: sites[0]?.id ?? '',
      start: '07:00',
      end: '15:00',
      note: '',
    })
  }

  function openEdit(workerId: string, day: Date, a: AssignmentRow) {
    if (!canEdit) return
    setError(null)
    setEdit({
      workerId,
      day,
      assignmentId: a.id,
      siteId: a.site_id,
      start: isoToTime(a.starts_at),
      end: isoToTime(a.ends_at),
      note: a.note ?? '',
    })
  }

  async function save() {
    if (!edit) return
    if (!edit.siteId) {
      setError('Pick a job site.')
      return
    }
    const starts_at = timeToIso(edit.day, edit.start)
    const ends_at = timeToIso(edit.day, edit.end)
    if (ends_at <= starts_at) {
      setError('End time has to be after the start time.')
      return
    }
    setBusy(true)
    setError(null)

    const row = {
      company_id: me.company_id,
      worker_id: edit.workerId,
      site_id: edit.siteId,
      starts_at,
      ends_at,
      note: edit.note.trim() || null,
    }

    const client = supabase()
    const { error: err } = edit.assignmentId
      ? await client.from('assignments').update(row).eq('id', edit.assignmentId)
      : await client.from('assignments').insert({ ...row, published: false })

    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setEdit(null)
    await reload()
    onChanged()
  }

  async function remove() {
    if (!edit?.assignmentId) return
    setBusy(true)
    const { error: err } = await supabase().from('assignments').delete().eq('id', edit.assignmentId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setEdit(null)
    await reload()
    onChanged()
  }

  async function publish() {
    setBusy(true)
    setError(null)
    const from = weekStart.toISOString()
    const to = addDays(weekStart, 7).toISOString()
    const { error: err } = await supabase()
      .from('assignments')
      .update({ published: true })
      .eq('company_id', me.company_id)
      .eq('published', false)
      .gte('starts_at', from)
      .lt('starts_at', to)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    await reload()
    onChanged()
  }

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'Unknown site'

  const unpublished = assignments.filter((a) => !a.published)
  const notifyCount = new Set(unpublished.map((a) => a.worker_id)).size

  const hoursByWorker = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of assignments) {
      const ms = new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()
      map.set(a.worker_id, (map.get(a.worker_id) ?? 0) + ms / 3_600_000)
    }
    return map
  }, [assignments])

  const rangeLabel = `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Schedule</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>{rangeLabel}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={ghost} onClick={() => setWeekOffset((w) => w - 1)}>
              ‹ Prev
            </button>
            <button style={ghost} onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
              This week
            </button>
            <button style={ghost} onClick={() => setWeekOffset((w) => w + 1)}>
              Next ›
            </button>
          </div>

          {canEdit && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <button onClick={() => void publish()} disabled={busy || unpublished.length === 0} style={cta}>
                PUBLISH SCHEDULE
              </button>
              <div style={{ fontSize: 10.5, color: theme.inkSoft, marginTop: 3 }}>
                {unpublished.length === 0
                  ? 'Everything visible is already published.'
                  : `Notifies ${notifyCount} crew`}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 4,
              background: '#FCE9EB',
              color: theme.alert,
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        {edit && (
          <div style={card}>
            <div style={{ fontSize: 11.5, color: theme.inkSoft, marginBottom: 8 }}>
              {workers.find((w) => w.id === edit.workerId)?.name ?? 'Worker'} ·{' '}
              {edit.day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={fieldLabel}>
                Job site
                <select
                  style={field}
                  value={edit.siteId}
                  onChange={(e) => setEdit({ ...edit, siteId: e.target.value })}
                >
                  {sites.length === 0 && <option value="">No job sites yet</option>}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={fieldLabel}>
                Start
                <input
                  type="time"
                  style={field}
                  value={edit.start}
                  onChange={(e) => setEdit({ ...edit, start: e.target.value })}
                />
              </label>
              <label style={fieldLabel}>
                End
                <input
                  type="time"
                  style={field}
                  value={edit.end}
                  onChange={(e) => setEdit({ ...edit, end: e.target.value })}
                />
              </label>
              <label style={{ ...fieldLabel, flex: 1, minWidth: 180 }}>
                Note
                <input
                  style={field}
                  value={edit.note}
                  onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                  placeholder="Optional"
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void save()} disabled={busy} style={cta}>
                {busy ? 'SAVING…' : 'SAVE'}
              </button>
              <button onClick={() => setEdit(null)} style={ghost}>
                Cancel
              </button>
              {edit.assignmentId && (
                <button onClick={() => void remove()} disabled={busy} style={{ ...ghost, marginLeft: 'auto', color: theme.alert }}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 14, marginTop: 14, alignItems: 'flex-start' }}>
          <div style={{ ...card, margin: 0, flex: 1, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left', minWidth: 130 }}>Crew</th>
                    {days.map((day) => (
                      <th key={day.toISOString()} style={{ ...th, minWidth: 90 }}>
                        {day.toLocaleDateString([], { weekday: 'short' })}
                        <div style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: theme.inkSoft }}>
                          {day.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workers.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ ...td, color: theme.inkSoft, padding: 24 }}>
                        No crew yet — add someone on the Crew screen first.
                      </td>
                    </tr>
                  )}
                  {workers.map((worker) => (
                    <tr key={worker.id}>
                      <td style={{ ...td, fontWeight: 500, verticalAlign: 'top' }}>{worker.name}</td>
                      {days.map((day) => {
                        const dayAssignments = assignments.filter(
                          (a) => a.worker_id === worker.id && sameDay(new Date(a.starts_at), day),
                        )
                        return (
                          <td
                            key={day.toISOString()}
                            onClick={() => openNew(worker.id, day)}
                            style={{
                              ...td,
                              verticalAlign: 'top',
                              cursor: canEdit ? 'pointer' : 'default',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {dayAssignments.map((a) => {
                                const tint = siteTint(a.site_id)
                                return (
                                  <div
                                    key={a.id}
                                    title={a.note ?? undefined}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openEdit(worker.id, day, a)
                                    }}
                                    style={{
                                      padding: '4px 6px',
                                      borderRadius: 3,
                                      background: tint.bg,
                                      border: `1px ${a.published ? 'solid' : 'dashed'} ${tint.border}`,
                                      color: tint.text,
                                      fontSize: 11,
                                      cursor: canEdit ? 'pointer' : 'default',
                                    }}
                                  >
                                    <div style={{ fontWeight: 700 }}>{siteName(a.site_id)}</div>
                                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                                      {new Date(a.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                      {'–'}
                                      {new Date(a.ends_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    </div>
                                  </div>
                                )
                              })}
                              {canEdit && dayAssignments.length === 0 && (
                                <span style={{ fontSize: 14, color: theme.inkFaint }}>+</span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loading && (
              <div style={{ padding: 14, fontSize: 12.5, color: theme.inkSoft }}>Loading schedule…</div>
            )}
          </div>

          <div style={{ ...card, margin: 0, width: 240, flex: 'none' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: theme.inkFaint, marginBottom: 8 }}>
              Hours this week
            </div>
            {workers.length === 0 && <div style={{ fontSize: 12, color: theme.inkSoft }}>No crew yet.</div>}
            {workers.map((worker) => {
              const hrs = hoursByWorker.get(worker.id) ?? 0
              const overtime = hrs > 40
              const nearing = hrs > 38 && !overtime
              const color = overtime ? theme.alert : nearing ? theme.warning : theme.ink
              return (
                <div key={worker.id} style={{ padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span>{worker.name}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color }}>
                      {hrs.toFixed(1)} h
                    </span>
                  </div>
                  {(overtime || nearing) && (
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 11,
                        fontWeight: overtime ? 700 : 500,
                        color,
                      }}
                    >
                      {overtime ? 'Over 40 h — would hit overtime' : 'Approaching 38 h — would hit overtime'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const th = {
  padding: '8px 10px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
}

const td = {
  padding: '8px 10px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
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
  padding: '7px 13px',
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

const field = {
  display: 'block',
  width: '100%',
  height: 32,
  marginTop: 4,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const fieldLabel = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  minWidth: 130,
} as const
