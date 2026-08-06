export interface LatLng {
  lat: number
  lng: number
}

export interface JobSite {
  id: string
  name: string
  address: string
  jobType: string
  status: 'active' | 'starting_soon'
  center: LatLng
  /** Geofence radius in metres. */
  radiusM: number
  /**
   * Internal cost budget — what the job is allowed to cost in labour,
   * materials and expenses. Not the contract price, and never shown to a
   * client. Null when not set.
   */
  budget: number | null
  /** Who the job is for. Shown in the client portal. */
  clientName: string | null
  /** Headline progress the client sees, 0–100. Null when not tracked. */
  progressPct: number | null
  /** One line on where the schedule stands, shown in the client portal. */
  scheduleNote: string | null
}

export interface Worker {
  id: string
  name: string
  initials: string
  trade: string
  /** Hourly rate in dollars, used for the live labour-cost tile. */
  rate: number
}

export interface CostCode {
  code: string
  name: string
}

/** A single location report from a worker's phone. */
export interface Ping {
  workerId: string
  at: number
  lat: number
  lng: number
  accuracyM: number
}

export type WorkerStatus = 'on_clock' | 'arriving' | 'traveling' | 'off' | 'exception'

/**
 * Why a worker is flagged. Surfaced on the map and in the roster so the office
 * can act on it, rather than discovering it on payroll day.
 */
export type ExceptionKind = 'outside_geofence' | 'signal_lost' | 'no_clock_out'

export interface WorkerState {
  worker: Worker
  position: LatLng | null
  lastPingAt: number | null
  status: WorkerStatus
  /** Site the worker is currently clocked in at, if any. */
  siteId: string | null
  clockedInAt: number | null
  /** Accumulated milliseconds on the clock today, excluding the open shift. */
  bankedMs: number
  /** Recent positions, newest last. Drawn as the breadcrumb trail. */
  trail: LatLng[]
  exception: ExceptionKind | null
  note: string | null
}

/** A block of time on the clock. Timesheets are just these, grouped. */
export interface Shift {
  id: string
  workerId: string
  siteId: string
  startedAt: number
  endedAt: number | null
  /** 'auto' came from the geofence, 'manual' from a human. Shown on every cell. */
  source: 'auto' | 'manual'
  edited: boolean
  approved: boolean
  costCode: string | null
}

export type TimelineEventKind =
  | 'clock_in'
  | 'clock_out'
  | 'drive_by_rejected'
  | 'geofence_exception'

export interface TimelineEvent {
  id: string
  at: number
  kind: TimelineEventKind
  workerId: string
  siteId: string | null
  message: string
}

/** Everything the dashboard renders. Implemented by the live Supabase hook. */
export interface CrewSnapshot {
  now: number
  crew: WorkerState[]
  events: TimelineEvent[]
  shifts: Shift[]
  onClock: number
  activeSites: number
  hoursToday: number
  labourCostToday: number
}
