/** Build-time configuration. Missing Maps credentials degrade rather than block. */
export const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || ''

/** Advanced Markers require a Map ID; DEMO_MAP_ID is fine for development. */
export const MAPS_MAP_ID =
  (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string) || 'DEMO_MAP_ID'

export const mapsConfigured = MAPS_API_KEY.length > 0
