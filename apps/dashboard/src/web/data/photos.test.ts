import ts from 'typescript'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import jobSrc from '../../worker/simple/Job.tsx?raw'
import workerAppSrc from '../../worker/WorkerApp.tsx?raw'
import { localDay as phoneLocalDay } from '../../data/localDay'
import { distanceM, objectPath, offset, removeFile, uploadFile } from '../phone'
import {
  dayHeading,
  DEFAULT_CATEGORY,
  deletePhoto,
  distanceWords,
  flagPhoto,
  groupByDay,
  loadPhotos,
  localDay,
  markWords,
  onSite,
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABEL,
  PHOTO_MAX_BYTES,
  PHOTO_PAGE,
  PHOTO_PICKER_ACCEPT,
  photoInsert,
  photoRefusal,
  photosSummary,
  problemWords,
  timeOf,
  uploadPhoto,
  whenWords,
  whoOf,
  type Db,
  type Photo,
} from './photos'

// Storage goes through the phone's own helpers; here they are stand-ins, so
// nothing leaves the test and every call can be compared with the phone's.
vi.mock('../phone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../phone')>()),
  objectPath: vi.fn((company: string, site: string, name: string) => `${company}/${site}/uuid-${name}`),
  uploadFile: vi.fn(async (_bucket: string, path: string) => path),
  removeFile: vi.fn(async () => {}),
}))

/**
 * A job's photos, read from the phone's own source and run beside the
 * website's copies in photos.ts:
 *  - Job.tsx: PhotoGrid's read and its grouping by day, the on-site rule and
 *    its words, the day and time labels, and PhotoViewer's two writes (flag
 *    as an issue, delete)
 *  - WorkerApp.tsx: PhotoScreen's upload (the bucket, the path, the row) and
 *    its categories
 * Change the phone and these name what to bring into line.
 *
 * Dates are Adelaide's, whatever the machine running this is set to.
 */

// Node re-reads TZ when it is assigned. (The app's tsconfig has no Node types, hence the cast.)
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const TZ = env.TZ
beforeAll(() => {
  env.TZ = 'Australia/Adelaide'
})
afterAll(() => {
  if (TZ === undefined) delete env.TZ
  else env.TZ = TZ
})
afterEach(() => {
  vi.useRealTimers()
})

// ------------------------------------------------------------ reading the phone

const JOB = ts.createSourceFile('Job.tsx', jobSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const APP = ts.createSourceFile('WorkerApp.tsx', workerAppSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

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
function decl(sf: ts.SourceFile, name: string, within: ts.Node = sf): Decl {
  const found = all(within, (n): n is Decl => (ts.isFunctionDeclaration(n) && n.name?.text === name) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name))
  if (found.length !== 1) throw new Error(`${sf.fileName}: expected one declaration of ${name}, found ${found.length}. Was it renamed or moved?`)
  return found[0]!
}

/** A declaration's whole statement as written (a const's `const x = …`, a function's `function f…`). */
const statement = (sf: ts.SourceFile, d: Decl) => (ts.isVariableDeclaration(d) ? d.parent.parent : d).getText(sf)

const js = (tsx: string) =>
  ts.transpileModule(tsx, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export\s*\{\s*\};?\s*$/m, '')

/** Run phone code: `body` (declarations), then `ret` evaluated, with `scope` as its free names. */
function run<T>(body: string, scope: Record<string, unknown>, ret: string): T {
  const names = Object.keys(scope)
  return new Function(...names, `${js(`${body}\nconst __ret = (${ret})`)}\nreturn __ret`)(...names.map((n) => scope[n])) as T
}

/** A PostgREST call chain as [method, args as written], the .from first. */
function chain(sf: ts.SourceFile, call: ts.Expression): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let at: ts.Expression = call
  while (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    out.unshift([at.expression.name.text, at.arguments.map((a) => a.getText(sf)).join(', ')])
    at = at.expression.expression
  }
  return out
}

/** Every whole call chain under `root` that starts .from('site_files'), in source order. */
function siteFilesChains(sf: ts.SourceFile, root: ts.Node): Array<Array<[string, string]>> {
  const froms = all(root, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'from' && n.arguments[0]?.getText(sf) === "'site_files'")
  return froms.map((from) => {
    let top: ts.Expression = from
    while (ts.isPropertyAccessExpression(top.parent) && ts.isCallExpression(top.parent.parent) && top.parent.parent.expression === top.parent) top = top.parent.parent
    return chain(sf, top)
  })
}

/** A phone chain's calls with their arguments evaluated in `scope`, as the recorder below writes them. */
const evaluated = (calls: Array<[string, string]>, scope: Record<string, unknown>) =>
  calls.map(([m, args]) => `site_files.${m}(${run<unknown[]>('', scope, `[${args}]`).map((a) => JSON.stringify(a)).join(', ')})`)

/** A fake client that records every call and answers each chain with `answer(calls so far)`. */
function recorder(answer: (calls: string[]) => unknown) {
  const calls: string[] = []
  const chainFor = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'range', 'limit', 'insert', 'update', 'delete', 'single']) {
      b[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
        return b
      }
    }
    b.then = (resolve: (v: unknown) => void) => resolve(answer(calls))
    return b
  }
  return { calls, client: { from: chainFor } as unknown as Db }
}

const photo = (over: Partial<Photo> = {}): Photo => ({
  id: 'p-1',
  company_id: 'co-1',
  site_id: 'site-1',
  uploaded_by: 'w-2',
  kind: 'photo',
  storage_path: 'co-1/site-1/uuid-IMG_0001.jpg',
  name: 'IMG_0001.jpg',
  mime: 'image/jpeg',
  size_bytes: 2_000_000,
  category: 'progress',
  caption: null,
  lat: null,
  lng: null,
  taken_at: '2026-10-21T03:45:00+00:00',
  version: null,
  supersedes: null,
  created_at: '2026-10-21T03:45:20.120000+00:00',
  ...over,
})

const PHOTO_GRID = decl(JOB, 'PhotoGrid')
const PHOTO_VIEWER = decl(JOB, 'PhotoViewer')
const PHOTO_SCREEN = decl(APP, 'PhotoScreen')

// --------------------------------------------------------------------- the read

describe("the phone's read (Job.tsx PhotoGrid)", () => {
  const phone = siteFilesChains(JOB, PHOTO_GRID)

  it('is one query, the newest 60 photos on the job', () => {
    expect(phone).toHaveLength(1)
    expect(phone[0]!.map(([m, a]) => `${m}(${a})`)).toEqual([
      "from('site_files')",
      "select('*')",
      "eq('site_id', site.id)",
      "eq('kind', 'photo')",
      "order('created_at', { ascending: false })",
      'limit(60)',
    ])
  })

  it('the website asks the same, and for every photo rather than 60, a page at a time', async () => {
    const { calls, client } = recorder(() => ({ data: [], error: null }))
    await loadPhotos('site-1', client)
    const same = evaluated(phone[0]!.filter(([m]) => m !== 'from' && m !== 'limit'), { site: { id: 'site-1' } })
    expect(calls).toEqual([...same, 'site_files.order("id", {"ascending":false})', `site_files.range(0, ${PHOTO_PAGE - 1})`])
  })

  it('reads past the first page, and keeps a row the pages both caught once', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => photo({ id: `p-${from + i}` }))
    const { calls, client } = recorder((log) => {
      const ranges = log.filter((c) => c.startsWith('site_files.range'))
      return ranges.length === 1 ? { data: page(0, PHOTO_PAGE), error: null } : { data: [photo({ id: `p-${PHOTO_PAGE - 1}` }), ...page(PHOTO_PAGE, 4)], error: null }
    })
    const rows = await loadPhotos('site-1', client)
    expect(calls.filter((c) => c.startsWith('site_files.range'))).toEqual([`site_files.range(0, ${PHOTO_PAGE - 1})`, `site_files.range(${PHOTO_PAGE}, ${2 * PHOTO_PAGE - 1})`])
    expect(rows).toHaveLength(PHOTO_PAGE + 4)
    expect(new Set(rows.map((r) => r.id)).size).toBe(PHOTO_PAGE + 4)
  })

  it('a failed read throws, so the tab can say so', async () => {
    const { client } = recorder(() => ({ data: null, error: { message: 'JWT expired' } }))
    await expect(loadPhotos('site-1', client)).rejects.toThrow('JWT expired')
  })
})

// -------------------------------------------------------------------- on site

describe("the on-site mark (Job.tsx onSite and PhotoViewer's words)", () => {
  const phoneOnSite = run<typeof onSite>(statement(JOB, decl(JOB, 'onSite')), { distanceM }, 'onSite')
  const site = { lat: -34.98, lng: 138.46, radius_m: 150 }
  const at = (bearing: number, m: number) => offset({ lat: site.lat, lng: site.lng }, bearing, m)

  it('gives the same answer as the phone, case by case', () => {
    const cases: Array<[string, Pick<Photo, 'lat' | 'lng'>, typeof site]> = [
      ['no coordinates', { lat: null, lng: null }, site],
      ['a latitude and no longitude', { lat: -34.98, lng: null }, site],
      ['a longitude and no latitude', { lat: null, lng: 138.46 }, site],
      ['on the pin', { lat: site.lat, lng: site.lng }, site],
      ['149 m north, 150 m fence', at(0, 149), site],
      ['151 m north, 150 m fence', at(0, 151), site],
      ['140 m east', at(90, 140), site],
      ['30 m away from a 25 m fence', at(200, 30), { ...site, radius_m: 25 }],
      ['the far side of a 2 km fence', at(45, 1990), { ...site, radius_m: 2000 }],
      ['Adelaide CBD, 12 km away', { lat: -34.9285, lng: 138.6007 }, site],
      ['coordinates sent as text', { lat: '-34.98' as unknown as number, lng: '138.46' as unknown as number }, site],
      ['zero, which is a place', { lat: 0, lng: 0 }, site],
      ['missing rather than null', { lat: undefined as unknown as null, lng: undefined as unknown as null }, site],
    ]
    for (const [what, file, s] of cases) {
      expect(onSite(file, s), what).toBe(phoneOnSite(file, s))
    }
    expect(onSite({ lat: null, lng: null }, site)).toBeNull()
    expect(onSite(at(0, 149), site)).toBe(true)
    expect(onSite(at(0, 151), site)).toBe(false)
  })

  it('in the same words', () => {
    const words = all(PHOTO_VIEWER, (n): n is ts.ConditionalExpression => ts.isConditionalExpression(n) && n.condition.getText(JOB) === 'here === true' && ts.isStringLiteral(n.whenTrue))
    expect(words).toHaveLength(1)
    for (const here of [true, false, null]) expect(markWords(here)).toBe(run('', { here }, words[0]!.getText(JOB)))
    expect([true, false, null].map(markWords)).toEqual(['On site', 'Away from site', 'No location'])
  })

  it('says how far from the pin in words', () => {
    expect(distanceWords(4.2)).toBe('4 m')
    expect(distanceWords(87.4)).toBe('87 m')
    expect(distanceWords(149)).toBe('150 m')
    expect(distanceWords(1234)).toBe('1.2 km')
    expect(distanceWords(12_480)).toBe('12 km')
  })
})

// --------------------------------------------------------------- days and times

describe('days and times', () => {
  // Wednesday 21 October 2026, 3:30 pm in Adelaide (daylight time, UTC+10:30).
  const NOW = new Date('2026-10-21T05:00:00Z')
  const phoneDayLabel = () => run<(iso: string) => string>(statement(JOB, decl(JOB, 'dayLabel')), {}, 'dayLabel')
  const phoneTaken = () => run<(iso: string) => string>(`${statement(JOB, decl(JOB, 'timeOf'))}\n${statement(JOB, decl(JOB, 'takenLabel'))}`, {}, 'takenLabel')
  const phoneTime = () => run<(iso: string) => string>(statement(JOB, decl(JOB, 'timeOf')), {}, 'timeOf')

  /** The phone's grouping, run as written: PhotoGrid's useMemo body over `files`. */
  const phoneGroups = (files: Photo[]) => {
    const groups = decl(JOB, 'groups', PHOTO_GRID) as ts.VariableDeclaration
    const memo = groups.initializer as ts.CallExpression
    return run<Array<[string, Photo[]]>>('', { files, localDay: phoneLocalDay }, `(${memo.arguments[0]!.getText(JOB)})()`)
  }

  // Taken (UTC) → Adelaide:
  const A = photo({ id: 'A', taken_at: '2026-10-20T21:02:00+00:00', created_at: '2026-10-20T21:02:30+00:00' }) // Wed 7:32 am
  const B = photo({ id: 'B', taken_at: '2026-10-21T03:45:00+00:00', created_at: '2026-10-21T03:45:20+00:00' }) // Wed 2:15 pm
  const C = photo({ id: 'C', taken_at: '2026-10-20T04:00:00+00:00', created_at: '2026-10-20T04:00:10+00:00' }) // Tue 2:30 pm
  const E = photo({ id: 'E', taken_at: '2026-10-20T13:29:00+00:00', created_at: '2026-10-20T13:29:10+00:00' }) // Tue 11:59 pm
  const F = photo({ id: 'F', taken_at: '2026-10-20T13:31:00+00:00', created_at: '2026-10-20T13:31:10+00:00' }) // Wed 12:01 am
  const D = photo({ id: 'D', taken_at: null, created_at: '2026-10-19T02:00:00+00:00' }) // filed Mon 12:30 pm, no time taken
  // The phone's order: newest made first.
  const newestMade = [B, A, F, E, C, D]

  it('files each photo under the day it was taken in Adelaide, newest day first, newest first within a day', () => {
    const days = groupByDay([C, D, A, F, E, B])
    expect(days.map((d) => [d.day, d.photos.map((p) => p.id).join('')])).toEqual([
      ['2026-10-21', 'BAF'],
      ['2026-10-20', 'EC'],
      ['2026-10-19', 'D'],
    ])
  })

  it('agrees with the phone on every photo: mornings, just after midnight, and one with no time taken', () => {
    expect(groupByDay(newestMade).map((d) => [d.day, d.photos.map((p) => p.id).join('')])).toEqual(
      phoneGroups(newestMade).map(([k, rows]) => [k, rows.map((p) => p.id).join('')]),
    )
    expect(phoneGroups(newestMade).map(([k]) => k)).toEqual(['2026-10-21', '2026-10-20', '2026-10-19'])
  })

  it('a photo with no time taken (a waterproofing step photo) goes by when it was filed', () => {
    expect(groupByDay([D])[0]!.day).toBe(localDay(D.created_at))
    expect(localDay('2026-10-20T13:31:00+00:00')).toBe('2026-10-21')
    expect(localDay('2026-10-20T13:29:00+00:00')).toBe('2026-10-20')
  })

  it("heads each day in the phone's words", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const label = phoneDayLabel()
    expect(dayHeading('2026-10-21', NOW)).toBe('Today · Wed 21 Oct')
    for (const day of ['2026-10-21', '2026-10-20', '2026-10-19', '2026-02-01']) {
      expect(dayHeading(day, NOW).toUpperCase()).toBe(label(day))
    }
    // The phone never says the year; a desk looks further back.
    expect(dayHeading('2025-12-24', NOW)).toBe('Wed 24 Dec 2025')
  })

  it("writes a time and a when the phone's way", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const taken = phoneTaken()
    const time = phoneTime()
    for (const iso of [B.taken_at!, A.taken_at!, C.taken_at!, '2026-03-02T22:05:00+00:00']) {
      expect(timeOf(iso)).toBe(time(iso))
      expect(whenWords(iso, NOW)).toBe(taken(iso))
    }
    expect(whenWords(B.taken_at!, NOW).replace(/\s/g, ' ')).toBe('Today, 2:15 pm')
    expect(whenWords('2025-12-24T00:30:00+00:00', NOW).replace(/\s/g, ' ')).toBe('24 Dec 2025, 11:00 am')
  })
})

// ------------------------------------------------------------------- who

describe('who took it', () => {
  const names = new Map([
    ['w-1', 'Troy Watson'],
    ['w-2', 'Dean Papadopoulos'],
  ])
  it('you, by name, crew, or somebody since deleted', () => {
    expect(whoOf('w-1', 'w-1', names)).toBe('You')
    expect(whoOf('w-2', 'w-1', names)).toBe('Dean Papadopoulos')
    expect(whoOf('w-9', 'w-1', names)).toBe('Crew')
    expect(whoOf('w-2', 'w-1', new Map())).toBe('Crew')
    expect(whoOf(null, 'w-1', names)).toBe('Former crew member')
  })

  it('counts photos, areas and issues as the phone counts photos and areas', () => {
    expect(photosSummary([])).toBe('No photos yet')
    expect(photosSummary([photo()])).toBe('1 photo')
    expect(photosSummary([photo({ caption: 'Ensuite' }), photo({ caption: 'Ensuite' }), photo({ caption: 'Laundry', category: 'issue' }), photo()])).toBe('4 photos · 2 areas · 1 flagged as an issue')
    expect(photosSummary([photo({ category: 'issue' }), photo({ category: 'issue' })])).toBe('2 photos · 2 flagged as issues')
  })
})

// --------------------------------------------------------------------- adding

describe("adding a photo the phone's way (WorkerApp.tsx PhotoScreen)", () => {
  const upload = decl(APP, 'upload', PHOTO_SCREEN) as ts.FunctionDeclaration
  const inserts = all(upload, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'insert' && !!n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0]))
  const literal = inserts[0]?.arguments[0] as ts.ObjectLiteralExpression
  const callsTo = (name: string) => all(upload, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name)

  const me = { id: 'w-1', company_id: 'co-1' }
  const siteId = 'site-1'
  const capturedAt = Date.parse('2026-10-21T03:45:00.000Z')

  it('inserts once, into site_files', () => {
    expect(inserts).toHaveLength(1)
    expect(siteFilesChains(APP, upload)).toHaveLength(1)
  })

  it('sends the same columns in the same order', () => {
    const keys = literal.properties.map((p) => p.name!.getText(APP))
    const web = photoInsert({ me, siteId, file: { name: 'a.jpg', type: 'image/jpeg', size: 1 }, path: 'p', category: 'progress', caption: '', takenAt: new Date(capturedAt).toISOString() })
    expect(Object.keys(web)).toEqual(keys)
  })

  it('with the same values, the GPS fix aside: a desk has none, so lat and lng stay empty', () => {
    for (const [name, type, size, category, caption] of [
      ['IMG_0001.jpg', 'image/jpeg', 2_345_678, 'progress', ''],
      ['ensuite floor.png', 'image/png', 99, 'before', '  Ensuite floor  '],
      ['crack.webp', '', 5, 'issue', '   '],
      ['after.gif', 'image/gif', 10, 'inspection', 'Laundry'],
    ] as const) {
      const file = { name, type, size }
      const path = `co-1/site-1/uuid-${name}`
      const takenAt = new Date(capturedAt).toISOString()
      const web = photoInsert({ me, siteId, file, path, category, caption, takenAt })
      const phone = run<Record<string, unknown>>('', { me, siteId, file, path, category, caption, capturedFix: null, capturedAt }, literal.getText(APP))
      expect(web).toEqual(phone)
      // With a fix, the phone's row differs from the desk's in lat and lng only.
      const fixed = run<Record<string, unknown>>('', { me, siteId, file, path, category, caption, capturedFix: { pos: { lat: -34.98, lng: 138.46 }, accuracyM: 6 }, capturedAt }, literal.getText(APP))
      expect(Object.keys(fixed).filter((k) => !Object.is(fixed[k], (web as Record<string, unknown>)[k]))).toEqual(['lat', 'lng'])
    }
  })

  it('into the same bucket, at the same path shape', async () => {
    const [pathCall] = callsTo('objectPath')
    const [putCall] = callsTo('uploadFile')
    expect(pathCall?.getText(APP)).toBe('objectPath(me.company_id, siteId, file.name)')
    expect(putCall?.getText(APP)).toBe('uploadFile(BUCKET_FILES, path, file)')

    vi.mocked(objectPath).mockClear()
    vi.mocked(uploadFile).mockClear()
    const file = new File([new Uint8Array(10)], 'IMG_0001.jpg', { type: 'image/jpeg' })
    const { client } = recorder(() => ({ data: photo({ storage_path: 'co-1/site-1/uuid-IMG_0001.jpg', uploaded_by: 'w-1' }), error: null }))
    const out = await uploadPhoto({ me, siteId, file, takenAt: new Date(capturedAt).toISOString() }, client)
    expect(out.ok).toBe(true)
    const scope = { me, siteId, file, path: 'co-1/site-1/uuid-IMG_0001.jpg', BUCKET_FILES: 'site-files' }
    expect(vi.mocked(objectPath).mock.calls[0]).toEqual(run('', scope, `[${pathCall!.arguments.map((a) => a.getText(APP)).join(', ')}]`))
    expect(vi.mocked(uploadFile).mock.calls[0]).toEqual(run('', scope, `[${putCall!.arguments.map((a) => a.getText(APP)).join(', ')}]`))
  })

  it('asks "what is this?" with the same answers, starting at the same one', () => {
    expect([...PHOTO_CATEGORIES]).toEqual(run(statement(APP, decl(APP, 'PHOTO_CATEGORIES')), {}, 'PHOTO_CATEGORIES'))
    expect(PHOTO_CATEGORY_LABEL).toEqual(run(statement(APP, decl(APP, 'PHOTO_CATEGORY_LABEL')), {}, 'PHOTO_CATEGORY_LABEL'))
    // const [category, setCategory] = useState<PhotoCategory>('progress')
    const state = all(PHOTO_SCREEN, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(APP) === 'useState' && n.typeArguments?.[0]?.getText(APP) === 'PhotoCategory')
    expect(state).toHaveLength(1)
    expect(DEFAULT_CATEGORY).toBe((state[0]!.arguments[0] as ts.StringLiteral).text)
  })

  it("offers what the phone's camera takes, and HEIC so it can say why not", () => {
    const inputs = all(PHOTO_SCREEN, (n): n is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(n) && n.tagName.getText(APP) === 'input' && n.getText(APP).includes('type="file"'))
    expect(inputs).toHaveLength(1)
    const accept = inputs[0]!.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(APP) === 'accept') as ts.JsxAttribute
    expect(PHOTO_PICKER_ACCEPT.split(',')[0]).toBe((accept.initializer as ts.StringLiteral).text)
  })
})

describe('uploadPhoto', () => {
  const me = { id: 'w-1', company_id: 'co-1' }
  const file = (name: string, type: string, size = 10) => {
    const f = new File([new Uint8Array(Math.min(size, 16))], name, { type })
    Object.defineProperty(f, 'size', { value: size })
    return f
  }

  it('refuses before anything is sent: HEIC, not a photo, empty, over 25 MB', async () => {
    expect(photoRefusal(file('IMG_4410.HEIC', 'image/heic'))).toMatch(/iPhone HEIC photo.*Save it as a JPEG/)
    expect(photoRefusal(file('IMG_4410.heic', ''))).toMatch(/HEIC/)
    expect(photoRefusal(file('scan.tiff', 'image/tiff'))).toMatch(/not a photo this takes/)
    expect(photoRefusal(file('plan.pdf', 'application/pdf'))).toMatch(/not a photo this takes\. Add JPEG, PNG, WebP or GIF images\./)
    expect(photoRefusal(file('blank.jpg', 'image/jpeg', 0))).toBe('blank.jpg is empty.')
    expect(photoRefusal(file('big.jpg', 'image/jpeg', PHOTO_MAX_BYTES + 2 * 1024 * 1024))).toBe('big.jpg is 27 MB, over the 25 MB limit. Add a smaller copy.')
    expect(photoRefusal(file('edge.jpg', 'image/jpeg', PHOTO_MAX_BYTES + 1))).toBe('edge.jpg is over the 25 MB limit. Add a smaller copy.')
    expect(photoRefusal(file('ok.jpg', 'image/jpeg', PHOTO_MAX_BYTES))).toBeNull()
    expect(photoRefusal(file('typeless.JPG', ''))).toBeNull()
    expect(photoRefusal(file('odd.jpg', 'image/jpg'))).toBeNull()

    const from = vi.fn()
    vi.mocked(uploadFile).mockClear()
    const out = await uploadPhoto({ me, siteId: 's', file: file('IMG_4410.HEIC', 'image/heic') }, { from } as unknown as Db)
    expect(out.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('sends the row the phone sends and reads it back', async () => {
    const { calls, client } = recorder((log) => {
      const sent = JSON.parse(log.find((c) => c.startsWith('site_files.insert'))!.slice('site_files.insert('.length, -1))
      return { data: { id: 'new', created_at: '2026-10-21T03:45:20+00:00', version: null, supersedes: null, ...sent }, error: null }
    })
    const takenAt = '2026-10-21T03:45:00.000Z'
    const out = await uploadPhoto({ me, siteId: 'site-1', file: file('IMG_0001.jpg', 'image/jpeg', 2048), category: 'before', caption: ' Ensuite ', takenAt }, client)
    expect(out).toMatchObject({ ok: true, value: { id: 'new', kind: 'photo', category: 'before', caption: 'Ensuite', lat: null, lng: null, taken_at: takenAt } })
    expect(calls.filter((c) => !c.startsWith('site_files.insert'))).toEqual(['site_files.select("*")', 'site_files.single()'])
  })

  it('a row that does not save takes its file back out of storage, and says why', async () => {
    vi.mocked(removeFile).mockClear()
    const { client } = recorder(() => ({ data: null, error: { message: 'new row violates row-level security policy for table "site_files"' } }))
    const out = await uploadPhoto({ me, siteId: 'site-1', file: file('a.jpg', 'image/jpeg') }, client)
    expect(out).toEqual({ ok: false, message: 'Not added: the database refused it. Reload the page and try again.' })
    expect(vi.mocked(removeFile).mock.calls.at(-1)?.[1]).toBe(vi.mocked(uploadFile).mock.calls.at(-1)?.[1])
  })

  it('a row that reads back as something else is not taken as saved', async () => {
    vi.mocked(removeFile).mockClear()
    const { client } = recorder(() => ({ data: photo({ storage_path: 'somewhere/else.jpg' }), error: null }))
    const out = await uploadPhoto({ me, siteId: 'site-1', file: file('a.jpg', 'image/jpeg') }, client)
    expect(out).toMatchObject({ ok: false, message: expect.stringMatching(/did not read back/) })
    expect(removeFile).toHaveBeenCalledTimes(1)
  })

  it('a file that does not reach storage writes no row', async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('Failed to fetch'))
    const from = vi.fn()
    const out = await uploadPhoto({ me, siteId: 'site-1', file: file('a.jpg', 'image/jpeg') }, { from } as unknown as Db)
    expect(out).toEqual({ ok: false, message: 'Not added: the connection dropped. Check the internet and try again.' })
    expect(from).not.toHaveBeenCalled()
  })

  it('says a problem in words', () => {
    expect(problemWords('The object exceeded the maximum allowed size')).toBe('it is over the 25 MB limit.')
    expect(problemWords('TypeError: NetworkError when attempting to fetch resource.')).toMatch(/connection dropped/)
    expect(problemWords('Something odd.')).toBe('Something odd')
  })
})

// ------------------------------------------------------ flagging and deleting

describe("the viewer's writes (Job.tsx PhotoViewer)", () => {
  const phone = siteFilesChains(JOB, PHOTO_VIEWER)
  const flagChain = phone.find((c) => c.some(([m]) => m === 'update'))!
  const deleteChain = phone.find((c) => c.some(([m]) => m === 'delete'))!

  it('the phone writes twice: flag as an issue, and delete', () => {
    expect(phone).toHaveLength(2)
    expect(flagChain.map(([m, a]) => `${m}(${a})`)).toEqual(["from('site_files')", "update({ category: 'issue' })", "eq('id', file.id)", "select('id,category')"])
    expect(deleteChain.map(([m, a]) => `${m}(${a})`)).toEqual(["from('site_files')", 'delete()', "eq('id', file.id)", "select('id')"])
  })

  it('flag: the same write, read back', async () => {
    const { calls, client } = recorder(() => ({ data: [{ id: 'p-1', category: 'issue' }], error: null }))
    const out = await flagPhoto(photo({ id: 'p-1' }), client)
    expect(out).toEqual({ ok: true, value: { id: 'p-1', category: 'issue' } })
    expect(calls).toEqual(evaluated(flagChain.slice(1), { file: { id: 'p-1' } }))
  })

  it('flag: an already flagged photo is left alone, as the phone does', async () => {
    const guard = all(PHOTO_VIEWER, (n): n is ts.IfStatement => ts.isIfStatement(n) && n.expression.getText(JOB) === "busy || file.category === 'issue'")
    expect(guard).toHaveLength(1)
    const from = vi.fn()
    expect(await flagPhoto(photo({ category: 'issue' }), { from } as unknown as Db)).toMatchObject({ ok: true })
    expect(from).not.toHaveBeenCalled()
  })

  it('flag: no row back, or a row that is not an issue, is not flagged', async () => {
    expect(await flagPhoto(photo(), recorder(() => ({ data: [], error: null })).client)).toMatchObject({ ok: false, message: expect.stringMatching(/^Not flagged/) })
    expect(await flagPhoto(photo(), recorder(() => ({ data: [{ id: 'p-1', category: 'progress' }], error: null })).client)).toMatchObject({ ok: false })
    expect(await flagPhoto(photo(), recorder(() => ({ data: null, error: { message: 'Failed to fetch' } })).client)).toMatchObject({ ok: false, message: expect.stringMatching(/connection dropped/) })
  })

  it('delete: the same write, then a read that it is gone', async () => {
    // First the delete, which sends its row back; then the read, which finds nothing.
    let n = 0
    const { calls, client } = recorder(() => (++n === 1 ? { data: [{ id: 'p-1' }], error: null } : { data: [], error: null }))
    const out = await deletePhoto(photo({ id: 'p-1' }), client)
    expect(out).toEqual({ ok: true, value: { id: 'p-1' } })
    expect(calls.slice(0, 3)).toEqual(evaluated(deleteChain.slice(1), { file: { id: 'p-1' } }))
    expect(calls.slice(3)).toEqual(['site_files.select("id")', 'site_files.eq("id", "p-1")'])
  })

  it('delete: refused is not deleted; already gone says so', async () => {
    // No rows back, and the photo still there: RLS said no.
    let n = 0
    const refused = recorder(() => (++n === 1 ? { data: [], error: null } : { data: [{ id: 'p-1' }], error: null }))
    expect(await deletePhoto(photo(), refused.client)).toEqual({ ok: false, message: 'Not deleted: only the office can remove photos, and the database refused it.' })
    // No rows back, and no photo either: somebody else deleted it first.
    const gone = recorder(() => ({ data: [], error: null }))
    expect(await deletePhoto(photo(), gone.client)).toMatchObject({ ok: false, gone: true })
    // Rows back, but it still reads back.
    const stuck = recorder(() => ({ data: [{ id: 'p-1' }], error: null }))
    expect(await deletePhoto(photo(), stuck.client)).toMatchObject({ ok: false, message: expect.stringMatching(/still reads back/) })
  })
})
