import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ExceptionKind,
  JobSite,
  LatLng,
  TimelineEvent,
  WorkerState,
} from '../types'
import type { PositionFeed } from '../data/feed'
import { jobSites, workers } from '../data/seed'
import {
  advance,
  initialPhase,
  siteContaining,
  SIGNAL_LOST_MS,
  type DwellPhase,
} from '../geofence/dwell'
import { distanceM } from '../geofence/geo'

/** Worker sitting outside a fence this long, near a site, gets flagged. */
const LOITER_FLAG_MS = 10 * 60_000
/** How close to a site counts as "they meant to be here". */
const NEAR_SITE_M = 450
/** Trail points closer together than this are dropped — keeps polylines light. */
const TRAIL_MIN_SPACING_M = 12
const TRAIL_MAX_POINTS = 240

interface Internals {
  phase: DwellPhase
  /** When the worker first became "near a site but outside the fence". */
  loiterSince: number | null
}

function blank(): Map<string, WorkerState> {
  return new Map(
    workers.map((worker) => [
      worker.id,
      {
        worker,
        position: null,
        lastPingAt: null,
        status: 'off',
        siteId: null,
        clockedInAt: null,
        bankedMs: 0,
        trail: [],
        exception: null,
        note: null,
      } satisfies WorkerState,
    ]),
  )
}

function pushTrail(trail: LatLng[], next: LatLng): LatLng[] {
  const last = trail[trail.length - 1]
  if (last && distanceM(last, next) < TRAIL_MIN_SPACING_M) return trail
  const out = [...trail, next]
  return out.length > TRAIL_MAX_POINTS ? out.slice(out.length - TRAIL_MAX_POINTS) : out
}

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export interface CrewSnapshot {
  now: number
  crew: WorkerState[]
  events: TimelineEvent[]
  onClock: number
  activeSites: number
  hoursToday: number
  labourCostToday: number
}

/**
 * Applies the position feed to the geofence engine and exposes everything the
 * dashboard renders. All timing comes from the pings themselves, so this works
 * identically against the simulated feed and against live phones.
 */
export function useCrew(feed: PositionFeed, sites: JobSite[] = jobSites): CrewSnapshot {
  const [states, setStates] = useState<Map<string, WorkerState>>(blank)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [now, setNow] = useState<number>(() => Date.now())

  /** Authoritative engine state. React state is a render snapshot of this. */
  const statesRef = useRef<Map<string, WorkerState>>(states)
  const internals = useRef<Map<string, Internals>>(
    new Map(workers.map((w) => [w.id, { phase: initialPhase, loiterSince: null }])),
  )
  const eventSeq = useRef(0)

  useEffect(() => {
    const unsubscribe = feed.subscribe(({ pings, now: feedNow }) => {
      // The engine runs here, NOT inside a setState updater: React invokes
      // updaters more than once (StrictMode, concurrent rendering) and the
      // dwell machine advances a ref, so a double invocation would consume
      // pings twice and drop the clock-in events they produced.
      const fresh: TimelineEvent[] = []
      let changed = false

      {
        const next = statesRef.current

        for (const ping of pings) {
          const current = next.get(ping.workerId)
          const inner = internals.current.get(ping.workerId)
          if (!current || !inner) continue

          const { phase, events: fired } = advance(inner.phase, ping, sites)
          inner.phase = phase

          let { bankedMs, clockedInAt, siteId } = current
          let exception: ExceptionKind | null = null
          let note: string | null = null

          for (const event of fired) {
            const site = sites.find((s) => s.id === event.siteId)
            const siteName = site?.name ?? event.siteId

            if (event.kind === 'clock_in') {
              clockedInAt = event.at
              siteId = event.siteId
              fresh.push({
                id: `e${eventSeq.current++}`,
                at: event.at,
                kind: 'clock_in',
                workerId: ping.workerId,
                siteId: event.siteId,
                message: `${current.worker.name} clocked in at ${siteName} · ${hhmm(event.at)}`,
              })
            }

            if (event.kind === 'clock_out') {
              if (clockedInAt !== null) bankedMs += Math.max(0, event.at - clockedInAt)
              clockedInAt = null
              siteId = null
              fresh.push({
                id: `e${eventSeq.current++}`,
                at: event.at,
                kind: 'clock_out',
                workerId: ping.workerId,
                siteId: event.siteId,
                message: `${current.worker.name} left ${siteName} · clocked out ${hhmm(event.at)}`,
              })
            }

            if (event.kind === 'drive_by_rejected') {
              const secs = Math.round(event.dwelledMs / 1000)
              fresh.push({
                id: `e${eventSeq.current++}`,
                at: event.at,
                kind: 'drive_by_rejected',
                workerId: ping.workerId,
                siteId: event.siteId,
                message: `${current.worker.name} passed ${siteName} ${hhmm(event.at)} — not clocked in (${secs}s on site)`,
              })
            }
          }

          // Near a site, outside its fence, not on the clock, for a while:
          // almost always parking or an address that needs its fence moved.
          const here = { lat: ping.lat, lng: ping.lng }
          const inFence = siteContaining(here, sites)
          const nearest = nearestSite(here, sites)

          if (!inFence && clockedInAt === null && nearest && nearest.distance <= NEAR_SITE_M) {
            inner.loiterSince ??= ping.at
            if (ping.at - inner.loiterSince >= LOITER_FLAG_MS) {
              exception = 'outside_geofence'
              const metres = Math.round(nearest.distance - nearest.site.radiusM)
              note = `${metres} m outside ${nearest.site.name} — review`
            }
          } else {
            inner.loiterSince = null
          }

          const status: WorkerState['status'] = exception
            ? 'exception'
            : clockedInAt !== null
              ? 'on_clock'
              : inner.phase.kind === 'arriving'
                ? 'arriving'
                : 'traveling'

          next.set(ping.workerId, {
            ...current,
            position: here,
            lastPingAt: ping.at,
            status,
            siteId,
            clockedInAt,
            bankedMs,
            trail: pushTrail(current.trail, here),
            exception,
            note,
          })
          changed = true
        }

        // Re-evaluate staleness every tick so a dropped phone surfaces even
        // when it has stopped reporting entirely.
        const staled = markStale(next, feedNow)
        if (staled !== next) {
          statesRef.current = staled
          changed = true
        }
      }

      setNow(feedNow)
      if (changed) setStates(new Map(statesRef.current))
      if (fresh.length) setEvents((prev) => [...fresh, ...prev].slice(0, 60))
    })

    return unsubscribe
  }, [feed, sites])

  return useMemo(() => {
    const crew = [...states.values()]

    const liveMs = (w: WorkerState) =>
      w.bankedMs + (w.clockedInAt !== null ? Math.max(0, now - w.clockedInAt) : 0)

    const hoursToday = crew.reduce((sum, w) => sum + liveMs(w) / 3_600_000, 0)
    const labourCostToday = crew.reduce(
      (sum, w) => sum + (liveMs(w) / 3_600_000) * w.worker.rate,
      0,
    )

    return {
      now,
      crew,
      events,
      onClock: crew.filter((w) => w.status === 'on_clock').length,
      activeSites: new Set(crew.filter((w) => w.siteId).map((w) => w.siteId)).size,
      hoursToday,
      labourCostToday,
    }
  }, [states, events, now])
}

function nearestSite(at: LatLng, sites: JobSite[]) {
  let best: { site: JobSite; distance: number } | null = null
  for (const site of sites) {
    const distance = distanceM(at, site.center)
    if (!best || distance < best.distance) best = { site, distance }
  }
  return best
}

/** A phone that stops reporting mid-shift is a problem worth showing. */
function markStale(states: Map<string, WorkerState>, now: number) {
  let changed = false
  const next = new Map(states)

  for (const [id, state] of states) {
    if (state.lastPingAt === null) continue
    const stale = now - state.lastPingAt >= SIGNAL_LOST_MS
    const already = state.exception === 'signal_lost'

    if (stale && !already) {
      next.set(id, {
        ...state,
        status: 'exception',
        exception: 'signal_lost',
        note: `No location since ${hhmm(state.lastPingAt)} — phone signal lost`,
      })
      changed = true
    } else if (!stale && already) {
      next.set(id, { ...state, exception: null, note: null })
      changed = true
    }
  }

  return changed ? next : states
}

/** Live milliseconds on the clock for a worker, given the current time. */
export function liveMsFor(state: WorkerState, now: number): number {
  return state.bankedMs + (state.clockedInAt !== null ? Math.max(0, now - state.clockedInAt) : 0)
}
