/**
 * The New job / Edit job form: what it holds, what it loads, and what Save
 * writes. JobForm.tsx draws it; this decides it.
 *
 * One form for both, because a job is set up in one place: the website's
 * whole point is that the screen that makes a job is the screen that sets
 * everything the crew's phones show about it. Editing is the same form,
 * filled in, and writes only what changed.
 *
 * CREATE runs createJob (data/jobs.ts) once: builder, job, the builder's
 * people, the supervisor link, the crew booking and any other jobs to link,
 * each step read back. A step after the job exists that fails never undoes
 * the job; it is stashed for the job page, which names it and retries it.
 *
 * EDIT writes the job's own columns first, in one update read back
 * (updateJob: only the columns that changed, the address and the fence
 * together), then the builder's people, then the supervisor link and any
 * other jobs to link. Anything after the job update that fails is stashed
 * for the job page the same way, so a half-saved edit says exactly what did
 * not save and offers Retry, as a half-made job does. It is added to what is
 * already there, never put in its place: whatever failed when the job was
 * made stays listed until it is retried or this edit settles it
 * (mergeIssues).
 *
 * THE BUILDER'S PEOPLE belong to the builder, not the job (builders.ts): the
 * project manager and contract administrator are one each per builder and
 * show on every job for them, so their fields always show the builder's
 * one person on file, and typing over them changes that person on every
 * job, as the phone's Project details does. The site supervisor is per job
 * (job_sites.supervisor_contact_id, the person SWMS and waterproofing
 * certificates are emailed to), so that field is this job's own: blank on a
 * new job, and blank again when the builder changes, because a job never
 * keeps another builder's person.
 *
 * When the builder in the box becomes a different builder, the people
 * fields that still show what was on file are swapped for the new
 * builder's; anything typed by hand is left as typed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  changesBuilder,
  findOrCreateBuilder,
  linkCandidates,
  linkOtherJobs,
  linkSkipNote,
  loadContacts,
  RoleTakenError,
  sameName,
  saveContact,
  setJobSupervisor,
  suggestionsOf,
  type BuilderRecord,
  type BuilderRef,
  type BuilderSuggestion,
  type ContactDraft,
  type ContactRow,
  type LinkSkip,
} from '../../data/builders'
import { CONTACT_LABEL, CONTACT_ROLES, ONE_PER_BUILDER, PHONE_NEW_STATUS, type ContactRole } from '../../data/contract'
import { contractValueProblem, moneyInput, parseMoney, saveContractValue, type ContractValue } from '../../data/contractValue'
import {
  buildJobInsert,
  createJob,
  JobInputError,
  jobPatch,
  peekCreateIssues,
  stashCreateIssues,
  updateJob,
  type CreateIssue,
  type CreateJobInput,
  type JobEdit,
} from '../../data/jobs'
import { nearDefaultCentre, samePoint, type FenceValue } from '../../map/fenceGeometry'
import { builderOf, JOB_COLOURS, railOf, supabase, type JobSiteRow, type WorkerRow } from '../../phone'
import { defaultPick, pickProblem, type CrewPick } from '../CrewPicker'

// ------------------------------------------------------------------ shapes

export type FormMode = 'create' | 'edit'

/** A person as typed: three boxes, blanks as ''. */
export interface ContactValue {
  name: string
  mobile: string
  email: string
}

export const BLANK_CONTACT: ContactValue = { name: '', mobile: '', email: '' }

export type Contacts = Record<ContactRole, ContactValue>
/** Who is on file for each role, for the builder in the box. */
export type OnFile = Record<ContactRole, ContactRow | null>

export interface JobFormValues {
  name: string
  workType: string
  /** One of JOB_COLOURS; null only for a phone-made job left on the phone's automatic colour. */
  colour: string | null
  builder: string
  address: string
  /** Null on a new job until the pin is placed on purpose (FenceEditor). */
  fence: FenceValue | null
  /** Local YYYY-MM-DD, or ''. */
  startsOn: string
  endsOn: string
  /** New jobs only; on an existing job the status moves from the job page's header. */
  status: 'starting_soon' | 'active'
  /** A role 'captain' worker, or ''. */
  captainId: string
  contacts: Contacts
  /** Also link the other jobs that go by this builder's name. */
  linkOthers: boolean
  /** New jobs only: book a crew as the job is made. */
  bookCrew: boolean
  crew: CrewPick
  /** Dollars as typed (contractValue.ts parseMoney), or '' for none. */
  contractValue: string
  /** Whether that figure includes GST. */
  contractGstInclusive: boolean
}

/** The job being edited, as useJob loaded it. Taken once, when the form opens. */
export interface EditSource {
  site: JobSiteRow
  builder: BuilderRecord | null
  contacts: Record<ContactRole, ContactRow | null>
  allContacts: ContactRow[]
  drift: { onJob: string; record: string } | null
  /** The contract value on file (contractValue.ts), or null. */
  contract: ContractValue | null
}

/** Somebody who can captain a job, or be booked. */
export interface CrewOption {
  id: string
  name: string
  role: 'owner' | 'captain' | 'employee'
  active: boolean
  is_office: boolean
}

/** What the form reads about every job: the builder list, the colours in use, other jobs to link. */
export type FormSite = Pick<JobSiteRow, 'id' | 'name' | 'address' | 'status' | 'client_name' | 'builder_id' | 'colour'>

/** Where an error is shown. Contact fields are `contact.<role>`. */
export type FieldKey =
  | 'name'
  | 'workType'
  | 'colour'
  | 'builder'
  | 'address'
  | 'fence'
  | 'startsOn'
  | 'endsOn'
  | 'status'
  | 'captain'
  | 'crew'
  | 'contractValue'
  | `contact.${ContactRole}`

export type FieldErrors = Partial<Record<FieldKey, string>>

/** The questions Save may ask before it writes (JobForm draws them). */
export type Check = 'address' | 'cbd'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const NO_ONE: OnFile = { project_manager: null, supervisor: null, contract_admin: null }

const trimmed = (v: string | null | undefined) => (v ?? '').trim()
const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
const mapRoles = <T>(f: (role: ContactRole) => T): Record<ContactRole, T> =>
  ({ project_manager: f('project_manager'), supervisor: f('supervisor'), contract_admin: f('contract_admin') }) as Record<ContactRole, T>

export const asContact = (c: ContactRow | null | undefined): ContactValue =>
  c ? { name: c.name, mobile: c.mobile ?? '', email: c.email ?? '' } : BLANK_CONTACT

export const sameContact = (a: ContactValue, b: ContactValue) =>
  trimmed(a.name) === trimmed(b.name) && trimmed(a.mobile) === trimmed(b.mobile) && trimmed(a.email) === trimmed(b.email)


/**
 * The colour new jobs start on: the one the fewest live jobs wear, so rails
 * on the board and the crew's schedule stay told apart. Archived jobs do not
 * count (nobody sees them side by side); a job with no colour of its own
 * counts as the colour the phone draws it in (railOf). Ties go to the
 * phone's own order.
 */
export function leastUsedColour(sites: Array<Pick<JobSiteRow, 'id' | 'colour' | 'status'>>, exceptId?: string | null): string {
  const counts = colourCounts(sites, exceptId)
  return JOB_COLOURS.reduce((best, c) => ((counts.get(c) ?? 0) < (counts.get(best) ?? 0) ? c : best), JOB_COLOURS[0]!)
}

/** Live jobs per rail colour, keyed by the JOB_COLOURS entry. */
export function colourCounts(sites: Array<Pick<JobSiteRow, 'id' | 'colour' | 'status'>>, exceptId?: string | null): Map<string, number> {
  const counts = new Map<string, number>(JOB_COLOURS.map((c) => [c, 0]))
  for (const s of sites) {
    if (s.status === 'archived' || s.id === exceptId) continue
    const rail = railOf(s).toLowerCase()
    const hit = JOB_COLOURS.find((c) => c.toLowerCase() === rail)
    if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1)
  }
  return counts
}

/** The canonical JOB_COLOURS entry for a stored colour, or the colour as stored. */
const canonicalColour = (c: string | null): string | null => (c ? (JOB_COLOURS.find((x) => x.toLowerCase() === c.toLowerCase()) ?? c) : null)

// ------------------------------------------------------------------ what the form reads

interface Loaded {
  sites: FormSite[]
  builders: BuilderRecord[]
  crew: CrewOption[]
}

/**
 * Every job (for the builder list, the colours in use and the jobs a builder
 * could be linked to), every builder record, and the crew (for the captain).
 * A failure leaves the form usable: a builder can still be typed, and the
 * error says what is missing.
 */
function useFormData() {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    const c = supabase()
    void Promise.all([
      c.from('job_sites').select('id, name, address, status, client_name, builder_id, colour'),
      c.from('builders').select('id, name, created_at, active').order('created_at').order('id'),
      c.from('crew_v').select('id, name, role, active, is_office').order('name').order('id'),
    ]).then(
      ([s, b, w]) => {
        if (!live) return
        const err = s.error ?? b.error ?? w.error
        if (err) {
          setError(err.message)
          return
        }
        setError(null)
        setData({ sites: (s.data ?? []) as FormSite[], builders: (b.data ?? []) as BuilderRecord[], crew: (w.data ?? []) as CrewOption[] })
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      live = false
    }
  }, [nonce])
  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, retry }
}

/** A builder's people, read when the builder in the box is a record. */
function useBuilderContacts(builderId: string | null): { rows: ContactRow[] | null; error: string | null } {
  // Kept with the builder they were read for, so a failure for one builder never stands in for the next.
  const [got, setGot] = useState<{ id: string; rows: ContactRow[] | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!builderId) return
    let live = true
    loadContacts(builderId).then(
      (rows) => {
        if (live) setGot({ id: builderId, rows, error: null })
      },
      (e: unknown) => {
        if (live) setGot({ id: builderId, rows: null, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => {
      live = false
    }
  }, [builderId])
  const mine = builderId && got?.id === builderId ? got : null
  return { rows: mine?.rows ?? null, error: mine?.error ?? null }
}

// ------------------------------------------------------------------ the builder in the box

/**
 * Which builder the box names. `key` is its identity for the people fields:
 * the record when there is one, else the name; it changes only when the box
 * names a different builder, not when the same one is respelled.
 */
export interface ResolvedBuilder {
  /**
   * What the job will be called by, and the spelling saved. A name already
   * on the list keeps the spelling it has there (a record's, or the one
   * typed on jobs), so "paramoint" typed for Paramoint never respells
   * Paramoint's jobs on every phone; the job's own builder keeps the job's
   * spelling. Anything else is as typed, tidied.
   */
  name: string
  /** The builders row behind it, if one is known yet. */
  builderId: string | null
  /** From the list (builders rows and names typed on jobs), if it is on it. */
  suggestion: BuilderSuggestion | null
  key: string
  /** Editing, and still the job's own builder, untouched. */
  original: boolean
}

// ------------------------------------------------------------------ the hook

export interface SaveOutcome {
  siteId: string
  /** The toast for the job page. */
  message: string
  tone: 'success' | 'neutral'
}

export function useJobForm({ me, source }: { me: WorkerRow; source: EditSource | null }) {
  // Taken once: the form edits the row it opened with, and works out what changed against it.
  const [src] = useState(source)
  const mode: FormMode = src ? 'edit' : 'create'
  const site = src?.site ?? null
  const { data, error: loadError, retry: retryLoad } = useFormData()

  const initial = useMemo<JobFormValues>(() => {
    const blankCrew: CrewPick = { workerIds: [], from: '', to: '' }
    if (!src) {
      return {
        name: '',
        workType: '',
        colour: JOB_COLOURS[0]!,
        builder: '',
        address: '',
        fence: null,
        startsOn: '',
        endsOn: '',
        status: PHONE_NEW_STATUS,
        captainId: '',
        contacts: mapRoles(() => BLANK_CONTACT),
        linkOthers: true,
        bookCrew: false,
        crew: { ...defaultPick(null), workerIds: [] },
        contractValue: '',
        contractGstInclusive: false,
      }
    }
    const s = src.site
    const own = ownSupervisor(src)
    return {
      name: s.name,
      workType: s.job_type ?? '',
      colour: canonicalColour(s.colour),
      // What the phone shows (builderOf), even when the record has been renamed since.
      builder: builderOf(s),
      address: s.address ?? '',
      fence: { lat: s.lat, lng: s.lng, radiusM: s.radius_m },
      startsOn: s.starts_on ?? '',
      endsOn: s.ends_on ?? '',
      status: s.status === 'active' ? 'active' : 'starting_soon',
      captainId: s.captain_id ?? '',
      contacts: { project_manager: asContact(src.contacts.project_manager), supervisor: asContact(own), contract_admin: asContact(src.contacts.contract_admin) },
      linkOthers: true,
      bookCrew: false,
      crew: blankCrew,
      contractValue: src.contract ? moneyInput(src.contract.contract_sum) : '',
      contractGstInclusive: src.contract?.gst_inclusive ?? false,
    }
  }, [src])

  const [values, setValues] = useState<JobFormValues>(initial)
  const set = useCallback(<K extends keyof JobFormValues>(key: K, value: JobFormValues[K]) => setValues((v) => ({ ...v, [key]: value })), [])
  const setContact = useCallback((role: ContactRole, value: ContactValue) => setValues((v) => ({ ...v, contacts: { ...v.contacts, [role]: value } })), [])

  // ---------------------------------------------------------------- colour

  // A new job starts on the least-used colour, once the jobs are in, unless one was picked already.
  const [colourPicked, setColourPicked] = useState(false)
  const counts = useMemo(() => colourCounts(data?.sites ?? [], site?.id), [data, site])
  useEffect(() => {
    if (mode !== 'create' || !data || colourPicked) return
    set('colour', leastUsedColour(data.sites))
  }, [mode, data, colourPicked, set])
  const pickColour = useCallback(
    (c: string | null) => {
      setColourPicked(true)
      set('colour', c)
    },
    [set],
  )

  // ---------------------------------------------------------------- the builder

  const suggestions = useMemo(() => (data ? suggestionsOf(data.builders, data.sites) : []), [data])
  /** The list entry picked last, until the box is typed in again. Picking is how a typed-only job gets linked to a record. */
  const [picked, setPicked] = useState<BuilderSuggestion | null>(null)
  const jobBuilderId = site ? (site.builder_id ?? src?.builder?.id ?? null) : null
  const initialBuilder = initial.builder

  const resolved = useMemo<ResolvedBuilder>(() => {
    const typed = values.builder.trim().replace(/\s+/g, ' ')
    const suggestion = typed ? (suggestions.find((s) => sameName(s.name, typed)) ?? null) : null
    // Editing: picking the job's own builder from the list links a job the
    // phone only ever typed a name for (or a different record of that name).
    const linking = mode === 'edit' && !!picked && sameName(picked.name, typed) && (!site?.builder_id || picked.builderId !== site.builder_id)
    if (mode === 'edit' && sameName(typed, initialBuilder) && !linking) {
      // The job's own builder, however it is respelled in the box: the job keeps its spelling.
      const name = typed ? initialBuilder.trim().replace(/\s+/g, ' ') : ''
      return { name, builderId: jobBuilderId, suggestion, key: jobBuilderId ? `id:${jobBuilderId}` : name ? `name:${norm(name)}` : '', original: true }
    }
    // On the list in another case or spacing: the spelling already on file, or already on the jobs.
    const name = suggestion?.name ?? typed
    const builderId = suggestion?.builderId ?? null
    return { name, builderId, suggestion, key: builderId ? `id:${builderId}` : name ? `name:${norm(name)}` : '', original: false }
  }, [values.builder, suggestions, picked, mode, site, initialBuilder, jobBuilderId])

  /** Editing: the job's builder is being changed, taken off, or linked to a record for the first time. */
  const builderChanged = mode === 'edit' && !resolved.original
  /**
   * Editing: a different builder (or none), not the same one linked or
   * respelled, such as the drift banner's "Use the record's name". Only this
   * takes the job's own site supervisor off (builderPatch), so only this
   * says it will.
   */
  const builderSwitched =
    builderChanged &&
    !!site &&
    changesBuilder(site, resolved.builderId ?? (src?.builder && resolved.name && sameName(src.builder.name, resolved.name) ? src.builder.id : null), resolved.name || null)

  const people = useBuilderContacts(resolved.original ? null : resolved.builderId)

  /**
   * Who is on file for each role, for the builder in the box. Null while
   * that builder's people are still loading. The job's own builder is as
   * the job page read it; the site supervisor is only ever this job's own.
   */
  const onFile = useMemo<OnFile | null>(() => {
    if (src && (resolved.original || (resolved.builderId && resolved.builderId === jobBuilderId))) {
      return { project_manager: src.contacts.project_manager, supervisor: ownSupervisor(src), contract_admin: src.contacts.contract_admin }
    }
    if (!resolved.builderId) return NO_ONE
    if (!people.rows) return people.error ? NO_ONE : null
    const first = (role: ContactRole) => people.rows!.find((r) => r.role === role) ?? null
    return { project_manager: first('project_manager'), supervisor: null, contract_admin: first('contract_admin') }
  }, [src, resolved, jobBuilderId, people.rows, people.error])

  /** The builder's site supervisors, offered for this job's. */
  const supervisors = useMemo<ContactRow[]>(() => {
    if (src && (resolved.original || (resolved.builderId && resolved.builderId === jobBuilderId))) return src.allContacts.filter((c) => c.role === 'supervisor')
    return (people.rows ?? []).filter((c) => c.role === 'supervisor')
  }, [src, resolved, jobBuilderId, people.rows])

  // When the box names a different builder, the people fields that still
  // show what was on file for the last one show this one's instead.
  const shown = useRef<{ key: string; onFile: OnFile }>({ key: resolved.key, onFile: onFile ?? NO_ONE })
  useEffect(() => {
    if (!onFile) return
    const before = shown.current
    shown.current = { key: resolved.key, onFile }
    if (before.key === resolved.key) return
    setValues((v) => ({
      ...v,
      contacts: mapRoles((role) => (sameContact(v.contacts[role], asContact(before.onFile[role])) ? asContact(onFile[role]) : v.contacts[role])),
    }))
  }, [resolved.key, onFile])

  /** Other jobs that go by this builder's name and are not linked to its record. */
  const candidates = useMemo<FormSite[]>(() => {
    if (!data || !resolved.name) return []
    if (mode === 'edit' && !builderChanged) return []
    return linkCandidates(data.sites, { id: resolved.builderId ?? '', name: resolved.name }, site?.id)
  }, [data, resolved, mode, builderChanged, site])

  // ---------------------------------------------------------------- the crew

  // The booking's days follow the job's dates until somebody changes the booking's own.
  const [crewFollows, setCrewFollows] = useState(true)
  useEffect(() => {
    if (mode !== 'create' || !crewFollows) return
    const next = defaultPick({ starts_on: ISO_DAY.test(values.startsOn) ? values.startsOn : null, ends_on: ISO_DAY.test(values.endsOn) ? values.endsOn : null })
    setValues((v) => (v.crew.from === next.from && v.crew.to === next.to ? v : { ...v, crew: { ...v.crew, from: next.from, to: next.to } }))
  }, [mode, crewFollows, values.startsOn, values.endsOn])
  const crewNow = values.crew
  const setCrew = useCallback(
    (next: CrewPick) => {
      if (next.from !== crewNow.from || next.to !== crewNow.to) setCrewFollows(false)
      set('crew', next)
    },
    [crewNow, set],
  )

  const captains = useMemo<CrewOption[]>(() => {
    const all = data?.crew ?? []
    return all.filter((w) => (w.role === 'captain' && w.active) || w.id === values.captainId || w.id === site?.captain_id)
  }, [data, values.captainId, site])

  // ---------------------------------------------------------------- what changed

  const stored = useMemo<FenceValue | null>(() => (site ? { lat: site.lat, lng: site.lng, radiusM: site.radius_m } : null), [site])
  const pinMoved = !!values.fence && (!stored || !samePoint(values.fence, stored))
  const radiusChanged = !!values.fence && !!stored && values.fence.radiusM !== stored.radiusM
  const fenceChanged = pinMoved || radiusChanged
  const addressChanged = trimmed(values.address) !== trimmed(initial.address)
  /** A new address searched, but no result picked and the map not clicked: the fence is still at the old site. */
  const pinLeftBehind = mode === 'edit' && addressChanged && !pinMoved

  /** Roles whose fields say something other than what is on file. */
  const changedRoles = useMemo(
    () => (onFile ? CONTACT_ROLES.filter((role) => !sameContact(values.contacts[role], asContact(onFile[role]))) : []),
    [values.contacts, onFile],
  )

  /** The contract value to save: the amount typed, when it differs from what is on file. */
  const contractEdit = useMemo(() => contractEditOf(values, initial), [values, initial])

  const dirty = useMemo(() => {
    const v = values
    const i = initial
    const contacts = CONTACT_ROLES.some((role) => !sameContact(v.contacts[role], i.contacts[role]))
    const common =
      trimmed(v.name) !== trimmed(i.name) ||
      trimmed(v.workType) !== trimmed(i.workType) ||
      trimmed(v.builder) !== trimmed(i.builder) ||
      builderChanged ||
      addressChanged ||
      v.startsOn !== i.startsOn ||
      v.endsOn !== i.endsOn ||
      v.captainId !== i.captainId ||
      contacts ||
      contractEdit !== null ||
      trimmed(v.contractValue) !== trimmed(i.contractValue)
    if (mode === 'create') return common || !!v.fence || v.status !== i.status || colourPicked || (v.bookCrew && v.crew.workerIds.length > 0)
    return common || fenceChanged || v.colour !== i.colour
  }, [values, initial, builderChanged, addressChanged, fenceChanged, mode, colourPicked, contractEdit])

  // ---------------------------------------------------------------- checking

  /** What stops Save outright (the button is disabled, and this says why). */
  const blocker: string | null =
    mode === 'create' && (!values.name.trim() || !values.fence)
      ? 'Needs a name and a placed fence'
      : mode === 'edit' && !dirty
        ? 'Nothing has changed yet'
        : // Until the builder's people are in, what was typed cannot be told from what is on file.
          !onFile
          ? `Loading ${resolved.name}'s people…`
          : null

  const [tried, setTried] = useState(false)

  const errors = useMemo<FieldErrors>(() => {
    const all = checkValues(values, { mode, changedRoles, builderName: resolved.name, contractOnFile: !!src?.contract })
    if (tried) return all
    // Before the first Save, only what is wrong whatever comes next: an end
    // before the start, or a contract value that is not an amount.
    const out: FieldErrors = {}
    if (all.startsOn) out.startsOn = all.startsOn
    if (all.endsOn) out.endsOn = all.endsOn
    if (all.contractValue) out.contractValue = all.contractValue
    return out
  }, [values, tried, changedRoles, resolved.name, mode, src])

  // ---------------------------------------------------------------- saving

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [inputError, setInputError] = useState<{ field: FieldKey; message: string } | null>(null)
  const shownErrors: FieldErrors = inputError ? { ...errors, [inputError.field]: errors[inputError.field] ?? inputError.message } : errors
  // A field error from the last Save goes as soon as that field is edited.
  const lastValues = useRef(values)
  useEffect(() => {
    if (lastValues.current !== values) setInputError(null)
    lastValues.current = values
  }, [values])

  /**
   * Which of the two pre-save questions apply now, in the order they are
   * asked: a new address with the pin where it was (editing), then a pin
   * left in the middle of Adelaide. A fence that is not being changed is
   * not asked about.
   */
  const checksDue = useCallback((): Check[] => {
    const due: Check[] = []
    if (pinLeftBehind) due.push('address')
    const fenceInPlay = mode === 'create' || fenceChanged || addressChanged
    if (values.fence && fenceInPlay && nearDefaultCentre(values.fence)) due.push('cbd')
    return due
  }, [pinLeftBehind, mode, fenceChanged, addressChanged, values.fence])

  /**
   * Check everything Save would refuse, before anything is written, and
   * show it. Returns the errors (empty when Save can go).
   */
  const validate = useCallback((): FieldErrors => {
    setTried(true)
    const out = checkValues(values, { mode, changedRoles, builderName: resolved.name, contractOnFile: !!src?.contract })
    if (Object.keys(out).length) return out
    // The rules the writes themselves apply (data/jobs.ts), run now so nothing half-saves on them.
    try {
      if (mode === 'create') buildJobInsert(me.company_id, draftOf(values, resolved.name))
      else if (site) jobPatch(site, columnsEdit(site, values, initial))
    } catch (e) {
      if (!(e instanceof JobInputError)) throw e
      const field = fieldOf(e.field)
      setInputError({ field, message: e.message })
      return { [field]: e.message }
    }
    return {}
  }, [values, changedRoles, resolved.name, mode, me.company_id, site, initial, src])

  /**
   * Save. Run after validate() and the questions. Resolves to where to go
   * and what to say there, or null when nothing was saved (saveError says
   * why, and the form stays as it is).
   */
  const save = useCallback(async (): Promise<SaveOutcome | null> => {
    if (saving) return null
    setSaving(true)
    setSaveError(null)
    setInputError(null)
    try {
      return mode === 'create' ? await saveNew() : await saveEdit()
    } catch (e) {
      if (e instanceof JobInputError) {
        setInputError({ field: fieldOf(e.field), message: e.message })
        setSaveError(e.message)
      } else {
        setSaveError(e instanceof Error ? e.message : String(e))
      }
      return null
    } finally {
      setSaving(false)
    }

    async function saveNew(): Promise<SaveOutcome | null> {
      const v = values
      const contacts: CreateJobInput['contacts'] = {}
      for (const role of changedRoles) {
        const draft = draftFor(role, v.contacts[role], onFile ?? NO_ONE)
        if (draft.name.trim()) contacts[role] = draft
      }
      const crew = v.bookCrew && v.crew.workerIds.length > 0 ? v.crew : null
      const res = await createJob(me, {
        ...draftOf(v, resolved.name),
        contacts,
        crew,
        linkJobs: v.linkOthers ? candidates.map((j) => ({ id: j.id })) : [],
        contract: contractEdit,
      })
      if (!res.site) {
        // Nothing was made (a builder found or added on the way is harmless: it is only a name).
        const why = res.issues.find((i) => i.step === 'job')?.message ?? 'The job was not saved.'
        setSaveError(why)
        return null
      }
      stashCreateIssues(res.site.id, res.issues)
      const extra: string[] = []
      if (res.booking?.skipped.length) {
        const n = res.booking.skipped.length
        extra.push(`${n} day${n === 1 ? '' : 's'} already booked elsewhere ${n === 1 ? 'was' : 'were'} left as ${n === 1 ? 'it was' : 'they were'}.`)
      }
      const skipNote = linkSkipNote(res.notLinked, res.builder?.name ?? resolved.name)
      if (skipNote) extra.push(skipNote)
      // The phone has no live updates: a running app shows a new job when it is next opened.
      return {
        siteId: res.site.id,
        message: ['Crew phones show it next time the app is opened. Clock-in works now.', ...extra].join(' '),
        tone: 'success',
      }
    }

    async function saveEdit(): Promise<SaveOutcome | null> {
      if (!site) return null
      const v = values
      const issues: CreateIssue[] = []
      const notes: string[] = []

      // 1. The builder record, when the job's builder changes, is linked for
      //    the first time, or needs one because people were typed for a
      //    builder the phone only ever named. Nothing on the job is written yet.
      const typedPeople = changedRoles.some((role) => trimmed(v.contacts[role].name))
      const needsRecord = builderChanged ? !!resolved.name : typedPeople && !site.builder_id && !!resolved.name
      let builder: BuilderRef | null | undefined
      if (needsRecord) {
        const b = await findOrCreateBuilder(me.company_id, resolved.name)
        builder = { id: b.id, name: b.name }
      } else if (builderChanged) {
        builder = null
      }
      const builderId = builder !== undefined ? (builder?.id ?? null) : site.builder_id

      // 2. The job's own columns, in one update, read back: only what
      //    changed; the address and the fence together; a change of builder
      //    takes the old builder's supervisor off. Taking this job's own
      //    supervisor off goes in the same update.
      const edit: JobEdit = columnsEdit(site, v, initial)
      if (builder !== undefined) edit.builder = builder
      const supOff = changedRoles.includes('supervisor') && !trimmed(v.contacts.supervisor.name) && !!site.supervisor_contact_id && builder === undefined
      if (supOff) edit.supervisor_contact_id = null
      const { site: row, written } = await updateJob(site, edit)

      // 2b. The contract value, when it changed: only its two figures (contractValue.ts).
      if (contractEdit) {
        try {
          await saveContractValue(row, contractEdit)
        } catch (e) {
          issues.push({ step: 'contract', ...contractEdit, message: e instanceof Error ? e.message : String(e) })
        }
      }

      // 3. The builder's people, against the builder the job now has.
      let supervisor: ContactRow | null = null
      for (const role of changedRoles) {
        const typed = v.contacts[role]
        if (role === 'supervisor' && !trimmed(typed.name)) continue // taken off above; the person stays on file
        // A blank project manager or contract administrator with nobody on file has nothing to do.
        if (!trimmed(typed.name) && !(onFile ?? NO_ONE)[role]) continue
        const draft = draftFor(role, typed, onFile ?? NO_ONE)
        if (!builderId) {
          issues.push({ step: 'contact', role, draft, builderId: null, builderName: resolved.name || null, message: 'Contacts belong to a builder, and this job has no builder record.' })
          continue
        }
        try {
          const saved = await saveContact({ companyId: me.company_id, builderId, role, draft })
          if (saved.note) notes.push(saved.note)
          if (role === 'supervisor') supervisor = saved.contact
        } catch (e) {
          issues.push(contactIssue(role, draft, builderId, resolved.name, e))
        }
      }

      // 4. Point the job at its supervisor, if that is not who it points at now.
      if (supervisor && supervisor.id !== row.supervisor_contact_id) {
        try {
          await setJobSupervisor(site.id, supervisor)
        } catch (e) {
          issues.push({ step: 'supervisor', contactId: supervisor.id, message: e instanceof Error ? e.message : String(e) })
        }
      }

      // 5. Other jobs with this builder's name, if asked.
      if (builder && v.linkOthers && candidates.length) {
        try {
          const out = await linkOtherJobs(builder, candidates)
          const note = linkSkipNote(out.skipped, builder.name)
          if (note) notes.push(note)
        } catch (e) {
          const partial = e as { failed?: string[]; skipped?: LinkSkip[] }
          const note = linkSkipNote(partial.skipped ?? [], builder.name)
          if (note) notes.push(note)
          issues.push({ step: 'link', builder, jobIds: partial.failed ?? candidates.map((j) => j.id), message: e instanceof Error ? e.message : String(e) })
        }
      }

      // What the job page lists as not saved: anything still outstanding from
      // before (the job's create, an earlier edit) that this edit has not
      // settled, then this edit's own. Never just this edit's: a crew booking
      // that failed when the job was made is still not booked after a rename.
      const switched = builder !== undefined && changesBuilder(site, builder?.id ?? null, builder ? builder.name : null)
      stashCreateIssues(
        site.id,
        mergeIssues(peekCreateIssues(site.id), issues, {
          written,
          builder: builder !== undefined,
          roles: changedRoles,
          supervisor: changedRoles.includes('supervisor') || written.includes('supervisor_contact_id') || switched,
          contract: contractEdit !== null,
        }),
      )
      const what = savedWhat(written, { pinMoved, radiusChanged, addressChanged }, changedRoles.length > 0 || contractEdit !== null)
      return {
        siteId: site.id,
        message: [issues.length ? 'Saved, but not all of it: the job page says what did not save, with Retry.' : what, ...notes].join(' '),
        tone: issues.length ? 'neutral' : 'success',
      }
    }
    // values and friends are read through the closure; the deps list them.
  }, [saving, mode, values, changedRoles, onFile, me, candidates, resolved, site, initial, builderChanged, pinMoved, radiusChanged, addressChanged, contractEdit])

  return {
    mode,
    site,
    source: src,
    values,
    initial,
    set,
    setContact,
    pickColour,
    setCrew,
    setPicked,
    loading: !data && !loadError,
    loadError,
    retryLoad,
    suggestions,
    resolved,
    builderChanged,
    builderSwitched,
    onFile,
    peopleError: people.error,
    supervisors,
    candidates,
    counts,
    captains,
    crew: data?.crew ?? [],
    stored,
    pinMoved,
    radiusChanged,
    fenceChanged,
    addressChanged,
    pinLeftBehind,
    dirty,
    blocker,
    errors: shownErrors,
    checksDue,
    validate,
    save,
    saving,
    saveError,
    clearSaveError: () => setSaveError(null),
  }
}

export type JobFormState = ReturnType<typeof useJobForm>

// ------------------------------------------------------------------ helpers

/** The job's own site supervisor (its link), not the builder's first one the phone falls back to. */
function ownSupervisor(src: EditSource): ContactRow | null {
  const sup = src.contacts.supervisor
  return sup && sup.id === src.site.supervisor_contact_id ? sup : null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * What the form would refuse, field by field. Pure. The writes check the
 * job's own columns again (buildJobInsert, jobPatch); this is what a person
 * can fix before anything is sent.
 */
export function checkValues(v: JobFormValues, ctx: { mode: FormMode; changedRoles: ContactRole[]; builderName: string; contractOnFile?: boolean }): FieldErrors {
  const out: FieldErrors = {}
  if (!v.name.trim()) out.name = 'The job needs a name.'
  if (!v.fence) out.fence = 'Place the fence on the map: search the address, or click where the job is.'
  if (v.startsOn && !ISO_DAY.test(v.startsOn)) out.startsOn = 'Pick a start date.'
  if (v.endsOn && !ISO_DAY.test(v.endsOn)) out.endsOn = 'Pick an end date.'
  if (ISO_DAY.test(v.startsOn) && ISO_DAY.test(v.endsOn) && v.endsOn < v.startsOn) out.endsOn = 'The end date is before the start date.'
  for (const role of CONTACT_ROLES) {
    const c = v.contacts[role]
    if (trimmed(c.email) && !EMAIL.test(trimmed(c.email))) out[`contact.${role}`] = 'That email address is not complete.'
    else if (!trimmed(c.name) && (trimmed(c.mobile) || trimmed(c.email))) out[`contact.${role}`] = 'Add their name, or clear their number and email.'
  }
  // A person typed for nobody: contacts belong to a builder.
  if (!ctx.builderName && ctx.changedRoles.some((role) => trimmed(v.contacts[role].name))) out.builder = "Type the builder: the people below are the builder's."
  if (ctx.mode === 'create' && v.bookCrew && v.crew.workerIds.length > 0) {
    const p = pickProblem(v.crew)
    if (p) out.crew = p
  }
  const money = contractValueProblem(v.contractValue)
  if (money) out.contractValue = money
  // A value on file is changed here, not taken off: the contract row holds more than this form shows.
  else if (ctx.mode === 'edit' && !trimmed(v.contractValue) && ctx.contractOnFile) out.contractValue = 'Type 0 to show the job has no contract value.'
  return out
}

/**
 * The contract value to save, when the box says something other than what
 * is on file: a different amount, or the same amount with GST the other
 * way. Null when there is nothing to save (blank, unchanged, or not an
 * amount, which checkValues reports).
 */
export function contractEditOf(v: JobFormValues, initial: JobFormValues): { sum: number; gstInclusive: boolean } | null {
  const sum = parseMoney(v.contractValue)
  if (sum === null || Number.isNaN(sum) || contractValueProblem(v.contractValue)) return null
  const was = parseMoney(initial.contractValue)
  if (was === sum && v.contractGstInclusive === initial.contractGstInclusive) return null
  return { sum, gstInclusive: v.contractGstInclusive }
}

/**
 * The insert's fields from the form (buildJobInsert checks them). The
 * builder goes by `builderName`, the resolved spelling (ResolvedBuilder.name),
 * not the box as typed.
 */
function draftOf(v: JobFormValues, builderName: string) {
  return {
    name: v.name,
    workType: v.workType,
    address: v.address,
    builderName,
    colour: v.colour ?? '',
    fence: v.fence ?? { lat: Number.NaN, lng: Number.NaN, radiusM: 0 },
    status: v.status,
    startsOn: v.startsOn || null,
    endsOn: v.endsOn || null,
    captainId: v.captainId || null,
  }
}

/**
 * The job's own columns that differ from the row, as an edit. Untouched
 * fields are left out, so a phone-made job keeps the phone's fallbacks (no
 * colour of its own, a builder name with no record) unless somebody changes
 * them here. jobPatch then writes only what really changed, and the four
 * fence columns together.
 */
function columnsEdit(site: JobSiteRow, v: JobFormValues, initial: JobFormValues): JobEdit {
  const edit: JobEdit = {}
  if (v.name.trim() !== site.name.trim()) edit.name = v.name
  if (trimmed(v.workType) !== trimmed(site.job_type)) edit.job_type = v.workType
  if (v.colour !== initial.colour) edit.colour = v.colour
  if (trimmed(v.address) !== trimmed(initial.address)) edit.address = v.address
  if (v.fence && (v.fence.lat !== site.lat || v.fence.lng !== site.lng)) Object.assign(edit, { lat: v.fence.lat, lng: v.fence.lng })
  if (v.fence && v.fence.radiusM !== site.radius_m) edit.radius_m = v.fence.radiusM
  if (v.startsOn !== (site.starts_on ?? '')) edit.starts_on = v.startsOn || null
  if (v.endsOn !== (site.ends_on ?? '')) edit.ends_on = v.endsOn || null
  if (v.captainId !== (site.captain_id ?? '')) edit.captain_id = v.captainId || null
  return edit
}

/**
 * What to save for one of the builder's people. A project manager or
 * contract administrator is the builder's one person in that role, so the
 * draft edits whoever is on file (typing over them changes them on every
 * job, as the phone's editor does). A site supervisor is edited in place
 * only while the name is still theirs; a new name is somebody else, found
 * by name among the builder's supervisors or added.
 */
function draftFor(role: ContactRole, typed: ContactValue, onFile: OnFile): ContactDraft {
  const holder = onFile[role]
  const id = ONE_PER_BUILDER.includes(role) ? (holder?.id ?? null) : holder && sameName(holder.name, typed.name) ? holder.id : null
  return { id, name: typed.name.trim(), mobile: typed.mobile.trim() || null, email: typed.email.trim() || null }
}

/** A contact that did not save, as an issue the job page can retry (data/jobs.ts contactIssue, for an edit). */
function contactIssue(role: ContactRole, draft: ContactDraft, builderId: string, builderName: string, e: unknown): CreateIssue {
  if (e instanceof RoleTakenError) {
    const label = CONTACT_LABEL[role].toLowerCase()
    const builder = builderName.trim() || 'this builder'
    return {
      step: 'contact',
      role,
      builderId,
      draft: { ...draft, id: e.holder.id },
      message: `Not saved: ${e.holder.name} is the ${label} for ${builder}, on every job for them. Retry to make ${draft.name} the ${label} on every job for ${builder} instead.`,
    }
  }
  return { step: 'contact', role, draft, builderId, message: e instanceof Error ? e.message : String(e) }
}

/** What an edit settled, for mergeIssues. */
export interface Settled {
  /** The job's columns the edit wrote, each read back as sent (updateJob). */
  written: string[]
  /** The edit set the job's builder (another, none, or a record for the name). */
  builder: boolean
  /** The builder's people the edit saved, or now reports as not saved. */
  roles: ContactRole[]
  /** The edit set or took off the job's site supervisor, or moved it to a builder whose supervisor the old one cannot be. */
  supervisor: boolean
  /** The edit saved the contract value, or now reports it as not saved. */
  contract?: boolean
}

/** createJob's wording for columns that read back other than entered (data/jobs.ts). */
const OFF_COLUMNS = /^The job saved, but (.+) did not save as entered\.$/

/**
 * The issues the job page lists after an edit: those from before that the
 * edit has not settled, then the edit's own. Pure.
 *
 * Settled means the edit itself decided the thing, so retrying the old issue
 * would at best do nothing and at worst undo what was just saved (a site
 * supervisor that failed when the job was made, retried after another was
 * picked here, would replace them):
 *  - 'job', columns that read back differently: the columns this edit wrote
 *    read back as sent, so they come off the list, and the issue goes when
 *    none are left. Wording it does not recognise is kept as it is.
 *  - 'builder': the edit set the job's builder.
 *  - 'contact': the edit saved that role, or reports it again itself.
 *  - 'supervisor', the job's link: the edit set or cleared it, or changed
 *    the builder, whose supervisor the old one cannot be.
 * A crew booking and other jobs to link are never touched by an edit, and
 * always stay.
 */
export function mergeIssues(before: CreateIssue[], mine: CreateIssue[], settled: Settled): CreateIssue[] {
  const kept: CreateIssue[] = []
  for (const issue of before) {
    switch (issue.step) {
      case 'job': {
        const off = OFF_COLUMNS.exec(issue.message)?.[1].split(', ')
        if (!off) {
          kept.push(issue)
          break
        }
        const left = off.filter((k) => !settled.written.includes(k))
        if (left.length === off.length) kept.push(issue)
        else if (left.length) kept.push({ ...issue, message: `The job saved, but ${left.join(', ')} did not save as entered.` })
        break
      }
      case 'builder':
        if (!settled.builder) kept.push(issue)
        break
      case 'contact':
        if (!settled.roles.includes(issue.role)) kept.push(issue)
        break
      case 'supervisor':
        if (!settled.supervisor) kept.push(issue)
        break
      case 'contract':
        if (!settled.contract) kept.push(issue)
        break
      default:
        kept.push(issue)
    }
  }
  return [...kept, ...mine]
}

/** A JobInputError's field, as the form's. */
function fieldOf(field: string): FieldKey {
  switch (field) {
    case 'name':
    case 'colour':
    case 'builder':
    case 'address':
    case 'status':
    case 'crew':
      return field
    case 'starts_on':
      return 'startsOn'
    case 'ends_on':
      return 'endsOn'
    case 'supervisor_contact_id':
      return 'contact.supervisor'
    case 'captain_id':
      return 'captain'
    default:
      return 'fence'
  }
}

/**
 * The toast after an edit: what was saved, and when it reaches the crew. The
 * fence is named apart, because a moved fence is the one change that works
 * at once (api/ping.ts reads it afresh on every location check), and an
 * address saved with the pin where it was must never read as a fence moved.
 */
function savedWhat(written: string[], fence: { pinMoved: boolean; radiusChanged: boolean; addressChanged: boolean }, people: boolean): string {
  const where = fence.pinMoved
    ? fence.addressChanged
      ? 'the address and the fence'
      : 'the fence'
    : fence.addressChanged
      ? fence.radiusChanged
        ? 'the address and the radius (the pin has not moved)'
        : 'the address (the fence has not moved)'
      : fence.radiusChanged
        ? 'the fence radius'
        : null
  const others = people || written.some((k) => !['lat', 'lng', 'radius_m', 'address'].includes(k))
  const parts = [where ? (others ? `Changes saved, with ${where}.` : `Saved ${where}.`) : 'Changes saved.']
  if (fence.pinMoved || fence.radiusChanged) parts.push('Clock-on uses the new circle from now on.')
  parts.push('Crew phones show the changes next time the app is opened.')
  return parts.join(' ')
}
