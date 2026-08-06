import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthScreen } from '../auth/AuthScreen'
import { useSession } from '../auth/useSession'
import { supabase, supabaseConfigured } from '../data/supabase'
import { DWELL_IN_MS, type DwellPhase } from '../geofence/dwell'
import { distanceM } from '../geofence/geo'
import { theme } from '../theme'
import type { LatLng } from '../types'

/**
 * The worker's phone.
 *
 * Every fix goes to /api/ping, and the phase the server returns is what gets
 * displayed — the phone never decides its own hours. Mobile web only reports
 * while the page is open; reliable background tracking needs the native app.
 */

const PING_INTERVAL_MS = 20_000

interface ServerSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
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

  return <Tracker name={me.name} initials={me.initials} trade={me.trade} />
}

function Tracker({
  name,
  initials,
  trade,
}: {
  name: string
  initials: string
  trade: string
}) {
  const [fix, setFix] = useState<{ pos: LatLng; accuracyM: number } | null>(null)
  const [phase, setPhase] = useState<DwellPhase>({ kind: 'offsite' })
  const [sites, setSites] = useState<ServerSite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(0)
  const [tick, setTick] = useState(Date.now())
  const [tracking, setTracking] = useState(false)

  const lastSent = useRef(0)
  const pending = useRef<Array<{ lat: number; lng: number; accuracyM: number; at: number }>>([])

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const send = useCallback(async (body: { lat: number; lng: number; accuracyM: number; at: number }) => {
    const { data } = await supabase().auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Session expired — sign in again.')

    const res = await fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Server returned ${res.status}`)
    }
    const payload = (await res.json()) as { phase: DwellPhase; sites: ServerSite[] }
    setPhase(payload.phase)
    setSites(payload.sites)
    setError(null)
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
    if (!('geolocation' in navigator)) {
      setError('This device has no location services.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude }, p.coords.accuracy),
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [tracking, onFix])

  const site = phase.kind === 'offsite' ? null : sites.find((s) => s.id === phase.siteId)
  const onClock = phase.kind === 'onsite' || phase.kind === 'departing'
  const elapsed = onClock ? Math.max(0, tick - phase.since) : 0
  const confirming =
    phase.kind === 'arriving' ? Math.max(0, Math.ceil((DWELL_IN_MS - (tick - phase.since)) / 1000)) : 0

  const nearest =
    fix && sites.length
      ? sites
          .map((s) => ({ s, d: distanceM(fix.pos, { lat: s.lat, lng: s.lng }) }))
          .sort((a, b) => a.d - b.d)[0]
      : null

  return (
    <div style={{ minHeight: '100vh', background: theme.appBg, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px 14px' }}>
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
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {initials}
          </span>
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
            <div style={{ fontSize: 12, color: theme.inkSoft }}>{trade}</div>
          </div>
          <button
            onClick={() => void supabase().auth.signOut()}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              color: theme.accent,
              font: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </header>

        <div
          style={{
            background: onClock ? '#EAF7EE' : theme.panel,
            border: `1px solid ${onClock ? '#B7E3C3' : theme.border}`,
            borderRadius: 10,
            padding: 20,
            textAlign: 'center',
          }}
        >
          {!tracking ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Start your shift</div>
              <p style={{ fontSize: 13, color: theme.inkSoft, lineHeight: 1.5 }}>
                Turn on tracking and you'll be clocked in automatically when you
                reach a job site. Nothing is recorded until you tap this.
              </p>
              <button onClick={() => setTracking(true)} style={bigCta}>
                START TRACKING
              </button>
            </>
          ) : onClock ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: '#1B7A32' }}>
                ON THE CLOCK
              </div>
              <div
                style={{
                  fontSize: 46,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  margin: '8px 0 2px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.floor(elapsed / 3_600_000)}:
                {String(Math.floor((elapsed % 3_600_000) / 60_000)).padStart(2, '0')}
              </div>
              <div style={{ fontSize: 14 }}>{site?.name}</div>
              <div style={{ fontSize: 12, color: theme.inkSoft, marginTop: 6 }}>
                Clocked in automatically — you didn't have to do anything.
              </div>
            </>
          ) : confirming > 0 ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: theme.accent }}>
                CONFIRMING YOU'RE ON SITE
              </div>
              <div style={{ fontSize: 40, fontWeight: 600, margin: '8px 0 2px' }}>{confirming}s</div>
              <div style={{ fontSize: 13 }}>{site?.name}</div>
              <div style={{ fontSize: 12, color: theme.inkSoft, marginTop: 6 }}>
                We wait until you've settled in, so driving past doesn't clock you in.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: theme.inkSoft }}>
                NOT ON THE CLOCK
              </div>
              <div style={{ fontSize: 15, margin: '10px 0 2px' }}>
                {nearest
                  ? `${(nearest.d / 1000).toFixed(1)} km from ${nearest.s.name}`
                  : sites.length === 0
                    ? 'Waiting for your first location report…'
                    : 'Waiting for GPS…'}
              </div>
              <div style={{ fontSize: 12, color: theme.inkSoft }}>
                You'll clock in automatically when you arrive.
              </div>
            </>
          )}
        </div>

        {queued > 0 && (
          <div style={{ ...banner, background: '#FFF6DF', borderColor: '#F2D89A', color: '#8A6100' }}>
            Offline — {queued} location{queued === 1 ? '' : 's'} waiting to send. They'll
            go through when you get signal.
          </div>
        )}

        {error && (
          <div style={{ ...banner, background: '#FDECEC', borderColor: '#F5C2C2', color: '#8A1C1C' }}>
            {error}
          </div>
        )}

        {tracking && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {['Take photo', 'Upload receipt', 'Site chat'].map((labelText) => (
              <button
                key={labelText}
                style={{
                  flex: 1,
                  padding: '14px 6px',
                  borderRadius: 8,
                  border: `1px solid ${theme.border}`,
                  background: theme.panel,
                  font: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {labelText}
              </button>
            ))}
          </div>
        )}

        <p style={{ fontSize: 11, color: theme.inkFaint, textAlign: 'center', marginTop: 18, lineHeight: 1.5 }}>
          {fix
            ? `GPS ±${Math.round(fix.accuracyM)} m · reporting every ${PING_INTERVAL_MS / 1000}s`
            : 'No fix yet'}
          <br />
          Location is only recorded while tracking is on.
        </p>
      </div>
    </div>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
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

const banner = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid',
  fontSize: 12.5,
  lineHeight: 1.45,
} as const

const bigCta = {
  width: '100%',
  marginTop: 14,
  padding: '14px 0',
  borderRadius: 6,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}
