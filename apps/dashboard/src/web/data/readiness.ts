/**
 * Is a job ready to start? A checklist worked out from rows the job already
 * has, so it needs no column of its own and the phone's edits count the
 * moment they are made: a supervisor saved on site, a scope line confirmed
 * on a phone, a SWMS issued from the Safety tab.
 *
 * Ten items, each naming the place on the website that fixes it:
 *   fence placed · builder linked · dates · site supervisor linked ·
 *   scope decided n of total · current drawings · builder's programme ·
 *   SWMS on the job · crew booked · captain
 * plus the waterproofing certificate's six steps (stepsOf, the phone's own
 * rule), reported beside the checklist rather than in it: waterproofing is
 * finished during a job, not before it starts.
 *
 * Imports the phone's feature code (phone-features.ts), so only lazily
 * loaded pages may import this file (boundary.test.ts rule 4). It reads
 * safety_documents directly and never safety_shelf_v, which returns other
 * companies' rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { builderOf, DEFAULT_CENTER, distanceM, supabase, type JobSiteRow } from '../phone'
import { docState, stepsOf, type SafetyDoc, type WpFile, type WpPackageRow } from '../phone-features'
import type { JobTab } from '../router'
import { allRows, startOfToday } from './bookings'
import { CONTACT_COLS, contactsOf, type ContactRow } from './builders'
import { drawingsOnly, isDrawing, scopeCounts, supersededIds, type ScopeStatus } from './contract'
import { useFresh } from './useFresh'

export type ReadyKey = 'fence' | 'builder' | 'dates' | 'supervisor' | 'scope' | 'drawings' | 'programme' | 'swms' | 'crew' | 'captain'

export interface ReadyItem {
  key: ReadyKey
  label: string
  done: boolean
  /** One line under the label: what is there, or what is missing. */
  detail: string
  /** Where it is fixed: a job tab, or 'edit' for the job form. */
  fix: JobTab | 'edit'
}

export interface Readiness {
  items: ReadyItem[]
  done: number
  total: number
  scope: { decided: number; total: number }
  waterproofing: { done: number; total: number }
}

/** The rows readinessOf reads, all for one job. */
export interface ReadinessRows {
  site: JobSiteRow
  selections: Array<{ scope_key: string | null; status: ScopeStatus }>
  /** site_files rows; anything that is not a drawing is ignored. */
  files: Array<{ id: string; kind: string; supersedes: string | null; selection_id: string | null; waterproofing_package_id: string | null }>
  programmes: Array<{ status: string }>
  /** safety_documents rows; only active, non-template SWMS for this job or the whole company count. */
  safety: Array<Pick<SafetyDoc, 'kind' | 'site_id' | 'is_template' | 'active' | 'expires_on'>>
  /** Published bookings on the job ending today or later. */
  bookings: Array<{ worker_id: string; starts_at: string }>
  /** The job's oldest waterproofing package (the one the phone shows) and its files. */
  wpPackage: WpPackageRow | null
  wpFiles: WpFile[]
  /**
   * The job's linked supervisor and the people of its builder (builder_id,
   * or failing that the linked supervisor's), oldest first: what the
   * phone's Project details picks the "Site supervisor" it shows from.
   */
  contacts: ContactRow[]
  now?: Date
}

/** The Adelaide-CBD guard: a pin left where the map opens was never placed. */
export const UNPLACED_WITHIN_M = 100

export function fencePlaced(site: Pick<JobSiteRow, 'lat' | 'lng'>): boolean {
  return Number.isFinite(site.lat) && Number.isFinite(site.lng) && distanceM({ lat: site.lat, lng: site.lng }, DEFAULT_CENTER) > UNPLACED_WITHIN_M
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const NO_ONE_TO_EMAIL = 'SWMS and waterproofing certificate emails have no one to go to'

/**
 * The site supervisor item. Done means the job itself points at one of its
 * builder's site supervisors (supervisor_contact_id): that is who the
 * phone's Safety and Waterproofing screens send SWMS and certificates to.
 * The phone's Project details also shows the builder's first supervisor on
 * a job that points at nobody, so a job can show a supervisor on the phone
 * (and on the job page, which shows what the phone shows) and still have no
 * one for those emails; the detail names that person and says what is
 * missing, rather than saying there is no supervisor.
 */
function supervisorItem(site: JobSiteRow, contacts: ContactRow[]): Pick<ReadyItem, 'done' | 'detail'> {
  const linked = site.supervisor_contact_id ? (contacts.find((c) => c.id === site.supervisor_contact_id) ?? null) : null
  if (site.supervisor_contact_id) {
    // Linked to someone these rows do not include (a load from before the link): linked is linked.
    if (!linked) return { done: true, detail: 'Linked to this job' }
    if (site.builder_id && linked.builder_id !== site.builder_id) {
      return { done: false, detail: `${linked.name} is linked, but is a site supervisor for another builder: the phone shows them, and emails go to them` }
    }
    return { done: true, detail: linked.email ? linked.name : `${linked.name}, with no email for SWMS and certificates` }
  }
  const builderId = site.builder_id
  const shown = builderId ? contactsOf(site, null, contacts.filter((c) => c.builder_id === builderId)).byRole.supervisor : null
  return shown
    ? { done: false, detail: `Not linked to this job. The phone shows ${shown.name}, but ${NO_ONE_TO_EMAIL}` }
    : { done: false, detail: `Not set for this job, so ${NO_ONE_TO_EMAIL}` }
}

/** The checklist for one job. Pure. */
export function readinessOf(r: ReadinessRows): Readiness {
  const { site } = r
  const now = r.now ?? new Date()

  const scope = scopeCounts(r.selections)
  const decided = scope.chosen + scope.not_applicable

  const drawings = r.files.filter(isDrawing)
  const old = supersededIds(drawings)
  const current = drawings.filter((d) => !old.has(d.id)).length

  const swms = r.safety.filter((d) => d.kind === 'swms' && d.active && !d.is_template && (d.site_id === null || d.site_id === site.id))
  const liveSwms = swms.filter((d) => docState(d as SafetyDoc).state !== 'overdue')

  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  const ahead = r.bookings.filter((b) => new Date(b.starts_at).getTime() >= t0.getTime())
  const people = new Set(ahead.map((b) => b.worker_id)).size

  const steps = stepsOf(r.wpPackage, r.wpFiles)
  const builder = builderOf(site)
  const supervisor = supervisorItem(site, r.contacts)

  const items: ReadyItem[] = [
    {
      key: 'fence',
      label: 'Fence placed',
      done: fencePlaced(site),
      detail: fencePlaced(site) ? `${site.radius_m} m around the pin` : 'The pin is still where the map opens, in the middle of Adelaide',
      fix: 'edit',
    },
    {
      key: 'builder',
      label: 'Builder linked',
      done: Boolean(site.builder_id),
      detail: site.builder_id ? builder || 'Linked' : builder ? `${builder}, typed but not linked to a builder` : 'No builder yet',
      fix: 'edit',
    },
    {
      key: 'dates',
      label: 'Dates set',
      done: Boolean(site.starts_on),
      detail: site.starts_on ? (site.ends_on ? `${site.starts_on} to ${site.ends_on}` : `From ${site.starts_on}`) : 'No start date',
      fix: 'edit',
    },
    { key: 'supervisor', label: 'Site supervisor', ...supervisor, fix: 'edit' },
    {
      key: 'scope',
      label: `${decided} of ${scope.total} scope decided`,
      done: decided === scope.total,
      detail: scope.pending === 0 ? 'Every line confirmed or not applicable' : `${plural(scope.pending, 'line')} still required`,
      fix: 'scope',
    },
    {
      key: 'drawings',
      label: 'Current drawings',
      done: current > 0,
      detail: current > 0 ? plural(current, 'sheet') : 'No drawings uploaded',
      fix: 'drawings',
    },
    {
      key: 'programme',
      label: "Builder's programme",
      done: r.programmes.some((p) => p.status === 'current'),
      detail: r.programmes.some((p) => p.status === 'current') ? 'Current revision uploaded' : 'Not uploaded yet',
      fix: 'drawings',
    },
    {
      key: 'swms',
      label: 'SWMS on the job',
      done: liveSwms.length > 0,
      detail: liveSwms.length > 0 ? plural(liveSwms.length, 'SWMS', 'SWMS') : swms.length > 0 ? 'The SWMS has expired' : 'No SWMS issued',
      fix: 'safety',
    },
    {
      key: 'crew',
      label: 'Crew booked',
      done: people > 0,
      detail: people > 0 ? `${plural(people, 'person', 'people')} booked from today` : 'Nobody booked',
      fix: 'crew',
    },
    {
      key: 'captain',
      label: 'Captain',
      done: Boolean(site.captain_id),
      detail: site.captain_id ? 'Running the job' : 'No captain',
      fix: 'edit',
    },
  ]

  return {
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
    scope: { decided, total: scope.total },
    waterproofing: { done: steps.filter((s) => s.state === 'complete').length, total: steps.length },
  }
}

// ---------------------------------------------------------------- loading

/** The phone's package columns (Waterproofing.tsx), everything stepsOf reads. */
const PKG_COLS =
  'id, site_id, created_at, unit, product_internal, product_external, installed_on, installed_by, flood_test_on, ' +
  'flood_test_result, flood_test_hours, builder_signed_name, builder_signed_at, certificate_no, ' +
  'certificate_generated_at, certificate_path, certificate_sent_at, certificate_sent_to, ' +
  'scope_of_work, completion_on, warranty_years'

type Rows = Omit<ReadinessRows, 'site' | 'now'>

/**
 * The rows for several jobs at once, keyed by job: one request per table
 * rather than one per job, so the board can show a meter on every row.
 */
export async function loadReadinessRows(siteIds: string[]): Promise<Map<string, Rows>> {
  const out = new Map<string, Rows>()
  if (siteIds.length === 0) return out
  for (const id of siteIds) out.set(id, { selections: [], files: [], programmes: [], safety: [], bookings: [], wpPackage: null, wpFiles: [], contacts: [] })
  const c = supabase()
  const t0 = startOfToday().toISOString()
  // In batches of ids, so the query string stays a sensible length.
  const batches: string[][] = []
  for (let i = 0; i < siteIds.length; i += 100) batches.push(siteIds.slice(i, i + 100))

  for (const ids of batches) {
    const [sel, files, progs, safety, asg, pkgs, jobs] = await Promise.all([
      allRows<{ site_id: string; scope_key: string | null; status: ScopeStatus }>((a, b) =>
        c.from('selections').select('site_id, scope_key, status').in('site_id', ids).order('id').range(a, b),
      ),
      allRows<ReadinessRows['files'][number] & { site_id: string }>((a, b) =>
        drawingsOnly(c.from('site_files').select('id, site_id, kind, supersedes, selection_id, waterproofing_package_id').in('site_id', ids))
          .order('id')
          .range(a, b),
      ),
      allRows<{ site_id: string; status: string }>((a, b) => c.from('programmes').select('site_id, status').in('site_id', ids).eq('status', 'current').order('id').range(a, b)),
      allRows<ReadinessRows['safety'][number]>((a, b) =>
        c
          .from('safety_documents')
          .select('kind, site_id, is_template, active, expires_on')
          .eq('kind', 'swms')
          .eq('active', true)
          .or(`site_id.is.null,site_id.in.(${ids.join(',')})`)
          .order('id')
          .range(a, b),
      ),
      allRows<{ site_id: string; worker_id: string; starts_at: string }>((a, b) =>
        c.from('assignments').select('site_id, worker_id, starts_at').in('site_id', ids).eq('published', true).gte('starts_at', t0).order('id').range(a, b),
      ),
      allRows<WpPackageRow & { site_id: string; created_at: string }>((a, b) =>
        c.from('waterproofing_packages').select(PKG_COLS).in('site_id', ids).order('created_at').order('id').range(a, b),
      ),
      // Each job's builder and supervisor as stored now, for the people below.
      allRows<Pick<JobSiteRow, 'id' | 'builder_id' | 'supervisor_contact_id'>>((a, b) =>
        c.from('job_sites').select('id, builder_id, supervisor_contact_id').in('id', ids).order('id').range(a, b),
      ),
    ])
    for (const r of sel) out.get(r.site_id)?.selections.push(r)
    for (const r of files) out.get(r.site_id)?.files.push(r)
    for (const r of progs) out.get(r.site_id)?.programmes.push(r)
    for (const id of ids) out.get(id)!.safety.push(...safety)
    for (const r of asg) out.get(r.site_id)?.bookings.push(r)
    // The oldest package per job: the one the phone's Waterproofing screen shows.
    const pkgIds: string[] = []
    for (const p of pkgs) {
      const rows = out.get(p.site_id)
      if (rows && !rows.wpPackage) {
        rows.wpPackage = p
        pkgIds.push(p.id)
      }
    }
    if (pkgIds.length) {
      const wpFiles = await allRows<WpFile & { waterproofing_package_id: string }>((a, b) =>
        c
          .from('site_files')
          .select('id, name, mime, storage_path, kind, category, wp_step, waterproofing_package_id')
          .in('waterproofing_package_id', pkgIds)
          .order('created_at')
          .order('id')
          .range(a, b),
      )
      const bySite = new Map(pkgs.filter((p) => pkgIds.includes(p.id)).map((p) => [p.id, p.site_id]))
      for (const f of wpFiles) out.get(bySite.get(f.waterproofing_package_id) ?? '')?.wpFiles.push(f)
    }
    // The builders' people and the linked supervisors, in one request.
    const builderIds = [...new Set(jobs.map((j) => j.builder_id).filter((x): x is string => !!x))]
    const supIds = [...new Set(jobs.map((j) => j.supervisor_contact_id).filter((x): x is string => !!x))]
    const who = [builderIds.length ? `builder_id.in.(${builderIds.join(',')})` : '', supIds.length ? `id.in.(${supIds.join(',')})` : ''].filter(Boolean)
    if (who.length) {
      const people = await allRows<ContactRow>((a, b) => c.from('builder_contacts').select(CONTACT_COLS).or(who.join(',')).order('created_at').order('id').range(a, b))
      for (const j of jobs) {
        const sup = people.find((p) => p.id === j.supervisor_contact_id)
        const builderId = j.builder_id ?? sup?.builder_id ?? null
        out.get(j.id)?.contacts.push(...people.filter((p) => p.id === j.supervisor_contact_id || (builderId && p.builder_id === builderId)))
      }
    }
  }
  return out
}

/**
 * Readiness for many jobs (the board's meters), refreshed with the page.
 *
 * Loads can overlap: a focus refresh and the reload after a write, or the
 * board's filter changing the set of jobs while the last set is still on
 * its way. Each load takes a number and only the one asked for last lands,
 * so an older answer can never put back a count the database has moved on
 * from. A job whose rows have not arrived yet is left out of the map rather
 * than shown as having nothing done.
 */
export function useReadinessMap(sites: JobSiteRow[], { fresh = true }: { fresh?: boolean } = {}) {
  const [rows, setRows] = useState<Map<string, Rows>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // A job's builder or supervisor changing changes who the supervisor item names, so it reloads too.
  const key = sites
    .map((s) => `${s.id}:${s.builder_id ?? ''}:${s.supervisor_contact_id ?? ''}`)
    .sort()
    .join(',')
  const currentKey = useRef(key)
  useEffect(() => {
    currentKey.current = key
  }, [key])
  const latest = useRef(0)

  const reload = useCallback(async () => {
    // A reload kept from before the set of jobs changed asks nothing.
    if (currentKey.current !== key) return
    const mine = ++latest.current
    const stale = () => mine !== latest.current || currentKey.current !== key
    try {
      const ids = key ? key.split(',').map((k) => k.split(':')[0]!) : []
      const got = await loadReadinessRows(ids)
      if (stale()) return
      setRows(got)
      setError(null)
    } catch (e) {
      if (stale()) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [key])

  useEffect(() => {
    void reload()
  }, [reload])
  useFresh(() => {
    if (fresh) void reload()
  })

  const map = useMemo(() => {
    const m = new Map<string, Readiness>()
    for (const site of sites) {
      const got = rows.get(site.id)
      if (got) m.set(site.id, readinessOf({ site, ...got }))
    }
    return m
  }, [sites, rows])

  return { map, loading, error, reload }
}

/** Readiness for one job (the job page's Ready to start card). */
export function useReadiness(site: JobSiteRow | null, opts: { fresh?: boolean } = {}) {
  const list = useMemo(() => (site ? [site] : []), [site])
  const { map, loading, error, reload } = useReadinessMap(list, opts)
  return { readiness: site ? (map.get(site.id) ?? null) : null, loading, error, reload }
}

