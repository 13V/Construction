import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  supabase,
  type EventRow,
  type JobSiteRow,
  type PositionRow,
  type ShiftRow,
  type WorkerRow,
} from './supabase'
import type {
  CrewSnapshot,
  JobSite,
  LatLng,
  Shift,
  TimelineEvent,
  Worker,
  WorkerState,
} from '../types'
import { distanceM } from '../geofence/geo'
import { siteContaining } from '../geofence/dwell'

/** No ping for this long during a shift means the phone dropped off. */
const SIGNAL_LOST_MS = 10 * 60_000
/** Parked this close to a site but outside its fence is worth flagging. */
const NEAR_SITE_M = 450
const TRAIL_MAX_POINTS = 240
/** Backfill cap. A busy day across 40 crew is well under this. */
const POSITION_BACKFILL_LIMIT = 5000

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const toWorker = (row: WorkerRow): Worker => ({
  id: row.id,
  name: row.name,
  initials: row.initials,
  trade: row.trade,
  rate: Number(row.rate),
})

const toSite = (row: JobSiteRow): JobSite => ({
  id: row.id,
  name: row.name,
  address: row.address,
  jobType: row.job_type,
  status: row.status === 'starting_soon' ? 'starting_soon' : 'active',
  center: { lat: row.lat, lng: row.lng },
  radiusM: row.radius_m,
  budget: row.budget === null ? null : Number(row.budget),
})

const toShift = (row: ShiftRow): Shift => ({
  id: row.id,
  workerId: row.worker_id,
  siteId: row.site_id ?? '',
  startedAt: new Date(row.started_at).getTime(),
  endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
  source: row.source,
  edited: row.edited,
  approved: Boolean(row.approved_at),
  costCode: row.cost_code,
})

export interface LiveData extends CrewSnapshot {
  companyName: string
  /** Raw rows, for crew management (invite state, access level). */
  roster: WorkerRow[]
  loading: boolean
  error: string | null
  sites: JobSite[]
  workers: Worker[]
  refresh: () => void
}

/**
 * Everything the dashboard renders, straight from Supabase.
 *
 * The geofence engine does NOT run here — the server owns that (api/ping.ts)
 * and writes shifts. This hook only reads what the server decided, so what the
 * office sees is exactly what payroll will bill.
 */
export function useLive(): LiveData {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [workerRows, setWorkerRows] = useState<WorkerRow[]>([])
  const [siteRows, setSiteRows] = useState<JobSiteRow[]>([])
  const [trails, setTrails] = useState<Map<string, LatLng[]>>(new Map())
  const [lastPing, setLastPing] = useState<Map<string, number>>(new Map())
  const [shiftRows, setShiftRows] = useState<Map<string, ShiftRow>>(new Map())
  const [eventRows, setEventRows] = useState<EventRow[]>([])
  const [companyName, setCompanyName] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [nonce, setNonce] = useState(0)

  const channels = useRef<RealtimeChannel[]>([])

  // Keeps open-shift counters ticking between server events.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ingestPosition = useCallback((row: PositionRow) => {
    const at = new Date(row.at).getTime()
    setLastPing((prev) => {
      const next = new Map(prev)
      next.set(row.worker_id, Math.max(next.get(row.worker_id) ?? 0, at))
      return next
    })
    setTrails((prev) => {
      const next = new Map(prev)
      const trail = next.get(row.worker_id) ?? []
      const point = { lat: row.lat, lng: row.lng }
      const last = trail[trail.length - 1]
      if (last && distanceM(last, point) < 12) return prev
      const appended = [...trail, point]
      next.set(
        row.worker_id,
        appended.length > TRAIL_MAX_POINTS
          ? appended.slice(appended.length - TRAIL_MAX_POINTS)
          : appended,
      )
      return next
    })
  }, [])

  useEffect(() => {
    const client = supabase()
    let cancelled = false
    setLoading(true)
    setError(null)

    const since = startOfToday().toISOString()

    async function load() {
      const [company, workers, sites, positions, shifts, events] = await Promise.all([
        client.from('companies').select('name').maybeSingle(),
        client.from('workers').select('*').eq('active', true).order('name'),
        client.from('job_sites').select('*').neq('status', 'archived').order('name'),
        client
          .from('positions')
          .select('worker_id, at, lat, lng, accuracy_m')
          .gte('at', since)
          .order('at', { ascending: true })
          .limit(POSITION_BACKFILL_LIMIT),
        client.from('shifts').select('*').gte('started_at', since),
        client
          .from('geofence_events')
          .select('*')
          .gte('at', since)
          .order('at', { ascending: false })
          .limit(60),
      ])

      if (cancelled) return

      const firstError =
        workers.error ?? sites.error ?? positions.error ?? shifts.error ?? events.error
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      setCompanyName((company.data as { name: string } | null)?.name ?? '')
      setWorkerRows((workers.data ?? []) as WorkerRow[])
      setSiteRows((sites.data ?? []) as JobSiteRow[])

      const trailMap = new Map<string, LatLng[]>()
      const pingMap = new Map<string, number>()
      for (const row of (positions.data ?? []) as PositionRow[]) {
        const point = { lat: row.lat, lng: row.lng }
        const trail = trailMap.get(row.worker_id) ?? []
        const last = trail[trail.length - 1]
        if (!last || distanceM(last, point) >= 12) {
          trail.push(point)
          trailMap.set(row.worker_id, trail.slice(-TRAIL_MAX_POINTS))
        }
        pingMap.set(row.worker_id, new Date(row.at).getTime())
      }
      setTrails(trailMap)
      setLastPing(pingMap)

      setShiftRows(
        new Map(((shifts.data ?? []) as ShiftRow[]).map((row) => [row.id, row])),
      )
      setEventRows((events.data ?? []) as EventRow[])
      setLoading(false)
    }

    void load()

    const positionsChannel = client
      .channel('live-positions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'positions' },
        (payload) => ingestPosition(payload.new as PositionRow),
      )
      .subscribe()

    const shiftsChannel = client
      .channel('live-shifts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts' },
        (payload) => {
          const row = (payload.new ?? payload.old) as ShiftRow
          setShiftRows((prev) => {
            const next = new Map(prev)
            if (payload.eventType === 'DELETE') next.delete(row.id)
            else next.set(row.id, payload.new as ShiftRow)
            return next
          })
        },
      )
      .subscribe()

    const eventsChannel = client
      .channel('live-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'geofence_events' },
        (payload) =>
          setEventRows((prev) => [payload.new as EventRow, ...prev].slice(0, 60)),
      )
      .subscribe()

    channels.current = [positionsChannel, shiftsChannel, eventsChannel]

    return () => {
      cancelled = true
      for (const channel of channels.current) void client.removeChannel(channel)
      channels.current = []
    }
  }, [ingestPosition, nonce])

  return useMemo(() => {
    const workers = workerRows.map(toWorker)
    const sites = siteRows.map(toSite)
    const shifts = [...shiftRows.values()].map(toShift)

    const openShiftFor = (workerId: string) =>
      shifts.find((s) => s.workerId === workerId && s.endedAt === null) ?? null

    const crew: WorkerState[] = workers.map((worker) => {
      const trail = trails.get(worker.id) ?? []
      const position = trail[trail.length - 1] ?? null
      const pingAt = lastPing.get(worker.id) ?? null
      const open = openShiftFor(worker.id)

      const banked = shifts
        .filter((s) => s.workerId === worker.id && s.endedAt !== null)
        .reduce((sum, s) => sum + (s.endedAt! - s.startedAt), 0)

      let exception: WorkerState['exception'] = null
      let note: string | null = null

      if (open && pingAt && now - pingAt >= SIGNAL_LOST_MS) {
        exception = 'signal_lost'
        note = 'Phone stopped reporting — hours may be short'
      } else if (!open && position) {
        const inFence = siteContaining(position, sites)
        if (!inFence) {
          const nearest = sites
            .map((s) => ({ site: s, d: distanceM(position, s.center) }))
            .sort((a, b) => a.d - b.d)[0]
          if (nearest && nearest.d <= NEAR_SITE_M) {
            exception = 'outside_geofence'
            note = `${Math.round(nearest.d - nearest.site.radiusM)} m outside ${nearest.site.name} — review`
          }
        }
      }

      const status: WorkerState['status'] = exception
        ? 'exception'
        : open
          ? 'on_clock'
          : pingAt
            ? 'traveling'
            : 'off'

      return {
        worker,
        position,
        lastPingAt: pingAt,
        status,
        siteId: open?.siteId ?? null,
        clockedInAt: open?.startedAt ?? null,
        bankedMs: banked,
        trail,
        exception,
        note,
      }
    })

    const liveMs = (state: WorkerState) =>
      state.bankedMs +
      (state.clockedInAt !== null ? Math.max(0, now - state.clockedInAt) : 0)

    const events: TimelineEvent[] = eventRows.map((row) => ({
      id: String(row.id),
      at: new Date(row.at).getTime(),
      kind: (row.kind as TimelineEvent['kind']) ?? 'clock_in',
      workerId: row.worker_id,
      siteId: row.site_id,
      message: row.message,
    }))

    return {
      companyName,
      roster: workerRows,
      loading,
      error,
      sites,
      workers,
      now,
      crew,
      shifts,
      events,
      onClock: crew.filter((c) => c.status === 'on_clock').length,
      activeSites: new Set(crew.filter((c) => c.siteId).map((c) => c.siteId)).size,
      hoursToday: crew.reduce((sum, c) => sum + liveMs(c) / 3_600_000, 0),
      labourCostToday: crew.reduce(
        (sum, c) => sum + (liveMs(c) / 3_600_000) * c.worker.rate,
        0,
      ),
      refresh: () => setNonce((n) => n + 1),
    }
  }, [companyName, workerRows, siteRows, trails, lastPing, shiftRows, eventRows, now, loading, error])
}
