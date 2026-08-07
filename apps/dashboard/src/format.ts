/**
 * Money formatting, in one place.
 *
 * The app is sold into Australian builders, so an amount that renders as
 * "US$0" is wrong in a way an owner notices immediately. Locale and currency
 * are set explicitly rather than inherited from the browser, so the same
 * figure reads the same on every machine and in the payroll export.
 */
const LOCALE = 'en-AU'
export const CURRENCY = (import.meta.env.VITE_CURRENCY as string) || 'AUD'

const whole = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
})
const cents = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
})

/** Rounded to the dollar — for totals and stat tiles. */
export const money = (n: number) => whole.format(Number.isFinite(n) ? n : 0)

/** To the cent — for line items, rates and anything reconciled against an invoice. */
export const money2 = (n: number) => cents.format(Number.isFinite(n) ? n : 0)

/**
 * Dates, in one place, for the same reason money is.
 *
 * These were previously left to the browser: `toLocaleDateString()` with no
 * locale renders 8/6/2026 on a US-configured machine and 6/8/2026 on an
 * Australian one. For an invoice due date that ambiguity is not cosmetic, so
 * the locale is pinned the way the currency already was.
 */
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
const weekdayDay = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })
const timeOnly = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' })

/** Accepts a Date, an epoch, an ISO timestamp, or a bare `2026-08-06` date. */
function asDate(v: Date | number | string): Date {
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(v)
  // A bare date has no timezone; parsing it as UTC shifts it a day in Adelaide.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v)
}

/** "6 Aug" — the default for anything inside the current year. */
export const shortDate = (v: Date | number | string) => dayMonth.format(asDate(v))

/** "6 Aug 2026" — when the year matters, like an issued or due date. */
export const fullDate = (v: Date | number | string) => dayMonthYear.format(asDate(v))

/** "Thu 6 Aug" — for day columns and log headings. */
export const dayDate = (v: Date | number | string) => weekdayDay.format(asDate(v))

/** "3:40 pm" */
export const clockTime = (v: Date | number | string) => timeOnly.format(asDate(v))
