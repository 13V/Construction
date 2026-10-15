/**
 * Where a job is, on a map that fills its pane: the website's fence editor.
 *
 * The fence is the circle the crew clock on inside (api/ping.ts). A fence in
 * the wrong suburb is not cosmetic: nobody can clock on, the job records no
 * hours, and it shows up a week later as a missing timesheet. So the pin
 * only ever moves on purpose:
 *  - picking an address search hit (the map flies there, zoom 17)
 *  - clicking the map
 *  - dragging the pin
 * and nothing else moves it: not panning, not zooming, not the map opening
 * somewhere. A new job has no pin at all until one of those happens, and its
 * form cannot save until then. The radius is the slider (25-600 m in 5 m
 * steps, the phone's own range), the number box, or the handle on the
 * circle's east edge.
 *
 * Written for a desk, not forked from the phone's FencePicker: on a phone the
 * pin sits still at the frame's centre and the map moves under the thumb;
 * with a mouse, clicking the spot and dragging the pin is the natural
 * gesture, and the map can be explored without moving the fence. It also
 * fixes the picker's stale circle: the circle there is first drawn from the
 * position the picker opened with, so a search answered before the map
 * finished loading drew the circle in the old place. Here every draw reads
 * the fence as it is now, on load and on every change.
 *
 * Every other live job's fence is drawn faintly in its rail colour, and an
 * amber note says when this one overlaps one (inside both, a clock-on goes to
 * whichever pin is nearer). A pin in the middle of Adelaide, where the map
 * opens, gets a note too; the page asks before saving one there.
 *
 * maplibre-gl (about 900 kB) is downloaded when the editor first mounts, not
 * with the page, so the form beside it is usable at once. Its worker is
 * pinned with setWorkerUrl, as the phone's map does, because after bundling
 * the URL it would work out for itself is wrong. If the map cannot run (no
 * WebGL2, or it has not loaded after 12 s, or it reports a WebGL or worker
 * failure), the editor still works without it: a search hit is already a
 * latitude and a longitude, and the slider sets the radius.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { GeoJSONSource, Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import { RADIUS_DEFAULT, RADIUS_MAX, RADIUS_MIN, RADIUS_STEP } from '../data/contract'
import { addressLine, DEFAULT_CENTER, MAP_STYLE_URL, railOf, supabase, type JobSiteRow } from '../phone'
import { color, radius, shadow, space, text } from '../tokens'
import { CloseIcon, IconButton, Spinner } from '../ui/Button'
import {
  boundsOf,
  circleFeature,
  collection,
  formatPoint,
  handlePoint,
  nearDefaultCentre,
  overlapping,
  parseRadius,
  pointAt,
  radiusFromHandle,
  type FenceValue,
  type LatLng,
  type OtherFence,
} from './fenceGeometry'
import { splitLabel, type AddressSearch, type GeocodeHit } from './geocode'

export type { FenceValue, OtherFence } from './fenceGeometry'

type MapLibre = typeof import('maplibre-gl')

/** The map element carries its maplibre instance here, for devtools and the browser rig. */
export type FenceMapElement = HTMLElement & { maplibre?: MlMap }

// ------------------------------------------------------------------ loading the map

let loading: Promise<MapLibre> | null = null

/** maplibre-gl, its worker and its stylesheet, fetched once per tab. */
function loadMapLibre(): Promise<MapLibre> {
  if (!loading) {
    loading = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([ml, worker]) => {
      ml.setWorkerUrl(worker.default)
      return ml
    })
    // A download that failed (offline, or a deploy renamed the chunk) may work on a retry.
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/**
 * Whether this browser can draw the map at all. maplibre needs WebGL2 and
 * reports its absence by logging, not by throwing anything catchable, so the
 * canvas is asked directly (the phone's FencePicker does the same).
 */
function canDrawMap(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

/** How long the map gets to come up before the editor carries on without it (the phone waits the same). */
const MAP_TIMEOUT_MS = 12_000

const FENCE = 'wb-fence'
const OTHERS = 'wb-fence-others'
const EMPTY = collection<object>([])

type Mode = 'loading' | 'map' | 'fallback'

// ------------------------------------------------------------------ other jobs' fences

/**
 * Every other live job's fence in the company, for drawing and the overlap
 * check. Archived jobs are left out: api/ping.ts never clocks anyone on to
 * one, so its fence overlaps nothing that matters.
 */
export function useOtherFences(exceptId: string | null): { fences: OtherFence[]; error: string | null } {
  const [fences, setFences] = useState<OtherFence[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      const { data, error: err } = await supabase().from('job_sites').select('id, name, address, lat, lng, radius_m, colour, status').neq('status', 'archived')
      if (!live) return
      if (err) {
        setError(err.message)
        return
      }
      setError(null)
      const rows = (data ?? []) as Array<Pick<JobSiteRow, 'id' | 'name' | 'address' | 'lat' | 'lng' | 'radius_m' | 'colour'>>
      setFences(
        rows
          .filter((r) => r.id !== exceptId && Number.isFinite(r.lat) && Number.isFinite(r.lng) && Number.isFinite(r.radius_m))
          .map((r) => ({ id: r.id, title: addressLine(r) || r.name, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radius_m, colour: railOf(r) })),
      )
    })()
    return () => {
      live = false
    }
  }, [exceptId])
  return { fences, error }
}

// ------------------------------------------------------------------ the editor

export interface FenceEditorProps {
  /** The fence as it stands: the stored one when editing, null for a job with no pin yet. */
  value: FenceValue | null
  /** A deliberate change: a hit picked, a click, a drag, a new radius. Never a pan or a zoom. */
  onChange: (next: FenceValue) => void
  /** This job's rail colour. */
  colour: string
  /** Other jobs' fences (useOtherFences). */
  others: OtherFence[]
  /** The address search whose hits are shown on the map (useAddressSearch). */
  search: AddressSearch
  style?: CSSProperties
}

export function FenceEditor({ value, onChange, colour, others, search, style }: FenceEditorProps) {
  const pane = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const mlRef = useRef<MapLibre | null>(null)
  const pin = useRef<MlMarker | null>(null)
  const handle = useRef<MlMarker | null>(null)
  const hitMarkers = useRef<MlMarker[]>([])
  const labelMarkers = useRef<MlMarker[]>([])
  /** What the pointer is dragging, so a redraw does not yank it out from under the mouse. */
  const dragging = useRef<'pin' | 'handle' | null>(null)
  /** Ends a pin or handle drag still under way, without handing over where it got to (set once the map is up). */
  const dropDrag = useRef<() => void>(() => {})
  /** True while dropDrag is ending a drag, so its dragend does not commit. */
  const dropping = useRef(false)
  /** Set once somebody pans or zooms, after which the editor never reframes the map by itself. */
  const userMoved = useRef(false)

  const [mode, setMode] = useState<Mode>('loading')
  /** Why the map is not shown, and whether trying again could help (no WebGL will not change on a retry). */
  const [why, setWhy] = useState<{ text: string; retry: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** The radius chosen before there is a pin to give it to. */
  const [radiusDraft, setRadiusDraft] = useState(RADIUS_DEFAULT)
  /** The fence mid-drag, drawn live and handed over on release. */
  const [preview, setPreview] = useState<FenceValue | null>(null)

  const shown = preview ?? value
  const radiusM = shown?.radiusM ?? radiusDraft

  // Handlers registered with maplibre once read the latest props through these.
  const latest = useRef({ value, onChange, radiusM, search })
  useEffect(() => {
    latest.current = { value, onChange, radiusM, search }
  })

  const fail = useCallback((text: string, retry = true) => {
    setWhy({ text, retry })
    setMode('fallback')
  }, [])

  /** Put the pin somewhere on purpose. */
  const place = useCallback((at: LatLng) => {
    const { onChange: change, radiusM: r } = latest.current
    change({ ...pointAt(at.lat, at.lng), radiusM: r })
  }, [])

  // ---------------------------------------------------------------- start the map

  useEffect(() => {
    setMode('loading')
    setWhy(null)
    if (!canDrawMap()) {
      fail('This browser has WebGL switched off, and the map needs it.', false)
      return
    }
    let cancelled = false
    let m: MlMap | null = null
    let settle = 0
    /** Stops watching the window for the end of a marker drag (see watchRelease). */
    let unwatch: (() => void) | null = null
    const paneEl = pane.current as FenceMapElement | null

    loadMapLibre().then(
      (ml) => {
        const el = host.current
        if (cancelled || !el) return
        mlRef.current = ml
        const start = latest.current.value
        const framed = start ? boundsOf([start]) : null
        try {
          m = new ml.Map({
            container: el,
            style: MAP_STYLE_URL,
            ...(framed
              ? { bounds: framed, fitBoundsOptions: { padding: 96, maxZoom: 17 } }
              : { center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat] as [number, number], zoom: 11 }),
            attributionControl: { compact: true },
            // North stays up, so the radius handle stays on the right of the pin.
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
          })
        } catch (err) {
          console.warn('[fence] the map could not start', err)
          fail('The map could not start in this browser.')
          return
        }
        const map = m
        mapRef.current = map
        if (paneEl) paneEl.maplibre = map
        map.touchZoomRotate.disableRotation()
        map.keyboard.disableRotation()
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right')
        map.getCanvas().style.cursor = 'crosshair'

        // A slow tile is a bad signal, not a broken map. Only a map that has
        // not come up at all by now counts.
        settle = window.setTimeout(() => {
          if (!map.loaded() && !map.isStyleLoaded()) fail('The map took too long to load.')
        }, MAP_TIMEOUT_MS)
        // No WebGL2, or a worker that would not start, arrive as error events
        // rather than a throw. Tile failures arrive here too and do not count.
        map.on('error', (e) => {
          const message = String((e as { error?: { message?: string } }).error?.message ?? '')
          if (/webgl|worker|context/i.test(message)) {
            console.warn('[fence] map unavailable', message)
            fail('The map stopped working in this browser.')
          }
        })
        map.on('load', () => {
          window.clearTimeout(settle)
          if (cancelled) return
          map.addSource(OTHERS, { type: 'geojson', data: EMPTY })
          map.addSource(FENCE, { type: 'geojson', data: EMPTY })
          // Other jobs: faint, dashed, each in its own rail colour.
          map.addLayer({ id: `${OTHERS}-fill`, type: 'fill', source: OTHERS, paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.07 } })
          map.addLayer({
            id: `${OTHERS}-line`,
            type: 'line',
            source: OTHERS,
            paint: { 'line-color': ['get', 'colour'], 'line-width': 1.5, 'line-opacity': 0.6, 'line-dasharray': [2, 2] },
          })
          // This job: solid, on top.
          map.addLayer({ id: `${FENCE}-fill`, type: 'fill', source: FENCE, paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.16 } })
          map.addLayer({ id: `${FENCE}-line`, type: 'line', source: FENCE, paint: { 'line-color': ['get', 'colour'], 'line-width': 2.5 } })
          setMode('map')
        })
        map.on('movestart', (e) => {
          if ((e as { originalEvent?: unknown }).originalEvent) userMoved.current = true
        })
        // A click on the map itself places the pin. Clicks on the pin, the
        // handle or a search marker reach this too, and are theirs, not the map's.
        map.on('click', (e) => {
          if (e.originalEvent.target !== map.getCanvas()) return
          place({ lat: e.lngLat.lat, lng: e.lngLat.lng })
        })

        // maplibre ends a marker drag only on a mouseup inside the map's
        // canvas (marker.ts: map.once('mouseup')). A button let go anywhere
        // else (on the radius bar under the map, the hit list, the zoom
        // buttons, the form beside it) never reaches it, so the drag carried
        // on with no button held: the pin or the circle followed the mouse
        // back over the map, and the next click both ended it and placed the
        // pin. So from a press on the pin or the handle until the button comes
        // up, the window listens as well, and a release the map did not see is
        // handed to it. That drag then ends like any other, where the map
        // shows it, and is handed over (dragend below).
        const canvasBox = map.getCanvasContainer()
        const release = (e: MouseEvent) => {
          unwatch?.()
          // Not to a map already taken down (the fallback, or the page closing).
          if (mapRef.current === map) map.fire(new ml.MapMouseEvent('mouseup', map, e))
        }
        const watchRelease = () => {
          unwatch?.()
          const up = (e: MouseEvent) => {
            // Inside the canvas the map sees the release itself.
            if (canvasBox.contains(e.target as Node)) unwatch?.()
            else release(e)
          }
          // A release no mouseup reported (the button let go outside the
          // window, or the tab losing focus mid-drag): the next move comes
          // with no button down.
          const move = (e: MouseEvent) => {
            if (e.buttons === 0) release(e)
          }
          const blur = () => release(new MouseEvent('mouseup'))
          window.addEventListener('mouseup', up, true)
          window.addEventListener('mousemove', move, true)
          window.addEventListener('blur', blur)
          unwatch = () => {
            window.removeEventListener('mouseup', up, true)
            window.removeEventListener('mousemove', move, true)
            window.removeEventListener('blur', blur)
            unwatch = null
          }
        }
        dropDrag.current = () => {
          dropping.current = true
          try {
            release(new MouseEvent('mouseup'))
          } finally {
            dropping.current = false
          }
          dragging.current = null
          setPreview(null)
        }

        const pinEl = document.createElement('div')
        pinEl.dataset.fencePin = ''
        pinEl.title = 'Drag to move the fence'
        pinEl.style.cursor = 'grab'
        pinEl.innerHTML = PIN_SVG
        // Before maplibre's own mousedown handler, which listens on the canvas container the pin sits in.
        pinEl.addEventListener('mousedown', watchRelease)
        const pinMarker = new ml.Marker({ element: pinEl, draggable: true, anchor: 'bottom', offset: [0, 1] })
        pin.current = pinMarker
        pinMarker.on('dragstart', () => {
          dragging.current = 'pin'
        })
        pinMarker.on('drag', () => {
          const p = pinMarker.getLngLat()
          setPreview({ ...pointAt(p.lat, p.lng), radiusM: latest.current.radiusM })
        })
        pinMarker.on('dragend', () => {
          const p = pinMarker.getLngLat()
          dragging.current = null
          setPreview(null)
          if (!dropping.current) place({ lat: p.lat, lng: p.lng })
        })

        const handleEl = document.createElement('div')
        handleEl.dataset.fenceHandle = ''
        handleEl.title = 'Drag to change the fence radius'
        Object.assign(handleEl.style, {
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: color.panel,
          border: `2px solid ${color.ink}`,
          boxShadow: shadow.button,
          cursor: 'ew-resize',
        } satisfies Partial<CSSStyleDeclaration>)
        handleEl.addEventListener('mousedown', watchRelease)
        const handleMarker = new ml.Marker({ element: handleEl, draggable: true, anchor: 'center' })
        handle.current = handleMarker
        handleMarker.on('dragstart', () => {
          dragging.current = 'handle'
        })
        handleMarker.on('drag', () => {
          const v = latest.current.value
          if (!v) return
          const at = handleMarker.getLngLat()
          setPreview({ ...v, radiusM: radiusFromHandle(v, { lat: at.lat, lng: at.lng }) })
        })
        handleMarker.on('dragend', () => {
          const v = latest.current.value
          const at = handleMarker.getLngLat()
          dragging.current = null
          setPreview(null)
          if (v && !dropping.current) latest.current.onChange({ ...v, radiusM: radiusFromHandle(v, { lat: at.lat, lng: at.lng }) })
        })
      },
      (err) => {
        if (cancelled) return
        console.warn('[fence] the map could not be downloaded', err)
        fail('The map could not be downloaded.')
      },
    )

    return () => {
      cancelled = true
      window.clearTimeout(settle)
      unwatch?.()
      dropDrag.current = () => {}
      dragging.current = null
      for (const mk of [...hitMarkers.current, ...labelMarkers.current]) mk.remove()
      hitMarkers.current = []
      labelMarkers.current = []
      pin.current?.remove()
      handle.current?.remove()
      pin.current = null
      handle.current = null
      // Unless the fallback already took it down: a map removed twice throws.
      if (m && mapRef.current === m) {
        m.remove()
        mapRef.current = null
      }
      if (paneEl) delete paneEl.maplibre
    }
  }, [attempt, fail, place])

  // A map given up on is taken down, so it cannot come back half-working behind the fallback.
  useEffect(() => {
    if (mode !== 'fallback' || !mapRef.current) return
    mapRef.current.remove()
    mapRef.current = null
    if (pane.current) delete (pane.current as FenceMapElement).maplibre
  }, [mode])

  // ---------------------------------------------------------------- draw

  // This job's fence, the pin and the handle: from the fence as it is now,
  // on load (mode becomes 'map') and on every change after.
  useEffect(() => {
    const m = mapRef.current
    if (mode !== 'map' || !m) return
    const src = m.getSource(FENCE) as GeoJSONSource | undefined
    src?.setData(shown ? collection([circleFeature(shown, { colour })]) : EMPTY)
    const p = pin.current
    const h = handle.current
    if (!p || !h) return
    // addTo() takes a marker off the map and puts it back, dropping a drag
    // in progress with it, so a marker already on the map is only moved.
    const onMap = (mk: MlMarker) => mk.getElement().isConnected
    if (!shown) {
      if (onMap(p)) p.remove()
      if (onMap(h)) h.remove()
      return
    }
    if (dragging.current !== 'pin') p.setLngLat([shown.lng, shown.lat])
    p.getElement().dataset.lat = String(shown.lat)
    p.getElement().dataset.lng = String(shown.lng)
    if (!onMap(p)) p.addTo(m)
    if (dragging.current !== 'handle') {
      const at = handlePoint(shown, shown.radiusM)
      h.setLngLat([at.lng, at.lat])
    }
    h.getElement().style.borderColor = colour
    if (!onMap(h)) h.addTo(m)
  }, [mode, shown, colour])

  // A fence put somewhere off screen (a reset, a form filled in from elsewhere) is brought into view.
  useEffect(() => {
    const m = mapRef.current
    if (mode !== 'map' || !m || !value || dragging.current || m.isMoving()) return
    if (!m.getBounds().contains([value.lng, value.lat])) m.easeTo({ center: [value.lng, value.lat] })
  }, [mode, value])

  // Other jobs' fences, and a small name on each so an overlap says whose it is.
  useEffect(() => {
    const m = mapRef.current
    const ml = mlRef.current
    if (mode !== 'map' || !m || !ml) return
    const src = m.getSource(OTHERS) as GeoJSONSource | undefined
    src?.setData(collection(others.map((o) => circleFeature(o, { id: o.id, title: o.title, colour: o.colour }))))
    for (const mk of labelMarkers.current) mk.remove()
    labelMarkers.current = others.map((o) => {
      const el = document.createElement('div')
      el.textContent = o.title
      Object.assign(el.style, {
        pointerEvents: 'none',
        maxWidth: '180px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        padding: '1px 6px',
        borderRadius: '6px',
        background: 'rgba(255,255,255,.82)',
        color: o.colour,
        font: `600 11px/16px ${getComputedStyle(pane.current ?? document.body).fontFamily}`,
      } satisfies Partial<CSSStyleDeclaration>)
      return new ml.Marker({ element: el, anchor: 'center' }).setLngLat([o.lng, o.lat]).addTo(m)
    })
    // A new job opens on the company's jobs rather than on the CBD, until somebody moves the map.
    const framed = boundsOf(others)
    if (!latest.current.value && framed && !userMoved.current) m.fitBounds(framed, { padding: 96, maxZoom: 14, duration: 0 })
  }, [mode, others])

  // The search hits, numbered as the list numbers them; a new answer is framed once.
  useEffect(() => {
    const m = mapRef.current
    const ml = mlRef.current
    if (mode !== 'map' || !m || !ml) return
    for (const mk of hitMarkers.current) mk.remove()
    hitMarkers.current = (search.hits ?? []).map((hit, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = String(i + 1)
      el.dataset.fenceHit = String(i)
      el.setAttribute('aria-label', `Put the fence at ${splitLabel(hit.label).head}`)
      el.className = 'wb-focus'
      Object.assign(el.style, {
        width: '24px',
        height: '24px',
        padding: '0',
        border: `2px solid ${color.panel}`,
        borderRadius: '50%',
        background: color.inkDeep,
        color: color.onDark,
        font: `700 12px/20px ${getComputedStyle(pane.current ?? document.body).fontFamily}`,
        boxShadow: shadow.button,
        cursor: 'pointer',
      } satisfies Partial<CSSStyleDeclaration>)
      el.addEventListener('click', () => pickRef.current(hit))
      return new ml.Marker({ element: el, anchor: 'center' }).setLngLat([hit.lng, hit.lat]).addTo(m)
    })
  }, [mode, search.hits])

  useEffect(() => {
    const m = mapRef.current
    const hits = latest.current.search.hits
    if (mode !== 'map' || !m || !hits?.length) return
    if (hits.length === 1) m.easeTo({ center: [hits[0].lng, hits[0].lat], zoom: Math.max(m.getZoom(), 15) })
    else {
      const b = boundsOf(hits.map((h) => ({ ...h, radiusM: 50 })))
      if (b) m.fitBounds(b, { padding: 96, maxZoom: 16 })
    }
    // Only a new answer moves the map; the same hits shown again do not.
  }, [mode, search.answer])

  /** A hit picked from the list or the map: the pin goes there and the map flies in. */
  const pick = useCallback(
    (hit: GeocodeHit) => {
      dropDrag.current()
      place(hit)
      latest.current.search.dismiss()
      mapRef.current?.flyTo({ center: [hit.lng, hit.lat], zoom: 17 })
    },
    [place],
  )
  const pickRef = useRef(pick)
  useEffect(() => {
    pickRef.current = pick
  })

  // ---------------------------------------------------------------- radius

  // The bar (or a pick) always wins over a drag still under way. Otherwise the
  // drag's preview, drawn in place of the fence, would hide the radius just
  // typed while Save wrote it. The drag is dropped where it was not yet handed
  // over, so the map goes back to showing exactly the fence that Save writes.
  const setRadius = (r: number) => {
    dropDrag.current()
    if (value) onChange({ ...value, radiusM: r })
    else setRadiusDraft(r)
  }

  // ---------------------------------------------------------------- notes

  const clashes = useMemo(() => (shown ? overlapping(shown, others) : []), [shown, others])
  const inCbd = shown ? nearDefaultCentre(shown) : false

  const notes: ReactNode[] = []
  if (clashes.length) {
    const [first, ...more] = clashes
    const whose = first.title === first.name ? first.title : `${first.title} (${first.name})`
    notes.push(
      <Note key="overlap" kind="overlap">
        This fence overlaps {whose}
        {more.length ? ` and ${more.length} other job${more.length === 1 ? '' : 's'}` : ''}. Inside both circles, a clock-on goes to whichever pin is nearer.
      </Note>,
    )
  }
  if (inCbd) {
    notes.push(
      <Note key="cbd" kind="cbd">
        The pin is in the middle of Adelaide, where the map opens. Is the job really there?
      </Note>,
    )
  }

  const bar = <FenceBar radiusM={radiusM} onRadius={setRadius} fence={shown} notes={notes} card={mode === 'fallback'} />
  const hitsList = search.hits ? <HitList hits={search.hits} query={search.query} onPick={pick} onClose={search.dismiss} floating={mode !== 'fallback'} /> : null

  return (
    <div
      ref={pane}
      data-fence-editor=""
      data-map-state={mode}
      data-placed={value ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 420,
        overflow: 'hidden',
        boxSizing: 'border-box',
        borderRadius: radius.lg,
        border: `1px solid ${color.border}`,
        background: color.panel,
        ...style,
      }}
    >
      {/* The map, with what floats on it. Always mounted, and only hidden for
          the fallback, so "Try the map again" has its element to start in.
          The radius and the notes sit under the map rather than over it, so
          they never hide the fence, the pin or the map's OpenStreetMap credit. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#E9ECEF', display: mode === 'fallback' ? 'none' : 'block' }}>
        <div ref={host} aria-label="Map: click to put the fence there" style={{ position: 'absolute', inset: 0 }} />
        {mode === 'loading' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.xs, ...text.sm, color: color.muted, pointerEvents: 'none' }}>
            <Spinner /> Loading the map…
          </div>
        )}
        {mode !== 'fallback' && hitsList}
        {!value && !search.hits && !search.busy && mode === 'map' && (
          <div style={{ position: 'absolute', top: space.sm, left: '50%', transform: 'translateX(-50%)', zIndex: 3, pointerEvents: 'none' }}>
            <Note kind="unplaced" floating>
              Search the address, or click the map where the job is.
            </Note>
          </div>
        )}
        {search.busy && mode !== 'fallback' && (
          <div
            style={{
              position: 'absolute',
              top: space.sm,
              left: space.sm,
              zIndex: 3,
              display: 'flex',
              alignItems: 'center',
              gap: space.xs,
              padding: '6px 10px',
              borderRadius: radius.md,
              background: color.panel,
              boxShadow: shadow.pop,
              ...text.sm,
              color: color.body,
            }}
          >
            <Spinner /> Searching…
          </div>
        )}
      </div>

      {mode === 'fallback' ? (
        <div data-fence-fallback="" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: space.md, padding: space.lg, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.xxs }}>
            <div style={{ ...text.md, fontWeight: 600, color: color.ink }}>The map will not load here</div>
            <div style={{ ...text.sm, color: color.body, maxWidth: 520 }}>
              {why?.text} Search the address and pick the right result: a search hit is the exact spot, so it places the fence on its own. Then set the radius
              below, a little wider if you are not sure of the spot.
            </div>
            {why?.retry && (
              <button type="button" className="wb-link wb-link--button" onClick={() => setAttempt((n) => n + 1)} style={{ alignSelf: 'flex-start', ...text.sm }}>
                Try the map again
              </button>
            )}
          </div>
          {search.busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, ...text.sm, color: color.muted }}>
              <Spinner /> Searching…
            </div>
          )}
          {hitsList}
          {!value && !search.hits && !search.busy && <Note kind="unplaced">No fence yet. Search the address, then pick the right result.</Note>}
          {bar}
        </div>
      ) : (
        bar
      )}
    </div>
  )
}

// ------------------------------------------------------------------ pieces

/** The phone's pin, cropped so its point is the bottom edge of the box (the marker's anchor). */
const PIN_SVG =
  '<svg width="28" height="36" viewBox="4 2 16 20.6" fill="none" style="display:block" aria-hidden="true">' +
  `<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="${color.ink}" stroke="#fff" stroke-width="1.6"/>` +
  '<circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>'

function Note({ kind, floating = false, children }: { kind: 'overlap' | 'cbd' | 'unplaced'; floating?: boolean; children: ReactNode }) {
  const amber = kind !== 'unplaced'
  return (
    <div
      data-fence-note={kind}
      role={amber ? 'status' : undefined}
      style={{
        padding: '8px 12px',
        borderRadius: radius.md,
        background: amber ? color.amberFill : color.panel,
        border: `1px solid ${amber ? color.amberEdge : color.border}`,
        boxShadow: floating ? shadow.pop : undefined,
        ...text.sm,
        color: amber ? color.amber : color.body,
        whiteSpace: floating ? 'nowrap' : undefined,
      }}
    >
      {children}
    </div>
  )
}

function HitList({
  hits,
  query,
  onPick,
  onClose,
  floating,
}: {
  hits: GeocodeHit[]
  query: string
  onPick: (hit: GeocodeHit) => void
  onClose: () => void
  floating: boolean
}) {
  return (
    <div
      data-fence-hits=""
      style={{
        // On the map it never reaches the zoom buttons in the top right corner
        // (10 px in, 29 px wide), so a narrow map keeps them and the list keeps its close button.
        ...(floating
          ? { position: 'absolute', top: space.sm, left: space.sm, zIndex: 3, width: 340, maxWidth: `calc(100% - ${space.sm + 52}px)`, maxHeight: 'calc(100% - 180px)', boxShadow: shadow.pop }
          : { maxWidth: 520 }),
        display: 'flex',
        flexDirection: 'column',
        background: color.panel,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: '8px 8px 8px 12px', borderBottom: `1px solid ${color.borderSoft}` }}>
        <div style={{ flex: 1, minWidth: 0, ...text.sm, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hits.length === 1 ? 'One place matches' : `${hits.length} places match`} “{query}”
        </div>
        <IconButton label="Close the results" size={26} onClick={onClose}>
          <CloseIcon size={11} />
        </IconButton>
      </div>
      <ol role="list" style={{ margin: 0, padding: 0, listStyle: 'none', overflowY: 'auto' }}>
        {hits.map((hit, i) => {
          const { head, rest } = splitLabel(hit.label)
          return (
            <li key={`${hit.lat},${hit.lng}`} style={{ borderTop: i === 0 ? 'none' : `1px solid ${color.borderSoft}` }}>
              <button
                type="button"
                data-fence-pick={i}
                className="wb-option wb-focus"
                onClick={() => onPick(hit)}
                title={hit.label}
                style={{ display: 'flex', gap: space.sm, width: '100%', padding: '10px 12px', border: 0, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              >
                <span
                  aria-hidden="true"
                  style={{ flex: 'none', width: 20, height: 20, borderRadius: '50%', background: color.inkDeep, color: color.onDark, fontSize: 11, fontWeight: 700, lineHeight: '20px', textAlign: 'center', marginTop: 1 }}
                >
                  {i + 1}
                </span>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ ...text.base, fontWeight: 600, color: color.ink }}>{head}</span>
                  {rest && <span style={{ ...text.xs, color: color.muted }}>{rest}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The radius (slider and number box), where the pin is, and the notes. */
function FenceBar({
  radiusM,
  onRadius,
  fence,
  notes,
  card,
}: {
  radiusM: number
  onRadius: (r: number) => void
  fence: FenceValue | null
  notes: ReactNode[]
  /** A card of its own (no map); otherwise the strip under the map. */
  card: boolean
}) {
  const id = useId()
  const [typed, setTyped] = useState(String(radiusM))
  // The box follows the slider and the handle. It is left alone while it
  // holds something unusable ("8" on the way to "80"), which changes no radius.
  useEffect(() => {
    setTyped(String(radiusM))
  }, [radiusM])
  const bad = parseRadius(typed) === null

  return (
    <div
      data-fence-bar=""
      style={{
        ...(card
          ? { maxWidth: 520, padding: space.sm, border: `1px solid ${color.border}`, borderRadius: radius.lg }
          : { flex: 'none', padding: `${space.sm}px ${space.md}px`, borderTop: `1px solid ${color.border}` }),
        display: 'flex',
        flexDirection: 'column',
        gap: space.xs,
        boxSizing: 'border-box',
        background: color.panel,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <label htmlFor={id} style={{ flex: 'none', ...text.label, color: color.muted }}>
          Fence radius
        </label>
        <input
          type="range"
          data-fence-radius-slider=""
          aria-label="Fence radius in metres"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={RADIUS_STEP}
          value={Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, radiusM))}
          onChange={(e) => onRadius(Number(e.target.value))}
          style={{ flex: 1, minWidth: 80, accentColor: color.ink }}
        />
        <input
          id={id}
          data-fence-radius-input=""
          className="wb-input"
          inputMode="numeric"
          aria-invalid={bad || undefined}
          aria-describedby={bad ? `${id}-msg` : undefined}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            const r = parseRadius(e.target.value)
            if (r !== null && r !== radiusM) onRadius(r)
          }}
          onBlur={() => setTyped(String(radiusM))}
          style={{ flex: 'none', width: 64, height: 32, textAlign: 'right', padding: '0 8px' }}
        />
        <span style={{ flex: 'none', ...text.sm, color: color.body }}>m</span>
      </div>
      {bad && (
        <div id={`${id}-msg`} style={{ ...text.xs, color: color.red }}>
          A whole number of metres from {RADIUS_MIN} to {RADIUS_MAX}, as the phone's slider allows.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.xs, ...text.xs, color: color.muted }}>
        {fence ? (
          <>
            Pin at
            <span
              data-fence-readout=""
              data-lat={fence.lat}
              data-lng={fence.lng}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: color.body, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatPoint(fence)}
            </span>
          </>
        ) : (
          'No pin yet.'
        )}
      </div>
      {notes}
    </div>
  )
}
