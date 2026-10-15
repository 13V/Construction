import { describe, expect, it } from 'vitest'
import overviewSrc from '../../worker/simple/Overview.tsx?raw'
import storageSql from '../../../../../supabase/storage.sql?raw'
import { screenFiles } from '../ui/DropZone'
import { SCOPE_TEMPLATE, scopeCounts } from './contract'
import {
  addExtraLine,
  ATTACH_ACCEPT,
  attachFiles,
  fileInsert,
  leftOutNote,
  MAX_ATTACHMENT_BYTES,
  NEEDS_CHOSEN,
  nextExtraSort,
  removeAttachment,
  removeExtraLine,
  restoredDate,
  ScopeInputError,
  scopeEntries,
  ScopeWriteError,
  selectionLost,
  setLineStatus,
  statusPatch,
  templateInsert,
  type Db,
  type ScopeRow,
} from './scope'

// ------------------------------------------------------------------ a scripted supabase-js

interface Call {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upload' | 'remove'
  payload?: unknown
  filters: Array<[string, ...unknown[]]>
}
type Reply = { data?: unknown; error?: { message: string; code?: string } | null }

/** Records every request, PostgREST and storage alike, and answers each with `reply`. */
function fakeDb(reply: (call: Call) => Reply = () => ({})) {
  const calls: Call[] = []
  const answer = (call: Call) => {
    calls.push(call)
    const { data = [], error = null } = reply(call)
    return { data, error }
  }
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), b),
        update: (p: unknown) => ((call.op = 'update'), (call.payload = p), b),
        delete: () => ((call.op = 'delete'), b),
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(answer(call)).then(ok, bad),
      }
      for (const m of ['eq', 'in', 'is', 'not', 'order', 'limit']) b[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), b)
      return b
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _file: unknown, options: unknown) => answer({ table: `storage:${bucket}`, op: 'upload', payload: { path, options }, filters: [] }),
        remove: async (paths: string[]) => answer({ table: `storage:${bucket}`, op: 'remove', payload: paths, filters: [] }),
      }),
    },
  }
  return { client: client as unknown as Db, calls }
}

const CTX = { company_id: 'co-1', site_id: 'site-1', worker_id: 'w-1' }
const row = (over: Partial<ScopeRow>): ScopeRow => ({ id: 'r', scope_key: null, name: 'x', detail: null, status: 'pending', chosen: null, chosen_at: null, sort: 0, ...over })
const pdf = (name = 'tiles.pdf', size = 20 * 1024) => new File([new Uint8Array(size)], name, { type: 'application/pdf' })
const entryFor = (key: string, rows: ScopeRow[] = []) => scopeEntries(rows).find((e) => e.key === key)!

// ------------------------------------------------------------------ the phone's rules, pinned

/** The object literal passed to `.insert(` inside the phone's attach(), as source text. */
function phoneAttachInsert(): string {
  const at = overviewSrc.indexOf("from('site_files').insert({", overviewSrc.indexOf('async function attach('))
  expect(at).toBeGreaterThan(0)
  return overviewSrc.slice(at, overviewSrc.indexOf('})', at))
}

describe('the phone, as scope.ts copies it', () => {
  it('a status change writes chosen and chosen_at only for Confirmed (Overview.tsx setStatus)', () => {
    expect(overviewSrc).toContain("chosen: status === 'chosen' ? chosen.trim() || null : null,")
    expect(overviewSrc).toContain("chosen_at: status === 'chosen' ? new Date().toISOString() : null,")
  })

  it('a first change inserts the template key, name, detail and sort = template index', () => {
    expect(overviewSrc).toContain('scope_key: SCOPE_TEMPLATE.some((t) => t.key === line.key) ? line.key : null,')
    expect(overviewSrc).toContain('sort: SCOPE_TEMPLATE.findIndex((t) => t.key === line.key),')
    expect(overviewSrc).toContain("status: 'pending',")
  })

  it('an empty Confirmed is refused with the same words', () => {
    expect(overviewSrc).toContain("const needsChosen = status === 'chosen' && !chosen.trim()")
    expect(overviewSrc).toContain(NEEDS_CHOSEN)
  })

  it("an attachment's site_files row has the phone's keys, and nothing else", () => {
    const phoneKeys = [...phoneAttachInsert().matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()
    expect(phoneKeys.length).toBeGreaterThan(5)
    expect(Object.keys(fileInsert(CTX, 'sel-1', pdf(), 'p')).sort()).toEqual(phoneKeys)
    expect(phoneAttachInsert()).toContain("kind: 'document',")
    expect(phoneAttachInsert()).toContain('mime: file.type || null,')
  })

  it("takes the phone's file types, and caps them at the bucket's own limit", () => {
    expect(overviewSrc).toContain(`accept="${ATTACH_ACCEPT}"`)
    const limit = /\('site-files',\s*'site-files',\s*false,\s*(\d+)\)/.exec(storageSql)
    expect(Number(limit?.[1])).toBe(MAX_ATTACHMENT_BYTES)
  })
})

// ------------------------------------------------------------------ pure rules

describe('scopeEntries', () => {
  it('a job with no rows shows the seven standard lines in the phone order, all Required', () => {
    const e = scopeEntries([])
    expect(e.map((x) => x.key)).toEqual(['tiles', 'grout', 'silicone', 'angles', 'mitres', 'grates', 'strip_drains'])
    expect(e.every((x) => x.status === 'pending' && x.row === null)).toBe(true)
    expect(e.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('matches rows by scope_key, puts hand-added lines after the template by sort, and ignores unknown keys', () => {
    const rows = [
      row({ id: 'b', name: 'Bench', sort: 8 }),
      row({ id: 'g', scope_key: 'grout', name: 'Grout colours', status: 'chosen', chosen: 'Mapei 113', sort: 1 }),
      row({ id: 'n', name: 'Niche', sort: 7 }),
      row({ id: 'z', scope_key: 'no_such_line', name: 'Stray', sort: 3 }),
    ]
    const e = scopeEntries(rows)
    expect(e.map((x) => x.key)).toEqual(['tiles', 'grout', 'silicone', 'angles', 'mitres', 'grates', 'strip_drains', 'n', 'b'])
    expect(e[1]).toMatchObject({ status: 'chosen', row: { id: 'g' } })
    expect(e[7]).toMatchObject({ index: null, line: { name: 'Niche', detail: '' } })
    // The same tally the phone's readiness bar shows.
    const c = scopeCounts(rows)
    expect([c.chosen, c.pending, c.not_applicable, c.total]).toEqual([1, 8, 0, 9])
    expect(e.length).toBe(c.total)
  })

  it("shows a standard line by the template's own name, as the phone does", () => {
    const e = scopeEntries([row({ id: 't', scope_key: 'tiles', name: 'renamed in the database' })])
    expect(e[0]!.line.name).toBe('Tile selections + Data')
  })
})

describe('statusPatch', () => {
  const now = new Date('2026-10-15T01:02:03.000Z')
  it('Confirmed needs what was chosen', () => {
    expect(() => statusPatch('chosen', '   ')).toThrow(ScopeInputError)
    expect(() => statusPatch('chosen', '')).toThrow(NEEDS_CHOSEN)
  })
  it('Confirmed stores the trimmed text and when', () => {
    expect(statusPatch('chosen', '  ZZ grout 113 ', now)).toEqual({ status: 'chosen', chosen: 'ZZ grout 113', chosen_at: now.toISOString() })
  })
  it('Required and Not applicable clear both, whatever was typed', () => {
    expect(statusPatch('pending', 'left over', now)).toEqual({ status: 'pending', chosen: null, chosen_at: null })
    expect(statusPatch('not_applicable', 'left over', now)).toEqual({ status: 'not_applicable', chosen: null, chosen_at: null })
  })
  it('refuses a status the database would not take', () => {
    expect(() => statusPatch('done' as never, 'x')).toThrow(ScopeInputError)
  })
})

describe('templateInsert and nextExtraSort', () => {
  it('writes the template key, name and detail, with sort = its index', () => {
    expect(templateInsert(CTX, 'grout', { status: 'pending' })).toEqual({
      company_id: 'co-1',
      site_id: 'site-1',
      scope_key: 'grout',
      name: SCOPE_TEMPLATE[1]!.name,
      detail: SCOPE_TEMPLATE[1]!.detail,
      sort: 1,
      status: 'pending',
    })
    expect(templateInsert(CTX, 'strip_drains', { status: 'pending' }).sort).toBe(6)
    expect(() => templateInsert(CTX, 'niche', { status: 'pending' })).toThrow(ScopeInputError)
  })

  it('puts the first hand-added line at 7, the next after it, and never ties after a removal', () => {
    expect(nextExtraSort([])).toBe(7)
    expect(nextExtraSort([row({ scope_key: 'grates', sort: 5 })])).toBe(7)
    expect(nextExtraSort([row({ sort: 7 }), row({ sort: 8 })])).toBe(9)
    expect(nextExtraSort([row({ sort: 7 }), row({ sort: 9 })])).toBe(10)
    // An old portal selection (sort 0) still leaves the next line after the template.
    expect(nextExtraSort([row({ sort: 0 })])).toBe(7)
  })
})

// ------------------------------------------------------------------ writes

describe('setLineStatus', () => {
  it('an empty Confirmed sends nothing', async () => {
    const { client, calls } = fakeDb()
    await expect(setLineStatus(CTX, entryFor('silicone'), 'chosen', '  ', { client })).rejects.toThrow(ScopeInputError)
    expect(calls).toEqual([])
  })

  it("a line's first change inserts its row, read back", async () => {
    const now = new Date('2026-10-15T00:00:00.000Z')
    const stored = row({ id: 'new', scope_key: 'grout', status: 'chosen', chosen: 'ZZ grout 113', sort: 1 })
    const { client, calls } = fakeDb(() => ({ data: [stored] }))
    const out = await setLineStatus(CTX, entryFor('grout'), 'chosen', 'ZZ grout 113', { client, now })
    expect(out).toBe(stored)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'selections', op: 'insert' })
    expect(calls[0]!.payload).toEqual({ ...templateInsert(CTX, 'grout', { status: 'chosen' }), chosen: 'ZZ grout 113', chosen_at: now.toISOString() })
  })

  it('a line with a row is updated by id, and Not applicable clears chosen', async () => {
    const existing = row({ id: 'sd', scope_key: 'strip_drains', status: 'chosen', chosen: 'old', sort: 6 })
    const { client, calls } = fakeDb(() => ({ data: [{ ...existing, status: 'not_applicable', chosen: null }] }))
    await setLineStatus(CTX, entryFor('strip_drains', [existing]), 'not_applicable', 'old', { client })
    expect(calls[0]).toMatchObject({ table: 'selections', op: 'update', payload: { status: 'not_applicable', chosen: null, chosen_at: null } })
    expect(calls[0]!.filters).toContainEqual(['eq', 'id', 'sd'])
  })

  it('an update that matched nothing (RLS, or the row went) is reported, not taken as saved', async () => {
    const existing = row({ id: 'sd', scope_key: 'strip_drains', sort: 6 })
    const { client } = fakeDb(() => ({ data: [] }))
    await expect(setLineStatus(CTX, entryFor('strip_drains', [existing]), 'pending', '', { client })).rejects.toThrow(ScopeWriteError)
  })

  it('when a phone made the row a moment ago, that row is found and updated instead', async () => {
    const theirs = row({ id: 'theirs', scope_key: 'grout', sort: 1 })
    const { client, calls } = fakeDb((c) =>
      c.op === 'insert' ? { data: null, error: { message: 'duplicate key', code: '23505' } } : c.op === 'select' ? { data: [theirs] } : { data: [{ ...theirs, status: 'not_applicable' }] },
    )
    const out = await setLineStatus(CTX, entryFor('grout'), 'not_applicable', '', { client })
    expect(out.id).toBe('theirs')
    expect(calls.map((c) => c.op)).toEqual(['insert', 'select', 'update'])
    expect(calls[1]!.filters).toContainEqual(['eq', 'scope_key', 'grout'])
  })
})

describe('attachFiles', () => {
  it('a file over 25 MB refuses the lot before anything is sent', async () => {
    const { client, calls } = fakeDb()
    const big = { name: 'big.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 } as File
    await expect(attachFiles(CTX, entryFor('tiles'), [pdf(), big], { client })).rejects.toThrow('big.pdf is 26 MB; the limit is 25 MB.')
    expect(calls).toEqual([])
  })

  it("a line with no row gets a 'pending' one first; the file goes under <company>/<site>/ and its row points at the line", async () => {
    const made = row({ id: 'sel-tiles', scope_key: 'tiles', sort: 0 })
    const { client, calls } = fakeDb((c) =>
      c.table === 'selections' ? { data: [made] } : c.table === 'site_files' ? { data: [{ id: 'f-1', ...(c.payload as object) }] } : { data: { path: 'x' } },
    )
    const file = pdf()
    const out = await attachFiles(CTX, entryFor('tiles'), [file], { client })
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['selections:insert', 'storage:site-files:upload', 'site_files:insert'])
    expect(calls[0]!.payload).toEqual(templateInsert(CTX, 'tiles', { status: 'pending' }))
    const path = (calls[1]!.payload as { path: string }).path
    expect(path).toMatch(/^co-1\/site-1\/[0-9a-f-]{36}-tiles\.pdf$/)
    expect(calls[2]!.payload).toEqual(fileInsert(CTX, 'sel-tiles', file, path))
    expect(calls[2]!.payload).toMatchObject({ kind: 'document', selection_id: 'sel-tiles', uploaded_by: 'w-1', mime: 'application/pdf', size_bytes: 20 * 1024 })
    expect(out.row?.id).toBe('sel-tiles')
    expect(out.added).toHaveLength(1)
    expect(out.failed).toEqual([])
  })

  it('a file row that will not insert takes its uploaded object away with it', async () => {
    const has = row({ id: 'sel-g', scope_key: 'grout', sort: 1 })
    const { client, calls } = fakeDb((c) => (c.table === 'site_files' ? { data: null, error: { message: 'denied' } } : { data: [] }))
    const out = await attachFiles(CTX, entryFor('grout', [has]), [pdf('g.pdf')], { client })
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['storage:site-files:upload', 'site_files:insert', 'storage:site-files:remove'])
    expect(calls[2]!.payload).toEqual([(calls[0]!.payload as { path: string }).path])
    expect(out.failed).toEqual([{ name: 'g.pdf', message: 'denied' }])
  })
})

describe('leftOutNote', () => {
  it('a drop where everything went on says nothing', () => {
    expect(leftOutNote([], [])).toBeNull()
  })
  it("a mixed drop names the file the drop zone refused, in the drop zone's own words, beside the one that went", () => {
    const big = { name: 'big.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 } as File
    const { ok, rejected } = screenFiles([big, pdf('small.pdf', 3000)], { accept: ATTACH_ACCEPT, maxBytes: MAX_ATTACHMENT_BYTES })
    expect(ok.map((f) => f.name)).toEqual(['small.pdf'])
    expect(leftOutNote(rejected.map((r) => r.reason))).toBe('Not attached: big.pdf is 26 MB; the limit is 25 MB.')
  })
  it('adds the files the bucket or the database turned away', () => {
    expect(leftOutNote(['a.zip is not a type this takes.'], [{ name: 'b.pdf', message: 'The resource already exists.' }])).toBe(
      'Not attached: a.zip is not a type this takes. b.pdf did not upload (The resource already exists).',
    )
  })
})

describe('selectionLost and restoredDate', () => {
  const at = '2026-10-15T01:02:03.000Z'
  const grout = row({ scope_key: 'grout', status: 'chosen', chosen: 'ZZ grout 113', chosen_at: at })
  it('moving a Confirmed line to Required or Not applicable hands back what it had, with its date', () => {
    expect(selectionLost(grout, 'pending')).toEqual({ chosen: 'ZZ grout 113', chosen_at: at })
    expect(selectionLost(grout, 'not_applicable')).toEqual({ chosen: 'ZZ grout 113', chosen_at: at })
  })
  it('nothing is lost by staying Confirmed, or by a line that had nothing recorded', () => {
    expect(selectionLost(grout, 'chosen')).toBeNull()
    expect(selectionLost(null, 'pending')).toBeNull()
    expect(selectionLost(row({ status: 'pending', chosen: null }), 'not_applicable')).toBeNull()
    expect(selectionLost(row({ status: 'chosen', chosen: '  ' }), 'pending')).toBeNull()
  })
  it('putting the same text back keeps the first date; other text is dated now', () => {
    const kept = selectionLost(grout, 'pending')
    expect(restoredDate(kept, ' ZZ grout 113 ')?.toISOString()).toBe(at)
    expect(restoredDate(kept, 'ZZ grout 114')).toBeUndefined()
    expect(restoredDate(null, 'ZZ grout 113')).toBeUndefined()
    expect(restoredDate({ chosen: 'x', chosen_at: null }, 'x')).toBeUndefined()
  })
  it('a put-back is written with that date (setLineStatus now)', async () => {
    const back = row({ id: 'g', scope_key: 'grout', status: 'pending' })
    const { client, calls } = fakeDb(() => ({ data: [back] }))
    await setLineStatus(CTX, entryFor('grout', [back]), 'chosen', 'ZZ grout 113', { client, now: restoredDate(selectionLost(grout, 'pending'), 'ZZ grout 113') })
    expect(calls[0]!.payload).toEqual({ status: 'chosen', chosen: 'ZZ grout 113', chosen_at: at })
  })
})

describe('removeAttachment', () => {
  const file = { id: 'f-1', name: 'tiles.pdf', storage_path: 'co-1/site-1/u-tiles.pdf' }
  it('deletes the row, read back, then the stored file', async () => {
    const { client, calls } = fakeDb((c) => (c.op === 'delete' ? { data: [{ id: 'f-1' }] } : { data: [{ name: file.storage_path }] }))
    expect(await removeAttachment(file, { client })).toEqual({ objectRemoved: true })
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['site_files:delete', 'storage:site-files:remove'])
    expect(calls[1]!.payload).toEqual([file.storage_path])
  })
  it('a delete that matched nothing leaves the stored file alone and says so', async () => {
    const { client, calls } = fakeDb(() => ({ data: [] }))
    await expect(removeAttachment(file, { client })).rejects.toThrow(ScopeWriteError)
    expect(calls).toHaveLength(1)
  })
  it('a stored file the bucket would not delete is reported', async () => {
    const { client } = fakeDb((c) => (c.op === 'delete' ? { data: [{ id: 'f-1' }] } : { data: [] }))
    expect(await removeAttachment(file, { client })).toEqual({ objectRemoved: false })
  })
})

describe('addExtraLine and removeExtraLine', () => {
  it('adds a Required line with no scope_key after the template', async () => {
    const { client, calls } = fakeDb((c) => ({ data: [{ id: 'x', ...(c.payload as object) }] }))
    await addExtraLine(CTX, [], { name: '  ZZ niche ', detail: '' }, { client })
    expect(calls[0]).toMatchObject({ table: 'selections', op: 'insert' })
    expect(calls[0]!.payload).toEqual({ company_id: 'co-1', site_id: 'site-1', scope_key: null, name: 'ZZ niche', detail: null, sort: 7, status: 'pending' })
  })
  it('refuses a blank name or one already on the job, sending nothing', async () => {
    const { client, calls } = fakeDb()
    await expect(addExtraLine(CTX, [], { name: '  ' }, { client })).rejects.toThrow(ScopeInputError)
    await expect(addExtraLine(CTX, [], { name: 'grout colours' }, { client })).rejects.toThrow('There is already a line called Grout colours.')
    await expect(addExtraLine(CTX, [row({ name: 'Niche', sort: 7 })], { name: 'NICHE' }, { client })).rejects.toThrow(ScopeInputError)
    expect(calls).toEqual([])
  })
  it('removes a hand-added line, read back, then its stored files; never a standard line', async () => {
    const { client, calls } = fakeDb((c) =>
      c.op === 'select' ? { data: [{ storage_path: 'co-1/site-1/a.pdf' }] } : c.op === 'delete' ? { data: [{ id: 'n' }] } : { data: [{ name: 'co-1/site-1/a.pdf' }] },
    )
    expect(await removeExtraLine(CTX, row({ id: 'n', name: 'Niche' }), { client })).toEqual({ objectsRemoved: true })
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['site_files:select', 'selections:delete', 'storage:site-files:remove'])
    const none = fakeDb()
    await expect(removeExtraLine(CTX, row({ id: 'g', scope_key: 'grout', name: 'Grout colours' }), { client: none.client })).rejects.toThrow(ScopeInputError)
    expect(none.calls).toEqual([])
  })
})
