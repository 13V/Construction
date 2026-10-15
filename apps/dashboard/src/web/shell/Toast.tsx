/**
 * Short confirmations at the bottom of the window: "Job created", "1 day
 * skipped: Dean is already booked on Tuesday".
 *
 * One provider at the website's root, so a toast survives the navigation it
 * often follows (create a job, land on it, read the toast there). Toasts are
 * in a polite live region, so a screen reader reads them without being cut
 * off; errors stay longer than good news, and every toast can be dismissed.
 *
 *   const toast = useToast()
 *   toast('Job created', { tone: 'success' })
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CloseIcon, IconButton } from '../ui/Button'
import { color, radius, shadow, space, text, z } from '../tokens'

export type ToastTone = 'neutral' | 'success' | 'error'

export interface ToastOptions {
  tone?: ToastTone
  /** A button in the toast: Undo, View job. */
  action?: { label: string; onClick: () => void }
  /** How long it stays, in ms. Default 6 s, errors 10 s. */
  duration?: number
}

interface Item extends ToastOptions {
  id: number
  message: ReactNode
}

type Show = (message: ReactNode, options?: ToastOptions) => void

const ToastContext = createContext<Show | null>(null)

/** Show a toast. Outside a ToastProvider (a test, a stray render) it does nothing rather than throw. */
export function useToast(): Show {
  return useContext(ToastContext) ?? noop
}
const noop: Show = () => {}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback<Show>((message, options = {}) => {
    const id = next.current++
    // Three at most: a burst of the same failure should not wall off the page.
    setItems((all) => [...all.slice(-2), { id, message, ...options }])
  }, [])
  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Rendered in place, not portalled: the provider already sits inside the
          website's root (so web.css's variables apply), nothing between has a
          transform, and a live region that exists before its first message is
          the one screen readers reliably announce. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          left: '50%',
          bottom: space.lg,
          zIndex: z.toast,
          width: 'min(480px, calc(100vw - 32px))',
          marginLeft: 'calc(min(480px, calc(100vw - 32px)) / -2)',
          display: 'flex',
          flexDirection: 'column',
          gap: space.xs,
          pointerEvents: 'none',
        }}
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: Item; onDismiss: () => void }) {
  const { tone = 'neutral', action, duration } = item
  const [paused, setPaused] = useState(false)
  const stay = duration ?? (tone === 'error' ? 10_000 : 6_000)
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  // Paused while the pointer is on it, so a long message can be finished.
  useEffect(() => {
    if (paused) return
    const t = window.setTimeout(() => dismissRef.current(), stay)
    return () => window.clearTimeout(t)
  }, [paused, stay])

  const mark = tone === 'success' ? color.greenFill : tone === 'error' ? color.redOnDark : null
  return (
    <div
      className="wb-anim-rise"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 48,
        padding: `${space.xs}px ${space.xs}px ${space.xs}px ${space.md}px`,
        background: color.inkDeep,
        color: color.onDark,
        borderRadius: radius.lg,
        boxShadow: shadow.pop,
        ...text.base,
      }}
    >
      {mark && (
        <span aria-hidden="true" style={{ flex: 'none', display: 'inline-flex' }}>
          {tone === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke={mark} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke={mark} strokeWidth="1.6" />
              <path d="M8 4.8v3.8M8 11.1v.1" stroke={mark} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, padding: '6px 0' }}>
        {tone === 'error' && <span className="wb-sr-only">Error: </span>}
        {item.message}
      </span>
      {action && (
        <button
          type="button"
          className="wb-btn wb-btn--light"
          onClick={() => {
            action.onClick()
            onDismiss()
          }}
          style={{ height: 32, padding: '0 12px', fontSize: 13, borderRadius: radius.sm }}
        >
          {action.label}
        </button>
      )}
      <IconButton label="Dismiss" onClick={onDismiss} style={{ color: color.onDarkMuted }}>
        <CloseIcon size={12} />
      </IconButton>
    </div>
  )
}
