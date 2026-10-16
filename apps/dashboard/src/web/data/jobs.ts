/**
 * Making and changing jobs: the website's only writer of job_sites.
 *
 * A web-made job has to be, row for row, a job the phone could have made, so
 * the insert is the phone's New project sheet insert (contract.ts
 * PHONE_INSERT_KEYS, with its blanks) plus only columns the phone already
 * reads but has no way to set when a job is created: colour, builder_id,
 * captain_id and the dates. It never writes schedule_note, budget,
 * progress_pct, contract_value or builder_job_ref, and never a channel: the
 * job_sites_channel trigger makes the job's chat channel in the same
 * transaction as the insert.
 *
 * createJob is several requests, not one transaction (that would need a
 * database function, and v1 makes no migrations). So each step is read back
 * and reported on its own, a failed step after the job exists never undoes
 * the job, and nothing here ever deletes a job: deleting cascades through a
 * job's history. The issues it returns are stashed for the job page, which
 * names what did not save and offers to retry it.
 *
 * Every write is read back. RLS turns a refused UPDATE into a success with
 * no rows; that reads here as refused, never as done.
 */
import { builderOf, JOB_COLOURS, supabase, type JobSiteRow } from '../phone'
import { bookCrew, type BookResult } from './bookings'
import {
  builderPatch,
  changesBuilder,
  CONTACT_COLS,
  findOrCreateBuilder,
  linkOtherJobs,
  linkSkipNote,
  notSupervisorFor,
  refused,
  RoleTakenError,
  sameName,
  saveContact,
  setJobSupervisor,
  type BuilderRef,
  type ContactDraft,
  type ContactRow,
  type LinkSkip,
} from './builders'
import { CONTACT_LABEL, CONTACT_ROLES, PHONE_NEW_STATUS, RADIUS_MAX, RADIUS_MIN, type ContactRole } from './contract'
import { saveContractValue } from './contractValue'

/** The Supabase client. Every write takes an optional one, so tests can pass a fake. */
export type Db = ReturnType<typeof supabase>
export interface WriteOpts {
  client?: Db
}

const db = (opts?: WriteOpts): Db => opts?.client ?? supabase()

export type JobStatus = JobSiteRow['status']
export const JOB_STATUSES: JobStatus[] = ['active', 'starting_soon', 'archived']

/** A form's input that cannot be saved as it stands. The message is for the person. */
export class JobInputError extends Error {
  field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'JobInputError'
    this.field = field
  }
}

// ----------------------------------------------------------------- the insert

export interface JobDraft {
  name: string
  /** What the work is (job_type). */
  workType?: string | null
  address?: string | null
  /** The builder as typed. Ignored when a builder record is passed to buildJobInsert. */
  builderName?: string | null
  /** One of JOB_COLOURS. */
  colour: string
  fence: { lat: number; lng: number; radiusM: number }
  /** A new job is Future unless "Active now" is picked. */
  status?: 'starting_soon' | 'active'
  /** Local YYYY-MM-DD. */
  startsOn?: string | null
  endsOn?: string | null
  /** A role 'captain' worker. */
  captainId?: string | null
}

/** The job_sites row a web-made job is inserted as. */
export interface JobInsert {
  company_id: string
  name: string
  address: string
  client_name: string | null
  job_type: string
  status: 'starting_soon' | 'active'
  lat: number
  lng: number
  radius_m: number
  colour: string
  builder_id: string | null
  captain_id: string | null
  starts_on: string | null
  ends_on: string | null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD, or null for blank. */
function dayOrNull(field: string, v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  const d = new Date(`${t}T00:00:00`)
  if (!ISO_DAY.test(t) || Number.isNaN(d.getTime()) || d.getDate() !== Number(t.slice(8))) throw new JobInputError(field, 'Dates are written YYYY-MM-DD.')
  return t
}

/** The canonical JOB_COLOURS entry for a colour, or an error. Case does not matter. */
export function jobColourOf(colour: string | null | undefined): string {
  const hit = JOB_COLOURS.find((c) => c.toLowerCase() === (colour ?? '').trim().toLowerCase())
  if (!hit) throw new JobInputError('colour', 'Pick one of the job colours.')
  return hit
}

/** A fence radius the phone's slider can show: a whole number of metres, 25 to 600. */
export function radiusOf(radiusM: number): number {
  if (!Number.isInteger(radiusM) || radiusM < RADIUS_MIN || radiusM > RADIUS_MAX) {
    throw new JobInputError('radius_m', `The fence radius is a whole number of metres from ${RADIUS_MIN} to ${RADIUS_MAX}.`)
  }
  return radiusM
}

function pointOf(lat: number, lng: number): { lat: number; lng: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new JobInputError('fence', 'Place the fence on the map first.')
  }
  return { lat, lng }
}

function datesOf(startsOn: string | null | undefined, endsOn: string | null | undefined): { starts_on: string | null; ends_on: string | null } {
  const starts_on = dayOrNull('starts_on', startsOn)
  const ends_on = dayOrNull('ends_on', endsOn)
  if (starts_on && ends_on && ends_on < starts_on) throw new JobInputError('ends_on', 'The end date is before the start date.')
  return { starts_on, ends_on }
}

/**
 * The job_sites insert for a draft, or a JobInputError saying what is wrong.
 * Pure. The phone's nine keys come out with the phone's blanks (address and
 * job_type '' never null, client_name null when blank); when a builder
 * record is linked, client_name is its name exactly.
 */
export function buildJobInsert(companyId: string, draft: JobDraft, builder: BuilderRef | null = null): JobInsert {
  const name = draft.name.trim()
  if (!name) throw new JobInputError('name', 'The job needs a name.')
  if (!companyId) throw new JobInputError('company_id', 'Your account has no company.')
  const status = draft.status ?? PHONE_NEW_STATUS
  if (status !== 'starting_soon' && status !== 'active') throw new JobInputError('status', 'A new job is Future or Active.')
  const { lat, lng } = pointOf(draft.fence.lat, draft.fence.lng)
  return {
    company_id: companyId,
    name,
    address: (draft.address ?? '').trim(),
    client_name: builder ? builder.name : (draft.builderName ?? '').trim() || null,
    job_type: (draft.workType ?? '').trim(),
    status,
    lat,
    lng,
    radius_m: radiusOf(draft.fence.radiusM),
    colour: jobColourOf(draft.colour),
    builder_id: builder?.id ?? null,
    captain_id: draft.captainId || null,
    ...datesOf(draft.startsOn, draft.endsOn),
  }
}

// -------------------------------------------------------------- create issues

/** A step of createJob after the job itself. */
export type CreateStep = 'builder' | 'job' | 'contact' | 'supervisor' | 'crew' | 'link'

/**
 * Something createJob could not do, with what is needed to try it again.
 * Stashed in sessionStorage as JSON for the job page (crewline.createIssues.<siteId>).
 */
export type CreateIssue =
  | { step: 'builder'; message: string; builderName: string }
  | { step: 'job'; message: string }
  | {
      step: 'contact'
      message: string
      role: ContactRole
      draft: ContactDraft
      /** The builder record the person was typed for; null when there was none to save against. */
      builderId: string | null
      /** With no record: the builder name typed, so a retry saves the person only under that builder. */
      builderName?: string | null
    }
  | { step: 'supervisor'; message: string; contactId: string }
  | { step: 'crew'; message: string; workerIds: string[]; from: string; to: string }
  | { step: 'link'; message: string; builder: BuilderRef; jobIds: string[] }
  | { step: 'contract'; message: string; sum: number; gstInclusive: boolean }

/** What an issue is about, in the words the job page uses. */
export function issueLabel(issue: CreateIssue): string {
  switch (issue.step) {
    case 'builder':
      return 'Builder'
    case 'job':
      return 'Job'
    case 'contact':
      return CONTACT_LABEL[issue.role]
    case 'supervisor':
      return CONTACT_LABEL.supervisor
    case 'crew':
      return 'Crew booking'
    case 'link':
      return 'Other jobs for this builder'
    case 'contract':
      return 'Contract value'
  }
}

const STASH = (siteId: string) => `crewline.createIssues.${siteId}`

const isIssue = (x: unknown): x is CreateIssue => {
  if (!x || typeof x !== 'object') return false
  const i = x as Record<string, unknown>
  if (typeof i.message !== 'string') return false
  switch (i.step) {
    case 'builder':
      return typeof i.builderName === 'string'
    case 'job':
      return true
    case 'contact':
      return typeof i.role === 'string' && i.role in CONTACT_LABEL && !!i.draft && typeof (i.draft as ContactDraft).name === 'string'
    case 'supervisor':
      return typeof i.contactId === 'string'
    case 'crew':
      return Array.isArray(i.workerIds) && typeof i.from === 'string' && typeof i.to === 'string'
    case 'link':
      return !!i.builder && Array.isArray(i.jobIds)
    case 'contract':
      return typeof i.sum === 'number' && typeof i.gstInclusive === 'boolean'
    default:
      return false
  }
}

/**
 * Keep a new job's issues for its page, across the navigation from the form.
 * An empty list clears them. Storage that is unavailable (a private window,
 * blocked site data) loses them quietly: the job itself is saved either way.
 */
export function stashCreateIssues(siteId: string, issues: CreateIssue[]): void {
  try {
    if (issues.length === 0) sessionStorage.removeItem(STASH(siteId))
    else sessionStorage.setItem(STASH(siteId), JSON.stringify(issues))
  } catch {
    /* storage unavailable */
  }
}

/** Read the stashed issues without removing them (anything malformed is dropped). */
export function peekCreateIssues(siteId: string): CreateIssue[] {
  try {
    const raw = sessionStorage.getItem(STASH(siteId))
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter(isIssue) : []
  } catch {
    return []
  }
}

/** Read and remove the stashed issues. */
export function takeCreateIssues(siteId: string): CreateIssue[] {
  const out = peekCreateIssues(siteId)
  try {
    sessionStorage.removeItem(STASH(siteId))
  } catch {
    /* storage unavailable */
  }
  return out
}

// ------------------------------------------------------------------- create

export interface CreateJobInput extends JobDraft {
  /** The builder's people, by role. Saved against the builder. */
  contacts?: Partial<Record<ContactRole, ContactDraft>>
  /** Book these people for the working days in from..to (local, inclusive). */
  crew?: { workerIds: string[]; from: string; to: string } | null
  /**
   * Other jobs to link to the same builder record (builders.ts
   * linkCandidates). Only the ids are used: each job is read again, and one
   * whose builder changed after it was offered is left alone (notLinked).
   */
  linkJobs?: Array<Pick<JobSiteRow, 'id'>>
  /** The contract value (contractValue.ts), saved once the job exists. */
  contract?: { sum: number; gstInclusive: boolean } | null
}

export interface CreateJobResult {
  /** The job as read back, or null when the job itself could not be saved. */
  site: JobSiteRow | null
  /** What did not save, step by step. Empty when everything did. */
  issues: CreateIssue[]
  builder: (BuilderRef & { created: boolean }) | null
  contacts: Partial<Record<ContactRole, ContactRow>>
  booking: BookResult | null
  linked: string[]
  /** linkJobs left alone because their builder changed after they were offered (linkSkipNote says so). */
  notLinked: LinkSkip[]
}

/**
 * Make a job, in order, each step read back:
 *   1. find or create the builder (by name, case aside)
 *   2. insert job_sites with builder_id and client_name = builders.name
 *   3. save the builder's people
 *   4. point the job at its site supervisor
 *   5. book the crew
 *   6. link other jobs with the builder's name, if asked and if, read
 *      again, they still go by it (the rest come back in notLinked)
 *   7. save the contract value (contractValue.ts), if one was typed
 * A failure at 1 still makes the job, with the builder name as typed. A
 * failure at 2 stops (nothing else is attempted, and the result has no
 * site). A failure after 2 is an issue; the job stays. Input errors throw
 * JobInputError before anything is written.
 *
 * The builder's people are the builder's, on every job for it (saveContact):
 * a name already on file is that person, and only what was typed is added to
 * them; a project manager or contract administrator other than the one on
 * file is not saved but comes back as an issue naming who is, which a retry
 * turns into replacing them.
 */
export async function createJob(me: { company_id: string }, input: CreateJobInput, opts?: WriteOpts): Promise<CreateJobResult> {
  const c = db(opts)
  const issues: CreateIssue[] = []
  const result: CreateJobResult = { site: null, issues, builder: null, contacts: {}, booking: null, linked: [], notLinked: [] }

  // Everything checkable is checked before the first write.
  buildJobInsert(me.company_id, input)
  const crew = input.crew && input.crew.workerIds.length > 0 ? input.crew : null
  if (crew && (!ISO_DAY.test(crew.from) || !ISO_DAY.test(crew.to) || crew.from > crew.to)) {
    throw new JobInputError('crew', 'Pick the days to book the crew for.')
  }

  // 1. The builder.
  const builderName = (input.builderName ?? '').trim()
  if (builderName) {
    try {
      result.builder = await findOrCreateBuilder(me.company_id, builderName, opts)
    } catch (e) {
      issues.push({ step: 'builder', message: messageOf(e), builderName })
    }
  }

  // 2. The job.
  const row = buildJobInsert(me.company_id, input, result.builder)
  const made = await c.from('job_sites').insert(row).select('*').single()
  if (made.error || !made.data) {
    issues.push({ step: 'job', message: made.error?.message ?? refused('Saving the job') })
    return result
  }
  const site = made.data as JobSiteRow
  result.site = site
  const off = (Object.keys(row) as Array<keyof JobInsert>).filter((k) => site[k as keyof JobSiteRow] !== row[k])
  if (off.length) issues.push({ step: 'job', message: `The job saved, but ${off.join(', ')} did not save as entered.` })

  // 3 and 4. The builder's people, and the job's supervisor.
  for (const role of CONTACT_ROLES) {
    const draft = input.contacts?.[role]
    if (!draft || !draft.name.trim()) continue
    const builderId = result.builder?.id ?? null
    if (!builderId) {
      issues.push({ step: 'contact', role, draft, builderId: null, builderName: builderName || null, message: 'Contacts belong to a builder, and this job has no builder record.' })
      continue
    }
    try {
      const saved = await saveContact({ companyId: me.company_id, builderId, role, draft }, opts)
      if (saved.contact) result.contacts[role] = saved.contact
    } catch (e) {
      issues.push(contactIssue(role, draft, builderId, result.builder?.name ?? null, e))
    }
  }
  const sup = result.contacts.supervisor
  if (sup) {
    try {
      await setJobSupervisor(site.id, sup, opts)
      site.supervisor_contact_id = sup.id
    } catch (e) {
      issues.push({ step: 'supervisor', contactId: sup.id, message: messageOf(e) })
    }
  }

  // 5. The crew.
  if (crew) {
    try {
      result.booking = await bookCrew({ companyId: me.company_id, siteId: site.id, ...crew }, opts)
    } catch (e) {
      issues.push({ step: 'crew', ...crew, message: messageOf(e) })
    }
  }

  // 6. Other jobs with this builder's name.
  if (result.builder && input.linkJobs?.length) {
    const builder = { id: result.builder.id, name: result.builder.name }
    const jobs = input.linkJobs.filter((j) => j.id !== site.id)
    try {
      const out = await linkOtherJobs(builder, jobs, opts)
      result.linked = out.linked
      result.notLinked = out.skipped
    } catch (e) {
      const partial = e as { failed?: string[]; linked?: string[]; skipped?: LinkSkip[] }
      result.linked = partial.linked ?? []
      result.notLinked = partial.skipped ?? []
      issues.push({ step: 'link', builder, jobIds: partial.failed ?? jobs.map((j) => j.id), message: messageOf(e) })
    }
  }

  // 7. The contract value, on the job as it now stands (its builder included).
  if (input.contract) {
    try {
      await saveContractValue(site, input.contract, opts?.client)
    } catch (e) {
      issues.push({ step: 'contract', ...input.contract, message: messageOf(e) })
    }
  }

  return result
}

/** What retrying an issue came to. */
export interface RetryOutcome {
  /** Still outstanding: empty when it worked. */
  left: CreateIssue[]
  /**
   * Set when it is done, but not quite as the issue said, for the person:
   * the project manager it was to replace had been removed since, so the one
   * typed was added instead; or the job's builder (or another job's) was
   * changed since, so nothing was written over that change.
   */
  note: string | null
}

/**
 * Try one createJob issue again for a job that exists. Returns the issues
 * still outstanding (empty when it worked; a contact that saves but whose
 * supervisor link does not becomes a supervisor issue). retryIssue also
 * says what happened when that differs from what the issue said.
 *
 * An issue can be retried long after it was made (the banner stays until
 * Retry works), and `site` may be older still, so every retry that writes a
 * job's builder reads the job again first and never undoes a builder chosen
 * since, on a phone or here:
 *   - builder: the job is linked only while it still has no builder record
 *     and still goes by the name typed, and the update carries both as its
 *     condition. Otherwise nothing is written, and the note names the
 *     job's builder now.
 *   - link: only jobs that still go by the builder's name are linked
 *     (linkOtherJobs); the note names any left alone.
 *   - contact: the issue is for the builder the job had when it was made. If
 *     the job is on another builder now, nothing is saved: saving it would
 *     change the other builder's people, and could put their site supervisor
 *     on this job. The issue comes back aimed at the job's builder now, so a
 *     second Retry saves the person there.
 */
export async function retryCreateIssue(me: { company_id: string }, site: JobSiteRow, issue: CreateIssue, opts?: WriteOpts): Promise<CreateIssue[]> {
  return (await retryIssue(me, site, issue, opts)).left
}

/** retryCreateIssue, with a note for the person when what it did is not quite what the issue said. */
export async function retryIssue(me: { company_id: string }, site: JobSiteRow, issue: CreateIssue, opts?: WriteOpts): Promise<RetryOutcome> {
  const done = (note: string | null = null): RetryOutcome => ({ left: [], note })
  const still = (...left: CreateIssue[]): RetryOutcome => ({ left, note: null })
  try {
    switch (issue.step) {
      case 'builder': {
        const job = await builderNow(site.id, opts)
        const since = builderSince(job, issue.builderName)
        if (since !== undefined) return done(since)
        const builder = await findOrCreateBuilder(me.company_id, issue.builderName, opts)
        const patch = builderPatch(job, builder)
        if (Object.keys(patch).length === 0) return done()
        // Only while the job is as just read: no record, the name typed. A builder picked in between is kept.
        const { data, error } = await db(opts)
          .from('job_sites')
          .update(patch)
          .eq('id', site.id)
          .is('builder_id', null)
          .eq('client_name', job.client_name ?? '')
          .select('*')
        if (error) throw new Error(error.message)
        const row = ((data ?? []) as JobSiteRow[])[0]
        if (!row) {
          const again = builderSince(await builderNow(site.id, opts), issue.builderName)
          if (again !== undefined) return done(again)
          throw new Error(refused('Linking the builder'))
        }
        const off = Object.keys(patch).filter((k) => row[k as keyof JobSiteRow] !== patch[k as keyof typeof patch])
        if (off.length) throw new Error(`The builder did not save: ${off.join(', ')} read back differently. Try again.`)
        return done()
      }
      case 'job':
        // The job exists, so whatever did not save on it is edited on the form.
        return done()
      case 'contact': {
        // The job's builder now: `site` may be from before a builder retried or changed since.
        const job = await builderNow(site.id, opts)
        const builderId = job.builder_id
        if (!builderId) return still({ ...issue, builderId: null, message: 'Contacts belong to a builder, and this job has no builder record.' })
        // Typed for a record: that record. Typed with none (the builder step failed): the builder of that
        // name, which a builder retry links. Anyone else's job is not where this person was typed.
        const meant = issue.builderId ? issue.builderId === builderId : !!issue.builderName && sameName(builderOf(job), issue.builderName)
        if (!meant) {
          const now = builderOf(job) || "this job's builder"
          // Without the id: whoever it named was the old builder's.
          const draft: ContactDraft = { ...issue.draft }
          delete draft.id
          return still({
            step: 'contact',
            role: issue.role,
            builderId,
            draft,
            message: `This job's builder is now ${now}, so ${issue.draft.name.trim()} was not saved. Retry to save them as the ${CONTACT_LABEL[issue.role].toLowerCase()} for ${now}.`,
          })
        }
        let saved
        try {
          saved = await saveContact({ companyId: me.company_id, builderId, role: issue.role, draft: issue.draft }, opts)
        } catch (e) {
          return still(contactIssue(issue.role, issue.draft, builderId, job.client_name, e))
        }
        if (issue.role === 'supervisor' && saved.contact) {
          try {
            await setJobSupervisor(site.id, saved.contact, opts)
          } catch (e) {
            return still({ step: 'supervisor', contactId: saved.contact.id, message: messageOf(e) })
          }
        }
        return done(saved.note ?? null)
      }
      case 'supervisor':
        await setJobSupervisor(site.id, issue.contactId, opts)
        return done()
      case 'crew':
        await bookCrew({ companyId: me.company_id, siteId: site.id, workerIds: issue.workerIds, from: issue.from, to: issue.to }, opts)
        return done()
      case 'link': {
        // linkOtherJobs reads the jobs again and leaves alone any whose builder changed since.
        try {
          const out = await linkOtherJobs(issue.builder, issue.jobIds.map((id) => ({ id })), opts)
          return done(linkSkipNote(out.skipped, issue.builder.name))
        } catch (e) {
          // Retry only what did not link; a job left alone stays left alone.
          const failed = (e as { failed?: string[] }).failed
          return still({ ...issue, ...(failed && { jobIds: failed }), message: messageOf(e) })
        }
      }
      case 'contract':
        await saveContractValue(site, { sum: issue.sum, gstInclusive: issue.gstInclusive }, opts?.client)
        return done()
    }
  } catch (e) {
    return still({ ...issue, message: messageOf(e) })
  }
}

// ------------------------------------------------------------------- update

/**
 * What the job form edits. Status changes through setStatus.
 *
 * The builder is not two columns here but one record: builder_id and
 * client_name are only ever written together, from `builder` (builderPatch),
 * so a job linked to a builder always carries that builder's name. Writing
 * either column alone is how a job comes to say one builder while linked to
 * another; the phone's Project details can do that, the website never does.
 */
export type JobEdit = Partial<
  Pick<JobSiteRow, 'name' | 'job_type' | 'address' | 'colour' | 'lat' | 'lng' | 'radius_m' | 'starts_on' | 'ends_on' | 'captain_id' | 'supervisor_contact_id'>
> & {
  /** The job's builder, as findOrCreateBuilder returns it; null takes the builder off the job. */
  builder?: BuilderRef | null
}

const FENCE_KEYS = ['lat', 'lng', 'radius_m', 'address'] as const

/**
 * The update for an edit: only the columns that changed, checked as the
 * insert is. The address and the fence are one fact (where the job is), so
 * when any of lat, lng, radius_m or address changes all four are written
 * together. builder_id or client_name passed as columns are refused if they
 * would change anything (see JobEdit); passed back unchanged, they are
 * ignored. Pure; an empty object means nothing changed.
 *
 * A change of builder (a different record, or for a job with no record, a
 * different name) clears the supervisor link, because the job's supervisor
 * is one of the old builder's people. That holds when the edit sends the
 * old link back unchanged, as a form that returns every field it loaded
 * does: only a different contact, named in the same edit, takes their
 * place, and updateJob checks that one is the new builder's. A supervisor
 * named for a job that will have no builder record is refused.
 */
export function jobPatch(site: JobSiteRow, edit: JobEdit): Partial<JobSiteRow> {
  const { builder, ...cols } = edit as JobEdit & { builder_id?: string | null; client_name?: string | null }
  const plain = (v: unknown) => (v == null ? null : String(v).trim() || null)
  for (const k of ['builder_id', 'client_name'] as const) {
    if (cols[k] !== undefined && plain(cols[k]) !== plain(site[k])) {
      throw new JobInputError('builder', "Pick the builder from the list: a job linked to a builder shows that builder's name.")
    }
    delete cols[k]
  }
  if (builder && (!builder.id || !builder.name.trim())) throw new JobInputError('builder', 'Pick the builder from the list.')

  const next = { ...site } as Record<string, unknown>
  for (const [k, v] of Object.entries(cols)) if (v !== undefined) next[k] = v
  const patch: Record<string, unknown> = {}
  const changed = (k: Exclude<keyof JobEdit, 'builder'>) => cols[k] !== undefined && next[k] !== site[k]

  if (changed('name')) {
    const name = String(next.name ?? '').trim()
    if (!name) throw new JobInputError('name', 'The job needs a name.')
    if (name !== site.name) patch.name = name
  }
  if (changed('job_type')) patch.job_type = String(next.job_type ?? '').trim()
  // Null is the phone's automatic colour (railOf hashes the id), which a phone-made job has.
  if (changed('colour')) patch.colour = next.colour == null ? null : jobColourOf(next.colour as string)
  if (changed('captain_id')) patch.captain_id = (next.captain_id as string | null) || null

  if (FENCE_KEYS.some((k) => changed(k))) {
    const { lat, lng } = pointOf(Number(next.lat), Number(next.lng))
    const radius = changed('radius_m') ? radiusOf(Number(next.radius_m)) : site.radius_m
    Object.assign(patch, { lat, lng, radius_m: radius, address: String(next.address ?? '').trim() })
  }

  if (changed('starts_on') || changed('ends_on')) {
    Object.assign(patch, datesOf(next.starts_on as string | null, next.ends_on as string | null))
  }

  const named = cols.supervisor_contact_id === undefined ? undefined : cols.supervisor_contact_id || null
  if (builder !== undefined) Object.assign(patch, builderPatch(site, builder))
  if (builder !== undefined && changesBuilder(site, builder?.id ?? null, builder ? builder.name : null)) {
    // builderPatch has dropped the old builder's supervisor; naming them again does not keep them.
    if (named && named !== site.supervisor_contact_id) patch.supervisor_contact_id = named
  } else if (named !== undefined && named !== site.supervisor_contact_id) {
    patch.supervisor_contact_id = named
  }
  const nextBuilderId = 'builder_id' in patch ? (patch.builder_id as string | null) : site.builder_id
  if (patch.supervisor_contact_id && !nextBuilderId) {
    throw new JobInputError('supervisor_contact_id', "Pick the job's builder first: a site supervisor is one of the builder's people.")
  }

  // Drop anything that, after cleaning, is what the row already holds,
  // except the four fence columns, which travel together.
  const fence = FENCE_KEYS.some((k) => k in patch && patch[k] !== site[k])
  for (const k of Object.keys(patch)) {
    if ((FENCE_KEYS as readonly string[]).includes(k) && fence) continue
    if (patch[k] === site[k as keyof JobSiteRow]) delete patch[k]
  }
  return patch as Partial<JobSiteRow>
}

/** Write columns to a job and read the row back; every written column must read back as sent. */
async function writeJob(siteId: string, patch: Partial<JobSiteRow>, opts?: WriteOpts): Promise<JobSiteRow> {
  const { data, error } = await db(opts).from('job_sites').update(patch).eq('id', siteId).select('*')
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as JobSiteRow[])[0]
  if (!row) throw new Error(refused('Saving the job'))
  const off = Object.keys(patch).filter((k) => row[k as keyof JobSiteRow] !== patch[k as keyof JobSiteRow])
  if (off.length) throw new Error(`The job did not save: ${off.join(', ')} read back differently. Try again.`)
  return row
}

/**
 * Save an edit to a job: only the columns that changed (see jobPatch), in
 * one update, read back. Returns the row as stored and the columns written
 * (none, and no request, when nothing changed).
 */
export async function updateJob(site: JobSiteRow, edit: JobEdit, opts?: WriteOpts): Promise<{ site: JobSiteRow; written: string[] }> {
  const patch = jobPatch(site, edit)
  const written = Object.keys(patch)
  if (written.length === 0) return { site, written }
  if (patch.supervisor_contact_id) {
    // The supervisor named must be one of the site supervisors of the builder the job is to have.
    const builderId = 'builder_id' in patch ? (patch.builder_id ?? null) : site.builder_id
    const builderName = 'client_name' in patch ? (patch.client_name ?? null) : site.client_name
    const { data, error } = await db(opts).from('builder_contacts').select(CONTACT_COLS).eq('id', patch.supervisor_contact_id).maybeSingle()
    if (error) throw new Error(error.message)
    const why = notSupervisorFor((data as ContactRow | null) ?? null, builderId, builderName)
    if (why) throw new JobInputError('supervisor_contact_id', why)
  }
  return { site: await writeJob(site.id, patch, opts), written }
}

/**
 * Mark active, archive, or restore to Future: the only three statuses there
 * are, read back. The phone's own control does not read back, so a refusal
 * there looks like success; here it throws. Nothing ever deletes a job.
 */
export async function setStatus(siteId: string, status: JobStatus, opts?: WriteOpts): Promise<JobSiteRow> {
  if (!JOB_STATUSES.includes(status)) throw new JobInputError('status', 'A job is Active, Future or Archived.')
  return writeJob(siteId, { status }, opts)
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

type BuilderCols = Pick<JobSiteRow, 'builder_id' | 'client_name' | 'supervisor_contact_id'>

/** A job's builder columns as they are now, for a retry that may be long after the issue was made. */
async function builderNow(siteId: string, opts?: WriteOpts): Promise<BuilderCols> {
  const { data, error } = await db(opts).from('job_sites').select('builder_id, client_name, supervisor_contact_id').eq('id', siteId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('This job is no longer there.')
  return data as BuilderCols
}

/**
 * Whether a builder issue (the builder typed could not be saved when the job
 * was made) still has anything to do. Undefined: yes, the job still has no
 * builder record and still goes by the name typed. Otherwise the builder was
 * dealt with since, and nothing must be written: null when the job is now
 * linked under that name (what the issue wanted), else a note for the person
 * naming the job's builder now, which the retry must not undo.
 */
function builderSince(job: BuilderCols, typed: string): string | null | undefined {
  const now = builderOf(job)
  if (sameName(now, typed)) return job.builder_id ? null : undefined
  return now ? `This job's builder is now ${now}, so it was not changed.` : 'This job has no builder now, so it was not changed.'
}

/**
 * A contact that did not save, as an issue. When the builder already has a
 * project manager or contract administrator by another name (RoleTakenError),
 * nothing was written, and the issue says who is on file and carries their
 * id: retrying it then replaces that person with the one typed, which changes
 * every job for the builder, as editing them on the phone does. Nobody is
 * replaced unless someone reads that and asks.
 */
function contactIssue(role: ContactRole, draft: ContactDraft, builderId: string | null, builderName: string | null, e: unknown): CreateIssue {
  if (e instanceof RoleTakenError) {
    const label = CONTACT_LABEL[role].toLowerCase()
    const typed = draft.name.trim()
    const builder = builderName?.trim() || 'this builder'
    // Retrying the replacement found the person it replaced gone, and somebody else in the role again.
    const since = e.replacedGone ? `The ${label} this was to replace is no longer on file. ` : ''
    return {
      step: 'contact',
      role,
      builderId,
      draft: { ...draft, id: e.holder.id },
      message: `${since}Not saved: ${e.holder.name} is the ${label} for ${builder}, on every job for them. Retry to make ${typed} the ${label} on every job for ${builder} instead.`,
    }
  }
  return { step: 'contact', role, draft, builderId, message: messageOf(e) }
}
