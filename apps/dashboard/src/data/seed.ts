import type { CostCode } from '../types'

/**
 * Static configuration. Crew and job sites are real records in Supabase —
 * see `useLive` — but cost codes are a fixed chart shared by every company
 * until per-company codes are worth building.
 */
export const costCodes: CostCode[] = [
  { code: '01-100', name: 'Preliminaries' },
  { code: '01-540', name: 'Plant & Equipment Hire' },
  { code: '02-100', name: 'Site Prep & Excavation' },
  { code: '02-200', name: 'Demolition' },
  { code: '03-200', name: 'Reinforcement' },
  { code: '03-300', name: 'Concrete' },
  { code: '03-450', name: 'Precast & Tilt-up' },
  { code: '05-120', name: 'Structural Steel' },
  { code: '05-310', name: 'Steel Decking' },
  { code: '06-100', name: 'Rough Carpentry' },
  { code: '06-110', name: 'Framing Timber' },
  { code: '06-200', name: 'Finish Carpentry' },
  { code: '06-400', name: 'Decking & External Timber' },
  { code: '07-140', name: 'Waterproofing' },
  { code: '07-210', name: 'Insulation' },
  { code: '07-410', name: 'Roofing & Cladding' },
  { code: '08-520', name: 'Windows & External Doors' },
  { code: '09-250', name: 'Plasterboard & Linings' },
  { code: '09-310', name: 'Tiling' },
  { code: '15-400', name: 'Plumbing' },
  { code: '15-410', name: 'Plumbing Fixtures' },
  { code: '16-100', name: 'Electrical' },
]

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
