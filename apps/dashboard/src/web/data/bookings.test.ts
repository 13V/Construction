import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bookCrew, bookingSummary, planBookings, removeFromJob, workingDays } from './bookings'
import { ASSIGN_MAX_DAYS, localISO } from './contract'
import type { Db } from './jobs'

/**
 * Bookings are local 07:00-15:00, as on the phone, and the website is used
 * from Adelaide. These run in Australia/Adelaide, whatever the machine
 * running them is set to, including across the end of daylight saving
 * (03:00 ACDT on Sunday 4 April 2027 becomes 02:00 ACST).
 */
// Node re-reads TZ when it is assigned. (The app's tsconfig has no Node types, hence the cast.)
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const TZ = env.TZ
beforeAll(() => {
  env.TZ = 'Australia/Adelaide'
})
afterAll(() => {
  if (TZ === undefined) delete env.TZ
  else env.TZ = TZ
})

/** Wall-clock time in Adelaide, independent of the process time zone. */
const adelaide = (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso))
    .replace(/,/g, '')

/** A scripted stand-in for supabase-js: each request is recorded and answered by `reply`. */
interface Call {
  table: string
  op: string
  payload?: unknown
  filters: Array<[string, ...unknown[]]>
}
function fakeDb(reply: (call: Call) => { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), b),
        delete: () => ((call.op = 'delete'), b),
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
          calls.push(call)
          const { data = [], error = null } = reply(call)
          return Promise.resolve({ data, error }).then(ok, bad)
        },
      }
      for (const m of ['eq', 'in', 'is', 'gte', 'lte', 'lt', 'order', 'limit', 'range']) b[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), b)
      return b
    },
  }
  return { client: client as unknown as Db, calls }
}

describe('the time zone these run in', () => {
  it('is Adelaide', () => {
    // ACDT is UTC+10:30 in January, ACST UTC+9:30 in July.
    expect(new Date(2027, 0, 15).getTimezoneOffset()).toBe(-630)
    expect(new Date(2027, 6, 15).getTimezoneOffset()).toBe(-570)
  })
})

describe('planBookings', () => {
  const base = { companyId: 'co', siteId: 's1' }

  it('books Monday to Friday and leaves weekends out', () => {
    const plan = planBookings({ ...base, workerIds: ['w1'], from: '2027-03-01', to: '2027-03-07' })
    expect(plan.days.map(localISO)).toEqual(['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05'])
    expect(plan.rows.map((r) => adelaide(r.starts_at))).toEqual(['Mon 01/03 07:00', 'Tue 02/03 07:00', 'Wed 03/03 07:00', 'Thu 04/03 07:00', 'Fri 05/03 07:00'])
    expect(planBookings({ ...base, workerIds: ['w1'], from: '2027-03-06', to: '2027-03-07' }).rows).toEqual([])
  })

  it('writes the phone row: published, no crew, 07:00-15:00', () => {
    const [row] = planBookings({ ...base, workerIds: ['w1'], from: '2027-03-01', to: '2027-03-01' }).rows
    expect(row).toEqual({ company_id: 'co', worker_id: 'w1', site_id: 's1', starts_at: '2027-02-28T20:30:00.000Z', ends_at: '2027-03-01T04:30:00.000Z', published: true })
    expect(row).not.toHaveProperty('crew_id')
  })

  it('stops at 84 working days, and says so', () => {
    const plan = planBookings({ ...base, workerIds: ['w1', 'w2'], from: '2027-01-01', to: '2027-12-31' })
    expect(plan.days).toHaveLength(ASSIGN_MAX_DAYS)
    expect(plan.rows).toHaveLength(2 * ASSIGN_MAX_DAYS)
    expect(plan.capped).toBe(true)
    // Exactly 84 working days in range is not cut short.
    const last = localISO(plan.days[ASSIGN_MAX_DAYS - 1]!)
    expect(workingDays('2027-01-01', last)).toEqual({ days: plan.days, capped: false })
    // Nor is a range whose only days past the cap are a weekend: from a
    // Tuesday, the 84th working day is a Friday.
    const fromTue = workingDays('2027-03-02', '2027-12-31')
    const friday = fromTue.days[ASSIGN_MAX_DAYS - 1]!
    expect([fromTue.capped, friday.getDay()]).toEqual([true, 5])
    const after = (n: number) => {
      const d = new Date(friday)
      d.setDate(d.getDate() + n)
      return localISO(d)
    }
    expect(workingDays('2027-03-02', after(2)).capped).toBe(false) // to the Sunday
    expect(workingDays('2027-03-02', after(3)).capped).toBe(true) // to the Monday
  })

  it('keeps 07:00-15:00 Adelaide time across the end of daylight saving (4 April 2027)', () => {
    const plan = planBookings({ ...base, workerIds: ['w1'], from: '2027-03-29', to: '2027-04-09' })
    expect(plan.rows).toHaveLength(10)
    for (const r of plan.rows) {
      expect(adelaide(r.starts_at)).toMatch(/ 07:00$/)
      expect(adelaide(r.ends_at)).toMatch(/ 15:00$/)
      expect(new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()).toBe(8 * 3_600_000)
    }
    const on = (day: string) => plan.rows.find((r) => adelaide(r.starts_at).includes(day))!
    // Friday before: ACDT, UTC+10:30. Monday after: ACST, UTC+9:30.
    expect(on('02/04')).toMatchObject({ starts_at: '2027-04-01T20:30:00.000Z', ends_at: '2027-04-02T04:30:00.000Z' })
    expect(on('05/04')).toMatchObject({ starts_at: '2027-04-04T21:30:00.000Z', ends_at: '2027-04-05T05:30:00.000Z' })
  })

  it("skips a person's day when they are already booked that local day, on any job", () => {
    const plan = planBookings({
      ...base,
      workerIds: ['w1', 'w2', 'w1'],
      from: '2027-03-01',
      to: '2027-03-05',
      // 20:30Z on the 2nd is 07:00 on Wednesday the 3rd in Adelaide: a local-day clash, not a UTC one.
      taken: [
        { worker_id: 'w1', starts_at: '2027-03-02T20:30:00.000Z' },
        { worker_id: 'w2', starts_at: '2027-03-05T12:00:00.000Z' },
      ],
    })
    expect(plan.skipped).toEqual([
      { workerId: 'w1', day: '2027-03-03' },
      { workerId: 'w2', day: '2027-03-05' },
    ])
    expect(plan.rows).toHaveLength(8)
    expect(plan.rows.some((r) => r.worker_id === 'w1' && adelaide(r.starts_at).startsWith('Wed 03/03'))).toBe(false)
  })

  it('books nothing for an empty or backwards range', () => {
    expect(planBookings({ ...base, workerIds: ['w1'], from: '2027-03-05', to: '2027-03-01' }).rows).toEqual([])
    expect(planBookings({ ...base, workerIds: ['w1'], from: 'soon', to: '2027-03-01' }).rows).toEqual([])
  })

  it('summarises a run the way the picker words it', () => {
    expect(bookingSummary(2, 5)).toBe('2 people × 5 working days = 10 bookings, 07:00-15:00, weekends left out')
    expect(bookingSummary(1, 1)).toBe('1 person × 1 working day = 1 booking, 07:00-15:00, weekends left out')
  })
})

describe('bookCrew', () => {
  const input = { companyId: 'co', siteId: 's1', workerIds: ['w1', 'w2'], from: '2027-03-01', to: '2027-03-05' }

  it('reads clashes across every job, inserts the rest published, and reads the ids back', async () => {
    const fake = fakeDb((c) =>
      c.op === 'insert'
        ? { data: (c.payload as unknown[]).map((_, i) => ({ id: `a${i}` })) }
        : { data: [{ worker_id: 'w2', starts_at: '2027-03-03T20:30:00.000Z' }] },
    )
    const out = await bookCrew(input, { client: fake.client })
    const read = fake.calls[0]!
    expect(read.table).toBe('assignments')
    expect(read.filters.map((f) => f[0])).toEqual(['in', 'gte', 'lte', 'order', 'range'])
    expect(read.filters.some((f) => f[1] === 'site_id' || f[1] === 'published')).toBe(false)
    expect(read.filters[1]).toEqual(['gte', 'starts_at', '2027-02-28T13:30:00.000Z'])
    expect(read.filters[2]).toEqual(['lte', 'starts_at', '2027-03-05T13:29:59.999Z'])
    expect(out.skipped).toEqual([{ workerId: 'w2', day: '2027-03-04' }])
    expect(out.inserted).toHaveLength(9)
    expect((fake.calls[1]!.payload as Array<{ published: boolean }>).every((r) => r.published === true)).toBe(true)
  })

  it('throws when the insert comes back short (refused), and on errors', async () => {
    const short = fakeDb((c) => (c.op === 'insert' ? { data: [{ id: 'a1' }] } : { data: [] }))
    await expect(bookCrew(input, { client: short.client })).rejects.toThrow(/refused/)
    const broken = fakeDb(() => ({ data: null, error: { message: 'boom' } }))
    await expect(bookCrew(input, { client: broken.client })).rejects.toThrow('boom')
  })

  it('inserts nothing, without error, when everyone is already booked every day', async () => {
    const days = ['2027-02-28', '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04']
    const taken = ['w1', 'w2'].flatMap((w) => days.map((d) => ({ worker_id: w, starts_at: `${d}T20:30:00.000Z` })))
    const fake = fakeDb((c) => (c.op === 'insert' ? { data: [] } : { data: taken }))
    const out = await bookCrew(input, { client: fake.client })
    expect(out.inserted).toEqual([])
    expect(out.skipped).toHaveLength(10)
    expect(fake.calls.some((c) => c.op === 'insert')).toBe(false)
  })

  it('refuses an empty pick or a range with no working days before reading anything', async () => {
    const fake = fakeDb(() => ({ data: [] }))
    await expect(bookCrew({ ...input, workerIds: [] }, { client: fake.client })).rejects.toThrow(/Nobody/)
    await expect(bookCrew({ ...input, from: '2027-03-06', to: '2027-03-07' }, { client: fake.client })).rejects.toThrow(/no working days/)
    expect(fake.calls).toEqual([])
  })
})

describe('removeFromJob', () => {
  it('deletes this person on this job from local midnight today, and checks none are left', async () => {
    const fake = fakeDb((c) => (c.op === 'delete' ? { data: [{ id: 'a1' }, { id: 'a2' }] } : { data: [] }))
    expect(await removeFromJob({ siteId: 's1', workerId: 'w1' }, { client: fake.client })).toEqual({ removed: 2 })
    const del = fake.calls[0]!
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    expect(del.filters).toEqual([
      ['eq', 'site_id', 's1'],
      ['eq', 'worker_id', 'w1'],
      ['gte', 'starts_at', t0.toISOString()],
    ])
  })

  it('throws when bookings are still there afterwards (refused)', async () => {
    const fake = fakeDb((c) => (c.op === 'delete' ? { data: [] } : { data: [{ id: 'a1' }] }))
    await expect(removeFromJob({ siteId: 's1', workerId: 'w1' }, { client: fake.client })).rejects.toThrow(/refused/)
  })
})
