/**
 * Tokens for the Simple design — measured from design/mobile/simple/
 * Crewline-Simple.dc.html, not invented. Counts are occurrences in that file.
 *
 * This deliberately does not replace src/theme.ts: the office dashboard keeps
 * the old system. The phone gets this one. Where both files name the same hex
 * (ink, border, appBg) that is the design reusing the existing system, not a
 * coincidence to "fix".
 */
export const s = {
  /** The accent is a prop in the design, default #6E56CF. Purple, not blue —
   *  the Crewline blue is present in the design only as a non-chosen option,
   *  and the client's instruction is exact-as-drawn. */
  accent: '#6E56CF',

  appBg: '#F5F6F7', // ×23
  panel: '#FFFFFF', // ×34
  ink: '#1A1D21', // ×79
  /** The dark chrome — job header, calendar card. One step past ink. */
  inkDeep: '#14171A', // ×16
  charcoal: '#2B2F33', // ×19
  body: '#4A5057', // ×43
  /** THE muted grey of this design (×61). Readable in sun; the old #8B9096
   *  (×25 here) survives only in genuinely decorative roles. */
  muted: '#7B838B',
  faint: '#8B9096',
  ghost: '#B7BCC2', // ×20
  border: '#DCE0E6', // ×48
  borderSoft: '#EDEFF1', // ×31
  rowFill: '#FAFBFC', // ×21
  fill: '#F1F3F5',

  /** Status. The deep red is this design's alert (×19) — not the office
   *  dashboard's #D2051E. */
  red: '#A3282E',
  redFill: '#FDECEE',
  green: '#1F7A4D', // ×16
  greenFill: '#EAF7EC',
  amber: '#8A6100', // ×19
  amberFill: '#FFF9E8',

  /** On-dark text for the charcoal surfaces. */
  onDark: '#FFFFFF',
  onDarkMuted: '#8A929B', // ×15
  onDarkFaint: '#5B6169', // ×15
} as const

/** The drawing's rail palette — the swatches its New-project form offers. */
export const JOB_COLOURS = ['#4C7FB8', '#5C8A63', '#A5714A', '#8B8375', '#6E7B86']

export function jobColour(siteId: string): string {
  let h = 0
  for (let i = 0; i < siteId.length; i++) h = (h * 31 + siteId.charCodeAt(i)) >>> 0
  return JOB_COLOURS[h % JOB_COLOURS.length]
}

/**
 * A job's rail: the colour somebody chose for it, or the hash when nobody
 * has. Everything that draws a job edge, bar or tile goes through this.
 */
export function railOf(site: { id: string; colour?: string | null }): string {
  return site.colour || jobColour(site.id)
}

/** The drawing's avatar greys — stacks cycle these so heads stay separable. */
export const AV_GREYS = ['#2B2F33', '#4A5057', '#696D74', '#7B838B']
export const avatarGrey = (i: number) => AV_GREYS[i % AV_GREYS.length]

export const sFont =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'

/**
 * Tickets — one rule, read the same on the Crew tab and on Me. Green means
 * they hold it, red that they do not: a lapsed ticket is red for the same
 * reason a missing one is, because on the day it matters they cannot do the
 * work. Anything inside its last thirty days stays green and says how long
 * is left, which is a warning while it is still theirs.
 */
export const TICKET_HELD = { bg: '#EAF7EC', fg: '#1B7A2C' }
export const TICKET_MISSING = { bg: '#FDECEE', fg: '#A3282E' }
export const CERT_WARN_DAYS = 30

export function ticketTone(expiresOn: string | null): { bg: string; fg: string; suffix: string } {
  if (!expiresOn) return { ...TICKET_HELD, suffix: '' }
  const days = Math.round((new Date(`${expiresOn}T00:00:00`).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { ...TICKET_MISSING, suffix: ' · lapsed' }
  if (days <= CERT_WARN_DAYS) return { ...TICKET_HELD, suffix: ` · ${days}d left` }
  return { ...TICKET_HELD, suffix: '' }
}

/**
 * The phone's own reserved edges — the notch / Dynamic Island above, the
 * home indicator below. Zero on the web; real on a device once the viewport
 * is viewport-fit=cover. Every fixed top and bottom surface adds these so
 * the drawing's 52px header means 52px BELOW the status bar, not under it.
 */
export const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
export const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
