/**
 * The site's clock and calendar, for the functions.
 *
 * Vercel runs in UTC; the crews are in Adelaide, 9.5 hours ahead of UTC in
 * winter and 10.5 in daylight time. Anything a function writes for a person
 * to read, and any calendar day an app hands it, means Adelaide.
 *
 * The zone is fixed rather than per-company because everything else in the
 * app is already pinned to en-AU and AUD; it becomes a companies column the
 * day the product is sold outside this timezone.
 */
export const SITE_TIME_ZONE = 'Australia/Adelaide'

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: SITE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** How far the site's wall clock is ahead of UTC at instant `t`, in ms. */
function offsetAt(t: number): number {
  const parts = wallClock.formatToParts(new Date(t))
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
  return wall - Math.floor(t / 1000) * 1000
}

/** The instant the site's wall clock reads 00:00 on the given day. */
function midnight(year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day)
  // Start from the offset at the same wall time read as UTC, then correct it
  // with the offset at the answer itself — they differ only when a daylight
  // saving change falls between the two, and Adelaide's changes happen at 2
  // and 3 am, never at midnight, so the second pass is exact.
  let t = wall - offsetAt(wall)
  for (let i = 0; i < 3; i++) {
    const next = wall - offsetAt(t)
    if (next === t) break
    t = next
  }
  return t
}

/**
 * The start and end of one calendar day at the site, as instants: [start, end).
 * `date` is YYYY-MM-DD, the way the apps send a local day (src/data/localDay.ts).
 * Usually 24 hours apart; 23 on the first Sunday of October, when the clocks go
 * forward, and 25 on the first Sunday of April, when they go back.
 *
 * Null for anything that is not a real date, so 2026-02-30 is refused rather
 * than rolled over into March.
 */
export function siteDay(date: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const asGiven = new Date(Date.UTC(year, month - 1, day))
  if (asGiven.getUTCFullYear() !== year || asGiven.getUTCMonth() !== month - 1 || asGiven.getUTCDate() !== day) {
    return null
  }
  const following = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    start: new Date(midnight(year, month, day)),
    end: new Date(midnight(following.getUTCFullYear(), following.getUTCMonth() + 1, following.getUTCDate())),
  }
}
