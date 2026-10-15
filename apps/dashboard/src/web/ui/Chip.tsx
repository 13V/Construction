/**
 * A small status pill, in the phone's own chip colours: red for defects and
 * overdue flood tests, amber for variations waiting, green for done, a quiet
 * grey for everything else.
 *
 * `bg` and `fg` take a chip's colours as the phone's rules return them (the
 * attention chip's chipOf), so the website shows the same chip, not a near
 * match.
 */
import type { ReactNode } from 'react'
import { color } from '../tokens'

export type ChipTone = 'neutral' | 'dark' | 'red' | 'amber' | 'green' | 'outline'

const TONES: Record<ChipTone, { bg: string; fg: string; border?: string }> = {
  neutral: { bg: color.fill, fg: color.body },
  dark: { bg: color.inkDeep, fg: color.onDark },
  red: { bg: color.redFill, fg: color.red },
  amber: { bg: color.amberFill, fg: color.amber },
  green: { bg: color.greenFill, fg: color.green },
  outline: { bg: 'transparent', fg: color.body, border: color.border },
}

export interface ChipProps {
  children: ReactNode
  tone?: ChipTone
  bg?: string
  fg?: string
  /** A dot before the label, in the text colour. */
  dot?: boolean
  size?: 'sm' | 'md'
  title?: string
}

export function Chip({ children, tone = 'neutral', bg, fg, dot = false, size = 'md', title }: ChipProps) {
  const t = TONES[tone]
  const h = size === 'sm' ? 20 : 22
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: h,
        maxWidth: '100%',
        padding: size === 'sm' ? '0 7px' : '0 8px',
        boxSizing: 'border-box',
        borderRadius: h / 2,
        background: bg ?? t.bg,
        border: t.border ? `1px solid ${t.border}` : undefined,
        color: fg ?? t.fg,
        fontSize: size === 'sm' ? 11.5 : 12,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flex: 'none',
      }}
    >
      {dot && <span aria-hidden="true" style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />}
      {children}
    </span>
  )
}
