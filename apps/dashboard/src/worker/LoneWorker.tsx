import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../data/api'
import { supabase } from '../data/supabase'
import { theme } from '../theme'

/**
 * Lone worker safety, from the worker's side.
 *
 * On a domestic job the crew is often one person after four o'clock. If they
 * come off a trestle in an empty house, nobody finds out until they fail to
 * come home. This is the ordinary industrial answer to that: while you are on
 * your own the app asks, at an interval you choose, whether you are all right.
 * Answer and it rolls on. Don't, and the office is told where you were last
 * seen. You can also raise it yourself without waiting to be asked.
 *
 * The countdown is local and the truth is not: every state transition is the
 * server's, fetched here. A phone that is asleep, out of battery or lying in
 * the dust is exactly the case this feature is for, so nothing about a worker
 * being safe may depend on their device saying so.
 */

interface Session {
  id: string
  site_id: string | null
  interval_min: number
  grace_min: number
  due_at: string
  state: 'ok' | 'overdue' | 'alarm' | 'ended'
  last_fix_at: string | null
}

type Action = 'status' | 'start' | 'check_in' | 'sos' | 'end'

const card: CSSProperties = {
  margin: '12px 20px 0',
  border: `1px solid ${theme.border}`,
  borderRadius: 12,
  background: '#fff',
  overflow: 'hidden',
}

const row: CSSProperties = { padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 4 }
const title: CSSProperties = { fontSize: 14.5, fontWeight: 700, color: theme.ink }
const sub: CSSProperties = { fontSize: 13, lineHeight: 1.45, color: theme.inkSoft }

const button = (bg: string, fg: string, height = 46): CSSProperties => ({
  width: '100%',
  minHeight: height,
  background: bg,
  color: fg,
  border: 'none',
  borderRadius: 10,
  fontFamily: 'inherit',
  fontSize: 14.5,
  fontWeight: 700,
  letterSpacing: '.03em',
  cursor: 'pointer',
})

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export function LoneWorkerCard({
  siteId,
  getFix,
}: {
  siteId: string | null
  /** The most recent position, so an alarm carries somewhere to go. */
  getFix: () => { lat: number; lng: number; accuracyM: number | null } | null
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [interval, setIntervalMin] = useState(60)
  const mounted = useRef(true)

  const call = useCallback(async (action: Action, extra: Record<string, unknown> = {}) => {
    const { data } = await supabase().auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Session expired — sign in again.')
    const fix = getFix()
    const res = await fetch(api('/api/lone-worker'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action,
        lat: fix?.lat,
        lng: fix?.lng,
        accuracyM: fix?.accuracyM ?? undefined,
        ...extra,
      }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(payload.error ?? `Server returned ${res.status}`)
    return payload.session as Session | null
  }, [getFix])

  const run = useCallback(async (action: Action, extra?: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const next = await call(action, extra)
      if (mounted.current) setSession(next)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [call])

  // Poll rather than trust the countdown: the server decides when a session is
  // late, and the office may have resolved an alarm from their end.
  useEffect(() => {
    mounted.current = true
    void run('status')
    const poll = window.setInterval(() => void run('status'), 30_000)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      mounted.current = false
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [run])

  if (!session) {
    return (
      <div style={card}>
        <div style={row}>
          <span style={title}>Working on your own?</span>
          <span style={sub}>
            Only if you want it. Turn it on and the app asks once an hour whether you're all right —
            miss one and the office is told, with where you were last seen. Nothing asks you anything
            unless you switch this on, and it stops the moment you say you're not on your own.
          </span>
        </div>
        <div style={{ padding: '0 15px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', gap: 7 }}>
            {[30, 60, 120].map((m) => (
              <button
                key={m}
                onClick={() => setIntervalMin(m)}
                style={{
                  flex: 1,
                  minHeight: 38,
                  borderRadius: 9,
                  border: `1px solid ${interval === m ? theme.accent : theme.border}`,
                  background: interval === m ? theme.accentFill : '#fff',
                  color: interval === m ? theme.accent : theme.inkSoft,
                  fontFamily: 'inherit',
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {m} min
              </button>
            ))}
          </div>
          <button
            disabled={busy}
            onClick={() => void run('start', { intervalMin: interval, siteId })}
            style={button(theme.ink, '#fff')}
          >
            {busy ? 'STARTING…' : 'START LONE WORKER'}
          </button>
          {error && <span style={{ ...sub, color: theme.alert }}>{error}</span>}
        </div>
      </div>
    )
  }

  const dueIn = new Date(session.due_at).getTime() - now
  const alarm = session.state === 'alarm'
  const overdue = session.state === 'overdue'

  return (
    <div style={{ ...card, borderColor: alarm ? theme.alert : overdue ? theme.warnBorder : theme.border }}>
      <div
        style={{
          ...row,
          background: alarm ? theme.alertFill : overdue ? theme.warnFill : theme.accentFill,
          borderBottom: `1px solid ${theme.borderSoft}`,
        }}
      >
        <span style={{ ...title, color: alarm ? theme.alert : theme.ink }}>
          {alarm ? 'ALARM RAISED — help is being called' : overdue ? 'Check-in missed' : 'Working alone'}
        </span>
        <span style={sub}>
          {alarm
            ? 'The office has been told where you were last seen. Tap below when you are all right.'
            : overdue
              ? `Answer now, or the office is told in ${mmss(dueIn + session.grace_min * 60_000)}.`
              : `Next check-in in ${mmss(dueIn)} · every ${session.interval_min} min`}
        </span>
      </div>
      <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <button disabled={busy} onClick={() => void run('check_in')} style={button(theme.success, '#fff', 52)}>
          {busy ? 'SENDING…' : "I'M OK"}
        </button>
        {!alarm && (
          <button disabled={busy} onClick={() => void run('sos')} style={button(theme.alert, '#fff')}>
            SOS — I NEED HELP
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => void run('end')}
          style={{ ...button('#fff', theme.inkSoft, 40), border: `1px solid ${theme.border}` }}
        >
          Not on my own any more
        </button>
        {error && <span style={{ ...sub, color: theme.alert }}>{error}</span>}
      </div>
    </div>
  )
}
