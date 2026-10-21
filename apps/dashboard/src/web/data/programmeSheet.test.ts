import { describe, expect, it, vi } from 'vitest'
import { removeFile, uploadFile } from '../phone'
import { importProgrammeSheet, oursSpan, programmeTaskRows, type Db } from './programme'
import { programmePdf } from './programmePdf'
import type { SheetLine } from './sheet'

// Storage goes through the phone's own helpers; here they are stand-ins, so
// nothing leaves the test.
vi.mock('../phone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../phone')>()),
  uploadFile: vi.fn(async (_bucket: string, path: string) => path),
  removeFile: vi.fn(async () => {}),
}))

/**
 * A programme read from a spreadsheet (programme.ts importProgrammeSheet):
 * the lines it saves, the order it saves them in, what a failure leaves
 * behind, and the printout the crew's phones open.
 */

const line = (over: Partial<SheetLine>): SheetLine => ({
  ref: '10',
  name: 'Task',
  trade: '',
  startsOn: '2027-02-01',
  endsOn: '2027-02-02',
  durationDays: null,
  pctComplete: null,
  isOurs: false,
  isPredecessor: false,
  ...over,
})

const LINES: SheetLine[] = [
  line({ ref: '110', name: 'Screed to falls', trade: 'Concreter', startsOn: '2027-02-08', endsOn: '2027-02-09', isPredecessor: true }),
  line({ ref: '120', name: 'Waterproof membrane', trade: 'Proven Tiling', startsOn: '2027-02-10', endsOn: '2027-02-11', pctComplete: 50, isOurs: true }),
  line({ ref: '130', name: 'Wall and floor tiling', trade: 'Proven Tiling', startsOn: '2027-02-15', endsOn: '2027-02-26', durationDays: 10, isOurs: true }),
  line({ ref: ' ', name: 'Shower screens', trade: ' ', startsOn: '2027-03-01', endsOn: null }),
]

/**
 * A fake client that answers each awaited call, in order, with the next
 * scripted answer, and records every call as "table.method(args).method(args)".
 */
function scripted(answers: unknown[]) {
  const calls: string[] = []
  const next = () => answers.shift() ?? { data: null, error: { message: 'nothing scripted' } }
  const chainFor = (table: string) => {
    const parts: string[] = []
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete', 'single']) {
      b[m] = (...args: unknown[]) => {
        parts.push(`${m}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
        return b
      }
    }
    b.then = (resolve: (v: unknown) => void) => {
      calls.push(`${table}.${parts.join('.')}`)
      resolve(next())
    }
    return b
  }
  const rpc = (fn: string, args: unknown) => ({
    then: (resolve: (v: unknown) => void) => {
      calls.push(`rpc.${fn}(${JSON.stringify(args)})`)
      resolve(next())
    },
  })
  return { calls, client: { from: chainFor, rpc } as unknown as Db }
}

const sent = (call: string) => JSON.parse(call.slice(call.indexOf('(') + 1, call.indexOf(').')))

const IMPORT = {
  me: { id: 'w', company_id: 'co' },
  siteId: 's',
  fileName: 'Lot42_Programme.xlsx',
  revision: ' Rev C ',
  issuedOn: '2027-01-20',
  lines: LINES,
  source: 'excel' as const,
  note: 'Gantt: 4 dated tasks, 2 read as ours.',
  pdf: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
}

describe('our window on a programme', () => {
  it('runs from the first start to the last finish of the lines marked ours', () => {
    expect(oursSpan(LINES)).toEqual({ from: '2027-02-10', to: '2027-02-26' })
  })
  it('is nothing when no line is ours', () => {
    expect(oursSpan(LINES.map((l) => ({ ...l, isOurs: false })))).toBeNull()
  })
  it('counts a line with one date at both ends', () => {
    expect(oursSpan([line({ isOurs: true, startsOn: null, endsOn: '2027-05-01' })])).toEqual({ from: '2027-05-01', to: '2027-05-01' })
  })
})

describe('the lines saved', () => {
  const rows = programmeTaskRows({ company_id: 'co' }, 's', 'p', LINES)
  it('keep the order the builder listed them in', () => {
    expect(rows.map((r) => r.sort)).toEqual([0, 1, 2, 3])
  })
  it('carry the ticks, the numbers and the dates as read', () => {
    expect(rows[1]).toEqual({
      company_id: 'co',
      programme_id: 'p',
      site_id: 's',
      ref: '120',
      name: 'Waterproof membrane',
      trade: 'Proven Tiling',
      starts_on: '2027-02-10',
      ends_on: '2027-02-11',
      duration_days: null,
      pct_complete: 50,
      is_ours: true,
      is_predecessor: false,
      sort: 1,
    })
    expect(rows[2]).toMatchObject({ duration_days: 10, pct_complete: 0, is_ours: true })
    expect(rows[0]).toMatchObject({ is_ours: false, is_predecessor: true })
  })
  it('save a blank ref or trade as nothing', () => {
    expect(rows[3]).toMatchObject({ ref: null, trade: null, ends_on: null })
  })
})

describe('importProgrammeSheet', () => {
  it('puts nothing up when there are no dated lines', async () => {
    const from = vi.fn()
    vi.mocked(uploadFile).mockClear()
    const out = await importProgrammeSheet({ ...IMPORT, lines: [] }, { from } as unknown as Db)
    expect(out.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('goes up as a draft, then its lines, then current; the one before is superseded and its dates carried', async () => {
    vi.mocked(uploadFile).mockClear()
    const { calls, client } = scripted([
      { data: [{ id: 'old' }], error: null }, // which revision is current now
      { data: { id: 'new' }, error: null }, // the draft
      { data: LINES.map((_, i) => ({ id: `t${i}` })), error: null }, // its lines
      { data: [{ id: 'new', name: 'Lot42 Programme', revision: 'Rev C', issued_on: '2027-01-20', received_on: '2027-01-21', storage_path: 'x', status: 'current' }], error: null },
      { data: null, error: null }, // the earlier revision's dates carried
      { data: [{ id: 'new', status: 'current' }, { id: 'old', status: 'superseded' }], error: null },
    ])
    const out = await importProgrammeSheet(IMPORT, client)
    expect(out).toMatchObject({ ok: true, superseded: ['old'] })
    expect(out.ok && out.warning).toBeFalsy()
    expect(calls.map((c) => c.slice(0, c.indexOf('(')))).toEqual([
      'programmes.select',
      'programmes.insert',
      'programme_tasks.insert',
      'programmes.update',
      'rpc.programme_carry_previous',
      'programmes.select',
    ])
    // The draft: the spreadsheet's kind, the revision trimmed, the reader's note, and the printout as its file.
    const row = sent(calls[1]!)
    expect(row).toMatchObject({ company_id: 'co', site_id: 's', name: 'Lot42 Programme', revision: 'Rev C', issued_on: '2027-01-20', source: 'excel', status: 'draft', import_note: IMPORT.note, imported_by: 'w' })
    expect(row.storage_path).toMatch(/^co\/s\/.+\.pdf$/)
    expect(vi.mocked(uploadFile).mock.calls.at(-1)).toEqual(['site-files', row.storage_path, IMPORT.pdf, 'application/pdf'])
    // Its lines, against the draft.
    expect(sent(calls[2]!).map((t: { programme_id: string; ref: string | null }) => [t.programme_id, t.ref])).toEqual([
      ['new', '110'],
      ['new', '120'],
      ['new', '130'],
      ['new', null],
    ])
    // Only then current, and only that row.
    expect(calls[3]).toMatch(/^programmes\.update\(\{"status":"current"\}\)\.eq\("id", "new"\)/)
    expect(calls[4]).toBe('rpc.programme_carry_previous({"p_programme":"new"})')
  })

  it('a failure before it is current takes the draft and its file back out, so the old revision stays', async () => {
    vi.mocked(removeFile).mockClear()
    const { calls, client } = scripted([
      { data: [{ id: 'old' }], error: null },
      { data: { id: 'new' }, error: null },
      { data: null, error: { message: 'new row violates row-level security policy for table "programme_tasks"' } },
      { data: null, error: null }, // the draft deleted
    ])
    const out = await importProgrammeSheet(IMPORT, client)
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/lines did not save: new row violates/) })
    expect(calls.at(-1)).toBe('programmes.delete().eq("id", "new").eq("status", "draft")')
    expect(calls.some((c) => c.startsWith('programmes.update'))).toBe(false)
    expect(vi.mocked(removeFile).mock.calls.at(-1)?.[1]).toBe(vi.mocked(uploadFile).mock.calls.at(-1)?.[1])
  })

  it('a refused write that answers with no rows is a failure too', async () => {
    const { calls, client } = scripted([
      { data: [], error: null },
      { data: { id: 'new' }, error: null },
      { data: [], error: null }, // RLS: no error, nothing written
      { data: null, error: null },
    ])
    const out = await importProgrammeSheet(IMPORT, client)
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/the write was refused/) })
    expect(calls.at(-1)).toMatch(/^programmes\.delete\(\)/)
  })

  it('says so when the earlier revision still reads current', async () => {
    const { client } = scripted([
      { data: [{ id: 'old' }], error: null },
      { data: { id: 'new' }, error: null },
      { data: LINES.map((_, i) => ({ id: `t${i}` })), error: null },
      { data: [{ id: 'new', status: 'current' }], error: null },
      { data: null, error: null },
      { data: [{ id: 'new', status: 'current' }, { id: 'old', status: 'current' }], error: null },
    ])
    const out = await importProgrammeSheet(IMPORT, client)
    expect(out).toMatchObject({ ok: true, superseded: [], warning: expect.stringMatching(/still reads as current/) })
  })
})

describe('the printout', () => {
  it('is a PDF of every line, with our work and the work we follow marked', async () => {
    const pdf = programmePdf({
      job: '12 Test Street, Glenelg',
      builder: 'Acme Builders',
      revision: 'Rev C',
      issuedOn: '2027-01-20',
      fileName: 'Lot42_Programme.xlsx',
      importedOn: '2027-01-21',
      lines: LINES,
    })
    expect(pdf.type).toBe('application/pdf')
    const body = new TextDecoder('latin1').decode(await pdf.arrayBuffer())
    expect(body.startsWith('%PDF')).toBe(true)
    for (const s of ['12 Test Street, Glenelg', 'Rev C', 'Acme Builders', 'Screed to falls', 'Waterproof membrane', 'Wall and floor tiling', 'Shower screens', 'OURS', 'FOLLOW']) {
      expect(body).toContain(s)
    }
    expect(body).toMatch(/We're on 10 Feb 2027 to 26 Feb 2027/)
  })
})
