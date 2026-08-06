import type { VercelRequest, VercelResponse } from '@vercel/node'
import { advance, initialPhase, type DwellPhase } from '../src/geofence/dwell.js'
import type { JobSite, Ping } from '../src/types.js'
import { callerWorker, serviceClient } from './_supabase.js'

/**
 * Location ingest. A worker's phone POSTs here; the geofence engine runs on the
 * server and writes shifts.
 *
 * This deliberately does NOT run in the browser. Timesheets have to be produced
 * whether or not anyone has the dashboard open, and a client-side clock is
 * something a worker could tamper with. The same pure engine
 * (src/geofence/dwell.ts) runs in both places — the dashboard uses it for live
 * display, this endpoint is the system of record.
 */

interface Body {
  lat: number
  lng: number
  accuracyM?: number
  /** Client timestamp, ISO or epoch ms. Clamped — never trusted outright. */
  at?: string | number
}

const MAX_CLOCK_SKEW_MS = 5 * 60_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let worker
  try {
    worker = await callerWorker(req.headers.authorization)
  } catch (err) {
    console.error('[ping] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!worker) return res.status(401).json({ error: 'Not authenticated' })

  const body = req.body as Body
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' })
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng out of range' })
  }

  // A phone with a wrong clock must not be able to backdate or postdate a
  // shift, so client time is only honoured within a small window.
  const now = Date.now()
  const claimed = body.at ? new Date(body.at).getTime() : now
  const at = Number.isFinite(claimed) && Math.abs(claimed - now) <= MAX_CLOCK_SKEW_MS
    ? claimed
    : now

  const db = serviceClient()

  const { data: siteRows, error: sitesError } = await db
    .from('job_sites')
    .select('id, name, lat, lng, radius_m, status')
    .eq('company_id', worker.company_id)
    .neq('status', 'archived')

  if (sitesError) {
    console.error('[ping] sites query failed', sitesError)
    return res.status(500).json({ error: 'Could not load job sites' })
  }

  const sites: JobSite[] = (siteRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: '',
    jobType: '',
    status: row.status === 'starting_soon' ? 'starting_soon' : 'active',
    center: { lat: row.lat, lng: row.lng },
    radiusM: row.radius_m,
  }))

  const { data: stateRow } = await db
    .from('dwell_state')
    .select('phase')
    .eq('worker_id', worker.id)
    .maybeSingle()

  const phase = (stateRow?.phase as DwellPhase | undefined) ?? initialPhase

  const ping: Ping = {
    workerId: worker.id,
    at,
    lat,
    lng,
    accuracyM: Number(body.accuracyM) || 0,
  }

  const result = advance(phase, ping, sites)
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'site'
  const hhmm = (t: number) =>
    new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

  // Record the raw position regardless of what the engine decided.
  const { error: positionError } = await db.from('positions').insert({
    worker_id: worker.id,
    at: new Date(at).toISOString(),
    lat,
    lng,
    accuracy_m: ping.accuracyM,
  })
  if (positionError) console.error('[ping] position insert failed', positionError)

  for (const event of result.events) {
    if (event.kind === 'clock_in') {
      const { error } = await db.from('shifts').insert({
        company_id: worker.company_id,
        worker_id: worker.id,
        site_id: event.siteId,
        started_at: new Date(event.at).toISOString(),
        source: 'auto',
      })
      // The partial unique index rejects a second open shift; that means we
      // already have one and this is a duplicate delivery, which is fine.
      if (error && error.code !== '23505') {
        console.error('[ping] clock_in insert failed', error)
      }
    }

    if (event.kind === 'clock_out') {
      const { error } = await db
        .from('shifts')
        .update({ ended_at: new Date(event.at).toISOString() })
        .eq('worker_id', worker.id)
        .is('ended_at', null)
      if (error) console.error('[ping] clock_out update failed', error)
    }

    const message =
      event.kind === 'clock_in'
        ? `${worker.name} clocked in at ${siteName(event.siteId)} · ${hhmm(event.at)}`
        : event.kind === 'clock_out'
          ? `${worker.name} left ${siteName(event.siteId)} · clocked out ${hhmm(event.at)}`
          : `${worker.name} passed ${siteName(event.siteId)} ${hhmm(event.at)} — not clocked in (${Math.round(event.dwelledMs / 1000)}s on site)`

    await db.from('geofence_events').insert({
      company_id: worker.company_id,
      worker_id: worker.id,
      site_id: event.siteId,
      at: new Date(event.at).toISOString(),
      kind: event.kind,
      message,
    })

    // Mirror into the site's chat as a system message. Clock-ins threading
    // through the crew's conversation is what makes the chat feel like part of
    // the app rather than a bolt-on.
    const { data: channel } = await db
      .from('channels')
      .select('id')
      .eq('site_id', event.siteId)
      .eq('kind', 'site')
      .maybeSingle()

    if (channel) {
      await db.from('messages').insert({
        company_id: worker.company_id,
        channel_id: channel.id,
        author_id: null,
        kind: 'system',
        body: message,
      })
    }
  }

  const { error: stateError } = await db.from('dwell_state').upsert({
    worker_id: worker.id,
    phase: result.phase,
    updated_at: new Date().toISOString(),
  })
  if (stateError) console.error('[ping] dwell_state upsert failed', stateError)

  // The full phase goes back so the phone renders the authoritative dwell
  // countdown rather than a second, drifting one of its own.
  return res.status(200).json({
    ok: true,
    phase: result.phase,
    events: result.events.map((e) => ({ kind: e.kind, siteId: e.siteId, at: e.at })),
    sites: sites.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.center.lat,
      lng: s.center.lng,
      radiusM: s.radiusM,
    })),
  })
}
