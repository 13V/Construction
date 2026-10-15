import { describe, expect, it } from 'vitest'
import { RADIUS_MAX, RADIUS_MIN, RADIUS_STEP } from '../data/contract'
import { UNPLACED_WITHIN_M } from '../data/readiness'
import { DEFAULT_CENTER, distanceM, offset } from '../phone'
import {
  boundsOf,
  CBD_GUARD_M,
  CIRCLE_STEPS,
  circleFeature,
  circleRing,
  clampRadius,
  formatPoint,
  handlePoint,
  nearDefaultCentre,
  overlapping,
  overlaps,
  parseRadius,
  pointAt,
  radiusFromHandle,
  ringCentre,
  roundCoord,
  sameFence,
  samePoint,
  snapRadius,
  type FenceValue,
} from './fenceGeometry'
import { hitsOf, splitLabel } from './geocode'

/** Moseley Square, Glenelg: a real spot at Adelaide's latitude, where a degree of longitude is a fifth short. */
const GLENELG = { lat: -34.98042, lng: 138.51367 }
const ll = ([lng, lat]: readonly [number, number]) => ({ lat, lng })

describe('the circle', () => {
  it('is closed, and every vertex is the radius away from the pin in true metres', () => {
    for (const r of [RADIUS_MIN, 80, 150, RADIUS_MAX]) {
      const ring = circleRing(GLENELG, r)
      expect(ring).toHaveLength(CIRCLE_STEPS + 1)
      expect(ring[ring.length - 1]).toEqual(ring[0])
      for (const v of ring) expect(Math.abs(distanceM(GLENELG, ll(v)) - r)).toBeLessThan(0.01)
    }
  })

  it('is round, not an oval: as wide east to west as north to south', () => {
    const ring = circleRing(GLENELG, 300)
    const lats = ring.map((v) => v[1])
    const lngs = ring.map((v) => v[0])
    const ns = distanceM({ lat: Math.max(...lats), lng: GLENELG.lng }, { lat: Math.min(...lats), lng: GLENELG.lng })
    const ew = distanceM({ lat: GLENELG.lat, lng: Math.max(...lngs) }, { lat: GLENELG.lat, lng: Math.min(...lngs) })
    expect(ns).toBeCloseTo(600, 0)
    expect(ew).toBeCloseTo(600, 0)
  })

  it('is centred on the pin it was drawn from, not anywhere it was before (no stale circle)', () => {
    const first = circleFeature({ ...DEFAULT_CENTER, radiusM: 150 }, { colour: '#4C7FB8' })
    const moved = circleFeature({ ...GLENELG, radiusM: 80 }, { colour: '#4C7FB8' })
    expect(distanceM(ringCentre(moved.geometry.coordinates[0]), GLENELG)).toBeLessThan(0.05)
    expect(distanceM(ringCentre(first.geometry.coordinates[0]), DEFAULT_CENTER)).toBeLessThan(0.05)
    expect(moved.properties).toEqual({ colour: '#4C7FB8' })
    expect(moved.geometry.type).toBe('Polygon')
  })

  it('ringCentre counts the closing vertex once', () => {
    expect(ringCentre([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual({ lat: 1, lng: 1 })
    expect(ringCentre([[0, 0], [2, 0], [2, 2], [0, 2]])).toEqual({ lat: 1, lng: 1 })
  })
})

describe('the radius', () => {
  it('is the phone slider: 25 to 600 m in steps of 5', () => {
    expect([RADIUS_MIN, RADIUS_MAX, RADIUS_STEP]).toEqual([25, 600, 5])
  })

  it('snaps a dragged handle onto the steps, within range', () => {
    expect(snapRadius(118)).toBe(120)
    expect(snapRadius(122.4)).toBe(120)
    expect(snapRadius(122.5)).toBe(125)
    expect(snapRadius(3)).toBe(25)
    expect(snapRadius(5000)).toBe(600)
    expect(clampRadius(80.4)).toBe(80)
    expect(clampRadius(-1)).toBe(25)
  })

  it('reads the number box only when it holds a whole number in range', () => {
    expect(parseRadius('80')).toBe(80)
    expect(parseRadius(' 120 ')).toBe(120)
    expect(parseRadius('25')).toBe(25)
    expect(parseRadius('600')).toBe(600)
    // On the way to "80": not yet a radius, so nothing changes.
    expect(parseRadius('8')).toBeNull()
    expect(parseRadius('')).toBeNull()
    expect(parseRadius('601')).toBeNull()
    expect(parseRadius('24')).toBeNull()
    expect(parseRadius('80.5')).toBeNull()
    expect(parseRadius('-80')).toBeNull()
    expect(parseRadius('1e2')).toBeNull()
  })

  it('puts the handle due east on the circle, and reads a dragged handle back as the radius', () => {
    const h = handlePoint(GLENELG, 120)
    expect(distanceM(GLENELG, h)).toBeCloseTo(120, 3)
    expect(h.lat).toBeCloseTo(GLENELG.lat, 6)
    expect(h.lng).toBeGreaterThan(GLENELG.lng)
    expect(radiusFromHandle(GLENELG, h)).toBe(120)
    // Dragged anywhere round the circle, not only east, the distance is what counts.
    expect(radiusFromHandle(GLENELG, offset(GLENELG, 200, 241))).toBe(240)
    expect(radiusFromHandle(GLENELG, GLENELG)).toBe(25)
  })
})

describe('the pin', () => {
  it('is kept to 6 decimal places, so the readout is exactly what is saved', () => {
    const p = pointAt(-34.98123456789, 138.50012345678)
    expect(p).toEqual({ lat: -34.981235, lng: 138.500123 })
    expect(formatPoint(p)).toBe('-34.981235, 138.500123')
    expect(Number(formatPoint(p).split(', ')[0])).toBe(p.lat)
    expect(roundCoord(138.5)).toBe(138.5)
    expect(formatPoint({ lat: -34.98, lng: 138.46 })).toBe('-34.980000, 138.460000')
  })

  it('within 100 m of where the map opens counts as never placed, the same distance as the job page', () => {
    expect(CBD_GUARD_M).toBe(UNPLACED_WITHIN_M)
    expect(nearDefaultCentre(DEFAULT_CENTER)).toBe(true)
    expect(nearDefaultCentre(offset(DEFAULT_CENTER, 45, 99))).toBe(true)
    expect(nearDefaultCentre(offset(DEFAULT_CENTER, 45, 101))).toBe(false)
    expect(nearDefaultCentre(GLENELG)).toBe(false)
  })

  it('compares fences by pin and radius', () => {
    expect(sameFence({ ...GLENELG, radiusM: 80 }, { ...GLENELG, radiusM: 80 })).toBe(true)
    expect(sameFence({ ...GLENELG, radiusM: 80 }, { ...GLENELG, radiusM: 85 })).toBe(false)
    expect(sameFence({ ...GLENELG, radiusM: 80 }, { ...GLENELG, lat: GLENELG.lat + 0.000001, radiusM: 80 })).toBe(false)
    expect(sameFence(null, null)).toBe(true)
    expect(sameFence(null, { ...GLENELG, radiusM: 80 })).toBe(false)
  })

  it('compares pins alone: a new radius at the same pin has not moved it', () => {
    const was: FenceValue = { ...GLENELG, radiusM: 330 }
    const now: FenceValue = { ...GLENELG, radiusM: 335 }
    expect(samePoint(was, now)).toBe(true)
    expect(sameFence(was, now)).toBe(false)
    expect(samePoint(GLENELG, { ...GLENELG, lng: GLENELG.lng + 0.000001 })).toBe(false)
    expect(samePoint(GLENELG, { ...GLENELG, lat: GLENELG.lat - 0.000001 })).toBe(false)
  })
})

describe('overlaps', () => {
  const at = (m: number) => ({ ...offset(GLENELG, 90, m), radiusM: 0 })

  it('is pins closer than the two radii added together', () => {
    const a = { ...GLENELG, radiusM: 100 }
    expect(overlaps(a, { ...at(200), radiusM: 150 })).toBe(true)
    expect(overlaps(a, { ...at(200), radiusM: 50 })).toBe(false)
    // Touching is not overlapping: nowhere is inside both.
    expect(overlaps(a, { ...at(250), radiusM: 149.9 })).toBe(false)
    expect(overlaps(a, { ...at(250), radiusM: 150.1 })).toBe(true)
  })

  it('lists the jobs a fence overlaps, nearest first, with how far apart', () => {
    const others = [
      { id: 'far', title: 'Far', name: 'Far', colour: '#4C7FB8', ...at(2000), radiusM: 150 },
      { id: 'b', title: 'B', name: 'B', colour: '#4C7FB8', ...at(300), radiusM: 250 },
      { id: 'a', title: 'A', name: 'A', colour: '#4C7FB8', ...at(100), radiusM: 25 },
    ]
    const hit = overlapping({ ...GLENELG, radiusM: 100 }, others)
    expect(hit.map((o) => o.id)).toEqual(['a', 'b'])
    expect(hit[0].apartM).toBeCloseTo(100, 3)
    expect(overlapping({ ...GLENELG, radiusM: 25 }, [])).toEqual([])
  })
})

describe('framing', () => {
  it('holds every fence whole', () => {
    const fences = [
      { ...GLENELG, radiusM: 150 },
      { lat: -35.0284495300373, lng: 138.542467125803, radiusM: 150 },
    ]
    const b = boundsOf(fences)!
    const [[w, s], [e, n]] = b
    for (const f of fences) {
      for (const bearing of [0, 90, 180, 270]) {
        const edge = offset(f, bearing, f.radiusM)
        expect(edge.lat).toBeGreaterThanOrEqual(s - 1e-12)
        expect(edge.lat).toBeLessThanOrEqual(n + 1e-12)
        expect(edge.lng).toBeGreaterThanOrEqual(w - 1e-12)
        expect(edge.lng).toBeLessThanOrEqual(e + 1e-12)
      }
    }
    expect(boundsOf([])).toBeNull()
  })
})

describe('geocode replies', () => {
  it('keeps usable hits, once each', () => {
    const body = {
      results: [
        { label: 'Moseley Square, Glenelg, Adelaide, South Australia, 5045, Australia', lat: -34.9804, lng: 138.5137 },
        { label: 'Same spot again', lat: -34.9804, lng: 138.5137 },
        { label: '', lat: -34.9, lng: 138.5 },
        { label: 'No coordinates', lat: 'x', lng: 138.5 },
        { label: 'Off the planet', lat: 123, lng: 138.5 },
        { label: 'Jetty Road, Glenelg', lat: '-34.9806', lng: '138.5150' },
      ],
    }
    expect(hitsOf(body)).toEqual([
      { label: 'Moseley Square, Glenelg, Adelaide, South Australia, 5045, Australia', lat: -34.9804, lng: 138.5137 },
      { label: 'Jetty Road, Glenelg', lat: -34.9806, lng: 138.515 },
    ])
    expect(hitsOf(null)).toEqual([])
    expect(hitsOf({ error: 'nope' })).toEqual([])
  })

  it('names a hit by its place, with the house number back in front of the street', () => {
    expect(splitLabel('1, Moseley Square, Glenelg, Adelaide, City of Holdfast Bay, South Australia, 5045, Australia')).toEqual({
      head: '1 Moseley Square',
      rest: 'Glenelg, Adelaide, City of Holdfast Bay, South Australia, 5045',
    })
    expect(splitLabel('Moseley Square, Glenelg, Adelaide, South Australia, 5045, Australia')).toEqual({
      head: 'Moseley Square',
      rest: 'Glenelg, Adelaide, South Australia, 5045',
    })
    expect(splitLabel('12a, Jetty Road, Glenelg')).toEqual({ head: '12a Jetty Road', rest: 'Glenelg' })
    expect(splitLabel('Glenelg')).toEqual({ head: 'Glenelg', rest: '' })
  })
})
