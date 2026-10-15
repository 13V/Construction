import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import programmeSrc from '../../worker/simple/Programme.tsx?raw'
import { removeFile, uploadFile } from '../phone'
import {
  loadProgrammes,
  PROGRAMME_ACCEPT,
  PROGRAMME_COLS,
  PROGRAMME_MAX_BYTES,
  programmeInsert,
  programmeName,
  programmeRefusal,
  splitProgrammes,
  todayISO,
  uploadProgramme,
  type Db,
  type ProgrammeRow,
} from './programme'

// Storage goes through the phone's own helpers; here they are stand-ins, so
// nothing leaves the test.
vi.mock('../phone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../phone')>()),
  uploadFile: vi.fn(async (_bucket: string, path: string) => path),
  removeFile: vi.fn(async () => {}),
}))

/**
 * The builder's programme, read from the phone's own source (Programme.tsx)
 * and run beside the website's copies in programme.ts: the read, the
 * current/superseded split, and the row an upload inserts. Change the phone
 * and this names what to bring into line.
 */

const PHONE = ts.createSourceFile('Programme.tsx', programmeSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

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
function decl(name: string): Decl {
  const found = all(PHONE, (n): n is Decl => (ts.isFunctionDeclaration(n) && n.name?.text === name) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name))
  if (found.length !== 1) throw new Error(`Programme.tsx: expected one declaration of ${name}, found ${found.length}. Was it renamed or moved?`)
  return found[0]!
}

const js = (tsx: string) =>
  ts.transpileModule(tsx, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export\s*\{\s*\};?\s*$/m, '')

function run<T>(body: string, scope: Record<string, unknown>, ret: string): T {
  const names = Object.keys(scope)
  return new Function(...names, `${js(`${body}\nconst __ret = (${ret})`)}\nreturn __ret`)(...names.map((n) => scope[n])) as T
}

/** A string constant's value. */
const constant = (name: string) => {
  const d = decl(name) as ts.VariableDeclaration
  if (!d.initializer || !ts.isStringLiteralLike(d.initializer)) throw new Error(`${name} is no longer a string`)
  return d.initializer.text
}

/** A PostgREST call chain as [method, args as written], the .from first. */
function chain(call: ts.Expression): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let at: ts.Expression = call
  while (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    out.unshift([at.expression.name.text, at.arguments.map((a) => a.getText(PHONE)).join(', ')])
    at = at.expression.expression
  }
  return out
}

/** A fake client that records every call and answers each chain with `answer(table)`. */
function recorder(answer: (table: string, calls: string[]) => unknown) {
  const calls: string[] = []
  const chainFor = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'insert', 'single']) {
      b[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
        return b
      }
    }
    b.then = (resolve: (v: unknown) => void) => resolve(answer(table, calls))
    return b
  }
  return { calls, client: { from: chainFor } as unknown as Db }
}

describe("the phone's read", () => {
  it('selects the same columns', () => {
    expect(PROGRAMME_COLS).toBe(constant('COLS'))
  })

  it('in the same order: newest received first, then newest made', async () => {
    const load = decl('load') as ts.VariableDeclaration
    const calls = all(load, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'order')
    const outer = calls.find((c) => !(ts.isPropertyAccessExpression(c.parent) && ts.isCallExpression(c.parent.parent)))!
    const phone = chain(outer).map(([m, a]) => `${m}(${a})`)
    expect(phone).toEqual(["from('programmes')", 'select(COLS)', "eq('site_id', siteId)", "order('received_on', { ascending: false })", "order('created_at', { ascending: false })"])

    const { calls: web, client } = recorder(() => ({ data: [], error: null }))
    await loadProgrammes('site-1', client)
    expect(web).toEqual([
      `programmes.select(${JSON.stringify(PROGRAMME_COLS)})`,
      'programmes.eq("site_id", "site-1")',
      'programmes.order("received_on", {"ascending":false})',
      'programmes.order("created_at", {"ascending":false})',
    ])
  })

  it('splits current from the rest the way useProgrammes does', () => {
    const fn = decl('useProgrammes') as ts.FunctionDeclaration
    const stmts = fn.body!.statements.filter((s) => ts.isVariableStatement(s) && ['current', 'history'].includes(s.declarationList.declarations[0]!.name.getText(PHONE)))
    expect(stmts).toHaveLength(2)
    const body = stmts.map((s) => s.getText(PHONE)).join('\n')
    const row = (id: string, status: ProgrammeRow['status']): ProgrammeRow => ({ id, name: id, revision: null, issued_on: null, received_on: '2026-10-15', storage_path: null, status })
    const cases: ProgrammeRow[][] = [
      [],
      [row('a', 'current')],
      [row('b', 'current'), row('a', 'superseded')],
      [row('c', 'superseded'), row('b', 'draft')],
      [row('c', 'draft'), row('b', 'current'), row('a', 'superseded')],
    ]
    for (const rows of cases) {
      const phone = run<{ current: ProgrammeRow | null; history: ProgrammeRow[] }>(body, { rows }, '{ current, history }')
      const web = splitProgrammes(rows)
      expect(web.current).toEqual(phone.current)
      expect(web.history).toEqual(phone.history)
    }
  })
})

describe("the phone's upload", () => {
  const sheet = decl('ProgrammeSheet') as ts.FunctionDeclaration
  const inserts = all(sheet, (n): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'insert' && !!n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0]),
  )
  const literal = inserts[0]?.arguments[0] as ts.ObjectLiteralExpression

  it('inserts once, into programmes', () => {
    expect(inserts).toHaveLength(1)
    expect(chain(inserts[0]!)[0]).toEqual(['from', "'programmes'"])
  })

  it('sends the same keys in the same order', () => {
    const keys = literal.properties.map((p) => p.name!.getText(PHONE))
    const web = programmeInsert({ me: { id: 'w', company_id: 'co' }, siteId: 's', file: { name: 'x.pdf' }, revision: '', issuedOn: '', path: 'p' })
    expect(Object.keys(web)).toEqual(keys)
  })

  it('with the same values, blanks and all', () => {
    const today = run<() => string>((decl('todayISO') as ts.VariableDeclaration).parent.parent.getText(PHONE), {}, 'todayISO')
    expect(todayISO()).toBe(today())
    const me = { id: 'w-1', company_id: 'co-1' }
    const site = { id: 'site-1' }
    for (const [name, revision, issuedOn] of [
      ['Stage-2_programme.pdf', ' Rev 2 ', '2026-10-01'],
      ['programme.PDF', '', ''],
      ['photo of programme.jpeg', '   ', '2026-09-30'],
      ['no extension', 'P4', ''],
    ]) {
      const path = `co-1/site-1/uuid-${name}`
      const phone = run<Record<string, unknown>>('', { me, site, file: { name }, revision, issuedOn, path, todayISO: today }, literal.getText(PHONE))
      expect(programmeInsert({ me, siteId: site.id, file: { name }, revision, issuedOn, path })).toEqual(phone)
    }
    expect(programmeName('Stage-2_programme.pdf')).toBe('Stage 2 programme')
  })

  it('takes the files the phone takes', () => {
    const input = all(sheet, (n): n is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(n) && n.tagName.getText(PHONE) === 'input' && n.getText(PHONE).includes('type="file"'))
    expect(input).toHaveLength(1)
    const accept = input[0]!.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(PHONE) === 'accept') as ts.JsxAttribute
    expect((accept.initializer as ts.StringLiteral).text).toBe(PROGRAMME_ACCEPT)
  })
})

describe('uploadProgramme', () => {
  it('refuses a file over 25 MB before anything is sent', async () => {
    expect(programmeRefusal({ name: 'big.pdf', size: PROGRAMME_MAX_BYTES + 1 })).toMatch(/over 25 MB/)
    const from = vi.fn()
    const file = { name: 'big.pdf', size: 26 * 1024 * 1024, type: 'application/pdf' } as File
    vi.mocked(uploadFile).mockClear()
    const out = await uploadProgramme({ me: { id: 'w', company_id: 'co' }, siteId: 's', file, revision: 'Rev 2', issuedOn: '' }, { from } as unknown as Db)
    expect(out.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('reads back that the new revision is the only current one', async () => {
    const stored = { id: 'new', name: 'p', revision: 'Rev 2', issued_on: null, received_on: '2026-10-15', storage_path: '', status: 'current' }
    let readsOfProgrammes = 0
    const { calls, client } = recorder((_t, log) => {
      const last = log[log.length - 1]!
      if (last.startsWith('programmes.single')) {
        // The insert: echo the path it was sent.
        const sent = JSON.parse(log.find((c) => c.startsWith('programmes.insert'))!.slice('programmes.insert('.length, -1))
        return { data: { ...stored, storage_path: sent.storage_path }, error: null }
      }
      readsOfProgrammes += 1
      // First the current one before the upload, then the read-back after it.
      return readsOfProgrammes === 1
        ? { data: [{ id: 'old' }], error: null }
        : { data: [{ id: 'new', status: 'current' }, { id: 'old', status: 'superseded' }], error: null }
    })
    const file = { name: 'Rev2.pdf', size: 10, type: 'application/pdf' } as File
    const out = await uploadProgramme({ me: { id: 'w', company_id: 'co' }, siteId: 's', file, revision: 'Rev 2', issuedOn: '' }, client)
    expect(out).toMatchObject({ ok: true, superseded: ['old'] })
    expect(calls.some((c) => c.startsWith('programmes.in("id", ["new","old"])'))).toBe(true)
    // The row sent is the phone's, at the path the file went to.
    const sent = JSON.parse(calls.find((c) => c.startsWith('programmes.insert'))!.slice('programmes.insert('.length, -1))
    expect(sent).toMatchObject({ company_id: 'co', site_id: 's', source: 'pdf', status: 'current', revision: 'Rev 2', imported_by: 'w' })
    expect(vi.mocked(uploadFile).mock.calls.at(-1)?.[1]).toBe(sent.storage_path)
  })

  it('a row that does not save takes its file back out of storage', async () => {
    vi.mocked(removeFile).mockClear()
    const { client } = recorder((_t, log) =>
      log[log.length - 1]!.startsWith('programmes.single') ? { data: null, error: { message: 'new row violates row-level security policy' } } : { data: [], error: null },
    )
    const file = { name: 'p.pdf', size: 10, type: 'application/pdf' } as File
    const out = await uploadProgramme({ me: { id: 'w', company_id: 'co' }, siteId: 's', file, revision: '', issuedOn: '' }, client)
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/row-level security/) })
    expect(vi.mocked(removeFile).mock.calls.at(-1)?.[1]).toBe(vi.mocked(uploadFile).mock.calls.at(-1)?.[1])
  })

  it('says so when the earlier revision still reads current', async () => {
    let n = 0
    const { client } = recorder((_t, log) => {
      if (log[log.length - 1]!.startsWith('programmes.single')) {
        const sent = JSON.parse(log.find((c) => c.startsWith('programmes.insert'))!.slice('programmes.insert('.length, -1))
        return { data: { id: 'new', storage_path: sent.storage_path, status: 'current' }, error: null }
      }
      n += 1
      return n === 1 ? { data: [{ id: 'old' }], error: null } : { data: [{ id: 'new', status: 'current' }, { id: 'old', status: 'current' }], error: null }
    })
    const file = { name: 'Rev2.pdf', size: 10, type: 'application/pdf' } as File
    const out = await uploadProgramme({ me: { id: 'w', company_id: 'co' }, siteId: 's', file, revision: '', issuedOn: '' }, client)
    expect(out).toMatchObject({ ok: true, warning: expect.stringMatching(/still reads as current/) })
  })
})
