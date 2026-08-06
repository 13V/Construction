import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type ChannelRow, type MessageRow, type WorkerRow } from '../data/supabase'
import { theme } from '../theme'
import type { JobSite, Worker } from '../types'

/**
 * One channel per job site (created by the `job_sites_channel` trigger) plus
 * ad-hoc DMs. DM channels are named `dm:<id>:<id>` with the two worker ids
 * sorted, so the same pair always resolves to the same row instead of a new
 * one every time someone clicks — that's the whole "lazily creates" trick.
 *
 * Starting a *new* DM writes to `channels`/`channel_members`, both of which
 * RLS restricts to office users (see schema_v2.sql). Field crew can read and
 * message in any channel they already belong to — messages_field_insert only
 * checks authorship — so we let them open existing DMs freely but grey out
 * starting one with someone they haven't talked to yet, rather than hand them
 * a button that fails with a raw policy error every time.
 */

const GROUP_WINDOW_MS = 5 * 60_000
const LAST_READ_PREFIX = 'crewline:chat:lastRead:'

const dmName = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`

function loadLastRead(workerId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_PREFIX + workerId) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
function saveLastRead(workerId: string, map: Record<string, string>) {
  try {
    localStorage.setItem(LAST_READ_PREFIX + workerId, JSON.stringify(map))
  } catch {
    // storage unavailable (private browsing, quota) — unread badges just won't persist
  }
}

interface Group {
  key: string
  kind: 'user' | 'system'
  authorId: string | null
  items: MessageRow[]
}

export function Chat({ me, sites, workers, onChanged }: {
  me: WorkerRow
  sites: JobSite[]
  workers: Worker[]
  onChanged: () => void
}) {
  const [siteChannels, setSiteChannels] = useState<ChannelRow[]>([])
  const [dmChannels, setDmChannels] = useState<ChannelRow[]>([])
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [channelsError, setChannelsError] = useState<string | null>(null)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const [unread, setUnread] = useState<Record<string, number>>({})

  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const bottomRef = useRef<HTMLDivElement | null>(null)

  const otherWorkers = useMemo(
    () => workers.filter((w) => w.id !== me.id).sort((a, b) => a.name.localeCompare(b.name)),
    [workers, me.id],
  )

  const peopleById = useMemo(() => {
    const map = new Map<string, { name: string; initials: string }>()
    for (const w of workers) map.set(w.id, { name: w.name, initials: w.initials })
    map.set(me.id, { name: me.name, initials: me.initials })
    return map
  }, [workers, me])

  // Site channels in job-site order rather than creation order, so the rail
  // matches the order everyone already knows from the Job Sites screen.
  const orderedSiteChannels = useMemo(() => {
    const bySite = new Map(siteChannels.map((c) => [c.site_id, c]))
    const ordered = sites
      .map((s) => bySite.get(s.id))
      .filter((c): c is ChannelRow => Boolean(c))
    const seen = new Set(ordered.map((c) => c.id))
    return [...ordered, ...siteChannels.filter((c) => !seen.has(c.id))]
  }, [siteChannels, sites])

  function markRead(channelId: string, at: string) {
    const current = loadLastRead(me.id)
    if (!current[channelId] || current[channelId]! < at) {
      saveLastRead(me.id, { ...current, [channelId]: at })
    }
    setUnread((prev) => (prev[channelId] ? { ...prev, [channelId]: 0 } : prev))
  }

  async function refreshUnread(channelIds: string[], read: Record<string, string>) {
    if (channelIds.length === 0) return
    const client = supabase()
    const results = await Promise.all(
      channelIds.map(async (id) => {
        const since = read[id] ?? '1970-01-01T00:00:00Z'
        const { count } = await client
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', id)
          .gt('created_at', since)
        return [id, count ?? 0] as const
      }),
    )
    setUnread((prev) => ({ ...prev, ...Object.fromEntries(results) }))
  }

  // ------------------------------------------------------------- channel list

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingChannels(true)
      setChannelsError(null)
      const { data, error: err } = await supabase()
        .from('channels')
        .select('*')
        .eq('company_id', me.company_id)
        .in('kind', ['site', 'dm'])
      if (cancelled) return
      if (err) {
        setChannelsError(err.message)
        setLoadingChannels(false)
        return
      }
      const rows = (data ?? []) as ChannelRow[]
      const sitesFound = rows.filter((r) => r.kind === 'site')
      // channels_read is company-wide, not membership-scoped — filter DMs down
      // to ones whose deterministic name actually includes me.
      const dmsFound = rows.filter((r) => r.kind === 'dm' && r.name.split(':').includes(me.id))
      setSiteChannels(sitesFound)
      setDmChannels(dmsFound)
      setLoadingChannels(false)
      setActiveId((prev) => prev ?? sitesFound[0]?.id ?? dmsFound[0]?.id ?? null)
      void refreshUnread([...sitesFound, ...dmsFound].map((c) => c.id), loadLastRead(me.id))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [me.company_id, me.id])

  const activeChannel = useMemo(
    () => [...siteChannels, ...dmChannels].find((c) => c.id === activeId) ?? null,
    [siteChannels, dmChannels, activeId],
  )

  function otherIdOf(channel: ChannelRow): string | null {
    if (channel.kind !== 'dm') return null
    return channel.name.split(':').find((p) => p !== 'dm' && p !== me.id) ?? null
  }

  // -------------------------------------------------------------- messages

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let cancelled = false
    async function load() {
      setLoadingMessages(true)
      setMessagesError(null)
      const { data, error: err } = await supabase()
        .from('messages')
        .select('*')
        .eq('channel_id', activeId)
        .order('created_at', { ascending: true })
        .limit(300)
      if (cancelled) return
      if (err) {
        setMessagesError(err.message)
        setLoadingMessages(false)
        return
      }
      setMessages((data ?? []) as MessageRow[])
      setLoadingMessages(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeId])

  // Scoped to the open channel so switching threads never leaves a stale
  // subscription appending messages into the wrong panel.
  useEffect(() => {
    if (!activeId) return
    const id = activeId
    const client = supabase()
    const ch = client
      .channel(`messages-channel-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` },
        (payload) => {
          const row = payload.new as MessageRow
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
          markRead(id, row.created_at)
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Company-wide, mounted once, purely to keep rail badges live for channels
  // that aren't the one currently open.
  useEffect(() => {
    const client = supabase()
    const ch = client
      .channel(`messages-company-${me.company_id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `company_id=eq.${me.company_id}` },
        (payload) => {
          const row = payload.new as MessageRow
          if (row.channel_id === activeIdRef.current) return
          setUnread((prev) => ({ ...prev, [row.channel_id]: (prev[row.channel_id] ?? 0) + 1 }))
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
  }, [me.company_id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, activeId])

  function openChannel(id: string) {
    setActiveId(id)
    setSendError(null)
    markRead(id, new Date().toISOString())
  }

  async function openWorkerDM(worker: Worker) {
    const name = dmName(me.id, worker.id)
    const existing = dmChannels.find((c) => c.name === name)
    if (existing) {
      openChannel(existing.id)
      return
    }
    if (!me.is_office) return // RLS would reject this insert — the rail keeps it disabled instead

    setCreatingFor(worker.id)
    setCreateError(null)
    const client = supabase()
    const { data, error: err } = await client
      .from('channels')
      .insert({ company_id: me.company_id, kind: 'dm', site_id: null, name })
      .select()
      .single()
    if (err) {
      setCreatingFor(null)
      setCreateError(err.message)
      return
    }
    const channel = data as ChannelRow
    const { error: memberErr } = await client.from('channel_members').insert([
      { channel_id: channel.id, worker_id: me.id },
      { channel_id: channel.id, worker_id: worker.id },
    ])
    setCreatingFor(null)
    if (memberErr) setCreateError(memberErr.message)
    setDmChannels((prev) => [...prev, channel])
    openChannel(channel.id)
    onChanged()
  }

  async function send() {
    const body = draft.trim()
    if (!body || !activeId || sending) return
    setSending(true)
    setSendError(null)
    const { error: err } = await supabase().from('messages').insert({
      company_id: me.company_id,
      channel_id: activeId,
      author_id: me.id,
      kind: 'user',
      body,
    })
    setSending(false)
    if (err) {
      setSendError(err.message)
      return
    }
    setDraft('')
    onChanged()
  }

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    for (const m of messages) {
      const last = out[out.length - 1]
      const lastItem = last?.items[last.items.length - 1]
      const sameAuthor = last && m.kind === 'user' && last.kind === 'user' && last.authorId === m.author_id
      const withinWindow =
        lastItem && new Date(m.created_at).getTime() - new Date(lastItem.created_at).getTime() <= GROUP_WINDOW_MS
      if (sameAuthor && withinWindow) {
        last.items.push(m)
      } else {
        out.push({ key: m.id, kind: m.kind, authorId: m.author_id, items: [m] })
      }
    }
    return out
  }, [messages])

  const headerTitle = activeChannel
    ? activeChannel.kind === 'site'
      ? activeChannel.name
      : (peopleById.get(otherIdOf(activeChannel) ?? '')?.name ?? 'Direct message')
    : null
  const headerSubtitle = activeChannel?.kind === 'site' ? 'Job site channel' : 'Direct message'

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: theme.appBg }}>
      <div style={{ padding: 16, maxWidth: 1100, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: 'none' }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Chat</h1>
        </div>

        {channelsError && (
          <div style={{ margin: '10px 0', fontSize: 12.5, color: theme.alert, flex: 'none' }}>{channelsError}</div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            marginTop: 12,
            display: 'flex',
            background: theme.panel,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <div style={{ width: 230, minWidth: 230, borderRight: `1px solid ${theme.border}`, overflowY: 'auto' }}>
            <div style={sectionHeader}>Job sites</div>
            {loadingChannels && <div style={placeholder}>Loading…</div>}
            {!loadingChannels && orderedSiteChannels.length === 0 && (
              <div style={placeholder}>No job sites yet.</div>
            )}
            {orderedSiteChannels.map((c) => (
              <RailItem
                key={c.id}
                label={c.name}
                active={c.id === activeId}
                unread={unread[c.id] ?? 0}
                onClick={() => openChannel(c.id)}
              />
            ))}

            <div style={sectionHeader}>Direct messages</div>
            {!loadingChannels && otherWorkers.length === 0 && (
              <div style={placeholder}>No other crew yet.</div>
            )}
            {otherWorkers.map((w) => {
              const existing = dmChannels.find((c) => c.name === dmName(me.id, w.id))
              const count = existing ? unread[existing.id] ?? 0 : 0
              const active = existing ? existing.id === activeId : false
              const disabled = !existing && !me.is_office
              return (
                <RailItem
                  key={w.id}
                  label={w.name}
                  sublabel={w.trade}
                  active={active}
                  unread={count}
                  busy={creatingFor === w.id}
                  disabled={disabled}
                  title={disabled ? 'Only office can start a new conversation' : undefined}
                  onClick={() => void openWorkerDM(w)}
                />
              )
            })}
            {createError && <div style={{ padding: '8px 14px', fontSize: 11.5, color: theme.alert }}>{createError}</div>}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {!activeChannel ? (
              <div style={{ margin: 'auto', fontSize: 13, color: theme.inkSoft, padding: 20, textAlign: 'center' }}>
                {loadingChannels ? 'Loading…' : 'Select a channel to start chatting.'}
              </div>
            ) : (
              <>
                <div style={{ flex: 'none', padding: '11px 16px', borderBottom: `1px solid ${theme.border}` }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{headerTitle}</div>
                  <div style={{ fontSize: 11, color: theme.inkFaint }}>{headerSubtitle}</div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>
                  {loadingMessages && <div style={{ fontSize: 12.5, color: theme.inkSoft }}>Loading…</div>}
                  {messagesError && <div style={{ fontSize: 12.5, color: theme.alert }}>{messagesError}</div>}
                  {!loadingMessages && !messagesError && groups.length === 0 && (
                    <div style={{ margin: 'auto', fontSize: 13, color: theme.inkSoft, textAlign: 'center', paddingTop: 40 }}>
                      {activeChannel.kind === 'site'
                        ? `No messages yet in ${activeChannel.name}. Say hello — clock-ins and expenses will start showing up here too.`
                        : `You haven't messaged ${headerTitle} yet. Say hello.`}
                    </div>
                  )}
                  {groups.map((g) => (
                    <MessageGroup key={g.key} group={g} person={g.authorId ? peopleById.get(g.authorId) : undefined} />
                  ))}
                  <div ref={bottomRef} />
                </div>

                <div style={{ flex: 'none', borderTop: `1px solid ${theme.border}`, padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    placeholder={`Message ${headerTitle}`}
                    rows={1}
                    style={composerInput}
                  />
                  <button onClick={() => void send()} disabled={sending || !draft.trim()} style={cta}>
                    {sending ? 'SENDING…' : 'SEND'}
                  </button>
                </div>
                {sendError && (
                  <div style={{ flex: 'none', padding: '0 12px 10px', fontSize: 11.5, color: theme.alert }}>{sendError}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageGroup({ group, person }: { group: Group; person?: { name: string; initials: string } }) {
  if (group.kind === 'system') {
    const m = group.items[0]!
    return (
      <div style={{ textAlign: 'center', margin: '10px 0' }}>
        <span style={{ fontSize: 11.5, color: theme.inkFaint }}>
          {m.body} · {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
    )
  }
  const first = group.items[0]!
  return (
    <div style={{ display: 'flex', gap: 10, margin: '14px 0 2px' }}>
      <div style={avatar}>{person?.initials ?? '??'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{person?.name ?? 'Unknown'}</span>
          <span style={{ fontSize: 11, color: theme.inkFaint }}>
            {new Date(first.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        {group.items.map((m) => (
          <div key={m.id} style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 2 }}>
            {m.body}
          </div>
        ))}
      </div>
    </div>
  )
}

function RailItem({
  label,
  sublabel,
  active,
  unread,
  disabled,
  busy,
  title,
  onClick,
}: {
  label: string
  sublabel?: string
  active: boolean
  unread: number
  disabled?: boolean
  busy?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '8px 14px',
        border: 'none',
        borderLeft: `3px solid ${active ? theme.accent : 'transparent'}`,
        background: active ? theme.accentFill : 'transparent',
        font: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: active ? 600 : 500,
            color: theme.ink,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        {sublabel && <div style={{ fontSize: 11, color: theme.inkFaint }}>{sublabel}</div>}
      </span>
      {busy && <span style={{ fontSize: 10, color: theme.inkFaint }}>…</span>}
      {!busy && unread > 0 && (
        <span
          style={{
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: theme.accent,
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

const sectionHeader = {
  padding: '14px 14px 6px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.09em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

const placeholder = {
  padding: '4px 14px 10px',
  fontSize: 12,
  color: theme.inkSoft,
}

const avatar = {
  flex: 'none',
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: theme.accentFill,
  color: theme.accent,
  fontSize: 11,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const

const composerInput = {
  flex: 1,
  resize: 'none' as const,
  maxHeight: 120,
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${theme.border}`,
  font: 'inherit',
  fontSize: 13.5,
  color: theme.ink,
  background: theme.appBg,
}

const cta = {
  padding: '8px 14px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
} as const
