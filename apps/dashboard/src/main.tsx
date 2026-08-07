import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Crash } from './ui/Crash.tsx'
import { theme } from './theme.ts'
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

const surface = isWorker ? <WorkerApp /> : officeSurface()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash surface={isWorker ? 'The worker app' : 'Crewline'}>
      <Suspense fallback={<Booting />}>{surface}</Suspense>
    </Crash>
  </StrictMode>,
)
