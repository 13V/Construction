import { describe, expect, it } from 'vitest'
import type { JobSite, Ping } from '../types'
import { advance, DWELL_IN_MS, DWELL_OUT_MS, initialPhase, type DwellEvent } from './dwell'
import { offset } from './geo'
import { generateDayPings, dayStart } from '../data/simulatedFeed'
import { jobSites } from '../data/seed'

const site: JobSite = {
  id: 'test-site',
  name: 'Test Site',
  address: '',
  jobType: '',
  status: 'active',
  center: { lat: -27.4055, lng: 153.049 },
  radiusM: 150,
}

const T0 = new Date('2026-08-05T06:00:00').getTime()

/** Feed a sequence of [offsetMs, distanceFromCentreM] through the machine. */
function run(steps: Array<[number, number]>, sites = [site]) {
  let phase = initialPhase
  const events: DwellEvent[] = []

  for (const [ms, distance] of steps) {
    const pos = offset(site.center, 90, distance)
    const ping: Ping = {
      workerId: 'w',
      at: T0 + ms,
      lat: pos.lat,
      lng: pos.lng,
      accuracyM: 8,
    }
    const result = advance(phase, ping, sites)
    phase = result.phase
    events.push(...result.events)
  }

  return { phase, events }
}

const MIN = 60_000

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
      [20_000, 40], // inside the fence, briefly
      [40_000, 60],
      [60_000, 800], // gone again, well under DWELL_IN_MS
    ])

    expect(events.map((e) => e.kind)).toEqual(['drive_by_rejected'])
    expect(events.filter((e) => e.kind === 'clock_in')).toHaveLength(0)
    expect(phase.kind).toBe('offsite')
  })

  it('does not clock out for a brief trip to the truck', () => {
    const { phase, events } = run([
      [0, 50],
      [3 * MIN, 50], // clocked in by now
      [10 * MIN, 400], // stepped outside the fence
      [11 * MIN, 50], // straight back in
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
      [departedAt, 50], // last ping inside
      [departedAt + 1 * MIN, 900],
      [departedAt + 2 * MIN, 1200],
      [departedAt + 5 * MIN, 1500], // past DWELL_OUT_MS
    ])

    const out = events.find((e) => e.kind === 'clock_out')
    expect(out).toBeDefined()
    expect(phase.kind).toBe('offsite')
    // Credited to when they left, not when we noticed.
    expect(out!.at).toBe(T0 + departedAt)
    expect(DWELL_OUT_MS).toBe(3 * MIN)
  })

  it('never clocks in a worker parked just outside the fence', () => {
    const justOutside = site.radiusM + 120
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

describe('scripted demo day', () => {
  const base = dayStart(new Date('2026-08-05T00:00:00'))
  const pings = generateDayPings(base)

  /** Replay the whole day the way the dashboard does. */
  function replay() {
    const phases = new Map<string, ReturnType<typeof advance>['phase']>()
    const byWorker = new Map<string, DwellEvent[]>()

    for (const ping of pings) {
      const phase = phases.get(ping.workerId) ?? initialPhase
      const result = advance(phase, ping, jobSites)
      phases.set(ping.workerId, result.phase)
      if (result.events.length) {
        byWorker.set(ping.workerId, [
          ...(byWorker.get(ping.workerId) ?? []),
          ...result.events,
        ])
      }
    }
    return byWorker
  }

  const events = replay()
  const kinds = (id: string) => (events.get(id) ?? []).map((e) => e.kind)

  it('clocks in the four workers who turn up and stay', () => {
    for (const id of ['miguel', 'danny', 'tre', 'rosa']) {
      expect(kinds(id), id).toContain('clock_in')
      expect(kinds(id).filter((k) => k === 'clock_in'), id).toHaveLength(1)
    }
  })

  it('clocks Sam out of Northgate and in again at Maple Ridge', () => {
    const sam = events.get('sam') ?? []
    const ins = sam.filter((e) => e.kind === 'clock_in')
    const outs = sam.filter((e) => e.kind === 'clock_out')

    expect(ins.map((e) => e.siteId)).toEqual(['northgate-plaza', 'maple-ridge'])
    expect(outs.map((e) => e.siteId)).toEqual(['northgate-plaza'])
  })

  it('rejects Sam driving through the City Line fence', () => {
    const sam = events.get('sam') ?? []
    const rejected = sam.filter((e) => e.kind === 'drive_by_rejected')

    expect(rejected).toHaveLength(1)
    expect(rejected[0].siteId).toBe('city-line-storage')
    // He was inside the fence, just never long enough to count.
    expect(rejected[0].kind === 'drive_by_rejected' && rejected[0].dwelledMs)
      .toBeLessThan(DWELL_IN_MS)
  })

  it('never clocks in Alicia, parked outside the fence all day', () => {
    expect(events.get('alicia') ?? []).toHaveLength(0)
  })

  it('reports nothing at all for Bobby, who has no shift', () => {
    expect(pings.some((p) => p.workerId === 'bobby')).toBe(false)
  })
})
