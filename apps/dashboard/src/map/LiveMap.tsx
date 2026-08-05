import { Circle, Map, Polyline } from '@vis.gl/react-google-maps'
import type { JobSite, WorkerState } from '../types'
import { mapCenter } from '../data/seed'
import { theme } from '../theme'
import { SiteMarker, WorkerMarker } from './markers'

/**
 * Advanced Markers require a map ID. `DEMO_MAP_ID` works for development;
 * create a real one in the Cloud Console and apply the style from
 * `mapStyle.json` there — when a mapId is set, the JS `styles` option is
 * ignored, so basemap styling has to live in the console.
 */
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string) || 'DEMO_MAP_ID'

interface LiveMapProps {
  sites: JobSite[]
  crew: WorkerState[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

/**
 * COST NOTE: every mount of <Map> is one billable Dynamic Maps load, and
 * Google retired the universal $200/month credit in March 2025. This component
 * is mounted once for the life of the session and never keyed or unmounted —
 * navigating away hides it with CSS instead. Moving markers costs nothing.
 * See MAPS.md at the repo root.
 */
export function LiveMap({ sites, crew, selectedId, onSelect }: LiveMapProps) {
  const countOnSite = (siteId: string) =>
    crew.filter((c) => c.siteId === siteId && c.status === 'on_clock').length

  const trailFor = crew.find(
    (c) => c.worker.id === selectedId && c.trail.length > 1,
  )

  return (
    <Map
      mapId={MAP_ID}
      defaultCenter={mapCenter}
      defaultZoom={13}
      gestureHandling="greedy"
      disableDefaultUI
      clickableIcons={false}
      onClick={() => onSelect(null)}
      style={{ width: '100%', height: '100%' }}
    >
      {sites.map((site) => (
        <Circle
          key={`fence-${site.id}`}
          center={site.center}
          radius={site.radiusM}
          strokeColor={site.status === 'starting_soon' ? theme.inkFaint : theme.accent}
          strokeOpacity={0.55}
          strokeWeight={1}
          fillColor={site.status === 'starting_soon' ? theme.inkFaint : theme.accent}
          fillOpacity={0.12}
          clickable={false}
        />
      ))}

      {trailFor && (
        <Polyline
          path={trailFor.trail}
          strokeColor={theme.accent}
          strokeOpacity={0}
          icons={[
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 0.9,
                strokeWeight: 2,
                scale: 2,
              },
              offset: '0',
              repeat: '11px',
            },
          ]}
        />
      )}

      {sites.map((site) => (
        <SiteMarker
          key={site.id}
          site={site}
          onSite={countOnSite(site.id)}
          selected={selectedId === site.id}
          onSelect={onSelect}
        />
      ))}

      {crew.map((state) => (
        <WorkerMarker
          key={state.worker.id}
          state={state}
          selected={selectedId === state.worker.id}
          onSelect={onSelect}
        />
      ))}
    </Map>
  )
}
