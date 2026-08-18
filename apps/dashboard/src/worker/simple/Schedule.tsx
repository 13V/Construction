/**
 * Schedule — the client's programme view. A dark PROGRAM header with a
 * Quarter / Month / Week / Day switcher:
 *
 *   Quarter — every job as a Gantt bar across a three-month window:
 *            charcoal bar, white end cap, green fill for work done, the
 *            date range under the bar and the status chip on the job tile.
 *            Dates prefer the job's imported programme (programme_tasks,
 *            our lines); jobs without one fall back to what actually
 *            happened — first shift or booking to last.
 *   Month  — the same bars over one month, one column per day, panning
 *            sideways under the pinned tiles and opening centred on today.
 *   Week   — the drawn week strip and day cards, unchanged.
 *   Day    — one day's cards with a previous / next day stepper.
 *
 * RLS scopes everything — the owner reads the whole company, a crew member
 * their own bookings.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type AssignmentRow, type JobSiteRow } from '../../data/supabase'
import { avatarGrey, builderOf, railOf, s, SAFE_TOP, streetLine } from './stheme'
import type { SimpleData } from './data'
import type { JobTab } from './Job'

const DAY = 86_400_000
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

/** Monday of the week containing `d`, at local midnight. */
const mondayOf = (d: Date) => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

const dmy = (d: Date, withYear = false) => `${d.getDate()} ${MON3[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`

/** "12 Sep – 28 Oct", collapsing a one-day job to its single date. */
const rangeLabel = (from: Date, to: Date, withYear = false) =>
  from.toDateString() === to.toDateString() ? dmy(from, withYear) : `${dmy(from, withYear)} – ${dmy(to, withYear)}`

// ------------------------------------------------------------- programme data

type BarStatus = 'progress' | 'upcoming' | 'done'

interface ProgRow {
  site: JobSiteRow
  start: Date | null
  end: Date | null
  status: BarStatus
  pct: number
}

const STATUS_META: Record<BarStatus, { label: string; color: string }> = {
  progress: { label: 'In Progress', color: '#1F7A4D' },
  upcoming: { label: 'Upcoming', color: '#2F6FED' },
  done: { label: 'Completed', color: '#8B9096' },
}

const STATUS_ORDER: Record<BarStatus, number> = { progress: 0, upcoming: 1, done: 2 }

/**
 * One row per job with its programme range. The imported programme (our
 * lines) wins; without one the range is real activity — first booking or
 * shift to the last. Sites are fetched here rather than taken from
 * SimpleData because finished (archived) jobs belong on a programme and
 * SimpleData deliberately hides them everywhere else.
 */
function useProgrammeRows(progress: Map<string, number>): { rows: ProgRow[]; loading: boolean } {
  const [sites, setSites] = useState<JobSiteRow[]>([])
  const [spans, setSpans] = useState<Map<string, { s: number; e: number }>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client.from('job_sites').select('*').order('name'),
      client.from('programme_tasks').select('site_id, starts_on, ends_on').eq('is_ours', true),
      client.from('assignments').select('site_id, starts_at, ends_at').limit(4000),
      client.from('shifts').select('site_id, started_at').limit(5000),
    ]).then(([js, pt, asg, sh]) => {
      if (cancelled) return
      const grow = (m: Map<string, { s: number; e: number }>, id: string, from: number, to: number) => {
        const cur = m.get(id)
        if (!cur) m.set(id, { s: from, e: to })
        else {
          cur.s = Math.min(cur.s, from)
          cur.e = Math.max(cur.e, to)
        }
      }
      const prog = new Map<string, { s: number; e: number }>()
      for (const t of (pt.data ?? []) as Array<{ site_id: string; starts_on: string | null; ends_on: string | null }>) {
        if (!t.starts_on) continue
        const from = new Date(`${t.starts_on}T00:00:00`).getTime()
        const to = new Date(`${t.ends_on ?? t.starts_on}T00:00:00`).getTime()
        grow(prog, t.site_id, from, to)
      }
      const act = new Map<string, { s: number; e: number }>()
      for (const a of (asg.data ?? []) as Array<{ site_id: string; starts_at: string; ends_at: string }>) {
        grow(act, a.site_id, new Date(a.starts_at).getTime(), new Date(a.ends_at).getTime())
      }
      for (const x of (sh.data ?? []) as Array<{ site_id: string; started_at: string }>) {
        const t = new Date(x.started_at).getTime()
        grow(act, x.site_id, t, t)
      }
      const merged = new Map<string, { s: number; e: number }>()
      for (const site of (js.data ?? []) as JobSiteRow[]) {
        const span = prog.get(site.id) ?? act.get(site.id)
        if (span) merged.set(site.id, span)
      }
      setSites((js.data ?? []) as JobSiteRow[])
      setSpans(merged)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    const out: ProgRow[] = sites.map((site) => {
      const span = spans.get(site.id)
      const start = span ? new Date(span.s) : null
      const end = span ? new Date(span.e) : null
      const done = site.status === 'archived'
      const notStarted = !start || start.getTime() > today.getTime()
      const status: BarStatus = done ? 'done' : notStarted || site.status === 'starting_soon' ? 'upcoming' : 'progress'
      return { site, start, end, status, pct: progress.get(site.id) ?? 0 }
    })
    out.sort((a, b) => {
      const g = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      if (g !== 0) return g
      if (a.status === 'done') return (b.end?.getTime() ?? 0) - (a.end?.getTime() ?? 0)
      return (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity)
    })
    return out
  }, [sites, spans, progress])

  return { rows, loading }
}

// ---------------------------------------------------------------- the gantt

/**
 * The job column's width, and the row height both panes share. They are
 * constants because the two panes line up by agreeing on them — a tile that
 * grew taller than its lane would shear the whole chart.
 */
const TILE_W = 144
const ROW_H = 112

const CHIP_TONE: Record<BarStatus, { bg: string; fg: string }> = {
  progress: { bg: '#EAF7EC', fg: '#1F7A4D' },
  upcoming: { bg: '#EAF0FE', fg: '#2F5FD7' },
  done: { bg: '#F1F3F5', fg: '#696D74' },
}

/**
 * The bar chart itself, shared by Year and Month: a PROJECT column, the
 * lane whose window is [w0, w1), and a fixed status column of chips.
 * Gridlines, shaded bands and column labels come in as percentages so the
 * two views stay one component.
 */
function Gantt({
  rows,
  w0,
  w1,
  gridAt,
  bands,
  labels,
  labelSize = 8.5,
  laneWidth,
  loading,
  onOpenJob,
}: {
  rows: ProgRow[]
  w0: number
  w1: number
  /** Vertical gridline positions, % of the lane. */
  gridAt: number[]
  /** Shaded background bands [from%, to%] — weekends, alternate months. */
  bands: Array<[number, number]>
  /** Column labels: [%, text, optional dim flag — weekends read quieter]. */
  labels: Array<[number, string] | [number, string, number]>
  /** Header label size — the month view runs 31 numbers, so it goes small. */
  labelSize?: number
  /**
   * Fixed lane width in px. When set, the chart pans sideways under the
   * pinned job tiles — how a day-per-column month fits a phone — and opens
   * centred on today.
   */
  laneWidth?: number
  loading: boolean
  onOpenJob: (site: JobSiteRow) => void
}) {
  const span = w1 - w0
  const scrollable = laneWidth !== undefined
  const scrollRef = useRef<HTMLDivElement>(null)
  const visible = rows.filter((r) => !r.start || !r.end || (r.end.getTime() >= w0 && r.start.getTime() < w1))
  // The anchor that makes the chart readable at a glance: where "now" falls.
  const t = Date.now()
  const todayPct = t >= w0 && t < w1 ? ((t - w0) / span) * 100 : null
  const headH = todayPct !== null ? 42 : 32

  const counts: Record<BarStatus, number> = { progress: 0, upcoming: 0, done: 0 }
  for (const r of visible) counts[r.status] += 1

  // A pannable chart opens where the reader is: today in the middle.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !scrollable || todayPct === null || laneWidth === undefined) return
    el.scrollLeft = Math.max(0, (laneWidth * todayPct) / 100 - el.clientWidth / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollable, laneWidth, w0])

  /** Everything the lane needs to draw one job, worked out once per row. */
  const geometry = visible.map((r) => {
    let bar: { left: number; width: number; clipL: boolean; clipR: boolean } | null = null
    if (r.start && r.end) {
      const from = Math.max(r.start.getTime(), w0)
      const to = Math.min(r.end.getTime() + DAY, w1)
      if (to > from) {
        bar = {
          left: ((from - w0) / span) * 100,
          width: ((to - from) / span) * 100,
          // A bar that runs past the window gets a squared edge — the
          // standard "continues beyond here" mark.
          clipL: r.start.getTime() < w0,
          clipR: r.end.getTime() + DAY > w1,
        }
      }
    }
    return {
      r,
      bar,
      // The green is the job's percentage, plainly — the same number the
      // chip shows, filling the bar you can see. (It used to be pegged to
      // the date that percentage fell on, which made the green disappear
      // whenever that date sat outside the window.)
      fill: r.status === 'progress' ? Math.min(Math.max(r.pct, 0), 100) : 0,
      // A one-day job is a milestone, and a milestone is a diamond.
      milestone: r.start !== null && r.end !== null && r.start.toDateString() === r.end.toDateString(),
    }
  })

  return (
    <div style={{ background: '#fff' }}>
      {/* The legend doubles as the summary — and explains the colours. */}
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6, padding: '0 16px 12px' }}>
        {(['progress', 'upcoming', 'done'] as const)
          .filter((k) => counts[k] > 0)
          .map((k) => (
            <span
              key={k}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: CHIP_TONE[k].bg, fontSize: 10.5, fontWeight: 700, color: CHIP_TONE[k].fg }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: CHIP_TONE[k].fg }} />
              {counts[k]} {STATUS_META[k].label.toLowerCase()}
            </span>
          ))}
      </div>

      {/*
       * Two panes, not one scrolling table. The job column is a sibling of
       * the chart rather than a sticky cell inside it — sticky positioning
       * inside a horizontally scrolling flex row is exactly the thing iOS
       * drops, and the tiles slid away with the bars on the phone. Panes
       * cannot slide: the left one simply is not in the scroller. They line
       * up because every row is the same fixed height in both.
       */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 'none', width: TILE_W, borderRight: '1px solid #EAEDF0' }}>
          <span style={{ display: 'flex', alignItems: 'center', height: headH, padding: '0 8px 0 16px', background: '#FAFBFC', borderTop: '1px solid #E9EDF0', borderBottom: '1px solid #E1E5E9', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' }}>
            PROJECT
          </span>
          {geometry.map(({ r }) => {
            // When the job runs, not how far through it is — the dates are
            // what a programme is read for, and the bar already carries the
            // progress in green. Its colour still says which state this is.
            const chipLabel = r.start && r.end ? rangeLabel(r.start, r.end) : 'No dates yet'
            return (
              <div
                key={r.site.id}
                onClick={() => onOpenJob(r.site)}
                style={{ display: 'flex', alignItems: 'stretch', height: ROW_H, boxSizing: 'border-box', padding: '7px 7px 7px 10px', borderBottom: '1px solid #EFF1F4', cursor: 'pointer' }}
              >
                {/* The job as a charcoal tile — the app's dark card: white
                    name, trade line, the dates it runs, and the job's own
                    rail colour on the edge, as its cards carry elsewhere. */}
                <span style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center', padding: '9px 10px 9px 13px', borderRadius: 10, background: 'linear-gradient(#23272C,#15181C)' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: railOf(r.site) }} />
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.01em', lineHeight: 1.25, color: '#fff', textTransform: 'uppercase', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {r.site.name}
                  </span>
                  {/* Where it is and who it is for. The trade was here and
                      told a foreman nothing he could act on — every one of
                      these jobs is tiling. */}
                  {streetLine(r.site) && (
                    <span style={{ fontSize: 9.5, lineHeight: 1.3, color: '#98A0A8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {streetLine(r.site)}
                    </span>
                  )}
                  {builderOf(r.site) && (
                    <span style={{ fontSize: 9.5, lineHeight: 1.3, fontWeight: 600, color: '#C2C8CE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {builderOf(r.site)}
                    </span>
                  )}
                  <span style={{ alignSelf: 'flex-start', padding: '2px 7px', borderRadius: 999, background: CHIP_TONE[r.status].bg, fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap', color: CHIP_TONE[r.status].fg }}>
                    {chipLabel}
                  </span>
                </span>
              </div>
            )
          })}
        </div>

        <div ref={scrollRef} style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
          <div style={{ width: scrollable ? laneWidth : '100%' }}>
            {/* The window's marks and the TODAY tag, over the same lane. */}
            <div style={{ position: 'relative', height: headH, background: '#FAFBFC', borderTop: '1px solid #E9EDF0', borderBottom: '1px solid #E1E5E9' }}>
              {labels.map(([at, text, dim]) => (
                <span
                  key={`${at}-${text}`}
                  style={{ position: 'absolute', top: 7, left: `${at}%`, transform: 'translateX(-50%)', fontSize: labelSize, fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap', color: dim ? '#BCC3C9' : '#8B9096' }}
                >
                  {text}
                </span>
              ))}
              {todayPct !== null && (
                <span
                  style={{ position: 'absolute', bottom: 3, left: `min(max(${todayPct}%, 20px), calc(100% - 20px))`, transform: 'translateX(-50%)', padding: '2px 5px', borderRadius: 4, background: '#C7423A', fontSize: 7.5, fontWeight: 800, letterSpacing: '.06em', color: '#fff' }}
                >
                  TODAY
                </span>
              )}
            </div>

            {geometry.map(({ r, bar, fill, milestone }) => {
              const radii = bar ? `${bar.clipL ? 2 : 7}px ${bar.clipR ? 2 : 7}px ${bar.clipR ? 2 : 7}px ${bar.clipL ? 2 : 7}px` : ''
              // The white end cap only where the bar is long enough to carry
              // it — on a short pill it reads as a toggle switch.
              const capOk = bar !== null && !bar.clipR && bar.width >= 18
              return (
                <div
                  key={r.site.id}
                  onClick={() => onOpenJob(r.site)}
                  style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: ROW_H, boxSizing: 'border-box', padding: '10px 0', borderBottom: '1px solid #EFF1F4', cursor: 'pointer' }}
                >
                  {/* Shaded bands and gridlines, behind everything. */}
                  {bands.map(([b0, b1]) => (
                    <span key={`b${b0}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${b0}%`, width: `${b1 - b0}%`, background: '#F7F8FA' }} />
                  ))}
                  {gridAt.map((g) => (
                    <span key={g} style={{ position: 'absolute', top: 0, bottom: 0, left: `${g}%`, width: 1, background: '#ECEFF2' }} />
                  ))}
                  {todayPct !== null && (
                    <span style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 1.5, background: 'rgba(214,69,65,.5)', zIndex: 1 }} />
                  )}

                  <div style={{ position: 'relative', height: 14, margin: '0 8px' }}>
                    {bar && milestone ? (
                      <span
                        style={{ position: 'absolute', top: '50%', left: `min(max(${bar.left + bar.width / 2}%, 8px), calc(100% - 8px))`, width: 11, height: 11, transform: 'translate(-50%, -50%) rotate(45deg)', borderRadius: 2.5, background: 'linear-gradient(135deg, #23272C, #15181C)', boxShadow: '0 1px 2px rgba(16,20,24,.3)' }}
                      />
                    ) : bar ? (
                      <span
                        style={{ position: 'absolute', top: 0, bottom: 0, left: `min(${bar.left}%, calc(100% - 26px))`, width: `${bar.width}%`, minWidth: 26, borderRadius: radii, background: 'linear-gradient(#23272C, #15181C)', boxShadow: '0 1px 2px rgba(16,20,24,.28)', overflow: 'hidden' }}
                      >
                        {fill > 0 && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`, background: 'linear-gradient(#33A75F, #2B9552)' }} />}
                        {capOk && (
                          <span style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
                        )}
                      </span>
                    ) : (
                      // Only reachable for a job with no dates at all —
                      // anything dated outside this window is filtered out
                      // of `visible` before it gets here.
                      <span style={{ position: 'absolute', top: 1, left: 0, fontSize: 10.5, color: '#9AA1A9' }}>
                        Not scheduled yet
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {visible.length === 0 && !loading && (
        <div style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13.5, color: '#7B838B' }}>Nothing in this window.</div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- screen

export function SimpleSchedule({
  data,
  onOpenJob,
}: {
  data: SimpleData
  onOpenJob: (site: JobSiteRow, tab?: JobTab) => void
}) {
  const now = useMemo(() => new Date(), [])
  const [view, setView] = useState<'quarter' | 'month' | 'week' | 'day'>('quarter')
  const [quarter, setQuarter] = useState<[number, number]>([now.getFullYear(), Math.floor(now.getMonth() / 3)])
  const [month, setMonth] = useState<[number, number]>([now.getFullYear(), now.getMonth()])

  const { rows: progRows, loading: progLoading } = useProgrammeRows(data.progress)

  // Week view state — the drawn strip, unchanged.
  const monday = useMemo(() => mondayOf(now), [now])
  const todayIx = Math.min(6, Math.max(0, Math.floor((Date.now() - monday.getTime()) / DAY)))
  const [dayIx, setDayIx] = useState(todayIx)
  const [weekRows, setWeekRows] = useState<AssignmentRow[]>([])
  const [roster, setRoster] = useState<Map<string, { name: string; initials: string }>>(new Map())
  const [weekLoading, setWeekLoading] = useState(true)

  // Day view state — any date, one day of bookings at a time.
  const [dayDate, setDayDate] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [dayRowsRaw, setDayRowsRaw] = useState<AssignmentRow[]>([])
  const [dayLoading, setDayLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client
        .from('assignments')
        .select('*')
        .eq('published', true)
        .gte('starts_at', monday.toISOString())
        .lt('starts_at', new Date(monday.getTime() + 7 * DAY).toISOString())
        .order('starts_at'),
      client.from('crew_v').select('id, name, initials'),
    ]).then(([a, cv]) => {
      if (cancelled) return
      setWeekRows((a.data as AssignmentRow[]) ?? [])
      setRoster(new Map(((cv.data as Array<{ id: string; name: string; initials: string }>) ?? []).map((w) => [w.id, w])))
      setWeekLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [monday])

  useEffect(() => {
    if (view !== 'day') return
    let cancelled = false
    setDayLoading(true)
    void supabase()
      .from('assignments')
      .select('*')
      .eq('published', true)
      .gte('starts_at', dayDate.toISOString())
      .lt('starts_at', new Date(dayDate.getTime() + DAY).toISOString())
      .order('starts_at')
      .then(({ data: a }) => {
        if (cancelled) return
        setDayRowsRaw((a as AssignmentRow[]) ?? [])
        setDayLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, dayDate])

  const byId = new Map(data.sites.map((x) => [x.id, x]))

  const week = [...Array(7)].map((_, i) => {
    const d = new Date(monday.getTime() + i * DAY)
    return {
      ix: i,
      dow: d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase(),
      num: String(d.getDate()),
      label: d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
      past: i < todayIx,
      today: i === todayIx,
    }
  })

  const groupBySite = (rows: AssignmentRow[], d0: number, d1: number) => {
    const bySite = new Map<string, AssignmentRow[]>()
    for (const b of rows) {
      const t = new Date(b.starts_at).getTime()
      if (t < d0 || t >= d1) continue
      bySite.set(b.site_id, [...(bySite.get(b.site_id) ?? []), b])
    }
    return [...bySite.entries()]
  }

  const dayCards = (entries: Array<[string, AssignmentRow[]]>, loading: boolean) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px 20px' }}>
      {entries.map(([siteId, list]) => {
        const site = byId.get(siteId)
        if (!site) return null
        const first = list[0]!
        const note = first.note ? ` · ${first.note}` : ''
        const time = `${clockTime(first.starts_at)} – ${clockTime(first.ends_at)}${note}`
        const crew = list
          .map((b) => roster.get(b.worker_id))
          .filter((w): w is { name: string; initials: string } => !!w)
        const who = crew.length ? crew.map((w) => w.name.split(' ')[0]).join(', ') : 'Nobody rostered'
        const defects = data.openDefects.get(siteId) ?? 0
        const holds = data.floodHold.get(siteId) ?? 0
        const chip = defects > 0 ? `${defects} defect${defects === 1 ? '' : 's'}` : holds > 0 ? 'Needs you' : ''
        const areas = data.floodAreas.get(siteId) ?? []
        const holdNote =
          holds > 0
            ? `Flood test on ${areas.join(', ') || 'a wet area'} ${areas.length > 1 ? 'are' : 'is'} overdue. Nothing on this job can be claimed until ${areas.length > 1 ? 'they are' : 'it is'} done.`
            : ''
        return (
          <div
            key={siteId}
            onClick={() => onOpenJob(site)}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 15px 14px 19px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', cursor: 'pointer', overflow: 'hidden' }}
          >
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
            <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                <span style={{ fontSize: 13.5, color: '#7B838B' }}>{time}</span>
              </span>
              {chip && (
                <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700, background: '#FDECEE', color: '#A3282E' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A3282E' }} />
                  {chip}
                </span>
              )}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
                {crew.slice(0, 5).map((w, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, marginRight: -7, borderRadius: '50%', border: '2px solid #fff', background: avatarGrey(i), color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
                    {w.initials}
                  </span>
                ))}
              </span>
              <span style={{ flex: 1, paddingLeft: 12, fontSize: 13.5, color: '#4A5057', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
              <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
                <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {holdNote && (
              <span style={{ padding: '9px 11px', borderRadius: 8, background: '#FDECEE', fontSize: 13.5, lineHeight: 1.4, color: '#8E2A31' }}>{holdNote}</span>
            )}
          </div>
        )
      })}

      {entries.length === 0 && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '52px 24px' }}>
          <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="#B7BCC2" strokeWidth="1.4" strokeLinecap="round">
            <path d="M3.5 4.5h13v13h-13zM3.5 8.5h13M7 2.5v3M13 2.5v3" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#4A5057' }}>Nobody rostered</span>
          <span style={{ fontSize: 14, lineHeight: 1.45, color: '#7B838B', textAlign: 'center' }}>
            Nothing published for this day. Bookings the office publishes show up here.
          </span>
        </div>
      )}
    </div>
  )

  // ‹ label › — the window stepper shared by year, month and day.
  const stepper = (label: string, onPrev: () => void, onNext: () => void) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 8px' }}>
      <button onClick={onPrev} aria-label="Previous" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, border: 0, background: 'none', cursor: 'pointer' }}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.ink} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.2 4.4 6.6 10l5.6 5.6" />
        </svg>
      </button>
      <span style={{ minWidth: 130, textAlign: 'center', fontSize: 16.5, fontWeight: 700, letterSpacing: '-.01em', color: s.ink }}>{label}</span>
      <button onClick={onNext} aria-label="Next" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, border: 0, background: 'none', cursor: 'pointer' }}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={s.ink} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.8 4.4 13.4 10l-5.6 5.6" />
        </svg>
      </button>
    </div>
  )

  let body: ReactNode
  if (view === 'quarter') {
    const [qy, qq] = quarter
    const w0 = new Date(qy, qq * 3, 1).getTime()
    const w1 = new Date(qy, qq * 3 + 3, 1).getTime()
    const span = w1 - w0
    const gridAt: number[] = []
    const labels: Array<[number, string]> = []
    const bands: Array<[number, number]> = []
    for (let m = 0; m < 3; m++) {
      const from = new Date(qy, qq * 3 + m, 1).getTime()
      const to = new Date(qy, qq * 3 + m + 1, 1).getTime()
      labels.push([(((from + to) / 2 - w0) / span) * 100, MON3[qq * 3 + m]!.toUpperCase()])
      // The middle month shaded — the quarter reads as three blocks.
      if (m === 1) bands.push([((from - w0) / span) * 100, ((to - w0) / span) * 100])
    }
    // Weekly texture, the same rhythm the month view has.
    for (const d = new Date(qy, qq * 3, 1); d.getTime() < w1; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 1) {
        const at = ((d.getTime() - w0) / span) * 100
        if (at > 0.5) gridAt.push(at)
      }
    }
    body = (
      <>
        {stepper(`Q${qq + 1} ${qy}`, () => setQuarter(qq === 0 ? [qy - 1, 3] : [qy, qq - 1]), () => setQuarter(qq === 3 ? [qy + 1, 0] : [qy, qq + 1]))}
        <Gantt rows={progRows} w0={w0} w1={w1} gridAt={gridAt} bands={bands} labels={labels} loading={progLoading} onOpenJob={onOpenJob} />
      </>
    )
  } else if (view === 'month') {
    const [my, mm] = month
    const w0 = new Date(my, mm, 1).getTime()
    const w1 = new Date(my, mm + 1, 1).getTime()
    const span = w1 - w0
    const gridAt: number[] = []
    const labels: Array<[number, string, number]> = []
    const bands: Array<[number, number]> = []
    for (let d = new Date(my, mm, 1); d.getTime() < w1; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 1) {
        const at = ((d.getTime() - w0) / span) * 100
        if (at > 0) gridAt.push(at)
      }
      // Every day of the month, 1 through 31, one per column — the chart
      // pans sideways under the pinned tiles, so nothing has to squeeze.
      // Weekends print quieter, like any wall planner.
      labels.push([((d.getTime() + DAY / 2 - w0) / span) * 100, String(d.getDate()), d.getDay() === 6 || d.getDay() === 0 ? 1 : 0])
      if (d.getDay() === 6 || d.getDay() === 0) {
        bands.push([((d.getTime() - w0) / span) * 100, ((d.getTime() + DAY - w0) / span) * 100])
      }
    }
    body = (
      <>
        {stepper(`${MON_FULL[mm]} ${my}`, () => setMonth(mm === 0 ? [my - 1, 11] : [my, mm - 1]), () => setMonth(mm === 11 ? [my + 1, 0] : [my, mm + 1]))}
        <Gantt
          rows={progRows}
          w0={w0}
          w1={w1}
          gridAt={gridAt}
          bands={bands}
          labels={labels}
          labelSize={8}
          laneWidth={new Date(my, mm + 1, 0).getDate() * 13}
          loading={progLoading}
          onOpenJob={onOpenJob}
        />
      </>
    )
  } else if (view === 'week') {
    const entries = groupBySite(weekRows, monday.getTime() + dayIx * DAY, monday.getTime() + (dayIx + 1) * DAY)
    const people = entries.reduce((a, [, list]) => a + list.length, 0)
    const daySub = people > 0 ? `${people} on the clock · ${entries.length} site${entries.length === 1 ? '' : 's'}` : 'Nothing rostered'
    const sel = week[dayIx]!
    body = (
      <>
        {/* The charcoal week strip, exactly as drawn. */}
        <div style={{ flex: 'none', padding: '10px 18px 14px', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 2, padding: 7, borderRadius: 14, background: 'linear-gradient(#23272C,#15181C)', boxShadow: '0 8px 20px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset' }}>
            {week.map((d) => {
              const on = d.ix === dayIx
              return (
                <button
                  key={d.ix}
                  onClick={() => setDayIx(d.ix)}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 44, height: 58, padding: 0, border: 0, borderRadius: 10, background: on ? '#FFFFFF' : 'transparent', fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: on ? 'rgba(26,29,33,.52)' : d.past ? '#5F666E' : '#8A929B' }}>{d.dow}</span>
                  <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em', color: on ? '#14171A' : d.past ? '#7E868F' : '#E7EAEE' }}>{d.num}</span>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: d.today ? s.accent : 'transparent' }} />
                </button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '16px 18px 11px' }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>{sel.today ? `Today · ${sel.label}` : sel.label}</span>
          <span style={{ fontSize: 13, color: '#7B838B' }}>{daySub}</span>
        </div>
        {dayCards(entries, weekLoading)}
      </>
    )
  } else {
    const entries = groupBySite(dayRowsRaw, dayDate.getTime(), dayDate.getTime() + DAY)
    const isToday = dayDate.toDateString() === new Date().toDateString()
    const label = dayDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    const people = entries.reduce((a, [, list]) => a + list.length, 0)
    body = (
      <>
        {stepper(isToday ? `Today · ${label}` : label, () => setDayDate(new Date(dayDate.getTime() - DAY)), () => setDayDate(new Date(dayDate.getTime() + DAY)))}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '2px 18px 11px' }}>
          <span style={{ fontSize: 13, color: '#7B838B' }}>
            {people > 0 ? `${people} on the clock · ${entries.length} site${entries.length === 1 ? '' : 's'}` : 'Nothing rostered'}
          </span>
        </div>
        {dayCards(entries, dayLoading)}
      </>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* The dark PROGRAM header with the view switcher, as the client drew it. */}
      <div style={{ flex: 'none', background: 'linear-gradient(#23272C,#15181C)', padding: `${SAFE_TOP} 0 0` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 20px' }}>
          <span style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '.09em', color: '#fff' }}>PROGRAM</span>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44 }}>
            <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
              <path d="M10 4.5v11M4.5 10h11" />
            </svg>
          </span>
        </div>
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ display: 'flex', padding: 3, borderRadius: 12, background: '#FFFFFF' }}>
            {(['quarter', 'month', 'week', 'day'] as const).map((v) => {
              const on = view === v
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{ flex: 1, height: 38, border: 0, borderRadius: 9, background: on ? '#1A1D21' : 'transparent', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: on ? '#fff' : s.ink, cursor: 'pointer' }}
                >
                  {v[0]!.toUpperCase() + v.slice(1)}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: view === 'quarter' || view === 'month' ? '#fff' : '#F5F6F7' }}>
        {body}
      </div>
    </div>
  )
}
