import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JOB_COLOURS, type JobSiteRow } from '../phone'
import { PHONE_BLANKS, PHONE_INSERT_KEYS, RADIUS_MAX, RADIUS_MIN } from './contract'
import {
  buildJobInsert,
  createJob,
  JobInputError,
  jobPatch,
  peekCreateIssues,
  retryCreateIssue,
  retryIssue,
  setStatus,
  stashCreateIssues,
  takeCreateIssues,
  updateJob,
  type CreateIssue,
  type Db,
  type JobDraft,
} from './jobs'

// ------------------------------------------------------------ a fake Supabase

/**
 * Just enough of supabase-js for the data layer: a query records what was
 * asked and an in-memory table answers it, with RLS-style refusals and
 * errors injected per test. Every request is kept in `calls`, so a test can
 * say what was (and was not) sent.
 */
interface Call {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  payload?: unknown
  cols?: string
  filters: Array<[string, ...unknown[]]>
  single?: 'single' | 'maybe'
}
type Row = Record<string, unknown>
type Outcome = { data?: Row[] | null; error?: { message: string } | null }

function fakeDb(seed: Record<string, Row[]> = {}, intercept?: (call: Call) => Outcome | undefined) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  const calls: Call[] = []
  let n = 0
  const unlike = (p: string) => p.replace(/\\(.)/g, '$1').toLowerCase()
  const matches = (row: Row, [m, col, val]: [string, ...unknown[]]) => {
    const v = row[col as string]
    switch (m) {
      case 'eq':
        return v === val
      case 'neq':
        return v !== val
      case 'is':
        return v === val || (val === null && v === undefined)
      case 'in':
        return (val as unknown[]).includes(v)
      case 'ilike':
        return String(v ?? '').toLowerCase() === unlike(String(val))
      case 'gte':
        return String(v) >= String(val)
      case 'lte':
        return String(v) <= String(val)
      case 'lt':
        return String(v) < String(val)
      case 'gt':
        return String(v) > String(val)
      default:
        return true
    }
  }
  const answer = (call: Call): Outcome => {
    const hit = intercept?.(call)
    if (hit) return hit
    const t = (tables[call.table] ??= [])
    const where = (r: Row) => call.filters.every((f) => matches(r, f))
    if (call.op === 'insert') {
      const list = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[]
      const made = list.map((r) => ({ id: `${call.table}-${++n}`, created_at: `2026-10-15T00:00:${String(n).padStart(2, '0')}Z`, ...r }))
      t.push(...made)
      return { data: made }
    }
    if (call.op === 'update') {
      const hit = t.filter(where)
      for (const r of hit) Object.assign(r, call.payload)
      return { data: hit }
    }
    if (call.op === 'delete') {
      const gone = t.filter(where)
      tables[call.table] = t.filter((r) => !where(r))
      return { data: gone }
    }
    const range = call.filters.find((f) => f[0] === 'range')
    const rows = t.filter(where)
    return { data: range ? rows.slice(range[1] as number, (range[2] as number) + 1) : rows }
  }
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const b: Record<string, unknown> = {
        select: (cols?: string) => ((call.cols = cols ?? '*'), b),
        insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), b),
        update: (p: unknown) => ((call.op = 'update'), (call.payload = p), b),
        delete: () => ((call.op = 'delete'), b),
        single: () => ((call.single = 'single'), b),
        maybeSingle: () => ((call.single = 'maybe'), b),
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
          calls.push(call)
          const { data = [], error = null } = answer(call)
          let out: { data: unknown; error: unknown } = { data, error }
          if (!error && call.single) {
            const rows = data ?? []
            if (call.single === 'maybe') out = { data: rows[0] ?? null, error: null }
            else out = rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
          }
          return Promise.resolve(out).then(ok, bad)
        },
      }
      for (const m of ['eq', 'neq', 'in', 'is', 'ilike', 'gte', 'gt', 'lte', 'lt', 'order', 'limit', 'range', 'or', 'not']) {
        b[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), b)
      }
      return b
    },
  }
  return { client: client as unknown as Db, calls, tables }
}

const ME = { company_id: 'co-1' }
const DRAFT: JobDraft = { name: 'ZZ Maple Ridge', colour: '#5C8A63', fence: { lat: -34.98, lng: 138.46, radiusM: 80 } }
const site = (over: Partial<JobSiteRow> = {}): JobSiteRow => ({
  id: 'site-1',
  company_id: 'co-1',
  name: 'Seacombe gardens',
  address: '2 brigalow Ave',
  job_type: 'Bathrooms',
  status: 'starting_soon',
  lat: -35.0284,
  lng: 138.5425,
  radius_m: 150,
  budget: null,
  client_name: 'Paramoint',
  progress_pct: null,
  schedule_note: null,
  contract_value: null,
  captain_id: null,
  supervisor_contact_id: null,
  builder_id: null,
  starts_on: '2026-09-15',
  ends_on: '2026-09-30',
  colour: null,
  ...over,
})

// --------------------------------------------------------------- the insert

describe('buildJobInsert', () => {
  it("carries every key the phone's New project sheet sends", () => {
    const row = buildJobInsert('co-1', DRAFT)
    for (const k of PHONE_INSERT_KEYS) expect(row).toHaveProperty(k)
  })

  it("writes the phone's blanks: '' for address and work, null for no builder, Future", () => {
    const row = buildJobInsert('co-1', { ...DRAFT, address: '  ', workType: undefined, builderName: ' ' })
    expect({ address: row.address, job_type: row.job_type, client_name: row.client_name }).toEqual(PHONE_BLANKS)
    expect(row.status).toBe('starting_soon')
    expect(buildJobInsert('co-1', { ...DRAFT, address: null, workType: null }).address).toBe('')
    expect(buildJobInsert('co-1', { ...DRAFT, address: null, workType: null }).job_type).toBe('')
  })

  it('trims what is typed and sends the company explicitly', () => {
    const row = buildJobInsert('co-1', { ...DRAFT, name: '  Job  ', address: ' 1 Moseley Sq ', workType: ' Bathrooms ', builderName: ' Paramoint ' })
    expect(row).toMatchObject({ company_id: 'co-1', name: 'Job', address: '1 Moseley Sq', job_type: 'Bathrooms', client_name: 'Paramoint' })
  })

  it("takes client_name from the builder record, character for character", () => {
    const row = buildJobInsert('co-1', { ...DRAFT, builderName: 'paramoint' }, { id: 'b-1', name: 'Paramoint' })
    expect(row).toMatchObject({ builder_id: 'b-1', client_name: 'Paramoint' })
  })

  it('rejects a fence radius outside 25-600 or not whole metres', () => {
    for (const radiusM of [0, RADIUS_MIN - 1, RADIUS_MAX + 1, 2000, 80.5, Number.NaN]) {
      expect(() => buildJobInsert('co-1', { ...DRAFT, fence: { ...DRAFT.fence, radiusM } })).toThrow(JobInputError)
    }
    expect(buildJobInsert('co-1', { ...DRAFT, fence: { ...DRAFT.fence, radiusM: RADIUS_MIN } }).radius_m).toBe(25)
    expect(buildJobInsert('co-1', { ...DRAFT, fence: { ...DRAFT.fence, radiusM: RADIUS_MAX } }).radius_m).toBe(600)
  })

  it('rejects colours outside JOB_COLOURS, and writes the swatch as the phone spells it', () => {
    for (const colour of ['#000000', '', 'green', '#5C8A6']) {
      expect(() => buildJobInsert('co-1', { ...DRAFT, colour })).toThrow(JobInputError)
    }
    for (const c of JOB_COLOURS) expect(buildJobInsert('co-1', { ...DRAFT, colour: c.toLowerCase() }).colour).toBe(c)
  })

  it('rejects a blank name, an unplaced fence, bad dates and an end before the start', () => {
    expect(() => buildJobInsert('co-1', { ...DRAFT, name: '  ' })).toThrow(/needs a name/)
    expect(() => buildJobInsert('co-1', { ...DRAFT, fence: { lat: Number.NaN, lng: 138, radiusM: 80 } })).toThrow(JobInputError)
    expect(() => buildJobInsert('co-1', { ...DRAFT, startsOn: '2027-02-30' })).toThrow(/YYYY-MM-DD/)
    expect(() => buildJobInsert('co-1', { ...DRAFT, startsOn: '1/3/2027' })).toThrow(/YYYY-MM-DD/)
    expect(() => buildJobInsert('co-1', { ...DRAFT, startsOn: '2027-03-12', endsOn: '2027-03-01' })).toThrow(/before the start/)
    expect(buildJobInsert('co-1', { ...DRAFT, startsOn: '2027-03-01', endsOn: '' })).toMatchObject({ starts_on: '2027-03-01', ends_on: null })
  })

  it('never writes what the phone never writes', () => {
    const row = buildJobInsert('co-1', { ...DRAFT, status: 'active', captainId: 'w-9', startsOn: '2027-03-01', endsOn: '2027-03-12' })
    for (const k of ['id', 'schedule_note', 'budget', 'progress_pct', 'contract_value', 'builder_job_ref', 'supervisor_contact_id']) expect(row).not.toHaveProperty(k)
    expect(row).toMatchObject({ status: 'active', captain_id: 'w-9' })
    expect(() => buildJobInsert('co-1', { ...DRAFT, status: 'archived' as 'active' })).toThrow(JobInputError)
  })
})

// --------------------------------------------------------------- createJob

describe('createJob', () => {
  const input = {
    ...DRAFT,
    builderName: 'ZZ Builder',
    captainId: 'w-cap',
    startsOn: '2027-03-01',
    endsOn: '2027-03-05',
    contacts: {
      supervisor: { name: 'ZZ Sup', mobile: '0400 000 000', email: 'sup@example.invalid' },
      project_manager: { name: 'ZZ PM' },
      contract_admin: { name: '  ' },
    },
    crew: { workerIds: ['w-1', 'w-2'], from: '2027-03-01', to: '2027-03-05' },
  }

  it('makes the builder, the job, the contacts, the supervisor link and the bookings, in that order', async () => {
    const fake = fakeDb()
    const out = await createJob(ME, input, { client: fake.client })
    expect(out.issues).toEqual([])
    expect(out.site).not.toBeNull()
    const steps = fake.calls.map((c) => `${c.op} ${c.table}`)
    expect(steps).toEqual([
      'select builders',
      'insert builders',
      'insert job_sites',
      'select builder_contacts',
      'insert builder_contacts',
      'select builder_contacts',
      'insert builder_contacts',
      'update job_sites',
      'select assignments',
      'insert assignments',
    ])
    const job = fake.tables.job_sites![0]!
    expect(job).toMatchObject({ ...buildJobInsert('co-1', input, { id: out.builder!.id, name: 'ZZ Builder' }), supervisor_contact_id: out.contacts.supervisor!.id })
    expect(fake.tables.builders).toEqual([expect.objectContaining({ company_id: 'co-1', name: 'ZZ Builder' })])
    expect(Object.keys(fake.calls.find((c) => c.op === 'insert' && c.table === 'builders')!.payload as Row).sort()).toEqual(['company_id', 'name'])
    expect(fake.tables.builder_contacts!.map((c) => [c.role, c.name, c.mobile, c.email])).toEqual([
      ['project_manager', 'ZZ PM', null, null],
      ['supervisor', 'ZZ Sup', '0400 000 000', 'sup@example.invalid'],
    ])
    expect(fake.tables.assignments).toHaveLength(10)
    expect(out.booking).toMatchObject({ days: 5, skipped: [] })
    // Never a channel (the trigger makes it), never a delete.
    expect(fake.calls.some((c) => c.table === 'channels')).toBe(false)
    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('reuses a builder of the same name, whatever the case, and its people', async () => {
    const fake = fakeDb({
      builders: [
        { id: 'b-new', name: 'ZZ Builder', created_at: '2026-10-02T00:00:00Z' },
        { id: 'b-old', name: 'zz builder', created_at: '2026-01-01T00:00:00Z' },
      ],
      builder_contacts: [{ id: 'c-1', builder_id: 'b-old', role: 'supervisor', name: 'zz sup', mobile: null, email: null, note: null }],
    })
    // The fake returns rows in table order; findOrCreateBuilder asks for oldest first.
    fake.tables.builders!.reverse()
    const out = await createJob(ME, { ...input, builderName: 'zz BUILDER', crew: null }, { client: fake.client })
    expect(out.issues).toEqual([])
    expect(out.builder).toEqual({ id: 'b-old', name: 'zz builder', created: false })
    expect(fake.calls.some((c) => c.op === 'insert' && c.table === 'builders')).toBe(false)
    expect(fake.tables.job_sites![0]).toMatchObject({ builder_id: 'b-old', client_name: 'zz builder', supervisor_contact_id: 'c-1' })
    expect(fake.tables.builder_contacts!.filter((c) => c.role === 'supervisor')).toHaveLength(1)
    // The same person: the spelling on file stays, and what was typed is added.
    expect(fake.tables.builder_contacts!.find((c) => c.id === 'c-1')).toMatchObject({ name: 'zz sup', mobile: '0400 000 000', email: 'sup@example.invalid' })
  })

  it("never wipes a known person's number when their name is typed again on another job", async () => {
    const sam = { id: 'c-sam', builder_id: 'b-1', role: 'supervisor', name: 'ZZ Sam Taylor', mobile: '0400 111 222', email: 'sam@example.invalid', note: null }
    const fake = fakeDb({ builders: [{ id: 'b-1', name: 'ZZ Builder', created_at: '2026-01-01T00:00:00Z' }], builder_contacts: [{ ...sam }] })
    const out = await createJob(ME, { ...DRAFT, builderName: 'ZZ Builder', contacts: { supervisor: { name: 'zz sam   taylor' } } }, { client: fake.client })
    expect(out.issues).toEqual([])
    expect(fake.tables.builder_contacts).toEqual([sam])
    expect(fake.calls.some((c) => c.table === 'builder_contacts' && c.op !== 'select')).toBe(false)
    expect(out.contacts.supervisor).toEqual(sam)
    expect(fake.tables.job_sites![0]).toMatchObject({ supervisor_contact_id: 'c-sam' })
    // A new number for the same person is added; the email on file stays.
    const again = await createJob(ME, { ...DRAFT, builderName: 'ZZ Builder', contacts: { supervisor: { name: 'ZZ SAM TAYLOR', mobile: '0499 999 999', email: ' ' } } }, { client: fake.client })
    expect(again.issues).toEqual([])
    expect(fake.calls.filter((c) => c.table === 'builder_contacts' && c.op === 'update').map((c) => c.payload)).toEqual([{ mobile: '0499 999 999' }])
    expect(fake.tables.builder_contacts).toEqual([{ ...sam, mobile: '0499 999 999' }])
  })

  it('never adds a second project manager or contract administrator the phone would not show; it says who is on file', async () => {
    const pm1 = { id: 'c-pm1', builder_id: 'b-1', role: 'project_manager', name: 'ZZ PM One', mobile: '0411 111 111', email: null, note: null, created_at: '2026-01-01T00:00:00Z' }
    const ca1 = { id: 'c-ca1', builder_id: 'b-1', role: 'contract_admin', name: 'ZZ CA One', mobile: null, email: 'ca@example.invalid', note: null, created_at: '2026-01-01T00:00:01Z' }
    const fake = fakeDb({ builders: [{ id: 'b-1', name: 'ZZ Builder', created_at: '2026-01-01T00:00:00Z' }], builder_contacts: [{ ...pm1 }, { ...ca1 }] })
    const out = await createJob(
      ME,
      { ...DRAFT, builderName: 'zz builder', contacts: { project_manager: { name: 'ZZ PM Two', mobile: '0422 222 222' }, contract_admin: { name: 'zz ca one' }, supervisor: { name: 'ZZ Sup Two' } } },
      { client: fake.client },
    )
    expect(out.site).not.toBeNull()
    // Nothing written for the PM, the CA was already on file, the supervisor (one per job) added.
    expect(fake.tables.builder_contacts!.filter((c) => c.role === 'project_manager')).toEqual([pm1])
    expect(fake.tables.builder_contacts!.filter((c) => c.role === 'contract_admin')).toEqual([ca1])
    expect(fake.tables.builder_contacts!.filter((c) => c.role === 'supervisor').map((c) => c.name)).toEqual(['ZZ Sup Two'])
    expect(out.contacts.project_manager).toBeUndefined()
    expect(out.issues).toEqual([
      {
        step: 'contact',
        role: 'project_manager',
        builderId: 'b-1',
        draft: { id: 'c-pm1', name: 'ZZ PM Two', mobile: '0422 222 222' },
        message: 'Not saved: ZZ PM One is the project manager for ZZ Builder, on every job for them. Retry to make ZZ PM Two the project manager on every job for ZZ Builder instead.',
      },
    ])
    // Retrying the issue (as stashed: JSON) replaces PM One in place, so there is still one PM.
    const [issue] = JSON.parse(JSON.stringify(out.issues)) as CreateIssue[]
    expect(await retryCreateIssue(ME, out.site!, issue!, { client: fake.client })).toEqual([])
    expect(fake.tables.builder_contacts!.filter((c) => c.role === 'project_manager')).toEqual([{ ...pm1, name: 'ZZ PM Two', mobile: '0422 222 222', email: null }])
  })

  it('keeps the job when the contacts are refused, and says which ones', async () => {
    const fake = fakeDb({}, (c) => (c.table === 'builder_contacts' && c.op === 'insert' ? { data: null, error: { message: 'permission denied for table builder_contacts' } } : undefined))
    const out = await createJob(ME, input, { client: fake.client })
    expect(out.site?.id).toBeTruthy()
    expect(fake.tables.job_sites).toHaveLength(1)
    expect(out.issues.map((i) => [i.step, i.step === 'contact' ? i.role : '', i.message])).toEqual([
      ['contact', 'project_manager', 'permission denied for table builder_contacts'],
      ['contact', 'supervisor', 'permission denied for table builder_contacts'],
    ])
    // No supervisor link without a supervisor, the crew still booked, nothing undone.
    expect(fake.calls.filter((c) => c.op === 'update' && c.table === 'job_sites')).toHaveLength(0)
    expect(fake.tables.assignments).toHaveLength(10)
    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('reports a refused supervisor link (no row back) as its own issue', async () => {
    const fake = fakeDb({}, (c) => (c.table === 'job_sites' && c.op === 'update' ? { data: [] } : undefined))
    const out = await createJob(ME, { ...input, crew: null }, { client: fake.client })
    expect(out.issues).toEqual([expect.objectContaining({ step: 'supervisor', contactId: out.contacts.supervisor!.id, message: expect.stringMatching(/refused/) })])
  })

  it('stops at the job when the job is refused, having tried nothing after it', async () => {
    const fake = fakeDb({}, (c) => (c.table === 'job_sites' && c.op === 'insert' ? { data: null, error: { message: 'new row violates row-level security policy' } } : undefined))
    const out = await createJob(ME, input, { client: fake.client })
    expect(out.site).toBeNull()
    expect(out.issues).toEqual([{ step: 'job', message: 'new row violates row-level security policy' }])
    expect(fake.calls.map((c) => c.table)).toEqual(['builders', 'builders', 'job_sites'])
  })

  it('still makes the job when the builder cannot be saved, with the name as typed', async () => {
    const fake = fakeDb({}, (c) => (c.table === 'builders' ? { data: null, error: { message: 'builders is down' } } : undefined))
    const out = await createJob(ME, { ...input, crew: null }, { client: fake.client })
    expect(out.site).toMatchObject({ builder_id: null, client_name: 'ZZ Builder' })
    expect(out.issues.map((i) => i.step)).toEqual(['builder', 'contact', 'contact'])
  })

  it('checks the input before writing anything', async () => {
    const fake = fakeDb()
    await expect(createJob(ME, { ...input, colour: '#123456' }, { client: fake.client })).rejects.toThrow(JobInputError)
    await expect(createJob(ME, { ...input, crew: { workerIds: ['w-1'], from: '2027-03-05', to: '2027-03-01' } }, { client: fake.client })).rejects.toThrow(JobInputError)
    expect(fake.calls).toEqual([])
  })

  it("retries a project manager issue whose PM was removed since (P4): adds the one typed, and says so", async () => {
    const pm1 = { id: 'c-pm1', builder_id: 'b-1', role: 'project_manager', name: 'ZZ PM One', mobile: null, email: null, note: null }
    const job = site({ id: 's-4', builder_id: 'b-1', client_name: 'ZZ Builder' })
    const issue: CreateIssue = { step: 'contact', role: 'project_manager', builderId: 'b-1', draft: { id: 'c-pm1', name: 'ZZ PM Two', mobile: '0422 222 222' }, message: 'x' }
    // PM One blanked on a phone: the builder has no PM.
    const fake = fakeDb({ job_sites: [{ ...job }], builder_contacts: [] })
    expect(await retryIssue(ME, job, issue, { client: fake.client })).toEqual({
      left: [],
      note: 'The project manager this was to replace is no longer on file, so ZZ PM Two was added as the project manager.',
    })
    expect(fake.tables.builder_contacts).toEqual([expect.objectContaining({ builder_id: 'b-1', role: 'project_manager', name: 'ZZ PM Two', mobile: '0422 222 222' })])
    // ...and somebody else made PM since: a fresh issue naming them, carrying their id, saying what happened.
    const pm3 = { ...pm1, id: 'c-pm3', name: 'ZZ PM Three' }
    const again = fakeDb({ job_sites: [{ ...job }], builder_contacts: [{ ...pm3 }] })
    const [left] = await retryCreateIssue(ME, job, issue, { client: again.client })
    expect(left).toMatchObject({ step: 'contact', role: 'project_manager', draft: { id: 'c-pm3', name: 'ZZ PM Two' } })
    expect(left!.message).toBe(
      'The project manager this was to replace is no longer on file. Not saved: ZZ PM Three is the project manager for ZZ Builder, on every job for them. Retry to make ZZ PM Two the project manager on every job for ZZ Builder instead.',
    )
    expect(again.calls.some((c) => c.table === 'builder_contacts' && c.op === 'insert')).toBe(false)
    // Retrying that one replaces PM Three in place.
    expect(await retryCreateIssue(ME, job, left!, { client: again.client })).toEqual([])
    expect(again.tables.builder_contacts).toEqual([{ ...pm3, name: 'ZZ PM Two', mobile: '0422 222 222' }])
    // A PM One still on file but refused (RLS) says refused, not gone.
    const ro = fakeDb({ job_sites: [{ ...job }], builder_contacts: [{ ...pm1 }] }, (c) => (c.table === 'builder_contacts' && c.op === 'update' ? { data: [] } : undefined))
    expect((await retryCreateIssue(ME, job, issue, { client: ro.client }))[0]!.message).toMatch(/refused/)
  })

  it("never saves a contact issue against a builder the job has left; it re-aims it at the job's builder now", async () => {
    const issue: CreateIssue = { step: 'contact', role: 'supervisor', builderId: 'b-1', draft: { id: null, name: 'ZZ Sup', mobile: '0400 000 000' }, message: 'x' }
    const stale = site({ id: 's-5', builder_id: 'b-1', client_name: 'Builder One' })
    const fake = fakeDb({ job_sites: [{ ...stale, builder_id: 'b-2', client_name: 'Builder Two' }] })
    const left = await retryCreateIssue(ME, stale, issue, { client: fake.client })
    expect(left).toEqual([
      {
        step: 'contact',
        role: 'supervisor',
        builderId: 'b-2',
        draft: { name: 'ZZ Sup', mobile: '0400 000 000' },
        message: "This job's builder is now Builder Two, so ZZ Sup was not saved. Retry to save them as the site supervisor for Builder Two.",
      },
    ])
    expect(fake.calls.some((c) => c.op !== 'select')).toBe(false)
    // Retried as re-aimed: saved under Builder Two and linked.
    expect(await retryCreateIssue(ME, stale, left[0]!, { client: fake.client })).toEqual([])
    const sup = fake.tables.builder_contacts![0]!
    expect(sup).toMatchObject({ builder_id: 'b-2', role: 'supervisor', name: 'ZZ Sup' })
    expect(fake.tables.job_sites![0]).toMatchObject({ builder_id: 'b-2', supervisor_contact_id: sup.id })
    // A supervisor issue for Builder One's person on a job now on Builder Two is refused, saying why.
    const sup1 = { id: 'c-1', builder_id: 'b-1', role: 'supervisor', name: 'Sup One', mobile: null, email: null, note: null }
    const f2 = fakeDb({ job_sites: [{ ...stale, builder_id: 'b-2', client_name: 'Builder Two' }], builder_contacts: [sup1] })
    const [still] = await retryCreateIssue(ME, stale, { step: 'supervisor', contactId: 'c-1', message: 'x' }, { client: f2.client })
    expect(still!.message).toBe('Sup One is a site supervisor for another builder, not for Builder Two.')
    expect(f2.tables.job_sites![0]!.supervisor_contact_id).toBeNull()
  })

  it('retries a contact issue: saves the person and links the supervisor', async () => {
    const fake = fakeDb({ job_sites: [{ ...site({ id: 's-9', builder_id: 'b-1' }) }] })
    const issue: CreateIssue = { step: 'contact', role: 'supervisor', builderId: 'b-1', draft: { name: 'ZZ Sup' }, message: 'x' }
    const left = await retryCreateIssue(ME, site({ id: 's-9', builder_id: 'b-1' }), issue, { client: fake.client })
    expect(left).toEqual([])
    const sup = fake.tables.builder_contacts![0]!
    expect(sup).toMatchObject({ builder_id: 'b-1', role: 'supervisor', name: 'ZZ Sup' })
    expect(fake.tables.job_sites![0]).toMatchObject({ supervisor_contact_id: sup.id })
  })

  it('retries a builder issue only while the job still has no builder record and goes by the name typed (K, K2)', async () => {
    const issue: CreateIssue = { step: 'builder', builderName: 'Acme Homes', message: 'Failed to fetch' }
    // What the banner still holds: the job as made, before anything was fixed.
    const stale = site({ id: 's-k', builder_id: null, client_name: 'Acme Homes', supervisor_contact_id: null })
    const acme = { id: 'b-acme', name: 'Acme Homes', created_at: '2026-01-01T00:00:00Z' }
    const writes = (f: ReturnType<typeof fakeDb>) => f.calls.filter((c) => c.op !== 'select')

    // K: the builder changed to Zenith on the phone since, and supervisor Zed saved there.
    const zenith = { ...stale, builder_id: 'b-zen', client_name: 'Zenith', supervisor_contact_id: 'c-zed' }
    const k = fakeDb({ job_sites: [{ ...zenith }], builders: [acme] })
    expect(await retryIssue(ME, stale, issue, { client: k.client })).toEqual({ left: [], note: "This job's builder is now Zenith, so it was not changed." })
    expect(writes(k)).toEqual([])
    expect(k.tables.job_sites).toEqual([zenith])

    // K2: a builder picked on the web form (updateJob) since.
    const picked = { ...stale, builder_id: 'b-pick', client_name: 'Picked Builders' }
    const k2 = fakeDb({ job_sites: [{ ...picked }], builders: [acme] })
    expect((await retryIssue(ME, stale, issue, { client: k2.client })).note).toBe("This job's builder is now Picked Builders, so it was not changed.")
    expect(writes(k2)).toEqual([])
    expect(k2.tables.job_sites).toEqual([picked])

    // Renamed on the phone with no record, or the builder taken off: nothing written either.
    const renamed = fakeDb({ job_sites: [{ ...stale, client_name: 'Zenith' }] })
    expect((await retryIssue(ME, stale, issue, { client: renamed.client })).note).toBe("This job's builder is now Zenith, so it was not changed.")
    const off = fakeDb({ job_sites: [{ ...stale, client_name: null }] })
    expect((await retryIssue(ME, stale, issue, { client: off.client })).note).toBe('This job has no builder now, so it was not changed.')
    expect([...writes(renamed), ...writes(off)]).toEqual([])

    // Linked since under that same name (the phone's first contact does that): nothing left to do.
    const linked = fakeDb({ job_sites: [{ ...stale, builder_id: 'b-acme' }] })
    expect(await retryIssue(ME, stale, issue, { client: linked.client })).toEqual({ left: [], note: null })
    expect(writes(linked)).toEqual([])

    // Still to do: linked to the record, with its spelling, on the condition that nothing changed.
    const todo = fakeDb({ job_sites: [{ ...stale, client_name: 'acme homes' }], builders: [acme] })
    expect(await retryIssue(ME, stale, issue, { client: todo.client })).toEqual({ left: [], note: null })
    expect(writes(todo)).toEqual([
      expect.objectContaining({
        table: 'job_sites',
        op: 'update',
        payload: { builder_id: 'b-acme', client_name: 'Acme Homes' },
        filters: [
          ['eq', 'id', 's-k'],
          ['is', 'builder_id', null],
          ['eq', 'client_name', 'acme homes'],
        ],
      }),
    ])
    expect(todo.tables.job_sites![0]).toMatchObject({ builder_id: 'b-acme', client_name: 'Acme Homes' })

    // A builder picked between the read and the write: the condition matches nothing, and the retry says so.
    const race: { f?: ReturnType<typeof fakeDb> } = {}
    race.f = fakeDb({ job_sites: [{ ...stale }], builders: [acme] }, (c) => {
      if (c.op !== 'update') return undefined
      Object.assign(race.f!.tables.job_sites![0]!, { builder_id: 'b-pick', client_name: 'Picked Builders' })
      return { data: [] }
    })
    expect(await retryIssue(ME, stale, issue, { client: race.f.client })).toEqual({ left: [], note: "This job's builder is now Picked Builders, so it was not changed." })
    expect(race.f.tables.job_sites![0]).toMatchObject({ builder_id: 'b-pick', client_name: 'Picked Builders' })

    // Refused by RLS with the job unchanged: still an issue, saying refused.
    const ro = fakeDb({ job_sites: [{ ...stale }], builders: [acme] }, (c) => (c.op === 'update' ? { data: [] } : undefined))
    const out = await retryIssue(ME, stale, issue, { client: ro.client })
    expect(out.left).toEqual([{ ...issue, message: expect.stringMatching(/refused/) }])
  })

  it('saves a person typed when the builder did not save only under that builder, never under one picked since', async () => {
    // The builder step failed at create, so the supervisor typed for Acme Homes waited on it.
    const fake0 = fakeDb({}, (c) => (c.table === 'builders' ? { data: null, error: { message: 'Failed to fetch' } } : undefined))
    const made = await createJob(ME, { ...DRAFT, builderName: 'Acme Homes', contacts: { supervisor: { name: 'Acme Sup' } } }, { client: fake0.client })
    const issue = made.issues.find((i) => i.step === 'contact')!
    expect(issue).toMatchObject({ step: 'contact', role: 'supervisor', builderId: null, builderName: 'Acme Homes', draft: { name: 'Acme Sup' } })
    const stale = made.site!

    // K: the builder is Zenith now, with Zed as this job's supervisor. Acme's person is not saved there.
    const zed = { id: 'c-zed', builder_id: 'b-zen', role: 'supervisor', name: 'Zed', mobile: null, email: null, note: null }
    const k = fakeDb({ job_sites: [{ ...stale, builder_id: 'b-zen', client_name: 'Zenith', supervisor_contact_id: 'c-zed' }], builder_contacts: [{ ...zed }] })
    const [left] = await retryCreateIssue(ME, stale, JSON.parse(JSON.stringify(issue)) as CreateIssue, { client: k.client })
    expect(left).toEqual({
      step: 'contact',
      role: 'supervisor',
      builderId: 'b-zen',
      draft: { name: 'Acme Sup' },
      message: "This job's builder is now Zenith, so Acme Sup was not saved. Retry to save them as the site supervisor for Zenith.",
    })
    expect(k.calls.some((c) => c.op !== 'select')).toBe(false)
    expect(k.tables.job_sites![0]).toMatchObject({ supervisor_contact_id: 'c-zed' })
    expect(k.tables.builder_contacts).toEqual([zed])

    // The builder retried and linked under the name typed: the person is saved there and linked.
    const ok = fakeDb({ job_sites: [{ ...stale, builder_id: 'b-acme', client_name: 'Acme Homes' }] })
    expect(await retryCreateIssue(ME, stale, issue, { client: ok.client })).toEqual([])
    expect(ok.tables.builder_contacts).toEqual([expect.objectContaining({ builder_id: 'b-acme', role: 'supervisor', name: 'Acme Sup' })])
    expect(ok.tables.job_sites![0]).toMatchObject({ supervisor_contact_id: ok.tables.builder_contacts![0]!.id })
  })

  it("retries a link issue only for jobs that still go by the builder's name (L), and says which it left alone", async () => {
    const builder = { id: 'b-l', name: 'L Builder' }
    const rows = [
      site({ id: 'l0', name: 'L0', builder_id: null, client_name: 'L Someone Else' }),
      site({ id: 'l2', name: 'L2', builder_id: null, client_name: 'l builder' }),
      site({ id: 'l3', name: 'L3', builder_id: 'b-l', client_name: 'L Builder' }),
    ]
    const issue: CreateIssue = { step: 'link', builder, jobIds: ['l0', 'l2', 'l3'], message: 'Failed to fetch' }
    const fake = fakeDb({ job_sites: rows.map((r) => ({ ...r })) })
    expect(await retryIssue(ME, site({ id: 'l1' }), issue, { client: fake.client })).toEqual({
      left: [],
      note: "Not linked to L Builder, because that job's builder has changed since: L0 (now L Someone Else).",
    })
    const [l0, l2, l3] = fake.tables.job_sites!
    expect(l0).toEqual(rows[0])
    expect(l2).toMatchObject({ builder_id: 'b-l', client_name: 'L Builder' })
    expect(l3).toEqual(rows[2])
    expect(fake.calls.filter((c) => c.op === 'update').map((c) => c.filters)).toEqual([[['in', 'id', ['l2']]]])

    // Refused: the issue stays, for the jobs that did not link only.
    const ro = fakeDb({ job_sites: rows.map((r) => ({ ...r })) }, (c) => (c.op === 'update' ? { data: [] } : undefined))
    const out = await retryIssue(ME, site({ id: 'l1' }), issue, { client: ro.client })
    expect(out.left).toEqual([{ ...issue, jobIds: ['l2'], message: expect.stringMatching(/could not be linked to L Builder/) }])
  })

  it('links the other jobs asked for only if they still go by the builder name, and says which it left alone', async () => {
    const o1 = site({ id: 'o1', name: 'Older One', builder_id: null, client_name: 'zz builder' })
    const o2 = site({ id: 'o2', name: 'Older Two', builder_id: null, client_name: 'Other Homes' })
    const fake = fakeDb({ job_sites: [{ ...o1 }, { ...o2 }] })
    // The form offered both; Older Two's builder was changed on a phone before Save.
    const out = await createJob(ME, { ...DRAFT, builderName: 'ZZ Builder', linkJobs: [o1, { ...o2, client_name: 'ZZ Builder' }] }, { client: fake.client })
    expect(out.issues).toEqual([])
    expect(out.linked).toEqual(['o1'])
    expect(out.notLinked).toEqual([{ id: 'o2', name: 'Older Two', now: 'Other Homes' }])
    expect(fake.tables.job_sites!.find((r) => r.id === 'o1')).toMatchObject({ builder_id: out.builder!.id, client_name: 'ZZ Builder' })
    expect(fake.tables.job_sites!.find((r) => r.id === 'o2')).toEqual(o2)
  })
})

// --------------------------------------------------------------- updates

describe('updateJob', () => {
  it('writes only the columns that changed, and nothing at all when nothing did', async () => {
    const before = site()
    expect(jobPatch(before, { name: ' Seacombe gardens ', job_type: 'Bathrooms', colour: undefined })).toEqual({})
    const fake = fakeDb({ job_sites: [{ ...before }] })
    const none = await updateJob(before, { name: 'Seacombe gardens' }, { client: fake.client })
    expect(none.written).toEqual([])
    expect(fake.calls).toEqual([])
    const out = await updateJob(before, { job_type: 'Bathrooms + ensuites', colour: '#4c7fb8' }, { client: fake.client })
    expect(out.written.sort()).toEqual(['colour', 'job_type'])
    expect(fake.calls[0]!.payload).toEqual({ job_type: 'Bathrooms + ensuites', colour: '#4C7FB8' })
    // A colour outside the swatches is refused; null goes back to the phone's automatic colour.
    expect(() => jobPatch(before, { colour: '#123456' })).toThrow(JobInputError)
    expect(jobPatch(site({ colour: '#4C7FB8' }), { colour: null })).toEqual({ colour: null })
  })

  it('saves the address and the fence together', () => {
    const before = site()
    expect(jobPatch(before, { address: '1 Moseley Square, Glenelg SA 5045' })).toEqual({
      lat: before.lat,
      lng: before.lng,
      radius_m: before.radius_m,
      address: '1 Moseley Square, Glenelg SA 5045',
    })
    expect(jobPatch(before, { lat: -34.98, lng: 138.46, radius_m: 80 })).toEqual({ lat: -34.98, lng: 138.46, radius_m: 80, address: before.address })
    // A legacy radius the slider cannot show is kept, not rejected, when only the address moves.
    expect(jobPatch(site({ radius_m: 900 }), { address: 'x' })).toMatchObject({ radius_m: 900 })
    expect(() => jobPatch(before, { radius_m: 900 })).toThrow(JobInputError)
  })

  it('clears the supervisor link when the builder changes, and only then', () => {
    const linked = site({ builder_id: 'b-1', client_name: 'Paramoint', supervisor_contact_id: 'c-1' })
    const other = { id: 'b-2', name: 'Other Homes' }
    expect(jobPatch(linked, { builder: other })).toEqual({ builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: null })
    expect(jobPatch(linked, { builder: other, supervisor_contact_id: 'c-9' })).toEqual({ builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: 'c-9' })
    // The old builder's supervisor sent back unchanged (a form returning every field it loaded) does not stay.
    expect(jobPatch(linked, { builder: other, supervisor_contact_id: 'c-1' })).toEqual({ builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: null })
    expect(jobPatch(linked, { builder: other, supervisor_contact_id: null })).toEqual({ builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: null })
    // The same builder: the link is the edit's to keep or change.
    expect(jobPatch(linked, { builder: { id: 'b-1', name: 'Paramoint' }, supervisor_contact_id: 'c-1' })).toEqual({})
    expect(jobPatch(linked, { builder: { id: 'b-1', name: 'Paramoint' }, supervisor_contact_id: 'c-2' })).toEqual({ supervisor_contact_id: 'c-2' })
    expect(jobPatch(linked, { builder: { id: 'b-1', name: 'Paramoint' } })).toEqual({})
    expect(jobPatch(linked, { builder: null })).toEqual({ builder_id: null, client_name: null, supervisor_contact_id: null })
    // A phone-made job (name, no record) linked to the record of the same name keeps its supervisor.
    const typed = site({ builder_id: null, client_name: 'paramoint', supervisor_contact_id: 'c-1' })
    expect(jobPatch(typed, { builder: { id: 'b-1', name: 'Paramoint' } })).toEqual({ builder_id: 'b-1', client_name: 'Paramoint' })
    expect(jobPatch(typed, { builder: { id: 'b-1', name: 'Paramoint' }, supervisor_contact_id: 'c-1' })).toEqual({ builder_id: 'b-1', client_name: 'Paramoint' })
    expect(jobPatch(typed, { builder: other })).toEqual({ builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: null })
    expect(jobPatch(typed, { builder: other, supervisor_contact_id: 'c-1' })).toEqual({ builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: null })
    // A supervisor is one of a builder's people: none for a job that is to have no builder record.
    expect(() => jobPatch(site(), { supervisor_contact_id: 'c-9' })).toThrow(JobInputError)
    expect(() => jobPatch(linked, { builder: null, supervisor_contact_id: 'c-9' })).toThrow(/builder first/)
  })

  it("links only a site supervisor of the job's new builder (P1: a builder change with every field sent back)", async () => {
    const supOne = { id: 'c-1', builder_id: 'b-1', role: 'supervisor', name: 'P Sup One', mobile: '0400 999 001', email: null, note: null }
    const supTwo = { id: 'c-2', builder_id: 'b-2', role: 'supervisor', name: 'P Sup Two', mobile: null, email: null, note: null }
    const pmTwo = { id: 'c-3', builder_id: 'b-2', role: 'project_manager', name: 'P PM Two', mobile: null, email: null, note: null }
    const before = site({ builder_id: 'b-1', client_name: 'Builder One', supervisor_contact_id: 'c-1', captain_id: 'w-cap', job_type: '' })
    const seed = () => fakeDb({ job_sites: [{ ...before }], builder_contacts: [{ ...supOne }, { ...supTwo }, { ...pmTwo }] })
    const two = { id: 'b-2', name: 'Builder Two' }
    const form = { name: before.name, job_type: before.job_type, captain_id: before.captain_id, supervisor_contact_id: before.supervisor_contact_id }

    // Everything the form loaded, sent back with the new builder: Builder One's supervisor is dropped.
    const a = seed()
    const out = await updateJob(before, { ...form, builder: two }, { client: a.client })
    expect(out.written.sort()).toEqual(['builder_id', 'client_name', 'supervisor_contact_id'])
    expect(a.tables.job_sites![0]).toMatchObject({ builder_id: 'b-2', client_name: 'Builder Two', supervisor_contact_id: null })

    // Builder Two's own supervisor, named with the change, is linked.
    const b = seed()
    await updateJob(before, { ...form, supervisor_contact_id: 'c-2', builder: two }, { client: b.client })
    expect(b.tables.job_sites![0]).toMatchObject({ builder_id: 'b-2', supervisor_contact_id: 'c-2' })

    // Another builder's supervisor, Builder Two's PM, or nobody on file: refused, and nothing is written.
    const onTwo = site({ builder_id: 'b-2', client_name: 'Builder Two', supervisor_contact_id: null })
    for (const [edit, why] of [
      [{ supervisor_contact_id: 'c-1' }, 'P Sup One is a site supervisor for another builder, not for Builder Two.'],
      [{ supervisor_contact_id: 'c-3' }, "P PM Two is the builder's project manager, not a site supervisor."],
      [{ supervisor_contact_id: 'c-gone' }, 'That site supervisor is no longer on file. Pick another, or add them.'],
    ] as const) {
      const f = fakeDb({ job_sites: [{ ...onTwo }], builder_contacts: [{ ...supOne }, { ...supTwo }, { ...pmTwo }] })
      await expect(updateJob(onTwo, edit, { client: f.client })).rejects.toThrow(why)
      expect(f.calls.some((c) => c.op !== 'select')).toBe(false)
    }
    // Moving the job back to Builder One and naming Sup Two (Builder Two's) is refused too.
    const c = seed()
    await expect(updateJob(onTwo, { builder: { id: 'b-1', name: 'Builder One' }, supervisor_contact_id: 'c-2' }, { client: c.client })).rejects.toThrow(/another builder, not for Builder One/)
  })

  it('never writes builder_id or client_name on their own, so a linked job keeps its builder record\'s name', () => {
    const linked = site({ builder_id: 'b-1', client_name: 'Paramoint', supervisor_contact_id: 'c-1' })
    const raw = (edit: Record<string, unknown>) => () => jobPatch(linked, edit as never)
    expect(raw({ client_name: 'Someone Else Builders' })).toThrow(JobInputError)
    expect(raw({ builder_id: 'b-2' })).toThrow(JobInputError)
    expect(raw({ builder_id: 'b-2', client_name: 'Other Homes' })).toThrow(JobInputError)
    expect(raw({ client_name: null })).toThrow(JobInputError)
    // A form that sends every column back unchanged is fine.
    expect(jobPatch(linked, { client_name: ' Paramoint ', builder_id: 'b-1', job_type: 'Ensuites' } as never)).toEqual({ job_type: 'Ensuites' })
    expect(() => jobPatch(linked, { builder: { id: '', name: 'x' } })).toThrow(JobInputError)
  })

  it('reads the row back, and a refusal (no row) throws', async () => {
    const before = site()
    const refused = fakeDb({}, () => ({ data: [] }))
    await expect(updateJob(before, { job_type: 'Ensuites' }, { client: refused.client })).rejects.toThrow(/refused/)
    const garbled = fakeDb({}, (c) => (c.op === 'update' ? { data: [{ ...before, job_type: 'something else' }] } : undefined))
    await expect(updateJob(before, { job_type: 'Ensuites' }, { client: garbled.client })).rejects.toThrow(/job_type/)
  })
})

describe('setStatus', () => {
  it('moves between the three statuses only, read back', async () => {
    const fake = fakeDb({ job_sites: [{ ...site() }] })
    expect((await setStatus('site-1', 'active', { client: fake.client })).status).toBe('active')
    expect((await setStatus('site-1', 'archived', { client: fake.client })).status).toBe('archived')
    expect((await setStatus('site-1', 'starting_soon', { client: fake.client })).status).toBe('starting_soon')
    await expect(setStatus('site-1', 'done' as 'active', { client: fake.client })).rejects.toThrow(JobInputError)
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls.every((c) => c.op === 'update' && JSON.stringify(c.payload).startsWith('{"status"'))).toBe(true)
  })

  it('throws when RLS refuses it', async () => {
    const fake = fakeDb({ job_sites: [] })
    await expect(setStatus('site-1', 'active', { client: fake.client })).rejects.toThrow(/refused/)
  })
})

// ------------------------------------------------------------- the stash

describe('stashCreateIssues / takeCreateIssues', () => {
  const store = new Map<string, string>()
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage, configurable: true })
  })
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original)
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })

  const issues: CreateIssue[] = [
    { step: 'contact', role: 'supervisor', builderId: 'b-1', draft: { name: 'ZZ Sup', mobile: '0400 000 000' }, message: 'permission denied' },
    { step: 'crew', workerIds: ['w-1'], from: '2027-03-01', to: '2027-03-05', message: 'timeout' },
  ]

  it('keeps them under crewline.createIssues.<siteId>, and take empties it', () => {
    stashCreateIssues('s-1', issues)
    expect(JSON.parse(store.get('crewline.createIssues.s-1')!)).toEqual(issues)
    expect(peekCreateIssues('s-1')).toEqual(issues)
    expect(takeCreateIssues('s-1')).toEqual(issues)
    expect(takeCreateIssues('s-1')).toEqual([])
    stashCreateIssues('s-1', issues)
    stashCreateIssues('s-1', [])
    expect(store.has('crewline.createIssues.s-1')).toBe(false)
  })

  it('drops anything that is not an issue, and survives storage that throws', () => {
    store.set('crewline.createIssues.s-2', JSON.stringify([issues[0], { step: 'contact', role: 'boss', message: 'x' }, 'junk']))
    expect(takeCreateIssues('s-2')).toEqual([issues[0]])
    store.set('crewline.createIssues.s-3', '{not json')
    expect(takeCreateIssues('s-3')).toEqual([])
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    expect(() => stashCreateIssues('s-4', issues)).not.toThrow()
    expect(takeCreateIssues('s-4')).toEqual([])
  })
})
