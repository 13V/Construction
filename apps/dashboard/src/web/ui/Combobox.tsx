/**
 * A text input with a list of suggestions under it: the builder picker
 * ("Paramount", or a new name nobody has typed before).
 *
 * The text is the value. Typing filters the list; ArrowDown and ArrowUp move
 * through it, Enter picks the highlighted one, Esc closes the list (and only
 * the list, when it is open inside a dialog or a drawer). Free text is kept
 * as typed: picking is a convenience, not a requirement, unless `strict`.
 *
 * It follows the ARIA 1.2 combobox pattern, so a screen reader hears the
 * list, the count and the highlighted option.
 *
 *   <Combobox label="Builder" value={builder} onChange={setBuilder}
 *     options={builders.map((b) => ({ value: b.id, label: b.name, detail: `${b.jobs} jobs` }))}
 *     onPick={(o) => setBuilderId(o.value)} />
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { color, radius, shadow, size, space, text, z } from '../tokens'
import { controlAria, FieldFrame, type FieldChrome } from './Field'

export interface ComboOption {
  value: string
  label: string
  /** Grey, to the right: "4 jobs", "Captain". */
  detail?: string
}

export interface ComboboxProps extends FieldChrome {
  value: string
  onChange: (text: string) => void
  options: ComboOption[]
  /** Called when an option is chosen (click or Enter); onChange gets its label too. */
  onPick?: (option: ComboOption) => void
  placeholder?: string
  /** Shown in the list when nothing matches. Omit to close the list instead. */
  emptyText?: ReactNode
  /** Only a listed option may be chosen; leaving the field with other text clears it. */
  strict?: boolean
  /** The most rows shown before the list scrolls. */
  maxRows?: number
  disabled?: boolean
  required?: boolean
  autoFocus?: boolean
  name?: string
  id?: string
  inputStyle?: CSSProperties
}

const norm = (v: string) => v.trim().toLowerCase()

export function Combobox({
  label,
  hint,
  error,
  optional,
  hideLabel,
  style,
  value,
  onChange,
  options,
  onPick,
  placeholder,
  emptyText,
  strict = false,
  maxRows = 8,
  disabled,
  required,
  autoFocus,
  name,
  id: given,
  inputStyle,
}: ComboboxProps) {
  const auto = useId()
  const id = given ?? auto
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const list = useRef<HTMLUListElement>(null)

  // Everything when the text is empty or exactly an option; otherwise the
  // options containing what was typed, those starting with it first.
  const shown = useMemo(() => {
    const q = norm(value)
    if (!q || options.some((o) => norm(o.label) === q)) return options
    const hits = options.filter((o) => norm(o.label).includes(q))
    return [...hits.filter((o) => norm(o.label).startsWith(q)), ...hits.filter((o) => !norm(o.label).startsWith(q))]
  }, [value, options])

  const showList = open && !disabled && (shown.length > 0 || emptyText !== undefined)

  useEffect(() => {
    if (!showList || active < 0) return
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, showList])

  const pick = (o: ComboOption) => {
    onChange(o.label)
    onPick?.(o)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(e.key === 'ArrowDown' ? 0 : shown.length - 1)
        return
      }
      if (shown.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length))
    } else if (e.key === 'Enter') {
      // Only claim Enter when it picks something; otherwise it submits the form as usual.
      if (showList && active >= 0 && shown[active]) {
        e.preventDefault()
        pick(shown[active])
      }
    } else if (e.key === 'Escape') {
      if (showList) {
        // Close the list, not the dialog or drawer this sits in.
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setActive(-1)
      }
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const onBlur = () => {
    setOpen(false)
    setActive(-1)
    if (strict && value && !options.some((o) => norm(o.label) === norm(value))) onChange('')
  }

  const rowH = 36
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} hideLabel={hideLabel} style={style}>
      <div style={{ position: 'relative' }}>
        <input
          {...controlAria(id, { hint, error })}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          name={name}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className="wb-input"
          style={{ height: size.control, ...inputStyle }}
        />
        {showList && (
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={typeof label === 'string' ? label : undefined}
            className="wb-listbox wb-anim-fade"
            // Keep focus in the input while the pointer is on the list.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: z.popover,
              maxHeight: rowH * maxRows + 8,
              overflowY: 'auto',
              margin: 0,
              padding: 4,
              listStyle: 'none',
              background: color.panel,
              border: `1px solid ${color.border}`,
              borderRadius: radius.md,
              boxShadow: shadow.pop,
            }}
          >
            {shown.length === 0 ? (
              <li style={{ padding: `${space.xs}px ${space.sm}px`, ...text.sm, color: color.muted }}>{emptyText}</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o.value}
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className="wb-option"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  style={{ display: 'flex', alignItems: 'center', gap: space.sm, minHeight: rowH, padding: `0 ${space.sm}px`, borderRadius: radius.sm, ...text.base, color: color.ink }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {o.detail && <span style={{ flex: 'none', ...text.sm, color: color.muted }}>{o.detail}</span>}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </FieldFrame>
  )
}
