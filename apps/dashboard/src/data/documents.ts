import type {
  ChangeOrderLineRow,
  ChangeOrderRow,
  ContractRow,
  InvoiceLineRow,
  InvoiceRow,
  WaterproofingRow,
} from './supabase'
import { LEFT, Page, RIGHT, WIDTH, buildPdf, details, footer, formatAbn, header, textWidth, wrap } from './pdf'

/**
 * The three documents this business hands to somebody else.
 *
 * Each one is built to survive being read by the person who is not on your
 * side: a builder's accounts team looking for a reason to reject a claim, a
 * contract administrator disputing a variation, an insurer's assessor two years
 * after a shower started leaking. That is why the compliance details are not
 * decoration — an Australian tax invoice over $82.50 that does not carry the
 * supplier's ABN can have its GST credit refused, and the builder will not
 * chase you about it, they will just not pay it.
 */

export interface CompanyDetails {
  name: string
  /** The Pty Ltd behind the trading name, when there is one (schema_v30). */
  legal_name?: string | null
  /** The licensed contractor who signs a certificate (schema_v30). */
  certifier_name?: string | null
  abn: string | null
  acn: string | null
  licence_no: string | null
  address: string | null
  phone: string | null
  email: string | null
  bank_bsb: string | null
  bank_account: string | null
  bank_account_name: string | null
  gst_registered: boolean
}

const LOCALE = 'en-AU'
const cents = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 })
const money = (n: number) => cents.format(Number.isFinite(n) ? n : 0)
const date = (v: string | null) =>
  v ? new Date(`${v}T00:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

/** Column edges for a line-item table. */
const COL_QTY = RIGHT - 250
const COL_UNIT = RIGHT - 150
const COL_AMOUNT = RIGHT

// -------------------------------------------------------------- tax invoice

export function invoicePdf(opts: {
  company: CompanyDetails
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  contract: ContractRow | null
  siteName: string | null
  builderName: string | null
  builderAbn: string | null
  variation: ChangeOrderRow | null
}): Blob {
  const { company, invoice, lines, contract, siteName, builderName, variation } = opts
  const page = new Page()

  // "Tax invoice" is the required wording when GST is charged; a document with
  // no GST on it must NOT say it, so the title follows the tax rather than the
  // company's usual practice.
  const hasGst = Number(invoice.tax_amount) > 0
  header(page, {
    company,
    title: hasGst ? 'Tax invoice' : 'Invoice',
    reference: invoice.invoice_no,
  })

  const billTo = builderName ?? invoice.client_name ?? 'Client'
  details(page, [
    ['Bill to', billTo],
    ['Invoice date', date(invoice.issued_on)],
    ['Their ABN', opts.builderAbn ? formatAbn(opts.builderAbn) : invoice.builder_abn ? formatAbn(invoice.builder_abn) : '-'],
    ['Due', date(invoice.due_on)],
    ['Job', siteName ?? '-'],
    ['Their reference', invoice.builder_job_ref ?? contract?.order_no ?? contract?.contract_no ?? '-'],
  ])
  page.down(10)

  if (invoice.period || variation) {
    page.text(
      variation ? `${variation.co_no} - ${variation.description}` : (invoice.period ?? ''),
      LEFT,
      { size: 11, font: 'HB' },
    )
    page.down(20)
  }

  // ---- lines
  page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
  page.down(6)
  page.text('DESCRIPTION', LEFT, { size: 7.5, font: 'HB', grey: 0.5 })
  page.text('%', COL_QTY, { size: 7.5, font: 'HB', grey: 0.5 })
  page.textRight('AMOUNT', COL_AMOUNT, { size: 7.5, font: 'HB', grey: 0.5 })
  page.down(14)
  page.rule(LEFT, RIGHT)
  page.down(8)

  const pages = [page]
  let current = page
  for (const l of lines) {
    if (current.full(30)) {
      current = new Page()
      pages.push(current)
    }
    const wrapped = wrap(l.description, COL_QTY - LEFT - 10, 10)
    for (let i = 0; i < wrapped.length; i++) {
      current.text(wrapped[i], LEFT, { size: 10 })
      if (i === 0) {
        if (l.pct_complete !== null) current.text(`${Number(l.pct_complete)}%`, COL_QTY, { size: 10, grey: 0.4 })
        current.textRight(money(Number(l.amount)), COL_AMOUNT, { size: 10 })
      }
      current.down(14)
    }
    if (l.cost_code) {
      current.text(l.cost_code, LEFT, { size: 8, grey: 0.55 })
      current.down(12)
    }
    current.down(2)
  }

  if (lines.length === 0) {
    current.text(invoice.period ?? 'Progress claim', LEFT, { size: 10 })
    current.textRight(money(Number(invoice.ex_tax) + Number(invoice.retention_amount)), COL_AMOUNT, { size: 10 })
    current.down(16)
  }

  // ---- totals
  current.down(6)
  current.rule(COL_UNIT - 20, RIGHT, { grey: 0.75 })
  current.down(10)

  const gross = Number(invoice.ex_tax) + Number(invoice.retention_amount)
  const totalRow = (label: string, value: string, bold = false) => {
    current.textRight(label, COL_AMOUNT - 110, { size: bold ? 11 : 10, font: bold ? 'HB' : 'H', grey: bold ? 0 : 0.4 })
    current.textRight(value, COL_AMOUNT, { size: bold ? 12 : 10, font: bold ? 'HB' : 'H' })
    current.down(bold ? 20 : 16)
  }

  if (Number(invoice.retention_amount) > 0) {
    totalRow('Value of work', money(gross))
    totalRow(`Less retention ${Number(invoice.retention_pct)}%`, `-${money(Number(invoice.retention_amount))}`)
  }
  totalRow('Subtotal ex GST', money(Number(invoice.ex_tax)))
  if (hasGst) totalRow(`GST ${Number(invoice.tax_rate)}%`, money(Number(invoice.tax_amount)))
  current.rule(COL_UNIT - 20, RIGHT, { grey: 0.75 })
  current.down(8)
  totalRow('Total due', money(Number(invoice.amount)), true)

  if (Number(invoice.paid_amount) > 0) {
    totalRow('Paid', `-${money(Number(invoice.paid_amount))}`)
    totalRow('Balance', money(Number(invoice.amount) - Number(invoice.paid_amount)), true)
  }

  // ---- how to pay, and the compliance line
  current.down(14)
  if (company.bank_bsb || company.bank_account) {
    current.text('PAYMENT', LEFT, { size: 7.5, font: 'HB', grey: 0.5 })
    current.down(12)
    current.text(
      [
        company.bank_account_name ?? company.name,
        company.bank_bsb ? `BSB ${company.bank_bsb}` : null,
        company.bank_account ? `Account ${company.bank_account}` : null,
        `Reference ${invoice.invoice_no}`,
      ]
        .filter(Boolean)
        .join('   '),
      LEFT,
      { size: 10 },
    )
    current.down(16)
  }

  if (invoice.note) {
    for (const line of wrap(invoice.note, WIDTH, 9)) {
      current.text(line, LEFT, { size: 9, grey: 0.4 })
      current.down(12)
    }
  }

  const foot: string[] = []
  if (hasGst && !company.abn) {
    // Said plainly on the document rather than silently omitted: an invoice
    // claiming GST without an ABN is one the builder's accountant will reject,
    // and finding that out from them costs a payment run.
    foot.push('WARNING: no ABN recorded for this business. A tax invoice without one can have its GST credit refused.')
  }
  if (invoice.is_rcti) foot.push('Recipient created tax invoice. Raised by the recipient under a written RCTI agreement.')
  if (contract?.contract_no) foot.push(`Claimed under contract ${contract.contract_no}.`)
  if (foot.length) footer(current, foot)

  return buildPdf(pages, `${invoice.invoice_no} ${company.name}`)
}

// ---------------------------------------------------------------- variation

export function variationPdf(opts: {
  company: CompanyDetails
  variation: ChangeOrderRow
  lines: ChangeOrderLineRow[]
  siteName: string | null
  builderName: string | null
}): Blob {
  const { company, variation, lines, siteName, builderName } = opts
  const page = new Page()

  header(page, { company, title: 'Variation', reference: variation.co_no })

  details(page, [
    ['To', builderName ?? '-'],
    ['Raised', date(variation.raised_on)],
    ['Job', siteName ?? '-'],
    ['Status', variation.status === 'approved' ? `Approved ${date(variation.approved_on)}` : statusWord(variation.status)],
  ])
  page.down(12)

  page.text(variation.description, LEFT, { size: 12, font: 'HB' })
  page.down(18)

  if (variation.detail) {
    for (const line of wrap(variation.detail, WIDTH, 10)) {
      page.text(line, LEFT, { size: 10, grey: 0.2 })
      page.down(14)
    }
    page.down(8)
  }

  page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
  page.down(6)
  page.text('SCOPE', LEFT, { size: 7.5, font: 'HB', grey: 0.5 })
  page.textRight('AMOUNT', COL_AMOUNT, { size: 7.5, font: 'HB', grey: 0.5 })
  page.down(14)
  page.rule(LEFT, RIGHT)
  page.down(8)

  const pages = [page]
  let current = page
  for (const l of lines) {
    if (current.full(30)) {
      current = new Page()
      pages.push(current)
    }
    const wrapped = wrap(l.name, COL_QTY - LEFT - 10, 10)
    wrapped.forEach((w, i) => {
      current.text(w, LEFT, { size: 10 })
      if (i === 0) current.textRight(money(Number(l.amount)), COL_AMOUNT, { size: 10 })
      current.down(14)
    })
    if (l.detail) {
      for (const d of wrap(l.detail, COL_QTY - LEFT - 10, 8.5)) {
        current.text(d, LEFT + 8, { size: 8.5, grey: 0.5 })
        current.down(11)
      }
    }
    current.down(2)
  }

  current.down(6)
  current.rule(COL_UNIT - 20, RIGHT, { grey: 0.75 })
  current.down(10)
  current.textRight('Variation total', COL_AMOUNT - 110, { size: 11, font: 'HB' })
  current.textRight(money(Number(variation.cost_impact)), COL_AMOUNT, { size: 12, font: 'HB' })
  current.down(20)

  if (Number(variation.days_impact) !== 0) {
    current.text(
      `Extension of time claimed: ${Number(variation.days_impact) > 0 ? '+' : ''}${Number(variation.days_impact)} days.`,
      LEFT,
      { size: 10, grey: 0.2 },
    )
    current.down(18)
  }

  // ---- signature
  current.down(20)
  if (variation.status === 'approved' && variation.signature) {
    current.text('APPROVED', LEFT, { size: 7.5, font: 'HB', grey: 0.5 })
    current.down(12)
    current.text(`${variation.signature.name}`, LEFT, { size: 11, font: 'HB' })
    current.down(14)
    current.text(
      `Signed ${new Date(variation.signature.signed_at).toLocaleString(LOCALE, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}. Added to the contract sum ${date(variation.approved_on)}.`,
      LEFT,
      { size: 9, grey: 0.4 },
    )
  } else {
    current.text('Signed', LEFT, { size: 9, grey: 0.5 })
    current.rule(LEFT + 50, LEFT + 280, { y: current.y + 12, grey: 0.5 })
    current.text('Date', LEFT + 320, { size: 9, grey: 0.5 })
    current.rule(LEFT + 355, RIGHT, { y: current.y + 12, grey: 0.5 })
    current.down(30)
    footer(current, [
      'This variation is not authorised until it is signed. Work covered by it should not proceed and cannot be billed.',
    ])
  }

  return buildPdf(pages, `${variation.co_no} variation`)
}

function statusWord(s: ChangeOrderRow['status']): string {
  return s === 'pending_client' ? 'Awaiting approval' : s === 'rejected' ? 'Declined' : 'Draft'
}

// ------------------------------------------------- waterproofing certificate

/**
 * The document the builder needs for their handover file, and the one that gets
 * read out loud if a wet area fails. Everything on it is a fact recorded before
 * the membrane was covered — that is why the record exists at all.
 */
export function waterproofingPdf(opts: {
  company: CompanyDetails
  record: WaterproofingRow
  siteName: string | null
  siteAddress: string | null
  builderName: string | null
  photoCount: number
}): Blob {
  const { company, record, siteName, siteAddress, builderName, photoCount } = opts
  const page = new Page()
  const ref = record.certificate_no ?? `WP-${record.id.slice(0, 8).toUpperCase()}`

  header(page, { company, title: 'Waterproofing certificate', reference: ref })

  details(page, [
    ['Job', siteName ?? '-'],
    ['Builder', builderName ?? '-'],
    ['Address', siteAddress ?? '-'],
    ['Wet area', record.area],
  ])
  page.down(14)

  page.text('This is to certify that the waterproofing membrane described below was applied', LEFT, { size: 10 })
  page.down(14)
  page.text('in accordance with AS 3740 and the manufacturer’s written instructions.', LEFT, { size: 10 })
  page.down(24)

  page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
  page.down(14)

  details(page, [
    ['Membrane', record.product_name ?? 'not recorded'],
    ['Batch', record.batch_no ?? 'not recorded'],
    ['Substrate', record.substrate ?? 'not recorded'],
    ['Primer', record.primer ?? 'not recorded'],
    ['Coats applied', String(record.coats)],
    ['Height up walls', record.wall_height_mm ? `${record.wall_height_mm} mm` : 'not recorded'],
    ['Angle fillet', record.angle_fillet ? 'Yes' : 'No'],
    ['Bond breaker', record.bond_breaker ? 'Yes' : 'No'],
    ['Started', date(record.started_on)],
    ['Completed', date(record.completed_on)],
    [
      'Flood test',
      record.flood_tested
        ? `Held ${record.flood_test_hours ?? 24} hours, ${date(record.flood_test_on)}`
        : 'NOT PERFORMED',
    ],
    ['Photographs on file', String(photoCount)],
  ])
  page.down(20)

  page.rule(LEFT, RIGHT, { grey: 0.75 })
  page.down(18)

  if (record.status === 'signed_off' && record.signed_off_at) {
    page.text(record.signed_off_name ?? 'Signed', LEFT, { size: 12, font: 'HB' })
    page.down(16)
    page.text(
      `${company.name}${company.licence_no ? `, licence ${company.licence_no}` : ''}`,
      LEFT,
      { size: 10, grey: 0.3 },
    )
    page.down(14)
    page.text(
      `Signed ${new Date(record.signed_off_at).toLocaleString(LOCALE, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`,
      LEFT,
      { size: 9, grey: 0.45 },
    )
  } else {
    page.text('NOT SIGNED OFF', LEFT, { size: 12, font: 'HB' })
    page.down(16)
    page.text('This is a draft. It is not a certificate and must not be issued.', LEFT, { size: 10, grey: 0.3 })
  }

  const foot: string[] = []
  if (!record.flood_tested) {
    foot.push('No flood test recorded. AS 3740 clause 3.7 requires the membrane to be water tested before covering.')
  }
  if (photoCount === 0) foot.push('No photographs on file for this wet area.')
  if (foot.length) footer(page, foot)

  return buildPdf([page], `${ref} ${record.area}`)
}

// ------------------------------------- Certificate of Compliance (a package)

/**
 * The client's own Certificate of Compliance, reproduced.
 *
 * This is not a document to design. Proven Tiling hands this exact page to a
 * builder, the builder countersigns the acknowledgement at the bottom, and it
 * goes in the handover file — so the headings, the clause wording and the
 * standards it cites are copied from theirs, not improved on. Where a fact is
 * missing the line still prints, empty, because a builder reading a certificate
 * with no completion date should see that rather than not see the field.
 *
 * Distinct from waterproofingPdf() above, which certifies ONE wet area from the
 * install register. This certifies the apartment: "waterproofing to bathroom +
 * ensuite + wc + balcony + laundry", one number, one signature.
 */
export interface WpPackageDoc {
  unit: string | null
  scope_of_work: string | null
  completion_on: string | null
  warranty_years: number
  certificate_no: string | null
  builder_signed_name: string | null
  builder_signed_at: string | null
}

/**
 * PTS-WP-250817-001 — initials, the document type, the day, the day's counter.
 * The initials come off the trading name so this is not one client's format
 * hardcoded, and the date is the issue date because that is what makes the
 * number unique and sortable in a builder's filing.
 */
export function certificateNo(companyName: string, on: Date, sequence: number): string {
  const initials =
    companyName
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'WP'
  const yy = String(on.getFullYear()).slice(2)
  const mm = String(on.getMonth() + 1).padStart(2, '0')
  const dd = String(on.getDate()).padStart(2, '0')
  return `${initials}-WP-${yy}${mm}${dd}-${String(sequence).padStart(3, '0')}`
}

/** The identity line under the letterhead rule, centred as on theirs. */
function identityLine(company: CompanyDetails): string {
  const who = company.legal_name && company.legal_name !== company.name
    ? `${company.legal_name} Trading as ${company.name}`
    : company.name
  return [
    company.abn ? `ABN: ${formatAbn(company.abn)}` : null,
    who,
    company.licence_no ? `BLD ${company.licence_no.replace(/^BLD\s*/i, '')}` : null,
  ]
    .filter(Boolean)
    .join('   |   ')
}

export function wpCertificatePdf(opts: {
  company: CompanyDetails
  pkg: WpPackageDoc
  siteName: string
  siteAddress: string | null
  builderName: string | null
  /** The licensed contractor who signs. Not whoever tapped the button. */
  signatoryName: string
  issuedOn: Date
}): Blob {
  const { company, pkg, siteName, siteAddress, builderName, signatoryName, issuedOn } = opts
  const page = new Page()

  // ------------------------------------------------------------- letterhead
  // Their letterhead is a wordmark top right over a rule, with the identity
  // line centred beneath it. No logo file is on record yet, so the trading
  // name sets in its place — same position, same weight.
  page.textRight(company.name, RIGHT, { size: 15, font: 'HB' })
  page.down(24)
  page.rule(LEFT, RIGHT, { grey: 0.55, width: 0.8 })
  page.down(9)

  const ident = identityLine(company)
  page.text(ident, LEFT + (WIDTH - textWidth(ident, 8, 'H')) / 2, { size: 8, grey: 0.25 })
  page.down(26)

  // ------------------------------------------------------------- the heading
  // The number goes on the same line, right-aligned: their template has no
  // field for it, but a builder filing this needs something to file it under,
  // and a document that cannot be referred to cannot be chased.
  page.text('Certificate of Compliance', LEFT, { size: 11.5, font: 'HB' })
  if (pkg.certificate_no) page.textRight(pkg.certificate_no, RIGHT, { size: 9, grey: 0.35, y: page.y + 3 })
  page.down(17)

  const scope = pkg.scope_of_work?.trim() || 'waterproofing'
  const label = 'Description of Work: '
  page.text(label, LEFT, { size: 9.5, font: 'HB' })
  const scopeX = LEFT + textWidth(label, 9.5, 'HB')
  const scopeLines = wrap(scope, RIGHT - scopeX, 9.5)
  scopeLines.forEach((l, i) => {
    page.text(l, i === 0 ? scopeX : LEFT, { size: 9.5, y: page.y + i * 13 })
  })
  page.down(scopeLines.length * 13 + 14)

  // ---------------------------------------------------------------- section
  const heading = (t: string) => {
    page.text(t, LEFT, { size: 9.5, font: 'HB' })
    page.down(14)
  }
  const line = (t: string, opts_: { grey?: number } = {}) => {
    for (const l of wrap(t, WIDTH, 9.5)) {
      page.text(l, LEFT, { size: 9.5, grey: opts_.grey })
      page.down(13)
    }
  }
  /** "Builder: Palumbo" — bold label, plain value, on one line. */
  const field = (k: string, v: string) => {
    page.text(k, LEFT, { size: 9.5 })
    page.text(v, LEFT + textWidth(k, 9.5, 'H') + 3, { size: 9.5 })
    page.down(13)
  }

  heading('Project Details')
  field('Project Name:', siteName)
  // Printed even on a house, blank — their form has the field and a builder
  // filling one in by hand is better than a missing line.
  field('Apartment No.', pkg.unit ?? '')
  field('Builder:', builderName ?? '')
  field('Date of Completion:', date(pkg.completion_on))
  if (siteAddress) field('Site Address:', siteAddress)
  page.down(9)

  heading('Standards and Regulations')
  line('This waterproofing work has been carried out in accordance with:')
  line('AS 3740:2021 - Waterproofing of domestic wet areas')
  line('Building Code of Australia (NCC Volume 2)')
  line("Manufacturer's installation instructions and specifications")
  page.down(9)

  heading('Statement of Compliance')
  line(
    'I, the undersigned, being a licensed waterproofing contractor, hereby certify that the ' +
      'waterproofing work described above:',
  )
  line('Has been completed in accordance with the relevant Australian Standards and manufacturer requirements.')
  line(
    'Has been applied to a clean, sound, and properly prepared surface; and is fit for its intended ' +
      'purpose at the time of completion.',
  )
  page.down(9)

  heading('Warranty')
  line(
    `The workmanship for the waterproofing installation is warranted for a period of ${pkg.warranty_years} ` +
      `year${pkg.warranty_years === 1 ? '' : 's'} from the date of completion, subject to normal use and ` +
      'maintenance and excluding damage caused by structural movement, abuse, or subsequent trades.',
  )
  line('Product warranties apply as provided by the respective manufacturers.')
  page.down(12)

  heading('Contractor Declaration')
  // Space for the signature. Theirs is an image; until one is on file this is
  // the room to sign in, which is what a printed certificate needs anyway.
  page.down(34)
  page.rule(LEFT, LEFT + 190, { grey: 0.7 })
  page.down(13)
  field('Name', signatoryName)
  field('Date:', date(pkg.completion_on) === '-' ? dateOf(issuedOn) : date(pkg.completion_on))
  page.down(12)

  heading('Builder Acknowledgement')
  line(
    'I acknowledge receipt of this Certificate of Compliance and confirm that the waterproofing areas ' +
      'have been inspected prior to tiling.',
  )
  page.down(6)

  // Signed already, or the blanks to sign in.
  if (pkg.builder_signed_at) {
    field('Signature:', pkg.builder_signed_name ?? '')
    field('Name (print):', pkg.builder_signed_name ?? '')
    field(
      'Date:',
      new Date(pkg.builder_signed_at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }),
    )
  } else {
    const blank = (k: string) => {
      page.text(k, LEFT, { size: 9.5 })
      page.rule(LEFT + textWidth(k, 9.5, 'H') + 8, LEFT + textWidth(k, 9.5, 'H') + 190, { grey: 0.6, y: page.y + 10 })
      page.down(20)
    }
    blank('Signature:')
    blank('Name (print):')
    page.text('Date:      /      /', LEFT, { size: 9.5 })
    page.down(13)
  }

  const ref = pkg.certificate_no ?? 'DRAFT'
  return buildPdf([page], `${ref} ${siteName}`)
}

/** A JS Date in the same shape as the date() helper's output. */
function dateOf(d: Date): string {
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
}
