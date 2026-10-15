/**
 * The phone's private rules, copied for the website.
 *
 * A job the website makes has to look and behave on the crew's phones exactly
 * as one the phone made, and most of what decides that is written inside
 * phone screens, unexported: the New project sheet's insert, the booking
 * helpers, the attention chip, the scope template, the drawing register's
 * filter. Exporting them would change the iOS bundle (a new export is new
 * bytes), and importing a phone screen from the website would drag the
 * screen in with it. So they are copied here, and contract.test.ts reads the
 * phone's own source through ?raw imports and fails the build the moment a
 * copy and its original disagree. Change the phone first; the test then says
 * which copy to bring into line.
 *
 * Where a copy is verbatim (the booking helpers, revChip, bumpVersion, the
 * scope template) the test compares the code itself. Where the phone's
 * version is tangled in a component (chipOf reads the screen's data, the
 * status labels carry JSX glyphs) the test runs the phone's code and this
 * one side by side and compares what they produce.
 *
 * Pure: no Supabase, no React. Everything here is safe for any web code.
 */
import type { JobTab } from '../router'

// ----------------------------------------------------- the New project sheet

/**
 * The columns the phone's New project sheet inserts (Projects.tsx, in
 * NewProjectSheet's save()), and nothing else. A web-made job sends all of
 * these with the same blanks, plus only columns the phone already reads but
 * cannot set at creation (colour, builder_id, captain_id, the dates).
 */
export const PHONE_INSERT_KEYS = ['company_id', 'name', 'address', 'client_name', 'job_type', 'status', 'lat', 'lng', 'radius_m'] as const

/**
 * The phone's blanks. address and job_type are '' and never null: Home calls
 * .match() on the address and .split() on the work, so a null there is a
 * crash on every phone. client_name is null when nobody typed a builder.
 */
export const PHONE_BLANKS = { address: '', job_type: '', client_name: null } as const

/** What the phone inserts a job as: a Future project, until someone marks it active. */
export const PHONE_NEW_STATUS = 'starting_soon'

/**
 * The phone's fence slider (FencePicker.tsx): 25 to 600 m in steps of 5,
 * starting at 150. The database allows up to 2000, but a fence the phone's
 * own slider cannot show is a fence nobody on site can check or move.
 */
export const RADIUS_MIN = 25
export const RADIUS_MAX = 600
export const RADIUS_STEP = 5
export const RADIUS_DEFAULT = 150

// ---------------------------------------------------------------- bookings
//
// Projects.tsx, "assign personnel". Copied verbatim; contract.test.ts
// compares the code. A booking is one row per person per working day, local
// 07:00-15:00, because that is what the schedule reads and what a timesheet
// is checked against.

/** Mon-Fri between two local dates, inclusive. Bookings are a working day. */
export function weekdaysBetween(fromISO: string, toISO: string): Date[] {
  const out: Date[] = []
  const d = new Date(`${fromISO}T00:00:00`)
  const end = new Date(`${toISO}T00:00:00`)
  while (d <= end && out.length < ASSIGN_MAX_DAYS) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * The phone's ceiling on one booking run: 84 working days. A booking is a
 * row per person per day, so an open-ended range would write thousands.
 */
export const ASSIGN_MAX_DAYS = 84

/** Local 07:00-15:00, the same working day the office scheduler books. */
export function bookingTimes(day: Date): { starts_at: string; ends_at: string } {
  const from = new Date(day)
  from.setHours(7, 0, 0, 0)
  const to = new Date(day)
  to.setHours(15, 0, 0, 0)
  return { starts_at: from.toISOString(), ends_at: to.toISOString() }
}

export const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The clash rule. The phone reads every assignments row (published or not,
 * on any job) for the people picked, from local midnight of the first day to
 * the last millisecond of the last, and skips a person's day when any of
 * those rows starts on it. These are its range and its key.
 */
export function clashWindow(days: Date[]): { from: string; to: string } | null {
  if (days.length === 0) return null
  const first = new Date(days[0]!)
  first.setHours(0, 0, 0, 0)
  const last = new Date(days[days.length - 1]!)
  last.setHours(23, 59, 59, 999)
  return { from: first.toISOString(), to: last.toISOString() }
}

/** `worker|YYYY-MM-DD`, the local day a booking starts on. */
export const clashKey = (workerId: string, day: Date | string) =>
  `${workerId}|${localISO(typeof day === 'string' ? new Date(day) : day)}`

// ------------------------------------------------------------ the attention chip

/** What needs attention on a job, as counted by the phone's useSimpleData. */
export interface AttentionCounts {
  /** Open and in-progress defects (data.openDefects). */
  defects: number
  /** Wet areas covered with no flood test (data.floodHold). */
  flood: number
  /** Variations waiting on the builder (data.pendingVariationsBySite). */
  variations: number
}

export type AttentionKind = 'flood' | 'defects' | 'variations'

export interface AttentionChip {
  kind: AttentionKind
  chip: string
  bg: string
  fg: string
  /** The website's tab that deals with it. */
  tab: JobTab
}

/**
 * The phone's Projects chip (Projects.tsx chipOf): one chip per job, the
 * worst thing first. A flood test outranks defects because a membrane tiled
 * over before its water test is the one mistake this trade cannot fix
 * afterwards. Same words, same colours as the phone, so the board and the
 * crew's Projects list say the same thing about the same job.
 *
 * Home.tsx orders these differently (defects first). The website follows
 * Projects, the list a job is managed from.
 */
export function chipOf(n: AttentionCounts): AttentionChip | null {
  const { defects: d, flood: f, variations: v } = n
  if (f > 0) {
    return { kind: 'flood', chip: f === 1 ? 'Flood test overdue' : `${f} flood tests overdue`, bg: '#FDECEE', fg: '#A3282E', tab: 'waterproofing' }
  }
  if (d > 0) return { kind: 'defects', chip: `${d} defect${d === 1 ? '' : 's'}`, bg: '#FDECEE', fg: '#A3282E', tab: 'overview' }
  if (v > 0) {
    return { kind: 'variations', chip: `${v} variation${v === 1 ? '' : 's'} waiting`, bg: '#FFF6E3', fg: '#8A6100', tab: 'overview' }
  }
  return null
}

// ------------------------------------------------------------ scope of works

export type ScopeStatus = 'pending' | 'chosen' | 'not_applicable'
export const SCOPE_STATUSES: ScopeStatus[] = ['pending', 'chosen', 'not_applicable']

/**
 * The phone's words and colours for a scope line's status (Overview.tsx
 * STATUS_META, without its glyphs). "Confirmed" is stored as 'chosen'.
 */
export const SCOPE_STATUS: Record<ScopeStatus, { label: string; bg: string; fg: string }> = {
  chosen: { label: 'Confirmed', bg: '#EAF7EC', fg: '#1B7A2C' },
  pending: { label: 'Required', bg: '#FFF4E5', fg: '#B26A00' },
  not_applicable: { label: 'Not applicable', bg: '#F1F3F5', fg: '#696D74' },
}

export interface ScopeLine {
  key: string
  name: string
  detail: string
}

/**
 * The seven standard lines, in the phone's order (Overview.tsx). A selections
 * row is written for a line only when somebody first sets it, with this key,
 * name and detail and sort = its index here. Lines added by hand have
 * scope_key null and come after these.
 */
export const SCOPE_TEMPLATE: ScopeLine[] = [
  { key: 'tiles', name: 'Tile selections + Data', detail: 'Confirm tile selections and provide all relevant product data.' },
  { key: 'grout', name: 'Grout colours', detail: 'Select and confirm grout colour for all areas.' },
  { key: 'silicone', name: 'Silicone colours', detail: 'Select and confirm silicone colour.' },
  { key: 'angles', name: 'Angles colour', detail: 'Confirm angles colour selection.' },
  { key: 'mitres', name: 'Mitres', detail: 'Confirm mitre type and finishes.' },
  { key: 'grates', name: 'Grates', detail: 'Confirm grate type, size and finish.' },
  { key: 'strip_drains', name: 'Strip drains', detail: 'Confirm strip drain type, length and location.' },
]

/**
 * How the phone counts a job's scope: every template line (a line with no
 * row yet is Required), then every line added by hand. A row whose
 * scope_key is not in the template is shown nowhere by the phone, so it is
 * not counted here either.
 */
export function scopeCounts(rows: Array<{ scope_key: string | null; status: ScopeStatus }>): Record<ScopeStatus, number> & { total: number } {
  const byKey = new Map(rows.filter((r) => r.scope_key).map((r) => [r.scope_key!, r]))
  const extras = rows.filter((r) => !r.scope_key)
  const counts = { chosen: 0, pending: 0, not_applicable: 0 }
  for (const line of SCOPE_TEMPLATE) counts[byKey.get(line.key)?.status ?? 'pending'] += 1
  for (const r of extras) counts[r.status] += 1
  return { ...counts, total: SCOPE_TEMPLATE.length + extras.length }
}

// ---------------------------------------------------------- the drawing register

/**
 * Which site_files rows are drawings: the phone register's query filters
 * (PlansScreen.tsx load(), and the Drawings button's count), as
 * [method, column, value]. A scope line's data sheet and a waterproofing
 * product sheet are also kind 'document' on the same job; these two nulls
 * keep them out of the register.
 */
export const DRAWING_FILTER: ReadonlyArray<readonly ['eq' | 'is', string, string | null]> = [
  ['eq', 'kind', 'document'],
  ['is', 'selection_id', null],
  ['is', 'waterproofing_package_id', null],
]

/** The same filter on a row already in hand. */
export function isDrawing(row: { kind: string; selection_id?: string | null; waterproofing_package_id?: string | null }): boolean {
  return row.kind === 'document' && !row.selection_id && !row.waterproofing_package_id
}

interface Filterable {
  eq(column: string, value: unknown): Filterable
  is(column: string, value: null): Filterable
}

/** Apply DRAWING_FILTER to a PostgREST query, in the phone's order. */
export function drawingsOnly<Q>(q: Q): Q {
  let out = q as unknown as Filterable
  for (const [method, column, value] of DRAWING_FILTER) out = method === 'eq' ? out.eq(column, value) : out.is(column, null)
  return out as unknown as Q
}

/**
 * A sheet is superseded when another sheet names it in `supersedes`. A
 * version string alone cannot say whether something newer exists.
 * (PlansScreen.tsx supersededIds.)
 */
export function supersededIds(sheets: Array<{ supersedes: string | null }>): Set<string> {
  return new Set(sheets.map((s) => s.supersedes).filter(Boolean) as string[])
}

// Office already stores version as "Rev A", "Rev B", etc. (see JobSiteFolder.tsx upload()),
// so prepending "REV " again produced "REV REV A" on every chip. Strip any leading "Rev"
// before adding our own.
export function revChip(version: string): string {
  return `REV ${version.replace(/^rev\s*/i, '').toUpperCase()}`
}

/** What a sheet's chip says in the phone's register. */
export function sheetChip(version: string | null, superseded: boolean): string {
  return superseded ? 'SUPERSEDED' : version ? revChip(version) : 'CURRENT'
}

/**
 * "Rev A" → "Rev B". Anything else gets a numeric suffix rather than a guess.
 * Copied from the old dashboard (ui/JobSiteFolder.tsx), which wrote every
 * revision the phone's register shows, before that file is deleted.
 */
export function bumpVersion(prev: string | null): string {
  const m = /^Rev ([A-Y])$/.exec((prev ?? '').trim())
  if (m) return `Rev ${String.fromCharCode(m[1]!.charCodeAt(0) + 1)}`
  const n = /^(.*?)(\d+)$/.exec((prev ?? '').trim())
  if (n) return `${n[1]}${Number(n[2]) + 1}`
  return 'Rev B'
}

// ----------------------------------------------------------- builder contacts

export type ContactRole = 'project_manager' | 'supervisor' | 'contract_admin'

/** The three people on the builder's side a job screen shows, in the phone's words (Overview.tsx EDIT_TITLE). */
export const CONTACT_LABEL: Record<ContactRole, string> = {
  project_manager: 'Project manager',
  supervisor: 'Site supervisor',
  contract_admin: 'Contract administrator',
}

export const CONTACT_ROLES: ContactRole[] = ['project_manager', 'supervisor', 'contract_admin']

/**
 * Roles a builder has one of, as far as the phone is concerned. Project
 * details shows the first contact in each role (byRole) and its editor edits
 * that one, so the phone never adds a second project manager or contract
 * administrator, and would never show one. The site supervisor is different:
 * each job points at its own (job_sites.supervisor_contact_id), and the
 * job's own supervisor is shown first, so a builder can have several.
 */
export const ONE_PER_BUILDER: ContactRole[] = ['project_manager', 'contract_admin']
