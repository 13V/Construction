/**
 * A confirm dialog: a question, Cancel, and the action.
 *
 * Esc cancels. Enter confirms: the dialog is a <form> and the action is its
 * submit button, which has focus when the dialog opens (or the first input
 * does, if the body has one, and Enter there submits too). Tab and Shift+Tab
 * stay inside the dialog while it is open, and focus goes back to whatever
 * opened it when it closes.
 *
 *   <Dialog open={asking} title="Archive this job?" confirmLabel="Archive" tone="danger"
 *     busy={saving} error={err} onConfirm={archive} onCancel={() => setAsking(false)}>
 *     Crews stop seeing it on their phones.
 *   </Dialog>
 *
 * useModal() is the part Drawer shares: Esc, the focus trap, and focus
 * restore, for whichever modal is on top.
 */
import { useEffect, useId, useRef, type FormEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { webRoot } from '../marker'
import { color, radius, shadow, size, space, text, z } from '../tokens'
import { Button } from './Button'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The focusable elements inside `root` that can actually be seen. */
export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
}

/** Open modals, newest last. Only the top one answers Esc and Tab. */
const stack: symbol[] = []

/**
 * While `open`: Esc calls onClose, Tab cycles inside `panel`, the page behind
 * does not scroll, and on close focus returns to where it was.
 *
 * `initialFocus` picks what to focus on open; by default the panel's first
 * focusable element, else the panel itself.
 */
export function useModal(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLElement | null>,
  initialFocus?: () => HTMLElement | null | undefined,
) {
  const close = useRef(onClose)
  const pick = useRef(initialFocus)
  useEffect(() => {
    close.current = onClose
    pick.current = initialFocus
  })

  useEffect(() => {
    if (!open) return
    const me = Symbol('modal')
    stack.push(me)
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = panel.current
    const first = pick.current?.() ?? focusables(root)[0] ?? root
    first?.focus()
    // A disabled pick cannot take focus; the panel itself then holds it, so
    // Esc and Tab still work and nothing behind the scrim keeps it.
    if (root && !root.contains(document.activeElement)) root.focus()

    const body = document.body.style
    const overflow = body.overflow
    body.overflow = 'hidden'

    // Bubble phase on the document, so a control inside that handles Esc
    // itself (an open Combobox list) can stop it before it closes the modal.
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(panel.current)
      if (items.length === 0) {
        e.preventDefault()
        panel.current?.focus()
        return
      }
      const active = document.activeElement
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const inside = panel.current?.contains(active) ?? false
      if (e.shiftKey && (active === firstItem || !inside)) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && (active === lastItem || !inside)) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(me), 1)
      if (stack.length === 0) body.overflow = overflow
      if (before && document.contains(before)) before.focus()
    }
  }, [open, panel])
}

export interface DialogProps {
  open: boolean
  title: ReactNode
  /** The explanation under the title; may hold inputs. */
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' makes the action red: archive, remove, delete. */
  tone?: 'default' | 'danger'
  /** While the action runs: the action spins, nothing else can be pressed, Esc does nothing. */
  busy?: boolean
  /** Why the action failed, shown above the buttons. The dialog stays open. */
  error?: ReactNode
  /** Disables the action, e.g. until a required input is filled. */
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
  width?: number
}

export function Dialog({
  open,
  title,
  children,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  error,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  width = size.dialog,
}: DialogProps) {
  const panel = useRef<HTMLFormElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  useModal(
    open,
    () => {
      if (!busy) onCancel()
    },
    panel,
    () => panel.current?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select') ?? confirm.current,
  )

  if (!open) return null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // A dialog opened from inside another form (the job form's "discard
    // changes?") must not submit that form too: React bubbles submit
    // through the portal to the component tree it was rendered from.
    e.stopPropagation()
    if (!busy && !confirmDisabled) onConfirm()
  }

  return createPortal(
    <div
      className="wb-anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: z.dialog, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space.lg, background: color.scrim }}
    >
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        tabIndex={-1}
        onSubmit={submit}
        className="wb-anim-pop"
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: space.md,
          padding: space.lg,
          background: color.panel,
          borderRadius: radius.lg,
          boxShadow: shadow.modal,
          outline: 'none',
        }}
      >
        <h2 id={titleId} style={{ margin: 0, ...text.md, fontSize: 17, fontWeight: 600, letterSpacing: '-.01em', color: color.ink }}>
          {title}
        </h2>
        {children && (
          <div id={bodyId} style={{ ...text.base, color: color.body }}>
            {children}
          </div>
        )}
        {error && (
          <div role="alert" style={{ padding: '10px 12px', borderRadius: radius.md, background: color.redFill, ...text.sm, color: color.red }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space.xs, marginTop: space.xxs }}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button ref={confirm} type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>,
    webRoot(),
  )
}
