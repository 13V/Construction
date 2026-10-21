/**
 * Small pieces the Chat page and a job's Chat tab share: a job's tile and a
 * person's circle as the phone's chat draws them, and the icons.
 */
import { railOf } from '../phone'
import { jobInit, personTone } from '../data/chat'
import { color } from '../tokens'

/** A job's tile: its rail colour and its initials ("L42"), as the phone's chat list draws it. */
export function JobTile({ site, size = 40 }: { site: { id: string; name: string; colour?: string | null }; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: railOf(site),
        color: color.onDark,
        fontSize: size >= 40 ? 13 : 12,
        fontWeight: 700,
        letterSpacing: '-.01em',
        overflow: 'hidden',
      }}
    >
      {jobInit(site.name)}
    </span>
  )
}

/** A person's circle: their initials on their grey, as the phone's direct messages draw it. */
export function PersonCircle({ id, initials, size = 40 }: { id: string; initials: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: personTone(id),
        color: color.onDark,
        fontSize: size >= 40 ? 13 : 12,
        fontWeight: 700,
        letterSpacing: '-.01em',
      }}
    >
      {initials || '?'}
    </span>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** The phone's compose glyph: a bubble with a plus. */
export function ComposeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...stroke} strokeWidth="1.8">
      <path d="M3 4.5h14v9h-8l-4 3.5v-3.5h-2z" />
      <path d="M10 6.6v4.4M7.8 8.8h4.4" />
    </svg>
  )
}

/** A speech bubble, for the empty thread. */
export function BubbleIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...stroke} strokeWidth="1.3">
      <path d="M3 4.5h14v9h-8l-4 3.5v-3.5h-2z" />
    </svg>
  )
}

/** The phone's camera key. */
export function CameraIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...stroke} strokeWidth="1.6">
      <path d="M2.6 6.2h3.1l1.3-1.9h6l1.3 1.9h3.1v9.6H2.6z" />
      <circle cx="10" cy="10.8" r="3" />
    </svg>
  )
}

/** The phone's send arrow. */
export function SendIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...stroke} strokeWidth="2.2">
      <path d="M10 16V4M4.8 9.2 10 4l5.2 5.2" />
    </svg>
  )
}

/** A document, for a file in a thread. */
export function FileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...stroke} strokeWidth="1.6">
      <path d="M4.5 2.5h7l4 4v11h-11z" />
      <path d="M11.5 2.5v4h4" />
    </svg>
  )
}

export function BackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" {...stroke} strokeWidth="1.8">
      <path d="M8.5 3L4.5 7l4 4" />
    </svg>
  )
}
