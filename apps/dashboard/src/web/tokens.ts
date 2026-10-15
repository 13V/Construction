/**
 * The website's design tokens: the phone's Simple design (worker/simple/
 * stheme.ts, the approved visual language) plus what a desk needs that a
 * phone does not.
 *
 * The phone's palette comes through unchanged, so `color.ink` here is the
 * same hex as `s.ink` on the phone. What this adds:
 *  - states a pointer and a keyboard need (hover, pressed, the focus ring),
 *    which the phone never had because inline styles cannot express them
 *  - an 8 px spacing scale, a 12/13/14/16/21/24 type scale, radii 8/10/12
 *  - desktop sizes: a 232 px rail, 40 px nav items, 44-52 px table rows,
 *    1144 px pages with 32 px gutters
 *  - z-index layers, so a drawer, a dialog over it and a toast over both
 *    stack the same way everywhere
 *
 * The phone's 16 px inputs and 56 px buttons are iOS anti-zoom and thumb
 * sizing; a desk gets 14 px and 40 px.
 *
 * Kept in src/web rather than appended to stheme.ts so website work never
 * edits a file that ships to iOS.
 */
import type { CSSProperties } from 'react'
import { s, sFont } from './phone'

/** The system font stack the phone uses. */
export const font = sFont

/** The phone's palette, plus interaction states. */
export const color = {
  ...s,
  /** A row or a quiet button under the pointer. */
  hover: s.fill,
  /** The same, held down. */
  pressed: '#E7EAED',
  /** The keyboard focus ring on light surfaces: the ink itself, 2 px. */
  focus: s.ink,
  /** The halo round a focused input (SignIn.tsx's ring, a touch stronger for a desk). */
  focusHalo: 'rgba(26,29,33,.14)',
  /** The focus ring on the charcoal rail. */
  focusOnDark: s.onDark,
  /** Behind a dialog or a drawer. */
  scrim: 'rgba(16,20,24,.44)',
  /** The charcoal button under the pointer: one step lighter, as the phone's busy state is. */
  primaryHover: s.charcoal,
  dangerHover: '#8C2227',
  /** Placeholder text, as on the phone's sign-in. */
  placeholder: '#A5ABB2',
  /** Rail text that is not the current page. */
  railText: '#B7BCC2',
  // Hover is a whisper and the current page a clear step brighter, so the
  // pointer resting on an item never reads as being on that page.
  railHover: 'rgba(255,255,255,.045)',
  railActive: 'rgba(255,255,255,.14)',
  railRule: 'rgba(255,255,255,.09)',
  /** Hairline edges for the tinted status fills (a banner's border). */
  redEdge: '#F4C9CE',
  amberEdge: '#F1DFAE',
  greenEdge: '#BFE3CB',
  /** Red on charcoal: the dot on the phone's dark notification card. */
  redOnDark: '#E5484D',
  /** The app icon's blue tile. Used in the mark and nowhere else. */
  iconBlue: '#007bff',
} as const

/** The 8 px spacing scale, with the 4 px half step dense rows need. */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 } as const

/**
 * The type scale. Each entry spreads into an inline style. `title` is the
 * phone's page title ("Projects": 21/600, -.015em); `label` is its tracked
 * caps section label ("NOTIFICATIONS").
 */
export const text = {
  xs: { fontSize: 12, lineHeight: '16px' },
  sm: { fontSize: 13, lineHeight: '18px' },
  base: { fontSize: 14, lineHeight: '20px' },
  md: { fontSize: 16, lineHeight: '22px' },
  title: { fontSize: 21, lineHeight: '28px', fontWeight: 600, letterSpacing: '-.015em' },
  display: { fontSize: 24, lineHeight: '30px', fontWeight: 600, letterSpacing: '-.02em' },
  label: { fontSize: 12, lineHeight: '16px', fontWeight: 700, letterSpacing: '.11em', textTransform: 'uppercase' },
} as const satisfies Record<string, CSSProperties>

export const radius = { sm: 8, md: 10, lg: 12, pill: 999 } as const

/** Desktop sizes. */
export const size = {
  rail: 232,
  /** Widest a page gets; at 1440 this plus two gutters is exactly what the rail leaves. */
  page: 1144,
  gutter: 32,
  header: 64,
  navItem: 40,
  control: 40,
  controlSm: 32,
  controlLg: 44,
  row: 44,
  rowTall: 52,
  /** Right-hand panels such as Needs attention. */
  side: 312,
  /** The New job form column, and drawers. */
  form: 480,
  dialog: 440,
} as const

/** Below `stack`, side panels go under the main column; below `narrow`, the rail becomes a top bar. */
export const bp = { stack: 1024, narrow: 768 } as const

/**
 * Stacking layers. The phone's FileViewer sits at 95, above all of these,
 * because a file opened from inside a dialog must cover it. A Contained host
 * is its own stacking context, so the phone panels' own z-indexes stay in it.
 */
export const z = { sticky: 10, rail: 20, popover: 30, drawer: 60, dialog: 70, toast: 90 } as const

export const shadow = {
  card: '0 1px 2px rgba(16,20,24,.05)',
  pop: '0 10px 28px rgba(16,20,24,.16), 0 1px 3px rgba(16,20,24,.08)',
  modal: '0 24px 64px rgba(16,20,24,.30)',
  /** The phone's charcoal call to action. */
  button: '0 2px 6px rgba(16,20,24,.18)',
} as const

/**
 * The colours web.css needs, as custom properties on the website's root.
 *
 * web.css cannot import this file, and repeating hex there would let the two
 * drift; so WebApp sets these on its root element and every rule in web.css
 * reads var(--wb-*). They inherit into a Contained host too, where nothing
 * reads them.
 */
export const cssVars = {
  '--wb-ink': color.ink,
  '--wb-ink-deep': color.inkDeep,
  '--wb-charcoal': color.charcoal,
  '--wb-body': color.body,
  '--wb-muted': color.muted,
  '--wb-ghost': color.ghost,
  '--wb-border': color.border,
  '--wb-border-soft': color.borderSoft,
  '--wb-row-fill': color.rowFill,
  '--wb-fill': color.fill,
  '--wb-panel': color.panel,
  '--wb-app-bg': color.appBg,
  '--wb-accent': color.accent,
  '--wb-red': color.red,
  '--wb-red-fill': color.redFill,
  '--wb-on-dark': color.onDark,
  '--wb-hover': color.hover,
  '--wb-pressed': color.pressed,
  '--wb-focus': color.focus,
  '--wb-focus-halo': color.focusHalo,
  '--wb-focus-on-dark': color.focusOnDark,
  '--wb-primary-hover': color.primaryHover,
  '--wb-danger-hover': color.dangerHover,
  '--wb-placeholder': color.placeholder,
  '--wb-rail-text': color.railText,
  '--wb-rail-hover': color.railHover,
  '--wb-rail-active': color.railActive,
  '--wb-shadow-card': shadow.card,
  '--wb-shadow-button': shadow.button,
  '--wb-rail-w': `${size.rail}px`,
  '--wb-side-w': `${size.side}px`,
} as CSSProperties
