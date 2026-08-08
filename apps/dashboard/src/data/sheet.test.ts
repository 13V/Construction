import { describe, expect, it } from 'vitest'
import { extractProgramme, parseDate, readCsv, readXlsx, type Grid } from './sheet'

/**
 * The .xlsx reader is tested against a real zip, built here rather than
 * checked in as a fixture. A hand-made binary is the only way to be sure the
 * reader handles what Excel actually writes — in particular a central
 * directory, since walking local headers forwards works right up until an
 * entry uses a data descriptor and then desyncs silently.
 *
 * Built with CompressionStream and DataView rather than node:zlib and Buffer,
 * so the test uses exactly the platform APIs the reader does and runs unchanged
 * in a browser test runner.
 */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function zip(files: Array<{ name: string; content: string }>): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const raw = enc.encode(f.content)
    const deflated = await deflateRaw(raw)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, 8, true) // deflate
    lv.setUint32(14, 0, true) // crc — the reader does not check it
    lv.setUint32(18, deflated.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(20, deflated.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)

    locals.push(local, deflated)
    central.push(cd)
    offset += local.length + deflated.length
  }

  const cdBuf = concat(central)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdBuf.length, true)
  ev.setUint32(16, offset, true)

  return concat([...locals, cdBuf, eocd]).buffer as ArrayBuffer
}

const WORKBOOK = `<?xml version="1.0"?><workbook><sheets><sheet name="Programme" sheetId="1"/></sheets></workbook>`

const SHARED = `<?xml version="1.0"?><sst count="4" uniqueCount="4">
  <si><t>Task</t></si>
  <si><t>Start</t></si>
  <si><t>Finish</t></si>
  <si><t>Wall and floor tiling</t></si>
</sst>`

// Row 1 is a title block, as every builder's export has. The header is row 2.
// 46069 = 2026-02-16, 46083 = 2026-03-02.
const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Lot 42 — Construction Programme Rev C</t></is></c></row>
  <row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c></row>
  <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>46069</v></c><c r="C3"><v>46083</v></c></row>
</sheetData></worksheet>`

describe('readXlsx', () => {
  it('reads a sheet through the central directory, with shared strings', async () => {
    const grids = await readXlsx(
      await zip([
        { name: 'xl/workbook.xml', content: WORKBOOK },
        { name: 'xl/sharedStrings.xml', content: SHARED },
        { name: 'xl/worksheets/sheet1.xml', content: SHEET },
      ]),
    )
    expect(grids).toHaveLength(1)
    expect(grids[0].name).toBe('Programme')
    expect(grids[0].rows[1]).toEqual(['Task', 'Start', 'Finish'])
    expect(grids[0].rows[2][0]).toBe('Wall and floor tiling')
  })

  it('turns an Excel serial into an ISO date', async () => {
    const grids = await readXlsx(
      await zip([
        { name: 'xl/workbook.xml', content: WORKBOOK },
        { name: 'xl/sharedStrings.xml', content: SHARED },
        { name: 'xl/worksheets/sheet1.xml', content: SHEET },
      ]),
    )
    // The 1900 leap-year bug is two days of offset; getting it wrong shifts
    // every date on the programme.
    expect(grids[0].rows[2][1]).toBe('2026-02-16')
    expect(grids[0].rows[2][2]).toBe('2026-03-02')
  })

  it('says so plainly when handed something that is not a zip', async () => {
    await expect(readXlsx(new TextEncoder().encode('not a spreadsheet').buffer as ArrayBuffer)).rejects.toThrow(
      /not a zip/i,
    )
  })
})

describe('readCsv', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(readCsv('a,"Level 2, east",c')).toEqual([['a', 'Level 2, east', 'c']])
  })

  it('handles doubled quotes and embedded newlines', () => {
    expect(readCsv('"He said ""go""","two\nlines"')).toEqual([['He said "go"', 'two\nlines']])
  })

  it('strips the BOM Excel leaves on a saved CSV', () => {
    // Without this the first header matches nothing and the whole import fails
    // with "no task column" on a file that plainly has one.
    expect(readCsv('﻿Task,Start')[0][0]).toBe('Task')
  })
})

describe('parseDate', () => {
  it('reads day-first, because the app is Australian', () => {
    // 03/04/2026 is 3 April here and 4 March in the US. Guessing wrong moves a
    // start date by a month without anything looking broken.
    expect(parseDate('03/04/2026')).toBe('2026-04-03')
    expect(parseDate('3-4-26')).toBe('2026-04-03')
  })

  it('reads the named-month forms a Gantt export uses', () => {
    expect(parseDate('12 Mar 2026')).toBe('2026-03-12')
    expect(parseDate('Mon 12-Mar-26')).toBe('2026-03-12')
  })

  it('refuses an impossible date rather than shifting it', () => {
    expect(parseDate('45/01/2026')).toBeNull()
    expect(parseDate('not a date')).toBeNull()
  })
})

describe('extractProgramme', () => {
  const grid = (rows: string[][]): Grid => ({ name: 'Programme', rows })

  it('finds the header under a title block', () => {
    const r = extractProgramme(
      grid([
        ['Lot 42 — Construction Programme'],
        ['Rev C', '', ''],
        ['ID', 'Task Name', 'Start', 'Finish', 'Resource'],
        ['12', 'Wall and floor tiling', '16/02/2026', '02/03/2026', 'Proven Tiling'],
      ]),
    )
    expect(r.headerRow).toBe(2)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ ref: '12', startsOn: '2026-02-16', endsOn: '2026-03-02' })
  })

  it('marks our lines and the trades we wait on', () => {
    const r = extractProgramme(
      grid([
        ['Task', 'Start', 'Finish'],
        ['Screed to falls', '10/02/2026', '11/02/2026'],
        ['Waterproof membrane', '12/02/2026', '13/02/2026'],
        ['Wall and floor tiling', '16/02/2026', '02/03/2026'],
        ['Shower screens', '05/03/2026', '06/03/2026'],
      ]),
    )
    expect(r.rows.map((x) => [x.name, x.isOurs, x.isPredecessor])).toEqual([
      ['Screed to falls', false, true],
      ['Waterproof membrane', true, false],
      ['Wall and floor tiling', true, false],
      ['Shower screens', false, false],
    ])
  })

  it('skips rows with no date rather than importing them undated', () => {
    const r = extractProgramme(
      grid([
        ['Task', 'Start', 'Finish'],
        ['Section heading with no dates', '', ''],
        ['Tiling', '16/02/2026', '02/03/2026'],
      ]),
    )
    expect(r.rows).toHaveLength(1)
  })

  it('refuses a sheet with no usable columns, and says what is missing', () => {
    const r = extractProgramme(grid([['Colour', 'Finish'], ['Matt white', 'Satin']]))
    expect(r.rows).toHaveLength(0)
    expect(r.note).toMatch(/task name and a start or finish date/i)
  })
})
