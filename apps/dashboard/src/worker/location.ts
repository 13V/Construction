/**
 * Where location comes from.
 *
 * The product promise is "nobody taps anything" — a worker drives to site and
 * is on the clock before they get out of the ute. Mobile web cannot keep that
 * promise: `navigator.geolocation.watchPosition` stops the moment the phone
 * locks or the browser is backgrounded, which is most of the working day. So
 * the same interface has two implementations and the app picks at runtime:
 *
 *  - native  a real background watcher with a persistent foreground-service
 *            notification, which keeps reporting with the screen off
 *  - web     watchPosition, honest about only working while the page is open
 *
 * The web build must not depend on the Capacitor packages, so the native path
 * is reached through a runtime check and an ignored dynamic import. Nothing
 * here is bundled into the browser build.
 */

export interface Fix {
  lat: number
  lng: number
  accuracyM: number
  at: number
}

export interface LocationWatch {
  stop: () => void
}

export type Backend = 'native' | 'web' | 'none'

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  /**
   * Every plugin the native shell registered, injected by the Capacitor
   * bridge. This — not an import — is how the web layer reaches a plugin
   * whose JavaScript package it does not have.
   */
  Plugins?: Record<string, unknown>
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True inside the Capacitor shell, false in any browser. */
export function isNative(): boolean {
  return Boolean(capacitor()?.isNativePlatform?.())
}

export function backend(): Backend {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'web' : 'none'
}

/**
 * What to tell the worker about how well tracking will actually hold up. The
 * phone surface shows this verbatim — a worker who thinks they are being
 * tracked in the background when they are not loses hours.
 */
export function backendNote(): string {
  switch (backend()) {
    case 'web':
      return arrivalRemindersAvailable()
        ? 'Your position is read while this app is open. With it closed, your phone still tells you when you reach a site so you can clock on.'
        : 'Your location is read only while this app is open. Clock on when you reach a site and clock off when you leave.'
    default:
      return 'This device has no location services.'
  }
}



function startWeb(onFix: (f: Fix) => void, onError: (message: string) => void): LocationWatch {
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracyM: p.coords.accuracy,
        at: p.timestamp,
      }),
    (err) => onError(err.message),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  )
  return { stop: () => navigator.geolocation.clearWatch(id) }
}

/**
 * Start watching. Falls back to the browser watcher if the native plugin is
 * missing or refuses to start, so a broken native build degrades to the old
 * behaviour rather than to no tracking at all.
 */
export async function startWatching(
  onFix: (f: Fix) => void,
  onError: (message: string) => void,
): Promise<LocationWatch> {
  if (backend() === 'none') {
    onError('This device has no location services.')
    return { stop: () => {} }
  }
  /*
   * One watcher, and it is the browser's. It reports while the app is open,
   * which is all a foreground watcher was ever doing.
   *
   * What used to be here — a background-location plugin, and the
   * UIBackgroundModes key that let it run — is gone. App Review rejected 1.0
   * under guideline 2.5.4 for declaring that mode with employee tracking as
   * its only use. iOS region monitoring took its place: the system watches
   * the site boundaries, wakes the app on a crossing, and the native side
   * (SiteGeofencePlugin.swift) reports it without needing this code to be
   * running at all. See armRegions below.
   */
  return startWeb(onFix, onError)
}

/**
 * Arrival reminders.
 *
 * Hands the job sites to iOS so it can watch the boundaries and tell the
 * worker when they reach one. That is the whole of it: the native side
 * (SiteArrivalPlugin.swift) raises a local notification and nothing else — no
 * network call, no credentials, no position leaving the phone. The worker taps
 * the notification, the app opens, and they clock on through the same
 * server-checked path they always have.
 *
 * A no-op in a browser and in any build without the plugin registered.
 * Reminders are a convenience; losing them must never look like an error a
 * worker has to act on.
 */
export interface ArrivalSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

interface ArrivalPlugin {
  requestPermissions(): Promise<{ granted: boolean }>
  setSites(o: { sites: ArrivalSite[] }): Promise<{ monitoring: number }>
  monitored(): Promise<{ count: number }>
  clear(): Promise<void>
}

function arrivals(): ArrivalPlugin | null {
  const plugins = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins
  const api = plugins?.SiteArrival as ArrivalPlugin | undefined
  return api && typeof api.setSites === 'function' ? api : null
}

export function arrivalRemindersAvailable(): boolean {
  return arrivals() !== null
}

/** Returns how many sites iOS is watching, or 0 where reminders aren't available. */
export async function armArrivalReminders(sites: ArrivalSite[]): Promise<number> {
  const api = arrivals()
  if (!api) return 0
  const { granted } = await api.requestPermissions().catch(() => ({ granted: false }))
  if (!granted) return 0
  const { monitoring } = await api.setSites({ sites })
  return monitoring
}

export async function clearArrivalReminders(): Promise<void> {
  await arrivals()?.clear()
}
