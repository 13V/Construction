/**
 * One choice from a few, side by side: Active · Future · Archived on the
 * board, Future or Active now on a new job.
 *
 * A radio group underneath: Tab lands on the chosen one, the arrow keys move
 * the choice (and take focus with it), Home and End jump to the ends.
 *
 *   <Segmented label="Show" value={tab} onChange={setTab}
 *     options={[{ value: 'active', label: 'Active', count: 3 }, …]} />
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { color, radius, text } from '../tokens'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  /** A number after the label, as on the phone's Active projects / Future projects tabs. */
  count?: number
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  /** What the group is, for a screen reader. */
  label: string
  size?: 'sm' | 'md'
  /** Stretch to the container, segments sharing the width. */
  block?: boolean
}

export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', block = false }: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null)
  const h = size === 'sm' ? 28 : 34

  const move = (to: number) => {
    const next = options[(to + options.length) % options.length]
    onChange(next.value)
    // Focus follows the choice, as in any radio group.
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = options.findIndex((o) => o.value === value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(at - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(options.length - 1)
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ display: block ? 'flex' : 'inline-flex', gap: 2, padding: 3, background: color.fill, borderRadius: radius.md }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className="wb-seg-item"
            style={{ flex: block ? 1 : 'none', height: h, padding: size === 'sm' ? '0 10px' : '0 14px', ...(size === 'sm' ? text.sm : text.base) }}
          >
            {o.label}
            {o.count !== undefined && (
              <span style={{ minWidth: 18, padding: '0 5px', borderRadius: 9, background: on ? color.fill : 'transparent', fontSize: 12, fontWeight: 600, lineHeight: '18px', color: on ? color.ink : color.muted }}>
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
