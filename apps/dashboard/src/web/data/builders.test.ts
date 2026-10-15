import { describe, expect, it } from 'vitest'
import type { JobSiteRow } from '../phone'
import {
  builderPatch,
  contactsOf,
  driftOf,
  escapeLike,
  findOrCreateBuilder,
  linkCandidates,
  linkOtherJobs,
  linkSkipNote,
  notSupervisorFor,
  RoleTakenError,
  saveContact,
  setJobBuilder,
  setJobSupervisor,
  suggestionsOf,
  type ContactRow,
} from './builders'
import type { Db } from './jobs'

/** A scripted stand-in for supabase-js: each request is recorded and answered by `reply`. */
interface Call {
  table: string
  op: string
  payload?: unknown
  filters: Array<[string, ...unknown[]]>
  single?: boolean | 'maybe'
}
function fakeDb(reply: (call: Call) => { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), b),
        update: (p: unknown) => ((call.op = 'update'), (call.payload = p), b),
        delete: () => ((call.op = 'delete'), b),
        single: () => ((call.single = true), b),
        maybeSingle: () => ((call.single = 'maybe'), b),
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
          calls.push(call)
          const { data = [], error = null } = reply(call)
          const out =
            call.single === 'maybe' && Array.isArray(data)
              ? { data: data[0] ?? null, error }
              : call.single && Array.isArray(data)
                ? { data: data[0] ?? null, error: data.length === 1 ? error : (error ?? { message: 'no rows' }) }
                : { data, error }
          return Promise.resolve(out).then(ok, bad)
        },
      }
      for (const m of ['eq', 'in', 'is', 'ilike', 'order', 'limit']) b[m] = (...args: unknown[]) => (call.filters.push([m, ...args]), b)
      return b
    },
  }
  return { client: client as unknown as Db, calls }
}

const contact = (over: Partial<ContactRow>): ContactRow => ({ id: 'c', builder_id: 'b-1', role: 'supervisor', name: 'Sam', mobile: null, email: null, note: null, ...over })

describe('escapeLike', () => {
  it('escapes % and _ (and the escape character itself) so ilike matches the name and nothing else', () => {
    expect(escapeLike('100% Tiling')).toBe('100\\% Tiling')
    expect(escapeLike('A_B Homes')).toBe('A\\_B Homes')
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x')
    expect(escapeLike('Paramoint')).toBe('Paramoint')
  })
})

describe('findOrCreateBuilder', () => {
  it('asks with the escaped name, oldest first, and takes the oldest exact match', async () => {
    const fake = fakeDb(() => ({
      data: [
        { id: 'b-old', name: '100%_homes', created_at: '2025-01-01' },
        { id: 'b-new', name: '100% Homes', created_at: '2026-01-01' },
      ],
    }))
    const out = await findOrCreateBuilder('co', '  100%_Homes ', { client: fake.client })
    expect(out).toEqual({ id: 'b-old', name: '100%_homes', created: false })
    expect(fake.calls[0]!.filters).toEqual([
      ['ilike', 'name', '100\\%\\_Homes'],
      ['order', 'created_at'],
      ['order', 'id'],
    ])
    expect(fake.calls).toHaveLength(1)
  })

  it('does not take a row the pattern over-matched; it makes the builder instead', async () => {
    const fake = fakeDb((c) => (c.op === 'insert' ? { data: [{ id: 'b-9', name: 'A*B', created_at: 'now' }] } : { data: [{ id: 'b-1', name: 'AxxB', created_at: '2025' }] }))
    const out = await findOrCreateBuilder('co', 'A*B', { client: fake.client })
    expect(out).toEqual({ id: 'b-9', name: 'A*B', created: true })
    expect(fake.calls[1]!.payload).toEqual({ company_id: 'co', name: 'A*B' })
  })

  it('makes {company_id, name} only, with the spacing tidied, and needs a name', async () => {
    const fake = fakeDb((c) => (c.op === 'insert' ? { data: [{ id: 'b-2', name: 'ZZ Builder', created_at: 'now' }] } : { data: [] }))
    expect(await findOrCreateBuilder('co', ' ZZ   Builder ', { client: fake.client })).toEqual({ id: 'b-2', name: 'ZZ Builder', created: true })
    expect(fake.calls[1]!.payload).toEqual({ company_id: 'co', name: 'ZZ Builder' })
    await expect(findOrCreateBuilder('co', '   ', { client: fake.client })).rejects.toThrow(/needs a name/)
  })

  it('throws when RLS refuses the insert', async () => {
    const fake = fakeDb((c) => (c.op === 'insert' ? { data: [] } : { data: [] }))
    await expect(findOrCreateBuilder('co', 'X', { client: fake.client })).rejects.toThrow()
  })
})

describe('suggestionsOf', () => {
  it('offers builder records and names typed on jobs, once each, case aside, oldest record first', () => {
    const sites = [
      { id: 's1', name: 'Seacombe gardens', status: 'starting_soon' as const, client_name: 'Paramoint', builder_id: null },
      { id: 's2', name: 'Glenelg', status: 'active' as const, client_name: 'PARAMOINT', builder_id: null },
      { id: 's3', name: 'Norwood', status: 'archived' as const, client_name: 'Other Homes', builder_id: 'b-2' },
      { id: 's4', name: 'Unley', status: 'active' as const, client_name: 'Hickinbotham', builder_id: null },
      { id: 's5', name: 'Blank', status: 'active' as const, client_name: '  ', builder_id: null },
    ]
    const out = suggestionsOf(
      [
        { id: 'b-2', name: 'Other Homes', created_at: '2026-02-01' },
        { id: 'b-1', name: 'Paramoint', created_at: '2026-01-01' },
        { id: 'b-3', name: 'paramoint ', created_at: '2026-03-01' },
      ],
      sites,
    )
    expect(out.map((s) => [s.name, s.builderId, s.jobs.map((j) => j.id)])).toEqual([
      ['Hickinbotham', null, ['s4']],
      ['Other Homes', 'b-2', ['s3']],
      ['Paramoint', 'b-1', ['s1', 's2']],
    ])
  })
})

describe('saveContact', () => {
  const args = { companyId: 'co', builderId: 'b-1', role: 'supervisor' as const }

  it("inserts the phone's row, blanks as null", async () => {
    const fake = fakeDb((c) => (c.op === 'insert' ? { data: [{ ...contact({ id: 'c-1', name: 'ZZ Sup' }) }] } : { data: [] }))
    const out = await saveContact({ ...args, draft: { name: ' ZZ Sup ', mobile: ' ', email: '' } }, { client: fake.client })
    expect(out.action).toBe('inserted')
    expect(fake.calls[1]!.payload).toEqual({ company_id: 'co', builder_id: 'b-1', role: 'supervisor', name: 'ZZ Sup', mobile: null, email: null })
  })

  it('takes a name already on file as that person: adds only what was typed, keeps the spelling, never blanks', async () => {
    const onFile = [contact({ id: 'c-6', name: 'Alex' }), contact({ id: 'c-7', name: 'Sam  Taylor', mobile: '0400 111 222', email: 'sam@example.invalid' })]
    const fake = fakeDb((c) => (c.op === 'update' ? { data: [{ ...onFile[1]!, ...(c.payload as object) }] } : { data: onFile }))
    const out = await saveContact({ ...args, draft: { name: 'sam taylor', mobile: '0499 999 999', email: '  ' } }, { client: fake.client })
    expect(out).toMatchObject({ action: 'updated', contact: { id: 'c-7', name: 'Sam  Taylor', mobile: '0499 999 999', email: 'sam@example.invalid' } })
    expect(fake.calls[1]).toMatchObject({
      op: 'update',
      payload: { mobile: '0499 999 999' },
      filters: [
        ['eq', 'id', 'c-7'],
        ['eq', 'builder_id', 'b-1'],
        ['eq', 'role', 'supervisor'],
      ],
    })
    // Name only: nothing to add, nothing written.
    const quiet = fakeDb(() => ({ data: onFile }))
    expect(await saveContact({ ...args, draft: { name: 'SAM TAYLOR' } }, { client: quiet.client })).toEqual({ action: 'unchanged', contact: onFile[1] })
    expect(quiet.calls.map((c) => c.op)).toEqual(['select'])
  })

  const mine = [
    ['eq', 'id', 'c-7'],
    ['eq', 'builder_id', 'b-1'],
    ['eq', 'role', 'supervisor'],
  ]

  it("edits a contact by id exactly as typed, blanks as null (the phone editor), only if it is this builder's, in this role", async () => {
    const fake = fakeDb((c) => ({ data: [contact({ id: 'c-7', ...(c.payload as object) })] }))
    await saveContact({ ...args, draft: { id: 'c-7', name: ' Sam ', mobile: '', email: null } }, { client: fake.client })
    expect(fake.calls).toEqual([expect.objectContaining({ op: 'update', payload: { name: 'Sam', mobile: null, email: null }, filters: mine })])
  })

  it("refuses an id that names another builder's person, or someone in another role, and writes nothing else", async () => {
    const theirs = fakeDb((c) => (c.op === 'update' ? { data: [] } : { data: [contact({ id: 'c-7', builder_id: 'b-2', name: 'Their Sam' })] }))
    await expect(saveContact({ ...args, draft: { id: 'c-7', name: 'Sam' } }, { client: theirs.client })).rejects.toThrow('Their Sam belongs to another builder, so they were not changed here.')
    expect(theirs.calls.map((c) => c.op)).toEqual(['update', 'select'])
    const pm = fakeDb((c) => (c.op === 'update' ? { data: [] } : { data: [contact({ id: 'c-7', role: 'project_manager', name: 'PM One' })] }))
    await expect(saveContact({ ...args, draft: { id: 'c-7', name: 'Sam' } }, { client: pm.client })).rejects.toThrow(
      "PM One is this builder's project manager, not their site supervisor, so they were not changed.",
    )
    const del = fakeDb((c) => (c.op === 'delete' ? { data: [] } : { data: [contact({ id: 'c-7', builder_id: 'b-2', name: 'Their Sam' })] }))
    await expect(saveContact({ ...args, draft: { id: 'c-7', name: '' } }, { client: del.client })).rejects.toThrow(/another builder/)
    expect(del.calls.map((c) => c.op)).toEqual(['delete', 'select'])
  })

  it('saves the draft as typed when the person it edits is no longer on file, and says so', async () => {
    const pmArgs = { ...args, role: 'project_manager' as const }
    // Removed on a phone, nobody in the role now: the one typed is added.
    const empty = fakeDb((c) => (c.op === 'insert' ? { data: [contact({ id: 'c-new', role: 'project_manager', name: 'PM Two' })] } : { data: [] }))
    expect(await saveContact({ ...pmArgs, draft: { id: 'c-pm1', name: 'PM Two', mobile: '0422 222 222' } }, { client: empty.client })).toEqual({
      action: 'inserted',
      contact: contact({ id: 'c-new', role: 'project_manager', name: 'PM Two' }),
      note: 'The project manager this was to replace is no longer on file, so PM Two was added as the project manager.',
    })
    expect(empty.calls.map((c) => `${c.op}${c.single === 'maybe' ? ' by id' : ''}`)).toEqual(['update', 'select by id', 'select', 'insert'])
    expect(empty.calls[3]!.payload).toEqual({ company_id: 'co', builder_id: 'b-1', role: 'project_manager', name: 'PM Two', mobile: '0422 222 222', email: null })
    // Removed, and somebody else is the PM now: a fresh RoleTakenError naming them, saying what happened.
    const pm3 = contact({ id: 'c-pm3', role: 'project_manager', name: 'PM Three' })
    const taken = fakeDb((c) => (c.op === 'select' && !c.single ? { data: [pm3] } : { data: [] }))
    const err = await saveContact({ ...pmArgs, draft: { id: 'c-pm1', name: 'PM Two' } }, { client: taken.client }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RoleTakenError)
    expect(err).toMatchObject({ holder: pm3, replacedGone: true, message: expect.stringMatching(/^The project manager this was to replace is no longer on file\. .*PM Three/) })
    expect(taken.calls.some((c) => c.op === 'insert')).toBe(false)
    // Removed, and blanking them: nothing left to do.
    const blank = fakeDb(() => ({ data: [] }))
    expect(await saveContact({ ...pmArgs, draft: { id: 'c-pm1', name: ' ' } }, { client: blank.client })).toEqual({
      action: 'none',
      contact: null,
      note: 'The project manager had already been removed.',
    })
  })

  it('refuses a second project manager or contract administrator, writing nothing; supervisors may be several', async () => {
    const pm = contact({ id: 'c-pm', role: 'project_manager', name: 'PM One' })
    const fake = fakeDb(() => ({ data: [pm] }))
    const err = await saveContact({ ...args, role: 'project_manager', draft: { name: 'PM Two' } }, { client: fake.client }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RoleTakenError)
    expect(err).toMatchObject({ role: 'project_manager', holder: pm, message: expect.stringContaining('PM One') })
    expect(fake.calls.map((c) => c.op)).toEqual(['select'])
    // The same name is that person, not a second one.
    const same = fakeDb(() => ({ data: [pm] }))
    expect((await saveContact({ ...args, role: 'project_manager', draft: { name: 'pm one' } }, { client: same.client })).action).toBe('unchanged')
    // Only the first PM is ever shown, so a hidden second of that name is not "the same person".
    const twins = fakeDb(() => ({ data: [pm, contact({ id: 'c-pm2', role: 'project_manager', name: 'PM Two' })] }))
    await expect(saveContact({ ...args, role: 'project_manager', draft: { name: 'PM Two' } }, { client: twins.client })).rejects.toBeInstanceOf(RoleTakenError)
    const sup = fakeDb((c) => (c.op === 'insert' ? { data: [contact({ id: 'c-s2', name: 'Sup Two' })] } : { data: [contact({ id: 'c-s1', name: 'Sup One' })] }))
    expect((await saveContact({ ...args, draft: { name: 'Sup Two' } }, { client: sup.client })).action).toBe('inserted')
  })

  it('deletes the contact being edited when the name is cleared, read back', async () => {
    const ok = fakeDb(() => ({ data: [{ id: 'c-1' }] }))
    expect(await saveContact({ ...args, draft: { id: 'c-1', name: '  ' } }, { client: ok.client })).toEqual({ action: 'deleted', contact: null })
    expect(ok.calls[0]).toMatchObject({
      op: 'delete',
      filters: [
        ['eq', 'id', 'c-1'],
        ['eq', 'builder_id', 'b-1'],
        ['eq', 'role', 'supervisor'],
      ],
    })
    // Nothing deleted, and the row is still there: refused.
    const refused = fakeDb((c) => (c.op === 'delete' ? { data: [] } : { data: [contact({ id: 'c-1' })] }))
    await expect(saveContact({ ...args, draft: { id: 'c-1', name: '' } }, { client: refused.client })).rejects.toThrow(/refused/)
    const none = fakeDb(() => ({ data: [] }))
    expect(await saveContact({ ...args, draft: { name: '' } }, { client: none.client })).toEqual({ action: 'none', contact: null })
    expect(none.calls).toEqual([])
  })

  it('throws when an update comes back empty and the contact is still there (refused)', async () => {
    const fake = fakeDb((c) => (c.op === 'update' ? { data: [] } : { data: [contact({ id: 'c-1' })] }))
    await expect(saveContact({ ...args, draft: { id: 'c-1', name: 'Sam' } }, { client: fake.client })).rejects.toThrow(
      'Saving the contact was refused. Only an owner login can set up jobs.',
    )
  })
})

describe("a job's builder", () => {
  const job = (over: Partial<JobSiteRow>) => ({ id: 'j', builder_id: null, client_name: null, supervisor_contact_id: null, ...over }) as JobSiteRow

  it('changing the builder clears the supervisor link; linking the same name does not', () => {
    expect(builderPatch(job({ builder_id: 'b-1', client_name: 'Paramoint', supervisor_contact_id: 'c-1' }), { id: 'b-2', name: 'Other Homes' })).toEqual({
      builder_id: 'b-2',
      client_name: 'Other Homes',
      supervisor_contact_id: null,
    })
    expect(builderPatch(job({ client_name: 'paramoint', supervisor_contact_id: 'c-1' }), { id: 'b-1', name: 'Paramoint' })).toEqual({
      builder_id: 'b-1',
      client_name: 'Paramoint',
    })
    expect(builderPatch(job({ builder_id: 'b-1', client_name: 'Paramoint', supervisor_contact_id: 'c-1' }), null)).toEqual({
      builder_id: null,
      client_name: null,
      supervisor_contact_id: null,
    })
    expect(builderPatch(job({ builder_id: 'b-1', client_name: 'Paramoint' }), { id: 'b-1', name: 'Paramoint' })).toEqual({})
  })

  it('setJobBuilder links the record, copies its name and drops the old supervisor, read back', async () => {
    const before = job({ id: 'j1', builder_id: 'b-1', client_name: 'Paramoint', supervisor_contact_id: 'c-1' })
    const fake = fakeDb((c) =>
      c.table === 'builders'
        ? { data: [{ id: 'b-2', name: 'Other Homes', created_at: '2025' }] }
        : { data: [{ ...before, ...(c.payload as object) }] },
    )
    const out = await setJobBuilder('co', before, 'other homes', { client: fake.client })
    expect(out.builder).toEqual({ id: 'b-2', name: 'Other Homes' })
    expect(fake.calls[1]).toMatchObject({ table: 'job_sites', op: 'update', payload: { builder_id: 'b-2', client_name: 'Other Homes', supervisor_contact_id: null } })
    const refused = fakeDb((c) => (c.table === 'builders' ? { data: [{ id: 'b-2', name: 'Other Homes', created_at: '2025' }] } : { data: [] }))
    await expect(setJobBuilder('co', before, 'Other Homes', { client: refused.client })).rejects.toThrow(/refused/)
  })

  it('offers to link other jobs with the same name and no link to this record', () => {
    const sites = [
      job({ id: 'a', client_name: 'Paramoint' }),
      job({ id: 'b', client_name: ' paramoint ' }),
      job({ id: 'c', client_name: 'Paramoint', builder_id: 'b-1' }),
      job({ id: 'd', client_name: 'Other' }),
      job({ id: 'e', client_name: 'Paramoint', builder_id: 'b-dupe' }),
    ]
    expect(linkCandidates(sites, { id: 'b-1', name: 'Paramoint' }, 'a').map((s) => s.id)).toEqual(['b', 'e'])
  })

  it('links them with the record name, read back, and says which did not link', async () => {
    // The jobs as read again, then each update answered as RLS would let it through.
    const fresh = [job({ id: 'x', name: 'X', client_name: 'paramoint' }), job({ id: 'y', name: 'Y', client_name: 'Paramoint', builder_id: 'b-dupe', supervisor_contact_id: 'c-9' })]
    const ok = fakeDb((c) =>
      c.op === 'select' ? { data: fresh } : { data: (c.filters[0]![2] as string[]).map((id) => ({ id, builder_id: 'b-1', client_name: 'Paramoint' })) },
    )
    expect(await linkOtherJobs({ id: 'b-1', name: 'Paramoint' }, [{ id: 'x' }, { id: 'y' }], { client: ok.client })).toEqual({ linked: ['x', 'y'], skipped: [] })
    expect(ok.calls[0]).toMatchObject({ table: 'job_sites', op: 'select', filters: [['in', 'id', ['x', 'y']]] })
    expect(ok.calls.filter((c) => c.op === 'update').map((c) => c.payload)).toEqual([
      { builder_id: 'b-1', client_name: 'Paramoint' },
      { builder_id: 'b-1', client_name: 'Paramoint', supervisor_contact_id: null },
    ])
    const partial = fakeDb((c) =>
      c.op === 'select'
        ? { data: [job({ id: 'x', client_name: 'Paramoint' }), job({ id: 'z', client_name: 'Paramoint' })] }
        : { data: [{ id: 'x', builder_id: 'b-1', client_name: 'Paramoint' }] },
    )
    await expect(linkOtherJobs({ id: 'b-1', name: 'Paramoint' }, [{ id: 'x' }, { id: 'z' }], { client: partial.client })).rejects.toMatchObject({
      failed: ['z'],
      linked: ['x'],
      skipped: [],
    })
  })

  it("reads the jobs again and leaves alone any whose builder changed since they were offered (L)", async () => {
    const fresh = [
      // Builder edited on a phone since (client_name only, as Project details does).
      job({ id: 'a', name: 'Job A', client_name: 'Someone Else' }),
      // Already linked to this record under its name: counts as linked, not written.
      job({ id: 'b', name: 'Job B', client_name: 'Paramoint', builder_id: 'b-1' }),
      // Linked to this record but now says another builder: left alone, not renamed back.
      job({ id: 'c', name: 'Job C', client_name: 'Other Homes', builder_id: 'b-1' }),
      // Still goes by the name: linked.
      job({ id: 'd', name: 'Job D', client_name: ' paramoint ' }),
      // Builder taken off since.
      job({ id: 'e', name: 'Job E', client_name: null }),
    ]
    const fake = fakeDb((c) =>
      c.op === 'select' ? { data: fresh } : { data: (c.filters[0]![2] as string[]).map((id) => ({ id, builder_id: 'b-1', client_name: 'Paramoint' })) },
    )
    const out = await linkOtherJobs({ id: 'b-1', name: 'Paramoint' }, ['a', 'b', 'c', 'd', 'e', 'gone'].map((id) => ({ id })), { client: fake.client })
    expect(out).toEqual({
      linked: ['b', 'd'],
      skipped: [
        { id: 'a', name: 'Job A', now: 'Someone Else' },
        { id: 'c', name: 'Job C', now: 'Other Homes' },
        { id: 'e', name: 'Job E', now: '' },
      ],
    })
    // Only Job D is written.
    expect(fake.calls.filter((c) => c.op === 'update').map((c) => c.filters)).toEqual([[['in', 'id', ['d']]]])
    expect(linkSkipNote(out.skipped, 'Paramoint')).toBe(
      "Not linked to Paramoint, because those jobs' builders have changed since: Job A (now Someone Else), Job C (now Other Homes), Job E (no builder now).",
    )
    expect(linkSkipNote(out.skipped.slice(0, 1), 'Paramoint')).toBe("Not linked to Paramoint, because that job's builder has changed since: Job A (now Someone Else).")
    expect(linkSkipNote([], 'Paramoint')).toBeNull()
    // Nothing to write at all: no update is sent.
    const none = fakeDb((c) => (c.op === 'select' ? { data: [fresh[0]] } : { data: [] }))
    expect(await linkOtherJobs({ id: 'b-1', name: 'Paramoint' }, [{ id: 'a' }], { client: none.client })).toEqual({ linked: [], skipped: [{ id: 'a', name: 'Job A', now: 'Someone Else' }] })
    expect(none.calls.map((c) => c.op)).toEqual(['select'])
  })

  it("flags a job whose name no longer matches the record it is linked to", () => {
    expect(driftOf(job({ builder_id: 'b-1', client_name: 'Paramount' }), { id: 'b-1', name: 'Paramoint' })).toEqual({ onJob: 'Paramount', record: 'Paramoint' })
    expect(driftOf(job({ builder_id: 'b-1', client_name: 'Paramoint' }), { id: 'b-1', name: 'Paramoint' })).toBeNull()
    expect(driftOf(job({ builder_id: null, client_name: 'Paramount' }), { id: 'b-1', name: 'Paramoint' })).toBeNull()
  })

  it("links a job only to a site supervisor of the job's own builder", async () => {
    const sup = contact({ id: 'c-1', builder_id: 'b-1', name: 'Sup One' })
    expect(notSupervisorFor(sup, 'b-1')).toBeNull()
    expect(notSupervisorFor(sup, 'b-2', 'Builder Two')).toBe('Sup One is a site supervisor for another builder, not for Builder Two.')
    expect(notSupervisorFor({ ...sup, role: 'project_manager' }, 'b-1')).toBe("Sup One is the builder's project manager, not a site supervisor.")
    expect(notSupervisorFor(sup, null)).toMatch(/builder first/)
    expect(notSupervisorFor(null, 'b-1')).toMatch(/no longer on file/)

    // Only while the job is on the supervisor's builder: the update carries that as a condition.
    const ok = fakeDb((c) => (c.op === 'update' ? { data: [{ id: 'j', supervisor_contact_id: 'c-1' }] } : { data: [] }))
    await setJobSupervisor('j', sup, { client: ok.client })
    expect(ok.calls).toEqual([
      expect.objectContaining({
        table: 'job_sites',
        op: 'update',
        payload: { supervisor_contact_id: 'c-1' },
        filters: [
          ['eq', 'id', 'j'],
          ['eq', 'builder_id', 'b-1'],
        ],
      }),
    ])
    // The job is on another builder now: nothing matched, and it says why.
    const moved = fakeDb((c) => (c.op === 'update' ? { data: [] } : { data: [{ builder_id: 'b-2', client_name: 'Builder Two' }] }))
    await expect(setJobSupervisor('j', sup, { client: moved.client })).rejects.toThrow('Sup One is a site supervisor for another builder, not for Builder Two.')
    // By id: looked up first; a project manager or a removed contact is never linked.
    const pm = fakeDb((c) => (c.table === 'builder_contacts' ? { data: [{ ...sup, role: 'project_manager' }] } : { data: [] }))
    await expect(setJobSupervisor('j', 'c-1', { client: pm.client })).rejects.toThrow(/not a site supervisor/)
    expect(pm.calls.some((c) => c.op === 'update')).toBe(false)
    const gone = fakeDb(() => ({ data: [] }))
    await expect(setJobSupervisor('j', 'c-1', { client: gone.client })).rejects.toThrow(/no longer on file/)
    // Refused by RLS while on the right builder.
    const refused = fakeDb((c) => (c.op === 'update' ? { data: [] } : { data: [{ builder_id: 'b-1', client_name: 'Builder One' }] }))
    await expect(setJobSupervisor('j', sup, { client: refused.client })).rejects.toThrow(/refused/)
    // Nobody: no condition needed.
    const none = fakeDb(() => ({ data: [{ id: 'j', supervisor_contact_id: null }] }))
    await setJobSupervisor('j', null, { client: none.client })
    expect(none.calls[0]).toMatchObject({ payload: { supervisor_contact_id: null }, filters: [['eq', 'id', 'j']] })
  })

  it("shows the builder's people the phone's way: the job's supervisor first, one per role", () => {
    const sup = contact({ id: 'c-2', builder_id: 'b-1', role: 'supervisor', name: 'Job Sup' })
    const people = [contact({ id: 'c-1', role: 'supervisor', name: 'Other Sup' }), contact({ id: 'c-3', role: 'project_manager', name: 'PM' }), sup]
    const out = contactsOf({ builder_id: null, supervisor_contact_id: 'c-2' }, sup, people)
    expect(out.builderId).toBe('b-1')
    expect(out.byRole.supervisor?.id).toBe('c-2')
    expect(out.byRole.project_manager?.id).toBe('c-3')
    expect(out.byRole.contract_admin).toBeNull()
    expect(out.all.map((c) => c.id)).toEqual(['c-2', 'c-1', 'c-3'])
  })
})
