/**
 * Chat — every job's channel plus this worker's direct messages. Job
 * channels are transcribed from the drawing's isChat block; DMs are this
 * screen's own addition, since the drawing predates them (schema_v2 added
 * `channels.kind = 'dm'` after the mock was drawn). The dark NEEDS A REPLY
 * card holds whichever channels' last word was someone else's, job or
 * person; the white list is everything caught up. There is no read-receipt
 * table, so "needs a reply" is derived from the one honest signal the
 * messages carry: who spoke last — the same signal useUnreadCount below
 * rolls up into a channel count for the tab bar.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, type JobSiteRow, type WorkerRow } from '../../data/supabase'
import { avatarGrey, railOf, s, SAFE_BOTTOM, SAFE_TOP } from './stheme'
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

/** A DM channel is found or created under this name, the two ids sorted so
 *  the pair always resolves to the same row — same trick, same schema, as
 *  ui/Chat.tsx's dmName. */
const dmName = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`

const otherIdOf = (channelName: string, meId: string): string | null =>
  channelName.split(':').find((p) => p !== 'dm' && p !== meId) ?? null

/** A stable colour per person, hashed the same way stheme's jobColour hashes
 *  a site id. Cycles the app's avatar greys rather than a job's rail
 *  palette — a person should never read as a job on this screen. */
function personTone(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return avatarGrey(h)
}

function dayLabel(d: Date): string {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

const closeGlyph = (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#4A5057" strokeWidth="2" strokeLinecap="round">
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
)
const chevron = (
  <svg width="11" height="11" viewBox="0 0 10 10" style={{ flex: 'none' }}>
    <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="#B7BCC2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

interface CrewPerson {
  id: string
  name: string
  initials: string
  trade: string
}

interface ChatChannel {
  id: string
  kind: 'site' | 'dm'
  site_id: string | null
  name: string
}

interface ChatMessage {
  id: string
  channel_id: string
  author_id: string | null
  kind: 'user' | 'system'
  body: string
  created_at: string
}

interface ChannelSummaryBase {
  id: string
  title: string
  preview: string
  time: string
  at: string
  waiting: number
}
type ChannelSummary = (ChannelSummaryBase & { kind: 'site'; site: JobSiteRow }) | (ChannelSummaryBase & { kind: 'dm'; personId: string })

/**
 * Shared by the inbox below and by useUnreadCount, which the tab bar mounts
 * once for the whole session — "even while the Chat tab itself is
 * unmounted", per WorkerApp.tsx — so this fetches and subscribes on its own
 * rather than trusting a screen that might not be open. A channel or a
 * message can land at any point in that session, so a one-shot fetch would
 * go stale the moment it did; the realtime half exists only to keep both
 * that badge and this list honest without a read-receipt table to poll.
 */
function useChannelWaiting(me: WorkerRow) {
  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const subId = useId().replace(/:/g, '')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const client = supabase()
    void Promise.all([
      client.from('channels').select('id, kind, site_id, name').in('kind', ['site', 'dm']),
      client.from('messages').select('id, channel_id, author_id, kind, body, created_at').eq('kind', 'user').order('created_at', { ascending: false }).limit(400),
    ]).then(([ch, ms]) => {
      if (cancelled) return
      const rows = (ch.data as ChatChannel[]) ?? []
      // channels_read has no membership check — a DM row is visible
      // company-wide — so "mine" is decided here, off the name the channel
      // was created under, the same way ui/Chat.tsx decides it.
      setChannels(rows.filter((c) => c.kind === 'site' || c.name.split(':').includes(me.id)))
      setMessages((ms.data as ChatMessage[]) ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [me.id, nonce])

  useEffect(() => {
    const client = supabase()
    const ch = client
      .channel(`chat-live-${subId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `company_id=eq.${me.company_id}` },
        (payload) => {
          const row = payload.new as ChatMessage
          if (row.kind !== 'user') return
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [row, ...prev]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channels', filter: `company_id=eq.${me.company_id}` },
        (payload) => {
          const row = payload.new as ChatChannel
          if (row.kind !== 'site' && !row.name.split(':').includes(me.id)) return
          setChannels((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]))
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
  }, [subId, me.id, me.company_id])

  const perChannel = useMemo(() => {
    const ids = new Set(channels.map((c) => c.id))
    const map = new Map<string, ChatMessage[]>()
    for (const m of messages) {
      if (!ids.has(m.channel_id)) continue
      map.set(m.channel_id, [...(map.get(m.channel_id) ?? []), m])
    }
    return map
  }, [channels, messages])

  const waiting = useMemo(() => {
    // Messages are newest-first: the run of someone else's messages since
    // the viewer last spoke is what is waiting on them.
    const map = new Map<string, number>()
    for (const [id, list] of perChannel) {
      let n = 0
      for (const m of list) {
        if (m.author_id === me.id) break
        n++
      }
      map.set(id, n)
    }
    return map
  }, [perChannel, me.id])

  return { channels, perChannel, waiting, loading, refresh: useCallback(() => setNonce((n) => n + 1), []) }
}

/** How many channels — job or DM — are waiting on this worker. The tab bar's
 *  badge; lifted out of this screen's own NEEDS A REPLY line so the two
 *  never drift apart into two different answers for "what's unread". */
export function useUnreadCount(me: WorkerRow): number {
  const { waiting } = useChannelWaiting(me)
  return useMemo(() => {
    let n = 0
    for (const v of waiting.values()) if (v > 0) n++
    return n
  }, [waiting])
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
  const { channels, perChannel, waiting, loading, refresh } = useChannelWaiting(me)
  const [people, setPeople] = useState<Map<string, CrewPerson>>(new Map())
  const [composeOpen, setComposeOpen] = useState(false)
  const [dmThread, setDmThread] = useState<{ channelId: string; personId: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabase()
      .from('crew_v')
      .select('id, name, initials, trade')
      .then(({ data: cv }) => {
        if (cancelled) return
        setPeople(new Map(((cv as CrewPerson[]) ?? []).map((w) => [w.id, w])))
      })
    return () => {
      cancelled = true
    }
  }, [me.company_id])

  const siteById = useMemo(() => new Map(data.sites.map((x) => [x.id, x])), [data.sites])

  const dmByPerson = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of channels) {
      if (c.kind !== 'dm') continue
      const other = otherIdOf(c.name, me.id)
      if (other) map.set(other, c.id)
    }
    return map
  }, [channels, me.id])

  const { unreadList, readList } = useMemo(() => {
    const out: ChannelSummary[] = []
    for (const c of channels) {
      const list = perChannel.get(c.id) ?? []
      const w = waiting.get(c.id) ?? 0
      const last = list[0]
      const time = last ? timeLabel(last.created_at) : ''
      const at = last?.created_at ?? ''

      if (c.kind === 'site') {
        // Jobs archived out of data.sites (or not yet loaded) drop out —
        // same rule the old two-pass version applied.
        const site = c.site_id ? siteById.get(c.site_id) : undefined
        if (!site) continue
        const who = !last ? '' : last.author_id === me.id ? 'You' : (last.author_id && people.get(last.author_id)?.name.split(' ')[0]) || 'Crew'
        out.push({ id: c.id, kind: 'site', site, title: site.name, preview: last ? `${who}: ${last.body}` : 'No messages yet', time, at, waiting: w })
      } else {
        const personId = otherIdOf(c.name, me.id)
        if (!personId) continue
        const title = people.get(personId)?.name ?? 'Crew'
        const who = !last ? '' : last.author_id === me.id ? 'You' : title.split(' ')[0] || 'Them'
        out.push({ id: c.id, kind: 'dm', personId, title, preview: last ? `${who}: ${last.body}` : 'No messages yet', time, at, waiting: w })
      }
    }
    out.sort((a, b) => (a.at > b.at ? -1 : 1))
    return {
      unreadList: out.filter((o) => o.waiting > 0),
      readList: out.filter((o) => o.waiting === 0),
    }
  }, [channels, perChannel, waiting, people, siteById, me.id])

  const unreadTotal = unreadList.reduce((a, c) => a + c.waiting, 0)

  // Whoever you can already reach floats to the top of the picker; who is
  // left is only reachable at all if you are office (see ComposeSheet).
  const crewForPicker = useMemo(() => {
    return [...people.values()]
      .filter((w) => w.id !== me.id)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [people, me.id])

  const tile = (site: JobSiteRow, size: number) => (
    <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: 11, background: railOf(site), color: '#fff', fontSize: size > 40 ? 13.5 : 13, fontWeight: 700, letterSpacing: '-.01em' }}>
      {jobInit(site.name)}
    </span>
  )
  const dmTile = (personId: string, initials: string, size: number) => (
    <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%', background: personTone(personId), color: '#fff', fontSize: size > 40 ? 13.5 : 13, fontWeight: 700, letterSpacing: '-.01em' }}>
      {initials}
    </span>
  )
  const avatarFor = (c: ChannelSummary, size: number) =>
    c.kind === 'site' ? tile(c.site, size) : dmTile(c.personId, people.get(c.personId)?.initials ?? '??', size)

  function openRow(c: ChannelSummary) {
    if (c.kind === 'site') onOpenJob(c.site, 'chat')
    else setDmThread({ channelId: c.id, personId: c.personId })
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: `calc(52px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 20px 0`, background: '#fff' }}>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>Chat</span>
        <span onClick={() => setComposeOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, cursor: 'pointer' }}>
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
                  key={c.id}
                  onClick={() => openRow(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 74, padding: '12px 17px', borderTop: '1px solid rgba(255,255,255,.08)', cursor: 'pointer' }}
                >
                  {avatarFor(c, 40)}
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ flex: 1, fontSize: 15.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
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
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', color: '#7B838B' }}>ALL CONVERSATIONS</span>
          <span style={{ fontSize: 12.5, color: '#7B838B' }}>{readList.length} up to date</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', background: '#fff', borderTop: '1px solid #E3E7EB', borderBottom: '1px solid #E3E7EB' }}>
          {readList.map((c) => (
            <div
              key={c.id}
              onClick={() => openRow(c)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 76, padding: '13px 16px', borderBottom: '1px solid #EDEFF1', cursor: 'pointer' }}
            >
              {avatarFor(c, 42)}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: s.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  <span style={{ flex: 'none', fontSize: 12.5, color: '#9AA1A9' }}>{c.time}</span>
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.35, color: '#8B9096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</span>
              </span>
            </div>
          ))}
          {readList.length === 0 && unreadList.length === 0 && !loading && (
            <span style={{ padding: '22px 19px', fontSize: 13.5, lineHeight: 1.5, color: '#7B838B' }}>
              Nothing here yet — every job gets its own channel the moment there is something to
              say, and tapping compose starts a conversation with anyone on the crew.
            </span>
          )}
        </div>

        <span style={{ display: 'block', padding: '14px 20px 20px', fontSize: 13, lineHeight: 1.5, color: '#696D74' }}>
          One chat per job — the job’s own record, which anyone added later reads back through. A
          message to a person is separate, and just as permanent: nothing here lives only in
          someone’s phone.
        </span>
      </div>

      {composeOpen && (
        <ComposeSheet
          me={me}
          crew={crewForPicker}
          dmByPerson={dmByPerson}
          onClose={() => setComposeOpen(false)}
          onOpen={(channelId, personId) => {
            setComposeOpen(false)
            setDmThread({ channelId, personId })
          }}
        />
      )}
      {dmThread && (
        <DmThread
          me={me}
          channelId={dmThread.channelId}
          person={people.get(dmThread.personId) ?? { id: dmThread.personId, name: 'Crew', initials: '??', trade: '' }}
          onClose={() => {
            setDmThread(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/**
 * Everyone on the crew, picked once. channels/channel_members are office-
 * write only (channels_office_write, channel_members_office_write in
 * schema_v2) — field crew message freely once a thread exists but cannot
 * open one, so a row with nobody to reopen sits dim instead of pretending
 * to work. Same split ui/Chat.tsx's rail makes for the same reason; drawn as
 * a sheet instead of a greyed rail button because a phone has no hover to
 * explain itself with, so the explanation runs in a line of copy instead.
 */
function ComposeSheet({
  me,
  crew,
  dmByPerson,
  onOpen,
  onClose,
}: {
  me: WorkerRow
  crew: CrewPerson[]
  dmByPerson: Map<string, string>
  onOpen: (channelId: string, personId: string) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(personId: string) {
    const existing = dmByPerson.get(personId)
    if (existing) {
      onOpen(existing, personId)
      return
    }
    setBusy(personId)
    setError(null)
    const client = supabase()
    const { data, error: err } = await client
      .from('channels')
      .insert({ company_id: me.company_id, kind: 'dm', site_id: null, name: dmName(me.id, personId) })
      .select('id')
      .single()
    if (err) {
      setBusy(null)
      setError(err.message)
      return
    }
    const channelId = (data as { id: string }).id
    const { error: memberErr } = await client.from('channel_members').insert([
      { channel_id: channelId, worker_id: me.id },
      { channel_id: channelId, worker_id: personId },
    ])
    setBusy(null)
    if (memberErr) {
      setError(memberErr.message)
      return
    }
    onOpen(channelId, personId)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', background: 'rgba(16,20,24,.45)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxHeight: '85%', display: 'flex', flexDirection: 'column', background: '#F5F6F7', borderRadius: '16px 16px 0 0', overflow: 'hidden' }}>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 15px 12px 18px', background: '#fff', borderBottom: '1px solid #E1E5E9' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.015em', color: s.ink }}>New message</span>
          <span onClick={onClose} aria-label="Close" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: '#F1F3F5', cursor: 'pointer' }}>
            {closeGlyph}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `2px 0 calc(14px + ${SAFE_BOTTOM})` }}>
          {crew.length === 0 && <span style={{ display: 'block', padding: '16px 18px', fontSize: 13, color: s.muted }}>No other crew yet.</span>}
          {crew.map((w) => {
            const isBusy = busy === w.id
            return (
              <div
                key={w.id}
                onClick={isBusy ? undefined : () => void pick(w.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid #EDEFF1', cursor: 'pointer' }}
              >
                <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: '50%', background: personTone(w.id), color: '#fff', fontSize: 12.5, fontWeight: 700 }}>
                  {w.initials}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: s.ink }}>{w.name}</span>
                  <span style={{ fontSize: 12.5, color: s.muted }}>{w.trade}</span>
                </span>
                {isBusy ? <span style={{ flex: 'none', fontSize: 12, color: s.muted }}>…</span> : chevron}
              </div>
            )
          })}

          {error && (
            <span style={{ display: 'block', margin: '10px 18px 0', padding: '10px 12px', background: s.redFill, borderRadius: 9, fontSize: 13, color: s.red }}>{error}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A DM's own thread. Chat.tsx has no navigation of its own to push a real
 * screen onto — that lives in WorkerApp.tsx, where the one hook wired up for
 * a thread view, ChatScreen, only ever looks a channel up by site_id. So
 * this opens as a full-screen overlay from inside the screen that owns it
 * instead of a pushed screen; nothing behind it is reachable while it's up,
 * which reads the same to whoever's holding the phone.
 */
function DmThread({
  me,
  channelId,
  person,
  onClose,
}: {
  me: WorkerRow
  channelId: string
  person: CrewPerson
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void supabase()
      .from('messages')
      .select('id, channel_id, author_id, kind, body, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(300)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        setMessages((data as ChatMessage[]) ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [channelId])

  useEffect(() => {
    const client = supabase()
    const ch = client
      .channel(`dm-thread-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = payload.new as ChatMessage
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
  }, [channelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    const { data, error: err } = await supabase()
      .from('messages')
      .insert({ company_id: me.company_id, channel_id: channelId, author_id: me.id, kind: 'user', body })
      .select('id, channel_id, author_id, kind, body, created_at')
      .single()
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    const row = data as ChatMessage
    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
    setDraft('')
  }

  const firstName = person.name.split(' ')[0] || 'them'
  const rows: ReactNode[] = []
  let lastDay = ''
  for (const m of messages) {
    const d = new Date(m.created_at)
    const dayKey = d.toDateString()
    if (dayKey !== lastDay) {
      lastDay = dayKey
      rows.push(
        <span key={`day-${dayKey}`} style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 11px', borderRadius: 12, background: '#E5E8EB', fontSize: 12, fontWeight: 600, color: '#5B6169' }}>
          {dayLabel(d)}
        </span>,
      )
    }
    const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    if (m.kind === 'system') {
      rows.push(
        <span key={m.id} style={{ alignSelf: 'center', textAlign: 'center', fontSize: 12, lineHeight: 1.4, color: s.muted, padding: '0 14px' }}>
          {m.body} · {time}
        </span>,
      )
      continue
    }
    const mine = m.author_id === me.id
    rows.push(
      <span key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%' }}>
        <span style={{ padding: '11px 13px', borderRadius: mine ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: mine ? s.charcoal : '#fff', border: `1px solid ${mine ? s.charcoal : s.border}`, color: mine ? '#fff' : s.ink, fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {m.body}
        </span>
        <span style={{ fontSize: 11.5, color: '#9AA1A9', alignSelf: mine ? 'flex-end' : 'flex-start', padding: '0 3px' }}>{time}</span>
      </span>,
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 65, display: 'flex', flexDirection: 'column', background: s.appBg }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: `calc(48px + ${SAFE_TOP})`, padding: `${SAFE_TOP} 10px 0 4px`, background: s.charcoal }}>
        <span onClick={onClose} aria-label="Back" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.2 4.4 6.6 10l5.6 5.6" />
          </svg>
        </span>
        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 11.5, fontWeight: 700 }}>
          {person.initials}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: s.onDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.name}</span>
          <span style={{ fontSize: 12.5, color: s.onDarkMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.trade}</span>
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
        {loading && <span style={{ fontSize: 12.5, color: s.muted, textAlign: 'center' }}>Loading…</span>}
        {!loading && messages.length === 0 && (
          <span style={{ margin: 'auto', fontSize: 13, color: s.muted, textAlign: 'center', padding: '0 30px' }}>{`You haven’t messaged ${firstName} yet. Say hello.`}</span>
        )}
        {rows}
        <div ref={bottomRef} />
      </div>

      {error && <span style={{ flex: 'none', padding: '0 16px 8px', fontSize: 12, color: s.red }}>{error}</span>}

      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: `10px 14px calc(14px + ${SAFE_BOTTOM})`, background: '#fff', borderTop: `1px solid ${s.border}` }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={`Message ${firstName}`}
          style={{ flex: 1, minWidth: 0, height: 44, padding: '0 15px', boxSizing: 'border-box', background: s.appBg, border: `1px solid ${s.border}`, borderRadius: 22, fontFamily: 'inherit', fontSize: 16, color: s.ink, outline: 'none' }}
        />
        <button
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          aria-label="Send"
          style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', border: 'none', background: s.accent, cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.35 : 1 }}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 16V4M4.8 9.2 10 4l5.2 5.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
