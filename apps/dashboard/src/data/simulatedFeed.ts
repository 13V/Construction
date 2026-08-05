import type { LatLng, Ping } from '../types'
import { lerp, offset } from '../geofence/geo'
import { jobSites } from './seed'
import type { FeedBatch, PositionFeed } from './feed'

/**
 * A scripted work day. Every case the geofence engine has to handle is in
 * here on purpose:
 *
 *  - Miguel / Danny / Tre  normal arrival at Maple Ridge, dwell, clock in
 *  - Rosa                  normal arrival at Harbor View
 *  - Sam                   on site at Northgate, leaves 9:12, clocks out,
 *                          drives *through* City Line's fence without
 *                          stopping (must be rejected), arrives Maple Ridge
 *  - Alicia                parks 120 m outside Maple Ridge's fence all day
 *                          and is never clocked in — flagged for review
 *  - Bobby                 no shift, reports nothing
 */

const site = (id: string): LatLng => {
  const found = jobSites.find((s) => s.id === id)
  if (!found) throw new Error(`simulatedFeed: unknown site ${id}`)
  return found.center
}

const MR = site('maple-ridge')
const NG = site('northgate-plaza')
const HV = site('harbor-view-3b')
const CL = site('city-line-storage')

/** Start of the simulated day: today at 06:20 local. */
export function dayStart(reference = new Date()): number {
  const d = new Date(reference)
  d.setHours(6, 20, 0, 0)
  return d.getTime()
}

const MIN = 60_000
const at = (base: number, hour: number, minute: number) => {
  const d = new Date(base)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

interface Keyframe {
  t: number
  pos: LatLng
}

interface Route {
  workerId: string
  frames: Keyframe[]
}

function buildRoutes(base: number): Route[] {
  const t = (h: number, m: number) => at(base, h, m)

  return [
    {
      workerId: 'miguel',
      frames: [
        { t: t(6, 20), pos: offset(MR, 195, 2600) },
        { t: t(6, 42), pos: MR },
        { t: t(15, 30), pos: offset(MR, 20, 40) },
      ],
    },
    {
      workerId: 'tre',
      frames: [
        { t: t(6, 20), pos: offset(MR, 270, 2100) },
        { t: t(6, 44), pos: offset(MR, 300, 35) },
        { t: t(15, 30), pos: offset(MR, 330, 55) },
      ],
    },
    {
      workerId: 'danny',
      frames: [
        { t: t(6, 25), pos: offset(MR, 15, 3000) },
        { t: t(6, 51), pos: offset(MR, 120, 45) },
        { t: t(15, 30), pos: offset(MR, 150, 60) },
      ],
    },
    {
      workerId: 'rosa',
      frames: [
        { t: t(6, 35), pos: offset(HV, 210, 2500) },
        { t: t(7, 3), pos: HV },
        { t: t(15, 30), pos: offset(HV, 60, 40) },
      ],
    },
    {
      workerId: 'sam',
      frames: [
        // Already on site when the day starts.
        { t: t(6, 20), pos: offset(NG, 90, 40) },
        { t: t(9, 12), pos: offset(NG, 100, 50) },
        // Heads south-west, clipping City Line's fence without stopping.
        { t: t(9, 30), pos: offset(CL, 30, 900) },
        { t: t(9, 31), pos: CL },
        { t: t(9, 32), pos: offset(CL, 210, 900) },
        { t: t(9, 50), pos: offset(MR, 45, 30) },
        { t: t(15, 30), pos: offset(MR, 60, 45) },
      ],
    },
    {
      workerId: 'alicia',
      frames: [
        { t: t(6, 40), pos: offset(MR, 60, 2400) },
        // Parks 120 m beyond the fence — no room in the drive.
        { t: t(7, 10), pos: offset(MR, 45, 272) },
        { t: t(15, 30), pos: offset(MR, 45, 272) },
      ],
    },
    // Bobby Kaminski has no shift scheduled and reports nothing.
  ]
}

function positionAt(route: Route, now: number): LatLng | null {
  const { frames } = route
  if (now < frames[0].t) return null

  for (let i = 1; i < frames.length; i++) {
    if (now <= frames[i].t) {
      const span = frames[i].t - frames[i - 1].t
      const progress = span === 0 ? 1 : (now - frames[i - 1].t) / span
      return lerp(frames[i - 1].pos, frames[i].pos, progress)
    }
  }
  return frames[frames.length - 1].pos
}

export const END_OF_DAY_HOUR = 15
export const END_OF_DAY_MIN = 45

/**
 * Every ping the scripted day produces, in time order. Deterministic and
 * timer-free so the geofence engine can be tested against the exact stream the
 * demo will replay.
 */
export function generateDayPings(base = dayStart(), pingIntervalS = 20): Ping[] {
  const routes = buildRoutes(base)
  const endOfDay = at(base, END_OF_DAY_HOUR, END_OF_DAY_MIN)
  const step = pingIntervalS * 1000
  const pings: Ping[] = []

  for (let t = base; t <= endOfDay; t += step) {
    for (const route of routes) {
      const pos = positionAt(route, t)
      if (!pos) continue
      pings.push({
        workerId: route.workerId,
        at: t,
        lat: pos.lat,
        lng: pos.lng,
        // Phone GPS realistically lands in the 5–20 m band outdoors.
        accuracyM: 6 + ((t / MIN) % 9),
      })
    }
  }

  return pings
}

export interface SimulatedFeedOptions {
  /** Simulated minutes per real second. */
  speed?: number
  /** Simulated seconds between pings from each phone. */
  pingIntervalS?: number
  /** Real milliseconds between ticks. */
  tickMs?: number
}

/**
 * Replays the scripted day against an accelerated clock. Phones report every
 * `pingIntervalS` of simulated time — which is what the real app does too: a
 * low-frequency ping while on shift, not a continuous stream.
 */
export function createSimulatedFeed(options: SimulatedFeedOptions = {}): PositionFeed {
  const { pingIntervalS = 20, tickMs = 250 } = options
  let speed = options.speed ?? 90

  const base = dayStart()
  const endOfDay = at(base, END_OF_DAY_HOUR, END_OF_DAY_MIN)
  const script = generateDayPings(base, pingIntervalS)

  let simNow = base
  let cursor = 0

  return {
    setSpeed(multiplier: number) {
      speed = multiplier
    },

    subscribe(onBatch: (batch: FeedBatch) => void) {
      const timer = setInterval(() => {
        simNow = Math.min(simNow + tickMs * speed, endOfDay)

        const pings: Ping[] = []
        while (cursor < script.length && script[cursor].at <= simNow) {
          pings.push(script[cursor])
          cursor++
        }

        onBatch({ pings, now: simNow })
      }, tickMs)

      return () => clearInterval(timer)
    },
  }
}
