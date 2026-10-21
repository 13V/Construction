/**
 * The public demo's login. "Try the demo" (api/demo.ts) signs anybody who
 * taps it into this one owner account, so anything it can do, everybody can.
 *
 * Not the App Review account: App Review signs into appstore.review@crewline.app,
 * a separate tenant this never names.
 */
export const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'appreview@crewline.app'

/** True for the demo login, whatever the letter case. */
export function isDemoAccount(email: string | null | undefined): boolean {
  return typeof email === 'string' && email !== '' && email.toLowerCase() === DEMO_EMAIL.toLowerCase()
}
