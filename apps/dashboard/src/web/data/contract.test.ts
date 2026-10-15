import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import projectsSrc from '../../worker/simple/Projects.tsx?raw'
import overviewSrc from '../../worker/simple/Overview.tsx?raw'
import plansSrc from '../../worker/PlansScreen.tsx?raw'
import drawingsSrc from '../../worker/simple/Drawings.tsx?raw'
import fenceSrc from '../../worker/simple/FencePicker.tsx?raw'
import contractSrc from './contract.ts?raw'
import * as web from './contract'
import { planBookings } from './bookings'
import { buildJobInsert } from './jobs'

/**
 * The phone's private rules, read from the phone's own source, against the
 * copies in contract.ts. Any drift fails here: change the phone and this
 * names the copy to bring into line; change a copy and this says it no
 * longer matches the phone.
 *
 * Verbatim copies are compared as code (printed by TypeScript without
 * comments, so formatting and comments may differ, nothing else may).
 * Rules that live inside a phone component are cut out of the source,
 * compiled, and run beside the copy on the same inputs.
 */

// ------------------------------------------------------------------ helpers

type Decl = ts.FunctionDeclaration | ts.VariableDeclaration

const parse = (file: string, src: string) =>
  ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const PHONE = {
  projects: parse('Projects.tsx', projectsSrc),
  overview: parse('Overview.tsx', overviewSrc),
  plans: parse('PlansScreen.tsx', plansSrc),
  drawings: parse('Drawings.tsx', drawingsSrc),
  fence: parse('FencePicker.tsx', fenceSrc),
}
const WEB = parse('contract.ts', contractSrc)

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

/** The one function or variable declaration called `name` anywhere in the file. */
function decl(sf: ts.SourceFile, name: string): Decl {
  const found = all(sf, (n): n is Decl =>
    (ts.isFunctionDeclaration(n) && n.name?.text === name) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name),
  )
  if (found.length !== 1) throw new Error(`${sf.fileName}: expected one declaration of ${name}, found ${found.length}. Was it renamed or moved?`)
  return found[0]!
}

const printer = ts.createPrinter({ removeComments: true })
/** Code as TypeScript prints it, without comments or an export keyword. */
function code(node: ts.Node, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/^export\s+/, '').replace(/\s+/g, ' ').trim()
}

/** The statement text of a declaration, export dropped, ready to compile. */
function source(d: Decl, sf: ts.SourceFile): string {
  const stmt = ts.isVariableDeclaration(d) ? d.parent.parent : d
  return stmt.getText(sf).replace(/^export\s+/, '')
}

/** Compile TypeScript (TSX allowed) to plain JavaScript. */
function js(tsx: string): string {
  return ts.transpileModule(tsx, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export\s*\{\s*\};?\s*$/m, '')
}

/** Run phone code: `body` sees `scope` as variables and returns `ret`. */
function run<T>(body: string, scope: Record<string, unknown>, ret: string): T {
  const names = Object.keys(scope)
  return new Function(...names, `${js(`${body}\nconst __ret = (${ret})`)}\nreturn __ret`)(...names.map((n) => scope[n])) as T
}

/** The initializer of a variable declaration. */
function init(d: Decl): ts.Expression {
  if (!ts.isVariableDeclaration(d) || !d.initializer) throw new Error('not a variable with a value')
  return d.initializer
}

/** String-literal properties of an object literal, by name. */
function stringProps(obj: ts.Expression): Record<string, string> {
  if (!ts.isObjectLiteralExpression(obj)) throw new Error('not an object literal')
  const out: Record<string, string> = {}
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) out[p.name.getText()] = p.initializer.text
  }
  return out
}

/** A PostgREST call chain as [method, args as printed], innermost (the .from) first. */
function chain(call: ts.Expression, sf: ts.SourceFile): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let at: ts.Expression = call
  while (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    out.unshift([at.expression.name.text, at.arguments.map((a) => code(a, sf)).join(', ')])
    at = at.expression.expression
  }
  return out
}

/** Every outermost call chain in a subtree that reads from `table`. */
function queriesOf(root: ts.Node, sf: ts.SourceFile, table: string): Array<Array<[string, string]>> {
  const calls = all(root, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression))
  const outermost = calls.filter((c) => !(ts.isPropertyAccessExpression(c.parent) && ts.isCallExpression(c.parent.parent)))
  return outermost.map((c) => chain(c, sf)).filter((ch) => ch.some(([m, a]) => m === 'from' && a === `'${table}'`))
}

// ------------------------------------------------------------ the insert

describe("the phone's New project sheet insert", () => {
  const sheet = decl(PHONE.projects, 'NewProjectSheet')
  const inserts = all(sheet, (n): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'insert' && !!n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0]),
  )
  const literal = inserts[0]?.arguments[0] as ts.ObjectLiteralExpression

  it('is found, once', () => {
    expect(inserts).toHaveLength(1)
  })

  it('sends exactly PHONE_INSERT_KEYS', () => {
    const keys = literal.properties.map((p) => (p.name ? p.name.getText(PHONE.projects) : '?'))
    expect(keys).toEqual([...web.PHONE_INSERT_KEYS])
  })

  const phoneInsert = (typed: { name: string; address: string; builder: string; work: string }) =>
    run<Record<string, unknown>>('', { me: { company_id: 'co-1' }, fence: { lat: -34.98, lng: 138.46, radiusM: 80 }, ...typed }, literal.getText(PHONE.projects))

  it("has the blanks and the status contract.ts says it has", () => {
    const row = phoneInsert({ name: ' Job ', address: '   ', builder: '  ', work: '' })
    expect({ address: row.address, job_type: row.job_type, client_name: row.client_name }).toEqual(web.PHONE_BLANKS)
    expect(row.status).toBe(web.PHONE_NEW_STATUS)
  })

  it('is what buildJobInsert sends for the same typing, key for key', () => {
    for (const typed of [
      { name: ' Job ', address: '   ', builder: '  ', work: '' },
      { name: 'Maple Ridge', address: ' 2 Brigalow Ave, Seacombe Gardens SA 5047 ', builder: ' Paramoint ', work: ' Bathrooms ' },
    ]) {
      const phone = phoneInsert(typed)
      const ours = buildJobInsert('co-1', {
        name: typed.name,
        address: typed.address,
        builderName: typed.builder,
        workType: typed.work,
        colour: '#5C8A63',
        fence: { lat: -34.98, lng: 138.46, radiusM: 80 },
      }) as unknown as Record<string, unknown>
      const shared = Object.fromEntries(web.PHONE_INSERT_KEYS.map((k) => [k, ours[k]]))
      expect(shared).toEqual(phone)
    }
  })

  it("matches the phone's fence slider", () => {
    const range = all(PHONE.fence, (n): n is ts.JsxSelfClosingElement =>
      ts.isJsxSelfClosingElement(n) && n.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === 'type' && a.initializer?.getText() === '"range"'),
    )
    expect(range).toHaveLength(1)
    const attr = (name: string) => {
      const a = range[0]!.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === name) as ts.JsxAttribute | undefined
      return Number((a?.initializer as ts.JsxExpression | undefined)?.expression?.getText())
    }
    expect({ min: attr('min'), max: attr('max'), step: attr('step') }).toEqual({ min: web.RADIUS_MIN, max: web.RADIUS_MAX, step: web.RADIUS_STEP })
    expect(fenceSrc).toMatch(new RegExp(`useState\\(value\\?\\.radiusM \\?\\? ${web.RADIUS_DEFAULT}\\)`))
  })
})

// ------------------------------------------------------------- bookings

describe("the phone's booking helpers", () => {
  for (const name of ['weekdaysBetween', 'ASSIGN_MAX_DAYS', 'bookingTimes', 'localISO']) {
    it(`${name} is the phone's, verbatim`, () => {
      expect(code(decl(WEB, name), WEB)).toBe(code(decl(PHONE.projects, name), PHONE.projects))
    })
  }

  const phone = run<{
    weekdaysBetween: (a: string, b: string) => Date[]
    bookingTimes: (d: Date) => { starts_at: string; ends_at: string }
    localISO: (d: Date) => string
    ASSIGN_MAX_DAYS: number
  }>(
    ['ASSIGN_MAX_DAYS', 'weekdaysBetween', 'bookingTimes', 'localISO'].map((n) => source(decl(PHONE.projects, n), PHONE.projects)).join('\n'),
    {},
    '{ weekdaysBetween, bookingTimes, localISO, ASSIGN_MAX_DAYS }',
  )

  it('ASSIGN_MAX_DAYS is the same number', () => {
    expect(web.ASSIGN_MAX_DAYS).toBe(phone.ASSIGN_MAX_DAYS)
  })

  it('books the same days at the same times', () => {
    for (const [from, to] of [
      ['2027-03-01', '2027-03-05'],
      ['2027-03-27', '2027-04-09'],
      ['2026-12-20', '2027-01-08'],
      ['2027-01-01', '2027-12-31'],
      ['2027-03-06', '2027-03-07'],
      ['2027-03-09', '2027-03-08'],
    ]) {
      const a = phone.weekdaysBetween(from!, to!)
      const b = web.weekdaysBetween(from!, to!)
      expect(b.map(web.localISO)).toEqual(a.map(phone.localISO))
      expect(b.map(web.bookingTimes)).toEqual(a.map(phone.bookingTimes))
    }
  })

  const assign = decl(PHONE.projects, 'AssignSheet')

  it("reads clashes the phone's way: any job, published or not, local midnight to the last millisecond", () => {
    const reads = queriesOf(assign, PHONE.projects, 'assignments').filter((q) => q.every(([m]) => m !== 'insert'))
    expect(reads).toEqual([
      [
        ['from', "'assignments'"],
        ['select', "'worker_id, starts_at'"],
        ['in', "'worker_id', ids"],
        ['gte', "'starts_at', first.toISOString()"],
        ['lte', "'starts_at', last.toISOString()"],
      ],
    ])
    const body = code(assign, PHONE.projects)
    expect(body).toContain('const first = new Date(days[0]!); first.setHours(0, 0, 0, 0);')
    expect(body).toContain('const last = new Date(days[days.length - 1]!); last.setHours(23, 59, 59, 999);')
    // The window clashWindow computes is that one.
    const days = web.weekdaysBetween('2027-03-01', '2027-03-05')
    const first = new Date(days[0]!)
    first.setHours(0, 0, 0, 0)
    const last = new Date(days[days.length - 1]!)
    last.setHours(23, 59, 59, 999)
    expect(web.clashWindow(days)).toEqual({ from: first.toISOString(), to: last.toISOString() })
  })

  it('keys a clash by person and local day, as the phone does', () => {
    const body = code(assign, PHONE.projects)
    expect(body).toContain('(a) => `${a.worker_id}|${localISO(new Date(a.starts_at))}`')
    expect(body).toContain('if (taken.has(`${id}|${localISO(day)}`))')
    const day = new Date(2027, 2, 3)
    expect(web.clashKey('w', day)).toBe(`w|${phone.localISO(day)}`)
    expect(web.clashKey('w', web.bookingTimes(day).starts_at)).toBe(`w|${phone.localISO(new Date(web.bookingTimes(day).starts_at))}`)
  })

  it("writes the phone's booking row, and planBookings writes the same", () => {
    const pushes = all(assign, (n): n is ts.CallExpression =>
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.getText(PHONE.projects) === 'rows.push',
    )
    expect(pushes).toHaveLength(1)
    const literal = pushes[0]!.arguments[0]!.getText(PHONE.projects)
    const days = web.weekdaysBetween('2027-03-01', '2027-03-05')
    const phoneRows = days.map((day) =>
      run('', { me: { company_id: 'co' }, id: 'w1', site: { id: 's1' }, day, bookingTimes: phone.bookingTimes }, literal),
    )
    const plan = planBookings({ companyId: 'co', siteId: 's1', workerIds: ['w1'], from: '2027-03-01', to: '2027-03-05' })
    expect(plan.rows).toEqual(phoneRows)
  })

  it("removes the phone's way: this job, this person, from local midnight today", () => {
    const projects = decl(PHONE.projects, 'removePerson')
    const deletes = queriesOf(projects, PHONE.projects, 'assignments')
    expect(deletes).toEqual([
      [
        ['from', "'assignments'"],
        ['delete', ''],
        ['eq', "'site_id', siteId"],
        ['eq', "'worker_id', workerId"],
        ['gte', "'starts_at', t0.toISOString()"],
        ['select', "'id'"],
      ],
    ])
    expect(code(projects, PHONE.projects)).toContain('const t0 = new Date(); t0.setHours(0, 0, 0, 0);')
  })
})

// --------------------------------------------------------- the attention chip

describe("the phone's Projects chip", () => {
  // Compiled once; `data` and `office` are what the phone's closure reads.
  const compiled = new Function('data', 'office', `${js(source(decl(PHONE.projects, 'chipOf'), PHONE.projects))}\nreturn chipOf`) as (
    data: unknown,
    office: boolean,
  ) => (site: { id: string }) => { chip: string; bg: string; fg: string } | null
  const phoneChip = (n: web.AttentionCounts, office: boolean) =>
    compiled(
      {
        openDefects: new Map([['s', n.defects]]),
        floodHold: new Map([['s', n.flood]]),
        pendingVariationsBySite: new Map([['s', n.variations]]),
      },
      office,
    )({ id: 's' })

  it('says the same words in the same colours, worst first', () => {
    for (const defects of [0, 1, 2]) {
      for (const flood of [0, 1, 3]) {
        for (const variations of [0, 1, 4]) {
          for (const office of [true, false]) {
            const p = phoneChip({ defects, flood, variations }, office)
            const w = web.chipOf({ defects, flood, variations })
            expect(w && { chip: w.chip, bg: w.bg, fg: w.fg }).toEqual(p && { chip: p.chip, bg: p.bg, fg: p.fg })
          }
        }
      }
    }
  })
})

// ------------------------------------------------------------- scope of works

describe("the phone's scope of works", () => {
  it('SCOPE_TEMPLATE is the same seven lines, verbatim', () => {
    expect(code(init(decl(WEB, 'SCOPE_TEMPLATE')), WEB)).toBe(code(init(decl(PHONE.overview, 'SCOPE_TEMPLATE')), PHONE.overview))
    const phone = run<web.ScopeLine[]>('', {}, init(decl(PHONE.overview, 'SCOPE_TEMPLATE')).getText(PHONE.overview))
    expect(web.SCOPE_TEMPLATE).toEqual(phone)
  })

  it('has the same three statuses', () => {
    const alias = all(PHONE.overview, (n): n is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(n) && n.name.text === 'ScopeStatus')
    expect(alias).toHaveLength(1)
    const literals = all(alias[0]!.type, (n): n is ts.StringLiteral => ts.isStringLiteral(n)).map((s) => s.text)
    expect([...literals].sort()).toEqual([...web.SCOPE_STATUSES].sort())
  })

  it('labels and colours them as the phone does', () => {
    const meta = init(decl(PHONE.overview, 'STATUS_META'))
    if (!ts.isObjectLiteralExpression(meta)) throw new Error('STATUS_META is not an object literal')
    const phone: Record<string, Record<string, string>> = {}
    for (const p of meta.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      const { label, bg, fg } = stringProps(p.initializer)
      phone[p.name.getText(PHONE.overview)] = { label: label!, bg: bg!, fg: fg! }
    }
    expect(web.SCOPE_STATUS).toEqual(phone)
  })

  it('counts a job the way the phone does', () => {
    const body = code(decl(PHONE.overview, 'OverviewTab'), PHONE.overview)
    expect(body).toContain('for (const { row } of lines) counts[row?.status ?? \'pending\'] += 1;')
    expect(web.scopeCounts([])).toEqual({ chosen: 0, pending: 7, not_applicable: 0, total: 7 })
    expect(
      web.scopeCounts([
        { scope_key: 'grout', status: 'chosen' },
        { scope_key: 'strip_drains', status: 'not_applicable' },
        { scope_key: null, status: 'pending' },
        { scope_key: 'retired_key', status: 'chosen' },
      ]),
    ).toEqual({ chosen: 1, pending: 6, not_applicable: 1, total: 8 })
  })
})

// --------------------------------------------------------- the drawing register

describe("the phone's drawing register", () => {
  const filterOf = (q: Array<[string, string]>) =>
    q
      .filter(([m, a]) => (m === 'eq' || m === 'is' || m === 'not' || m === 'in' || m === 'neq') && !a.startsWith("'site_id'"))
      .map(([m, a]) => {
        const [col, val] = a.split(/,\s*/)
        return [m, JSON.parse(col!.replace(/'/g, '"')), val === 'null' ? null : JSON.parse(val!.replace(/'/g, '"'))]
      })
  const expected = web.DRAWING_FILTER.map((f) => [...f])

  it('PlansScreen filters site_files exactly as DRAWING_FILTER', () => {
    const qs = queriesOf(PHONE.plans, PHONE.plans, 'site_files')
    expect(qs).toHaveLength(1)
    expect(filterOf(qs[0]!)).toEqual(expected)
  })

  it("the Drawings button counts with the same filter", () => {
    const qs = queriesOf(PHONE.drawings, PHONE.drawings, 'site_files')
    expect(qs).toHaveLength(1)
    expect(filterOf(qs[0]!)).toEqual(expected)
  })

  it('isDrawing and drawingsOnly apply that filter', () => {
    const calls: Array<[string, string, unknown]> = []
    const q = {
      eq(c: string, v: unknown) {
        calls.push(['eq', c, v])
        return q
      },
      is(c: string, v: null) {
        calls.push(['is', c, v])
        return q
      },
    }
    web.drawingsOnly(q)
    expect(calls).toEqual(expected)
    expect(web.isDrawing({ kind: 'document', selection_id: null, waterproofing_package_id: null })).toBe(true)
    expect(web.isDrawing({ kind: 'document', selection_id: 'x', waterproofing_package_id: null })).toBe(false)
    expect(web.isDrawing({ kind: 'document', selection_id: null, waterproofing_package_id: 'x' })).toBe(false)
    expect(web.isDrawing({ kind: 'photo', selection_id: null, waterproofing_package_id: null })).toBe(false)
  })

  it('supersededIds is the phone rule', () => {
    const memo = init(decl(PHONE.plans, 'supersededIds'))
    if (!ts.isCallExpression(memo) || !ts.isArrowFunction(memo.arguments[0]!)) throw new Error('supersededIds is no longer a useMemo(() => …)')
    const body = (memo.arguments[0] as ts.ArrowFunction).body.getText(PHONE.plans)
    const sheets = [
      { id: 'a', supersedes: null },
      { id: 'b', supersedes: 'a' },
      { id: 'c', supersedes: 'b' },
      { id: 'd', supersedes: null },
    ]
    expect(web.supersededIds(sheets)).toEqual(run<Set<string>>('', { sheets }, body))
  })

  it('revChip is the phone\'s, verbatim, and so is the chip it heads', () => {
    expect(code(decl(WEB, 'revChip'), WEB)).toBe(code(decl(PHONE.plans, 'revChip'), PHONE.plans))
    const chips = all(PHONE.plans, (n): n is ts.ConditionalExpression => ts.isConditionalExpression(n) && n.getText(PHONE.plans).includes("'SUPERSEDED'"))
    expect(chips.length).toBeGreaterThan(0)
    const revChip = run<(v: string) => string>(source(decl(PHONE.plans, 'revChip'), PHONE.plans), {}, 'revChip')
    for (const chip of chips) {
      const text = chip.getText(PHONE.plans)
      const holder = /(\w+)\.version/.exec(text)![1]!
      for (const version of [null, 'Rev A', 'rev b', 'C', 'REV 3']) {
        for (const superseded of [true, false]) {
          expect(web.sheetChip(version, superseded)).toBe(run('', { superseded, revChip, [holder]: { version } }, text))
        }
      }
    }
  })
})

// --------------------------------------------------------------- bumpVersion

describe('bumpVersion, kept from the old dashboard', () => {
  // The old dashboard is being deleted; while its file is here, the copy must match it.
  const old = Object.values(import.meta.glob<string>('/src/ui/JobSiteFolder.tsx', { query: '?raw', import: 'default', eager: true }))[0]

  it.runIf(Boolean(old))("is the old dashboard's, verbatim", () => {
    const sf = parse('JobSiteFolder.tsx', old!)
    expect(code(decl(WEB, 'bumpVersion'), WEB)).toBe(code(decl(sf, 'bumpVersion'), sf))
  })

  it('bumps the way it always has', () => {
    expect(web.bumpVersion('Rev A')).toBe('Rev B')
    expect(web.bumpVersion(' Rev C ')).toBe('Rev D')
    expect(web.bumpVersion('Rev Y')).toBe('Rev Z')
    expect(web.bumpVersion('Rev Z')).toBe('Rev B')
    expect(web.bumpVersion('P2')).toBe('P3')
    expect(web.bumpVersion('Rev 9')).toBe('Rev 10')
    expect(web.bumpVersion(null)).toBe('Rev B')
    expect(web.bumpVersion('Issue for construction')).toBe('Rev B')
  })
})

// ---------------------------------------------------------- builder contacts

describe("the phone's words for the builder's people", () => {
  it('CONTACT_LABEL matches Project details', () => {
    const titles = stringProps(init(decl(PHONE.overview, 'EDIT_TITLE')))
    for (const role of web.CONTACT_ROLES) expect(web.CONTACT_LABEL[role]).toBe(titles[role])
  })
})

describe("the phone's one person per role", () => {
  const editor = all(PHONE.overview, (n): n is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(n) && n.tagName.getText(PHONE.overview) === 'DetailEditor')
  const contactProp = (el: ts.JsxSelfClosingElement) =>
    el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(PHONE.overview) === 'contact')

  it('Project details shows the first contact in each role', () => {
    const byRole = run<(role: string) => { id: string } | null>(
      '',
      { contacts: [{ id: 'pm-1', role: 'project_manager' }, { id: 'sup-1', role: 'supervisor' }, { id: 'pm-2', role: 'project_manager' }] },
      init(decl(PHONE.overview, 'byRole')).getText(PHONE.overview),
    )
    expect(byRole('project_manager')?.id).toBe('pm-1')
    expect(byRole('contract_admin')).toBeNull()
  })

  it('and its editor edits that one, so it never makes a second project manager or contract administrator (ONE_PER_BUILDER)', () => {
    expect(editor).toHaveLength(1)
    const value = contactProp(editor[0]!)?.initializer
    expect(value && ts.isJsxExpression(value) && value.expression ? code(value.expression, PHONE.overview) : null).toMatch(/: byRole\(editRow\)$/)
    expect(web.ONE_PER_BUILDER).toEqual(['project_manager', 'contract_admin'])
  })

  it("puts the job's own supervisor first, so a builder may have one supervisor per job", () => {
    const calls = all(PHONE.overview, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(PHONE.overview) === 'setContacts')
    expect(calls.map((c) => code(c, PHONE.overview))).toContain('setContacts(supRow ? [supRow, ...rows.filter((r) => r.id !== supRow.id)] : rows)')
    expect(web.ONE_PER_BUILDER).not.toContain('supervisor')
  })
})
