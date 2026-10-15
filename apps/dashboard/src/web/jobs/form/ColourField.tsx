/**
 * The job's colour: the rail it wears on the board, on the crew's Projects
 * list and down the side of every schedule bar, on both surfaces.
 *
 * Five swatches, the phone's own JOB_COLOURS, and nothing else: railOf() on
 * the phone draws whatever is stored, but only these five were designed to
 * sit side by side on the schedule. A new job starts on the one the fewest
 * live jobs wear (useJobForm leastUsedColour), so two jobs on one site
 * week rarely share a rail.
 *
 * A job made on the phone has no colour of its own: the phone hashes its id
 * into one of the five. That is shown as a sixth choice, "Automatic", picked,
 * so editing such a job leaves it exactly as it was unless somebody picks a
 * colour on purpose.
 *
 * A radio group underneath (as Segmented is): Tab lands on the chosen one,
 * the arrow keys move the choice.
 */
import { useId, useRef, type KeyboardEvent } from 'react'
import { JOB_COLOURS } from '../../phone'
import { color, radius, space, text } from '../../tokens'

/** What each swatch is called, for a screen reader and the tooltip. */
const NAMES: Record<string, string> = {
  '#4C7FB8': 'Blue',
  '#5C8A63': 'Green',
  '#A5714A': 'Clay',
  '#8B8375': 'Stone',
  '#6E7B86': 'Slate',
}

export interface ColourFieldProps {
  /** One of JOB_COLOURS, or null for the phone's automatic colour. */
  value: string | null
  onChange: (next: string | null) => void
  /** The colour the phone works out when the job has none (railOf), offered only for a job that has none. */
  automatic: string | null
  /** Live jobs per colour, for the tooltip. */
  counts: Map<string, number>
  error?: string
}

const AUTO = 'auto'

export function ColourField({ value, onChange, automatic, counts, error }: ColourFieldProps) {
  const id = useId()
  const group = useRef<HTMLDivElement>(null)
  // The stored colour when it is not one of the five (set by the old dashboard): kept, and shown, until changed.
  const custom = value && !JOB_COLOURS.includes(value) ? value : null
  const options: Array<{ key: string; hex: string; label: string }> = [
    ...JOB_COLOURS.map((hex) => ({ key: hex, hex, label: NAMES[hex] ?? hex })),
    ...(custom ? [{ key: custom, hex: custom, label: 'Current colour' }] : []),
    ...(automatic ? [{ key: AUTO, hex: automatic, label: 'Automatic' }] : []),
  ]
  const chosen = value === null ? AUTO : value

  const choose = (key: string) => onChange(key === AUTO ? null : key)
  const move = (to: number) => {
    const next = options[(to + options.length) % options.length]!
    choose(next.key)
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-colour="${CSS.escape(next.key)}"]`)?.focus())
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = options.findIndex((o) => o.key === chosen)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(at - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(options.length - 1)
    else return
    e.preventDefault()
  }

  const used = (key: string) => {
    if (key === AUTO) return 'Worked out by the phone from the job, as it is now'
    const n = counts.get(key) ?? 0
    return n === 0 ? 'No live job uses it' : `${n} live job${n === 1 ? '' : 's'} use${n === 1 ? 's' : ''} it`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span id={`${id}-label`} style={{ ...text.label, color: color.muted }}>
        Colour
      </span>
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-msg`}
        onKeyDown={onKeyDown}
        data-colour-field=""
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}
      >
        {options.map((o) => {
          const on = o.key === chosen
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${o.label}${o.key === AUTO ? '' : ` ${o.hex}`}`}
              title={`${o.label} · ${used(o.key)}`}
              tabIndex={on ? 0 : -1}
              data-colour={o.key}
              className="wb-focus"
              onClick={() => choose(o.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 36,
                padding: o.key === AUTO ? '0 10px 0 4px' : 4,
                border: `1.5px solid ${on ? color.ink : color.border}`,
                borderRadius: radius.pill,
                background: color.panel,
                cursor: 'pointer',
                font: 'inherit',
                ...text.sm,
                color: color.body,
              }}
            >
              <span
                aria-hidden="true"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: o.hex }}
              >
                {on && (
                  <svg width="14" height="14" viewBox="0 0 16 16">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {o.key === AUTO && 'Automatic'}
            </button>
          )
        })}
      </div>
      <div id={`${id}-msg`} role={error ? 'alert' : undefined} style={{ ...text.sm, color: error ? color.red : color.muted }}>
        {error ??
          (value === null
            ? 'The phone picks this colour from the job itself. Pick one to fix it.'
            : 'The rail on the board, the schedule and the crew’s Projects list.')}
      </div>
    </div>
  )
}
