/**
 * The signed-in website: the rail on the left, the page on the right, on the
 * phone's app background.
 *
 * Below 768 px the rail becomes a bar across the top and a banner says the
 * website is made for a laptop (web.css); pages still work in one column,
 * because somebody will open it on a phone in a ute.
 *
 * A "Skip to content" link comes first in the Tab order, invisible until it
 * has focus, so a keyboard does not have to walk the rail on every page.
 */
import type { ReactNode } from 'react'
import type { WorkerRow } from '../phone'
import type { Route } from '../router'
import { color, space, text } from '../tokens'
import { Rail } from './Rail'

export function WorkspaceFrame({ me, route, children }: { me: WorkerRow; route: Route; children: ReactNode }) {
  return (
    <div className="wb-frame">
      <a
        href="#wb-main"
        className="wb-skip"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('wb-main')?.focus()
        }}
      >
        Skip to content
      </a>
      <Rail me={me} route={route} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          className="wb-narrow-only"
          role="note"
          style={{ alignItems: 'center', justifyContent: 'center', gap: space.xs, padding: `${space.xs}px ${space.md}px`, background: color.amberFill, ...text.sm, color: color.amber, textAlign: 'center' }}
        >
          Best on a laptop. Crews use the app.
        </div>
        <main id="wb-main" tabIndex={-1} style={{ flex: 1, minWidth: 0, outline: 'none' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
