import { useEffect, useMemo, useRef, useState } from 'react'
import { jobSites } from '../data/seed'
import { advance, DWELL_IN_MS, initialPhase, type DwellPhase } from '../geofence/dwell'
import { distanceM } from '../geofence/geo'
import { theme } from '../theme'
import type { LatLng, Ping } from '../types'

/**
 * The worker's phone. Mobile web for the MVP — real background location needs a
 * native app (see MAPS.md and the feasibility notes), but foreground tracking
 * is enough to demonstrate the whole loop end to end.
 *
 * The dwell engine runs here for instant feedback, and every fix is also POSTed
 * to /api/ping where the same engine runs server-side as the system of record.
 */

const PING_INTERVAL_MS = 20_000

interface Fix {
  pos: LatLng
  accuracyM: number
  at: number
}

export function WorkerApp() {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<DwellPhase>(initialPhase)
  const [log, setLog] = useState<string[]>([])
  const [simSite, setSimSite] = useState<string | null>(null)
  const [tick, setTick] = useState(Date.now())

  const phaseRef = useRef<DwellPhase>(initialPhase)
  const lastSent = useRef(0)

  // Drives the elapsed-time counter.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const applyFix = useMemo(
    () =>
      (pos: LatLng, accuracyM: number) => {
        const at = Date.now()
        setFix({ pos, accuracyM, at })

        const ping: Ping = { workerId: 'me', at, lat: pos.lat, lng: pos.lng, accuracyM }
        const result = advance(phaseRef.current, ping, jobSites)
        phaseRef.current = result.phase
        setPhase(result.phase)

        for (const event of result.events) {
          const site = jobSites.find((s) => s.id === event.siteId)
          const time = new Date(event.at).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })
          setLog((prev) =>
            [
              event.kind === 'clock_in'
                ? `Clocked in at ${site?.name} · ${time}`
                : event.kind === 'clock_out'
                  ? `Clocked out of ${site?.name} · ${time}`
                  : `Passed ${site?.name} · ${time} — not clocked in`,
              ...prev,
            ].slice(0, 6),
          )
        }

        // Fire-and-forget to the server engine; it is the record that counts.
        if (at - lastSent.current >= PING_INTERVAL_MS) {
          lastSent.current = at
          void fetch('/api/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracyM, at }),
          }).catch(() => {
            /* Offline is normal on site — the native app will queue these. */
          })
        }
      },
    [],
  )

  useEffect(() => {
    if (simSite) return
    if (!('geolocation' in navigator)) {
      setError('This device has no location services.')
      return
    }

    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null)
        applyFix({ lat: p.coords.latitude, lng: p.coords.longitude }, p.coords.accuracy)
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [applyFix, simSite])

  // Standing at a site is hard to arrange during a demo, so allow pinning to one.
  useEffect(() => {
    if (!simSite) return
    const site = jobSites.find((s) => s.id === simSite)
    if (!site) return
    applyFix(site.center, 8)
    const t = setInterval(() => applyFix(site.center, 8), 5_000)
    return () => clearInterval(t)
  }, [simSite, applyFix])

  const onSite = phase.kind === 'onsite' || phase.kind === 'departing'
  const site = phase.kind === 'offsite' ? null : jobSites.find((s) => s.id === phase.siteId)

  const nearest = fix
    ? jobSites
        .map((s) => ({ site: s, d: distanceM(fix.pos, s.center) }))
        .sort((a, b) => a.d - b.d)[0]
    : null

  const elapsed =
    phase.kind === 'onsite' || phase.kind === 'departing'
      ? Math.max(0, tick - phase.since)
      : 0
  const hh = Math.floor(elapsed / 3_600_000)
  const mm = Math.floor((elapsed % 3_600_000) / 60_000)

  const confirming =
    phase.kind === 'arriving'
      ? Math.max(0, Math.ceil((DWELL_IN_MS - (tick - phase.since)) / 1000))
      : 0

  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.appBg,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 430, padding: 16 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '4px 2px 14px',
          }}
        >
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
            MO
          </span>
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Miguel Ortiz</div>
            <div style={{ fontSize: 12, color: theme.inkSoft }}>Foreman</div>
          </div>
        </header>

        {/* Status card — the only thing that matters at a glance. */}
        <div
          style={{
            background: onSite ? '#EAF7EE' : theme.panel,
            border: `1px solid ${onSite ? '#B7E3C3' : theme.border}`,
            borderRadius: 10,
            padding: 20,
            textAlign: 'center',
          }}
        >
          {onSite ? (
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
                {hh}:{String(mm).padStart(2, '0')}
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
              <div style={{ fontSize: 40, fontWeight: 600, margin: '8px 0 2px' }}>
                {confirming}s
              </div>
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
                  ? `${(nearest.d / 1000).toFixed(1)} km from ${nearest.site.name}`
                  : 'Waiting for GPS…'}
              </div>
              <div style={{ fontSize: 12, color: theme.inkSoft }}>
                You'll clock in automatically when you arrive.
              </div>
            </>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: '#FDECEC',
              border: '1px solid #F5C2C2',
              fontSize: 12.5,
              color: '#8A1C1C',
            }}
          >
            Location unavailable — {error}. Tracking needs location permission set
            to “Always” to work with the screen off.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {['Take photo', 'Upload receipt', 'Site chat'].map((label) => (
            <button
              key={label}
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
              {label}
            </button>
          ))}
        </div>

        {log.length > 0 && (
          <div
            style={{
              marginTop: 16,
              background: theme.panel,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: '.1em',
                color: theme.inkFaint,
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              TODAY
            </div>
            {log.map((line, i) => (
              <div key={i} style={{ padding: '8px 12px', fontSize: 12.5 }}>
                {line}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: `1px dashed ${theme.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: theme.inkFaint }}>
            DEMO — PIN MY LOCATION TO A SITE
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {jobSites.map((s) => (
              <button
                key={s.id}
                onClick={() => setSimSite(simSite === s.id ? null : s.id)}
                style={{
                  padding: '5px 9px',
                  borderRadius: 3,
                  border: `1px solid ${simSite === s.id ? theme.accent : theme.border}`,
                  background: simSite === s.id ? theme.accentFill : theme.panel,
                  color: simSite === s.id ? theme.accent : theme.ink,
                  font: 'inherit',
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: theme.inkFaint, marginTop: 8 }}>
            {fix
              ? `GPS ±${Math.round(fix.accuracyM)} m · ${fix.pos.lat.toFixed(5)}, ${fix.pos.lng.toFixed(5)}`
              : 'No fix yet'}
          </div>
        </div>

        <p style={{ fontSize: 11, color: theme.inkFaint, textAlign: 'center', marginTop: 18 }}>
          Location tracked 6:00 AM – 4:00 PM on scheduled shifts only.
        </p>
      </div>
    </div>
  )
}
