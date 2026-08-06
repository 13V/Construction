import { describe, expect, it } from 'vitest'
import type { JobSite, LatLng, Ping } from '../types.js'
import { advance, DWELL_IN_MS, DWELL_OUT_MS, initialPhase, type DwellEvent } from './dwell.js'
import { lerp, offset } from './geo.js'

const MIN = 60_000
const T0 = new Date('2026-08-05T06:00:00').getTime()

const site = (id: string, center: LatLng, radiusM: number): JobSite => ({
  id,
  name: id,
  address: '',
  jobType: '',
  status: 'active',
  center,
  radiusM,
  budget: null,
  clientName: null,
  progressPct: null,
  scheduleNote: null,
})

const MAPLE = site('maple', { lat: -27.4055, lng: 153.049 }, 150)
const NORTH = site('north', { lat: -27.3905, lng: 153.0715 }, 122)
const CITY = site('city', { lat: -27.418, lng: 153.064 }, 122)

/** Feed [offsetMs, metres from Maple's centre] through the machine. */
function run(steps: Array<[number, number]>, sites = [MAPLE]) {
  let phase = initialPhase
  const events: DwellEvent[] = []

  for (const [ms, distance] of steps) {
    const pos = offset(MAPLE.center, 90, distance)
    const ping: Ping = { workerId: 'w', at: T0 + ms, lat: pos.lat, lng: pos.lng, accuracyM: 8 }
    const result = advance(phase, ping, sites)
    phase = result.phase
    events.push(...result.events)
  }

  return { phase, events }
}

describe('dwell geofence engine', () => {
  it('clocks in only after the dwell threshold', () => {
    const { phase, events } = run([
      [0, 900],
      [1 * MIN, 50],
      [2 * MIN, 50],
      [3 * MIN, 50],
    ])

    expect(events.filter((e) => e.kind === 'clock_in')).toHaveLength(1)
    expect(phase.kind).toBe('onsite')
  })

  it('does not clock in before the threshold has elapsed', () => {
    const { phase, events } = run([
      [0, 900],
      [30_000, 50],
      [60_000, 50],
    ])

    expect(events).toHaveLength(0)
    expect(phase.kind).toBe('arriving')
    expect(DWELL_IN_MS).toBeGreaterThan(60_000)
  })

  it('rejects a drive-by instead of clocking the worker in', () => {
    const { phase, events } = run([
      [0, 900],
      [20_000, 40],
      [40_000, 60],
      [60_000, 800],
    ])

    expect(events.map((e) => e.kind)).toEqual(['drive_by_rejected'])
    expect(events.filter((e) => e.kind === 'clock_in')).toHaveLength(0)
    expect(phase.kind).toBe('offsite')
  })

  it('does not clock out for a brief trip to the truck', () => {
    const { phase, events } = run([
      [0, 50],
      [3 * MIN, 50],
      [10 * MIN, 400],
      [11 * MIN, 50],
      [30 * MIN, 50],
    ])

    expect(events.filter((e) => e.kind === 'clock_out')).toHaveLength(0)
    expect(phase.kind).toBe('onsite')
  })

  it('clocks out once the worker has really gone, backdated to departure', () => {
    const departedAt = 20 * MIN
    const { phase, events } = run([
      [0, 50],
      [3 * MIN, 50],
      [departedAt, 50],
      [departedAt + 1 * MIN, 900],
      [departedAt + 2 * MIN, 1200],
      [departedAt + 5 * MIN, 1500],
    ])

    const out = events.find((e) => e.kind === 'clock_out')
    expect(out).toBeDefined()
    expect(phase.kind).toBe('offsite')
    // Credited to when they left, not when we noticed.
    expect(out!.at).toBe(T0 + departedAt)
    expect(DWELL_OUT_MS).toBe(3 * MIN)
  })

  it('never clocks in a worker parked just outside the fence', () => {
    const justOutside = MAPLE.radiusM + 120
    const { phase, events } = run([
      [0, 2000],
      [10 * MIN, justOutside],
      [60 * MIN, justOutside],
      [240 * MIN, justOutside],
    ])

    expect(events).toHaveLength(0)
    expect(phase.kind).toBe('offsite')
  })
})

describe('moving between sites', () => {
  const sites = [MAPLE, NORTH, CITY]

  /** Positions interpolated along a route, sampled every 20 s of travel. */
  function travel(
    frames: Array<{ t: number; pos: LatLng }>,
    stepMs = 20_000,
  ): Ping[] {
    const pings: Ping[] = []
    const end = frames[frames.length - 1].t

    for (let t = frames[0].t; t <= end; t += stepMs) {
      let pos = frames[frames.length - 1].pos
      for (let i = 1; i < frames.length; i++) {
        if (t <= frames[i].t) {
          const span = frames[i].t - frames[i - 1].t
          pos = lerp(frames[i - 1].pos, frames[i].pos, span === 0 ? 1 : (t - frames[i - 1].t) / span)
          break
        }
      }
      pings.push({ workerId: 'w', at: t, lat: pos.lat, lng: pos.lng, accuracyM: 8 })
    }
    return pings
  }

  function replay(pings: Ping[]) {
    let phase = initialPhase
    const events: DwellEvent[] = []
    for (const ping of pings) {
      const result = advance(phase, ping, sites)
      phase = result.phase
      events.push(...result.events)
    }
    return events
  }

  it('clocks out of one site and into the next, ignoring a fence crossed on the way', () => {
    const events = replay(
      travel([
        // Starts on site at Northgate.
        { t: T0, pos: offset(NORTH.center, 90, 40) },
        { t: T0 + 170 * MIN, pos: offset(NORTH.center, 100, 50) },
        // Drives south-west, straight through City Line's fence without stopping.
        { t: T0 + 188 * MIN, pos: offset(CITY.center, 30, 900) },
        { t: T0 + 189 * MIN, pos: CITY.center },
        { t: T0 + 190 * MIN, pos: offset(CITY.center, 210, 900) },
        // Settles at Maple Ridge for the rest of the day.
        { t: T0 + 208 * MIN, pos: offset(MAPLE.center, 45, 30) },
        { t: T0 + 400 * MIN, pos: offset(MAPLE.center, 60, 45) },
      ]),
    )

    expect(events.filter((e) => e.kind === 'clock_in').map((e) => e.siteId)).toEqual([
      'north',
      'maple',
    ])
    expect(events.filter((e) => e.kind === 'clock_out').map((e) => e.siteId)).toEqual(['north'])

    const rejected = events.filter((e) => e.kind === 'drive_by_rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].siteId).toBe('city')
    expect(rejected[0].kind === 'drive_by_rejected' && rejected[0].dwelledMs).toBeLessThan(
      DWELL_IN_MS,
    )
  })

  it('produces no events at all for someone who never goes near a site', () => {
    const far = offset(MAPLE.center, 0, 20_000)
    const events = replay(
      travel([
        { t: T0, pos: far },
        { t: T0 + 300 * MIN, pos: offset(far, 90, 500) },
      ]),
    )
    expect(events).toHaveLength(0)
  })
})
