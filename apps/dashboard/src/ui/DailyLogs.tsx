import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type DailyLogRow, type WorkerRow } from '../data/supabase'
import { api } from '../data/api'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * Daily logs draft themselves from shifts, site photos, expenses and
 * materials we already have — the foreman reviews and confirms rather than
 * filling out a form from scratch. Only weather and "anything else" are
 * ever typed by hand; everything else carries a "from your data" marker so
 * it's obvious what to double-check versus what to add.
 *
 * Layout follows design/screens/isDailyLog.html: sections render as plain
 * read text first ("review"), and "Edit sections" swaps the data-derived
 * ones to textareas ("confirm") — the amber band's framing is "review and
 * confirm", not "fill in a form". "Anything else" is the one field that's
 * always live, since it's the one thing the data could never know.
 */

const RECENT_DAYS = 14

interface Edits {
  weather: string
  workCompleted: string
  materials: string
  issues: string
  extraNotes: string
}

const blankEdits: Edits = {
  weather: '',
  workCompleted: '',
  materials: '',
  issues: '',
  extraNotes: '',
}

const editsFrom = (row: DailyLogRow): Edits => ({
  weather: row.weather ?? '',
  workCompleted: row.work_completed ?? '',
  materials: row.materials ?? '',
  issues: row.issues ?? '',
  extraNotes: row.extra_notes ?? '',
})

const todayStr = () => new Date().toISOString().slice(0, 10)

/** `log_date` is a bare YYYY-MM-DD with no timezone — parsing it directly
 *  would land on UTC midnight and can read back as the previous day west of
 *  Greenwich. Anchoring to local noon-less midnight keeps it on the day the
 *  crew actually worked. */
function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}
function formatFullDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-AU', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
function formatShortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' })
}
function formatMediumDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}
/** generated_at / confirmed_at are real timestamps, not bare dates — format
 *  them directly rather than through the local-midnight helper above. */
function formatTimestampDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

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
  // Sections open in read mode ("review") until the foreman opts into
  // "Edit sections" ("confirm") — matches the design's static paragraphs
  // plus a dedicated edit affordance, rather than always-open text fields.
  const [editMode, setEditMode] = useState(false)
  // Real ordinal — count of this site's daily logs up to and including this
  // date — not a fabricated project-day counter we have no data to back.
  const [logNumber, setLogNumber] = useState<number | null>(null)

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
    // Every fresh load (including right after a save) drops back to review
    // mode — the just-saved text is what you see, not an open text field.
    setEditMode(false)

    if (!currentLog) {
      setLogNumber(null)
      return
    }
    const siteForCount = currentLog.site_id
    const dateForCount = currentLog.log_date
    let cancelled = false
    async function countLogs() {
      const { count } = await supabase()
        .from('daily_logs')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteForCount)
        .lte('log_date', dateForCount)
      if (!cancelled) setLogNumber(count ?? null)
    }
    void countLogs()
    return () => {
      cancelled = true
    }
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

      const res = await fetch(api('/api/draft-log'), {
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

  const confirmed = currentLog?.status === 'confirmed'
  const busy = generating || saving || confirming

  // Shared between the main card's "Crew on site" rows and the phone
  // preview — crew_summary only keeps name + hours, so initials/trade are
  // a best-effort match against the current roster, not stored on the row.
  const crewRows = (currentLog?.crew_summary ?? []).map((c) => {
    const w = workers.find((x) => x.name === c.name)
    return { ini: w?.initials, name: c.name, trade: w?.trade ?? '', hours: Number(c.hours) }
  })
  const totalHours = crewRows.reduce((sum, r) => sum + r.hours, 0)
  const isToday = date === todayStr()

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg, padding: '16px 18px 40px' }}>
      {/* Inline styles can't reach ::placeholder — one scoped rule keeps the
          "anything the data wouldn't know" placeholder text the exact muted
          tone the design specifies instead of each browser's own default. */}
      <style>{`.daily-log-field::placeholder { color: #B7BCC2; opacity: 1; }`}</style>

      {sites.length === 0 ? (
        <div style={emptyCard}>No job sites yet — add one before logging a day's work.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={pickerField}>
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
              style={{ ...pickerField, fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
              {recentLogs.length} log{recentLogs.length === 1 ? '' : 's'} in the last {RECENT_DAYS} days
            </span>
          </div>

          {error && <div style={{ marginBottom: 10, fontSize: 12.5, color: theme.alert }}>{error}</div>}
          {notice && <div style={{ marginBottom: 10, fontSize: 12.5, color: theme.inkSoft }}>{notice}</div>}

          {loadingCurrent ? (
            <div style={emptyCard}>Loading…</div>
          ) : !currentLog ? (
            <div style={emptyCard}>
              <p style={{ margin: 0, fontSize: 13, color: theme.inkSoft, lineHeight: 1.5 }}>
                No log yet for {siteName(siteId)} on {formatMediumDate(date)}. Generate a draft from the
                shifts, photos, purchases and materials on record for that day.
              </p>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={generating}
                style={{ ...ctaButton, marginTop: 12 }}
              >
                {generating ? 'GENERATING…' : 'GENERATE DRAFT'}
              </button>
            </div>
          ) : (
            <>
              {confirmed ? (
                <ConfirmedBand name={workerName(currentLog.confirmed_by)} confirmedAt={currentLog.confirmed_at} />
              ) : (
                <DraftBand generatedAt={currentLog.generated_at} />
              )}

              <div style={twoColRow}>
                <div style={mainCard}>
                  <div style={cardHeader}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 17, fontWeight: 600 }}>Daily log — {siteName(currentLog.site_id)}</span>
                      <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                        {formatFullDate(currentLog.log_date)} · Prepared for {me.name}
                      </span>
                    </div>
                    {logNumber != null && <span style={logBadge}>Log #{logNumber}</span>}
                  </div>

                  <LogSection title="Crew on site" source="Tallied from clocked shifts on this date." fromData>
                    {crewRows.length === 0 ? (
                      <span style={{ fontSize: 13, color: theme.inkFaint }}>No shifts on record.</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {crewRows.map((r, i) => (
                          <div key={i} style={crewRowBox}>
                            {r.ini && <span style={crewAvatar}>{r.ini}</span>}
                            <span style={crewName}>{r.name}</span>
                            <span style={crewTrade}>{r.trade}</span>
                            <span style={crewHours}>{r.hours.toFixed(1)} h</span>
                          </div>
                        ))}
                        <div style={crewTotalRow}>
                          <span>Total</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalHours.toFixed(1)} h</span>
                        </div>
                      </div>
                    )}
                  </LogSection>

                  <TextLogSection
                    title="Weather"
                    source="Not tracked automatically — type it in."
                    fromData={false}
                    value={edits.weather}
                    editable={!confirmed && editMode}
                    placeholder="Clear, mid-70s"
                    onChange={(v) => setEdits({ ...edits, weather: v })}
                  />

                  <TextLogSection
                    title="Work completed"
                    source="Summarized from crew and hours on site."
                    fromData
                    value={edits.workCompleted}
                    editable={!confirmed && editMode}
                    onChange={(v) => setEdits({ ...edits, workCompleted: v })}
                  />

                  <TextLogSection
                    title="Materials"
                    source="From materials delivered and purchases logged today."
                    fromData
                    value={edits.materials}
                    editable={!confirmed && editMode}
                    onChange={(v) => setEdits({ ...edits, materials: v })}
                  />

                  <TextLogSection
                    title="Issues"
                    source="From site photos flagged as issues today."
                    fromData
                    value={edits.issues}
                    editable={!confirmed && editMode}
                    onChange={(v) => setEdits({ ...edits, issues: v })}
                  />

                  <div style={anythingElseRow}>
                    <div style={sectionLabelCol}>
                      <span style={sectionTitle}>Anything else?</span>
                      <span style={sectionSource}>The only thing you have to type.</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {confirmed ? (
                        <div style={anythingElseBox}>
                          <span style={{ fontSize: 13.5, color: edits.extraNotes ? theme.ink : theme.inkFaint }}>
                            {edits.extraNotes || '—'}
                          </span>
                        </div>
                      ) : (
                        <textarea
                          className="daily-log-field"
                          value={edits.extraNotes}
                          onChange={(e) => setEdits({ ...edits, extraNotes: e.target.value })}
                          placeholder="Anything the data wouldn't know — subs, visitors, delays, safety notes…"
                          aria-label="Anything else?"
                          style={anythingElseTextarea}
                        />
                      )}
                    </div>
                  </div>

                  {!confirmed && (
                    <div style={cardFooter}>
                      <button type="button" onClick={() => void confirm()} disabled={busy} style={ctaButton}>
                        {confirming ? 'SENDING…' : 'CONFIRM & SEND'}
                      </button>
                      <span style={footerCaption}>Sends to owner + client portal.</span>
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => setEditMode(true)}
                        disabled={busy}
                        style={footerGhost}
                      >
                        Edit sections
                      </button>
                      <button type="button" onClick={() => void saveDraft()} disabled={busy} style={footerGhost}>
                        {saving ? 'SAVING…' : 'Save draft'}
                      </button>
                    </div>
                  )}
                </div>

                {!confirmed && (
                  <div style={phoneCol} aria-hidden="true">
                    <div style={phoneColHeading}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>Foreman confirms on site — three taps</span>
                    </div>
                    <div style={phoneFrame}>
                      <div style={phoneScreen}>
                        <div style={phoneStatusBar}>
                          <span style={phoneTime}>
                            {new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <svg width="16" height="11" viewBox="0 0 16 11" fill="#1A1D21">
                              <rect x="0" y="7" width="2.6" height="4" rx="0.6" />
                              <rect x="4" y="5" width="2.6" height="6" rx="0.6" />
                              <rect x="8" y="2.6" width="2.6" height="8.4" rx="0.6" />
                              <rect x="12" y="0" width="2.6" height="11" rx="0.6" opacity="0.3" />
                            </svg>
                            <svg width="22" height="11" viewBox="0 0 24 12" fill="none">
                              <rect x="1" y="1" width="19" height="10" rx="3" stroke="#1A1D21" strokeOpacity="0.4" />
                              <rect x="2.5" y="2.5" width="12" height="7" rx="1.8" fill="#1A1D21" />
                            </svg>
                          </span>
                        </div>

                        <div style={phoneHeader}>
                          <span style={{ fontSize: 17, fontWeight: 600 }}>{isToday ? "Today's log" : 'Daily log'}</span>
                          <span style={{ fontSize: 12.5, color: theme.inkSoft }}>
                            {siteName(currentLog.site_id)} · {formatShortDate(currentLog.log_date)}
                          </span>
                        </div>

                        <div style={phoneBanner}>
                          <ClockIcon size={15} />
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#8A6100' }}>
                            Drafted for you{currentLog.generated_at ? ` at ${formatTime(currentLog.generated_at)}` : ''}
                          </span>
                        </div>

                        <div style={phoneList}>
                          {[
                            {
                              k: 'Crew',
                              v: crewRows.length ? `${crewRows.length} on site · ${totalHours.toFixed(1)} h` : 'No shifts on record',
                            },
                            { k: 'Weather', v: edits.weather || 'Not entered' },
                            { k: 'Work completed', v: edits.workCompleted || '—' },
                            { k: 'Materials', v: edits.materials || '—' },
                            { k: 'Issues', v: edits.issues || '—' },
                          ].map((row) => (
                            <div key={row.k} style={phoneRow}>
                              <CheckIcon />
                              <div style={phoneRowText}>
                                <span style={{ fontSize: 15, fontWeight: 600 }}>{row.k}</span>
                                <span style={{ fontSize: 13.5, lineHeight: 1.45, color: theme.inkSoft }}>{row.v}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div style={phoneNoteWrap}>
                          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', color: '#8B9096' }}>
                            ANYTHING ELSE?
                          </span>
                          <div style={phoneNoteBox}>
                            <span style={{ fontSize: 14, color: edits.extraNotes ? theme.ink : '#B7BCC2' }}>
                              {edits.extraNotes || 'Tap to add a note…'}
                            </span>
                          </div>
                        </div>

                        <div style={phoneFooter}>
                          <div style={phoneCta}>{'CONFIRM & SEND'}</div>
                          <span style={{ fontSize: 12.5, color: '#8B9096', textAlign: 'center' }}>
                            Goes to the owner and client portal.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div style={recentCard}>
            <div style={recentHeader}>Recent logs — {siteName(siteId)}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Date', 'Crew', 'Hours', 'Status'].map((h) => (
                    <th key={h} style={thStyle}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingRecent && (
                  <tr>
                    <td colSpan={4} style={{ ...tdStyle, padding: 24, color: theme.inkSoft }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loadingRecent && recentLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...tdStyle, padding: 24, color: theme.inkSoft }}>
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
                      <td style={tdStyle}>{formatMediumDate(row.log_date)}</td>
                      <td style={{ ...tdStyle, color: theme.inkSoft }}>{(row.crew_summary ?? []).length}</td>
                      <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums' }}>{hours.toFixed(1)} h</td>
                      <td style={tdStyle}>
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
  )
}

// ------------------------------------------------------------------ pieces

function ClockIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#C9A227" strokeWidth={1.5} style={{ flex: 'none' }}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8v3.4l2.4 1.4" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 16 16"
      fill="none"
      stroke={theme.success}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none', marginTop: 2 }}
    >
      <path d="M3 8.4l3.2 3.2L13 4.8" />
    </svg>
  )
}

function DraftBand({ generatedAt }: { generatedAt: string | null }) {
  return (
    <div style={draftBand}>
      <span style={{ ...bandHeadline, color: '#8A6100' }}>
        <ClockIcon size={17} />
        Draft{generatedAt ? ` — generated ${formatTime(generatedAt)}` : ''}. Review and confirm.
      </span>
      <span style={{ width: 1, height: 14, background: '#E7D6A6' }} />
      <span style={{ fontSize: 12.5, color: '#8A6100' }}>
        Nothing here was typed by hand. Every section came from data the app already had.
      </span>
      <div style={{ flex: 1 }} />
      {/* Each section already carries its own "from your data" marker, so a
          second link that opened nothing was noise. */}
    </div>
  )
}

function ConfirmedBand({ name, confirmedAt }: { name: string; confirmedAt: string | null }) {
  return (
    <div style={confirmedBandStyle}>
      <span style={{ ...bandHeadline, color: '#1B7A32' }}>
        <CheckIcon />
        Confirmed by {name}. Locked and sent.
      </span>
      {confirmedAt && (
        <>
          <span style={{ width: 1, height: 14, background: '#B9DDC0' }} />
          <span style={{ fontSize: 12.5, color: '#1B7A32' }}>
            Sent {formatTimestampDate(confirmedAt)} at {formatTime(confirmedAt)}.
          </span>
        </>
      )}
    </div>
  )
}

function LogSection({
  title,
  source,
  fromData,
  children,
}: {
  title: string
  source: string
  fromData: boolean
  children: ReactNode
}) {
  return (
    <div style={sectionRow}>
      <div style={sectionLabelCol}>
        <span style={sectionTitle}>{title}</span>
        {fromData && <span style={fromDataBadge}>FROM YOUR DATA</span>}
        <span style={sectionSource}>{source}</span>
      </div>
      <div style={sectionBodyCol}>{children}</div>
    </div>
  )
}

function TextLogSection({
  title,
  source,
  fromData,
  value,
  editable,
  placeholder,
  onChange,
}: {
  title: string
  source: string
  fromData: boolean
  value: string
  editable: boolean
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <LogSection title={title} source={source} fromData={fromData}>
      {editable ? (
        <textarea
          className="daily-log-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={title}
          style={sectionTextarea}
        />
      ) : (
        <p style={sectionParagraph}>{value || '—'}</p>
      )}
    </LogSection>
  )
}

// ------------------------------------------------------------------ styles

const emptyCard = {
  padding: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  color: theme.inkSoft,
  fontSize: 13,
} as const

const pickerField = {
  height: 32,
  padding: '0 9px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const bandHeadline = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontSize: 13.5,
  fontWeight: 600,
} as const

const bandBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 14px',
  borderRadius: 8,
  marginBottom: 14,
  flexWrap: 'wrap',
} as const

const draftBand = {
  ...bandBase,
  background: '#FFF9E8',
  border: '1px solid #F0DCA8',
} as const

const confirmedBandStyle = {
  ...bandBase,
  background: '#EAF7EE',
  border: '1px solid #C3E6CB',
} as const

const twoColRow = {
  display: 'flex',
  gap: 14,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
} as const

const mainCard = {
  flex: '1 1 620px',
  minWidth: 460,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  overflow: 'hidden',
} as const

const cardHeader = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 14,
  padding: '14px 16px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const logBadge = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 3,
  background: theme.appBg,
  fontSize: 11.5,
  fontWeight: 600,
  color: theme.inkSoft,
  whiteSpace: 'nowrap',
} as const

const sectionRow = {
  display: 'flex',
  gap: 14,
  padding: '13px 16px',
  borderBottom: '1px solid #F1F3F5',
} as const

const sectionLabelCol = {
  flex: 'none',
  width: 150,
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
} as const

const sectionTitle = {
  fontSize: 12.5,
  fontWeight: 700,
} as const

const fromDataBadge = {
  display: 'inline-flex',
  alignSelf: 'flex-start',
  alignItems: 'center',
  gap: 5,
  padding: '2px 6px',
  borderRadius: 3,
  background: theme.accentFill,
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.03em',
  color: theme.accent,
} as const

const sectionSource = {
  fontSize: 11,
  lineHeight: 1.35,
  color: '#8B9096',
} as const

const sectionBodyCol = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
} as const

const sectionParagraph = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.6,
  color: theme.ink,
  textWrap: 'pretty',
  // Generated text is a single sentence, but hand-typed weather notes can
  // carry real line breaks — preserve them instead of collapsing to one line.
  whiteSpace: 'pre-wrap',
} as const

const sectionTextarea = {
  font: 'inherit',
  display: 'block',
  width: '100%',
  minHeight: 56,
  padding: '11px 12px',
  borderRadius: 4,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  fontSize: 13.5,
  lineHeight: 1.6,
  color: theme.ink,
  resize: 'vertical',
} as const

const crewRowBox = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 10px',
  background: '#FAFBFC',
  border: '1px solid #EDEFF1',
  borderRadius: 4,
} as const

const crewAvatar = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: theme.railSoft,
  color: '#fff',
  fontSize: 8.5,
  fontWeight: 700,
} as const

const crewName = {
  flex: 1,
  minWidth: 0,
  fontSize: 12.5,
  fontWeight: 500,
} as const

const crewTrade = {
  flex: 'none',
  fontSize: 12,
  color: theme.inkSoft,
} as const

const crewHours = {
  flex: 'none',
  width: 74,
  textAlign: 'right',
  fontSize: 12.5,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
} as const

const crewTotalRow = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: 2,
  paddingTop: 6,
  borderTop: '1px solid #EDEFF1',
  fontSize: 12.5,
  fontWeight: 700,
} as const

const anythingElseRow = {
  display: 'flex',
  gap: 14,
  padding: '13px 16px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const anythingElseBox = {
  minHeight: 74,
  padding: '11px 12px',
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  background: theme.panel,
} as const

const anythingElseTextarea = {
  ...sectionTextarea,
  minHeight: 74,
} as const

const cardFooter = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 16px',
  background: '#FAFBFC',
  flexWrap: 'wrap',
} as const

const ctaButton = {
  display: 'flex',
  alignItems: 'center',
  height: 34,
  padding: '0 18px',
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: theme.ink,
  cursor: 'pointer',
} as const

const footerCaption = {
  fontSize: 12.5,
  color: theme.inkSoft,
} as const

const footerGhost = {
  display: 'flex',
  alignItems: 'center',
  height: 30,
  padding: '0 12px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  color: theme.ink,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const

const phoneCol = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  width: 390,
} as const

const phoneColHeading = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
} as const

const phoneFrame = {
  width: 390,
  height: 844,
  background: theme.rail,
  borderRadius: 42,
  padding: 9,
  boxShadow: '0 8px 26px rgba(26,29,33,.18)',
} as const

const phoneScreen = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: theme.panel,
  borderRadius: 34,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
} as const

const phoneStatusBar = {
  flex: 'none',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  height: 46,
  padding: '0 24px 6px',
} as const

const phoneTime = {
  fontSize: 13.5,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
} as const

const phoneHeader = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '4px 20px 12px',
  borderBottom: `1px solid ${theme.border}`,
} as const

const phoneBanner = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '11px 20px',
  background: '#FFF9E8',
  borderBottom: '1px solid #F0DCA8',
} as const

const phoneList = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
} as const

const phoneRow = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 11,
  padding: '15px 20px',
  borderBottom: '1px solid #EDEFF1',
} as const

const phoneRowText = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
} as const

const phoneNoteWrap = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '15px 20px',
} as const

const phoneNoteBox = {
  minHeight: 70,
  padding: 12,
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
} as const

const phoneFooter = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  padding: '14px 20px 22px',
  borderTop: `1px solid ${theme.border}`,
} as const

const phoneCta = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: 56,
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  borderRadius: 3,
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: theme.ink,
  cursor: 'default',
} as const

const recentCard = {
  marginTop: 14,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  overflow: 'hidden',
} as const

const recentHeader = {
  padding: '11px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderBottom: `1px solid ${theme.border}`,
} as const

const thStyle = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: '#FAFBFC',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: '#696D74',
  textAlign: 'left',
} as const

const tdStyle = {
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  fontSize: 12.5,
  color: theme.ink,
} as const
