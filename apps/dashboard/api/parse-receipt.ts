import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callerWorker } from './_supabase.js'

/**
 * Reads a receipt photo with Claude and hands back structured fields for the
 * client to review. This endpoint never touches the database — expenses are
 * only ever written after a human confirms what was read, on the client.
 */

interface Body {
  imageBase64: string
  mediaType: string
  siteHint?: string
  sitesList?: string[]
}

interface ExtractedReceipt {
  vendor: string | null
  spent_on: string | null
  amount: number | null
  tax: number | null
  category: string
  line_items: Array<{ description: string; amount: number }>
  confidence: number
  note: string | null
}

const CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

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

  const siteHint = typeof body.siteHint === 'string' ? body.siteHint : null
  const sitesList = Array.isArray(body.sitesList)
    ? body.sitesList.filter((s): s is string => typeof s === 'string')
    : []

  const instructions = [
    'You are extracting structured data from a photo of a construction expense receipt.',
    'Return ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:',
    '{"vendor": string, "spent_on": "YYYY-MM-DD", "amount": number, "tax": number, "category": string, "line_items": [{"description": string, "amount": number}], "confidence": number, "note": string}',
    `"category" must be exactly one of: ${CATEGORIES.join(', ')}.`,
    '"amount" is the total charged and "tax" is the tax portion, both plain numbers with no currency symbols.',
    '"confidence" is your confidence in the overall reading, from 0 to 1.',
    '"note" is one short sentence flagging anything uncertain or illegible, or an empty string if the receipt was clear.',
    'If a field cannot be read, make your best guess and lower "confidence" rather than leaving it blank.',
  ]
  if (siteHint) instructions.push(`This receipt was likely purchased for the job site "${siteHint}".`)
  if (sitesList.length) instructions.push(`Known job sites for this company: ${sitesList.join(', ')}.`)

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
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instructions.join('\n') },
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
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
          .map((li) => ({
            description: String((li as { description?: unknown }).description ?? ''),
            amount: Number((li as { amount?: unknown }).amount) || 0,
          }))
      : [],
    confidence,
    note: typeof parsed.note === 'string' && parsed.note.length > 0 ? parsed.note : null,
  }

  return res.status(200).json(result)
}
