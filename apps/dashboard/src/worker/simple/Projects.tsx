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
import { avatarGrey, railOf, s, SAFE_TOP } from './stheme'
import type { SimpleData } from './data'

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

const localeOf = (site: { name: string; address: string }) => {
  const m = site.address.match(/,\s*([^,\d]+?)\s+SA\b/)
  const suburb = m?.[1]?.trim()
  if (suburb && suburb !== site.name) return suburb
  const street = (site.address.split(',')[0] ?? '').trim()
  return street.startsWith(site.name) ? '' : street
}

interface Notif {
  key: string
  text: string
  meta: string
  tone: 'r' | 'a'
  at: string
  site: JobSiteRow
  tab: 'photos' | 'waterproofing' | 'money'
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
  onOpenJob: (site: JobSiteRow, tab?: 'photos' | 'waterproofing' | 'money' | 'crew') => void
}) {
  const office = me.is_office
  const [defectRows, setDefectRows] = useState<Array<{ site_id: string; location: string | null; created_at: string }>>([])
  const [wpRows, setWpRows] = useState<Array<{ site_id: string; area: string; flood_test_on: string | null }>>([])
  const [varRows, setVarRows] = useState<Array<{ site_id: string | null; cost_impact: number; raised_on: string }>>([])
  const [bookings, setBookings] = useState<AssignmentRow[]>([])
  const [roster, setRoster] = useState<Map<string, { name: string; initials: string }>>(new Map())
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    const t0 = new Date()
    t0.setHours(0, 0, 0, 0)
    const t14 = new Date(t0.getTime() + 14 * 86_400_000)
    void Promise.all([
      client.from('defects').select('site_id, location, created_at').in('status', ['open', 'in_progress']),
      client.from('waterproofing').select('site_id, area, flood_test_on').in('status', ['complete', 'signed_off']).eq('flood_tested', false),
      client.from('change_orders').select('site_id, cost_impact, raised_on').eq('status', 'pending_client'),
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
      setVarRows(co.error ? [] : ((co.data as Array<{ site_id: string | null; cost_impact: number; raised_on: string }>) ?? []))
      setBookings((asg.data as AssignmentRow[]) ?? [])
      setRoster(new Map(((cv.data as Array<{ id: string; name: string; initials: string }>) ?? []).map((w) => [w.id, w])))
    })
    return () => {
      cancelled = true
    }
  }, [me.id, nonce])

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
        tab: 'waterproofing',
      })
    }
    for (const v of varRows) {
      const site = v.site_id ? byId.get(v.site_id) : undefined
      if (!site) continue
      out.push({
        key: `v|${v.site_id}|${v.raised_on}|${v.cost_impact}`,
        text: `${money0(Number(v.cost_impact))} variation waiting on the builder`,
        meta: `${site.name} · ${whenLabel(v.raised_on)}`,
        tone: 'a',
        at: v.raised_on,
        site,
        tab: 'money',
      })
    }
    out.sort((a, b) => (a.at > b.at ? -1 : 1))
    return out
  }, [defectRows, wpRows, varRows, byId])

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
    await supabase()
      .from('assignments')
      .delete()
      .eq('site_id', siteId)
      .eq('worker_id', workerId)
      .gte('starts_at', new Date().toISOString())
    setNonce((n) => n + 1)
  }

  const chipOf = (site: JobSiteRow) => {
    const d = data.openDefects.get(site.id) ?? 0
    const f = data.floodHold.get(site.id) ?? 0
    const v = data.pendingVariationsBySite.get(site.id) ?? 0
    if (d > 0) return { chip: `${d} defect${d === 1 ? '' : 's'}`, bg: '#FDECEE', fg: '#A3282E' }
    if (f > 0) return { chip: 'Needs you', bg: '#FDECEE', fg: '#A3282E' }
    if (v > 0) return { chip: `${v} variation${v === 1 ? '' : 's'}`, bg: '#FFF6E3', fg: '#8A6100' }
    return null
  }

  const active = data.sites.filter((x) => x.status === 'active')
  const future = data.sites.filter((x) => x.status === 'starting_soon')
  const shown = showAll ? notifs : notifs.slice(0, 3)

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: `calc(52px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 20px 0`, background: '#fff' }}>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Projects</span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44 }}>
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

        {/* ACTIVE PROJECTS. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '20px 18px 9px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>ACTIVE PROJECTS</span>
          <span style={{ fontSize: 12.5, color: '#7B838B' }}>{active.length} running</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px' }}>
          {active.map((site) => {
            const pct = Math.round(data.progress.get(site.id) ?? 0)
            const chip = chipOf(site)
            const people = peopleOf(site.id)
            const isOpen = open === site.id
            const sub = [localeOf(site), site.job_type, site.client_name].filter(Boolean).join(' · ')
            return (
              <div key={site.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site), zIndex: 1 }} />
                <span onClick={() => onOpenJob(site)} style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '14px 14px 13px 19px', cursor: 'pointer' }}>
                  <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.015em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                      <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
                    </span>
                    {chip && (
                      <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: chip.bg, color: chip.fg }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: chip.fg }} />
                        {chip.chip}
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ flex: 1, display: 'block', height: 4, borderRadius: 2, background: '#EDEFF1', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: 4, borderRadius: 2, background: railOf(site), width: `${pct}%` }} />
                    </span>
                    <span style={{ flex: 'none', fontSize: 13, fontWeight: 600, color: '#5B6169' }}>{pct}%</span>
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
                    <span
                      onClick={() => onOpenJob(site, 'crew')}
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
        {future.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '20px 18px 9px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>FUTURE PROJECTS</span>
              <span style={{ fontSize: 12.5, color: '#7B838B' }}>
                {future.length} {future.length === 1 ? 'starting soon' : 'coming up'}
              </span>
            </div>
            <div style={{ margin: '0 18px 22px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
              {future.map((site, i) => (
                <span
                  key={site.id}
                  onClick={() => onOpenJob(site, 'crew')}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 68, padding: '11px 14px 11px 19px', borderTop: `1px solid ${i === 0 ? 'transparent' : '#EDEFF1'}`, cursor: 'pointer' }}
                >
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                    <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[localeOf(site), site.job_type, site.client_name].filter(Boolean).join(' · ')}
                    </span>
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
          </>
        )}
        {future.length === 0 && <div style={{ height: 22 }} />}
      </div>
    </div>
  )
}
