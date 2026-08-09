import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * CORS for the serverless functions.
 *
 * Before api.ts pointed the native shell at an absolute URL, every request
 * to these functions was same-origin and no browser ever sent a preflight.
 * Now the phone calls https://<vercel-domain>/api/... from
 * capacitor://localhost or https://localhost, which makes it cross-origin,
 * so the browser engine sends an OPTIONS preflight before the real request
 * and — without an Access-Control-Allow-Origin the engine accepts — blocks
 * the response from ever reaching the app's fetch() call. That failure looks
 * identical to the one api.ts exists to fix: a 200 never arrives, so it
 * reads as "offline" rather than as the config problem it is.
 *
 * The allow-list is exact origins, never "*". Every one of these endpoints
 * reads the caller's identity off an Authorization bearer token
 * (callerWorker in _supabase.ts), which makes them credentialed requests —
 * and a wildcard origin on a credentialed endpoint is how a worker's session
 * token gets handed to whatever site happens to also send a "*"-permitted
 * request. Reflecting one of these three fixed origins back is the whole
 * point of an allow-list: it works, but only for the shells we built.
 */
const ALLOWED_ORIGINS = [
  'capacitor://localhost', // iOS shell
  'https://localhost', // Android shell
  'http://localhost:5173', // vite dev server
]

const ALLOWED_METHODS = 'GET, POST, OPTIONS'
const ALLOWED_HEADERS = 'authorization, content-type'

/**
 * Sets the CORS headers for one response, if the request's Origin is one we
 * recognise. Call this on EVERY path out of a handler, success or error — a
 * 401 or 500 sent without these headers is invisible to the browser's fetch
 * as anything other than a network failure, so the client never even gets to
 * show the caller-facing error message the endpoint bothered to compute.
 *
 * Returns true if the request was an OPTIONS preflight and has already been
 * answered — the caller should return immediately in that case.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin
  if (typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    // Credentialed requests (ours all carry Authorization) can't use "*" per
    // the fetch spec even if we wanted to, but set it explicitly rather than
    // rely on that: a browser silently drops the response without it.
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    // Caches and CDNs must not serve one origin's preflight response to
    // another origin's request.
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}
