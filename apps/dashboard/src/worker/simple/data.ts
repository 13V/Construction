/**
 * One hook, everything the Simple shell's screens read.
 *
 * Every query here is safe for every role — RLS narrows rather than errors.
 * An employee's `shifts` come back as just their own, a captain's as their
 * jobs, the owner's as everyone: the ON SITE counter is honest for each of
 * them without this file knowing who is asking. Pending variations used to
 * be the exception — `change_orders` is office-only, so a captain's own
 * count came back zero. This reads `site_variations_v` instead (schema_v24):
 * the office's whole company or a captain's own jobs, with no cost_impact on
 * it, which this hook never wanted anyway.
 *
 * Coming back to the app asks again (see the resume effect in the hook): a
 * job the office makes or changes on the website shows on a phone that was
 * already open, without anyone having to close the app and reopen it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type AssignmentRow, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { addressLine } from './stheme'

export interface SimpleData {
  loading: boolean
  error: string | null
  sites: JobSiteRow[]
  /** site_id → weighted % complete, from site_progress_v. */
  progress: Map<string, number>
  /** site_id → open + in_progress defect count. */
  openDefects: Map<string, number>
  /** site_id → people on the clock right now (RLS-scoped to the viewer). */
  onSiteNow: Map<string, number>
  onSiteTotal: number
  /** Published bookings, today and tomorrow, for the calendar card. */
  today: AssignmentRow[]
  tomorrow: AssignmentRow[]
  /** Variations sitting with the builder — the office's whole company, a captain's own jobs. */
  pendingVariations: number
  pendingVariationsBySite: Map<string, number>
  /** site_id → who is on the clock there, for the Who-is-where sheet. */
  crewOnSite: Map<string, Array<{ name: string; initials: string; since: string }>>
  /**
   * site_id → wet areas covered (complete or signed off) with no flood test.
   * The drawing's "Needs you" chip and the Money tab's HELD UNTIL SIGN-OFF
   * band both hang off this: a membrane that gets tiled over before its water
   * test is the one mistake this trade cannot photograph its way out of.
   */
  floodHold: Map<string, number>
  /** site_id → the held areas' names, for notes like "Flood test on B305…". */
  floodAreas: Map<string, string[]>
  refresh: () => void
  /**
   * A builder or address this phone has just saved (Overview's Project
   * details), put straight into `sites`, so the open job, its header and
   * card, its Directions, and every list show it at once, not after the
   * next load.
   */
  patchSite: (id: string, patch: SitePatch) => void
}

/** The job fields Overview's Project details saves from the phone. */
export type SitePatch = { client_name?: string | null; address?: string }

const dayStart = (offset: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}

/**
 * Coming back to the app asks again only if the last load started at least
 * this long ago. Hopping out to read a text and straight back costs nothing,
 * and a phone on one bar is not sent eight requests every time a
 * notification pulls it away for a second.
 */
const RESUME_REFETCH_AFTER_MS = 30_000

/**
 * How long a return to the app settles before this hook decides to ask. A
 * return can renew the login too (supabase-js, when the token has run out),
 * and the request is better sent with the new token than raced against it.
 * A list that refreshes a second and a half after the person is back is no
 * loss.
 */
const RESUME_SETTLE_MS = 1_500

/**
 * `next`, unless it holds exactly what `prev` already does; then `prev`
 * itself, so React sees the same object and re-renders nothing. Coming back
 * to a list nobody changed is then invisible, open screens included.
 */
/** The order the lists show jobs in: by what they show, the address, falling back to the name. */
function byShown(a: JobSiteRow, b: JobSiteRow): number {
  return (addressLine(a) || a.name).localeCompare(addressLine(b) || b.name, undefined, { sensitivity: 'base' })
}

function unlessSame<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}
const takeNext = <T>(_prev: T, next: T): T => next

export function useSimpleData(me: WorkerRow): SimpleData {
  const [nonce, setNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sites, setSites] = useState<JobSiteRow[]>([])
  const [progressRows, setProgressRows] = useState<Array<{ site_id: string; pct_complete: number | null }>>([])
  const [defectRows, setDefectRows] = useState<Array<{ site_id: string; status: string }>>([])
  const [shiftRows, setShiftRows] = useState<Array<{ site_id: string | null; worker_id: string; started_at: string; ended_at: string | null }>>([])
  const [roster, setRoster] = useState<Array<{ id: string; name: string; initials: string }>>([])
  const [bookings, setBookings] = useState<AssignmentRow[]>([])
  const [pendingVariations, setPendingVariations] = useState(0)
  const [variationRows, setVariationRows] = useState<Array<{ id: string; site_id: string | null }>>([])
  const [wpRows, setWpRows] = useState<Array<{ site_id: string; area: string; status: string; flood_tested: boolean }>>([])

  /**
   * Why the next load runs: refresh() asked for it, or the app came back
   * (the resume effect below). Null for the first load and for a change of
   * company. The load reads it and clears it.
   */
  const reason = useRef<'refresh' | 'resume' | null>(null)
  /** When the latest load started, and whether it is still out. */
  const startedAt = useRef(0)
  const inFlight = useRef(false)
  /*
   * Fields saved on this phone, by site and field, with when the save came
   * back. A load that started before a save read the row before it (or
   * cannot be shown to have read it after), so its copy of that field is
   * older than what is on screen and the save is put back over it. Once a
   * load that started after the save gets through, it has read the saved
   * row itself, and the note is dropped.
   */
  const saved = useRef(new Map<string, { id: string; field: keyof SitePatch; value: string | null; at: number }>())

  useEffect(() => {
    let cancelled = false
    /*
     * A load because the app came back is QUIET. It says nothing while it
     * runs (no loading, so no screen blinks), and if it does not get
     * through it changes nothing at all: the lists stay as they were. Every
     * other load empties the lists when it fails, as it always has. Those
     * loads are rare (opening the app, or straight after a change made on
     * this phone), but coming back to the app happens all day, often on one
     * bar in a stairwell, and an open job is looked up in these lists
     * (WorkerApp's openJob): emptied, it would shut under the person's thumb.
     */
    const quiet = reason.current === 'resume'
    reason.current = null
    const began = Date.now()
    startedAt.current = began
    inFlight.current = true
    if (!quiet) {
      setLoading(true)
      setError(null)
    }
    const client = supabase()
    const t0 = dayStart(0).toISOString()
    const t2 = dayStart(2).toISOString()

    const fetchAll = () =>
      Promise.all([
        // Sorted client-side below by what the list actually shows (the address,
        // falling back to name) — `name` is mostly invisible on screen, so
        // ordering the query by it made the visible list look shuffled.
        client.from('job_sites').select('*').neq('status', 'archived'),
        client.from('site_progress_v').select('site_id, pct_complete'),
        client.from('defects').select('site_id, status').in('status', ['open', 'in_progress']),
        client.from('shifts').select('site_id, worker_id, started_at, ended_at').gte('started_at', t0),
        client
          .from('assignments')
          .select('*')
          .eq('published', true)
          .lt('starts_at', t2)
          .gte('ends_at', t0)
          .order('starts_at'),
        client.from('site_variations_v').select('id, site_id').eq('status', 'pending_client'),
        client.from('crew_v').select('id, name, initials'),
        client.from('waterproofing').select('site_id, area, status, flood_tested').in('status', ['complete', 'signed_off']).eq('flood_tested', false),
      ])
    /*
     * After hours in the background the access token has expired, and if
     * refreshing it fails (that one bar again) supabase-js sends the anon
     * key instead. RLS answers the anon key with no rows and no error: an
     * empty job list that looks exactly like a good answer. So a quiet load
     * first makes sure there is a session to send, and otherwise stays home.
     */
    const fetched: Promise<Awaited<ReturnType<typeof fetchAll>> | null> = quiet
      ? Promise.resolve()
          .then(() => client.auth.getSession())
          .then(({ data }) => (data.session ? fetchAll() : null))
          .catch(() => null)
      : fetchAll()

    void fetched.then((res) => {
      if (cancelled) return
      inFlight.current = false
      if (!res) return
      const [st, pr, df, sh, asg, vr, cv, wp] = res
      const firstError = st.error || pr.error || df.error || sh.error || asg.error
      if (quiet && firstError) return
      // A quiet load that got through also clears an error an earlier load left.
      setError(firstError ? firstError.message : null)
      const put = quiet ? unlessSame : takeNext
      let fetchedSites = (st.data as JobSiteRow[]) ?? []
      for (const [key, edit] of saved.current) {
        if (edit.at < began) {
          saved.current.delete(key)
          continue
        }
        fetchedSites = fetchedSites.map((x) => (x.id === edit.id ? { ...x, [edit.field]: edit.value } : x))
      }
      fetchedSites.sort(byShown)
      setSites((prev) => put(prev, fetchedSites))
      setProgressRows((prev) => put(prev, pr.data ?? []))
      setDefectRows((prev) => put(prev, df.data ?? []))
      setShiftRows((prev) => put(prev, sh.data ?? []))
      setBookings((prev) => put(prev, (asg.data as AssignmentRow[]) ?? []))
      // site_variations_v has no RLS to reject with — its own where clause is
      // the security boundary (schema_v24) — but the guard stays so a renamed
      // or dropped view fails soft instead of taking the whole hook down.
      // These three fail soft, and a quiet load that could not read one of
      // them keeps what it had rather than zeroing a count that was right.
      if (!quiet || !vr.error) {
        setPendingVariations(vr.error ? 0 : (vr.data?.length ?? 0))
        setVariationRows((prev) => put(prev, vr.error ? [] : ((vr.data as Array<{ id: string; site_id: string | null }>) ?? [])))
      }
      if (!quiet || !cv.error) setRoster((prev) => put(prev, (cv.data as Array<{ id: string; name: string; initials: string }>) ?? []))
      if (!quiet || !wp.error) {
        setWpRows((prev) => put(prev, wp.error ? [] : ((wp.data as Array<{ site_id: string; area: string; status: string; flood_tested: boolean }>) ?? [])))
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [me.company_id, nonce])

  /*
   * Coming back to the app. WKWebView reports the app returning to the
   * foreground as visibilitychange to visible; a browser tab does the same,
   * and a browser window coming back to the front fires focus. Either one
   * asks again, quietly, if the last load started RESUME_REFETCH_AFTER_MS
   * ago or more. There is no realtime on these tables: this is how a job
   * the office made on the website reaches a phone that was already open,
   * in place, with the person still where they were.
   */
  useEffect(() => {
    let timer: number | undefined
    const check = () => {
      timer = undefined
      if (document.visibilityState !== 'visible') return
      // No network at all: asking would only fail. The next return asks.
      if (navigator.onLine === false) return
      // A load is on its way already, one refresh() just asked for or one
      // still out on a slow connection. Another would only cancel it and
      // start the same eight requests again.
      if (reason.current !== null || inFlight.current) return
      if (Date.now() - startedAt.current < RESUME_REFETCH_AFTER_MS) return
      reason.current = 'resume'
      setNonce((n) => n + 1)
    }
    // Not at once (RESUME_SETTLE_MS): a remount on the way takes this timer
    // with it, and a screen that refreshes on focus itself (the website's
    // pages do) gets in first, so this finds that load under way instead of
    // starting a second one beside it.
    const soon = () => {
      if (document.visibilityState !== 'visible') {
        // Leaving. A timer left pending here would be frozen with the app
        // and fire the instant it is back, before the return has settled.
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
        return
      }
      if (timer === undefined) timer = window.setTimeout(check, RESUME_SETTLE_MS)
    }
    window.addEventListener('focus', soon)
    document.addEventListener('visibilitychange', soon)
    return () => {
      window.removeEventListener('focus', soon)
      document.removeEventListener('visibilitychange', soon)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  const progress = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of progressRows) if (r.pct_complete !== null) m.set(r.site_id, Number(r.pct_complete))
    return m
  }, [progressRows])

  const openDefects = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of defectRows) m.set(r.site_id, (m.get(r.site_id) ?? 0) + 1)
    return m
  }, [defectRows])

  const onSiteNow = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of shiftRows) {
      if (r.ended_at !== null || !r.site_id) continue
      m.set(r.site_id, (m.get(r.site_id) ?? 0) + 1)
    }
    return m
  }, [shiftRows])

  /** site_id → who is on the clock there right now, earliest first. */
  const crewOnSite = useMemo(() => {
    const people = new Map(roster.map((w) => [w.id, w]))
    const m = new Map<string, Array<{ name: string; initials: string; since: string }>>()
    for (const r of shiftRows) {
      if (r.ended_at !== null || !r.site_id) continue
      const w = people.get(r.worker_id)
      const list = m.get(r.site_id) ?? []
      list.push({ name: w?.name ?? 'Crew', initials: w?.initials ?? '??', since: r.started_at })
      m.set(r.site_id, list)
    }
    for (const list of m.values()) list.sort((a, b) => (a.since < b.since ? -1 : 1))
    return m
  }, [shiftRows, roster])

  const pendingVariationsBySite = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of variationRows) if (v.site_id) m.set(v.site_id, (m.get(v.site_id) ?? 0) + 1)
    return m
  }, [variationRows])

  const floodHold = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of wpRows) m.set(r.site_id, (m.get(r.site_id) ?? 0) + 1)
    return m
  }, [wpRows])

  const floodAreas = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of wpRows) m.set(r.site_id, [...(m.get(r.site_id) ?? []), r.area])
    return m
  }, [wpRows])

  const { today, tomorrow } = useMemo(() => {
    const t1 = dayStart(1).getTime()
    const today: AssignmentRow[] = []
    const tomorrow: AssignmentRow[] = []
    for (const b of bookings) (new Date(b.starts_at).getTime() < t1 ? today : tomorrow).push(b)
    return { today, tomorrow }
  }, [bookings])

  const onSiteTotal = useMemo(
    () => [...onSiteNow.values()].reduce((a, b) => a + b, 0),
    [onSiteNow],
  )

  return {
    loading,
    error,
    sites,
    progress,
    openDefects,
    onSiteNow,
    onSiteTotal,
    today,
    tomorrow,
    pendingVariations,
    pendingVariationsBySite,
    crewOnSite,
    floodHold,
    floodAreas,
    refresh: useCallback(() => {
      // Asked for, so a full load, even if a quiet one was about to start.
      reason.current = 'refresh'
      setNonce((n) => n + 1)
    }, []),
    patchSite: useCallback((id: string, patch: SitePatch) => {
      const at = Date.now()
      for (const field of ['client_name', 'address'] as const) {
        if (patch[field] === undefined) continue
        saved.current.set(`${id}:${field}`, { id, field, value: patch[field] ?? null, at })
      }
      setSites((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)).sort(byShown))
    }, []),
  }
}

// ------------------------------------------------------------- when a job runs

/**
 * A job's span, from everything that knows about it.
 *
 * Dates somebody typed onto the job win outright — that is a person saying
 * when this runs, and nothing derived gets to argue.
 *
 * Below that it is the widest of what is planned and what is happening:
 * programme lines that are ours, plus what the crew is booked and clocked on
 * to. This started out programme-first — a builder's programme being what we
 * agreed to, and bookings being a mere description of what happened — and
 * that was wrong in a way only visible once a line could be added by hand.
 * Adding a single "tiling — wet areas" line to a job with eight weeks of
 * bookings SHORTENED its bar to those four days, because one hand-typed line
 * counted as a complete programme. A line somebody adds must be able to
 * extend a job and never to truncate it.
 *
 * It lives here because two screens ask the question — the programme bar on
 * the Schedule and the project dates on a job — and a job that runs to
 * different dates depending on which screen you are looking at is worse than
 * one with no dates at all.
 */
export interface SpanRows {
  tasks: Array<{ starts_on: string | null; ends_on: string | null }>
  assignments: Array<{ starts_at: string; ends_at: string | null }>
  shifts: Array<{ started_at: string }>
  /** Set by hand on the job (schema_v33). Beats everything below it. */
  set?: { starts_on: string | null; ends_on: string | null }
}

export function siteSpan(rows: SpanRows): { s: number; e: number } | null {
  const day = (v: string) => new Date(`${v}T00:00:00`).getTime()
  const span = (from: number, to: number, acc: { s: number; e: number } | null) =>
    acc ? { s: Math.min(acc.s, from), e: Math.max(acc.e, to) } : { s: from, e: to }

  // Somebody typed these in. Nothing derived gets to argue with that.
  if (rows.set?.starts_on) {
    return { s: day(rows.set.starts_on), e: day(rows.set.ends_on ?? rows.set.starts_on) }
  }

  let out: { s: number; e: number } | null = null
  for (const t of rows.tasks) {
    if (!t.starts_on) continue
    out = span(day(t.starts_on), day(t.ends_on ?? t.starts_on), out)
  }
  for (const a of rows.assignments) {
    out = span(new Date(a.starts_at).getTime(), new Date(a.ends_at ?? a.starts_at).getTime(), out)
  }
  for (const x of rows.shifts) {
    const t = new Date(x.started_at).getTime()
    out = span(t, t, out)
  }
  return out
}
