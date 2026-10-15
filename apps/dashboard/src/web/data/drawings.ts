/**
 * The drawing register: which rows are drawings, which sheet is current, what
 * its chip says, and the two writes the website adds to it (upload a sheet or
 * a revision, remove the newest revision).
 *
 * The phone reads the register and never writes it (PlansScreen.tsx: "The
 * office uploads sheets to the job"), so every rule here that decides what a
 * crew member sees is a copy of the phone's, pinned to the phone's own source
 * by drawings.test.ts:
 *  - which site_files rows are drawings (REGISTER_FILTER, the register's query)
 *  - a sheet is superseded when another sheet names it in `supersedes`
 *  - levels, once there are nine or more current sheets (groupByLevel)
 *  - the chip: SUPERSEDED, else revChip(version), else CURRENT
 *  - open pins: a plan_pins row on the sheet with no resolved_at
 *
 * The writes are the old office dashboard's (ui/JobSiteFolder.tsx upload()),
 * which made every revision the phone shows today: kind 'document', category
 * 'plan', 'Rev A' for a new sheet and bumpVersion(prior) with `supersedes`
 * for a revision. bumpVersion is copied here before that file is deleted.
 *
 * Kept free of WP05's contract.ts on purpose, so this package stands on the
 * committed foundation alone; both copies are pinned to the same phone source.
 *
 * Every write is read back. RLS turns a refused DELETE into a success with no
 * rows; that reads here as refused, never as done.
 */
import { BUCKET_FILES, objectPath, removeFile, signedUrl, supabase, uploadFile, viewFile, type SiteFileRow, type WorkerRow } from '../phone'

/** The Supabase client. Every call takes an optional one, so a test can pass a fake. */
export type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

/** A register row: site_files as the register selects it ('*'), with the two columns that keep other paperwork out. */
export type Sheet = SiteFileRow & { selection_id?: string | null; waterproofing_package_id?: string | null }

/** What the register needs of a pin: which sheet, and whether it is still open. */
export interface PinRow {
  id: string
  file_id: string
  resolved_at: string | null
}

/** A level as the phone's levelOf reads it off a sheet's name. */
export type LevelOf = (name: string) => { label: string; sort: number } | null

// ----------------------------------------------------------------- the rules

/**
 * Which site_files rows are drawings, as [method, column, value], in the
 * order PlansScreen's query applies them. A scope line's data sheet and a
 * waterproofing product sheet are kind 'document' on the same job too; the
 * two nulls keep them out. Category is not a filter: the phone ignores it, so
 * ANY document row with neither link is a sheet to build from, and the
 * website must never file other paperwork that way.
 */
export const REGISTER_FILTER: ReadonlyArray<readonly ['eq' | 'is', string, string | null]> = [
  ['eq', 'kind', 'document'],
  ['is', 'selection_id', null],
  ['is', 'waterproofing_package_id', null],
]

/** The register lists sheets by name, as the phone does. */
export const REGISTER_ORDER = 'name'

/** The same filter on a row already in hand. */
export function isDrawing(row: { kind: string; selection_id?: string | null; waterproofing_package_id?: string | null }): boolean {
  return row.kind === 'document' && !row.selection_id && !row.waterproofing_package_id
}

/**
 * A sheet is superseded when another sheet names it in `supersedes`. That is
 * the only honest test: a version string alone cannot say whether something
 * newer exists. (PlansScreen.tsx supersededIds.)
 */
export function supersededIdsOf(sheets: ReadonlyArray<{ supersedes: string | null }>): Set<string> {
  return new Set(sheets.map((s) => s.supersedes).filter(Boolean) as string[])
}

// Office already stores version as "Rev A", "Rev B", etc. (see JobSiteFolder.tsx upload()),
// so prepending "REV " again produced "REV REV A" on every chip. Strip any leading "Rev"
// before adding our own.
export function revChip(version: string): string {
  return `REV ${version.replace(/^rev\s*/i, '').toUpperCase()}`
}

/** What a sheet's chip says in the phone's register (PlansScreen.tsx SheetList). */
export function sheetChip(version: string | null, superseded: boolean): string {
  return superseded ? 'SUPERSEDED' : version ? revChip(version) : 'CURRENT'
}

/**
 * "Rev A" → "Rev B". Anything else gets a numeric suffix rather than a guess.
 * Copied verbatim from the old dashboard (ui/JobSiteFolder.tsx), which wrote
 * every revision the phone's register shows, before that file is deleted.
 * Its one quirk is kept with it: "Rev Z" has no next letter and comes out
 * "Rev B". The dialog says the new revision's name before anything is sent.
 */
export function bumpVersion(prev: string | null): string {
  const m = /^Rev ([A-Y])$/.exec((prev ?? '').trim())
  if (m) return `Rev ${String.fromCharCode(m[1]!.charCodeAt(0) + 1)}`
  const n = /^(.*?)(\d+)$/.exec((prev ?? '').trim())
  if (n) return `${n[1]}${Number(n[2]) + 1}`
  return 'Rev B'
}

/**
 * Levels, once there are enough sheets for a flat list to stop working: nine
 * or more current sheets, in at least two levels. Below that the grouping is
 * noise. A sheet whose name says no level goes under "Other sheets", last.
 * (PlansScreen.tsx levels.)
 */
export function groupByLevel<T extends { name: string }>(current: ReadonlyArray<T>, levelOf: LevelOf): Array<[string, { sort: number; sheets: T[] }]> | null {
  if (current.length < 9) return null
  const groups = new Map<string, { sort: number; sheets: T[] }>()
  for (const sheet of current) {
    const lv = levelOf(sheet.name)
    const label = lv?.label ?? 'Other sheets'
    const sort = lv?.sort ?? 1000
    const g = groups.get(label) ?? { sort, sheets: [] }
    g.sheets.push(sheet)
    groups.set(label, g)
  }
  // One group is not a grouping.
  if (groups.size < 2) return null
  return [...groups.entries()].sort((a, b) => a[1].sort - b[1].sort)
}

/** Open pins per sheet: a pin with no resolved_at (PlansScreen.tsx pinsFor; Drawings.tsx counts the same). */
export function openPinsBySheet(pins: ReadonlyArray<{ file_id: string; resolved_at: string | null }>): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of pins) if (!p.resolved_at) out.set(p.file_id, (out.get(p.file_id) ?? 0) + 1)
  return out
}

/** The register as both apps show it: the search applied, then current and superseded. */
export interface Register<T extends Sheet = Sheet> {
  /** Every drawing on the job, searched or not. */
  all: T[]
  /** After the search. */
  shown: T[]
  current: T[]
  superseded: T[]
  supersededIds: Set<string>
  /** A superseded sheet → the revision that replaced it. */
  replacedBy: Map<string, T>
  /** A sheet → the revision it replaced, while that is still on the job. */
  replaces: Map<string, T>
  levels: Array<[string, { sort: number; sheets: T[] }]> | null
  openPins: Map<string, number>
}

/**
 * Everything the tab draws, worked out the phone's way: the search (a name
 * match, as the phone's box does) narrows the list first, and current,
 * superseded and the levels are taken from what is left.
 */
export function registerOf<T extends Sheet>(sheets: ReadonlyArray<T>, pins: ReadonlyArray<PinRow>, levelOf: LevelOf, query = ''): Register<T> {
  const supersededIds = supersededIdsOf(sheets)
  const q = query.trim().toLowerCase()
  const shown = q ? sheets.filter((x) => x.name.toLowerCase().includes(q)) : [...sheets]
  const current = shown.filter((x) => !supersededIds.has(x.id))
  const superseded = shown.filter((x) => supersededIds.has(x.id))
  const { replacedBy, replaces } = chainsOf(sheets)
  return { all: [...sheets], shown, current, superseded, supersededIds, replacedBy, replaces, levels: groupByLevel(current, levelOf), openPins: openPinsBySheet(pins) }
}

/** Each sheet's place in its chain of revisions: what replaced it, and what it replaced. */
export function chainsOf<T extends Pick<Sheet, 'id' | 'supersedes' | 'created_at'>>(sheets: ReadonlyArray<T>): { replacedBy: Map<string, T>; replaces: Map<string, T> } {
  const byId = new Map(sheets.map((s) => [s.id, s]))
  const replacedBy = new Map<string, T>()
  const replaces = new Map<string, T>()
  for (const s of sheets) {
    if (!s.supersedes) continue
    const prior = byId.get(s.supersedes)
    if (prior) replaces.set(s.id, prior)
    // Two revisions of one sheet should not happen (uploadDrawing refuses
    // it); if it ever does, the older of the two is named.
    const seen = replacedBy.get(s.supersedes)
    if (!seen || s.created_at < seen.created_at) replacedBy.set(s.supersedes, s)
  }
  return { replacedBy, replaces }
}

/**
 * The newest revision of a sheet: what replaced it, followed until nothing
 * has. A current sheet is its own. A revision may carry a new file name
 * ("A-201 rev B.pdf" over "A-201.pdf"), so this goes by `supersedes`, never
 * by name.
 */
export function headOf<T extends { id: string }>(sheet: T, replacedBy: ReadonlyMap<string, T>): T {
  let head = sheet
  const seen = new Set([head.id])
  for (let next = replacedBy.get(head.id); next && !seen.has(next.id); next = replacedBy.get(head.id)) {
    seen.add(next.id)
    head = next
  }
  return head
}

// ------------------------------------------------------------------- reading

export interface RegisterRows {
  sheets: Sheet[]
  pins: PinRow[]
  /** The pins could not be read: the sheets are right, the pin counts are not known. */
  pinsError: string | null
}

/**
 * The register's two reads, as PlansScreen makes them: the job's drawings
 * ordered by name, and its pins. A failed sheet read throws (the tab keeps
 * what it last had and says so); a failed pin read only loses the counts.
 */
export async function loadRegister(siteId: string, client?: Db): Promise<RegisterRows> {
  const c = db(client)
  let q = c.from('site_files').select('*').eq('site_id', siteId)
  for (const [method, column, value] of REGISTER_FILTER) q = method === 'eq' ? q.eq(column, value) : q.is(column, null)
  const [f, p] = await Promise.all([q.order(REGISTER_ORDER), c.from('plan_pins').select('id, file_id, resolved_at').eq('site_id', siteId)])
  if (f.error) throw new Error(f.error.message)
  return { sheets: (f.data ?? []) as Sheet[], pins: (p.data ?? []) as PinRow[], pinsError: p.error ? p.error.message : null }
}

/** Open a sheet in the file viewer, through a signed URL (the bucket is private). False when it cannot be signed. */
export async function openSheet(sheet: Pick<Sheet, 'storage_path' | 'name'>): Promise<boolean> {
  const url = await signedUrl(BUCKET_FILES, sheet.storage_path)
  if (!url) return false
  viewFile({ url, name: sheet.name })
  return true
}

// ------------------------------------------------------------------- writing

/** The bucket's own limit (storage.sql), which the old dashboard checked before sending. */
export const DRAWING_MAX_BYTES = 25 * 1024 * 1024

/**
 * What a drawing can be: what the phone can show. A PDF opens in the
 * viewer's frame and an image takes pins; anything else would sit in the
 * crew's register as a sheet they cannot open.
 */
export const DRAWING_ACCEPT = 'application/pdf,.pdf,image/*'

/** A size as a person says it. */
export const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${Math.round((n / 1024 / 1024) * 10) / 10} MB`)

/** Why a file cannot go up, before anything is sent; null when it can. */
export function drawingRefusal(file: { name: string; size: number }): string | null {
  if (file.size > DRAWING_MAX_BYTES) return `${file.name} is ${sizeLabel(file.size)}; the limit is ${sizeLabel(DRAWING_MAX_BYTES)}. Upload a smaller copy.`
  if (file.size === 0) return `${file.name} is empty.`
  return null
}

/**
 * The site_files row for an upload, exactly as the old dashboard wrote it:
 * a new sheet is Rev A; a revision is bumpVersion(prior) and names the prior
 * sheet in `supersedes`. selection_id and waterproofing_package_id stay
 * unset (null), which is what makes it a drawing.
 */
export function drawingInsert({
  me,
  siteId,
  file,
  path,
  prior = null,
}: {
  me: Pick<WorkerRow, 'id' | 'company_id'>
  siteId: string
  file: { name: string; type: string; size: number }
  path: string
  prior?: Pick<Sheet, 'id' | 'version'> | null
}) {
  return {
    company_id: me.company_id,
    site_id: siteId,
    uploaded_by: me.id,
    kind: 'document' as const,
    storage_path: path,
    name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    category: 'plan',
    version: prior ? bumpVersion(prior.version) : 'Rev A',
    supersedes: prior ? prior.id : null,
  }
}

export type WriteResult<T> = { ok: true; value: T; warning?: string } | { ok: false; message: string }

/**
 * Put one sheet up: as Rev A, or as the next revision of `prior`.
 *
 * In order: the size check (nothing is sent for a file over 25 MB); for a
 * revision, a check that nobody has revised `prior` already (two revisions
 * of one sheet would leave two current sheets, and the crew could build from
 * either); the object under <company>/<site>/; then the row, read back as
 * stored. If the row cannot be written, the object just sent is removed
 * again, so a failed upload leaves nothing behind.
 */
export async function uploadDrawing(
  { me, siteId, file, prior = null }: { me: Pick<WorkerRow, 'id' | 'company_id'>; siteId: string; file: File; prior?: Sheet | null },
  client?: Db,
): Promise<WriteResult<Sheet>> {
  const refusal = drawingRefusal(file)
  if (refusal) return { ok: false, message: refusal }
  const c = db(client)

  if (prior) {
    const { data: newer, error } = await c.from('site_files').select('id, name, version').eq('supersedes', prior.id).limit(1)
    if (error) return { ok: false, message: `Could not check ${prior.name} is still current: ${error.message}` }
    if (newer && newer.length > 0) {
      const n = newer[0] as { name: string; version: string | null }
      return { ok: false, message: `${prior.name} has already been revised (${n.version ?? n.name}). Reload the register and revise the current sheet.` }
    }
  }

  const path = objectPath(me.company_id, siteId, file.name)
  try {
    await uploadFile(BUCKET_FILES, path, file)
  } catch (e) {
    return { ok: false, message: `${file.name} did not upload: ${e instanceof Error ? e.message : String(e)}` }
  }

  const row = drawingInsert({ me, siteId, file, path, prior })
  const { data, error } = await c.from('site_files').insert(row).select('*').single()
  const stored = data as Sheet | null
  const matches =
    !!stored &&
    stored.storage_path === row.storage_path &&
    stored.kind === row.kind &&
    stored.category === row.category &&
    stored.version === row.version &&
    (stored.supersedes ?? null) === row.supersedes &&
    isDrawing(stored)
  if (error || !matches) {
    // Not on the register, so the file must not stay in storage either.
    await removeFile(BUCKET_FILES, path).catch(() => {})
    return { ok: false, message: `${file.name} did not save: ${error?.message ?? 'the row did not read back as written.'}` }
  }
  return { ok: true, value: stored }
}

/**
 * Take the newest revision of a sheet off the job: the row, then the stored
 * file, each read back. The revision before it (if any) becomes current
 * again, because nothing supersedes it any more. Its pins go with it
 * (plan_pins.file_id cascades).
 *
 * Only the newest revision: removing one in the middle of a chain would
 * cut the history ("what did the plan say when we built it" is the whole
 * question in a dispute), so a superseded sheet is refused, checked against
 * the database rather than the screen.
 */
export async function removeDrawing(sheet: Pick<Sheet, 'id' | 'name' | 'storage_path'>, client?: Db): Promise<WriteResult<{ id: string }>> {
  const c = db(client)
  const { data: newer, error: checkErr } = await c.from('site_files').select('id, version').eq('supersedes', sheet.id).limit(1)
  if (checkErr) return { ok: false, message: `Could not check ${sheet.name} is the newest revision: ${checkErr.message}` }
  if (newer && newer.length > 0) return { ok: false, message: `${sheet.name} has a newer revision. Only the newest revision of a sheet can be removed.` }

  const { data: gone, error } = await c.from('site_files').delete().eq('id', sheet.id).select('id')
  if (error) return { ok: false, message: `${sheet.name} was not removed: ${error.message}` }
  if (!gone || gone.length === 0) return { ok: false, message: `${sheet.name} was not removed: the database refused it.` }

  const { data: still } = await c.from('site_files').select('id').eq('id', sheet.id)
  if (still && still.length > 0) return { ok: false, message: `${sheet.name} still reads back on the register.` }

  // The row is gone, so the sheet is off every phone. A file left in storage
  // is invisible clutter, not a wrong drawing; it is reported, not undone.
  let warning: string | undefined
  try {
    await removeFile(BUCKET_FILES, sheet.storage_path)
    const slash = sheet.storage_path.lastIndexOf('/')
    const folder = sheet.storage_path.slice(0, slash)
    const fileName = sheet.storage_path.slice(slash + 1)
    const { data: left, error: listErr } = await c.storage.from(BUCKET_FILES).list(folder, { search: fileName })
    if (listErr) warning = `${sheet.name} is off the register; whether its file left storage could not be checked (${listErr.message}).`
    else if ((left ?? []).some((o) => o.name === fileName)) warning = `${sheet.name} is off the register, but its file is still in storage.`
  } catch (e) {
    warning = `${sheet.name} is off the register, but its file could not be deleted from storage: ${e instanceof Error ? e.message : String(e)}`
  }
  return { ok: true, value: { id: sheet.id }, warning }
}

// ------------------------------------------------------- names already taken

/**
 * A file name as the office reads it, case and the spaces round it aside.
 * "A-101.PDF" and "a-101.pdf" are one sheet to anyone looking at the
 * register, so they are one name here.
 */
export const nameKey = (name: string) => name.trim().toLowerCase()

/** A dropped file named like a sheet on the job. */
export interface NameClash<T> {
  /** The sheet the file is named like. */
  sheet: T
  /** That sheet has been revised: the name is an old revision's. */
  superseded: boolean
  /** The current revision a new one would go over: `sheet` itself, or what replaced it. */
  head: T
}

/**
 * The sheet on the job a dropped file is named like, current or superseded.
 * Probably the drawing office reissuing it under the same name: put up as a
 * second Rev A, the crew would see two current sheets called the same thing
 * (or, for an old revision's name, the sheet they were told not to build
 * from back on the register as current), and could build from either.
 *
 * A current sheet of that name is named before a superseded one, and among
 * equals the newest. `head` is where a revision of it would go: on top of
 * the chain, whatever that revision is called.
 */
export function nameClash<T extends Sheet>(file: { name: string }, sheets: ReadonlyArray<T>): NameClash<T> | null {
  const key = nameKey(file.name)
  const named = sheets.filter((s) => nameKey(s.name) === key)
  if (named.length === 0) return null
  const supersededIds = supersededIdsOf(sheets)
  const rank = (s: T) => (supersededIds.has(s.id) ? 1 : 0)
  const sheet = named.reduce((best, s) => (rank(s) < rank(best) || (rank(s) === rank(best) && s.created_at > best.created_at) ? s : best))
  return { sheet, superseded: supersededIds.has(sheet.id), head: headOf(sheet, chainsOf(sheets).replacedBy) }
}

/**
 * Which files of a drop to hold back and ask about, in the drop's order:
 * any named like
 *  - a sheet on the job, current or superseded (nameClash);
 *  - a file from an earlier drop that has not reached the register yet:
 *    still waiting, still going up, or itself held. Checking only the
 *    register as last read let a second copy dropped a moment after the
 *    first go straight up beside it;
 *  - an earlier file in this same drop.
 * Names compare as nameKey does. True means hold.
 */
export function holdBack(files: ReadonlyArray<{ name: string }>, sheets: ReadonlyArray<{ name: string }>, outstanding: ReadonlyArray<{ name: string }>): boolean[] {
  const taken = new Set([...sheets, ...outstanding].map((x) => nameKey(x.name)))
  return files.map((f) => {
    const key = nameKey(f.name)
    const hold = taken.has(key)
    taken.add(key)
    return hold
  })
}
