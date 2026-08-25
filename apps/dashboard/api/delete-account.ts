import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { serviceClient } from './_supabase.js'
import { applyCors } from './_cors.js'

/**
 * Account deletion — App Store Guideline 5.1.1(v): an app that lets someone
 * create an account must let them delete it from inside the app.
 *
 * This is two irreversible operations in a specific order, not one:
 *
 *   1. delete_worker_account() (schema_v23.sql) marks the worker inactive
 *      and purges their raw location history, in the database, while their
 *      login still works. If this fails, nothing has happened yet and the
 *      request can simply be retried.
 *
 *   2. Only once (1) has committed do we delete auth.users via the admin
 *      API. That is the point of no return — it is also what makes this
 *      endpoint need the service role at all, since deleting another user's
 *      login is not something any anon or authenticated key can do, and it
 *      is not a plain table row a client library reaches with `.delete()`.
 *
 * Doing it in the other order would be worse than doing nothing: if the
 * login vanished first and the database step then failed, the worker would
 * be locked out with no working bearer token to retry with, and no route
 * back in — a self-service delete that quietly turns into "contact support".
 *
 * NOTE for whoever wires up CORS across /api: this handler needs the same
 * applyCors() treatment as bootstrap.ts, ping.ts etc. — it isn't skipped
 * here, just written the same way they are so it slots into that pass.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Server not configured' })
  }

  const authorization = req.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  // Deliberately not callerWorker() (_supabase.ts): that helper drops the
  // caller's auth user id and role, and this endpoint needs both — the id to
  // delete the login, the role to know whether the sole-owner rule applies.
  const scoped = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user },
    error: authError,
  } = await scoped.auth.getUser()
  if (authError || !user) return res.status(401).json({ error: 'Not authenticated' })

  const db = serviceClient()

  const { data: worker, error: workerError } = await db
    .from('workers')
    .select('id, role, company_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (workerError) {
    console.error('[delete-account] worker lookup failed', workerError)
    return res.status(500).json({ error: 'Could not look up your account. Try again, or contact support.' })
  }

  // A login with no linked worker row (bootstrap never finished, or the row
  // was already unlinked some other way) has no company data to clean up —
  // but the login itself still needs to go, or the account "delete" did
  // nothing at all from the one perspective that matters to the person who
  // asked for it.
  /*
   * The sole owner of a company is the one person the guard below refuses, and
   * they are also the person most likely to be testing that account deletion
   * works at all — App Review included, since the demo account is a company of
   * one owner. "You cannot delete this account" is not an answer Guideline
   * 5.1.1(v) accepts.
   *
   * So they get the honest option instead of a wall: for a one-owner business
   * the account and the company are the same thing, and deleting one deletes
   * the other. The client asks for it explicitly (it makes the caller type the
   * company's name first), because this removes every job, invoice,
   * certificate and photo the company has, for everybody in it, with no undo.
   */
  const alsoDeleteCompany = req.body?.deleteCompany === true

  if (worker) {
    const { error: rpcError } = await db.rpc('delete_worker_account', { p_worker_id: worker.id })
    if (rpcError) {
      if (rpcError.message === 'sole_owner' && alsoDeleteCompany) {
        // Every table hangs off company_id with a cascading delete, so this is
        // the whole tenant. Done before the login is removed, so a failure
        // here leaves a caller who can still sign in and try again.
        const { error: companyError } = await db.from('companies').delete().eq('id', worker.company_id)
        if (companyError) {
          console.error('[delete-account] company delete failed', companyError)
          return res.status(500).json({ error: 'Could not delete the company. Try again, or contact support.' })
        }
      } else if (rpcError.message === 'sole_owner') {
        return res.status(409).json({
          error:
            "You're the only owner of this company, so deleting your account on its own would leave nobody able to see pay rates, invoices or contracts. Either make somebody else an owner first — Me, then Your crew — or delete the company along with your account.",
          soleOwner: true,
        })
      } else {
        console.error('[delete-account] worker cleanup failed', rpcError)
        return res.status(500).json({ error: 'Could not delete your account. Try again, or contact support.' })
      }
    }
  }

  const { error: deleteAuthError } = await db.auth.admin.deleteUser(user.id)
  if (deleteAuthError) {
    console.error('[delete-account] auth user delete failed', deleteAuthError)
    // The database side already committed (or was already done on a prior
    // attempt) — the login is still live, so simply asking again works.
    return res.status(500).json({
      error: 'Your records were updated but we could not remove your login. Try again, or contact support.',
    })
  }

  return res.status(200).json({ ok: true })
}
