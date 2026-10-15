/**
 * A job's fence as geometry: the circle the crew clock on inside, where its
 * radius handle sits, whether it overlaps another job's, and whether it was
 * ever really placed. Pure, so the map editor (FenceEditor.tsx) and its tests
 * share one set of rules.
 *
 * Distances are true metres on the sphere (geofence/geo.ts, the same maths
 * api/ping.ts clocks people on with), not degrees. A circle drawn in degrees
 * is an oval at Adelaide's latitude, a fifth narrower east to west than it
 * says, and a fence that is not the radius it claims is one the crew cannot
 * trust.
 */
import { DEFAULT_CENTER, distanceM, offset } from '../phone'
import { RADIUS_MAX, RADIUS_MIN, RADIUS_STEP } from '../data/contract'

export interface LatLng {
  lat: number
  lng: number
}

/** A fence: where its pin is and how far it reaches. */
export interface FenceValue extends LatLng {
  radiusM: number
}

/** Another job's fence, drawn faintly behind the one being edited. */
export interface OtherFence extends FenceValue {
  id: string
  /** What the job is listed as: the address line, else the name (the phone's rule). */
  title: string
  name: string
  /** Its rail colour (railOf), so it reads as the same job it is on the board. */
  colour: string
}

// ------------------------------------------------------------------ the pin

/**
 * Coordinates are kept to 6 decimal places, about 11 cm: far finer than any
 * phone's GPS and any 25 m fence, and short enough that what the editor
 * shows is exactly what is saved, digit for digit.
 */
export const COORD_DP = 6

export const roundCoord = (n: number): number => Math.round(n * 10 ** COORD_DP) / 10 ** COORD_DP

/** A point as the editor places it: rounded to COORD_DP. */
export const pointAt = (lat: number, lng: number): LatLng => ({ lat: roundCoord(lat), lng: roundCoord(lng) })

/** "-34.928200, 138.599900": the readout under the map, the same digits that are saved. */
export const formatPoint = (p: LatLng): string => `${p.lat.toFixed(COORD_DP)}, ${p.lng.toFixed(COORD_DP)}`

/**
 * The Adelaide-CBD guard. The map opens on DEFAULT_CENTER, so a pin within
 * this distance of it was most likely never moved there on purpose, and a
 * fence in the wrong suburb means nobody can clock on at the real site. The
 * job page's readiness check (data/readiness.ts UNPLACED_WITHIN_M) uses the
 * same distance; the tests hold the two together.
 */
export const CBD_GUARD_M = 100

export const nearDefaultCentre = (p: LatLng): boolean => distanceM(p, DEFAULT_CENTER) <= CBD_GUARD_M

/**
 * The same pin, to the digit. Kept apart from sameFence because a fence can
 * change without moving: a new radius at the old pin is still the old site.
 */
export const samePoint = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lng === b.lng

export const sameFence = (a: FenceValue | null, b: FenceValue | null): boolean =>
  a === b || (!!a && !!b && samePoint(a, b) && a.radiusM === b.radiusM)

// ------------------------------------------------------------------ radius

/** A whole number of metres the phone's slider can show (25-600). */
export const clampRadius = (m: number): number => Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(m)))

/** A dragged radius, settled onto the slider's 5 m steps. */
export const snapRadius = (m: number): number => clampRadius(Math.round(m / RADIUS_STEP) * RADIUS_STEP)

/**
 * What the radius box holds, if it can be saved: a whole number from 25 to
 * 600. Anything else (blank, "8" on the way to "80", "80.5") is null, and the
 * fence keeps its last good radius until the box says something it can use.
 */
export function parseRadius(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,4}$/.test(t)) return null
  const n = Number(t)
  return n >= RADIUS_MIN && n <= RADIUS_MAX ? n : null
}

/** The radius handle sits due east of the pin, on the circle's edge. */
export const HANDLE_BEARING = 90

export const handlePoint = (centre: LatLng, radiusM: number): LatLng => offset(centre, HANDLE_BEARING, radiusM)

/** The radius a handle dragged to `at` sets: its distance from the pin, on the slider's steps. */
export const radiusFromHandle = (centre: LatLng, at: LatLng): number => snapRadius(distanceM(centre, at))

// ------------------------------------------------------------------ the circle

/** 72 sides: a circle to the eye at any zoom a fence is edited at, and cheap to redraw on every drag frame. */
export const CIRCLE_STEPS = 72

/** The circle as a closed GeoJSON ring of [lng, lat], every vertex `radiusM` true metres from the centre. */
export function circleRing(centre: LatLng, radiusM: number, steps = CIRCLE_STEPS): Array<[number, number]> {
  const ring: Array<[number, number]> = []
  for (let i = 0; i < steps; i++) {
    const p = offset(centre, (360 * i) / steps, radiusM)
    ring.push([p.lng, p.lat])
  }
  ring.push(ring[0])
  return ring
}

export interface CircleFeature<P> {
  type: 'Feature'
  properties: P
  geometry: { type: 'Polygon'; coordinates: Array<Array<[number, number]>> }
}

export interface Collection<P> {
  type: 'FeatureCollection'
  features: Array<CircleFeature<P>>
}

export function circleFeature<P extends object>(fence: FenceValue, properties: P): CircleFeature<P> {
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [circleRing(fence, fence.radiusM)] } }
}

export const collection = <P>(features: Array<CircleFeature<P>>): Collection<P> => ({ type: 'FeatureCollection', features })

/**
 * Where a drawn ring is centred: the mean of its vertices (the closing one
 * not counted twice). How the tests, and the browser rig, check that the
 * circle on the map is drawn round the pin and not round somewhere it used
 * to be.
 */
export function ringCentre(ring: ReadonlyArray<readonly [number, number]>): LatLng {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  let lat = 0
  let lng = 0
  for (const [x, y] of open) {
    lng += x
    lat += y
  }
  return { lat: lat / open.length, lng: lng / open.length }
}

// ------------------------------------------------------------------ overlaps

/**
 * Two fences overlap when their pins are closer than their radii added
 * together. Inside both circles api/ping.ts clocks a person on to whichever
 * job's pin is nearer, which is rarely what anyone meant.
 */
export const overlaps = (a: FenceValue, b: FenceValue): boolean => distanceM(a, b) < a.radiusM + b.radiusM

/** The other jobs this fence overlaps, nearest first. */
export function overlapping<T extends FenceValue>(fence: FenceValue, others: ReadonlyArray<T>): Array<T & { apartM: number }> {
  return others
    .map((o) => ({ ...o, apartM: distanceM(fence, o) }))
    .filter((o) => o.apartM < fence.radiusM + o.radiusM)
    .sort((a, b) => a.apartM - b.apartM)
}

// ------------------------------------------------------------------ framing

/** [[west, south], [east, north]], the shape maplibre's fitBounds takes. */
export type Bounds = [[number, number], [number, number]]

/** The box that holds every fence whole, circles and all; null for none. */
export function boundsOf(fences: ReadonlyArray<FenceValue>): Bounds | null {
  if (fences.length === 0) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const f of fences) {
    const north = offset(f, 0, f.radiusM)
    const south = offset(f, 180, f.radiusM)
    const east = offset(f, 90, f.radiusM)
    const west = offset(f, 270, f.radiusM)
    n = Math.max(n, north.lat)
    s = Math.min(s, south.lat)
    e = Math.max(e, east.lng)
    w = Math.min(w, west.lng)
  }
  return [
    [w, s],
    [e, n],
  ]
}
