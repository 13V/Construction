import { isNative } from '../worker/location'

/**
 * When one of the page's own code files will not load.
 *
 * The website and /worker are split into many files, each named for what is
 * in it (assets/ChatPage-<hash>.js). A deploy replaces them all and the old
 * names stop existing: Vercel answers them with the website's index.html. A
 * tab opened before the deploy still runs the old code, so the next screen it
 * opens asks for a file that is gone, and the import fails. Reloading fixes
 * it, because the new index.html names the new files, and nothing else does:
 * React's lazy() and the browser both remember a failed import.
 *
 * So the page reloads itself, once:
 *  - only when the website can be reached. A failed import is also what no
 *    signal looks like, and reloading with no signal would swap the app for
 *    the browser's own error page. Offline, the caller says so and tries
 *    again when the connection comes back.
 *  - never twice within RELOAD_GUARD_MS in one tab. sessionStorage remembers
 *    when it last did, so a file that is really missing (a broken deploy)
 *    cannot reload the page over and over; and where that cannot be
 *    remembered, it does not reload at all.
 *
 * main.tsx calls this on Vite's 'vite:preloadError', which the build fires for
 * every failed import and stylesheet of its own; the error boundaries that
 * catch a failed lazy screen (ui/Crash.tsx, the website's PageBoundary) call
 * it too, to know what to say. All of them share one attempt.
 *
 * In the iOS app the files are on the phone, so there is nothing to reach:
 * it reloads once, under the same guard.
 */

/** What became of a code file that would not load. */
export type Recovery =
  /** The page is reloading to fetch the latest version. */
  | 'reloading'
  /** No connection. Try again when it comes back. */
  | 'offline'
  /** It already reloaded a moment ago, or could not note that it had: reloading is up to the person. */
  | 'stuck'

/** At most one automatic reload in this long, per tab. */
export const RELOAD_GUARD_MS = 10 * 60_000

/** Where the last automatic reload is noted (sessionStorage, so per tab). */
export const RELOADED_AT_KEY = 'crewline.reloadedForUpdateAt'

/** How long the website gets to answer before this counts as offline. */
const PROBE_TIMEOUT_MS = 8_000

/**
 * A failed import() of one of the build's own files, in each browser's words
 * (Chrome "Failed to fetch dynamically imported module", Firefox "error
 * loading dynamically imported module", Safari "Importing a module script
 * failed"), or Vite's for a stylesheet ("Unable to preload CSS for …").
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /dynamically imported module|preload css|importing a module script failed/i.test(message)
}

let attempt: Promise<Recovery> | null = null

/** Reload to get the latest version, once, if the website can be reached. Every caller gets the same answer. */
export function reloadForLatestVersion(): Promise<Recovery> {
  attempt ??= tryReload().then((outcome) => {
    // Offline is not final: the next call (the connection coming back) checks again.
    if (outcome === 'offline') attempt = null
    return outcome
  })
  return attempt
}

async function tryReload(): Promise<Recovery> {
  if (!(await reachable())) return 'offline'
  if (!noteReload()) return 'stuck'
  window.location.reload()
  return 'reloading'
}

/** Whether the website answers at all. Any answer will do; no answer in time is offline. */
async function reachable(): Promise<boolean> {
  if (isNative()) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch(`${window.location.origin}/`, { method: 'HEAD', cache: 'no-store', signal: stop.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Note this reload; false when there was one too recently, or nowhere to note it (then do not reload). */
function noteReload(): boolean {
  try {
    const store = window.sessionStorage
    const last = Number(store.getItem(RELOADED_AT_KEY))
    const now = Date.now()
    if (last > 0 && now - last < RELOAD_GUARD_MS) return false
    store.setItem(RELOADED_AT_KEY, String(now))
    return store.getItem(RELOADED_AT_KEY) === String(now)
  } catch {
    return false
  }
}
