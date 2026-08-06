import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type DailyLogRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Daily logs draft themselves from shifts, site photos, expenses and
 * equipment we already have — the foreman reviews and confirms rather than
 * filling out a form from scratch. Only weather and "anything else" are
 * ever typed by hand; everything else carries a "from your data" marker so
 * it's obvious what to double-check versus what to add.
 */

const RECENT_DAYS = 14

interface Edits {
  weather: string
  workCompleted: string
  materials: string
  equipmentNote: string
  issues: string
  extraNotes: string
}

const blankEdits: Edits = {
  weather: '',
  workCompleted: '',
  materials: '',
  equipmentNote: '',
  issues: '',
  extraNotes: '',
}

const editsFrom = (row: DailyLogRow): Edits => ({
  weather: row.weather ?? '',
  workCompleted: row.work_completed ?? '',
  materials: row.materials ?? '',
  equipmentNote: row.equipment_note ?? '',
  issues: row.issues ?? '',
  extraNotes: row.extra_notes ?? '',
})

const todayStr = () => new Date().toISOString().slice(0, 10)

export function DailyLogs({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '')
  const [date, setDate] = useState(todayStr())

  const [currentLog, setCurrentLog] = useState<DailyLogRow | null>(null)
  const [loadingCurrent, setLoadingCurrent] = useState(false)
  const [recentLogs, setRecentLogs] = useState<DailyLogRow[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)

  const [edits, setEdits] = useState<Edits>(blankEdits)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!siteId && sites[0]) setSiteId(sites[0].id)
  }, [sites, siteId])

  const loadCurrent = useCallback(async () => {
    if (!siteId || !date) {
      setCurrentLog(null)
      return
    }
    setLoadingCurrent(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('site_id', siteId)
      .eq('log_date', date)
      .maybeSingle()
    setLoadingCurrent(false)
    if (err) {
      setError(err.message)
      return
    }
    setCurrentLog((data as DailyLogRow | null) ?? null)
  }, [siteId, date])

  const loadRecent = useCallback(async () => {
    if (!siteId) {
      setRecentLogs([])
      return
    }
    setLoadingRecent(true)
    const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
    const { data, error: err } = await supabase()
      .from('daily_logs')
      .select('*')
      .eq('site_id', siteId)
      .gte('log_date', cutoff)
      .order('log_date', { ascending: false })
    setLoadingRecent(false)
    if (err) {
      setError(err.message)
      return
    }
    setRecentLogs((data as DailyLogRow[]) ?? [])
  }, [siteId])

  useEffect(() => {
    void loadCurrent()
  }, [loadCurrent])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  useEffect(() => {
    setEdits(currentLog ? editsFrom(currentLog) : blankEdits)
  }, [currentLog])

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '—'
  const workerName = (id: string | null) => workers.find((w) => w.id === id)?.name ?? 'Unknown'

  async function generate() {
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const {
        data: { session },
      } = await supabase().auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not signed in')

      const res = await fetch('/api/draft-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ siteId, date }),
      })
      const body = (await res.json().catch(() => null)) as
        | { row?: DailyLogRow; aiGenerated?: boolean; error?: string }
        | null
      if (!res.ok) throw new Error(body?.error ?? `Could not generate a draft (${res.status})`)
      if (body?.row) setCurrentLog(body.row)
      if (body && body.aiGenerated === false) {
        setNotice('Narrative text wasn’t AI-generated (no API key configured) — the crew, hours and figures below are still pulled straight from your data.')
      }
      await loadRecent()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a draft.')
    } finally {
      setGenerating(false)
    }
  }

  async function saveDraft() {
    if (!currentLog) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase()
      .from('daily_logs')
      .update({
        weather: edits.weather.trim() || null,
        work_completed: edits.workCompleted.trim() || null,
        materials: edits.materials.trim() || null,
        equipment_note: edits.equipmentNote.trim() || null,
        issues: edits.issues.trim() || null,
        extra_notes: edits.extraNotes.trim() || null,
      })
      .eq('id', currentLog.id)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    await loadCurrent()
    await loadRecent()
    onChanged()
  }

  async function confirm() {
    if (!currentLog) return
    setConfirming(true)
    setError(null)
    const { error: err } = await supabase()
      .from('daily_logs')
      .update({
        weather: edits.weather.trim() || null,
        work_completed: edits.workCompleted.trim() || null,
        materials: edits.materials.trim() || null,
        equipment_note: edits.equipmentNote.trim() || null,
        issues: edits.issues.trim() || null,
        extra_notes: edits.extraNotes.trim() || null,
        status: 'confirmed',
        confirmed_by: me.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', currentLog.id)
    setConfirming(false)
    if (err) {
      setError(err.message)
      return
    }
    await loadCurrent()
    await loadRecent()
    onChanged()
  }

  const totalHours = (currentLog?.crew_summary ?? []).reduce((sum, c) => sum + Number(c.hours), 0)
  const confirmed = currentLog?.status === 'confirmed'
  const readOnly = confirmed

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Daily Logs</h1>
          <span style={{ fontSize: 13, color: theme.inkSoft }}>
            {recentLogs.length} in last {RECENT_DAYS} days
          </span>
        </div>

        {sites.length === 0 ? (
          <div style={{ ...card, color: theme.inkSoft, fontSize: 13 }}>
            No job sites yet — add one before logging a day's work.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={selectStyle}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => setDate(e.target.value)}
                style={{ ...selectStyle, fontVariantNumeric: 'tabular-nums' }}
              />
            </div>

            {error && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>
            )}
            {notice && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: theme.inkSoft }}>{notice}</div>
            )}

            {loadingCurrent ? (
              <div style={{ ...card, color: theme.inkSoft, fontSize: 13 }}>Loading…</div>
            ) : !currentLog ? (
              <div style={card}>
                <p style={{ margin: 0, fontSize: 13, color: theme.inkSoft, lineHeight: 1.5 }}>
                  No log yet for {siteName(siteId)} on {new Date(`${date}T00:00:00`).toLocaleDateString()}.
                  Generate a draft from the shifts, photos, purchases and equipment on record for that day.
                </p>
                <button onClick={() => void generate()} disabled={generating} style={{ ...cta, marginTop: 12 }}>
                  {generating ? 'GENERATING…' : 'GENERATE DRAFT'}
                </button>
              </div>
            ) : (
              <div style={card}>
                {confirmed ? (
                  <div style={{ ...band, background: '#EAF7EE', color: '#1B7A32' }}>
                    Confirmed by {workerName(currentLog.confirmed_by)}
                    {currentLog.confirmed_at &&
                      ` · ${new Date(currentLog.confirmed_at).toLocaleDateString()} ${new Date(currentLog.confirmed_at).toLocaleTimeString()}`}
                  </div>
                ) : (
                  <div style={{ ...band, background: '#FFF6DF', color: '#8A6100' }}>
                    Draft
                    {currentLog.generated_at &&
                      ` — generated ${new Date(currentLog.generated_at).toLocaleTimeString()}`}
                    . Review and confirm.
                  </div>
                )}

                <Section label="Crew on site" fromData>
                  {(currentLog.crew_summary ?? []).length === 0 ? (
                    <div style={{ fontSize: 13, color: theme.inkFaint }}>No shifts on record.</div>
                  ) : (
                    <div style={{ fontSize: 13 }}>
                      {currentLog.crew_summary.map((c, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '3px 0',
                            borderBottom: i < currentLog.crew_summary.length - 1 ? `1px solid ${theme.border}` : 'none',
                          }}
                        >
                          <span>{c.name}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: theme.inkSoft }}>
                            {Number(c.hours).toFixed(1)} h
                          </span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0 0', fontWeight: 600 }}>
                        <span>Total</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalHours.toFixed(1)} h</span>
                      </div>
                    </div>
                  )}
                </Section>

                <Section label="Weather">
                  {readOnly ? (
                    <Readonly value={edits.weather} />
                  ) : (
                    <input
                      value={edits.weather}
                      onChange={(e) => setEdits({ ...edits, weather: e.target.value })}
                      placeholder="Clear, mid-70s"
                      style={field}
                    />
                  )}
                </Section>

                <Section label="Work completed" fromData>
                  {readOnly ? (
                    <Readonly value={edits.workCompleted} />
                  ) : (
                    <textarea
                      value={edits.workCompleted}
                      onChange={(e) => setEdits({ ...edits, workCompleted: e.target.value })}
                      style={textarea}
                    />
                  )}
                </Section>

                <Section label="Materials" fromData>
                  {readOnly ? (
                    <Readonly value={edits.materials} />
                  ) : (
                    <textarea
                      value={edits.materials}
                      onChange={(e) => setEdits({ ...edits, materials: e.target.value })}
                      style={textarea}
                    />
                  )}
                </Section>

                <Section label="Equipment" fromData>
                  {readOnly ? (
                    <Readonly value={edits.equipmentNote} />
                  ) : (
                    <textarea
                      value={edits.equipmentNote}
                      onChange={(e) => setEdits({ ...edits, equipmentNote: e.target.value })}
                      style={textarea}
                    />
                  )}
                </Section>

                <Section label="Issues" fromData>
                  {readOnly ? (
                    <Readonly value={edits.issues} />
                  ) : (
                    <textarea
                      value={edits.issues}
                      onChange={(e) => setEdits({ ...edits, issues: e.target.value })}
                      style={textarea}
                    />
                  )}
                </Section>

                <Section label="Anything else?">
                  {readOnly ? (
                    <Readonly value={edits.extraNotes} />
                  ) : (
                    <textarea
                      value={edits.extraNotes}
                      onChange={(e) => setEdits({ ...edits, extraNotes: e.target.value })}
                      placeholder="Anything the data above wouldn't catch"
                      style={textarea}
                    />
                  )}
                </Section>

                {!readOnly && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button onClick={() => void confirm()} disabled={confirming || saving} style={cta}>
                      {confirming ? 'SENDING…' : 'CONFIRM & SEND'}
                    </button>
                    <button onClick={() => void saveDraft()} disabled={saving || confirming} style={ghost}>
                      {saving ? 'SAVING…' : 'Save draft'}
                    </button>
                    <button
                      onClick={() => void generate()}
                      disabled={generating || saving || confirming}
                      style={ghost}
                    >
                      {generating ? 'Regenerating…' : 'Regenerate from data'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${theme.border}` }}>
                Recent logs — {siteName(siteId)}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Crew', 'Hours', 'Status'].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingRecent && (
                    <tr>
                      <td colSpan={4} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loadingRecent && recentLogs.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ ...td, padding: 24, color: theme.inkSoft }}>
                        No logs in the last {RECENT_DAYS} days.
                      </td>
                    </tr>
                  )}
                  {recentLogs.map((row) => {
                    const hours = (row.crew_summary ?? []).reduce((sum, c) => sum + Number(c.hours), 0)
                    const isSelected = row.log_date === date
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setDate(row.log_date)}
                        style={{ cursor: 'pointer', background: isSelected ? theme.accentFill : undefined }}
                      >
                        <td style={td}>{new Date(`${row.log_date}T00:00:00`).toLocaleDateString()}</td>
                        <td style={{ ...td, color: theme.inkSoft }}>
                          {(row.crew_summary ?? []).length}
                        </td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{hours.toFixed(1)} h</td>
                        <td style={td}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 3,
                              fontSize: 11,
                              fontWeight: 600,
                              background: row.status === 'confirmed' ? '#EAF7EE' : '#FFF6DF',
                              color: row.status === 'confirmed' ? '#1B7A32' : '#8A6100',
                            }}
                          >
                            {row.status === 'confirmed' ? 'Confirmed' : 'Draft'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ label, fromData, children }: { label: string; fromData?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: theme.inkFaint,
          }}
        >
          {label}
        </span>
        {fromData && (
          <span style={{ fontSize: 10, fontWeight: 700, color: theme.accent }}>· from your data</span>
        )}
      </div>
      {children}
    </div>
  )
}

function Readonly({ value }: { value: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: value ? theme.ink : theme.inkFaint }}>
      {value || '—'}
    </div>
  )
}

const card = {
  marginTop: 14,
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
} as const

const band = {
  padding: '8px 10px',
  borderRadius: 4,
  fontSize: 12.5,
  lineHeight: 1.4,
} as const

const th = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.appBg,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
  textAlign: 'left' as const,
}

const td = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 13,
}

const ghost = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
}

const cta = {
  padding: '7px 13px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

const selectStyle = {
  height: 32,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const field = {
  display: 'block',
  width: '100%',
  height: 32,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const textarea = {
  display: 'block',
  width: '100%',
  minHeight: 56,
  padding: '7px 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.45,
  color: theme.ink,
  resize: 'vertical',
} as const
