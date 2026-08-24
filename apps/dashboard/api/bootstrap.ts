import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { serviceClient } from './_supabase.js'
import { applyCors } from './_cors.js'

/**
 * First-run setup. Creates a company and links the signed-up user to an office
 * worker row — without that row every RLS policy denies, so a fresh account
 * would see nothing at all.
 *
 * Runs with the service role because the caller has no company yet, and so no
 * policy can grant them the insert.
 */

const initialsFor = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '??'

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

  // Idempotent: a retried request must not create a second company.
  const { data: existing } = await db
    .from('workers')
    .select('id, company_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (existing) {
    return res.status(200).json({ ok: true, workerId: existing.id, existing: true })
  }

  /*
   * Someone the office already added claims their row rather than starting a
   * new company. This is how crew join — no invite tokens to manage.
   *
   * The claim is on the email alone, so it MUST NOT happen until Supabase has
   * confirmed the address. Otherwise anyone who knows a crew member's email
   * can sign up as them and take the row — with their pay rate, their
   * timesheets, and the ability to file corrections in their name.
   *
   * This is checked here rather than relying on the project's autoconfirm
   * setting, because that setting is one toggle away from being wrong and
   * this endpoint is the thing that actually hands over the record.
   */
  if (user.email && !user.email_confirmed_at) {
    return res.status(403).json({
      error: 'Confirm your email address first — check your inbox for the link.',
    })
  }

  if (user.email) {
    const { data: invited } = await db
      .from('workers')
      .select('id, company_id')
      .ilike('invite_email', user.email)
      .is('auth_user_id', null)
      .maybeSingle()

    if (invited) {
      const { error: linkError } = await db
        .from('workers')
        .update({ auth_user_id: user.id, invite_email: null })
        .eq('id', invited.id)
      if (linkError) {
        console.error('[bootstrap] invite link failed', linkError)
        return res.status(500).json({ error: 'Could not link your invitation' })
      }
      return res.status(200).json({ ok: true, workerId: invited.id, joined: true })
    }
  }

  /*
   * The request body is the first-run path, where the browser still has both
   * strings in hand. User metadata is the second: with email confirmation on,
   * signUp() returns no session, so the app cannot call this endpoint at that
   * moment and instead stores what was typed on the account itself. When the
   * person comes back from their inbox and signs in, that is all there is
   * left of what they told us — so read it here rather than refusing them.
   */
  const meta = (user.user_metadata ?? {}) as { company_name?: unknown; full_name?: unknown }
  const companyName = String(req.body?.companyName ?? meta.company_name ?? '').trim()
  const name = String(req.body?.name ?? meta.full_name ?? '').trim()
  if (!companyName || !name) {
    // Not an error worth a stack trace: somebody signed up expecting to be
    // invited and nobody has added them yet.
    return res.status(404).json({ error: 'no_pending_company' })
  }

  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name: companyName })
    .select('id')
    .single()
  if (companyError || !company) {
    console.error('[bootstrap] company insert failed', companyError)
    return res.status(500).json({ error: 'Could not create the company' })
  }

  const { data: worker, error: workerError } = await db
    .from('workers')
    .insert({
      company_id: company.id,
      auth_user_id: user.id,
      name,
      initials: initialsFor(name),
      trade: 'Office',
      is_office: true,
      /*
       * No `rate`. schema_v24 dropped that column — a worker holding their own
       * token could read everyone's pay off the crew list — and moved wages to
       * worker_pay, which a trigger now populates on insert. This endpoint was
       * never updated, so every attempt to create a company since that
       * migration failed on an unknown column and returned a 500. Signing up
       * as a new business has been broken outright, and it went unnoticed
       * because the only tenant anybody exercised was the demo, which is
       * seeded straight into the database and never calls this.
       *
       * The role is written explicitly rather than left to workers_sync_role
       * to infer from is_office. The trigger does infer it correctly today,
       * but the founder of a company being its owner is not a detail to leave
       * as a side effect of a boolean — delete_worker_account()'s guard on the
       * last remaining owner is what stands between one wrong tap and an
       * orphaned company.
       */
      role: 'owner',
    })
    .select('id')
    .single()

  if (workerError || !worker) {
    console.error('[bootstrap] worker insert failed', workerError)
    // Don't strand an orphan company if the second insert fails.
    await db.from('companies').delete().eq('id', company.id)
    return res.status(500).json({ error: 'Could not create your user record' })
  }

  return res.status(200).json({ ok: true, companyId: company.id, workerId: worker.id })
}
