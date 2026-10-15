/**
 * The job's Crew tab: who is on this job, day by day, for six weeks; who is
 * on site right now; booking more people; and taking someone off.
 *
 * Every write is the phone's own (data/bookings.ts, copied from Projects.tsx
 * and checked against it by contract.test.ts):
 *  - Book crew is the Assign personnel sheet: one published row per person
 *    per working day, 07:00-15:00 local, no crew_id, and any day a person
 *    already has on any job left alone and reported. bookCrew reads its
 *    rows back.
 *  - Remove is the phone's Remove: this person's bookings on this job from
 *    local midnight today, so today is still theirs to unassign until the
 *    day is over and the days before stay as the record. removeFromJob reads
 *    back that none are left. As on the phone, someone on the clock here
 *    cannot be removed until they clock off.
 * So a booking made here is on the crew's phones (Home, Projects, the
 * schedule) the next time they open the app, and clock-on works with it at
 * once.
 *
 * Who is "on site now" is the phone's rule (useSimpleData's crewOnSite, the
 * Crew tab on the phone): a shift at this job started since local midnight
 * and not yet ended.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { allRows, bookCrew, removeFromJob, startOfToday, type BookResult } from '../../data/bookings'
import { ASSIGN_MAX_DAYS, clashWindow, localISO } from '../../data/contract'
import { useFresh } from '../../data/useFresh'
import {
  BOOKING_COLS,
  BookingGrid,
  BookingLegend,
  dayLabel,
  fitWeeks,
  indexBookings,
  loadBookings,
  loadSites,
  mondayOf,
  PersonAvatar,
  rangeLabel,
  siteTitle,
  toDayBooking,
  useMeasuredWidth,
  weekdaysFrom,
  type BookingIndex,
  type BookingRow,
  type GridSizes,
  type SiteLite,
} from '../../jobs/BookingGrid'
import { CrewPicker, defaultPick, pickProblem, skippedWords, type CrewPick } from '../../jobs/CrewPicker'
import { railOf, supabase } from '../../phone'
import { useToast } from '../../shell/Toast'
import { color, radius, shadow, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button, IconButton, PlusIcon } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Dialog } from '../../ui/Dialog'
import { Drawer } from '../../ui/Drawer'
import { Empty } from '../../ui/Empty'
import type { JobTabProps } from '../types'

/**
 * How far the strip looks: six weeks from this Monday, the span a roster is
 * planned over. A screen too narrow for six weeks of readable days (a 1024
 * laptop still gets six; an iPad held upright gets two) shows fewer weeks,
 * each day still a cell you can read and point at, and pages by that many.
 */
const MAX_WEEKS = 6

/**
 * The strip's columns. The person and the Remove columns narrow before the
 * days do; at their narrowest "N days ahead" stacks over Remove.
 */
const STRIP: GridSizes = { leadWidth: 264, minLeadWidth: 168, trailWidth: 196, compactTrailWidth: 100, minCell: 12 }

const WEEK_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six']
const weeksWords = (n: number) => (n === 1 ? 'week' : `${WEEK_WORDS[n] ?? n} weeks`)

interface CrewPerson {
  id: string
  name: string
  initials: string
  trade: string | null
  /** False when they have since been taken off the team; their bookings still show. */
  active: boolean
  /** When they clocked on here, if they are on the clock here now. */
  onSince: string | null
  /** Bookings on this job from local start of today on: what Remove deletes. */
  ahead: number
  /** When the first of those starts. */
  next: string | null
}

interface CrewData {
  /** Which strip this was read for, so a strip still loading is not drawn with another's days. */
  forKey: string
  people: CrewPerson[]
  index: BookingIndex
  sites: Map<string, SiteLite>
  /** Everyone in the company by id, for naming a skipped day's person. */
  names: Map<string, string>
}

const stripKey = (days: Date[]) => (days.length ? `${localISO(days[0]!)}|${localISO(days[days.length - 1]!)}` : 'none')

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

/**
 * Everything the tab shows for one strip of days:
 *  - this job's bookings from the earlier of the strip's start and today,
 *    to whenever they end (the strip's cells, and the "ahead" count Remove
 *    acts on, which is not limited to six weeks)
 *  - who is on the clock here now
 *  - those people's bookings on other jobs inside the strip, and those
 *    jobs' names and colours
 */
async function loadJobCrew(siteId: string, days: Date[]): Promise<CrewData> {
  const c = supabase()
  const t0 = startOfToday()
  const span = clashWindow(days)!
  const from = new Date(Math.min(new Date(span.from).getTime(), t0.getTime())).toISOString()
  const [mine, cv, sh] = await Promise.all([
    allRows<BookingRow>((a, b) => c.from('assignments').select(BOOKING_COLS).eq('site_id', siteId).gte('starts_at', from).order('starts_at').order('id').range(a, b)),
    c.from('crew_v').select('id, name, initials, trade, active'),
    c.from('shifts').select('worker_id, started_at, ended_at').eq('site_id', siteId).gte('started_at', t0.toISOString()).is('ended_at', null),
  ])
  if (cv.error) throw new Error(cv.error.message)
  if (sh.error) throw new Error(sh.error.message)
  const roster = new Map(((cv.data ?? []) as Array<{ id: string; name: string; initials: string; trade: string | null; active: boolean }>).map((w) => [w.id, w]))

  const onSince = new Map<string, string>()
  for (const s of (sh.data ?? []) as Array<{ worker_id: string; started_at: string }>) {
    const was = onSince.get(s.worker_id)
    if (!was || s.started_at < was) onSince.set(s.worker_id, s.started_at)
  }
  const t0iso = t0.toISOString()
  const inStrip = (iso: string) => iso >= span.from && iso <= span.to
  const ahead = new Map<string, { n: number; next: string }>()
  const shown = new Set<string>(onSince.keys())
  for (const r of mine) {
    if (new Date(r.starts_at).toISOString() >= t0iso) {
      const a = ahead.get(r.worker_id)
      if (a) a.n += 1
      else ahead.set(r.worker_id, { n: 1, next: r.starts_at })
      shown.add(r.worker_id)
    }
    if (inStrip(new Date(r.starts_at).toISOString())) shown.add(r.worker_id)
  }

  const ids = [...shown]
  const others = ids.length ? await loadBookings(ids, span, { exceptSite: siteId }) : []
  const sites = await loadSites(others.map((b) => b.siteId))

  const people: CrewPerson[] = ids.map((id) => {
    const w = roster.get(id)
    return {
      id,
      name: w?.name ?? 'Someone no longer on the books',
      initials: w?.initials ?? '?',
      trade: w?.trade ?? null,
      active: w?.active ?? false,
      onSince: onSince.get(id) ?? null,
      ahead: ahead.get(id)?.n ?? 0,
      next: ahead.get(id)?.next ?? null,
    }
  })
  // On the clock first, as the phone's crew list reads a day as it arrived; then by name.
  people.sort((a, b) => (a.onSince ? 0 : 1) - (b.onSince ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return {
    forKey: stripKey(days),
    people,
    index: indexBookings([...mine.map(toDayBooking), ...others]),
    sites,
    names: new Map([...roster.values()].map((w) => [w.id, w.name])),
  }
}

/**
 * The tab's data, kept on screen while a refresh or the next strip loads.
 * Only the latest load lands. Nothing is read until the strip has been
 * measured (days null), so the first read is for the weeks that will show.
 */
function useJobCrew(siteId: string, days: Date[] | null) {
  const [data, setData] = useState<CrewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const reload = useCallback(async () => {
    if (!days || days.length === 0) return
    const mine = ++latest.current
    try {
      const out = await loadJobCrew(siteId, days)
      if (mine !== latest.current) return
      setData(out)
      setError(null)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [siteId, days])
  useEffect(() => {
    void reload()
  }, [reload])
  useFresh(() => void reload())
  return { data, error, reload }
}

/** What the toast says after a booking run. */
function bookedWords(res: BookResult, nameOf: (id: string) => string): string {
  const n = res.inserted.length
  const parts = [`Booked ${n} day${n === 1 ? '' : 's'}`]
  if (res.skipped.length > 0) {
    const k = res.skipped.length
    parts.push(`${k} day${k === 1 ? '' : 's'} skipped, already booked: ${skippedWords(res.skipped, nameOf)}`)
  }
  if (res.capped) parts.push(`Stopped at ${ASSIGN_MAX_DAYS} working days; book the rest in a second run`)
  return `${parts.join('. ')}.`
}

export default function CrewTab({ site, reloadJob }: JobTabProps) {
  const toast = useToast()
  const archived = site.status === 'archived'
  const colour = railOf(site)
  const title = siteTitle(site)

  // The strip: as many weeks as the card has room for (six on a laptop),
  // from this Monday, moved that many weeks at a time. `offset` counts
  // weeks, so a strip that narrows or widens keeps its first week.
  const [stripBox, stripWidth] = useMeasuredWidth<HTMLDivElement>()
  const weeks = stripWidth ? fitWeeks(stripWidth, MAX_WEEKS, STRIP) : null
  const [offset, setOffset] = useState(0)
  const days = useMemo(() => {
    if (!weeks) return null
    const start = mondayOf(new Date())
    start.setDate(start.getDate() + offset * 7)
    return weekdaysFrom(start, weeks)
  }, [offset, weeks])
  const { data, error, reload } = useJobCrew(site.id, days)
  const current = data !== null && days !== null && data.forKey === stripKey(days)
  const span = weeksWords(weeks ?? MAX_WEEKS)
  const nameOf = useCallback((id: string) => data?.names.get(id) ?? 'Someone', [data])

  // Book crew.
  const [booking, setBooking] = useState(false)
  const [pick, setPick] = useState<CrewPick>(() => defaultPick(site))
  const [bookBusy, setBookBusy] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const openBooking = () => {
    setPick(defaultPick(site))
    setBookError(null)
    setBooking(true)
  }
  const closeBooking = () => {
    if (!bookBusy) setBooking(false)
  }
  const problem = pickProblem(pick)

  async function book() {
    if (problem) {
      setBookError(problem)
      return
    }
    setBookBusy(true)
    setBookError(null)
    try {
      const res = await bookCrew({ companyId: site.company_id, siteId: site.id, ...pick })
      if (res.inserted.length === 0) {
        // Not an error, but nothing happened: say why and leave the drawer open to change the pick.
        setBookError(`Nothing was booked. Everyone picked is already booked on every working day in that range: ${skippedWords(res.skipped, nameOf)}.`)
        return
      }
      setBooking(false)
      toast(bookedWords(res, nameOf), { tone: res.skipped.length || res.capped ? 'neutral' : 'success', duration: res.skipped.length ? 12_000 : undefined })
      void reload()
      reloadJob()
    } catch (e) {
      const made = (e as { inserted?: string[] }).inserted?.length ?? 0
      const why = e instanceof Error ? e.message : String(e)
      setBookError(made ? `${why} ${made} day${made === 1 ? ' was' : 's were'} booked before it stopped; they are on the strip.` : why)
      if (made) void reload()
    } finally {
      setBookBusy(false)
    }
  }

  // Remove from job.
  const [removing, setRemoving] = useState<CrewPerson | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  async function remove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      const { removed } = await removeFromJob({ siteId: site.id, workerId: removing.id })
      toast(
        removed > 0
          ? `${removing.name} is off this job: ${removed} booking${removed === 1 ? '' : 's'} from today on removed.`
          : `${removing.name} had no bookings ahead on this job.`,
        { tone: 'success' },
      )
      setRemoving(null)
      void reload()
      reloadJob()
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e))
    } finally {
      setRemoveBusy(false)
    }
  }

  const people = data?.people ?? []
  const onSite = people.filter((p) => p.onSince)
  const booked = people.filter((p) => p.ahead > 0).length
  const summary = data
    ? [booked === 0 ? 'Nobody booked from today on' : `${booked} ${booked === 1 ? 'person' : 'people'} booked from today on`, `${onSite.length} on site now`].join(' · ')
    : 'Loading…'

  return (
    <div data-crew-tab="" style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink }}>Crew</h2>
          <div data-crew-count="" style={{ ...text.sm, color: color.muted }}>
            {summary}
          </div>
        </div>
        <Button variant="primary" icon={<PlusIcon />} data-book-crew="" disabled={archived} onClick={openBooking}>
          Book crew
        </Button>
      </div>

      {archived && (
        <Banner title="This job is archived">Restore it from the top of the page to book crew onto it again. What is below is the record.</Banner>
      )}
      {error && (
        <Banner tone={data ? 'warn' : 'error'} title={data ? 'Showing the crew as last loaded' : 'Could not load the crew'} action={<Button size="sm" onClick={() => void reload()}>Try again</Button>}>
          {error}
        </Banner>
      )}

      <section aria-labelledby="wb-crew-onsite" style={card}>
        <h3 id="wb-crew-onsite" style={{ margin: 0, ...text.label, color: color.muted }}>
          On site now
        </h3>
        {onSite.length === 0 ? (
          <div data-crew-onsite="" style={{ ...text.base, color: color.muted }}>
            {data ? 'Nobody is clocked on here right now.' : 'Loading…'}
          </div>
        ) : (
          <ul data-crew-onsite="" style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' }}>
            {onSite.map((p, i) => (
              <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: '6px 12px 6px 6px', background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.pill }}>
                <PersonAvatar name={p.name} initials={p.initials} index={i} live />
                <span style={{ ...text.base, fontWeight: 600, color: color.ink }}>{p.name}</span>
                <span style={{ ...text.sm, color: color.muted }}>since {clockTime(p.onSince!)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wb-crew-strip" style={card}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
          <h3 id="wb-crew-strip" style={{ margin: 0, ...text.label, color: color.muted }}>
            Bookings
          </h3>
          <span data-crew-range="" style={{ ...text.sm, fontWeight: 600, color: color.ink }}>
            {days ? rangeLabel(days) : ''}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <IconButton label={weeks === 1 ? 'Previous week' : `Earlier ${span}`} disabled={!weeks} onClick={() => weeks && setOffset((o) => o - weeks)}>
              <Chevron dir="left" />
            </IconButton>
            {offset !== 0 && (
              <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
                This week
              </Button>
            )}
            <IconButton label={weeks === 1 ? 'Next week' : `Later ${span}`} disabled={!weeks} onClick={() => weeks && setOffset((o) => o + weeks)}>
              <Chevron dir="right" />
            </IconButton>
          </span>
          <span style={{ flex: 1 }} />
          <BookingLegend colour={colour} />
        </div>

        {/* Measured, so the strip is laid out to the card it is in. */}
        <div ref={stripBox} data-crew-strip="" style={{ minWidth: 0 }}>
          {!data || !days ? (
            <div style={{ ...text.base, color: color.muted, padding: `${space.md}px 0` }}>{error ? 'The crew could not be loaded.' : 'Loading…'}</div>
          ) : people.length === 0 ? (
            <Empty
              compact
              data-crew-empty=""
              title="Nobody is booked on this job"
              action={!archived && <Button onClick={openBooking}>Book crew</Button>}
              style={{ border: 0, padding: `${space.lg}px ${space.md}px` }}
            >
              {offset === 0
                ? 'Book people for the days they will be here. They see it on their phones, and can clock on inside the fence.'
                : `Nobody is booked here in ${weeks === 1 ? 'that week' : `these ${span}`}, or from today on.`}
            </Empty>
          ) : (
            <div style={{ opacity: current ? 1 : 0.5, transition: 'opacity .12s' }} aria-busy={!current || undefined}>
              <BookingGrid
                label={`Bookings on this job, ${rangeLabel(days)}`}
                days={days}
                people={people}
                index={data.index}
                sites={data.sites}
                here={{ id: site.id, colour, title }}
                width={stripWidth}
                {...STRIP}
                rowHeight={52}
                lead={(p, i) => <PersonCell person={p} index={i} captain={site.captain_id === p.id} />}
                trail={(p, _i, { compact }) => (
                  <span
                    style={
                      compact
                        ? { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }
                        : { display: 'inline-flex', alignItems: 'center', gap: space.sm }
                    }
                  >
                    <span style={{ ...text.xs, color: color.muted, whiteSpace: 'nowrap' }}>{p.ahead ? `${p.ahead} day${p.ahead === 1 ? '' : 's'} ahead` : 'None ahead'}</span>
                    <Button
                      size="sm"
                      data-remove={p.id}
                      aria-label={`Remove ${p.name} from this job`}
                      title={p.onSince ? 'On the clock here now. Remove them once they have clocked off.' : p.ahead ? undefined : 'No bookings ahead on this job'}
                      disabled={!p.ahead || !!p.onSince || archived}
                      onClick={() => {
                        setRemoveError(null)
                        setRemoving(p)
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              />
            </div>
          )}
        </div>
      </section>

      <Drawer
        open={booking}
        title="Book crew"
        subtitle={title}
        // Wider than a form drawer: the picker's grid is the point of it, and
        // at 640 a long run of days still leaves every name whole.
        width={640}
        onClose={closeBooking}
        footer={
          <>
            <Button onClick={closeBooking} disabled={bookBusy}>
              Cancel
            </Button>
            <Button variant="primary" data-book-confirm="" loading={bookBusy} disabled={!!problem} onClick={() => void book()}>
              {pick.workerIds.length ? `Book ${pick.workerIds.length} ${pick.workerIds.length === 1 ? 'person' : 'people'}` : 'Book'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          {bookError && (
            <Banner tone="error" title="Not booked">
              {bookError}
            </Banner>
          )}
          <CrewPicker value={pick} onChange={setPick} site={site} disabled={bookBusy} />
        </div>
      </Drawer>

      <Dialog
        open={removing !== null}
        title={removing ? `Take ${removing.name} off this job?` : ''}
        confirmLabel="Remove"
        tone="danger"
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        {removing && (
          <>
            {removing.ahead === 1
              ? 'Their 1 booking on this job from today on is deleted, and comes off'
              : `Their ${removing.ahead} bookings on this job from today on are deleted, and come off`}{' '}
            their phone's schedule the next time they open the app. Days already worked stay on the record.
          </>
        )}
      </Dialog>
    </div>
  )
}

const card = {
  display: 'flex',
  flexDirection: 'column',
  gap: space.sm,
  padding: space.md,
  background: color.panel,
  border: `1px solid ${color.borderSoft}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
} as const

function PersonCell({ person: p, index, captain }: { person: CrewPerson; index: number; captain: boolean }) {
  const today = localISO(new Date())
  const when = p.onSince
    ? `On site since ${clockTime(p.onSince)}`
    : p.next
      ? localISO(new Date(p.next)) === today
        ? 'Booked today'
        : `Next on ${dayLabel(new Date(p.next))}`
      : 'No bookings ahead'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <PersonAvatar name={p.name} initials={p.initials} index={index} live={!!p.onSince} />
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ ...text.base, fontWeight: 600, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          {captain && <Chip size="sm" tone="dark">Captain</Chip>}
          {!p.active && <Chip size="sm" tone="outline">Off the team</Chip>}
        </span>
        <span style={{ ...text.xs, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[p.trade, when].filter(Boolean).join(' · ')}</span>
      </span>
    </span>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d={dir === 'left' ? 'M8.5 3L4.5 7l4 4' : 'M5.5 3l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
