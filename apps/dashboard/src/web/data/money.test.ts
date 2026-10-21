import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jobSrc from '../../worker/simple/Job.tsx?raw'
import dataSrc from '../../worker/simple/data.ts?raw'
import appSrc from '../../worker/WorkerApp.tsx?raw'
import readerSrc from '../../../api/parse-receipt.ts?raw'
import moneySrc from './money.ts?raw'
import { api, BUCKET_RECEIPTS, removeFile, uploadFile } from '../phone'
import * as web from './money'
import { JOB_CONTRACT_COLS, loadContract } from '../../data/jobContract'
import type { CostForm, Db, ExpenseRead, MoneyReads, ProfitRow, Reading } from './money'

// Storage goes through the phone's own helpers; here they are stand-ins, so
// nothing leaves the test.
vi.mock('../phone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../phone')>()),
  uploadFile: vi.fn(async (_bucket: string, path: string) => path),
  removeFile: vi.fn(async () => {}),
}))

/**
 * The phone's Money tab (worker/simple/Job.tsx MoneyTab) and its receipt
 * form (worker/WorkerApp.tsx ReceiptScreen), read from the phone's own
 * source and run beside the website's copies in money.ts: the reads, what
 * the load keeps, every figure and word on the tab, and the row, file and
 * reader a cost goes through. Change the phone and this names what to bring
 * into line.
 */

// ------------------------------------------------------------------ helpers

type Decl = ts.FunctionDeclaration | ts.VariableDeclaration

const parse = (file: string, src: string) =>
  ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const JOB = parse('Job.tsx', jobSrc)
const DATA = parse('data.ts', dataSrc)
const APP = parse('WorkerApp.tsx', appSrc)
const READER = parse('parse-receipt.ts', readerSrc)
const WEB = parse('money.ts', moneySrc)

/** Every node in a subtree that passes `test`. */
function all<T extends ts.Node>(root: ts.Node, test: (n: ts.Node) => n is T): T[] {
  const out: T[] = []
  const visit = (n: ts.Node) => {
    if (test(n)) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(root)
  return out
}

/** The one function or variable declaration called `name` under `root`. */
function decl(root: ts.Node, name: string): Decl {
  const found = all(root, (n): n is Decl =>
    (ts.isFunctionDeclaration(n) && n.name?.text === name) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name),
  )
  const file = root.getSourceFile().fileName
  if (found.length !== 1) throw new Error(`${file}: expected one declaration of ${name}, found ${found.length}. Was it renamed or moved?`)
  return found[0]!
}

const printer = ts.createPrinter({ removeComments: true })
/** Code as TypeScript prints it, without comments or an export keyword. */
const code = (node: ts.Node) =>
  printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/^export\s+/, '').replace(/\s+/g, ' ').trim()

/** A declaration's whole statement, export dropped, ready to compile. */
function source(d: Decl): string {
  const stmt = ts.isVariableDeclaration(d) ? d.parent.parent : d
  return stmt.getText(d.getSourceFile()).replace(/^export\s+/, '')
}

/** Compile TypeScript (TSX allowed) to plain JavaScript. */
const js = (tsx: string) =>
  ts.transpileModule(tsx, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export\s*\{\s*\};?\s*$/m, '')

/** Run phone code: `body` sees `scope` as variables and returns `ret`. */
function run<T>(body: string, scope: Record<string, unknown>, ret: string): T {
  const names = Object.keys(scope)
  return new Function(...names, `${js(`${body}\nconst __ret = (${ret})`)}\nreturn __ret`)(...names.map((n) => scope[n])) as T
}

/** A call to `name`: a method name ('then'), a dotted path ('Promise.all') or a plain function ('fetch'). */
const isCall = (name?: string) => (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) &&
  (name === undefined ||
    (name.includes('.') ? n.expression.getText() === name : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text === name : n.expression.getText() === name))

/** A string-literal array constant's values. */
function strings(d: Decl): string[] {
  const init = (d as ts.VariableDeclaration).initializer
  if (!init || !ts.isArrayLiteralExpression(init)) throw new Error(`${code(d)} is no longer an array literal`)
  return init.elements.map((e) => {
    if (!ts.isStringLiteralLike(e)) throw new Error(`${e.getText()} is not a string`)
    return e.text
  })
}

/** A fake client that records every call and answers each awaited chain with `answer(table)`. */
function recorder(answer: (table: string, calls: string[]) => unknown = (t) => ({ data: ['job_profit_v', 'site_progress_v', 'contracts'].includes(t) ? null : [], error: null })) {
  const calls: string[] = []
  const chainFor = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'range', 'limit', 'maybeSingle', 'single', 'insert', 'update', 'delete']) {
      b[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
        return b
      }
    }
    b.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(answer(table, calls)).then(resolve, reject)
    return b
  }
  return { calls, client: { from: chainFor } as unknown as Db }
}

const byTable = (calls: string[]) => {
  const m = new Map<string, string[]>()
  for (const c of calls) {
    const t = c.slice(0, c.indexOf('.'))
    m.set(t, [...(m.get(t) ?? []), c])
  }
  return m
}

// ------------------------------------------------------------------ the phone's Money tab

const MONEY_TAB = decl(JOB, 'MoneyTab') as ts.FunctionDeclaration
const PROMISE_ALL = all(MONEY_TAB, isCall('Promise.all'))
const THEN = all(MONEY_TAB, (n): n is ts.CallExpression => isCall('then')(n) && ts.isPropertyAccessExpression(n.expression) && PROMISE_ALL.includes(n.expression.expression as ts.CallExpression))

/** The phone's own helpers, compiled from its source. */
const PH = run<{ money: (v: number | null | undefined) => string; shortDate: (iso: string) => string; countWord: (n: number) => string }>(
  ['money', 'shortDate', 'countWord'].map((n) => source(decl(JOB, n))).join('\n'),
  {},
  '{ money, shortDate, countWord }',
)

/** What the phone's load keeps from its reads (MoneyTab's .then), run on the same answers. */
type PhoneState = {
  row: unknown
  donePct: number | null
  claims: Array<{ label: string; ex: number }>
  pending: unknown[]
  mats: unknown[]
  exps: unknown[]
  sublets: Array<{ name: string; cost: number }>
  wageLines: Array<{ k: string; v: string }>
  loading: boolean
  contract?: unknown
  contractErr?: string | null
}
function phoneLoad(answers: unknown[]): PhoneState {
  const out = {} as PhoneState
  const set = (k: keyof PhoneState) => (v: unknown) => {
    ;(out as Record<string, unknown>)[k] = v
  }
  const fn = run<(a: unknown[]) => void>(
    '',
    {
      cancelled: false,
      setRow: set('row'),
      setDonePct: set('donePct'),
      setClaims: set('claims'),
      setPending: set('pending'),
      setMats: set('mats'),
      setExps: set('exps'),
      setSublets: set('sublets'),
      setWageLines: set('wageLines'),
      setLoading: set('loading'),
      setContract: set('contract'),
      setContractErr: set('contractErr'),
      reloaded: { current: null },
      shortDate: PH.shortDate,
      money: PH.money,
    },
    THEN[0]!.arguments[0]!.getText(JOB),
  )
  fn(answers)
  return out
}

/** Every figure and row the phone's tab draws from that state (MoneyTab, `const value` to `const rows`). */
type PhoneFigures = {
  value: number
  claimed: number
  claimedPct: number | null
  totalCost: number
  earned: number | null
  marginPct: number | null
  marginFg: string
  ban?: { text: string; tone: string }
  rows: Array<{ key: string; k: string; v: string; note: string; tone?: string; lines: Array<{ k: string; v: string }>; empty: string; ban?: { text: string; tone: string } }>
}
const FIGURE_STATEMENTS = (() => {
  const stmts = [...MONEY_TAB.body!.statements]
  const from = stmts.findIndex((s) => ts.isVariableStatement(s) && s.declarationList.declarations[0]!.name.getText(JOB) === 'value')
  const last = stmts.length - 1
  if (from < 0 || !ts.isReturnStatement(stmts[last]!)) throw new Error('Job.tsx MoneyTab: the figures no longer start at `const value` and end before the JSX return')
  return stmts.slice(from, last).map((s) => s.getText(JOB)).join('\n')
})()
function phoneFigures(st: PhoneState, floodHoldCount: number): PhoneFigures {
  return run<PhoneFigures>(
    FIGURE_STATEMENTS,
    { ...st, floodHoldCount, money: PH.money, countWord: PH.countWord },
    '{ value, claimed, claimedPct, totalCost, earned, marginPct, marginFg, ban, rows }',
  )
}

/** The phone's on-dark margin colours, as the website's tones. */
const FG_TONE: Record<string, web.Tone | null> = { '#4CC38A': 'g', '#E9A23B': 'a', '#F2777C': 'r', '#8A929B': null }

// ------------------------------------------------------------------ fixtures

const profit = (over: Partial<ProfitRow> = {}): ProfitRow => ({
  contract_id: 'k-1',
  contract_sum_ex: 48000,
  approved_variations: 2000,
  job_value_ex: 50000,
  claimed_ex: 15000,
  labour_hours: 39,
  labour_cost: 1188.75,
  material_cost: 2558.4,
  expense_cost: 515,
  sublet_cost: 740,
  margin_pct: 90,
  ...over,
})

const W = { a: 'w-a', b: 'w-b', c: 'w-c', d: 'w-d', gone: 'w-gone' }
const at = (day: string, h: number, m = 0) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+10:30`).toISOString()

/** The e2e job's rows: a little of everything, so every section has lines. */
function baseReads(over: Partial<MoneyReads> = {}): MoneyReads {
  return {
    row: profit(),
    progress: { pct_complete: 44 },
    invoices: [
      { invoice_no: 'ZZ-2', period: null, issued_on: '2026-10-15', ex_tax: 5000 },
      { invoice_no: 'ZZ-1', period: 'Progress claim 1', issued_on: '2026-09-30', ex_tax: 10000 },
    ],
    variations: [{ description: 'Extra niche in the ensuite', cost_impact: 1250 }],
    materials: [
      { name: 'Porcelain 600x600', supplier: 'Tile Depot', total_cost: 2100, cost_code: 'tiles' },
      { name: 'Adhesive 20 kg', supplier: 'Trade Supplies', total_cost: 370, cost_code: 'adhesive' },
      { name: 'Trims', supplier: null, total_cost: 88.4, cost_code: null },
    ],
    expenses: [
      { vendor: 'Grout Co', category: 'Subcontractor', amount: 330, tax: 30, id: 'e-1', spent_on: '2026-10-02', receipt_path: 'co/s/e1-grout.pdf' },
      { vendor: 'Hire Shop', category: 'Equipment Rental', amount: 220, tax: 20, id: 'e-2', spent_on: '2026-10-03', receipt_path: null },
      { vendor: 'Parking', category: null, amount: 15, tax: 0, id: 'e-3', spent_on: '2026-10-04', receipt_path: null },
    ],
    subcontracts: [
      { cost: 400, subcontractors: { name: 'Waterproofers' } },
      { cost: 250, subcontractors: [{ name: 'Waterproofers' }] },
      { cost: 90, subcontractors: null },
    ],
    shifts: [
      { worker_id: W.a, started_at: at('2026-10-06', 7), ended_at: at('2026-10-06', 15, 30), break_minutes: 30 },
      { worker_id: W.b, started_at: at('2026-10-06', 7), ended_at: at('2026-10-06', 16), break_minutes: 30 },
      { worker_id: W.a, started_at: at('2026-10-07', 7), ended_at: at('2026-10-07', 15, 30), break_minutes: null },
      { worker_id: W.c, started_at: at('2026-10-07', 8), ended_at: at('2026-10-07', 14), break_minutes: 0 },
      // Ended before it started: no hours, so no line.
      { worker_id: W.d, started_at: at('2026-10-08', 9), ended_at: at('2026-10-08', 8), break_minutes: 0 },
      // Someone no longer on the books: hours, but no name, so no line.
      { worker_id: W.gone, started_at: at('2026-10-08', 7), ended_at: at('2026-10-08', 15), break_minutes: 0 },
      // Still on the clock: not a cost yet.
      { worker_id: W.b, started_at: at('2026-10-09', 7), ended_at: null, break_minutes: 0 },
    ],
    crew: [
      { id: W.a, name: 'Ana Tiler', trade: 'Tiler', role: 'employee' },
      { id: W.b, name: 'Ben Captain', trade: 'Tiler', role: 'captain' },
      { id: W.c, name: 'Cal Labourer', trade: null, role: 'employee' },
      { id: W.d, name: 'Dee Backwards', trade: 'Tiler', role: 'employee' },
    ],
    pay: [
      { worker_id: W.a, rate: 45 },
      { worker_id: W.b, rate: 52.5 },
      { worker_id: W.d, rate: 40 },
    ],
    wet: [],
    contract: null,
    ...over,
  }
}

/** The labour cost that leaves the e2e job's $22,000 earned at `pct` margin. */
const labourFor = (pct: number) => 22000 * (1 - pct / 100) - (2558.4 + 515 + 740)

/** The answers the phone's ten reads would have given for the same rows, in its order. */
function phoneAnswers(r: MoneyReads): unknown[] {
  const phoneExps = r.expenses.map(({ vendor, category, amount, tax }) => ({ vendor, category, amount, tax }))
  return [
    { data: r.row },
    { data: r.progress },
    { data: r.invoices },
    { data: r.variations },
    { data: r.materials },
    { data: phoneExps },
    { data: r.subcontracts },
    { data: r.shifts },
    { data: r.crew },
    { data: r.pay },
    { c: r.contract ?? null, err: null },
  ]
}

/** Every case the figures are checked on, side by side. */
const CASES: Array<[string, MoneyReads]> = [
  ['the e2e job: behind on claiming', baseReads()],
  ['a flood test overdue on one wet area', baseReads({ wet: [{ site_id: 's', area: 'Ensuite', status: 'complete', flood_tested: false }] })],
  ['two wet areas held', baseReads({ wet: ['Ensuite', 'Main bath'].map((area) => ({ site_id: 's', area, status: 'signed_off', flood_tested: false })) })],
  ['seven wet areas held', baseReads({ wet: Array.from({ length: 7 }, (_, i) => ({ site_id: 's', area: `Bath ${i}`, status: 'complete', flood_tested: false })) })],
  ['nothing claimed yet', baseReads({ invoices: [], row: profit({ claimed_ex: 0 }) })],
  ['claimed ahead of the work', baseReads({ row: profit({ claimed_ex: 25000 }) })],
  ['claimed in line, two points under', baseReads({ row: profit({ claimed_ex: 21000 }) })],
  ['claimed in line, level', baseReads({ row: profit({ claimed_ex: 22000 }) })],
  ['three points under is behind', baseReads({ row: profit({ claimed_ex: 20500 }) })],
  ['progress on a fraction', baseReads({ progress: { pct_complete: 44.6 } })],
  ['no progress measured', baseReads({ progress: { pct_complete: null } })],
  ['no progress row', baseReads({ progress: null })],
  ['nothing done yet', baseReads({ progress: { pct_complete: 0 } })],
  ['a thin margin, amber', baseReads({ row: profit({ labour_cost: labourFor(10) }) })],
  ['under 8%, red', baseReads({ row: profit({ labour_cost: labourFor(5) }) })],
  ['a margin under water', baseReads({ row: profit({ labour_cost: 30000 }) })],
  ['about 8%', baseReads({ row: profit({ labour_cost: labourFor(8) }) })],
  ['about 15%', baseReads({ row: profit({ labour_cost: labourFor(15) }) })],
  ['just under 15%, amber', baseReads({ row: profit({ labour_cost: labourFor(14.5) }) })],
  ['just under 8%, red', baseReads({ row: profit({ labour_cost: labourFor(7.5) }) })],
  ['behind by an amount that rounds', baseReads({ row: profit({ claimed_ex: 15040 }) })],
  ['behind by an amount that rounds down', baseReads({ row: profit({ claimed_ex: 15060.5 }) })],
  ['no contract value', baseReads({ row: profit({ contract_id: null, contract_sum_ex: 0, approved_variations: 0, job_value_ex: 0 }) })],
  ['figures as strings, as numeric can come', baseReads({ row: profit({ job_value_ex: '50000.00' as unknown as number, claimed_ex: '15000' as unknown as number }) })],
  [
    'an empty job',
    baseReads({ row: profit({ claimed_ex: 0, labour_cost: 0, material_cost: 0, expense_cost: 0, sublet_cost: 0 }), invoices: [], variations: [], materials: [], expenses: [], subcontracts: [], shifts: [], pay: [] }),
  ],
  ['only a subcontractor’s invoice', baseReads({ row: profit({ labour_cost: 0, sublet_cost: 0 }), shifts: [], subcontracts: [], expenses: [baseReads().expenses[0]!] })],
  ['three variations with the builder', baseReads({ variations: [{ description: 'A', cost_impact: 100 }, { description: 'B', cost_impact: 250.5 }, { description: 'C', cost_impact: 0 }] })],
  ['two tile orders', baseReads({ materials: [...baseReads().materials, { name: 'Mosaic', supplier: 'Tile Depot', total_cost: 410.25, cost_code: 'tiles' }] })],
  ['a claim on a contract of nothing', baseReads({ row: profit({ job_value_ex: 0 }) })],
]

// ------------------------------------------------------------------ the reads

describe("the phone's reads", () => {
  it('are found where the test looks for them', () => {
    expect(PROMISE_ALL).toHaveLength(1)
    expect(THEN).toHaveLength(1)
  })

  const phone = recorder()
  run('', { client: phone.client, site: { id: 'site-1' }, loadContract }, PROMISE_ALL[0]!.arguments[0]!.getText(JOB))
  const phoneTables = byTable(phone.calls)

  it('are ten and the contract; the website makes the same ten in the same order, then the flood-test hold and the contract', async () => {
    const w = recorder()
    await web.loadMoney('site-1', w.client)
    const order = (calls: string[]) => [...new Set(calls.map((c) => c.slice(0, c.indexOf('.'))))]
    const TEN = ['job_profit_v', 'site_progress_v', 'invoices', 'change_orders', 'materials', 'expenses', 'subcontract_work', 'shifts', 'crew_v', 'worker_pay']
    // The phone reads its contract through the shared loader (data/jobContract.ts loadContract).
    expect(order(phone.calls)).toEqual([...TEN, 'contracts'])
    expect(order(w.calls)).toEqual([...TEN, 'waterproofing', 'contracts'])
  })

  it('ask the same of each table, with the same filters', async () => {
    const w = recorder()
    await web.loadMoney('site-1', w.client)
    const webTables = byTable(w.calls)
    for (const [table, calls] of phoneTables) {
      // Expenses and shifts are checked below; the contract too, since the website's card reads more of it.
      if (table === 'expenses' || table === 'shifts' || table === 'contracts') continue
      expect(webTables.get(table), table).toEqual(calls)
    }
  })

  it('ask the phone’s four expense columns first, then when and the file', async () => {
    const w = recorder()
    await web.loadMoney('site-1', w.client)
    const [phoneSelect, ...phoneRest] = phoneTables.get('expenses')!
    const [webSelect, ...webRest] = byTable(w.calls).get('expenses')!
    expect(phoneSelect).toBe('expenses.select("vendor, category, amount, tax")')
    expect(webSelect).toBe(`expenses.select("vendor, category, amount, tax, ${web.EXPENSE_EXTRA}")`)
    expect(webRest).toEqual(phoneRest)
  })

  it('read the phone’s closed shifts a page at a time', async () => {
    const w = recorder()
    await web.loadMoney('site-1', w.client)
    expect(byTable(w.calls).get('shifts')).toEqual([...phoneTables.get('shifts')!, 'shifts.order("id")', 'shifts.range(0, 999)'])
  })

  it('count the flood-test hold as the phone does, for this job', async () => {
    // useSimpleData reads every wet area in the company covered with no flood test, and counts them by job.
    const fetchAll = decl(DATA, 'fetchAll')
    const reads = all(fetchAll, isCall('from')).filter((c) => c.arguments[0]?.getText(DATA) === "'waterproofing'")
    expect(reads).toHaveLength(1)
    let outer: ts.Node = reads[0]!
    while (ts.isPropertyAccessExpression(outer.parent) && ts.isCallExpression(outer.parent.parent)) outer = outer.parent.parent
    const p = recorder()
    run('', { client: p.client }, outer.getText(DATA))
    const w = recorder()
    await web.loadMoney('site-1', w.client)
    expect(byTable(w.calls).get('waterproofing')).toEqual([...p.calls, 'waterproofing.eq("site_id", "site-1")'])
    // The count: one per row, the phone's floodHold map looked up for the job.
    const count = all(decl(DATA, 'floodHold'), (n): n is ts.ArrowFunction => ts.isArrowFunction(n))[0]!
    const rows = [{ site_id: 's' }, { site_id: 'other' }, { site_id: 's' }]
    const phoneHold = run<Map<string, number>>('', { wpRows: rows }, `(${count.getText(DATA)})()`)
    expect(phoneHold.get('s')).toBe(2)
    expect(web.stateOf(baseReads({ wet: rows.filter((r) => r.site_id === 's').map((r) => ({ ...r, area: 'x', status: 'complete', flood_tested: false })) })).floodHoldCount).toBe(phoneHold.get('s'))
  })

  it('say which read failed, rather than showing a total that is too small', async () => {
    const w = recorder((t) => (t === 'materials' ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null }))
    await expect(web.loadMoney('site-1', w.client)).rejects.toThrow('Could not read materials: permission denied')
    const s = recorder((t) => (t === 'shifts' ? { data: null, error: { message: 'timeout' } } : { data: [], error: null }))
    await expect(web.loadMoney('site-1', s.client)).rejects.toThrow('Could not read hours worked: timeout')
  })

  it('page past the server’s 1,000 rows', async () => {
    let page = 0
    const w = recorder((t) => {
      if (t !== 'shifts') return { data: t === 'job_profit_v' ? null : [], error: null }
      page += 1
      return { data: Array.from({ length: page === 1 ? 1000 : 3 }, (_, i) => ({ worker_id: W.a, started_at: at('2026-10-06', 7), ended_at: at('2026-10-06', 8), break_minutes: 0, i })), error: null }
    })
    const reads = await web.loadMoney('site-1', w.client)
    expect(reads.shifts).toHaveLength(1003)
    expect(w.calls.filter((c) => c.startsWith('shifts.range'))).toEqual(['shifts.range(0, 999)', 'shifts.range(1000, 1999)'])
  })
})

// ------------------------------------------------------------------ what the load keeps

describe("what the phone's load keeps", () => {
  for (const [name, reads] of CASES) {
    it(name, () => {
      const phone = phoneLoad(phoneAnswers(reads))
      const mine = web.stateOf(reads)
      expect(phone.loading).toBe(false)
      expect(mine.row).toEqual(phone.row)
      expect(mine.donePct).toEqual(phone.donePct)
      expect(mine.claims.map(({ label, ex }) => ({ label, ex }))).toEqual(phone.claims)
      expect(mine.pending).toEqual(phone.pending)
      expect(mine.mats).toEqual(phone.mats)
      expect(mine.exps.map(({ vendor, category, amount, tax }) => ({ vendor, category, amount, tax }))).toEqual(phone.exps)
      expect(mine.sublets).toEqual(phone.sublets)
      expect(mine.wages.map((l) => ({ k: l.k, v: web.money(Math.round(l.cost)) }))).toEqual(phone.wageLines)
    })
  }
})

// ------------------------------------------------------------------ the figures

describe("every figure, band and line on the phone's tab", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T10:00:00+10:30'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const [name, reads] of CASES) {
    it(name, () => {
      const phone = phoneFigures(phoneLoad(phoneAnswers(reads)), reads.wet.length)
      const mine = web.figuresOf(web.stateOf(reads))
      expect(mine.value).toBe(phone.value)
      expect(mine.claimed).toBe(phone.claimed)
      expect(mine.claimedPct).toBe(phone.claimedPct)
      expect(mine.totalCost).toBe(phone.totalCost)
      expect(mine.earned).toBe(phone.earned)
      expect(mine.marginPct).toBe(phone.marginPct)
      expect(phone.marginFg in FG_TONE, `a colour the test does not know: ${phone.marginFg}`).toBe(true)
      expect(mine.marginTone).toBe(FG_TONE[phone.marginFg])
      expect(mine.ban).toEqual(phone.ban)
      expect(mine.sections.map(({ lines, ...s }) => ({ ...s, lines: lines.map(({ k, v }) => ({ k, v })) }))).toEqual(
        phone.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))),
      )
    })
  }

  it('covers every band the phone has, and none', () => {
    const leads = new Set(CASES.map(([, r]) => web.banParts(web.figuresOf(web.stateOf(r)).ban?.text ?? '').lead))
    expect([...leads].sort()).toEqual(['', 'BEHIND ON CLAIMING', 'CLAIMED AHEAD OF THE WORK', 'CLAIMED IN LINE WITH THE WORK', 'HELD UNTIL SIGN-OFF', 'NOTHING CLAIMED YET'].sort())
  })

  it('and every colour', () => {
    const tones = new Set(CASES.map(([, r]) => web.figuresOf(web.stateOf(r)).marginTone))
    expect(tones).toEqual(new Set(['g', 'a', 'r', null]))
  })
})

describe('the phone’s words, copied', () => {
  it('money, shortDate and countWord are the phone’s code', () => {
    for (const n of ['money', 'shortDate', 'countWord']) expect(code(decl(WEB, n)), n).toBe(code(decl(JOB, n)))
  })

  it('the tab says the phone’s sentences', () => {
    // The words on screen: the JSX text, and the strings it shows (the no-contract sentence is one).
    const jsxText = all(MONEY_TAB, (n): n is ts.JsxText | ts.StringLiteral => ts.isJsxText(n) || ts.isStringLiteral(n))
      .map((n) => (ts.isStringLiteral(n) ? n.text : n.getText(JOB)))
      .join(' ')
      .replace(/\s+/g, ' ')
    expect(jsxText).toContain(web.NO_CONTRACT)
    expect(jsxText).toContain(web.OFFICE_ONLY)
  })
})

// ------------------------------------------------------------------ the rules, stated

describe('the claim band', () => {
  const now = new Date('2026-10-21T10:00:00+10:30')
  const ban = (r: MoneyReads) => web.figuresOf(web.stateOf(r), now).ban

  it('holds everything while a wet area is covered with no flood test, whatever was claimed', () => {
    const one = baseReads({ wet: [{ site_id: 's', area: 'Ensuite', status: 'complete', flood_tested: false }], row: profit({ claimed_ex: 30000 }) })
    expect(ban(one)).toEqual({
      tone: 'r',
      text: 'HELD UNTIL SIGN-OFF — One wet area signed off with no flood test. Nothing on this job can be claimed until it is done.',
    })
    const two = baseReads({ wet: ['a', 'b'].map((area) => ({ site_id: 's', area, status: 'signed_off', flood_tested: false })) })
    expect(ban(two)?.text).toBe('HELD UNTIL SIGN-OFF — Two wet areas signed off with no flood test. Nothing on this job can be claimed until they are done.')
    const seven = baseReads({ wet: Array.from({ length: 7 }, (_, i) => ({ site_id: 's', area: `b${i}`, status: 'complete', flood_tested: false })) })
    expect(ban(seven)?.text).toMatch(/^HELD UNTIL SIGN-OFF — 7 wet areas/)
  })

  it('says when the first claim goes, with nothing claimed', () => {
    expect(ban(baseReads({ invoices: [] }))).toEqual({ tone: 'n', text: 'NOTHING CLAIMED YET — First claim goes out at the end of October, on whatever is measured then.' })
  })

  it('reads claimed against done: ahead, in line within two points, behind with the dollars', () => {
    expect(ban(baseReads({ row: profit({ claimed_ex: 25000 }) }))).toEqual({
      tone: 'r',
      text: 'CLAIMED AHEAD OF THE WORK — Claimed 50% against 44% done. That is the conversation a builder’s QS opens with.',
    })
    expect(ban(baseReads({ row: profit({ claimed_ex: 21000 }) }))).toEqual({
      tone: 'g',
      text: 'CLAIMED IN LINE WITH THE WORK — Claimed 42% against 44% done. Nothing to explain at the next claim.',
    })
    expect(ban(baseReads())).toEqual({
      tone: 'a',
      text: 'BEHIND ON CLAIMING — Claimed 30% against 44% done. There is $7,000 of finished work not yet claimed.',
    })
  })

  it('says nothing when there is no progress to measure claims against', () => {
    expect(ban(baseReads({ progress: { pct_complete: null } }))).toBeUndefined()
  })

  it('splits where the phone’s capitals end', () => {
    expect(web.banParts('BEHIND ON CLAIMING — Claimed 30% against 44% done.')).toEqual({ lead: 'BEHIND ON CLAIMING', rest: 'Claimed 30% against 44% done.' })
    expect(web.banParts('No dash here.')).toEqual({ lead: '', rest: 'No dash here.' })
  })
})

describe('the totals on the e2e job', () => {
  const f = web.figuresOf(web.stateOf(baseReads()), new Date('2026-10-21T10:00:00+10:30'))
  const sec = (k: web.SectionKey) => f.sections.find((s) => s.key === k)!

  it('summary: value, margin at today on earned value, done, claimed', () => {
    expect(f.value).toBe(50000)
    expect(f.earned).toBe(22000)
    expect(f.totalCost).toBeCloseTo(5002.15, 6)
    expect(f.marginPct!.toFixed(1)).toBe('77.3')
    expect(f.marginTone).toBe('g')
    expect(f.claimedPct).toBe(30)
  })

  it('claimed: the sent and paid invoices, newest first, ex GST', () => {
    expect(sec('claimed')).toMatchObject({ v: '$15,000', note: '30% of the job' })
    expect(sec('claimed').lines).toEqual([
      { k: 'ZZ-2 · 15 Oct', v: '$5,000' },
      { k: 'Progress claim 1 · 30 Sept', v: '$10,000', detail: 'Invoice ZZ-1' },
    ])
  })

  it('contractors and wages: hours × rate, subbies by name, a subbie’s invoice ex GST', () => {
    const s = sec('wages')
    // job_profit_v's labour and sublet, plus the subcontractor's invoice ex GST.
    expect(s.v).toBe('$2,229')
    expect(s.note).toBe('6 people on the job')
    expect(s.lines.map(({ k, v }) => `${k} = ${v}`)).toEqual([
      'Ana Tiler · tiler = $743',
      'Ben Captain · crew captain = $446',
      'Cal Labourer · crew = $0',
      'Waterproofers = $650',
      'Subcontractor = $90',
      'Grout Co · Subcontractor = $300',
    ])
    expect(s.lines[0]!.detail).toBe('16.5 hours')
    expect(s.lines[2]!.detail).toBe('6 hours, no pay rate on file')
    expect(s.lines[5]).toMatchObject({ detail: '2 Oct 2026 · $330 inc GST', receiptPath: 'co/s/e1-grout.pdf' })
  })

  it('tile supply and materials: tiles by cost code, the rest with the expenses, biggest first', () => {
    expect(sec('tiles')).toMatchObject({ v: '$2,100', note: '1 order', lines: [{ k: 'Tile Depot · Porcelain 600x600', v: '$2,100' }] })
    expect(sec('mats').v).toBe('$673')
    expect(sec('mats').note).toBe('4 lines')
    expect(sec('mats').lines.map(({ k, v }) => `${k} = ${v}`)).toEqual(['Trade Supplies · Adhesive 20 kg = $370', 'Hire Shop · Equipment Rental = $200', 'Trims = $88', 'Parking = $15'])
  })

  it('variations: pending with the builder, amber', () => {
    expect(sec('vars')).toMatchObject({ v: '$1,250', note: '1 with the builder', tone: 'a', lines: [{ k: 'Extra niche in the ensuite', v: '$1,250' }] })
  })

  it('an empty section says what the phone says', () => {
    const e = web.figuresOf(web.stateOf(baseReads({ invoices: [], variations: [], materials: [], expenses: [], subcontracts: [], shifts: [], row: profit({ labour_cost: 0, sublet_cost: 0, claimed_ex: 0 }) })))
    expect(e.sections.map((s) => [s.v, s.note, s.empty])).toEqual([
      ['—', 'nothing claimed yet', 'No claim has gone out yet.'],
      ['—', 'nothing yet', 'Nobody has booked time to this job.'],
      ['—', 'nothing ordered', 'No tile ordered against this job.'],
      ['—', 'nothing yet', 'No materials or hire booked.'],
      ['—', 'none raised', 'No variations raised on this job.'],
    ])
  })
})

describe('moneyOf', () => {
  it('tells no contract from a job this login cannot see', () => {
    expect(web.moneyOf(baseReads())).toMatchObject({ hasContract: true, visible: true })
    expect(web.moneyOf(baseReads({ row: profit({ contract_id: null }) }))).toMatchObject({ hasContract: false, visible: true })
    expect(web.moneyOf(baseReads({ row: null }))).toMatchObject({ hasContract: false, visible: false })
  })
})

// ------------------------------------------------------------------ the contract card

describe('contractFacts', () => {
  const k: web.ContractCardRow = {
    id: 'k-1',
    contract_no: ' HC-1042 ',
    order_no: null,
    contract_sum: 48000,
    gst_inclusive: false,
    retention_pct: 5,
    payment_terms_days: 45,
    signed_on: '2026-09-01',
    starts_on: null,
    due_on: '2026-12-18',
  }
  it('reads the row: the sum and its GST basis, the numbers, retention, terms, and only the dates that are set', () => {
    expect(web.contractFacts(k, 2000).map((f) => [f.label, f.value])).toEqual([
      ['Contract sum', '$48,000 ex GST'],
      ['Approved variations', '$2,000 ex GST'],
      ['Contract number', 'HC-1042'],
      ['Builder’s order number', null],
      ['Retention', '5% of each claim'],
      ['Payment terms', '45 days from the invoice'],
      ['Signed', '1 Sept 2026'],
      ['Completion due', '18 Dec 2026'],
    ])
  })
  it('inc GST, no retention, no variations, odd terms', () => {
    const f = web.contractFacts({ ...k, gst_inclusive: true, contract_sum: 52800.5, retention_pct: 2.5, payment_terms_days: 1, starts_on: '2026-10-01' }, 0)
    expect(f.find((x) => x.key === 'sum')?.value).toBe('$52,800.50 inc GST')
    expect(f.find((x) => x.key === 'variations')).toBeUndefined()
    expect(f.find((x) => x.key === 'retention')?.value).toBe('2.5% of each claim')
    expect(f.find((x) => x.key === 'terms')?.value).toBe('1 day from the invoice')
    expect(f.find((x) => x.key === 'starts')?.value).toBe('1 Oct 2026')
    expect(web.contractFacts({ ...k, retention_pct: 0, payment_terms_days: 0 }, null).filter((x) => ['retention', 'terms'].includes(x.key)).map((x) => x.value)).toEqual(['None', 'On the invoice date'])
  })
  it('reads the contracts row straight, with the columns the Contract card shows', async () => {
    const w = recorder()
    await web.loadMoney('site-1', w.client)
    expect(byTable(w.calls).get('contracts')).toEqual([`contracts.select("${web.CONTRACT_CARD_COLS}")`, 'contracts.eq("site_id", "site-1")', 'contracts.maybeSingle()'])
  })
  it("reads every column the phone's Money tab reads of the contract, by the same job", async () => {
    const p = recorder()
    await loadContract('site-1', p.client).catch(() => null)
    const cols = (sel: string) => sel.split(',').map((c) => c.trim())
    expect(p.calls).toEqual([`contracts.select("${JOB_CONTRACT_COLS}")`, 'contracts.eq("site_id", "site-1")', 'contracts.maybeSingle()'])
    for (const c of cols(JOB_CONTRACT_COLS)) expect(cols(web.CONTRACT_CARD_COLS)).toContain(c)
  })
})

// ------------------------------------------------------------------ adding a cost: the phone's ReceiptScreen

const RECEIPT = decl(APP, 'ReceiptScreen') as ts.FunctionDeclaration
const inReceipt = (name: string) => decl(RECEIPT, name) as ts.FunctionDeclaration

type PhoneForm = {
  siteId: string
  vendor: string
  spentOn: string
  amount: string
  tax: string
  category: string
  lineItems: Array<{ description: string; amount: number }>
  aiNote: string | null
  aiConfidence: number | null
  aiFilled: Set<string>
  aiExtracted: boolean
  receiptPath: string | null
}
const toWeb = ({ siteId: _s, ...f }: PhoneForm): CostForm => ({ ...f })
const comparable = (f: CostForm | PhoneForm) => {
  const { aiFilled, ...rest } = f as CostForm & { siteId?: string }
  delete rest.siteId
  return { ...rest, aiFilled: [...aiFilled].sort() }
}

describe("the phone's receipt form", () => {
  /**
   * The phone's blank form, field by field from its source, its date left out:
   * the phone's date is being moved off UTC to the local day, so that one
   * expression is not run here (it may come to call a helper this test does
   * not have). Every other field is.
   */
  const BLANK = (() => {
    const fn = decl(APP, 'blankReceiptForm') as ts.FunctionDeclaration
    const ret = all(fn, (n): n is ts.ReturnStatement => ts.isReturnStatement(n))[0]!
    if (!ret.expression || !ts.isObjectLiteralExpression(ret.expression)) throw new Error('blankReceiptForm no longer returns an object literal')
    return ret.expression.properties.map((p) => {
      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) throw new Error(`blankReceiptForm: ${p.getText(APP)} is not a plain field`)
      return { name: p.name.getText(APP), value: ts.isPropertyAssignment(p) ? p.initializer.getText(APP) : p.name.getText(APP) }
    })
  })()
  const phoneBlank = (siteId: string): PhoneForm =>
    Object.fromEntries(BLANK.map(({ name, value }) => [name, name === 'spentOn' ? '' : run<unknown>('', { siteId }, value)])) as PhoneForm

  it('starts blank the same way, every field but the date, which is the local day', () => {
    const p = phoneBlank('site-1')
    const w = web.blankCost('2026-10-21')
    expect(BLANK.map((b) => b.name).filter((n) => n !== 'siteId')).toEqual(Object.keys(w))
    expect(comparable({ ...w, spentOn: '' })).toEqual(comparable(p))
    expect(w.spentOn).toBe('2026-10-21')
    expect(p.siteId).toBe('site-1')
    const d = new Date()
    expect(web.blankCost().spentOn).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  })

  it('offers the same categories, which are the reader’s', () => {
    expect(web.EXPENSE_CATEGORIES).toEqual(strings(decl(APP, 'EXPENSE_CATEGORIES')))
    expect(web.EXPENSE_CATEGORIES).toEqual(strings(decl(READER, 'CATEGORIES')))
    expect(web.sectionOfCategory('Subcontractor')).toBe('Contractors & wages')
    for (const c of web.EXPENSE_CATEGORIES.filter((x) => x !== 'Subcontractor')) expect(web.sectionOfCategory(c)).toBe('Materials & hire')
  })

  it('a field typed over stops saying it was read from the file (editField)', () => {
    const fn = inReceipt('editField')
    const updater = all(fn, isCall('setForm'))[0]!.arguments[0]!.getText(APP)
    const form: PhoneForm = { ...phoneBlank('s'), vendor: 'Read Vendor', aiFilled: new Set(['vendor', 'amount']) }
    const phone = run<(f: PhoneForm) => PhoneForm>('', { key: 'vendor', value: 'Typed Vendor' }, updater)(form)
    const mine = web.editCost(toWeb(form), 'vendor', 'Typed Vendor')
    expect(comparable(mine)).toEqual(comparable(phone))
    expect([...mine.aiFilled]).toEqual(['amount'])
  })

  const readings: Reading[] = [
    {
      vendor: 'Tile Supplies',
      spent_on: '2026-10-20',
      amount: 550,
      tax: 50,
      category: 'Materials',
      line_items: [{ description: 'Grout 20 kg', amount: 45, quantity: 1, unit: 'ea', unit_cost: 45, cost_code: null }],
      confidence: 0.92,
      note: null,
    },
    { vendor: null, spent_on: null, amount: 0, tax: null, category: 'Other', line_items: [], confidence: 0.3, note: 'The total is smudged.' },
    { vendor: '', spent_on: '2026-01-02', amount: null, tax: 0, category: '', line_items: undefined as unknown as [], confidence: null, note: null },
  ]

  it('fills in what the reader found, and marks it (handleFile)', () => {
    const fn = inReceipt('handleFile')
    const updaters = all(fn, isCall('setForm')).filter((c) => c.arguments[0]!.getText(APP).includes('aiExtracted'))
    expect(updaters).toHaveLength(1)
    for (const parsed of readings) {
      const form: PhoneForm = { ...phoneBlank('s'), vendor: 'Typed', receiptPath: 'co/s/r.jpg' }
      const phone = run<(f: PhoneForm) => PhoneForm>('', { parsed, filled: new Set<string>() }, updaters[0]!.arguments[0]!.getText(APP))(form)
      expect(comparable(web.withReading(toWeb(form), parsed))).toEqual(comparable(phone))
    }
  })

  const saveFn = inReceipt('save')
  const inserts = all(saveFn, (n): n is ts.CallExpression => isCall('insert')(n) && !!n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0]))
  const literal = inserts[0]?.arguments[0] as ts.ObjectLiteralExpression

  it('inserts once, into expenses', () => {
    expect(inserts).toHaveLength(1)
    const from = all(saveFn, isCall('from'))
    expect(from.map((c) => c.arguments[0]!.getText(APP))).toEqual(["'expenses'"])
  })

  it('the same row: the same keys in the same order, the same values', () => {
    const me = { id: 'w-1', company_id: 'co-1' }
    const forms: PhoneForm[] = [
      { ...phoneBlank('site-1'), vendor: '  Bunnings ', spentOn: '2026-10-20', amount: '110', tax: '10', category: 'Materials', receiptPath: 'co-1/site-1/u-r.jpg' },
      { ...phoneBlank('site-1'), vendor: 'Parking', spentOn: '2026-10-21', amount: '15.5', tax: '', category: '' },
      web.withReading(toWeb({ ...phoneBlank('site-1'), receiptPath: 'co-1/site-1/u-inv.pdf' }), readings[0]!) as unknown as PhoneForm,
    ].map((f) => ({ ...f, siteId: 'site-1' }))
    for (const form of forms) {
      const dollarsOf = run<(t: string) => number>(source(decl(APP, 'dollarsOf')), {}, 'dollarsOf')
      const phone = run<Record<string, unknown>>('', { me, form, dollarsOf }, literal.getText(APP))
      const mine = web.expenseInsert({ me, siteId: form.siteId, form: toWeb(form) })
      expect(Object.keys(mine)).toEqual(Object.keys(phone))
      expect(mine).toEqual(phone)
    }
  })

  it('reads "$1,100.50" as 1,100.50 dollars, on the phone and the website alike', () => {
    const me = { id: 'w-1', company_id: 'co-1' }
    const form: PhoneForm = { ...phoneBlank('site-1'), vendor: 'Tiles', amount: '$1,100.50', tax: '100.05' }
    const dollarsOf = run<(t: string) => number>(source(decl(APP, 'dollarsOf')), {}, 'dollarsOf')
    const phone = run<Record<string, unknown>>('', { me, form, dollarsOf }, literal.getText(APP))
    expect(phone).toMatchObject({ amount: 1100.5, tax: 100.05 })
    expect(web.expenseInsert({ me, siteId: 'site-1', form: toWeb(form) })).toMatchObject({ amount: 1100.5, tax: 100.05 })
    // What is not a number is refused before saving, not filed at $0.
    expect(dollarsOf('ten')).toBeNaN()
    expect(dollarsOf('')).toBe(0)
  })

  it('files the receipt where the phone does: receipts, under <company>/<job>/', async () => {
    const fn = inReceipt('handleFile')
    const text = code(fn)
    expect(text).toContain("const path = objectPath(me.company_id, form.siteId || 'unassigned', file.name);")
    expect(text).toContain('await uploadFile(BUCKET_RECEIPTS, path, file);')
    vi.mocked(uploadFile).mockClear()
    const file = new File(['x'], 'Tax invoice #12.pdf', { type: 'application/pdf' })
    const path = await web.uploadReceipt({ company_id: 'co-1' }, 'site-1', file)
    expect(path).toMatch(/^co-1\/site-1\/[0-9a-f-]{36}-Tax_invoice__12\.pdf$/)
    expect(vi.mocked(uploadFile).mock.calls.at(-1)).toEqual([BUCKET_RECEIPTS, path, file])
    vi.mocked(removeFile).mockClear()
    await web.discardReceipt(path)
    expect(vi.mocked(removeFile).mock.calls.at(-1)).toEqual([BUCKET_RECEIPTS, path])
  })

  it('reads the file to base64 with the phone’s own code', () => {
    expect(code(decl(WEB, 'readFileAsBase64'))).toBe(code(decl(APP, 'readFileAsBase64')))
  })
})

describe("the phone's reader", () => {
  const fn = decl(RECEIPT, 'handleFile') as ts.FunctionDeclaration
  const fetches = all(fn, isCall('fetch'))

  it('is one POST to /api/parse-receipt with the session’s token', () => {
    expect(fetches).toHaveLength(1)
    const [url, init] = fetches[0]!.arguments
    expect(url!.getText(APP)).toBe("api('/api/parse-receipt')")
    const props = (init as ts.ObjectLiteralExpression).properties.map((p) => p.name!.getText(APP))
    expect(props).toEqual(['method', 'headers', 'body'])
    expect(code(init!)).toContain("method: 'POST'")
    expect(code(init!)).toContain("headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }")
  })

  it('sends the same body, and says the same of a file’s type', async () => {
    const body = all(fetches[0]!, (n): n is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(n) && n.properties.some((p) => p.name?.getText(APP) === 'imageBase64'))[0]!
    expect(body.properties.map((p) => p.name!.getText(APP))).toEqual(Object.keys(web.readerBody({ base64: 'x', mediaType: 'image/png', siteName: 'Job' })))
    const mediaType = body.properties.find((p) => p.name!.getText(APP) === 'mediaType') as ts.PropertyAssignment
    for (const type of ['image/png', 'application/pdf', '']) {
      expect(web.mediaTypeOf({ type })).toBe(run<string>('', { file: { type } }, mediaType.initializer.getText(APP)))
    }

    const posted: Array<{ url: string; init: RequestInit }> = []
    const post = (async (url: string, init: RequestInit) => {
      posted.push({ url, init })
      return new Response(JSON.stringify(readingsOk), { status: 200 })
    }) as unknown as typeof fetch
    const readingsOk: Reading = { vendor: 'V', spent_on: null, amount: 1, tax: null, category: 'Other', line_items: [], confidence: 0.5, note: null }
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as unknown as Db
    expect(await web.readReceipt({ base64: 'QUJD', mediaType: 'image/png', siteName: 'ZZ job' }, { client, post })).toEqual(readingsOk)
    expect(posted[0]!.url).toBe(api('/api/parse-receipt'))
    expect(posted[0]!.init.method).toBe('POST')
    expect(posted[0]!.init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer tok' })
    expect(JSON.parse(String(posted[0]!.init.body))).toEqual({ imageBase64: 'QUJD', mediaType: 'image/png', siteHint: 'ZZ job', sitesList: ['ZZ job'] })
  })

  it('leaves the form to be filled by hand when the server has no reader (501), and passes on its words otherwise', async () => {
    const t = code(fn)
    expect(t).toContain('if (res.status === 501) { setReadOff(true); return; }')
    expect(t).toContain('throw new Error(body?.error ?? `Extraction failed (${res.status})`);')
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } } as unknown as Db
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    const input = { base64: 'QUJD', mediaType: 'image/png', siteName: 'J' }
    expect(await web.readReceipt(input, { client, post: answer(501, { error: 'AI extraction not configured', manual: true }) })).toBeNull()
    await expect(web.readReceipt(input, { client, post: answer(413, { error: 'That image is too large to read.' }) })).rejects.toThrow('That image is too large to read.')
    await expect(web.readReceipt(input, { client, post: (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch })).rejects.toThrow('Extraction failed (502)')
    const signedOut = { auth: { getSession: async () => ({ data: { session: null } }) } } as unknown as Db
    await expect(web.readReceipt(input, { client: signedOut, post: answer(200, {}) })).rejects.toThrow('Session expired')
  })

  it('knows what the reader takes (api/parse-receipt.ts)', () => {
    const types = run<string[]>(['ALLOWED_IMAGE_TYPES', 'PDF_TYPE', 'ALLOWED_MEDIA_TYPES'].map((n) => source(decl(READER, n))).join('\n'), {}, 'ALLOWED_MEDIA_TYPES')
    expect(web.READER_TYPES).toEqual(types)
    expect(web.READER_MAX_BASE64).toBe(run<number>(source(decl(READER, 'MAX_IMAGE_BASE64')), {}, 'MAX_IMAGE_BASE64'))
    expect(web.readerRefusal({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull()
    // The reader's ceiling is on the base64, which is a shade under 5 MB of file.
    expect(web.readerRefusal({ name: 'a.pdf', type: 'application/pdf', size: 5 * 1024 * 1024 - 3 })).toBeNull()
    expect(web.readerRefusal({ name: 'big.pdf', type: 'application/pdf', size: 5 * 1024 * 1024 })).toMatch(/too big to read/)
    expect(web.readerRefusal({ name: 'IMG_1.heic', type: 'image/heic', size: 1000 })).toMatch(/reads JPEG, PNG, WebP, GIF and PDF/)
  })
})

// ------------------------------------------------------------------ saving a cost

describe('amounts typed and shown', () => {
  it('reads plain amounts, with or without a dollar sign, commas and spaces; blank is null; the rest NaN', () => {
    expect(web.parseAmount('110')).toBe(110)
    expect(web.parseAmount('$1,100.50')).toBe(1100.5)
    expect(web.parseAmount(' 1 100 ')).toBe(1100)
    expect(web.parseAmount('0')).toBe(0)
    expect(web.parseAmount('  ')).toBeNull()
    for (const bad of ['ten', '-5', '1.2.3', '10.555', '$', '4e5']) expect(web.parseAmount(bad)).toBeNaN()
  })

  it('shows cents only when there are some', () => {
    expect(web.amountWords(48000)).toBe('$48,000')
    expect(web.amountWords(110.5)).toBe('$110.50')
    expect(web.amountWords(52800.5)).toBe('$52,800.50')
  })
})

describe('saveCost', () => {
  const me = { id: 'w-1', company_id: 'co-1' }
  const filled = (over: Partial<CostForm> = {}): CostForm => ({ ...web.blankCost('2026-10-21'), vendor: 'Bunnings', amount: '110', tax: '10', category: 'Materials', ...over })

  it('refuses what cannot be saved, in words, before writing', async () => {
    expect(web.costProblem(filled({ vendor: ' ' }))).toMatch(/who it was from/)
    expect(web.costProblem(filled({ amount: '' }))).toMatch(/the amount/)
    expect(web.costProblem(filled({ amount: 'ten' }))).toMatch(/amount in dollars/)
    expect(web.costProblem(filled({ tax: 'GST' }))).toMatch(/GST in dollars/)
    expect(web.costProblem(filled({ tax: '120' }))).toMatch(/more than the amount/)
    expect(web.costProblem(filled({ spentOn: '21/10/2026' }))).toMatch(/date/)
    expect(web.costProblem(filled({ tax: '' }))).toBeNull()
    const w = recorder()
    await expect(web.saveCost({ me, siteId: 's', form: filled({ amount: 'ten' }) }, w.client)).rejects.toThrow(/amount in dollars/)
    expect(w.calls).toEqual([])
  })

  it('inserts the phone’s row and reads it back', async () => {
    const w = recorder((_t, calls) => {
      const sent = JSON.parse(calls.find((c) => c.startsWith('expenses.insert'))!.slice('expenses.insert('.length, -1))
      return { data: [{ id: 'e-1', ...sent }], error: null }
    })
    const out = await web.saveCost({ me, siteId: 's', form: filled() }, w.client)
    expect(out).toMatchObject({ id: 'e-1', vendor: 'Bunnings', amount: 110, tax: 10, site_id: 's' })
    expect(w.calls).toEqual([`expenses.insert(${JSON.stringify(web.expenseInsert({ me, siteId: 's', form: filled() }))})`, `expenses.select("${web.EXPENSE_SAVED_COLS}")`])
  })

  it('a refused write (no row back) is a failure', async () => {
    const w = recorder(() => ({ data: [], error: null }))
    await expect(web.saveCost({ me, siteId: 's', form: filled() }, w.client)).rejects.toThrow(/refused/)
    const e = recorder(() => ({ data: null, error: { message: 'new row violates row-level security policy for table "expenses"' } }))
    await expect(web.saveCost({ me, siteId: 's', form: filled() }, e.client)).rejects.toThrow(/row-level security/)
  })

  it('a row that reads back different is a failure', async () => {
    const w = recorder((_t, calls) => {
      const sent = JSON.parse(calls.find((c) => c.startsWith('expenses.insert'))!.slice('expenses.insert('.length, -1))
      return { data: [{ id: 'e-1', ...sent, amount: 11 }], error: null }
    })
    await expect(web.saveCost({ me, siteId: 's', form: filled() }, w.client)).rejects.toThrow(/did not read back/)
  })
})

describe('the lines on the e2e job carry what is behind them', () => {
  it('an expense: its date, its total with GST, its file', () => {
    const e: ExpenseRead = { vendor: 'V', category: 'Materials', amount: 110.5, tax: 10.05, id: 'e', spent_on: '2026-10-20', receipt_path: 'co/s/f.pdf' }
    const line = web.figuresOf(web.stateOf(baseReads({ expenses: [e], materials: [] }))).sections.find((s) => s.key === 'mats')!.lines[0]
    expect(line).toEqual({ k: 'V · Materials', v: '$100', detail: '20 Oct 2026 · $110.50 inc GST', receiptPath: 'co/s/f.pdf' })
  })
})
