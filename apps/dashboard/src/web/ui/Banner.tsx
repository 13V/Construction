/**
 * A message across the top of a page or a form: something did not save,
 * something needs a decision, something went right.
 *
 * Errors are announced as alerts (role="alert"); the rest politely
 * (role="status"), so a screen reader is not interrupted by good news.
 */
import type { ReactNode } from 'react'
import { color, radius, space, text } from '../tokens'
import { CloseIcon, IconButton } from './Button'

export type BannerTone = 'info' | 'warn' | 'error' | 'success'

const TONES: Record<BannerTone, { bg: string; fg: string; edge: string }> = {
  info: { bg: color.panel, fg: color.ink, edge: color.border },
  warn: { bg: color.amberFill, fg: color.amber, edge: color.amberEdge },
  error: { bg: color.redFill, fg: color.red, edge: color.redEdge },
  success: { bg: color.greenFill, fg: color.green, edge: color.greenEdge },
}

export interface BannerProps {
  tone?: BannerTone
  title?: ReactNode
  children?: ReactNode
  /** A button or link on the right: Retry, Mark active. */
  action?: ReactNode
  onDismiss?: () => void
}

export function Banner({ tone = 'info', title, children, action, onDismiss }: BannerProps) {
  const t = TONES[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm, padding: `${space.sm}px ${space.md}px`, background: t.bg, border: `1px solid ${t.edge}`, borderRadius: radius.md }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
        {title && <div style={{ ...text.base, fontWeight: 600, color: t.fg }}>{title}</div>}
        {children && <div style={{ ...text.sm, color: tone === 'info' ? color.body : t.fg }}>{children}</div>}
      </div>
      {action && <div style={{ flex: 'none', alignSelf: 'center' }}>{action}</div>}
      {onDismiss && (
        <IconButton label="Dismiss" size={28} onClick={onDismiss} style={{ color: t.fg }}>
          <CloseIcon size={12} />
        </IconButton>
      )}
    </div>
  )
}
