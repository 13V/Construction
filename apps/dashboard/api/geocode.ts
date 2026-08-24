import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callerWorker } from './_supabase.js'
import { applyCors } from './_cors.js'

/**
 * Address lookup, so a job site can be put on the map from the office.
 *
 * A geofence used to be centred wherever the phone was standing, which is
 * right exactly once — when you happen to be at the job when you create it.
 * Every other time (writing up three jobs on a Sunday night, quoting a site
 * across town) it put the fence on the wrong suburb, and a fence in the wrong
 * suburb means nobody can clock on and the whole timesheet stops working.
 *
 * This runs on the server rather than in the app for two reasons. Nominatim
 * does not reliably return CORS headers through every network path the phone
 * takes, so a browser fetch is not dependable; and its usage policy asks for
 * an identifying User-Agent, which a browser will not let a page set. Both
 * are solved by asking from here.
 *
 * OpenStreetMap's own geocoder: no key, no billing, no cap that a tiling
 * business could ever reach — the same reasoning that put the map on
 * OpenFreeMap tiles. In exchange it asks for at most one request a second and
 * an honest User-Agent, and the app only calls it when somebody taps Search.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

/** Nominatim asks callers to identify themselves. This is that. */
const USER_AGENT = 'Crewline/1.0 (job site geofencing; contact: support@crewline.app)'

export interface GeocodeHit {
  label: string
  lat: number
  lng: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Authenticated, because an open geocoding proxy on a public domain is an
  // invitation to have someone else's crawler spend our Nominatim goodwill.
  let worker
  try {
    worker = await callerWorker(req.headers.authorization)
  } catch (err) {
    console.error('[geocode] auth misconfigured', err)
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!worker) return res.status(401).json({ error: 'Not authenticated' })

  const q = String(req.query.q ?? '').trim()
  if (q.length < 3) return res.status(400).json({ error: 'Type a bit more of the address' })

  const url = new URL(ENDPOINT)
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '5')
  url.searchParams.set('addressdetails', '1')
  // Every site this app has ever had is in Australia, and unrestricted search
  // puts "Brighton" in England at the top of the list.
  url.searchParams.set('countrycodes', 'au')

  let upstream: Response
  try {
    upstream = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-AU,en' } })
  } catch (err) {
    console.error('[geocode] upstream unreachable', err)
    return res.status(502).json({ error: 'Address search is unavailable — place the pin by hand.' })
  }
  if (!upstream.ok) {
    console.error('[geocode] upstream status', upstream.status)
    return res.status(502).json({ error: 'Address search is unavailable — place the pin by hand.' })
  }

  const raw = (await upstream.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>
  const results: GeocodeHit[] = raw
    .map((r) => ({
      label: String(r.display_name ?? ''),
      lat: Number(r.lat),
      lng: Number(r.lon),
    }))
    .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng))

  // A short cache is politeness to Nominatim and speed for the second person
  // who types the same builder's estate this week.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
  return res.status(200).json({ results })
}
