import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AuthScreen } from '../auth/AuthScreen'
import { useSession } from '../auth/useSession'
import { api } from '../data/api'
import { supabase, supabaseConfigured } from '../data/supabase'
import type {
  AssignmentRow,
  ChannelRow,
  MessageRow,
  NotificationRow,
  ShiftCorrectionRow,
  ShiftRow,
  TimeOffRow,
  WorkerRow,
} from '../data/supabase'
import { BUCKET_FILES, BUCKET_RECEIPTS, objectPath, uploadFile } from '../data/storage'
import { DWELL_IN_MS, type DwellPhase } from '../geofence/dwell'
import { distanceM } from '../geofence/geo'
import { backend, backendNote, startWatching, type LocationWatch } from './location'
import { clockTime, dayDate, shortDate } from '../format'
import { HoursTab } from './HoursTab'
import { DailyLogScreen } from './DailyLogScreen'
import { useSites } from './useSites'
import { PlansScreen } from './PlansScreen'
import { SafetyScreen } from './SafetyScreen'
import { PhotosTab } from './PhotosTab'
import { theme } from '../theme'
import type { LatLng } from '../types'

/**
 * The worker's phone — ported screen-for-screen from
 * design/screens/isClockin.html (the clock-in / on-the-clock story) and
 * design/screens/isCrewMobile.html (the wider crew app: jobs, photos, chat).
 *
 * Those two files are spec documents, not app code: the dark phone bezel,
 * the fake iOS status bar (6:39, signal, battery) and the marketing chrome
 * ("← Back to map", "iPhone 14 · 390 × 844", the numbered step badges) are
 * the design tool's own presentation frame for showing many states side by
 * side. This component renders in a real mobile browser that already draws
 * its own status bar, so only what was *inside* each mock phone screen —
 * the header row, body and footer that make up Crewline itself — is ported
 * here; the frame around it is not.
 *
 * Every fix goes to /api/ping, and the phase (and events) the server
 * returns is what gets displayed — the phone never decides its own hours.
 * Mobile web only reports while the page is open; reliable background
 * tracking needs the native app.
 */

const PING_INTERVAL_MS = 20_000

// How long the "Clocked in" celebration (isClockin step 3 — the moment it
// happens) holds before handing off to the ongoing "On the clock" screen
// (step 4). The design draws these as two separate screens; here they're
// the same server phase ('onsite') with a timed handoff between the two
// renderings of it, triggered by a real clock_in event from /api/ping.
const CELEBRATION_MS = 6_000

/**
 * Colours the design uses that src/theme.ts doesn't define. theme.ts turns
 * out to already match the design almost hue-for-hue (same source palette),
 * so this is just the handful of extra shades the two mobile screens
 * introduce — kept local rather than widening a shared file for one screen.
 */
const design = {
  faint: '#8B9096',
  hairline: '#EDEFF1',
  mid: '#4A5057',
  muted: '#B7BCC2',
  greenBg: '#EAF7EC',
  greenFg: '#1B7A2C',
  ctaBorder: '#E0A032',
  redBg: '#FDECEE',
  redFg: '#A00417',
  redBorder: '#F3C4CB',
  wash: '#FAFBFC',
  amberBg: '#FFF9E8',
  amberFg: '#8A6100',
  calloutFg: '#0A4E9E',
  ringSoft: '#BBD9FF',
  mapBg: '#E9ECEE',
  mapBlock: '#E2E6EA',
  texA: '#E4E7EA',
  texB: '#DADEE2',
} as const

interface ServerSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

interface PingEvent {
  kind: 'clock_in' | 'clock_out' | 'drive_by_rejected'
  siteId: string
  at: number
}

interface PingResponse {
  phase: DwellPhase
  sites: ServerSite[]
  events: PingEvent[]
  /** Things the worker needs telling that aren't a clock event — e.g. why a
   *  manual clock-in was refused, or that an earlier shift never closed. */
  notes: string[]
}

export function WorkerApp() {
  const { loading, session, me } = useSession()

  if (!supabaseConfigured) {
    return <Notice title="Not configured">This build has no Supabase credentials.</Notice>
  }
  if (loading) return <Notice title="Loading…">One moment.</Notice>
  if (!session) return <AuthScreen />
  if (!me) {
    return (
      <Notice title="Not linked to a company">
        Ask your office to add you to the crew list, then sign in again.
      </Notice>
    )
  }

  return <Tracker me={me} />
}

// ============================================================== the tracker

type PanelScreen = 'photo' | 'receipt' | 'chat' | 'schedule' | 'correction' | 'timeoff' | 'safety' | 'plans' | 'dailylog'
type Screen = 'tracker' | PanelScreen

/**
 * Four tabs that persist, per Crewline Mobile screen 3.
 *
 * The six-tile grid this replaces was all one-way trips: you went in, you came
 * back. There was no persistent home for Time or Photos, so a worker checking
 * their hours on payday had to remember which tile it was — and Photos was not
 * reachable at all, because the gallery did not exist.
 */
type Tab = 'jobs' | 'time' | 'photos' | 'chat'

interface Celebration {
  siteId: string
  at: number
  /** Metres inside the fence at clock-in, if a fix was available for that ping. */
  marginM: number | null
}

function Tracker({ me }: { me: WorkerRow }) {
  const [fix, setFix] = useState<{ pos: LatLng; accuracyM: number } | null>(null)
  const [phase, setPhase] = useState<DwellPhase>({ kind: 'offsite' })
  const [sites, setSites] = useState<ServerSite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [tick, setTick] = useState(Date.now())
  const [tracking, setTracking] = useState(false)
  const [screen, setScreen] = useState<Screen>('tracker')
  const [tab, setTab] = useState<Tab>('jobs')
  const [celebration, setCelebration] = useState<Celebration | null>(null)
  const [clockOutConfirm, setClockOutConfirm] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [showAccount, setShowAccount] = useState(false)

  const lastSent = useRef(0)
  const pending = useRef<Array<{ lat: number; lng: number; accuracyM: number; at: number }>>([])

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // The celebration is a timed handoff, not a screen the worker navigates —
  // it clears itself so "on the clock" (step 4) always takes over eventually
  // even if nobody taps "View today".
  useEffect(() => {
    if (!celebration) return
    const t = window.setTimeout(() => setCelebration(null), CELEBRATION_MS)
    return () => window.clearTimeout(t)
  }, [celebration])

  const send = useCallback(async (body: { lat: number; lng: number; accuracyM: number; at: number; manual?: boolean }) => {
    const { data } = await supabase().auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Session expired — sign in again.')

    const res = await fetch(api('/api/ping'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Server returned ${res.status}`)
    }
    const payload = (await res.json()) as PingResponse
    setPhase(payload.phase)
    setSites(payload.sites)
    setError(null)

    // The server is the only thing allowed to decide a clock-in happened —
    // this just notices it did, from the same response, to time the
    // celebration screen. Using this ping's own coordinates (not a possibly
    // stale `fix`) keeps "GPS put you N ft inside the fence" honest.
    const clockIn = payload.events.find((e) => e.kind === 'clock_in')
    if (clockIn) {
      const clockedSite = payload.sites.find((s) => s.id === clockIn.siteId)
      const marginM = clockedSite
        ? Math.round(clockedSite.radiusM - distanceM({ lat: body.lat, lng: body.lng }, clockedSite))
        : null
      setCelebration({ siteId: clockIn.siteId, at: clockIn.at, marginM })
    }
    // Returned so a deliberate tap (manual clock-in) can tell whether it
    // actually produced a clock-in or was refused, rather than guessing from
    // side effects the way the passive 20-second loop can afford to.
    return payload
  }, [])

  const onFix = useCallback(
    (pos: LatLng, accuracyM: number) => {
      setFix({ pos, accuracyM })
      const at = Date.now()
      if (at - lastSent.current < PING_INTERVAL_MS) return
      lastSent.current = at

      const body = { lat: pos.lat, lng: pos.lng, accuracyM, at }
      // Sites lose signal constantly. Queue and drain rather than lose fixes.
      const backlog = [...pending.current, body]
      pending.current = []
      setQueued(0)

      void (async () => {
        for (const item of backlog) {
          try {
            await send(item)
          } catch (err) {
            pending.current.push(item)
            setQueued(pending.current.length)
            setError(err instanceof Error ? err.message : String(err))
            return
          }
        }
      })()
    },
    [send],
  )

  useEffect(() => {
    if (!tracking) return
    let watch: LocationWatch | null = null
    let cancelled = false

    void startWatching(
      (f) => onFix({ lat: f.lat, lng: f.lng }, f.accuracyM),
      (message) => setError(message),
    ).then((w) => {
      // The effect can be torn down while the native watcher is still being
      // registered; without this the watcher outlives the screen.
      if (cancelled) w.stop()
      else watch = w
    })

    return () => {
      cancelled = true
      watch?.stop()
    }
  }, [tracking, onFix])

  // "Clock in manually" is not a client-side clock — RLS and the
  // shifts_worker_guard trigger refuse a direct insert, correctly, because a
  // phone must never be the system of record for its own hours. What the tap
  // does is send the same ping the 20-second loop sends, flagged `manual:
  // true` so the server treats it as a deliberate request rather than
  // passive tracking: still refused outside a site's fence, but not made to
  // wait out the two-minute settle window inside one.
  const manualClockIn = useCallback(async () => {
    if (!fix) {
      setNote("No GPS fix yet — wait a few seconds for the location dot to steady, then try again.")
      return
    }
    setNote(null)
    try {
      const payload = await send({ lat: fix.pos.lat, lng: fix.pos.lng, accuracyM: fix.accuracyM, at: Date.now(), manual: true })
      const clockedIn = payload.events.some((e) => e.kind === 'clock_in')
      if (!clockedIn) {
        // The server is the one that knows why, and should always say so via
        // `notes` when it refuses a manual request — this generic line is
        // only a fallback for a response that reached here without one.
        setNote(payload.notes[0] ?? "That didn't clock you in — make sure you're inside the site's boundary and try again.")
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }, [fix, send])

  // The one thing this tap really does: stop sending location. It does NOT
  // write a clock-out — only the geofence (server-side, via /api/ping) may
  // do that, and RLS blocks a field worker from writing shifts/dwell_state
  // directly. If they're still standing inside the fence, the shift they
  // already have stays open and correctly resumes if they start tracking
  // again; the honest promise here is "stop sharing my location," not
  // "end my paid shift," so it's never offered under the CLOCK OUT label
  // without this explanation alongside it.
  function stopTracking() {
    setTracking(false)
    setClockOutConfirm(false)
    setCelebration(null)
    setScreen('tracker')
  }

  const currentSiteId = phase.kind === 'offsite' ? null : phase.siteId
  const site = currentSiteId ? sites.find((s) => s.id === currentSiteId) ?? null : null
  const onClock = phase.kind === 'onsite' || phase.kind === 'departing'
  const elapsed = onClock ? Math.max(0, tick - phase.since) : 0
  const confirming = phase.kind === 'arriving'
  const confirmMs = confirming ? Math.max(0, DWELL_IN_MS - (tick - phase.since)) : 0

  const nearest =
    fix && sites.length
      ? sites.map((s) => ({ s, d: distanceM(fix.pos, { lat: s.lat, lng: s.lng }) })).sort((a, b) => a.d - b.d)[0]
      : null

  const celebrationSite = celebration ? sites.find((s) => s.id === celebration.siteId) ?? null : null

  return (
    <div
      style={{
        height: '100dvh',
        minHeight: '100vh',
        maxWidth: 480,
        margin: '0 auto',
        background: theme.panel,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        color: theme.ink,
        font: '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      }}
    >
      {/* cl-ping is already defined globally (src/index.css) for the map's
          arrival pulse; cl-spin is only used on this screen, so it's scoped
          here instead of widening a shared stylesheet for one file. */}
      <style>{'@keyframes cl-spin { to { transform: rotate(360deg); } }'}</style>

      {queued > 0 && <OfflineBanner text={`Offline — ${queued} location${queued === 1 ? '' : 's'} waiting to sync`} />}

      {screen === 'photo' && (
        <PhotoScreen me={me} currentSiteId={currentSiteId} sites={sites} fix={fix} onClose={() => setScreen('tracker')} />
      )}
      {screen === 'receipt' && (
        <ReceiptScreen me={me} currentSiteId={currentSiteId} sites={sites} onClose={() => setScreen('tracker')} />
      )}
      {screen === 'schedule' && <ScheduleScreen me={me} onClose={() => setScreen('tracker')} />}
      {screen === 'correction' && (
        <CorrectionScreen me={me} onClose={() => setScreen('tracker')} />
      )}
      {screen === 'timeoff' && <TimeOffScreen me={me} onClose={() => setScreen('tracker')} />}
      {screen === 'dailylog' && (
        <DailyLogScreen me={me} siteId={currentSiteId} onClose={() => setScreen('tracker')} />
      )}
      {screen === 'plans' && (
        <PlansScreen
          me={me}
          siteId={currentSiteId}
          siteName={sites.find((s) => s.id === currentSiteId)?.name ?? 'this site'}
          onClose={() => setScreen('tracker')}
        />
      )}
      {screen === 'safety' && (
        <SafetyScreen
          me={me}
          siteId={currentSiteId}
          siteName={sites.find((s) => s.id === currentSiteId)?.name ?? 'this site'}
          onClose={() => setScreen('tracker')}
        />
      )}
      {screen === 'chat' && (
        <ChatScreen me={me} currentSiteId={currentSiteId} sites={sites} onClose={() => setScreen('tracker')} />
      )}

      {screen === 'tracker' && tab === 'photos' && (
        <PhotosTab
          me={me}
          sites={sites}
          activeSiteId={currentSiteId}
          onTakePhoto={() => setScreen('photo')}
        />
      )}

      {screen === 'tracker' && tab === 'chat' && (
        <ChatScreen me={me} currentSiteId={currentSiteId} sites={sites} onClose={() => setTab('jobs')} />
      )}

      {screen === 'tracker' && tab === 'time' && <HoursTab me={me} sites={sites} />}

      {screen === 'tracker' && tab === 'jobs' && (
        <>
          {!tracking ? (
            <GateScreen
              me={me}
              onShowAccount={() => setShowAccount(true)}
              onStart={() => setTracking(true)}
              onOpenPanel={(k) => setScreen(k)}
            />
          ) : celebration ? (
            <CelebrationScreen
              me={me}
              siteName={celebrationSite?.name ?? 'the site'}
              at={celebration.at}
              marginM={celebration.marginM}
              onDismiss={() => setCelebration(null)}
              onFixPunch={() => {
                setCelebration(null)
                setScreen('correction')
              }}
            />
          ) : onClock && site ? (
            <OnClockScreen
              site={site}
              since={phase.kind === 'onsite' || phase.kind === 'departing' ? phase.since : tick}
              elapsedMs={elapsed}
              onOpenPanel={(k) => setScreen(k)}
              clockOutConfirm={clockOutConfirm}
              onClockOutTap={() => setClockOutConfirm(true)}
              onClockOutCancel={() => setClockOutConfirm(false)}
              onStopTracking={stopTracking}
              onShowAccount={() => setShowAccount(true)}
            />
          ) : confirming && site ? (
            <ConfirmingScreen
              me={me}
              site={site}
              remainingMs={confirmMs}
              onShowAccount={() => setShowAccount(true)}
              onOpenPanel={(k) => setScreen(k)}
            />
          ) : (
            <ApproachingScreen
              me={me}
              nearest={nearest}
              hasSites={sites.length > 0}
              note={note}
              onDismissNote={() => setNote(null)}
              onShowAccount={() => setShowAccount(true)}
              onManualClockIn={() => void manualClockIn()}
              onOpenPanel={(k) => setScreen(k)}
            />
          )}

          {error && <Banner tone="error">{error}</Banner>}

          {showAccount && <AccountSheet me={me} onClose={() => setShowAccount(false)} />}
        </>
      )}

      {/* The bar is the app. It shows on every tab and never on a panel that
          was opened from one — a panel is a trip you come back from. */}
      {screen === 'tracker' && <TabBar active={tab} unread={0} onPick={setTab} />}
    </div>
  )
}

function TabBar({
  active,
  unread,
  onPick,
}: {
  active: Tab
  unread: number
  onPick: (t: Tab) => void
}) {
  const items: Array<{ key: Tab; label: string; icon: (c: string) => ReactNode }> = [
    { key: 'jobs', label: 'Jobs', icon: (c) => <FolderIcon color={c} /> },
    { key: 'time', label: 'Time', icon: (c) => <ClockTabIcon color={c} /> },
    { key: 'photos', label: 'Photos', icon: (c) => <CameraIcon color={c} size={22} /> },
    { key: 'chat', label: 'Chat', icon: (c) => <ChatBubbleIcon color={c} size={22} /> },
  ]
  return (
    <div
      style={{
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        borderTop: `1px solid ${theme.border}`,
        background: theme.panel,
        // 56px plus the home-indicator inset, per the design note.
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {items.map((it) => {
        const on = active === it.key
        const colour = on ? theme.accent : theme.inkFaint
        return (
          <button
            key={it.key}
            onClick={() => onPick(it.key)}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              height: 56,
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            {it.icon(colour)}
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, color: colour }}>{it.label}</span>
            {it.key === 'chat' && unread > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 'calc(50% + 6px)',
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: theme.alert,
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unread}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function FolderIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2.2h9.2A1.5 1.5 0 0 1 21 9.7v7.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  )
}

function ClockTabIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.1 1.9" strokeLinecap="round" />
    </svg>
  )
}

// ================================================================== shared

function AccountSheet({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(26,29,33,.45)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 10,
      }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', background: theme.panel, borderRadius: '14px 14px 0 0', padding: '22px 20px 28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: theme.rail,
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {me.initials}
          </span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{me.name}</div>
            <div style={{ fontSize: 13, color: design.faint }}>{me.trade}</div>
          </div>
        </div>
        <button onClick={() => void supabase().auth.signOut()} style={{ ...ctaWhite(50), marginTop: 20 }}>
          Sign out
        </button>
        <button onClick={onClose} style={{ ...ctaGhost, marginTop: 10 }}>
          Close
        </button>
      </div>
    </div>
  )
}

function OfflineBanner({ text }: { text: string }) {
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 20px',
        background: design.hairline,
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <WifiOffIcon />
      <span style={{ fontSize: 12.5, fontWeight: 500, color: design.mid }}>{text}</span>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  const c =
    tone === 'warning'
      ? { bg: design.amberBg, fg: design.amberFg, border: '#F2D89A' }
      : tone === 'error'
        ? { bg: design.redBg, fg: design.redFg, border: design.redBorder }
        : tone === 'success'
          ? { bg: design.greenBg, fg: design.greenFg, border: '#B7E3C3' }
          : { bg: theme.accentFill, fg: design.calloutFg, border: '#BBD9FF' }
  return (
    <div
      style={{
        margin: '10px 18px 0',
        padding: '11px 13px',
        borderRadius: 8,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  )
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginTop: 18, display: 'flex', gap: 11, padding: 15, background: theme.accentFill, borderRadius: 8 }}>
      <ClockIcon />
      <span style={{ fontSize: 15, lineHeight: 1.45, color: design.calloutFg }}>{children}</span>
    </div>
  )
}

/** Header used on the three tracking screens (off-clock / arriving / on-clock). */
function TrackerHeader({
  me,
  tone,
  label,
  onAvatarTap,
}: {
  me: WorkerRow
  tone: 'off' | 'amber'
  label: string
  onAvatarTap: () => void
}) {
  const pillBg = tone === 'amber' ? design.amberBg : theme.appBg
  const pillFg = tone === 'amber' ? design.amberFg : theme.inkSoft
  const pillDot = tone === 'amber' ? theme.warning : design.muted
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 20px 12px',
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <button
        onClick={onAvatarTap}
        style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: theme.rail,
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          {me.initials}
        </span>
        <span style={{ fontSize: 17, fontWeight: 600, color: theme.ink }}>Today</span>
      </button>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 11,
          background: pillBg,
          fontSize: 12,
          fontWeight: 600,
          color: pillFg,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: pillDot }} />
        {label}
      </span>
    </div>
  )
}

/** The three-tile action row from isClockin step 4 — reused on every
 *  tracking screen (not just on-the-clock) since a worker can log a photo,
 *  a receipt or a chat message before they've settled in, same as before. */
/**
 * The three things a worker does when they are NOT working: check tomorrow's
 * roster, dispute a punch from a shift that has already ended, and ask for
 * leave. They were originally only on the on-clock screens, which put them
 * out of reach at exactly the times they are wanted.
 */
function OffClockActions({ onOpen }: { onOpen: (screen: PanelScreen) => void }) {
  const tile: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 82,
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 3,
    font: 'inherit',
    cursor: 'pointer',
  }
  return (
    <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
      <button style={tile} onClick={() => onOpen('schedule')}>
        <CalendarIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>My Jobs</span>
      </button>
      <button style={tile} onClick={() => onOpen('correction')}>
        <FixIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Fix a Punch</span>
      </button>
      <button style={tile} onClick={() => onOpen('timeoff')}>
        <LeaveIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Time Off</span>
      </button>
    </div>
  )
}

/**
 * The three things a worker does *at* a job, kept on the clock screen.
 *
 * My Jobs, Fix a Punch and Time Off used to be here too. They are places, not
 * moments, and they now live under the Jobs and Time tabs — a tile was a
 * one-way trip, which is the wrong shape for a screen you check on payday.
 */
function ActionGrid({ onOpen }: { onOpen: (screen: PanelScreen) => void }) {
  const tile: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 82,
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 3,
    font: 'inherit',
    cursor: 'pointer',
  }
  return (
    <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9, padding: '16px 20px' }}>
      <button style={tile} onClick={() => onOpen('photo')}>
        <CameraIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Take Photo</span>
      </button>
      <button style={tile} onClick={() => onOpen('receipt')}>
        <ReceiptIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Upload Receipt</span>
      </button>
      <button style={tile} onClick={() => onOpen('plans')}>
        <SheetIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Plans</span>
      </button>
      <button style={tile} onClick={() => onOpen('safety')}>
        <ShieldIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Safety</span>
      </button>
      <button style={tile} onClick={() => onOpen('dailylog')}>
        <LogIcon />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Daily Log</span>
      </button>
    </div>
  )
}

function LogIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9.5h8M8 13h8M8 16.5h5" strokeLinecap="round" />
    </svg>
  )
}

function SheetIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12.5h6M9 16h4" strokeLinecap="round" />
    </svg>
  )
}

function ShieldIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7}>
      <path d="M12 3.2 19 6v5.4c0 4.2-2.9 7.4-7 9.4-4.1-2-7-5.2-7-9.4V6z" />
      <path d="M8.9 12.2 11.2 14.5 15.4 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Unread notices, shown wherever the worker is. */
function NoticeBanner({ me, onOpen }: { me: WorkerRow; onOpen: () => void }) {
  const [rows, setRows] = useState<NotificationRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await supabase()
        .from('notifications')
        .select('*')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(5)
      if (!cancelled) setRows((data ?? []) as NotificationRow[])
    }
    void load()
    const ch = supabase()
      .channel('worker-notices')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => void load())
      .subscribe()
    return () => {
      cancelled = true
      void supabase().removeChannel(ch)
    }
  }, [me.id])

  if (rows.length === 0) return null

  const dismiss = async () => {
    const stamp = new Date().toISOString()
    const ids = rows.map((r) => r.id)
    setRows([])
    await supabase().from('notifications').update({ read_at: stamp }).in('id', ids)
    onOpen()
  }

  return (
    <button
      onClick={() => void dismiss()}
      style={{
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        margin: '0 20px 12px',
        padding: '11px 13px',
        background: theme.accentFill,
        border: `1px solid ${theme.accent}`,
        borderRadius: 4,
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0A4E9E' }}>{rows[0].title}</span>
      {rows[0].body && <span style={{ fontSize: 12.5, color: '#0A4E9E' }}>{rows[0].body}</span>}
      {rows.length > 1 && (
        <span style={{ fontSize: 11.5, color: '#0A4E9E', opacity: 0.8 }}>
          and {rows.length - 1} more — tap to clear
        </span>
      )}
    </button>
  )
}

function CalendarIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.6" />
      <path d="M3.5 9.8h17M8.2 3v4M15.8 3v4" strokeLinecap="round" />
    </svg>
  )
}

function FixIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4v5l3.2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LeaveIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <path d="M3.6 19.4h16.8" strokeLinecap="round" />
      <path d="M6.4 19.4V9.2l6-3.6 6 3.6v10.2" strokeLinejoin="round" />
      <path d="M10.4 19.4v-4.8h3.2v4.8" strokeLinejoin="round" />
    </svg>
  )
}

/** Header for the three full-screen panels (photo / receipt / chat). */
function ScreenHeader({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 18px 12px',
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <button
        onClick={onCancel}
        style={{ width: 60, border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 14, color: theme.accent, textAlign: 'left', cursor: 'pointer' }}
      >
        Cancel
      </button>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
      <span style={{ width: 60 }} />
    </div>
  )
}

/** The exact preserved privacy line, plus the live GPS readout. Shown on
 *  every tracking-related screen so it's never more than one glance away. */
function PrivacyLine({ fix }: { fix: { pos: LatLng; accuracyM: number } | null }) {
  return (
    <p style={{ fontSize: 12, color: design.faint, textAlign: 'center', lineHeight: 1.5, margin: '10px 0 0' }}>
      {fix ? `GPS ±${Math.round(fix.accuracyM)} m · reporting every ${PING_INTERVAL_MS / 1000}s` : 'No fix yet'}
      <br />
      Location is only recorded while tracking is on — every report, not just arrivals, and your office can see it as
      a trail on the map.
      {backend() === 'web' && (
        <>
          <br />
          <span style={{ color: '#8A6100' }}>{backendNote()}</span>
        </>
      )}
    </p>
  )
}

// ============================================================ icons (shared)

function CheckIcon({ color = theme.success, size = 16 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.4l3.2 3.2L13 4.8" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke={theme.accent} strokeWidth={1.4} style={{ flex: 'none', marginTop: 1 }}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.9V8l2.4 1.5" strokeLinecap="round" />
    </svg>
  )
}

function CameraIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.3}>
      <path d="M2 5.6h2.6L6 3.8h4l1.4 1.8H14v7.6H2z" strokeLinejoin="round" />
      <circle cx="8" cy="9.2" r="2.6" />
    </svg>
  )
}

function ReceiptIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.3}>
      <path d="M3.4 2.2h9.2v11.6l-2.3-1.4-2.3 1.4-2.3-1.4-2.3 1.4z" strokeLinejoin="round" />
      <path d="M5.8 5.6h4.4M5.8 8.2h4.4" strokeLinecap="round" />
    </svg>
  )
}

function ChatBubbleIcon({ color = theme.ink, size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.3}>
      <path d="M2.4 3.4h11.2v7.4H7.2L4.2 13.4v-2.6H2.4z" strokeLinejoin="round" />
    </svg>
  )
}
// Re-exported under the name the action grid expects.

function WifiOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={design.mid} strokeWidth={1.4} style={{ flex: 'none' }}>
      <path d="M2 6.2a8.6 8.6 0 0112 0M4.6 9a5 5 0 016.8 0" strokeLinecap="round" />
      <path d="M8 12.4h.01" strokeWidth={2} strokeLinecap="round" />
      <path d="M2.6 2.6l10.8 10.8" stroke={theme.alert} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

function PinIcon({ color = '#fff', size = 10 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.8}>
      <path d="M8 14.2s4.6-4.4 4.6-7.6a4.6 4.6 0 10-9.2 0C3.4 9.8 8 14.2 8 14.2z" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={design.muted} strokeWidth={1.5} style={{ flex: 'none' }}>
      <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.2" />
      <path d="M5.6 7V5.2a2.4 2.4 0 014.8 0V7" strokeLinecap="round" />
    </svg>
  )
}

// ---- style helpers ---------------------------------------------------------

function ctaYellow(height: number): CSSProperties {
  return {
    width: '100%',
    height,
    background: theme.cta,
    border: `1px solid ${design.ctaBorder}`,
    borderRadius: 3,
    font: 'inherit',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '.04em',
    color: theme.ink,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  }
}

function ctaWhite(height: number): CSSProperties {
  return {
    width: '100%',
    height,
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 3,
    font: 'inherit',
    fontSize: 15,
    fontWeight: 600,
    color: theme.ink,
    cursor: 'pointer',
  }
}

const ctaRed: CSSProperties = {
  width: '100%',
  height: 54,
  background: theme.panel,
  border: `1px solid ${theme.alert}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: '.03em',
  color: theme.alert,
  cursor: 'pointer',
}

const ctaGhost: CSSProperties = {
  width: '100%',
  height: 44,
  background: 'none',
  border: 'none',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: design.faint,
  cursor: 'pointer',
}

const fieldBox: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '11px 12px',
  marginTop: 6,
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  font: 'inherit',
  fontSize: 14.5,
  color: theme.ink,
  background: theme.panel,
  boxSizing: 'border-box',
}

const sectionLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.07em',
  color: design.faint,
}

// ============================================================ gate screen

/** Shown before the worker has tapped to start tracking. Not configured in
 *  either design file — the mock assumes background tracking simply starts
 *  on schedule, which a mobile browser cannot do without a tap. Built from
 *  the same visual language (header, blue callout, big yellow CTA) as the
 *  "Approaching" screen it hands off to, so it reads as part of the same
 *  app rather than a bolt-on. Nothing is recorded before this tap. */
function GateScreen({
  me,
  onStart,
  onShowAccount,
  onOpenPanel,
}: {
  me: WorkerRow
  onStart: () => void
  onShowAccount: () => void
  onOpenPanel: (s: PanelScreen) => void
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <TrackerHeader me={me} tone="off" label="Off the clock" onAvatarTap={onShowAccount} />
      <div style={{ paddingTop: 14 }}>
        <NoticeBanner me={me} onOpen={() => onOpenPanel('schedule')} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '6px 20px 20px', overflowY: 'auto' }}>
        <Callout>
          Turn on tracking and you'll be clocked in <b style={{ fontWeight: 700 }}>automatically</b> when you reach a
          job site.
        </Callout>

        <div style={{ marginTop: 18 }}>
          <OffClockActions onOpen={onOpenPanel} />
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, color: design.faint, lineHeight: 1.45 }}>
            Nothing is recorded until you tap this.
          </span>
          <button onClick={onStart} style={ctaYellow(56)}>
            START TRACKING
          </button>
        </div>
        <PrivacyLine fix={null} />
      </div>
    </div>
  )
}

// ========================================================= approaching (1)

function ApproachingScreen({
  me,
  nearest,
  hasSites,
  note,
  onDismissNote,
  onShowAccount,
  onManualClockIn,
  onOpenPanel,
}: {
  me: WorkerRow
  nearest: { s: ServerSite; d: number } | null
  hasSites: boolean
  note: string | null
  onDismissNote: () => void
  onShowAccount: () => void
  onManualClockIn: () => void
  onOpenPanel: (s: PanelScreen) => void
}) {
  const distanceLabel = nearest ? (nearest.d < 1000 ? `${Math.round(nearest.d)} m away` : `${(nearest.d / 1000).toFixed(1)} km away`) : ''

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <TrackerHeader me={me} tone="off" label="Off the clock" onAvatarTap={onShowAccount} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, overflowY: 'auto' }}>
        {nearest ? (
          <>
            <ApproachMap />
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: theme.accent }}>HEADED TO</span>
              <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.1 }}>{nearest.s.name}</span>
              <span style={{ fontSize: 15, color: theme.inkSoft }}>{distanceLabel}</span>
            </div>
            <Callout>
              You'll clock in <b style={{ fontWeight: 700 }}>automatically</b> when you arrive.
            </Callout>
          </>
        ) : (
          <div style={{ fontSize: 15, color: theme.inkSoft, padding: '30px 0' }}>
            {hasSites ? 'Waiting for GPS…' : 'Waiting for your first location report…'}
          </div>
        )}

        {note && (
          <Banner tone="info">
            {note}
            <button onClick={onDismissNote} style={{ ...ctaGhost, height: 'auto', marginTop: 6, padding: 0, fontSize: 12.5, color: design.calloutFg }}>
              Got it
            </button>
          </Banner>
        )}

        <div style={{ flex: 1 }} />
        <ActionGrid onOpen={onOpenPanel} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, color: design.faint, lineHeight: 1.45 }}>
            Tracking is on, so your position is being sent to the office now, including the drive here — you're only
            paid from two minutes after you've settled at the site.
          </span>
          <button onClick={onManualClockIn} style={ctaWhite(52)}>
            Clock in manually
          </button>
        </div>
        <PrivacyLine fix={nearest ? { pos: { lat: 0, lng: 0 }, accuracyM: 0 } : null} />
      </div>
    </div>
  )
}

/** Decorative map, copied from the design's own placeholder — it isn't a
 *  real map there either (hand-drawn rects standing in for city blocks), so
 *  reproducing the same illustration is more faithful than wiring up a real
 *  map SDK for a component that only ever shows "you, and one pin". */
function ApproachMap() {
  return (
    <div style={{ position: 'relative', height: 250, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: design.mapBg }}>
      <svg viewBox="0 0 348 250" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <rect width="348" height="250" fill="#FFFFFF" />
        <g fill={design.mapBlock}>
          <rect x="0" y="0" width="140" height="96" />
          <rect x="152" y="0" width="196" height="96" />
          <rect x="0" y="108" width="140" height="142" />
          <rect x="152" y="108" width="196" height="142" />
        </g>
        <circle cx="232" cy="82" r="62" fill={theme.accent} fillOpacity=".12" stroke={theme.accent} />
        <path
          d="M232 82 c-7-10-10-13-10-19a10 10 0 1 1 20 0c0 6-3 9-10 19z"
          transform="translate(0,-5)"
          fill={theme.accent}
          stroke="#fff"
          strokeWidth="2"
        />
        <path d="M64 214 L96 190 L136 156 L172 128" fill="none" stroke={theme.accent} strokeWidth="2.4" strokeDasharray="2 6" strokeLinecap="round" />
        <circle cx="64" cy="214" r="15" fill="#fff" />
        <circle cx="64" cy="214" r="13" fill={theme.accent} />
        <circle cx="64" cy="214" r="4.6" fill="#fff" />
      </svg>
    </div>
  )
}

// ========================================================== confirming (2)

function ConfirmingScreen({
  me,
  site,
  remainingMs,
  onShowAccount,
  onOpenPanel,
}: {
  me: WorkerRow
  site: ServerSite
  remainingMs: number
  onShowAccount: () => void
  onOpenPanel: (s: PanelScreen) => void
}) {
  const secs = Math.ceil(remainingMs / 1000)
  const mm = Math.floor(secs / 60)
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <TrackerHeader me={me} tone="amber" label="Arriving" onAvatarTap={onShowAccount} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '34px 24px 20px', overflowY: 'auto' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 172, height: 172 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: theme.accent, opacity: 0.14, animation: 'cl-ping 2.4s ease-out infinite' }} />
          <span style={{ position: 'absolute', inset: 18, borderRadius: '50%', border: `1.5px solid ${design.ringSoft}` }} />
          <svg viewBox="0 0 172 172" style={{ position: 'absolute', inset: 0, width: 172, height: 172, animation: 'cl-spin 2.6s linear infinite' }}>
            <circle cx="86" cy="86" r="78" fill="none" stroke={theme.accent} strokeWidth="4" strokeLinecap="round" strokeDasharray="132 358" />
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1 }}>
              {mm}:{ss}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', color: design.faint }}>REMAINING</span>
          </span>
        </div>

        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.01em' }}>Confirming you're on site…</span>
          <span style={{ fontSize: 15, lineHeight: 1.45, color: theme.inkSoft, maxWidth: 290 }}>
            We wait until you've settled in, so driving past a site never clocks you in.
          </span>
        </div>

        <div style={{ marginTop: 24, width: '100%', border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 15px', borderBottom: `1px solid ${design.hairline}` }}>
            <CheckIcon />
            <span style={{ flex: 1, fontSize: 14.5 }}>Inside the {site.name} fence</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 15px', background: design.wash }}>
            <span
              style={{
                flex: 'none',
                display: 'block',
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: `2px solid ${theme.border}`,
                borderTopColor: theme.accent,
                animation: 'cl-spin .9s linear infinite',
              }}
            />
            <span style={{ flex: 1, fontSize: 14.5, color: design.mid }}>Settle window</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.accent }}>in progress</span>
          </div>
        </div>

        <div style={{ flex: 1 }} />
        <ActionGrid onOpen={onOpenPanel} />
        <span style={{ fontSize: 13, color: design.faint, textAlign: 'center', lineHeight: 1.45 }}>
          Nothing is recorded until this finishes.
        </span>
      </div>
    </div>
  )
}

// ===================================================== celebration (moment)

function CelebrationScreen({
  me,
  siteName,
  at,
  marginM,
  onDismiss,
  onFixPunch,
}: {
  me: WorkerRow
  siteName: string
  at: number
  marginM: number | null
  onDismiss: () => void
  onFixPunch: () => void
}) {
  const time = new Date(at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  const dwellMin = Math.round(DWELL_IN_MS / 60_000)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '26px 24px 30px', background: theme.success, color: '#fff' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 66, height: 66, borderRadius: '50%', background: 'rgba(255,255,255,.18)' }}>
          <CheckIcon color="#fff" size={34} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center' }}>
          <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.15 }}>Clocked in at {time}</span>
          <span style={{ fontSize: 16, opacity: 0.92 }}>
            {siteName} · {me.trade}
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 13, background: 'rgba(255,255,255,.16)', fontSize: 13, fontWeight: 600 }}>
          Automatic — you didn't have to do anything
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '18px 20px 20px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 'none', width: 118, height: 96, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: design.mapBg }}>
            <svg viewBox="0 0 118 96" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <rect width="118" height="96" fill="#fff" />
              <g fill={design.mapBlock}>
                <rect x="0" y="0" width="52" height="40" />
                <rect x="60" y="0" width="58" height="40" />
                <rect x="0" y="48" width="52" height="48" />
                <rect x="60" y="48" width="58" height="48" />
              </g>
              <circle cx="59" cy="48" r="34" fill={theme.success} fillOpacity=".14" stroke={theme.success} />
              <circle cx="59" cy="48" r="8" fill={theme.success} stroke="#fff" strokeWidth="2" />
            </svg>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.07em', color: design.faint }}>ARRIVAL VERIFIED</span>
            <span style={{ fontSize: 14, lineHeight: 1.4, color: design.mid }}>
              GPS put you{' '}
              <b style={{ fontWeight: 600, color: theme.ink }}>
                {marginM != null && marginM >= 0 ? `${marginM} m inside` : 'inside'}
              </b>{' '}
              the fence for {dwellMin} min before the clock started.
            </span>
          </div>
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onFixPunch}
            style={{ border: 'none', background: 'none', font: 'inherit', fontSize: 14, fontWeight: 500, color: theme.ink, cursor: 'pointer' }}
          >
            Not right? Fix this
          </button>
          <button onClick={onDismiss} style={ctaWhite(54)}>
            View today
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================ on clock (4)

function OnClockScreen({
  site,
  since,
  elapsedMs,
  onOpenPanel,
  clockOutConfirm,
  onClockOutTap,
  onClockOutCancel,
  onStopTracking,
  onShowAccount,
}: {
  site: ServerSite
  since: number
  elapsedMs: number
  onOpenPanel: (s: PanelScreen) => void
  clockOutConfirm: boolean
  onClockOutTap: () => void
  onClockOutCancel: () => void
  onStopTracking: () => void
  onShowAccount: () => void
}) {
  const h = Math.floor(elapsedMs / 3_600_000)
  const m = String(Math.floor((elapsedMs % 3_600_000) / 60_000)).padStart(2, '0')
  const sinceLabel = new Date(since).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  const hrsSoFar = (elapsedMs / 3_600_000).toFixed(1)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '22px 20px 20px', borderBottom: `1px solid ${theme.border}` }}>
        {/* Design's on-the-clock screen (isClockin step 4) has no header row
            at all — the pill below stands in for it. The account sheet
            (with sign-out) still needs a way in, so the pill itself is the
            tap target rather than adding chrome the design doesn't have. */}
        <button
          onClick={onShowAccount}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 12px',
            borderRadius: 13,
            background: design.greenBg,
            color: design.greenFg,
            fontSize: 12.5,
            fontWeight: 700,
            border: 'none',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: theme.success }} />
          ON THE CLOCK
        </button>
        <span style={{ fontSize: 62, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.05 }}>
          {h}:{m}
        </span>
        <span style={{ fontSize: 14, color: theme.inkSoft }}>
          since {sinceLabel} · {site.name}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ActionGrid onOpen={onOpenPanel} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 20px 0', borderTop: `1px solid ${theme.border}`, overflowY: 'auto' }}>
          <span style={{ padding: '14px 0 10px', ...sectionLabel }}>TODAY'S TIMELINE</span>

          <div style={{ display: 'flex', gap: 11 }}>
            <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: theme.success, marginTop: 4 }} />
              <span style={{ flex: 1, width: 2, background: theme.border }} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 14 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>Arrived — clocked in</span>
              <span style={{ fontSize: 13, color: design.faint }}>{sinceLabel} · auto, GPS verified</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 11 }}>
            <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${theme.accent}`, background: '#fff', marginTop: 4 }} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: theme.accent }}>Still on site</span>
              <span style={{ fontSize: 13, color: design.faint }}>
                {site.name} · {hrsSoFar} hrs so far
              </span>
            </div>
          </div>
        </div>

        <div style={{ flex: 'none', padding: '14px 20px 22px', borderTop: `1px solid ${theme.border}` }}>
          {clockOutConfirm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 13, color: design.mid, lineHeight: 1.5 }}>
                Leaving the site is what actually clocks you out — GPS closes the shift a few minutes after you
                walk away. If your phone won't be with you, you can stop sending location now instead; tell your
                foreman if the hours need fixing by hand.
              </span>
              <button onClick={onStopTracking} style={ctaRed}>
                STOP TRACKING ON THIS PHONE
              </button>
              <button onClick={onClockOutCancel} style={ctaGhost}>
                Keep tracking
              </button>
            </div>
          ) : (
            <button onClick={onClockOutTap} style={ctaRed}>
              CLOCK OUT
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================== notice

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        padding: 24,
        textAlign: 'center',
        font: '14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.ink }}>{title}</div>
        <p style={{ color: theme.inkSoft }}>{children}</p>
      </div>
    </div>
  )
}

// ================================================================== photo

const PHOTO_CATEGORIES = ['progress', 'issue', 'before', 'after', 'inspection'] as const
type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]
const PHOTO_CATEGORY_LABEL: Record<PhotoCategory, string> = {
  progress: 'Progress',
  issue: 'Issue',
  before: 'Before',
  after: 'After',
  inspection: 'Inspection',
}

function PhotoScreen({
  me,
  currentSiteId,
  sites,
  fix,
  onClose,
}: {
  me: WorkerRow
  currentSiteId: string | null
  sites: ServerSite[]
  fix: { pos: LatLng; accuracyM: number } | null
  onClose: () => void
}) {
  const [siteId, setSiteId] = useState(currentSiteId ?? sites[0]?.id ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturedAt, setCapturedAt] = useState<number | null>(null)
  const [capturedFix, setCapturedFix] = useState<{ pos: LatLng; accuracyM: number } | null>(null)
  const [category, setCategory] = useState<PhotoCategory>('progress')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (currentSiteId) setSiteId(currentSiteId)
  }, [currentSiteId])

  // Revoke the object URL whenever it's replaced or the screen unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function pickFile(f: File) {
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
    setCapturedAt(Date.now())
    setCapturedFix(fix)
    setSuccess(false)
    setError(null)
  }

  const site = sites.find((s) => s.id === siteId) ?? null

  async function upload() {
    if (!file || !siteId) {
      setError('Pick a job site first.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const path = objectPath(me.company_id, siteId, file.name)
      await uploadFile(BUCKET_FILES, path, file)
      const { error: err } = await supabase()
        .from('site_files')
        .insert({
          company_id: me.company_id,
          site_id: siteId,
          uploaded_by: me.id,
          kind: 'photo',
          storage_path: path,
          name: file.name,
          mime: file.type || null,
          size_bytes: file.size,
          category,
          caption: caption.trim() || null,
          lat: capturedFix?.pos.lat ?? null,
          lng: capturedFix?.pos.lng ?? null,
          taken_at: new Date(capturedAt ?? Date.now()).toISOString(),
        })
      if (err) throw new Error(err.message)
      setSuccess(true)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setFile(null)
      setPreviewUrl(null)
      setCaption('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ScreenHeader title={file ? '1 photo' : 'Take a photo'} onCancel={onClose} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {!file ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 }}>
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 8,
                background: `repeating-linear-gradient(135deg, ${design.texA} 0 8px, ${design.texB} 8px 16px)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CameraIcon color={design.faint} size={40} />
            </div>
            <label style={{ ...ctaYellow(56), width: '100%' }}>
              <CameraIcon size={19} />
              OPEN CAMERA
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) pickFile(f)
                }}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        ) : (
          <>
            <div style={{ position: 'relative', width: '100%', height: 260, background: theme.rail, overflow: 'hidden' }}>
              {previewUrl && (
                <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              <span
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: theme.accent,
                  border: '2px solid #fff',
                }}
              >
                <CheckIcon color="#fff" size={13} />
              </span>
              {site && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: '7px 10px',
                    background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.55))',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff',
                  }}
                >
                  <PinIcon />
                  {site.name} · {new Date(capturedAt ?? Date.now()).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '16px 18px' }}>
              <span style={sectionLabel}>WHAT IS THIS?</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PHOTO_CATEGORIES.map((c) => {
                  const active = c === category
                  return (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 38,
                        padding: '0 15px',
                        borderRadius: 19,
                        background: active ? theme.ink : theme.panel,
                        border: active ? 'none' : `1px solid ${theme.border}`,
                        color: active ? '#fff' : theme.ink,
                        font: 'inherit',
                        fontSize: 14,
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {PHOTO_CATEGORY_LABEL[c]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 18px 16px' }}>
              <span style={sectionLabel}>CAPTION (OPTIONAL)</span>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="What's this show?"
                rows={2}
                style={{ ...fieldBox, marginTop: 0, resize: 'none', fontFamily: 'inherit', minHeight: 62 }}
              />
            </div>

            <div style={{ borderTop: `1px solid ${design.hairline}` }}>
              <MetaRow label="Site" value={site?.name ?? '—'} />
              <MetaRow label="Taken" value={new Date(capturedAt ?? Date.now()).toLocaleString('en-AU', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })} />
              <MetaRow label="GPS" value={capturedFix ? `±${Math.round(capturedFix.accuracyM)} m` : 'No fix yet'} />
            </div>

            {!currentSiteId && (
              <div style={{ padding: '2px 18px 16px' }}>
                <span style={sectionLabel}>JOB SITE</span>
                <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={fieldBox}>
                  <option value="">Choose a site…</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && <Banner tone="error">{error}</Banner>}
            {success && <Banner tone="success">Photo uploaded.</Banner>}

            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 18px 22px', borderTop: `1px solid ${theme.border}` }}>
              <button onClick={() => void upload()} disabled={uploading || !siteId} style={{ ...ctaYellow(56), opacity: uploading || !siteId ? 0.6 : 1 }}>
                {uploading ? 'UPLOADING…' : `UPLOAD TO ${(site?.name ?? 'SITE').toUpperCase()}`}
              </button>
              <span style={{ fontSize: 12.5, color: design.faint, textAlign: 'center' }}>
                Adds a dated, geotagged photo to today's photos.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: `1px solid ${design.hairline}` }}>
      <span style={{ flex: 'none', width: 60, fontSize: 12.5, color: design.faint }}>{label}</span>
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{value}</span>
      <LockIcon />
    </div>
  )
}

// ================================================================ receipt

const EXPENSE_CATEGORIES = ['Materials', 'Subcontractor', 'Equipment Rental', 'Permits', 'Fuel', 'Other']

interface ReceiptForm {
  siteId: string
  vendor: string
  spentOn: string
  amount: string
  tax: string
  category: string
  lineItems: Array<{ description: string; amount: number }>
  aiNote: string | null
  aiConfidence: number | null
  /** Field names still showing the "read from photo" marker — cleared as the user corrects each one. */
  aiFilled: Set<string>
  aiExtracted: boolean
  receiptPath: string | null
}

function blankReceiptForm(siteId: string): ReceiptForm {
  return {
    siteId,
    vendor: '',
    spentOn: new Date().toISOString().slice(0, 10),
    amount: '',
    tax: '',
    category: '',
    lineItems: [],
    aiNote: null,
    aiConfidence: null,
    aiFilled: new Set(),
    aiExtracted: false,
    receiptPath: null,
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function ReceiptScreen({
  me,
  currentSiteId,
  sites,
  onClose,
}: {
  me: WorkerRow
  currentSiteId: string | null
  sites: ServerSite[]
  onClose: () => void
}) {
  const [form, setForm] = useState<ReceiptForm>(() => blankReceiptForm(currentSiteId ?? sites[0]?.id ?? ''))
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (currentSiteId) setForm((f) => ({ ...f, siteId: currentSiteId }))
  }, [currentSiteId])

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name

  function editField<K extends keyof ReceiptForm>(key: K, value: ReceiptForm[K]) {
    setForm((f) => {
      const nextFilled = new Set(f.aiFilled)
      nextFilled.delete(key as string)
      return { ...f, [key]: value, aiFilled: nextFilled }
    })
  }

  async function handleFile(file: File) {
    setError(null)
    setSaved(false)
    setExtracting(true)
    try {
      const path = objectPath(me.company_id, form.siteId || 'unassigned', file.name)
      await uploadFile(BUCKET_RECEIPTS, path, file)
      setForm((f) => ({ ...f, receiptPath: path }))

      const base64 = await readFileAsBase64(file)
      const {
        data: { session },
      } = await supabase().auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Session expired — sign in again.')

      const res = await fetch(api('/api/parse-receipt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: file.type || 'image/jpeg',
          siteHint: form.siteId ? siteName(form.siteId) : undefined,
          sitesList: sites.map((s) => s.name),
        }),
      })

      if (res.status === 501) return // AI extraction not configured — form stays fully usable by hand.

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Extraction failed (${res.status})`)
      }

      const parsed = (await res.json()) as {
        vendor: string | null
        spent_on: string | null
        amount: number | null
        tax: number | null
        category: string | null
        line_items: Array<{ description: string; amount: number }>
        confidence: number | null
        note: string | null
      }

      const filled = new Set<string>()
      setForm((f) => {
        const next = { ...f }
        if (parsed.vendor) {
          next.vendor = parsed.vendor
          filled.add('vendor')
        }
        if (parsed.spent_on) {
          next.spentOn = parsed.spent_on
          filled.add('spentOn')
        }
        if (parsed.amount != null) {
          next.amount = String(parsed.amount)
          filled.add('amount')
        }
        if (parsed.tax != null) {
          next.tax = String(parsed.tax)
          filled.add('tax')
        }
        if (parsed.category) {
          next.category = parsed.category
          filled.add('category')
        }
        next.lineItems = parsed.line_items ?? []
        next.aiNote = parsed.note
        next.aiConfidence = parsed.confidence
        next.aiFilled = filled
        next.aiExtracted = true
        return next
      })
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't read the receipt automatically — ${e.message}. Enter it by hand.`
          : "Couldn't read the receipt automatically. Enter it by hand.",
      )
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    if (!form.vendor.trim() || !form.spentOn || !form.amount) {
      setError('Vendor, date, and amount are required.')
      return
    }
    setSaving(true)
    setError(null)
    const { error: err } = await supabase()
      .from('expenses')
      .insert({
        company_id: me.company_id,
        site_id: form.siteId || null,
        submitted_by: me.id,
        vendor: form.vendor.trim(),
        spent_on: form.spentOn,
        amount: Number(form.amount) || 0,
        tax: Number(form.tax) || 0,
        category: form.category || null,
        receipt_path: form.receiptPath,
        status: 'needs_review',
        ai_note: form.aiNote,
        ai_confidence: form.aiConfidence,
        line_items: form.lineItems,
      })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setSaved(true)
    setForm(blankReceiptForm(currentSiteId ?? sites[0]?.id ?? ''))
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ScreenHeader title="Upload receipt" onCancel={onClose} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        <label style={{ ...ctaYellow(56), opacity: extracting ? 0.6 : 1 }}>
          <ReceiptIcon color={theme.ink} size={19} />
          {extracting ? 'READING RECEIPT…' : form.receiptPath ? 'RETAKE PHOTO' : 'OPEN CAMERA'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={extracting}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleFile(file)
            }}
            style={{ display: 'none' }}
          />
        </label>

        {form.aiExtracted && !extracting && (
          <Banner tone="info">
            Read from photo — confidence {form.aiConfidence != null ? `${Math.round(form.aiConfidence * 100)}%` : '—'}.
            Check every field below.
          </Banner>
        )}

        <div style={{ marginTop: 14 }}>
          <span style={sectionLabel}>JOB SITE</span>
          {sites.length === 0 ? (
            <div style={{ fontSize: 12.5, color: design.faint, marginTop: 6 }}>
              No job sites loaded yet — wait for your first location report.
            </div>
          ) : (
            <select value={form.siteId} onChange={(e) => editField('siteId', e.target.value)} style={fieldBox}>
              <option value="">Choose a site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {currentSiteId && form.siteId === currentSiteId && (
            <div style={{ fontSize: 12, color: design.faint, marginTop: 6 }}>Prefilled from where you are right now.</div>
          )}
        </div>

        <ReceiptField label="Vendor" value={form.vendor} aiFilled={form.aiFilled.has('vendor')} onChange={(v) => editField('vendor', v)} placeholder="Home Depot" />
        <ReceiptField label="Date" type="date" value={form.spentOn} aiFilled={form.aiFilled.has('spentOn')} onChange={(v) => editField('spentOn', v)} />
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <ReceiptField label="Amount" value={form.amount} aiFilled={form.aiFilled.has('amount')} onChange={(v) => editField('amount', v)} placeholder="0.00" />
          </div>
          <div style={{ flex: 1 }}>
            <ReceiptField label="Tax" value={form.tax} aiFilled={form.aiFilled.has('tax')} onChange={(v) => editField('tax', v)} placeholder="0.00" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <span style={sectionLabel}>
            CATEGORY
            {form.aiFilled.has('category') && <AiMarker />}
          </span>
          <select value={form.category} onChange={(e) => editField('category', e.target.value)} style={fieldBox}>
            <option value="">—</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {form.lineItems.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <span style={sectionLabel}>LINE ITEMS READ FROM PHOTO</span>
            {form.lineItems.map((li, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${design.hairline}`, fontSize: 13.5 }}>
                <span style={{ color: theme.inkSoft }}>{li.description}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>${Number(li.amount).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {error && <Banner tone="error">{error}</Banner>}
        {saved && <Banner tone="success">Receipt saved — sent for office review.</Banner>}

        <button onClick={() => void save()} disabled={saving || extracting} style={{ ...ctaYellow(56), marginTop: 18, opacity: saving || extracting ? 0.6 : 1 }}>
          {saving ? 'SAVING…' : 'SAVE EXPENSE'}
        </button>
      </div>
    </div>
  )
}

function ReceiptField({
  label: labelText,
  value,
  onChange,
  placeholder,
  type = 'text',
  aiFilled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  aiFilled?: boolean
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <span style={sectionLabel}>
        {labelText.toUpperCase()}
        {aiFilled && <AiMarker />}
      </span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={fieldBox} />
    </div>
  )
}

function AiMarker() {
  return <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: theme.accent }}>· read from photo</span>
}

// ==================================================================== chat

interface MessageWithAuthor extends MessageRow {
  workers: { name: string; initials: string } | null
}

function ChatScreen({
  me,
  currentSiteId,
  sites: fromTracker,
  onClose,
}: {
  me: WorkerRow
  currentSiteId: string | null
  sites: ServerSite[]
  onClose: () => void
}) {
  // Chat is a tab. The tracker's site list is empty until someone taps Start
  // tracking, and the screen read "Choose a site…" with nothing to choose.
  const sites = useSites(fromTracker as never) as unknown as ServerSite[]
  const [siteId, setSiteId] = useState(currentSiteId ?? '')
  // sites arrives a tick later than first render, so the pick cannot happen in
  // the initialiser — otherwise a crew on one job is asked to choose it.
  useEffect(() => {
    if (!siteId && sites.length === 1) setSiteId(sites[0]!.id)
  }, [sites, siteId])
  const [channel, setChannel] = useState<ChannelRow | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [authors, setAuthors] = useState<Record<string, { name: string; initials: string }>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const authorsRef = useRef(authors)
  useEffect(() => {
    authorsRef.current = authors
  }, [authors])

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (currentSiteId) setSiteId(currentSiteId)
  }, [currentSiteId])

  useEffect(() => {
    if (!siteId) {
      setChannel(null)
      setMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void supabase()
      .from('channels')
      .select('*')
      .eq('site_id', siteId)
      .eq('kind', 'site')
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setChannel((data as ChannelRow) ?? null)
        if (!data) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [siteId])

  useEffect(() => {
    if (!channel) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void supabase()
      .from('messages')
      .select('*, workers(name, initials)')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        const rows = ((data ?? []) as MessageWithAuthor[]).slice().reverse()
        setMessages(rows)
        setAuthors((prev) => {
          const next = { ...prev }
          for (const r of rows) {
            if (r.author_id && r.workers) next[r.author_id] = r.workers
          }
          return next
        })
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channel])

  useEffect(() => {
    if (!channel) return
    const id = channel.id
    const client = supabase()
    const ch = client
      .channel(`worker-chat-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` },
        (payload) => {
          const row = payload.new as MessageRow
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
          const authorId = row.author_id
          if (authorId && authorId !== me.id && !authorsRef.current[authorId]) {
            void supabase()
              .from('workers')
              .select('name, initials')
              .eq('id', authorId)
              .maybeSingle()
              .then(({ data }) => {
                if (data) setAuthors((p) => ({ ...p, [authorId]: data as { name: string; initials: string } }))
              })
          }
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
  }, [channel, me.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body || !channel || sending) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase()
      .from('messages')
      .insert({
        company_id: me.company_id,
        channel_id: channel.id,
        author_id: me.id,
        kind: 'user',
        body,
      })
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
  }

  const site = sites.find((s) => s.id === siteId) ?? null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ScreenHeader title="Site chat" onCancel={onClose} />

      {!currentSiteId && (
        <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}` }}>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={{ ...fieldBox, marginTop: 0 }}>
            <option value="">Choose a site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!siteId ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontSize: 13, color: design.faint, textAlign: 'center' }}>
          Pick a site to see its chat.
        </div>
      ) : loading && !channel ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: design.faint }}>Loading…</div>
      ) : !channel ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontSize: 13, color: design.faint, textAlign: 'center' }}>
          No chat channel for {site?.name ?? 'this site'} yet.
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', background: theme.appBg }}>
            {loading && <div style={{ fontSize: 12.5, color: design.faint }}>Loading…</div>}
            {!loading && messages.length === 0 && (
              <div style={{ fontSize: 13, color: design.faint, textAlign: 'center', padding: '30px 0' }}>No messages yet. Say hello.</div>
            )}
            {messages.map((m) =>
              m.kind === 'system' ? (
                <div key={m.id} style={{ textAlign: 'center', margin: '10px 0' }}>
                  <span style={{ fontSize: 12, color: design.faint }}>
                    {m.body} · {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ) : (
                <div key={m.id} style={{ margin: '10px 0' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{m.author_id === me.id ? 'You' : authors[m.author_id ?? '']?.name ?? 'Crew'}</span>
                    <span style={{ fontSize: 11.5, color: design.faint }}>
                      {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', marginTop: 2 }}>{m.body}</div>
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>

          {error && <Banner tone="error">{error}</Banner>}

          <div style={{ flex: 'none', display: 'flex', gap: 8, alignItems: 'flex-end', padding: '10px 12px', borderTop: `1px solid ${theme.border}` }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Message the crew…"
              rows={1}
              style={{ ...fieldBox, marginTop: 0, flex: 1, resize: 'none', fontFamily: 'inherit', minHeight: 44, boxSizing: 'border-box' }}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              style={{
                flex: 'none',
                height: 44,
                padding: '0 18px',
                borderRadius: 3,
                border: 'none',
                background: theme.accent,
                color: '#fff',
                font: 'inherit',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: 'pointer',
                opacity: sending || !draft.trim() ? 0.5 : 1,
              }}
            >
              {sending ? '…' : 'SEND'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================ my jobs (5)

/**
 * The roster, from the crew's side.
 *
 * The office could publish a week and nobody could see it: the worker app
 * never read `assignments`. Publishing was a write to a boolean nobody
 * downstream consumed.
 */
function ScheduleScreen({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [sites, setSites] = useState<Array<{ id: string; name: string; address: string }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const client = supabase()
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      const to = new Date(from)
      to.setDate(to.getDate() + 21)
      const [a, s] = await Promise.all([
        client
          .from('assignments')
          .select('*')
          .eq('worker_id', me.id)
          .eq('published', true)
          .gte('starts_at', from.toISOString())
          .lt('starts_at', to.toISOString())
          .order('starts_at'),
        client.from('job_sites').select('id, name, address'),
      ])
      if (cancelled) return
      setRows((a.data ?? []) as AssignmentRow[])
      setSites((s.data ?? []) as Array<{ id: string; name: string; address: string }>)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [me.id])

  const byDay = new Map<string, AssignmentRow[]>()
  for (const r of rows) {
    const key = new Date(r.starts_at).toDateString()
    const list = byDay.get(key)
    if (list) list.push(r)
    else byDay.set(key, [r])
  }
  const siteOf = (id: string) => sites.find((s) => s.id === id)

  return (
    <div style={panelScreen}>
      <ScreenHeader title="My jobs" onCancel={onClose} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 28px' }}>
        {loading && <p style={panelMuted}>Loading…</p>}
        {!loading && rows.length === 0 && (
          <p style={panelMuted}>
            Nothing published for the next three weeks. Your foreman publishes the roster from the office and it
            shows up here.
          </p>
        )}
        {[...byDay.entries()].map(([key, list]) => {
          const d = new Date(key)
          const today = d.toDateString() === new Date().toDateString()
          return (
            <div key={key} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{today ? 'Today' : dayDate(d)}</span>
                <span style={{ flex: 1, height: 1, background: theme.border }} />
              </div>
              {list.map((a) => {
                const site = siteOf(a.site_id)
                return (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      padding: '12px 14px',
                      marginBottom: 8,
                      background: theme.panel,
                      border: `1px solid ${theme.border}`,
                      borderLeft: `3px solid ${today ? theme.success : theme.border}`,
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{site?.name ?? 'Job site'}</span>
                    <span style={{ fontSize: 13, color: theme.inkSoft }}>
                      {clockTime(a.starts_at)} – {clockTime(a.ends_at)}
                    </span>
                    {site?.address && <span style={{ fontSize: 12.5, color: theme.inkFaint }}>{site.address}</span>}
                    {a.note && <span style={{ fontSize: 13, color: theme.inkMid, marginTop: 3 }}>{a.note}</span>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ======================================================== fix a punch (6)

const REASONS: Array<{ code: ShiftCorrectionRow['reason_code']; label: string }> = [
  { code: 'parked_offsite', label: 'Parked off-site and walked in' },
  { code: 'access_changed', label: 'Site access point had changed that day' },
  { code: 'blocked', label: 'Truck or equipment was blocking my usual spot' },
  { code: 'forgot', label: 'Forgot to start or stop the clock' },
  { code: 'other', label: "Something else — I'll explain below" },
]

/**
 * The dispute path. A geofence punch is evidence, so this never rewrites it —
 * it raises a request the office decides on, and the decision is recorded
 * against a named person.
 */
function CorrectionScreen({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [siteNames, setSiteNames] = useState<Map<string, string>>(new Map())
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [reason, setReason] = useState<ShiftCorrectionRow['reason_code']>('parked_offsite')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const client = supabase()
      const since = new Date()
      since.setDate(since.getDate() - 14)
      const [sh, st] = await Promise.all([
        client
          .from('shifts')
          .select('*')
          .eq('worker_id', me.id)
          .gte('started_at', since.toISOString())
          .order('started_at', { ascending: false })
          .limit(30),
        client.from('job_sites').select('id, name'),
      ])
      if (cancelled) return
      const rows = (sh.data ?? []) as ShiftRow[]
      setShifts(rows)
      setShiftId(rows[0]?.id ?? null)
      setSiteNames(new Map(((st.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])))
    })()
    return () => {
      cancelled = true
    }
  }, [me.id])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase().from('shift_corrections').insert({
      company_id: me.company_id,
      shift_id: shiftId,
      worker_id: me.id,
      reason_code: reason,
      detail: detail.trim() || null,
      status: 'open',
    })
    setBusy(false)
    if (err) setError(err.message)
    else setDone(true)
  }

  if (done) {
    return (
      <div style={panelScreen}>
        <ScreenHeader title="Sent" onCancel={onClose} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28, textAlign: 'center' }}>
          <CheckIcon size={44} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>The office has it</span>
          <span style={{ fontSize: 14, color: theme.inkSoft, lineHeight: 1.5 }}>
            Your hours stay recorded as they are until someone reviews this. Nothing was changed on the timesheet.
          </span>
          <button onClick={onClose} style={ctaWhite(50)}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div style={panelScreen}>
      <ScreenHeader title="Fix a punch" onCancel={onClose} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <span style={panelLabel}>WHICH SHIFT?</span>
          {shifts.length === 0 && <p style={panelMuted}>No shifts in the last two weeks.</p>}
          {shifts.slice(0, 8).map((s) => {
            const on = s.id === shiftId
            return (
              <button
                key={s.id}
                onClick={() => setShiftId(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '11px 13px',
                  marginBottom: 7,
                  textAlign: 'left',
                  background: on ? theme.accentFill : theme.panel,
                  border: `1px solid ${on ? theme.accent : theme.border}`,
                  borderRadius: 4,
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {s.site_id ? siteNames.get(s.site_id) ?? 'Job site' : 'Unassigned'}
                  </span>
                  <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                    {dayDate(s.started_at)} · {clockTime(s.started_at)} –{' '}
                    {s.ended_at ? clockTime(s.ended_at) : 'now'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div>
          <span style={panelLabel}>WHAT HAPPENED?</span>
          {REASONS.map((r) => {
            const on = r.code === reason
            return (
              <button
                key={r.code}
                onClick={() => setReason(r.code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  width: '100%',
                  padding: '13px',
                  marginBottom: 7,
                  textAlign: 'left',
                  background: on ? theme.accentFill : theme.panel,
                  border: `1px solid ${on ? theme.accent : theme.border}`,
                  borderRadius: 4,
                  font: 'inherit',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    flex: 'none',
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: `2px solid ${on ? theme.accent : theme.border}`,
                    background: on ? theme.accent : 'transparent',
                    boxShadow: on ? `inset 0 0 0 3px ${theme.panel}` : 'none',
                  }}
                />
                {r.label}
              </button>
            )
          })}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={panelLabel}>TELL THE OFFICE WHAT TO FIX</span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={4}
            placeholder="I was on site from 6:40, not 7:10."
            style={{
              padding: 11,
              border: `1px solid ${theme.border}`,
              borderRadius: 4,
              font: 'inherit',
              fontSize: 15,
              resize: 'vertical',
            }}
          />
        </label>

        {error && <Banner tone="error">{error}</Banner>}

        <button onClick={() => void submit()} disabled={busy || !shiftId} style={{ ...ctaYellow(54), opacity: busy || !shiftId ? 0.55 : 1 }}>
          {busy ? 'SENDING…' : 'SEND CORRECTION REQUEST'}
        </button>
        <span style={{ fontSize: 12.5, color: theme.inkFaint, lineHeight: 1.5, textAlign: 'center' }}>
          Your GPS record is not changed by this. The office sees what you say and decides.
        </span>
      </div>
    </div>
  )
}

// ========================================================== time off (7)

function TimeOffScreen({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [mine, setMine] = useState<TimeOffRow[]>([])
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [kind, setKind] = useState<TimeOffRow['kind']>('annual')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase()
      .from('time_off_requests')
      .select('*')
      .eq('worker_id', me.id)
      .order('starts_on', { ascending: false })
      .limit(12)
    setMine((data ?? []) as TimeOffRow[])
  }, [me.id])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (busy) return
    if (to < from) {
      setError('The last day cannot be before the first day.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase().from('time_off_requests').insert({
      company_id: me.company_id,
      worker_id: me.id,
      kind,
      starts_on: from,
      ends_on: to,
      reason: reason.trim() || null,
      status: 'pending',
    })
    setBusy(false)
    if (err) setError(err.message)
    else {
      setReason('')
      await load()
    }
  }

  const meta: Record<TimeOffRow['status'], { label: string; bg: string; fg: string }> = {
    pending: { label: 'Waiting on the office', bg: '#FFF9E8', fg: '#8A6100' },
    approved: { label: 'Approved', bg: '#EAF7EC', fg: '#1B7A2C' },
    declined: { label: 'Declined', bg: '#FDECEE', fg: '#A00417' },
    cancelled: { label: 'Withdrawn', bg: theme.fill, fg: theme.inkSoft },
  }

  return (
    <div style={panelScreen}>
      <ScreenHeader title="Time off" onCancel={onClose} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={panelLabel}>FIRST DAY</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={panelInput} />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={panelLabel}>LAST DAY</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={panelInput} />
          </label>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={panelLabel}>TYPE</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as TimeOffRow['kind'])} style={panelInput}>
            <option value="annual">Annual leave</option>
            <option value="personal">Personal / sick</option>
            <option value="unpaid">Unpaid</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={panelLabel}>REASON (OPTIONAL)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Family — planned" style={panelInput} />
        </label>

        {error && <Banner tone="error">{error}</Banner>}

        <button onClick={() => void submit()} disabled={busy} style={{ ...ctaYellow(54), opacity: busy ? 0.55 : 1 }}>
          {busy ? 'SENDING…' : 'REQUEST TIME OFF'}
        </button>

        {mine.length > 0 && (
          <div>
            <span style={panelLabel}>YOUR REQUESTS</span>
            {mine.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 13px',
                  marginBottom: 7,
                  background: theme.panel,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 4,
                }}
              >
                <span style={{ flex: 1, fontSize: 14 }}>
                  {shortDate(t.starts_on)} – {shortDate(t.ends_on)}
                </span>
                <span
                  style={{
                    padding: '3px 9px',
                    borderRadius: 11,
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: meta[t.status].bg,
                    color: meta[t.status].fg,
                  }}
                >
                  {meta[t.status].label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const panelScreen = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: theme.appBg,
  zIndex: 20,
} as const

const panelLabel = {
  display: 'block',
  marginBottom: 8,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.06em',
  color: theme.inkFaint,
} as const

const panelMuted = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.55,
  color: theme.inkSoft,
} as const

const panelInput = {
  height: 44,
  padding: '0 11px',
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  background: theme.panel,
  font: 'inherit',
  fontSize: 15,
  color: theme.ink,
} as const
