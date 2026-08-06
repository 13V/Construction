import type { LatLng } from '../types.js'

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Linear interpolation between two points. `t` runs 0..1. */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  }
}

/** Point `distance` metres from `origin` along `bearing` degrees. */
export function offset(origin: LatLng, bearing: number, distance: number): LatLng {
  const d = distance / EARTH_RADIUS_M
  const br = toRad(bearing)
  const lat1 = toRad(origin.lat)
  const lng1 = toRad(origin.lng)

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    )

  return { lat: toDeg(lat2), lng: toDeg(lng2) }
}

/** Total length in metres of a path, used to pace the simulated feed. */
export function pathLengthM(path: LatLng[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) total += distanceM(path[i - 1], path[i])
  return total
}

/** Position at `t` (0..1) along a multi-segment path. */
export function pointAlongPath(path: LatLng[], t: number): LatLng {
  if (path.length === 0) throw new Error('pointAlongPath: empty path')
  if (path.length === 1) return path[0]

  const clamped = Math.min(Math.max(t, 0), 1)
  const target = pathLengthM(path) * clamped

  let travelled = 0
  for (let i = 1; i < path.length; i++) {
    const seg = distanceM(path[i - 1], path[i])
    if (travelled + seg >= target) {
      const within = seg === 0 ? 0 : (target - travelled) / seg
      return lerp(path[i - 1], path[i], within)
    }
    travelled += seg
  }
  return path[path.length - 1]
}
