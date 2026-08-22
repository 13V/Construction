import type {
  ChangeOrderLineRow,
  ChangeOrderRow,
  ContractRow,
  InvoiceLineRow,
  InvoiceRow,
  WaterproofingRow,
} from './supabase'
import {
  LEFT,
  Page,
  RIGHT,
  WIDTH,
  buildPdf,
  details,
  footer,
  formatAbn,
  header,
  ratingFill,
  table,
  textWidth,
  wrap,
  type Cell,
} from './pdf'
import { isStructured, type SwmsContent, type SwmsTask } from './swms'

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

// -------------------------------------------------- safe work method statement

/**
 * A SWMS, issued for one job.
 *
 * "Each SWMS will require the project, the builder, the date. The rest stays
 * the same." Those three plus the job description are the per-job facts and
 * come in on `opts`, from whoever is issuing the copy — never from the
 * template, because the template is shared across every job this trade takes.
 *
 * The template itself comes in two shapes. Most of this company's history it
 * has been a text box a person edits by hand — a heading is a line starting
 * `## `, a bullet starts `- ` — and that path (legacySwmsPdf, below) still
 * renders exactly as it always has for a template with no structure to it.
 * But the client's own document is not prose, it is a five-column risk
 * register, and a register does not survive being typed into a text box and
 * printed back out as headings and bullets — the two ratings that are the
 * whole argument of the page would end up looking like just more text. So a
 * template can now also be `SwmsContent` (see ./swms), and when it is,
 * structuredSwmsPdf renders his actual document: the register as a table, the
 * PPE icons as chips, the substance notes run to whatever length they need.
 *
 * `content` is the explicit way in — pass the parsed template. `body` stays
 * the fallback: a hand-typed template is never valid JSON, so parsing it
 * throws and this falls straight through to the old path, which is the point.
 */
interface SwmsPdfOpts {
  company: CompanyDetails
  title: string
  body: string
  /** The template, already parsed, when the caller has it that way. */
  content?: unknown
  reference: string | null
  siteName: string
  siteAddress: string | null
  builderName: string | null
  /**
   * What the builder engaged this trade to do — a per-job fact, not part of
   * the template, and printed as a dash for a caller that does not collect it
   * yet rather than being left off the page.
   */
  jobDescription?: string | null
  documentDate: string | null
  version: string
  preparedBy: string
}

export function swmsPdf(opts: SwmsPdfOpts): Blob {
  let content: SwmsContent | null = null
  if (isStructured(opts.content)) {
    content = opts.content
  } else {
    try {
      const parsed = JSON.parse(opts.body)
      if (isStructured(parsed)) content = parsed
    } catch {
      // Not JSON — a hand-typed template, which is what legacySwmsPdf is for.
    }
  }
  return content ? structuredSwmsPdf(opts, content) : legacySwmsPdf(opts)
}

/**
 * The old path. A cover block with the three per-job facts, then the body
 * verbatim from the company's template, rendered from two marks a person
 * editing a text box has to learn: `## ` for a heading, `- ` for a bullet.
 * Kept byte-for-byte so a template nobody has converted to structured content
 * yet keeps printing exactly as it always has.
 */
function legacySwmsPdf(opts: SwmsPdfOpts): Blob {
  const { company, title, body, reference, siteName, siteAddress, builderName, documentDate, version, preparedBy } = opts
  const pages: Page[] = []
  let page = new Page()
  pages.push(page)

  /** A SWMS runs to several pages; every one of them says which job it is. */
  const continueOnNewPage = () => {
    page = new Page()
    pages.push(page)
    page.text(`${title} — ${siteName}`, LEFT, { size: 8, grey: 0.45 })
    page.textRight(reference ?? '', RIGHT, { size: 8, grey: 0.45 })
    page.down(12)
    page.rule(LEFT, RIGHT, { grey: 0.85 })
    page.down(16)
  }
  /**
   * The footer is drawn from the bottom of the last page after the body is
   * laid out, so the body has to stop short of it — without this reserve the
   * last paragraph and the footer print on top of each other.
   */
  const FOOTER_RESERVE = 44
  const room = (need: number) => {
    if (page.full(need + FOOTER_RESERVE)) continueOnNewPage()
  }

  header(page, { company, title: 'Safe work method statement', reference: reference ?? 'DRAFT' })

  details(page, [
    ['Project', siteName],
    ['Builder', builderName ?? '-'],
    ['Site address', siteAddress ?? '-'],
    ['Date', date(documentDate)],
    ['Prepared by', preparedBy],
    ['Version', version],
  ])
  page.down(16)
  page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
  page.down(18)

  page.text(title, LEFT, { size: 12, font: 'HB' })
  page.down(20)

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      page.down(8)
      continue
    }
    if (line.startsWith('## ')) {
      room(34)
      page.down(6)
      page.text(line.slice(3), LEFT, { size: 10.5, font: 'HB' })
      page.down(16)
      continue
    }
    // "- " keeps its bullet and hangs its wrap under the text, not the dot.
    const bullet = /^[-*]\s+/.test(line)
    const text = bullet ? line.replace(/^[-*]\s+/, '') : line
    const x = bullet ? LEFT + 12 : LEFT
    const wrapped = wrap(text, RIGHT - x, 9.5)
    wrapped.forEach((l, i) => {
      room(14)
      if (bullet && i === 0) page.text('•', LEFT, { size: 9.5, grey: 0.4 })
      page.text(l, x, { size: 9.5 })
      page.down(13)
    })
  }

  // ------------------------------------------------------------- the sign-on
  // A SWMS nobody signed is a document, not a control. The register is part of
  // the document so the copy the builder files shows who was briefed on it.
  // Header, blurb, column titles and nine rules — 252pt, measured, not guessed.
  room(260)
  page.down(14)
  page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
  page.down(16)
  page.text('Worker sign-on', LEFT, { size: 10.5, font: 'HB' })
  page.down(14)
  page.text(
    'Everyone carrying out this work has read this statement, understands the controls and agrees to work to them.',
    LEFT,
    { size: 9, grey: 0.3 },
  )
  page.down(20)

  const colName = LEFT
  const colSig = LEFT + 190
  const colDate = RIGHT - 90
  page.text('NAME', colName, { size: 7.5, font: 'HB', grey: 0.5 })
  page.text('SIGNATURE', colSig, { size: 7.5, font: 'HB', grey: 0.5 })
  page.text('DATE', colDate, { size: 7.5, font: 'HB', grey: 0.5 })
  page.down(12)
  for (let i = 0; i < 8; i++) {
    page.rule(LEFT, RIGHT, { grey: 0.8 })
    page.down(22)
  }
  page.rule(LEFT, RIGHT, { grey: 0.8 })

  footer(pages[pages.length - 1]!, [
    `${title} · version ${version}${documentDate ? ` · ${date(documentDate)}` : ''}`,
    'This statement must be kept on site and reviewed if the work, the plant or the site conditions change.',
  ])

  return buildPdf(pages, `${reference ?? 'SWMS'} ${siteName}`)
}

/**
 * WinAnsi has no code point for ≥ (or ≤), and winAnsi() in pdf.ts has nothing
 * to map either onto, so it drops them rather than mangling them — turning
 * "Working at Heights (≥2m)" into "(2m)" and losing the "at least" the clause
 * exists to say. Guarded here, on every content string before it reaches a
 * page or a table cell, because pdf.ts is not this file to fix it in.
 */
function guardUnicode(s: string): string {
  return s.replace(/≥/g, '>=').replace(/≤/g, '<=')
}

/**
 * His document. Company block, project block, approval, the risk legend and
 * the page-1 undertakings; PPE as chips; the substance notes run long; the
 * five-column register, which is the substance of the page; training and
 * duties; his jurisdiction's statutes; the likelihood/consequence criteria
 * behind the ratings; and the sign-on register a crew actually signs.
 */
function structuredSwmsPdf(opts: SwmsPdfOpts, content: SwmsContent): Blob {
  const { company, siteName, siteAddress, builderName, jobDescription, reference, documentDate, version, preparedBy } = opts
  const documentNo = content.documentNo ?? reference ?? 'DRAFT'
  const activity = content.activity || opts.title
  const t = guardUnicode

  const pages: Page[] = []
  let page = new Page()
  pages.push(page)

  /** Every page after the first carries his running header: company, document number, activity. */
  const continueOnNewPage = (): Page => {
    page = new Page()
    pages.push(page)
    page.text(company.name, LEFT, { size: 8, font: 'HB', grey: 0.4 })
    page.textRight(`DOC ${documentNo}`, RIGHT, { size: 8, grey: 0.45 })
    page.down(11)
    page.text(t(activity), LEFT, { size: 8, grey: 0.45 })
    page.down(12)
    page.rule(LEFT, RIGHT, { grey: 0.85 })
    page.down(16)
    return page
  }
  /**
   * The footer is drawn from the bottom of the last page after everything
   * else is laid out, so every reservation of room has to stop short of it.
   */
  const FOOTER_RESERVE = 44
  const room = (need: number) => {
    if (page.full(need + FOOTER_RESERVE)) continueOnNewPage()
  }

  const sectionHeading = (label: string) => {
    room(32)
    page.down(8)
    page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
    page.down(11)
    page.text(label, LEFT, { size: 11, font: 'HB' })
    page.down(16)
  }
  const subHeading = (label: string) => {
    room(17)
    page.text(label, LEFT, { size: 9.5, font: 'HB' })
    page.down(13)
  }
  const paragraph = (text: string, size = 9.5, grey = 0) => {
    for (const l of wrap(t(text), WIDTH, size)) {
      room(size + 4)
      page.text(l, LEFT, { size, grey })
      page.down(size + 3.5)
    }
  }
  const bullets = (items: string[], size = 9.5) => {
    for (const raw of items) {
      const wrapped = wrap(t(raw), RIGHT - (LEFT + 12), size)
      wrapped.forEach((l, i) => {
        room(size + 4)
        if (i === 0) page.text('•', LEFT, { size, grey: 0.4 })
        page.text(l, LEFT + 12, { size })
        page.down(size + 3.5)
      })
    }
  }
  /** A label with a rule above and below — the caption a legend, not a bullet. */
  const numberedLine = (lead: string, body_: string, size = 9) => {
    room(size + 6)
    const prefix = `${lead}  `
    page.text(prefix, LEFT, { size, font: 'HB' })
    const cx = LEFT + textWidth(prefix, size, 'HB')
    const wrapped = wrap(t(body_), RIGHT - cx, size)
    wrapped.forEach((l, i) => {
      if (i > 0) room(size + 4)
      page.text(l, i === 0 ? cx : LEFT + 18, { size })
      page.down(size + 4)
    })
  }
  /**
   * PPE captions as chips. Page.rule() only ever draws one y — a horizontal
   * line, never a vertical one — so there is no primitive for a boxed
   * rectangle's sides. A chip here is a rule above and a rule below padded
   * text instead: still a labelled tag, not a bare bullet list, which is what
   * the icon captions are meant to read as.
   */
  const chipRow = (items: string[]) => {
    const SIZE = 8.5
    const H = 20
    const PAD = 9
    const GAP = 10
    room(H + 10)
    let x = LEFT
    let y0 = page.y
    for (const raw of items) {
      const label = t(raw).toUpperCase()
      const w = textWidth(label, SIZE, 'H') + PAD * 2
      if (x + w > RIGHT) {
        page.down(H + 10)
        room(H + 10)
        x = LEFT
        y0 = page.y
      }
      page.rule(x, x + w, { y: y0, grey: 0.55 })
      page.rule(x, x + w, { y: y0 + H, grey: 0.55 })
      page.text(label, x + PAD, { size: SIZE, grey: 0.25, y: y0 + H / 2 + 3 })
      x += w + GAP
    }
    page.down(H + 14)
  }

  // ---------------------------------------------------------------- part 1
  header(page, { company, title: 'Safe work method statement', reference: documentNo })

  details(page, [
    ['Project', siteName],
    ['Principal', builderName ?? '-'],
    ['Site address', siteAddress ?? '-'],
    ['Date', date(documentDate)],
    ['Prepared by', preparedBy],
    ['Version', version],
  ])
  page.down(10)

  const jdLabel = 'Job description: '
  page.text(jdLabel, LEFT, { size: 9.5, font: 'HB' })
  const jdX = LEFT + textWidth(jdLabel, 9.5, 'HB')
  const jdLines = wrap(t(jobDescription || '-'), RIGHT - jdX, 9.5)
  jdLines.forEach((l, i) => page.text(l, i === 0 ? jdX : LEFT, { size: 9.5, y: page.y + i * 13 }))
  page.down(jdLines.length * 13 + 8)

  page.text(t(activity), LEFT, { size: 12, font: 'HB' })
  page.down(20)

  if (content.approvedByName) {
    paragraph(
      `Approved by ${content.approvedByName}` +
        `${content.approvedByRole ? `, ${content.approvedByRole}` : ''}` +
        `${content.approvedOn ? ` - ${content.approvedOn}` : ''}`,
      9.5,
      0.25,
    )
    page.down(6)
  }

  sectionHeading('Risk rating')
  for (const item of content.riskLegend) numberedLine(item.code, item.label)

  sectionHeading('Monitoring and review')
  bullets(content.monitoring)

  // ------------------------------------------------------------------- ppe
  sectionHeading('Personal protective equipment')
  paragraph(content.ppe.general)
  if (content.ppe.whereRequired) {
    page.down(4)
    subHeading('Additional PPE where required')
    paragraph(content.ppe.whereRequired)
  }
  if (content.ppe.icons.length) {
    page.down(6)
    chipRow(content.ppe.icons)
  }

  // ----------------------------------------------------------------- notes
  sectionHeading('Hazardous substances')
  for (const note of content.safetyNotes) {
    subHeading(note.substance)
    paragraph(note.text)
    page.down(6)
  }

  // -------------------------------------------------------------- register
  // The five-column register: task, hazards, the rating before controls, the
  // controls themselves, the rating after, and who is accountable. The pair
  // of ratings either side of the controls is the whole argument of the page,
  // which is why it is a table and not more paragraphs — a reader has to be
  // able to find "3H before, 1L after" for a task without hunting for it.
  sectionHeading('Risk assessment and controls')
  // RB and RA are the widest headings a 26pt column will take, and an
  // inspector reading this is owed the expansion rather than a guess.
  // "4" and "A: Acute - ACT NOW - ..." become "4 Acute": the band's own word,
  // taken from between the colon and whatever dash follows it, so the legend
  // stays the client's wording rather than a second list to keep in step.
  const band = (label: string) => (label.split(':')[1] ?? label).split(/[\u2013\u2014-]/)[0]!.trim()
  paragraph(
    'RB is the risk rating before the controls are applied, RA the rating after. ' +
      content.riskLegend.map((r) => `${r.code} ${band(r.label)}`).join(', ') +
      '.',
    8.5,
    0.4,
  )
  page.down(4)
  page = table(
    page,
    [
      { header: 'Task', width: 95 },
      { header: 'Hazards', width: 88 },
      { header: 'RB', width: 26 },
      { header: 'Controls', width: 165 },
      { header: 'RA', width: 26 },
      { header: 'Responsible', width: 65 },
    ],
    content.tasks.map(
      (task): Cell[] => [
        { content: t(task.task) },
        { content: task.hazards.map(t) },
        { content: task.riskBefore, align: 'center', fill: ratingFill(task.riskBefore) },
        { content: controlsContent(task) },
        { content: task.riskAfter, align: 'center', fill: ratingFill(task.riskAfter) },
        { content: responsibleContent(task) },
      ],
    ),
    { newPage: continueOnNewPage },
  )

  // ---------------------------------------------------------------- part 2
  if (content.part2) {
    const p2 = content.part2
    sectionHeading('Training, duties and supervision')
    if (p2.trainingRequired) {
      subHeading('Training required')
      paragraph(p2.trainingRequired)
      page.down(4)
    }
    if (p2.duties?.length) {
      subHeading('Duties')
      bullets(p2.duties)
      page.down(4)
    }
    if (p2.trainingModules?.length) {
      subHeading('Training modules')
      bullets(p2.trainingModules)
      page.down(4)
    }
    if (p2.supervision?.length) {
      subHeading('Supervision')
      bullets(p2.supervision)
      page.down(4)
    }
    if (p2.permits) {
      subHeading('Permits and PPE standards')
      paragraph(p2.permits)
      page.down(4)
    }
    if (p2.legislation?.length) {
      subHeading('Legislation')
      bullets(p2.legislation)
      page.down(4)
    }
    if (p2.plant?.length) {
      subHeading('Plant and equipment')
      bullets(p2.plant)
      page.down(4)
    }
    if (p2.maintenance) {
      subHeading('Maintenance')
      paragraph(p2.maintenance)
    }
  }

  // His jurisdiction's own statutes — a distinct short block from Part 2's
  // model WHS Act, because for a tiler in Adelaide the South Australian Act is
  // the one that binds.
  if (content.jurisdiction?.length) {
    sectionHeading('Applicable legislation (jurisdiction)')
    bullets(content.jurisdiction)
  }

  // ------------------------------------------------------------ risk method
  if (content.riskAssessment) {
    sectionHeading('Part 4 - risk assessment')
    subHeading('Likelihood')
    for (const l of content.riskAssessment.likelihood) numberedLine(l.criteria, l.description)
    page.down(6)
    subHeading('Consequence')
    for (const c of content.riskAssessment.consequence) numberedLine(c.level, c.example)
    if (content.riskAssessment.matrixNote) {
      page.down(6)
      paragraph(content.riskAssessment.matrixNote, 8.5, 0.35)
    }
  }

  // -------------------------------------------------------------- sign-on
  // A SWMS nobody signed is a document, not a control. The header repeats if
  // the crew is long enough to push the register onto a second page, because
  // a signature column with no heading over it is not a register any more.
  sectionHeading('Worker sign-on')
  if (content.signOff.preparedByName) {
    paragraph(
      `Prepared by ${content.signOff.preparedByName}` +
        `${content.signOff.preparedByPosition ? `, ${content.signOff.preparedByPosition}` : ''}`,
      9,
      0.3,
    )
    page.down(6)
  }
  if (content.signOff.preamble) {
    paragraph(content.signOff.preamble, 9.5, 0.15)
    page.down(8)
  }
  content.signOff.acknowledgement.forEach((point, i) => numberedLine(`${i + 1}.`, point))
  page.down(12)

  const cols = content.signOff.registerColumns?.length
    ? content.signOff.registerColumns
    : ['#', 'SURNAME', 'GIVEN NAME', 'ROLE', 'SIGNATURE', 'DATE']
  const widths = signOnColumnWidths(cols.length)
  const drawRegisterHeader = () => {
    room(30)
    page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
    page.down(14)
    let x = LEFT
    cols.forEach((c, i) => {
      page.text(c, x, { size: 7.5, font: 'HB', grey: 0.5 })
      x += widths[i] ?? 0
    })
    page.down(12)
  }
  drawRegisterHeader()
  const SIGN_ROWS = 15
  for (let i = 0; i < SIGN_ROWS; i++) {
    if (page.full(22 + FOOTER_RESERVE)) {
      continueOnNewPage()
      drawRegisterHeader()
    }
    page.rule(LEFT, RIGHT, { grey: 0.8 })
    page.down(22)
  }
  page.rule(LEFT, RIGHT, { grey: 0.8 })

  footer(pages[pages.length - 1]!, [
    `${t(activity)} - ${documentNo} - version ${version}${documentDate ? ` - ${date(documentDate)}` : ''}`,
    'This statement must be kept on site and reviewed if the work, the plant or the site conditions change.',
  ])

  return buildPdf(pages, `${documentNo} ${siteName}`)
}

/**
 * The controls cell: the client's own `{ heading?, items }` groups, guarded
 * against WinAnsi's blind spots and passed straight through — a table cell's
 * content accepts exactly this shape, because it is the same shape as
 * SwmsControlGroup by design (see pdf.ts's own note on why).
 */
function controlsContent(task: SwmsTask): Array<{ heading?: string; items: string[] }> {
  return task.controls.map((g) => ({
    heading: g.heading ? guardUnicode(g.heading) : undefined,
    items: g.items.map(guardUnicode),
  }))
}

/**
 * Most tasks give one responsible party for the whole row ("All Workers"), a
 * flat bullet list. "Working at Heights" instead gives one per control group —
 * Supervisor for the access set-up, Workers for the ladder — and the two
 * arrays line up by index. When they do, that pairing is worth keeping: each
 * name prints under its group's own heading rather than collapsing into a
 * list that reads as if everyone answers for everything.
 */
function responsibleContent(task: SwmsTask): Array<{ heading?: string; items: string[] }> | string[] {
  if (task.controls.length > 1 && task.responsible.length === task.controls.length) {
    return task.controls.map((g, i) => ({
      heading: g.heading ? guardUnicode(g.heading) : undefined,
      items: [guardUnicode(task.responsible[i]!)],
    }))
  }
  return task.responsible.map(guardUnicode)
}

/** Column widths for the sign-on register. His own six sum to the page width. */
function signOnColumnWidths(n: number): number[] {
  if (n === 6) return [30, 108, 108, 88, 100, 65]
  const w = Math.floor(WIDTH / n)
  return Array.from({ length: n }, () => w)
}

/** PTS-SWMS-260818-001 — the same shape as a certificate number. */
export function swmsReference(companyName: string, on: Date, sequence: number): string {
  return certificateNo(companyName, on, sequence).replace('-WP-', '-SWMS-')
}
