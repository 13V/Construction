import { AdvancedMarker } from '@vis.gl/react-google-maps'
import type { JobSite, WorkerState } from '../types'
import { statusColor, theme } from '../theme'

const metresToFeet = (m: number) => Math.round((m * 3.28084) / 50) * 50

interface SiteMarkerProps {
  site: JobSite
  onSite: number
  selected: boolean
  onSelect: (id: string) => void
}

export function SiteMarker({ site, onSite, selected, onSelect }: SiteMarkerProps) {
  const dim = site.status === 'starting_soon'

  return (
    <AdvancedMarker
      position={site.center}
      zIndex={selected ? 40 : 20}
      onClick={() => onSelect(site.id)}
      title={site.address}
    >
      <div
        style={{
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '5px 9px 5px 6px',
          borderRadius: 6,
          background: theme.panel,
          border: `1px solid ${selected ? theme.accent : theme.border}`,
          boxShadow: '0 1px 4px rgba(0,0,0,.18)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          opacity: dim ? 0.75 : 1,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dim ? theme.inkFaint : theme.accent,
          }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>{site.name}</span>
          <span style={{ fontSize: 10.5, color: theme.inkSoft }}>
            {metresToFeet(site.radiusM)} ft ·{' '}
            {dim ? 'starts Mon' : `${onSite} on site`}
          </span>
        </span>
      </div>
    </AdvancedMarker>
  )
}

interface WorkerMarkerProps {
  state: WorkerState
  selected: boolean
  onSelect: (id: string) => void
}

export function WorkerMarker({ state, selected, onSelect }: WorkerMarkerProps) {
  if (!state.position) return null
  const ring = statusColor[state.status] ?? theme.inkFaint

  return (
    <AdvancedMarker
      position={state.position}
      zIndex={selected ? 60 : state.status === 'exception' ? 50 : 30}
      onClick={() => onSelect(state.worker.id)}
      title={`${state.worker.name} — ${state.worker.trade}`}
    >
      <div style={{ position: 'relative', cursor: 'pointer' }}>
        {state.status === 'arriving' && (
          <span
            style={{
              position: 'absolute',
              inset: -4,
              borderRadius: '50%',
              border: `2px solid ${theme.accent}`,
              animation: 'cl-ping 1.8s cubic-bezier(0,0,.2,1) infinite',
            }}
          />
        )}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: theme.railSoft,
            color: '#fff',
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '.02em',
            border: `2.5px solid ${ring}`,
            boxShadow: selected
              ? `0 0 0 3px ${theme.accentFill}, 0 1px 4px rgba(0,0,0,.3)`
              : '0 1px 4px rgba(0,0,0,.3)',
          }}
        >
          {state.worker.initials}
        </span>
        {state.exception && (
          <span
            style={{
              position: 'absolute',
              right: -3,
              bottom: -3,
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: theme.alert,
              border: '2px solid #fff',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '9px',
              textAlign: 'center',
            }}
          >
            !
          </span>
        )}
      </div>
    </AdvancedMarker>
  )
}
