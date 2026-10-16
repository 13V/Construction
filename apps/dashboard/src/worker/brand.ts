/**
 * The name on the door.
 *
 * The App Store listing is "Proven - For Tilers" and the icon on the phone
 * says "Proven"; App Review rejected 1.0 under 2.3.8 when the sign-in screen
 * said "Crewline" underneath it. The product is still Crewline — the domain,
 * the privacy policy — and says so as "Powered by Crewline".
 *
 * The website is Proven too (web/marker.ts), and it hosts these screens:
 * the Team page's add form tells the office what the new person downloads,
 * which is the app called Proven. So a build without VITE_BRAND (the
 * website's, on Vercel) is Proven as well. ios-testflight.yml still sets it,
 * and Vite folds import.meta.env to a literal at build time either way.
 */
export const BRAND: string = import.meta.env.VITE_BRAND || 'Proven'

/** True when the phone is wearing somebody else's name and should say whose. */
export const WHITE_LABELLED = BRAND !== 'Crewline'
