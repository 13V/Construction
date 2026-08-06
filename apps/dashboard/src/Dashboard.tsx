import { useState } from 'react'
import type { ReactNode } from 'react'
import { LiveMap } from './map/LiveMap'
import { Sidebar, ToolbarButton, TopBar, type NavItem } from './ui/Chrome'
import { EventLog, RosterPanel, StatStrip, ToolRail } from './ui/Overlays'
import { Timesheets } from './ui/Timesheets'
import { JobSites, type JobSiteDraft } from './ui/JobSites'
import { Crew } from './ui/Crew'
import { Schedule } from './ui/Schedule'
import { SiteFiles } from './ui/SiteFiles'
import { Expenses } from './ui/Expenses'
import { DailyLogs } from './ui/DailyLogs'
import { Chat } from './ui/Chat'
import { Equipment } from './ui/Equipment'
import { Safety } from './ui/Safety'
import { useLive } from './data/useLive'
import { supabase, type WorkerRow } from './data/supabase'
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

  // Every feature screen takes the same props, so adding one is a single entry.
  const featureProps = {
    me,
    sites: live.sites,
    workers: live.workers,
    onChanged: live.refresh,
  }

  const SCREENS: Partial<Record<NavItem, ReactNode>> = {
    Schedule: <Schedule {...featureProps} />,
    Timesheets: <Timesheets {...featureProps} />,
    'Photos & Docs': <SiteFiles {...featureProps} />,
    Expenses: <Expenses {...featureProps} />,
    'Daily Logs': <DailyLogs {...featureProps} />,
    Chat: <Chat {...featureProps} />,
    Equipment: <Equipment {...featureProps} />,
    Safety: <Safety {...featureProps} />,
    Crew: (
      <Crew
        snapshot={live}
        roster={live.roster}
        companyId={me.company_id}
        canEdit={me.is_office}
        onSaved={live.refresh}
      />
    ),
  }

  const screen = SCREENS[nav]

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
            {nav === 'Map' && (
              <>
                <ToolbarButton active={showFences} onClick={() => setShowFences((v) => !v)}>
                  Geofences
                </ToolbarButton>
                <ToolbarButton onClick={() => setSelectedId(null)}>
                  Clear selection
                </ToolbarButton>
              </>
            )}
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
            The map is mounted once and never unmounted. Other screens render
            over it, so switching sections never re-initialises the map or
            refetches tiles.
          */}
          <div style={{ position: 'absolute', inset: 0 }}>
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

              {!live.loading && live.sites.length === 0 && (
                <NoSites onGo={() => setNav('Job Sites')} />
              )}
            </>
          )}

          {screen && (
            <div style={{ position: 'absolute', inset: 0, background: theme.appBg }}>
              {screen}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function NoSites({ onGo }: { onGo: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(245,246,247,.97)',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          No job sites yet
        </div>
        <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.55 }}>
          Add your first site and drop a geofence on the map. Crew start clocking
          in automatically as soon as a site exists and their phone reports in.
        </p>
        <button
          onClick={onGo}
          style={{
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
          }}
        >
          ADD A JOB SITE
        </button>
      </div>
    </div>
  )
}
