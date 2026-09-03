import type { VercelRequest, VercelResponse } from '@vercel/node'
import { advance, initialPhase, siteContaining, type DwellPhase } from '../src/geofence/dwell.js'
import type { JobSite, Ping } from '../src/types.js'
import { callerWorker, serviceClient } from './_supabase.js'
import { applyCors } from './_cors.js'

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
  /**
   * "Clock in manually" button in the worker app. Only the literal boolean
   * `true` engages the manual path — a truthy string or 1 must not, or a
   * client bug that mis-serialises the flag would silently switch every
   * worker onto the no-dwell path.
   */
  manual?: boolean
  /**
   * The clock-out half. Normally a shift closes because the phone left the
   * site and iOS reported the crossing. This is what closes it when that did
   * not happen — an exit event that never fired leaves a worker on the clock
   * overnight, and nothing else in the app can end it.
   */
  manualOut?: boolean
}

const MAX_CLOCK_SKEW_MS = 5 * 60_000
const SITE_TIME_ZONE = 'Australia/Adelaide'

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
    // The geofence engine only needs geometry; the commercial columns are
    // not selected above and must not be invented here.
    budget: null,
    contractValue: null,
    clientName: null,
    progressPct: null,
    scheduleNote: null,
  }))

  // "Clock in manually" bypasses the two-minute dwell, nothing else. The
  // server is still the one deciding whether the worker is on site — a phone
  // that lies about its coordinates gets refused exactly as it would on an
  // automatic ping, and this branch never reads or trusts anything the client
  // says about which site it's at. Handled entirely separately from the
  // dwell engine below so the automatic path — the one running for every
  // worker who never touches the button — is untouched by this feature.
  // Deliberately NOT refused off site. A worker taps this as they leave, or in
  // the ute a street away, and refusing them for having stepped past the
  // boundary would strand exactly the open shift this exists to close. The
  // position is still recorded, so the office can see where the tap happened.
  if (body?.manualOut === true) {
    const { error: positionError } = await db.from('positions').insert({
      worker_id: worker.id,
      at: new Date(at).toISOString(),
      lat,
      lng,
      accuracy_m: Number.isFinite(Number(body?.accuracyM)) ? Number(body.accuracyM) : null,
    })
    if (positionError) console.error('[ping] position insert failed', positionError)

    const { data: open, error: openError } = await db
      .from('shifts')
      .select('id, site_id, started_at')
      .eq('worker_id', worker.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (openError) {
      console.error('[ping] open shift lookup failed', openError)
      return res.status(500).json({ error: 'Could not check your shift status' })
    }
    if (!open) return res.status(409).json({ error: "You don't have a shift open." })

    const { error: closeError } = await db
      .from('shifts')
      .update({ ended_at: new Date(at).toISOString() })
      .eq('id', open.id)
      .is('ended_at', null)
    if (closeError) {
      console.error('[ping] manual clock_out update failed', closeError)
      return res.status(500).json({ error: 'Could not close your shift' })
    }

    // Back to offsite, so a later crossing starts a fresh arrival rather than
    // resuming the shift that was just deliberately ended.
    const { error: stateError } = await db.from('dwell_state').upsert({
      worker_id: worker.id,
      phase: initialPhase,
      updated_at: new Date().toISOString(),
    })
    if (stateError) console.error('[ping] dwell_state reset failed', stateError)

    const outSite = sites.find((s2) => s2.id === open.site_id)
    const hhmmOut = new Date(at).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: SITE_TIME_ZONE,
    })
    const outMessage = `${worker.name} clocked out of ${outSite?.name ?? 'site'} · ${hhmmOut} · manual`

    if (open.site_id) {
      await db.from('geofence_events').insert({
        company_id: worker.company_id,
        worker_id: worker.id,
        site_id: open.site_id,
        at: new Date(at).toISOString(),
        kind: 'clock_out',
        message: outMessage,
      })
      const { data: outChannel } = await db
        .from('channels')
        .select('id')
        .eq('site_id', open.site_id)
        .eq('kind', 'site')
        .maybeSingle()
      if (outChannel) {
        await db.from('messages').insert({
          company_id: worker.company_id,
          channel_id: outChannel.id,
          author_id: null,
          kind: 'system',
          body: outMessage,
        })
      }
    }

    return res.status(200).json({
      ok: true,
      notes: [],
      phase: initialPhase,
      events: [{ kind: 'clock_out', siteId: open.site_id, at, since: new Date(open.started_at).getTime() }],
      sites: sites.map((s2) => ({
        id: s2.id,
        name: s2.name,
        lat: s2.center.lat,
        lng: s2.center.lng,
        radiusM: s2.radiusM,
      })),
    })
  }

  if (body?.manual === true) {
    // Still a location report, whatever the outcome — same as the automatic
    // path a few lines down, and worth keeping even for a refused attempt.
    const { error: positionError } = await db.from('positions').insert({
      worker_id: worker.id,
      at: new Date(at).toISOString(),
      lat,
      lng,
      accuracy_m: Number(body.accuracyM) || 0,
    })
    if (positionError) console.error('[ping] position insert failed', positionError)

    // Plain radius, not the buffered one used for exits — a manual clock-in
    // is a new arrival, and arrivals use the same rule the automatic engine
    // uses to start the dwell timer in the first place.
    const site = siteContaining({ lat, lng }, sites)
    if (!site) {
      return res.status(409).json({
        error: 'You need to be inside a job site to clock in. Move closer and try again.',
      })
    }

    const { data: openShift, error: openShiftError } = await db
      .from('shifts')
      .select('id')
      .eq('worker_id', worker.id)
      .is('ended_at', null)
      .maybeSingle()
    if (openShiftError) {
      console.error('[ping] open shift lookup failed', openShiftError)
      return res.status(500).json({ error: 'Could not check your shift status' })
    }
    if (openShift) {
      return res.status(409).json({ error: 'A shift is already open — clock out first.' })
    }

    const { error: insertError } = await db.from('shifts').insert({
      company_id: worker.company_id,
      worker_id: worker.id,
      site_id: site.id,
      started_at: new Date(at).toISOString(),
      source: 'manual',
    })
    // Same race the automatic path guards against with the same codes — two
    // pings landing together must not open two shifts. Whichever loses is
    // told plainly rather than shown a bare 500.
    if (insertError) {
      if (insertError.code === '23505' || insertError.code === '23P01') {
        return res.status(409).json({ error: 'A shift is already open — clock out first.' })
      }
      console.error('[ping] manual clock_in insert failed', insertError)
      return res.status(500).json({ error: 'Could not open your shift' })
    }

    // Recorded as if the dwell engine had itself reached "onsite", so the
    // very next automatic ping continues from here — extending lastInside,
    // then clocking out after the normal exit dwell — instead of restarting
    // a two-minute arrival timer for a worker who is plainly already there.
    const onsitePhase: DwellPhase = { kind: 'onsite', siteId: site.id, since: at, lastInside: at }
    const { error: stateError } = await db.from('dwell_state').upsert({
      worker_id: worker.id,
      phase: onsitePhase,
      updated_at: new Date().toISOString(),
    })
    if (stateError) console.error('[ping] dwell_state upsert failed', stateError)

    // Timezone reasoning matches the automatic path below: written on a
    // server running UTC, read by a builder in Adelaide.
    const hhmmAt = new Date(at).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: SITE_TIME_ZONE,
    })
    const message = `${worker.name} clocked in at ${site.name} · ${hhmmAt} · manual`

    await db.from('geofence_events').insert({
      company_id: worker.company_id,
      worker_id: worker.id,
      site_id: site.id,
      at: new Date(at).toISOString(),
      kind: 'clock_in',
      message,
    })

    // Mirrors the automatic path so a manual clock-in shows up in the site
    // chat the same way an automatic one does — the crew shouldn't be able
    // to tell which button someone pressed from the chat alone.
    const { data: channel } = await db
      .from('channels')
      .select('id')
      .eq('site_id', site.id)
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

    return res.status(200).json({
      ok: true,
      notes: [],
      phase: onsitePhase,
      events: [{ kind: 'clock_in', siteId: site.id, at }],
      sites: sites.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.center.lat,
        lng: s.center.lng,
        radiusM: s.radiusM,
      })),
    })
  }

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
  /*
   * These strings are written on the server and read by a builder in Adelaide,
   * so they must be rendered in the site's timezone — not the server's. Vercel
   * runs in UTC, which had clock-ins showing up in the activity log and the
   * site chat 9.5 hours out.
   *
   * The zone is fixed rather than per-company because everything else in the
   * app is already pinned to en-AU and AUD; it becomes a companies column the
   * day the product is sold outside this timezone.
   */
  const hhmm = (t: number) =>
    new Date(t).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: SITE_TIME_ZONE,
    })

  // Record the raw position regardless of what the engine decided.
  const { error: positionError } = await db.from('positions').insert({
    worker_id: worker.id,
    at: new Date(at).toISOString(),
    lat,
    lng,
    accuracy_m: ping.accuracyM,
  })
  if (positionError) console.error('[ping] position insert failed', positionError)

  /** Things the worker needs telling, surfaced instead of logged and lost. */
  const notes: string[] = []

  for (const event of result.events) {
    if (event.kind === 'clock_in') {
      const { error } = await db.from('shifts').insert({
        company_id: worker.company_id,
        worker_id: worker.id,
        site_id: event.siteId,
        started_at: new Date(event.at).toISOString(),
        source: 'auto',
      })
      // 23505: the partial unique index rejected a second open shift, so we
      // already have one and this is a duplicate delivery — fine.
      //
      // 23P01: shifts_no_overlap refused because an EARLIER shift is still
      // open and, being open, is treated as running to infinity. That is not
      // a duplicate; it means this worker has a stranded shift and is now
      // silently not being tracked. Closing the old one here would be
      // inventing an end time, so it is surfaced instead of swallowed.
      if (error?.code === '23P01') {
        console.error('[ping] clock_in blocked by an unclosed earlier shift', {
          workerId: worker.id,
          siteId: event.siteId,
        })
        notes.push('An earlier shift never closed, so this clock-in was refused. Tell the office.')
      } else if (error && error.code !== '23505') {
        console.error('[ping] clock_in insert failed', error)
      }
    }

    if (event.kind === 'clock_out') {
      const { error } = await db
        .from('shifts')
        .update({ ended_at: new Date(event.at).toISOString() })
        .eq('worker_id', worker.id)
        .is('ended_at', null)
      // A failure here used to be invisible: the shift stayed open, the next
      // day's clock-in collided with it, and the worker stopped being tracked
      // with nothing said. The engine is the system of record for times, so
      // this is the one write that must not fail quietly.
      if (error) {
        console.error('[ping] clock_out update failed', error)
        notes.push('Your clock-out did not save. Your hours are being held — tell the office.')
      }
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
    notes,
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
