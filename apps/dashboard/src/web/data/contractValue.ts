/**
 * The contract value: what the job is worth, the figure the phone's Money
 * tab measures the margin against.
 *
 * It is the job's row in `contracts` (schema_v17.sql: one per job, unique on
 * site_id; only an owner can read or write it). job_value_v takes
 * contract_sum and gst_inclusive from it, and job_profit_v, which the
 * Money tab reads, takes job_value_ex from that: the contract plus approved
 * variations, ex GST. A job with no row has no contract value.
 *
 * The old office dashboard's Contract tab kept the rest of that row too
 * (the builder's contract number, retention, payment terms, dates). This
 * writes only the two figures, so an existing row keeps everything else.
 */
import { supabase, type JobSiteRow } from '../phone'

type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

export interface ContractValue {
  id: string
  /** Dollars, as the contract states them. */
  contract_sum: number
  /** Whether that figure includes GST. */
  gst_inclusive: boolean
}

export const CONTRACT_VALUE_COLS = 'id, contract_sum, gst_inclusive'

/** contract_sum is numeric(14,2). */
export const CONTRACT_VALUE_MAX = 999_999_999_999.99

/**
 * What was typed, in dollars: "$48,500", "48500.5" and "48 500" all read.
 * Blank is null. Anything that is not a plain amount (letters, a minus sign,
 * two points, more than two decimals) is NaN, for the form to refuse.
 */
export function parseMoney(typed: string): number | null {
  const t = typed.trim()
  if (!t) return null
  const bare = t.replace(/^\$/, '').replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) return Number.NaN
  return Number(bare)
}

/** An amount as it goes back into the box: 48500, or 48500.50. */
export function moneyInput(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** "$48,500", or "$48,500.50" when there are cents. */
export function moneyWords(n: number): string {
  const cents = !Number.isInteger(n)
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }).format(n)
}

/** What the form says is wrong with a typed value, or null when it can be saved (blank included). */
export function contractValueProblem(typed: string): string | null {
  const n = parseMoney(typed)
  if (n === null) return null
  if (Number.isNaN(n)) return 'Type the contract value as an amount of dollars, like 48500 or 48,500.00.'
  if (n > CONTRACT_VALUE_MAX) return 'That is more than a contract value can be.'
  return null
}

const asValue = (r: unknown): ContractValue => {
  const x = r as { id: string; contract_sum: number | string; gst_inclusive: boolean }
  return { id: x.id, contract_sum: Number(x.contract_sum), gst_inclusive: x.gst_inclusive === true }
}

/** The job's contract value, or null when none has been entered. */
export async function loadContractValue(siteId: string, client?: Db): Promise<ContractValue | null> {
  const { data, error } = await db(client).from('contracts').select(CONTRACT_VALUE_COLS).eq('site_id', siteId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? asValue(data) : null
}

/**
 * Set a job's contract value. A job that has a row has only its two figures
 * changed; a job with none gets one, for the job's builder. Read back,
 * because RLS answers a refused write with no rows rather than an error.
 */
export async function saveContractValue(
  site: Pick<JobSiteRow, 'id' | 'company_id' | 'builder_id'>,
  value: { sum: number; gstInclusive: boolean },
  client?: Db,
): Promise<ContractValue> {
  if (!Number.isFinite(value.sum) || value.sum < 0 || value.sum > CONTRACT_VALUE_MAX) throw new Error('The contract value has to be an amount of dollars.')
  const c = db(client)
  const figures = { contract_sum: value.sum, gst_inclusive: value.gstInclusive }
  const update = async (): Promise<unknown> => {
    const { data, error } = await c.from('contracts').update(figures).eq('site_id', site.id).select(CONTRACT_VALUE_COLS)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown[])[0]
  }
  let row = await update()
  if (!row) {
    const { data, error } = await c
      .from('contracts')
      .insert({ company_id: site.company_id, site_id: site.id, builder_id: site.builder_id ?? null, ...figures })
      .select(CONTRACT_VALUE_COLS)
    if (error) {
      // Made somewhere else in between (one row per job): that row is the one to change.
      if (error.code !== '23505') throw new Error(error.message)
      row = await update()
    } else {
      row = ((data ?? []) as unknown[])[0]
    }
  }
  if (!row) throw new Error('Saving the contract value was refused. Only an owner login can set it.')
  const saved = asValue(row)
  if (saved.contract_sum !== value.sum || saved.gst_inclusive !== value.gstInclusive) throw new Error('The contract value did not save as entered.')
  return saved
}
