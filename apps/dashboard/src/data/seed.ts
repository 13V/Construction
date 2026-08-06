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
