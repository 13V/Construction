import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callerWorker } from './_supabase.js'

/**
 * Reads a receipt or supplier invoice with Claude and hands back structured
 * fields for the client to review. Line items come back costed — quantity,
 * unit and unit price — so they can become material rows against the job
 * rather than just a total someone has to re-key.
 *
 * This endpoint never touches the database. Nothing is written until a human
 * confirms what was read; an extractor that files wrong numbers silently is
 * worse than manual entry.
 */

interface Body {
  imageBase64: string
  mediaType: string
  siteHint?: string
  sitesList?: string[]
  /** Cost codes to choose from, so lines come back already coded. */
  costCodes?: string[]
}

export interface ExtractedLine {
  description: string
  quantity: number
  unit: string
  unit_cost: number
  amount: number
  cost_code: string | null
}

interface ExtractedReceipt {
  vendor: string | null
  spent_on: string | null
  amount: number | null
  tax: number | null
  category: string
  line_items: ExtractedLine[]
  confidence: number
  note: string | null
}

const CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// Supplier invoices arrive as PDFs far more often than photos.
const PDF_TYPE = 'application/pdf'
const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, PDF_TYPE]

/** Anthropic's own per-image ceiling is 5 MB; base64 inflates bytes by ~4/3. */
const MAX_IMAGE_BASE64 = Math.ceil((5 * 1024 * 1024 * 4) / 3)
/** Job sites and cost codes get joined into the prompt — cap how many. */
const MAX_LIST = 200

/** Units a merchant might print, normalised to what the materials table uses. */
const UNITS = ['ea', 'lm', 'm', 'm²', 'm³', 'kg', 't', 'L', 'box', 'pack', 'sheet', 'hr']

/** Claude sometimes wraps JSON in a fenced code block despite instructions not to. */
function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let worker
  try {
    worker = await callerWorker(req.headers.authorization)
  } catch (err) {
    console.error('[parse-receipt] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!worker) return res.status(401).json({ error: 'Not authenticated' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // The dashboard falls back to manual entry when it sees this — never a hard failure.
    return res.status(501).json({ error: 'AI extraction not configured', manual: true })
  }

  const body = req.body as Body
  const imageBase64 = String(body?.imageBase64 ?? '')
  const mediaType = String(body?.mediaType ?? '')
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' })
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: `mediaType must be one of ${ALLOWED_MEDIA_TYPES.join(', ')}` })
  }
  // Anthropic rejects images over 5 MB anyway, so anything larger is a request
  // that cannot succeed — and every call here costs money, so the ceiling is
  // enforced before the request is made rather than after it is billed.
  if (imageBase64.length > MAX_IMAGE_BASE64) {
    return res.status(413).json({
      error: 'That image is too large to read. Photograph the receipt again, or crop it.',
    })
  }

  // These are joined into the prompt, so they are bounded too: unbounded
  // caller-supplied arrays are a way to inflate the input token count at will.
  const siteHint = typeof body.siteHint === 'string' ? body.siteHint.slice(0, 120) : null
  const sitesList = Array.isArray(body.sitesList)
    ? body.sitesList.filter((s): s is string => typeof s === 'string').slice(0, MAX_LIST).map((s) => s.slice(0, 120))
    : []

  const instructions = [
    'You are extracting structured data from a photo of a construction expense receipt.',
    'Return ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:',
    '{"vendor": string, "spent_on": "YYYY-MM-DD", "amount": number, "tax": number, "category": string, "line_items": [{"description": string, "quantity": number, "unit": string, "unit_cost": number, "amount": number, "cost_code": string｜null}], "confidence": number, "note": string}',
    'Extract EVERY line item on the document, not just a summary. These become the material list costed against the job, so quantities and unit prices matter as much as the total.',
    `"unit" must be one of: ${UNITS.join(', ')}. Map the merchant's unit onto the closest one — "LIN M" or "L/M" is lm, "EACH" or "PC" is ea, "SHT" is sheet. Use "ea" if genuinely unclear.`,
    '"quantity" x "unit_cost" should equal "amount" for each line. If the document only prints a line total, infer quantity 1 and set unit_cost to the line total.',
    'Ignore delivery fees, surcharges and rounding lines — those are not materials. Do not invent lines that are not printed on the document.',
    `"category" must be exactly one of: ${CATEGORIES.join(', ')}.`,
    '"amount" is the total charged and "tax" is the tax portion, both plain numbers with no currency symbols.',
    '"confidence" is your confidence in the overall reading, from 0 to 1.',
    '"note" is one short sentence flagging anything uncertain or illegible, or an empty string if the receipt was clear.',
    'If a field cannot be read, make your best guess and lower "confidence" rather than leaving it blank.',
  ]
  if (siteHint) instructions.push(`This receipt was likely purchased for the job site "${siteHint}".`)
  if (sitesList.length) instructions.push(`Known job sites for this company: ${sitesList.join(', ')}.`)
  const costCodes = Array.isArray(body.costCodes)
    ? body.costCodes.filter((c): c is string => typeof c === 'string').slice(0, MAX_LIST).map((c) => c.slice(0, 120))
    : []
  if (costCodes.length) {
    instructions.push(
      `Assign each line the most fitting cost code from this list, or null if none fits: ${costCodes.join(' | ')}.`,
    )
  }

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
        // Invoices can run to dozens of lines; 1024 truncated them mid-JSON.
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instructions.join('\n') },
              mediaType === PDF_TYPE
                ? {
                    type: 'document',
                    source: { type: 'base64', media_type: PDF_TYPE, data: imageBase64 },
                  }
                : { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    console.error('[parse-receipt] Anthropic request failed', err)
    return res.status(502).json({ error: 'Could not reach the extraction service — enter it by hand.' })
  }

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(() => '')
    console.error('[parse-receipt] Anthropic error', anthropicRes.status, detail)
    return res.status(502).json({ error: 'Receipt extraction failed — enter it by hand.' })
  }

  const payload = (await anthropicRes.json().catch(() => null)) as
    | { content?: Array<{ type: string; text?: string }> }
    | null
  const text = payload?.content?.find((block) => block.type === 'text')?.text
  if (!text) {
    return res.status(502).json({ error: 'Extraction returned no result — enter it by hand.' })
  }

  let parsed: Partial<ExtractedReceipt> & { category?: unknown }
  try {
    parsed = JSON.parse(stripFences(text))
  } catch (err) {
    console.error('[parse-receipt] JSON parse failed', text, err)
    return res.status(502).json({ error: 'Could not parse the extraction result — enter it by hand.' })
  }

  const category = typeof parsed.category === 'string' && CATEGORIES.includes(parsed.category)
    ? parsed.category
    : 'Other'
  const confidence =
    typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5

  const result: ExtractedReceipt = {
    vendor: typeof parsed.vendor === 'string' ? parsed.vendor : null,
    spent_on:
      typeof parsed.spent_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.spent_on)
        ? parsed.spent_on
        : null,
    amount: typeof parsed.amount === 'number' ? parsed.amount : Number(parsed.amount) || null,
    tax: typeof parsed.tax === 'number' ? parsed.tax : Number(parsed.tax) || null,
    category,
    line_items: Array.isArray(parsed.line_items)
      ? parsed.line_items
          .filter((li) => li != null && typeof li === 'object')
          .map((raw) => {
            const li = raw as unknown as Record<string, unknown>
            const amount = Number(li.amount) || 0
            const quantity = Number(li.quantity) || 0
            // Trust the printed line total over a quantity x price that
            // doesn't reconcile — the total is what the supplier charged.
            const unitCost = Number(li.unit_cost) || (quantity > 0 ? amount / quantity : amount)
            const unit = typeof li.unit === 'string' && UNITS.includes(li.unit) ? li.unit : 'ea'
            return {
              description: String(li.description ?? '').trim(),
              quantity: quantity > 0 ? quantity : 1,
              unit,
              unit_cost: Math.round(unitCost * 100) / 100,
              amount,
              cost_code:
                typeof li.cost_code === 'string' && costCodes.includes(li.cost_code)
                  ? li.cost_code
                  : null,
            }
          })
          .filter((li) => li.description.length > 0)
      : [],
    confidence,
    note: typeof parsed.note === 'string' && parsed.note.length > 0 ? parsed.note : null,
  }

  return res.status(200).json(result)
}
