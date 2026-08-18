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
  /**
   * Black, on the client's instruction — "make the purple black", the same
   * call he made on the chat bubbles. The design shipped with #6E56CF and the
   * app wore it until he saw it on a phone in daylight.
   *
   * A shade darker than `ink` so a link still separates from body text: the
   * weight and the icon do most of that work, and this finishes it.
   */
  accent: '#0B0D10',

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

/**
 * How a job identifies itself everywhere it is listed: where it is, and who
 * it is for. The client asked for these two facts and no others — a trade
 * name and a percentage told a foreman nothing he could act on.
 *
 * The state and postcode come off because a phone header has no room for
 * them and nobody reads a job by its postcode.
 */
export const addressLine = (site: { name?: string; address: string | null }) => {
  const line = (site.address ?? '').replace(/,?\s*(SA|NSW|VIC|QLD|WA|NT|TAS|ACT)\s*\d{4}\s*$/i, '').trim()
  // A job named after its address has nothing to add by repeating it.
  return site.name && line.toLowerCase() === site.name.trim().toLowerCase() ? '' : line
}

/** The builder we are under. Blank until somebody sets it on the job. */
export const builderOf = (site: { client_name: string | null }) => (site.client_name ?? '').trim()

/**
 * The street on its own, for somewhere too narrow to hold the rest — a
 * programme tile is 144px and an ellipsised suburb is worse than no suburb.
 * The suburb is usually in the job's name anyway, which is what makes the
 * street the half worth keeping.
 */
export const streetLine = (site: { name?: string; address: string | null }) => {
  const line = addressLine(site)
  if (!line) return ''
  const street = line.split(',')[0]!.trim()
  return site.name && street.toLowerCase() === site.name.trim().toLowerCase() ? '' : street
}

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
