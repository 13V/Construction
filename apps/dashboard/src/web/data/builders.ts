/**
 * Builders and the builder's people, written the way the phone writes them.
 *
 * A builder is a `builders` row; client_name on a job is the name the phone
 * shows for it. The phone only ever links the two lazily (the first contact
 * saved on a job finds or creates a builder by exact name, Overview.tsx
 * builderIdFor), so the website links them at creation: with builder_id set,
 * the phone's lookup returns early and never makes a second row, and
 * client_name is copied from builders.name character for character so the
 * phone's builderOf() and the record agree.
 *
 * Contacts belong to the builder, not the job: the same site supervisor shows
 * on every job for that builder. A job points at its own supervisor through
 * job_sites.supervisor_contact_id, which is why changing a job's builder
 * clears that link: otherwise the phone would keep showing the old builder's
 * person on the new builder's job.
 *
 * Every write is read back. RLS turns a refused UPDATE or DELETE into a
 * successful response with no rows, which must read as "refused", never as
 * done.
 */
import { builderOf, supabase, type JobSiteRow } from '../phone'
import { CONTACT_LABEL, ONE_PER_BUILDER, type ContactRole } from './contract'
import type { Db, WriteOpts } from './jobs'

/** A builder as the website needs it. */
export interface BuilderRef {
  id: string
  name: string
}

export interface BuilderRecord extends BuilderRef {
  created_at: string
  active?: boolean
}

/** A builder_contacts row, as the phone reads it. */
export interface ContactRow {
  id: string
  builder_id: string
  role: ContactRole | 'accounts' | 'estimator' | 'other'
  name: string
  mobile: string | null
  email: string | null
  note: string | null
}

/** One person typed into a form. A blank name means "nobody in this role". */
export interface ContactDraft {
  /** The existing contact this edits, if any. */
  id?: string | null
  name: string
  mobile?: string | null
  email?: string | null
}

export const CONTACT_COLS = 'id, builder_id, role, name, mobile, email, note'

const db = (opts?: WriteOpts): Db => opts?.client ?? supabase()

/** Only an owner login can set up jobs, and RLS says so by returning nothing. */
export const refused = (what: string) => `${what} was refused. Only an owner login can set up jobs.`

/** Same name for a person: case, outer spaces and runs of spaces do not count. */
export const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === (b ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * A literal for `ilike`: Postgres LIKE treats % and _ as wildcards and \ as
 * the escape, so all three are escaped. A builder called "100% Tiling" must
 * match itself and not "100 Tiling Group".
 *
 * PostgREST also reads * as a wildcard and has no escape for it, so an
 * ilike can still over-match on a name with a *; findOrCreateBuilder
 * compares the rows it gets back exactly, case aside.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// ------------------------------------------------------------ suggestions

export interface BuilderSuggestion {
  /** The record's name when there is one, else the most common spelling on jobs. */
  name: string
  /** Null for a name typed on jobs with no builders row behind it yet. */
  builderId: string | null
  /** Jobs for this builder: linked to the record, or unlinked with the same name. */
  jobs: Array<Pick<JobSiteRow, 'id' | 'name' | 'status'>>
}

type SiteLite = Pick<JobSiteRow, 'id' | 'name' | 'status' | 'client_name' | 'builder_id'>

/**
 * What the builder picker offers: every builders row, plus every distinct
 * client_name typed on a job (the phone's New project sheet and Project
 * details only ever write the name). Names are matched case-insensitively;
 * when two records share a name the oldest wins, as findOrCreateBuilder
 * decides. Sorted by name.
 */
export function suggestionsOf(builders: BuilderRecord[], sites: SiteLite[]): BuilderSuggestion[] {
  const oldestFirst = [...builders].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
  const byKey = new Map<string, BuilderSuggestion>()
  const keyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
  const byId = new Map<string, BuilderSuggestion>()
  for (const b of oldestFirst) {
    const k = keyOf(b.name)
    if (!k) continue
    const existing = byKey.get(k)
    if (existing) {
      byId.set(b.id, existing)
      continue
    }
    const sug: BuilderSuggestion = { name: b.name.trim(), builderId: b.id, jobs: [] }
    byKey.set(k, sug)
    byId.set(b.id, sug)
  }
  for (const site of sites) {
    const linked = site.builder_id ? byId.get(site.builder_id) : undefined
    const named = builderOf(site)
    const sug = linked ?? (named ? byKey.get(keyOf(named)) : undefined)
    if (sug) {
      sug.jobs.push({ id: site.id, name: site.name, status: site.status })
    } else if (named) {
      const fresh: BuilderSuggestion = { name: named, builderId: null, jobs: [{ id: site.id, name: site.name, status: site.status }] }
      byKey.set(keyOf(named), fresh)
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Load the picker's list. Archived jobs count: a builder is still a builder after the job is done. */
export async function loadBuilderSuggestions(opts?: WriteOpts): Promise<BuilderSuggestion[]> {
  const c = db(opts)
  const [b, s] = await Promise.all([
    c.from('builders').select('id, name, created_at, active').order('created_at'),
    c.from('job_sites').select('id, name, status, client_name, builder_id'),
  ])
  if (b.error) throw new Error(b.error.message)
  if (s.error) throw new Error(s.error.message)
  return suggestionsOf((b.data ?? []) as BuilderRecord[], (s.data ?? []) as SiteLite[])
}

// ------------------------------------------------------------- find or create

/**
 * The company's builder with this name (case aside), or a new one.
 *
 * ilike with the name escaped, oldest first, then an exact comparison of
 * what came back, so the oldest record of that name wins and a second
 * spelling of the same builder ("paramoint") never becomes a second row. The
 * insert is {company_id, name}, the same shape the phone inserts.
 */
export async function findOrCreateBuilder(companyId: string, name: string, opts?: WriteOpts): Promise<BuilderRef & { created: boolean }> {
  const wanted = name.trim().replace(/\s+/g, ' ')
  if (!wanted) throw new Error('A builder needs a name.')
  const c = db(opts)
  const found = await c
    .from('builders')
    .select('id, name, created_at')
    .ilike('name', escapeLike(wanted))
    .order('created_at')
    .order('id')
  if (found.error) throw new Error(found.error.message)
  const match = ((found.data ?? []) as BuilderRecord[]).find((b) => sameName(b.name, wanted))
  if (match) return { id: match.id, name: match.name, created: false }

  const made = await c.from('builders').insert({ company_id: companyId, name: wanted }).select('id, name, created_at').single()
  if (made.error) throw new Error(made.error.message)
  const row = made.data as BuilderRecord | null
  if (!row?.id) throw new Error(refused('Adding the builder'))
  return { id: row.id, name: row.name, created: true }
}

// ------------------------------------------------------------------- contacts

/** The builder's contacts, oldest first. */
export async function loadContacts(builderId: string, opts?: WriteOpts): Promise<ContactRow[]> {
  const { data, error } = await db(opts).from('builder_contacts').select(CONTACT_COLS).eq('builder_id', builderId).order('created_at').order('id')
  if (error) throw new Error(error.message)
  return (data ?? []) as ContactRow[]
}

export interface SaveContactArgs {
  companyId: string
  builderId: string
  role: ContactRole
  draft: ContactDraft
}

export interface SaveContactResult {
  /** 'unchanged': the person was already on file exactly so, and nothing was written. */
  action: 'inserted' | 'updated' | 'unchanged' | 'deleted' | 'none'
  /** The row as read back (or as on file, when unchanged); null when deleted or nothing was there. */
  contact: ContactRow | null
  /** Set when what was done is not quite what was asked, for the person: the contact being edited had been removed. */
  note?: string
}

/**
 * The builder already has someone in a role the phone holds one of per
 * builder (ONE_PER_BUILDER), and the draft names somebody else. Nothing was
 * written. To replace them, save the draft again with the holder's id: that
 * renames the builder's one project manager (or contract administrator),
 * which changes it on every job for the builder, as the phone's own editor
 * does.
 *
 * `replacedGone`: the draft was itself such a replacement, but the person it
 * was to replace is no longer on file (removed on a phone, say), and the
 * holder now is somebody else again.
 */
export class RoleTakenError extends Error {
  role: ContactRole
  holder: ContactRow
  replacedGone: boolean
  constructor(role: ContactRole, holder: ContactRow, typed: string, replacedGone = false) {
    const label = CONTACT_LABEL[role].toLowerCase()
    super(
      `${replacedGone ? `The ${label} this was to replace is no longer on file. ` : ''}This builder's ${label} is ${holder.name}, on every job for them, so ${typed} was not added as a second one.`,
    )
    this.name = 'RoleTakenError'
    this.role = role
    this.holder = holder
    this.replacedGone = replacedGone
  }
}

const roleLabel = (role: string) => (CONTACT_LABEL[role as ContactRole] ?? role).toLowerCase()

/** One contact by id, or null when there is none (deleted, or not this company's). */
async function contactById(c: Db, id: string): Promise<ContactRow | null> {
  const { data, error } = await c.from('builder_contacts').select(CONTACT_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ContactRow | null) ?? null
}

/**
 * A write by id, limited to this builder and role, touched no row. Returns
 * when that is because the contact is gone. Throws when it is somebody
 * else's person (a draft id must never quietly edit another builder's
 * contact, or turn a supervisor into a project manager), and when the row
 * is there and the write was refused.
 */
async function whyUntouched(c: Db, id: string, builderId: string, role: ContactRole, what: string): Promise<void> {
  const row = await contactById(c, id)
  if (!row) return
  if (row.builder_id !== builderId) throw new Error(`${row.name} belongs to another builder, so they were not changed here.`)
  if (row.role !== role) throw new Error(`${row.name} is this builder's ${roleLabel(row.role)}, not their ${roleLabel(role)}, so they were not changed.`)
  throw new Error(refused(what))
}

/**
 * Write some of a builder's contact's columns and read them back as sent.
 * Only a contact of this builder in this role is written. Null when the
 * contact is no longer on file.
 */
async function editContact(
  c: Db,
  id: string,
  builderId: string,
  role: ContactRole,
  patch: Partial<Pick<ContactRow, 'name' | 'mobile' | 'email'>>,
): Promise<ContactRow | null> {
  const up = await c.from('builder_contacts').update(patch).eq('id', id).eq('builder_id', builderId).eq('role', role).select(CONTACT_COLS)
  if (up.error) throw new Error(up.error.message)
  const row = ((up.data ?? []) as ContactRow[])[0]
  if (!row) {
    await whyUntouched(c, id, builderId, role, 'Saving the contact')
    return null
  }
  for (const [k, v] of Object.entries(patch)) {
    if (row[k as keyof ContactRow] !== v) throw new Error('The contact did not save as typed. Try again.')
  }
  return row
}

/**
 * Save one of the builder's people, as the phone's Project details does
 * (Overview.tsx DetailEditor).
 *
 * With an id, that person is edited exactly as typed, blanks as null, which
 * is the phone's editor: a blank name deletes them. Only this builder's
 * contact in this role is touched; an id naming anyone else throws. When
 * the person is no longer on file (removed on a phone since the form or the
 * create issue was made), a blank name has nothing left to do, and a name
 * is saved by the rules below as if typed fresh, with a note saying so.
 * RLS refusing the write is told apart from that by looking the row up.
 *
 * Without an id, the draft is somebody typed into a form, and the builder's
 * people in that role are looked at first, because they belong to the
 * builder and show on every job for it:
 *   - Someone of the same name (case and spacing aside) is that person. Only
 *     what was typed is added: the spelling on file stays, and a mobile or
 *     email left blank leaves the one on file alone. Typing "sam taylor" on a
 *     second job must not wipe Sam Taylor's number from the first.
 *   - A project manager or contract administrator with a different name
 *     throws RoleTakenError and writes nothing. The phone shows the first one
 *     per role and edits only that one, so a second would be saved but never
 *     shown anywhere.
 *   - Otherwise a row {company_id, builder_id, role, name, mobile, email} is
 *     inserted. Site supervisors are per job (job_sites.supervisor_contact_id),
 *     so a builder may have several.
 */
export async function saveContact({ companyId, builderId, role, draft }: SaveContactArgs, opts?: WriteOpts): Promise<SaveContactResult> {
  const c = db(opts)
  const name = draft.name.trim()
  const typed = { mobile: (draft.mobile ?? '').trim() || null, email: (draft.email ?? '').trim() || null }
  const label = roleLabel(role)

  if (!name) {
    if (!draft.id) return { action: 'none', contact: null }
    const gone = await c.from('builder_contacts').delete().eq('id', draft.id).eq('builder_id', builderId).eq('role', role).select('id')
    if (gone.error) throw new Error(gone.error.message)
    if ((gone.data ?? []).length === 1) return { action: 'deleted', contact: null }
    await whyUntouched(c, draft.id, builderId, role, 'Removing the contact')
    return { action: 'none', contact: null, note: `The ${label} had already been removed.` }
  }

  // The person being edited, if they are still on file.
  let replacing = false
  if (draft.id) {
    const row = await editContact(c, draft.id, builderId, role, { name, ...typed })
    if (row) return { action: 'updated', contact: row }
    replacing = true
  }
  const gone = `The ${label} this was to replace is no longer on file`

  const same = await c.from('builder_contacts').select(CONTACT_COLS).eq('builder_id', builderId).eq('role', role).order('created_at').order('id')
  if (same.error) throw new Error(same.error.message)
  const onFile = (same.data ?? []) as ContactRow[]
  // In a one-per-builder role only the first is ever shown, so only the first can be "the same person".
  const oneOnly = ONE_PER_BUILDER.includes(role)

  const match = (oneOnly ? onFile.slice(0, 1) : onFile).find((x) => sameName(x.name, name))
  if (match) {
    const note = replacing ? `${gone}, and ${match.name} already is.` : undefined
    const add: Partial<Pick<ContactRow, 'mobile' | 'email'>> = {}
    if (typed.mobile && typed.mobile !== match.mobile) add.mobile = typed.mobile
    if (typed.email && typed.email !== match.email) add.email = typed.email
    if (Object.keys(add).length === 0) return { action: 'unchanged', contact: match, ...(note && { note }) }
    const row = await editContact(c, match.id, builderId, role, add)
    if (!row) throw new Error(`${match.name} was removed while this was saving. Try again.`)
    return { action: 'updated', contact: row, ...(note && { note }) }
  }

  const holder = oneOnly ? onFile[0] : undefined
  if (holder) throw new RoleTakenError(role, holder, name, replacing)

  const made = await c
    .from('builder_contacts')
    .insert({ company_id: companyId, builder_id: builderId, role, name, ...typed })
    .select(CONTACT_COLS)
    .single()
  if (made.error) throw new Error(made.error.message)
  const row = made.data as ContactRow | null
  if (!row?.id) throw new Error(refused('Saving the contact'))
  return { action: 'inserted', contact: row, ...(replacing && { note: `${gone}, so ${name} was added as the ${label}.` }) }
}

/** What a job's supervisor link needs to know about the contact. */
export type SupervisorRef = Pick<ContactRow, 'id' | 'builder_id' | 'role' | 'name'>

/**
 * Why this contact cannot be the site supervisor of a job on this builder,
 * in words for the person, or null when they can. The phone's Safety and
 * Waterproofing screens send a job's SWMS and certificates to the job's
 * supervisor (job_sites.supervisor_contact_id), and Project details shows
 * them with a call button, so another builder's person here is the wrong
 * person rung and emailed. Pure.
 */
export function notSupervisorFor(contact: SupervisorRef | null, builderId: string | null, builderName?: string | null): string | null {
  if (!contact) return 'That site supervisor is no longer on file. Pick another, or add them.'
  if (contact.role !== 'supervisor') return `${contact.name} is the builder's ${roleLabel(contact.role)}, not a site supervisor.`
  if (!builderId) return "Pick the job's builder first: a site supervisor is one of the builder's people."
  if (contact.builder_id !== builderId) return `${contact.name} is a site supervisor for another builder, not for ${builderName?.trim() || "this job's builder"}.`
  return null
}

/**
 * Point a job at its site supervisor (or at nobody), read back. The contact
 * must be a site supervisor of the job's builder (notSupervisorFor), so the
 * update only matches while the job is on that builder: a job whose builder
 * changed a moment ago is refused, not given the old builder's person. Pass
 * the contact row when it is in hand (createJob has just saved it); an id is
 * looked up first.
 */
export async function setJobSupervisor(siteId: string, who: string | SupervisorRef | null, opts?: WriteOpts): Promise<void> {
  const c = db(opts)
  const sup = who === null ? null : typeof who === 'string' ? await contactById(c, who) : who
  if (who !== null) {
    // Existence and role here; the builder is the update's own condition.
    const why = notSupervisorFor(sup, sup?.builder_id ?? null)
    if (why) throw new Error(why)
  }
  let q = c.from('job_sites').update({ supervisor_contact_id: sup?.id ?? null }).eq('id', siteId)
  if (sup) q = q.eq('builder_id', sup.builder_id)
  const { data, error } = await q.select('id, supervisor_contact_id')
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as Array<{ supervisor_contact_id: string | null }>)[0]
  if (!row) {
    if (sup) {
      const job = await c.from('job_sites').select('builder_id, client_name').eq('id', siteId).maybeSingle()
      if (job.error) throw new Error(job.error.message)
      const j = job.data as Pick<JobSiteRow, 'builder_id' | 'client_name'> | null
      const why = j && notSupervisorFor(sup, j.builder_id, builderOf(j))
      if (why) throw new Error(why)
    }
    throw new Error(refused('Linking the site supervisor'))
  }
  if (row.supervisor_contact_id !== (sup?.id ?? null)) throw new Error('The site supervisor link did not save. Try again.')
}

/**
 * Who the phone's Project details shows for a job (Overview.tsx
 * ProjectDetails): the job's own supervisor first, then the builder's
 * contacts, one per role, first come first served. The builder is the job's
 * builder_id, or failing that the supervisor's builder.
 */
export function contactsOf(
  site: Pick<JobSiteRow, 'builder_id' | 'supervisor_contact_id'>,
  supervisor: ContactRow | null,
  builderContacts: ContactRow[],
): { builderId: string | null; byRole: Record<ContactRole, ContactRow | null>; all: ContactRow[] } {
  const builderId = site.builder_id ?? supervisor?.builder_id ?? null
  const all = supervisor ? [supervisor, ...builderContacts.filter((r) => r.id !== supervisor.id)] : builderContacts
  const first = (role: ContactRole) => all.find((x) => x.role === role) ?? null
  return { builderId, byRole: { project_manager: first('project_manager'), supervisor: first('supervisor'), contract_admin: first('contract_admin') }, all }
}

// ------------------------------------------------------- the job's builder

/**
 * The columns a change of builder writes, together: the record, its name as
 * the job's client_name, and no supervisor when the builder really changed
 * (a different record, or for a job with no record, a different name).
 * Pass null for "no builder".
 */
export function builderPatch(
  site: Pick<JobSiteRow, 'builder_id' | 'client_name' | 'supervisor_contact_id'>,
  builder: BuilderRef | null,
): Partial<Pick<JobSiteRow, 'builder_id' | 'client_name' | 'supervisor_contact_id'>> {
  const patch: Partial<Pick<JobSiteRow, 'builder_id' | 'client_name' | 'supervisor_contact_id'>> = {}
  const nextId = builder?.id ?? null
  const nextName = builder ? builder.name : null
  if (nextId !== site.builder_id) patch.builder_id = nextId
  if (nextName !== site.client_name) patch.client_name = nextName
  if (changesBuilder(site, nextId, nextName) && site.supervisor_contact_id) patch.supervisor_contact_id = null
  return patch
}

/** Is this a different builder, rather than the same one linked or respelled? */
export function changesBuilder(site: Pick<JobSiteRow, 'builder_id' | 'client_name'>, nextId: string | null, nextName: string | null): boolean {
  if (site.builder_id) return nextId !== site.builder_id
  // No record yet: linking the same name to a record is not a change of builder.
  return !sameName(site.client_name, nextName)
}

/**
 * Set a job's builder by name: find or create the record, then write
 * builder_id, client_name and (if the builder changed) a cleared supervisor,
 * in one update, read back. A blank name takes the builder off the job.
 */
export async function setJobBuilder(
  companyId: string,
  site: Pick<JobSiteRow, 'id' | 'builder_id' | 'client_name' | 'supervisor_contact_id'>,
  name: string,
  opts?: WriteOpts,
): Promise<{ builder: BuilderRef | null; site: JobSiteRow }> {
  const builder = name.trim() ? await findOrCreateBuilder(companyId, name, opts) : null
  const patch = builderPatch(site, builder)
  const c = db(opts)
  const { data, error } = Object.keys(patch).length
    ? await c.from('job_sites').update(patch).eq('id', site.id).select('*')
    : await c.from('job_sites').select('*').eq('id', site.id)
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as JobSiteRow[])[0]
  if (!row) throw new Error(refused('Changing the builder'))
  for (const [k, v] of Object.entries(patch)) {
    if (row[k as keyof JobSiteRow] !== v) throw new Error('The builder did not save. Try again.')
  }
  return { builder: builder ? { id: builder.id, name: builder.name } : null, site: row }
}

// ----------------------------------------------------------- other jobs

/**
 * Other jobs that go by this builder's name but are not linked to its record:
 * what "also link N other jobs with this builder name" offers. The phone
 * only ever typed names, so a company's earlier jobs for the same builder
 * are usually like this.
 */
export function linkCandidates<T extends Pick<JobSiteRow, 'id' | 'client_name' | 'builder_id'>>(sites: T[], builder: BuilderRef, exceptId?: string): T[] {
  return sites.filter((s) => s.id !== exceptId && s.builder_id !== builder.id && sameName(builderOf(s), builder.name))
}

/** A job linkOtherJobs left alone because, when it looked, the job no longer went by the builder's name. */
export interface LinkSkip {
  id: string
  name: string
  /** The builder the job shows now (builderOf); '' for none. */
  now: string
}

export interface LinkResult {
  /** Linked to the record, as read back (or already linked to it, under its name). */
  linked: string[]
  /** Not written: their builder changed after they were offered. */
  skipped: LinkSkip[]
}

type LinkRow = Pick<JobSiteRow, 'id' | 'name' | 'builder_id' | 'client_name' | 'supervisor_contact_id'>

/**
 * Link those jobs to the record: builder_id, and client_name copied from
 * builders.name. A job that was linked to a different record of the same
 * name loses its supervisor link, which belonged to that other record.
 *
 * The jobs are read again first and only those that still go by the
 * builder's name (linkCandidates) are written. The list was made earlier (a
 * form's load, a create issue retried later), and a job whose builder was
 * changed since, on a phone or here, must keep that change: linking it would
 * put it back on this builder and undo it. Those come back in `skipped`; a
 * job already linked to the record under its name counts as linked; a job no
 * longer there is dropped. Throws naming how many did not read back linked.
 */
export async function linkOtherJobs(builder: BuilderRef, jobs: Array<Pick<JobSiteRow, 'id'>>, opts?: WriteOpts): Promise<LinkResult> {
  if (jobs.length === 0) return { linked: [], skipped: [] }
  const c = db(opts)
  const read = await c
    .from('job_sites')
    .select('id, name, builder_id, client_name, supervisor_contact_id')
    .in('id', jobs.map((j) => j.id))
  if (read.error) throw new Error(read.error.message)
  const rows = (read.data ?? []) as LinkRow[]
  const todo = linkCandidates(rows, builder)
  const already = rows.filter((r) => r.builder_id === builder.id && sameName(builderOf(r), builder.name))
  const skipped: LinkSkip[] = rows
    .filter((r) => !todo.includes(r) && !already.includes(r))
    .map((r) => ({ id: r.id, name: r.name, now: builderOf(r) }))

  const linked: string[] = already.map((r) => r.id)
  const failed: string[] = []
  // Two groups: jobs whose supervisor belongs to another record lose it.
  const clearing = todo.filter((j) => j.builder_id && j.builder_id !== builder.id && j.supervisor_contact_id)
  const keeping = todo.filter((j) => !clearing.includes(j))
  for (const [group, extra] of [
    [keeping, {}],
    [clearing, { supervisor_contact_id: null }],
  ] as const) {
    if (group.length === 0) continue
    const ids = group.map((j) => j.id)
    const { data, error } = await c
      .from('job_sites')
      .update({ builder_id: builder.id, client_name: builder.name, ...extra })
      .in('id', ids)
      .select('id, builder_id, client_name')
    if (error) throw new Error(error.message)
    const ok = new Set(
      ((data ?? []) as Array<{ id: string; builder_id: string | null; client_name: string | null }>)
        .filter((r) => r.builder_id === builder.id && r.client_name === builder.name)
        .map((r) => r.id),
    )
    for (const id of ids) (ok.has(id) ? linked : failed).push(id)
  }
  if (failed.length) {
    throw Object.assign(new Error(`${failed.length} job${failed.length === 1 ? '' : 's'} could not be linked to ${builder.name}. ${refused('Linking')}`), {
      linked,
      failed,
      skipped,
    })
  }
  return { linked, skipped }
}

/** What to tell the person about jobs linkOtherJobs left alone, or null when there were none. */
export function linkSkipNote(skipped: LinkSkip[], builderName: string): string | null {
  if (skipped.length === 0) return null
  const each = (s: LinkSkip) => `${s.name.trim() || 'a job'} (${s.now ? `now ${s.now}` : 'no builder now'})`
  const one = skipped.length === 1
  return `Not linked to ${builderName.trim()}, because ${one ? "that job's builder has" : "those jobs' builders have"} changed since: ${skipped.map(each).join(', ')}.`
}

// ------------------------------------------------------------------- drift

/**
 * The phone's Project details edits client_name without touching
 * builder_id, so a job can come to say one builder while linked to another
 * record. The website shows the job as the phone does (builderOf) and flags
 * the difference instead of fixing it silently.
 */
export function driftOf(site: Pick<JobSiteRow, 'client_name' | 'builder_id'>, builder: BuilderRef | null): { onJob: string; record: string } | null {
  if (!builder || !site.builder_id || builder.id !== site.builder_id) return null
  const onJob = builderOf(site)
  return onJob === builder.name.trim() ? null : { onJob, record: builder.name }
}
