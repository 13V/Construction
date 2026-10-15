/**
 * The scope of works, as the website reads and writes it.
 *
 * The crew's phones show a job's scope under Overview › Scope of works
 * (worker/simple/Overview.tsx), and every rule here is that screen's, so a
 * line set on the website reads on a phone exactly as if the office had set
 * it there:
 *  - The seven template lines (contract.ts SCOPE_TEMPLATE) are drawn whether
 *    or not a row exists. An untouched line has NO selections row and counts
 *    as Required; a row is written the first time a line is changed, with the
 *    template's scope_key, name and detail and sort = its template index.
 *  - Required / Confirmed / Not applicable are stored as pending / chosen /
 *    not_applicable. `chosen` and `chosen_at` are written only for Confirmed
 *    and cleared otherwise, and a Confirmed with nothing recorded is refused
 *    before anything is sent: on the phone's list and in its Complete tally
 *    it would read exactly like a real selection.
 *  - A line's attachments are site_files rows with selection_id set and kind
 *    'document' (also for photos). kind keeps them out of the Photos grid,
 *    selection_id keeps them out of the Drawings register. A first file on a
 *    line with no row yet creates the row first, as 'pending'.
 * The website adds two things the phone cannot do: lines added by hand
 * (scope_key null, after the template, which the phone already lists), and
 * deleting the stored file when an attachment is removed (the phone deletes
 * only the row, and the object stays in the bucket for ever).
 *
 * Every write is read back. RLS turns a refused UPDATE or DELETE into a
 * success that matched nothing, so a write that returns no row is reported
 * as not saved, never taken on trust.
 *
 * scope.test.ts pins the rules copied from the phone against the phone's
 * own source.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BUCKET_FILES, objectPath, supabase } from '../phone'
import { SCOPE_STATUSES, SCOPE_TEMPLATE, type ScopeLine, type ScopeStatus } from './contract'
import { useFresh } from './useFresh'

export type Db = ReturnType<typeof supabase>
export interface WriteOpts {
  client?: Db
}

// ------------------------------------------------------------------ rows

/** A selections row, as much of it as a scope line uses. */
export interface ScopeRow {
  id: string
  scope_key: string | null
  name: string
  detail: string | null
  status: ScopeStatus
  chosen: string | null
  chosen_at: string | null
  sort: number
}
export const SCOPE_COLS = 'id, scope_key, name, detail, status, chosen, chosen_at, sort'

/** A file attached to a scope line (site_files with selection_id set). */
export interface ScopeFile {
  id: string
  selection_id: string
  name: string
  mime: string | null
  size_bytes: number | null
  storage_path: string
  created_at: string
}
export const SCOPE_FILE_COLS = 'id, selection_id, name, mime, size_bytes, storage_path, created_at'

/** Whose company and job a write is for, and who is making it. */
export interface ScopeCtx {
  company_id: string
  site_id: string
  /** workers.id, stored as uploaded_by: site_files' insert policy checks it is the caller. */
  worker_id: string
}

/** Something the person can fix: blank text, a file too big. Thrown before any request. */
export class ScopeInputError extends Error {
  name = 'ScopeInputError'
}
/** The database or the bucket refused, or a write matched nothing. */
export class ScopeWriteError extends Error {
  name = 'ScopeWriteError'
}

/** The phone's words for an empty Confirmed (Overview.tsx ScopeSheet). */
export const NEEDS_CHOSEN = 'Enter what was chosen, or set this to Required/Not applicable instead.'

// ------------------------------------------------------------------ files

/**
 * The bucket's own limit (supabase/storage.sql: site-files file_size_limit
 * 26214400). Checked here so a file over it is refused before an upload
 * starts, rather than after it has gone up and been bounced.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** What the phone's "PDF or file" picker takes: the paperwork a scope line is decided on. */
export const ATTACH_ACCEPT = 'application/pdf,.pdf,.doc,.docx,.xls,.xlsx,image/*'

// ------------------------------------------------------------------ the lines

/** One line of the table: a template line (with its row once it has one) or a line added by hand. */
export interface ScopeEntry {
  /** The template key, or the row id of a line added by hand. Stable across reloads. */
  key: string
  /** Name and detail as shown, and as written on a template line's first change. */
  line: ScopeLine
  row: ScopeRow | null
  /** Its index in SCOPE_TEMPLATE; null for a line added by hand. */
  index: number | null
  status: ScopeStatus
}

/**
 * The phone's list: the seven template lines in its order, then the lines
 * added by hand (scope_key null). A row whose scope_key is not in the
 * template is shown nowhere by the phone, so it is not shown here either.
 *
 * The phone lists hand-added lines in whatever order the database returns
 * them; here they go by sort, which is the order they were added in.
 */
export function scopeEntries(rows: ReadonlyArray<ScopeRow>): ScopeEntry[] {
  const byKey = new Map(rows.filter((r) => r.scope_key).map((r) => [r.scope_key!, r]))
  const extras = rows
    .filter((r) => !r.scope_key)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return [
    ...SCOPE_TEMPLATE.map((line, index) => {
      const row = byKey.get(line.key) ?? null
      return { key: line.key, line, row, index, status: row?.status ?? 'pending' }
    }),
    ...extras.map((row) => ({ key: row.id, line: { key: row.id, name: row.name, detail: row.detail ?? '' }, row, index: null, status: row.status })),
  ]
}

/**
 * What a status change writes: the phone's patch (Overview.tsx setStatus).
 * `chosen` only means anything on a Confirmed line, so Required and Not
 * applicable clear it and its date; otherwise the list goes on printing old
 * text in the green "confirmed" style. Throws ScopeInputError for a
 * Confirmed with no text.
 */
export function statusPatch(status: ScopeStatus, chosen: string, now: Date = new Date()): { status: ScopeStatus; chosen: string | null; chosen_at: string | null } {
  if (!SCOPE_STATUSES.includes(status)) throw new ScopeInputError(`Unknown status ${String(status)}.`)
  const text = chosen.trim()
  if (status === 'chosen' && !text) throw new ScopeInputError(NEEDS_CHOSEN)
  return {
    status,
    chosen: status === 'chosen' ? text : null,
    chosen_at: status === 'chosen' ? now.toISOString() : null,
  }
}

/**
 * A template line's row, as the phone inserts it on the line's first change:
 * the template's key, name and detail, sort = its template index.
 */
export function templateInsert(ctx: Pick<ScopeCtx, 'company_id' | 'site_id'>, key: string, fields: { status: ScopeStatus; chosen?: string | null; chosen_at?: string | null }) {
  const index = SCOPE_TEMPLATE.findIndex((t) => t.key === key)
  if (index < 0) throw new ScopeInputError(`${key} is not one of the standard lines.`)
  const t = SCOPE_TEMPLATE[index]!
  return { company_id: ctx.company_id, site_id: ctx.site_id, scope_key: t.key, name: t.name, detail: t.detail, sort: index, ...fields }
}

/**
 * Where the next hand-added line sorts: after the template (7) and after
 * every line already added, so the first is 7, the next 8, and a line
 * removed in between leaves no tie behind it.
 */
export function nextExtraSort(rows: ReadonlyArray<Pick<ScopeRow, 'scope_key' | 'sort'>>): number {
  return rows.filter((r) => !r.scope_key).reduce((n, r) => Math.max(n, r.sort + 1), SCOPE_TEMPLATE.length)
}

/** The site_files row for one attachment: the phone's insert (Overview.tsx attach), key for key. */
export function fileInsert(ctx: ScopeCtx, selectionId: string, file: Pick<File, 'name' | 'type' | 'size'>, storagePath: string) {
  return {
    company_id: ctx.company_id,
    site_id: ctx.site_id,
    selection_id: selectionId,
    uploaded_by: ctx.worker_id,
    kind: 'document' as const,
    storage_path: storagePath,
    name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
  }
}

// ------------------------------------------------------------------ reads

export interface ScopeData {
  rows: ScopeRow[]
  /** Attachments by selection id, oldest first (the phone's order). */
  files: Map<string, ScopeFile[]>
}

/** A job's scope rows and its lines' attachments, as the phone loads them. */
export async function loadScope(siteId: string, { client = supabase() }: WriteOpts = {}): Promise<ScopeData> {
  const [sel, att] = await Promise.all([
    client.from('selections').select(SCOPE_COLS).eq('site_id', siteId),
    client.from('site_files').select(SCOPE_FILE_COLS).eq('site_id', siteId).not('selection_id', 'is', null).order('created_at'),
  ])
  if (sel.error) throw new ScopeWriteError(`Could not load the scope: ${sel.error.message}`)
  if (att.error) throw new ScopeWriteError(`Could not load the attachments: ${att.error.message}`)
  const files = new Map<string, ScopeFile[]>()
  for (const f of (att.data ?? []) as ScopeFile[]) files.set(f.selection_id, [...(files.get(f.selection_id) ?? []), f])
  return { rows: (sel.data ?? []) as ScopeRow[], files }
}

// ------------------------------------------------------------------ writes

const UNIQUE_VIOLATION = '23505'

/** Update one selections row by id, read back. */
async function updateRow(client: Db, ctx: ScopeCtx, id: string, patch: object, what: string): Promise<ScopeRow> {
  const { data, error } = await client.from('selections').update(patch).eq('id', id).eq('site_id', ctx.site_id).select(SCOPE_COLS)
  if (error) throw new ScopeWriteError(`${what} did not save: ${error.message}`)
  const rows = (data ?? []) as ScopeRow[]
  if (rows.length !== 1) throw new ScopeWriteError(`${what} did not save: the line was not there to change. It may have been removed; the list has been reloaded.`)
  return rows[0]!
}

/**
 * Write a template line's first row, read back. If a phone made the row a
 * moment ago (unique on site_id + scope_key), that row is the line: it is
 * found and, when there is a status to set, updated instead.
 */
async function writeTemplateRow(
  client: Db,
  ctx: ScopeCtx,
  key: string,
  patch: ReturnType<typeof statusPatch> | null,
  what: string,
): Promise<ScopeRow> {
  const ins = await client
    .from('selections')
    .insert(templateInsert(ctx, key, patch ?? { status: 'pending' }))
    .select(SCOPE_COLS)
  const made = (ins.data ?? []) as ScopeRow[]
  if (!ins.error && made.length === 1) return made[0]!
  if (ins.error?.code === UNIQUE_VIOLATION) {
    const { data } = await client.from('selections').select(SCOPE_COLS).eq('site_id', ctx.site_id).eq('scope_key', key)
    const there = ((data ?? []) as ScopeRow[])[0]
    if (there) return patch ? updateRow(client, ctx, there.id, patch, what) : there
  }
  throw new ScopeWriteError(`${what} did not save: ${ins.error?.message ?? 'nothing came back'}`)
}

/**
 * Set a line to Required, Confirmed (with what was chosen) or Not
 * applicable. A template line with no row gets one now. Returns the row as
 * stored. A Confirmed with no text throws ScopeInputError and sends nothing.
 */
export async function setLineStatus(
  ctx: ScopeCtx,
  entry: Pick<ScopeEntry, 'key' | 'line' | 'row' | 'index'>,
  status: ScopeStatus,
  chosen: string,
  { client = supabase(), now }: WriteOpts & { now?: Date } = {},
): Promise<ScopeRow> {
  const patch = statusPatch(status, chosen, now)
  const what = entry.line.name
  if (entry.row) return updateRow(client, ctx, entry.row.id, patch, what)
  if (entry.index === null) throw new ScopeInputError(`${what} has no row to change.`)
  return writeTemplateRow(client, ctx, entry.key, patch, what)
}

export interface AttachResult {
  /** The line's row: the one it had, or the 'pending' one made to hang the files on. */
  row: ScopeRow | null
  added: ScopeFile[]
  failed: Array<{ name: string; message: string }>
}

/**
 * What a line says about the files of one drop that did not make it on:
 * the ones refused before sending (DropZone's reasons, each a sentence that
 * names its file) and the ones the bucket or the database turned away. Null
 * when every file went on. One note, so a drop that partly worked never
 * reads as if it had all worked.
 */
export function leftOutNote(refused: ReadonlyArray<string>, failed: ReadonlyArray<{ name: string; message: string }> = []): string | null {
  const all = [...refused.map((r) => r.trim()), ...failed.map((f) => `${f.name} did not upload (${f.message.replace(/\.$/, '')}).`)]
  return all.length ? `Not attached: ${all.join(' ')}` : null
}

/**
 * The selection a line loses when it is moved off Confirmed: the phone's
 * patch clears `chosen` (statusPatch), and a single click on the button next
 * to Confirmed would otherwise erase the product name with nothing left to
 * put back. The screen keeps it in the field, unsaved, so pressing Confirmed
 * restores it; `chosen_at` comes along so the restore keeps its own date.
 * Null when there is nothing recorded to lose.
 */
export function selectionLost(row: Pick<ScopeRow, 'status' | 'chosen' | 'chosen_at'> | null, to: ScopeStatus): { chosen: string; chosen_at: string | null } | null {
  if (to === 'chosen' || row?.status !== 'chosen' || !row.chosen?.trim()) return null
  return { chosen: row.chosen, chosen_at: row.chosen_at }
}

/**
 * When a Confirmed is the put-back of a selection kept by selectionLost (the
 * same text), it is dated as it was first confirmed, not now; anything else
 * is dated now (undefined: statusPatch's default).
 */
export function restoredDate(kept: { chosen: string; chosen_at: string | null } | null | undefined, text: string): Date | undefined {
  if (!kept?.chosen_at || kept.chosen.trim() !== text.trim()) return undefined
  const d = new Date(kept.chosen_at)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Files over the cap, in words; empty when all are fine. */
export function oversize(files: ReadonlyArray<Pick<File, 'name' | 'size'>>): string[] {
  const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`
  return files.filter((f) => f.size > MAX_ATTACHMENT_BYTES).map((f) => `${f.name} is ${mb(f.size)}; the limit is ${mb(MAX_ATTACHMENT_BYTES)}.`)
}

/**
 * Attach files to a line: the phone's attach(). A template line with no row
 * gets a 'pending' row first. Each file goes to <company>/<site>/<uuid>-name
 * (the folder the storage policies check), then its site_files row is
 * inserted and read back; a row that will not insert takes its uploaded
 * object away with it, so nothing is left in the bucket that no screen
 * shows. Any file over the cap refuses the lot before anything is sent.
 */
export async function attachFiles(
  ctx: ScopeCtx,
  entry: Pick<ScopeEntry, 'key' | 'line' | 'row' | 'index'>,
  files: ReadonlyArray<File>,
  { client = supabase() }: WriteOpts = {},
): Promise<AttachResult> {
  const big = oversize(files)
  if (big.length) throw new ScopeInputError(big.join(' '))
  if (files.length === 0) return { row: entry.row, added: [], failed: [] }

  let row = entry.row
  if (!row) {
    if (entry.index === null) throw new ScopeInputError(`${entry.line.name} has no row to attach to.`)
    row = await writeTemplateRow(client, ctx, entry.key, null, entry.line.name)
  }

  const bucket = client.storage.from(BUCKET_FILES)
  const added: ScopeFile[] = []
  const failed: AttachResult['failed'] = []
  for (const file of files) {
    const path = objectPath(ctx.company_id, ctx.site_id, file.name)
    const up = await bucket.upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (up.error) {
      failed.push({ name: file.name, message: up.error.message })
      continue
    }
    const { data, error } = await client.from('site_files').insert(fileInsert(ctx, row.id, file, path)).select(SCOPE_FILE_COLS)
    const stored = ((data ?? []) as ScopeFile[])[0]
    if (error || !stored) {
      await bucket.remove([path]).catch(() => undefined)
      failed.push({ name: file.name, message: error?.message ?? 'the file row did not save' })
      continue
    }
    added.push(stored)
  }
  return { row, added, failed }
}

/**
 * Remove an attachment: its row, read back, then the stored file. The row
 * goes first: a row whose object is gone would be a broken file on every
 * phone, while an object whose row is gone is only bytes nobody sees.
 * Returns whether the stored file went too.
 */
export async function removeAttachment(file: Pick<ScopeFile, 'id' | 'name' | 'storage_path'>, { client = supabase() }: WriteOpts = {}): Promise<{ objectRemoved: boolean }> {
  const { data, error } = await client.from('site_files').delete().eq('id', file.id).select('id')
  if (error) throw new ScopeWriteError(`${file.name} was not removed: ${error.message}`)
  if (!data || data.length !== 1) throw new ScopeWriteError(`${file.name} was not removed. Only the office can remove attachments.`)
  return { objectRemoved: await removeObjects(client, [file.storage_path]) }
}

/** Delete stored files, read back by what the bucket says it deleted. */
async function removeObjects(client: Db, paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true
  try {
    const { data, error } = await client.storage.from(BUCKET_FILES).remove(paths)
    // A refused delete is not an error either: it removes nothing and says so.
    return !error && (data ?? []).length === paths.length
  } catch {
    return false
  }
}

/**
 * Add a line of the office's own: scope_key null, Required, sorted after
 * the template and the lines already added. Its name may not repeat one
 * already on the job, which would be two lines nobody could tell apart.
 */
export async function addExtraLine(
  ctx: ScopeCtx,
  rows: ReadonlyArray<ScopeRow>,
  input: { name: string; detail?: string },
  { client = supabase() }: WriteOpts = {},
): Promise<ScopeRow> {
  const name = input.name.trim()
  const detail = (input.detail ?? '').trim()
  if (!name) throw new ScopeInputError('Give the line a name.')
  const taken = scopeEntries(rows).find((e) => e.line.name.trim().toLowerCase() === name.toLowerCase())
  if (taken) throw new ScopeInputError(`There is already a line called ${taken.line.name}.`)
  const { data, error } = await client
    .from('selections')
    .insert({ company_id: ctx.company_id, site_id: ctx.site_id, scope_key: null, name, detail: detail || null, sort: nextExtraSort(rows), status: 'pending' })
    .select(SCOPE_COLS)
  const row = ((data ?? []) as ScopeRow[])[0]
  if (error || !row) throw new ScopeWriteError(`${name} was not added: ${error?.message ?? 'nothing came back'}`)
  return row
}

/**
 * Remove a line the office added (never a template line: the phone draws
 * those whatever the database holds). Its attachment rows go with it
 * (on delete cascade); their stored files are deleted after, as for a
 * single attachment. Returns whether every stored file went.
 */
export async function removeExtraLine(ctx: ScopeCtx, row: Pick<ScopeRow, 'id' | 'name' | 'scope_key'>, { client = supabase() }: WriteOpts = {}): Promise<{ objectsRemoved: boolean }> {
  if (row.scope_key) throw new ScopeInputError(`${row.name} is a standard line; set it to Not applicable instead.`)
  const att = await client.from('site_files').select('storage_path').eq('selection_id', row.id)
  if (att.error) throw new ScopeWriteError(`${row.name} was not removed: ${att.error.message}`)
  const paths = ((att.data ?? []) as Array<{ storage_path: string }>).map((f) => f.storage_path)
  const { data, error } = await client.from('selections').delete().eq('id', row.id).eq('site_id', ctx.site_id).select('id')
  if (error) throw new ScopeWriteError(`${row.name} was not removed: ${error.message}`)
  if (!data || data.length !== 1) throw new ScopeWriteError(`${row.name} was not removed. It may already have gone; the list has been reloaded.`)
  return { objectsRemoved: await removeObjects(client, paths) }
}

// ------------------------------------------------------------------ the hook

export interface ScopeState {
  /** Null until the first load for this job comes back. */
  data: ScopeData | null
  /** The last load's failure; the last good data stays on screen. */
  error: string | null
  reload: () => Promise<void>
  /**
   * Put a row a write just read back into the list now, without waiting for
   * the reload. Until that lands, the screen would otherwise judge the next
   * edit against the line as it was before this write (and, say, take text
   * typed back to the old value as "unchanged" and not send it).
   */
  put: (row: ScopeRow) => void
}

/**
 * A job's scope, refreshed when the window regains focus, when the tab is
 * shown again and every 60 s (useFresh), so a line confirmed on a phone shows
 * here without a reload. Only the newest load lands: a slow refresh that
 * started before a write cannot put the old line back after it.
 */
export function useScope(siteId: string): ScopeState {
  const [state, setState] = useState<{ forSite: string; data: ScopeData | null; error: string | null }>({ forSite: siteId, data: null, error: null })
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    try {
      const data = await loadScope(siteId)
      if (mine === seq.current) setState({ forSite: siteId, data, error: null })
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ forSite: siteId, data: s.forSite === siteId ? s.data : null, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [siteId])

  const put = useCallback(
    (row: ScopeRow) => {
      // A load already on its way read the database before this write; it
      // must not land on top of it. The reload after the write replaces it.
      seq.current += 1
      setState((s) => (s.forSite !== siteId || !s.data ? s : { ...s, data: { ...s.data, rows: [...s.data.rows.filter((r) => r.id !== row.id), row] } }))
    },
    [siteId],
  )

  useEffect(() => {
    void reload()
  }, [reload])
  useFresh(() => void reload())

  const current = state.forSite === siteId
  return { data: current ? state.data : null, error: current ? state.error : null, reload, put }
}
