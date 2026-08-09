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
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True inside the Capacitor shell, false in any browser. */
export function isNative(): boolean {
  return Boolean(capacitor()?.isNativePlatform?.())
}

export function backend(): Backend {
  if (isNative()) return 'native'
  return typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'web' : 'none'
}

/**
 * What to tell the worker about how well tracking will actually hold up. The
 * phone surface shows this verbatim — a worker who thinks they are being
 * tracked in the background when they are not loses hours.
 */
export function backendNote(): string {
  switch (backend()) {
    case 'native':
      return 'Tracking keeps running with your screen off.'
    case 'web':
      return 'In a browser, tracking pauses when your phone locks. Install the app to be clocked in without keeping this open.'
    default:
      return 'This device has no location services.'
  }
}

interface NativeWatcherModule {
  BackgroundGeolocation: {
    addWatcher(
      options: {
        backgroundMessage?: string
        backgroundTitle?: string
        requestPermissions?: boolean
        stale?: boolean
        distanceFilter?: number
      },
      callback: (
        position:
          | { latitude: number; longitude: number; accuracy: number; time: number | null }
          | undefined,
        error?: { code?: string; message?: string },
      ) => void,
    ): Promise<string>
    removeWatcher(options: { id: string }): Promise<void>
  }
}

async function startNative(
  onFix: (f: Fix) => void,
  onError: (message: string) => void,
): Promise<LocationWatch> {
  // The specifier is assembled at runtime so neither TypeScript nor Vite
  // resolves it: the browser build has no Capacitor packages installed, and a
  // static import would fail both typecheck and bundling.
  const specifier = ['@capacitor-community', 'background-geolocation'].join('/')
  const mod = (await import(/* @vite-ignore */ specifier)) as
    | NativeWatcherModule
    | { default: NativeWatcherModule }
  const api = 'BackgroundGeolocation' in mod ? mod.BackgroundGeolocation : mod.default.BackgroundGeolocation

  const id = await api.addWatcher(
    {
      // Android requires a visible notification for background location. That
      // is a feature here, not a tax: the crew can see exactly when the app is
      // tracking them, and dismissing tracking is one tap away.
      backgroundTitle: 'Crewline is tracking your location',
      // Was "Only while you are clocked on" — false. The watcher this
      // notification belongs to runs from the START TRACKING tap, which is
      // well before any clock-in (the drive to site, the arrival dwell), and
      // every fix it produces is sent and stored, not just ones near a site.
      backgroundMessage: 'Recording your location while tracking is on. Tap to open.',
      requestPermissions: true,
      // A stale fix is worse than none for a geofence decision.
      stale: false,
      distanceFilter: 15,
    },
    (position, error) => {
      if (error) {
        onError(
          error.code === 'NOT_AUTHORIZED'
            ? 'Location permission is off. Turn it on in Settings, and choose "Allow all the time" so your hours keep recording with the screen off.'
            : (error.message ?? 'Location error'),
        )
        return
      }
      if (!position) return
      onFix({
        lat: position.latitude,
        lng: position.longitude,
        accuracyM: position.accuracy,
        at: position.time ?? Date.now(),
      })
    },
  )

  return {
    stop: () => {
      void api.removeWatcher({ id })
    },
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
  if (isNative()) {
    try {
      return await startNative(onFix, onError)
    } catch (err) {
      onError(
        `Background tracking could not start (${
          err instanceof Error ? err.message : String(err)
        }). Falling back to foreground only — keep this screen open.`,
      )
    }
  }
  return startWeb(onFix, onError)
}
