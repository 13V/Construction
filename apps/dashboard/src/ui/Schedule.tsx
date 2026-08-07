import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type AssignmentRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import { money } from '../format'
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

/** "7" for an on-the-hour time, "3:30" otherwise — the design's compact chip label. */
function compactTime(d: Date): string {
  const h24 = d.getHours()
  const m = d.getMinutes()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, '0')}`
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

/** Past 40h every hour is paid at 1.5×; past 38h it's close enough to flag before it happens. */
function hoursColor(hrs: number): string {
  if (hrs > 40) return theme.alert
  if (hrs > 38) return theme.warning
  return theme.ink
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

/**
 * A shift with a site and time but nobody assigned yet — the design's dispatch
 * board leads with these. `assignments.worker_id` is required by the schema,
 * so there is currently no way to persist one; this stays real (and empty)
 * rather than faking rows, ready to fill in once the data model can hold one.
 */
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
  const [siteFilter, setSiteFilter] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const load = useCallback(async () => {
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
    if (err) setError(err.message)
    else setAssignments((data ?? []) as AssignmentRow[])
    setLoading(false)
  }, [me.company_id, weekStart])

  useEffect(() => {
    setEdit(null) // the open editor would otherwise point at a day from the week we just left
    void load()
  }, [load])

  function openNew(workerId: string, day: Date) {
    if (!canEdit) return
    setError(null)
    setEdit({
      workerId,
      day,
      assignmentId: null,
      siteId: siteFilter || sites[0]?.id || '',
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
    await load()
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
    await load()
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
    await load()
    onChanged()
  }

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'Unknown site'

  // Hours and overtime always reflect the full week regardless of the site/trade
  // filters below — those only narrow what's drawn, never what counts toward 1.5×.
  const hoursByWorker = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of assignments) {
      const ms = new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()
      map.set(a.worker_id, (map.get(a.worker_id) ?? 0) + ms / 3_600_000)
    }
    return map
  }, [assignments])

  const unpublished = assignments.filter((a) => !a.published)
  const notifyCount = new Set(unpublished.map((a) => a.worker_id)).size

  const trades = useMemo(
    () => Array.from(new Set(workers.map((w) => w.trade).filter(Boolean))).sort(),
    [workers],
  )
  const visibleWorkers = useMemo(
    () => (tradeFilter ? workers.filter((w) => w.trade === tradeFilter) : workers),
    [workers, tradeFilter],
  )
  const visibleAssignments = useMemo(() => {
    const workerIds = new Set(visibleWorkers.map((w) => w.id))
    return assignments.filter((a) => workerIds.has(a.worker_id) && (!siteFilter || a.site_id === siteFilter))
  }, [assignments, visibleWorkers, siteFilter])

  const laborCost = visibleAssignments.reduce((sum, a) => {
    const worker = workers.find((w) => w.id === a.worker_id)
    const hrs = (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 3_600_000
    return sum + hrs * (worker?.rate ?? 0)
  }, 0)

  // No row in `assignments` can exist without a worker (schema requires worker_id),
  // so this stays empty until the product grows a real open-shift concept.

  const atRisk = useMemo(
    () =>
      workers
        .map((w) => ({ id: w.id, name: w.name, hrs: hoursByWorker.get(w.id) ?? 0 }))
        .filter((w) => w.hrs > 38)
        .sort((a, b) => b.hrs - a.hrs),
    [workers, hoursByWorker],
  )
  const allOverAtRisk = atRisk.length > 0 && atRisk.every((w) => w.hrs > 40)

  const availList = useMemo(
    () =>
      workers
        .map((w) => ({ worker: w, hrs: hoursByWorker.get(w.id) ?? 0 }))
        .sort((a, b) => b.hrs - a.hrs),
    [workers, hoursByWorker],
  )

  const rangeLabel = `${weekStart.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const today = new Date()

  // `assignments` has no published_at/published_by column, so the exact "who and
  // when" the design shows can't be told truthfully — this reports the same fact honestly instead.
  const publishStatus =
    unpublished.length === 0
      ? assignments.length === 0
        ? 'Nothing scheduled this week yet.'
        : 'This week is fully published.'
      : `${unpublished.length} shift${unpublished.length === 1 ? '' : 's'} not yet published this week.`

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.appBg }}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 40,
          padding: '0 12px',
          background: theme.panel,
          borderBottom: `1px solid ${theme.border}`,
          overflowX: 'auto',
        }}
      >
        <div style={{ flex: 'none', display: 'flex', height: 27, border: `1px solid ${theme.border}`, borderRadius: 3, overflow: 'hidden' }}>
          <span
            role="button"
            tabIndex={0}
            aria-label="Previous week"
            onClick={() => setWeekOffset((w) => w - 1)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setWeekOffset((w) => w - 1)
            }}
            style={{ display: 'flex', alignItems: 'center', padding: '0 9px', background: theme.panel, color: '#4A5057', fontSize: 13, cursor: 'pointer' }}
          >
            ‹
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 11px',
              background: theme.panel,
              borderLeft: `1px solid ${theme.border}`,
              borderRight: `1px solid ${theme.border}`,
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {rangeLabel}
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Next week"
            onClick={() => setWeekOffset((w) => w + 1)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setWeekOffset((w) => w + 1)
            }}
            style={{ display: 'flex', alignItems: 'center', padding: '0 9px', background: theme.panel, color: '#4A5057', fontSize: 13, cursor: 'pointer' }}
          >
            ›
          </span>
        </div>

        <button onClick={() => setWeekOffset(0)} style={weekBtnStyle}>
          This week
        </button>

        <div style={{ flex: 'none', width: 1, height: 20, background: theme.border, margin: '0 4px' }} />

        <FilterButton
          label={(siteFilter && siteName(siteFilter)) || 'All sites'}
          ariaLabel="Filter by job site"
          value={siteFilter}
          onChange={setSiteFilter}
          options={[{ value: '', label: 'All sites' }, ...sites.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <FilterButton
          label={tradeFilter || 'All trades'}
          ariaLabel="Filter by trade"
          value={tradeFilter}
          onChange={setTradeFilter}
          options={[{ value: '', label: 'All trades' }, ...trades.map((t) => ({ value: t, label: t }))]}
        />

        <div style={{ flex: 1 }} />

        {canEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <button onClick={() => void publish()} disabled={busy || unpublished.length === 0} style={publishBtnStyle}>
              PUBLISH SCHEDULE
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px 40px' }}>
        {error && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 4, background: '#FCE9EB', color: theme.alert, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {edit && (
          <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: '#8B9096', marginBottom: 8 }}>
              {workers.find((w) => w.id === edit.workerId)?.name ?? 'Worker'} ·{' '}
              {edit.day.toLocaleDateString('en-AU', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={fieldLabelStyle}>
                Job site
                <select style={fieldStyle} value={edit.siteId} onChange={(e) => setEdit({ ...edit, siteId: e.target.value })}>
                  {sites.length === 0 && <option value="">No job sites yet</option>}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={fieldLabelStyle}>
                Start
                <input type="time" style={fieldStyle} value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} />
              </label>
              <label style={fieldLabelStyle}>
                End
                <input type="time" style={fieldStyle} value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} />
              </label>
              <label style={{ ...fieldLabelStyle, flex: 1, minWidth: 180 }}>
                Note
                <input style={fieldStyle} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Optional" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => void save()} disabled={busy} style={ctaStyle}>
                {busy ? 'SAVING…' : 'SAVE'}
              </button>
              <button onClick={() => setEdit(null)} style={ghostStyle}>
                Cancel
              </button>
              {edit.assignmentId && (
                <button onClick={() => void remove()} disabled={busy} style={{ ...ghostStyle, marginLeft: 'auto', color: theme.alert }}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

            <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflowX: 'auto' }}>
              <div
                style={{
                  display: 'grid',
                  minWidth: 900,
                  gridTemplateColumns: '186px repeat(7,minmax(0,1fr))',
                  borderBottom: `1px solid ${theme.border}`,
                  background: '#FAFBFC',
                }}
              >
                <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: theme.inkSoft }}>CREW</div>
                {days.map((day) => {
                  const fg = sameDay(day, today) ? theme.accent : theme.inkSoft
                  return (
                    <div
                      key={day.toISOString()}
                      style={{ padding: '8px 10px', borderLeft: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 1 }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: fg }}>
                        {day.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: fg, fontVariantNumeric: 'tabular-nums' }}>
                        {day.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  )
                })}
              </div>

              {loading && <div style={{ padding: '14px 12px', fontSize: 12.5, color: '#8B9096' }}>Loading schedule…</div>}

              {!loading && visibleWorkers.length === 0 && (
                <div style={{ padding: 24, fontSize: 12.5, color: '#8B9096' }}>
                  {workers.length === 0 ? 'No crew yet — add someone on the Crew screen first.' : 'No crew matches this filter.'}
                </div>
              )}

              {!loading &&
                visibleWorkers.map((worker) => {
                  const hrs = hoursByWorker.get(worker.id) ?? 0
                  return (
                    <div
                      key={worker.id}
                      style={{
                        display: 'grid',
                        minWidth: 900,
                        gridTemplateColumns: '186px repeat(7,minmax(0,1fr))',
                        borderBottom: '1px solid #EDEFF1',
                        minHeight: 52,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px' }}>
                        <span
                          style={{
                            flex: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 27,
                            height: 27,
                            borderRadius: '50%',
                            background: theme.railSoft,
                            color: '#fff',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {worker.initials}
                        </span>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {worker.name}
                          </span>
                          <span style={{ fontSize: 11.5, color: '#8B9096', fontVariantNumeric: 'tabular-nums' }}>
                            {worker.trade} · {hrs.toFixed(1)} hrs
                          </span>
                        </div>
                      </div>
                      {days.map((day) => {
                        const dayAssignments = visibleAssignments.filter(
                          (a) => a.worker_id === worker.id && sameDay(new Date(a.starts_at), day),
                        )
                        const single = dayAssignments.length === 1
                        return (
                          <div
                            key={day.toISOString()}
                            onClick={canEdit ? () => openNew(worker.id, day) : undefined}
                            style={{ borderLeft: '1px solid #EDEFF1', padding: '5px 5px', cursor: canEdit ? 'pointer' : 'default' }}
                          >
                            {dayAssignments.length === 0
                              ? canEdit && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 40 }}>
                                    <span style={{ fontSize: 13, color: theme.inkFaint }}>+</span>
                                  </div>
                                )
                              : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%' }}>
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
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          height: single ? '100%' : undefined,
                                          minHeight: 40,
                                          padding: '6px 7px',
                                          borderRadius: 4,
                                          borderLeft: `3px ${a.published ? 'solid' : 'dashed'} ${tint.border}`,
                                          background: tint.bg,
                                          cursor: canEdit ? 'grab' : 'default',
                                        }}
                                      >
                                        <svg width="7" height="12" viewBox="0 0 9 14" fill={tint.border} style={{ flex: 'none', opacity: 0.65 }}>
                                          <circle cx="2" cy="2" r="1.3" />
                                          <circle cx="7" cy="2" r="1.3" />
                                          <circle cx="2" cy="7" r="1.3" />
                                          <circle cx="7" cy="7" r="1.3" />
                                          <circle cx="2" cy="12" r="1.3" />
                                          <circle cx="7" cy="12" r="1.3" />
                                        </svg>
                                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                          <span
                                            style={{
                                              fontSize: 11.5,
                                              fontWeight: 600,
                                              lineHeight: 1.2,
                                              color: tint.text,
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                          >
                                            {siteName(a.site_id)}
                                          </span>
                                          <span style={{ fontSize: 11, lineHeight: 1.2, color: tint.text, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                                            {compactTime(new Date(a.starts_at))}–{compactTime(new Date(a.ends_at))}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 13px', background: '#FAFBFC' }}>
                <span style={{ fontSize: 12.5, color: theme.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                  {visibleAssignments.length} shift{visibleAssignments.length === 1 ? '' : 's'} scheduled ·{' '}
                  {visibleAssignments.filter((a) => !a.published).length} not yet published
                </span>
                <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                  Projected labour{' '}
                  <b style={{ fontWeight: 600, color: theme.ink, fontVariantNumeric: 'tabular-nums' }}>{money(laborCost)}</b> this week
                </span>
              </div>
            </div>
          </div>

          <div style={{ flex: 'none', width: 290, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '10px 13px', borderBottom: `1px solid ${theme.border}`, fontSize: 14, fontWeight: 600 }}>Crew availability</div>

              {atRisk.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: '12px 13px',
                    borderBottom: `1px solid ${theme.border}`,
                    background: '#FFF6F7',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={theme.alert} strokeWidth={1.5} style={{ flex: 'none', marginTop: 1 }}>
                      <path d="M8 2.6L14.4 13H1.6z" strokeLinejoin="round" />
                      <path d="M8 6.4v3.1" strokeLinecap="round" />
                      <path d="M8 11.4h.01" strokeWidth={1.8} strokeLinecap="round" />
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#A00417' }}>
                        Overtime risk — {atRisk.length} worker{atRisk.length === 1 ? '' : 's'}
                      </span>
                      <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E3B41' }}>
                        {atRisk.map((w, i) => {
                          const sep = i === 0 ? '' : i === atRisk.length - 1 ? (atRisk.length > 2 ? ', and ' : ' and ') : ', '
                          return (
                            <span key={w.id} style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {sep}
                              {w.name} {i === 0 ? 'is at' : 'at'} <b style={{ fontWeight: 700 }}>{w.hrs.toFixed(1)} hrs</b>
                            </span>
                          )
                        })}
                        {'. '}
                        {allOverAtRisk
                          ? 'Already over — every extra hour is paid at 1.5×.'
                          : `One more shift tips ${atRisk.length === 2 ? 'both' : 'them'} into overtime at 1.5×.`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {availList.length === 0 && <div style={{ padding: '9px 13px', fontSize: 12, color: '#8B9096' }}>No crew yet.</div>}
              {availList.map(({ worker, hrs }) => {
                const color = hoursColor(hrs)
                const over = hrs > 40
                const nearing = hrs > 38 && !over
                const note = over ? 'Over 40 hrs — hits overtime' : nearing ? 'Approaching 38 hrs' : worker.trade
                const noteFg = over ? theme.alert : nearing ? theme.warning : '#8B9096'
                const bar = `${Math.max(0, Math.min(100, (hrs / 40) * 100))}%`
                return (
                  <div key={worker.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderBottom: '1px solid #F1F3F5' }}>
                    <span
                      style={{
                        flex: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: theme.railSoft,
                        color: '#fff',
                        fontSize: 9.5,
                        fontWeight: 700,
                      }}
                    >
                      {worker.initials}
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {worker.name}
                      </span>
                      <span style={{ fontSize: 11.5, color: noteFg }}>{note}</span>
                    </div>
                    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{hrs.toFixed(1)} h</span>
                      <span style={{ display: 'block', width: 46, height: 4, borderRadius: 2, background: '#EDEFF1', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: 4, borderRadius: 2, width: bar, background: color }} />
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {canEdit && (
              <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 13, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>When you publish</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <span style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: '#4A5057', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: theme.accent, fontWeight: 700 }}>→</span>
                    The week appears under My Jobs for {notifyCount} crew, next time they open the app
                  </span>
                  <span style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: '#4A5057' }}>
                    <span style={{ color: theme.accent, fontWeight: 700 }}>→</span>
                    Unpublished shifts stay yours — nobody sees a draft roster
                  </span>
                </div>
                {/*
                  This panel used to promise "notifies N crew by push + SMS",
                  "arms each site geofence for the assigned hours only" and
                  "locks cost codes". None of the three were true: there is no
                  notification transport in the app, api/ping.ts never reads
                  assignments, and the table has no cost_code column. A roster
                  the owner believes was texted out is worse than no roster.
                */}
                <div style={{ display: 'flex', gap: 9, padding: '9px 11px', background: '#FFF9E8', border: '1px solid #F0DCA8', borderRadius: 4 }}>
                  <span style={{ fontSize: 12, lineHeight: 1.45, color: '#8A6100' }}>
                    Crew are not texted or pushed — nothing sends yet. Tell them to check the app, or send the week
                    round yourself.
                  </span>
                </div>
                <div style={{ height: 1, background: '#EDEFF1', margin: '2px 0' }} />
                <span style={{ fontSize: 11.5, lineHeight: 1.45, color: '#8B9096' }}>{publishStatus}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterButton({
  label,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  label: string
  ariaLabel: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  const [hover, setHover] = useState(false)
  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 27,
        padding: '0 10px',
        background: hover ? theme.appBg : theme.panel,
        border: `1px solid ${hover ? '#C3C9D0' : theme.border}`,
        borderRadius: 3,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const weekBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const publishBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  height: 29,
  padding: '0 14px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: theme.ink,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const fieldLabelStyle = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.inkFaint,
  minWidth: 130,
} as const

const fieldStyle = {
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

const ghostStyle = {
  padding: '4px 10px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
} as const

const ctaStyle = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const
