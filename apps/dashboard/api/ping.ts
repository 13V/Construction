import type { VercelRequest, VercelResponse } from '@vercel/node'
import { advance, initialPhase, siteContaining, type DwellEvent, type DwellPhase } from '../src/geofence/dwell.js'
import {
  automaticPingTime,
  manualPingTime,
  readDwell,
  storeDwell,
  type Dwell,
  type StoredPhase,
} from '../src/geofence/pingTime.js'
import type { JobSite, Ping } from '../src/types.js'
import { callerWorker, serviceClient } from './_supabase.js'
import { applyCors } from './_cors.js'
import { SITE_TIME_ZONE } from './_siteTime.js'

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
  /**
   * When the fix was taken, by the phone's clock: ISO or epoch ms. A phone
   * with no signal queues its fixes and sends them later, so this can be
   * hours old. Never trusted outright — src/geofence/pingTime.ts has the rules.
   */
  at?: string | number
  /**
   * Optional: the phone's clock at the moment it sent this request. With it,
   * the age of a queued fix is measured on the phone's own clock, so a phone
   * clock that is set wrong cannot move a shift. See pingTime.ts.
   */
  sentAt?: string | number
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

/** How many times a ping is re-decided when another ping for the same worker wrote first. */
const STATE_ATTEMPTS = 3

type Db = ReturnType<typeof serviceClient>

/** A worker's dwell_state row as read: the state, and `updated_at` exactly as stored (null: no row yet). */
interface State {
  dwell: Dwell
  version: string | null
}

async function readState(db: Db, workerId: string): Promise<State | null> {
  const { data, error } = await db
    .from('dwell_state')
    .select('phase, updated_at')
    .eq('worker_id', workerId)
    .maybeSingle()
  if (error) {
    console.error('[ping] dwell_state read failed', error)
    return null
  }
  return { dwell: readDwell(data?.phase, data?.updated_at), version: data ? String(data.updated_at) : null }
}

/** An updated_at strictly after the one read, so no write can ever look like the row it replaced. */
function nextVersion(read: string | null): string {
  const prev = read ? Date.parse(read) : NaN
  const now = Date.now()
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString()
}

/**
 * Writes a worker's next dwell state only if nobody has written it since it
 * was read — `updated_at` is the version.
 *
 * Two of one worker's pings can be in flight at once: the phone drains its
 * offline queue one fix at a time, but a fresh fix 20 seconds later is sent
 * alongside it. Both read the same state; without this, the one that wrote
 * last won, and a 7:03 fix could put the state back behind a 9:00 one that
 * had already been taken. Whoever loses reads again and decides again, and
 * only the winner writes the shift and the messages that go with the change.
 */
async function claimState(db: Db, workerId: string, read: State, phase: StoredPhase): Promise<'won' | 'lost' | 'error'> {
  const updated_at = nextVersion(read.version)
  if (read.version === null) {
    const { error } = await db.from('dwell_state').insert({ worker_id: workerId, phase, updated_at })
    if (!error) return 'won'
    if (error.code === '23505') return 'lost'
    console.error('[ping] dwell_state insert failed', error)
    return 'error'
  }
  const { data, error } = await db
    .from('dwell_state')
    .update({ phase, updated_at })
    .eq('worker_id', workerId)
    .eq('updated_at', read.version)
    .select('worker_id')
  if (error) {
    console.error('[ping] dwell_state update failed', error)
    return 'error'
  }
  return data && data.length > 0 ? 'won' : 'lost'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let caller
  try {
    caller = await callerWorker(req.headers.authorization)
  } catch (err) {
    console.error('[ping] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!caller.ok) return res.status(caller.status).json(caller.body)
  const worker = caller.worker

  const body = req.body as Body
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' })
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng out of range' })
  }

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

  const siteList = sites.map((s) => ({
    id: s.id,
    name: s.name,
    lat: s.center.lat,
    lng: s.center.lng,
    radiusM: s.radiusM,
  }))

  /*
   * These strings are written on the server and read by a builder in Adelaide,
   * so they must be rendered in the site's timezone — not the server's. Vercel
   * runs in UTC, which had clock-ins showing up in the activity log and the
   * site chat 9.5 hours out. (Why the zone is fixed: _siteTime.ts.)
   */
  const hhmm = (t: number) =>
    new Date(t).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: SITE_TIME_ZONE,
    })

  // Read by every path below: the automatic one runs the engine from it, and
  // the two buttons need the newest ping time already taken, which no tap may
  // land before.
  const state = await readState(db, worker.id)
  if (!state) return res.status(500).json({ error: 'Could not check your shift status' })

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
    const at = manualPingTime(body, Date.now(), state.dwell.lastPingAt)
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

    // Never before the shift's own start: a shift the engine opened while
    // this tap was in flight, or one the old five-minute rule dated slightly
    // ahead, would otherwise make an end-before-start range the database
    // refuses, and the worker could not clock out at all.
    const startedAt = Date.parse(String(open.started_at))
    const endAt = Number.isFinite(startedAt) && startedAt > at ? startedAt : at

    const { error: closeError } = await db
      .from('shifts')
      .update({ ended_at: new Date(endAt).toISOString() })
      .eq('id', open.id)
      .is('ended_at', null)
    if (closeError) {
      console.error('[ping] manual clock_out update failed', closeError)
      return res.status(500).json({ error: 'Could not close your shift' })
    }

    // Back to offsite, so a later crossing starts a fresh arrival rather than
    // resuming the shift that was just deliberately ended. Written whatever
    // else has happened since the read: the tap is the worker's own word.
    const { error: stateError } = await db.from('dwell_state').upsert({
      worker_id: worker.id,
      phase: storeDwell(initialPhase, endAt),
      updated_at: nextVersion(state.version),
    })
    if (stateError) console.error('[ping] dwell_state reset failed', stateError)

    const outSite = sites.find((s2) => s2.id === open.site_id)
    const outMessage = `${worker.name} clocked out of ${outSite?.name ?? 'site'} · ${hhmm(endAt)} · manual`

    if (open.site_id) {
      await db.from('geofence_events').insert({
        company_id: worker.company_id,
        worker_id: worker.id,
        site_id: open.site_id,
        at: new Date(endAt).toISOString(),
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
      events: [{ kind: 'clock_out', siteId: open.site_id, at: endAt, since: new Date(open.started_at).getTime() }],
      sites: siteList,
    })
  }

  if (body?.manual === true) {
    const at = manualPingTime(body, Date.now(), state.dwell.lastPingAt)
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
      phase: storeDwell(onsitePhase, at),
      updated_at: nextVersion(state.version),
    })
    if (stateError) console.error('[ping] dwell_state upsert failed', stateError)

    // Timezone reasoning matches the automatic path below: written on a
    // server running UTC, read by a builder in Adelaide.
    const message = `${worker.name} clocked in at ${site.name} · ${hhmm(at)} · manual`

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
      sites: siteList,
    })
  }

  /*
   * The automatic path: decide when this ping happened, run the engine, and
   * claim the new state — then, and only if the claim held, write what it
   * decided. A ping that is not taken — older than one already taken, too old
   * to be believed, or a fresh fix sent alongside a queue that is still
   * arriving (src/geofence/pingTime.ts) — changes nothing at all and is
   * answered with the worker's current state, as a success, so the phone
   * drops it from its queue instead of sending it forever.
   */
  let read = state
  let decided: { late: boolean; now: number; ping: Ping; events: DwellEvent[]; phase: DwellPhase }
  for (let attempt = 1; ; attempt++) {
    const now = Date.now()
    const time = automaticPingTime(body, now, read.dwell)
    if (!time.ok) {
      console.warn('[ping] ping not taken', {
        workerId: worker.id,
        reason: time.reason,
        claimed: body.at,
        sentAt: body.sentAt,
        lastPingAt: read.dwell.lastPingAt,
      })
      return res.status(200).json({
        ok: true,
        ignored: time.reason,
        notes: [],
        phase: read.dwell.phase,
        events: [],
        sites: siteList,
      })
    }

    const ping: Ping = {
      workerId: worker.id,
      at: time.at,
      lat,
      lng,
      accuracyM: Number(body.accuracyM) || 0,
    }
    const result = advance(read.dwell.phase, ping, sites)
    const claim = await claimState(db, worker.id, read, storeDwell(result.phase, time.at, time.queueSince))
    if (claim === 'error') return res.status(500).json({ error: 'Could not save your location — it will be sent again.' })
    if (claim === 'won') {
      decided = { late: time.late, now, ping, events: result.events, phase: result.phase }
      break
    }
    if (attempt >= STATE_ATTEMPTS) {
      console.error('[ping] dwell_state kept changing underneath this ping', { workerId: worker.id })
      return res.status(503).json({ error: 'Could not save your location — it will be sent again.' })
    }
    const again = await readState(db, worker.id)
    if (!again) return res.status(500).json({ error: 'Could not check your shift status' })
    read = again
  }
  const { ping } = decided

  // A ping sent from the phone's queue says so wherever it is announced, with
  // the time it actually arrived. Its time is the phone's word, and the office
  // reading "clocked in 7:02 am · sent 9:00 am" can see that for themselves.
  const sent = decided.late ? ` · sent ${hhmm(decided.now)}` : ''

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'site'

  // Record the raw position of every ping the engine took, whatever it
  // decided, at the time the fix was taken.
  const { error: positionError } = await db.from('positions').insert({
    worker_id: worker.id,
    at: new Date(ping.at).toISOString(),
    lat,
    lng,
    accuracy_m: ping.accuracyM,
  })
  if (positionError) console.error('[ping] position insert failed', positionError)

  /** Things the worker needs telling, surfaced instead of logged and lost. */
  const notes: string[] = []
  /** What the phone is told happened — a clock-in that was refused is not one. */
  const reported: DwellEvent[] = []

  for (const event of decided.events) {
    let kind: DwellEvent['kind'] | 'geofence_exception' = event.kind
    let message =
      event.kind === 'clock_in'
        ? `${worker.name} clocked in at ${siteName(event.siteId)} · ${hhmm(event.at)}${sent}`
        : event.kind === 'clock_out'
          ? `${worker.name} left ${siteName(event.siteId)} · clocked out ${hhmm(event.at)}${sent}`
          : `${worker.name} passed ${siteName(event.siteId)} ${hhmm(event.at)} — not clocked in (${Math.round(event.dwelledMs / 1000)}s on site)${sent}`

    if (event.kind === 'clock_in') {
      const { error } = await db.from('shifts').insert({
        company_id: worker.company_id,
        worker_id: worker.id,
        site_id: event.siteId,
        started_at: new Date(event.at).toISOString(),
        source: 'auto',
      })
      /*
       * Refused because something already holds this time. What holds it
       * decides what is said.
       *
       * 23505 is shifts_one_open_per_worker: a shift is open. Opened during
       * this arrival (a "Clock in manually" tap that landed while this ping
       * was in flight), the worker is on the clock and nothing is wrong. Older
       * than the arrival, it is a shift that never closed — stranded, blocking
       * every clock-in after it, and this worker is now silently not being
       * tracked. The unique index is older than shifts_no_overlap, so Postgres
       * checks it first, and this is the code a stranded shift produces.
       *
       * 23P01 is shifts_no_overlap: a closed shift already covers this time.
       * Now that a queued fix can arrive hours late, that is the office having
       * put the hours in by hand while the phone had no signal.
       *
       * Neither of those two is a clock-in, and closing or moving the other
       * shift here would be inventing times, so it is surfaced instead: the
       * worker is told which it is, the office's activity log records it as
       * an exception, and the site chat is not told somebody clocked in.
       */
      if (error?.code === '23505' || error?.code === '23P01') {
        const arrivedAt = read.dwell.phase.kind === 'arriving' ? read.dwell.phase.since : event.at
        const { data: open } = await db
          .from('shifts')
          .select('id, started_at')
          .eq('worker_id', worker.id)
          .is('ended_at', null)
          .limit(1)
          .maybeSingle()
        const stranded = open ? Date.parse(String(open.started_at)) < arrivedAt : false
        if (!open || stranded) {
          console.error('[ping] clock_in refused', {
            code: error.code,
            workerId: worker.id,
            siteId: event.siteId,
            at: event.at,
            openShift: open?.id ?? null,
          })
          notes.push(
            stranded
              ? 'An earlier shift never closed, so this clock-in was refused. Tell the office.'
              : `Your clock-in at ${hhmm(event.at)} overlaps hours already on your timesheet, so it wasn't added. Tell the office if that's wrong.`,
          )
          kind = 'geofence_exception'
          message = `${worker.name} arrived at ${siteName(event.siteId)} · ${hhmm(event.at)}${sent} — not clocked in: ${
            stranded ? 'an earlier shift is still open' : 'overlaps a shift already recorded'
          }`
        }
      } else if (error) {
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

    await db.from('geofence_events').insert({
      company_id: worker.company_id,
      worker_id: worker.id,
      site_id: event.siteId,
      at: new Date(event.at).toISOString(),
      kind,
      message,
    })

    if (kind === 'geofence_exception') continue
    reported.push(event)

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

  // The full phase goes back so the phone renders the authoritative dwell
  // countdown rather than a second, drifting one of its own.
  return res.status(200).json({
    ok: true,
    notes,
    phase: decided.phase,
    events: reported.map((e) => ({ kind: e.kind, siteId: e.siteId, at: e.at })),
    sites: siteList,
  })
}
