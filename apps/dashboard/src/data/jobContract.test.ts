import { describe, expect, it } from 'vitest'
import {
  BLANK_CONTRACT,
  contractDraftOf,
  contractEditOf,
  contractProblems,
  contractValueProblem,
  loadContract,
  moneyInput,
  moneyWords,
  parseDays,
  parseMoney,
  parsePercent,
  retentionWords,
  saveContract,
  termsWords,
  type ContractDraft,
  type JobContract,
} from './jobContract'

type Answer = { data?: unknown; error?: { message: string; code?: string } | null }

/** A client that records each call and answers from `reply`, by operation. */
function fake(reply: (op: string, payload: unknown) => Answer) {
  const calls: Array<{ op: string; payload: unknown; filters: unknown[]; cols?: string }> = []
  const client = {
    from(table: string) {
      expect(table).toBe('contracts')
      const call = { op: 'select', payload: undefined as unknown, filters: [] as unknown[], cols: undefined as string | undefined }
      let single = false
      const chain = {
        update(p: unknown) {
          call.op = 'update'
          call.payload = p
          return chain
        },
        insert(p: unknown) {
          call.op = 'insert'
          call.payload = p
          return chain
        },
        eq(col: string, val: unknown) {
          call.filters.push([col, val])
          return chain
        },
        select(cols?: string) {
          call.cols = cols
          return chain
        },
        maybeSingle() {
          single = true
          return chain
        },
        then(ok: (a: Answer) => unknown, bad?: (e: unknown) => unknown) {
          calls.push(call)
          const out = reply(call.op, call.payload)
          const answer = single && !out.error ? { data: ((out.data as unknown[]) ?? [])[0] ?? null, error: null } : out
          return Promise.resolve(answer).then(ok, bad)
        },
      }
      return chain
    },
  }
  return { client: client as never, calls }
}

const SITE = { id: 'site-1', company_id: 'co-1', builder_id: 'b-1' }

/** A row as the database holds it: what the columns default to, plus `over`. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'k-1',
  contract_sum: 0,
  gst_inclusive: false,
  contract_no: null,
  order_no: null,
  retention_pct: 0,
  payment_terms_days: 30,
  ...over,
})

const ON_FILE: JobContract = { id: 'k-1', contract_sum: 48500, gst_inclusive: false, contract_no: 'C-2291', order_no: 'PO 88401', retention_pct: 5, payment_terms_days: 45 }
const typed = (over: Partial<ContractDraft> = {}): ContractDraft => ({ ...BLANK_CONTRACT, ...over })

// ------------------------------------------------------------------ typing

describe('parseMoney', () => {
  it('reads plain amounts, with or without a dollar sign, commas and spaces', () => {
    expect(parseMoney('48500')).toBe(48500)
    expect(parseMoney('$48,500')).toBe(48500)
    expect(parseMoney(' 48 500.5 ')).toBe(48500.5)
    expect(parseMoney('0')).toBe(0)
  })
  it('is null when blank, NaN when not an amount', () => {
    expect(parseMoney('  ')).toBeNull()
    for (const bad of ['abc', '-5', '1.2.3', '48500.555', '$', '4e5']) expect(parseMoney(bad)).toBeNaN()
  })
})

describe('contractValueProblem', () => {
  it('accepts blank and amounts, refuses the rest', () => {
    expect(contractValueProblem('')).toBeNull()
    expect(contractValueProblem('48,500.00')).toBeNull()
    expect(contractValueProblem('forty grand')).toMatch(/amount of dollars/)
    expect(contractValueProblem('1000000000000')).toMatch(/more than/)
  })
})

describe('moneyInput and moneyWords', () => {
  it('drops the cents when there are none', () => {
    expect(moneyInput(48500)).toBe('48500')
    expect(moneyInput(48500.5)).toBe('48500.50')
    expect(moneyWords(48500)).toBe('$48,500')
    expect(moneyWords(48500.5)).toBe('$48,500.50')
  })
})

describe('parsePercent and parseDays', () => {
  it('reads a percentage with or without the sign, to two decimals', () => {
    expect(parsePercent('5')).toBe(5)
    expect(parsePercent(' 2.5 % ')).toBe(2.5)
    expect(parsePercent('0')).toBe(0)
    expect(parsePercent('100')).toBe(100)
    expect(parsePercent('')).toBeNull()
    for (const bad of ['five', '-5', '2.555', '5%%', '1e2', '.5']) expect(parsePercent(bad)).toBeNaN()
  })
  it('reads whole days, with or without the word', () => {
    expect(parseDays('30')).toBe(30)
    expect(parseDays(' 45 days ')).toBe(45)
    expect(parseDays('1 day')).toBe(1)
    expect(parseDays('14d')).toBe(14)
    expect(parseDays('0')).toBe(0)
    expect(parseDays('  ')).toBeNull()
    for (const bad of ['30.5', '-30', 'thirty', '30 weeks', '1e2']) expect(parseDays(bad)).toBeNaN()
  })
  it('words them the same on both apps', () => {
    expect(retentionWords(0)).toBe('None')
    expect(retentionWords(5)).toBe('5%')
    expect(retentionWords(2.5)).toBe('2.5%')
    expect(termsWords(30)).toBe('30 days')
    expect(termsWords(1)).toBe('1 day')
  })
})

// ------------------------------------------------------------------ the form

describe('contractDraftOf', () => {
  it('opens blank with nothing on file, and as filed otherwise', () => {
    expect(contractDraftOf(null)).toEqual(BLANK_CONTRACT)
    expect(contractDraftOf({ ...ON_FILE, contract_sum: 52800.5, gst_inclusive: true, order_no: null })).toEqual({
      contractValue: '52800.50',
      contractGstInclusive: true,
      contractNo: 'C-2291',
      orderNo: '',
      retentionPct: '5',
      paymentTermsDays: '45',
    })
  })
})

describe('contractProblems', () => {
  it('accepts blank boxes and good values', () => {
    expect(contractProblems(BLANK_CONTRACT, null, { tried: true })).toEqual({})
    expect(contractProblems(typed({ contractValue: '$48,500', contractNo: 'C-1', orderNo: 'PO 1', retentionPct: '5%', paymentTermsDays: '30 days' }), null, { tried: true })).toEqual({})
    expect(contractProblems(typed({ contractValue: '0', retentionPct: '100', paymentTermsDays: '365' }), null, { tried: true })).toEqual({})
  })

  it('refuses retention outside 0 to 100, and terms that are not whole days', () => {
    expect(contractProblems(typed({ retentionPct: 'five' }), null)).toEqual({ retentionPct: expect.stringMatching(/percentage, like 5/) })
    expect(contractProblems(typed({ retentionPct: '120' }), null)).toEqual({ retentionPct: 'Retention is a percentage from 0 to 100.' })
    expect(contractProblems(typed({ retentionPct: '-5' }), null).retentionPct).toBeTruthy()
    expect(contractProblems(typed({ paymentTermsDays: '30.5' }), null)).toEqual({ paymentTermsDays: expect.stringMatching(/whole number of days/) })
    expect(contractProblems(typed({ paymentTermsDays: '400' }), null)).toEqual({ paymentTermsDays: 'Payment terms are at most 365 days.' })
    expect(contractProblems(typed({ contractValue: 'lots' }), null)).toEqual({ contractValue: expect.stringMatching(/amount of dollars/) })
  })

  it('refuses a contract or order number longer than any real one', () => {
    const long = 'x'.repeat(81)
    expect(contractProblems(typed({ contractNo: long, orderNo: long }), null)).toEqual({ contractNo: expect.stringMatching(/at most 80/), orderNo: expect.stringMatching(/at most 80/) })
    expect(contractProblems(typed({ contractNo: ` ${'x'.repeat(80)} ` }), null)).toEqual({})
  })

  it('asks for 0, not a blank, in place of a value on file, as it is typed', () => {
    expect(contractProblems(contractDraftOf(ON_FILE), ON_FILE)).toEqual({})
    expect(contractProblems({ ...contractDraftOf(ON_FILE), contractValue: ' ' }, ON_FILE)).toEqual({ contractValue: 'Type 0 to show the job has no contract value.' })
  })

  it('asks for the value of a new contract only once Save is pressed', () => {
    const details = typed({ contractNo: 'C-1' })
    expect(contractProblems(details, null)).toEqual({})
    expect(contractProblems(details, null, { tried: true })).toEqual({ contractValue: expect.stringMatching(/Type the contract value as well/) })
    for (const k of ['orderNo', 'retentionPct', 'paymentTermsDays'] as const) {
      expect(contractProblems(typed({ [k]: '5' }), null, { tried: true }).contractValue).toMatch(/as well/)
    }
    // Nothing typed is no contract, unless one is being added.
    expect(contractProblems(typed({ contractGstInclusive: true }), null, { tried: true })).toEqual({})
    expect(contractProblems(BLANK_CONTRACT, null, { tried: true, required: true })).toEqual({ contractValue: 'Type the contract value.' })
    expect(contractProblems(BLANK_CONTRACT, null, { required: true })).toEqual({})
  })
})

describe('contractEditOf', () => {
  it('is nothing when nothing was typed or nothing changed', () => {
    expect(contractEditOf(BLANK_CONTRACT, null)).toBeNull()
    expect(contractEditOf(typed({ contractGstInclusive: true }), null)).toBeNull()
    expect(contractEditOf(contractDraftOf(ON_FILE), ON_FILE)).toBeNull()
    // The same values typed another way are not a change.
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), contractValue: '$48,500.00', contractNo: ' C-2291 ', retentionPct: '5%', paymentTermsDays: '45 days' }, ON_FILE)).toBeNull()
  })

  it('is nothing while anything is refused', () => {
    expect(contractEditOf(typed({ contractValue: '48500', retentionPct: '120' }), null)).toBeNull()
    expect(contractEditOf(typed({ contractNo: 'C-1' }), null)).toBeNull()
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), contractValue: '' }, ON_FILE)).toBeNull()
  })

  it('makes a new contract from what was typed, leaving blanks to the defaults', () => {
    expect(contractEditOf(typed({ contractValue: '48,500' }), null)).toEqual({ sum: 48500, gstInclusive: false })
    expect(contractEditOf(typed({ contractValue: '52800.5', contractGstInclusive: true, contractNo: ' C-2291 ', orderNo: 'PO 88401', retentionPct: '5', paymentTermsDays: '14' }), null)).toEqual({
      sum: 52800.5,
      gstInclusive: true,
      contractNo: 'C-2291',
      orderNo: 'PO 88401',
      retentionPct: 5,
      paymentTermsDays: 14,
    })
  })

  it('changes only what differs from what is on file', () => {
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), contractNo: 'C-2292' }, ON_FILE)).toEqual({ contractNo: 'C-2292' })
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), retentionPct: '2.5', paymentTermsDays: '30' }, ON_FILE)).toEqual({ retentionPct: 2.5, paymentTermsDays: 30 })
  })

  it('writes the value and its GST basis together, as one fact', () => {
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), contractGstInclusive: true }, ON_FILE)).toEqual({ sum: 48500, gstInclusive: true })
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), contractValue: '50000' }, ON_FILE)).toEqual({ sum: 50000, gstInclusive: false })
  })

  it('reads a cleared box as not set: no number, no retention, 30 days', () => {
    expect(contractEditOf({ ...contractDraftOf(ON_FILE), contractNo: '', orderNo: ' ', retentionPct: '', paymentTermsDays: '' }, ON_FILE)).toEqual({
      contractNo: null,
      orderNo: null,
      retentionPct: 0,
      paymentTermsDays: 30,
    })
    // Already not set: clearing the box again changes nothing.
    const bare: JobContract = { ...ON_FILE, contract_no: null, order_no: null, retention_pct: 0, payment_terms_days: 30 }
    expect(contractEditOf({ ...contractDraftOf(bare), retentionPct: '', paymentTermsDays: '' }, bare)).toBeNull()
  })
})

// ------------------------------------------------------------------ reading and writing

describe('loadContract', () => {
  it("reads the job's row, or null when there is none", async () => {
    const { client, calls } = fake(() => ({ data: [row({ contract_sum: '48500.00', retention_pct: '5.00', contract_no: 'C-2291' })] }))
    expect(await loadContract('site-1', client)).toEqual({ id: 'k-1', contract_sum: 48500, gst_inclusive: false, contract_no: 'C-2291', order_no: null, retention_pct: 5, payment_terms_days: 30 })
    expect(calls[0]).toMatchObject({ op: 'select', filters: [['site_id', 'site-1']] })
    expect(calls[0]!.cols).toMatch(/contract_no.*order_no.*retention_pct.*payment_terms_days/)
    const none = fake(() => ({ data: [] }))
    expect(await loadContract('site-1', none.client)).toBeNull()
  })

  it('throws when the read fails, rather than calling it no contract', async () => {
    const { client } = fake(() => ({ error: { message: 'JWT expired' } }))
    await expect(loadContract('site-1', client)).rejects.toThrow(/JWT expired/)
  })
})

describe('saveContract', () => {
  it('changes only the two figures on a job that has a row', async () => {
    const { client, calls } = fake((op, p) => (op === 'update' ? { data: [row(p as Record<string, unknown>)] } : { data: [] }))
    const out = await saveContract(SITE, { sum: 48500, gstInclusive: false }, client)
    expect(out).toMatchObject({ id: 'k-1', contract_sum: 48500, gst_inclusive: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ op: 'update', payload: { contract_sum: 48500, gst_inclusive: false }, filters: [['site_id', 'site-1']] })
  })

  it('changes only the details it is given, and never the value with them', async () => {
    const { client, calls } = fake((_op, p) => ({ data: [row({ contract_sum: 48500, ...(p as object) })] }))
    const out = await saveContract(SITE, { contractNo: ' C-2291 ', orderNo: null, retentionPct: 2.55, paymentTermsDays: 14 }, client)
    expect(calls[0]!.payload).toEqual({ contract_no: 'C-2291', order_no: null, retention_pct: 2.55, payment_terms_days: 14 })
    expect(out).toEqual({ id: 'k-1', contract_sum: 48500, gst_inclusive: false, contract_no: 'C-2291', order_no: null, retention_pct: 2.55, payment_terms_days: 14 })
  })

  it('makes a row for the job and its builder when there is none', async () => {
    const { client, calls } = fake((op, p) => (op === 'update' ? { data: [] } : { data: [row({ id: 'k-2', ...(p as object) })] }))
    const out = await saveContract(SITE, { sum: 52800, gstInclusive: true }, client)
    expect(out).toMatchObject({ id: 'k-2', contract_sum: 52800, gst_inclusive: true })
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert'])
    expect(calls[1]!.payload).toEqual({ company_id: 'co-1', site_id: 'site-1', builder_id: 'b-1', contract_sum: 52800, gst_inclusive: true })
  })

  it('makes a new row with its details, the blanks left to the defaults', async () => {
    const { client, calls } = fake((op, p) => (op === 'update' ? { data: [] } : { data: [row({ id: 'k-5', ...(p as object) })] }))
    const out = await saveContract(SITE, { sum: 1000, gstInclusive: false, contractNo: 'C-9', retentionPct: 5 }, client)
    expect(calls[1]!.payload).toEqual({ company_id: 'co-1', site_id: 'site-1', builder_id: 'b-1', contract_sum: 1000, gst_inclusive: false, contract_no: 'C-9', retention_pct: 5 })
    expect(out).toEqual({ id: 'k-5', contract_sum: 1000, gst_inclusive: false, contract_no: 'C-9', order_no: null, retention_pct: 5, payment_terms_days: 30 })
  })

  it('never makes a contract without its value', async () => {
    const { client, calls } = fake(() => ({ data: [] }))
    await expect(saveContract(SITE, { contractNo: 'C-1' }, client)).rejects.toThrow(/no contract on file/)
    expect(calls.map((c) => c.op)).toEqual(['update'])
  })

  it('changes the row made in between when the insert finds one already there', async () => {
    let updates = 0
    const { client, calls } = fake((op, p) => {
      if (op === 'insert') return { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      updates += 1
      return { data: updates === 1 ? [] : [row({ id: 'k-3', ...(p as object) })] }
    })
    const out = await saveContract(SITE, { sum: 1000, gstInclusive: false, paymentTermsDays: 7 }, client)
    expect(out.id).toBe('k-3')
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert', 'update'])
  })

  it('says so when the write is refused (no rows back)', async () => {
    const { client } = fake((op) => (op === 'insert' ? { error: { message: 'new row violates row-level security policy for table "contracts"', code: '42501' } } : { data: [] }))
    await expect(saveContract(SITE, { sum: 1000, gstInclusive: false }, client)).rejects.toThrow(/row-level security/)
    const quiet = fake(() => ({ data: [] }))
    await expect(saveContract(SITE, { sum: 1000, gstInclusive: false }, quiet.client)).rejects.toThrow(/refused/)
  })

  it('refuses what is not an amount, a percentage or whole days, before writing', async () => {
    const { client, calls } = fake(() => ({ data: [] }))
    await expect(saveContract(SITE, { sum: Number.NaN, gstInclusive: false }, client)).rejects.toThrow(/amount of dollars/)
    await expect(saveContract(SITE, { sum: -1, gstInclusive: false }, client)).rejects.toThrow(/amount of dollars/)
    await expect(saveContract(SITE, { retentionPct: 101 }, client)).rejects.toThrow(/0 to 100/)
    await expect(saveContract(SITE, { retentionPct: 2.555 }, client)).rejects.toThrow(/0 to 100/)
    await expect(saveContract(SITE, { paymentTermsDays: 30.5 }, client)).rejects.toThrow(/whole number of days/)
    await expect(saveContract(SITE, { paymentTermsDays: 366 }, client)).rejects.toThrow(/whole number of days/)
    await expect(saveContract(SITE, { contractNo: 'x'.repeat(81) }, client)).rejects.toThrow(/at most 80/)
    await expect(saveContract(SITE, {}, client)).rejects.toThrow(/nothing to save/)
    expect(calls).toHaveLength(0)
  })

  it('notices a value that read back different from what was sent', async () => {
    const { client } = fake(() => ({ data: [row({ id: 'k-4', contract_sum: 999 })] }))
    await expect(saveContract(SITE, { sum: 1000, gstInclusive: false }, client)).rejects.toThrow(/did not save as entered/)
  })

  it('notices a detail that read back different from what was sent', async () => {
    const { client } = fake(() => ({ data: [row({ contract_sum: 1000, retention_pct: 5, contract_no: 'C-1' })] }))
    await expect(saveContract(SITE, { retentionPct: 5, contractNo: 'C-2' }, client)).rejects.toThrow(/did not save as entered/)
  })
})
