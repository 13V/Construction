/**
 * A labelled text input. The label is a real <label>, the hint and the error
 * are tied to the input with aria-describedby, and an error marks the input
 * aria-invalid (web.css draws it red).
 *
 * Labels are the phone's tracked caps ("COMPANY NAME" on its sign-up), the
 * approved Simple design, at desk sizes: 14 px type in a 40 px field.
 *
 *   <Field label="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
 */
import { useId, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react'
import { color, size, space, text } from '../tokens'

export interface FieldChrome {
  label: ReactNode
  /** Under the input, in grey. Replaced by `error` when there is one. */
  hint?: ReactNode
  /** Under the input, in red; also marks the input invalid. */
  error?: ReactNode
  /** Says "Optional" beside the label. */
  optional?: boolean
  /** Hides the label visually; it is still read out. */
  hideLabel?: boolean
  /** On the wrapper, for layout (width, grid placement). */
  style?: CSSProperties
}

/** The label row, the control, and the hint or error. Shared by Field, TextArea, Select and Combobox. */
export function FieldFrame({
  id,
  label,
  hint,
  error,
  optional,
  hideLabel,
  style,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <label htmlFor={id} className={hideLabel ? 'wb-sr-only' : undefined} style={hideLabel ? undefined : { ...text.label, color: color.muted, display: 'flex', alignItems: 'baseline', gap: space.xs }}>
        {label}
        {optional && <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: color.faint }}>Optional</span>}
      </label>
      {children}
      {error ? (
        <div id={`${id}-msg`} role="alert" style={{ ...text.sm, color: color.red }}>
          {error}
        </div>
      ) : hint ? (
        <div id={`${id}-msg`} style={{ ...text.sm, color: color.muted }}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

/** aria wiring for a control inside FieldFrame. */
export function controlAria(id: string, { hint, error }: Pick<FieldChrome, 'hint' | 'error'>, describedBy?: string) {
  const ids = [hint || error ? `${id}-msg` : null, describedBy ?? null].filter(Boolean).join(' ')
  return {
    id,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': ids || undefined,
  }
}

export type FieldProps = FieldChrome & Omit<ComponentPropsWithRef<'input'>, 'style'> & { inputStyle?: CSSProperties }

export function Field({ label, hint, error, optional, hideLabel, style, inputStyle, id: given, className, ...input }: FieldProps) {
  const auto = useId()
  const id = given ?? auto
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} hideLabel={hideLabel} style={style}>
      <input
        {...input}
        {...controlAria(id, { hint, error }, input['aria-describedby'])}
        className={`wb-input${className ? ` ${className}` : ''}`}
        style={{ height: size.control, ...inputStyle }}
      />
    </FieldFrame>
  )
}
