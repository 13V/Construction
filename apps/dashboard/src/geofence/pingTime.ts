import { initialPhase, type DwellPhase } from './dwell.js'

/**
 * When a ping happened, as far as the timesheet is concerned.
 *
 * A phone on a site with no reception keeps every fix it takes, each stamped
 * with the moment it was taken (WorkerApp.tsx onFix), and sends the lot when
 * the signal comes back, oldest first. The server used to replace any time
 * more than five minutes from its own clock with "now". That was meant to stop
 * a phone with a wrong clock from moving a shift, but it also threw away the
 * one thing a queued fix knows: someone who walked onto a dead-spot site at
 * 7:00 and found signal at 9:00 was clocked in at about 9:02.
 *
 * So a fix is now taken at its own time when that time is believable, and the
 * rules for "believable" are these:
 *
 *  - Never ahead of the server. A time in the future is a phone clock running
 *    fast, and the fix is current, so it counts as now.
 *  - Never older than MAX_PING_AGE_MS. Twelve hours covers a whole working
 *    day spent out of signal; anything older is either a clock that is badly
 *    wrong or a queue that has outlived any shift it could belong to, and it is
 *    dropped rather than guessed at.
 *  - Never at or before the newest ping already taken for that worker. The
 *    dwell engine is a state machine that only moves forward in time: a fix
 *    from 7:30 fed in after one from 9:00 would reopen or move a shift that has
 *    already been decided. It is dropped, not re-timed, because putting a
 *    7:30 position at 9:00 is inventing where somebody was. This is also what
 *    stops a phone from backdating a shift past anything it has already
 *    reported.
 *  - Never ahead of a queue that is still arriving. The phone drains its queue
 *    one fix at a time, but every 20 seconds it also sends the fix it has just
 *    taken, alongside — not after — a drain that is still going. On a long
 *    queue (a whole day on a dead-spot site is 1,500 fixes, minutes to send)
 *    that fresh fix lands while the queue is still at 7:30 in the morning;
 *    taken, it would put everything still queued behind it out of order, and
 *    the day would be recorded as ending at 7:30. So while a queue is arriving,
 *    a fix taken after it started arriving that leaps ahead of where it has
 *    got to is dropped. The worker's position a few minutes after the signal
 *    came back is lost; the day before it is not.
 *
 * A dropped ping is answered with success (and the worker's current state) so
 * the phone takes it off its queue. An error would make the phone send it
 * again forever, keep everything queued behind it waiting, and — because the
 * phone puts a failed fix back at the end of its queue — shuffle its order.
 *
 * If the phone also says when it SENT the ping (`sentAt`, its own clock at the
 * moment of sending), the age of the fix is measured on the phone's clock and
 * laid against the server's: taken = now - (sentAt - at). That makes the
 * phone's clock setting irrelevant — a clock set back two hours gives the same
 * answer as a right one — and is the reason the field exists. Phones that do
 * not send it are judged on `at` alone, by the rules above.
 */

/** A phone clock may be this far off before its times stop being taken as live. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000

/** The oldest a queued fix may be and still be taken at its own time. */
export const MAX_PING_AGE_MS = 12 * 60 * 60_000

/**
 * A queue counts as still arriving while its fixes keep reaching the server
 * within this of each other. A drain sends them back to back, a fraction of a
 * second apart; this leaves room for a slow request without letting one
 * stalled drain hold fresh fixes off for long.
 */
export const QUEUE_ARRIVING_MS = 30_000

/**
 * Consecutive fixes in a queue are 20 seconds apart while the app is open. A
 * fresh fix more than this ahead of the newest one taken is past the queue,
 * not the next fix in it.
 */
export const QUEUE_STEP_MS = 60_000

export type PingTime =
  /**
   * Taken. `late`: the fix was older than the clock skew when it arrived —
   * sent from a queue. `queueSince`: what to store as the moment the queue
   * now arriving started arriving, or null when none is.
   */
  | { ok: true; at: number; late: boolean; queueSince: number | null }
  /** Dropped: answered as a success so the phone lets it go. */
  | { ok: false; reason: 'too_old' | 'out_of_order' | 'catching_up' }

/** What is known about the newest ping already taken for a worker. */
export interface LastTaken {
  /** When that ping happened, or null if none is known. */
  lastPingAt: number | null
  /** When the server took it (dwell_state.updated_at), or null if unknown. */
  takenAt: number | null
  /** When the queue it came in started arriving, if it came in one. */
  queueSince: number | null
}

/** What the phone sends about time. Both are its own clock, epoch ms or ISO. */
export interface ClaimedTimes {
  at?: unknown
  sentAt?: unknown
}

/** An instant from epoch ms or an ISO string, or null for anything else. */
export function instant(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const t = Date.parse(raw)
    return Number.isFinite(t) ? t : null
  }
  return null
}

/**
 * When the fix was taken, on the server's clock as far as can be told, or
 * null when the phone gave no usable time. Without `sentAt` this is just the
 * phone's own `at`.
 */
export function fixTime(claim: ClaimedTimes, now: number): number | null {
  const at = instant(claim.at)
  if (at === null) return null
  const sentAt = instant(claim.sentAt)
  if (sentAt === null) return at
  // A fix "taken after it was sent" means the clock moved in between; the
  // fix is then as fresh as can be said, not from the future.
  return now - Math.max(0, sentAt - at)
}

/**
 * The time an automatic (passive, possibly queued) ping is taken at, or why it
 * is dropped. `last` describes the newest ping already fed to the dwell
 * engine for this worker.
 */
export function automaticPingTime(claim: ClaimedTimes, now: number, last: LastTaken): PingTime {
  const fixed = fixTime(claim, now)
  const at = fixed === null || fixed > now ? now : fixed
  if (at < now - MAX_PING_AGE_MS) return { ok: false, reason: 'too_old' }
  const { lastPingAt, takenAt, queueSince } = last
  if (lastPingAt !== null && at <= lastPingAt) return { ok: false, reason: 'out_of_order' }

  const arriving = queueSince !== null && takenAt !== null && now - takenAt < QUEUE_ARRIVING_MS
  if (
    arriving &&
    queueSince !== null &&
    lastPingAt !== null &&
    // Taken after the queue started arriving — so not in it — allowing for a
    // phone clock up to the usual skew off…
    at > queueSince - MAX_CLOCK_SKEW_MS &&
    // …and well past the newest fix the queue has delivered so far.
    at - lastPingAt > QUEUE_STEP_MS
  ) {
    return { ok: false, reason: 'catching_up' }
  }

  const late = now - at > MAX_CLOCK_SKEW_MS
  return { ok: true, at, late, queueSince: arriving ? queueSince : late ? now : null }
}

/**
 * The time a deliberate tap ("Clock in manually", "End my shift now") counts
 * at. The phone sends those as it is tapped and never queues them, so there is
 * no such thing as a late one: a time more than the skew away from now is a
 * wrong clock, and now is used. It is never earlier than the newest ping
 * already taken, so a tap can never land inside a stretch the engine has
 * already decided — a clock-out can never come before the shift's own start.
 */
export function manualPingTime(claim: ClaimedTimes, now: number, lastAccepted: number | null): number {
  const fixed = fixTime(claim, now)
  const at = fixed === null || fixed > now || fixed < now - MAX_CLOCK_SKEW_MS ? now : fixed
  return lastAccepted !== null && lastAccepted > at ? lastAccepted : at
}

/**
 * What dwell_state.phase holds: the engine's phase, plus `lastPingAt`, the
 * time of the newest ping fed to the engine, and `queueSince` while a queue
 * is arriving. Kept in the same row as the phase they belong to, so they can
 * never disagree with it; dwell_state is written only by api/ping.ts and is
 * not read by either app.
 */
export type StoredPhase = DwellPhase & { lastPingAt?: number; queueSince?: number }

export interface Dwell extends LastTaken {
  phase: DwellPhase
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The engine's phase out of whatever is stored, or offsite if it is not a phase. */
function phaseOf(raw: unknown): DwellPhase {
  if (!raw || typeof raw !== 'object') return initialPhase
  const p = raw as Record<string, unknown>
  const ambiguousWith = Array.isArray(p.ambiguousWith)
    ? { ambiguousWith: p.ambiguousWith.filter((s): s is string => typeof s === 'string') }
    : {}
  if (p.kind === 'offsite') return initialPhase
  if (typeof p.siteId !== 'string' || !finite(p.since)) return initialPhase
  if (p.kind === 'arriving') return { kind: 'arriving', siteId: p.siteId, since: p.since, ...ambiguousWith }
  if ((p.kind === 'onsite' || p.kind === 'departing') && finite(p.lastInside)) {
    return { kind: p.kind, siteId: p.siteId, since: p.since, lastInside: p.lastInside, ...ambiguousWith }
  }
  return initialPhase
}

/**
 * Reads a dwell_state row as any version of api/ping.ts wrote it.
 *
 * Rows written before `lastPingAt` existed still say roughly how far the
 * engine had got: the phase's own times are ping times, and the old code
 * stamped `updated_at` with the server clock while only taking ping times
 * within MAX_CLOCK_SKEW_MS of it. The latest of those is a safe floor, so even
 * the first ping after this shipped cannot be fed in behind one already taken.
 */
export function readDwell(raw: unknown, updatedAt: string | null | undefined): Dwell {
  const phase = phaseOf(raw)
  const parsed = updatedAt ? Date.parse(updatedAt) : NaN
  const takenAt = Number.isFinite(parsed) ? parsed : null
  const fields = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const queueSince = finite(fields.queueSince) ? fields.queueSince : null
  if (finite(fields.lastPingAt)) return { phase, lastPingAt: fields.lastPingAt, takenAt, queueSince }

  const floors: number[] = []
  if (phase.kind !== 'offsite') floors.push(phase.since)
  if (phase.kind === 'onsite' || phase.kind === 'departing') floors.push(phase.lastInside)
  if (takenAt !== null) floors.push(takenAt - MAX_CLOCK_SKEW_MS)
  return { phase, lastPingAt: floors.length ? Math.max(...floors) : null, takenAt, queueSince: null }
}

/** The value to store in dwell_state.phase. */
export function storeDwell(phase: DwellPhase, lastPingAt: number, queueSince: number | null = null): StoredPhase {
  return queueSince === null ? { ...phase, lastPingAt } : { ...phase, lastPingAt, queueSince }
}
