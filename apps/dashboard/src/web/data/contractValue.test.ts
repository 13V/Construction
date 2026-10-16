import { describe, expect, it } from 'vitest'
import { contractValueProblem, moneyInput, moneyWords, parseMoney, saveContractValue } from './contractValue'

type Answer = { data?: unknown; error?: { message: string; code?: string } | null }

/** A client that records each call and answers from `reply`, by operation. */
function fake(reply: (op: string, payload: unknown) => Answer) {
  const calls: Array<{ op: string; payload: unknown; filters: unknown[] }> = []
  const client = {
    from(table: string) {
      expect(table).toBe('contracts')
      const call = { op: 'select', payload: undefined as unknown, filters: [] as unknown[] }
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
        select() {
          return chain
        },
        then(ok: (a: Answer) => unknown, bad?: (e: unknown) => unknown) {
          calls.push(call)
          return Promise.resolve(reply(call.op, call.payload)).then(ok, bad)
        },
      }
      return chain
    },
  }
  return { client: client as never, calls }
}

const SITE = { id: 'site-1', company_id: 'co-1', builder_id: 'b-1' }

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

describe('saveContractValue', () => {
  it('changes only the two figures on a job that has a row', async () => {
    const { client, calls } = fake((op, p) => (op === 'update' ? { data: [{ id: 'k-1', ...(p as object) }] } : { data: [] }))
    const out = await saveContractValue(SITE, { sum: 48500, gstInclusive: false }, client)
    expect(out).toEqual({ id: 'k-1', contract_sum: 48500, gst_inclusive: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ op: 'update', payload: { contract_sum: 48500, gst_inclusive: false }, filters: [['site_id', 'site-1']] })
  })

  it('makes a row for the job and its builder when there is none', async () => {
    const { client, calls } = fake((op, p) => (op === 'update' ? { data: [] } : { data: [{ id: 'k-2', ...(p as object) }] }))
    const out = await saveContractValue(SITE, { sum: 52800, gstInclusive: true }, client)
    expect(out).toEqual({ id: 'k-2', contract_sum: 52800, gst_inclusive: true })
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert'])
    expect(calls[1]!.payload).toEqual({ company_id: 'co-1', site_id: 'site-1', builder_id: 'b-1', contract_sum: 52800, gst_inclusive: true })
  })

  it('changes the row made in between when the insert finds one already there', async () => {
    let updates = 0
    const { client, calls } = fake((op, p) => {
      if (op === 'insert') return { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
      updates += 1
      return { data: updates === 1 ? [] : [{ id: 'k-3', ...(p as object) }] }
    })
    const out = await saveContractValue(SITE, { sum: 1000, gstInclusive: false }, client)
    expect(out.id).toBe('k-3')
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert', 'update'])
  })

  it('says so when the write is refused (no rows back)', async () => {
    const { client } = fake((op) => (op === 'insert' ? { error: { message: 'new row violates row-level security policy for table "contracts"', code: '42501' } } : { data: [] }))
    await expect(saveContractValue(SITE, { sum: 1000, gstInclusive: false }, client)).rejects.toThrow(/row-level security/)
  })

  it('refuses an amount that is not one, before writing', async () => {
    const { client, calls } = fake(() => ({ data: [] }))
    await expect(saveContractValue(SITE, { sum: Number.NaN, gstInclusive: false }, client)).rejects.toThrow(/amount of dollars/)
    await expect(saveContractValue(SITE, { sum: -1, gstInclusive: false }, client)).rejects.toThrow(/amount of dollars/)
    expect(calls).toHaveLength(0)
  })

  it('notices a value that read back different from what was sent', async () => {
    const { client } = fake(() => ({ data: [{ id: 'k-4', contract_sum: 999, gst_inclusive: false }] }))
    await expect(saveContractValue(SITE, { sum: 1000, gstInclusive: false }, client)).rejects.toThrow(/did not save as entered/)
  })
})
