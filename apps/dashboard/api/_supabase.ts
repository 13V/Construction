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

/** The calling worker, as the functions use them. */
export interface CallerWorker {
  id: string
  company_id: string
  name: string
  is_office: boolean
}

/**
 * Who is calling, or the answer that refuses them. A handler sends a refusal
 * as it is: `res.status(caller.status).json(caller.body)`.
 */
export type Caller =
  | { ok: true; worker: CallerWorker }
  | { ok: false; status: 401 | 403 | 500; body: { error: string; removed?: true } }

/**
 * What a worker the office has taken off the crew is told. `removed: true`
 * rides along in the body so an app can show its own screen for it rather
 * than match on the words.
 */
export const REMOVED_FROM_CREW = "You've been taken off this company's crew. Ask the office if that's a mistake."

const NOT_AUTHENTICATED: Caller = { ok: false, status: 401, body: { error: 'Not authenticated' } }

/**
 * Resolves the caller from their bearer token.
 *
 * A worker row with `active = false` is refused with a 403. That is what the
 * office's "take off the crew" sets, and what deleting an account sets
 * (delete_worker_account, schema_v39.sql). Their login can outlive it — the
 * office never touches auth.users — and every function here runs on the
 * service role, which RLS does not stop, so without this a removed worker
 * kept clocking in through /api/ping and drafting logs for the company.
 *
 * api/delete-account.ts deliberately does not come through here: a removed
 * worker must still be able to delete their own account.
 */
export async function callerWorker(authorization: string | undefined): Promise<Caller> {
  if (!authorization?.startsWith('Bearer ')) return NOT_AUTHENTICATED
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')

  const scoped = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error,
  } = await scoped.auth.getUser()
  if (error || !user) return NOT_AUTHENTICATED

  const { data: worker, error: lookupError } = await serviceClient()
    .from('workers')
    .select('id, company_id, name, is_office, active')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // A failed lookup is not the caller's fault and not a reason to tell them
  // they are signed out; it is worth asking again.
  if (lookupError) {
    console.error('[auth] worker lookup failed', lookupError)
    return { ok: false, status: 500, body: { error: 'Could not check your account. Try again in a moment.' } }
  }
  if (!worker) return NOT_AUTHENTICATED
  if (!worker.active) return { ok: false, status: 403, body: { error: REMOVED_FROM_CREW, removed: true } }

  return {
    ok: true,
    worker: { id: worker.id, company_id: worker.company_id, name: worker.name, is_office: worker.is_office },
  }
}
