/**
 * A job's money, read and worked out exactly as the phone's Money tab does
 * it (worker/simple/Job.tsx MoneyTab), and a cost or a supplier invoice
 * saved exactly as the phone's ReceiptScreen saves one (worker/WorkerApp.tsx).
 *
 * Neither is exported by the phone, and a phone file cannot change for the
 * website's sake, so the rules are copied here and money.test.ts runs the
 * phone's own source beside them: the same ten reads, the same arithmetic on
 * the same rows, the same words, the same expenses row, the same file in the
 * same bucket, the same reader. Change the phone and the test names what to
 * bring into line.
 *
 * What the website adds, all of it beside the phone's figures rather than
 * instead of them:
 *  - the flood-test hold read for this job alone. The phone counts the same
 *    rows company-wide (useSimpleData's floodHold) and looks the job up.
 *  - the contracts row itself, for the Contract card.
 *  - what is behind a line, from the rows the phone already reads: the hours
 *    behind a wage, the invoice number behind a claim, the date, GST and file
 *    behind an expense (the expenses read asks for those three columns too).
 *  - a read that fails says so, where the phone shows nothing. And
 *    job_profit_v has a row for every job the office can see, so no row at
 *    all means this login cannot see the job's money, not "no contract".
 *  - shifts are read a page at a time. The phone's read stops at the
 *    server's 1,000 rows, which on a long job leaves hours off the wage
 *    lines; the wage total, from job_profit_v, is whole on both.
 *  - a receipt the reader cannot take (not a JPEG, PNG, WebP, GIF or PDF, or
 *    too big for it) is still filed, but not sent to be read.
 */
import { WEB_BRAND } from '../marker'
import { api, BUCKET_RECEIPTS, objectPath, removeFile, signedUrl, supabase, uploadFile, viewFile, type WorkerRow } from '../phone'
import { allRows } from './bookings'

export type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

// ------------------------------------------------------------ the phone's words

/** Whole dollars, as the phone prints every figure on its Money tab (Job.tsx money). */
export const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(v))

/** "12 Oct", a claim's date on the phone (Job.tsx shortDate). */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

/** "Two" wet areas (Job.tsx countWord). */
export const countWord = (n: number) =>
  ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'][n] ?? String(n)

/** The phone's first sentence when a job has no contract value (Job.tsx MoneyTab). */
export const NO_CONTRACT = 'No contract value for this job yet.'

/** The phone's last sentence on the tab: who sees it. */
export const OFFICE_ONLY = 'Only owners and the office see this tab.'

/** "$48,500", or "$48,500.50" when there are cents: an amount as a contract or an invoice states it. */
export function amountWords(n: number): string {
  const cents = !Number.isInteger(n)
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }).format(n)
}

/**
 * What was typed, in dollars: "$1,100.50", "1100.5" and "1 100" all read.
 * Blank is null. Anything that is not a plain amount (letters, a minus sign,
 * two points, more than two decimals) is NaN, for the form to refuse.
 */
export function parseAmount(typed: string): number | null {
  const t = typed.trim()
  if (!t) return null
  const bare = t.replace(/^\$/, '').replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) return Number.NaN
  return Number(bare)
}

/** "15 Oct 2026": a whole date on the website. A bare date is a local day, not UTC midnight. */
export const dateWords = (v: string) =>
  new Date(v.length > 10 ? v : `${v}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

// ------------------------------------------------------------ the reads

/** job_profit_v as the phone reads it (Job.tsx ProfitRow). Ex GST throughout. */
export interface ProfitRow {
  /** Null when no contract value has been entered for the job. */
  contract_id: string | null
  contract_sum_ex: number | null
  approved_variations: number | null
  job_value_ex: number | null
  claimed_ex: number | null
  labour_hours: number | null
  labour_cost: number | null
  material_cost: number | null
  expense_cost: number | null
  sublet_cost: number | null
  margin_pct: number | null
}

export interface InvoiceRead {
  invoice_no: string
  period: string | null
  issued_on: string
  ex_tax: number
}
export interface VariationRead {
  description: string
  cost_impact: number
}
export interface MaterialRead {
  name: string
  supplier: string | null
  total_cost: number
  cost_code: string | null
}
/** The phone's four columns, then the three the website shows beside them (EXPENSE_EXTRA). */
export interface ExpenseRead {
  vendor: string
  category: string | null
  amount: number
  tax: number
  id?: string
  spent_on?: string | null
  receipt_path?: string | null
}
export interface SubcontractRead {
  cost: number
  /** The embed's shape depends on whether the client knows the FK is many-to-one; the phone takes both. */
  subcontractors: { name: string } | Array<{ name: string }> | null
}
export interface ShiftRead {
  worker_id: string
  started_at: string
  ended_at: string | null
  break_minutes: number | null
}
export interface CrewRead {
  id: string
  name: string
  trade: string | null
  role: string
}
export interface PayRead {
  worker_id: string
  rate: number
}
export interface WetRead {
  site_id: string
  area: string
  status: string
  flood_tested: boolean
}

/** The contracts row, for the Contract card. Office only, like everything here. */
export interface ContractCardRow {
  id: string
  contract_no: string | null
  order_no: string | null
  contract_sum: number
  gst_inclusive: boolean
  retention_pct: number
  payment_terms_days: number
  signed_on: string | null
  starts_on: string | null
  due_on: string | null
}
export const CONTRACT_CARD_COLS = 'id, contract_no, order_no, contract_sum, gst_inclusive, retention_pct, payment_terms_days, signed_on, starts_on, due_on'

/** What the website asks of each expense beyond the phone's four columns: when, and the file. */
export const EXPENSE_EXTRA = 'id, spent_on, receipt_path'

/** Everything the tab reads, as it came back. */
export interface MoneyReads {
  row: ProfitRow | null
  progress: { pct_complete: number | null } | null
  invoices: InvoiceRead[]
  variations: VariationRead[]
  materials: MaterialRead[]
  expenses: ExpenseRead[]
  subcontracts: SubcontractRead[]
  shifts: ShiftRead[]
  crew: CrewRead[]
  pay: PayRead[]
  /** Wet areas covered with no flood test, on this job. */
  wet: WetRead[]
  contract: ContractCardRow | null
}

/** What each read is, in the order loadMoney makes them, for a message that says which one failed. */
const READ_NAMES = [
  'the job’s figures',
  'progress',
  'claims',
  'variations',
  'materials',
  'costs',
  'subcontract work',
  'hours worked',
  'the crew',
  'pay rates',
  'waterproofing',
  'the contract',
]

type Answer = { data: unknown; error: { message: string } | null }

/**
 * Every read the tab needs, at once. The first ten are the phone's, in the
 * phone's order and with its filters (money.test.ts runs both); then the
 * flood-test hold and the contract row.
 *
 * Throws when any read fails, naming it: a missing read would otherwise show
 * as a total that is too small, which is worse than no total.
 */
export async function loadMoney(siteId: string, client?: Db): Promise<MoneyReads> {
  const c = db(client)
  const [p, pr, inv, co, mt, ex, sw, sh, cv, pay, wp, k] = (await Promise.all([
    c.from('job_profit_v').select('*').eq('site_id', siteId).maybeSingle(),
    c.from('site_progress_v').select('pct_complete').eq('site_id', siteId).maybeSingle(),
    c.from('invoices').select('invoice_no, period, issued_on, ex_tax').eq('site_id', siteId).in('status', ['sent', 'paid']).order('issued_on', { ascending: false }),
    c.from('change_orders').select('description, cost_impact').eq('site_id', siteId).eq('status', 'pending_client'),
    c.from('materials').select('name, supplier, total_cost, cost_code').eq('site_id', siteId).neq('status', 'returned'),
    c.from('expenses').select(`vendor, category, amount, tax, ${EXPENSE_EXTRA}`).eq('site_id', siteId),
    c.from('subcontract_work').select('cost, subcontractors(name)').eq('site_id', siteId),
    // Paged, ordered by id so the pages do not overlap; the phone's own read
    // is the same rows without the order, up to the server's 1,000.
    allRows<ShiftRead>((from, to) =>
      c.from('shifts').select('worker_id, started_at, ended_at, break_minutes').eq('site_id', siteId).not('ended_at', 'is', null).order('id').range(from, to),
    ).then(
      (data): Answer => ({ data, error: null }),
      (e: unknown): Answer => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }),
    ),
    c.from('crew_v').select('id, name, trade, role'),
    c.from('worker_pay').select('worker_id, rate'),
    c.from('waterproofing').select('site_id, area, status, flood_tested').in('status', ['complete', 'signed_off']).eq('flood_tested', false).eq('site_id', siteId),
    c.from('contracts').select(CONTRACT_CARD_COLS).eq('site_id', siteId).maybeSingle(),
  ])) as Answer[]

  const answers = [p, pr, inv, co, mt, ex, sw, sh, cv, pay, wp, k]
  const bad = answers.findIndex((a) => a?.error)
  if (bad >= 0) throw new Error(`Could not read ${READ_NAMES[bad]}: ${answers[bad]!.error!.message}`)

  const list = <T>(a: Answer) => ((a.data as T[] | null) ?? []) as T[]
  return {
    row: (p!.data as ProfitRow | null) ?? null,
    progress: (pr!.data as { pct_complete: number | null } | null) ?? null,
    invoices: list<InvoiceRead>(inv!),
    variations: list<VariationRead>(co!),
    materials: list<MaterialRead>(mt!),
    expenses: list<ExpenseRead>(ex!),
    subcontracts: list<SubcontractRead>(sw!),
    shifts: list<ShiftRead>(sh!),
    crew: list<CrewRead>(cv!),
    pay: list<PayRead>(pay!),
    wet: list<WetRead>(wp!),
    contract: k!.data ? asContract(k!.data) : null,
  }
}

const asContract = (r: unknown): ContractCardRow => {
  const x = r as ContractCardRow
  return {
    ...x,
    contract_sum: Number(x.contract_sum),
    gst_inclusive: x.gst_inclusive === true,
    retention_pct: Number(x.retention_pct ?? 0),
    payment_terms_days: Number(x.payment_terms_days ?? 0),
  }
}

// ------------------------------------------------------------ what the phone keeps

/** One person's closed hours on the job and what they cost, as the phone works a wage line out. */
export interface WageLine {
  /** "Dean Papadopoulos · tiler", the phone's words. */
  k: string
  cost: number
  hours: number
  /** False when there is no pay rate on file (or it is $0), so the line costs nothing. */
  rated: boolean
}

/**
 * What the phone's MoneyTab keeps once its reads are back (its useEffect's
 * .then): the same values, plus what the website shows beside them (a
 * claim's invoice number, a wage line's hours, an expense's date and file).
 */
export interface MoneyState {
  row: ProfitRow | null
  donePct: number | null
  claims: Array<{ label: string; ex: number; invoiceNo: string; period: string | null }>
  pending: VariationRead[]
  mats: MaterialRead[]
  exps: ExpenseRead[]
  sublets: Array<{ name: string; cost: number }>
  wages: WageLine[]
  /** Covered wet areas with no flood test (useSimpleData's floodHold, for this job). */
  floodHoldCount: number
}

/** The phone's arithmetic on its reads, step for step (Job.tsx MoneyTab, the load). */
export function stateOf(r: MoneyReads): MoneyState {
  const donePct = r.progress?.pct_complete === undefined || r.progress?.pct_complete === null ? null : Number(r.progress.pct_complete)
  const claims = r.invoices.map((i) => ({
    label: `${i.period || i.invoice_no} · ${shortDate(i.issued_on)}`,
    ex: Number(i.ex_tax ?? 0),
    invoiceNo: i.invoice_no,
    period: i.period,
  }))
  const bySub = new Map<string, number>()
  for (const w of r.subcontracts) {
    const rel = w.subcontractors
    const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? 'Subcontractor'
    bySub.set(name, (bySub.get(name) ?? 0) + Number(w.cost ?? 0))
  }
  const sublets = [...bySub.entries()].map(([name, cost]) => ({ name, cost }))

  // Wages per person: closed shift hours × their rate.
  const rates = new Map(r.pay.map((p) => [p.worker_id, Number(p.rate)]))
  const people = new Map(r.crew.map((w) => [w.id, w]))
  const hours = new Map<string, number>()
  for (const s of r.shifts) {
    if (!s.ended_at) continue
    const h = Math.max(0, (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000 - (s.break_minutes ?? 0) / 60)
    hours.set(s.worker_id, (hours.get(s.worker_id) ?? 0) + h)
  }
  const wages: WageLine[] = []
  for (const [workerId, h] of hours) {
    const w = people.get(workerId)
    if (!w || h <= 0) continue
    const role = w.role === 'captain' ? 'crew captain' : (w.trade || 'crew').toLowerCase()
    const rate = rates.get(workerId) ?? 0
    wages.push({ k: `${w.name} · ${role}`, cost: h * rate, hours: h, rated: rate > 0 })
  }
  wages.sort((a, b) => b.cost - a.cost)

  return {
    row: r.row ?? null,
    donePct,
    claims,
    pending: r.variations,
    mats: r.materials,
    exps: r.expenses,
    sublets,
    wages,
    floodHoldCount: r.wet.length,
  }
}

// ------------------------------------------------------------ the figures

/** The phone's tones: red, amber, green, and a neutral grey for the claim band. */
export type Tone = 'r' | 'a' | 'g'
export type BanTone = Tone | 'n'

/** One line of a section: the phone's words and figure, and what the website shows under them. */
export interface MoneyLine {
  k: string
  v: string
  /** A second line in grey: hours, an invoice number, a date. */
  detail?: string
  /** The receipt or supplier invoice behind an expense, in the receipts bucket. */
  receiptPath?: string | null
}

export type SectionKey = 'claimed' | 'wages' | 'tiles' | 'mats' | 'vars'

/** One of the phone's five rows (Job.tsx MoneyRowData). */
export interface MoneySection {
  key: SectionKey
  k: string
  v: string
  note: string
  tone?: Tone
  lines: MoneyLine[]
  empty: string
  ban?: { text: string; tone: BanTone }
}

export interface MoneyFigures {
  /** Contract plus approved variations, ex GST: what the phone calls CONTRACT VALUE. */
  value: number
  claimed: number
  /** Claimed as a whole percentage of the value, or null with nothing to measure. */
  claimedPct: number | null
  /** Labour, materials, expenses and sublet labour, as job_profit_v counts them. */
  totalCost: number
  /** The value of the work done so far, or null with no progress figure. */
  earned: number | null
  /** MARGIN AT TODAY: earned less cost to date, over earned. */
  marginPct: number | null
  /** The phone's colour for it: green from 15%, amber from 8%, red below. */
  marginTone: Tone | null
  /** The claim band: Held, Nothing claimed yet, Ahead, In line or Behind. */
  ban?: { text: string; tone: BanTone }
  sections: MoneySection[]
}

/** The phone's colour for a margin (its marginFg): 15% and up green, 8% and up amber, under that red. */
export const marginToneOf = (marginPct: number | null): Tone | null =>
  marginPct === null ? null : marginPct >= 15 ? 'g' : marginPct >= 8 ? 'a' : 'r'

const hoursWords = (h: number) => {
  const x = Math.round(h * 10) / 10
  return `${x} hour${x === 1 ? '' : 's'}`
}

const expenseDetail = (e: ExpenseRead) => {
  const parts = [e.spent_on ? dateWords(e.spent_on) : null, Number(e.tax ?? 0) > 0 ? `${amountWords(Number(e.amount ?? 0))} inc GST` : null]
  return parts.filter(Boolean).join(' · ') || undefined
}

/**
 * Every figure, band and line on the phone's Money tab (Job.tsx MoneyTab,
 * from `const value` to `const rows`), worked out the same way.
 *
 * The phone shows none of it until there is a contract value; the website
 * shows the costs either way, and puts "no contract value" where the summary
 * would be. With no contract the value is 0, so nothing is measured against
 * it: no claimed %, no margin.
 */
export function figuresOf(st: MoneyState, now: Date = new Date()): MoneyFigures {
  const { row, donePct, claims, pending, mats, exps, sublets, wages, floodHoldCount } = st
  const value = Number(row?.job_value_ex ?? 0)
  const claimed = Number(row?.claimed_ex ?? 0)
  const claimedPct = value > 0 && claimed > 0 ? Math.round((claimed / value) * 100) : null
  // "Margin at today" is margin on work actually done: earned value less
  // cost to date, over earned value. With no progress figure there is
  // nothing earned to measure against, and the phone shows a dash.
  const totalCost = Number(row?.labour_cost ?? 0) + Number(row?.material_cost ?? 0) + Number(row?.expense_cost ?? 0) + Number(row?.sublet_cost ?? 0)
  const earned = donePct !== null && value > 0 ? (value * donePct) / 100 : null
  const marginPct = earned !== null && earned > 0 ? ((earned - totalCost) / earned) * 100 : null

  // The claim band, in the order the trade worries: a covered membrane with
  // no water test freezes claiming outright; then claimed against done.
  let ban: MoneySection['ban']
  if (floodHoldCount > 0) {
    ban = {
      tone: 'r',
      text: `HELD UNTIL SIGN-OFF — ${countWord(floodHoldCount)} wet area${floodHoldCount === 1 ? '' : 's'} signed off with no flood test. Nothing on this job can be claimed until ${floodHoldCount === 1 ? 'it is' : 'they are'} done.`,
    }
  } else if (claims.length === 0) {
    const month = now.toLocaleDateString('en-AU', { month: 'long' })
    ban = { tone: 'n', text: `NOTHING CLAIMED YET — First claim goes out at the end of ${month}, on whatever is measured then.` }
  } else if (claimedPct !== null && donePct !== null) {
    const d = Math.round(donePct)
    if (claimedPct > d) {
      ban = { tone: 'r', text: `CLAIMED AHEAD OF THE WORK — Claimed ${claimedPct}% against ${d}% done. That is the conversation a builder’s QS opens with.` }
    } else if (d - claimedPct <= 2) {
      ban = { tone: 'g', text: `CLAIMED IN LINE WITH THE WORK — Claimed ${claimedPct}% against ${d}% done. Nothing to explain at the next claim.` }
    } else {
      const gap = Math.round(((d / 100) * value - claimed) / 100) * 100
      ban = { tone: 'a', text: `BEHIND ON CLAIMING — Claimed ${claimedPct}% against ${d}% done. There is ${money(gap)} of finished work not yet claimed.` }
    }
  }

  const tileMats = mats.filter((m) => m.cost_code === 'tiles')
  const otherMats = mats.filter((m) => m.cost_code !== 'tiles')
  const tileSum = tileMats.reduce((a, m) => a + Number(m.total_cost ?? 0), 0)
  // A subcontractor's invoice lands in expenses with fuel and permits; its
  // category is the only clue, and it is labour bought in, so the phone
  // counts it with whoever else got paid to work the job.
  const subExps = exps.filter((e) => e.category === 'Subcontractor')
  const otherExps = exps.filter((e) => e.category !== 'Subcontractor')
  const subExpLines = subExps.map((e) => ({
    k: [e.vendor, e.category].filter(Boolean).join(' · '),
    cost: Number(e.amount ?? 0) - Number(e.tax ?? 0),
    detail: expenseDetail(e),
    receiptPath: e.receipt_path ?? null,
  }))
  const subExpSum = subExpLines.reduce((a, l) => a + l.cost, 0)
  const matLines: Array<{ k: string; cost: number; detail?: string; receiptPath?: string | null }> = [
    ...otherMats.map((m) => ({ k: [m.supplier, m.name].filter(Boolean).join(' · '), cost: Number(m.total_cost ?? 0) })),
    ...otherExps.map((e) => ({
      k: [e.vendor, e.category].filter(Boolean).join(' · '),
      cost: Number(e.amount ?? 0) - Number(e.tax ?? 0),
      detail: expenseDetail(e),
      receiptPath: e.receipt_path ?? null,
    })),
  ].sort((a, b) => b.cost - a.cost)
  const matSum = matLines.reduce((a, l) => a + l.cost, 0)
  const pendingSum = pending.reduce((a, v) => a + Number(v.cost_impact ?? 0), 0)
  const wageSum = Number(row?.labour_cost ?? 0) + Number(row?.sublet_cost ?? 0) + subExpSum
  const people = wages.length + sublets.length + subExpLines.length

  const sections: MoneySection[] = [
    {
      key: 'claimed',
      k: 'Claimed',
      v: claims.length ? money(claimed) : '—',
      note: claimedPct !== null ? `${claimedPct}% of the job` : claims.length ? 'claimed to date' : 'nothing claimed yet',
      lines: claims.map((c) => ({ k: c.label, v: money(c.ex), ...(c.period ? { detail: `Invoice ${c.invoiceNo}` } : null) })),
      empty: 'No claim has gone out yet.',
      ban,
    },
    {
      key: 'wages',
      k: 'Contractors & wages',
      v: wageSum > 0 ? money(wageSum) : '—',
      note: people > 0 ? `${people} people on the job` : 'nothing yet',
      lines: [
        ...wages.map((l) => ({ k: l.k, v: money(Math.round(l.cost)), detail: l.rated ? hoursWords(l.hours) : `${hoursWords(l.hours)}, no pay rate on file` })),
        ...sublets.map((x) => ({ k: x.name, v: money(Math.round(x.cost)), detail: 'Subcontract work' })),
        ...subExpLines.map((l) => ({ k: l.k, v: money(Math.round(l.cost)), detail: l.detail, receiptPath: l.receiptPath })),
      ],
      empty: 'Nobody has booked time to this job.',
    },
    {
      key: 'tiles',
      k: 'Tile supply',
      v: tileSum > 0 ? money(tileSum) : '—',
      note: tileMats.length > 0 ? `${tileMats.length} order${tileMats.length === 1 ? '' : 's'}` : 'nothing ordered',
      lines: tileMats.map((m) => ({ k: [m.supplier, m.name].filter(Boolean).join(' · '), v: money(Number(m.total_cost ?? 0)) })),
      empty: 'No tile ordered against this job.',
    },
    {
      key: 'mats',
      k: 'Materials & hire',
      v: matSum > 0 ? money(matSum) : '—',
      note: matLines.length > 0 ? `${matLines.length} line${matLines.length === 1 ? '' : 's'}` : 'nothing yet',
      lines: matLines.map((l) => ({ k: l.k, v: money(Math.round(l.cost)), ...(l.detail ? { detail: l.detail } : null), ...(l.receiptPath ? { receiptPath: l.receiptPath } : null) })),
      empty: 'No materials or hire booked.',
    },
    {
      key: 'vars',
      k: 'Variations',
      v: pendingSum > 0 ? money(pendingSum) : '—',
      note: pending.length > 0 ? `${pending.length} with the builder` : 'none raised',
      tone: pending.length > 0 ? 'a' : undefined,
      lines: pending.map((v) => ({ k: v.description, v: money(Number(v.cost_impact ?? 0)) })),
      empty: 'No variations raised on this job.',
    },
  ]

  return { value, claimed, claimedPct, totalCost, earned, marginPct, marginTone: marginToneOf(marginPct), ban, sections }
}

/** The figures read from the database, worked out: what MoneyTab draws. */
export interface Money {
  state: MoneyState
  figures: MoneyFigures
  /** True once a contract value has been entered (the phone shows nothing without one). */
  hasContract: boolean
  contract: ContractCardRow | null
  /** False when job_profit_v gave no row: this login cannot see the job's money. */
  visible: boolean
}

export function moneyOf(reads: MoneyReads, now: Date = new Date()): Money {
  const state = stateOf(reads)
  return {
    state,
    figures: figuresOf(state, now),
    hasContract: Boolean(reads.row?.contract_id),
    contract: reads.contract,
    visible: reads.row !== null,
  }
}

/** The claim band's words split where the phone's caps end: "HELD UNTIL SIGN-OFF" and the sentence after it. */
export function banParts(text: string): { lead: string; rest: string } {
  const at = text.indexOf(' — ')
  return at < 0 ? { lead: '', rest: text } : { lead: text.slice(0, at), rest: text.slice(at + 3) }
}

// ------------------------------------------------------------ the contract card

export interface ContractFact {
  key: 'sum' | 'variations' | 'number' | 'order' | 'retention' | 'terms' | 'signed' | 'starts' | 'due'
  label: string
  /** Null when nothing is on file. */
  value: string | null
}

const pctWords = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`

/**
 * The contract's terms, read straight from its row: the sum as the contract
 * states it, approved variations when there are any, the builder's numbers,
 * retention, payment terms, and the dates that are set.
 */
export function contractFacts(k: ContractCardRow, approvedVariations: number | null | undefined): ContractFact[] {
  const facts: ContractFact[] = [{ key: 'sum', label: 'Contract sum', value: `${amountWords(k.contract_sum)} ${k.gst_inclusive ? 'inc GST' : 'ex GST'}` }]
  const approved = Number(approvedVariations ?? 0)
  if (approved !== 0) facts.push({ key: 'variations', label: 'Approved variations', value: `${amountWords(approved)} ${k.gst_inclusive ? 'inc GST' : 'ex GST'}` })
  facts.push(
    { key: 'number', label: 'Contract number', value: k.contract_no?.trim() || null },
    { key: 'order', label: 'Builder’s order number', value: k.order_no?.trim() || null },
    { key: 'retention', label: 'Retention', value: k.retention_pct > 0 ? `${pctWords(k.retention_pct)} of each claim` : 'None' },
    { key: 'terms', label: 'Payment terms', value: k.payment_terms_days > 0 ? `${k.payment_terms_days} day${k.payment_terms_days === 1 ? '' : 's'} from the invoice` : 'On the invoice date' },
  )
  if (k.signed_on) facts.push({ key: 'signed', label: 'Signed', value: dateWords(k.signed_on) })
  if (k.starts_on) facts.push({ key: 'starts', label: 'Starts', value: dateWords(k.starts_on) })
  if (k.due_on) facts.push({ key: 'due', label: 'Completion due', value: dateWords(k.due_on) })
  return facts
}

// ------------------------------------------------------------ adding a cost

/** The phone's categories (WorkerApp.tsx EXPENSE_CATEGORIES), which are also the reader's. */
export const EXPENSE_CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']

/** Where a cost of this category shows on the Money tab, on both apps. */
export const sectionOfCategory = (category: string) => (category === 'Subcontractor' ? 'Contractors & wages' : 'Materials & hire')

/** What the reader sends back for each line it found (api/parse-receipt.ts ExtractedLine). */
export interface ReadLine {
  description: string
  amount: number
  quantity?: number
  unit?: string
  unit_cost?: number
  cost_code?: string | null
}

/**
 * The phone's receipt form (WorkerApp.tsx ReceiptForm), without the job
 * picker: a cost added on a job's Money tab is that job's.
 */
export interface CostForm {
  vendor: string
  spentOn: string
  amount: string
  tax: string
  category: string
  lineItems: ReadLine[]
  aiNote: string | null
  aiConfidence: number | null
  /** Fields still showing "read from the file", cleared as each is corrected. */
  aiFilled: Set<string>
  aiExtracted: boolean
  receiptPath: string | null
}

/** Today as a local calendar date, "2026-10-21": the office's day, not UTC's. */
export const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * An empty form, dated today: the local calendar day. (The phone's
 * blankReceiptForm takes the UTC date, which in Adelaide before 10:30 am is
 * yesterday; that is being fixed on the phone to the local day too.)
 */
export function blankCost(today: string = todayLocal()): CostForm {
  return {
    vendor: '',
    spentOn: today,
    amount: '',
    tax: '',
    category: '',
    lineItems: [],
    aiNote: null,
    aiConfidence: null,
    aiFilled: new Set(),
    aiExtracted: false,
    receiptPath: null,
  }
}

/** A field typed over: it no longer says it was read from the file (the phone's editField). */
export function editCost<K extends keyof CostForm>(f: CostForm, key: K, value: CostForm[K]): CostForm {
  const nextFilled = new Set(f.aiFilled)
  nextFilled.delete(key as string)
  return { ...f, [key]: value, aiFilled: nextFilled }
}

/** What the reader returns (api/parse-receipt.ts ExtractedReceipt). */
export interface Reading {
  vendor: string | null
  spent_on: string | null
  amount: number | null
  tax: number | null
  category: string | null
  line_items: ReadLine[]
  confidence: number | null
  note: string | null
}

/** The form with what the reader found filled in, each such field marked (ReceiptScreen handleFile). */
export function withReading(f: CostForm, parsed: Reading): CostForm {
  const filled = new Set<string>()
  const next = { ...f }
  if (parsed.vendor) {
    next.vendor = parsed.vendor
    filled.add('vendor')
  }
  if (parsed.spent_on) {
    next.spentOn = parsed.spent_on
    filled.add('spentOn')
  }
  if (parsed.amount != null) {
    next.amount = String(parsed.amount)
    filled.add('amount')
  }
  if (parsed.tax != null) {
    next.tax = String(parsed.tax)
    filled.add('tax')
  }
  if (parsed.category) {
    next.category = parsed.category
    filled.add('category')
  }
  next.lineItems = parsed.line_items ?? []
  next.aiNote = parsed.note
  next.aiConfidence = parsed.confidence
  next.aiFilled = filled
  next.aiExtracted = true
  return next
}

/**
 * Why the form cannot be saved yet, in words; null when it can. The phone
 * asks for the same three fields; it also takes any typing as an amount and
 * saves what it cannot read as $0 ("1,100" included), which a desk should
 * not.
 */
export function costProblem(f: CostForm): string | null {
  if (!f.vendor.trim() || !f.spentOn || !f.amount.trim()) return 'Add who it was from, the date and the amount.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.spentOn)) return 'Pick the date from the calendar.'
  const amount = parseAmount(f.amount)
  if (amount === null || Number.isNaN(amount)) return 'Type the amount in dollars, like 110 or 1,100.50.'
  const tax = parseAmount(f.tax)
  if (tax !== null && Number.isNaN(tax)) return 'Type the GST in dollars, like 10, or leave it blank.'
  if (tax !== null && tax > amount) return 'The GST is more than the amount. Check both.'
  return null
}

/**
 * The expenses row, exactly as the phone's ReceiptScreen save() inserts it:
 * needs_review, the reader's note, confidence and lines kept, the file's
 * path, blanks as null. Amounts are read as amounts ("$1,100.50" is 1100.5).
 */
export function expenseInsert({ me, siteId, form }: { me: Pick<WorkerRow, 'id' | 'company_id'>; siteId: string; form: CostForm }) {
  return {
    company_id: me.company_id,
    site_id: siteId || null,
    submitted_by: me.id,
    vendor: form.vendor.trim(),
    spent_on: form.spentOn,
    amount: parseAmount(form.amount) || 0,
    tax: parseAmount(form.tax) || 0,
    category: form.category || null,
    receipt_path: form.receiptPath,
    status: 'needs_review' as const,
    ai_note: form.aiNote,
    ai_confidence: form.aiConfidence,
    line_items: form.lineItems,
  }
}

export const EXPENSE_SAVED_COLS = 'id, site_id, vendor, spent_on, amount, tax, category, receipt_path, status'

export interface SavedCost {
  id: string
  site_id: string | null
  vendor: string
  spent_on: string
  amount: number
  tax: number
  category: string | null
  receipt_path: string | null
  status: string
}

/**
 * Save the cost against the job and read it back. RLS answers a refused
 * write with no row rather than an error, so a missing row, or one that does
 * not read back as sent, is a failure here too.
 */
export async function saveCost({ me, siteId, form }: { me: Pick<WorkerRow, 'id' | 'company_id'>; siteId: string; form: CostForm }, client?: Db): Promise<SavedCost> {
  const problem = costProblem(form)
  if (problem) throw new Error(problem)
  const row = expenseInsert({ me, siteId, form })
  const { data, error } = await db(client).from('expenses').insert(row).select(EXPENSE_SAVED_COLS)
  if (error) throw new Error(`It did not save: ${error.message}`)
  const back = ((data ?? []) as SavedCost[])[0]
  if (!back) throw new Error('It did not save: the write was refused. Only the office can add costs.')
  const same =
    back.site_id === row.site_id &&
    back.vendor === row.vendor &&
    back.spent_on === row.spent_on &&
    Number(back.amount) === row.amount &&
    Number(back.tax) === row.tax &&
    (back.category ?? null) === row.category &&
    (back.receipt_path ?? null) === row.receipt_path
  if (!same) throw new Error('It saved, but did not read back as entered. Check the line under this job before adding it again.')
  return { ...back, amount: Number(back.amount), tax: Number(back.tax) }
}

// ------------------------------------------------------------ the file and the reader

/** What the file box takes: what the phone's camera takes, and the PDFs supplier invoices come as. */
export const RECEIPT_ACCEPT = 'image/*,application/pdf'

/** The receipts bucket's own limit (storage.sql). */
export const RECEIPT_MAX_BYTES = 25 * 1024 * 1024

/** The types the reader reads (api/parse-receipt.ts ALLOWED_MEDIA_TYPES). */
export const READER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

/** The most the reader takes, as base64 (api/parse-receipt.ts MAX_IMAGE_BASE64): 5 MB of file. */
export const READER_MAX_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3)

/** The type the phone tells the reader a file is. */
export const mediaTypeOf = (file: { type: string }) => file.type || 'image/jpeg'

/** Why the reader will not take a file, or null when it will. The file is filed either way. */
export function readerRefusal(file: { name: string; type: string; size: number }): string | null {
  if (!READER_TYPES.includes(mediaTypeOf(file))) return `${WEB_BRAND} reads JPEG, PNG, WebP, GIF and PDF files, so ${file.name} is attached but not read. Enter the details by hand.`
  if (Math.ceil(file.size / 3) * 4 > READER_MAX_BASE64) return `${file.name} is too big to read (over 5 MB), so it is attached but not read. Enter the details by hand.`
  return null
}

/** The phone's readFileAsBase64 (WorkerApp.tsx): the file's bytes as base64, without the data: prefix. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}
export { readFileAsBase64 as fileBase64 }

/**
 * File a receipt or supplier invoice where the phone files one: the receipts
 * bucket, under <company>/<job>/, which the storage policies check.
 */
export async function uploadReceipt(me: Pick<WorkerRow, 'company_id'>, siteId: string, file: File): Promise<string> {
  const path = objectPath(me.company_id, siteId, file.name)
  await uploadFile(BUCKET_RECEIPTS, path, file)
  return path
}

/** Take back a file nothing was saved against (a cancelled form, a replaced file). */
export async function discardReceipt(path: string): Promise<void> {
  await removeFile(BUCKET_RECEIPTS, path).catch(() => {})
}

/** Open a filed receipt in the viewer. False when it cannot be signed. */
export async function openReceipt(path: string): Promise<boolean> {
  const url = await signedUrl(BUCKET_RECEIPTS, path)
  if (!url) return false
  viewFile({ url, name: path.split('/').pop()!.replace(/^[0-9a-f-]{36}-/i, '') })
  return true
}

/** The body the phone posts to /api/parse-receipt. */
export function readerBody({ base64, mediaType, siteName }: { base64: string; mediaType: string; siteName: string }) {
  return {
    imageBase64: base64,
    mediaType,
    siteHint: siteName || undefined,
    // The phone lists every job it knows, as a hint; a cost added on a job's
    // Money tab is that job's whatever the reader thinks, so this is the one.
    sitesList: siteName ? [siteName] : [],
  }
}

/**
 * Ask the phone's reader (POST /api/parse-receipt, the signed-in session's
 * token) what a receipt says. Null when the server has no reader set up
 * (501): the form is then filled in by hand, as on the phone. Throws with the
 * server's own words when it could not read it.
 */
export async function readReceipt(
  input: { base64: string; mediaType: string; siteName: string },
  { client, post = fetch }: { client?: Db; post?: typeof fetch } = {},
): Promise<Reading | null> {
  const {
    data: { session },
  } = await db(client).auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Session expired — sign in again.')

  const res = await post(api('/api/parse-receipt'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(readerBody(input)),
  })
  if (res.status === 501) return null
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Extraction failed (${res.status})`)
  }
  return (await res.json()) as Reading
}
