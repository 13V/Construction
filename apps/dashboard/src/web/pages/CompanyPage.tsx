/**
 * Company, /company: the phone's own Business details sheet (BusinessSheet),
 * unchanged, in a 560 px column, with one line above it saying what the
 * company's paperwork still lacks.
 *
 * The sheet is the phone's code, so a save here is the phone's save: the same
 * ABN check, the same trimming, the same read-back that catches an update RLS
 * quietly refused. Closing it goes back to the jobs board.
 *
 * THE LINE UNDER THE TITLE is complianceGaps(), the phone's own rule, run on
 * the companies row as the database has it. A new company lands here with
 * nothing filled in, and every SWMS and certificate it issues prints its ABN,
 * licence, address and signatory from this row (data/documents.ts) and
 * silently leaves out whatever is blank. The sheet's own amber box says the
 * same about what is typed in the form; this line is what is saved, so the
 * two agree once Save has been pressed. The page reads the row again when the
 * sheet goes still after a save (HostedSheet), so the line catches up within
 * a second.
 *
 * A save writes every field the sheet shows, from the copy it loaded, so a
 * sheet that is behind would put old details back over somebody else's. To
 * know whether it is behind, the page reads the form off the sheet (the
 * fields' values, never changing them) and compares it with the row: a
 * change the form shows, or showed when Save was pressed, is on screen;
 * any other change was saved somewhere else (the owner on his phone, another
 * window), whenever it is found. A sheet nobody has touched is then reloaded
 * quietly, and so is one left as it loaded or was saved once it has been
 * left alone a few seconds; one with typing in it gets a banner instead,
 * because reloading would throw the typing away.
 *
 * If the row cannot be read, the sheet is a blank card (it shows its own
 * error only beside a form), so the page says so and offers Try again. If
 * only the sheet's own read failed and the page's worked, there is nothing
 * to tell anyone: the page finds the blank card and reloads it quietly.
 */
import { useCallback, useState } from 'react'
import { supabase } from '../phone'
import { BusinessSheet, complianceGaps } from '../phone-features'
import type { PageProps } from '../routes'
import { navigate, paths } from '../router'
import { Page } from '../shell/PageHeader'
import { announceCompanyName } from '../shell/Rail'
import { color } from '../tokens'
import { HostedSheet, type SheetForm } from './TeamPage'

/** The companies row as the Business sheet reads it (Business.tsx's CompanyRow). */
interface CompanyRow {
  id: string
  name: string
  legal_name: string | null
  abn: string | null
  acn: string | null
  licence_no: string | null
  certifier_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  bank_bsb: string | null
  bank_account: string | null
  bank_account_name: string | null
  gst_registered: boolean
}

/**
 * The columns the sheet reads (Business.tsx's COLS), in its order, so a
 * change to any field it shows is noticed. A column it adds later and this
 * misses only means a change to it is noticed late.
 */
const COMPANY_COLS =
  'id, name, legal_name, abn, acn, licence_no, certifier_name, address, phone, email, ' +
  'bank_bsb, bank_account, bank_account_name, gst_registered'

export default function CompanyPage({ me }: PageProps) {
  // undefined until the first read that works.
  const [row, setRow] = useState<CompanyRow | undefined>(undefined)

  const read = useCallback(async () => {
    const { data, error } = await supabase().from('companies').select(COMPANY_COLS).eq('id', me.company_id).maybeSingle()
    if (error) throw error
    // No row is as good as a failed read: the sheet shows nothing without one.
    if (!data) throw new Error('The company row could not be read.')
    return data as unknown as CompanyRow
  }, [me.company_id])

  return (
    <Page title="Company" subtitle={<GapsLine row={row} />}>
      <HostedSheet
        label="Business details, as the app shows them"
        read={read}
        onRead={(next) => {
          setRow(next)
          announceCompanyName(next.name)
        }}
        writes={COMPANY_WRITES}
        form={BUSINESS_FORM}
        check={blankCard}
        behind={{
          title: 'These details were changed somewhere else',
          body: 'Since this page opened they were saved from the app or another window. Saving here would put back what this form shows.',
          action: 'Load the latest',
        }}
        failed="Could not load your business details"
      >
        <BusinessSheet me={me} onClose={() => navigate(paths.jobs)} />
      </HostedSheet>
    </Page>
  )
}

// ------------------------------------------------- the form, read off the sheet

/** The sheet's one control that writes, by its text as Business.tsx draws it. */
const COMPANY_WRITES = ['SAVE'] as const

type TextCol = Exclude<keyof CompanyRow, 'id' | 'gst_registered'>

/**
 * Each field as the sheet labels it (Business.tsx), the column it edits, and
 * how Save cleans what is typed before writing it (Business.tsx's save()):
 * trimmed, or with every space taken out. Both sides are cleaned the same
 * way, so " 0412 " typed and "0412" saved count as the same.
 */
const FIELDS: ReadonlyArray<readonly [label: string, col: TextCol, clean: 'trim' | 'squash']> = [
  ['TRADING NAME', 'name', 'trim'],
  ['LEGAL NAME (IF DIFFERENT)', 'legal_name', 'trim'],
  ['ABN', 'abn', 'squash'],
  ['ACN (IF A COMPANY)', 'acn', 'squash'],
  ['BUILDERS LICENCE', 'licence_no', 'trim'],
  ['WHO SIGNS CERTIFICATES', 'certifier_name', 'trim'],
  ['BUSINESS ADDRESS', 'address', 'trim'],
  ['PHONE', 'phone', 'trim'],
  ['EMAIL', 'email', 'trim'],
  ['ACCOUNT NAME', 'bank_account_name', 'trim'],
  ['BSB', 'bank_bsb', 'squash'],
  ['ACCOUNT NUMBER', 'bank_account', 'squash'],
]

const cleaned = (how: 'trim' | 'squash', v: string | null) => (how === 'trim' ? (v ?? '').trim() : (v ?? '').replace(/\s/g, ''))

/**
 * The Business sheet as a SheetForm. If the phone ever relabels a field or
 * redraws the GST switch, read() finds no form and the page falls back to
 * timing (HostedSheet): a save is still told from a change made elsewhere,
 * less sharply.
 */
const BUSINESS_FORM: SheetForm<CompanyRow> = {
  of: (row) => JSON.stringify([...FIELDS.map(([, col, how]) => cleaned(how, row[col])), row.gst_registered]),
  read: (sheet) => {
    // Each field sits straight after its label (Business.tsx's textRow, and
    // the ABN, address, BSB and account number written out the same way).
    const typed = new Map<string, string>()
    for (const field of sheet.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      const label = field.previousElementSibling?.textContent
      if (label) typed.set(label, field.value)
    }
    const values: string[] = []
    for (const [label, , how] of FIELDS) {
      const v = typed.get(label)
      if (v === undefined) return null
      values.push(cleaned(how, v))
    }
    const gst = gstSwitch(sheet)
    return gst === null ? null : JSON.stringify([...values, gst])
  },
}

/**
 * Once the sheet has loaded (HostedSheet asks only then), it shows its form,
 * or nothing at all: its own read failed or found no row, and it has nothing
 * a save could start from. Only a sheet with no field in it at all counts as
 * blank, so a form the page cannot read (a field relabelled) is never taken
 * for one and reloaded on every read.
 */
const blankCard = (sheet: HTMLElement): 'empty' | null => (sheet.querySelector('input, textarea') ? null : 'empty')

/**
 * The GST switch, which is a span, not a field: its knob is moved 20 px
 * right when it is on (Business.tsx). Null when it is not where the sheet
 * draws it.
 */
function gstSwitch(sheet: HTMLElement): boolean | null {
  const title = [...sheet.querySelectorAll('span')].find((el) => el.childElementCount === 0 && el.textContent === 'Registered for GST')
  const knob = title?.parentElement?.nextElementSibling?.firstElementChild
  if (!(knob instanceof HTMLElement)) return null
  const moved = knob.style.transform
  return moved === 'none' ? false : moved.startsWith('translateX(') ? true : null
}

/**
 * What the paperwork still lacks, in one line: the phone's complianceGaps()
 * on the saved row. Each gap is shown by its first half ("an ABN"); the
 * second half, what leaving it out costs, is on hover, and in full in the
 * sheet's own amber box below.
 */
function GapsLine({ row }: { row: CompanyRow | undefined }) {
  if (!row) return <span>What goes on your SWMS, certificates and invoices.</span>
  const gaps = complianceGaps(row)
  if (gaps.length === 0) {
    return (
      <span data-company-gaps="0" style={{ display: 'inline-flex', gap: 6 }}>
        <Dot tone={color.green} />
        <span style={{ color: color.body }}>Everything your SWMS and certificates need about the business is on file.</span>
      </span>
    )
  }
  return (
    <span data-company-gaps={gaps.length} style={{ display: 'inline-flex', gap: 6 }}>
      <Dot tone={color.amber} />
      <span style={{ color: color.body }}>
        Your SWMS and certificates still need{' '}
        {gaps.map((gap, i) => (
          <span key={gap}>
            {i === 0 ? '' : i === gaps.length - 1 ? ' and ' : ', '}
            <span data-gap="" title={gap} style={{ fontWeight: 600, color: color.amber }}>
              {gap.split(' — ')[0]}
            </span>
          </span>
        ))}
        .
      </span>
    </span>
  )
}

/** On the first line's middle (the subtitle is 13/18), however many lines the sentence wraps to. */
function Dot({ tone }: { tone: string }) {
  return <span aria-hidden="true" style={{ flex: 'none', width: 7, height: 7, marginTop: 6, borderRadius: '50%', background: tone }} />
}
