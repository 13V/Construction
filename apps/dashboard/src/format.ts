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
