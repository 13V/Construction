/**
 * The name on the door.
 *
 * The App Store listing is "Proven - For Tilers" and the icon on the phone
 * says "Proven"; App Review rejected 1.0 under 2.3.8 when the sign-in screen
 * said "Crewline" underneath it. The product is still Crewline — the domain,
 * the privacy policy, the office dashboard — so the phone wears the client's
 * name and the browser keeps the product's.
 *
 * VITE_BRAND is set by ios-testflight.yml and nowhere else. Vite folds
 * import.meta.env to a literal at build time, so a build without it is
 * Crewline with no runtime check and nothing to misconfigure.
 */
export const BRAND: string = import.meta.env.VITE_BRAND || 'Crewline'

/** True when the phone is wearing somebody else's name and should say whose. */
export const WHITE_LABELLED = BRAND !== 'Crewline'
