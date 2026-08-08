import { useCallback, useEffect, useRef, useState } from 'react'
import {
  supabase,
  type ProgrammeRow,
  type ProgrammeTaskRow,
  type SiteProgrammeRow,
  type WorkerRow,
} from '../data/supabase'
import { extractProgramme, readCsv, readXlsx, type ProgrammeRow as SheetRow } from '../data/sheet'
import { fullDate } from '../format'
import { theme } from '../theme'
import type { JobSite } from '../types'
import {
  Chip,
  Empty,
  Fact,
  FactGrid,
  LABEL,
  ListRow,
  Note,
  Panel,
  PanelHead,
  TAB_PAD,
  ctaStyle,
  ghostStyle,
} from './kit'

/**
 * The builder's construction programme.
 *
 * A programme arrives as a Gantt chart every few weeks, revised, and the only
 * lines on it that matter to a tiler are theirs and the two trades either side.
 * This screen answers three things and deliberately does not try to redraw the
 * chart:
 *
 *   * When are we on, and has that moved since the last revision?
 *   * Is the job actually ready — has the screed gone down, is the rough-in in?
 *   * What did the builder change without telling anyone?
 *
 * Turning up to a job that is not ready is a day's wages for nothing, and it is
 * the most common way a subcontractor loses money that no invoice ever records.
 *
 * Spreadsheets are read in this browser by src/data/sheet.ts — no upload, no
 * service, works on a phone with no signal to spare. A PDF goes to
 * /api/parse-programme, which reads the bars off the timeline with Claude and
 * returns rows for confirmation. Neither path writes anything until a human has
 * looked at what came back.
 */

const MAX_PDF_BYTES = 24 * 1024 * 1024

interface Draft {
  rows: SheetRow[]
  note: string
  source: ProgrammeRow['source']
  revision: string | null
  fileName: string
}

export function ProgrammeTab({
  me,
  site,
  onChanged,
}: {
  me: WorkerRow
  site: JobSite
  onChanged: () => void
}) {
  const [programme, setProgramme] = useState<ProgrammeRow | null>(null)
  const [tasks, setTasks] = useState<ProgrammeTaskRow[]>([])
  const [summary, setSummary] = useState<SiteProgrammeRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const siteId = site.id
  const canEdit = me.is_office || me.role === 'captain'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const c = supabase()
    const { data: prog, error: pErr } = await c
      .from('programmes')
      .select('*')
      .eq('site_id', siteId)
      .eq('status', 'current')
      .maybeSingle()
    if (pErr) {
      setError(pErr.message)
      setLoading(false)
      return
    }
    const current = (prog as ProgrammeRow | null) ?? null
    setProgramme(current)

    const [t, s] = await Promise.all([
      current
        ? c.from('programme_tasks').select('*').eq('programme_id', current.id).order('starts_on', { nullsFirst: false })
        : Promise.resolve({ data: [], error: null }),
      c.from('site_programme_v').select('*').eq('site_id', siteId).maybeSingle(),
    ])
    setTasks((t.data ?? []) as ProgrammeTaskRow[])
    setSummary((s.data as SiteProgrammeRow | null) ?? null)
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  // A half-reviewed import must not follow the user onto another job.
  useEffect(() => {
    setDraft(null)
  }, [siteId])

  async function onFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        const grids = await readXlsx(await file.arrayBuffer())
        // The biggest sheet is the programme; a workbook usually carries a
        // cover sheet and a legend beside it.
        const best = grids.slice().sort((a, b) => b.rows.length - a.rows.length)
        for (const g of best) {
          const r = extractProgramme(g)
          if (r.rows.length > 0) {
            setDraft({ rows: r.rows, note: `${g.name}: ${r.note}`, source: 'excel', revision: null, fileName: file.name })
            setBusy(false)
            return
          }
        }
        setError(extractProgramme(best[0] ?? { name: '', rows: [] }).note)
      } else if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
        const r = extractProgramme({ name: file.name, rows: readCsv(await file.text()) })
        if (r.rows.length === 0) setError(r.note)
        else setDraft({ rows: r.rows, note: r.note, source: 'csv', revision: null, fileName: file.name })
      } else if (lower.endsWith('.pdf')) {
        if (file.size > MAX_PDF_BYTES) {
          setError('That PDF is too large to read. Send the tiling pages on their own.')
          setBusy(false)
          return
        }
        await readPdf(file)
      } else {
        setError('Send the programme as .xlsx, .csv or .pdf.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  async function readPdf(file: File) {
    const buf = new Uint8Array(await file.arrayBuffer())
    // btoa on a 20 MB string built with spread would blow the argument limit;
    // chunked keeps it flat.
    let binary = ''
    for (let i = 0; i < buf.length; i += 0x8000) {
      binary += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    }
    const {
      data: { session },
    } = await supabase().auth.getSession()
    const res = await fetch('/api/parse-programme', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ fileBase64: btoa(binary), mediaType: 'application/pdf', siteName: site.name }),
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      setError(
        res.status === 501
          ? 'Reading a PDF programme needs the AI key configured. Ask the builder for the Excel export, or enter the dates by hand.'
          : (payload?.error ?? 'Could not read that PDF.'),
      )
      return
    }
    const rows: SheetRow[] = (payload.tasks ?? []).map((t: Record<string, unknown>) => ({
      ref: String(t.ref ?? ''),
      name: String(t.name ?? ''),
      trade: String(t.trade ?? ''),
      startsOn: (t.starts_on as string | null) ?? null,
      endsOn: (t.ends_on as string | null) ?? null,
      durationDays: null,
      pctComplete: (t.pct_complete as number | null) ?? null,
      isOurs: t.is_ours === true,
      isPredecessor: t.is_predecessor === true,
    }))
    if (rows.length === 0) {
      setError('Nothing dated could be read off that PDF. Ask for the Excel export, or enter the dates by hand.')
      return
    }
    setDraft({
      rows,
      note: `${rows.length} tasks read${payload.note ? ` — ${payload.note}` : ''}`,
      source: 'pdf',
      revision: payload.revision ?? null,
      fileName: file.name,
    })
  }

  async function importDraft() {
    if (!draft) return
    setBusy(true)
    setError(null)
    const c = supabase()

    // Inserting the programme as 'current' supersedes the previous revision by
    // trigger, so there is never a moment where two are live.
    const { data: prog, error: pErr } = await c
      .from('programmes')
      .insert({
        company_id: me.company_id,
        site_id: siteId,
        name: draft.fileName,
        revision: draft.revision,
        source: draft.source,
        status: 'current',
        import_note: draft.note,
        imported_by: me.id,
      })
      .select()
      .single()
    if (pErr) {
      setBusy(false)
      setError(pErr.message)
      return
    }

    const programmeId = (prog as ProgrammeRow).id
    const { error: tErr } = await c.from('programme_tasks').insert(
      draft.rows.map((r, i) => ({
        company_id: me.company_id,
        programme_id: programmeId,
        site_id: siteId,
        ref: r.ref || null,
        name: r.name,
        trade: r.trade || null,
        starts_on: r.startsOn,
        ends_on: r.endsOn,
        duration_days: r.durationDays,
        pct_complete: r.pctComplete ?? 0,
        is_ours: r.isOurs,
        is_predecessor: r.isPredecessor,
        sort: i,
      })),
    )
    if (tErr) {
      setBusy(false)
      setError(`The programme saved but its tasks failed: ${tErr.message}`)
      return
    }

    // Carry the previous revision's dates across, matched on the builder's own
    // line refs. Done in Postgres against what is actually stored.
    await c.rpc('programme_carry_previous', { p_programme: programmeId })

    setBusy(false)
    setDraft(null)
    await load()
    onChanged()
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.inkSoft, fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  const moved = tasks.filter((t) => t.prev_starts_on && t.starts_on && t.prev_starts_on !== t.starts_on)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: TAB_PAD }}>
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: theme.alertFill, border: `1px solid ${theme.border}`, borderRadius: 8, fontSize: 12.5, color: theme.alertInk }}>
          {error}
        </div>
      )}

      {/* --------------------------------------------------- are we on, is it ready */}
      <Panel style={{ marginBottom: 14 }}>
        <PanelHead
          right={
            canEdit && !draft ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xlsm,.csv,.tsv,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onFile(f)
                    e.target.value = ''
                  }}
                />
                <button onClick={() => fileInput.current?.click()} disabled={busy} style={ctaStyle}>
                  {busy ? 'READING…' : programme ? 'IMPORT A REVISION' : 'IMPORT THE PROGRAMME'}
                </button>
              </>
            ) : undefined
          }
        >
          {programme ? `Programme${programme.revision ? ` · ${programme.revision}` : ''}` : 'No programme imported'}
        </PanelHead>

        {summary && summary.our_start ? (
          <FactGrid min={165}>
            <Fact
              k="WE'RE ON"
              v={fullDate(summary.our_start)}
              note={summary.our_end ? `through ${fullDate(summary.our_end)}` : summary.our_task ?? ''}
            />
            <Fact
              k="THAT'S IN"
              v={
                summary.days_until_start === null
                  ? '—'
                  : summary.days_until_start < 0
                    ? `${Math.abs(summary.days_until_start)} days ago`
                    : `${summary.days_until_start} days`
              }
              note={summary.our_task ?? ''}
            />
            <Fact
              k="MOVED"
              v={
                summary.start_moved_days === null
                  ? '—'
                  : summary.start_moved_days === 0
                    ? 'No change'
                    : `${summary.start_moved_days > 0 ? '+' : ''}${summary.start_moved_days} days`
              }
              note={summary.start_moved_days === null ? 'first revision' : 'since the last revision'}
              fg={summary.start_moved_days && summary.start_moved_days !== 0 ? theme.warnInk : theme.ink}
            />
            <Fact
              k="READY FOR US"
              v={summary.ready === null ? 'Unknown' : summary.ready ? 'Yes' : 'No'}
              note={
                summary.ready === null
                  ? 'the programme names nothing we follow'
                  : summary.ready
                    ? 'everything we follow is done'
                    : `${summary.blockers_open} still open`
              }
              fg={summary.ready === false ? theme.alert : summary.ready ? theme.successInk : theme.inkSoft}
            />
          </FactGrid>
        ) : (
          <div style={{ padding: 16 }}>
            <Empty>
              {programme
                ? 'The current programme has no line marked as ours with a date still ahead. Tick the right line below and it will show here.'
                : 'Import the builder’s programme and this answers when the crew is on, whether the job will be ready, and what moved since the last revision. Excel and CSV are read here in the browser; a PDF Gantt is read by the extractor.'}
            </Empty>
          </div>
        )}

        {summary?.ready === false && summary.blocked_by && (
          <Note tone="alert">
            Not ready: {summary.blocked_by}. Sending a crew before those are finished is a day's wages against a job
            that cannot be worked, and it never appears on an invoice.
          </Note>
        )}

        {summary?.ready === null && programme && (
          <Note tone="warn">
            Nothing on this programme is marked as a trade we follow, so readiness is unknown rather than clear. Tick
            "we follow" on the screed, rough-in or set-out lines below to turn it on.
          </Note>
        )}
      </Panel>

      {/* ------------------------------------------------------------ the review */}
      {draft && (
        <Panel style={{ marginBottom: 14 }}>
          <PanelHead>Check this before it lands</PanelHead>
          <Note>{draft.note}</Note>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            {draft.rows.map((r, i) => (
              <ListRow key={`${r.ref}-${i}`} columns="70px 1fr 110px 110px 190px">
                <span style={{ fontSize: 11.5, color: LABEL }}>{r.ref}</span>
                <span style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </span>
                <span style={{ fontSize: 12, color: LABEL }}>{r.startsOn ? fullDate(r.startsOn) : '—'}</span>
                <span style={{ fontSize: 12, color: LABEL }}>{r.endsOn ? fullDate(r.endsOn) : '—'}</span>
                <span style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
                    <input
                      type="checkbox"
                      checked={r.isOurs}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                rows: d.rows.map((x, j) =>
                                  j === i ? { ...x, isOurs: e.target.checked, isPredecessor: e.target.checked ? false : x.isPredecessor } : x,
                                ),
                              }
                            : d,
                        )
                      }
                    />
                    ours
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5 }}>
                    <input
                      type="checkbox"
                      checked={r.isPredecessor}
                      onChange={(e) =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                rows: d.rows.map((x, j) =>
                                  j === i ? { ...x, isPredecessor: e.target.checked, isOurs: e.target.checked ? false : x.isOurs } : x,
                                ),
                              }
                            : d,
                        )
                      }
                    />
                    we follow
                  </label>
                </span>
              </ListRow>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '12px 15px', alignItems: 'center' }}>
            <button onClick={() => void importDraft()} disabled={busy} style={ctaStyle}>
              {busy ? 'IMPORTING…' : 'IMPORT — SUPERSEDES THE CURRENT ONE'}
            </button>
            <button onClick={() => setDraft(null)} style={ghostStyle}>
              Discard
            </button>
            <span style={{ fontSize: 11.5, color: LABEL }}>
              Nothing is saved until you press import. Check the two ticks — everything on the screen above keys off
              them.
            </span>
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------------- what moved */}
      {moved.length > 0 && (
        <Panel style={{ marginBottom: 14 }}>
          <PanelHead>Changed in this revision</PanelHead>
          {moved.map((t) => {
            const days = Math.round(
              (new Date(`${t.starts_on}T00:00:00`).getTime() - new Date(`${t.prev_starts_on}T00:00:00`).getTime()) /
                86_400_000,
            )
            return (
              <ListRow key={t.id} columns="1fr 130px 130px 110px">
                <span style={{ fontSize: 13, fontWeight: t.is_ours ? 600 : 400 }}>
                  {t.name}
                  {t.is_ours && <span style={{ marginLeft: 8, fontSize: 11, color: theme.accent }}>ours</span>}
                </span>
                <span style={{ fontSize: 12, color: LABEL, textDecoration: 'line-through' }}>
                  {t.prev_starts_on ? fullDate(t.prev_starts_on) : '—'}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t.starts_on ? fullDate(t.starts_on) : '—'}</span>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    textAlign: 'right',
                    color: days > 0 ? theme.alert : theme.successInk,
                  }}
                >
                  {days > 0 ? `+${days} days` : `${days} days`}
                </span>
              </ListRow>
            )
          })}
        </Panel>
      )}

      {/* ------------------------------------------------------------- the lines */}
      {tasks.length > 0 && (
        <Panel>
          <PanelHead>
            The programme
            <span style={{ fontWeight: 400, fontSize: 12.5, color: LABEL }}>
              {' '}
              · imported {fullDate(programme?.received_on ?? '')} from {programme?.name}
            </span>
          </PanelHead>
          {tasks.map((t) => (
            <ListRow key={t.id} columns="70px 1fr 110px 110px 120px">
              <span style={{ fontSize: 11.5, color: LABEL }}>{t.ref ?? ''}</span>
              <span style={{ fontSize: 13, fontWeight: t.is_ours ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </span>
              <span style={{ fontSize: 12, color: LABEL }}>{t.starts_on ? fullDate(t.starts_on) : '—'}</span>
              <span style={{ fontSize: 12, color: LABEL }}>{t.ends_on ? fullDate(t.ends_on) : '—'}</span>
              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {t.is_ours ? (
                  <Chip label="Ours" bg={theme.accentFill} fg={theme.accent} />
                ) : t.is_predecessor ? (
                  <Chip
                    label={t.status === 'done' ? 'Done' : 'We follow'}
                    bg={t.status === 'done' ? theme.successFill : theme.warnFill}
                    fg={t.status === 'done' ? theme.successInk : theme.warnInk}
                  />
                ) : (
                  <span style={{ fontSize: 11.5, color: theme.inkGhost }}>{t.trade ?? ''}</span>
                )}
              </span>
            </ListRow>
          ))}
          {canEdit && (
            <Note>
              A line we follow is marked done from the builder's own update, or here. Tick the ones that gate our start
              — screed, rough-in, set-out — and readiness above stops being a guess.
            </Note>
          )}
        </Panel>
      )}

      {tasks.length > 0 && canEdit && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tasks
            .filter((t) => t.is_predecessor && t.status !== 'done')
            .map((t) => (
              <button
                key={t.id}
                style={{ ...ghostStyle, fontSize: 11.5 }}
                onClick={async () => {
                  await supabase().from('programme_tasks').update({ status: 'done', pct_complete: 100 }).eq('id', t.id)
                  await load()
                }}
              >
                Mark “{t.name}” done
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
