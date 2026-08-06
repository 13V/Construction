import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, type ChannelRow, type MessageRow, type WorkerRow } from '../data/supabase'
import { BUCKET_FILES, objectPath, signedUrl, uploadFile } from '../data/storage'
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
 *
 * LAYOUT SOURCE: design/screens/isChat.html. That file draws a job-site
 * channel (wide, flat Slack-style rows) and a direct message (a narrower
 * fixed-width bubble thread) as two example frames sitting side by side.
 * Nothing in the schema, in RLS, or in the behaviour this port is told to
 * keep supports two *simultaneously live* conversations — there is one
 * `activeId`, one realtime subscription, one unread map — and both frames
 * use the exact same "Message X" composer placeholder the previous version
 * already keyed off `channel.kind`. So this renders ONE active conversation
 * and picks whichever of the two frames matches its kind, reproducing that
 * frame's spacing/colour/copy exactly. The two frames really do differ on
 * purpose: square per-person-coloured avatars + inline header for channels,
 * a circular fixed-colour avatar + trailing caption bubbles for DMs.
 *
 * A handful of numbers in the mock describe that specific illustrated thread
 * rather than data this component has (an "on site now" headcount, read
 * receipts, "from Sheet A-2", presence dots) — `channel_members` isn't even
 * populated for site channels, membership there is implicit company-wide,
 * and Chat only receives `workers: Worker[]`, not live shift/position state.
 * Those spots show the closest honest real value instead of the mock's copy.
 */

const LAST_READ_PREFIX = 'crewline:chat:lastRead:'
/** Matches the bucket's own file_size_limit (storage.sql) so a too-big file
 *  fails with a plain message here instead of a raw storage error. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i
/** Generic "image not loaded yet" texture, straight out of the design file —
 *  used for both the loading state and any attachment that isn't a photo. */
const HATCH_BG = 'repeating-linear-gradient(135deg,#E4E7EA 0 7px,#DADEE2 7px 14px)'
/** Two greys this screen uses that aren't in the shared theme. */
const CHAT_SOFT = '#8B9096'
const CHAT_FAINT = '#B7BCC2'

/** Deterministic per-person avatar colour for channel rows, echoing the
 *  design's per-message `avBg`/`avFg` bindings — reuses tones already
 *  established elsewhere in the app (Expenses.tsx's confirmed/review colours)
 *  rather than inventing a new palette. */
const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: theme.accentFill, fg: theme.accent },
  { bg: '#EAF7EE', fg: '#1B7A32' },
  { bg: '#FFF6DF', fg: '#8A6100' },
  { bg: '#FCE8EA', fg: theme.alert },
  { bg: '#F1F3F5', fg: theme.railSoft },
  { bg: '#EDEFF1', fg: '#54595F' },
]
function avatarPalette(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!
}

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

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const firstNameOf = (name: string) => name.split(' ')[0] || name
const memberCountLabel = (n: number) => `${n} member${n === 1 ? '' : 's'}`

/** Uploaded objects are named `<uuid>-<original name>` (data/storage.ts
 *  objectPath) — strip the uuid so chat shows the name the sender picked. */
function attachmentBaseName(path: string) {
  const base = path.split('/').pop() ?? path
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')
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
  const [uploading, setUploading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const [unread, setUnread] = useState<Record<string, number>>({})

  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const otherWorkers = useMemo(
    () => workers.filter((w) => w.id !== me.id).sort((a, b) => a.name.localeCompare(b.name)),
    [workers, me.id],
  )

  const peopleById = useMemo(() => {
    const map = new Map<string, { name: string; initials: string; trade: string }>()
    for (const w of workers) map.set(w.id, { name: w.name, initials: w.initials, trade: w.trade })
    map.set(me.id, { name: me.name, initials: me.initials, trade: me.trade })
    return map
  }, [workers, me])

  const sitesById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites])
  // Site channels are readable company-wide (channels_read has no membership
  // check) — channel_members isn't even populated for kind='site' — so the
  // whole roster is the honest "members" count for every job-site channel.
  const companySize = workers.length + 1

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

  const otherPersonId = activeChannel ? otherIdOf(activeChannel) : null
  const otherPerson = otherPersonId ? peopleById.get(otherPersonId) : undefined
  const channelSite = activeChannel?.site_id ? sitesById.get(activeChannel.site_id) : undefined

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

  async function send(attachmentPath?: string) {
    const body = draft.trim()
    if (!activeId || sending) return
    if (!body && !attachmentPath) return
    setSending(true)
    setSendError(null)
    const { error: err } = await supabase().from('messages').insert({
      company_id: me.company_id,
      channel_id: activeId,
      author_id: me.id,
      kind: 'user',
      body,
      attachment_path: attachmentPath ?? null,
    })
    setSending(false)
    if (err) {
      setSendError(err.message)
      return
    }
    setDraft('')
    onChanged()
  }

  /** Composer attach buttons — not in the "keep behaviour" list, but wiring
   *  them for real beats leaving the design's icon buttons dead. Reuses the
   *  same site-files bucket/helpers SiteFiles.tsx already uploads through;
   *  the channel id just takes the place of a site id as the storage folder
   *  key, which the bucket's RLS (company folder only) doesn't care about. */
  async function attach(file: File) {
    if (!activeId || uploading) return
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setSendError('That file is too large — 25 MB max.')
      return
    }
    setUploading(true)
    setSendError(null)
    try {
      const path = objectPath(me.company_id, activeId, file.name)
      await uploadFile(BUCKET_FILES, path, file)
      await send(path)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not attach that file.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', overflowX: 'auto' }}>
      {/* Inline styles can't reach ::placeholder — this keeps that one rule
          self-contained here rather than touching a shared stylesheet. */}
      <style>{`.cl-chat-input::placeholder{color:${CHAT_FAINT}}`}</style>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void attach(file)
          e.target.value = ''
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void attach(file)
          e.target.value = ''
        }}
      />

      {/* ---------------------------------------------------------- rail */}
      <div
        style={{
          flex: 'none',
          width: 212,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: theme.panel,
          borderRight: `1px solid ${theme.border}`,
          overflowY: 'auto',
        }}
      >
        {channelsError && (
          <div style={{ padding: '10px 13px 0', fontSize: 11.5, color: theme.alert }}>{channelsError}</div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px 7px' }}>
          <span style={sectionHeaderStyle}>CHANNELS</span>
          <span style={{ fontSize: 14, color: CHAT_SOFT, cursor: 'default' }} title="Job site channels are created automatically">
            +
          </span>
        </div>
        {loadingChannels && <div style={railNoteStyle}>Loading…</div>}
        {!loadingChannels && orderedSiteChannels.length === 0 && <div style={railNoteStyle}>No job sites yet.</div>}
        {orderedSiteChannels.map((c) => (
          <button key={c.id} onClick={() => openChannel(c.id)} style={railButtonStyle(c.id === activeId)}>
            <span style={{ flex: 'none', opacity: 0.55, fontWeight: 600 }}>#</span>
            <span style={railLabelStyle}>{c.name}</span>
            {(unread[c.id] ?? 0) > 0 && <span style={unreadBadgeStyle}>{Math.min(unread[c.id]!, 99)}{unread[c.id]! > 99 ? '+' : ''}</span>}
          </button>
        ))}

        <div style={{ height: 1, background: theme.border, margin: '10px 13px' }} />

        <div style={{ padding: '0 13px 7px' }}>
          <span style={sectionHeaderStyle}>DIRECT MESSAGES</span>
        </div>
        {!loadingChannels && otherWorkers.length === 0 && <div style={railNoteStyle}>No other crew yet.</div>}
        {otherWorkers.map((w) => {
          const existing = dmChannels.find((c) => c.name === dmName(me.id, w.id))
          const count = existing ? unread[existing.id] ?? 0 : 0
          const active = existing ? existing.id === activeId : false
          const disabled = !existing && !me.is_office
          const busy = creatingFor === w.id
          return (
            <button
              key={w.id}
              onClick={() => void openWorkerDM(w)}
              disabled={disabled || busy}
              title={disabled ? 'Only office can start a new conversation' : undefined}
              style={railButtonStyle(active, disabled)}
            >
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: theme.inkFaint }} />
              <span style={railLabelStyle}>{w.name}</span>
              {busy && <span style={{ flex: 'none', fontSize: 11, color: CHAT_FAINT }}>…</span>}
              {!busy && count > 0 && <span style={unreadBadgeStyle}>{Math.min(count, 99)}{count > 99 ? '+' : ''}</span>}
            </button>
          )
        })}
        {createError && <div style={{ padding: '6px 13px 10px', fontSize: 11.5, color: theme.alert }}>{createError}</div>}
      </div>

      {/* ------------------------------------------------------- main pane */}
      {!activeChannel ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', background: theme.appBg }}>
          <div style={{ margin: 'auto', fontSize: 13, color: theme.inkSoft, padding: 20, textAlign: 'center' }}>
            {loadingChannels ? 'Loading…' : 'Select a channel to start chatting.'}
          </div>
        </div>
      ) : activeChannel.kind === 'site' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 440, minHeight: 0, borderRight: `1px solid ${theme.border}` }}>
          <div
            style={{
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 15px',
              background: theme.panel,
              borderBottom: `1px solid ${theme.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>{`# ${activeChannel.name}`}</span>
              <span style={{ fontSize: 12.5, color: CHAT_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {[memberCountLabel(companySize), channelSite?.jobType, channelSite?.address].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div style={{ flex: 'none', display: 'flex', gap: 6 }}>
              <button style={headerBtnStyle}>Files</button>
              <button style={{ ...headerBtnStyle, whiteSpace: 'nowrap' }}>Members</button>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 15px 6px', display: 'flex', flexDirection: 'column', gap: 2, background: theme.appBg }}>
            {loadingMessages && <div style={mutedNoteStyle}>Loading…</div>}
            {messagesError && <div style={{ ...mutedNoteStyle, color: theme.alert }}>{messagesError}</div>}
            {!loadingMessages && !messagesError && messages.length === 0 && (
              <div style={{ margin: 'auto', fontSize: 13, color: theme.inkSoft, textAlign: 'center', paddingTop: 40 }}>
                {`No messages yet in ${activeChannel.name}. Say hello — clock-ins and expenses will start showing up here too.`}
              </div>
            )}
            {!loadingMessages &&
              !messagesError &&
              messages.map((m) =>
                m.kind === 'system' ? (
                  <SystemRow key={m.id} m={m} />
                ) : (
                  <ChannelMessageRow key={m.id} m={m} person={m.author_id ? peopleById.get(m.author_id) : undefined} />
                ),
              )}
            <div ref={bottomRef} />
          </div>

          <div style={{ flex: 'none', padding: '11px 15px 14px', background: theme.panel, borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 11px', height: 38, border: `1px solid ${theme.border}`, borderRadius: 3 }}>
              <input
                className="cl-chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={`Message #${activeChannel.name}`}
                style={composerInputStyle(13.5)}
              />
              <button onClick={() => photoInputRef.current?.click()} disabled={uploading} style={iconBtnStyle} aria-label="Attach a photo" title="Attach a photo">
                <CameraIcon size={16} />
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={iconBtnStyle} aria-label="Attach a file" title="Attach a file">
                <PaperclipIcon size={16} />
              </button>
            </div>
          </div>
          {sendError && <div style={errorLineStyle}>{sendError}</div>}
        </div>
      ) : (
        <div style={{ flex: 'none', width: 352, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: theme.panel }}>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${theme.border}` }}>
            <span
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: theme.railSoft,
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {otherPerson?.initials ?? '??'}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{otherPerson?.name ?? 'Direct message'}</span>
              <span style={{ fontSize: 11.5, color: CHAT_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {otherPerson?.trade ?? ''}
              </span>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            {loadingMessages && <div style={mutedNoteStyle}>Loading…</div>}
            {messagesError && <div style={{ ...mutedNoteStyle, color: theme.alert }}>{messagesError}</div>}
            {!loadingMessages && !messagesError && messages.length === 0 && (
              <div style={{ margin: 'auto', fontSize: 13, color: theme.inkSoft, textAlign: 'center', paddingTop: 40 }}>
                {`You haven't messaged ${otherPerson?.name ?? 'them'} yet. Say hello.`}
              </div>
            )}
            {!loadingMessages &&
              !messagesError &&
              messages.map((m) =>
                m.kind === 'system' ? (
                  <SystemRow key={m.id} m={m} />
                ) : (
                  <DmBubbleRow
                    key={m.id}
                    m={m}
                    outgoing={m.author_id === me.id}
                    authorName={(m.author_id ? peopleById.get(m.author_id)?.name : undefined) ?? 'Unknown'}
                  />
                ),
              )}
            <div ref={bottomRef} />
          </div>

          <div style={{ flex: 'none', padding: '11px 14px 14px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 11px', height: 36, border: `1px solid ${theme.border}`, borderRadius: 3 }}>
              <input
                className="cl-chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={`Message ${firstNameOf(otherPerson?.name ?? 'them')}`}
                style={composerInputStyle(13)}
              />
              <button onClick={() => photoInputRef.current?.click()} disabled={uploading} style={iconBtnStyle} aria-label="Attach a photo" title="Attach a photo">
                <CameraIcon size={15} />
              </button>
            </div>
          </div>
          {sendError && <div style={errorLineStyle}>{sendError}</div>}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ rows

function SystemRow({ m }: { m: MessageRow }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: '#EDEFF1' }}>
        <ClockIcon />
      </span>
      <span style={{ flex: 1, fontSize: 12.5, color: CHAT_SOFT, fontStyle: 'italic' }}>{m.body}</span>
      <span style={{ flex: 'none', fontSize: 11.5, color: CHAT_FAINT }}>{formatTime(m.created_at)}</span>
    </div>
  )
}

function ChannelMessageRow({ m, person }: { m: MessageRow; person?: { name: string; initials: string; trade: string } }) {
  const palette = avatarPalette(m.author_id ?? m.id)
  return (
    <div style={{ display: 'flex', gap: 11, padding: '8px 0' }}>
      <span
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 4,
          fontSize: 10.5,
          fontWeight: 700,
          background: palette.bg,
          color: palette.fg,
        }}
      >
        {person?.initials ?? '??'}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{person?.name ?? 'Unknown'}</span>
          <span style={{ fontSize: 11.5, color: CHAT_SOFT }}>{person?.trade ?? ''}</span>
          <span style={{ fontSize: 11.5, color: CHAT_FAINT }}>{formatTime(m.created_at)}</span>
        </span>
        {m.body && <span style={{ fontSize: 13.5, lineHeight: 1.5, color: theme.ink, whiteSpace: 'pre-wrap' }}>{m.body}</span>}
        {m.attachment_path && <AttachmentBlock path={m.attachment_path} size={{ w: 130, h: 132, radius: 4 }} alignSelf="flex-start" />}
      </div>
    </div>
  )
}

function DmBubbleRow({ m, outgoing, authorName }: { m: MessageRow; outgoing: boolean; authorName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: outgoing ? 'flex-end' : 'flex-start' }}>
      {m.body && (
        <div
          style={{
            maxWidth: '88%',
            padding: '9px 12px',
            borderRadius: outgoing ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
            background: outgoing ? theme.accent : '#F1F3F5',
            color: outgoing ? '#fff' : theme.ink,
          }}
        >
          <span style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{m.body}</span>
        </div>
      )}
      {m.attachment_path && <AttachmentBlock path={m.attachment_path} size={{ w: 186, h: 126, radius: 6 }} />}
      <span style={{ fontSize: 11, color: CHAT_SOFT }}>{`${authorName} · ${formatTime(m.created_at)}`}</span>
    </div>
  )
}

interface TileSize {
  w: number
  h: number
  radius: number
}

/** Renders a message attachment as a photo tile or a file chip, matching
 *  whichever the design's two plain (non-illustrative) examples used —
 *  MessageRow only carries a path, so the photo/file split is inferred from
 *  the extension rather than a stored mime type. */
function AttachmentBlock({ path, size, alignSelf }: { path: string; size: TileSize; alignSelf?: 'flex-start' }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void signedUrl(BUCKET_FILES, path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const name = attachmentBaseName(path)

  if (IMAGE_EXT_RE.test(path)) {
    return (
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'block',
          width: size.w,
          height: size.h,
          borderRadius: size.radius,
          border: `1px solid ${theme.border}`,
          overflow: 'hidden',
          background: HATCH_BG,
          alignSelf,
        }}
      >
        {url && <img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </a>
    )
  }

  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'FILE'
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignSelf,
        alignItems: 'center',
        gap: 9,
        padding: '8px 11px',
        border: `1px solid ${theme.border}`,
        borderRadius: 4,
        background: theme.panel,
        color: theme.ink,
        textDecoration: 'none',
      }}
    >
      <FileIcon />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 11, color: CHAT_SOFT }}>{ext}</span>
      </span>
    </a>
  )
}

// ----------------------------------------------------------------- icons

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth={1.5}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 5.4V8l1.9 1.2" strokeLinecap="round" />
    </svg>
  )
}

function CameraIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth={1.4} style={{ flex: 'none' }}>
      <path d="M2 5.6h2.6L6 3.8h4l1.4 1.8H14v7.6H2z" strokeLinejoin="round" />
      <circle cx="8" cy="9.2" r="2.4" />
    </svg>
  )
}

function PaperclipIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#8B9096" strokeWidth={1.4} style={{ flex: 'none' }}>
      <path d="M9.4 3.2L5 7.6a2.6 2.6 0 003.6 3.6l4.4-4.4a4.2 4.2 0 00-6-6L2.6 5.2" strokeLinecap="round" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke={theme.alert} strokeWidth={1.3} style={{ flex: 'none' }}>
      <path d="M3.6 1.6h6l3 3v9.8H3.6z" strokeLinejoin="round" />
      <path d="M9.6 1.6v3h3" strokeLinejoin="round" />
    </svg>
  )
}

// ----------------------------------------------------------------- styles

const sectionHeaderStyle = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '.1em',
  color: CHAT_SOFT,
} as const

const railLabelStyle = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

const railNoteStyle = {
  padding: '4px 13px 10px',
  fontSize: 12,
  color: CHAT_SOFT,
} as const

const unreadBadgeStyle = {
  flex: 'none',
  minWidth: 17,
  height: 17,
  padding: '0 5px',
  borderRadius: 9,
  background: theme.alert,
  color: '#fff',
  fontSize: 9.5,
  fontWeight: 700,
  lineHeight: '17px',
  textAlign: 'center',
} as const

function railButtonStyle(active: boolean, disabled?: boolean) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 29,
    padding: '0 13px',
    border: 0,
    cursor: disabled ? 'default' : 'pointer',
    font: 'inherit',
    fontSize: 13,
    textAlign: 'left',
    background: active ? theme.accentFill : 'transparent',
    color: active ? theme.accent : theme.ink,
    fontWeight: active ? 600 : 500,
    opacity: disabled ? 0.5 : 1,
  } as const
}

const headerBtnStyle = {
  height: 27,
  padding: '0 10px',
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
} as const

const iconBtnStyle = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
} as const

function composerInputStyle(fontSize: number) {
  return {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    font: 'inherit',
    fontSize,
    color: theme.ink,
  } as const
}

const mutedNoteStyle = {
  fontSize: 12.5,
  color: theme.inkSoft,
} as const

const errorLineStyle = {
  flex: 'none',
  padding: '0 15px 10px',
  fontSize: 11.5,
  color: theme.alert,
} as const
