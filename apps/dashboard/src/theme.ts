/**
 * Palette measured from design/screens/*.html — the 21 exported screens are the
 * source of truth, not this file. Counts below are occurrences across all 21.
 *
 * Two values here were wrong before and are worth calling out, because code
 * written against them looks subtly off against the design:
 *   inkFaint was #A3A9AF, which appears exactly ONCE in the whole corpus. The
 *   real muted-label grey is #8B9096, which appears 199 times.
 *   The CTA was rendered `linear-gradient(90deg, ctaFrom, ctaTo)` with no
 *   border. The design uses 180deg, the opposite stop order, and a 1px
 *   #E0A032 border — 24 times, with no exceptions.
 */
export const theme = {
  appBg: '#F5F6F7', //  53
  panel: '#FFFFFF', //  28
  ink: '#1A1D21', // 136
  inkMid: '#4A5057', //  70 — body text one step down from ink
  inkSoft: '#696D74', // 187
  inkFaint: '#8B9096', // 199 — uppercase labels, captions, meta
  inkGhost: '#B7BCC2', //  16 — placeholder text only
  border: '#DCE0E6', // 336
  borderSoft: '#EDEFF1', //  48 — table row dividers
  rowFill: '#FAFBFC', //  40 — table header background
  fill: '#F1F3F5', //  34 — muted chips, inactive bubbles
  accent: '#007BFF', //  89
  accentFill: '#E7F1FF', //  15
  rail: '#2B2F33', //  33
  railSoft: '#3F454B', //  31
  alert: '#D2051E', //  41
  alertInk: '#A00417', //  12 — red text on a tint
  alertFill: '#FDECEE', //  10
  success: '#28A745', //  32
  successInk: '#1B7A2C', //  11
  successFill: '#EAF7EC', //   7
  warning: '#FFC107', //   9
  warnInk: '#8A6100', //  22
  warnFill: '#FFF9E8', //  10
  warnBorder: '#F0DCA8', //   9
  /**
   * The one primary button treatment. Always paired with ctaBorder. The raw
   * stops are deliberately not exported: every hand-rolled gradient in this
   * codebase had the wrong angle, the wrong stop order, or no border.
   */
  cta: 'linear-gradient(180deg, #FFCD11, #F7B244)',
  ctaBorder: '#E0A032',
  /** Flat brand yellow, for fills that aren't buttons (geofence draft). */
  brandYellow: '#FFCD11', //  32
} as const

/** Status ring colours for worker markers and roster dots. */
export const statusColor: Record<string, string> = {
  on_clock: theme.success,
  arriving: theme.accent,
  traveling: theme.warning,
  exception: theme.alert,
  off: theme.inkFaint,
}

export const statusLabel: Record<string, string> = {
  on_clock: 'On the clock',
  arriving: 'Arriving',
  traveling: 'Travelling',
  exception: 'Needs review',
  off: 'Off',
}

export const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
