/**
 * One hook, everything the Simple shell's screens read.
 *
 * Every query here is safe for every role — RLS narrows rather than errors.
 * An employee's `shifts` come back as just their own, a captain's as their
 * jobs, the owner's as everyone: the ON SITE counter is honest for each of
 * them without this file knowing who is asking. `change_orders` is the one
 * office-only table queried; for anyone else it returns zero rows, which
 * renders as an ATTENTION count without variations in it — correct, not
 * broken.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type AssignmentRow, type JobSiteRow, type WorkerRow } from '../../data/supabase'

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
  /** Variations sitting with the builder. Zero for non-office by RLS. */
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
}

const dayStart = (offset: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}

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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const client = supabase()
    const t0 = dayStart(0).toISOString()
    const t2 = dayStart(2).toISOString()

    void Promise.all([
      client.from('job_sites').select('*').neq('status', 'archived').order('name'),
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
      client.from('change_orders').select('id, site_id').eq('status', 'pending_client'),
      client.from('crew_v').select('id, name, initials'),
      client.from('waterproofing').select('site_id, area, status, flood_tested').in('status', ['complete', 'signed_off']).eq('flood_tested', false),
    ]).then(([st, pr, df, sh, asg, co, cv, wp]) => {
      if (cancelled) return
      const firstError = st.error || pr.error || df.error || sh.error || asg.error
      if (firstError) setError(firstError.message)
      setSites((st.data as JobSiteRow[]) ?? [])
      setProgressRows(pr.data ?? [])
      setDefectRows(df.data ?? [])
      setShiftRows(sh.data ?? [])
      setBookings((asg.data as AssignmentRow[]) ?? [])
      // change_orders errors for nobody — RLS just empties it — but keep the
      // guard so a future policy change cannot take the whole screen down.
      setPendingVariations(co.error ? 0 : (co.data?.length ?? 0))
      setVariationRows(co.error ? [] : ((co.data as Array<{ id: string; site_id: string | null }>) ?? []))
      setRoster((cv.data as Array<{ id: string; name: string; initials: string }>) ?? [])
      setWpRows(wp.error ? [] : ((wp.data as Array<{ site_id: string; area: string; status: string; flood_tested: boolean }>) ?? []))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [me.company_id, nonce])

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
    refresh: useCallback(() => setNonce((n) => n + 1), []),
  }
}

// ------------------------------------------------------------- when a job runs

/**
 * A job's span, from the three things that know about it.
 *
 * The rule is programme-first: if the builder's programme has lines that are
 * ours, those dates ARE the job, because that is what we agreed to. Only when
 * there is no programme does the span fall back to what the crew is actually
 * booked and clocked on to — which is a description of what happened rather
 * than a plan, and would otherwise overwrite the plan with it.
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

  let planned: { s: number; e: number } | null = null
  for (const t of rows.tasks) {
    if (!t.starts_on) continue
    planned = span(
      new Date(`${t.starts_on}T00:00:00`).getTime(),
      new Date(`${t.ends_on ?? t.starts_on}T00:00:00`).getTime(),
      planned,
    )
  }
  if (planned) return planned

  let actual: { s: number; e: number } | null = null
  for (const a of rows.assignments) {
    actual = span(new Date(a.starts_at).getTime(), new Date(a.ends_at ?? a.starts_at).getTime(), actual)
  }
  for (const x of rows.shifts) {
    const t = new Date(x.started_at).getTime()
    actual = span(t, t, actual)
  }
  return actual
}
