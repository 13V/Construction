import { useMemo } from 'react'
import { AdvancedMarker, Circle, Map, Polyline } from '@vis.gl/react-google-maps'
import type { JobSite, LatLng, WorkerState } from '../types'
import { DEFAULT_CENTER } from '../data/seed'
import { theme } from '../theme'
import { SiteMarker, WorkerMarker } from './markers'

import { MAPS_MAP_ID } from '../config'

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
  /** Geofence being placed on the Job Sites screen. */
  draft?: DraftFence | null
  /** When set, clicking the map reports coordinates instead of clearing selection. */
  onPick?: (at: LatLng) => void
}

/**
 * COST NOTE: every mount of <Map> is one billable Dynamic Maps load, and
 * Google retired the universal $200/month credit in March 2025. This component
 * is mounted once for the life of the session and never keyed or unmounted —
 * navigating away hides it or renders beside it. Moving markers costs nothing,
 * which is also why placing a job site reuses this map rather than opening a
 * second one. See MAPS.md at the repo root.
 */
export function LiveMap({
  sites,
  crew,
  selectedId,
  onSelect,
  showFences,
  draft,
  onPick,
}: LiveMapProps) {
  // Only used on first mount — the map is uncontrolled after that, so later
  // site changes never yank the viewport out from under the user.
  const initialCenter = useMemo(() => {
    if (sites.length === 0) return DEFAULT_CENTER
    return {
      lat: sites.reduce((sum, s) => sum + s.center.lat, 0) / sites.length,
      lng: sites.reduce((sum, s) => sum + s.center.lng, 0) / sites.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites.length > 0])

  const countOnSite = (siteId: string) =>
    crew.filter((c) => c.siteId === siteId && c.status === 'on_clock').length

  const trailFor = crew.find((c) => c.worker.id === selectedId && c.trail.length > 1)

  return (
    <Map
      mapId={MAPS_MAP_ID}
      defaultCenter={initialCenter}
      defaultZoom={13}
      gestureHandling="greedy"
      disableDefaultUI
      clickableIcons={false}
      onClick={(event) => {
        const at = event.detail.latLng
        if (onPick && at) onPick({ lat: at.lat, lng: at.lng })
        else onSelect(null)
      }}
      style={{ width: '100%', height: '100%' }}
    >
      {showFences &&
        sites.map((site) => (
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

      {draft && (
        <>
          <Circle
            center={draft.center}
            radius={draft.radiusM}
            strokeColor={theme.ctaTo}
            strokeOpacity={0.95}
            strokeWeight={2}
            fillColor={theme.ctaTo}
            fillOpacity={0.18}
            clickable={false}
          />
          <AdvancedMarker position={draft.center} zIndex={80}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: theme.ctaTo,
                border: '2px solid #fff',
                boxShadow: '0 1px 4px rgba(0,0,0,.35)',
              }}
            />
          </AdvancedMarker>
        </>
      )}

      {trailFor && (
        <Polyline
          path={trailFor.trail}
          strokeColor={theme.accent}
          strokeOpacity={0}
          icons={[
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeWeight: 2, scale: 2 },
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
