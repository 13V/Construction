/**
 * What the website calls itself, and the string that proves a bundle is the
 * website.
 *
 * WEB_MARKER is on the website's root element (WebApp's data-web-root). Every
 * website build carries it and a phone build never may: the phone-fingerprint
 * workflow and ios-testflight.yml both grep the iOS bundle for it, so finding
 * it there means website code leaked into the app.
 *
 * The name is the client's, the same as the App Store listing and the icon on
 * the crew's phones: "Proven", with "Powered by Crewline" underneath, exactly
 * as the phone's sign-in says it. The website keeps its own copy rather than
 * reading src/worker/brand.ts, because that file ships to iOS (where BRAND is
 * set at build time by VITE_BRAND) and a website change must never touch it.
 */
export const WEB_MARKER = 'crewline-web-surface'

/** The name on the door: the browser tab, the rail, the sign-in. */
export const WEB_BRAND = 'Proven'

/** The product underneath, said once and small. */
export const WEB_POWERED_BY = 'Powered by Crewline'

/**
 * The website's root element, where dialogs, drawers and toasts are portalled.
 *
 * Portalling into the root rather than document.body keeps them inside the
 * root's custom properties (tokens.ts cssVars), which web.css reads; and out
 * of any Contained host, whose transform would otherwise trap a fixed panel
 * inside it. The body is the fallback for anything rendered outside WebApp.
 */
export function webRoot(): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-web-root="${WEB_MARKER}"]`) ?? document.body
}
