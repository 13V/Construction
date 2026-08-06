import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { WorkerApp } from './worker/WorkerApp.tsx'
import './index.css'

// Two surfaces, one bundle: the office dashboard and the worker's phone.
// Vercel rewrites every path to index.html (see vercel.json), so this is all
// the routing the MVP needs.
const isWorker = window.location.pathname.replace(/\/+$/, '') === '/worker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isWorker ? <WorkerApp /> : <App />}</StrictMode>,
)
