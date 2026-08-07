import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { WorkerApp } from './worker/WorkerApp.tsx'
import './index.css'

/*
 * Two surfaces, one bundle: the office dashboard and the worker's phone.
 * Vercel rewrites every path to index.html (see vercel.json), so this is all
 * the routing the MVP needs.
 *
 * Three ways to land on the worker surface:
 *  - /worker in a browser
 *  - a build made for the native shell (VITE_SURFACE=worker)
 *  - running inside Capacitor at all, where the path is always '/' and a
 *    phone app is never the office dashboard
 */
const isNativeShell = Boolean(
  (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
)
const isWorker =
  window.location.pathname.replace(/\/+$/, '') === '/worker' ||
  import.meta.env.VITE_SURFACE === 'worker' ||
  isNativeShell

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isWorker ? <WorkerApp /> : <App />}</StrictMode>,
)
