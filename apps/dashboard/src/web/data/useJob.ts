/**
 * One job, with its builder and the builder's people.
 *
 * Read by id with no status filter, so an archived job opens too (the board
 * links to archived jobs, and Restore lives on the job page). The contacts
 * are worked out the way the phone's Project details works them out
 * (builders.ts contactsOf): the job's own supervisor first, then the
 * builder's people, one per role. The builder is the job's builder_id, or
 * failing that the supervisor's builder.
 *
 * Refreshes when the window regains focus, when the tab becomes visible
 * again and every 60 s while visible (useFresh), unless { fresh: false }. A
 * refresh that fails keeps the job on screen and reports the error. Loads
 * can overlap (a focus refresh and the reload after a write); only the one
 * asked for last lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, type JobSiteRow } from '../phone'
import { CONTACT_COLS, contactsOf, driftOf, type BuilderRecord, type ContactRow } from './builders'
import type { ContactRole } from './contract'
import { useFresh } from './useFresh'

export interface JobData {
  state: 'loading' | 'ready' | 'missing' | 'failed'
  site: JobSiteRow | null
  /** The builders row behind the job, if any. */
  builder: BuilderRecord | null
  /** One per role, as the phone shows them. */
  contacts: Record<ContactRole, ContactRow | null>
  /** Everyone on the builder's side, supervisor first. */
  allContacts: ContactRow[]
  /** client_name no longer says what the linked record is called (a phone edit). */
  drift: { onJob: string; record: string } | null
  error: string | null
  reload: () => Promise<void>
}

const NO_CONTACTS: Record<ContactRole, ContactRow | null> = { project_manager: null, supervisor: null, contract_admin: null }

interface Loaded {
  site: JobSiteRow
  builder: BuilderRecord | null
  contacts: Record<ContactRole, ContactRow | null>
  allContacts: ContactRow[]
}

/** Read a job and its builder's people. Null when there is no such job (or it is not yours to see). */
export async function loadJob(id: string): Promise<Loaded | null> {
  const c = supabase()
  const { data, error } = await c.from('job_sites').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const site = data as JobSiteRow
  const sup = site.supervisor_contact_id
    ? await c.from('builder_contacts').select(CONTACT_COLS).eq('id', site.supervisor_contact_id).maybeSingle()
    : { data: null, error: null }
  if (sup.error) throw new Error(sup.error.message)
  const supRow = (sup.data as ContactRow | null) ?? null
  const builderId = site.builder_id ?? supRow?.builder_id ?? null
  const [b, all] = builderId
    ? await Promise.all([
        c.from('builders').select('id, name, created_at, active').eq('id', builderId).maybeSingle(),
        c.from('builder_contacts').select(CONTACT_COLS).eq('builder_id', builderId).order('created_at').order('id'),
      ])
    : [{ data: null, error: null }, { data: [], error: null }]
  if (b.error) throw new Error(b.error.message)
  if (all.error) throw new Error(all.error.message)
  const { byRole, all: allContacts } = contactsOf(site, supRow, (all.data ?? []) as ContactRow[])
  return { site, builder: (b.data as BuilderRecord | null) ?? null, contacts: byRole, allContacts }
}

export function useJob(id: string, { fresh = true }: { fresh?: boolean } = {}): JobData {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [state, setState] = useState<JobData['state']>('loading')
  const [error, setError] = useState<string | null>(null)
  // A slow answer for a job that is no longer on screen must not land.
  const current = useRef(id)
  useEffect(() => {
    current.current = id
  }, [id])
  // Nor may an older load that answers after a newer one: a reload on focus
  // that started before a status change and answers after the reload that
  // followed it would put the old status back. Each load takes a number and
  // only the latest one lands.
  const latest = useRef(0)

  const reload = useCallback(async () => {
    // A reload kept from before the job changed asks nothing, and so cannot
    // outnumber the load of the job now on screen.
    if (current.current !== id) return
    const mine = ++latest.current
    const stale = () => mine !== latest.current || current.current !== id
    try {
      const out = await loadJob(id)
      if (stale()) return
      setError(null)
      setLoaded(out)
      setState(out ? 'ready' : 'missing')
    } catch (e) {
      if (stale()) return
      setError(e instanceof Error ? e.message : String(e))
      setState((s) => (s === 'ready' ? 'ready' : 'failed'))
    }
  }, [id])

  useEffect(() => {
    setState('loading')
    setLoaded(null)
    void reload()
  }, [reload])
  useFresh(() => {
    if (fresh) void reload()
  })

  return {
    state,
    site: loaded?.site ?? null,
    builder: loaded?.builder ?? null,
    contacts: loaded?.contacts ?? NO_CONTACTS,
    allContacts: loaded?.allContacts ?? [],
    drift: loaded ? driftOf(loaded.site, loaded.builder) : null,
    error,
    reload,
  }
}
