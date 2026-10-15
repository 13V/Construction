import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The wall between the website and the phone app.
 *
 * Everything under src/worker (and every shared module it imports) ships in
 * the iOS app; src/web never does. That only stays true while the imports
 * keep to these rules, so this test reads every source file and fails on any
 * import that breaks one:
 *
 *  1. Nothing outside src/web imports src/web, except main.tsx's single
 *     '@web/entry' (the lazy import the phone build folds away).
 *  2. Inside src/web, only the two barrels (phone.ts, phone-features.ts)
 *     reach phone-side code. One greppable list of what the website shares
 *     with the phone. Tests are exempt: parity tests read phone sources.
 *  3. src/web never imports the old office theme (src/theme.ts) or the old
 *     dashboard's components (src/ui/*), which are being deleted.
 *  4. The code the website loads first (everything entry.tsx reaches without
 *     a dynamic import) does not include phone-features.ts, whose panels and
 *     PDF builders belong in the lazily loaded pages.
 *
 * Imports are read with TypeScript's own parser, so comments, strings and
 * multi-line import lists cannot fool it.
 */

type Sources = Record<string, string>

/** Every .ts/.tsx file under src, keyed '/src/…', as text. */
const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

interface Edge {
  /** As written. */
  spec: string
  /** '/src/…' for a file in the app (extension resolved where it can be), or null for a package. */
  target: string | null
  /** import type / export type: gone after compilation. */
  typeOnly: boolean
  /** import('…'): its own chunk, loaded on demand. */
  dynamic: boolean
  line: number
}

const WEB = '/src/web/'
const BARRELS = new Set(['/src/web/phone.ts', '/src/web/phone-features.ts'])
const ENTRY = '/src/web/entry.tsx'
const FEATURES = '/src/web/phone-features.ts'
const ALIASES: Record<string, string> = { '@web/entry': ENTRY }

const isTest = (file: string) => /\.test\.tsx?$/.test(file)

function normalise(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return `/${out.join('/')}`
}

function resolve(from: string, spec: string, files: Sources): string | null {
  const bare = spec.split('?')[0]
  if (ALIASES[bare]) return ALIASES[bare]
  if (bare.startsWith('@web/')) return `${WEB}${bare.slice(5)}`
  if (!bare.startsWith('.') && !bare.startsWith('/')) return null
  const base = bare.startsWith('/') ? normalise(bare) : normalise(`${from.slice(0, from.lastIndexOf('/'))}/${bare}`)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (candidate in files) return candidate
  }
  // A stylesheet, a JSON file, an image: not in the glob, but where it lives still counts.
  return base
}

/** The import edges of one file. */
function edgesOf(file: string, source: string, files: Sources): Edge[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Edge[] = []
  const add = (node: ts.Node, specNode: ts.Expression, typeOnly: boolean, dynamic: boolean) => {
    if (!ts.isStringLiteralLike(specNode)) return
    const spec = specNode.text
    out.push({ spec, target: resolve(file, spec, files), typeOnly, dynamic, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 })
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      // `import type {…}`, or `import { type A, type B }` with nothing else, is erased.
      const allTypes =
        !!clause &&
        (clause.isTypeOnly ||
          (!clause.name &&
            !!clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly)))
      add(node, node.moduleSpecifier, allTypes, false)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const allTypes =
        node.isTypeOnly ||
        (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly))
      add(node, node.moduleSpecifier, allTypes, false)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
      add(node, node.arguments[0], false, true)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly, false)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Every rule broken in `files`, as "file:line  why". */
function violations(files: Sources): string[] {
  const out: string[] = []
  const graph = new Map<string, Edge[]>()
  for (const [file, source] of Object.entries(files)) graph.set(file, edgesOf(file, source, files))

  for (const [file, edges] of graph) {
    const inWeb = file.startsWith(WEB)
    for (const e of edges) {
      const where = `${file}:${e.line}  '${e.spec}'`
      const t = e.target
      // 1. Into src/web from outside.
      if (!inWeb && (t?.startsWith(WEB) || e.spec.startsWith('@web/'))) {
        if (!(file === '/src/main.tsx' && e.spec === '@web/entry')) out.push(`${where}: only main.tsx may import the website, and only as '@web/entry'`)
      }
      if (!inWeb || !t || !t.startsWith('/src/')) continue
      // 3. The old office theme and components.
      const raw = e.spec.includes('?raw')
      if ((t === '/src/theme.ts' || t.startsWith('/src/ui/')) && !(isTest(file) && raw)) {
        out.push(`${where}: the website does not use the old office dashboard's ${t === '/src/theme.ts' ? 'theme' : 'components'}`)
      }
      // 2. Phone-side code, other than through the two barrels.
      if (!t.startsWith(WEB) && !BARRELS.has(file) && !isTest(file)) {
        out.push(`${where}: reach phone code through src/web/phone.ts or src/web/phone-features.ts`)
      }
    }
  }

  // 4. What entry.tsx pulls in eagerly: static, value-carrying imports only.
  if (graph.has(ENTRY)) {
    const seen = new Map<string, string | null>([[ENTRY, null]])
    const queue = [ENTRY]
    while (queue.length) {
      const file = queue.shift()!
      for (const e of graph.get(file) ?? []) {
        if (e.dynamic || e.typeOnly || !e.target || !graph.has(e.target) || seen.has(e.target)) continue
        seen.set(e.target, file)
        queue.push(e.target)
      }
    }
    if (seen.has(FEATURES)) {
      const chain: string[] = []
      for (let at: string | null = FEATURES; at; at = seen.get(at) ?? null) chain.unshift(at)
      out.push(`${FEATURES} is loaded eagerly (${chain.join(' -> ')}): only lazily loaded pages may import it`)
    }
  }
  return out
}

describe('the website and the phone app stay apart', () => {
  it('reads the real source tree', () => {
    const files = Object.keys(SOURCES)
    // A glob that silently matched nothing would make every check below pass.
    expect(files).toContain('/src/main.tsx')
    expect(files).toContain(ENTRY)
    expect(files).toContain('/src/web/phone.ts')
    expect(files.some((f) => f.startsWith('/src/worker/'))).toBe(true)
    // And the one allowed crossing is really seen, so rule 1 is looking at imports.
    expect(edgesOf('/src/main.tsx', SOURCES['/src/main.tsx'], SOURCES).some((e) => e.spec === '@web/entry' && e.dynamic)).toBe(true)
  })

  it('keeps every rule in the current tree', () => {
    expect(violations(SOURCES)).toEqual([])
  })
})

describe('each rule catches what it is for', () => {
  // A small tree that obeys every rule; each case below breaks one.
  const clean: Sources = {
    '/src/main.tsx': "const App = lazy(() => import('@web/entry'))",
    '/src/worker/simple/Home.tsx': "import { s } from './stheme'\nexport const Home = 1",
    '/src/worker/simple/stheme.ts': 'export const s = {}',
    '/src/worker/simple/Safety.tsx': 'export const SafetyTab = 1',
    '/src/theme.ts': 'export const theme = {}',
    '/src/ui/kit.tsx': 'export const Card = 1',
    '/src/web/entry.tsx': "import { WebApp } from './WebApp'\nexport default WebApp",
    '/src/web/WebApp.tsx': "import { s } from './phone'\nconst Page = lazy(() => import('./pages/SafetyPage'))\nexport const WebApp = 1",
    '/src/web/phone.ts': "export { s } from '../worker/simple/stheme'",
    '/src/web/phone-features.ts': "export { SafetyTab } from '../worker/simple/Safety'",
    '/src/web/pages/SafetyPage.tsx': "import { SafetyTab } from '../phone-features'\nexport default SafetyTab",
    '/src/web/data/contract.test.ts': "import src from '../../worker/simple/Home.tsx?raw'",
  }
  const breaking = (patch: Sources) => violations({ ...clean, ...patch })

  it('passes the clean tree', () => {
    expect(violations(clean)).toEqual([])
  })

  it('1: catches phone code importing the website', () => {
    expect(breaking({ '/src/worker/simple/Home.tsx': "import { WebApp } from '../../web/WebApp'" }).join()).toMatch(/only main\.tsx may import the website/)
    expect(breaking({ '/src/main.tsx': "import '@web/entry'\nimport { color } from './web/tokens'" }).join()).toMatch(/only main\.tsx may import the website/)
  })

  it('2: catches the website reaching past its barrels, written any way', () => {
    // The acceptance case: a temporary side-effect import of a phone screen.
    expect(breaking({ '/src/web/WebApp.tsx': "import '../worker/simple/Home'" }).join()).toMatch(/through src\/web\/phone\.ts/)
    expect(breaking({ '/src/web/WebApp.tsx': "import type { X } from '../worker/simple/Home'" }).join()).toMatch(/through src\/web\/phone\.ts/)
    expect(breaking({ '/src/web/WebApp.tsx': "export {\n  Home,\n} from '../worker/simple/Home'" }).join()).toMatch(/through src\/web\/phone\.ts/)
    expect(breaking({ '/src/web/WebApp.tsx': "const H = lazy(() => import('../worker/simple/Home'))" }).join()).toMatch(/through src\/web\/phone\.ts/)
    // …but not by a comment or a string that only looks like an import.
    expect(breaking({ '/src/web/WebApp.tsx': "// import '../worker/simple/Home'\nconst s = \"import '../worker/simple/Home'\"" })).toEqual([])
  })

  it('3: catches the old office theme and components, even through a barrel', () => {
    expect(breaking({ '/src/web/WebApp.tsx': "import { theme } from '../theme'" }).join()).toMatch(/old office dashboard's theme/)
    expect(breaking({ '/src/web/phone.ts': "export { Card } from '../ui/kit'" }).join()).toMatch(/old office dashboard's components/)
  })

  it('4: catches phone-features in the first download, however far down', () => {
    const out = breaking({ '/src/web/WebApp.tsx': "import { SafetyTab } from './phone-features'\nexport const WebApp = 1" }).join()
    expect(out).toMatch(/loaded eagerly \(\/src\/web\/entry\.tsx -> \/src\/web\/WebApp\.tsx -> \/src\/web\/phone-features\.ts\)/)
    // A type from it costs nothing at runtime.
    expect(breaking({ '/src/web/WebApp.tsx': "import type { SafetyDoc } from './phone-features'\nexport const WebApp = 1" })).toEqual([])
  })
})
