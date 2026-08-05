/**
 * Palette lifted from the Fieldwire (by Hilti) production stylesheets.
 * See STYLE-REFERENCE.md at the repo root for where each value came from.
 */
export const theme = {
  appBg: '#F5F6F7',
  panel: '#FFFFFF',
  ink: '#1A1D21',
  inkSoft: '#696D74',
  inkFaint: '#A3A9AF',
  border: '#DCE0E6',
  accent: '#007BFF',
  accentFill: '#E7F1FF',
  rail: '#2B2F33',
  railSoft: '#3F454B',
  ctaFrom: '#F7B244',
  ctaTo: '#FFCD11',
  alert: '#D2051E',
  success: '#28A745',
  warning: '#FFC107',
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
  traveling: 'Traveling',
  exception: 'Needs review',
  off: 'Off',
}

export const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
