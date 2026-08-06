/**
 * Demo mode: sign in automatically so the app can be handed to someone to try
 * without an account.
 *
 * This is NOT an auth bypass. Every RLS policy keys off the signed-in worker
 * row, so bypassing auth would mean disabling RLS — and the anon key ships in
 * the browser bundle, so that would expose the whole database to anyone with
 * the URL. Instead a real account signs in behind the scenes and every policy
 * still applies to it.
 *
 * The trade-off is still real: the demo password is in the client bundle, so
 * anyone with the URL reaches that company's data. Fine for a test site,
 * never for real crew. Clear VITE_DEMO_EMAIL in Vercel to require login again.
 */
export const DEMO_EMAIL = (import.meta.env.VITE_DEMO_EMAIL as string) || ''
export const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string) || ''
export const demoMode = Boolean(DEMO_EMAIL && DEMO_PASSWORD)
