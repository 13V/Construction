import type { JobSite, LatLng, Ping } from '../types.js'
import { distanceM } from './geo.js'

/**
 * Dwell-based geofence engine.
 *
 * A plain circular geofence clocks people in when they merely drive past — the
 * single most common complaint about every competitor in this category. So an
 * entry only becomes a clock-in once the worker has *stayed* inside the fence
 * for DWELL_IN_MS, and an exit only becomes a clock-out once they have been
 * outside for DWELL_OUT_MS (so walking to the truck for a tool doesn't end the
 * shift).
 *
 * Pure and time-injected: every transition is driven by the timestamp on the
 * ping, never by the wall clock. That keeps it testable and lets the simulated
 * feed run at an accelerated clock.
 */

export const DWELL_IN_MS = 2 * 60_000
export const DWELL_OUT_MS = 3 * 60_000

/** A ping older than this means the phone dropped off — flag, don't guess. */
export const SIGNAL_LOST_MS = 10 * 60_000

/** GPS is noisy; require this much slack past the radius before counting an exit. */
export const EXIT_BUFFER_M = 25

export type DwellPhase =
  | { kind: 'offsite' }
  | { kind: 'arriving'; siteId: string; since: number }
  /** `lastInside` is the newest ping still within the fence — a clock-out is
   *  backdated to it so nobody is paid for the drive home. */
  | { kind: 'onsite'; siteId: string; since: number; lastInside: number }
  | { kind: 'departing'; siteId: string; since: number; lastInside: number }

export type DwellEvent =
  | { kind: 'clock_in'; siteId: string; at: number }
  | { kind: 'clock_out'; siteId: string; at: number; since: number }
  | { kind: 'drive_by_rejected'; siteId: string; at: number; dwelledMs: number }

export interface DwellResult {
  phase: DwellPhase
  events: DwellEvent[]
}

export const initialPhase: DwellPhase = { kind: 'offsite' }

/** The site whose geofence contains `at`, or null. Nearest wins on overlap. */
export function siteContaining(
  at: LatLng,
  sites: JobSite[],
  bufferM = 0,
): JobSite | null {
  let best: JobSite | null = null
  let bestDistance = Infinity

  for (const site of sites) {
    const d = distanceM(at, site.center)
    if (d <= site.radiusM + bufferM && d < bestDistance) {
      best = site
      bestDistance = d
    }
  }
  return best
}

/**
 * Advance the state machine by one ping. Returns the next phase plus any
 * events that fired — the caller decides what to persist.
 */
export function advance(
  phase: DwellPhase,
  ping: Ping,
  sites: JobSite[],
): DwellResult {
  const at = ping.at
  const here = { lat: ping.lat, lng: ping.lng }
  const events: DwellEvent[] = []

  // Entry uses the plain radius; exit gets a buffer so GPS jitter at the
  // boundary doesn't produce a flapping clock.
  const inside = siteContaining(here, sites)
  const insideBuffered = siteContaining(here, sites, EXIT_BUFFER_M)

  switch (phase.kind) {
    case 'offsite': {
      if (inside) return { phase: { kind: 'arriving', siteId: inside.id, since: at }, events }
      return { phase, events }
    }

    case 'arriving': {
      if (!insideBuffered || insideBuffered.id !== phase.siteId) {
        // Left before the dwell threshold — this was a drive-by, not a shift.
        events.push({
          kind: 'drive_by_rejected',
          siteId: phase.siteId,
          at,
          dwelledMs: at - phase.since,
        })
        // They may have driven straight into a different site's fence.
        if (inside) {
          return { phase: { kind: 'arriving', siteId: inside.id, since: at }, events }
        }
        return { phase: { kind: 'offsite' }, events }
      }

      if (at - phase.since >= DWELL_IN_MS) {
        events.push({ kind: 'clock_in', siteId: phase.siteId, at })
        return {
          phase: { kind: 'onsite', siteId: phase.siteId, since: at, lastInside: at },
          events,
        }
      }
      return { phase, events }
    }

    case 'onsite': {
      if (!insideBuffered || insideBuffered.id !== phase.siteId) {
        // Hold the last confirmed-inside timestamp; don't overwrite it with
        // the ping that proved they had already gone.
        return { phase: { ...phase, kind: 'departing' }, events }
      }
      return { phase: { ...phase, lastInside: at }, events }
    }

    case 'departing': {
      if (insideBuffered && insideBuffered.id === phase.siteId) {
        // Came back — never actually left. Keep the original shift start.
        return {
          phase: { kind: 'onsite', siteId: phase.siteId, since: phase.since, lastInside: at },
          events,
        }
      }

      if (at - phase.lastInside >= DWELL_OUT_MS) {
        events.push({
          kind: 'clock_out',
          siteId: phase.siteId,
          // Clock out as of when they actually left, not when we noticed.
          at: phase.lastInside,
          since: phase.since,
        })
        if (inside) {
          return { phase: { kind: 'arriving', siteId: inside.id, since: at }, events }
        }
        return { phase: { kind: 'offsite' }, events }
      }
      return { phase, events }
    }
  }
}

/** Site a phase is attached to, if any. */
export function phaseSiteId(phase: DwellPhase): string | null {
  return phase.kind === 'offsite' ? null : phase.siteId
}
