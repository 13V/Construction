import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { serviceClient } from './_supabase'

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

  // Someone the office already added claims their row rather than starting a
  // new company. This is how crew join — no invite tokens to manage.
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

  const companyName = String(req.body?.companyName ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  if (!companyName || !name) {
    return res.status(400).json({ error: 'companyName and name are required' })
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
      rate: 0,
      is_office: true,
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
