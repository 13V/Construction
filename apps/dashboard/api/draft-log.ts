import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callerWorker, serviceClient } from './_supabase.js'

/**
 * Drafts a daily log from data we already have — nobody types a form at 4pm.
 * The AI narrative is a convenience layer on top of a factual draft that is
 * always written, so the feature works with or without an API key.
 */

interface Body {
  siteId: string
  date: string
}

interface Draft {
  work_completed: string
  materials: string
  equipment_note: string
  issues: string
}

/** Claude sometimes wraps JSON in a fenced code block despite instructions not to. */
function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

function hoursBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(0, Math.round((ms / 3_600_000) * 10) / 10)
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
    console.error('[draft-log] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!worker) return res.status(401).json({ error: 'Not authenticated' })

  const body = req.body as Body
  const siteId = String(body?.siteId ?? '')
  const date = String(body?.date ?? '')
  if (!siteId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'siteId and date (YYYY-MM-DD) are required' })
  }

  const db = serviceClient()

  const { data: site, error: siteError } = await db
    .from('job_sites')
    .select('id, name, company_id')
    .eq('id', siteId)
    .eq('company_id', worker.company_id)
    .maybeSingle()
  if (siteError) {
    console.error('[draft-log] site lookup failed', siteError)
    return res.status(500).json({ error: 'Could not load job site' })
  }
  if (!site) return res.status(404).json({ error: 'Job site not found' })

  const dayStart = new Date(`${date}T00:00:00Z`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
  const now = new Date()

  const [{ data: shiftRows, error: shiftsError }, { data: fileRows, error: filesError },
    { data: expenseRows, error: expensesError }, { data: equipmentRows, error: equipmentError }] =
    await Promise.all([
      db
        .from('shifts')
        .select('worker_id, started_at, ended_at, workers(name)')
        .eq('site_id', siteId)
        .eq('company_id', worker.company_id)
        .gte('started_at', dayStart.toISOString())
        .lt('started_at', dayEnd.toISOString()),
      db
        .from('site_files')
        .select('kind, category, caption')
        .eq('site_id', siteId)
        .eq('company_id', worker.company_id)
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString()),
      db
        .from('expenses')
        .select('vendor, amount')
        .eq('site_id', siteId)
        .eq('company_id', worker.company_id)
        .eq('spent_on', date),
      db
        .from('equipment')
        .select('name, code, status')
        .eq('site_id', siteId)
        .eq('company_id', worker.company_id),
    ])

  if (shiftsError || filesError || expensesError || equipmentError) {
    console.error('[draft-log] data query failed', { shiftsError, filesError, expensesError, equipmentError })
    return res.status(500).json({ error: 'Could not load site activity' })
  }

  // Aggregate hours per worker rather than per shift — someone can clock in
  // and out more than once in a day.
  const hoursByWorker = new Map<string, { name: string; hours: number }>()
  for (const row of shiftRows ?? []) {
    const name = (row.workers as unknown as { name?: string } | null)?.name ?? 'Crew'
    const ended = row.ended_at ?? now.toISOString()
    const existing = hoursByWorker.get(row.worker_id)
    const hours = hoursBetween(row.started_at, ended)
    hoursByWorker.set(row.worker_id, { name, hours: (existing?.hours ?? 0) + hours })
  }
  const crewSummary = Array.from(hoursByWorker.values())
    .map((c) => ({ name: c.name, hours: Math.round(c.hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours)
  const totalHours = Math.round(crewSummary.reduce((sum, c) => sum + c.hours, 0) * 10) / 10

  const photoCount = (fileRows ?? []).filter((f) => f.kind === 'photo').length
  const issuePhotoCaptions = (fileRows ?? [])
    .filter((f) => f.category === 'issue' && f.caption)
    .map((f) => f.caption as string)

  const expenses = (expenseRows ?? []).map((e) => ({ vendor: e.vendor, amount: Number(e.amount) }))
  const equipmentList = (equipmentRows ?? []) as Array<{ name: string; code: string; status: string }>

  // Factual fallback — always computed, used verbatim when there's no API
  // key and as the basis of the prompt when there is one.
  const factualWorkCompleted = crewSummary.length
    ? `${crewSummary.length} crew on site, ${totalHours} hours total.`
    : 'No shifts logged on site for this date.'
  const factualMaterials = expenses.length
    ? expenses.map((e) => `${e.vendor || 'Unspecified vendor'} — $${e.amount.toFixed(2)}`).join('; ')
    : 'No purchases logged for this date.'
  const factualEquipment = equipmentList.length
    ? equipmentList.map((e) => `${e.name} (${e.code}) — ${e.status.replace('_', ' ')}`).join('; ')
    : 'No equipment assigned to this site.'
  const factualIssues = issuePhotoCaptions.length ? issuePhotoCaptions.join('; ') : 'None flagged.'

  let draft: Draft = {
    work_completed: factualWorkCompleted,
    materials: factualMaterials,
    equipment_note: factualEquipment,
    issues: factualIssues,
  }
  let aiGenerated = false

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    const facts = [
      `Site: ${site.name}, date: ${date}.`,
      `Crew: ${crewSummary.length ? crewSummary.map((c) => `${c.name} (${c.hours}h)`).join(', ') : 'none logged'}.`,
      `Photos taken: ${photoCount}.`,
      `Photo captions flagged as issues: ${issuePhotoCaptions.length ? issuePhotoCaptions.join('; ') : 'none'}.`,
      `Purchases: ${expenses.length ? expenses.map((e) => `${e.vendor || 'unspecified'} $${e.amount.toFixed(2)}`).join(', ') : 'none'}.`,
      `Equipment on site: ${equipmentList.length ? equipmentList.map((e) => `${e.name} (${e.status})`).join(', ') : 'none'}.`,
    ].join('\n')

    const instructions = [
      'You are drafting a construction daily log from the data below, written the way a foreman would jot it down at the end of the day — plain, factual, brief. No marketing language, no invented detail, no speculation beyond what the data supports.',
      'If a section has nothing to report, say so plainly (e.g. "Nothing to report.").',
      'Return ONLY a single JSON object, no markdown fences, no commentary, matching exactly this shape:',
      '{"work_completed": string, "materials": string, "equipment_note": string, "issues": string}',
      'work_completed: 1-2 short sentences summarizing who was on site and general activity level, based only on the crew/hours given.',
      'materials: 1 short sentence on purchases, or "Nothing to report." if none.',
      'equipment_note: 1 short sentence on equipment on site and its status, or "Nothing to report." if none.',
      'issues: 1 short sentence summarizing any flagged issue photos, or "None flagged." if none.',
      '',
      'Data:',
      facts,
    ].join('\n')

    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 512,
          messages: [{ role: 'user', content: instructions }],
        }),
      })

      if (!anthropicRes.ok) {
        const detail = await anthropicRes.text().catch(() => '')
        console.error('[draft-log] Anthropic error', anthropicRes.status, detail)
      } else {
        const payload = (await anthropicRes.json().catch(() => null)) as
          | { content?: Array<{ type: string; text?: string }> }
          | null
        const text = payload?.content?.find((block) => block.type === 'text')?.text
        if (text) {
          const parsed = JSON.parse(stripFences(text)) as Partial<Draft>
          draft = {
            work_completed: typeof parsed.work_completed === 'string' ? parsed.work_completed : factualWorkCompleted,
            materials: typeof parsed.materials === 'string' ? parsed.materials : factualMaterials,
            equipment_note: typeof parsed.equipment_note === 'string' ? parsed.equipment_note : factualEquipment,
            issues: typeof parsed.issues === 'string' ? parsed.issues : factualIssues,
          }
          aiGenerated = true
        }
      }
    } catch (err) {
      // Narrative generation failing is not fatal — the factual draft still stands.
      console.error('[draft-log] Anthropic request failed', err)
    }
  }

  // Preserve anything the foreman already typed if a draft for this day exists.
  const { data: existing } = await db
    .from('daily_logs')
    .select('id, status, weather, extra_notes')
    .eq('site_id', siteId)
    .eq('log_date', date)
    .maybeSingle()

  if (existing?.status === 'confirmed') {
    return res.status(409).json({ error: 'This log is already confirmed and cannot be re-drafted.' })
  }

  const row = {
    company_id: worker.company_id,
    site_id: siteId,
    log_date: date,
    status: 'draft' as const,
    weather: existing?.weather ?? null,
    work_completed: draft.work_completed,
    materials: draft.materials,
    equipment_note: draft.equipment_note,
    issues: draft.issues,
    extra_notes: existing?.extra_notes ?? null,
    crew_summary: crewSummary,
    generated_at: new Date().toISOString(),
  }

  const { data: saved, error: upsertError } = await db
    .from('daily_logs')
    .upsert(row, { onConflict: 'site_id,log_date' })
    .select()
    .single()

  if (upsertError) {
    console.error('[draft-log] upsert failed', upsertError)
    return res.status(500).json({ error: 'Could not save the draft' })
  }

  return res.status(200).json({ row: saved, aiGenerated })
}
