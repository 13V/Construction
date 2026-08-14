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
  const [shiftRows, setShiftRows] = useState<Array<{ site_id: string | null; ended_at: string | null }>>([])
  const [bookings, setBookings] = useState<AssignmentRow[]>([])
  const [pendingVariations, setPendingVariations] = useState(0)

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
      client.from('shifts').select('site_id, ended_at').gte('started_at', t0),
      client
        .from('assignments')
        .select('*')
        .eq('published', true)
        .lt('starts_at', t2)
        .gte('ends_at', t0)
        .order('starts_at'),
      client.from('change_orders').select('id').eq('status', 'pending_client'),
    ]).then(([st, pr, df, sh, asg, co]) => {
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
    refresh: useCallback(() => setNonce((n) => n + 1), []),
  }
}
