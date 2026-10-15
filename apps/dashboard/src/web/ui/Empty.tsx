/**
 * What a page or a panel shows when there is nothing in it yet, said as what
 * to do next: "Set up your first job", not "No data".
 *
 * Extra props (data-*, id) land on the outer element.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { color, radius, space, text } from '../tokens'

export interface EmptyProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  children?: ReactNode
  /** A button or link: the next step. */
  action?: ReactNode
  /** A small drawing above the title. */
  icon?: ReactNode
  /** Less padding, for inside a card or a tab. */
  compact?: boolean
}

export function Empty({ title, children, action, icon, compact = false, style, ...rest }: EmptyProps) {
  return (
    <div
      {...rest}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: space.xs,
        padding: compact ? `${space.xl}px ${space.lg}px` : `${space.xxxl}px ${space.xl}px`,
        background: color.panel,
        border: `1px solid ${color.borderSoft}`,
        borderRadius: radius.lg,
        ...style,
      }}
    >
      {icon && <div style={{ marginBottom: space.xs, color: color.ghost }}>{icon}</div>}
      <div style={{ ...text.md, fontWeight: 600, color: color.ink }}>{title}</div>
      {children && <div style={{ maxWidth: 440, ...text.base, color: color.body }}>{children}</div>}
      {action && <div style={{ marginTop: space.sm }}>{action}</div>}
    </div>
  )
}
