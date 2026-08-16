/**
 * Chat — one chat per job, transcribed from the drawing's isChat block.
 *
 * The dark NEEDS A REPLY card holds the job channels whose last word was
 * someone else's; the white list is every active job's channel. There is no
 * read-receipt table, so "needs a reply" is derived from the one honest
 * signal the messages carry: who spoke last. The badge is how many messages
 * have landed since you last said anything in that channel.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { railOf, s, SAFE_TOP } from './stheme'
import type { SimpleData } from './data'

/** "Lot 42, Kentish Ave" → "L42"; "Hallett Cove" → "HC" — the drawn tiles. */
const jobInit = (name: string) => {
  const words = name.replace(/,/g, '').split(/\s+/).slice(0, 2)
  return words.map((w) => (/^\d/.test(w) ? w : w[0]?.toUpperCase() ?? '')).join('')
}

const timeLabel = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  const clock = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  if (d.getTime() >= t0.getTime()) return clock
  if (d.getTime() >= t0.getTime() - 86_400_000) return 'Yesterday'
  return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${clock}`
}

interface ChannelSummary {
  site: JobSiteRow
  preview: string
  time: string
  at: string
  waiting: number
}

export function SimpleChat({
  me,
  data,
  onOpenJob,
}: {
  me: WorkerRow
  data: SimpleData
  onOpenJob: (site: JobSiteRow, tab: 'chat') => void
}) {
  const [channels, setChannels] = useState<Array<{ id: string; site_id: string | null }>>([])
  const [messages, setMessages] = useState<Array<{ channel_id: string; author_id: string | null; body: string; created_at: string }>>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const client = supabase()
    void Promise.all([
      client.from('channels').select('id, site_id').eq('kind', 'site'),
      client.from('messages').select('channel_id, author_id, body, created_at').eq('kind', 'user').order('created_at', { ascending: false }).limit(400),
      client.from('crew_v').select('id, name'),
    ]).then(([ch, ms, cv]) => {
      if (cancelled) return
      setChannels((ch.data as Array<{ id: string; site_id: string | null }>) ?? [])
      setMessages((ms.data as Array<{ channel_id: string; author_id: string | null; body: string; created_at: string }>) ?? [])
      setAuthors(new Map(((cv.data as Array<{ id: string; name: string }>) ?? []).map((w) => [w.id, w.name.split(' ')[0] ?? 'Crew'])))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [me.id])

  const { unreadList, readList } = useMemo(() => {
    const bySite = new Map(channels.filter((c) => c.site_id).map((c) => [c.id, c.site_id as string]))
    const perChannel = new Map<string, Array<{ author_id: string | null; body: string; created_at: string }>>()
    for (const m of messages) {
      if (!bySite.has(m.channel_id)) continue
      perChannel.set(m.channel_id, [...(perChannel.get(m.channel_id) ?? []), m])
    }
    const siteById = new Map(data.sites.map((x) => [x.id, x]))
    const out: ChannelSummary[] = []
    for (const [channelId, list] of perChannel) {
      const site = siteById.get(bySite.get(channelId)!)
      if (!site) continue
      const last = list[0]!
      const who = last.author_id === me.id ? 'You' : (last.author_id && authors.get(last.author_id)) || 'Crew'
      // Messages are newest-first: count the run of other people's messages
      // since the viewer last spoke. That run is what is waiting on them.
      let waiting = 0
      for (const m of list) {
        if (m.author_id === me.id) break
        waiting++
      }
      out.push({
        site,
        preview: `${who}: ${last.body}`,
        time: timeLabel(last.created_at),
        at: last.created_at,
        waiting,
      })
    }
    // Jobs with a channel but no words yet still belong in the list.
    const covered = new Set(out.map((o) => o.site.id))
    for (const c of channels) {
      const site = c.site_id ? siteById.get(c.site_id) : undefined
      if (!site || covered.has(site.id)) continue
      out.push({ site, preview: 'No messages yet', time: '', at: '', waiting: 0 })
    }
    out.sort((a, b) => (a.at > b.at ? -1 : 1))
    return {
      unreadList: out.filter((o) => o.waiting > 0),
      readList: out.filter((o) => o.waiting === 0),
    }
  }, [channels, messages, authors, data.sites, me.id])

  const unreadTotal = unreadList.reduce((a, c) => a + c.waiting, 0)

  const tile = (site: JobSiteRow, size: number) => (
    <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: 11, background: railOf(site), color: '#fff', fontSize: size > 40 ? 13.5 : 13, fontWeight: 700, letterSpacing: '-.01em' }}>
      {jobInit(site.name)}
    </span>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: `calc(52px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 20px 0`, background: '#fff' }}>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Chat</span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44 }}>
          <svg width="21" height="21" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5h14v9h-8l-4 3.5v-3.5h-2z" />
            <path d="M10 6.6v4.4M7.8 8.8h4.4" />
          </svg>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#F5F6F7' }}>
        {unreadList.length > 0 && (
          <div style={{ padding: '14px 18px 4px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(#23272C,#15181C)', boxShadow: '0 10px 24px rgba(16,20,24,.20), 0 1px 0 rgba(255,255,255,.06) inset' }}>
              <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 17px 12px' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', color: '#8A929B' }}>NEEDS A REPLY</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#98A0A8' }}>{unreadTotal} message{unreadTotal === 1 ? '' : 's'}</span>
              </span>
              {unreadList.map((c) => (
                <span
                  key={c.site.id}
                  onClick={() => onOpenJob(c.site, 'chat')}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 74, padding: '12px 17px', borderTop: '1px solid rgba(255,255,255,.08)', cursor: 'pointer' }}
                >
                  {tile(c.site, 40)}
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 15.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.site.name}</span>
                      <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: '#98A0A8' }}>{c.time}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.35, color: '#B4BBC2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</span>
                      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: s.accent, color: '#fff', fontSize: 11.5, fontWeight: 700 }}>
                        {c.waiting}
                      </span>
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '18px 18px 9px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>ALL ACTIVE JOBS</span>
          <span style={{ fontSize: 12.5, color: '#7B838B' }}>{readList.length} up to date</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', borderTop: '1px solid #E3E7EB', borderBottom: '1px solid #E3E7EB' }}>
          {readList.map((c) => (
            <div
              key={c.site.id}
              onClick={() => onOpenJob(c.site, 'chat')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 76, padding: '13px 16px', borderBottom: '1px solid #EDEFF1', cursor: 'pointer' }}
            >
              {tile(c.site, 42)}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.site.name}</span>
                  <span style={{ flex: 'none', fontSize: 12.5, color: '#9AA1A9' }}>{c.time}</span>
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.35, color: '#8B9096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</span>
              </span>
            </div>
          ))}
          {readList.length === 0 && unreadList.length === 0 && !loading && (
            <span style={{ padding: '22px 19px', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
              No job chats yet — every job gets its own channel the moment there is something to say.
            </span>
          )}
        </div>

        <span style={{ display: 'block', padding: '14px 20px 20px', fontSize: 13, lineHeight: 1.5, color: '#696D74' }}>
          One chat per job — the job’s own record. Anyone added to the job later reads back
          through it, and nothing lives in someone’s phone.
        </span>
      </div>
    </div>
  )
}
