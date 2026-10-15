/**
 * The builder's programme: the PDF the builder issues and keeps reissuing,
 * read and written exactly as the phone does (worker/simple/Programme.tsx).
 *
 * A new upload never overwrites the old one, it supersedes it: the row goes
 * in with status 'current' and the database's programmes_one_current trigger
 * (schema_v21) demotes whichever revision was current before, so there is
 * exactly one current programme per job and every earlier one stays
 * readable. The file lives in programmes.storage_path, never as a site_files
 * row: the drawing register lists every document row on a job, and a
 * programme is not a drawing to build from.
 *
 * The read is the phone's useProgrammes query, made here so a failed read can
 * say so (the phone's hook shows a failed read as "Not uploaded yet", which
 * on a desk would invite a second upload of the same revision). The line the
 * phone's Project details shows is the phone's own programmeLine.
 * programme.test.ts pins the read, the split and the insert to the phone's
 * source.
 */
import { BUCKET_FILES, objectPath, removeFile, signedUrl, supabase, uploadFile, viewFile, type WorkerRow } from '../phone'
import type { ProgrammeRow } from '../phone-features'

export type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

export type { ProgrammeRow }

/** The columns the phone reads (Programme.tsx COLS). */
export const PROGRAMME_COLS = 'id, name, revision, issued_on, received_on, storage_path, status'

/** What the phone's file input takes (Programme.tsx: a PDF, or a photo of the printed programme). */
export const PROGRAMME_ACCEPT = 'application/pdf,image/*'

/** The bucket's own limit (storage.sql); the phone leaves it to the bucket, the website says it before sending. */
export const PROGRAMME_MAX_BYTES = 25 * 1024 * 1024

export interface Programmes {
  rows: ProgrammeRow[]
  current: ProgrammeRow | null
  /** Everything but the current one, newest first: what the phone lists under "Superseded". */
  history: ProgrammeRow[]
}

/** The phone's split (useProgrammes): the first row that is current, and the rest. */
export function splitProgrammes(rows: ProgrammeRow[]): Programmes {
  const current = rows.find((r) => r.status === 'current') ?? null
  const history = rows.filter((r) => r.id !== current?.id)
  return { rows, current, history }
}

/** Every revision of a job's programme, newest first, as the phone reads them. Throws when the read fails. */
export async function loadProgrammes(siteId: string, client?: Db): Promise<Programmes> {
  const { data, error } = await db(client)
    .from('programmes')
    .select(PROGRAMME_COLS)
    .eq('site_id', siteId)
    .order('received_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return splitProgrammes((data ?? []) as unknown as ProgrammeRow[])
}

/** Today as a local calendar date, as the phone stamps received_on. */
export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The programme's name, from its file name the phone's way: "Stage-2_programme.pdf" → "Stage 2 programme". */
export const programmeName = (fileName: string) => fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')

/** Why a file cannot go up, before anything is sent; null when it can. */
export function programmeRefusal(file: { name: string; size: number }): string | null {
  if (file.size > PROGRAMME_MAX_BYTES) return `${file.name} is over 25 MB. Upload a smaller copy.`
  if (file.size === 0) return `${file.name} is empty.`
  return null
}

/**
 * The programmes row, exactly as the phone's ProgrammeSheet inserts it
 * (Programme.tsx upload()): source 'pdf', status 'current' (the trigger does
 * the superseding), received today, blanks as null.
 */
export function programmeInsert({
  me,
  siteId,
  file,
  revision,
  issuedOn,
  path,
  today = todayISO(),
}: {
  me: Pick<WorkerRow, 'id' | 'company_id'>
  siteId: string
  file: { name: string }
  revision: string
  issuedOn: string
  path: string
  today?: string
}) {
  return {
    company_id: me.company_id,
    site_id: siteId,
    name: programmeName(file.name),
    revision: revision.trim() || null,
    issued_on: issuedOn || null,
    received_on: today,
    source: 'pdf' as const,
    storage_path: path,
    status: 'current' as const,
    imported_by: me.id,
  }
}

export type UploadResult =
  | { ok: true; row: ProgrammeRow; superseded: string[]; warning?: string }
  | { ok: false; message: string }

/**
 * Put a new revision up. In order: the size check (nothing sent over 25 MB);
 * which revision is current now; the file under <company>/<site>/; the row,
 * read back as stored; then the read-back that matters, that the new row is
 * the job's only current programme and the one before it now reads
 * 'superseded'. A row that cannot be written takes its file back out of
 * storage.
 */
export async function uploadProgramme(
  { me, siteId, file, revision, issuedOn }: { me: Pick<WorkerRow, 'id' | 'company_id'>; siteId: string; file: File; revision: string; issuedOn: string },
  client?: Db,
): Promise<UploadResult> {
  const refusal = programmeRefusal(file)
  if (refusal) return { ok: false, message: refusal }
  const c = db(client)

  const before = await c.from('programmes').select('id').eq('site_id', siteId).eq('status', 'current')
  if (before.error) return { ok: false, message: `Could not read the current programme: ${before.error.message}` }
  const priorIds = ((before.data ?? []) as Array<{ id: string }>).map((r) => r.id)

  const path = objectPath(me.company_id, siteId, file.name)
  try {
    await uploadFile(BUCKET_FILES, path, file)
  } catch (e) {
    return { ok: false, message: `${file.name} did not upload: ${e instanceof Error ? e.message : String(e)}` }
  }

  const row = programmeInsert({ me, siteId, file, revision, issuedOn, path })
  const { data, error } = await c.from('programmes').insert(row).select(PROGRAMME_COLS).single()
  const stored = data as unknown as ProgrammeRow | null
  if (error || !stored || stored.storage_path !== path) {
    await removeFile(BUCKET_FILES, path).catch(() => {})
    return { ok: false, message: `${file.name} did not save: ${error?.message ?? 'the row did not read back as written.'}` }
  }

  // The trigger runs in the insert's own transaction, so by now the job has
  // one current programme: this one.
  const after = await c.from('programmes').select('id, status').eq('site_id', siteId).in('id', [stored.id, ...priorIds])
  if (after.error) return { ok: true, row: stored, superseded: [], warning: `Uploaded, but the revisions could not be read back: ${after.error.message}` }
  const status = new Map(((after.data ?? []) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]))
  const stillCurrent = priorIds.filter((id) => status.get(id) === 'current')
  if (status.get(stored.id) !== 'current' || stillCurrent.length > 0) {
    return { ok: true, row: stored, superseded: [], warning: 'Uploaded, but the earlier revision still reads as current. Reload and check which one the crew see.' }
  }
  return { ok: true, row: stored, superseded: priorIds }
}

/** Open a revision in the file viewer. False when it has no file or cannot be signed. */
export async function openProgramme(row: Pick<ProgrammeRow, 'storage_path' | 'revision' | 'name'>): Promise<boolean> {
  if (!row.storage_path) return false
  const url = await signedUrl(BUCKET_FILES, row.storage_path)
  if (!url) return false
  // The phone names it "<revision>.pdf"; the stored file's own extension is
  // kept here, so a photographed programme is not called a PDF.
  const ext = /\.[a-z0-9]+$/i.exec(row.storage_path)?.[0] ?? '.pdf'
  viewFile({ url, name: `${row.revision?.trim() || row.name}${ext}` })
  return true
}
