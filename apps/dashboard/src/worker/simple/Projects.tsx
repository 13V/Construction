/**
 * Projects — the drawn register: notifications on top, active projects with
 * progress and crew assignment, then what is coming. Transcribed from the
 * isProjects block of design/mobile/simple/Crewline-Simple.dc.html.
 *
 * Notifications are derived, never stored: open defects, an overdue flood
 * test, a variation sitting with the builder. Each one is the same fact the
 * counters on Home count — this screen is where they get words and a time.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type AssignmentRow, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { addressLine, avatarGrey, builderOf, railOf, s, SAFE_BOTTOM, SAFE_TOP } from './stheme'
import type { SimpleData } from './data'
import type { JobTab } from './Job'

const money0 = (v: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v)

const whenLabel = (iso: string) => {
  // A bare date ("2026-08-14", e.g. raised_on) has no clock to show — parsing
  // it as an instant would render UTC midnight as a bogus local time.
  if (!iso.includes('T')) {
    const d = new Date(`${iso}T12:00:00`)
    const today = new Date().toLocaleDateString('en-CA')
    return iso === today ? 'Today' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  }
  const d = new Date(iso)
  const t0 = new Date()
  t0.setHours(0, 0, 0, 0)
  if (d.getTime() >= t0.getTime())
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
}

interface Notif {
  key: string
  text: string
  meta: string
  tone: 'r' | 'a'
  at: string
  site: JobSiteRow
  tab: JobTab
}

interface Person {
  id: string
  name: string
  initials: string
  where: string
  onClock: boolean
}

export function ProjectsScreen({
  me,
  data,
  onOpenJob,
}: {
  me: WorkerRow
  data: SimpleData
  onOpenJob: (site: JobSiteRow, tab?: JobTab) => void
}) {
  const office = me.is_office
  const [defectRows, setDefectRows] = useState<Array<{ site_id: string; location: string | null; created_at: string }>>([])
  const [wpRows, setWpRows] = useState<Array<{ site_id: string; area: string; flood_test_on: string | null }>>([])
  const [varRows, setVarRows] = useState<Array<{ id: string; site_id: string | null; cost_impact: number | null; raised_on: string }>>([])
  const [bookings, setBookings] = useState<AssignmentRow[]>([])
  const [roster, setRoster] = useState<Map<string, { name: string; initials: string }>>(new Map())
  const [showAll, setShowAll] = useState(false)
  const [tab, setTab] = useState<'active' | 'future'>('active')
  const [open, setOpen] = useState('')
  const [nonce, setNonce] = useState(0)
  const [newOpen, setNewOpen] = useState(false)
  const [assignFor, setAssignFor] = useState<JobSiteRow | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    const t14 = new Date(t0.getTime() + 14 * 86_400_000)
    void Promise.all([
      client.from('defects').select('site_id, location, created_at').in('status', ['open', 'in_progress']),
      client.from('waterproofing').select('site_id, area, flood_test_on').in('status', ['complete', 'signed_off']).eq('flood_tested', false),
      // The office reads change_orders for the dollar figure the notification
      // leads with. A captain reads site_variations_v instead (schema_v24) —
      // the same pending list with cost_impact left off — and the notification
      // below says so in words rather than a number it was never sent.
      office
        ? client.from('change_orders').select('id, site_id, cost_impact, raised_on').eq('status', 'pending_client')
        : client.from('site_variations_v').select('id, site_id, raised_on').eq('status', 'pending_client'),
      client
        .from('assignments')
        .select('*')
        .eq('published', true)
        .gte('starts_at', t0.toISOString())
        .lt('starts_at', t14.toISOString()),
      client.from('crew_v').select('id, name, initials'),
    ]).then(([df, wp, co, asg, cv]) => {
      if (cancelled) return
      setDefectRows((df.data as Array<{ site_id: string; location: string | null; created_at: string }>) ?? [])
      setWpRows(wp.error ? [] : ((wp.data as Array<{ site_id: string; area: string; flood_test_on: string | null }>) ?? []))
      setVarRows(
        co.error
          ? []
          : ((co.data as Array<{ id: string; site_id: string | null; cost_impact?: number; raised_on: string }>) ?? []).map((v) => ({
              id: v.id,
              site_id: v.site_id,
              cost_impact: v.cost_impact ?? null,
              raised_on: v.raised_on,
            })),
      )
      setBookings((asg.data as AssignmentRow[]) ?? [])
      setRoster(new Map(((cv.data as Array<{ id: string; name: string; initials: string }>) ?? []).map((w) => [w.id, w])))
    })
    return () => {
      cancelled = true
    }
  }, [me.id, office, nonce])

  const byId = useMemo(() => new Map(data.sites.map((x) => [x.id, x])), [data.sites])

  const notifs = useMemo(() => {
    const out: Notif[] = []
    // Defects, grouped the way they were raised: per job and location.
    const grouped = new Map<string, { site: JobSiteRow; location: string; n: number; at: string }>()
    for (const d of defectRows) {
      const site = byId.get(d.site_id)
      if (!site) continue
      const key = `${d.site_id}|${d.location ?? ''}`
      const g = grouped.get(key)
      if (g) {
        g.n++
        if (d.created_at > g.at) g.at = d.created_at
      } else grouped.set(key, { site, location: d.location || 'site', n: 1, at: d.created_at })
    }
    for (const [key, g] of grouped) {
      out.push({
        key: `d|${key}`,
        text: `${g.n} defect${g.n === 1 ? '' : 's'} logged on ${g.location}`,
        meta: `${g.site.name} · ${whenLabel(g.at)}`,
        tone: 'r',
        at: g.at,
        site: g.site,
        tab: 'photos',
      })
    }
    for (const w of wpRows) {
      const site = byId.get(w.site_id)
      if (!site) continue
      const at = w.flood_test_on ?? new Date().toISOString()
      out.push({
        key: `w|${w.site_id}|${w.area}`,
        text: `Flood test on ${w.area} is overdue`,
        meta: `${site.name} · ${whenLabel(at)}`,
        tone: 'r',
        at,
        site,
        tab: 'overview',
      })
    }
    for (const v of varRows) {
      const site = v.site_id ? byId.get(v.site_id) : undefined
      if (!site) continue
      out.push({
        key: `v|${v.id}`,
        // A captain's row came from site_variations_v and never carried
        // cost_impact — the same reason the chip below has no dollar sign.
        text: office ? `${money0(Number(v.cost_impact))} variation waiting on the builder` : 'A variation is waiting on the builder',
        meta: `${site.name} · ${whenLabel(v.raised_on)}`,
        tone: 'a',
        at: v.raised_on,
        site,
        tab: office ? 'money' : 'overview',
      })
    }
    out.sort((a, b) => (a.at > b.at ? -1 : 1))
    return out
  }, [defectRows, wpRows, varRows, byId, office])

  /** Everyone attached to a job: on the clock there now, or booked ahead. */
  const peopleOf = useCallback(
    (siteId: string): Person[] => {
      const seen = new Map<string, Person>()
      for (const c of data.crewOnSite.get(siteId) ?? []) {
        const t = new Date(c.since).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
        const match = [...roster.entries()].find(([, w]) => w.name === c.name)
        seen.set(match?.[0] ?? c.name, {
          id: match?.[0] ?? c.name,
          name: c.name,
          initials: c.initials,
          where: `On site since ${t}`,
          onClock: true,
        })
      }
      for (const b of bookings) {
        if (b.site_id !== siteId || seen.has(b.worker_id)) continue
        const w = roster.get(b.worker_id)
        if (!w) continue
        const day = new Date(b.starts_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
        seen.set(b.worker_id, { id: b.worker_id, name: w.name, initials: w.initials, where: `Booked ${day}`, onClock: false })
      }
      return [...seen.values()]
    },
    [data.crewOnSite, bookings, roster],
  )

  const removePerson = async (siteId: string, workerId: string) => {
    // Unassigning takes their future published bookings off the job — the
    // honest meaning of "remove from this project". Past shifts stay.
    //
    // The rows come back because a DELETE the office is not allowed to make
    // matches nothing rather than failing, and PostgREST reports that as a
    // success. Without reading them back, a refusal looks exactly like a
    // person who had no bookings left.
    const { data, error: err } = await supabase()
      .from('assignments')
      .delete()
      .eq('site_id', siteId)
      .eq('worker_id', workerId)
      .gte('starts_at', new Date().toISOString())
      .select('id')
    if (err) {
      setAssignError(err.message)
      return
    }
    if (!data || data.length === 0) {
      setAssignError('Nothing changed — they have no bookings ahead on this job, or that is not yours to change.')
      return
    }
    setAssignError(null)
    setNonce((n) => n + 1)
  }

  /**
   * What needs attention, named as the thing itself and pointed at the tab
   * that fixes it. "Needs you" told a foreman to go looking; "2 flood tests
   * overdue" tells him what to do, and the tap lands him on Waterproofing.
   */
  const chipOf = (site: JobSiteRow): { chip: string; bg: string; fg: string; tab: JobTab } | null => {
    const d = data.openDefects.get(site.id) ?? 0
    const f = data.floodHold.get(site.id) ?? 0
    const v = data.pendingVariationsBySite.get(site.id) ?? 0
    if (f > 0) {
      return {
        chip: f === 1 ? 'Flood test overdue' : `${f} flood tests overdue`,
        bg: '#FDECEE',
        fg: '#A3282E',
        tab: 'overview',
      }
    }
    if (d > 0) return { chip: `${d} defect${d === 1 ? '' : 's'}`, bg: '#FDECEE', fg: '#A3282E', tab: 'overview' }
    if (v > 0) {
      return {
        chip: `${v} variation${v === 1 ? '' : 's'} waiting`,
        bg: '#FFF6E3',
        fg: '#8A6100',
        tab: office ? 'money' : 'overview',
      }
    }
    return null
  }

  const active = data.sites.filter((x) => x.status === 'active')
  const future = data.sites.filter((x) => x.status === 'starting_soon')
  const shown = showAll ? notifs : notifs.slice(0, 3)

  /**
   * "Do the two different tab, as list could get long." Both lists were
   * stacked, so a company with twenty running jobs pushed everything starting
   * next month somewhere nobody scrolls to. They are separate lists now, and
   * the tab carries its own count so the number is answered without opening
   * it.
   *
   * Active leads because that is the list somebody is on this screen for.
   */
  const list = tab === 'active' ? active : future

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: `calc(52px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 20px 0`, background: '#fff' }}>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Projects</span>
        <span onClick={() => setNewOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, cursor: 'pointer' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: '50%', background: '#14171A', boxShadow: '0 2px 6px rgba(16,20,24,.22)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
              <path d="M10 4.4v11.2M4.4 10h11.2" />
            </svg>
          </span>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#F5F6F7' }}>
        {/* NOTIFICATIONS — the dark card. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 9px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>NOTIFICATIONS</span>
          {notifs.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 21, padding: '0 8px', borderRadius: 11, background: '#FDECEE', fontSize: 11.5, fontWeight: 700, color: '#A3282E' }}>
              {notifs.length}
            </span>
          )}
        </div>
        <div style={{ margin: '0 18px', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', background: 'linear-gradient(#23272C,#15181C)', boxShadow: '0 10px 24px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset' }}>
          {shown.map((n, i) => (
            <span
              key={n.key}
              onClick={() => onOpenJob(n.site, n.tab)}
              style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 58, padding: '11px 15px', borderTop: `1px solid ${i === 0 ? 'transparent' : 'rgba(255,255,255,.08)'}`, cursor: 'pointer' }}
            >
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: n.tone === 'r' ? '#E5484D' : '#E9A23B', boxShadow: `0 0 0 4px ${n.tone === 'r' ? 'rgba(229,72,77,.16)' : 'rgba(233,162,59,.16)'}` }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3, color: '#fff' }}>{n.text}</span>
                <span style={{ fontSize: 12.5, color: '#8A929B' }}>{n.meta}</span>
              </span>
              <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
                <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#6D757D" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          ))}
          {notifs.length === 0 && (
            <span style={{ padding: '16px 17px', fontSize: 13.5, lineHeight: 1.45, color: '#8A929B' }}>
              Nothing needs you right now — defects, held flood tests and waiting variations land here.
            </span>
          )}
          {notifs.length > 3 && (
            <span
              onClick={() => setShowAll((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, borderTop: '1px solid rgba(255,255,255,.08)', fontSize: 13.5, fontWeight: 600, color: '#B4BBC2', cursor: 'pointer' }}
            >
              {showAll ? 'Show less' : `Show ${notifs.length - 3} more`}
            </span>
          )}
        </div>

        {/* Active or future — two lists, one at a time. */}
        <div style={{ display: 'flex', alignItems: 'stretch', margin: '18px 0 0', background: '#fff', borderTop: '1px solid #E9EDF0', borderBottom: '1px solid #E1E5E9' }}>
          {([
            ['active', 'Active projects', active.length],
            ['future', 'Future projects', future.length],
          ] as const).map(([key, label, n]) => {
            const on = tab === key
            return (
              <span
                key={key}
                onClick={() => setTab(key)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '11px 4px 0', cursor: 'pointer' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: on ? 700 : 500, letterSpacing: '-.01em', color: on ? s.ink : '#7B838B' }}>{label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 19, height: 19, padding: '0 5px', borderRadius: 10, background: on ? s.ink : '#EDEFF1', fontSize: 11, fontWeight: 700, color: on ? '#fff' : '#7B838B' }}>
                    {n}
                  </span>
                </span>
                <span style={{ width: '100%', height: 2.5, marginTop: 8, borderRadius: '2px 2px 0 0', background: on ? s.ink : 'transparent' }} />
              </span>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px 0' }}>
          {tab === 'active' && list.map((site) => {
            const chip = chipOf(site)
            const people = peopleOf(site.id)
            const isOpen = open === site.id
            const where = addressLine(site)
            const builder = builderOf(site)
            return (
              <div key={site.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site), zIndex: 1 }} />
                <span onClick={() => onOpenJob(site)} style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 14px 13px 19px', cursor: 'pointer' }}>
                  {/* The chip sits under the address rather than beside it: an
                      address is a good deal longer than a trade name was, and
                      side by side the two fought over the width until one of
                      them lost its ending. */}
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {/* The address IS the title now — the trade name above
                          it told nobody anything they could act on, and the
                          job is found by where it is. Falling back to the name
                          covers a job with no address on it yet. */}
                      <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.015em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {where || site.name}
                      </span>
                      {builder && (
                        <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{builder}</span>
                      )}
                    </span>
                    {chip && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenJob(site, chip.tab)
                        }}
                        style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, maxWidth: '100%', height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: chip.bg, color: chip.fg, cursor: 'pointer' }}
                      >
                        <span style={{ flex: 'none', width: 5, height: 5, borderRadius: '50%', background: chip.fg }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chip.chip}</span>
                      </span>
                    )}
                  </span>
                </span>
                <span
                  onClick={() => setOpen(isOpen ? '' : site.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '8px 14px 8px 19px', borderTop: '1px solid #EDEFF1', cursor: 'pointer' }}
                >
                  <span style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
                    {people.slice(0, 4).map((p, i) => (
                      <span key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, marginRight: -7, borderRadius: '50%', border: '2px solid #fff', background: p.onClock ? avatarGrey(i) : '#8B9096', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                        {p.initials}
                      </span>
                    ))}
                  </span>
                  <span style={{ flex: 1, paddingLeft: 13, fontSize: 13.5, color: '#4A5057', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} assigned` : 'Nobody assigned yet'}
                  </span>
                  <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, color: s.accent }}>{isOpen ? 'Done' : 'Manage'}</span>
                </span>
                {isOpen && (
                  <span style={{ display: 'flex', flexDirection: 'column', background: '#FAFBFC', borderTop: '1px solid #EDEFF1' }}>
                    {people.map((p, i) => (
                      <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 56, padding: '9px 14px 9px 19px', borderBottom: '1px solid #EDEFF1' }}>
                        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: p.onClock ? avatarGrey(i) : '#8B9096', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                          {p.initials}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          <span style={{ fontSize: 12.5, color: '#8B9096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.where}</span>
                        </span>
                        {office && !p.onClock && (
                          <span
                            onClick={() => void removePerson(site.id, p.id)}
                            style={{ flex: 'none', display: 'flex', alignItems: 'center', height: 30, padding: '0 11px', border: '1px solid #E7CBCD', borderRadius: 15, fontSize: 12.5, fontWeight: 700, color: '#A3282E', cursor: 'pointer' }}
                          >
                            Remove
                          </span>
                        )}
                      </span>
                    ))}
                    {people.length === 0 && (
                      <span style={{ padding: '14px 19px', fontSize: 13.5, color: '#8B9096' }}>Nobody assigned to this project yet.</span>
                    )}
                    {assignError && (
                      <span style={{ margin: '10px 14px 0 19px', padding: '9px 11px', background: '#FDECEE', borderRadius: 9, fontSize: 12.5, lineHeight: 1.45, color: '#8E2A31' }}>
                        {assignError}
                      </span>
                    )}
                    <span
                      onClick={() => {
                        setAssignError(null)
                        setAssignFor(site)
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 52, padding: '9px 14px 9px 19px', cursor: 'pointer' }}
                    >
                      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: '#14171A' }}>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                          <path d="M10 4.5v11M4.5 10h11" />
                        </svg>
                      </span>
                      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: '#14171A' }}>Assign personnel</span>
                    </span>
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* FUTURE PROJECTS. */}
        {tab === 'future' && (
          <div style={{ margin: '0 18px 22px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
            {future.map((site, i) => (
              <span
                key={site.id}
                onClick={() => onOpenJob(site, 'crew')}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 68, padding: '11px 14px 11px 19px', borderTop: `1px solid ${i === 0 ? 'transparent' : '#EDEFF1'}`, cursor: 'pointer' }}
              >
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {addressLine(site) || site.name}
                  </span>
                  {builderOf(site) && (
                    <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{builderOf(site)}</span>
                  )}
                </span>
                <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#FFF6E3', color: '#8A6100' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#8A6100' }} />
                  {site.schedule_note || 'Starting soon'}
                </span>
                <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
                  <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ))}
          </div>
        )}

        {/* An empty list still has to say so, or the tab looks broken. */}
        {list.length === 0 && (
          <div style={{ margin: '14px 18px 22px', padding: '18px 16px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
            {tab === 'active'
              ? 'No jobs running right now. Anything starting soon is on the other tab.'
              : 'Nothing lined up yet. A job set to start later shows here until the day it does.'}
          </div>
        )}
        {list.length > 0 && <div style={{ height: 22 }} />}
      </div>

      {newOpen && (
        <NewProjectSheet
          me={me}
          office={office}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false)
            setTab('future')
            data.refresh()
          }}
        />
      )}

      {assignFor && (
        <AssignSheet
          me={me}
          office={office}
          site={assignFor}
          onClose={() => setAssignFor(null)}
          onAssigned={() => {
            setAssignFor(null)
            setNonce((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------- new project

/**
 * The one flow the header's + opens: a name, who it is for, and the fence a
 * job needs before anyone can clock on to it — that last part is why this
 * exists at all, since a job with no fence is a job nobody can start. Office
 * only, on the same rule as every other write on this screen: `job_sites_write`
 * checks `current_is_office()`, so the SAVE button is the thing that is not
 * live for anyone else, same as DetailEditor in Overview.tsx.
 *
 * There is no geocoder in this bundle, and the honest case for opening this
 * sheet is standing on the job — so the fence starts at wherever the phone
 * says that is, not at an address somebody has to type and hope matches.
 */
function NewProjectSheet({
  me,
  office,
  onClose,
  onCreated,
}: {
  me: WorkerRow
  office: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [builder, setBuilder] = useState('')
  const [address, setAddress] = useState('')
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null)
  // 150 is job_sites' own default (schema.sql) and what most seeded sites
  // carry. The slider tops out at 600, same as the office dashboard's own
  // new-site form — the schema allows up to 2000, but nothing this size
  // needs a fence wider than that ever has.
  const [radius, setRadius] = useState(150)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function locateMe() {
    if (!('geolocation' in navigator)) {
      setError('This device has no location service — set the fence from the office dashboard instead.')
      return
    }
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
      },
      (err) => {
        setError(err.message || 'Could not get your location.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  async function save() {
    if (!name.trim() || !center) {
      setError('A name and a location for the fence are both required.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase()
      .from('job_sites')
      .insert({
        company_id: me.company_id,
        name: name.trim(),
        address: address.trim(),
        client_name: builder.trim() || null,
        status: 'starting_soon',
        lat: center.lat,
        lng: center.lng,
        radius_m: radius,
      })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onCreated()
  }

  const label = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' } as const
  const input = {
    width: '100%',
    height: 48,
    padding: '0 13px',
    boxSizing: 'border-box' as const,
    background: '#F5F6F7',
    border: '1px solid #DCE0E6',
    borderRadius: 10,
    font: 'inherit',
    fontSize: 16,
    color: s.ink,
    outline: 'none',
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>New project</span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          {office ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, color: '#8E2A31' }}>{error}</span>}

              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>PROJECT NAME</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maple Ridge" style={input} />
              </span>

              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>BUILDER</span>
                <input value={builder} onChange={(e) => setBuilder(e.target.value)} placeholder="Who the job is for" style={input} />
              </span>

              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>SITE ADDRESS</span>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder="Street, suburb, state, postcode"
                  style={{ ...input, height: 'auto', padding: '11px 13px', fontFamily: 'inherit', lineHeight: 1.4, resize: 'none' }}
                />
              </span>

              <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={label}>GEOFENCE</span>
                {center ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: '#EAF7EC', border: '1px solid #C8E6D5', borderRadius: 10 }}>
                    <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: '#1F7A4D' }} />
                    <span style={{ flex: 1, fontSize: 13, color: '#14532B' }}>
                      Centred where you are now ({center.lat.toFixed(5)}, {center.lng.toFixed(5)})
                    </span>
                    <span
                      onClick={locating ? undefined : locateMe}
                      style={{ flex: 'none', fontSize: 12.5, fontWeight: 700, color: locating ? '#8B9096' : s.accent, cursor: locating ? 'default' : 'pointer' }}
                    >
                      {locating ? 'Finding…' : 'Update'}
                    </span>
                  </span>
                ) : (
                  <button
                    onClick={locateMe}
                    disabled={locating}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, border: '1px solid #DCE0E6', borderRadius: 10, background: '#fff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: '#1A1D21', cursor: locating ? 'default' : 'pointer' }}
                  >
                    {locating ? 'Finding you…' : 'Use my current location'}
                  </button>
                )}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12.5, color: '#4A5057' }}>Fence radius — {radius} m</span>
                  <input type="range" min={25} max={600} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ width: '100%' }} />
                </span>
                <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                  Crew can only clock on inside this circle, so a job needs one before anyone can
                  start it. It's centred on you for now — move it from the office dashboard once
                  the real boundary is known.
                </span>
              </span>

              <button
                disabled={busy}
                onClick={() => void save()}
                style={{ width: '100%', height: 48, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', opacity: busy ? 0.6 : 1, cursor: 'pointer' }}
              >
                {busy ? 'SAVING…' : 'SAVE'}
              </button>
            </div>
          ) : (
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
              The office sets up new projects, including the geofence a job needs before anyone
              can clock in. If one's missing, say so in the job chat.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------- assign personnel

/** Mon-Fri between two local dates, inclusive. Bookings are a working day. */
function weekdaysBetween(fromISO: string, toISO: string): Date[] {
  const out: Date[] = []
  const d = new Date(`${fromISO}T00:00:00`)
  const end = new Date(`${toISO}T00:00:00`)
  while (d <= end && out.length < ASSIGN_MAX_DAYS) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) out.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * A twelve-week ceiling. A booking is a row per person per day, so a job with
 * a two-year programme would write thousands of them from one tap — and
 * nobody rosters that far out honestly anyway. The sheet says when it stops.
 */
const ASSIGN_MAX_DAYS = 84

/** Local 07:00-15:00, the same working day the office scheduler books. */
function bookingTimes(day: Date): { starts_at: string; ends_at: string } {
  const from = new Date(day)
  from.setHours(7, 0, 0, 0)
  const to = new Date(day)
  to.setHours(15, 0, 0, 0)
  return { starts_at: from.toISOString(), ends_at: to.toISOString() }
}

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface Assignable {
  id: string
  name: string
  initials: string
  trade: string | null
}

/**
 * Putting people on a job.
 *
 * "Assign personnel" used to land on a read-only Crew tab, which is the same
 * as not having the button. What it has to do is what the office means by it:
 * pick the people, pick the run of days, and book them.
 *
 * A booking in this app is one row per person per working day — that is what
 * the schedule reads and what a timesheet is checked against — so this writes
 * that, and skips any day a person is already booked on anything. It says how
 * many it skipped rather than silently double-booking somebody or silently
 * doing less than it was asked.
 */
function AssignSheet({
  me,
  office,
  site,
  onClose,
  onAssigned,
}: {
  me: WorkerRow
  office: boolean
  site: JobSiteRow
  onClose: () => void
  onAssigned: () => void
}) {
  const [crew, setCrew] = useState<Assignable[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // The job's own dates lead, because somebody typed those in for this job.
  // The start is never in the past: you cannot roster a day that has gone.
  const [from, setFrom] = useState(() => {
    const today = localISO(new Date())
    return site.starts_on && site.starts_on > today ? site.starts_on : today
  })
  const [to, setTo] = useState(() => {
    if (site.ends_on) return site.ends_on
    const d = new Date()
    d.setDate(d.getDate() + 13)
    return localISO(d)
  })

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('crew_v')
      .select('id, name, initials, trade, active, is_office')
      .eq('active', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        setCrew(
          ((data as Array<Assignable & { is_office: boolean }>) ?? [])
            .filter((w) => !w.is_office)
            .map((w) => ({ id: w.id, name: w.name, initials: w.initials, trade: w.trade })),
        )
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const days = useMemo(() => (from && to && from <= to ? weekdaysBetween(from, to) : []), [from, to])

  async function assign() {
    if (picked.size === 0) {
      setError('Nobody is picked yet.')
      return
    }
    if (days.length === 0) {
      setError('That range has no working days in it.')
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    const client = supabase()
    const ids = [...picked]

    // What they already have on, anywhere — a person booked on another job
    // that day is not free for this one, and quietly writing a second row
    // would put them in two places on the schedule.
    const first = new Date(days[0]!)
    first.setHours(0, 0, 0, 0)
    const last = new Date(days[days.length - 1]!)
    last.setHours(23, 59, 59, 999)
    const { data: existing, error: readErr } = await client
      .from('assignments')
      .select('worker_id, starts_at')
      .in('worker_id', ids)
      .gte('starts_at', first.toISOString())
      .lte('starts_at', last.toISOString())
    if (readErr) {
      setBusy(false)
      setError(readErr.message)
      return
    }
    const taken = new Set(
      ((existing as Array<{ worker_id: string; starts_at: string }>) ?? []).map(
        (a) => `${a.worker_id}|${localISO(new Date(a.starts_at))}`,
      ),
    )

    const rows: Array<Record<string, unknown>> = []
    let skipped = 0
    for (const id of ids) {
      for (const day of days) {
        if (taken.has(`${id}|${localISO(day)}`)) {
          skipped++
          continue
        }
        rows.push({
          company_id: me.company_id,
          worker_id: id,
          site_id: site.id,
          ...bookingTimes(day),
          published: true,
        })
      }
    }

    if (rows.length === 0) {
      setBusy(false)
      setError('Everyone picked is already booked for every day in that range.')
      return
    }

    // Read the rows back. An insert the office is not allowed to make is
    // refused outright, but one filtered out by a row-level policy comes back
    // as a success with nothing in it — and the two have to read differently.
    const { data: made, error: err } = await client.from('assignments').insert(rows).select('id')
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (!made || made.length === 0) {
      setError('That was refused — assigning people to a job is the office’s to do.')
      return
    }
    if (skipped > 0) {
      setNote(`Booked ${made.length} day${made.length === 1 ? '' : 's'}. ${skipped} skipped — already booked.`)
      return
    }
    onAssigned()
  }

  const label = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', color: '#8B9096' } as const
  const input = {
    width: '100%',
    height: 48,
    padding: '0 13px',
    boxSizing: 'border-box' as const,
    background: '#F5F6F7',
    border: '1px solid #DCE0E6',
    borderRadius: 10,
    font: 'inherit',
    fontSize: 16,
    color: s.ink,
    outline: 'none',
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.5)' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}
      >
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>Assign personnel</span>
            <span style={{ fontSize: 12.5, color: '#8B9096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {addressLine(site) || site.name}
            </span>
          </span>
          <span onClick={onClose} style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `15px 16px calc(20px + ${SAFE_BOTTOM})` }}>
          {!office ? (
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
              The office rosters people onto jobs. If you need somebody here, say so in the job chat
              — it is the same request, and it leaves a record.
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {error && <span style={{ padding: '10px 12px', background: '#FDECEE', borderRadius: 9, fontSize: 13, lineHeight: 1.45, color: '#8E2A31' }}>{error}</span>}
              {note && <span style={{ padding: '10px 12px', background: '#EAF7EC', borderRadius: 9, fontSize: 13, lineHeight: 1.45, color: '#14532B' }}>{note}</span>}

              <span style={{ display: 'flex', gap: 10 }}>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>FROM</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={label}>TO</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
                </span>
              </span>

              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                {days.length === 0
                  ? 'No working days in that range.'
                  : `${days.length} working day${days.length === 1 ? '' : 's'}, 7am to 3pm, weekends left out.` +
                    (days.length >= ASSIGN_MAX_DAYS ? ' That is as far ahead as this books in one go.' : '')}
              </span>

              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>WHO</span>
                <span style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 10, overflow: 'hidden' }}>
                  {loading && <span style={{ padding: '14px 14px', fontSize: 13.5, color: '#8B9096' }}>Loading the crew…</span>}
                  {!loading && crew.length === 0 && (
                    <span style={{ padding: '14px 14px', fontSize: 13.5, lineHeight: 1.5, color: '#8B9096' }}>
                      Nobody on the books yet. People are added on the Crew screen.
                    </span>
                  )}
                  {crew.map((w, i) => {
                    const on = picked.has(w.id)
                    return (
                      <span
                        key={w.id}
                        onClick={() =>
                          setPicked((prev) => {
                            const next = new Set(prev)
                            if (next.has(w.id)) next.delete(w.id)
                            else next.add(w.id)
                            return next
                          })
                        }
                        style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 56, padding: '9px 13px', borderTop: `1px solid ${i === 0 ? 'transparent' : '#EDEFF1'}`, background: on ? '#F4F6F8' : '#fff', cursor: 'pointer' }}
                      >
                        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: avatarGrey(i), color: '#fff', fontSize: 11, fontWeight: 700 }}>
                          {w.initials}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                          {w.trade && <span style={{ fontSize: 12.5, color: '#8B9096' }}>{w.trade}</span>}
                        </span>
                        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${on ? s.accent : '#CFD4DA'}`, background: on ? s.accent : '#fff' }}>
                          {on && (
                            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4.5 10.5l3.5 3.5 7.5-7.5" />
                            </svg>
                          )}
                        </span>
                      </span>
                    )
                  })}
                </span>
              </span>

              <button
                disabled={busy}
                onClick={() => void assign()}
                style={{ width: '100%', height: 48, border: 0, borderRadius: 10, background: '#1A1D21', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, letterSpacing: '.03em', color: '#fff', opacity: busy ? 0.6 : 1, cursor: 'pointer' }}
              >
                {busy
                  ? 'BOOKING…'
                  : `ASSIGN${picked.size ? ` ${picked.size}` : ''}${picked.size && days.length ? ` · ${picked.size * days.length} DAY${picked.size * days.length === 1 ? '' : 'S'}` : ''}`}
              </button>

              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#8B9096' }}>
                This writes real bookings — they show on the schedule straight away and anyone
                booked can clock on inside the fence. A day somebody is already booked on is left
                alone rather than double-booked.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
