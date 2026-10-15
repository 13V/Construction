import { describe, expect, it } from 'vitest'
import { DEFAULT_CENTER, type JobSiteRow } from '../phone'
import type { WpPackageRow } from '../phone-features'
import type { ContactRow } from './builders'
import { fencePlaced, readinessOf, type ReadinessRows } from './readiness'

const NOW = new Date(2027, 2, 1, 9, 0)

/** Seacombe gardens as the phone made it: a name, an address, a builder typed in, a fence, dates. */
const phoneMade: JobSiteRow = {
  id: 'site-1',
  company_id: 'co',
  name: 'Seacombe gardens',
  address: '2 brigalow Ave',
  job_type: 'Bathrooms',
  status: 'starting_soon',
  lat: -35.0284,
  lng: 138.5425,
  radius_m: 150,
  budget: null,
  client_name: 'Paramoint',
  progress_pct: null,
  schedule_note: null,
  contract_value: null,
  captain_id: null,
  supervisor_contact_id: null,
  builder_id: null,
  starts_on: '2026-09-15',
  ends_on: '2026-09-30',
  colour: null,
}

const nothing: Omit<ReadinessRows, 'site'> = { selections: [], files: [], programmes: [], safety: [], bookings: [], wpPackage: null, wpFiles: [], contacts: [], now: NOW }

const person = (over: Partial<ContactRow>): ContactRow => ({ id: 'c', builder_id: 'b-1', role: 'supervisor', name: 'Sam Taylor', mobile: null, email: null, note: null, ...over })

const pkg = (over: Partial<WpPackageRow>): WpPackageRow => ({
  id: 'p1',
  unit: null,
  product_internal: null,
  product_external: null,
  installed_on: null,
  installed_by: null,
  flood_test_on: null,
  flood_test_result: 'not_completed',
  flood_test_hours: null,
  builder_signed_name: null,
  builder_signed_at: null,
  certificate_no: null,
  certificate_generated_at: null,
  certificate_path: null,
  certificate_sent_at: null,
  certificate_sent_to: null,
  scope_of_work: null,
  completion_on: null,
  warranty_years: 10,
  ...over,
})

const item = (r: ReturnType<typeof readinessOf>, key: string) => r.items.find((i) => i.key === key)!

describe('readinessOf', () => {
  it("reads a phone-made job: fence and dates, a builder typed but not linked, nothing else", () => {
    const r = readinessOf({ site: phoneMade, ...nothing })
    expect(r.items.map((i) => [i.key, i.done])).toEqual([
      ['fence', true],
      ['builder', false],
      ['dates', true],
      ['supervisor', false],
      ['scope', false],
      ['drawings', false],
      ['programme', false],
      ['swms', false],
      ['crew', false],
      ['captain', false],
    ])
    expect(r).toMatchObject({ done: 2, total: 10, scope: { decided: 0, total: 7 }, waterproofing: { done: 0, total: 6 } })
    expect(item(r, 'builder').detail).toBe('Paramoint, typed but not linked to a builder')
    expect(item(r, 'scope').label).toBe('0 of 7 scope decided')
  })

  it('treats a pin left in the middle of Adelaide as not placed', () => {
    expect(fencePlaced({ lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng })).toBe(false)
    expect(fencePlaced({ lat: DEFAULT_CENTER.lat + 0.0005, lng: DEFAULT_CENTER.lng })).toBe(false)
    expect(fencePlaced({ lat: -34.98, lng: 138.46 })).toBe(true)
    expect(item(readinessOf({ site: { ...phoneMade, ...DEFAULT_CENTER }, ...nothing }), 'fence')).toMatchObject({ done: false, fix: 'edit' })
  })

  it('counts every item when the job is set up', () => {
    const site = { ...phoneMade, builder_id: 'b-1', supervisor_contact_id: 'c-1', captain_id: 'w-cap' }
    const r = readinessOf({
      site,
      ...nothing,
      selections: [
        ...['tiles', 'grout', 'silicone', 'angles', 'mitres', 'grates'].map((k) => ({ scope_key: k, status: 'chosen' as const })),
        { scope_key: 'strip_drains', status: 'not_applicable' },
      ],
      files: [{ id: 'f1', kind: 'document', supersedes: null, selection_id: null, waterproofing_package_id: null }],
      programmes: [{ status: 'current' }],
      safety: [{ kind: 'swms', site_id: 'site-1', is_template: false, active: true, expires_on: null }],
      bookings: [{ worker_id: 'w1', starts_at: new Date(2027, 2, 2, 7).toISOString() }],
    })
    expect(r.done).toBe(10)
    expect(r.items.every((i) => i.done)).toBe(true)
    expect(item(r, 'scope').label).toBe('7 of 7 scope decided')
    expect(item(r, 'crew')).toMatchObject({ label: 'Crew booked', detail: '1 person booked from today', fix: 'crew' })
  })

  it("says '1 of 7 scope decided', counting extras and ignoring retired keys as the phone does", () => {
    const r = readinessOf({ site: phoneMade, ...nothing, selections: [{ scope_key: 'grout', status: 'chosen' }, { scope_key: 'old_key', status: 'chosen' }] })
    expect(item(r, 'scope')).toMatchObject({ label: '1 of 7 scope decided', done: false, fix: 'scope' })
    const extra = readinessOf({ site: phoneMade, ...nothing, selections: [{ scope_key: null, status: 'pending' }] })
    expect(item(extra, 'scope').label).toBe('0 of 8 scope decided')
  })

  it('counts current drawings only: not scope attachments, not waterproofing files, not superseded sheets', () => {
    const files = [
      { id: 'a', kind: 'document', supersedes: null, selection_id: null, waterproofing_package_id: null },
      { id: 'b', kind: 'document', supersedes: 'a', selection_id: null, waterproofing_package_id: null },
      { id: 's', kind: 'document', supersedes: null, selection_id: 'sel', waterproofing_package_id: null },
      { id: 'w', kind: 'document', supersedes: null, selection_id: null, waterproofing_package_id: 'p1' },
      { id: 'p', kind: 'photo', supersedes: null, selection_id: null, waterproofing_package_id: null },
    ]
    expect(item(readinessOf({ site: phoneMade, ...nothing, files }), 'drawings')).toMatchObject({ done: true, detail: '1 sheet' })
    expect(item(readinessOf({ site: phoneMade, ...nothing, files: files.slice(2) }), 'drawings').done).toBe(false)
  })

  it("counts a SWMS on this job or the whole company's shelf, not another job's, not a template, not an expired one", () => {
    const swms = (over: Partial<ReadinessRows['safety'][number]>) => ({ kind: 'swms' as const, site_id: 'site-1', is_template: false, active: true, expires_on: null, ...over })
    const on = (safety: ReadinessRows['safety']) => item(readinessOf({ site: phoneMade, ...nothing, safety }), 'swms').done
    expect(on([swms({})])).toBe(true)
    expect(on([swms({ site_id: null })])).toBe(true)
    expect(on([swms({ site_id: 'other' })])).toBe(false)
    expect(on([swms({ is_template: true })])).toBe(false)
    expect(on([swms({ active: false })])).toBe(false)
    expect(on([swms({ kind: 'policy' })])).toBe(false)
    expect(on([swms({ expires_on: '2020-01-01' })])).toBe(false)
    expect(item(readinessOf({ site: phoneMade, ...nothing, safety: [swms({ expires_on: '2020-01-01' })] }), 'swms').detail).toBe('The SWMS has expired')
  })

  it('counts crew booked from today on, not bookings in the past', () => {
    const past = [{ worker_id: 'w1', starts_at: new Date(2027, 1, 26, 7).toISOString() }]
    expect(item(readinessOf({ site: phoneMade, ...nothing, bookings: past }), 'crew').done).toBe(false)
    const today = [
      { worker_id: 'w1', starts_at: new Date(2027, 2, 1, 7).toISOString() },
      { worker_id: 'w2', starts_at: new Date(2027, 2, 3, 7).toISOString() },
      { worker_id: 'w2', starts_at: new Date(2027, 2, 4, 7).toISOString() },
    ]
    expect(item(readinessOf({ site: phoneMade, ...nothing, bookings: today }), 'crew').detail).toBe('2 people booked from today')
  })

  it("names the supervisor the phone shows on a job not linked to one, and says what is missing", () => {
    const sup = person({ id: 'c-sup', name: 'Q Sup One', mobile: '0400 777 001', email: 'q@example.invalid' })
    const pm = person({ id: 'c-pm', role: 'project_manager', name: 'Q PM' })
    const site = { ...phoneMade, builder_id: 'b-1', client_name: 'Q Builder' }
    // Made for an existing builder with no supervisor typed: the phone shows the builder's first supervisor.
    expect(item(readinessOf({ site, ...nothing, contacts: [pm, sup] }), 'supervisor')).toEqual({
      key: 'supervisor',
      label: 'Site supervisor',
      done: false,
      detail: 'Not linked to this job. The phone shows Q Sup One, but SWMS and waterproofing certificate emails have no one to go to',
      fix: 'edit',
    })
    // Nobody at all.
    expect(item(readinessOf({ site, ...nothing, contacts: [pm] }), 'supervisor')).toMatchObject({
      done: false,
      detail: 'Not set for this job, so SWMS and waterproofing certificate emails have no one to go to',
    })
    // Another builder's supervisor is not this builder's, even if the rows include them.
    expect(item(readinessOf({ site, ...nothing, contacts: [person({ id: 'x', builder_id: 'b-2', name: 'Other Sup' })] }), 'supervisor').done).toBe(false)
  })

  it('counts a linked supervisor, naming them, and not one who works for another builder', () => {
    const sup = person({ id: 'c-sup', name: 'Sam Taylor', email: 'sam@example.invalid' })
    const site = { ...phoneMade, builder_id: 'b-1', supervisor_contact_id: 'c-sup' }
    expect(item(readinessOf({ site, ...nothing, contacts: [sup] }), 'supervisor')).toMatchObject({ done: true, detail: 'Sam Taylor' })
    expect(item(readinessOf({ site, ...nothing, contacts: [{ ...sup, email: null }] }), 'supervisor')).toMatchObject({
      done: true,
      detail: 'Sam Taylor, with no email for SWMS and certificates',
    })
    // P1: a job moved to Builder Two still pointing at Builder One's supervisor.
    const old = person({ id: 'c-old', builder_id: 'b-1', name: 'P Sup One' })
    expect(item(readinessOf({ site: { ...site, builder_id: 'b-2', supervisor_contact_id: 'c-old' }, ...nothing, contacts: [old] }), 'supervisor')).toMatchObject({
      done: false,
      detail: 'P Sup One is linked, but is a site supervisor for another builder: the phone shows them, and emails go to them',
    })
    // A phone-made job with no builder record, pointing at a supervisor: the phone finds the builder through them.
    expect(item(readinessOf({ site: { ...phoneMade, supervisor_contact_id: 'c-sup' }, ...nothing, contacts: [sup] }), 'supervisor').done).toBe(true)
    // Linked to someone the rows do not include yet: linked is linked.
    expect(item(readinessOf({ site, ...nothing }), 'supervisor')).toMatchObject({ done: true, detail: 'Linked to this job' })
  })

  it("reports waterproofing as the phone's six steps, beside the checklist", () => {
    const r = readinessOf({
      site: phoneMade,
      ...nothing,
      wpPackage: pkg({ product_internal: 'Ardex WPM 300', product_external: 'Ardex WPM 002', installed_on: '2027-02-01', flood_test_result: 'pass' }),
    })
    expect(r.waterproofing).toEqual({ done: 3, total: 6 })
    expect(r.total).toBe(10)
  })
})
