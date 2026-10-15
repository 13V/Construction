/**
 * Every job, for the board: the phone's own loader plus what the board shows
 * that the phone's lists do not.
 *
 * useSimpleData is the phone's one loader (the same rows, counts and chips
 * the crew see), so the board's attention chips and who-is-on-site come
 * from exactly the numbers the phone's Projects list shows. It hides
 * archived jobs, which the board lists under Archived, so this adds:
 *   - every job, archived included, sorted the phone's way (by what the row
 *     shows: the address line, else the name)
 *   - published bookings from local start of today for 14 days, the phone's
 *     Projects window for "who is on this job"
 *   - the rows siteSpan needs, so a job's dates are the phone's dates
 *     (typed dates win; else the widest of our programme lines, bookings
 *     and shifts), read a page at a time so a busy company's dates are not
 *     cut short by the API's row cap
 *
 * Refreshes when the window regains focus, when the tab becomes visible
 * again and every 60 s while visible (useFresh), unless { fresh: false }.
 * A refresh keeps the rows on screen: `loading` is the first load only,
 * `refreshing` any later one. A newer refresh cancels an older one still on
 * its way, so the last asked is the last to land.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { addressLine, siteSpan, supabase, useSimpleData, type AssignmentRow, type JobSiteRow, type SimpleData, type SpanRows, type WorkerRow } from '../phone'
import { allRows, startOfToday } from './bookings'
import { chipOf, type AttentionChip } from './contract'
import { useFresh } from './useFresh'

export interface CrewLite {
  id: string
  name: string
  initials: string
}

/** Someone attached to a job: on the clock there now, or booked in the next 14 days. */
export interface JobPerson extends CrewLite {
  onClock: boolean
  /** 'On site since 7:02 am' or 'Booked Mon 3 Nov'. */
  where: string
}

export interface JobsData {
  /**
   * True until the first load has answered, and never again: the 60 s poll
   * and the refresh on focus keep what is on screen while they ask, so a
   * board that shows a loading state on this does not blank every minute.
   */
  loading: boolean
  /** A later refresh is on its way (the rows on screen are the last ones). */
  refreshing: boolean
  error: string | null
  /** The phone's loader, as the phone's Projects screen reads it. */
  simple: SimpleData
  /** Every job, archived included, in the phone's order. */
  sites: JobSiteRow[]
  active: JobSiteRow[]
  future: JobSiteRow[]
  archived: JobSiteRow[]
  /** Published bookings starting from local start of today, for 14 days. */
  bookings: AssignmentRow[]
  crew: Map<string, CrewLite>
  /** A job's dates by the phone's rule, as local-midnight millis. */
  spanOf: (site: JobSiteRow) => { s: number; e: number } | null
  /** On the clock there now, then booked ahead: the phone's Projects people. */
  peopleOf: (siteId: string) => JobPerson[]
  /** The phone's Projects chip for the job, or null. */
  chipFor: (siteId: string) => AttentionChip | null
  refresh: () => void
}

/** The phone's list order: by the title a row shows. */
export const byTitle = (a: JobSiteRow, b: JobSiteRow) =>
  (addressLine(a) || a.name).localeCompare(addressLine(b) || b.name, undefined, { sensitivity: 'base' })

/** Group span rows by job, as the phone's Schedule does before calling siteSpan. */
export function spanRowsBySite(
  tasks: Array<{ site_id: string; starts_on: string | null; ends_on: string | null }>,
  assignments: Array<{ site_id: string; starts_at: string; ends_at: string | null }>,
  shifts: Array<{ site_id: string | null; started_at: string }>,
): Map<string, SpanRows> {
  const per = new Map<string, SpanRows>()
  const bucket = (id: string) => {
    const b = per.get(id) ?? { tasks: [], assignments: [], shifts: [] }
    per.set(id, b)
    return b
  }
  for (const t of tasks) bucket(t.site_id).tasks.push(t)
  for (const a of assignments) bucket(a.site_id).assignments.push(a)
  for (const x of shifts) if (x.site_id) bucket(x.site_id).shifts.push(x)
  return per
}

/**
 * The phone's Projects "people" rule (Projects.tsx peopleOf): whoever is on
 * the clock there now, matched to the roster by name as the phone does,
 * then everyone with a published booking in the window, once each.
 */
export function peopleOn(
  siteId: string,
  onSite: Map<string, Array<{ name: string; initials: string; since: string }>>,
  bookings: AssignmentRow[],
  roster: Map<string, CrewLite>,
): JobPerson[] {
  const seen = new Map<string, JobPerson>()
  for (const c of onSite.get(siteId) ?? []) {
    const t = new Date(c.since).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
    const match = [...roster.values()].find((w) => w.name === c.name)
    const id = match?.id ?? c.name
    seen.set(id, { id, name: c.name, initials: c.initials, where: `On site since ${t}`, onClock: true })
  }
  for (const b of bookings) {
    if (b.site_id !== siteId || seen.has(b.worker_id)) continue
    const w = roster.get(b.worker_id)
    if (!w) continue
    const day = new Date(b.starts_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
    seen.set(b.worker_id, { ...w, where: `Booked ${day}`, onClock: false })
  }
  return [...seen.values()]
}

export function useJobs(me: WorkerRow, { fresh = true }: { fresh?: boolean } = {}): JobsData {
  const simple = useSimpleData(me)
  const [nonce, setNonce] = useState(0)
  // `loading` is the first load only; `fetching` is any load, first or later.
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(true)
  // useSimpleData (the phone's loader) says loading on every refresh, so
  // remember whether it has answered once. Set while rendering, the way
  // React suggests for state that follows another value.
  const [simpleAnswered, setSimpleAnswered] = useState(false)
  if (!simpleAnswered && !simple.loading) setSimpleAnswered(true)
  const [error, setError] = useState<string | null>(null)
  const [sites, setSites] = useState<JobSiteRow[]>([])
  const [bookings, setBookings] = useState<AssignmentRow[]>([])
  const [crew, setCrew] = useState<Map<string, CrewLite>>(new Map())
  const [spanRows, setSpanRows] = useState<Map<string, SpanRows>>(new Map())

  useEffect(() => {
    let cancelled = false
    setFetching(true)
    const c = supabase()
    const t0 = startOfToday()
    const t14 = new Date(t0.getTime() + 14 * 86_400_000)
    void (async () => {
      try {
        const [js, asg, cv, tasks, spanAsg, shifts] = await Promise.all([
          allRows<JobSiteRow>((a, b) => c.from('job_sites').select('*').order('id').range(a, b)),
          allRows<AssignmentRow>((a, b) =>
            c.from('assignments').select('*').eq('published', true).gte('starts_at', t0.toISOString()).lt('starts_at', t14.toISOString()).order('starts_at').order('id').range(a, b),
          ),
          c.from('crew_v').select('id, name, initials'),
          allRows<{ site_id: string; starts_on: string | null; ends_on: string | null }>((a, b) =>
            c.from('programme_tasks').select('site_id, starts_on, ends_on').eq('is_ours', true).order('id').range(a, b),
          ),
          allRows<{ site_id: string; starts_at: string; ends_at: string }>((a, b) => c.from('assignments').select('site_id, starts_at, ends_at').order('id').range(a, b)),
          allRows<{ site_id: string | null; started_at: string }>((a, b) => c.from('shifts').select('site_id, started_at').order('id').range(a, b)),
        ])
        if (cancelled) return
        if (cv.error) throw new Error(cv.error.message)
        setSites([...js].sort(byTitle))
        setBookings(asg)
        setCrew(new Map(((cv.data ?? []) as CrewLite[]).map((w) => [w.id, w])))
        setSpanRows(spanRowsBySite(tasks, spanAsg, shifts))
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setFetching(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me.company_id, nonce])

  const simpleRefresh = simple.refresh
  const refresh = useCallback(() => {
    simpleRefresh()
    setNonce((n) => n + 1)
  }, [simpleRefresh])
  useFresh(() => {
    if (fresh) refresh()
  })

  const spanOf = useCallback(
    (site: JobSiteRow) => siteSpan({ ...(spanRows.get(site.id) ?? { tasks: [], assignments: [], shifts: [] }), set: { starts_on: site.starts_on, ends_on: site.ends_on } }),
    [spanRows],
  )
  const peopleOf = useCallback((siteId: string) => peopleOn(siteId, simple.crewOnSite, bookings, crew), [simple.crewOnSite, bookings, crew])
  const chipFor = useCallback(
    (siteId: string) =>
      chipOf({
        defects: simple.openDefects.get(siteId) ?? 0,
        flood: simple.floodHold.get(siteId) ?? 0,
        variations: simple.pendingVariationsBySite.get(siteId) ?? 0,
      }),
    [simple.openDefects, simple.floodHold, simple.pendingVariationsBySite],
  )

  const groups = useMemo(
    () => ({
      active: sites.filter((s) => s.status === 'active'),
      future: sites.filter((s) => s.status === 'starting_soon'),
      archived: sites.filter((s) => s.status === 'archived'),
    }),
    [sites],
  )

  const first = loading || !simpleAnswered
  return {
    loading: first,
    refreshing: !first && (fetching || simple.loading),
    error: error ?? simple.error,
    simple,
    sites,
    ...groups,
    bookings,
    crew,
    spanOf,
    peopleOf,
    chipFor,
    refresh,
  }
}
