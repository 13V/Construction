/**
 * Jobs, /jobs: the website's home page. Every job the company has, Active,
 * Future and Archived, with who is on it, how ready it is and what needs
 * somebody, and on the right the list of what needs somebody.
 *
 * The rows are the phone's own data (useJobs wraps useSimpleData, the
 * phone's one loader), so the board and the crew's Projects screen show the
 * same jobs with the same chips. The phone hides archived jobs; the board
 * lists them under Archived, because that is where Restore lives.
 *
 * Status changes are the office's (job_sites_write is owner-only RLS, and
 * only an owner reaches this page). Each one is asked first, written by
 * setStatus, which reads the row back (RLS turns a refused update into an
 * empty success), and then the row moves to its new list straight away,
 * from the row the database returned, while the board reads everything
 * again behind it. A toast says where it went and offers Undo.
 *
 * Keys: / searches, N starts a new job, Enter in the search opens the first
 * job listed, ArrowDown goes from the search into the rows and ArrowUp from
 * the first row back. Which list is open and what was searched are kept in
 * the address (?show=future&q=…), so Back from a job lands where you were.
 *
 * The page reads again when the window comes back into focus, when the tab
 * becomes visible and every minute while it is (useFresh, inside useJobs and
 * the panels), so a job changed on a phone shows here without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { localISO } from '../data/contract'
import { setStatus, type JobStatus } from '../data/jobs'
import { useReadinessMap } from '../data/readiness'
import { useJobs, type JobsData } from '../data/useJobs'
import { AttentionPanel } from '../jobs/AttentionPanel'
import { jobTitle, JobsTable, type BoardShow } from '../jobs/JobsTable'
import { builderOf, supabase, type JobSiteRow } from '../phone'
import { complianceGaps } from '../phone-features'
import type { PageProps } from '../routes'
import { linkProps, navigate, paths } from '../router'
import { Page } from '../shell/PageHeader'
import { useToast } from '../shell/Toast'
import { color, radius, size, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button, PlusIcon } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Empty } from '../ui/Empty'
import { Segmented } from '../ui/Segmented'

const SHOWS: ReadonlyArray<{ value: BoardShow; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'future', label: 'Future' },
  { value: 'archived', label: 'Archived' },
]

const isShow = (v: string | null): v is BoardShow => v === 'active' || v === 'future' || v === 'archived'

/** What the board's address says: ?show=future&q=seacombe. */
function readAddress(): { show: BoardShow | null; q: string } {
  const p = new URLSearchParams(window.location.search)
  const show = p.get('show')
  return { show: isShow(show) ? show : null, q: p.get('q') ?? '' }
}

/**
 * Keep the address in step with the board, replacing the entry rather than
 * adding one: Back should leave the board, not step back through every
 * letter typed. Written straight to history, not through navigate(),
 * because nothing else on the page follows these two values.
 */
function writeAddress(show: BoardShow | null, q: string) {
  const p = new URLSearchParams(window.location.search)
  if (show) p.set('show', show)
  else p.delete('show')
  if (q) p.set('q', q)
  else p.delete('q')
  const qs = p.toString()
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next)
}

/**
 * The search: every word must appear somewhere in the job's name, address,
 * builder or work. "seacombe bath" finds Seacombe gardens' bathrooms.
 */
function matches(site: Pick<JobSiteRow, 'name' | 'address' | 'client_name' | 'job_type'>, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [site.name, site.address ?? '', builderOf(site), site.job_type ?? ''].join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/**
 * Whether the board's own read (the jobs, their bookings and dates) is the
 * one that failed, rather than the phone's loader (defect counts, who is on
 * the clock), which runs beside it. useJobs reports one error for the two.
 *
 * The board's read hands over a new list every time it answers and keeps
 * the old one when it fails, so a load that ends still holding the list it
 * began with did not answer. That settles it when both failed with the same
 * words (a dropped connection says "Failed to fetch" to both); otherwise an
 * error that is not the phone loader's is the board's.
 */
function useBoardFailed(jobs: JobsData): boolean {
  const busy = jobs.loading || jobs.refreshing
  const [load, setLoad] = useState({ busy, from: jobs.sites, failed: false })
  if (busy !== load.busy) {
    setLoad(busy ? { busy, from: jobs.sites, failed: load.failed } : { busy, from: jobs.sites, failed: jobs.error !== null && jobs.sites === load.from })
  }
  if (jobs.error === null) return false
  if (jobs.simple.error === null || jobs.error !== jobs.simple.error) return true
  return load.failed
}

/** Typing somewhere: a key there is a letter, not a shortcut. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/** What each move says before it is made, and after. */
const MOVE: Record<JobStatus, { title: (t: string) => string; body: string; confirm: string; done: (t: string) => string; danger?: boolean }> = {
  active: {
    title: (t) => `Mark ${t} active?`,
    body: "It moves to Active projects on the crew's phones and on this board. Its bookings, dates and fence stay as they are.",
    confirm: 'Mark active',
    done: (t) => `${t} is Active now.`,
  },
  archived: {
    title: (t) => `Archive ${t}?`,
    body:
      "It comes off the crew's phones: Home, Projects, the Schedule's week and day, and its chat. Nobody can clock on there any more. " +
      'Its photos, chat, bookings and files are kept, and Restore puts it back as a Future job.',
    confirm: 'Archive',
    done: (t) => `${t} is archived.`,
    danger: true,
  },
  starting_soon: {
    title: (t) => `Restore ${t} to Future?`,
    body: "It goes back on the crew's phones as a Future project, and the crew can clock on there again. Mark it active when work starts.",
    confirm: 'Restore',
    done: (t) => `${t} is back in Future.`,
  },
}

export default function JobsPage({ me }: PageProps) {
  const jobs = useJobs(me)
  const boardFailed = useBoardFailed(jobs)
  const toast = useToast()
  const searchRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const [chosen, setChosen] = useState<BoardShow | null>(() => readAddress().show)
  const [q, setQ] = useState(() => readAddress().q)
  useEffect(() => writeAddress(chosen, q.trim()), [chosen, q])

  // Rows as the database returned them from a status change, shown until
  // the board's next read lands. useJobs cancels a read already on its way
  // when it is asked again, so the next `sites` it hands over is from after
  // the write, and these can all go then.
  const [moved, setMoved] = useState<Map<string, JobSiteRow>>(() => new Map())
  const [seen, setSeen] = useState(jobs.sites)
  if (seen !== jobs.sites) {
    setSeen(jobs.sites)
    if (moved.size) setMoved(new Map())
  }
  const sites = useMemo(() => (moved.size ? jobs.sites.map((x) => moved.get(x.id) ?? x) : jobs.sites), [jobs.sites, moved])

  const groups = useMemo(() => {
    const g: Record<BoardShow, JobSiteRow[]> = { active: [], future: [], archived: [] }
    for (const x of sites) {
      if (x.status === 'active') g.active.push(x)
      else if (x.status === 'starting_soon') g.future.push(x)
      else if (x.status === 'archived') g.archived.push(x)
    }
    return g
  }, [sites])
  const found = useMemo(
    () => ({
      active: groups.active.filter((x) => matches(x, q)),
      future: groups.future.filter((x) => matches(x, q)),
      archived: groups.archived.filter((x) => matches(x, q)),
    }),
    [groups, q],
  )

  // Nobody chose a list: Active, unless nothing is running and something is
  // lined up (a new company's first jobs are all Future), then Future.
  const show: BoardShow = chosen ?? (!jobs.loading && groups.active.length === 0 && groups.future.length > 0 ? 'future' : 'active')
  const rows = found[show]
  const searching = q.trim().length > 0

  // The checklist for every job not archived: one request per table, not per job.
  const live = useMemo(() => sites.filter((x) => x.status !== 'archived'), [sites])
  const ready = useReadinessMap(live)

  const today = localISO(new Date())

  // ------------------------------------------------------------ status changes

  const [asking, setAsking] = useState<{ site: JobSiteRow; to: JobStatus } | null>(null)
  const [busy, setBusy] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  // Where the moved row was, so focus can land on the row that took its place.
  const [refocus, setRefocus] = useState<number | null>(null)

  const refresh = jobs.refresh
  const move = useCallback(
    async (site: JobSiteRow, to: JobStatus): Promise<JobSiteRow> => {
      const row = await setStatus(site.id, to)
      setMoved((m) => new Map(m).set(row.id, row))
      refresh()
      return row
    },
    [refresh],
  )

  const confirmMove = async () => {
    if (!asking) return
    const { site, to } = asking
    const from = site.status
    const title = jobTitle(site)
    const at = rows.findIndex((x) => x.id === site.id)
    setBusy(true)
    setAskError(null)
    try {
      await move(site, to)
    } catch (e) {
      setAskError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      return
    }
    setBusy(false)
    setAsking(null)
    setRefocus(Math.max(0, at))
    toast(MOVE[to].done(title), {
      tone: 'success',
      action: {
        label: 'Undo',
        onClick: () => {
          move(site, from).then(
            () => toast(MOVE[from].done(title), { tone: 'success' }),
            (e: unknown) => toast(`Could not undo: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' }),
          )
        },
      },
    })
  }

  // The row the dialog would hand focus back to has just moved to another
  // list, so focus would fall to the page. Put it on the row now in that
  // place (or the last row, or the search) so a keyboard carries on from
  // where it was. Runs after the dialog's own focus restore, and only if
  // that found nothing to go back to.
  useEffect(() => {
    if (refocus === null) return
    setRefocus(null)
    if (document.activeElement && document.activeElement !== document.body) return
    const trs = tableRef.current?.querySelectorAll<HTMLElement>('tbody tr[tabindex="0"]')
    const target = trs && trs.length ? trs[Math.min(refocus, trs.length - 1)] : searchRef.current
    target?.focus()
  }, [refocus])

  const ask = useCallback((site: JobSiteRow, to: JobStatus) => {
    setAskError(null)
    setAsking({ site, to })
  }, [])

  // ------------------------------------------------------------ keys

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      // Not while a dialog, a drawer or a row's menu is open: those keys are theirs.
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        navigate(paths.jobNew)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const firstRow = () => tableRef.current?.querySelector<HTMLElement>('tbody tr[tabindex="0"]') ?? null

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const first = rows[0]
      if (first) navigate(paths.job(first.id))
    } else if (e.key === 'ArrowDown') {
      const row = firstRow()
      if (row) {
        e.preventDefault()
        row.focus()
      }
    } else if (e.key === 'Escape' && q) {
      e.preventDefault()
      setQ('')
    }
  }

  // ------------------------------------------------------------ render

  const newJob = (
    <Button variant="primary" href={paths.jobNew} icon={<PlusIcon />} aria-keyshortcuts="N" title="New job (N)">
      New job
    </Button>
  )

  // A company with no jobs at all: one card saying what to do first. Not
  // when the jobs could not be read: a company whose list failed to load is
  // not a new one.
  if (!jobs.loading && !boardFailed && jobs.sites.length === 0) {
    return (
      <Page title="Jobs" actions={newJob}>
        <FirstJob me={me} />
      </Page>
    )
  }

  const others = SHOWS.filter((x) => x.value !== show && found[x.value].length > 0)
  const empty = jobs.loading ? (
    'Loading jobs…'
  ) : boardFailed && jobs.sites.length === 0 ? (
    'The jobs could not be loaded.'
  ) : searching ? (
    <span data-board-empty="search" style={{ display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: space.xs }}>
      <span>
        No {show === 'future' ? 'Future' : show === 'active' ? 'Active' : 'Archived'} job matches “{q.trim()}”.
      </span>
      {others.map((x) => (
        <button key={x.value} type="button" className="wb-link wb-link--button" onClick={() => setChosen(x.value)}>
          {found[x.value].length} in {x.label}
        </button>
      ))}
    </span>
  ) : (
    <span data-board-empty={show}>
      {show === 'active'
        ? 'No jobs running right now. Anything lined up is under Future.'
        : show === 'future'
          ? 'Nothing lined up. A new job starts here, as a Future job, until somebody marks it active.'
          : 'Nothing archived. Archive a job when it is finished: it comes off the crew’s phones, and everything on it is kept.'}
    </span>
  )

  return (
    <Page title="Jobs" actions={newJob}>
      {jobs.error && (
        <div style={{ marginBottom: space.md }} data-board-error={boardFailed ? (jobs.sites.length ? 'stale' : 'jobs') : 'phone'}>
          <Banner
            tone="error"
            title={!boardFailed ? 'Defects and who is on site could not be read' : jobs.sites.length ? 'The jobs could not be refreshed' : 'The jobs could not be loaded'}
            action={
              <Button size="sm" onClick={jobs.refresh}>
                Try again
              </Button>
            }
          >
            {/* The jobs listed came from a read that worked (an earlier one, if this one failed), so say which. */}
            {!boardFailed
              ? `The jobs, their dates and bookings are up to date, but a row may be missing its defects chip or who is on the clock there. ${jobs.error}`
              : jobs.sites.length
                ? `What is shown is from the last time it worked. ${jobs.error}`
                : jobs.error}
          </Banner>
        </div>
      )}

      <div className="wb-split">
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm }}>
            <Segmented
              label="Which jobs"
              value={show}
              onChange={setChosen}
              options={SHOWS.map((x) => ({ value: x.value, label: x.label, count: jobs.loading ? undefined : found[x.value].length }))}
            />
            <SearchBox inputRef={searchRef} value={q} onChange={setQ} onKeyDown={onSearchKey} />
          </div>
          <JobsTable
            wrapRef={tableRef}
            show={show}
            sites={rows}
            spanOf={jobs.spanOf}
            peopleOf={jobs.peopleOf}
            chipFor={jobs.chipFor}
            readiness={ready.map}
            readinessFailed={Boolean(ready.error)}
            today={today}
            onStatus={ask}
            empty={empty}
            onLeaveTop={() => searchRef.current?.focus()}
          />
          {searching && rows.length > 0 && (
            <div style={{ ...text.xs, color: color.muted }}>
              Enter opens {jobTitle(rows[0]!)}. Esc clears the search.
            </div>
          )}
        </div>
        <aside aria-label="Needs attention" style={{ minWidth: 0 }}>
          <AttentionPanel sites={sites} />
        </aside>
      </div>

      {asking && (
        <Dialog
          open
          title={MOVE[asking.to].title(jobTitle(asking.site))}
          confirmLabel={MOVE[asking.to].confirm}
          tone={MOVE[asking.to].danger ? 'danger' : 'default'}
          busy={busy}
          error={askError}
          onConfirm={() => void confirmMove()}
          onCancel={() => setAsking(null)}
        >
          <MoveBody site={asking.site} to={asking.to} onClock={jobs.peopleOf(asking.site.id).filter((p) => p.onClock).map((p) => p.name)} />
        </Dialog>
      )}
    </Page>
  )
}

function MoveBody({ site, to, onClock }: { site: JobSiteRow; to: JobStatus; onClock: string[] }) {
  const sub = [jobTitle(site) !== site.name ? site.name : '', builderOf(site)].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
      {sub && <div style={{ ...text.sm, color: color.muted }}>{sub}</div>}
      <div>{MOVE[to].body}</div>
      {to === 'archived' && onClock.length > 0 && (
        <div style={{ padding: `${space.xs}px ${space.sm}px`, borderRadius: radius.sm, background: color.amberFill, ...text.sm, color: color.amber }}>
          {onClock.join(', ').replace(/, ([^,]*)$/, ' and $1')} {onClock.length === 1 ? 'is' : 'are'} on the clock there right now.
        </div>
      )}
    </div>
  )
}

/** The search box: a magnifier, the text, and a "/" to say how to get here without the mouse. */
function SearchBox({
  inputRef,
  value,
  onChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  onChange: (v: string) => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div role="search" style={{ position: 'relative', flex: '0 1 300px', minWidth: 200 }}>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', marginTop: -7.5, color: color.muted, pointerEvents: 'none' }}>
        <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        className="wb-input"
        aria-label="Search jobs by name, address, builder or work"
        aria-keyshortcuts="/"
        placeholder="Search jobs"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        data-board-search=""
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ height: size.control, paddingLeft: 34, paddingRight: 34 }}
      />
      {!focused && !value && (
        <kbd
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            marginTop: -10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 20,
            height: 20,
            padding: '0 5px',
            boxSizing: 'border-box',
            border: `1px solid ${color.border}`,
            borderRadius: 5,
            background: color.rowFill,
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            color: color.muted,
            pointerEvents: 'none',
          }}
        >
          /
        </kbd>
      )}
    </div>
  )
}

/**
 * A company with no jobs yet. One thing to do, said as what happens when
 * it is done, and under it what the company's paperwork still lacks (the
 * phone's complianceGaps), since the first job's SWMS and certificates print
 * from those details.
 */
function FirstJob({ me }: { me: PageProps['me'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <Empty
        data-board-empty="company"
        title="Set up your first job"
        action={
          <Button variant="primary" href={paths.jobNew} icon={<PlusIcon />}>
            New job
          </Button>
        }
      >
        Name it, put the fence round the site, pick the builder and book the crew. It is on your crew’s phones the moment you save it.
      </Empty>
      <GapsLine me={me} />
    </div>
  )
}

/** "Before your first SWMS or certificate goes out, add an ABN, …": a link to Company, or nothing once it is all there. */
function GapsLine({ me }: { me: PageProps['me'] }) {
  const [gaps, setGaps] = useState<string[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('companies')
      .select('abn, licence_no, address, certifier_name')
      .eq('id', me.company_id)
      .maybeSingle()
      .then(({ data }) => {
        // Unreadable says nothing rather than claiming everything is missing.
        if (!cancelled && data) setGaps(complianceGaps(data as Parameters<typeof complianceGaps>[0]))
      })
    return () => {
      cancelled = true
    }
  }, [me.company_id])
  if (!gaps || gaps.length === 0) return null
  return (
    <div
      data-company-gaps={gaps.length}
      style={{ display: 'flex', alignItems: 'baseline', gap: space.xs, padding: `${space.sm}px ${space.md}px`, background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, ...text.sm, color: color.body }}
    >
      <span aria-hidden="true" style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: color.amber, transform: 'translateY(-1px)' }} />
      <span>
        Before your first SWMS or certificate goes out, your company details still need{' '}
        {gaps.map((gap, i) => (
          <span key={gap}>
            {i === 0 ? '' : i === gaps.length - 1 ? ' and ' : ', '}
            <span title={gap} style={{ fontWeight: 600, color: color.amber }}>
              {gap.split(' — ')[0]}
            </span>
          </span>
        ))}
        .{' '}
        <a {...linkProps(paths.company)} className="wb-link" style={{ whiteSpace: 'nowrap' }}>
          Fill them in
        </a>
      </span>
    </div>
  )
}
