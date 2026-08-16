import type { VercelRequest, VercelResponse } from '@vercel/node'
import { serviceClient } from './_supabase.js'
import { applyCors } from './_cors.js'

/**
 * One-tap demo sign-in.
 *
 * The sign-in screen's "Try the demo" button calls this, gets back a one-time
 * token hash for the demo account, and exchanges it client-side for a session
 * (supabase.auth.verifyOtp). The demo password therefore never ships in any
 * bundle — SHIP.md records exactly how that went last time — and can rotate
 * without touching the app.
 *
 * This is deliberately an unauthenticated endpoint: "anyone can open the demo"
 * is the feature. What bounds it is the account itself — a fictional tenant
 * (Semaphore Tiling & Waterproofing) whose every row is stage dressing, seeded
 * and re-seedable by scripts/seed-demo.mjs. The token is single-use and
 * short-lived, minted per request by GoTrue.
 */

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'appreview@crewline.app'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { data, error } = await serviceClient().auth.admin.generateLink({
      type: 'magiclink',
      email: DEMO_EMAIL,
    })
    if (error || !data?.properties?.hashed_token) {
      console.error('[demo] generateLink failed', error)
      return res.status(503).json({ error: 'The demo is unavailable right now.' })
    }
    return res.status(200).json({ token_hash: data.properties.hashed_token })
  } catch (err) {
    console.error('[demo] unexpected', err)
    return res.status(500).json({ error: 'The demo is unavailable right now.' })
  }
}
