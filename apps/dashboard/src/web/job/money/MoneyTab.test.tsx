import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { figuresOf, moneyOf, OFFICE_ONLY, stateOf, type MoneyReads } from '../../data/money'
import type { JobSiteRow, WorkerRow } from '../../phone'
import MoneyTab from '../tabs/MoneyTab'
import { ClaimBand, ContractCard, SectionTable, Summary } from './parts'

/**
 * The Money tab's screens, rendered to markup: what someone who is not the
 * office sees (the rig signs in as the owner only), what the office sees
 * before the figures arrive, and the parts the figures are drawn with.
 * The figures themselves are money.test.ts's.
 */

const site = {
  id: 'site-1',
  company_id: 'co-1',
  name: 'ZZ job',
  address: '7 Money Test Street, Glenelg SA 5045',
  status: 'active',
  client_name: 'ZZ Builder',
} as JobSiteRow

const me = (office: boolean) => ({ id: 'w-1', company_id: 'co-1', name: 'Ann', is_office: office, role: office ? 'owner' : 'captain' }) as WorkerRow

const reads = (over: Partial<MoneyReads> = {}): MoneyReads => ({
  row: {
    contract_id: 'k-1',
    contract_sum_ex: 48000,
    approved_variations: 2000,
    job_value_ex: 50000,
    claimed_ex: 15000,
    labour_hours: 25,
    labour_cost: 1188.75,
    material_cost: 2470,
    expense_cost: 515,
    sublet_cost: 650,
    margin_pct: null,
  },
  progress: { pct_complete: 44 },
  invoices: [{ invoice_no: 'INV-2', period: null, issued_on: '2026-10-15', ex_tax: 15000 }],
  variations: [],
  materials: [],
  expenses: [{ vendor: 'Hire Shop', category: 'Equipment Rental', amount: 220, tax: 20, id: 'e-1', spent_on: '2026-10-03', receipt_path: 'co-1/site-1/u-hire.pdf' }],
  subcontracts: [],
  shifts: [],
  crew: [],
  pay: [],
  wet: [],
  contract: {
    id: 'k-1',
    contract_no: 'HC-1042',
    order_no: null,
    contract_sum: 48000,
    gst_inclusive: false,
    retention_pct: 5,
    payment_terms_days: 45,
    signed_on: '2026-09-01',
    starts_on: null,
    due_on: null,
  },
  ...over,
})

describe('the Money tab', () => {
  it('tells a login that is not the office’s whose tab it is, with no figures and no buttons', () => {
    const html = renderToStaticMarkup(<MoneyTab me={me(false)} site={site} reloadJob={() => {}} />)
    expect(html).toContain(OFFICE_ONLY.replace(/\.$/, ''))
    expect(html).toContain('what has been claimed')
    expect(html).not.toContain('Add supplier invoice')
    expect(html).not.toContain('Loading')
  })

  it('gives the office its two buttons straight away, and says it is loading', () => {
    const html = renderToStaticMarkup(<MoneyTab me={me(true)} site={site} reloadJob={() => {}} />)
    expect(html).toContain('Add supplier invoice')
    expect(html).toContain('Add a cost')
    expect(html).toContain('Loading')
  })
})

describe('the parts', () => {
  const m = moneyOf(reads(), new Date('2026-10-21T10:00:00+10:30'))

  it('the summary: value, margin at today and what it is measured on, done, claimed', () => {
    const html = renderToStaticMarkup(<Summary figures={m.figures} state={m.state} />)
    for (const s of ['Contract value', '$50,000', 'Ex GST, with the approved variations', 'Margin at today', '78.1%', 'On $22,000 of work done, $4,824 spent so far', 'Done', '44%', 'Claimed', '$15,000', '30% of the job']) {
      expect(html).toContain(s)
    }
  })

  it('a margin with nothing to measure against says why', () => {
    const none = moneyOf(reads({ progress: null }))
    expect(renderToStaticMarkup(<Summary figures={none.figures} state={none.state} />)).toContain('Needs the work measured on site')
  })

  it('the band: the phone’s capitals as its heading, the sentence under it', () => {
    const html = renderToStaticMarkup(<ClaimBand ban={m.figures.ban!} />)
    expect(m.figures.ban!.tone).toBe('a')
    expect(html).toContain('data-money-ban="a"')
    expect(html).toContain('BEHIND ON CLAIMING</span>')
    expect(html).toContain('Claimed 30% against 44% done. There is $7,000 of finished work not yet claimed.')
  })

  it('a row as a table: its name, note and total, every line, and a file to open', () => {
    const mats = figuresOf(stateOf(reads())).sections.find((s) => s.key === 'mats')!
    const html = renderToStaticMarkup(<SectionTable section={mats} />)
    expect(html).toContain('Materials &amp; hire')
    expect(html).toContain('1 line')
    expect(html).toContain('Hire Shop · Equipment Rental')
    expect(html).toContain('3 Oct 2026 · $220 inc GST')
    expect(html).toContain('Open file')
    expect(html).toContain('$200')
  })

  it('an empty row says what the phone says', () => {
    const vars = figuresOf(stateOf(reads())).sections.find((s) => s.key === 'vars')!
    expect(renderToStaticMarkup(<SectionTable section={vars} />)).toContain('No variations raised on this job.')
  })

  it('the contract card: the row’s terms, Not set for a blank, and the way to Edit job', () => {
    const html = renderToStaticMarkup(<ContractCard contract={reads().contract!} approvedVariations={2000} editHref="/jobs/site-1/edit" />)
    for (const s of ['$48,000 ex GST', '$2,000 ex GST', 'HC-1042', 'Not set', '5% of each claim', '45 days from the invoice', 'href="/jobs/site-1/edit"', 'Change on Edit job']) {
      expect(html).toContain(s)
    }
    expect(html).not.toContain('Completion due')
  })
})
