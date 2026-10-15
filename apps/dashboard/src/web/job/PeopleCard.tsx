/**
 * Who is on this job: on the clock there now, then booked in the next 14
 * days. The phone's Projects rule for "who is on this job" (useJobs.ts
 * peopleOn): the on-site list is the phone's own (useSimpleData's
 * crewOnSite, a shift here since local midnight with no end), matched to the
 * crew list by name as the phone matches it; the bookings are published
 * rows from local start of today, the window the phone's Projects list uses.
 *
 * The board shows these as avatars; here each person also says when: since
 * what time they are on site, or which days they are booked. Booking and
 * removing people is the Crew tab's job, linked from the card.
 *
 * The bookings are read on mount, with the page (focus, visibility, every
 * 60 s), and when `refresh` moves: the job page's Retry can book the crew a
 * job was made without, and the toast saying so should not sit beside
 * "Nobody is booked".
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { allRows, startOfToday } from '../data/bookings'
import { useFresh } from '../data/useFresh'
import { peopleOn, type CrewLite } from '../data/useJobs'
import { avatarGrey, supabase, useSimpleData, type AssignmentRow, type JobSiteRow, type WorkerRow } from '../phone'
import { linkProps, paths } from '../router'
import { color, space, text } from '../tokens'
import { initialsOf } from '../ui/AvatarStack'
import { Card } from './ProjectCard'

const WINDOW_DAYS = 14

const dayWords = (ms: number) => new Date(ms).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')

/** "Booked Mon 20 Oct", or "Booked Mon 20 Oct – Fri 24 Oct · 5 days". */
function bookedWords(starts: string[]): string {
  const days = [...new Set(starts.map((s) => new Date(new Date(s).setHours(0, 0, 0, 0)).getTime()))].sort((a, b) => a - b)
  if (days.length === 0) return ''
  if (days.length === 1) return `Booked ${dayWords(days[0])}`
  return `Booked ${dayWords(days[0])} – ${dayWords(days[days.length - 1])} · ${days.length} days`
}

export function PeopleCard({ me, site, roster, refresh = 0 }: { me: WorkerRow; site: JobSiteRow; roster: Map<string, CrewLite> | null; refresh?: number }) {
  const simple = useSimpleData(me)
  const [bookings, setBookings] = useState<AssignmentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const t0 = startOfToday()
    const end = new Date(t0)
    end.setDate(end.getDate() + WINDOW_DAYS)
    try {
      const rows = await allRows<AssignmentRow>((a, b) =>
        supabase()
          .from('assignments')
          .select('*')
          .eq('site_id', site.id)
          .eq('published', true)
          .gte('starts_at', t0.toISOString())
          .lt('starts_at', end.toISOString())
          .order('starts_at')
          .order('id')
          .range(a, b),
      )
      setBookings(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [site.id])

  // `refresh` is not read inside: it is here so a move of it reads the bookings again.
  useEffect(() => {
    void load()
  }, [load, refresh])
  const refreshSimple = simple.refresh
  useFresh(() => {
    void load()
    refreshSimple()
  })

  const people = useMemo(() => peopleOn(site.id, simple.crewOnSite, bookings ?? [], roster ?? new Map()), [site.id, simple.crewOnSite, bookings, roster])
  const startsBy = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const b of bookings ?? []) m.set(b.worker_id, [...(m.get(b.worker_id) ?? []), b.starts_at])
    return m
  }, [bookings])

  const onSite = people.filter((p) => p.onClock)
  const booked = people.filter((p) => !p.onClock)

  return (
    <Card
      title="People"
      data-card="people"
      action={
        <a {...linkProps(paths.job(site.id, 'crew'))} className="wb-link">
          {booked.length || onSite.length ? 'Crew' : 'Book crew'}
        </a>
      }
    >
      {error && <div role="alert" style={{ ...text.sm, color: color.red, paddingBottom: space.xs }}>Bookings did not load: {error}</div>}

      <Section label="On site now" data="on-site">
        {onSite.length === 0 ? (
          <Quiet>{simple.loading && simple.crewOnSite.size === 0 ? ' ' : 'Nobody is clocked on here right now'}</Quiet>
        ) : (
          onSite.map((p, i) => <PersonLine key={p.id} index={i} name={p.name} initials={p.initials} where={p.where} live />)
        )}
      </Section>

      <Section label={`Booked, next ${WINDOW_DAYS} days`} data="booked">
        {bookings === null || roster === null ? (
          // Not "nobody" until both the bookings and the names to put on them are in.
          <Quiet>{error ? '' : ' '}</Quiet>
        ) : booked.length === 0 ? (
          <Quiet>Nobody is booked in the next two weeks</Quiet>
        ) : (
          booked.map((p, i) => <PersonLine key={p.id} index={onSite.length + i} name={p.name} initials={p.initials} where={bookedWords(startsBy.get(p.id) ?? []) || p.where} />)
        )}
      </Section>
    </Card>
  )
}

function Section({ label, data, children }: { label: string; data: string; children: ReactNode }) {
  return (
    <div data-people={data} style={{ display: 'flex', flexDirection: 'column', gap: space.xs, padding: `${space.sm}px 0`, borderTop: `1px solid ${color.borderSoft}` }}>
      <span style={{ ...text.xs, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: color.muted }}>{label}</span>
      {children}
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <span style={{ ...text.sm, color: color.faint }}>{children}</span>
}

function PersonLine({ name, initials, where, index, live = false }: { name: string; initials: string; where: string; index: number; live?: boolean }) {
  return (
    <div data-person={name} style={{ display: 'flex', alignItems: 'center', gap: space.sm, minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          flex: 'none',
          width: 30,
          height: 30,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: avatarGrey(index),
          color: color.onDark,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {initialsOf({ id: name, name, initials })}
        {live && <span style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', background: color.green, boxShadow: `0 0 0 2px ${color.panel}` }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...text.base, fontWeight: 600, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ ...text.sm, color: live ? color.green : color.muted }}>{where}</span>
      </span>
    </div>
  )
}
