import { supabase } from './supabase'

/**
 * Supabase Storage helpers.
 *
 * Objects are keyed `<company_id>/<site_id>/<uuid>-<name>`. The leading folder
 * is what the storage RLS policies check, so the company id in the path is
 * load-bearing — not just organisation.
 */

export const BUCKET_FILES = 'site-files'
export const BUCKET_RECEIPTS = 'receipts'

const safeName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)

export function objectPath(companyId: string, siteId: string, fileName: string) {
  return `${companyId}/${siteId}/${crypto.randomUUID()}-${safeName(fileName)}`
}

export async function uploadFile(
  bucket: string,
  path: string,
  file: File | Blob,
  contentType?: string,
) {
  const { error } = await supabase()
    .storage.from(bucket)
    .upload(path, file, { contentType: contentType ?? (file as File).type, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/**
 * Buckets are private, so rendering an image needs a short-lived signed URL.
 *
 * A link of an hour or less is for showing something on this screen now, so
 * it is cached for the session, per file and per lifetime, and handed out
 * again while it has more than a minute left: an image is not re-signed (and
 * re-downloaded under a new address) on every render.
 *
 * A longer link is for handing to somebody else, like the 14-day link in a
 * certificate or SWMS email, and it has to last its whole lifetime from the
 * moment it is handed over. So it is never cached. It used to share the
 * cache with the hour-long links, by file only: open a certificate, then
 * email it, and the email promised 14 days on a link that died within the
 * hour.
 */
const signed = new Map<string, { url: string; until: number }>()

/** The longest link the cache keeps. */
export const SIGNED_CACHE_MAX_SECONDS = 3600

export async function signedUrl(bucket: string, path: string, seconds = 3600) {
  const cacheable = seconds <= SIGNED_CACHE_MAX_SECONDS
  const key = `${bucket}/${path}@${seconds}`
  const hit = cacheable ? signed.get(key) : undefined
  if (hit && hit.until > Date.now() + 60_000) return hit.url

  const { data, error } = await supabase().storage.from(bucket).createSignedUrl(path, seconds)
  if (error || !data) return null
  if (cacheable) signed.set(key, { url: data.signedUrl, until: Date.now() + seconds * 1000 })
  return data.signedUrl
}

export async function removeFile(bucket: string, path: string) {
  const { error } = await supabase().storage.from(bucket).remove([path])
  if (error) throw new Error(error.message)
}
