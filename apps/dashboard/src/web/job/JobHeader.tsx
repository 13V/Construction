/**
 * The top of a job's page: a 112 px charcoal band, the phone's job header
 * (Job.tsx, #2B2F33) at desk size, with the job's rail colour down its edge.
 *
 * It says what the board row says, and in the same words: the title is
 * addressLine or the name (the phone's rule for how a job names itself),
 * then the name and the work, then builder · status · dates · fence. Its
 * actions are the job's whole lifecycle: Edit job, and Mark active /
 * Archive / Restore to Future. Each status change is confirmed in a dialog
 * and read back (jobs.ts setStatus throws when RLS quietly refused it), so
 * the header never shows a status the database does not hold.
 *
 * The job's dates live here too (useJobDates), because the header and the
 * Overview's Project card both show them and must agree: one load, handed
 * to both by the job page. They are the phone's dates (siteSpan): dates
 * typed on the job win; otherwise the widest of our programme lines, the
 * bookings and the clock-ons, exactly as the phone's Project details and
 * Schedule work them out.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { allRows, startOfToday } from '../data/bookings'
import { setStatus, type JobStatus } from '../data/jobs'
import { addressLine, builderOf, railOf, siteSpan, supabase, type JobSiteRow } from '../phone'
import { paths } from '../router'
import { useToast } from '../shell/Toast'
import { color, radius, space, text } from '../tokens'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Dialog } from '../ui/Dialog'

// ------------------------------------------------------------------ dates

export interface JobDates {
  /** Local-midnight millis (start and end of the span), or null when nothing says when it runs. */
  span: { s: number; e: number } | null
  /** typed: starts_on is set on the job. derived: worked out from programme lines, bookings and clock-ons. */
  source: 'typed' | 'derived' | 'none'
  /** True until the first derived load has answered (never, for typed dates). */
  loading: boolean
}

type SpanInputs = { tasks: Array<{ starts_on: string | null; ends_on: string | null }>; assignments: Array<{ starts_at: string; ends_at: string | null }>; shifts: Array<{ started_at: string }> }

/**
 * A job's dates by the phone's rule. Typed dates need no request, so an
 * edit to ends_on shows the moment the job row is read again. Derived dates
 * read the job's own rows, a page at a time so a long job is not cut short
 * by the API's row cap, and are read again whenever the job row is (pass a
 * new row object: the job page reads it on focus, when the tab is shown
 * again, every 60 s and after every change made on the page), so they never
 * lag the row they are shown beside.
 */
export function useJobDates(site: JobSiteRow | null): JobDates {
  const [rows, setRows] = useState<{ siteId: string; data: SpanInputs } | null>(null)

  useEffect(() => {
    if (!site || site.starts_on) return
    const siteId = site.id
    let cancelled = false
    const c = supabase()
    void (async () => {
      try {
        const [tasks, assignments, shifts] = await Promise.all([
          allRows<SpanInputs['tasks'][number]>((a, b) => c.from('programme_tasks').select('starts_on, ends_on').eq('site_id', siteId).eq('is_ours', true).order('id').range(a, b)),
          allRows<SpanInputs['assignments'][number]>((a, b) => c.from('assignments').select('starts_at, ends_at').eq('site_id', siteId).order('id').range(a, b)),
          allRows<SpanInputs['shifts'][number]>((a, b) => c.from('shifts').select('started_at').eq('site_id', siteId).order('id').range(a, b)),
        ])
        if (!cancelled) setRows({ siteId, data: { tasks, assignments, shifts } })
      } catch {
        // Dates are a summary: a failed refresh keeps the last ones, and the
        // job page's own banner already says when the job could not load.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [site])

  if (!site) return { span: null, source: 'none', loading: true }
  const set = { starts_on: site.starts_on, ends_on: site.ends_on }
  if (site.starts_on) return { span: siteSpan({ tasks: [], assignments: [], shifts: [], set }), source: 'typed', loading: false }
  const mine = rows?.siteId === site.id ? rows.data : null
  const span = mine ? siteSpan({ ...mine, set }) : null
  return { span, source: span ? 'derived' : 'none', loading: !mine }
}

const day = (ms: number, opts: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleDateString('en-AU', opts)

/**
 * A span in words, as short as stays unambiguous:
 * "3 Nov 2026", "3–28 Nov 2026", "3 Nov – 2 Dec 2026", "28 Dec 2026 – 9 Jan 2027".
 */
export function spanWords(span: { s: number; e: number } | null): string {
  if (!span) return ''
  const a = new Date(span.s)
  const b = new Date(span.e)
  const full = { day: 'numeric', month: 'short', year: 'numeric' } as const
  if (a.toDateString() === b.toDateString()) return day(span.s, full)
  if (a.getFullYear() !== b.getFullYear()) return `${day(span.s, full)} – ${day(span.e, full)}`
  if (a.getMonth() !== b.getMonth()) return `${day(span.s, { day: 'numeric', month: 'short' })} – ${day(span.e, full)}`
  return `${a.getDate()}–${day(span.e, full)}`
}

/** A Future job whose first day is behind us: the owner moves it to Active by hand (no nightly job does). */
function startPassed(site: Pick<JobSiteRow, 'status'>, dates: JobDates, now = new Date()): boolean {
  return site.status === 'starting_soon' && !!dates.span && dates.span.s < startOfToday(now).getTime()
}

// ------------------------------------------------------------------ status

/** The phone's words for a job's status, in colours that read on charcoal. */
const STATUS_WORDS: Record<JobStatus, { label: string; bg: string; fg: string }> = {
  // The phone's Future chip (Projects.tsx): amber on cream.
  starting_soon: { label: 'Starting soon', bg: color.amberFill, fg: color.amber },
  active: { label: 'Active', bg: color.greenFill, fg: color.green },
  archived: { label: 'Archived', bg: 'rgba(255,255,255,.14)', fg: color.onDark },
}

type Move = { to: JobStatus; verb: string; title: string; body: string; done: string; danger?: boolean }

const MOVES: Record<'activate' | 'archive' | 'restore', Move> = {
  activate: {
    to: 'active',
    verb: 'Mark active',
    title: 'Mark this job active?',
    body: "It moves from Future to Active on the board and on the crew's phones.",
    done: 'Job marked active',
  },
  archive: {
    to: 'archived',
    verb: 'Archive',
    title: 'Archive this job?',
    body:
      "It comes off the crew's phones and off the board's Active and Future lists, and nobody can clock on here. Nothing is deleted: files, notes, chat and bookings stay, and Restore brings it back. Take anyone still booked off on the Crew tab first if they should not turn up.",
    done: 'Job archived',
    danger: true,
  },
  restore: {
    to: 'starting_soon',
    verb: 'Restore to Future',
    title: 'Restore this job to Future?',
    body: "It goes back on the board and on the crew's phones under Future. Mark it active when work starts.",
    done: 'Job restored to Future',
  },
}

// ------------------------------------------------------------------ header

export interface JobHeaderProps {
  site: JobSiteRow
  dates: JobDates
  /** After a status change has been read back: reload the job. */
  onChanged: () => void
}

/**
 * Buttons inside the band. The kit's colours are custom properties
 * (web.css reads var(--wb-*)), so the band redefines the few that must
 * change on charcoal: the focus ring turns white, and a hover is a white
 * wash rather than the page's light grey.
 */
const BAND_VARS = {
  '--wb-focus': color.onDark,
  '--wb-hover': 'rgba(255,255,255,.10)',
  '--wb-pressed': 'rgba(255,255,255,.16)',
} as CSSProperties

/** An outlined button on charcoal: the kit's ghost button, in white. */
const onDarkButton: CSSProperties = { color: color.onDark, borderColor: 'rgba(255,255,255,.24)' }

export function JobHeader({ site, dates, onChanged }: JobHeaderProps) {
  const toast = useToast()
  const [asking, setAsking] = useState<Move | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = addressLine(site) || site.name
  const builder = builderOf(site)
  const status = STATUS_WORDS[site.status] ?? STATUS_WORDS.starting_soon
  const when = spanWords(dates.span)
  const passed = startPassed(site, dates)
  const under = [title !== site.name ? site.name : null, site.job_type.trim() || null].filter(Boolean).join(' · ')

  const moves: Move[] = site.status === 'archived' ? [MOVES.restore] : site.status === 'active' ? [MOVES.archive] : [MOVES.archive, MOVES.activate]

  const confirm = async () => {
    if (!asking) return
    setBusy(true)
    setError(null)
    try {
      const row = await setStatus(site.id, asking.to)
      // setStatus has read the row back; say so only for the status it holds.
      if (row.status !== asking.to) throw new Error('The status did not save. Try again.')
      toast(asking.done, { tone: 'success' })
      setAsking(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Each fact after the first carries its own separator, so a line that wraps
  // never ends on a dangling dot.
  const sep = <span aria-hidden="true" style={{ marginRight: space.xs, color: color.onDarkFaint }}>·</span>
  const fact = { display: 'inline-flex', alignItems: 'center', gap: space.xs, whiteSpace: 'nowrap' } as const

  return (
    <header
      data-job-header=""
      data-status={site.status}
      style={{
        ...BAND_VARS,
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: `${space.sm}px ${space.lg}px`,
        minHeight: 112,
        padding: `${space.md}px ${space.lg}px ${space.md}px ${space.lg + 6}px`,
        boxSizing: 'border-box',
        background: color.charcoal,
        color: color.onDark,
        borderRadius: radius.lg,
        overflow: 'hidden',
      }}
    >
      {/* The job's colour, as its edge on every list and bar it appears in. */}
      <span aria-hidden="true" data-job-rail={railOf(site)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: railOf(site) }} />

      {/* 340 px before the actions wrap under it, on a window too narrow for both. */}
      <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 data-job-title="" style={{ margin: 0, ...text.title, color: color.onDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </h1>
        {under && (
          <div data-job-name="" style={{ ...text.base, color: '#A7AEB6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {under}
          </div>
        )}
        <div data-job-meta="" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: `${space.xxs}px ${space.xs}px`, marginTop: 2, ...text.sm, color: '#C3C8CD' }}>
          <span data-job-builder="">{builder || <span style={{ color: color.onDarkMuted }}>No builder yet</span>}</span>
          <span style={fact}>
            {sep}
            <span data-job-status="">
              <Chip size="sm" bg={status.bg} fg={status.fg}>
                {status.label}
              </Chip>
            </span>
            {passed && (
              <Chip size="sm" bg={color.amberFill} fg={color.amber} title="Nothing moves a job to Active by itself">
                Start date passed
              </Chip>
            )}
          </span>
          <span style={fact}>
            {sep}
            <span data-job-dates="" title={dates.source === 'typed' ? 'Set on the job' : dates.source === 'derived' ? 'From the programme, bookings and clock-ons' : undefined}>
              {when || <span style={{ color: color.onDarkMuted }}>{dates.loading ? ' ' : 'No dates yet'}</span>}
            </span>
          </span>
          <span style={fact}>
            {sep}
            <span data-job-fence="">{site.radius_m} m fence</span>
          </span>
        </div>
      </div>

      <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginLeft: 'auto' }}>
        {/* One white button per band: Edit job on a running job, the status move otherwise. */}
        <Button variant={site.status === 'active' ? 'light' : 'ghost'} style={site.status === 'active' ? undefined : onDarkButton} href={paths.jobEdit(site.id)} data-action="edit">
          Edit job
        </Button>
        {moves.map((m) => (
          <Button
            key={m.to}
            data-action={m.to}
            variant={m.to === 'archived' ? 'ghost' : 'light'}
            style={m.to === 'archived' ? onDarkButton : undefined}
            onClick={() => {
              setError(null)
              setAsking(m)
            }}
          >
            {m.verb}
          </Button>
        ))}
      </div>

      <Dialog
        open={asking !== null}
        title={asking?.title}
        confirmLabel={asking?.verb}
        tone={asking?.danger ? 'danger' : 'default'}
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setAsking(null)
          setError(null)
        }}
      >
        {asking?.body}
      </Dialog>
    </header>
  )
}
