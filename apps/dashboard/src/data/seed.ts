import type { CostCode, JobSite, Worker } from '../types'

/**
 * Demo seed data. Coordinates sit across Brisbane's inner north so the map
 * renders real streets — move the whole set by editing the `center` values.
 * Everything else in the app is driven from here.
 */

export const jobSites: JobSite[] = [
  {
    id: 'maple-ridge',
    name: 'Maple Ridge',
    address: '4412 Sandgate Rd, Nundah QLD',
    jobType: 'Custom home — framing',
    status: 'active',
    center: { lat: -27.4055, lng: 153.049 },
    radiusM: 152, // 500 ft
  },
  {
    id: 'northgate-plaza',
    name: 'Northgate Plaza',
    address: '1900 Toombul Rd, Northgate QLD',
    jobType: 'Tenant improvement',
    status: 'active',
    center: { lat: -27.3905, lng: 153.0715 },
    radiusM: 122, // 400 ft
  },
  {
    id: 'harbor-view-3b',
    name: 'Harbor View 3B',
    address: '88 Kingsford Smith Dr, Hamilton QLD',
    jobType: 'Condo remodel',
    status: 'active',
    center: { lat: -27.439, lng: 153.07 },
    radiusM: 107, // 350 ft
  },
  {
    id: 'city-line-storage',
    name: 'City Line Storage',
    address: '7715 Nudgee Rd, Hendra QLD',
    jobType: 'Slab & site work',
    status: 'starting_soon',
    center: { lat: -27.418, lng: 153.064 },
    radiusM: 122, // 400 ft
  },
]

export const workers: Worker[] = [
  { id: 'miguel', name: 'Miguel Ortiz', initials: 'MO', trade: 'Foreman', rate: 68 },
  { id: 'danny', name: 'Danny Whitfield', initials: 'DW', trade: 'Framer', rate: 54 },
  { id: 'rosa', name: 'Rosa Delgado', initials: 'RD', trade: 'Finish carpenter', rate: 58 },
  { id: 'tre', name: 'Tre Coleman', initials: 'TC', trade: 'Laborer', rate: 42 },
  { id: 'sam', name: 'Sam Nguyen', initials: 'SN', trade: 'Electrician', rate: 62 },
  { id: 'bobby', name: 'Bobby Kaminski', initials: 'BK', trade: 'Equipment operator', rate: 56 },
  { id: 'alicia', name: 'Alicia Moreno', initials: 'AM', trade: 'Drywall', rate: 52 },
]

export const costCodes: CostCode[] = [
  { code: '01-100', name: 'General Conditions' },
  { code: '03-300', name: 'Concrete' },
  { code: '06-100', name: 'Rough Carpentry' },
  { code: '06-200', name: 'Finish Carpentry' },
  { code: '15-400', name: 'Plumbing' },
  { code: '16-100', name: 'Electrical' },
]

export const siteById = (id: string | null): JobSite | undefined =>
  id ? jobSites.find((s) => s.id === id) : undefined

/** Centre of the four sites — where the map opens. */
export const mapCenter = {
  lat: jobSites.reduce((sum, s) => sum + s.center.lat, 0) / jobSites.length,
  lng: jobSites.reduce((sum, s) => sum + s.center.lng, 0) / jobSites.length,
}
