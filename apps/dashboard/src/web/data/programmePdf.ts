/**
 * A spreadsheet programme as a PDF: the file a programme read from Excel or
 * CSV goes up with (programme.ts importProgrammeSheet).
 *
 * A phone opens a programme by showing its file (Programme.tsx), and it can
 * show a PDF but not a spreadsheet, so the lines that were read are printed:
 * one A4 table of ref, task, trade, start and finish, our lines tinted and
 * marked OURS, the lines we wait on marked FOLLOW. It is what the crew need
 * from a programme, readable on a phone, and the same on every phone the
 * app is on, whichever version.
 */
import { buildPdf, LEFT, Page, table, WIDTH, type Cell, type TableColumn } from '../phone-features'
import { oursSpan } from './programme'
import type { SheetLine } from './sheet'

/** "16 Feb 2026": a programme line's date as the printout shows it. */
export function printedDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const OURS_FILL: [number, number, number] = [0.9, 0.96, 0.92]
const FOLLOW_FILL: [number, number, number] = [1, 0.96, 0.88]

const COLUMNS: TableColumn[] = [
  { width: 38, header: 'REF' },
  { width: 199, header: 'TASK' },
  { width: 92, header: 'TRADE' },
  { width: 58, header: 'START' },
  { width: 58, header: 'FINISH' },
  { width: WIDTH - 38 - 199 - 92 - 58 - 58, header: '' },
]

export function programmePdf({
  job,
  builder,
  revision,
  issuedOn,
  fileName,
  importedOn,
  lines,
}: {
  /** What the job goes by: its address, or its name. */
  job: string
  builder: string | null
  revision: string
  issuedOn: string
  fileName: string
  importedOn: string
  lines: SheetLine[]
}): Blob {
  const pages: Page[] = []
  const newPage = () => {
    const p = new Page()
    pages.push(p)
    return p
  }
  const first = newPage()
  first.text(job, LEFT, { size: 16, font: 'HB' })
  first.down(22)
  const about = ["Builder's programme", revision.trim() || null, issuedOn ? `issued ${printedDate(issuedOn)}` : null, builder?.trim() || null].filter(Boolean).join('  ·  ')
  first.text(about, LEFT, { size: 10, grey: 0.25 })
  first.down(15)
  const span = oursSpan(lines)
  const ours = lines.filter((l) => l.isOurs).length
  first.text(
    span ? `We're on ${printedDate(span.from)} to ${printedDate(span.to)}  (${ours} line${ours === 1 ? '' : 's'} marked OURS)` : 'No line is marked as ours.',
    LEFT,
    { size: 10, font: 'HB' },
  )
  first.down(14)
  first.text(`Read from ${fileName} on ${printedDate(importedOn)}. OURS is our work; FOLLOW is what has to be finished before we start.`, LEFT, { size: 8.5, grey: 0.45 })
  first.down(16)

  const rows: Cell[][] = lines.map((l) => {
    const fill = l.isOurs ? OURS_FILL : l.isPredecessor ? FOLLOW_FILL : undefined
    const bold = l.isOurs ? ('HB' as const) : ('H' as const)
    return [
      { content: l.ref, fill, grey: 0.4 },
      { content: l.name, fill, font: bold },
      { content: l.trade, fill, grey: 0.35 },
      { content: printedDate(l.startsOn), fill },
      { content: printedDate(l.endsOn), fill },
      { content: l.isOurs ? 'OURS' : l.isPredecessor ? 'FOLLOW' : '', fill, font: 'HB', size: 7.5 },
    ]
  })
  table(first, COLUMNS, rows, { newPage })
  return buildPdf(pages, `${job} - builder's programme`)
}
