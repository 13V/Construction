import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase clients.
 *
 * `serviceClient` bypasses RLS — it is the only thing allowed to write shifts
 * and dwell state, and it must never be constructed in browser code. The key
 * lives in SUPABASE_SERVICE_ROLE_KEY with no VITE_ prefix precisely so Vite
 * cannot bundle it.
 */

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY

export function serviceClient(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Resolves the caller from their bearer token. Returns null if unauthenticated. */
export async function callerWorker(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return null
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')

  const scoped = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error,
  } = await scoped.auth.getUser()
  if (error || !user) return null

  const { data: worker } = await serviceClient()
    .from('workers')
    .select('id, company_id, name, is_office')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  return worker ?? null
}
