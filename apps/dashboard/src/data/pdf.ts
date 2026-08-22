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
 * which is the entire reason this is hand-rolled instead of a library.
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

/** A filled band — a table header row, or a risk rating's tint. */
interface Rect {
  x: number
  /** Distance from the top of the page, same sense as everything else here. */
  y: number
  w: number
  h: number
  r: number
  g: number
  b: number
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
    // "Bathroom refit x 6" is how a job describes itself in this app, and the
    // multiplication sign it is typed with has no WinAnsi code point.
    .replace(/\u00D7/g, 'x')
    // A bullet typed into a note or a method statement would otherwise be
    // dropped, leaving the indent with nothing in front of it.
    .replace(/[\u2022\u00B7\u25CF\u25AA]/g, '-')
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

/**
 * Break a paragraph to a width, on spaces — and, where there is no space to
 * break on, mid-word.
 *
 * A word with no break point of its own that is wider than the space given to
 * it ("(ladder/scaffold)" in a 60pt register column) used to be left to
 * overflow. In a paragraph that is untidy; in a table it is a defect, because
 * the overflow lands on top of the next cell's text and the reader cannot tell
 * which column the words belong to. Cutting at the last character that fits is
 * not typesetting, but it keeps every word inside its own cell.
 */
export function wrap(s: string, width: number, size: number, font: Font = 'H'): string[] {
  const words = winAnsi(s).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (textWidth(word, size, font) > width) {
      if (line) lines.push(line)
      let chunk = ''
      for (const ch of word) {
        if (chunk && textWidth(chunk + ch, size, font) > width) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      line = chunk
      continue
    }
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
  private rects: Rect[] = []
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

  /** A vertical rule — `rule()` only ever draws horizontal, and a table's
   *  column separators need the other axis. `y1`/`y2` are top and bottom. */
  vrule(x: number, y1: number, y2: number, opts: { width?: number; grey?: number } = {}) {
    this.rules.push({ x1: x, y1, x2: x, y2, width: opts.width ?? 0.5, grey: opts.grey ?? 0.85 })
    return this
  }

  /** A filled band, painted under whatever rules and text land on top of it —
   *  a table's shaded header row, or a risk rating's colour. `fill` is RGB 0-1. */
  rect(x: number, y: number, w: number, h: number, fill: [number, number, number]) {
    this.rects.push({ x, y, w, h, r: fill[0], g: fill[1], b: fill[2] })
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
    // Fills first, then rules, then text — each layer painted over the last,
    // so a shaded header cell doesn't blot out its own grid line or title.
    for (const rc of this.rects) {
      parts.push(`q ${rc.r} ${rc.g} ${rc.b} rg ${rc.x} ${PAGE_H - rc.y - rc.h} ${rc.w} ${rc.h} re f Q`)
    }
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

// --------------------------------------------------------------- the table

/**
 * A register cell holds one of three shapes: a plain paragraph (a task
 * name), a flat bullet list (hazards, the officers responsible — nothing
 * heads them), or headed bullet groups repeated down the cell ("Manual
 * handling:" then its own items, then "Mixing and applying:" and its own).
 * That third shape is deliberately the same shape as SwmsControlGroup in
 * swms.ts — this file doesn't import that type, a hand-rolled PDF writer has
 * no business knowing what a SWMS is, but a control cell is built from an
 * array of `{ heading?, items }` either way, so the caller just passes its
 * `controls` array straight through as a cell's content.
 */
export type CellContent = string | string[] | Array<{ heading?: string; items: string[] }>

export interface Cell {
  content: CellContent
  font?: Font
  size?: number
  grey?: number
  align?: 'left' | 'center' | 'right'
  /** RGB 0-1, painted behind this cell only — a risk rating's tint. */
  fill?: [number, number, number]
}

export interface TableColumn {
  width: number
  header: string
}

const CELL_PAD_X = 5
const CELL_PAD_Y = 5
/** How far a bullet's text sits from the cell's edge, past the marker itself. */
const BULLET_INDENT = 9
const DEFAULT_SIZE = 8.5
const DEFAULT_FONT: Font = 'H'
const HEADER_SIZE = 7.5

/**
 * Line spacing for a given size. Every other block in this file picks its
 * leading by feel — 10pt body text gets `down(14)`, 8.5pt gets `down(11)` —
 * because a person chose it once for one paragraph. A table draws lines at
 * whatever size a cell was given, so it needs that feel as a formula instead.
 */
function leading(size: number): number {
  return size + 3.5
}

interface CellLine {
  text: string
  indent: number
  marker: boolean
  font: Font
  size: number
  grey?: number
  align: 'left' | 'center' | 'right'
}

/** Wrap a cell's content to `width` — the lines it will actually draw. */
function layoutCell(cell: Cell, width: number): CellLine[] {
  const size = cell.size ?? DEFAULT_SIZE
  const font = cell.font ?? DEFAULT_FONT
  const align = cell.align ?? 'left'
  const inner = Math.max(width - CELL_PAD_X * 2, 20)
  const lines: CellLine[] = []
  const add = (text: string, indent: number, bulleted: boolean, f: Font) => {
    for (const [i, l] of wrap(text, Math.max(inner - indent, 20), size, f).entries()) {
      lines.push({ text: l, indent, marker: bulleted && i === 0, font: f, size, grey: cell.grey, align })
    }
  }

  const c = cell.content
  if (typeof c === 'string') {
    if (c) add(c, 0, false, font)
  } else if (c.length && typeof c[0] === 'string') {
    for (const item of c as string[]) add(item, BULLET_INDENT, true, font)
  } else {
    for (const group of c as Array<{ heading?: string; items: string[] }>) {
      if (group.heading) add(group.heading, 0, false, 'HB')
      for (const item of group.items) add(item, BULLET_INDENT, true, font)
    }
  }
  return lines
}

/**
 * A cell's height at a given width — the measurement a page-break decision
 * needs before it can be made, since a PDF viewer will not tell you either.
 */
export function cellHeight(cell: Cell, width: number): number {
  const n = Math.max(layoutCell(cell, width).length, 1)
  return n * leading(cell.size ?? DEFAULT_SIZE) + CELL_PAD_Y * 2
}

/**
 * A row's height: the tallest of its cells. This is the whole argument for a
 * table over columns of loose text — a control-measures cell running to a
 * dozen bullets and the rating cell beside it holding "3H" still sit on one
 * row, and neither bleeds into the next.
 */
export function rowHeight(row: Cell[], columns: TableColumn[]): number {
  return Math.max(...row.map((cell, i) => cellHeight(cell, columns[i]!.width)))
}

/** The shaded header row's height, from the column titles at their own size. */
export function headerHeight(columns: TableColumn[], size = HEADER_SIZE): number {
  return Math.max(...columns.map((col) => cellHeight({ content: col.header, font: 'HB', size }, col.width)))
}

const HEADER_FILL: [number, number, number] = [0.9, 0.9, 0.9]

/**
 * A risk rating's tint, keyed on its leading digit: 4 Acute and 3 High read
 * warm, 2 Moderate amber, 1 Low cool — the same association a hazard board
 * already uses, so the BEFORE/AFTER pair of ratings argues its own case
 * before an inspector reads a word of the controls sitting between them.
 * Anything that isn't a 1-4 rating gets no tint back.
 */
const RATING_FILL: Record<string, [number, number, number]> = {
  '4': [0.96, 0.78, 0.76],
  '3': [0.98, 0.85, 0.74],
  '2': [0.99, 0.92, 0.72],
  '1': [0.83, 0.91, 0.85],
}

export function ratingFill(rating: string): [number, number, number] | undefined {
  return RATING_FILL[rating.trim().charAt(0)]
}

function drawCellLines(page: Page, lines: CellLine[], cellX: number, top: number, width: number) {
  let y = top + CELL_PAD_Y
  for (const l of lines) {
    const w = textWidth(l.text, l.size, l.font)
    const x =
      l.align === 'center'
        ? cellX + (width - w) / 2
        : l.align === 'right'
          ? cellX + width - CELL_PAD_X - w
          : cellX + CELL_PAD_X + l.indent
    // The marker is drawn separately from the text so a wrapped bullet's
    // second line can indent under the words, not under the dash.
    if (l.marker) page.text('-', cellX + CELL_PAD_X, { size: l.size, y, grey: l.grey ?? 0.45 })
    page.text(l.text, x, { size: l.size, font: l.font, grey: l.grey, y })
    y += leading(l.size)
  }
}

/** Column separators and the outer box, for one row's slice of one page. */
function drawColumnRules(page: Page, x: number, top: number, columns: TableColumn[], height: number) {
  let cx = x
  page.vrule(cx, top, top + height, { grey: 0.75 })
  for (const col of columns) {
    cx += col.width
    page.vrule(cx, top, top + height, { grey: 0.75 })
  }
}

/**
 * Draw a register: a shaded header row of column titles, then each data row —
 * a cell per column, wrapped independently, the row as tall as its tallest
 * cell. A row too tall for what's left on the page splits at a line boundary,
 * never mid-line: each column keeps its own count of lines already drawn, so
 * a short cell (a rating) can finish while a long one (its controls) keeps
 * going into the next slice. When a slice has to move to a new page,
 * `newPage()` gets called for a fresh one and the column headers are drawn
 * again before the row continues — so a reader turning to any page of a long
 * SWMS still knows which column is which. A row with nothing in any of its
 * cells still draws as one blank ruled row; a register with a gap in it reads
 * as a mistake, not as "nothing to add".
 *
 * `newPage` belongs to the caller, not to this function: a document knows its
 * own running header and page furniture, a table only knows where its own
 * header row and grid go. It must return a Page whose `y` is where the table
 * should resume — usually just past whatever running header the document
 * draws on every page.
 */
export function table(
  page: Page,
  columns: TableColumn[],
  rows: Cell[][],
  opts: { x?: number; newPage: () => Page },
): Page {
  const x = opts.x ?? LEFT
  const right = x + columns.reduce((sum, col) => sum + col.width, 0)
  let current = page

  const drawHeader = () => {
    const h = headerHeight(columns)
    const top = current.y
    let cx = x
    for (const col of columns) {
      current.rect(cx, top, col.width, h, HEADER_FILL)
      cx += col.width
    }
    cx = x
    for (const col of columns) {
      drawCellLines(
        current,
        layoutCell({ content: col.header, font: 'HB', size: HEADER_SIZE, grey: 0.35 }, col.width),
        cx,
        top,
        col.width,
      )
      cx += col.width
    }
    drawColumnRules(current, x, top, columns, h)
    current.rule(x, right, { y: top, grey: 0.5, width: 1 })
    current.down(h)
    current.rule(x, right, { grey: 0.5, width: 1 })
  }

  // Below this much room, a fresh page is cheaper than starting a sliver of a
  // row nobody can read wedged against the bottom margin.
  const MIN_SLICE = leading(DEFAULT_SIZE) + CELL_PAD_Y * 2

  drawHeader()

  for (const row of rows) {
    const cellLines = row.map((cell, i) => layoutCell(cell, columns[i]!.width))
    const cursors = row.map(() => 0)
    const done = () => row.every((_, i) => cursors[i]! >= cellLines[i]!.length)

    let first = true
    while (first || !done()) {
      first = false
      if (current.full(MIN_SLICE)) {
        current = opts.newPage()
        drawHeader()
      }

      const avail = PAGE_H - MARGIN - current.y - CELL_PAD_Y * 2
      const fit = row.map((cell, i) => {
        const maxFit = Math.max(0, Math.floor(avail / leading(cell.size ?? DEFAULT_SIZE)))
        return Math.min(maxFit, cellLines[i]!.length - cursors[i]!)
      })
      const segH = Math.max(0, ...row.map((cell, i) => fit[i]! * leading(cell.size ?? DEFAULT_SIZE))) + CELL_PAD_Y * 2

      const top = current.y
      let cx = x
      row.forEach((cell, i) => {
        if (cell.fill) current.rect(cx, top, columns[i]!.width, segH, cell.fill)
        cx += columns[i]!.width
      })
      cx = x
      row.forEach((_, i) => {
        const slice = cellLines[i]!.slice(cursors[i]!, cursors[i]! + fit[i]!)
        drawCellLines(current, slice, cx, top, columns[i]!.width)
        cursors[i]! += fit[i]!
        cx += columns[i]!.width
      })
      drawColumnRules(current, x, top, columns, segH)
      current.down(segH)
      current.rule(x, right, { grey: 0.75 })
    }
  }

  return current
}
