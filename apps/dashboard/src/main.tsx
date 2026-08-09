import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Crash } from './ui/Crash.tsx'
import { theme } from './theme.ts'
import { apiConfigError } from './data/api.ts'
import './index.css'

/*
 * Two surfaces, one codebase: the office dashboard and the worker's phone.
 * Vercel rewrites every path to index.html (see vercel.json), so this is all
 * the routing the MVP needs.
 *
 * Three ways to land on the worker surface:
 *  - /worker in a browser
 *  - a build made for the native shell (VITE_SURFACE=worker)
 *  - running inside Capacitor at all, where the path is always '/' and a
 *    phone app is never the office dashboard
 *
 * Both are loaded dynamically so only the one being shown is fetched and
 * parsed. Importing them statically meant a worker's phone downloaded and
 * parsed the entire office dashboard — MapLibre GL included, roughly 800 kB of
 * a mapping library the worker surface never once references — before it could
 * show a clock-in button. That is the wrong tax to put on an old Android on
 * site signal, and it applied to the native build too.
 */
const isNativeShell = Boolean(
  (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
)

/**
 * True only in a build made for the phone. Vite replaces `import.meta.env` with
 * a literal at build time, so this folds to a constant and the office dashboard
 * is dropped from the output entirely rather than merely never loaded — the APK
 * would otherwise carry the dashboard chunk, MapLibre's worker and all fourteen
 * feature screens as dead files, about 1.7 MB the phone can never reach.
 */
const workerOnlyBuild = import.meta.env.VITE_SURFACE === 'worker'

const isWorker =
  workerOnlyBuild || isNativeShell || window.location.pathname.replace(/\/+$/, '') === '/worker'

const WorkerApp = lazy(() => import('./worker/WorkerApp.tsx').then((m) => ({ default: m.WorkerApp })))

/** Shown for the moment it takes to fetch the surface chunk. */
function Booting() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        color: theme.inkFaint,
        font: '13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      Loading…
    </div>
  )
}

/**
 * The office dashboard, reached only in a build that can show it. Referencing
 * it inside the dead branch below is what lets Rollup drop it from a phone
 * build; naming it at the top level would keep the import alive in both.
 */
function officeSurface() {
  const App = lazy(() => import('./App.tsx'))
  return <App />
}

/**
 * A phone build with no server address is not a degraded app, it is a decoy:
 * it opens, signs in, shows the clock and asks for location, and records
 * nothing — because every `/api/...` call is answered by Capacitor's own
 * bundled-asset handler instead of the server. The failure is invisible until
 * someone relies on it for a day's pay.
 *
 * A missing environment variable must not be able to ship that, so it is fatal
 * at startup and says so. In a browser the base is empty on purpose and this
 * never fires.
 */
function ConfigError({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        background: theme.appBg,
        color: theme.ink,
        font: '15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 340 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>This app can't record anything</div>
        <p style={{ margin: 0, color: theme.inkSoft, fontSize: 14 }}>{message}</p>
      </div>
    </div>
  )
}

const configError = apiConfigError()

const surface = configError ? (
  <ConfigError message={configError} />
) : isWorker ? (
  <WorkerApp />
) : (
  officeSurface()
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash surface={isWorker ? 'The worker app' : 'Crewline'}>
      <Suspense fallback={<Booting />}>{surface}</Suspense>
    </Crash>
  </StrictMode>,
)
