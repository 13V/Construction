/**
 * Home — a transcription of the Simple design's isHome block, not an
 * approximation of it. Every size, colour, radius and shadow below is lifted
 * from design/mobile/simple/Crewline-Simple.dc.html; where a value looks odd
 * (a 5px rail, a 23px chip, `.14em` tracking) it is because the drawing says
 * so. Deviate here and the app stops being the design.
 */
import type { JobSiteRow, WorkerRow } from '../../data/supabase'
import { jobColour, s } from './stheme'
import type { SimpleData } from './data'

const DAY = 86_400_000

/** "Tue 12 Aug" — dow capitalised, no comma, exactly as the card draws it. */
function calDate(offset: number): string {
  const d = new Date(Date.now() + offset * DAY)
  const dow = d.toLocaleDateString('en-AU', { weekday: 'short' })
  return `${dow} ${d.getDate()} ${d.toLocaleDateString('en-AU', { month: 'short' })}`
}

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

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
  onOpenJob: (site: JobSiteRow) => void
  onOpenSchedule: () => void
  onOpenClock: () => void
  onOpenNotifications: () => void
  onShowAccount: () => void
}) {
  const byId = new Map(data.sites.map((x) => [x.id, x]))
  const firstStart = new Map<string, string>()
  for (const b of data.today) if (!firstStart.has(b.site_id)) firstStart.set(b.site_id, clockTime(b.starts_at))

  const calRows = (list: typeof data.today) => {
    const seen = new Map<string, { name: string; time: string; rail: string }>()
    for (const b of list) {
      const site = byId.get(b.site_id)
      if (!site || seen.has(site.id)) continue
      seen.set(site.id, {
        name: site.name,
        time: `${clockTime(b.starts_at)} – ${clockTime(b.ends_at)}`,
        rail: jobColour(site.id),
      })
    }
    return [...seen.values()]
  }

  const defectTotal = [...data.openDefects.values()].reduce((a, b) => a + b, 0)
  const attnN = defectTotal + data.pendingVariations
  // The drawing's three-state attention colour: nothing → grey, only
  // waiting-on-someone → amber, anything red → the deep red.
  const attnFg = attnN ? (defectTotal ? '#A3282E' : '#8A6100') : '#5B6169'
  const attnBd = attnN ? (defectTotal ? '#F0C9CC' : '#EFD9AE') : '#E1E5E9'

  const active = data.sites.filter((x) => x.status === 'active')

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Header: 52px, white, 21px title, bell with dot, 32px avatar. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 20px', background: '#fff' }}>
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
            onClick={onOpenClock}
            style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '13px 14px 14px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.11em', color: '#7B838B' }}>ON SITE</span>
              <Chevron />
            </span>
            <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.03em', lineHeight: 1.05, color: s.ink }}>{data.onSiteTotal}</span>
          </span>
          <span
            style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '13px 14px 14px', background: '#fff', border: `1px solid ${attnBd}`, borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)' }}
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
            {active.length} active job{active.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ padding: '0 18px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', overflow: 'hidden' }}>
            {active.map((site, i) => {
              const defects = data.openDefects.get(site.id) ?? 0
              const where = [site.address.split(',')[0] || site.job_type, firstStart.get(site.id)].filter(Boolean).join(' · ')
              return (
                <span
                  key={site.id}
                  onClick={() => onOpenJob(site)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64, padding: '11px 13px 11px 19px', borderTop: `1px solid ${i === 0 ? 'transparent' : '#EDEFF1'}`, cursor: 'pointer' }}
                >
                  <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: jobColour(site.id) }} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {site.name}
                    </span>
                    <span style={{ fontSize: 13, color: '#7B838B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where}</span>
                  </span>
                  {defects > 0 && (
                    <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 23, padding: '0 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#FDECEE', color: '#A3282E' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A3282E' }} />
                      {defects} defect{defects === 1 ? '' : 's'}
                    </span>
                  )}
                  <Chevron size={11} />
                </span>
              )
            })}
            {active.length === 0 && !data.loading && (
              <span style={{ padding: '22px 19px', fontSize: 13, lineHeight: 1.5, color: '#7B838B' }}>
                No active jobs yet — jobs the office adds show up here.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
