/**
 * Schedule — the drawn week strip and day cards, transcribed from
 * design/mobile/simple/Crewline-Simple.dc.html (isSchedule block).
 *
 * The week runs Monday to Sunday, the selected day is a white pill in the
 * charcoal strip, and each booked job is a card: name, time · what, the
 * booked crew's avatars and first names, and the chips and notes the day
 * carries (defects, an overdue flood test). RLS scopes the bookings — the
 * owner reads the whole company's day, a crew member their own.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase, type AssignmentRow, type JobSiteRow } from '../../data/supabase'
import { jobColour, s } from './stheme'
import type { SimpleData } from './data'

const DAY = 86_400_000

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

/** Monday of the week containing `d`, at local midnight. */
const mondayOf = (d: Date) => {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

export function SimpleSchedule({
  data,
  onOpenJob,
}: {
  data: SimpleData
  onOpenJob: (site: JobSiteRow, tab?: 'photos' | 'waterproofing' | 'money' | 'crew') => void
}) {
  const monday = useMemo(() => mondayOf(new Date()), [])
  const todayIx = Math.min(6, Math.max(0, Math.floor((Date.now() - monday.getTime()) / DAY)))
  const [dayIx, setDayIx] = useState(todayIx)
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [roster, setRoster] = useState<Map<string, { name: string; initials: string }>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client
        .from('assignments')
        .select('*')
        .eq('published', true)
        .gte('starts_at', monday.toISOString())
        .lt('starts_at', new Date(monday.getTime() + 7 * DAY).toISOString())
        .order('starts_at'),
      client.from('crew_v').select('id, name, initials'),
    ]).then(([a, cv]) => {
      if (cancelled) return
      setRows((a.data as AssignmentRow[]) ?? [])
      setRoster(new Map(((cv.data as Array<{ id: string; name: string; initials: string }>) ?? []).map((w) => [w.id, w])))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [monday])

  const byId = new Map(data.sites.map((x) => [x.id, x]))

  // The drawn week strip: MON..SUN, past days dimmed, today marked with the
  // accent dot, the selected day a white pill.
  const week = [...Array(7)].map((_, i) => {
    const d = new Date(monday.getTime() + i * DAY)
    return {
      ix: i,
      dow: d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase(),
      num: String(d.getDate()),
      label: d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
      past: i < todayIx,
      today: i === todayIx,
    }
  })

  // Selected day's bookings, grouped per site in booking order.
  const dayRows = useMemo(() => {
    const d0 = monday.getTime() + dayIx * DAY
    const d1 = d0 + DAY
    const bySite = new Map<string, AssignmentRow[]>()
    for (const b of rows) {
      const t = new Date(b.starts_at).getTime()
      if (t < d0 || t >= d1) continue
      bySite.set(b.site_id, [...(bySite.get(b.site_id) ?? []), b])
    }
    return [...bySite.entries()]
  }, [rows, monday, dayIx])

  const people = dayRows.reduce((a, [, list]) => a + list.length, 0)
  const daySub = people > 0 ? `${people} on the clock · ${dayRows.length} site${dayRows.length === 1 ? '' : 's'}` : 'Nothing rostered'
  const sel = week[dayIx]!
  const dayLabel = sel.today ? `Today · ${sel.label}` : sel.label

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Header — 52px, title + inert plus, exactly as drawn. */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 20px', background: '#fff' }}>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Schedule</span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44 }}>
          <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="1.7" strokeLinecap="round">
            <path d="M10 4.5v11M4.5 10h11" />
          </svg>
        </span>
      </div>

      {/* The charcoal week strip. */}
      <div style={{ flex: 'none', padding: '2px 18px 14px', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 2, padding: 7, borderRadius: 14, background: 'linear-gradient(#23272C,#15181C)', boxShadow: '0 8px 20px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset' }}>
          {week.map((d) => {
            const on = d.ix === dayIx
            return (
              <button
                key={d.ix}
                onClick={() => setDayIx(d.ix)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 44, height: 58, padding: 0, border: 0, borderRadius: 10, background: on ? '#FFFFFF' : 'transparent', fontFamily: 'inherit', cursor: 'pointer' }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: on ? 'rgba(26,29,33,.52)' : d.past ? '#5F666E' : '#8A929B' }}>{d.dow}</span>
                <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em', color: on ? '#14171A' : d.past ? '#7E868F' : '#E7EAEE' }}>{d.num}</span>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: d.today ? s.accent : 'transparent' }} />
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#F5F6F7' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '16px 18px 11px' }}>
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>{dayLabel}</span>
          <span style={{ fontSize: 13, color: '#7B838B' }}>{daySub}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px 20px' }}>
          {dayRows.map(([siteId, list]) => {
            const site = byId.get(siteId)
            if (!site) return null
            const first = list[0]!
            const note = first.note ? ` · ${first.note}` : ''
            const time = `${clockTime(first.starts_at)} – ${clockTime(first.ends_at)}${note}`
            const crew = list
              .map((b) => roster.get(b.worker_id))
              .filter((w): w is { name: string; initials: string } => !!w)
            const who = crew.length ? crew.map((w) => w.name.split(' ')[0]).join(', ') : 'Nobody rostered'
            const defects = data.openDefects.get(siteId) ?? 0
            const holds = data.floodHold.get(siteId) ?? 0
            const chip = defects > 0 ? `${defects} defect${defects === 1 ? '' : 's'}` : holds > 0 ? 'Needs you' : ''
            const areas = data.floodAreas.get(siteId) ?? []
            const holdNote =
              holds > 0
                ? `Flood test on ${areas.join(', ') || 'a wet area'} ${areas.length > 1 ? 'are' : 'is'} overdue. Nothing on this job can be claimed until ${areas.length > 1 ? 'they are' : 'it is'} done.`
                : ''
            return (
              <div
                key={siteId}
                onClick={() => onOpenJob(site)}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 15px 14px 19px', background: '#fff', border: '1px solid #E1E5E9', borderRadius: 12, boxShadow: '0 1px 2px rgba(16,20,24,.05)', cursor: 'pointer', overflow: 'hidden' }}
              >
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: jobColour(siteId) }} />
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{site.name}</span>
                    <span style={{ fontSize: 13.5, color: '#7B838B' }}>{time}</span>
                  </span>
                  {chip && (
                    <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700, background: '#FDECEE', color: '#A3282E' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A3282E' }} />
                      {chip}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>
                    {crew.slice(0, 5).map((w, i) => (
                      <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, marginRight: -7, borderRadius: '50%', border: '2px solid #fff', background: s.charcoal, color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
                        {w.initials}
                      </span>
                    ))}
                  </span>
                  <span style={{ flex: 1, paddingLeft: 12, fontSize: 13.5, color: '#4A5057', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
                  <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
                    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {holdNote && (
                  <span style={{ padding: '9px 11px', borderRadius: 8, background: '#FDECEE', fontSize: 13.5, lineHeight: 1.4, color: '#8E2A31' }}>{holdNote}</span>
                )}
              </div>
            )
          })}

          {dayRows.length === 0 && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '52px 24px' }}>
              <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="#B7BCC2" strokeWidth="1.4" strokeLinecap="round">
                <path d="M3.5 4.5h13v13h-13zM3.5 8.5h13M7 2.5v3M13 2.5v3" />
              </svg>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#4A5057' }}>Nobody rostered</span>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: '#7B838B', textAlign: 'center' }}>
                Nothing published for this day. Bookings the office publishes show up here.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
