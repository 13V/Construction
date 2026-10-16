import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import plansSrc from '../../worker/PlansScreen.tsx?raw'
import drawingsBtnSrc from '../../worker/simple/Drawings.tsx?raw'
import drawingsSrc from './drawings.ts?raw'
import { levelOf } from '../phone-features'
import { removeFile, uploadFile } from '../phone'
import {
  bumpVersion,
  drawingInsert,
  drawingRefusal,
  DRAWING_MAX_BYTES,
  groupByLevel,
  headOf,
  holdBack,
  isDrawing,
  openPinsBySheet,
  REGISTER_FILTER,
  REGISTER_ORDER,
  registerOf,
  removeDrawing,
  nameClash,
  revChip,
  sheetChip,
  supersededIdsOf,
  uploadDrawing,
  type Db,
  type Sheet,
} from './drawings'

// Storage goes through the phone's own helpers (one client, one path rule);
// here they are stand-ins, so nothing leaves the test.
vi.mock('../phone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../phone')>()),
  uploadFile: vi.fn(async (_bucket: string, path: string) => path),
  removeFile: vi.fn(async () => {}),
}))

/**
 * The drawing register's rules, read from the phone's own source
 * (PlansScreen.tsx, Drawings.tsx) and run beside the website's copies in
 * drawings.ts. Change the phone and this names the copy to bring into line.
 *
 * Verbatim copies are compared as code, printed by TypeScript without
 * comments. Rules that live inside a phone component are cut out of the
 * source, compiled, and run beside the copy on the same inputs.
 *
 * bumpVersion and the upload row came from the first office dashboard
 * (ui/JobSiteFolder.tsx), compared with it until it was removed. The pinned
 * cases below keep them as they were.
 */

// ------------------------------------------------------------------ helpers

const parse = (file: string, src: string) =>
  ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const PLANS = parse('PlansScreen.tsx', plansSrc)
const BUTTON = parse('Drawings.tsx', drawingsBtnSrc)
const WEB = parse('drawings.ts', drawingsSrc)

function all<T extends ts.Node>(root: ts.Node, test: (n: ts.Node) => n is T): T[] {
  const out: T[] = []
  const visit = (n: ts.Node) => {
    if (test(n)) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(root)
  return out
}

type Decl = ts.FunctionDeclaration | ts.VariableDeclaration

/** The one declaration called `name` anywhere in the file (inside components too). */
function decl(sf: ts.SourceFile, name: string): Decl {
  const found = all(sf, (n): n is Decl => (ts.isFunctionDeclaration(n) && n.name?.text === name) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name))
  if (found.length !== 1) throw new Error(`${sf.fileName}: expected one declaration of ${name}, found ${found.length}. Was it renamed or moved?`)
  return found[0]!
}

const printer = ts.createPrinter({ removeComments: true })
/** A function as code: parameters, return type and body, printed without comments, export dropped. */
function code(d: Decl, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, d, sf).replace(/^export\s+/, '').replace(/\s+/g, ' ').trim()
}

function js(tsx: string): string {
  return ts.transpileModule(tsx, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export\s*\{\s*\};?\s*$/m, '')
}

/** Run phone code: `body` sees `scope` as variables, and the value of `ret` comes back. */
function run<T>(body: string, scope: Record<string, unknown>, ret: string): T {
  const names = Object.keys(scope)
  return new Function(...names, `${js(`${body}\nconst __ret = (${ret})`)}\nreturn __ret`)(...names.map((n) => scope[n])) as T
}

/** The arrow function a `const x = useMemo(() => …, deps)` is built from, as text. */
function memoBody(sf: ts.SourceFile, name: string): string {
  const d = decl(sf, name)
  const memo = ts.isVariableDeclaration(d) ? d.initializer : undefined
  if (!memo || !ts.isCallExpression(memo) || !ts.isArrowFunction(memo.arguments[0]!)) throw new Error(`${name} is no longer a useMemo(() => …)`)
  return (memo.arguments[0] as ts.ArrowFunction).body.getText(sf)
}

/** A PostgREST call chain as [method, args as written], the .from first. */
function chain(call: ts.Expression, sf: ts.SourceFile): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let at: ts.Expression = call
  while (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    out.unshift([at.expression.name.text, at.arguments.map((a) => a.getText(sf)).join(', ')])
    at = at.expression.expression
  }
  return out
}

/** Every outermost query in a subtree that reads `table`. */
function queriesOf(root: ts.Node, sf: ts.SourceFile, table: string) {
  const calls = all(root, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression))
  const outermost = calls.filter((c) => !(ts.isPropertyAccessExpression(c.parent) && ts.isCallExpression(c.parent.parent)))
  return outermost.map((c) => chain(c, sf)).filter((ch) => ch.some(([m, a]) => m === 'from' && a === `'${table}'`))
}

const sheet = (id: string, name: string, extra: Partial<Sheet> = {}): Sheet => ({
  id,
  company_id: 'co',
  site_id: 'site',
  uploaded_by: null,
  kind: 'document',
  storage_path: `co/site/${id}-${name}`,
  name,
  mime: 'application/pdf',
  size_bytes: 1000,
  category: 'plan',
  caption: null,
  lat: null,
  lng: null,
  taken_at: null,
  version: 'Rev A',
  supersedes: null,
  created_at: '2026-10-15T01:00:00Z',
  ...extra,
})

// -------------------------------------------------------- which rows are drawings

describe('which rows are drawings', () => {
  const filterOf = (q: Array<[string, string]>) => q.filter(([m, a]) => (m === 'eq' || m === 'is') && !a.startsWith("'site_id'"))
  const expected = REGISTER_FILTER.map(([m, col, v]) => [m, `'${col}', ${v === null ? 'null' : `'${v}'`}`])

  it("is the phone register's query: every row, these filters, by name", () => {
    const load = decl(PLANS, 'load')
    const qs = queriesOf(load, PLANS, 'site_files')
    expect(qs).toHaveLength(1)
    const q = qs[0]!
    expect(q.find(([m]) => m === 'select')?.[1]).toBe("'*'")
    expect(filterOf(q)).toEqual(expected)
    expect(q.find(([m]) => m === 'order')?.[1]).toBe(`'${REGISTER_ORDER}'`)
  })

  it("and the phone's Drawings button counts the same rows", () => {
    const qs = queriesOf(BUTTON, BUTTON, 'site_files')
    expect(qs).toHaveLength(1)
    expect(filterOf(qs[0]!)).toEqual(expected)
  })

  it('isDrawing applies it to a row in hand', () => {
    expect(isDrawing({ kind: 'document', selection_id: null, waterproofing_package_id: null })).toBe(true)
    expect(isDrawing({ kind: 'document' })).toBe(true)
    expect(isDrawing({ kind: 'photo' })).toBe(false)
    expect(isDrawing({ kind: 'document', selection_id: 'sel' })).toBe(false)
    expect(isDrawing({ kind: 'document', waterproofing_package_id: 'pkg' })).toBe(false)
  })

  it('loadRegister sends exactly that query', async () => {
    const calls: Array<[string, unknown[]]> = []
    const builder = (table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order']) {
        b[m] = (...args: unknown[]) => {
          calls.push([`${table}.${m}`, args])
          return b
        }
      }
      b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
      return b
    }
    const { loadRegister } = await import('./drawings')
    await loadRegister('site-1', { from: builder } as unknown as Db)
    expect(calls.filter(([c]) => c.startsWith('site_files'))).toEqual([
      ['site_files.select', ['*']],
      ['site_files.eq', ['site_id', 'site-1']],
      ['site_files.eq', ['kind', 'document']],
      ['site_files.is', ['selection_id', null]],
      ['site_files.is', ['waterproofing_package_id', null]],
      ['site_files.order', ['name']],
    ])
    expect(calls.filter(([c]) => c.startsWith('plan_pins'))).toEqual([
      ['plan_pins.select', ['id, file_id, resolved_at']],
      ['plan_pins.eq', ['site_id', 'site-1']],
    ])
  })
})

// ------------------------------------------------------------- the register

describe('the register, the phone way', () => {
  const sheets = [
    sheet('a1', 'A-201.pdf'),
    sheet('a2', 'A-201 rev B.pdf', { version: 'Rev B', supersedes: 'a1', created_at: '2026-10-16T01:00:00Z' }),
    sheet('b1', 'A-101.pdf'),
    sheet('c1', 'A-102.pdf', { version: null }),
  ]

  it('superseded is the phone rule', () => {
    const phone = run<Set<string>>('', { sheets }, memoBody(PLANS, 'supersededIds'))
    expect(supersededIdsOf(sheets)).toEqual(phone)
    expect([...phone]).toEqual(['a1'])
  })

  it('search, current and superseded are worked out as the phone works them out', () => {
    // The phone's own lines, from `const q` to `const old`, run as they are.
    const comp = decl(PLANS, 'PlansScreen') as ts.FunctionDeclaration
    const stmts = comp.body!.statements
    const from = stmts.findIndex((st) => ts.isVariableStatement(st) && st.declarationList.declarations[0]!.name.getText(PLANS) === 'q')
    const to = stmts.findIndex((st) => ts.isVariableStatement(st) && st.declarationList.declarations[0]!.name.getText(PLANS) === 'old')
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const body = stmts.slice(from, to + 1).map((st) => st.getText(PLANS)).join('\n')
    for (const query of ['', '  a-20 ', 'nothing', 'A-1']) {
      const phone = run<{ shown: Sheet[]; current: Sheet[]; old: Sheet[] }>(body, { sheets, query, supersededIds: supersededIdsOf(sheets) }, '{ shown, current, old }')
      const web = registerOf(sheets, [], levelOf, query)
      expect(web.shown.map((s) => s.id)).toEqual(phone.shown.map((s) => s.id))
      expect(web.current.map((s) => s.id)).toEqual(phone.current.map((s) => s.id))
      expect(web.superseded.map((s) => s.id)).toEqual(phone.old.map((s) => s.id))
    }
  })

  it('levels are the phone rule: nine current sheets or more, in two levels or more', () => {
    const body = memoBody(PLANS, 'levels')
    const named = (names: string[]) => names.map((n, i) => sheet(`s${i}`, n))
    const cases = [
      named(['L01 Plan.pdf', 'L02 Plan.pdf']),
      named(['L01-A.pdf', 'L01-B.pdf', 'L02-A.pdf', 'Level 2 RCP.pdf', 'GF Plan.pdf', 'Basement 1.pdf', 'B2 carpark.pdf', 'Site plan.pdf', 'Lvl3 wet areas.pdf', 'L10 roof.pdf']),
      named(Array.from({ length: 10 }, (_, i) => `L03 sheet ${i}.pdf`)),
      named(Array.from({ length: 9 }, (_, i) => `Detail ${i}.pdf`)),
    ]
    for (const current of cases) {
      const phone = run<unknown>('', { current, levelOf }, `(() => { ${body} })()`)
      expect(groupByLevel(current, levelOf)).toEqual(phone)
    }
    // And the case that groups really does group, Basement first and the unnamed last.
    const grouped = groupByLevel(cases[1]!, levelOf)!
    expect(grouped.map(([label, g]) => `${label}:${g.sheets.length}`)).toEqual(['Basement 1:1', 'Basement 2:1', 'Ground floor:1', 'Level 1:2', 'Level 2:2', 'Level 3:1', 'Level 10:1', 'Other sheets:1'])
  })

  it("revChip is the phone's, verbatim", () => {
    expect(code(decl(WEB, 'revChip'), WEB)).toBe(code(decl(PLANS, 'revChip'), PLANS))
    expect(revChip('Rev A')).toBe('REV A')
    expect(revChip('rev b')).toBe('REV B')
    expect(revChip('C')).toBe('REV C')
  })

  it("and the chip on a row is the phone's choice of SUPERSEDED, the revision, or CURRENT", () => {
    const revChipPhone = run<(v: string) => string>(decl(PLANS, 'revChip').getText(PLANS), {}, 'revChip')
    const chips = all(PLANS, (n): n is ts.ConditionalExpression => ts.isConditionalExpression(n) && n.getText(PLANS).includes("'SUPERSEDED'") && n.getText(PLANS).includes("'CURRENT'"))
    // The list row and the open sheet's header.
    expect(chips.length).toBeGreaterThanOrEqual(2)
    for (const chip of chips) {
      const text = chip.getText(PLANS)
      const holder = /(\w+)\.version/.exec(text)![1]!
      for (const version of ['Rev A', 'Rev B', null, '']) {
        for (const superseded of [true, false]) {
          expect(sheetChip(version, superseded)).toBe(run('', { superseded, revChip: revChipPhone, [holder]: { version } }, text))
        }
      }
    }
  })

  it('open pins are the phone count: unresolved, per sheet', () => {
    const pins = [
      { id: 'p1', file_id: 'b1', resolved_at: null },
      { id: 'p2', file_id: 'b1', resolved_at: null },
      { id: 'p3', file_id: 'b1', resolved_at: '2026-10-15T00:00:00Z' },
      { id: 'p4', file_id: 'a2', resolved_at: null },
    ]
    const pinsFor = run<(id: string) => unknown[]>('', { pins }, decl(PLANS, 'pinsFor').getText(PLANS).replace(/^pinsFor\s*=\s*/, ''))
    const counts = openPinsBySheet(pins)
    for (const id of ['a1', 'a2', 'b1', 'c1']) expect(counts.get(id) ?? 0).toBe(pinsFor(id).length)
    expect(registerOf(sheets, pins, levelOf).openPins.get('b1')).toBe(2)
  })

  it('names what replaced a superseded sheet, and what a revision replaced', () => {
    const reg = registerOf(sheets, [], levelOf)
    expect(reg.replacedBy.get('a1')?.id).toBe('a2')
    expect(reg.replaces.get('a2')?.id).toBe('a1')
    expect(reg.replacedBy.has('b1')).toBe(false)
  })

  it('follows a chain of revisions to the current one, whatever each is called', () => {
    const chain = [
      sheet('u1', 'U-300.pdf'),
      sheet('u2', 'U-300 rev B.pdf', { version: 'Rev B', supersedes: 'u1', created_at: '2026-10-16T01:00:00Z' }),
      sheet('u3', 'U-300 C.pdf', { version: 'Rev C', supersedes: 'u2', created_at: '2026-10-16T02:00:00Z' }),
    ]
    const { replacedBy } = registerOf(chain, [], levelOf)
    expect(headOf(chain[0]!, replacedBy).id).toBe('u3')
    expect(headOf(chain[1]!, replacedBy).id).toBe('u3')
    expect(headOf(chain[2]!, replacedBy).id).toBe('u3')
  })
})

describe('a dropped file named like another sheet is held back', () => {
  const sheets = [
    sheet('a1', 'A-201.pdf'),
    sheet('a2', 'A-201 rev B.pdf', { version: 'Rev B', supersedes: 'a1', created_at: '2026-10-16T01:00:00Z' }),
    sheet('b1', 'A-101.pdf'),
  ]

  it('names the current sheet it is named like, case and spaces aside', () => {
    const c = nameClash({ name: ' a-101.PDF' }, sheets)!
    expect(c.sheet.id).toBe('b1')
    expect(c.superseded).toBe(false)
    expect(c.head.id).toBe('b1')
    expect(nameClash({ name: 'A-101 rev B.pdf' }, sheets)).toBeNull()
  })

  it("and a superseded one: its revision goes over the current sheet that replaced it, not over the old name", () => {
    // U-300.pdf revised as "U-300 rev B.pdf", then U-300.pdf dropped again:
    // checking only current sheets let it straight up as a fresh current Rev A.
    const c = nameClash({ name: 'A-201.pdf' }, sheets)!
    expect(c.sheet.id).toBe('a1')
    expect(c.superseded).toBe(true)
    expect(c.head.id).toBe('a2')
    expect(bumpVersion(c.head.version)).toBe('Rev C')
  })

  it('prefers a current sheet of that name over a superseded one, and the newest of equals', () => {
    const both = [
      ...sheets,
      sheet('a3', 'A-201.pdf', { created_at: '2026-10-16T03:00:00Z' }),
      sheet('a4', 'a-201.pdf', { created_at: '2026-10-16T02:00:00Z' }),
    ]
    expect(nameClash({ name: 'A-201.pdf' }, both)!.sheet.id).toBe('a3')
  })

  it('holds a file named like any sheet on the job, current or superseded', () => {
    expect(holdBack([{ name: 'A-101.pdf' }, { name: 'a-201.pdf' }, { name: 'A-301.pdf' }], sheets, [])).toEqual([true, true, false])
  })

  it('holds a file named like one from an earlier drop that has not reached the register', () => {
    // R-500.pdf still going up, then R-500.pdf dropped again.
    expect(holdBack([{ name: 'R-500.pdf' }], sheets, [{ name: 'R-500.pdf' }])).toEqual([true])
    expect(holdBack([{ name: 'R-500.pdf' }], sheets, [])).toEqual([false])
  })

  it('holds the second of two files named alike in one drop, not the first', () => {
    expect(holdBack([{ name: 'Q-600.pdf' }, { name: 'q-600.pdf ' }, { name: 'Q-601.pdf' }], sheets, [])).toEqual([false, true, false])
  })
})

// ----------------------------------------------------------------- the writes

describe('bumpVersion and the upload row (the old dashboard writer)', () => {
  it('bumpVersion keeps its pinned behaviour', () => {
    expect(bumpVersion('Rev A')).toBe('Rev B')
    expect(bumpVersion(' Rev C ')).toBe('Rev D')
    expect(bumpVersion('Rev Y')).toBe('Rev Z')
    expect(bumpVersion('Rev Z')).toBe('Rev B')
    expect(bumpVersion('P4')).toBe('P5')
    expect(bumpVersion('Rev 2')).toBe('Rev 3')
    expect(bumpVersion(null)).toBe('Rev B')
    expect(bumpVersion('')).toBe('Rev B')
  })

  it('a new sheet is Rev A, a plan, with nothing that would keep it off the register', () => {
    const row = drawingInsert({ me: { id: 'w', company_id: 'co' }, siteId: 's', file: { name: 'A.pdf', type: 'application/pdf', size: 5 }, path: 'co/s/x-A.pdf' })
    expect(row).toMatchObject({ kind: 'document', category: 'plan', version: 'Rev A', supersedes: null, mime: 'application/pdf', size_bytes: 5 })
    expect(isDrawing(row)).toBe(true)
    expect(Object.keys(row)).not.toContain('selection_id')
    expect(Object.keys(row)).not.toContain('waterproofing_package_id')
  })

  it('a file over 25 MB is refused before anything is sent', async () => {
    expect(drawingRefusal({ name: 'big.pdf', size: DRAWING_MAX_BYTES + 1 })).toMatch(/limit is 25 MB/)
    expect(drawingRefusal({ name: 'ok.pdf', size: DRAWING_MAX_BYTES })).toBeNull()
    const from = vi.fn()
    const file = { name: 'big.pdf', size: 26 * 1024 * 1024, type: 'application/pdf' } as File
    vi.mocked(uploadFile).mockClear()
    const out = await uploadDrawing({ me: { id: 'w', company_id: 'co' }, siteId: 's', file }, { from, storage: { from } } as unknown as Db)
    expect(out.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('a revision of a sheet somebody already revised is refused before anything is sent', async () => {
    vi.mocked(uploadFile).mockClear()
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'x', name: 'A rev B.pdf', version: 'Rev B' }], error: null }) }) }) }),
    } as unknown as Db
    const file = { name: 'A rev C.pdf', size: 10, type: 'application/pdf' } as File
    const out = await uploadDrawing({ me: { id: 'w', company_id: 'co' }, siteId: 's', file, prior: sheet('a1', 'A.pdf') }, client)
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/already been revised \(Rev B\)/) })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  /** A client whose site_files insert answers with `row` (or `error`), echoing the path it was sent. */
  const inserting = (answer: (sent: Record<string, unknown>) => { data: unknown; error: unknown }) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        insert: (sent: Record<string, unknown>) => ({ select: () => ({ single: async () => answer(sent) }) }),
      }),
    }) as unknown as Db

  it('a revision goes up as the next revision of the sheet, and is read back as stored', async () => {
    vi.mocked(uploadFile).mockClear()
    vi.mocked(removeFile).mockClear()
    const prior = sheet('a1', 'A-201.pdf')
    const file = { name: 'A-201 B.pdf', size: 10, type: 'application/pdf' } as File
    const out = await uploadDrawing({ me: { id: 'w', company_id: 'co' }, siteId: 'site', file, prior }, inserting((sent) => ({ data: { ...sent, id: 'a2', created_at: 'now' }, error: null })))
    expect(out).toMatchObject({ ok: true, value: { id: 'a2', version: 'Rev B', supersedes: 'a1', kind: 'document', category: 'plan' } })
    const [bucket, path] = vi.mocked(uploadFile).mock.calls[0]!
    expect(bucket).toBe('site-files')
    expect(path).toMatch(/^co\/site\/[0-9a-f-]{36}-A-201_B\.pdf$/)
    expect(removeFile).not.toHaveBeenCalled()
  })

  it('a row that does not save takes its file back out of storage', async () => {
    vi.mocked(uploadFile).mockClear()
    vi.mocked(removeFile).mockClear()
    const file = { name: 'A.pdf', size: 10, type: 'application/pdf' } as File
    const refused = await uploadDrawing({ me: { id: 'w', company_id: 'co' }, siteId: 'site', file }, inserting(() => ({ data: null, error: { message: 'new row violates row-level security policy' } })))
    expect(refused).toEqual({ ok: false, message: expect.stringMatching(/row-level security/) })
    // A row that comes back other than written counts as not saved too.
    const wrong = await uploadDrawing({ me: { id: 'w', company_id: 'co' }, siteId: 'site', file }, inserting((sent) => ({ data: { ...sent, id: 'x', version: 'Rev B' }, error: null })))
    expect(wrong.ok).toBe(false)
    const uploaded = vi.mocked(uploadFile).mock.calls.map((c) => c[1])
    expect(vi.mocked(removeFile).mock.calls.map((c) => c[1])).toEqual(uploaded)
  })

  it('removing the newest revision deletes the row, then the file, and reads both back', async () => {
    vi.mocked(removeFile).mockClear()
    const steps: string[] = []
    const client = {
      from: () => ({
        select: () => ({
          eq: (col: string) => (col === 'supersedes' ? { limit: async () => (steps.push('check newest'), { data: [], error: null }) } : (steps.push('read back row'), Promise.resolve({ data: [], error: null }))),
        }),
        delete: () => ({ eq: () => ({ select: async () => (steps.push('delete row'), { data: [{ id: 'a2' }], error: null }) }) }),
      }),
      storage: { from: () => ({ list: async (folder: string, o: { search: string }) => (steps.push(`list ${folder} ${o.search}`), { data: [], error: null }) }) },
    } as unknown as Db
    const out = await removeDrawing(sheet('a2', 'A-201 B.pdf', { storage_path: 'co/site/uuid-A-201_B.pdf' }), client)
    expect(out).toEqual({ ok: true, value: { id: 'a2' }, warning: undefined })
    expect(vi.mocked(removeFile).mock.calls).toEqual([['site-files', 'co/site/uuid-A-201_B.pdf']])
    expect(steps).toEqual(['check newest', 'delete row', 'read back row', 'list co/site uuid-A-201_B.pdf'])
  })

  it('only the newest revision can be removed, checked in the database', async () => {
    const del = vi.fn()
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'newer', version: 'Rev B' }], error: null }) }) }), delete: del }),
    } as unknown as Db
    const out = await removeDrawing(sheet('a1', 'A.pdf'), client)
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/Only the newest revision/) })
    expect(del).not.toHaveBeenCalled()
  })

  it('a delete RLS refused (no rows back) reads as refused, not done', async () => {
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        delete: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }),
      }),
    } as unknown as Db
    const out = await removeDrawing(sheet('a1', 'A.pdf'), client)
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/database refused/) })
  })
})
