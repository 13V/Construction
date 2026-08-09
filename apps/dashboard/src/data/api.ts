import { isNative } from '../worker/location'

/**
 * Where the backend lives.
 *
 * Every call to our own serverless functions used to be root-relative —
 * `fetch('/api/ping')`. In a browser that is correct: the app is served from
 * the same Vercel origin as the functions, so the path resolves to them.
 *
 * Inside the Capacitor shell it is silently, completely wrong. There is no
 * `server` block in capacitor.config.ts (deliberately — the assets are bundled
 * so the app opens with no signal), so the document origin is
 * `capacitor://localhost` on iOS and `https://localhost` on Android, and
 * `/api/ping` is answered by Capacitor's own bundled-asset handler. It never
 * leaves the phone. The response is the SPA's index.html with a 200, so
 * `res.ok` is TRUE and the failure only surfaces when `res.json()` chokes on
 * HTML — by which point it reads like a network blip rather than a request
 * that was never sent.
 *
 * `/api/ping` is the only writer of shifts. So on a phone: no clock-in, no
 * clock-out, no timesheet — the entire reason the native app exists — with an
 * "offline" banner explaining it away.
 *
 * The fix is one absolute base, baked in at build time. It stays empty for the
 * web build, where relative paths are right and an absolute one would break
 * preview deployments by pinning them at production.
 */
const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')

/**
 * True when this bundle was built for the native shell. The mobile build sets
 * VITE_API_BASE; the web build does not. Used to fail loudly rather than
 * silently at startup — see assertApiReachable().
 */
export const isNativeBuild = BASE !== ''

/** The base itself, for anything that needs to show or log it. */
export const apiBase = BASE

/**
 * Absolute URL for one of our serverless functions.
 *
 *     fetch(api('/api/ping'), { … })
 *
 * Always route through this rather than concatenating at the call site: the
 * whole class of bug above came from eight independent strings, and a ninth
 * added later would reintroduce it without anything failing in the browser.
 */
export function api(path: string): string {
  if (!path.startsWith('/')) throw new Error(`api() needs a root-relative path, got "${path}"`)
  return `${BASE}${path}`
}

/**
 * Fail loudly at startup if a native build shipped without a base URL.
 *
 * The failure this guards against is invisible: the app builds, installs,
 * opens, and looks completely normal until a worker relies on it to record a
 * day's pay. A missing environment variable must not be able to ship that.
 */
export function apiConfigError(): string | null {
  // Only the native shell can be wrong here — in a browser an empty base is
  // correct and intended. isNative() already exists for exactly this question
  // and asks Capacitor itself rather than pattern-matching the URL, which
  // differs between iOS (capacitor://localhost) and Android (https://localhost).
  if (!isNative()) return null
  if (BASE) return null
  return 'This build is missing its server address, so nothing can be recorded. Reinstall from a build made with `npm run sync`.'
}
