/**
 * A job's contract: the builder's head contract for one job. Both apps read
 * and write it through this file, the website's New job, Edit job and
 * Project card, and the phone's Money tab, so a contract reads, checks and
 * saves the same way on both.
 *
 * It is the job's row in `contracts` (schema_v17.sql: one per job, unique on
 * site_id; only the office can read or write it, current_is_office). This
 * file reads and writes six of its columns: the value (contract_sum) and
 * whether it includes GST, the builder's contract number and order number,
 * the retention and the payment terms. job_value_v takes contract_sum and
 * gst_inclusive from it, and job_profit_v, which the Money tab reads, takes
 * job_value_ex from that: the contract plus approved variations, ex GST. A
 * job with no row has no contract.
 *
 * A save writes only the columns it is given, and a form gives it only what
 * the person changed (contractEditOf), so the rest of the row (the dates,
 * the status, the note, anything another phone changed in the meantime) is
 * never written over. The value and its GST basis are one fact, so they are
 * always written together. Blank means not set: no contract or order number
 * (both columns allow null), and the column's own default for retention (0)
 * and payment terms (30 days). A new contract needs its value; the other
 * details are kept with it.
 *
 * Every write is read back: RLS answers a refused write with no rows, not
 * an error.
 */
import { supabase, type JobSiteRow } from './supabase'

type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

export interface JobContract {
  id: string
  /** Dollars, as the contract states them. */
  contract_sum: number
  /** Whether that figure includes GST. */
  gst_inclusive: boolean
  /** The builder's contract number. */
  contract_no: string | null
  /** The builder's purchase order number. */
  order_no: string | null
  /** Held from each claim until completion, as a percentage. */
  retention_pct: number
  /** Days from the invoice date until payment is due. */
  payment_terms_days: number
}

export const JOB_CONTRACT_COLS = 'id, contract_sum, gst_inclusive, contract_no, order_no, retention_pct, payment_terms_days'

/** contract_sum is numeric(14,2). */
export const CONTRACT_VALUE_MAX = 999_999_999_999.99
/** retention_pct's check: 0 to 100. */
export const RETENTION_MAX = 100
/** payment_terms_days' default, which a blank box means. */
export const TERMS_DEFAULT = 30
/** Longer than any builder's terms; mostly catches a typo. */
export const TERMS_MAX = 365
/** Room for any contract or order number, and none for a pasted paragraph. */
export const REF_MAX = 80

// ------------------------------------------------------------------ typing

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

/** What is wrong with a typed value, or null when it can be saved (blank included). */
export function contractValueProblem(typed: string): string | null {
  const n = parseMoney(typed)
  if (n === null) return null
  if (Number.isNaN(n)) return 'Type the contract value as an amount of dollars, like 48500 or 48,500.00.'
  if (n > CONTRACT_VALUE_MAX) return 'That is more than a contract value can be.'
  return null
}

/** A percentage as typed: "5", "2.5" and "5%" all read. Blank is null; anything else is NaN. */
export function parsePercent(typed: string): number | null {
  const t = typed.trim()
  if (!t) return null
  const bare = t.replace(/\s*%$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) return Number.NaN
  return Number(bare)
}

/** Whole days as typed: "30", "30 days" and "30d" all read. Blank is null; anything else is NaN. */
export function parseDays(typed: string): number | null {
  const t = typed.trim()
  if (!t) return null
  const m = /^(\d+)\s*(days?|d)?$/i.exec(t)
  return m ? Number(m[1]) : Number.NaN
}

/** "5%", "2.5%", or "None" for no retention. */
export function retentionWords(pct: number): string {
  return pct === 0 ? 'None' : `${pct}%`
}

/** "30 days", "1 day". */
export function termsWords(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`
}

const refOf = (v: string | null | undefined): string | null => (v ?? '').trim() || null

// ------------------------------------------------------------------ the form

/** The contract as typed into a form: '' is a blank box. Field names are the website form's. */
export interface ContractDraft {
  /** Dollars (parseMoney). */
  contractValue: string
  contractGstInclusive: boolean
  contractNo: string
  orderNo: string
  /** A percentage (parsePercent); blank is none. */
  retentionPct: string
  /** Whole days (parseDays); blank is 30. */
  paymentTermsDays: string
}

export type ContractField = 'contractValue' | 'contractNo' | 'orderNo' | 'retentionPct' | 'paymentTermsDays'
export type ContractProblems = Partial<Record<ContractField, string>>

export const BLANK_CONTRACT: ContractDraft = { contractValue: '', contractGstInclusive: false, contractNo: '', orderNo: '', retentionPct: '', paymentTermsDays: '' }

/** The boxes as they open: the contract on file, or blank. */
export function contractDraftOf(c: JobContract | null): ContractDraft {
  if (!c) return BLANK_CONTRACT
  return {
    contractValue: moneyInput(c.contract_sum),
    contractGstInclusive: c.gst_inclusive,
    contractNo: c.contract_no ?? '',
    orderNo: c.order_no ?? '',
    retentionPct: String(c.retention_pct),
    paymentTermsDays: String(c.payment_terms_days),
  }
}

/** Something typed besides the value (and its GST basis). */
const detailsTyped = (d: ContractDraft) => [d.contractNo, d.orderNo, d.retentionPct, d.paymentTermsDays].some((v) => v.trim() !== '')

/**
 * What is wrong, field by field; empty when the boxes can be saved as they
 * are. `onFile` is the contract the boxes opened with.
 *
 * Before the first Save (`tried` false) it says only what is wrong whatever
 * is typed next: an amount, a percentage or a number of days that is not
 * one, one out of range, and a value on file taken out (a value on file is
 * changed, not removed: the row holds more than these boxes). After it, it
 * also asks for the value a new contract needs: always when `required` (the
 * phone's Add the contract), and otherwise when other details were typed.
 */
export function contractProblems(d: ContractDraft, onFile: JobContract | null, opts: { tried?: boolean; required?: boolean } = {}): ContractProblems {
  const out: ContractProblems = {}
  const money = contractValueProblem(d.contractValue)
  if (money) out.contractValue = money
  else if (!d.contractValue.trim()) {
    if (onFile) out.contractValue = 'Type 0 to show the job has no contract value.'
    else if (opts.tried && opts.required) out.contractValue = 'Type the contract value.'
    else if (opts.tried && detailsTyped(d)) out.contractValue = 'Type the contract value as well. The other details are kept with it.'
  }
  if (d.contractNo.trim().length > REF_MAX) out.contractNo = `A contract number is at most ${REF_MAX} characters.`
  if (d.orderNo.trim().length > REF_MAX) out.orderNo = `An order number is at most ${REF_MAX} characters.`
  const pct = parsePercent(d.retentionPct)
  if (pct !== null && Number.isNaN(pct)) out.retentionPct = 'Type the retention as a percentage, like 5 or 2.5.'
  else if (pct !== null && pct > RETENTION_MAX) out.retentionPct = 'Retention is a percentage from 0 to 100.'
  const days = parseDays(d.paymentTermsDays)
  if (days !== null && Number.isNaN(days)) out.paymentTermsDays = 'Type the payment terms as a whole number of days, like 30.'
  else if (days !== null && days > TERMS_MAX) out.paymentTermsDays = `Payment terms are at most ${TERMS_MAX} days.`
  return out
}

/** What a save writes: only the columns given. */
export interface ContractEdit {
  sum?: number
  gstInclusive?: boolean
  /** Null takes it off. */
  contractNo?: string | null
  orderNo?: string | null
  retentionPct?: number
  paymentTermsDays?: number
}

/**
 * The save for what the boxes say, or null when there is nothing to save
 * (nothing changed, nothing typed, or something contractProblems refuses).
 *
 * With a contract on file, only what differs from it: the value and its GST
 * basis together when either changed, and each other detail on its own, a
 * blank one as not set (no number, no retention, 30 days). With none, a new
 * contract: the value, its GST basis and whatever else was typed, the rest
 * left to the columns' defaults.
 */
export function contractEditOf(d: ContractDraft, onFile: JobContract | null): ContractEdit | null {
  if (Object.keys(contractProblems(d, onFile, { tried: true })).length) return null
  const sum = parseMoney(d.contractValue)
  const pct = parsePercent(d.retentionPct)
  const days = parseDays(d.paymentTermsDays)
  const edit: ContractEdit = {}
  if (!onFile) {
    if (sum === null) return null
    edit.sum = sum
    edit.gstInclusive = d.contractGstInclusive
    if (refOf(d.contractNo)) edit.contractNo = refOf(d.contractNo)
    if (refOf(d.orderNo)) edit.orderNo = refOf(d.orderNo)
    if (pct !== null) edit.retentionPct = pct
    if (days !== null) edit.paymentTermsDays = days
    return edit
  }
  if (sum !== null && (sum !== onFile.contract_sum || d.contractGstInclusive !== onFile.gst_inclusive)) {
    edit.sum = sum
    edit.gstInclusive = d.contractGstInclusive
  }
  if (refOf(d.contractNo) !== refOf(onFile.contract_no)) edit.contractNo = refOf(d.contractNo)
  if (refOf(d.orderNo) !== refOf(onFile.order_no)) edit.orderNo = refOf(d.orderNo)
  if ((pct ?? 0) !== onFile.retention_pct) edit.retentionPct = pct ?? 0
  if ((days ?? TERMS_DEFAULT) !== onFile.payment_terms_days) edit.paymentTermsDays = days ?? TERMS_DEFAULT
  return Object.keys(edit).length ? edit : null
}

// ------------------------------------------------------------------ reading and writing

type Row = Record<string, unknown>

const asContract = (r: unknown): JobContract => {
  const x = r as Row
  return {
    id: String(x.id),
    contract_sum: Number(x.contract_sum),
    gst_inclusive: x.gst_inclusive === true,
    contract_no: refOf(x.contract_no as string | null),
    order_no: refOf(x.order_no as string | null),
    retention_pct: Number(x.retention_pct),
    payment_terms_days: Number(x.payment_terms_days),
  }
}

/** The columns for an edit, checked: a save never sends what a form would refuse. */
function columnsOf(edit: ContractEdit): Row {
  const cols: Row = {}
  if (edit.sum !== undefined) {
    if (!Number.isFinite(edit.sum) || edit.sum < 0 || edit.sum > CONTRACT_VALUE_MAX) throw new Error('The contract value has to be an amount of dollars.')
    cols.contract_sum = edit.sum
  }
  if (edit.gstInclusive !== undefined) cols.gst_inclusive = edit.gstInclusive === true
  for (const [key, col, what] of [
    ['contractNo', 'contract_no', 'A contract number'],
    ['orderNo', 'order_no', 'An order number'],
  ] as const) {
    if (edit[key] === undefined) continue
    const ref = refOf(edit[key])
    if (ref && ref.length > REF_MAX) throw new Error(`${what} is at most ${REF_MAX} characters.`)
    cols[col] = ref
  }
  if (edit.retentionPct !== undefined) {
    const p = edit.retentionPct
    // numeric(5,2): two decimals at most (2.55 * 100 is 254.99999999999997, hence the tolerance).
    if (!Number.isFinite(p) || p < 0 || p > RETENTION_MAX || Math.abs(Math.round(p * 100) - p * 100) > 1e-6) throw new Error('Retention is a percentage from 0 to 100.')
    cols.retention_pct = p
  }
  if (edit.paymentTermsDays !== undefined) {
    const t = edit.paymentTermsDays
    if (!Number.isInteger(t) || t < 0 || t > TERMS_MAX) throw new Error(`Payment terms are a whole number of days, up to ${TERMS_MAX}.`)
    cols.payment_terms_days = t
  }
  return cols
}

/** The job's contract, or null when none has been entered. */
export async function loadContract(siteId: string, client?: Db): Promise<JobContract | null> {
  const { data, error } = await db(client).from('contracts').select(JOB_CONTRACT_COLS).eq('site_id', siteId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? asContract(data) : null
}

/**
 * Save a job's contract: the columns in `edit`, and nothing else. A job that
 * has a row has those columns changed; a job with none gets one, for the
 * job's builder, which needs the value. Read back, because RLS answers a
 * refused write with no rows rather than an error; a column that reads back
 * other than as sent is an error too.
 */
export async function saveContract(site: Pick<JobSiteRow, 'id' | 'company_id' | 'builder_id'>, edit: ContractEdit, client?: Db): Promise<JobContract> {
  const cols = columnsOf(edit)
  if (Object.keys(cols).length === 0) throw new Error('There is nothing to save.')
  const c = db(client)
  const update = async (): Promise<unknown> => {
    const { data, error } = await c.from('contracts').update(cols).eq('site_id', site.id).select(JOB_CONTRACT_COLS)
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown[])[0]
  }
  let row = await update()
  if (!row) {
    // Nothing to update: a new contract, which is its value first of all.
    if (cols.contract_sum === undefined) throw new Error('This job has no contract on file now. Add it again, with its value.')
    const { data, error } = await c
      .from('contracts')
      .insert({ company_id: site.company_id, site_id: site.id, builder_id: site.builder_id ?? null, ...cols })
      .select(JOB_CONTRACT_COLS)
    if (error) {
      // Made somewhere else in between (one row per job): that row is the one to change.
      if (error.code !== '23505') throw new Error(error.message)
      row = await update()
    } else {
      row = ((data ?? []) as unknown[])[0]
    }
  }
  if (!row) throw new Error('Saving the contract was refused. Only an owner login can change it.')
  const saved = asContract(row)
  const back = saved as unknown as Row
  const off = Object.keys(cols).filter((k) => (typeof cols[k] === 'number' ? Number(back[k]) !== cols[k] : back[k] !== cols[k]))
  if (off.length) throw new Error('The contract did not save as entered.')
  return saved
}
