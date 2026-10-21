import { describe, expect, it } from 'vitest'
import { BLANK_CONTRACT, contractDraftOf, type JobContract } from '../../phone'
import { BLANK_CONTACT, checkValues, mergeIssues, savedWhat, type JobFormValues } from './useJobForm'

/** A new job that can be saved as it stands, plus `over`. */
const form = (over: Partial<JobFormValues> = {}): JobFormValues => ({
  name: 'ZZ Maple Ridge',
  workType: '',
  colour: '#5C8A63',
  builder: '',
  address: '',
  fence: { lat: -34.98, lng: 138.46, radiusM: 150 },
  startsOn: '',
  endsOn: '',
  status: 'starting_soon',
  captainId: '',
  contacts: { project_manager: BLANK_CONTACT, supervisor: BLANK_CONTACT, contract_admin: BLANK_CONTACT },
  linkOthers: true,
  bookCrew: false,
  crew: { workerIds: [], from: '', to: '' },
  ...BLANK_CONTRACT,
  ...over,
})

const ON_FILE: JobContract = { id: 'k-1', contract_sum: 48500, gst_inclusive: false, contract_no: 'C-2291', order_no: null, retention_pct: 5, payment_terms_days: 30 }
const NEW = { mode: 'create' as const, changedRoles: [], builderName: '' }

describe('checkValues: the contract', () => {
  it('lets a job be saved with no contract, or with a whole one', () => {
    expect(checkValues(form(), NEW)).toEqual({})
    expect(checkValues(form({ contractValue: '48,500', contractNo: 'C-1', orderNo: 'PO 1', retentionPct: '5', paymentTermsDays: '30' }), NEW)).toEqual({})
  })

  it("says what is wrong with each box, as the phone's Money tab does", () => {
    expect(checkValues(form({ contractValue: 'lots', retentionPct: '120', paymentTermsDays: '30.5' }), NEW)).toEqual({
      contractValue: expect.stringMatching(/amount of dollars/),
      retentionPct: 'Retention is a percentage from 0 to 100.',
      paymentTermsDays: expect.stringMatching(/whole number of days/),
    })
  })

  it('needs the value for details typed on a job with no contract, and 0 rather than a blank for one on file', () => {
    expect(checkValues(form({ orderNo: 'PO 1' }), NEW)).toEqual({ contractValue: expect.stringMatching(/as well/) })
    const edit = { mode: 'edit' as const, changedRoles: [], builderName: '', contract: ON_FILE }
    expect(checkValues(form({ ...contractDraftOf(ON_FILE) }), edit)).toEqual({})
    expect(checkValues(form({ ...contractDraftOf(ON_FILE), contractValue: '' }), edit)).toEqual({ contractValue: 'Type 0 to show the job has no contract value.' })
  })
})

describe('savedWhat', () => {
  const still = { pinMoved: false, radiusChanged: false, addressChanged: false }
  it('says a contract saved on its own is for the Money tab, not the crew', () => {
    expect(savedWhat([], still, { people: false, contract: true })).toMatch(/^Saved the contract\. The Money tab/)
    expect(savedWhat([], still, { people: false, contract: true })).not.toMatch(/Crew phones/)
  })
  it('still says when other changes reach the crew', () => {
    expect(savedWhat(['name'], still, { people: false, contract: true })).toMatch(/^Changes saved\..*Crew phones show the changes/)
    expect(savedWhat([], still, { people: true, contract: false })).toMatch(/^Changes saved\./)
  })
})

describe('mergeIssues: the contract', () => {
  const contract = { step: 'contract' as const, sum: 1000, gstInclusive: false, message: 'timeout' }
  const settled = { written: [], builder: false, roles: [], supervisor: false }
  it('keeps an earlier contract issue until an edit saves the contract or reports it again', () => {
    expect(mergeIssues([contract], [], settled)).toEqual([contract])
    expect(mergeIssues([contract], [], { ...settled, contract: true })).toEqual([])
    const again = { ...contract, contractNo: 'C-1', message: 'refused' }
    expect(mergeIssues([contract], [again], { ...settled, contract: true })).toEqual([again])
  })
})
