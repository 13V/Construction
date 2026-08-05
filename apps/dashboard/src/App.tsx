import { useMemo, useState } from 'react'
import { APIProvider } from '@vis.gl/react-google-maps'
import { LiveMap } from './map/LiveMap'
import { Sidebar, ToolbarButton, TopBar, type NavItem } from './ui/Chrome'
import { EventLog, Playback, RosterPanel, StatStrip, ToolRail } from './ui/Overlays'
import { SetupNotice } from './ui/SetupNotice'
import { createSimulatedFeed } from './data/simulatedFeed'
import { jobSites } from './data/seed'
import { useCrew } from './state/useCrew'
import { theme } from './theme'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export default function App() {
  // One feed for the life of the session. Swap createSimulatedFeed() for
  // createSupabaseFeed() once phones are reporting — nothing else changes.
  const feed = useMemo(() => createSimulatedFeed({ speed: 90 }), [])
  const snapshot = useCrew(feed)

  const [nav, setNav] = useState<NavItem>('Map')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [speed, setSpeed] = useState(90)
  const [showFences, setShowFences] = useState(true)

  const changeSpeed = (next: number) => {
    setSpeed(next)
    feed.setSpeed?.(next)
  }

  if (!API_KEY) return <SetupNotice />

  const today = new Date(snapshot.now).toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
    <APIProvider apiKey={API_KEY}>
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: theme.appBg,
          color: theme.ink,
          overflow: 'hidden',
        }}
      >
        <TopBar
          toolbar={
            <>
              <ToolbarButton>{today}</ToolbarButton>
              <ToolbarButton
                active={showFences}
                onClick={() => setShowFences((v) => !v)}
              >
                Geofences
              </ToolbarButton>
              <ToolbarButton onClick={() => setSelectedId(null)}>
                Clear selection
              </ToolbarButton>
              <span style={{ marginLeft: 'auto' }} />
              <ToolbarButton>Filter by site</ToolbarButton>
              <ToolbarButton>Export day</ToolbarButton>
            </>
          }
        />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar active={nav} onNavigate={setNav} />

          <main style={{ flex: 1, position: 'relative', minWidth: 0 }}>
            {/*
              The map is mounted once and never unmounted — each mount is a
              billable Dynamic Maps load. Other sections render *over* it.
            */}
            <div style={{ position: 'absolute', inset: 0 }}>
              <LiveMap
                sites={showFences ? jobSites : []}
                crew={snapshot.crew}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>

            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                pointerEvents: 'none',
              }}
            >
              <div style={{ pointerEvents: 'auto' }}>
                <ToolRail />
              </div>
              <div style={{ pointerEvents: 'auto' }}>
                <StatStrip snapshot={snapshot} />
              </div>
            </div>

            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                bottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                alignItems: 'flex-end',
              }}
            >
              <RosterPanel
                snapshot={snapshot}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              <EventLog snapshot={snapshot} />
            </div>

            <div style={{ position: 'absolute', left: 12, bottom: 12 }}>
              <Playback now={snapshot.now} speed={speed} onSpeed={changeSpeed} />
            </div>

            {nav !== 'Map' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(245,246,247,.97)',
                  textAlign: 'center',
                  padding: 24,
                }}
              >
                <div style={{ maxWidth: 420 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
                    {nav}
                  </div>
                  <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.55 }}>
                    Not built yet — this MVP slice covers the live map and the
                    geofence engine behind it. The map stays mounted underneath
                    this panel rather than unmounting, because every remount is a
                    billable Google Maps load.
                  </p>
                  <button
                    onClick={() => setNav('Map')}
                    style={{
                      marginTop: 14,
                      padding: '7px 14px',
                      borderRadius: 3,
                      border: 'none',
                      background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
                      color: theme.ink,
                      font: 'inherit',
                      fontSize: 11.5,
                      fontWeight: 700,
                      letterSpacing: '.04em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Back to map
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </APIProvider>
  )
}
