import { useCallback, useEffect, useState } from 'react'
import { api } from '../data/api'
import { supabase, type DailyLogRow, type WorkerRow } from '../data/supabase'
import { useSites } from './useSites'
import { dayDate } from '../format'
import { theme } from '../theme'

/**
 * The daily log — Crewline Mobile, screen 8.
 *
 * The app drafts it from what it already knows — today's punches, photos and
 * deliveries — and the worker corrects it. It never posts one on their behalf
 * silently, because a log nobody read is a log nobody will defend in a dispute.
 * So the draft arrives as a draft, every field is editable, and nothing leaves
 * until they send it.
 *
 * Weather is typed, not fetched. The design drew it as auto-filled from the
 * site's location, and flagged that nothing joins the two — there is a
 * free-text weather column and a lat/lng, and no weather service between them.
 * Rather than draw an AUTO badge over a number nobody produced, it is a field.
 */

export function DailyLogScreen({
  me,
  siteId: standingIn,
  onClose,
}: {
  me: WorkerRow
  siteId: string | null
  onClose: () => void
}) {
  const all = useSites()
  const [siteId, setSiteId] = useState<string | null>(standingIn)
  useEffect(() => {
    if (!siteId && all.length > 0) setSiteId(standingIn ?? all[0]!.id)
  }, [all, standingIn, siteId])

  const today = new Date().toISOString().slice(0, 10)
  const [row, setRow] = useState<DailyLogRow | null>(null)
  const [weather, setWeather] = useState('')
  const [work, setWork] = useState('')
  const [materials, setMaterials] = useState('')
  const [issues, setIssues] = useState('')
  const [crew, setCrew] = useState<Array<{ name: string; hours: number }>>([])
  const [drafting, setDrafting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const site = all.find((s) => s.id === siteId)

  const load = useCallback(async () => {
    if (!siteId) return
    const { data } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('site_id', siteId)
      .eq('log_date', today)
      .maybeSingle()
    const d = data as DailyLogRow | null
    if (d) {
      setRow(d)
      setWeather(d.weather ?? '')
      setWork(d.work_completed ?? '')
      setMaterials(d.materials ?? '')
      setIssues(d.issues ?? '')
      setCrew(d.crew_summary ?? [])
      setSent(d.status === 'confirmed')
    }
  }, [siteId, today])

  useEffect(() => {
    void load()
  }, [load])

  /** Ask the server to assemble today from the punches, photos and deliveries. */
  const draft = async () => {
    if (!siteId || drafting) return
    setDrafting(true)
    setError(null)
    try {
      const { data } = await supabase().auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(api('/api/draft-log'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ siteId, date: today }),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error ?? `Server returned ${res.status}`)
      const saved = out.row as DailyLogRow
      setRow(saved)
      setWeather(saved.weather ?? '')
      setWork(saved.work_completed ?? '')
      setMaterials(saved.materials ?? '')
      setIssues(saved.issues ?? '')
      setCrew(saved.crew_summary ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setDrafting(false)
  }

  const send = async () => {
    if (!siteId || busy) return
    setBusy(true)
    setError(null)
    const payload = {
      company_id: me.company_id,
      site_id: siteId,
      log_date: today,
      weather: weather.trim() || null,
      work_completed: work.trim() || null,
      materials: materials.trim() || null,
      issues: issues.trim() || null,
      crew_summary: crew,
      status: 'confirmed' as const,
      confirmed_by: me.id,
      confirmed_at: new Date().toISOString(),
    }
    const { error: err } = row
      ? await supabase().from('daily_logs').update(payload).eq('id', row.id)
      : await supabase().from('daily_logs').insert(payload)
    setBusy(false)
    if (err) setError(err.message)
    else {
      setSent(true)
      void load()
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: theme.appBg }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: theme.panel, borderBottom: `1px solid ${theme.border}` }}>
        <button onClick={onClose} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: theme.accent, cursor: 'pointer' }}>
          ‹ Back
        </button>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>Daily log</span>
          <span style={{ fontSize: 11.5, color: theme.inkFaint }}>
            {site?.name ?? 'this site'} · {dayDate(today)}
          </span>
        </span>
        <span
          style={{
            flex: 'none',
            padding: '4px 9px',
            borderRadius: 11,
            background: sent ? theme.successFill : theme.warnFill,
            color: sent ? theme.successInk : theme.warnInk,
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {sent ? 'SENT' : 'DRAFT'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 18px 24px' }}>
        {error && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 6, background: theme.alertFill, color: theme.alertInk, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {!row && !sent && (
          <div style={{ marginBottom: 16, padding: '14px 15px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.panel }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 5 }}>Start from today</span>
            <span style={{ display: 'block', fontSize: 13, lineHeight: 1.5, color: theme.inkSoft, marginBottom: 12 }}>
              The app can assemble a draft from today's punches, photos and deliveries. You correct it before
              anything is posted.
            </span>
            <button onClick={() => void draft()} disabled={drafting || !siteId} style={{ ...primary, opacity: drafting ? 0.6 : 1 }}>
              {drafting ? 'DRAFTING…' : 'DRAFT TODAY FOR ME'}
            </button>
          </div>
        )}

        {sent && (
          <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: theme.successFill, color: theme.successInk, fontSize: 13, lineHeight: 1.5 }}>
            Sent. The office has today's log. You can still change it and send again.
          </div>
        )}

        <Field label="WEATHER">
          <input
            value={weather}
            onChange={(e) => setWeather(e.target.value)}
            placeholder="14–19 °C, showers easing"
            style={input}
          />
          {/* No AUTO badge: nothing fetches this, and pretending otherwise
              would be a number with no source. */}
          <Hint>Typed, not fetched — there is no weather service wired up.</Hint>
        </Field>

        <Field label="WHAT GOT DONE">
          <textarea value={work} onChange={(e) => setWork(e.target.value)} rows={4} style={area} />
        </Field>

        {crew.length > 0 && (
          <Field label="WHO WAS ON">
            <div style={{ padding: '11px 13px', borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.panel }}>
              <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 6 }}>
                FROM YOUR DAY
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                {crew.map((c) => `${c.name} ${Number(c.hours).toFixed(1)} hrs`).join(' · ')}
              </span>
            </div>
          </Field>
        )}

        <Field label="MATERIALS IN">
          <textarea value={materials} onChange={(e) => setMaterials(e.target.value)} rows={3} style={area} />
        </Field>

        <Field label="DELAYS AND ISSUES">
          <textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={3} style={area} />
        </Field>
      </div>

      <div style={{ flex: 'none', padding: '10px 18px 18px', borderTop: `1px solid ${theme.border}`, background: theme.panel }}>
        <button onClick={() => void send()} disabled={busy || !siteId} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'SENDING…' : sent ? 'SEND THE CHANGES' : 'SEND TODAY’S LOG'}
        </button>
        <span style={{ display: 'block', marginTop: 8, textAlign: 'center', fontSize: 12, color: theme.inkFaint }}>
          Nothing is posted until you send it.
        </span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', color: theme.inkFaint, marginBottom: 7 }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'block', marginTop: 5, fontSize: 11.5, color: theme.inkFaint }}>{children}</span>
}

const input = {
  width: '100%',
  height: 48,
  padding: '0 12px',
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  background: theme.panel,
  font: 'inherit',
  fontSize: 14,
  color: theme.ink,
} as const

const area = {
  width: '100%',
  padding: '11px 12px',
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  background: theme.panel,
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1.5,
  color: theme.ink,
  resize: 'none',
} as const

const primary = {
  width: '100%',
  height: 52,
  border: 'none',
  borderRadius: 6,
  background: theme.ink,
  color: '#fff',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: '.03em',
  cursor: 'pointer',
} as const
