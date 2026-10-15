/**
 * The website's root.
 *
 * It carries the website's marker (data-web-root, see marker.ts), sets the
 * browser tab's name (index.html is shared with the phone app and stays as
 * it is), loads the website's stylesheet, and mounts the phone's file viewer
 * once: viewFile() anywhere, including inside the phone panels the website
 * hosts, does nothing without it.
 *
 * The custom properties web.css reads are set here, on the root, so dialogs
 * and toasts (portalled into this element) get them too.
 */
import './web.css'
import { useEffect } from 'react'
import { AuthGate } from './auth/AuthGate'
import { FileViewerHost, type WorkerRow } from './phone'
import { WEB_BRAND, WEB_MARKER } from './marker'
import { RouteView } from './routes'
import { useRoute } from './router'
import { ToastProvider } from './shell/Toast'
import { WorkspaceFrame } from './shell/WorkspaceFrame'
import { color, cssVars, font } from './tokens'

export function WebApp() {
  useEffect(() => {
    const before = document.title
    document.title = WEB_BRAND
    return () => {
      document.title = before
    }
  }, [])

  return (
    <div
      data-web-root={WEB_MARKER}
      style={{
        ...cssVars,
        minHeight: '100vh',
        background: color.appBg,
        color: color.ink,
        fontFamily: font,
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <ToastProvider>
        <AuthGate>{({ me }) => <Workspace me={me} />}</AuthGate>
      </ToastProvider>
      <FileViewerHost />
    </div>
  )
}

function Workspace({ me }: { me: WorkerRow }) {
  const route = useRoute()
  return (
    <WorkspaceFrame me={me} route={route}>
      <RouteView route={route} me={me} />
    </WorkspaceFrame>
  )
}
