import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
import type { MapMouseEvent } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

// MapLibre derives its worker URL from import.meta.url, which after bundling
// points at a path that was never emitted — the map then silently fails to
// render tiles. Pin it to the asset Vite actually produces.
setWorkerUrl(maplibreWorkerUrl)
import type { JobSite, LatLng, WorkerState } from '../types'
import { DEFAULT_CENTER, MAP_STYLE_URL } from '../data/seed'
import { statusColor, theme } from '../theme'
import { offset } from '../geofence/geo'

/**
 * Live map on MapLibre GL + OpenFreeMap tiles.
 *
 * No API key, no billing account, no request cap, and commercial use is
 * explicitly allowed — which is why this replaced Google Maps. Google bills per
 * map load with a 10,000/month free tier, so every dashboard open cost money;
 * here it costs nothing and there is no key to leak or restrict.
 *
 * The map instance is created once and kept for the life of the component.
 * Markers and sources are mutated in place rather than torn down, so a position
 * update never re-initialises anything.
 */

export interface DraftFence {
  center: LatLng
  radiusM: number
}

interface LiveMapProps {
  sites: JobSite[]
  crew: WorkerState[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  showFences: boolean
  draft?: DraftFence | null
  onPick?: (at: LatLng) => void
}

/**
 * The map view survives a reload. Without this the map opens on a default
 * centre and then animates to fit the sites on every single page load, which
 * reads as the map reloading itself every time you arrive.
 */
const VIEW_KEY = 'crewline.map.view'

interface SavedView {
  lng: number
  lat: number
  zoom: number
}

function readView(): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<SavedView>
    if ([v.lng, v.lat, v.zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return v as SavedView
    }
  } catch {
    // A corrupt or unavailable store just means we fall back to fitting sites.
  }
  return null
}

const FENCE_SRC = 'geofences'
const DRAFT_SRC = 'draft-fence'
const TRAIL_SRC = 'trail'

/** Circles must be in metres, not pixels, so they're drawn as polygons. */
function circlePolygon(center: LatLng, radiusM: number, steps = 64) {
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const p = offset(center, (i / steps) * 360, radiusM)
    ring.push([p.lng, p.lat])
  }
  return { type: 'Polygon' as const, coordinates: [ring] }
}

const fenceCollection = (sites: JobSite[]) => ({
  type: 'FeatureCollection' as const,
  features: sites.map((site) => ({
    type: 'Feature' as const,
    properties: { pending: site.status === 'starting_soon' },
    geometry: circlePolygon(site.center, site.radiusM),
  })),
})

const emptyCollection = { type: 'FeatureCollection' as const, features: [] }

function siteMarkerEl(site: JobSite, onSite: number, selected: boolean) {
  const el = document.createElement('div')
  const dim = site.status === 'starting_soon'
  el.style.cssText = `display:flex;align-items:center;gap:7px;padding:5px 9px 5px 6px;border-radius:6px;background:${theme.panel};border:1px solid ${selected ? theme.accent : theme.border};box-shadow:0 1px 4px rgba(0,0,0,.18);cursor:pointer;white-space:nowrap;opacity:${dim ? 0.75 : 1};font:400 12px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif`
  el.innerHTML = `
    <span style="width:8px;height:8px;border-radius:50%;background:${dim ? theme.inkFaint : theme.accent}"></span>
    <span style="display:flex;flex-direction:column">
      <span style="font-weight:600;color:${theme.ink}">${escapeHtml(site.name)}</span>
      <span style="font-size:10.5px;color:${theme.inkSoft}">${site.radiusM} m · ${
        dim ? 'starts soon' : `${onSite} on site`
      }</span>
    </span>`
  return el
}

function workerMarkerEl(state: WorkerState, selected: boolean) {
  const ring = statusColor[state.status] ?? theme.inkFaint
  const el = document.createElement('div')
  el.style.cssText = 'position:relative;cursor:pointer'
  el.innerHTML = `
    <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${theme.railSoft};color:#fff;font:700 10.5px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.02em;border:2.5px solid ${ring};box-shadow:${
      selected ? `0 0 0 3px ${theme.accentFill},` : ''
    }0 1px 4px rgba(0,0,0,.3)">${escapeHtml(state.worker.initials)}</span>
    ${
      state.exception
        ? `<span style="position:absolute;right:-3px;bottom:-3px;width:13px;height:13px;border-radius:50%;background:${theme.alert};border:2px solid #fff;color:#fff;font:700 9px/9px sans-serif;text-align:center">!</span>`
        : ''
    }`
  return el
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The handful of map actions the floating tool rail drives. */
export interface MapHandle {
  zoomIn: () => void
  zoomOut: () => void
  fitSites: () => void
  toggleFullscreen: () => void
}

export const LiveMap = forwardRef<MapHandle, LiveMapProps>(function LiveMap(
  { sites, crew, selectedId, onSelect, showFences, draft, onPick },
  handleRef,
) {
  const container = useRef<HTMLDivElement | null>(null)
  // Read once on mount; later writes must not re-trigger the map build.
  const saved = useRef<SavedView | null>(readView())
  const map = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const markers = useRef(new Map<string, Marker>())
  const centred = useRef(false)

  // Handlers change every render; hold them in refs so the map is built once.
  const pick = useRef(onPick)
  const select = useRef(onSelect)
  pick.current = onPick
  select.current = onSelect

  useEffect(() => {
    if (!container.current || map.current) return

    const m = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE_URL,
      center: saved.current
        ? [saved.current.lng, saved.current.lat]
        : [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: saved.current ? saved.current.zoom : 11,
      attributionControl: { compact: true },
    })
    map.current = m

    // Metric, and driven by the real zoom. Australian job sites are measured
    // in metres and the geofence radius is stored that way.
    m.addControl(new ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-left')

    m.on('moveend', () => {
      const c = m.getCenter()
      try {
        localStorage.setItem(
          VIEW_KEY,
          JSON.stringify({ lng: c.lng, lat: c.lat, zoom: m.getZoom() }),
        )
      } catch {
        // Private browsing can refuse writes; the map still works.
      }
    })

    m.on('click', (e: MapMouseEvent) => {
      if (pick.current) pick.current({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      else select.current(null)
    })

    m.on('load', () => {
      m.addSource(FENCE_SRC, { type: 'geojson', data: emptyCollection })
      m.addLayer({
        id: 'geofence-fill',
        type: 'fill',
        source: FENCE_SRC,
        paint: {
          'fill-color': ['case', ['get', 'pending'], theme.inkFaint, theme.accent],
          'fill-opacity': 0.12,
        },
      })
      m.addLayer({
        id: 'geofence-line',
        type: 'line',
        source: FENCE_SRC,
        paint: {
          'line-color': ['case', ['get', 'pending'], theme.inkFaint, theme.accent],
          'line-opacity': 0.55,
          'line-width': 1,
        },
      })

      m.addSource(DRAFT_SRC, { type: 'geojson', data: emptyCollection })
      m.addLayer({
        id: 'draft-fill',
        type: 'fill',
        source: DRAFT_SRC,
        paint: { 'fill-color': theme.brandYellow, 'fill-opacity': 0.18 },
      })
      m.addLayer({
        id: 'draft-line',
        type: 'line',
        source: DRAFT_SRC,
        paint: { 'line-color': theme.brandYellow, 'line-width': 2 },
      })

      m.addSource(TRAIL_SRC, { type: 'geojson', data: emptyCollection })
      m.addLayer({
        id: 'trail-line',
        type: 'line',
        source: TRAIL_SRC,
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': theme.accent,
          'line-width': 2,
          'line-opacity': 0.9,
          'line-dasharray': [1, 1.6],
        },
      })

      setReady(true)
    })

    return () => {
      for (const marker of markers.current.values()) marker.remove()
      markers.current.clear()
      m.remove()
      map.current = null
      setReady(false)
    }
  }, [])

  // Geofences
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const src = m.getSource(FENCE_SRC) as GeoJSONSource | undefined
    src?.setData(showFences ? fenceCollection(sites) : emptyCollection)
  }, [sites, showFences, ready])

  // Draft geofence while placing a job site
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const src = m.getSource(DRAFT_SRC) as GeoJSONSource | undefined
    src?.setData(
      draft
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: circlePolygon(draft.center, draft.radiusM),
              },
            ],
          }
        : emptyCollection,
    )
  }, [draft, ready])

  // Breadcrumb trail for the selected worker
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const src = m.getSource(TRAIL_SRC) as GeoJSONSource | undefined
    const trailFor = crew.find((c) => c.worker.id === selectedId && c.trail.length > 1)
    src?.setData(
      trailFor
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: trailFor.trail.map((p) => [p.lng, p.lat]),
                },
              },
            ],
          }
        : emptyCollection,
    )
  }, [crew, selectedId, ready])

  // Markers — reuse existing ones and move them; never rebuild the whole set.
  useEffect(() => {
    const m = map.current
    if (!m) return

    const live = new Set<string>()
    /*
     * MapLibre positions a marker by writing `transform` into the inline style
     * of the element it was given. So that element is a bare wrapper it owns
     * outright, and everything we draw goes in a single child we swap.
     *
     * Assigning `node.style.cssText` on update — which is what this used to do
     * — wiped that transform, and MapLibre only rewrites it on the next map
     * move. Every marker collapsed to the top-left corner of the map and
     * stayed there until the user happened to pan. The crew dots never worked.
     */
    const upsert = (
      key: string,
      lngLat: [number, number],
      el: HTMLElement,
      onClick: () => void,
      offset: [number, number] = [0, 0],
    ) => {
      live.add(key)
      const existing = markers.current.get(key)
      if (existing) {
        existing.setLngLat(lngLat)
        existing.setOffset(offset)
        const node = existing.getElement()
        if (node.firstElementChild) node.firstElementChild.replaceWith(el)
        else node.appendChild(el)
        return
      }
      const wrapper = document.createElement('div')
      wrapper.style.cursor = 'pointer'
      wrapper.appendChild(el)
      wrapper.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onClick()
      })
      markers.current.set(key, new Marker({ element: wrapper, offset }).setLngLat(lngLat).addTo(m))
    }

    for (const site of sites) {
      const onSite = crew.filter((c) => c.siteId === site.id && c.status === 'on_clock').length
      upsert(
        `site:${site.id}`,
        [site.center.lng, site.center.lat],
        siteMarkerEl(site, onSite, selectedId === site.id),
        () => select.current(site.id),
      )
    }

    /*
     * Two people standing on the same slab are metres apart, which is well
     * under a pixel at city zoom — one marker lands exactly on top of the
     * other and the owner cannot see the second person is there at all.
     *
     * Grouping by a coarse geographic key and fanning the group out by a fixed
     * pixel offset keeps them legible at every zoom, which a geographic nudge
     * would not.
     */
    const placed = crew.filter((c) => c.position)
    const clusters = new Map<string, typeof placed>()
    for (const state of placed) {
      // ~55 m cells: close enough to overlap, coarse enough not to split a site.
      const key = `${state.position!.lat.toFixed(3)},${state.position!.lng.toFixed(3)}`
      const group = clusters.get(key)
      if (group) group.push(state)
      else clusters.set(key, [state])
    }

    for (const group of clusters.values()) {
      group.forEach((state, i) => {
        let offset: [number, number] = [0, 18]
        if (group.length > 1) {
          // A fan above the point, centred, so the site label stays readable.
          const spread = 30
          const x = (i - (group.length - 1) / 2) * spread
          offset = [x, 18 - Math.abs(x) * 0.25]
        }
        upsert(
          `worker:${state.worker.id}`,
          [state.position!.lng, state.position!.lat],
          workerMarkerEl(state, selectedId === state.worker.id),
          () => select.current(state.worker.id),
          offset,
        )
      })
    }

    for (const [key, marker] of markers.current) {
      if (!live.has(key)) {
        marker.remove()
        markers.current.delete(key)
      }
    }
  }, [sites, crew, selectedId])

  // Frame the sites only on a first visit. Once someone has moved the map,
  // their view is restored above and yanking it back would be the bug.
  useEffect(() => {
    const m = map.current
    if (!m || centred.current || sites.length === 0) return
    centred.current = true
    if (saved.current) return

    if (sites.length === 1) {
      m.jumpTo({ center: [sites[0].center.lng, sites[0].center.lat], zoom: 14 })
      return
    }
    const bounds = new LngLatBounds()
    for (const s of sites) bounds.extend([s.center.lng, s.center.lat])
    // No animation: on a cold load this is the opening view, not a transition.
    m.fitBounds(bounds, { padding: 120, maxZoom: 15, duration: 0 })
  }, [sites])

  useImperativeHandle(
    handleRef,
    () => ({
      zoomIn: () => map.current?.zoomIn(),
      zoomOut: () => map.current?.zoomOut(),
      fitSites: () => {
        const m = map.current
        if (!m || sites.length === 0) return
        if (sites.length === 1) {
          m.flyTo({ center: [sites[0].center.lng, sites[0].center.lat], zoom: 15 })
          return
        }
        const b = new LngLatBounds()
        for (const s of sites) b.extend([s.center.lng, s.center.lat])
        m.fitBounds(b, { padding: 120, maxZoom: 15 })
      },
      toggleFullscreen: () => {
        const el = container.current?.parentElement ?? container.current
        if (!el) return
        if (document.fullscreenElement) void document.exitFullscreen()
        else void el.requestFullscreen?.()
      },
    }),
    [sites],
  )

  return <div ref={container} style={{ width: '100%', height: '100%' }} />
})
