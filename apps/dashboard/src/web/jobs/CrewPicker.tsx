/**
 * Picking who to book onto a job, and for which days. Shared by the New job
 * form (an optional first booking) and the job's Crew tab (Book crew).
 *
 * It is the phone's Assign personnel sheet (Projects.tsx AssignSheet) at a
 * desk: the same people (crew_v, active, not office), the same run of days
 * (Mon-Fri, 07:00-15:00 local, at most 84 working days) and the same rule
 * that a day somebody already has on any job is left alone. What a desk
 * adds is seeing it before pressing anything:
 *  - the sum, worded as the run will be: "2 people × 5 working days = 10
 *    bookings, 07:00-15:00, weekends left out"
 *  - each person's days across the range, already-booked days in the
 *    colour of the job they are on (BookingGrid), so a clash is visible
 *    rather than reported afterwards
 *  - which days will be skipped, and why, before booking
 *
 * Controlled: the form or the drawer holds the pick ({ workerIds, from, to },
 * the shape createJob's crew and bookCrew take) and does the writing. The
 * picker only reads. bookCrew reads the clashes again at the moment it
 * writes, so a booking made elsewhere in between is still skipped; the
 * preview here is what was true a moment ago.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { bookingSummary, planBookings, workingDays, type SkippedDay } from '../data/bookings'
import { ASSIGN_MAX_DAYS, clashKey, clashWindow, localISO } from '../data/contract'
import { railOf, supabase } from '../phone'
import { linkProps, paths } from '../router'
import { color, radius, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { BookingGrid, BookingLegend, dayLabel, indexBookings, loadBookings, loadSites, PersonAvatar, siteTitle, type DayBooking, type SiteLite } from './BookingGrid'

/** What gets booked: the shape createJob's `crew` and bookCrew take. Dates are local YYYY-MM-DD, inclusive. */
export interface CrewPick {
  workerIds: string[]
  from: string
  to: string
}

/** Someone who can be booked: on the books, active, and not office. */
export interface Bookable {
  id: string
  name: string
  initials: string
  trade: string | null
  role: 'owner' | 'captain' | 'employee'
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The time zone bookings are meant in. bookingTimes uses the computer's own clock. */
export const BOOKING_TIME_ZONE = 'Australia/Adelaide'

/** The computer's time zone, or '' when the browser will not say. */
export function computerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localISO(d)
}

/**
 * Where a new pick starts, as the phone's sheet starts it: the job's own
 * dates lead, because somebody typed those for this job, but never before
 * today (a day that has gone cannot be rostered); with no end date, two
 * weeks.
 */
export function defaultPick(site?: { starts_on: string | null; ends_on: string | null } | null, now = new Date()): CrewPick {
  const today = localISO(now)
  const from = site?.starts_on && site.starts_on > today ? site.starts_on : today
  const to = site?.ends_on && site.ends_on >= from ? site.ends_on : addDays(from, 13)
  return { workerIds: [], from, to }
}

/** What is wrong with the days, if anything, in words for the field. */
export function datesProblem(p: Pick<CrewPick, 'from' | 'to'>, now = new Date()): { field: 'from' | 'to'; message: string } | null {
  if (!ISO_DAY.test(p.from)) return { field: 'from', message: 'Pick the first day.' }
  if (!ISO_DAY.test(p.to)) return { field: 'to', message: 'Pick the last day.' }
  // The phone never offers a past day either; a booking is a plan, and the
  // record of who was there is their shifts.
  if (p.from < localISO(now)) return { field: 'from', message: 'Bookings start today at the earliest.' }
  if (p.to < p.from) return { field: 'to', message: 'The last day is before the first.' }
  if (workingDays(p.from, p.to).days.length === 0) return { field: 'to', message: 'That range has no working days in it.' }
  return null
}

/** Why this pick cannot be booked yet, or null when it can. */
export function pickProblem(p: CrewPick, now = new Date()): string | null {
  return datesProblem(p, now)?.message ?? (p.workerIds.length === 0 ? 'Nobody is picked yet.' : null)
}

/**
 * Skipped days in words, by person: "Dean Papadopoulos on Tue 20 Oct",
 * "Dean Papadopoulos on Tue 20 Oct and Wed 21 Oct; Maria Voulgaris on Mon
 * 19 Oct". At most four days a person are named.
 */
export function skippedWords(skipped: SkippedDay[], nameOf: (workerId: string) => string): string {
  const by = new Map<string, string[]>()
  for (const s of skipped) by.set(s.workerId, [...(by.get(s.workerId) ?? []), s.day])
  return [...by.entries()]
    .map(([id, days]) => {
      const named = days.slice(0, 4).map((d) => dayLabel(d))
      const more = days.length - named.length
      const list = more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', ').replace(/, ([^,]*)$/, ' and $1')
      return `${nameOf(id)} on ${list}`
    })
    .join('; ')
}

/**
 * The people who can be booked, as the phone's sheet lists them: crew_v,
 * active, not office, by name. Office staff are left out because nothing
 * they do is rostered; a captain is crew.
 */
export function useBookableCrew(): { crew: Bookable[]; loading: boolean; error: string | null; retry: () => void } {
  const [crew, setCrew] = useState<Bookable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('crew_v')
      .select('id, name, initials, trade, role, active, is_office')
      .eq('active', true)
      .order('name')
      .order('id')
      .then(({ data, error: err }) => {
        if (cancelled) return
        setLoading(false)
        if (err) {
          setError(err.message)
          return
        }
        setError(null)
        setCrew(
          ((data ?? []) as Array<Bookable & { is_office: boolean }>)
            .filter((w) => !w.is_office)
            .map(({ id, name, initials, trade, role }) => ({ id, name, initials, trade, role })),
        )
      })
    return () => {
      cancelled = true
    }
  }, [nonce])
  const retry = useCallback(() => {
    setLoading(true)
    setNonce((n) => n + 1)
  }, [])
  return { crew, loading, error, retry }
}

export interface CrewPickerProps {
  value: CrewPick
  onChange: (next: CrewPick) => void
  /** The job being booked. Null on the New job form, before the job exists. */
  site: { id: string; name: string; address: string | null; colour?: string | null } | null
  /** The colour "this job" is drawn in. Default the job's rail; on a new job, pass the colour picked on the form. */
  colour?: string
  disabled?: boolean
}

interface Taken {
  key: string
  rows: DayBooking[]
  sites: Map<string, SiteLite>
}

export function CrewPicker({ value, onChange, site, colour, disabled = false }: CrewPickerProps) {
  const { crew, loading, error: crewError, retry: retryCrew } = useBookableCrew()
  const here = useMemo(
    () => ({ id: site?.id ?? null, colour: colour ?? (site ? railOf(site) : color.ink), title: site ? siteTitle(site) : 'this job' }),
    [site, colour],
  )
  const problem = datesProblem(value)
  // The grid shows the range even while it cannot be booked (a first day
  // already gone): it is what the field's error is about.
  const { days, capped } = useMemo(() => workingDays(value.from, value.to), [value.from, value.to])
  const picked = useMemo(() => new Set(value.workerIds), [value.workerIds])

  // What everyone already has on in the range, on any job. Read a beat
  // after the dates settle, so typing a date is not a query a keystroke.
  const crewIds = useMemo(() => crew.map((c) => c.id), [crew])
  const key = `${days.length ? `${localISO(days[0]!)}|${localISO(days[days.length - 1]!)}` : 'none'}|${crewIds.join(',')}`
  const [taken, setTaken] = useState<Taken | null>(null)
  const [takenError, setTakenError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let cancelled = false
    const span = clashWindow(days)
    if (!span || crewIds.length === 0) {
      setTaken({ key, rows: [], sites: new Map() })
      return
    }
    const t = setTimeout(() => {
      void (async () => {
        try {
          const rows = await loadBookings(crewIds, span)
          const sites = await loadSites(rows.map((r) => r.siteId))
          if (cancelled) return
          setTaken({ key, rows, sites })
          setTakenError(null)
        } catch (e) {
          if (!cancelled) setTakenError(e instanceof Error ? e.message : String(e))
        }
      })()
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // days and crewIds are memoised, so this runs when the range or the crew
    // changes; nonce is Try again.
  }, [days, crewIds, key, nonce])

  const fresh = taken !== null && taken.key === key
  const index = useMemo(() => indexBookings(fresh ? taken.rows : []), [fresh, taken])
  const sites = useMemo(() => (fresh ? taken.sites : new Map<string, SiteLite>()), [fresh, taken])

  // The run as bookCrew would make it from what was just read: which days it skips.
  const plan = useMemo(() => {
    if (!fresh || days.length === 0) return null
    return planBookings({
      companyId: '',
      siteId: here.id ?? '',
      workerIds: value.workerIds,
      from: value.from,
      to: value.to,
      taken: taken.rows.map((r) => ({ worker_id: r.workerId, starts_at: r.startsAt })),
    })
  }, [fresh, taken, days.length, here.id, value.workerIds, value.from, value.to])

  const nameOf = useCallback((id: string) => crew.find((c) => c.id === id)?.name ?? 'Someone', [crew])
  const busyDays = useCallback((id: string) => days.filter((d) => index.has(clashKey(id, d))).length, [days, index])

  const set = (patch: Partial<CrewPick>) => onChange({ ...value, ...patch })
  const toggle = (id: string) => set({ workerIds: picked.has(id) ? value.workerIds.filter((w) => w !== id) : [...value.workerIds, id] })
  const allPicked = crew.length > 0 && crew.every((c) => picked.has(c.id))

  const tz = computerTimeZone()
  const summary =
    days.length === 0
      ? null
      : value.workerIds.length === 0
        ? `${days.length} working day${days.length === 1 ? '' : 's'}, 07:00-15:00, weekends left out. Pick who to book.`
        : bookingSummary(value.workerIds.length, days.length)

  return (
    <div data-crew-picker="" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.sm }}>
        <Field
          label="From"
          type="date"
          value={value.from}
          min={localISO(new Date())}
          disabled={disabled}
          error={problem?.field === 'from' ? problem.message : undefined}
          onChange={(e) => set({ from: e.target.value })}
        />
        <Field
          label="To"
          type="date"
          value={value.to}
          min={value.from || undefined}
          disabled={disabled}
          error={problem?.field === 'to' ? problem.message : undefined}
          onChange={(e) => set({ to: e.target.value })}
        />
      </div>

      <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {summary && (
          <div data-crew-summary="" style={{ ...text.base, fontWeight: 600, color: color.ink }}>
            {summary}
          </div>
        )}
        {capped && days.length > 0 && (
          <div style={{ ...text.sm, color: color.amber }}>
            One run books at most {ASSIGN_MAX_DAYS} working days, so this stops on {dayLabel(days[days.length - 1]!)}. Book the rest in a second run.
          </div>
        )}
        {!fresh && days.length > 0 && crew.length > 0 && !takenError && (
          <div style={{ ...text.sm, color: color.muted }}>Checking who is already booked…</div>
        )}
        {plan && plan.skipped.length > 0 && (
          <div data-crew-skips="" style={{ ...text.sm, color: color.body }}>
            {plan.skipped.length === 1 ? '1 day is' : `${plan.skipped.length} days are`} already booked and will be left as they are, not double-booked:{' '}
            {skippedWords(plan.skipped, nameOf)}.
          </div>
        )}
      </div>

      {value.workerIds.length > 0 && tz && tz !== BOOKING_TIME_ZONE && (
        <Banner tone="warn" title="This computer is not on Adelaide time">
          It is set to {tz}. Bookings are written as 07:00-15:00 on this computer's clock, so they would land at the wrong hours on the crew's phones. Set the
          computer to Adelaide time before booking, or book from the app.
        </Banner>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.xs }}>
          <span style={{ ...text.label, color: color.muted }}>Who</span>
          <span style={{ ...text.sm, color: color.muted }}>{value.workerIds.length > 0 ? `${value.workerIds.length} picked` : ''}</span>
          <span style={{ flex: 1 }} />
          {crew.length > 1 && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => set({ workerIds: allPicked ? [] : crew.map((c) => c.id) })}>
              {allPicked ? 'Clear' : 'Pick everyone'}
            </Button>
          )}
        </div>

        {crewError && (
          <Banner tone="error" title="Could not load the crew" action={<Button size="sm" onClick={retryCrew}>Try again</Button>}>
            {crewError}
          </Banner>
        )}
        {takenError && (
          <Banner tone="warn" title="Could not check who is already booked" action={<Button size="sm" onClick={() => setNonce((n) => n + 1)}>Try again</Button>}>
            Booking still skips anyone already booked; it checks again when it writes. {takenError}
          </Banner>
        )}

        <div style={{ background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, padding: `${space.xs}px ${space.sm}px` }}>
          {loading ? (
            <div style={{ padding: `${space.sm}px 0`, ...text.base, color: color.muted }}>Loading the crew…</div>
          ) : crew.length === 0 && !crewError ? (
            <div style={{ padding: `${space.sm}px 0`, ...text.base, color: color.muted }}>
              Nobody on the books yet.{' '}
              <a {...linkProps(paths.team)} className="wb-link">
                Add people on the Team page
              </a>
              , then book them here.
            </div>
          ) : (
            <BookingGrid
              label={days.length ? `Who to book, ${dayLabel(days[0]!)} to ${dayLabel(days[days.length - 1]!)}` : 'Who to book'}
              days={days}
              people={crew}
              index={index}
              sites={sites}
              here={here}
              proposing={picked}
              // Laid out to the drawer or the form it is in. At its longest
              // (84 working days in the Crew tab's 640 px drawer) a day is a
              // 3.5 px sliver headed by month and week, which is enough to
              // see a clash; the names are narrowed only when that buys a
              // day its letter or date.
              leadWidth={224}
              minLeadWidth={184}
              minCell={3}
              rowHeight={48}
              cellHeight={20}
              lead={(p, i) => {
                const busy = busyDays(p.id)
                const sub = [p.trade, busy ? `${busy} day${busy === 1 ? '' : 's'} taken` : null].filter(Boolean).join(' · ')
                return (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: disabled ? 'default' : 'pointer' }}>
                    <input
                      type="checkbox"
                      className="wb-focus"
                      data-worker={p.id}
                      checked={picked.has(p.id)}
                      disabled={disabled}
                      onChange={() => toggle(p.id)}
                      style={{ flex: 'none', width: 16, height: 16, margin: 0, accentColor: color.ink, cursor: 'inherit' }}
                    />
                    <PersonAvatar name={p.name} initials={p.initials} index={i} />
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ ...text.base, fontWeight: 600, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {sub && <span style={{ ...text.xs, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
                    </span>
                  </label>
                )
              }}
            />
          )}
        </div>
        {days.length > 0 && crew.length > 0 && <BookingLegend colour={here.colour} proposing hereLabel={site ? 'This job' : null} />}
      </div>

      <div style={{ ...text.sm, color: color.muted }}>
        These are real bookings: they show on the crew's phones and the schedule straight away, and anyone booked can clock on inside the job's fence. A
        day somebody is already booked on is left alone rather than double-booked.
      </div>
    </div>
  )
}
