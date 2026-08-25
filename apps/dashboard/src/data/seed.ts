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

// DEFAULT_CENTER and MAP_STYLE_URL used to live here. They are in
// data/mapconfig.ts now, imported directly by the two screens that draw a map.
// Deliberately NOT re-exported from this file: this module is on the startup
// path, and one re-export was enough of an edge for the bundler to load 900 kB
// of maplibre-gl before the app could show anybody their day.
