import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callerWorker, serviceClient } from './_supabase.js'
import { applyCors } from './_cors.js'

/**
 * Lone worker safety.
 *
 * A worker who is the only person on a site starts a session and says how
 * often they want to be asked whether they are all right. Answering rolls the
 * next question forward. Not answering, past a grace window, takes the session
 * to `overdue` and then to `alarm`, and the office is shown where they were
 * last seen. They can raise `sos` themselves at any point.
 *
 * Every write happens here under the service role and every time is stamped
 * here, never on the phone. A check-in log is the kind of record that gets
 * read out after somebody is hurt, and a device with a wrong clock — or a
 * worker who would rather the log said something else — must not be able to
 * shape it.
 *
 * Overdue is evaluated on read as well as on write. There is no cron in this
 * deployment, so a session that lapses while nobody is looking would otherwise
 * sit at `ok` until the next call. Deriving it from `due_at` on every touch
 * means the office dashboard, which polls, reaches the same answer a scheduler
 * would have. It is honest about its limit: nothing escalates while every
 * client is closed, which is why the office screen is the thing that watches.
 */

type Action = 'start' | 'check_in' | 'sos' | 'end' | 'resolve' | 'status'

interface Body {
  action?: Action
  intervalMin?: number
  graceMin?: number
  siteId?: string | null
  sessionId?: string
  lat?: number
  lng?: number
  accuracyM?: number
  note?: string
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** A session is late once it is past due, and an alarm once it is past due
 *  plus the grace it was given. Two steps rather than one so the worker sees
 *  "you are late" and gets a chance to answer before anyone is called. */
function derive(session: { due_at: string; grace_min: number; state: string }, now: number) {
  if (session.state === 'alarm' || session.state === 'ended') return session.state
  const due = new Date(session.due_at).getTime()
  if (now > due + session.grace_min * 60_000) return 'alarm'
  if (now > due) return 'overdue'
  return 'ok'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let worker
  try {
    worker = await callerWorker(req.headers.authorization)
  } catch (err) {
    console.error('[lone-worker] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!worker) return res.status(401).json({ error: 'Not authenticated' })

  const body = (req.body ?? {}) as Body
  const action: Action = body.action ?? 'status'
  const db = serviceClient()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  const lat = Number.isFinite(Number(body.lat)) ? Number(body.lat) : null
  const lng = Number.isFinite(Number(body.lng)) ? Number(body.lng) : null
  const accuracyM = Number.isFinite(Number(body.accuracyM)) ? Number(body.accuracyM) : null
  const hasFix = lat !== null && lng !== null

  const logEvent = async (
    sessionId: string,
    kind: 'started' | 'check_in' | 'overdue' | 'sos' | 'resolved' | 'ended',
    note?: string,
    actorId?: string,
  ) => {
    await db.from('lone_worker_events').insert({
      company_id: worker.company_id,
      session_id: sessionId,
      worker_id: worker.id,
      kind,
      at: nowIso,
      lat,
      lng,
      accuracy_m: accuracyM,
      note: note ?? null,
      actor_id: actorId ?? null,
    })
  }

  /** Alarms are shouted, not filed. The site channel is where the crew and
   *  the office already look, so that is where this goes. */
  const shout = async (siteId: string | null, message: string) => {
    if (!siteId) return
    const { data: channel } = await db
      .from('channels')
      .select('id')
      .eq('site_id', siteId)
      .eq('kind', 'site')
      .maybeSingle()
    if (!channel) return
    await db.from('messages').insert({
      company_id: worker.company_id,
      channel_id: channel.id,
      author_id: null,
      kind: 'system',
      body: message,
    })
  }

  // The caller's open session, if any, with its state brought up to date.
  const openSession = async () => {
    const { data } = await db
      .from('lone_worker_sessions')
      .select('*')
      .eq('worker_id', worker.id)
      .is('ended_at', null)
      .maybeSingle()
    if (!data) return null
    const state = derive(data, now)
    if (state !== data.state) {
      await db.from('lone_worker_sessions').update({ state }).eq('id', data.id)
      // Record the crossing once, not on every poll that sees it.
      if (state === 'overdue' || state === 'alarm') {
        await db.from('lone_worker_events').insert({
          company_id: worker.company_id,
          session_id: data.id,
          worker_id: worker.id,
          kind: 'overdue',
          at: nowIso,
          lat: data.last_lat,
          lng: data.last_lng,
          note: state === 'alarm' ? 'No answer past the grace window' : 'Check-in missed',
        })
      }
      if (state === 'alarm') {
        await shout(
          data.site_id,
          `SAFETY ALARM — ${worker.name} was working alone and has not answered a check-in. Last seen ${
            data.last_fix_at ? new Date(data.last_fix_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' }) : 'position unknown'
          }.`,
        )
      }
      return { ...data, state }
    }
    return data
  }

  try {
    if (action === 'status') {
      return res.status(200).json({ ok: true, session: await openSession() })
    }

    if (action === 'start') {
      const existing = await openSession()
      if (existing) return res.status(409).json({ error: 'You already have a lone worker session running.' })

      const intervalMin = clampInt(body.intervalMin, 5, 240, 60)
      const graceMin = clampInt(body.graceMin, 1, 60, 5)
      const { data, error } = await db
        .from('lone_worker_sessions')
        .insert({
          company_id: worker.company_id,
          worker_id: worker.id,
          site_id: body.siteId ?? null,
          interval_min: intervalMin,
          grace_min: graceMin,
          due_at: new Date(now + intervalMin * 60_000).toISOString(),
          state: 'ok',
          last_lat: lat,
          last_lng: lng,
          last_fix_at: hasFix ? nowIso : null,
        })
        .select()
        .single()
      if (error || !data) {
        console.error('[lone-worker] start failed', error)
        return res.status(500).json({ error: 'Could not start the session' })
      }
      await logEvent(data.id, 'started')
      await shout(data.site_id, `${worker.name} is working alone, checking in every ${intervalMin} minutes.`)
      return res.status(200).json({ ok: true, session: data })
    }

    const session = await openSession()
    if (!session && action !== 'resolve') {
      return res.status(409).json({ error: "You don't have a lone worker session running." })
    }

    if (action === 'check_in') {
      const dueAt = new Date(now + session!.interval_min * 60_000).toISOString()
      const { data, error } = await db
        .from('lone_worker_sessions')
        .update({
          due_at: dueAt,
          state: 'ok',
          last_lat: hasFix ? lat : session!.last_lat,
          last_lng: hasFix ? lng : session!.last_lng,
          last_fix_at: hasFix ? nowIso : session!.last_fix_at,
        })
        .eq('id', session!.id)
        .select()
        .single()
      if (error) {
        console.error('[lone-worker] check_in failed', error)
        return res.status(500).json({ error: 'Could not record your check-in' })
      }
      await logEvent(session!.id, 'check_in')
      return res.status(200).json({ ok: true, session: data })
    }

    if (action === 'sos') {
      const { data, error } = await db
        .from('lone_worker_sessions')
        .update({
          state: 'alarm',
          last_lat: hasFix ? lat : session!.last_lat,
          last_lng: hasFix ? lng : session!.last_lng,
          last_fix_at: hasFix ? nowIso : session!.last_fix_at,
        })
        .eq('id', session!.id)
        .select()
        .single()
      if (error) {
        console.error('[lone-worker] sos failed', error)
        return res.status(500).json({ error: 'Could not raise the alarm' })
      }
      await logEvent(session!.id, 'sos', body.note)
      await shout(session!.site_id, `SOS — ${worker.name} has raised an alarm and needs help now.`)
      return res.status(200).json({ ok: true, session: data })
    }

    if (action === 'end') {
      const { error } = await db
        .from('lone_worker_sessions')
        .update({ ended_at: nowIso, state: 'ended' })
        .eq('id', session!.id)
      if (error) {
        console.error('[lone-worker] end failed', error)
        return res.status(500).json({ error: 'Could not end the session' })
      }
      await logEvent(session!.id, 'ended')
      await shout(session!.site_id, `${worker.name} has finished working alone and is safe.`)
      return res.status(200).json({ ok: true, session: null })
    }

    if (action === 'resolve') {
      if (!worker.is_office) return res.status(403).json({ error: 'Only office staff can resolve an alarm.' })
      const id = body.sessionId
      if (!id) return res.status(400).json({ error: 'sessionId is required' })
      const { error } = await db
        .from('lone_worker_sessions')
        .update({ ended_at: nowIso, state: 'ended' })
        .eq('id', id)
        .eq('company_id', worker.company_id)
      if (error) {
        console.error('[lone-worker] resolve failed', error)
        return res.status(500).json({ error: 'Could not resolve the alarm' })
      }
      await db.from('lone_worker_events').insert({
        company_id: worker.company_id,
        session_id: id,
        worker_id: worker.id,
        kind: 'resolved',
        at: nowIso,
        note: body.note ?? null,
        actor_id: worker.id,
      })
      return res.status(200).json({ ok: true, session: null })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    console.error('[lone-worker] unexpected', err)
    return res.status(500).json({ error: 'Something went wrong' })
  }
}
