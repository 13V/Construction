/**
 * Where the map opens, and where its tiles come from.
 *
 * These two constants live in their own leaf module — with no imports of their
 * own — so that a lazily-loaded map screen does not drag anything else in with
 * it. They used to sit in data/seed.ts alongside the cost-code table, which
 * startup code reads; that shared import was enough for the bundler to put
 * maplibre-gl (900 kB of it) in the same chunk the app loads before it can
 * show anybody their day.
 */

/** Where the map opens before any job site exists. */
export const DEFAULT_CENTER = { lat: -34.9282, lng: 138.5999 } // Adelaide CBD

/**
 * OpenFreeMap tiles: no API key, no request cap, commercial use allowed.
 * "positron" is the light desaturated style, closest to the app palette.
 * Self-hostable if the public instance ever becomes a reliability concern —
 * see MAPS.md.
 */
export const MAP_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string) ||
  'https://tiles.openfreemap.org/styles/positron'
