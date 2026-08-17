/**
 * Home — a transcription of the Simple design's isHome block, not an
 * approximation of it. Every size, colour, radius and shadow below is lifted
 * from design/mobile/simple/Crewline-Simple.dc.html; where a value looks odd
 * (a 5px rail, a 23px chip, `.14em` tracking) it is because the drawing says
 * so. Deviate here and the app stops being the design.
 */
import { useState } from 'react'
import type { JobSiteRow, WorkerRow } from '../../data/supabase'
import { avatarGrey, railOf, s, SAFE_BOTTOM, SAFE_TOP } from './stheme'
import type { SimpleData } from './data'
import type { JobTab } from './Job'

const DAY = 86_400_000

/** "Tue 12 Aug" — dow capitalised, no comma, exactly as the card draws it. */
function calDate(offset: number): string {
  const d = new Date(Date.now() + offset * DAY)
  const dow = d.toLocaleDateString('en-AU', { weekday: 'short' })
  return `${dow} ${d.getDate()} ${d.toLocaleDateString('en-AU', { month: 'short' })}`
}

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

/**
 * "42 Kentish Ave, Prospect SA 5082" → "Prospect": the drawing's rows lead
 * with the suburb. Except when the job is NAMED after its suburb ("Hallett
 * Cove") — repeating the name as its own locale says nothing, so the street
 * ("18 Sandison Rd") carries the line instead, which is what the drawing does.
 */
const localeOf = (site: { name: string; address: string }) => {
  const m = site.address.match(/,\s*([^,\d]+?)\s+SA\b/)
  const suburb = m?.[1]?.trim()
  if (suburb && suburb !== site.name) return suburb
  const street = (site.address.split(',')[0] ?? '').trim()
  // An address that is just the job's own name carries no locale at all.
  return street.startsWith(site.name) ? '' : street
}

const Chevron = ({ size = 10, colour = '#B7BCC2' }: { size?: number; colour?: string }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" style={{ flex: 'none' }}>
    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke={colour} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function HomeScreen({
  me,
  data,
  onOpenJob,
  onOpenSchedule,
  onOpenClock,
  onOpenNotifications,
  onShowAccount,
}: {
  me: WorkerRow
  data: SimpleData
  onOpenJob: (site: JobSiteRow, tab?: JobTab) => void
  onOpenSchedule: () => void
  onOpenClock: () => void
  onOpenNotifications: () => void
  onShowAccount: () => void
}) {
  const [whoOpen, setWhoOpen] = useState(false)
  const [attnOpen, setAttnOpen] = useState(false)
  const byId = new Map(data.sites.map((x) => [x.id, x]))
  const firstStart = new Map<string, string>()
  for (const b of data.today) if (!firstStart.has(b.site_id)) firstStart.set(b.site_id, clockTime(b.starts_at))

  const calRows = (list: typeof data.today) => {
    const seen = new Map<string, { name: string; time: string; rail: string }>()
    for (const b of list) {
      const site = byId.get(b.site_id)
      if (!site || seen.has(site.id)) continue
      seen.set(site.id, {
        // The card's columns are narrow, so the drawing shortens names the
        // same way people do out loud: "Lot 42", not "Lot 42, Kentish Ave".
        name: site.name.split(',')[0],
        time: `${clockTime(b.starts_at)} – ${clockTime(b.ends_at)}`,
        rail: railOf(site),
      })
    }
    return [...seen.values()]
  }

  // The drawing's TODAY list is the day's schedule: the jobs someone is
  // booked on, in booking order. Every active job regardless would bury the
  // day under jobs nobody is at. When nothing is booked (a brand-new tenant),
  // fall back to the active list so the screen is never a dead card.
  const todaySites: JobSiteRow[] = []
  {
    const seen = new Set<string>()
    for (const b of data.today) {
      const site = byId.get(b.site_id)
      if (!site || seen.has(site.id)) continue
      seen.add(site.id)
      todaySites.push(site)
    }
  }
  const active = data.sites.filter((x) => x.status === 'active')
  const todayList = todaySites.length > 0 ? todaySites : active

  // One entry per job that needs the owner, exactly as the drawing counts:
  // red for defects, red for a covered membrane with no flood test ("Needs
  // you"), amber for variations sitting with the builder. The sheet spans
  // every non-archived job — a job that starts Monday still belongs on it.
  const needs: Array<{ site: JobSiteRow; tone: 'r' | 'a'; chip: string; tab: 'photos' | 'waterproofing' | 'money' }> = []
  // Booked jobs first, in the day's order, then the rest — the drawing reads
  // the sheet as "today's problems, then everything else".
  const sheetOrder = [...todaySites, ...data.sites.filter((x) => !todaySites.some((t) => t.id === x.id))]
  for (const site of sheetOrder) {
    const d = data.openDefects.get(site.id) ?? 0
    const f = data.floodHold.get(site.id) ?? 0
    const v = data.pendingVariationsBySite.get(site.id) ?? 0
    if (d > 0) needs.push({ site, tone: 'r', chip: `${d} defect${d === 1 ? '' : 's'}`, tab: 'photos' })
    else if (f > 0) needs.push({ site, tone: 'r', chip: 'Needs you', tab: 'waterproofing' })
    else if (v > 0) needs.push({ site, tone: 'a', chip: `${v} variation${v === 1 ? '' : 's'}`, tab: 'money' })
  }
  const needIds = new Set(needs.map((n) => n.site.id))
  const calm = data.sites.filter((x) => !needIds.has(x.id))

  // The counter is jobs that need you, not a tally of everything wrong on
  // them — three jobs with problems is "3" however many problems each has.
  const attnN = needs.length
  const anyRed = needs.some((n) => n.tone === 'r')
  // The drawing's three-state attention colour: nothing → grey, only
  // waiting-on-someone → amber, anything red → the deep red.
  const attnFg = attnN ? (anyRed ? '#A3282E' : '#8A6100') : '#5B6169'
  const attnBd = attnN ? (anyRed ? '#F0C9CC' : '#EFD9AE') : '#E1E5E9'

  /**
   * The one-line state a job resolves to, the way the drawing writes it:
   * the thing that needs you beats the head-count, a future job says when it
   * starts, and a crew booked for tonight is "tonight", not a lie about now.
   */
  const stateOf = (site: JobSiteRow) => {
    if ((data.floodHold.get(site.id) ?? 0) > 0) return 'Flood test overdue'
    if (site.status === 'starting_soon') return site.schedule_note || 'Starting soon'
    const onsite = data.onSiteNow.get(site.id) ?? 0
    const first = data.today.find((b) => b.site_id === site.id)
    const evening = first ? new Date(first.starts_at).getHours() >= 17 : false
    if (onsite > 0) return `${onsite} on site ${evening ? 'tonight' : 'today'}`
    const pct = data.progress.get(site.id)
    return pct !== undefined ? `${Math.round(pct)}% done` : 'Nobody on site'
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Header: 52px, white, 21px title, bell with dot, 32px avatar. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: `calc(52px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 20px 0`, background: '#fff' }}>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Home</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={onOpenNotifications}
            aria-label="Notifications"
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="1.7" strokeLinecap="round">
              <path d="M10 3.2a4.6 4.6 0 0 0-4.6 4.6c0 4-1.6 5.2-1.6 5.2h12.4s-1.6-1.2-1.6-5.2A4.6 4.6 0 0 0 10 3.2z" />
              <path d="M8.4 15.6a1.9 1.9 0 0 0 3.2 0" />
            </svg>
            {attnN > 0 && (
              <span style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: '#E5484D', border: '1.5px solid #fff' }} />
            )}
          </button>
          <button
            onClick={onShowAccount}
            aria-label="Account"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: s.charcoal, color: '#fff', fontSize: 11, fontWeight: 700, border: 0, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            {me.initials}
          </button>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: s.appBg }}>
        {/* The calendar card — one tap target, the whole card opens Schedule. */}
        <div style={{ padding: '6px 18px 0' }}>
          <div
            onClick={onOpenSchedule}
            style={{
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 14,
              overflow: 'hidden',
              background: 'linear-gradient(#23272C,#15181C)',
              boxShadow: '0 10px 24px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px 10px' }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', color: '#8A929B' }}>CALENDAR</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: '#B4BBC2' }}>
                Open schedule
                <Chevron colour="#B4BBC2" />
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid rgba(255,255,255,.08)' }}>
              {[0, 1].map((offset) => {
                const rows = calRows(offset === 0 ? data.today : data.tomorrow)
                return (
                  <span
                    key={offset}
                    style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '11px 15px 13px', borderLeft: `1px solid ${offset === 0 ? 'transparent' : 'rgba(255,255,255,.08)'}` }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.11em', color: offset === 0 ? '#FFFFFF' : '#8A929B' }}>
                        {offset === 0 ? 'TODAY' : 'TOMORROW'}
                      </span>
                      <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: '-.01em', color: '#fff' }}>{calDate(offset)}</span>
                    </span>
                    {rows.slice(0, 2).map((r) => (
                      <span key={r.name} style={{ display: 'flex', alignItems: 'stretch', gap: 9 }}>
                        <span style={{ flex: 'none', width: 3, borderRadius: 2, background: r.rail }} />
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '1px 0' }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#E7EAEE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                          <span style={{ fontSize: 12.5, color: '#8A929B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.time}</span>
                        </span>
                      </span>
                    ))}
                    {rows.length > 2 && (
                      <span style={{ paddingLeft: 12, fontSize: 12.5, fontWeight: 600, color: '#6D757D' }}>+{rows.length - 2} more</span>
                    )}
                    {rows.length === 0 && <span style={{ paddingLeft: 12, fontSize: 12.5, fontWeight: 600, color: '#6D757D' }}>Nothing booked</span>}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* The two counters. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 18px 0' }}>
          <span
            onClick={() => setWhoOpen(true)}
            style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '13px 14px 14px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: '#7B838B' }}>ON SITE</span>
              <Chevron />
            </span>
            <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.05, color: s.ink }}>{data.onSiteTotal}</span>
          </span>
          <span
            onClick={() => setAttnOpen(true)}
            style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '13px 14px 14px', background: '#fff', border: `1px solid ${attnBd}`, borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: attnFg }}>ATTENTION</span>
              <Chevron colour={attnFg} />
            </span>
            <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.05, color: attnFg }}>{attnN}</span>
          </span>
        </div>

        {/* Today's jobs — ONE card, hairline dividers, 5px rails. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '20px 18px 9px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>TODAY</span>
          <span style={{ fontSize: 12.5, color: '#7B838B' }}>
            {todayList.length} active job{todayList.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ padding: '0 18px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
            {todayList.map((site, i) => {
              const defects = data.openDefects.get(site.id) ?? 0
              const holds = data.floodHold.get(site.id) ?? 0
              const where = [localeOf(site) || site.job_type.split('·')[0].trim(), firstStart.get(site.id)].filter(Boolean).join(' · ')
              return (
                <span
                  key={site.id}
                  onClick={() => onOpenJob(site)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64, padding: '11px 13px 11px 19px', borderTop: `1px solid ${i === 0 ? 'transparent' : '#EDEFF1'}`, cursor: 'pointer' }}
                >
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {site.name}
                    </span>
                    <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</span>
                  </span>
                  {defects > 0 ? (
                    <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#FDECEE', color: '#A3282E' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A3282E' }} />
                      {defects} defect{defects === 1 ? '' : 's'}
                    </span>
                  ) : holds > 0 ? (
                    <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#FDECEE', color: '#A3282E' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A3282E' }} />
                      Needs you
                    </span>
                  ) : null}
                  <Chevron size={11} />
                </span>
              )
            })}
            {todayList.length === 0 && !data.loading && (
              <span style={{ padding: '22px 19px', fontSize: 13, lineHeight: 1.5, color: '#7B838B' }}>
                No active jobs yet — jobs the office adds show up here.
              </span>
            )}
          </div>
        </div>
      </div>

      {whoOpen && (
        <>
          <div onClick={() => setWhoOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(20,23,26,.52)', zIndex: 40 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 41, display: 'flex', flexDirection: 'column', maxHeight: 560, background: '#fff', borderRadius: '18px 18px 34px 34px', boxShadow: '0 -10px 30px rgba(16,20,24,.28)' }}>
            <div style={{ flex: 'none', display: 'flex', justifyContent: 'center', padding: '9px 0 3px' }}>
              <span style={{ width: 36, height: 5, borderRadius: 3, background: '#DCE0E6' }} />
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '8px 20px 14px' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Who is where</span>
                <span style={{ fontSize: 13.5, color: '#7B838B' }}>
                  {data.onSiteTotal} on the clock across {[...data.crewOnSite.keys()].length} site{[...data.crewOnSite.keys()].length === 1 ? '' : 's'}
                </span>
              </span>
              <span onClick={() => setWhoOpen(false)} style={{ flex: 'none', fontSize: 13.5, fontWeight: 600, color: '#5B6169', cursor: 'pointer' }}>Close</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', padding: `0 0 calc(24px + ${SAFE_BOTTOM})` }}>
              {[...data.crewOnSite.entries()]
                .sort((a, b) => (a[1][0].since < b[1][0].since ? -1 : 1))
                .map(([siteId, crew]) => {
                const site = byId.get(siteId)
                if (!site) return null
                const who = `${crew.map((c) => c.name.split(' ')[0]).join(', ')} · ${clockTime(crew[0].since)}`
                return (
                  <span
                    key={siteId}
                    onClick={() => { setWhoOpen(false); onOpenJob(site, 'crew') }}
                    style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, minHeight: 70, padding: '12px 18px 12px 24px', borderTop: '1px solid #EDEFF1', cursor: 'pointer' }}
                  >
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                      <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
                    </span>
                    <span style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
                      {crew.slice(0, 4).map((c, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, marginRight: -7, borderRadius: '50%', border: '2px solid #fff', background: avatarGrey(i), color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
                          {c.initials}
                        </span>
                      ))}
                    </span>
                    <Chevron size={11} />
                  </span>
                )
              })}
              {data.crewOnSite.size === 0 && (
                <span style={{ padding: '18px 24px', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
                  Nobody is on the clock right now. The geofence clocks people on as they
                  arrive, and they show up here the moment it happens.
                </span>
              )}
              <span
                onClick={() => { setWhoOpen(false); onOpenClock() }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '14px 18px 0', padding: '13px 15px', border: '1px solid #E1E5E9', borderRadius: 12, cursor: 'pointer' }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: s.ink }}>Your tracking</span>
                <Chevron size={11} />
              </span>
            </div>
          </div>
        </>
      )}

      {attnOpen && (
        <>
          <div onClick={() => setAttnOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(20,23,26,.52)', zIndex: 40 }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 41, display: 'flex', flexDirection: 'column', maxHeight: 640, background: '#F5F6F7', borderRadius: '18px 18px 34px 34px', boxShadow: '0 -10px 30px rgba(16,20,24,.28)', overflow: 'hidden' }}>
            <div style={{ flex: 'none', display: 'flex', justifyContent: 'center', padding: '9px 0 3px', background: '#fff' }}>
              <span style={{ width: 36, height: 5, borderRadius: 3, background: '#DCE0E6' }} />
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '8px 20px 14px', background: '#fff' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Active jobs</span>
                <span style={{ fontSize: 13.5, color: '#7B838B' }}>
                  {needs.length} of {data.sites.length} active job{data.sites.length === 1 ? '' : 's'} need{needs.length === 1 ? 's' : ''} you
                </span>
              </span>
              <span onClick={() => setAttnOpen(false)} style={{ flex: 'none', fontSize: 13.5, fontWeight: 600, color: '#5B6169', cursor: 'pointer' }}>Close</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', padding: `0 0 calc(24px + ${SAFE_BOTTOM})` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 20px 11px', background: '#14171A' }}>
                <span style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: '#E5484D' }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.13em', color: '#fff' }}>NEEDS YOU</span>
              </span>
              {needs.map(({ site, chip, tone, tab }) => (
                <span
                  key={site.id}
                  onClick={() => { setAttnOpen(false); onOpenJob(site, tab) }}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 72, padding: '12px 16px 12px 24px', background: '#fff', borderBottom: '1px solid #EDEFF1', cursor: 'pointer' }}
                >
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                    <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[localeOf(site), site.job_type, site.client_name].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: tone === 'r' ? '#FDECEE' : '#FFF6E3', color: tone === 'r' ? '#A3282E' : '#8A6100' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone === 'r' ? '#A3282E' : '#8A6100' }} />
                    {chip}
                  </span>
                  <Chevron size={11} />
                </span>
              ))}
              {calm.length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '15px 20px 10px' }}>
                  <span style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: '#4CC38A' }} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.13em', color: '#7B838B' }}>RUNNING TO PLAN</span>
                </span>
              )}
              {calm.map((site) => {
                const state = stateOf(site)
                return (
                  <span
                    key={site.id}
                    onClick={() => { setAttnOpen(false); onOpenJob(site) }}
                    style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 66, padding: '11px 16px 11px 24px', background: '#fff', borderTop: '1px solid #EDEFF1', cursor: 'pointer' }}
                  >
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: railOf(site) }} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 600, color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                      <span style={{ fontSize: 13, color: '#7B838B' }}>{state}</span>
                    </span>
                    <Chevron size={11} />
                  </span>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
