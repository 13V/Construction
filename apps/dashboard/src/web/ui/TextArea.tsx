/**
 * A labelled multi-line input: notes, addresses, what was chosen. Grows by
 * dragging its corner (vertical only, so it never breaks a column). Enter is
 * a new line here, so a form holding one still submits with its button, or
 * with Cmd/Ctrl+Enter where the form wires that up.
 */
import { useId, type ComponentPropsWithRef, type CSSProperties } from 'react'
import { controlAria, FieldFrame, type FieldChrome } from './Field'

export type TextAreaProps = FieldChrome & Omit<ComponentPropsWithRef<'textarea'>, 'style'> & { inputStyle?: CSSProperties }

export function TextArea({ label, hint, error, optional, hideLabel, style, inputStyle, id: given, className, rows = 3, ...area }: TextAreaProps) {
  const auto = useId()
  const id = given ?? auto
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} hideLabel={hideLabel} style={style}>
      <textarea
        rows={rows}
        {...area}
        {...controlAria(id, { hint, error }, area['aria-describedby'])}
        className={`wb-input wb-input--multi${className ? ` ${className}` : ''}`}
        style={inputStyle}
      />
    </FieldFrame>
  )
}
