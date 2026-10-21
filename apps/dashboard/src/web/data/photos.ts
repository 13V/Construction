/**
 * A job's photos: which rows they are, the day each is filed under, the
 * on-site mark, and the three writes (add one from the desk, flag one as an
 * issue, delete one).
 *
 * Everything that decides what a crew member sees is the phone's own, pinned
 * to the phone's source by photos.test.ts:
 *  - the read: PhotoGrid's query in worker/simple/Job.tsx (every site_files
 *    row on the job of kind 'photo', newest made first). The phone stops at
 *    the newest 60; a desk reads them all, a page at a time.
 *  - the on-site mark: Job.tsx onSite, word for word ("On site", "Away from
 *    site", "No location"), measured from the job's pin and fence radius as
 *    they are now.
 *  - adding a photo: PhotoScreen's upload in worker/WorkerApp.tsx. The same
 *    bucket, the same <company>/<job>/<uuid>-<name> path (objectPath), the
 *    same row and the same "what is this?" categories. taken_at is the
 *    moment the photo was added, which is when the phone stamps one too.
 *    lat and lng stay empty: where the shutter went is something only the
 *    crew's phone can say.
 *  - flag as an issue and delete: PhotoViewer's two writes, the same calls.
 *    Delete takes the row only, as the phone's does: the stored file can be
 *    named by other records (a waterproofing photo keeps its own copy of the
 *    path), so it stays.
 *
 * One deliberate difference: the day a photo is filed under. The phone slices
 * the date off taken_at as the database sends it, which is UTC, so a photo
 * taken before 10:30 am in Adelaide lands under the day before. The website
 * files it under the local calendar day it was taken on (groupByDay).
 *
 * Every write is read back. RLS turns a refused UPDATE or DELETE into a
 * success with no rows; that reads here as refused, never as done.
 */
import { BUCKET_FILES, distanceM, objectPath, removeFile, supabase, uploadFile, type JobSiteRow, type SiteFileRow, type WorkerRow } from '../phone'
import { sizeLabel } from './drawings'

/** The Supabase client. Every call takes an optional one, so a test can pass a fake. */
export type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

/**
 * A photo: a site_files row as the phone reads it ('*'), with the columns
 * later migrations added. A waterproofing step's photo is on the job's
 * Photos tab too (the phone's read does not leave it out); it carries the
 * package and the step.
 */
export type Photo = SiteFileRow & {
  selection_id?: string | null
  waterproofing_package_id?: string | null
  wp_step?: string | null
}

export type WriteResult<T> = { ok: true; value: T } | { ok: false; message: string }

// ------------------------------------------------------------------ reading

/** The phone reads the newest 60 (PhotoGrid's .limit(60)). A desk reads every photo, this many at a time. */
export const PHOTO_PAGE = 1000

/** Pages read before giving up: a hundred thousand photos on one job. */
const MAX_PAGES = 100

/**
 * Every photo on a job, newest made first, read as the phone's Photos tab
 * reads them. Ties on created_at are broken by id, so the pages cannot
 * overlap or skip; a photo added while the pages are read moves every later
 * row down one, so a row that turns up twice is kept once. Throws when the
 * read fails.
 */
export async function loadPhotos(siteId: string, client?: Db): Promise<Photo[]> {
  const c = db(client)
  const out: Photo[] = []
  const seen = new Set<string>()
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PHOTO_PAGE
    const { data, error } = await c
      .from('site_files')
      .select('*')
      .eq('site_id', siteId)
      .eq('kind', 'photo')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PHOTO_PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Photo[]
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
    if (rows.length < PHOTO_PAGE) break
  }
  return out
}

/**
 * Everyone in the company by id, for saying who took a photo. crew_v is the
 * crew list everything reads; it keeps people who have left (active false),
 * so their photos still carry their names.
 */
export async function loadNames(client?: Db): Promise<Map<string, string>> {
  const { data, error } = await db(client).from('crew_v').select('id, name')
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]))
}

// ------------------------------------------------------------- who and where

/**
 * Who took a photo, in the words the tile and the viewer show. The phone
 * says "You" or "Crew"; a desk has room for the name. A photo whose taker
 * has since been deleted from the company has nobody (uploaded_by goes null).
 */
export function whoOf(uploadedBy: string | null, meId: string, names: ReadonlyMap<string, string>): string {
  if (!uploadedBy) return 'Former crew member'
  if (uploadedBy === meId) return 'You'
  return names.get(uploadedBy) ?? 'Crew'
}

/**
 * Was the phone inside the fence when the shutter went? Null, not false,
 * when the photo carries no coordinates: "we don't know" and "they weren't
 * there" are different claims to put beside somebody's name. The phone's
 * rule (Job.tsx onSite), measured against the job's pin and radius.
 */
export function onSite(file: Pick<Photo, 'lat' | 'lng'>, site: Pick<JobSiteRow, 'lat' | 'lng' | 'radius_m'>): boolean | null {
  if (file.lat === null || file.lng === null) return null
  return distanceM({ lat: Number(file.lat), lng: Number(file.lng) }, { lat: site.lat, lng: site.lng }) <= site.radius_m
}

/** The phone's words for the mark (PhotoViewer). */
export const markWords = (here: boolean | null) => (here === true ? 'On site' : here === false ? 'Away from site' : 'No location')

/** How far from the job's pin a photo was taken, in metres; null with no coordinates. */
export function metresFromPin(file: Pick<Photo, 'lat' | 'lng'>, site: Pick<JobSiteRow, 'lat' | 'lng'>): number | null {
  if (file.lat === null || file.lng === null) return null
  return distanceM({ lat: Number(file.lat), lng: Number(file.lng) }, { lat: site.lat, lng: site.lng })
}

/** "4 m", "150 m", "1.2 km", "35 km". */
export function distanceWords(m: number): string {
  if (m < 100) return `${Math.max(1, Math.round(m))} m`
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  const km = m / 1000
  return `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} km`
}

// ---------------------------------------------------------------- days and times

const LOCALE = 'en-AU'

/**
 * When a photo was taken. Every photo the phone takes carries taken_at; one
 * filed without it (a waterproofing step's photo) goes by when it was filed.
 */
export const takenOf = (p: Pick<Photo, 'taken_at' | 'created_at'>) => p.taken_at ?? p.created_at

/** The local calendar day an instant falls on, as YYYY-MM-DD. */
export function localDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface PhotoDay<T> {
  /** The local day, YYYY-MM-DD. */
  day: string
  photos: T[]
}

/**
 * The photos by the day they were taken, newest day first, and newest first
 * within a day: the phone's grouping, filed under the day where they were
 * taken rather than the phone's UTC day (see the top of this file).
 */
export function groupByDay<T extends Pick<Photo, 'id' | 'taken_at' | 'created_at'>>(photos: ReadonlyArray<T>): Array<PhotoDay<T>> {
  const ms = (iso: string) => new Date(iso).getTime()
  const sorted = [...photos].sort((a, b) => ms(takenOf(b)) - ms(takenOf(a)) || ms(b.created_at) - ms(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  const out: Array<PhotoDay<T>> = []
  for (const p of sorted) {
    const day = localDay(takenOf(p))
    const last = out[out.length - 1]
    if (last && last.day === day) last.photos.push(p)
    else out.push({ day, photos: [p] })
  }
  return out
}

/**
 * A day's heading: "Today · Wed 21 Oct", "Tue 20 Oct", the phone's words
 * (Job.tsx dayLabel; the website's label style sets them in capitals, as the
 * phone does). A day in another year says which.
 */
export function dayHeading(day: string, now = new Date()): string {
  const d = new Date(`${day}T00:00:00`)
  const words = d
    .toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
    .replace(',', '')
  return day === localDay(now) ? `Today · ${words}` : words
}

/** "7:32 am", as the phone writes a time (Job.tsx timeOf). */
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

/** "Today, 7:32 am" or "12 Aug, 7:32 am": the phone's viewer line (Job.tsx takenLabel), with the year when it is not this one. */
export function whenWords(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day =
    d.toDateString() === now.toDateString()
      ? 'Today'
      : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return `${day}, ${timeOf(iso)}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The line under the heading: "24 photos · 3 areas · 1 flagged as an issue".
 * The phone's count line (photos, and areas: the different captions), and
 * the issues, which a desk is asked about first.
 */
export function photosSummary(photos: ReadonlyArray<Pick<Photo, 'caption' | 'category'>>): string {
  if (photos.length === 0) return 'No photos yet'
  const areas = new Set(photos.map((p) => p.caption).filter(Boolean)).size
  const issues = photos.filter((p) => p.category === 'issue').length
  return [plural(photos.length, 'photo'), areas ? plural(areas, 'area') : null, issues ? `${issues} flagged as ${issues === 1 ? 'an issue' : 'issues'}` : null].filter(Boolean).join(' · ')
}

// ------------------------------------------------------------------ adding

/** What the phone asks of a photo before it goes up ("WHAT IS THIS?" in WorkerApp.tsx PhotoScreen), in its order. */
export const PHOTO_CATEGORIES = ['progress', 'issue', 'before', 'after', 'inspection'] as const
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]
export const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  progress: 'Progress',
  issue: 'Issue',
  before: 'Before',
  after: 'After',
  inspection: 'Inspection',
}
/** The phone's starting answer. */
export const DEFAULT_CATEGORY: PhotoCategory = 'progress'

/** The bucket's own limit (storage.sql). The phone leaves it to the bucket; the website says it before sending. */
export const PHOTO_MAX_BYTES = 25 * 1024 * 1024

/**
 * What the file chooser offers: any image, and an iPhone's HEIC original by
 * name (Windows often gives it no type), so choosing one gets photoRefusal's
 * answer rather than a greyed-out file nobody can explain.
 */
export const PHOTO_PICKER_ACCEPT = 'image/*,.heic,.heif'

/**
 * What actually goes up: photos every browser and every phone can show. The
 * phone's camera only ever hands over a JPEG; a desk can be offered anything,
 * and a HEIC original or a TIFF would sit on the job as a tile nobody can open.
 */
const SHOWABLE = /^image\/(jpe?g|pjpeg|png|webp|gif)$/i
const SHOWABLE_NAME = /\.(jpe?g|png|webp|gif)$/i

/** Why a file cannot go up, in words, before anything is sent; null when it can. */
export function photoRefusal(file: { name: string; size: number; type: string }): string | null {
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) {
    return `${file.name} is an iPhone HEIC photo, which most computers cannot show. Save it as a JPEG first (on a Mac, open it in Preview and choose File, Export, JPEG) and add that.`
  }
  const typeless = !file.type || file.type === 'application/octet-stream'
  if (!(SHOWABLE.test(file.type) || (typeless && SHOWABLE_NAME.test(file.name)))) {
    return `${file.name} is not a photo this takes. Add JPEG, PNG, WebP or GIF images.`
  }
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > PHOTO_MAX_BYTES) {
    // "25 MB, over the 25 MB limit" says nothing, so a file only just over gives no size.
    const size = sizeLabel(file.size)
    return `${file.name} is ${size === sizeLabel(PHOTO_MAX_BYTES) ? '' : `${size}, `}over the ${sizeLabel(PHOTO_MAX_BYTES)} limit. Add a smaller copy.`
  }
  return null
}

/**
 * The site_files row for a photo, exactly as the phone's PhotoScreen inserts
 * one (WorkerApp.tsx upload()): the same columns in the same order, the
 * category it was given, a blank caption as null, and taken_at the moment
 * it was added. lat and lng are null: the phone fills them from its own GPS
 * fix at the shutter, which a desk does not have.
 */
export function photoInsert({
  me,
  siteId,
  file,
  path,
  category,
  caption,
  takenAt,
}: {
  me: Pick<WorkerRow, 'id' | 'company_id'>
  siteId: string
  file: { name: string; type: string; size: number }
  path: string
  category: PhotoCategory
  caption: string
  /** When it was added, as the phone's capturedAt: the moment the file was picked. */
  takenAt: string
}) {
  return {
    company_id: me.company_id,
    site_id: siteId,
    uploaded_by: me.id,
    kind: 'photo' as const,
    storage_path: path,
    name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    category,
    caption: caption.trim() || null,
    lat: null,
    lng: null,
    taken_at: takenAt,
  }
}

/** A storage or database error, said so a person knows what to do next. */
export function problemWords(message: string): string {
  if (/failed to fetch|networkerror|load failed|network request failed|timed? ?out/i.test(message)) return 'the connection dropped. Check the internet and try again.'
  if (/row-level security|permission denied|not allowed|unauthori[sz]ed|forbidden/i.test(message)) return 'the database refused it. Reload the page and try again.'
  if (/maximum allowed size|payload too large|entity too large/i.test(message)) return 'it is over the 25 MB limit.'
  return message.replace(/\.$/, '')
}

/**
 * Put one photo on a job, as the phone does: the file under
 * <company>/<job>/, then the row, read back as stored. A file over 25 MB, or
 * one a browser cannot show, is refused before anything is sent. If the row
 * cannot be written, the file just sent is taken back out of storage, so a
 * failed photo leaves nothing behind.
 */
export async function uploadPhoto(
  {
    me,
    siteId,
    file,
    category = DEFAULT_CATEGORY,
    caption = '',
    takenAt = new Date().toISOString(),
  }: { me: Pick<WorkerRow, 'id' | 'company_id'>; siteId: string; file: File; category?: PhotoCategory; caption?: string; takenAt?: string },
  client?: Db,
): Promise<WriteResult<Photo>> {
  const refusal = photoRefusal(file)
  if (refusal) return { ok: false, message: refusal }
  const c = db(client)

  const path = objectPath(me.company_id, siteId, file.name)
  try {
    await uploadFile(BUCKET_FILES, path, file)
  } catch (e) {
    return { ok: false, message: `Not added: ${problemWords(e instanceof Error ? e.message : String(e))}` }
  }

  const row = photoInsert({ me, siteId, file, path, category, caption, takenAt })
  const { data, error } = await c.from('site_files').insert(row).select('*').single()
  const stored = data as Photo | null
  const matches = !!stored && stored.storage_path === path && stored.kind === 'photo' && stored.site_id === siteId && stored.uploaded_by === me.id
  if (error || !matches) {
    await removeFile(BUCKET_FILES, path).catch(() => {})
    return { ok: false, message: `Not added: ${error ? problemWords(error.message) : 'the photo did not read back as saved. Try again.'}` }
  }
  return { ok: true, value: stored }
}

// ------------------------------------------------------- flagging and deleting

/**
 * Flag a photo as an issue: the phone's write (PhotoViewer flag()), its
 * category set to 'issue', read back. A photo already flagged is left
 * alone, as on the phone, whose button is not there for one.
 */
export async function flagPhoto(photo: Pick<Photo, 'id' | 'category'>, client?: Db): Promise<WriteResult<{ id: string; category: string }>> {
  if (photo.category === 'issue') return { ok: true, value: { id: photo.id, category: 'issue' } }
  const { data, error } = await db(client).from('site_files').update({ category: 'issue' }).eq('id', photo.id).select('id,category')
  if (error) return { ok: false, message: `Not flagged: ${problemWords(error.message)}` }
  const back = ((data ?? []) as Array<{ id: string; category: string | null }>)[0]
  if (!back) return { ok: false, message: 'Not flagged: the database did not save it. The photo may have been deleted. Reload to check.' }
  if (back.category !== 'issue') return { ok: false, message: 'Not flagged: the photo did not read back as an issue. Reload and try again.' }
  return { ok: true, value: { id: back.id, category: 'issue' } }
}

export type DeleteResult = { ok: true; value: { id: string } } | { ok: false; message: string; /** Not deleted by this, but not on the job either. */ gone?: boolean }

/**
 * Delete a photo: the phone's write (PhotoViewer remove()), the row and
 * nothing else, read back. Deleting is the office's (site_files_office_write);
 * a refusal comes back as no rows, which reads here as not deleted, and a
 * second read says whether it was refused or already gone.
 */
export async function deletePhoto(photo: Pick<Photo, 'id'>, client?: Db): Promise<DeleteResult> {
  const c = db(client)
  const { data, error } = await c.from('site_files').delete().eq('id', photo.id).select('id')
  if (error) return { ok: false, message: `Not deleted: ${problemWords(error.message)}` }
  if (!data || data.length === 0) {
    const { data: still, error: checkErr } = await c.from('site_files').select('id').eq('id', photo.id)
    if (!checkErr && still && still.length === 0) return { ok: false, gone: true, message: 'That photo had already been deleted, on another screen or a phone.' }
    return { ok: false, message: 'Not deleted: only the office can remove photos, and the database refused it.' }
  }
  const { data: still, error: checkErr } = await c.from('site_files').select('id').eq('id', photo.id)
  if (checkErr) return { ok: true, value: { id: photo.id } }
  if (still && still.length > 0) return { ok: false, message: 'Not deleted: the photo still reads back on the job. Reload and try again.' }
  return { ok: true, value: { id: photo.id } }
}
