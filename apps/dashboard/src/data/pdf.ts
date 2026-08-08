/**
 * PDF generation, with no dependency.
 *
 * A tax invoice has to leave this app as a file the builder's accounts team can
 * file, and the same is true of a variation and a waterproofing certificate.
 * The usual answers are jsPDF (350 kB) or a rendering service (a round trip and
 * a bill), and neither is warranted: these documents are a page of left-aligned
 * text, some right-aligned numbers and a few rules.
 *
 * So this writes the PDF directly. A PDF is a handful of objects, a cross
 * reference table giving each one's byte offset, and a trailer — which is why
 * the whole file is assembled as a byte string and measured as it goes.
 *
 * WinAnsi and the 14 standard fonts only. No embedded font means no font file,
 * which is the entire reason this is 400 lines instead of a library.
 */

// -------------------------------------------------------------- the writer

/** Points. A4 is 595.28 x 841.89pt; rounded, because nothing here is typeset. */
const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 48

type Font = 'H' | 'HB' // Helvetica, Helvetica-Bold

interface Cmd {
  text: string
  x: number
  y: number
  size: number
  font: Font
  /** Grey level 0-1. 0 is black. */
  grey?: number
}

interface Rule {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  grey: number
}

/**
 * Escape for a PDF literal string. Backslash first — escaping it after the
 * parens would double-escape the backslashes those introduced.
 */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ')
}

/**
 * WinAnsi has no code point above 255, and a stray em dash or a non-breaking
 * space out of a copy-pasted address renders as garbage or breaks the string.
 * The characters that actually turn up in this app's data are mapped to their
 * nearest ASCII; anything else is dropped rather than mangled.
 */
function winAnsi(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\u00B2/g, '2')
    .replace(/[^\x20-\x7E]/g, '')
}

/**
 * Helvetica advance widths, in 1/1000 em, for the printable ASCII range. Taken
 * from the Adobe AFM. Needed because right-aligning a number means knowing how
 * wide it is, and a PDF viewer will not tell you.
 */
const W_REG: Record<string, number> = {}
const W_BOLD: Record<string, number> = {}
{
  const reg =
    '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'
  const bold =
    '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'
  const r = reg.split(' ').map(Number)
  const b = bold.split(' ').map(Number)
  for (let i = 0; i < r.length; i++) {
    const ch = String.fromCharCode(32 + i)
    W_REG[ch] = r[i]
    W_BOLD[ch] = b[i]
  }
}

export function textWidth(s: string, size: number, font: Font): number {
  const table = font === 'HB' ? W_BOLD : W_REG
  let w = 0
  for (const ch of winAnsi(s)) w += table[ch] ?? 556
  return (w * size) / 1000
}

/** Break a paragraph to a width, on spaces. Long unbreakable words overflow. */
export function wrap(s: string, width: number, size: number, font: Font = 'H'): string[] {
  const words = winAnsi(s).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (textWidth(next, size, font) > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

export class Page {
  private cmds: Cmd[] = []
  private rules: Rule[] = []
  /** Distance from the top of the page. Flipped to PDF's origin on render. */
  y = MARGIN

  text(s: string, x: number, opts: { size?: number; font?: Font; grey?: number; y?: number } = {}) {
    const size = opts.size ?? 10
    this.cmds.push({ text: winAnsi(s), x, y: opts.y ?? this.y, size, font: opts.font ?? 'H', grey: opts.grey })
    return this
  }

  /** Right-aligned at `right`, which is what every money column needs. */
  textRight(s: string, right: number, opts: { size?: number; font?: Font; grey?: number; y?: number } = {}) {
    const size = opts.size ?? 10
    const font = opts.font ?? 'H'
    return this.text(s, right - textWidth(s, size, font), { ...opts, size, font })
  }

  rule(x1: number, x2: number, opts: { width?: number; grey?: number; y?: number } = {}) {
    const y = opts.y ?? this.y
    this.rules.push({ x1, y1: y, x2, y2: y, width: opts.width ?? 0.5, grey: opts.grey ?? 0.85 })
    return this
  }

  down(by: number) {
    this.y += by
    return this
  }

  /** True when there is no room left for another line at this size. */
  full(need = 14): boolean {
    return this.y + need > PAGE_H - MARGIN
  }

  content(): string {
    const parts: string[] = []
    for (const r of this.rules) {
      parts.push(
        `q ${r.grey} G ${r.width} w ${r.x1} ${PAGE_H - r.y1} m ${r.x2} ${PAGE_H - r.y2} l S Q`,
      )
    }
    for (const c of this.cmds) {
      const grey = c.grey ?? 0
      parts.push(`BT /${c.font} ${c.size} Tf ${grey} g ${c.x} ${PAGE_H - c.y - c.size} Td (${esc(c.text)}) Tj ET`)
    }
    return parts.join('\n')
  }
}

/** Assemble pages into a PDF file. */
export function buildPdf(pages: Page[], title: string): Blob {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length // 1-based object number
  }

  // 1 catalog, 2 pages, 3/4 fonts, then a content stream + page per page.
  const catalogNo = add('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesNo = add('') // patched below, once the kids are known
  const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  const kids: number[] = []
  for (const p of pages) {
    const stream = p.content()
    const contentNo = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const pageNo = add(
      `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /H ${fontReg} 0 R /HB ${fontBold} 0 R >> >> /Contents ${contentNo} 0 R >>`,
    )
    kids.push(pageNo)
  }
  objects[pagesNo - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`

  const infoNo = add(`<< /Title (${esc(winAnsi(title))}) /Producer (Crewline) >>`)

  // The cross reference table is byte offsets into the file, so the file has to
  // be measured as it is assembled — and measured in BYTES, not characters.
  // Everything written here is ASCII after winAnsi(), so the two agree.
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefAt = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`

  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return new Blob([bytes], { type: 'application/pdf' })
}

export function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ------------------------------------------------------------- the layout

export const LEFT = MARGIN
export const RIGHT = PAGE_W - MARGIN
export const WIDTH = RIGHT - LEFT

/** Supplier block, document title and reference. Shared by every document. */
export function header(
  page: Page,
  opts: {
    company: { name: string; abn?: string | null; licence_no?: string | null; address?: string | null; phone?: string | null; email?: string | null }
    title: string
    reference: string
  },
) {
  page.text(opts.company.name, LEFT, { size: 16, font: 'HB' })
  page.textRight(opts.title.toUpperCase(), RIGHT, { size: 16, font: 'HB', grey: 0.35 })
  page.down(20)

  const lines = [
    opts.company.address,
    opts.company.phone,
    opts.company.email,
    opts.company.abn ? `ABN ${formatAbn(opts.company.abn)}` : null,
    opts.company.licence_no ? `Builders licence ${opts.company.licence_no}` : null,
  ].filter((v): v is string => Boolean(v))

  const startY = page.y
  for (const l of lines) {
    page.text(l, LEFT, { size: 9, grey: 0.4 })
    page.down(12)
  }
  page.textRight(opts.reference, RIGHT, { size: 11, font: 'HB', y: startY })

  page.y = Math.max(page.y, startY + 12 * lines.length)
  page.down(6)
  page.rule(LEFT, RIGHT, { grey: 0.75, width: 1 })
  page.down(18)
}

/** 51 824 753 556 — the ATO's own grouping, and how it reads on every document. */
export function formatAbn(abn: string): string {
  const d = abn.replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn
}

/** A two-column block of label/value pairs, as every document's detail panel. */
export function details(page: Page, pairs: Array<[string, string]>, x = LEFT, colWidth = WIDTH / 2) {
  const startY = page.y
  pairs.forEach(([k, v], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const cx = x + col * colWidth
    const cy = startY + row * 26
    page.text(k.toUpperCase(), cx, { size: 7.5, font: 'HB', grey: 0.5, y: cy })
    page.text(v || '-', cx, { size: 10, y: cy + 11 })
  })
  page.y = startY + Math.ceil(pairs.length / 2) * 26
}

export function footer(page: Page, lines: string[]) {
  let y = PAGE_H - MARGIN - lines.length * 11
  page.rule(LEFT, RIGHT, { grey: 0.85, y: y - 10 })
  for (const l of lines) {
    page.text(l, LEFT, { size: 8, grey: 0.45, y })
    y += 11
  }
}
