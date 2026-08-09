import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callerWorker } from './_supabase.js'
import { applyCors } from './_cors.js'

/**
 * Reads a builder's construction programme out of a PDF and hands back dated
 * tasks for a human to confirm.
 *
 * Spreadsheets never reach here: .xlsx and .csv are structured data and are
 * read in the browser by src/data/sheet.ts, for free and offline. This endpoint
 * is only for the PDF case — a Gantt chart rendered to paper, where the dates
 * exist as bars on a timeline and there is no grid to read.
 *
 * Like parse-receipt, it NEVER writes to the database. A programme that files
 * itself with a mis-read date sends a crew to a job that is not ready, which is
 * a day's wages for nothing; nothing is stored until someone has looked at it.
 */

interface Body {
  fileBase64: string
  mediaType: string
  siteName?: string
}

export interface ExtractedTask {
  ref: string | null
  name: string
  trade: string | null
  starts_on: string | null
  ends_on: string | null
  pct_complete: number | null
  is_ours: boolean
  is_predecessor: boolean
}

interface ExtractedProgramme {
  revision: string | null
  issued_on: string | null
  tasks: ExtractedTask[]
  confidence: number
  note: string
}

const PDF_TYPE = 'application/pdf'
/** Anthropic's per-document ceiling is 32 MB; base64 inflates bytes by ~4/3. */
const MAX_BASE64 = Math.ceil((32 * 1024 * 1024 * 4) / 3)
/** A programme with more lines than this is a whole-project master, not a job. */
const MAX_TASKS = 400

/** Claude sometimes wraps JSON in a fenced code block despite instructions not to. */
function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

const isoDate = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let worker
  try {
    worker = await callerWorker(req.headers.authorization)
  } catch (err) {
    console.error('[parse-programme] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!worker) return res.status(401).json({ error: 'Not authenticated' })
  // A programme is not commercial, but importing one supersedes the revision the
  // whole crew is working to, so it is an office action.
  if (!worker.is_office) return res.status(403).json({ error: 'Office only' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // The import screen offers the spreadsheet path and manual entry when it
    // sees this. Never a hard failure.
    return res.status(501).json({ error: 'PDF reading not configured', manual: true })
  }

  const body = req.body as Body
  const fileBase64 = String(body?.fileBase64 ?? '')
  const mediaType = String(body?.mediaType ?? '')
  if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' })
  if (mediaType !== PDF_TYPE) {
    return res.status(400).json({ error: 'Only PDF is read here — spreadsheets are read in the browser.' })
  }
  if (fileBase64.length > MAX_BASE64) {
    return res.status(413).json({ error: 'That programme is too large to read. Send the tiling pages only.' })
  }

  const siteName = typeof body.siteName === 'string' ? body.siteName.slice(0, 120) : null

  const instructions = [
    'You are reading a construction programme (a Gantt chart) sent by a builder to a TILING SUBCONTRACTOR in South Australia.',
    'Return ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:',
    '{"revision": string|null, "issued_on": "YYYY-MM-DD"|null, "tasks": [{"ref": string|null, "name": string, "trade": string|null, "starts_on": "YYYY-MM-DD"|null, "ends_on": "YYYY-MM-DD"|null, "pct_complete": number|null, "is_ours": boolean, "is_predecessor": boolean}], "confidence": number, "note": string}',
    'Read the dates off the bars against the timeline scale at the top. Give the date the bar STARTS and the date it ENDS.',
    'Dates on Australian programmes are day-first: 03/04/26 is 3 April 2026. Always return ISO YYYY-MM-DD.',
    '"is_ours" is true for lines this tiling subcontractor performs: tiling, wall and floor tiling, waterproofing, membrane, screed-and-tile, grouting, wet areas, sealing.',
    '"is_predecessor" is true for lines that must FINISH before tiling can start: screed, substrate, falls, set-out, rendering, plastering/gyprock, plumbing rough-in, slab, hobs. It is false for anything already marked is_ours.',
    'Do not mark trades that FOLLOW tiling (shower screens, cabinetry, final plumbing fit-off, painting) as predecessors.',
    'Include every dated line you can read, not only ours — the lines around ours are what tell them whether the job will be ready.',
    'Do NOT invent tasks or dates. If a bar is unreadable, leave its dates null and say so in "note".',
    '"revision" is the drawing revision if one is printed ("Rev C", "P4"), otherwise null.',
    '"confidence" is your confidence in the dates you read, from 0 to 1. Lower it if the timeline scale was hard to read.',
    '"note" is one or two short sentences on anything uncertain, or an empty string if it was clear.',
  ]
  if (siteName) instructions.push(`This programme is for the job site "${siteName}".`)

  let anthropicRes
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // A programme runs to hundreds of lines; anything less truncates the
        // JSON mid-array and the whole import is lost.
        max_tokens: 16_384,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instructions.join('\n') },
              { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data: fileBase64 } },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    console.error('[parse-programme] Anthropic request failed', err)
    return res.status(502).json({ error: 'Could not reach the extraction service — enter the dates by hand.' })
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => '')
    console.error('[parse-programme] Anthropic error', anthropicRes.status, detail)
    return res.status(502).json({ error: 'Reading the programme failed — enter the dates by hand.' })
  }

  const payload = (await anthropicRes.json().catch(() => null)) as
    | { content?: Array<{ type: string; text?: string }> }
    | null
  const text = payload?.content?.find((block) => block.type === 'text')?.text
  if (!text) return res.status(502).json({ error: 'Reading returned no result — enter the dates by hand.' })

  let parsed: Partial<ExtractedProgramme>
  try {
    parsed = JSON.parse(stripFences(text))
  } catch (err) {
    console.error('[parse-programme] JSON parse failed', text.slice(0, 400), err)
    return res.status(502).json({ error: 'Could not parse what came back — enter the dates by hand.' })
  }

  // Everything is re-checked rather than trusted. A model that returns "next
  // Tuesday" or a 1970 date has to fail loudly here, not silently populate a
  // programme the crew then plans a fortnight around.
  const raw: unknown[] = Array.isArray(parsed.tasks) ? parsed.tasks : []
  const tasks: ExtractedTask[] = raw
    .slice(0, MAX_TASKS)
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      ref: typeof t.ref === 'string' ? t.ref.slice(0, 40) : null,
      name: String(t.name ?? '').slice(0, 200),
      trade: typeof t.trade === 'string' ? t.trade.slice(0, 80) : null,
      starts_on: isoDate(t.starts_on),
      ends_on: isoDate(t.ends_on),
      pct_complete:
        typeof t.pct_complete === 'number' && Number.isFinite(t.pct_complete)
          ? Math.max(0, Math.min(100, t.pct_complete))
          : null,
      is_ours: t.is_ours === true,
      // Belt and braces on the one rule the prompt could get wrong in a way
      // that matters: a line cannot be both ours and something we wait on.
      is_predecessor: t.is_predecessor === true && t.is_ours !== true,
    }))
    .filter((t) => t.name.length > 0 && (t.starts_on !== null || t.ends_on !== null))

  return res.status(200).json({
    revision: typeof parsed.revision === 'string' ? parsed.revision.slice(0, 40) : null,
    issued_on: isoDate(parsed.issued_on),
    tasks,
    confidence:
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    note: typeof parsed.note === 'string' ? parsed.note.slice(0, 500) : '',
  })
}
