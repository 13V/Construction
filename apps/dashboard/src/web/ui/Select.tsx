/**
 * A labelled native <select>. Native on purpose: the keyboard, type-to-find
 * and the screen reader all come with it, and the list is the operating
 * system's own. For a list that also takes free text (a builder's name), use
 * Combobox.
 *
 *   <Select label="Captain" value={id} onChange={(e) => setId(e.target.value)}
 *     placeholder="No captain" options={captains.map((w) => ({ value: w.id, label: w.name }))} />
 */
import { useId, type ComponentPropsWithRef, type CSSProperties } from 'react'
import { size } from '../tokens'
import { controlAria, FieldFrame, type FieldChrome } from './Field'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export type SelectProps = FieldChrome &
  Omit<ComponentPropsWithRef<'select'>, 'style'> & {
    options?: SelectOption[]
    /** A first, empty-valued option ("Choose…", "No captain"). */
    placeholder?: string
    inputStyle?: CSSProperties
  }

export function Select({ label, hint, error, optional, hideLabel, style, inputStyle, id: given, className, options, placeholder, children, ...select }: SelectProps) {
  const auto = useId()
  const id = given ?? auto
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} hideLabel={hideLabel} style={style}>
      <select
        {...select}
        {...controlAria(id, { hint, error }, select['aria-describedby'])}
        className={`wb-input wb-input--select${className ? ` ${className}` : ''}`}
        style={{ height: size.control, ...inputStyle }}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </FieldFrame>
  )
}
