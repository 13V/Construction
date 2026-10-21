import { describe, expect, it } from 'vitest'
import type { JobSite, LatLng, Ping } from '../types.js'
import { advance, DWELL_IN_MS, initialPhase, type DwellEvent, type DwellPhase } from './dwell.js'
import { offset } from './geo.js'
import {
  automaticPingTime,
  fixTime,
  manualPingTime,
  MAX_CLOCK_SKEW_MS,
  MAX_PING_AGE_MS,
  QUEUE_ARRIVING_MS,
  readDwell,
  storeDwell,
  type LastTaken,
} from './pingTime.js'

const MIN = 60_000
const HOUR = 60 * MIN

/** A wall-clock time in Adelaide on 21 October 2026 (daylight time, UTC+10:30). */
const adl = (t: string) => Date.parse(`2026-10-21T${t.length === 5 ? `${t}:00` : t}+10:30`)

const site = (id: string, center: LatLng, radiusM: number): JobSite => ({
  id,
  name: id,
  address: '',
  jobType: '',
  status: 'active',
  center,
  radiusM,
  budget: null,
  contractValue: null,
  clientName: null,
  progressPct: null,
  scheduleNote: null,
})

const LOT42 = site('lot42', { lat: -34.9285, lng: 138.6007 }, 120)
const HOME = offset(LOT42.center, 45, 9_000)
const ON_SITE = offset(LOT42.center, 90, 30)

const NOTHING: LastTaken = { lastPingAt: null, takenAt: null, queueSince: null }
/** The newest ping taken happened at `at`, and was taken live, a moment later. */
const live = (at: number): LastTaken => ({ lastPingAt: at, takenAt: at + 300, queueSince: null })
const taken = (at: number, late = false, queueSince: number | null = null) => ({ ok: true, at, late, queueSince })

describe('when a ping counts as having happened', () => {
  const now = adl('09:00')

  it('takes a live fix at its own time, and one with no time at all as now', () => {
    expect(automaticPingTime({ at: now - 20_000 }, now, NOTHING)).toEqual(taken(now - 20_000))
    expect(automaticPingTime({}, now, NOTHING)).toEqual(taken(now))
    expect(automaticPingTime({ at: 'not a time' }, now, NOTHING)).toEqual(taken(now))
    expect(automaticPingTime({ at: new Date(now - 60_000).toISOString() }, now, NOTHING)).toEqual(taken(now - 60_000))
  })

  it('takes a queued fix at the time it was taken, hours later, and marks it late', () => {
    // Walked onto a dead-spot site at 7:00; signal came back at 9:00. The
    // first fix of a queue also marks the moment the queue started arriving.
    expect(automaticPingTime({ at: adl('07:00') }, now, live(adl('06:40')))).toEqual(taken(adl('07:00'), true, now))
    // Twelve hours is the limit, and it is inclusive.
    expect(automaticPingTime({ at: now - MAX_PING_AGE_MS }, now, NOTHING)).toEqual(taken(now - MAX_PING_AGE_MS, true, now))
    expect(MAX_PING_AGE_MS).toBe(12 * HOUR)
  })

  it('drops a fix older than twelve hours instead of guessing a time for it', () => {
    expect(automaticPingTime({ at: now - MAX_PING_AGE_MS - 1 }, now, NOTHING)).toEqual({ ok: false, reason: 'too_old' })
    expect(automaticPingTime({ at: now - 3 * 24 * HOUR }, now, NOTHING)).toEqual({ ok: false, reason: 'too_old' })
  })

  it('never takes a time ahead of the server, however slightly', () => {
    expect(automaticPingTime({ at: now + 30_000 }, now, NOTHING)).toEqual(taken(now))
    expect(automaticPingTime({ at: now + MAX_CLOCK_SKEW_MS + 1 }, now, NOTHING)).toEqual(taken(now))
    expect(automaticPingTime({ at: now + 3 * HOUR }, now, NOTHING)).toEqual(taken(now))
  })

  it('drops a fix at or before the newest one already taken, so nothing can be fed in behind it', () => {
    const newest = adl('09:00:20')
    const later = adl('09:05')
    expect(automaticPingTime({ at: adl('07:30') }, later, live(newest))).toEqual({ ok: false, reason: 'out_of_order' })
    // The same fix delivered twice (a retry after a lost response) is not taken twice.
    expect(automaticPingTime({ at: newest }, later, live(newest))).toEqual({ ok: false, reason: 'out_of_order' })
    expect(automaticPingTime({ at: newest + 1 }, later, live(newest))).toEqual(taken(newest + 1))
  })

  it('measures a fix by the phone’s own clock when the phone says when it sent it', () => {
    // The phone's clock is two hours slow. The fix was taken 30 seconds
    // before it was sent, so it happened 30 seconds ago, whatever the clock says.
    const slow = now - 2 * HOUR
    expect(fixTime({ at: slow - 30_000, sentAt: slow }, now)).toBe(now - 30_000)
    expect(automaticPingTime({ at: slow - 30_000, sentAt: slow }, now, NOTHING)).toEqual(taken(now - 30_000))
    // Queued for two hours on a phone whose clock is an hour fast.
    const fast = now + HOUR
    expect(automaticPingTime({ at: fast - 2 * HOUR, sentAt: fast }, now, NOTHING)).toEqual(taken(now - 2 * HOUR, true, now))
    // A fix "taken after it was sent" is a clock that moved: it is now, not the future.
    expect(fixTime({ at: now + 10_000, sentAt: now }, now)).toBe(now)
    // ISO strings work for both.
    expect(fixTime({ at: new Date(slow - 5_000).toISOString(), sentAt: new Date(slow).toISOString() }, now)).toBe(now - 5_000)
    // Without a usable `at` there is nothing to measure.
    expect(fixTime({ sentAt: slow }, now)).toBeNull()
  })

  it('times a deliberate tap at the phone’s time only within the skew, and never before the newest ping', () => {
    expect(manualPingTime({ at: now - 2 * MIN }, now, null)).toBe(now - 2 * MIN)
    // A tap is never queued, so a time ten minutes old is a wrong clock.
    expect(manualPingTime({ at: now - 10 * MIN }, now, null)).toBe(now)
    expect(manualPingTime({ at: now + 2 * MIN }, now, null)).toBe(now)
    expect(manualPingTime({}, now, null)).toBe(now)
    // A clock-out can never land before the last ping the engine took.
    expect(manualPingTime({ at: now - 2 * MIN }, now, now - MIN)).toBe(now - MIN)
    // A phone that also sends sentAt is judged by the age of the tap, not its clock.
    expect(manualPingTime({ at: now - 3 * HOUR, sentAt: now - 3 * HOUR }, now, null)).toBe(now)
  })
})

describe('a fresh fix while the phone is still sending its queue', () => {
  // The queue started arriving at 9:00:00.2 and has got as far as 7:27; that
  // fix was taken a fifth of a second ago.
  const now = adl('09:00:20.200')
  const queueSince = adl('09:00:00.200')
  const arriving: LastTaken = { lastPingAt: adl('07:27'), takenAt: now - 200, queueSince }

  it('is dropped rather than let past the rest of the queue', () => {
    expect(automaticPingTime({ at: adl('09:00:20') }, now, arriving)).toEqual({ ok: false, reason: 'catching_up' })
    // Also from a phone whose clock runs two minutes slow.
    expect(automaticPingTime({ at: adl('08:58:20') }, now, arriving)).toEqual({ ok: false, reason: 'catching_up' })
  })

  it('does not hold up the queue itself, gaps and all', () => {
    expect(automaticPingTime({ at: adl('07:27:20') }, now, arriving)).toEqual(taken(adl('07:27:20'), true, queueSince))
    // The phone was locked from 7:27 to 8:45: an hour-long step, but taken
    // well before the queue started arriving, so part of it.
    expect(automaticPingTime({ at: adl('08:45') }, now, arriving)).toEqual(taken(adl('08:45'), true, queueSince))
    // The end of the queue, the fix taken as the signal came back.
    const nearlyDone: LastTaken = { ...arriving, lastPingAt: adl('08:59:40') }
    expect(automaticPingTime({ at: adl('09:00') }, now, nearlyDone)).toEqual(taken(adl('09:00'), false, queueSince))
  })

  it('is taken as usual once the queue has stopped arriving', () => {
    const stopped = { ...arriving, takenAt: now - QUEUE_ARRIVING_MS }
    expect(automaticPingTime({ at: adl('09:00:20') }, now, stopped)).toEqual(taken(adl('09:00:20')))
  })

  it('does not hold up live fixes when no queue is arriving', () => {
    expect(automaticPingTime({ at: adl('09:00:20') }, now, live(adl('09:00')))).toEqual(taken(adl('09:00:20')))
    expect(automaticPingTime({ at: adl('09:00:20') }, now, live(adl('08:30')))).toEqual(taken(adl('09:00:20')))
  })

  it('takes a fix that is only a step past the newest one, queue or not', () => {
    const atTheEnd: LastTaken = { ...arriving, lastPingAt: adl('09:00:00') }
    expect(automaticPingTime({ at: adl('09:00:20') }, now, atTheEnd)).toEqual(taken(adl('09:00:20'), false, queueSince))
  })
})

describe('the stored state', () => {
  it('keeps the newest ping time beside the phase and gives back the phase alone', () => {
    const phase: DwellPhase = { kind: 'onsite', siteId: 'lot42', since: adl('07:02'), lastInside: adl('08:59') }
    const stored = JSON.parse(JSON.stringify(storeDwell(phase, adl('09:00'))))
    expect(stored).toEqual({ ...phase, lastPingAt: adl('09:00') })
    expect(readDwell(stored, '2026-10-20T22:30:01.123+00:00')).toEqual({
      phase,
      lastPingAt: adl('09:00'),
      takenAt: Date.parse('2026-10-20T22:30:01.123+00:00'),
      queueSince: null,
    })
    const queued = JSON.parse(JSON.stringify(storeDwell(phase, adl('08:00'), adl('09:00'))))
    expect(readDwell(queued, null)).toMatchObject({ lastPingAt: adl('08:00'), queueSince: adl('09:00') })
  })

  it('reads a row written before lastPingAt existed with a safe floor', () => {
    // The old code stamped updated_at with the server clock and only took
    // ping times within five minutes of it.
    const written = '2026-10-20T22:30:00.123456+00:00' // 9:00:00.123 in Adelaide
    expect(readDwell({ kind: 'offsite' }, written)).toEqual({
      phase: initialPhase,
      lastPingAt: Date.parse(written) - MAX_CLOCK_SKEW_MS,
      takenAt: Date.parse(written),
      queueSince: null,
    })
    // A phase's own times are ping times, and win when they are later.
    const departing = { kind: 'departing', siteId: 'lot42', since: adl('07:02'), lastInside: adl('08:58') }
    expect(readDwell(departing, written).lastPingAt).toBe(adl('08:58'))
    expect(readDwell(null, null)).toEqual({ phase: initialPhase, lastPingAt: null, takenAt: null, queueSince: null })
    expect(readDwell(undefined, undefined)).toEqual({ phase: initialPhase, lastPingAt: null, takenAt: null, queueSince: null })
  })

  it('treats anything that is not a phase as offsite rather than crashing the engine', () => {
    expect(readDwell({}, null).phase).toEqual(initialPhase)
    expect(readDwell({ kind: 'onsite', siteId: 'lot42', since: 1 }, null).phase).toEqual(initialPhase)
    expect(readDwell({ kind: 'teleported', siteId: 'x', since: 1 }, null).phase).toEqual(initialPhase)
    expect(readDwell('onsite', null).phase).toEqual(initialPhase)
    expect(readDwell({ kind: 'arriving', siteId: 'lot42', since: 5, ambiguousWith: ['twin', 7] }, null).phase).toEqual({
      kind: 'arriving',
      siteId: 'lot42',
      since: 5,
      ambiguousWith: ['twin'],
    })
  })
})

/**
 * The server's side, the way api/ping.ts does it: each delivery is timed
 * against the newest ping already taken, then dropped or fed to the engine,
 * in the order the server receives them.
 */
class Server {
  phase: DwellPhase = initialPhase
  last: LastTaken = NOTHING
  events: DwellEvent[] = []
  dropped: Array<{ fixAt: number; reason: string }> = []
  /** False switches the queue rule off: a fresh fix is never held back. */
  holdBack: boolean
  constructor(holdBack = true) {
    this.holdBack = holdBack
  }

  receive(fixAt: number, pos: LatLng, now: number): void {
    const time = automaticPingTime({ at: fixAt }, now, this.holdBack ? this.last : { ...this.last, queueSince: null })
    if (!time.ok) {
      this.dropped.push({ fixAt, reason: time.reason })
      return
    }
    const ping: Ping = { workerId: 'w', at: time.at, lat: pos.lat, lng: pos.lng, accuracyM: 8 }
    const result = advance(this.phase, ping, [LOT42])
    this.phase = result.phase
    this.last = { lastPingAt: time.at, takenAt: now, queueSince: time.queueSince }
    this.events.push(...result.events)
  }
}

function deliver(deliveries: Array<{ fixAt: number; sentAt: number; pos: LatLng }>) {
  const server = new Server()
  for (const d of deliveries) server.receive(d.fixAt, d.pos, d.sentAt)
  return server
}

type Fix = { fixAt: number; pos: LatLng }

/** A fix every 20 seconds from `from` to `to` (inclusive), at `pos`. */
function every20s(from: number, to: number, pos: LatLng): Fix[] {
  const out: Fix[] = []
  for (let t = from; t <= to; t += 20_000) out.push({ fixAt: t, pos })
  return out
}

/**
 * The phone, as WorkerApp.tsx onFix sends: every 20 seconds it takes a fix and
 * starts a drain of [...everything queued, that fix], whether or not an
 * earlier drain is still going. A drain sends one at a time, `latency` apart;
 * when a request fails (no signal) it puts that fix and everything behind it
 * back on the queue and stops.
 */
function phone(opts: {
  queued: Fix[]
  signalAt: number
  until: number
  freshPos: (t: number) => LatLng
  latency: number
  server: Server
  /** Times with no signal: a request sent then never reaches the server. */
  offline?: (t: number) => boolean
}): Fix[] {
  let pending = [...opts.queued]
  const drains: Array<{ items: Fix[]; next: number; i: number }> = []
  let tick = opts.signalAt
  for (;;) {
    const drain = drains.filter((d) => d.i < d.items.length).sort((a, b) => a.next - b.next)[0]
    if (tick <= opts.until && (!drain || tick <= drain.next)) {
      drains.push({ items: [...pending, { fixAt: tick, pos: opts.freshPos(tick) }], next: tick, i: 0 })
      pending = []
      tick += 20_000
      continue
    }
    if (!drain) return pending
    const item = drain.items[drain.i]!
    if (opts.offline?.(drain.next)) {
      pending.push(...drain.items.slice(drain.i))
      drain.i = drain.items.length
      continue
    }
    opts.server.receive(item.fixAt, item.pos, drain.next + opts.latency)
    drain.i += 1
    drain.next += opts.latency
  }
}

describe('a phone that had no signal', () => {
  it('clocks in at 7:02 for a 7:00 arrival it could only report at 9:00', () => {
    // Driving in with signal, then two hours on a dead-spot site.
    const driving = every20s(adl('06:50'), adl('06:59:40'), HOME).map((f) => ({ ...f, sentAt: f.fixAt + 500 }))
    const queued = every20s(adl('07:00'), adl('09:00'), ON_SITE)
    // Drained oldest first from 9:00:05, a quarter of a second apart.
    const drained = queued.map((f, i) => ({ ...f, sentAt: adl('09:00:05') + i * 250 }))

    const { events, phase, dropped } = deliver([...driving, ...drained])

    const clockIns = events.filter((e) => e.kind === 'clock_in')
    expect(clockIns).toHaveLength(1)
    expect(clockIns[0]!.at).toBe(adl('07:02'))
    expect(adl('07:02') - adl('07:00')).toBe(DWELL_IN_MS)
    expect(phase).toMatchObject({ kind: 'onsite', siteId: 'lot42', since: adl('07:02'), lastInside: adl('09:00') })
    expect(dropped).toEqual([])
  })

  it('would have clocked in at about 9:02 under the old five-minute rule', () => {
    // The behaviour this replaces, kept as a record of why: every queued time
    // more than five minutes old became "now", so the dwell only started when
    // the signal came back.
    const oldRule = (fixAt: number, now: number) => (Math.abs(fixAt - now) <= MAX_CLOCK_SKEW_MS ? fixAt : now)
    let phase: DwellPhase = initialPhase
    const events: DwellEvent[] = []
    const queued = every20s(adl('07:00'), adl('09:00'), ON_SITE)
    // Sent at the pace a phone drains its queue: the sends span the dwell.
    queued.forEach((f, i) => {
      const now = adl('09:00:05') + i * 1_000
      const result = advance(phase, { workerId: 'w', at: oldRule(f.fixAt, now), lat: f.pos.lat, lng: f.pos.lng, accuracyM: 8 }, [LOT42])
      phase = result.phase
      events.push(...result.events)
    })
    const clockIn = events.find((e) => e.kind === 'clock_in')
    expect(clockIn!.at).toBeGreaterThanOrEqual(adl('09:02'))
  })

  it('clocks out at the last fix inside the fence, even when the departure was queued', () => {
    const day = [
      ...every20s(adl('07:00'), adl('15:00'), ON_SITE),
      ...every20s(adl('15:00:20'), adl('15:20'), HOME),
    ].map((f, i) => ({ ...f, sentAt: adl('15:30') + i * 200 }))
    const { events } = deliver(day)
    expect(events.filter((e) => e.kind === 'clock_in').map((e) => e.at)).toEqual([adl('07:02')])
    expect(events.filter((e) => e.kind === 'clock_out').map((e) => e.at)).toEqual([adl('15:00')])
  })

  describe('sent the way the phone sends, fresh fixes alongside the queue', () => {
    // 7:00 to 15:30 on site, the drive home, signal back at 16:00: 1,620
    // queued fixes and five minutes to send them, with a fresh fix from home
    // every 20 seconds starting a drain of its own alongside.
    const wholeDay = [...every20s(adl('07:00'), adl('15:30'), ON_SITE), ...every20s(adl('15:30:20'), adl('15:59:40'), HOME)]
    const send = (queued: Fix[], server: Server, offline?: (t: number) => boolean) =>
      phone({ queued, signalAt: adl('16:00'), until: adl('16:20'), freshPos: () => HOME, latency: 200, server, offline })

    it('records the whole day, and lets go of only fresh fixes that came while it was arriving', () => {
      const server = new Server()
      expect(send(wholeDay, server)).toEqual([])
      expect(server.events.map((e) => [e.kind, e.at])).toEqual([
        ['clock_in', adl('07:02')],
        ['clock_out', adl('15:30')],
      ])
      expect(server.dropped.length).toBeGreaterThan(0)
      // Nothing taken before the signal came back at 16:00.
      expect(server.dropped.every((d) => d.reason === 'catching_up' && d.fixAt >= adl('16:00'))).toBe(true)
      // Fresh fixes are taken again once the queue is in.
      expect(server.last.lastPingAt).toBe(adl('16:20'))
      expect(server.last.queueSince).toBeNull()
    })

    it('would have ended the day at half past seven without that', () => {
      const server = new Server(false)
      send(wholeDay, server)
      expect(server.events.find((e) => e.kind === 'clock_out')!.at).toBeLessThan(adl('08:00'))
    })

    it('keeps a queue with hours missing from it whole — the phone locked in a pocket', () => {
      const pocketed = [
        ...every20s(adl('07:00'), adl('07:05'), ON_SITE),
        ...every20s(adl('11:00'), adl('15:30'), ON_SITE),
        ...every20s(adl('15:30:20'), adl('15:40'), HOME),
      ]
      const server = new Server()
      send(pocketed, server)
      expect(server.events.map((e) => [e.kind, e.at])).toEqual([
        ['clock_in', adl('07:02')],
        ['clock_out', adl('15:30')],
      ])
      expect(server.dropped.every((d) => d.fixAt >= adl('16:00'))).toBe(true)
    })

    it('picks the queue up where it stopped when the signal drops out mid-way', () => {
      const server = new Server()
      const left = send(wholeDay, server, (t) => t >= adl('16:01') && t < adl('16:01:30'))
      expect(left).toEqual([])
      expect(server.events.map((e) => [e.kind, e.at])).toEqual([
        ['clock_in', adl('07:02')],
        ['clock_out', adl('15:30')],
      ])
      expect(server.dropped.every((d) => d.fixAt >= adl('16:00'))).toBe(true)
    })
  })

  it('cannot reopen or move a shift with a fix that arrives behind newer ones', () => {
    // Live all afternoon, clocked out at 15:00 on the way home. Then a stray
    // queued fix from 14:30, inside the fence, turns up at 15:10.
    const afternoon = [
      ...every20s(adl('12:00'), adl('15:00'), ON_SITE),
      ...every20s(adl('15:00:20'), adl('15:06'), HOME),
    ].map((f) => ({ ...f, sentAt: f.fixAt + 400 }))
    const before = deliver(afternoon)
    const after = deliver([...afternoon, { fixAt: adl('14:30'), sentAt: adl('15:10'), pos: ON_SITE }])

    expect(after.events).toEqual(before.events)
    expect(after.phase).toEqual(before.phase)
    expect(after.dropped).toEqual([{ fixAt: adl('14:30'), reason: 'out_of_order' }])

    // What the engine alone would have done with it: start a new arrival,
    // dated half an hour before the clock-out it had just made.
    const unguarded = advance(before.phase, { workerId: 'w', at: adl('14:30'), ...ON_SITE, accuracyM: 8 }, [LOT42])
    expect(unguarded.phase.kind).toBe('arriving')
  })

  it('drops the rest of a queue a fresh fix got ahead of once the queue had stalled', () => {
    // The queue stopped arriving for longer than QUEUE_ARRIVING_MS, so the
    // fresh fix is taken, and everything older than it is refused rather than
    // replayed out of order.
    const queued = every20s(adl('07:00'), adl('07:30'), ON_SITE)
    const head = queued.slice(0, 10).map((f, i) => ({ ...f, sentAt: adl('09:00') + i * 250 })) // 7:00 to 7:03
    const fresh = { fixAt: adl('09:00:40'), sentAt: adl('09:00:40') + 300, pos: ON_SITE }
    const tail = queued.slice(10).map((f, i) => ({ ...f, sentAt: fresh.sentAt + 100 + i * 250 }))

    const { events, dropped, phase } = deliver([...head, fresh, ...tail])

    expect(events.filter((e) => e.kind === 'clock_in').map((e) => e.at)).toEqual([adl('07:02')])
    expect(dropped).toHaveLength(tail.length)
    expect(dropped.every((d) => d.reason === 'out_of_order')).toBe(true)
    expect(phase).toMatchObject({ kind: 'onsite', since: adl('07:02'), lastInside: adl('09:00:40') })
  })

  it('never takes a queue that has outlived any shift it could belong to', () => {
    const yesterday = every20s(adl('07:00') - 24 * HOUR, adl('07:10') - 24 * HOUR, ON_SITE).map((f) => ({
      ...f,
      sentAt: adl('09:00'),
    }))
    const { events, dropped } = deliver(yesterday)
    expect(events).toEqual([])
    expect(dropped.every((d) => d.reason === 'too_old')).toBe(true)
  })
})
