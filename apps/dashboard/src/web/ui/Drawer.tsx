/**
 * A panel that slides in from the right over a scrim: Book crew, edit
 * details, anything that needs a form without leaving the page. The desk's
 * answer to the phone's bottom sheet.
 *
 * Esc or the scrim or the cross closes it, Tab stays inside it, and focus
 * returns to what opened it (useModal, shared with Dialog). `footer` stays
 * pinned to the bottom while the body scrolls.
 *
 *   <Drawer open={booking} title="Book crew" onClose={() => setBooking(false)}
 *     footer={<Button variant="primary" onClick={book}>Book 10 days</Button>}>
 *     …
 *   </Drawer>
 */
import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { webRoot } from '../marker'
import { color, shadow, size, space, text, z } from '../tokens'
import { CloseIcon, IconButton } from './Button'
import { useModal } from './Dialog'

export interface DrawerProps {
  open: boolean
  title: ReactNode
  /** A line under the title. */
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export function Drawer({ open, title, subtitle, onClose, children, footer, width = size.form }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // Open on the first thing to fill in, not on the cross.
  useModal(open, onClose, panel, () => {
    const body = panel.current?.querySelector<HTMLElement>('[data-drawer-body]')
    return body?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, button, a[href]') ?? closeBtn.current
  })

  if (!open) return null

  return createPortal(
    <div
      className="wb-anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: z.drawer, display: 'flex', justifyContent: 'flex-end', background: color.scrim }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="wb-anim-slide"
        style={{
          width: '100%',
          maxWidth: width,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: color.panel,
          boxShadow: shadow.modal,
          outline: 'none',
        }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', gap: space.sm, padding: `${space.md + 4}px ${space.lg}px ${space.md}px`, borderBottom: `1px solid ${color.borderSoft}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600, letterSpacing: '-.01em', color: color.ink }}>
              {title}
            </h2>
            {subtitle && <div style={{ ...text.sm, marginTop: 2, color: color.muted }}>{subtitle}</div>}
          </div>
          <IconButton ref={closeBtn} label="Close" onClick={onClose} style={{ marginRight: -6 }}>
            <CloseIcon />
          </IconButton>
        </div>
        <div data-drawer-body="" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: space.lg }}>
          {children}
        </div>
        {footer && (
          <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', gap: space.xs, padding: `${space.md}px ${space.lg}px`, borderTop: `1px solid ${color.borderSoft}`, background: color.panel }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    webRoot(),
  )
}
