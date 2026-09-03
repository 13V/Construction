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
      return regionMonitoringAvailable()
        ? 'Arriving at a site clocks you on even with the app closed. While it is open, your position updates as you move.'
        : 'In a browser, tracking pauses when your phone locks. Install the app to be clocked on without keeping this open.'
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
 * Hand the job sites to iOS so it can watch the boundaries itself.
 *
 * This is what replaced the location background mode. iOS monitors the
 * regions in the system, wakes the app when one is crossed, and the native
 * side (SiteGeofencePlugin.swift) reports the crossing to /api/ping without
 * needing this JavaScript to be alive — which it will not be, because the
 * app will have been terminated.
 *
 * A no-op in a browser and in any build where the plugin is not registered.
 * Failing loudly here would put an error in front of a worker about something
 * they cannot act on; the foreground watcher above is what records hours
 * while the app is open either way.
 */
export interface RegionSite {
  id: string
  lat: number
  lng: number
  radiusM: number
}

interface GeofencePlugin {
  requestAlways(): Promise<{ granted: boolean }>
  setCredentials(o: { apiBase: string; supabaseUrl: string; anonKey: string; refreshToken: string }): Promise<void>
  setRegions(o: { sites: RegionSite[] }): Promise<{ monitoring: number }>
  monitored(): Promise<{ count: number; ids: string[] }>
  clear(): Promise<void>
}

function geofence(): GeofencePlugin | null {
  const plugins = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins
  const api = plugins?.SiteGeofence as GeofencePlugin | undefined
  return api && typeof api.setRegions === 'function' ? api : null
}

export function regionMonitoringAvailable(): boolean {
  return geofence() !== null
}

export async function armRegions(
  sites: RegionSite[],
  credentials: { apiBase: string; supabaseUrl: string; anonKey: string; refreshToken: string },
): Promise<number> {
  const api = geofence()
  if (!api) return 0
  await api.requestAlways().catch(() => ({ granted: false }))
  await api.setCredentials(credentials)
  const { monitoring } = await api.setRegions({ sites })
  return monitoring
}

export async function disarmRegions(): Promise<void> {
  await geofence()?.clear()
}
