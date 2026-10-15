/**
 * The jobs board's table: one 52 px row per job, in the phone's order.
 *
 *   colour · Job · Builder · Dates · Crew · Ready · Attention · ⋯
 *
 * Every fact on a row is the phone's own rule, so a job reads the same on
 * the board as on a crew member's phone:
 *  - the colour strip is railOf (the colour somebody picked, else the hash)
 *  - the title is addressLine, else the name, with the name and the work
 *    under it
 *  - the builder is builderOf; the dates are siteSpan (typed dates win,
 *    else the widest of our programme lines, bookings and time on site)
 *  - the crew are the phone's Projects people: on the clock there now, then
 *    anyone booked in the next 14 days
 *  - the attention chip is the phone's Projects chip (chipOf): a flood test
 *    first, then defects, then variations, same words, same colours
 * The Ready meter is the website's own checklist (data/readiness.ts).
 *
 * A Future job whose start date has come says so, with Mark active beside
 * it. Nothing promotes a job by itself: the phone's Home already treats an
 * arrived Future job as today's, and quietly flipping it to Active would
 * change what every phone shows without anybody deciding to.
 *
 * The row is a link to the job (Table: click, Enter, Cmd-click for a new
 * tab); a flood-test chip, Mark active and the ⋯ menu are controls of their
 * own inside it. ArrowUp and ArrowDown move between rows. The menu offers
 * what the status allows (Mark active, Archive, Restore to Future); the
 * page asks before any of them is done.
 *
 * Only the flood-test chip is a link (to Waterproofing, which deals with
 * it). The website has no page that lists defects or variations, so their
 * chips are plain and say where the details are instead of opening a tab
 * that says nothing about them (ATTENTION_DETAILS).
 *
 * The board's main column is 808 px at 1440 and narrower on a smaller
 * laptop, and the 312 px Needs attention panel stays beside it down to a
 * 1024 px window, so the table measures itself and gives up columns in
 * order, keeping the job's name readable (at least ~140 px) at every width:
 *   - under 760 px the builder moves into the line under the title
 *   - under 650 px Crew and Ready drop out
 *   - under 520 px (a 1024 px laptop, a tablet, a phone) the dates move
 *     into the line under the title too, before the builder
 * A column that does not fit is better gone than squeezed to an ellipsis.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { localISO, type AttentionChip, type AttentionKind } from '../data/contract'
import type { JobStatus } from '../data/jobs'
import type { Readiness } from '../data/readiness'
import type { JobPerson } from '../data/useJobs'
import { webRoot } from '../marker'
import { addressLine, builderOf, railOf, type JobSiteRow } from '../phone'
import { JOB_TABS, linkProps, paths } from '../router'
import { color, radius, shadow, size, space, text, z } from '../tokens'
import { AvatarStack } from '../ui/AvatarStack'
import { IconButton } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Table, type Column } from '../ui/Table'
import { ReadinessMeter } from './ReadinessMeter'

/** Which list the board is showing: the phone's Active and Future tabs, plus Archived. */
export type BoardShow = 'active' | 'future' | 'archived'

/** How a job names itself in every list: where it is, else what it is called (the phone's rule). */
export const jobTitle = (site: Pick<JobSiteRow, 'name' | 'address'>) => addressLine(site) || site.name

/**
 * Where the details of an attention item are, for the kinds the website
 * has no page for. A flood test has one (the job's Waterproofing tab); a
 * defect's description and who is responsible, and a variation's lines, are
 * on no website page, so the chip and the Needs attention panel say so
 * rather than send somebody to an Overview that says nothing about them.
 * The phone lists a job's waiting variations on its Money tab (owners and
 * office only); it lists no defects, only counts them.
 */
export const ATTENTION_DETAILS: Partial<Record<AttentionKind, string>> = {
  defects: 'Not listed on the website',
  variations: 'Listed in the Proven app, under Money',
}

/** A Future job whose typed start date is today or earlier. `today` is local YYYY-MM-DD. */
const startPassed = (site: Pick<JobSiteRow, 'status' | 'starts_on'>, today: string) =>
  site.status === 'starting_soon' && Boolean(site.starts_on) && (site.starts_on as string) <= today

/** What each status can become from the board, in the menu's order. */
const STATUS_MOVES: Record<JobStatus, ReadonlyArray<{ to: JobStatus; label: string; danger?: boolean }>> = {
  starting_soon: [
    { to: 'active', label: 'Mark active' },
    { to: 'archived', label: 'Archive', danger: true },
  ],
  active: [{ to: 'archived', label: 'Archive', danger: true }],
  archived: [{ to: 'starting_soon', label: 'Restore to Future' }],
}

/** A span end as a local YYYY-MM-DD (local parts, never UTC: the phone's rule for programme dates). */
const isoDay = (ms: number) => localISO(new Date(ms))

/**
 * A span as a row shows it: "15 Sept – 30 Sept" this year, "3 Mar – 28 Mar
 * 2027" in another, "15 Dec 2026 – 30 Jan 2027" across a new year, one date
 * for a one-day job. Months are en-AU's short names, as on the phone.
 */
function spanText(span: { s: number; e: number }, now = new Date()): string {
  const s = new Date(span.s)
  const e = new Date(span.e)
  const thisYear = now.getFullYear()
  const day = (d: Date, year: boolean) => d.toLocaleDateString('en-AU', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })
  if (isoDay(span.s) === isoDay(span.e)) return day(s, s.getFullYear() !== thisYear)
  if (s.getFullYear() === e.getFullYear()) return `${day(s, false)} – ${day(e, e.getFullYear() !== thisYear)}`
  return `${day(s, true)} – ${day(e, true)}`
}

const longDay = (ms: number) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

export interface JobsTableProps {
  show: BoardShow
  /** The jobs to list, already filtered to `show` and the search. */
  sites: JobSiteRow[]
  spanOf: (site: JobSiteRow) => { s: number; e: number } | null
  peopleOf: (siteId: string) => JobPerson[]
  chipFor: (siteId: string) => AttentionChip | null
  /** Each job's checklist; a job not in the map is still on its way, unless the load failed. */
  readiness: Map<string, Readiness>
  readinessFailed: boolean
  /** Local YYYY-MM-DD, for "Start date passed". */
  today: string
  /** A status change was asked for; the page confirms and makes it. */
  onStatus: (site: JobSiteRow, to: JobStatus) => void
  /** Shown instead of rows when there are none. */
  empty: ReactNode
  /** ArrowUp on the first row: back to the search box. */
  onLeaveTop?: () => void
  /** The table's wrapper, for the page to focus the first row. */
  wrapRef?: RefObject<HTMLDivElement | null>
}

/**
 * How much the table shows, by its own width (see the top of the file).
 * Each step down is taken where the job's column, which gets whatever the
 * fixed columns leave, would otherwise fall under about 140 px:
 *   wide   rail 4 · Builder 108 · Dates 140 · Crew 72 · Ready 72 · Attention 152 · ⋯ 44 = 592
 *   mid    the same without Builder                                                    = 484
 *   narrow without Crew and Ready                                                      = 340
 *   tight  without Dates: rail · Attention · ⋯                                          = 200
 * so at 520 px a narrow job column is 180, and a tight one is 158 on a
 * 390 px phone (358 px of table) and 192 at a 1024 px window.
 */
type Tier = 'wide' | 'mid' | 'narrow' | 'tight'

/** The wrapper's width, kept current. 0 until measured (and in a test with no layout), which counts as wide. */
function useTier(ref: RefObject<HTMLDivElement | null>): Tier {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setW(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  if (w === 0 || w >= 760) return 'wide'
  if (w >= 650) return 'mid'
  return w >= 520 ? 'narrow' : 'tight'
}

/**
 * A column with 8 px either side instead of the table's 12: the board has
 * eight columns in 808 px, and those 8 px a side are what let a date range
 * and a flood-test chip show whole.
 */
function snug(key: string, header: string, width: number, render: (site: JobSiteRow) => ReactNode): Column<JobSiteRow> {
  return {
    key,
    header: <span style={{ display: 'block', padding: `0 ${space.xs}px` }}>{header}</span>,
    width,
    flush: true,
    render: (site) => <div style={{ padding: `0 ${space.xs}px`, minWidth: 0 }}>{render(site)}</div>,
  }
}

export function JobsTable({ show, sites, spanOf, peopleOf, chipFor, readiness, readinessFailed, today, onStatus, empty, onLeaveTop, wrapRef }: JobsTableProps) {
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = wrapRef ?? ownRef
  const tier = useTier(ref)
  const [menu, setMenu] = useState<{ site: JobSiteRow; trigger: HTMLButtonElement } | null>(null)
  const archived = show === 'archived'

  const columns: Array<Column<JobSiteRow>> = [
    {
      key: 'rail',
      header: <span className="wb-sr-only">Colour</span>,
      width: 4,
      flush: true,
      render: (site) => <span aria-hidden="true" style={{ display: 'block', width: 4, height: size.rowTall, background: railOf(site) }} />,
    },
    {
      key: 'job',
      header: 'Job',
      render: (site) => <JobCell site={site} withBuilder={tier !== 'wide'} dates={tier === 'tight' ? { span: spanOf(site) } : null} />,
    },
  ]
  if (tier === 'wide') {
    columns.push(
      snug('builder', 'Builder', 108, (site) => {
        const b = builderOf(site)
        return (
          <span data-job-builder={b} title={b || undefined} style={{ display: 'block', ...text.sm, color: b ? color.body : color.ghost, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b || '—'}
          </span>
        )
      }),
    )
  }
  if (tier !== 'tight') columns.push(snug('dates', 'Dates', 140, (site) => <DatesCell site={site} span={spanOf(site)} />))
  if (tier === 'wide' || tier === 'mid') {
    columns.push(snug('crew', 'Crew', 72, (site) => <CrewCell people={peopleOf(site.id)} />))
    if (!archived) {
      columns.push(snug('ready', 'Ready', 72, (site) => <ReadinessMeter readiness={readiness.get(site.id)} loading={!readinessFailed} />))
    }
  }
  if (!archived) {
    columns.push(
      snug('attention', 'Attention', 152, (site) => (
        <AttentionCell site={site} chip={chipFor(site.id)} passed={startPassed(site, today)} onMarkActive={() => onStatus(site, 'active')} />
      )),
    )
  }
  columns.push({
    key: 'menu',
    header: <span className="wb-sr-only">Actions</span>,
    width: 44,
    flush: true,
    render: (site) => (
      <span style={{ display: 'flex', justifyContent: 'center' }}>
        <IconButton
          label={`Actions for ${jobTitle(site)}`}
          aria-haspopup="menu"
          aria-expanded={menu?.site.id === site.id}
          data-row-menu={site.id}
          onClick={(e) => {
            const trigger = e.currentTarget
            setMenu((m) => (m?.site.id === site.id ? null : { site, trigger }))
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
          </svg>
        </IconButton>
      </span>
    ),
  })

  // Up and down between rows, as in any list; up from the first goes back to the search.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = e.target as HTMLElement
    if (row.tagName !== 'TR' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const next = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null
    if (next && next.tabIndex >= 0) {
      e.preventDefault()
      next.focus()
    } else if (!next && e.key === 'ArrowUp' && onLeaveTop) {
      e.preventDefault()
      onLeaveTop()
    }
  }

  return (
    <div ref={ref} onKeyDown={onKeyDown} data-jobs-table={show}>
      <Table
        label={`${show === 'active' ? 'Active' : show === 'future' ? 'Future' : 'Archived'} jobs`}
        columns={columns}
        rows={sites}
        rowKey={(site) => site.id}
        rowHref={(site) => paths.job(site.id)}
        rowLabel={(site) => {
          // What a screen reader hears on reaching a row: the facts, not just the title.
          const span = spanOf(site)
          return [jobTitle(site), builderOf(site), span ? spanText(span) : 'no dates', chipFor(site.id)?.chip, startPassed(site, today) ? 'start date passed' : '']
            .filter(Boolean)
            .join(', ')
        }}
        empty={empty}
      />
      {menu && (
        <RowMenu
          site={menu.site}
          trigger={menu.trigger}
          onClose={() => setMenu(null)}
          onPick={(to) => {
            const { site, trigger } = menu
            setMenu(null)
            // Focus goes back to the ⋯ first, so the confirm dialog hands it
            // back there when it closes rather than to a menu that is gone.
            trigger.focus()
            onStatus(site, to)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- cells

/**
 * The title, and under it what the row has no column for: the builder once
 * Builder has gone, the dates (first, ahead of the builder) once Dates has
 * gone, then the job's name when the title is its address, and the work.
 * `dates` is null while the Dates column is showing them.
 */
function JobCell({ site, withBuilder, dates }: { site: JobSiteRow; withBuilder: boolean; dates: { span: { s: number; e: number } | null } | null }) {
  const title = jobTitle(site)
  const builder = builderOf(site)
  const under: ReactNode[] = [
    dates ? <DatesText key="dates" site={site} span={dates.span} /> : null,
    withBuilder && builder ? builder : null,
    title !== site.name ? site.name : null,
    (site.job_type ?? '').trim() || null,
  ].filter((x) => x !== null)
  return (
    <span data-job-id={site.id} data-status={site.status} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span data-job-title="" style={{ ...text.base, fontWeight: 600, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      {under.length > 0 && (
        <span data-job-under="" style={{ ...text.xs, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {under.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              {part}
            </Fragment>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * A job's dates as text, with where they come from on hover. The same
 * element (and data-job-dates, data-span-start, data-span-end) whether it
 * stands in the Dates column or in the line under the title.
 */
function DatesText({ site, span, style }: { site: JobSiteRow; span: { s: number; e: number } | null; style?: CSSProperties }) {
  if (!span) {
    return (
      <span data-job-dates="" title="No dates on the job, and nothing booked, programmed or worked there yet" style={style}>
        No dates
      </span>
    )
  }
  const from = site.starts_on ? 'Set on the job.' : 'From the programme, bookings and time on site.'
  const said = isoDay(span.s) === isoDay(span.e) ? longDay(span.s) : `${longDay(span.s)} to ${longDay(span.e)}`
  return (
    <span data-job-dates={spanText(span)} data-span-start={isoDay(span.s)} data-span-end={isoDay(span.e)} title={`${said}. ${from}`} style={style}>
      {spanText(span)}
    </span>
  )
}

function DatesCell({ site, span }: { site: JobSiteRow; span: { s: number; e: number } | null }) {
  return (
    <DatesText
      site={site}
      span={span}
      style={{ display: 'block', ...text.sm, color: span ? color.body : color.ghost, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    />
  )
}

function CrewCell({ people }: { people: JobPerson[] }) {
  if (people.length === 0) {
    return (
      <span data-crew="0" title="Nobody on the clock there, and nobody booked in the next 14 days" style={{ ...text.xs, color: color.ghost }}>
        Nobody
      </span>
    )
  }
  // Each head's tooltip says why they are listed: "On site since 7:02 am", "Booked Tue 4 Nov".
  return (
    <span data-crew={people.length} style={{ display: 'inline-flex' }}>
      <AvatarStack people={people.map((p) => ({ id: p.id, name: `${p.name} (${p.where})`, initials: p.initials }))} max={3} size={22} />
    </span>
  )
}

const tabLabel = (tab: string) => JOB_TABS.find((t) => t.key === tab)?.label ?? 'Overview'

/**
 * The chip. A flood test's opens the job's Waterproofing tab, which deals
 * with it. Defects and variations have no page on the website, so theirs is
 * not a link of its own (a click on it opens the job, like the rest of the
 * row) and its tooltip says where the details are.
 */
function AttentionChipView({ site, chip }: { site: JobSiteRow; chip: AttentionChip }) {
  const elsewhere = ATTENTION_DETAILS[chip.kind]
  const face = (
    <Chip size="sm" bg={chip.bg} fg={chip.fg} dot>
      {chip.chip}
    </Chip>
  )
  if (elsewhere) {
    return (
      <span data-chip={chip.kind} title={`${chip.chip}. ${elsewhere}.`} style={{ display: 'inline-flex', maxWidth: '100%' }}>
        {face}
      </span>
    )
  }
  return (
    <a
      {...linkProps(paths.job(site.id, chip.tab))}
      className="wb-focus"
      data-chip={chip.kind}
      title={`${chip.chip}. Open ${tabLabel(chip.tab)}.`}
      style={{ display: 'inline-flex', maxWidth: '100%', borderRadius: 10, textDecoration: 'none' }}
    >
      {face}
    </a>
  )
}

/**
 * The phone's chip, and for a Future job whose start date has come, "Start
 * date passed" over "Mark active". "Start date passed · Mark active" is
 * about 180 px of text and the cell has 136, so the two always stack, under
 * the chip when there is one. That one case is three lines, and its row
 * grows to fit them (66 px) rather than cut the words short: it is
 * rare, and the warning is the point of it.
 */
function AttentionCell({ site, chip, passed, onMarkActive }: { site: JobSiteRow; chip: AttentionChip | null; passed: boolean; onMarkActive: () => void }) {
  const future = site.status === 'starting_soon'
  const both = Boolean(chip) && passed
  return (
    <span
      data-attention={chip?.chip ?? ''}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: both ? 4 : 3, minWidth: 0, padding: both ? '5px 0' : undefined }}
    >
      {chip && <AttentionChipView site={site} chip={chip} />}
      {passed ? (
        <span data-start-passed="" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: both ? 0 : 1, maxWidth: '100%', ...text.xs, fontWeight: 600, color: color.amber }}>
          <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Start date passed</span>
          <span className="wb-sr-only"> · </span>
          <button type="button" className="wb-link wb-link--button" onClick={onMarkActive} style={{ flex: 'none', fontSize: 12, lineHeight: '16px' }}>
            Mark active
          </button>
        </span>
      ) : (
        future &&
        !chip && (
          // The phone's Future-row chip: the note somebody wrote, else "Starting soon".
          <Chip size="sm" tone="amber" dot title={site.schedule_note || undefined}>
            {site.schedule_note || 'Starting soon'}
          </Chip>
        )
      )}
    </span>
  )
}

// ---------------------------------------------------------------- the ⋯ menu

/**
 * A row's actions, in a menu under its ⋯ button: Edit job, then what the
 * job's status allows. Drawn into the website's root, because the table
 * clips anything that leaves a cell.
 *
 * The ARIA menu pattern: focus starts on the first item, the arrow keys
 * (and Home, End) move, Enter or Space picks, Esc closes and returns focus
 * to the button, Tab closes and carries on from the button. A click
 * anywhere else, a scroll or a resize closes it.
 */
function RowMenu({ site, trigger, onClose, onPick }: { site: JobSiteRow; trigger: HTMLButtonElement; onClose: () => void; onPick: (to: JobStatus) => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  // Which item has focus, for its highlight: the pointer moves focus too, so
  // the highlight is always the item Enter would pick.
  const [active, setActive] = useState(0)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const moves = STATUS_MOVES[site.status] ?? []
  const width = 208

  useLayoutEffect(() => {
    const r = trigger.getBoundingClientRect()
    const h = panel.current?.offsetHeight ?? 0
    const below = r.bottom + 4
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below
    setAt({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) })
  }, [trigger])

  // Focus the first item once the menu is in place (a hidden element cannot
  // take focus), and only once: the board re-renders under an open menu (a
  // refresh, the meters arriving) and that must not pull focus back to it.
  const focused = useRef(false)
  useEffect(() => {
    // The row went (a refresh moved the job to another list): the menu goes with it.
    if (!trigger.isConnected) close.current()
  })
  useEffect(() => {
    if (!at || focused.current) return
    focused.current = true
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [at])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || trigger.contains(t)) return
      close.current()
    }
    const onMove = () => close.current()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    // Capture, so a scroll inside any container closes it too: the menu is fixed and would be left behind.
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [trigger])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const cur = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => items[(i + items.length) % items.length]?.focus()
    switch (e.key) {
      case 'ArrowDown':
        go(cur + 1)
        break
      case 'ArrowUp':
        go(cur - 1)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(items.length - 1)
        break
      case 'Escape':
        onClose()
        trigger.focus()
        break
      case 'Tab':
        // Close and let Tab carry on from the ⋯, where the menu came from.
        onClose()
        trigger.focus()
        return
      case ' ':
        // Space picks, as Enter does. A link never answers Space, and a
        // button only clicks on Space when its keydown goes through, which
        // the preventDefault below (there so the page does not scroll)
        // stops. So the item is clicked here, whichever it is.
        if (cur >= 0) items[cur]?.click()
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const item = (i: number) =>
    ({
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      height: 36,
      padding: `0 ${space.sm}px`,
      boxSizing: 'border-box',
      border: 0,
      borderRadius: radius.sm,
      outline: 'none',
      background: active === i ? color.hover : 'transparent',
      font: 'inherit',
      ...text.base,
      textAlign: 'left',
      textDecoration: 'none',
      cursor: 'pointer',
    }) as const
  const focusHere = (i: number) => ({
    onFocus: () => setActive(i),
    onMouseEnter: (e: { currentTarget: HTMLElement }) => e.currentTarget.focus(),
  })

  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={`Actions for ${jobTitle(site)}`}
      data-row-menu-for={site.id}
      onKeyDown={onKeyDown}
      className="wb-anim-fade"
      style={{
        position: 'fixed',
        top: at?.top ?? -9999,
        left: at?.left ?? -9999,
        zIndex: z.popover,
        width,
        padding: space.xxs,
        boxSizing: 'border-box',
        background: color.panel,
        border: `1px solid ${color.borderSoft}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        visibility: at ? 'visible' : 'hidden',
      }}
    >
      <a
        {...linkProps(paths.jobEdit(site.id))}
        role="menuitem"
        tabIndex={-1}
        {...focusHere(0)}
        onClick={(e) => {
          linkProps(paths.jobEdit(site.id)).onClick(e)
          onClose()
        }}
        style={{ ...item(0), color: color.ink }}
      >
        Edit job
      </a>
      {moves.length > 0 && <div role="separator" style={{ height: 1, margin: `${space.xxs}px 0`, background: color.borderSoft }} />}
      {moves.map((m, i) => (
        <button
          key={m.to}
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-move={m.to}
          {...focusHere(i + 1)}
          onClick={() => onPick(m.to)}
          style={{ ...item(i + 1), color: m.danger ? color.red : color.ink, fontWeight: 500 }}
        >
          {m.label}
        </button>
      ))}
    </div>,
    webRoot(),
  )
}
