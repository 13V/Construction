/**
 * Who is booked where, day by day: one row per person, one cell per working
 * day, each cell in the colour of the job it is booked on.
 *
 * Shared by the Book crew picker (the days being booked) and the job's Crew
 * tab (six weeks). The colour is the job's rail (railOf), the same edge the
 * job wears on the board, the phone's Projects list and its schedule, so a
 * red-brown cell means "on the Glenelg job" everywhere it appears.
 *
 * A booking is one assignments row per person per working day (the phone's
 * rule, data/contract.ts), and a day is the LOCAL day a row starts on: the
 * same key (clashKey) the booking run uses to skip a day somebody already
 * has, so what this grid shows as taken is exactly what booking will skip.
 *
 * Cells:
 *  - this job:      solid, in this job's colour
 *  - another job:   that job's colour, striped, so it still reads as
 *                   "somewhere else" when two jobs share one of the five
 *                   rail colours
 *  - will be booked (picker): a pale wash of this job's colour, outlined in
 *                   it when the cell is wide enough for an outline to leave
 *                   the wash showing
 *  - free:          the phone's quiet grey
 * Past days are faded: they are the record, not the plan.
 *
 * Weekends are not drawn. Nothing books them (bookingTimes is Mon-Fri), and
 * a column that is always empty would cost a fifth of the strip's width.
 *
 * The grid is laid out to the width it is given, measured (fitGrid): the
 * person and action columns narrow before the days do, every day column is
 * the same width (a Monday's column is wider by the gap before it, rather
 * than its cell narrower), and headings are printed only where they fit:
 * a weekday letter and date over each day when there is room, the week's
 * first date over each week, else the month. The Crew tab also shows fewer
 * weeks on a narrow screen (fitWeeks) rather than thinner days. Only below
 * the narrowest cell worth drawing does the table outgrow its box, and then
 * it scrolls sideways inside it.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { allRows } from '../data/bookings'
import { clashKey, localISO, weekdaysBetween } from '../data/contract'
import { addressLine, avatarGrey, railOf, supabase, type JobSiteRow } from '../phone'
import { color, radius, space, text } from '../tokens'
import { initialsOf } from '../ui/AvatarStack'

// ------------------------------------------------------------------ data

/** What a cell needs to know about a job: its name for the tooltip, its colour for the fill. */
export interface SiteLite {
  id: string
  name: string
  address: string | null
  colour: string | null
  status: JobSiteRow['status']
}

/** One assignments row, as the grid reads it. */
export interface DayBooking {
  id: string
  workerId: string
  siteId: string
  startsAt: string
  published: boolean
}

/** Bookings by clashKey (`worker|YYYY-MM-DD`, the local day each starts on). */
export type BookingIndex = Map<string, DayBooking[]>

/** The columns every booking read here selects. */
export const BOOKING_COLS = 'id, worker_id, site_id, starts_at, published'

export interface BookingRow {
  id: string
  worker_id: string
  site_id: string
  starts_at: string
  published: boolean
}

export function toDayBooking(r: BookingRow): DayBooking {
  return { id: r.id, workerId: r.worker_id, siteId: r.site_id, startsAt: r.starts_at, published: r.published }
}

/** Index bookings by person and local day. */
export function indexBookings(rows: Iterable<DayBooking>): BookingIndex {
  const out: BookingIndex = new Map()
  for (const b of rows) {
    const k = clashKey(b.workerId, b.startsAt)
    const list = out.get(k)
    if (list) list.push(b)
    else out.set(k, [b])
  }
  return out
}

/**
 * Every booking these people have between two instants, on any job,
 * published or not: an unpublished row is still a day the booking run
 * skips, so it has to show. A page at a time (allRows), so a busy month is
 * not cut off at the API's row cap; ids in slices, so the URL stays short.
 */
export async function loadBookings(
  workerIds: string[],
  span: { from: string; to: string },
  { exceptSite }: { exceptSite?: string } = {},
): Promise<DayBooking[]> {
  const ids = [...new Set(workerIds)]
  const out: DayBooking[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100)
    const rows = await allRows<BookingRow>((a, b) => {
      let q = supabase().from('assignments').select(BOOKING_COLS).in('worker_id', slice).gte('starts_at', span.from).lte('starts_at', span.to)
      if (exceptSite) q = q.neq('site_id', exceptSite)
      return q.order('starts_at').order('id').range(a, b)
    })
    out.push(...rows.map(toDayBooking))
  }
  return out
}

/** The jobs those bookings are on, archived included (a finished job's past days still need a colour). */
export async function loadSites(ids: Iterable<string>): Promise<Map<string, SiteLite>> {
  const list = [...new Set(ids)]
  const out = new Map<string, SiteLite>()
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await supabase().from('job_sites').select('id, name, address, colour, status').in('id', list.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const s of (data ?? []) as SiteLite[]) out.set(s.id, s)
  }
  return out
}

// ------------------------------------------------------------------ days

/** Monday, local midnight, of the week `d` is in. */
export function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

/** The working days of `weeks` weeks from the Monday of `start`. */
export function weekdaysFrom(start: Date, weeks: number): Date[] {
  const a = mondayOf(start)
  const b = new Date(a)
  b.setDate(b.getDate() + weeks * 7 - 1)
  return weekdaysBetween(localISO(a), localISO(b))
}

/** "Tue 20 Oct" */
export const dayLabel = (d: Date | string) =>
  new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d)
    .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '')

/** "19 Oct" */
const shortDate = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

/** "19 Oct – 27 Nov 2026" */
export function rangeLabel(days: Date[]): string {
  if (days.length === 0) return ''
  const a = days[0]!
  const b = days[days.length - 1]!
  return `${shortDate(a)} – ${shortDate(b)} ${b.getFullYear()}`
}

/** What a job is called in a tooltip: where it is, else its name. */
export const siteTitle = (s: { name: string; address: string | null }) => addressLine({ name: s.name, address: s.address ?? '' }) || s.name

// ------------------------------------------------------------------ people

/** A head in the phone's avatar greys. */
export function PersonAvatar({ name, initials, index, size = 28, live = false }: { name: string; initials?: string | null; index: number; size?: number; live?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: avatarGrey(index),
        color: color.onDark,
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        letterSpacing: '.02em',
      }}
    >
      {initialsOf({ id: name, name, initials })}
      {/* The phone's "on the clock" dot (Job.tsx CrewTab). */}
      {live && <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: '50%', border: `2px solid ${color.panel}`, background: '#4CC38A' }} />}
    </span>
  )
}

// ------------------------------------------------------------------ fitting

/**
 * The width an element has to lay out in, kept current: read before the
 * first paint, then again whenever it changes (a window resized, a drawer's
 * scrollbar arriving). null until measured, and where there is no layout
 * (a hidden tab, a test), so nothing is drawn at a width that is not real.
 */
export function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // The layout width, not the box on screen: a drawer or dialog animating
    // in is scaled for a moment, and the observer is not told when a
    // transform ends. Whole pixels, rounded down: clientWidth rounds 440.56
    // up to 441, and a table laid out to 441 sticks out of a 440.56 box.
    const read = (w: number) => {
      const px = Math.floor(w)
      setWidth(px > 0 ? px : null)
    }
    read(parseFloat(getComputedStyle(el).width) || 0)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => read(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** The space before a week. A Monday's column is this much wider, so its cell is as wide as any other day's. */
const WEEK_GAP = 5
const DENSE_WEEK_GAP = 2
/**
 * Narrower than this a cell is a sliver (the picker over a long range):
 * days in a week touch, with a smaller gap between weeks. Below
 * LETTERS_FROM "will be booked" is a wash with no outline, because a 2 px
 * outline round a narrow cell is most of it (round a 3 px one, all of it)
 * and would read as "already booked here".
 */
const DENSE_BELOW = 8
/** From this wide a day has room for its weekday letter, and the strip is headed by week ("19 Oct") rather than by month. */
const LETTERS_FROM = 12
/** From this wide, for its date as well. */
const DATES_FROM = 16
/** Wider than this a cell stops growing; the person column takes the rest. */
const MAX_CELL = 44

export interface GridSizes {
  /** The person column at its most comfortable. */
  leadWidth: number
  /** The narrowest it goes to make room for days. Default leadWidth. */
  minLeadWidth?: number
  /** The column on the right, if any. */
  trailWidth?: number
  /** That column when space is tight; what is in it is told to stack (compact). Default trailWidth. */
  compactTrailWidth?: number
  /** The narrowest day worth drawing. Below it the table is wider than its box and scrolls inside it. Default 3. */
  minCell?: number
}

export interface GridFit {
  lead: number
  trail: number
  /** The right column is at its narrow width. */
  compact: boolean
  /** A day's column, px; a Monday's is wider by `gap`. */
  cell: number
  gap: number
  /** Padding either side of a cell, inside its column. */
  pad: number
  dense: boolean
  letters: boolean
  dates: boolean
  /** The days got minCell or more without the table outgrowing the width. */
  fits: boolean
  /** The table's width: exactly the width given, or more when it scrolls. */
  total: number
}

/**
 * How `n` days (with `gaps` week starts after the first) lay out in
 * `width`. The person and action columns stay at their roomiest unless
 * narrowing them changes what a day can show: its date, then its weekday
 * letter, then a cell wider than a sliver, then minCell. Cutting a name
 * short to make a 3 px day 3.5 px is not worth it; to give the strip its
 * letters, it is.
 */
export function fitGrid(width: number, n: number, gaps: number, sizes: GridSizes): GridFit {
  const { leadWidth, trailWidth = 0, minCell = 3 } = sizes
  const minLead = Math.min(sizes.minLeadWidth ?? leadWidth, leadWidth)
  const tightTrail = Math.min(sizes.compactTrailWidth ?? trailWidth, trailWidth)
  const tiers = [
    { lead: leadWidth, trail: trailWidth, compact: false },
    { lead: Math.round((leadWidth + minLead) / 2), trail: tightTrail, compact: tightTrail < trailWidth },
    { lead: minLead, trail: tightTrail, compact: tightTrail < trailWidth },
  ]
  const per = Math.max(n, 1)
  const room = (t: { lead: number; trail: number }) => {
    const c = (width - t.lead - t.trail - gaps * WEEK_GAP) / per
    if (c >= DENSE_BELOW) return { raw: c, gap: WEEK_GAP, dense: false }
    return { raw: (width - t.lead - t.trail - gaps * DENSE_WEEK_GAP) / per, gap: DENSE_WEEK_GAP, dense: true }
  }
  const goals = [...[DATES_FROM, LETTERS_FROM, DENSE_BELOW].filter((g) => g > minCell), minCell]
  // Failing every goal, the narrowest: then it is the days that are short of room.
  let tier = tiers[tiers.length - 1]!
  let got = room(tier)
  search: for (const goal of goals) {
    for (const t of tiers) {
      const r = room(t)
      if (r.raw >= goal) {
        tier = t
        got = r
        break search
      }
    }
  }
  const fits = got.raw >= minCell
  // Whole pixels, so cell edges are crisp; quarter pixels for a sliver,
  // where a whole one is a third of the cell.
  const raw = Math.min(got.raw, MAX_CELL)
  const cell = fits ? (raw >= 4 ? Math.floor(raw) : Math.floor(raw * 4) / 4) : minCell
  // Sliver or not as the room was worked out; when nothing fits, as the cell actually drawn.
  const dense = fits ? got.dense : cell < DENSE_BELOW
  const gap = fits ? got.gap : dense ? DENSE_WEEK_GAP : WEEK_GAP
  const days = n * cell + gaps * gap
  // The person column takes what rounding leaves, so the table is exactly its box.
  const lead = Math.max(tier.lead, width - tier.trail - days)
  return {
    lead,
    trail: tier.trail,
    compact: tier.compact,
    cell,
    gap,
    pad: dense ? 0 : 1,
    dense,
    letters: cell >= LETTERS_FROM,
    dates: cell >= DATES_FROM,
    fits,
    total: lead + days + tier.trail,
  }
}

/** The most whole Monday-to-Friday weeks, up to `max`, that fit `width` at sizes.minCell or wider. At least one. */
export function fitWeeks(width: number, max: number, sizes: GridSizes): number {
  for (let w = max; w > 1; w--) if (fitGrid(width, w * 5, w - 1, sizes).fits) return w
  return 1
}

/** A colour washed out over white, opaque, so it looks the same on any background. */
export function tint(c: string, amount: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return `color-mix(in srgb, ${c} ${Math.round(amount * 100)}%, white)`
  const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join('') : m[1]!
  const [r, g, b] = [0, 2, 4].map((i) => Math.round(255 + (parseInt(h.slice(i, i + 2), 16) - 255) * amount))
  return `rgb(${r}, ${g}, ${b})`
}

/** How much of this job's colour "will be booked" is washed in. */
const NEW_TINT = 0.32

/**
 * Roughly how wide a short heading is at `px`: a touch over the system
 * fonts' widest digits and letters, so a heading that is printed fits.
 * (A heading cell cannot widen its column either way: see `th` below.)
 */
const labelWidth = (s: string, px: number) => [...s].reduce((w, ch) => w + px * (/[0-9 ]/.test(ch) ? 0.58 : 0.64), 2)

// ------------------------------------------------------------------ the grid

export type CellKind = 'free' | 'here' | 'other' | 'new'

export interface GridPerson {
  id: string
  name: string
}

export interface BookingGridProps<P extends GridPerson> {
  /** What the grid shows, for a screen reader: "Bookings on this job, next six weeks". */
  label: string
  days: Date[]
  people: P[]
  /** The person's cell on the left: name, a checkbox, an avatar. */
  lead: (person: P, index: number) => ReactNode
  /** Anything on the right of the row: a count, Remove. `compact` when that column is at its narrow width: stack, don't spread. */
  trail?: (person: P, index: number, layout: { compact: boolean }) => ReactNode
  index: BookingIndex
  sites: Map<string, SiteLite>
  /** The job this grid is for. id is null for a job not made yet (the New job form). */
  here: { id: string | null; colour: string; title: string }
  /** People whose free days in the grid are about to be booked (the picker's picks). */
  proposing?: ReadonlySet<string>
  /** Local YYYY-MM-DD; days before it are faded. Default today. */
  today?: string
  /** The width to lay out in, when the page has measured it already (the Crew tab, which picks its weeks by it). Default: measured here. */
  width?: number | null
  /** See GridSizes. */
  leadWidth?: number
  minLeadWidth?: number
  trailWidth?: number
  compactTrailWidth?: number
  minCell?: number
  cellHeight?: number
  rowHeight?: number
  /** Header row above: the column headings for lead and trail. */
  leadHeader?: ReactNode
  trailHeader?: ReactNode
}

const STRIPES = 'repeating-linear-gradient(135deg, rgba(255,255,255,.42) 0 2.5px, transparent 2.5px 6px)'
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** What one cell is, and the words for it. */
export function cellOf(
  list: DayBooking[] | undefined,
  { here, proposing, sites }: { here: { id: string | null; title: string }; proposing: boolean; sites: Map<string, SiteLite> },
): { kind: CellKind; booking: DayBooking | null; words: string } {
  const mine = here.id ? list?.find((b) => b.siteId === here.id) : undefined
  const other = list?.find((b) => b.siteId !== here.id)
  const draft = (b: DayBooking) => (b.published ? '' : ' (not published to their phone)')
  if (mine) {
    const also = other ? `; also booked on ${nameOf(other.siteId, sites)}` : ''
    return { kind: 'here', booking: mine, words: `Booked on this job${draft(mine)}${also}${proposing ? '. Already booked, so left as it is' : ''}` }
  }
  if (other) {
    return { kind: 'other', booking: other, words: `Booked on ${nameOf(other.siteId, sites)}${draft(other)}${proposing ? '. Already booked, so this day is left out' : ''}` }
  }
  if (proposing) return { kind: 'new', booking: null, words: `Will be booked on ${here.title}, 07:00-15:00` }
  return { kind: 'free', booking: null, words: 'Free' }
}

const nameOf = (siteId: string, sites: Map<string, SiteLite>) => {
  const s = sites.get(siteId)
  return s ? siteTitle(s) : 'another job'
}

/** A run of consecutive days under one heading. */
interface Span {
  key: string
  start: number
  span: number
  label: string
  sr: string
}

function spansOf(days: Date[], keyOf: (d: Date) => string, words: (first: Date) => { label: string; sr: string }): Span[] {
  const out: Span[] = []
  days.forEach((d, i) => {
    const key = keyOf(d)
    const last = out[out.length - 1]
    if (last && last.key === key) last.span += 1
    else out.push({ key, start: i, span: 1, ...words(d) })
  })
  return out
}

export function BookingGrid<P extends GridPerson>({
  label,
  days,
  people,
  lead,
  trail,
  index,
  sites,
  here,
  proposing,
  today = localISO(new Date()),
  width: given,
  leadWidth = 240,
  minLeadWidth,
  trailWidth = 120,
  compactTrailWidth,
  minCell,
  cellHeight = 22,
  rowHeight = 48,
  leadHeader,
  trailHeader,
}: BookingGridProps<P>) {
  const [box, measured] = useMeasuredWidth<HTMLDivElement>()
  const width = given ?? measured

  // A Monday that is not the first column starts a new week: a gap before it.
  const starts = days.map((d, i) => i > 0 && d.getDay() === 1)
  const fit = width
    ? fitGrid(width, days.length, starts.filter(Boolean).length, { leadWidth, minLeadWidth, trailWidth: trail ? trailWidth : 0, compactTrailWidth, minCell })
    : null

  return (
    // The box the grid is measured by. It scrolls sideways only when even the
    // narrowest layout cannot give each day minCell; otherwise nothing is
    // clipped, so the focus ring round a checkbox or Remove at the edge shows.
    <div
      ref={box}
      data-booking-grid-box=""
      style={{ width: '100%', minWidth: 0, ...(fit && !fit.fits ? { overflowX: 'auto', overflowY: 'hidden' } : null) }}
    >
      {fit && (
        <GridTable
          label={label}
          days={days}
          starts={starts}
          fit={fit}
          people={people}
          lead={lead}
          trail={trail}
          index={index}
          sites={sites}
          here={here}
          proposing={proposing}
          today={today}
          cellHeight={cellHeight}
          rowHeight={rowHeight}
          leadHeader={leadHeader}
          trailHeader={trailHeader}
        />
      )}
    </div>
  )
}

function GridTable<P extends GridPerson>({
  label,
  days,
  starts,
  fit,
  people,
  lead,
  trail,
  index,
  sites,
  here,
  proposing,
  today,
  cellHeight,
  rowHeight,
  leadHeader,
  trailHeader,
}: Pick<BookingGridProps<P>, 'label' | 'days' | 'people' | 'lead' | 'trail' | 'index' | 'sites' | 'here' | 'proposing' | 'leadHeader' | 'trailHeader'> & {
  starts: boolean[]
  fit: GridFit
  today: string
  cellHeight: number
  rowHeight: number
}) {
  const { cell, gap, pad, dense } = fit
  const colW = days.map((_, i) => cell + (starts[i] ? gap : 0))
  // What a heading over a span has to fit in: its columns, less the gap
  // before a week and the cells' own padding.
  const roomOf = (s: Span) => {
    let w = 0
    for (let i = s.start; i < s.start + s.span; i++) w += colW[i]!
    return w - (starts[s.start] ? gap : 0) - 2 * pad
  }
  const lead0 = (s: Span) => (starts[s.start] ? gap : 0) + pad

  // Days wide enough for a letter are headed by week ("19 Oct") and then by
  // day; narrower than that, by month and then by the date each week starts.
  const weeks = spansOf(
    days,
    (d) => localISO(mondayOf(d)),
    (d) => ({ label: shortDate(d), sr: `Week of ${shortDate(mondayOf(d))}` }),
  )
  const byWeek = fit.letters
  const top = byWeek
    ? weeks
    : spansOf(
        days,
        (d) => `${d.getFullYear()}-${d.getMonth()}`,
        (d) => ({ label: d.toLocaleDateString('en-AU', { month: 'short' }), sr: d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) }),
      )

  const TOP_PX = 11.5
  const DAY_PX = 10.5
  // Under a month, the date each week starts: all of them or none, so a
  // run of single-digit dates that fit is not read as the only weeks.
  const weekDatesFit = weeks.every((s) => s.span < 5 || labelWidth('30', DAY_PX) <= roomOf(s))

  // maxWidth 0: a heading's text never widens its columns. Chrome lets a
  // header cell's text add to a fixed-layout table's width (measured: half a
  // pixel over 84 days, enough for a scrollbar), and a font wider than the
  // estimate would add more; this way the columns are exactly as set.
  const th: CSSProperties = { padding: 0, maxWidth: 0, fontWeight: 600, color: color.muted, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden' }
  const newWash = tint(here.colour, NEW_TINT)

  return (
    <table data-booking-grid="" aria-label={label} style={{ width: fit.total, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: fit.lead }} />
        {days.map((d, i) => (
          <col key={localISO(d)} style={{ width: colW[i] }} />
        ))}
        {trail && <col style={{ width: fit.trail }} />}
      </colgroup>
      <thead>
        <tr style={{ height: 18 }}>
          <th scope="col" rowSpan={2} style={{ ...th, ...text.label, fontSize: 11, verticalAlign: 'bottom', paddingBottom: 6 }}>
            {leadHeader ?? <span className="wb-sr-only">Person</span>}
          </th>
          {top.map((s) => {
            const shown = labelWidth(s.label, TOP_PX) <= roomOf(s)
            // The indent is on the label, not the cell: padding on a spanning
            // cell in the first row is shared out over its columns (Chrome),
            // making the table wider than its box by a fraction of a pixel.
            return (
              <th key={s.key} scope="colgroup" colSpan={s.span} style={{ ...th, ...text.xs, fontSize: TOP_PX, verticalAlign: 'bottom' }}>
                {shown && (
                  <span aria-hidden="true" style={{ display: 'inline-block', paddingLeft: lead0(s), paddingBottom: 2 }}>
                    {s.label}
                  </span>
                )}
                <span className="wb-sr-only">{s.sr}</span>
              </th>
            )
          })}
          {trail && (
            <th scope="col" rowSpan={2} style={{ ...th, ...text.label, fontSize: 11, verticalAlign: 'bottom', paddingBottom: 6, paddingLeft: space.sm }}>
              {trailHeader ?? <span className="wb-sr-only">Actions</span>}
            </th>
          )}
        </tr>
        {/* The same height whatever is in it, so a heading that comes or
            goes as the width changes never moves the rows (and a scrollbar
            that comes with them never changes the width back). */}
        <tr style={{ height: 32 }}>
          {byWeek
            ? days.map((d, i) => {
                const iso = localISO(d)
                const isToday = iso === today
                return (
                  <th
                    key={iso}
                    scope="col"
                    data-day={iso}
                    aria-label={dayLabel(d)}
                    style={{ ...th, padding: `0 ${pad}px 6px ${(starts[i] ? gap : 0) + pad}px`, verticalAlign: 'bottom', textAlign: 'center', fontSize: DAY_PX, lineHeight: '13px', fontWeight: isToday ? 700 : 500, color: isToday ? color.ink : color.faint }}
                  >
                    <span aria-hidden="true" style={{ display: 'block' }}>
                      {DAY_LETTER[d.getDay()]}
                    </span>
                    {fit.dates && (
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-block',
                          minWidth: 14,
                          borderRadius: radius.pill,
                          background: isToday ? color.ink : 'transparent',
                          color: isToday ? color.onDark : undefined,
                        }}
                      >
                        {d.getDate()}
                      </span>
                    )}
                  </th>
                )
              })
            : weeks.map((s) => {
                const first = days[s.start]!
                const words = String(first.getDate())
                const shown = weekDatesFit && labelWidth(words, DAY_PX) <= roomOf(s)
                return (
                  <th
                    key={s.key}
                    scope="colgroup"
                    colSpan={s.span}
                    style={{ ...th, fontWeight: 500, color: color.faint, fontSize: DAY_PX, lineHeight: '13px', verticalAlign: 'bottom', paddingLeft: lead0(s), paddingBottom: 6 }}
                  >
                    {shown && <span aria-hidden="true">{words}</span>}
                    <span className="wb-sr-only">{s.sr}</span>
                  </th>
                )
              })}
        </tr>
      </thead>
      <tbody>
        {people.map((p, pi) => (
          <tr key={p.id} data-person={p.id} style={{ height: rowHeight, borderTop: `1px solid ${color.borderSoft}` }}>
            <th scope="row" style={{ padding: `0 ${space.xs}px 0 0`, fontWeight: 'inherit', textAlign: 'left', overflow: 'hidden' }}>
              {lead(p, pi)}
            </th>
            {days.map((d, i) => {
              const iso = localISO(d)
              const { kind, booking, words } = cellOf(index.get(clashKey(p.id, d)), { here, proposing: proposing?.has(p.id) ?? false, sites })
              const fill = kind === 'here' ? here.colour : kind === 'other' && booking ? railOf(sites.get(booking.siteId) ?? { id: booking.siteId }) : null
              const past = iso < today
              const tip = `${dayLabel(d)}: ${words}`
              return (
                <td key={iso} style={{ padding: `0 ${pad}px 0 ${(starts[i] ? gap : 0) + pad}px`, verticalAlign: 'middle' }}>
                  <span
                    data-cell={kind}
                    data-day={iso}
                    data-site={booking?.siteId}
                    title={tip}
                    style={{
                      display: 'block',
                      height: cellHeight,
                      borderRadius: dense ? 1 : cell < LETTERS_FROM ? 3 : 4,
                      boxSizing: 'border-box',
                      backgroundColor: fill ?? (kind === 'new' ? newWash : color.fill),
                      backgroundImage: kind === 'other' ? STRIPES : undefined,
                      // The outline only where it leaves the wash showing: on a
                      // narrow cell it is most of the cell, and on a sliver all
                      // of it, which reads as booked already.
                      boxShadow: kind === 'new' && cell >= LETTERS_FROM ? `inset 0 0 0 2px ${here.colour}` : undefined,
                      // An unpublished booking is not on the person's phone: drawn
                      // as a ghost of itself.
                      opacity: past ? 0.4 : booking && !booking.published ? 0.55 : 1,
                    }}
                  >
                    <span className="wb-sr-only">{tip}</span>
                  </span>
                </td>
              )
            })}
            {trail && <td style={{ padding: `0 0 0 ${space.sm}px`, verticalAlign: 'middle', textAlign: 'right' }}>{trail(p, pi, { compact: fit.compact })}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The key under a grid. */
export function BookingLegend({ colour, proposing = false, hereLabel = 'This job' }: { colour: string; proposing?: boolean; hereLabel?: string | null }) {
  const swatch = (style: CSSProperties) => <span aria-hidden="true" style={{ flex: 'none', width: 14, height: 12, borderRadius: 3, boxSizing: 'border-box', ...style }} />
  const item = (s: ReactNode, words: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {s}
      {words}
    </span>
  )
  return (
    <div data-booking-legend="" style={{ display: 'flex', flexWrap: 'wrap', gap: `${space.xxs}px ${space.md}px`, ...text.xs, color: color.muted }}>
      {/* A job not made yet has no days of its own to show. */}
      {hereLabel !== null && item(swatch({ background: colour }), hereLabel)}
      {item(swatch({ backgroundColor: color.ghost, backgroundImage: STRIPES }), 'Another job, in its colour')}
      {/* The wash is what "will be booked" always has; the outline only shows on wider cells. */}
      {proposing && item(swatch({ background: tint(colour, NEW_TINT), boxShadow: `inset 0 0 0 2px ${colour}` }), 'Will be booked')}
      {item(swatch({ background: color.fill, boxShadow: `inset 0 0 0 1px ${color.border}` }), 'Free')}
    </div>
  )
}
