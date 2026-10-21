import type { VercelRequest, VercelResponse } from '@vercel/node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { siteDay } from '../_siteTime.js'
import { FakeDb, FakeResponse } from './fakeDb.js'

/**
 * The daily log counts the crew's day, Adelaide midnight to Adelaide
 * midnight — not UTC's, which in daylight time runs 10:30 am to 10:30 am and
 * filed a 7 am start under the day before.
 */

const HOUR = 3_600_000
const iso = (d: Date | undefined) => d?.toISOString()

describe('siteDay', () => {
  it('is Adelaide midnight to midnight in daylight time (UTC+10:30)', () => {
    const day = siteDay('2026-10-21')!
    expect(iso(day.start)).toBe('2026-10-20T13:30:00.000Z')
    expect(iso(day.end)).toBe('2026-10-21T13:30:00.000Z')
  })

  it('is Adelaide midnight to midnight in standard time (UTC+9:30)', () => {
    const day = siteDay('2026-06-15')!
    expect(iso(day.start)).toBe('2026-06-14T14:30:00.000Z')
    expect(iso(day.end)).toBe('2026-06-15T14:30:00.000Z')
  })

  it('is 23 hours long on the first Sunday of October, when the clocks go forward', () => {
    const day = siteDay('2026-10-04')!
    expect(iso(day.start)).toBe('2026-10-03T14:30:00.000Z')
    expect(iso(day.end)).toBe('2026-10-04T13:30:00.000Z')
    expect(day.end.getTime() - day.start.getTime()).toBe(23 * HOUR)
  })

  it('is 25 hours long on the first Sunday of April, when they go back', () => {
    const day = siteDay('2026-04-05')!
    expect(iso(day.start)).toBe('2026-04-04T13:30:00.000Z')
    expect(iso(day.end)).toBe('2026-04-05T14:30:00.000Z')
    expect(day.end.getTime() - day.start.getTime()).toBe(25 * HOUR)
  })

  it('runs every day of a year end to end, with no gaps and no overlaps', () => {
    let previous = siteDay('2026-01-01')!
    for (let d = new Date(Date.UTC(2026, 0, 2)); d.getUTCFullYear() < 2028; d = new Date(d.getTime() + 24 * HOUR)) {
      const day = siteDay(d.toISOString().slice(0, 10))!
      expect(day.start.getTime()).toBe(previous.end.getTime())
      expect([23 * HOUR, 24 * HOUR, 25 * HOUR]).toContain(day.end.getTime() - day.start.getTime())
      previous = day
    }
    expect(iso(siteDay('2026-12-31')!.end)).toBe('2026-12-31T13:30:00.000Z')
  })

  it('puts a 7 am start on its own day, which the UTC window did not', () => {
    const sevenAm = Date.parse('2026-10-21T07:00:00+10:30')
    const day = siteDay('2026-10-21')!
    expect(sevenAm >= day.start.getTime() && sevenAm < day.end.getTime()).toBe(true)
    const utcStart = Date.parse('2026-10-21T00:00:00Z')
    expect(sevenAm >= utcStart).toBe(false)
  })

  it('refuses anything that is not a real date', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '26-10-21', '2026-10-21T00:00', '', '0099-01-01']) {
      expect(siteDay(bad)).toBeNull()
    }
    expect(siteDay('2028-02-29')).not.toBeNull()
  })
})

// ------------------------------------------------------------- the handler

const h = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('../_supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_supabase.js')>()
  return {
    ...real,
    serviceClient: () => h.db,
    callerWorker: async () => ({ ok: true, worker: { id: 'w1', company_id: 'co1', name: 'Sam', is_office: false } }),
  }
})

const { default: draftLog } = await import('../draft-log.js')

describe('POST /api/draft-log', () => {
  let db: FakeDb
  beforeEach(() => {
    db = new FakeDb()
    h.db = db
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    db.seed('job_sites', { id: 'lot42', name: 'Lot 42', company_id: 'co1' })
    const shift = (worker: string, name: string, start: string, end: string) => ({
      company_id: 'co1',
      site_id: 'lot42',
      worker_id: worker,
      started_at: new Date(Date.parse(start)).toISOString(),
      ended_at: new Date(Date.parse(end)).toISOString(),
      workers: { name },
    })
    db.seed(
      'shifts',
      // The crew's day, 7 am to 3 pm.
      shift('w1', 'Sam', '2026-10-21T07:00:00+10:30', '2026-10-21T15:00:00+10:30'),
      shift('w2', 'Alex', '2026-10-21T07:30:00+10:30', '2026-10-21T11:30:00+10:30'),
      // The evenings either side belong to their own days.
      shift('w3', 'Kim', '2026-10-20T22:00:00+10:30', '2026-10-20T23:00:00+10:30'),
      shift('w3', 'Kim', '2026-10-22T06:00:00+10:30', '2026-10-22T08:00:00+10:30'),
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function post(body: unknown) {
    const res = new FakeResponse()
    await draftLog(
      { method: 'POST', headers: { authorization: 'Bearer token' }, body } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    )
    return res
  }

  it('counts the shifts that started on the crew’s day, by Adelaide midnight', async () => {
    const res = await post({ siteId: 'lot42', date: '2026-10-21' })
    expect(res.statusCode).toBe(200)
    const row = (res.body as { row: Record<string, unknown> }).row
    expect(row.work_completed).toBe('2 crew on site, 12 hours total.')
    expect(row.crew_summary).toEqual([
      { name: 'Sam', hours: 8 },
      { name: 'Alex', hours: 4 },
    ])

    const shiftsRead = db.log.find((s) => s.table === 'shifts' && s.kind === 'select')!
    expect(shiftsRead.filters).toContainEqual({ col: 'started_at', op: 'gte', value: '2026-10-20T13:30:00.000Z' })
    expect(shiftsRead.filters).toContainEqual({ col: 'started_at', op: 'lt', value: '2026-10-21T13:30:00.000Z' })
    const photosRead = db.log.find((s) => s.table === 'site_files')!
    expect(photosRead.filters).toContainEqual({ col: 'created_at', op: 'gte', value: '2026-10-20T13:30:00.000Z' })
  })

  it('refuses a date that does not exist instead of failing on it', async () => {
    const res = await post({ siteId: 'lot42', date: '2026-02-30' })
    expect(res.statusCode).toBe(400)
  })
})
