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
import { DEFAULT_CENTER, MAP_STYLE_URL } from '../../data/mapconfig'
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

/**
 * Whether this browser engine can draw the map at all.
 *
 * maplibre requires WebGL2 and reports its absence by logging a
 * GPUInitializationError — not by throwing from the constructor, and not
 * through map.on('error') — so there is nothing to catch. Asking the canvas
 * directly is deterministic, synchronous, and does not depend on how the
 * library happens to plumb its failures this version.
 */
function canDrawMap(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

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
  /**
   * Whether the pin is anywhere on purpose.
   *
   * The map has to open somewhere, and its somewhere is Adelaide's CBD. That
   * default is the most dangerous value in this component: it looks exactly
   * like a real placement — a pin, a circle, streets underneath — so a job
   * saved without touching the map gets a fence thirteen kilometres from the
   * site, and the failure surfaces a week later as a crew who cannot clock on
   * and a job with no hours against it. Until somebody has actually put the
   * pin somewhere, this reports nothing at all and the form refuses to save.
   */
  const [placed, setPlaced] = useState(value != null)
  /**
   * Set when the map itself cannot run.
   *
   * maplibre-gl needs WebGL and a Web Worker, and this is the first build to
   * ship it inside the iOS shell — where the document origin is
   * capacitor://localhost, served by a custom scheme handler, and Workers
   * loaded from a custom scheme have a history of not starting in WKWebView.
   * That cannot be settled from here, so it is not gambled on: if the map
   * fails, the picker keeps working without it. A geocoded address is already
   * a latitude and a longitude — the map only ever confirmed it — so a job can
   * still be created from a search result or from where the phone is standing.
   * Losing the map costs precision, not the ability to work.
   */
  const [mapBroken, setMapBroken] = useState(false)
  const [locating, setLocating] = useState(false)

  // The parent only ever hears about a finished, deliberate value — never a
  // frame of a pan, and never the opening default.
  useEffect(() => {
    if (!placed) return
    onChange({ lat: centre.lat, lng: centre.lng, radiusM: radius })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, centre.lat, centre.lng, radius])

  useEffect(() => {
    if (!host.current || map.current) return
    if (!canDrawMap()) {
      setMapBroken(true)
      return
    }
    let m: MapLibreMap
    try {
      m = new MapLibreMap({
        container: host.current,
        style: MAP_STYLE_URL,
        center: [centre.lng, centre.lat],
        zoom: 15,
        attributionControl: { compact: true },
      })
    } catch (err) {
      // WebGL unavailable, or the worker refused to start. Either way there
      // is no map today.
      console.warn('[fence] map could not start', err)
      setMapBroken(true)
      return
    }
    map.current = m
    // A tile that will not load is a bad signal, not a broken map — the app is
    // built for sites with no reception. Only a failure to come up at all
    // counts, so this waits for the map to say it is ready and gives up if it
    // never does.
    const settle = window.setTimeout(() => {
      if (!m.loaded()) setMapBroken(true)
    }, 12_000)
    m.on('load', () => window.clearTimeout(settle))
    // maplibre reports "no WebGL2" and a worker that would not start as error
    // events, not as a throw from the constructor — so without this the picker
    // sat on a dead grey rectangle until the timeout above gave up on it.
    // Tile failures also arrive here and must NOT count: a site with no
    // reception is the normal case this app is built for, and the map is still
    // perfectly usable for placing a pin without them.
    m.on('error', (e) => {
      const message = String((e as { error?: { message?: string } }).error?.message ?? '')
      if (/webgl|worker|context/i.test(message)) {
        console.warn('[fence] map unavailable', message)
        window.clearTimeout(settle)
        setMapBroken(true)
      }
    })
    m.on('load', () => {
      m.addSource(CIRCLE_SOURCE, { type: 'geojson', data: circle(centre.lat, centre.lng, radius) })
      m.addLayer({ id: 'fence-fill', type: 'fill', source: CIRCLE_SOURCE, paint: { 'fill-color': '#1A73E8', 'fill-opacity': 0.14 } })
      m.addLayer({ id: 'fence-line', type: 'line', source: CIRCLE_SOURCE, paint: { 'line-color': '#1A73E8', 'line-width': 2 } })
    })
    // `moveend`, not `move`: redrawing the circle on every animation frame of
    // a pan is what makes a map feel like it is fighting you.
    m.on('moveend', (e) => {
      const c = m.getCenter()
      setCentre({ lat: c.lat, lng: c.lng })
      // A pan the person did with their thumb counts as placing the pin. A
      // programmatic jumpTo (search result, geolocation) carries no
      // originalEvent and marks itself placed at its own call site.
      if ((e as { originalEvent?: unknown }).originalEvent) setPlaced(true)
    })
    return () => {
      window.clearTimeout(settle)
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

  /** Put the pin where the phone is. Offered on tap, and tried once on open. */
  function useMyPosition(explicit: boolean) {
    if (!('geolocation' in navigator)) {
      if (explicit) setNote('This device will not give the app a location.')
      return
    }
    if (explicit) setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        map.current?.jumpTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 })
        setCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        // Standing at the site when you write the job up is a real placement
        // — it is the one case the old "use my current location" got right.
        setPlaced(true)
        if (explicit) setNote(null)
      },
      (err) => {
        setLocating(false)
        // On open this is silence: declined is a perfectly normal answer and
        // the address search is the way in. Asked for directly, it needs an
        // answer.
        if (explicit) setNote(err.message || 'Could not get this phone’s location.')
      },
      { enableHighAccuracy: explicit, timeout: 10_000 },
    )
  }

  useEffect(() => {
    if (value || located) return
    setLocated(true)
    useMyPosition(false)
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
    setPlaced(true)
    setHits(null)
    setNote(null)
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
          {searching ? 'Searching…' : mapBroken ? 'Find the address' : 'Find the address on the map'}
        </button>
        <button
          type="button"
          onClick={() => useMyPosition(true)}
          disabled={locating}
          title="Put the fence where this phone is"
          style={{ flex: 'none', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', cursor: 'pointer', opacity: locating ? 0.6 : 1 }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke={s.ink} strokeWidth="1.7">
            <circle cx="10" cy="10" r="3.2" />
            <circle cx="10" cy="10" r="6.8" />
            <path d="M10 .8v2.6M10 16.6v2.6M.8 10h2.6M16.6 10h2.6" strokeLinecap="round" />
          </svg>
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

      <span style={{ position: 'relative', display: mapBroken ? 'none' : 'block', height: 240, borderRadius: 12, overflow: 'hidden', border: '1px solid #DCE0E6' }}>
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

      {mapBroken && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 13px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 11 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: s.ink }}>
            {placed ? 'Fence set without the map' : 'The map will not load on this phone'}
          </span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#7B838B' }}>
            {placed
              ? 'Searching the address is enough on its own — it gives the exact spot. Widen the radius below if you are not certain of it.'
              : 'Use “Find the address” or the target button to set the fence — neither one needs the map. You can adjust it later from the office dashboard.'}
          </span>
          {placed && (
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, color: '#4A5057' }}>
              {centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}
            </span>
          )}
        </span>
      )}

      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12.5, color: '#4A5057' }}>Fence radius — {radius} m</span>
        <input type="range" min={25} max={600} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: '100%' }} />
      </span>

      {!placed && (
        <span style={{ padding: '10px 12px', background: '#FFF6E3', border: '1px solid #F0DFB8', borderRadius: 9, fontSize: 12.5, lineHeight: 1.5, color: '#7A5700' }}>
          {mapBroken
            ? 'The fence is not set yet — search the address, or use the target button if you are standing at the site.'
            : 'The pin is not on the site yet — search the address above, or drag the map until the pin is over the job. The map opens on the middle of Adelaide, which is nobody’s job site.'}
        </span>
      )}

      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
        Crew can only clock on inside this circle. Cover the building and its parking, not the
        whole street — a fence that reaches the road clocks people on as they drive past.
      </span>
    </span>
  )
}
