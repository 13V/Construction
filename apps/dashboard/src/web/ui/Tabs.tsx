/**
 * A row of tabs: the job page's Overview · Scope · Drawings · Waterproofing ·
 * Safety · Crew.
 *
 * Tabs with an `href` are links, so each tab has its own address (Back works,
 * a tab can be opened in a new window). Tabs without one are buttons that
 * call onChange.
 *
 * Keyboard, per the ARIA tabs pattern with manual activation: Tab lands on
 * the current tab, the arrow keys (and Home, End) move between tabs, Enter or
 * Space opens the one with focus. Moving focus does not load anything, so
 * arrowing past four tabs does not fetch four tabs.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { linkProps } from '../router'
import { color, space, text } from '../tokens'

export interface TabItem<T extends string> {
  key: T
  label: ReactNode
  href?: string
  /** A small number after the label. */
  count?: number
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange?: (key: T) => void
  /** What the tabs switch between, for a screen reader. */
  label: string
  /** The id of the element the tabs control. */
  panelId?: string
  /** Colours for a dark band, such as the job header. */
  onDark?: boolean
}

export function Tabs<T extends string>({ items, value, onChange, label, panelId, onDark = false }: TabsProps<T>) {
  const row = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(row.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
    const at = tabs.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    let to = -1
    if (e.key === 'ArrowRight') to = (at + 1) % tabs.length
    else if (e.key === 'ArrowLeft') to = (at - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = tabs.length - 1
    else if (e.key === ' ' && tabs[at].tagName === 'A') {
      // Space presses a button but scrolls the page on a link; make it open the tab.
      e.preventDefault()
      tabs[at].click()
      return
    }
    if (to < 0) return
    e.preventDefault()
    tabs[to].focus()
  }

  return (
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ display: 'flex', alignItems: 'stretch', gap: space.lg, height: 48, overflowX: 'auto', scrollbarWidth: 'none' }}
    >
      {items.map((t) => {
        const on = t.key === value
        const common = {
          role: 'tab',
          'aria-selected': on,
          'aria-controls': panelId,
          tabIndex: on ? 0 : -1,
          className: 'wb-tab',
          style: { flex: 'none', ...text.base, ...(onDark ? { color: on ? color.onDark : color.railText, borderBottomColor: on ? color.onDark : 'transparent' } : null) },
        } as const
        const inner = (
          <>
            {t.label}
            {t.count !== undefined && <span style={{ ...text.xs, fontWeight: 600, color: onDark ? color.onDarkMuted : color.muted }}>{t.count}</span>}
          </>
        )
        if (t.href) {
          const nav = linkProps(t.href)
          return (
            <a
              key={t.key}
              {...common}
              href={nav.href}
              aria-current={on ? 'page' : undefined}
              onClick={(e) => {
                onChange?.(t.key)
                nav.onClick(e)
              }}
            >
              {inner}
            </a>
          )
        }
        return (
          <button key={t.key} type="button" {...common} onClick={() => onChange?.(t.key)}>
            {inner}
          </button>
        )
      })}
    </div>
  )
}
