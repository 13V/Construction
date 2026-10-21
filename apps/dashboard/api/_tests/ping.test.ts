import type { VercelRequest, VercelResponse } from '@vercel/node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { offset } from '../../src/geofence/geo.js'
import { FakeDb, FakeResponse, type Row } from './fakeDb.js'

/**
 * api/ping.ts end to end, against an in-memory database: what a phone that
 * lost signal gets recorded as, what a ping arriving behind newer ones can
 * and cannot do, and two pings for one worker deciding at the same moment.
 */

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  caller: undefined as unknown,
}))

vi.mock('../_supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_supabase.js')>()
  return { ...real, serviceClient: () => h.db, callerWorker: async () => h.caller }
})

const { default: handler } = await import('../ping.js')

/** A wall-clock time in Adelaide on 21 October 2026 (daylight time, UTC+10:30). */
const adl = (t: string) => Date.parse(`2026-10-21T${t.length === 5 ? `${t}:00` : t}+10:30`)

const SAM = { id: 'w1', company_id: 'co1', name: 'Sam', is_office: false }
const LOT42 = { id: 'lot42', company_id: 'co1', name: 'Lot 42', lat: -34.9285, lng: 138.6007, radius_m: 120, status: 'active' }
const ON_SITE = offset({ lat: LOT42.lat, lng: LOT42.lng }, 90, 30)
const HOME = offset({ lat: LOT42.lat, lng: LOT42.lng }, 45, 9_000)

let db: FakeDb

beforeEach(() => {
  db = new FakeDb()
  h.db = db
  h.caller = { ok: true, worker: SAM }
  db.seed('job_sites', LOT42)
  db.seed('channels', { id: 'ch42', site_id: 'lot42', kind: 'site' })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

interface PingReply {
  ok?: boolean
  ignored?: string
  error?: string
  notes: string[]
  phase: { kind: string; since?: number; lastInside?: number }
  events: Array<{ kind: string; at: number }>
}

/** POST /api/ping with the server's clock at `now`. */
async function ping(body: Record<string, unknown>, now: number) {
  vi.setSystemTime(now)
  const res = new FakeResponse()
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer token' }, body } as unknown as VercelRequest,
    res as unknown as VercelResponse,
  )
  return { status: res.statusCode, body: res.body as PingReply }
}

const fix = (at: number, pos = ON_SITE, extra: Record<string, unknown> = {}) => ({
  lat: pos.lat,
  lng: pos.lng,
  accuracyM: 8,
  at,
  ...extra,
})

const every20s = (from: number, to: number) => {
  const out: number[] = []
  for (let t = from; t <= to; t += 20_000) out.push(t)
  return out
}

const instant = (v: unknown) => Date.parse(String(v))
const shifts = () => db.rows('shifts')
const chat = () => db.rows('messages').map((m) => m.body)
const events = () => db.rows('geofence_events').map((e) => ({ kind: e.kind, at: instant(e.at), message: e.message }))
const state = () => db.rows('dwell_state').find((r) => r.worker_id === 'w1') as Row & { phase: Record<string, unknown> }

describe('a day with signal', () => {
  it('clocks in after the dwell and out at the last fix inside, as before', async () => {
    const times = [...every20s(adl('06:58'), adl('07:03')), adl('12:00'), adl('14:59:40'), adl('15:00')]
    for (const t of times) {
      const reply = await ping(fix(t), t + 300)
      expect(reply.status).toBe(200)
      expect(reply.body.ignored).toBeUndefined()
    }
    for (const t of every20s(adl('15:00:20'), adl('15:04'))) await ping(fix(t, HOME), t + 300)

    expect(shifts()).toHaveLength(1)
    expect(instant(shifts()[0]!.started_at)).toBe(adl('07:00'))
    expect(instant(shifts()[0]!.ended_at)).toBe(adl('15:00'))
    expect(chat()).toEqual(['Sam clocked in at Lot 42 · 7:00 am', 'Sam left Lot 42 · clocked out 3:00 pm'])
    expect(events().map((e) => e.kind)).toEqual(['clock_in', 'clock_out'])
  })
})

describe('a phone that had no signal', () => {
  it('clocks in at 7:02 for a 7:00 arrival reported at 9:00, and says it was sent late', async () => {
    for (const t of every20s(adl('06:50'), adl('06:59:40'))) await ping(fix(t, HOME), t + 300)
    const queued = every20s(adl('07:00'), adl('09:00'))
    for (const [i, t] of queued.entries()) {
      const reply = await ping(fix(t), adl('09:00:05') + i * 250)
      expect(reply.status).toBe(200)
      expect(reply.body.ignored).toBeUndefined()
    }

    expect(shifts()).toHaveLength(1)
    expect(shifts()[0]).toMatchObject({ worker_id: 'w1', site_id: 'lot42', source: 'auto' })
    expect(shifts()[0]!.ended_at ?? null).toBeNull()
    expect(instant(shifts()[0]!.started_at)).toBe(adl('07:02'))
    expect(chat()).toEqual(['Sam clocked in at Lot 42 · 7:02 am · sent 9:00 am'])
    expect(events()).toEqual([{ kind: 'clock_in', at: adl('07:02'), message: 'Sam clocked in at Lot 42 · 7:02 am · sent 9:00 am' }])
    // Every fix is kept at the time it was taken.
    expect(db.rows('positions').map((p) => instant(p.at))).toEqual([...every20s(adl('06:50'), adl('06:59:40')), ...queued])
    expect(state().phase).toMatchObject({ kind: 'onsite', since: adl('07:02'), lastInside: adl('09:00'), lastPingAt: adl('09:00') })
  })

  it('drops a fix that arrives behind a newer one, and records nothing for it', async () => {
    for (const t of every20s(adl('07:00'), adl('07:03'))) await ping(fix(t), t + 300)
    const before = structuredClone(db.tables)

    const reply = await ping(fix(adl('06:59')), adl('07:04'))

    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ ok: true, ignored: 'out_of_order', events: [], notes: [] })
    expect(reply.body.phase).toMatchObject({ kind: 'onsite', since: adl('07:02') })
    expect(reply.body.phase).not.toHaveProperty('lastPingAt')
    expect(db.tables).toEqual(before)
  })

  it('lets go of a fresh fix sent alongside a queue that is still arriving, and carries on with the queue', async () => {
    for (const [i, t] of every20s(adl('07:00'), adl('07:01:40')).entries()) await ping(fix(t), adl('09:00') + i * 250)
    const before = structuredClone(db.tables)

    const fresh = await ping(fix(adl('09:00:20')), adl('09:00:20.300'))

    expect(fresh.status).toBe(200)
    expect(fresh.body).toMatchObject({ ok: true, ignored: 'catching_up', events: [] })
    expect(db.tables).toEqual(before)
    const next = await ping(fix(adl('07:02')), adl('09:00:20.500'))
    expect(next.body.events.map((e) => e.kind)).toEqual(['clock_in'])
    expect(chat()).toEqual(['Sam clocked in at Lot 42 · 7:02 am · sent 9:00 am'])
  })

  it('drops a fix more than twelve hours old', async () => {
    const reply = await ping(fix(adl('09:00') - 12 * 3_600_000 - 1), adl('09:00'))
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ ignored: 'too_old', events: [] })
    expect(db.rows('positions')).toEqual([])
    expect(db.rows('dwell_state')).toEqual([])
  })

  it('takes a fix that claims to be from the future at the server’s time', async () => {
    await ping(fix(adl('11:00')), adl('09:00'))
    expect(db.rows('positions').map((p) => instant(p.at))).toEqual([adl('09:00')])
    expect(state().phase).toMatchObject({ kind: 'arriving', since: adl('09:00'), lastPingAt: adl('09:00') })
  })

  it('refuses a late clock-in over hours the office already entered, and says so plainly', async () => {
    db.seed('shifts', {
      id: 'by-hand',
      company_id: 'co1',
      worker_id: 'w1',
      site_id: 'lot42',
      started_at: new Date(adl('07:00')).toISOString(),
      ended_at: new Date(adl('15:30')).toISOString(),
      source: 'manual',
    })
    for (const [i, t] of every20s(adl('07:00'), adl('07:03')).entries()) await ping(fix(t), adl('16:00') + i * 250)

    expect(shifts().map((s) => s.id)).toEqual(['by-hand'])
    expect(chat()).toEqual([])
    expect(events()).toEqual([
      {
        kind: 'geofence_exception',
        at: adl('07:02'),
        message: 'Sam arrived at Lot 42 · 7:02 am · sent 4:00 pm — not clocked in: overlaps a shift already recorded',
      },
    ])
  })

  it('is not alarmed by a clock-in tap that opened the shift while the arrival was in flight', async () => {
    db.seed('shifts', {
      id: 'tapped',
      company_id: 'co1',
      worker_id: 'w1',
      site_id: 'lot42',
      started_at: new Date(adl('07:01')).toISOString(),
      ended_at: null,
      source: 'manual',
    })
    const replies = []
    for (const t of every20s(adl('07:00'), adl('07:03'))) replies.push(await ping(fix(t), t + 300))
    expect(replies.flatMap((r) => r.body.notes)).toEqual([])
    expect(shifts().map((s) => s.id)).toEqual(['tapped'])
    expect(events().map((e) => e.kind)).toEqual(['clock_in'])
  })

  it('tells the worker which it is when a clock-in is refused', async () => {
    db.seed('shifts', {
      id: 'by-hand',
      company_id: 'co1',
      worker_id: 'w1',
      site_id: 'lot42',
      started_at: new Date(adl('07:00')).toISOString(),
      ended_at: new Date(adl('15:30')).toISOString(),
      source: 'manual',
    })
    const replies = []
    for (const [i, t] of every20s(adl('07:00'), adl('07:03')).entries()) replies.push(await ping(fix(t), adl('16:00') + i * 250))
    const refused = replies.find((r) => r.body.notes.length > 0)!
    expect(refused.body.notes).toEqual([
      "Your clock-in at 7:02 am overlaps hours already on your timesheet, so it wasn't added. Tell the office if that's wrong.",
    ])
    // No celebration on the phone for a clock-in that did not happen.
    expect(refused.body.events).toEqual([])

    // A shift that never closed is a different message.
    db.rows('shifts').length = 0
    db.rows('dwell_state').length = 0
    db.rows('geofence_events').length = 0
    db.seed('shifts', {
      id: 'stranded',
      company_id: 'co1',
      worker_id: 'w1',
      site_id: 'lot42',
      started_at: new Date(adl('07:00') - 24 * 3_600_000).toISOString(),
      ended_at: null,
      source: 'auto',
    })
    const live = []
    for (const t of every20s(adl('17:00'), adl('17:03'))) live.push(await ping(fix(t), t + 300))
    const stranded = live.find((r) => r.body.notes.length > 0)!
    expect(stranded.body.notes).toEqual(['An earlier shift never closed, so this clock-in was refused. Tell the office.'])
    expect(events().map((e) => e.message)).toEqual([
      'Sam arrived at Lot 42 · 5:02 pm — not clocked in: an earlier shift is still open',
    ])
  })

  it('reads a row written before this change with a safe floor', async () => {
    db.seed('shifts', {
      id: 's1',
      company_id: 'co1',
      worker_id: 'w1',
      site_id: 'lot42',
      started_at: new Date(adl('07:02')).toISOString(),
      ended_at: null,
      source: 'auto',
    })
    db.seed('dwell_state', {
      worker_id: 'w1',
      phase: { kind: 'onsite', siteId: 'lot42', since: adl('07:02'), lastInside: adl('09:00') },
      updated_at: new Date(adl('09:00:01')).toISOString(),
    })

    expect((await ping(fix(adl('08:30')), adl('09:05'))).body.ignored).toBe('out_of_order')
    const taken = await ping(fix(adl('09:04:40')), adl('09:05'))
    expect(taken.body.ignored).toBeUndefined()
    expect(state().phase).toMatchObject({ kind: 'onsite', since: adl('07:02'), lastInside: adl('09:04:40'), lastPingAt: adl('09:04:40') })
  })

  it('answers a failed state read with an error the phone retries, not a fresh start', async () => {
    db.failing.dwell_state = { code: '08006', message: 'connection failure' }
    const reply = await ping(fix(adl('09:00')), adl('09:00'))
    expect(reply.status).toBe(500)
    expect(db.rows('positions')).toEqual([])
    expect(shifts()).toEqual([])
  })
})

describe('two pings for one worker at the same moment', () => {
  /** Arriving at Lot 42 since 8:58, live; the newest fix is 8:59:40. */
  async function arriving() {
    for (const t of every20s(adl('08:58'), adl('08:59:40'))) await ping(fix(t), t + 300)
    expect(state().phase).toMatchObject({ kind: 'arriving', since: adl('08:58') })
  }

  /** Runs `other` to completion just before the next dwell_state write lands. */
  function beforeNextStateWrite(other: () => Promise<unknown>) {
    let done = false
    db.before = async (s) => {
      if (!done && s.table === 'dwell_state' && s.kind === 'update') {
        done = true
        await other()
      }
    }
  }

  it('the later fix decides first: the earlier one is dropped, and there is one clock-in', async () => {
    await arriving()
    let later: Awaited<ReturnType<typeof ping>> | undefined
    beforeNextStateWrite(async () => {
      later = await ping(fix(adl('09:00:20')), adl('09:00:20.300'))
    })
    const earlier = await ping(fix(adl('09:00')), adl('09:00:00.300'))

    expect(later!.body.events.map((e) => e.kind)).toEqual(['clock_in'])
    expect(earlier.status).toBe(200)
    expect(earlier.body.ignored).toBe('out_of_order')
    expect(shifts()).toHaveLength(1)
    expect(instant(shifts()[0]!.started_at)).toBe(adl('09:00:20'))
    expect(chat()).toHaveLength(1)
    expect(state().phase).toMatchObject({ kind: 'onsite', since: adl('09:00:20'), lastPingAt: adl('09:00:20') })
  })

  it('the earlier fix decides first: the later one carries on from it, and there is one clock-in', async () => {
    await arriving()
    let earlier: Awaited<ReturnType<typeof ping>> | undefined
    beforeNextStateWrite(async () => {
      earlier = await ping(fix(adl('09:00')), adl('09:00:20.400'))
    })
    const later = await ping(fix(adl('09:00:20')), adl('09:00:20.300'))

    expect(earlier!.body.events.map((e) => e.kind)).toEqual(['clock_in'])
    expect(later.status).toBe(200)
    expect(later.body.ignored).toBeUndefined()
    expect(later.body.events).toEqual([])
    expect(later.body.phase).toMatchObject({ kind: 'onsite', since: adl('09:00'), lastInside: adl('09:00:20') })
    expect(shifts()).toHaveLength(1)
    expect(instant(shifts()[0]!.started_at)).toBe(adl('09:00'))
    expect(chat()).toHaveLength(1)
    expect(state().phase).toMatchObject({ lastPingAt: adl('09:00:20') })
  })

  it('gives up with an error the phone retries if the state keeps changing underneath', async () => {
    await arriving()
    let n = 0
    db.before = async (s) => {
      // Another writer gets in before every one of this ping's attempts.
      if (s.table === 'dwell_state' && s.kind === 'update') {
        const row = state()
        row.updated_at = new Date(adl('09:01') + ++n).toISOString()
      }
    }
    const reply = await ping(fix(adl('09:00')), adl('09:00:00.300'))
    expect(reply.status).toBe(503)
    expect(shifts()).toEqual([])
  })
})

describe('the buttons', () => {
  it('never time a clock-in before the newest ping, and late fixes cannot land behind it', async () => {
    // Arriving since 8:58:30, not yet two minutes in; the newest fix is 8:59:50.
    for (const t of every20s(adl('08:58:30'), adl('08:59:50'))) await ping(fix(t), t + 300)
    expect(state().phase).toMatchObject({ kind: 'arriving', lastPingAt: adl('08:59:50') })
    // A phone clock three and a half minutes slow: within the skew, but
    // before the 8:59:50 fix the engine has already taken.
    const tapped = await ping(fix(adl('08:56:30'), ON_SITE, { manual: true }), adl('09:00:00'))
    expect(tapped.status).toBe(200)
    expect(instant(shifts()[0]!.started_at)).toBe(adl('08:59:50'))
    expect(state().phase).toMatchObject({ kind: 'onsite', since: adl('08:59:50'), lastPingAt: adl('08:59:50') })

    const late = await ping(fix(adl('08:59:40')), adl('09:01'))
    expect(late.body.ignored).toBe('out_of_order')
    expect(shifts()).toHaveLength(1)
  })

  it('time a clock-out from a phone whose clock is slow by the server', async () => {
    for (const [i, t] of every20s(adl('07:00'), adl('07:03')).entries()) await ping(fix(t), adl('09:00') + i * 250)
    for (const t of every20s(adl('13:59'), adl('14:00'))) await ping(fix(t), t + 300)

    const tapped = await ping(fix(adl('13:45'), HOME, { manualOut: true }), adl('14:00:30'))

    expect(tapped.status).toBe(200)
    expect(instant(shifts()[0]!.ended_at)).toBe(adl('14:00:30'))
    expect(chat().at(-1)).toBe('Sam clocked out of Lot 42 · 2:00 pm · manual')
    expect(state().phase).toEqual({ kind: 'offsite', lastPingAt: adl('14:00:30') })
    // And the queue cannot reopen it afterwards.
    expect((await ping(fix(adl('13:50')), adl('14:01'))).body.ignored).toBe('out_of_order')
  })

  it('never close a shift before its own start, even one the old rule dated a few minutes ahead', async () => {
    db.seed('shifts', {
      id: 'ahead',
      company_id: 'co1',
      worker_id: 'w1',
      site_id: 'lot42',
      started_at: new Date(adl('09:04')).toISOString(),
      ended_at: null,
      source: 'auto',
    })
    const tapped = await ping(fix(adl('09:01'), ON_SITE, { manualOut: true }), adl('09:01'))
    expect(tapped.status).toBe(200)
    expect(instant(shifts()[0]!.ended_at)).toBe(adl('09:04'))
    expect(tapped.body.events).toMatchObject([{ kind: 'clock_out', at: adl('09:04') }])
  })
})

describe('who may ping', () => {
  it('passes a refusal from callerWorker straight back, before touching anything', async () => {
    const { REMOVED_FROM_CREW } = await import('../_supabase.js')
    h.caller = { ok: false, status: 403, body: { error: REMOVED_FROM_CREW, removed: true } }
    const reply = await ping(fix(adl('09:00')), adl('09:00'))
    expect(reply.status).toBe(403)
    expect(reply.body).toEqual({
      error: "You've been taken off this company's crew. Ask the office if that's a mistake.",
      removed: true,
    })
    expect(db.log).toEqual([])
  })
})
