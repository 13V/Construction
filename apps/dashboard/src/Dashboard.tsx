import { useState } from 'react'
import { LiveMap } from './map/LiveMap'
import { Sidebar, ToolbarButton, TopBar, type NavItem } from './ui/Chrome'
import { EventLog, RosterPanel, StatStrip, ToolRail } from './ui/Overlays'
import { Timesheets } from './ui/Timesheets'
import { JobSites, type JobSiteDraft } from './ui/JobSites'
import { Crew } from './ui/Crew'
import { useLive } from './data/useLive'
import { supabase, type WorkerRow } from './data/supabase'
import { mapsConfigured } from './config'
import { theme } from './theme'

export function Dashboard({ me }: { me: WorkerRow }) {
  const live = useLive()

  const [nav, setNav] = useState<NavItem>('Map')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showFences, setShowFences] = useState(true)
  const [draft, setDraft] = useState<JobSiteDraft | null>(null)

  const editingSites = nav === 'Job Sites' && draft !== null

  const today = new Date(live.now).toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  return (
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
        company={live.companyName}
        userName={me.name}
        onSignOut={() => void supabase().auth.signOut()}
        toolbar={
          <>
            <ToolbarButton>{today}</ToolbarButton>
            <ToolbarButton active={showFences} onClick={() => setShowFences((v) => !v)}>
              Geofences
            </ToolbarButton>
            <ToolbarButton onClick={() => setSelectedId(null)}>
              Clear selection
            </ToolbarButton>
            <span style={{ marginLeft: 'auto' }} />
            {live.error ? (
              <span style={{ fontSize: 12, color: theme.alert }}>{live.error}</span>
            ) : (
              <span style={{ fontSize: 11.5, color: theme.inkSoft }}>
                {live.loading ? 'Loading…' : 'Live'}
              </span>
            )}
            <ToolbarButton onClick={live.refresh}>Refresh</ToolbarButton>
          </>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar active={nav} sites={live.sites} onNavigate={setNav} />

        {nav === 'Job Sites' && (
          <JobSites
            sites={live.sites}
            draft={draft}
            onDraftChange={setDraft}
            onSaved={live.refresh}
            canEdit={me.is_office}
          />
        )}

        <main style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {/*
            Mounted once and never unmounted — each mount is a billable Dynamic
            Maps load. Other sections render over or beside it.
          */}
          <div style={{ position: 'absolute', inset: 0 }}>
            {!mapsConfigured ? (
              <MapUnavailable />
            ) : (
            <LiveMap
              sites={live.sites}
              crew={live.crew}
              selectedId={selectedId}
              onSelect={setSelectedId}
              showFences={showFences}
              draft={
                editingSites && draft?.center
                  ? { center: draft.center, radiusM: draft.radiusM }
                  : null
              }
              onPick={
                editingSites
                  ? (at) => setDraft((d) => (d ? { ...d, center: at } : d))
                  : undefined
              }
            />
            )}
          </div>

          {nav === 'Map' && (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <ToolRail />
                <StatStrip snapshot={live} />
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
                  snapshot={live}
                  sites={live.sites}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
                <EventLog snapshot={live} />
              </div>

              {!live.loading && live.sites.length === 0 && <NoSites onGo={() => setNav('Job Sites')} />}
            </>
          )}

          {nav === 'Timesheets' && (
            <div style={{ position: 'absolute', inset: 0, background: theme.appBg }}>
              <Timesheets snapshot={live} sites={live.sites} />
            </div>
          )}

          {nav === 'Crew' && (
            <div style={{ position: 'absolute', inset: 0, background: theme.appBg }}>
              <Crew
                snapshot={live}
                roster={live.roster}
                companyId={me.company_id}
                canEdit={me.is_office}
                onSaved={live.refresh}
              />
            </div>
          )}

          {nav !== 'Map' &&
            nav !== 'Timesheets' &&
            nav !== 'Job Sites' &&
            nav !== 'Crew' && (
              <div style={panelOverlay}>
                <div style={{ maxWidth: 420, textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{nav}</div>
                  <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.55 }}>
                    Not built yet. This release covers the live map, job sites and
                    geofences, crew, the timesheets they produce, and the worker app
                    at <code>/worker</code>.
                  </p>
                  <button onClick={() => setNav('Map')} style={cta}>
                    BACK TO MAP
                  </button>
                </div>
              </div>
            )}
        </main>
      </div>
    </div>
  )
}

function MapUnavailable() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          Map not configured
        </div>
        <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.55 }}>
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> in Vercel and redeploy. Everything
          else works without it — crew, timesheets and job sites by address. Geofences
          still run server-side, so clock-ins keep working.
        </p>
      </div>
    </div>
  )
}

function NoSites({ onGo }: { onGo: () => void }) {
  return (
    <div style={panelOverlay}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          No job sites yet
        </div>
        <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.55 }}>
          Add your first site and drop a geofence on the map. Crew start clocking
          in automatically as soon as a site exists and their phone reports in.
        </p>
        <button onClick={onGo} style={cta}>
          ADD A JOB SITE
        </button>
      </div>
    </div>
  )
}

const panelOverlay = {
  position: 'absolute' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(245,246,247,.97)',
  padding: 24,
}

const cta = {
  marginTop: 14,
  padding: '8px 15px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}
