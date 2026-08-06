import type { CostCode } from '../types'

/**
 * Static configuration. Crew and job sites are real records in Supabase —
 * see `useLive` — but cost codes are a fixed chart shared by every company
 * until per-company codes are worth building.
 */
export const costCodes: CostCode[] = [
  { code: '01-100', name: 'General Conditions' },
  { code: '03-300', name: 'Concrete' },
  { code: '06-100', name: 'Rough Carpentry' },
  { code: '06-200', name: 'Finish Carpentry' },
  { code: '15-400', name: 'Plumbing' },
  { code: '16-100', name: 'Electrical' },
]

/** Fallback map centre before any job site exists (Brisbane CBD). */
export const DEFAULT_CENTER = { lat: -27.4698, lng: 153.0251 }

/**
 * OpenFreeMap tiles: no API key, no request cap, commercial use allowed.
 * "positron" is the light desaturated style, closest to the app palette.
 * Self-hostable if the public instance ever becomes a reliability concern —
 * see MAPS.md.
 */
export const MAP_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string) ||
  'https://tiles.openfreemap.org/styles/positron'
