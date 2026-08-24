/**
 * Putting a job's geofence somewhere other than where you are standing.
 *
 * A new project used to centre its fence on the phone's current position, and
 * that is right exactly once — when you happen to be at the site the moment
 * you create it. Every other time (three jobs written up on a Sunday night, a
 * site across town you have only quoted) it dropped the fence on the wrong
 * suburb. A fence in the wrong suburb is not a cosmetic problem: nobody can
 * clock on, so the job records no hours at all and the failure shows up a week
 * later as a missing timesheet.
 *
 * So: type the address, tap Search, and the map goes there — or pan it by hand
 * if the search cannot find a brand-new estate that OpenStreetMap has not
 * heard of yet, which for new builds is often. The pin is fixed at the centre
 * of the frame and the map moves underneath it, because dragging a small
 * target with the thumb that is covering it is the worse of the two gestures
 * on a phone.
 *
 * MapLibre with OpenFreeMap tiles, the same as the office dashboard's map:
 * no API key, no billing account, no request cap.
 */
import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from '../../data/supabase'
import { api } from '../../data/api'
import { DEFAULT_CENTER, MAP_STYLE_URL } from '../../data/seed'
import { s } from './stheme'

setWorkerUrl(maplibreWorkerUrl)

export interface FenceValue {
  lat: number
  lng: number
  radiusM: number
}

interface Hit {
  label: string
  lat: number
  lng: number
}

const CIRCLE_SOURCE = 'fence'

/** A circle as a polygon, in degrees. Same maths as the dashboard's map. */
function circle(lat: number, lng: number, radiusM: number, steps = 72) {
  const coords: Array<[number, number]> = []
  // A degree of latitude is ~111.32 km everywhere; a degree of longitude
  // shrinks by cos(latitude), which at Adelaide's -35 is a fifth narrower.
  // Ignoring that draws an oval and, worse, a fence that is not the radius it
  // says it is.
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    coords.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)])
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [coords] } }
}

export function FencePicker({
  value,
  address,
  onChange,
}: {
  value: FenceValue | null
  address: string
  onChange: (v: FenceValue) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const [radius, setRadius] = useState(value?.radiusM ?? 150)
  const [centre, setCentre] = useState<{ lat: number; lng: number }>(
    value ? { lat: value.lat, lng: value.lng } : DEFAULT_CENTER,
  )
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [located, setLocated] = useState(false)

  // The parent only ever hears about a finished value, never a frame of the
  // pan — this is the one place the two are stitched together.
  useEffect(() => {
    onChange({ lat: centre.lat, lng: centre.lng, radiusM: radius })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre.lat, centre.lng, radius])

  useEffect(() => {
    if (!host.current || map.current) return
    const m = new MapLibreMap({
      container: host.current,
      style: MAP_STYLE_URL,
      center: [centre.lng, centre.lat],
      zoom: 15,
      attributionControl: { compact: true },
    })
    map.current = m
    m.on('load', () => {
      m.addSource(CIRCLE_SOURCE, { type: 'geojson', data: circle(centre.lat, centre.lng, radius) })
      m.addLayer({ id: 'fence-fill', type: 'fill', source: CIRCLE_SOURCE, paint: { 'fill-color': '#1A73E8', 'fill-opacity': 0.14 } })
      m.addLayer({ id: 'fence-line', type: 'line', source: CIRCLE_SOURCE, paint: { 'line-color': '#1A73E8', 'line-width': 2 } })
    })
    // `moveend`, not `move`: redrawing the circle on every animation frame of
    // a pan is what makes a map feel like it is fighting you.
    m.on('moveend', () => {
      const c = m.getCenter()
      setCentre({ lat: c.lat, lng: c.lng })
    })
    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the drawn circle in step with the pin and the slider.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const src = m.getSource(CIRCLE_SOURCE)
    if (src && 'setData' in src) (src as { setData: (d: unknown) => void }).setData(circle(centre.lat, centre.lng, radius))
  }, [centre.lat, centre.lng, radius])

  /** Open on the phone's own position the first time, if it is willing. */
  useEffect(() => {
    if (value || located || !('geolocation' in navigator)) return
    setLocated(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.current?.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 })
        setCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        // Declined or unavailable. The map stays on Adelaide and the address
        // search is the way in — no error worth showing for this.
      },
      { enableHighAccuracy: false, timeout: 8000 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function search() {
    const q = address.trim()
    if (q.length < 3) {
      setNote('Type the site address above first.')
      return
    }
    setSearching(true)
    setNote(null)
    setHits(null)
    try {
      const { data } = await supabase().auth.getSession()
      const token = data.session?.access_token
      const r = await fetch(`${api('/api/geocode')}?q=${encodeURIComponent(q)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const body = (await r.json().catch(() => ({}))) as { results?: Hit[]; error?: string }
      if (!r.ok) throw new Error(body.error ?? 'Address search failed.')
      if (!body.results?.length) {
        setNote('No match — a brand-new estate is often not on the map yet. Pan to it by hand.')
      } else {
        setHits(body.results)
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Address search is unavailable — place the pin by hand.')
    }
    setSearching(false)
  }

  function goTo(hit: Hit) {
    map.current?.jumpTo({ center: [hit.lng, hit.lat], zoom: 17 })
    setCentre({ lat: hit.lat, lng: hit.lng })
    setHits(null)
  }

  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching}
          style={{ flex: 1, height: 44, border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: s.ink, cursor: 'pointer', opacity: searching ? 0.6 : 1 }}
        >
          {searching ? 'Searching…' : 'Find the address on the map'}
        </button>
      </span>

      {hits && (
        <span style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10, overflow: 'hidden' }}>
          {hits.map((h, i) => (
            <span
              key={`${h.lat},${h.lng}`}
              onClick={() => goTo(h)}
              style={{ padding: '11px 13px', borderTop: i === 0 ? 'none' : '1px solid #EDEFF1', fontSize: 13, lineHeight: 1.4, color: s.ink, cursor: 'pointer' }}
            >
              {h.label}
            </span>
          ))}
        </span>
      )}

      {note && <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B6100' }}>{note}</span>}

      <span style={{ position: 'relative', display: 'block', height: 240, borderRadius: 12, overflow: 'hidden', border: '1px solid #DCE0E6' }}>
        <div ref={host} style={{ position: 'absolute', inset: 0 }} />
        {/* The pin sits at the frame's centre and the map moves under it. The
            offset lifts the point of the pin, not its middle, onto the spot. */}
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -100%)', pointerEvents: 'none' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="#1A1D21" stroke="#fff" strokeWidth="1.6" />
            <circle cx="12" cy="10" r="2.6" fill="#fff" />
          </svg>
        </span>
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12.5, color: '#4A5057' }}>Fence radius — {radius} m</span>
        <input type="range" min={25} max={600} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: '100%' }} />
      </span>

      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
        Crew can only clock on inside this circle. Cover the building and its parking, not the
        whole street — a fence that reaches the road clocks people on as they drive past.
      </span>
    </span>
  )
}
