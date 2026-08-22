import { describe, expect, it } from 'vitest'
import { Page, buildPdf, formatAbn, textWidth, wrap } from './pdf'
import { invoicePdf, type CompanyDetails } from './documents'
import type { ContractRow, InvoiceLineRow, InvoiceRow } from './supabase'

/**
 * These assert the FILE, not the pixels.
 *
 * A PDF written by hand is one byte-offset table away from being a file no
 * reader will open, and the failure mode is silent: a viewer either shows a
 * blank page or refuses it, and neither says which offset was wrong. So the
 * cross reference table is parsed back out and every offset checked against
 * what it claims to point at — which is exactly the check a reader performs.
 */

async function bytes(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return s
}

/** Parse the trailer and xref, and check each offset lands on its object. */
function checkStructure(pdf: string) {
  expect(pdf.startsWith('%PDF-1.')).toBe(true)
  expect(pdf.endsWith('%%EOF')).toBe(true)

  const startxref = pdf.lastIndexOf('startxref')
  expect(startxref).toBeGreaterThan(0)
  const xrefAt = Number(pdf.slice(startxref + 9, pdf.indexOf('%%EOF')).trim())
  expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref')

  const header = pdf.slice(xrefAt).match(/^xref\s+0 (\d+)\s/)
  expect(header).not.toBeNull()
  const count = Number(header![1])

  // Entries are fixed 20-byte records after the "xref\n0 N\n" header.
  const entriesAt = xrefAt + header![0].length
  for (let i = 1; i < count; i++) {
    const entry = pdf.slice(entriesAt + i * 20, entriesAt + i * 20 + 20)
    const offset = Number(entry.slice(0, 10))
    // The object each offset claims to point at must actually start there.
    expect(pdf.slice(offset, offset + String(i).length + 6)).toBe(`${i} 0 obj`)
  }
  return count
}

const COMPANY: CompanyDetails = {
  name: 'Proven Tiling Solutions',
  abn: '72101512485',
  acn: null,
  licence_no: 'BLD 187384',
  address: 'Findon SA 5023',
  phone: '0400 000 000',
  email: 'accounts@example.com',
  bank_bsb: '065-000',
  bank_account: '1234 5678',
  bank_account_name: 'Proven Tiling Solutions',
  gst_registered: true,
}

const INVOICE: InvoiceRow = {
  id: 'abcdef01-0000-0000-0000-000000000001',
  company_id: 'c',
  site_id: 's',
  invoice_no: 'INV-1042',
  client_name: 'Metro Homes',
  period: 'Progress claim 3 - August',
  issued_on: '2026-08-01',
  due_on: '2026-08-31',
  amount: 46200,
  tax_amount: 4200,
  ex_tax: 42000,
  tax_rate: 10,
  paid_amount: 0,
  status: 'sent',
  note: null,
  retention_pct: 5,
  retention_amount: 2210.53,
  builder_id: null,
  supplier_abn: null,
  builder_abn: '51824753556',
  builder_job_ref: 'LOT 42',
  is_rcti: false,
  contract_id: null,
  variation_id: null,
}

const LINES: InvoiceLineRow[] = [
  { id: '1', invoice_id: 'i', cost_code: '09-300', description: 'Wall and floor tiling, wet areas', pct_complete: 60, amount: 30000, sort: 0 },
  { id: '2', invoice_id: 'i', cost_code: null, description: 'Waterproofing to ensuite, main bath and laundry', pct_complete: 100, amount: 14210.53, sort: 1 },
]

describe('buildPdf', () => {
  it('writes a file whose xref offsets all point at their objects', async () => {
    const page = new Page()
    page.text('Hello', 48, { size: 12 })
    const pdf = await bytes(buildPdf([page], 'Test'))
    const count = checkStructure(pdf)
    // catalog, pages, 2 fonts, 1 content, 1 page, info = 7 objects + free entry
    expect(count).toBe(8)
  })

  it('keeps the offsets right across several pages', async () => {
    const pages = [new Page(), new Page(), new Page()]
    pages.forEach((p, i) => p.text(`Page ${i + 1}`, 48))
    checkStructure(await bytes(buildPdf(pages, 'Multi')))
  })

  it('escapes a name containing parentheses instead of breaking the file', async () => {
    // An unescaped ")" ends the string early and every byte after it is read as
    // an operator — the file opens to a blank page with no error anywhere.
    const page = new Page()
    page.text('Lot 42 (stage 2) \\ rear', 48)
    const pdf = await bytes(buildPdf([page], 'Escapes'))
    checkStructure(pdf)
    expect(pdf).toContain('Lot 42 \\(stage 2\\) \\\\ rear')
  })
})

describe('invoicePdf', () => {
  it('produces a structurally valid tax invoice', async () => {
    const pdf = await bytes(invoicePdf({
      company: COMPANY,
      invoice: INVOICE,
      lines: LINES,
      contract: null,
      siteName: 'Lot 42, Seaton',
      builderName: 'Metro Homes',
      builderAbn: '51824753556',
      variation: null,
    }))
    checkStructure(pdf)
  })

  it('says "Tax invoice" only when GST is actually charged', async () => {
    const withGst = await bytes(invoicePdf({
      company: COMPANY, invoice: INVOICE, lines: LINES, contract: null,
      siteName: null, builderName: null, builderAbn: null, variation: null,
    }))
    expect(withGst).toContain('TAX INVOICE')

    // A document with no GST on it must not carry the wording — that is a
    // representation to the ATO, not a house style.
    const noGst = await bytes(invoicePdf({
      company: COMPANY,
      invoice: { ...INVOICE, tax_amount: 0, ex_tax: 46200 },
      lines: LINES, contract: null,
      siteName: null, builderName: null, builderAbn: null, variation: null,
    }))
    expect(noGst).not.toContain('TAX INVOICE')
    expect(noGst).toContain('INVOICE')
  })

  it('warns on the document itself when the ABN is missing', async () => {
    // A tax invoice with no ABN can have its GST credit refused, and the
    // builder will not tell you — they will just not pay it.
    const pdf = await bytes(invoicePdf({
      company: { ...COMPANY, abn: null },
      invoice: INVOICE, lines: LINES, contract: null,
      siteName: null, builderName: null, builderAbn: null, variation: null,
    }))
    expect(pdf).toContain('no ABN recorded')
  })

  it('shows retention coming off before GST', async () => {
    const pdf = await bytes(invoicePdf({
      company: COMPANY, invoice: INVOICE, lines: LINES, contract: null,
      siteName: null, builderName: null, builderAbn: null, variation: null,
    }))
    expect(pdf).toContain('Less retention 5%')
    expect(pdf).toContain('GST 10%')
  })

  it('survives a contract number, a variation and a long note on one document', async () => {
    const contract = { contract_no: 'C-2291', order_no: 'PO 88401' } as ContractRow
    const pdf = await bytes(invoicePdf({
      company: COMPANY,
      invoice: { ...INVOICE, note: 'Claimed to end of month. '.repeat(20), is_rcti: true },
      lines: LINES,
      contract,
      siteName: 'Lot 42',
      builderName: 'Metro Homes',
      builderAbn: null,
      variation: null,
    }))
    checkStructure(pdf)
    expect(pdf).toContain('Recipient created tax invoice')
  })

  it('paginates rather than running off the bottom of the page', async () => {
    const many: InvoiceLineRow[] = Array.from({ length: 120 }, (_, i) => ({
      id: String(i), invoice_id: 'i', cost_code: '09-300',
      description: `Line ${i} - wall and floor tiling to a room with a fairly long description`,
      pct_complete: 50, amount: 100, sort: i,
    }))
    const pdf = await bytes(invoicePdf({
      company: COMPANY, invoice: INVOICE, lines: many, contract: null,
      siteName: null, builderName: null, builderAbn: null, variation: null,
    }))
    checkStructure(pdf)
    expect(pdf.match(/\/Type \/Page[^s]/g)?.length ?? 0).toBeGreaterThan(1)
  })
})

describe('text measuring', () => {
  it('measures bold wider than regular, which is what right-alignment needs', () => {
    expect(textWidth('Total due', 11, 'HB')).toBeGreaterThan(textWidth('Total due', 11, 'H'))
  })

  it('wraps to the width it is given', () => {
    const lines = wrap('the quick brown fox jumps over the lazy dog again and again', 100, 10)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(textWidth(l, 10, 'H')).toBeLessThanOrEqual(100)
  })

  it('breaks a word it cannot fit rather than letting it overflow', () => {
    // A word with no space to break on used to be returned whole and left to
    // run past its width. That is untidy in a paragraph and a defect in a
    // table, where the overflow lands on the next cell's text. It is now cut
    // at the last character that fits — and the word still has to survive,
    // which is what joining the pieces back up checks.
    const long = 'Supercalifragilisticexpialidocious'
    const lines = wrap(long, 20, 10)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(long)
    for (const l of lines) expect(textWidth(l, 10, 'H')).toBeLessThanOrEqual(20)
  })

  it('keeps a long word out of the column beside it', () => {
    // The case that found this: a register column 60pt wide, and a responsible
    // officer cell reading "(ladder/scaffold)".
    for (const l of wrap('Tools/materials (ladder/scaffold)', 60, 7.5)) {
      expect(textWidth(l, 7.5, 'H')).toBeLessThanOrEqual(60)
    }
  })
})

describe('formatAbn', () => {
  it('groups an ABN the way the ATO prints it', () => {
    expect(formatAbn('51824753556')).toBe('51 824 753 556')
  })

  it('leaves anything that is not 11 digits alone rather than mangling it', () => {
    expect(formatAbn('123')).toBe('123')
  })
})
