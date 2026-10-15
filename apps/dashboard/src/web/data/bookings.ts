/**
 * Booking people onto a job, exactly as the phone's Assign personnel sheet
 * does it (Projects.tsx AssignSheet), with the rules copied in contract.ts.
 *
 * A booking is one assignments row per person per working day, local
 * 07:00-15:00, published, with no crew_id: that is what the phone's
 * schedule, Home and Projects read, and what a timesheet is checked against.
 * A day the person is already booked on anything (any job, published or
 * not) is skipped and reported, never double-booked and never silently
 * dropped. At most 84 working days go in one run.
 *
 * Times are the computer's local time, as on the phone. The website is used
 * from Adelaide; a computer set to another time zone books other hours, so
 * the booking form warns when it is not Australia/Adelaide.
 */
import { supabase } from '../phone'
import { refused } from './builders'
import { ASSIGN_MAX_DAYS, bookingTimes, clashKey, clashWindow, localISO, weekdaysBetween } from './contract'
import type { Db, WriteOpts } from './jobs'

const db = (opts?: WriteOpts): Db => opts?.client ?? supabase()

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** One row as the phone inserts it. */
export interface PlannedBooking {
  company_id: string
  worker_id: string
  site_id: string
  starts_at: string
  ends_at: string
  published: true
}

export interface SkippedDay {
  workerId: string
  /** Local YYYY-MM-DD. */
  day: string
}

export interface BookingPlan {
  /** The working days in the range, at most ASSIGN_MAX_DAYS. */
  days: Date[]
  /** True when the range had working days past the cap, which are not booked. */
  capped: boolean
  rows: PlannedBooking[]
  skipped: SkippedDay[]
}

export interface PlanInput {
  companyId: string
  siteId: string
  workerIds: string[]
  /** Local YYYY-MM-DD, inclusive. */
  from: string
  to: string
  /** Existing bookings for these people around the range, on any job. */
  taken?: Iterable<{ worker_id: string; starts_at: string }>
}

/** Mon-Fri in the range, with whether the 84-day cap cut it short. */
export function workingDays(from: string, to: string): { days: Date[]; capped: boolean } {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return { days: [], capped: false }
  const days = weekdaysBetween(from, to)
  let capped = false
  if (days.length >= ASSIGN_MAX_DAYS) {
    // Is there a working day after the last one booked, still inside the range?
    const next = new Date(days[days.length - 1]!)
    do next.setDate(next.getDate() + 1)
    while (next.getDay() === 0 || next.getDay() === 6)
    capped = localISO(next) <= to
  }
  return { days, capped }
}

/**
 * The rows a booking run writes, and the days it skips. Pure: `taken` is
 * what the clash read found. Each person is booked in the order given, day
 * by day, as the phone does.
 */
export function planBookings({ companyId, siteId, workerIds, from, to, taken = [] }: PlanInput): BookingPlan {
  const { days, capped } = workingDays(from, to)
  const busy = new Set<string>()
  for (const t of taken) busy.add(clashKey(t.worker_id, t.starts_at))
  const rows: PlannedBooking[] = []
  const skipped: SkippedDay[] = []
  for (const id of [...new Set(workerIds)]) {
    for (const day of days) {
      if (busy.has(clashKey(id, day))) {
        skipped.push({ workerId: id, day: localISO(day) })
        continue
      }
      rows.push({ company_id: companyId, worker_id: id, site_id: siteId, ...bookingTimes(day), published: true })
    }
  }
  return { days, capped, rows, skipped }
}

/** 'N people × D working days = B bookings, 07:00-15:00, weekends left out' */
export function bookingSummary(people: number, days: number): string {
  const p = `${people} ${people === 1 ? 'person' : 'people'}`
  const d = `${days} working day${days === 1 ? '' : 's'}`
  const b = people * days
  return `${p} × ${d} = ${b} booking${b === 1 ? '' : 's'}, 07:00-15:00, weekends left out`
}

/**
 * Every row of a select, a page at a time. PostgREST stops at its row cap
 * (1000 by default) without saying so, which for a clash check means a
 * double booking and for a job's dates means the wrong dates.
 */
export async function allRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  { pageSize = 1000, maxPages = 50 } = {},
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await query(page * pageSize, page * pageSize + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
  return out
}

export interface BookInput {
  companyId: string
  siteId: string
  workerIds: string[]
  from: string
  to: string
}

export interface BookResult {
  /** Ids of the rows inserted, as read back. */
  inserted: string[]
  skipped: SkippedDay[]
  /** Working days in the range (after the cap). */
  days: number
  capped: boolean
}

/**
 * Book people onto a job: read what they already have on (any job,
 * published or not), skip those days, insert the rest as published rows and
 * read their ids back. Throws when nothing in the range is bookable as
 * asked (bad range, nobody picked), on any error, and when fewer rows come
 * back than were sent (refused). Everyone already booked every day is not
 * an error: inserted is empty and skipped says why.
 */
export async function bookCrew({ companyId, siteId, workerIds, from, to }: BookInput, opts?: WriteOpts): Promise<BookResult> {
  const ids = [...new Set(workerIds)]
  if (ids.length === 0) throw new Error('Nobody is picked yet.')
  const { days, capped } = workingDays(from, to)
  if (days.length === 0) throw new Error('That range has no working days in it.')
  const window = clashWindow(days)!
  const c = db(opts)

  const taken = await allRows<{ worker_id: string; starts_at: string }>((a, b) =>
    c
      .from('assignments')
      .select('worker_id, starts_at')
      .in('worker_id', ids)
      .gte('starts_at', window.from)
      .lte('starts_at', window.to)
      .order('id')
      .range(a, b),
  )
  const plan = planBookings({ companyId, siteId, workerIds: ids, from, to, taken })

  const inserted: string[] = []
  // In chunks, so each insert's read-back is one response well under any row cap.
  for (let i = 0; i < plan.rows.length; i += 500) {
    const chunk = plan.rows.slice(i, i + 500)
    const { data, error } = await c.from('assignments').insert(chunk).select('id')
    if (error) throw Object.assign(new Error(error.message), { inserted })
    const made = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
    inserted.push(...made)
    if (made.length !== chunk.length) throw Object.assign(new Error(refused('Booking the crew')), { inserted })
  }
  return { inserted, skipped: plan.skipped, days: days.length, capped }
}

/** Local midnight today, the cutoff for "from today on". */
export function startOfToday(now = new Date()): Date {
  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  return t0
}

/**
 * Take a person off a job: delete their bookings on it from local start of
 * today, the phone's Remove (Projects.tsx removePerson). Today is still
 * theirs to unassign until midnight; past days stay as the record of who
 * was there. Read back twice: the rows the delete returned, and a select
 * that must find none left. Returns how many went (0 when there were none).
 */
export async function removeFromJob({ siteId, workerId }: { siteId: string; workerId: string }, opts?: WriteOpts): Promise<{ removed: number }> {
  const c = db(opts)
  const t0 = startOfToday().toISOString()
  const gone = await c.from('assignments').delete().eq('site_id', siteId).eq('worker_id', workerId).gte('starts_at', t0).select('id')
  if (gone.error) throw new Error(gone.error.message)
  const left = await c.from('assignments').select('id').eq('site_id', siteId).eq('worker_id', workerId).gte('starts_at', t0).limit(1)
  if (left.error) throw new Error(left.error.message)
  if ((left.data ?? []).length > 0) throw new Error(refused('Removing them from the job'))
  return { removed: (gone.data ?? []).length }
}
