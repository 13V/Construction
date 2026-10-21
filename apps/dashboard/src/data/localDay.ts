/**
 * The calendar day an instant falls on where the phone is, as YYYY-MM-DD.
 *
 * Not toISOString().slice(0, 10): that is the day in UTC, and Adelaide is
 * 9.5 to 10.5 hours ahead of UTC, so until mid-morning UTC still says
 * yesterday. A cost entered at 8 am, or a photo taken at 7:30 am, would be
 * filed under the day before.
 */
export function localDay(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
