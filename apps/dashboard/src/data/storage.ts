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
 * Cached per path for the session to avoid re-signing on every render.
 */
const signed = new Map<string, { url: string; until: number }>()

export async function signedUrl(bucket: string, path: string, seconds = 3600) {
  const key = `${bucket}/${path}`
  const hit = signed.get(key)
  if (hit && hit.until > Date.now() + 60_000) return hit.url

  const { data, error } = await supabase().storage.from(bucket).createSignedUrl(path, seconds)
  if (error || !data) return null
  signed.set(key, { url: data.signedUrl, until: Date.now() + seconds * 1000 })
  return data.signedUrl
}

export async function removeFile(bucket: string, path: string) {
  const { error } = await supabase().storage.from(bucket).remove([path])
  if (error) throw new Error(error.message)
}
