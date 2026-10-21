/**
 * Chat, read and written exactly as the phone does.
 *
 * The phone's chat is in two files: worker/simple/Chat.tsx (the Chat tab:
 * every job's channel and this person's direct messages, the count on the
 * tab bar, starting a direct message, a direct message's thread) and
 * worker/WorkerApp.tsx (ChatScreen, the thread a job's Chat tab shows). This
 * file is the website's copy of their reads, writes and rules; chat.test.ts
 * runs it beside the phone's own source and fails when the two part.
 *
 * Unread. There is no read-receipt table, and the phone keeps no read state
 * of its own. What it counts is what is waiting on you: in each
 * conversation, the run of other people's messages since you last spoke
 * there ("Needs a reply"), and on the tab bar, how many conversations have
 * one. Opening a thread writes nothing, on either surface; a conversation
 * stops waiting when you answer it. So nothing here marks anything read,
 * and the count on the website's rail is the count on the phone's tab bar.
 *
 * Channels. A job's channel is made by the database when the job is (the
 * job_sites_channel trigger, schema_v2); the phone only ever looks it up by
 * the job, and so does this. A direct message is a 'dm' channel named
 * dm:<id>:<id>, the two ids sorted so a pair always finds the same row, with
 * both people in channel_members. Every channel row is readable company-wide
 * (channels_read has no membership check), so which direct messages are
 * yours is decided by that name, here as on the phone.
 *
 * Photos. A job's thread carries them (messages.attachment_path, a file in
 * site-files under <company>/<channel>/). The phone's direct-message thread
 * shows text only, so the website sends text only there too.
 *
 * Only '../phone' is imported here: the rail, which the website loads first,
 * reads its count through this file.
 */
import { avatarGrey, BUCKET_FILES, objectPath, removeFile, supabase, uploadFile, type MessageRow, type WorkerRow } from '../phone'

export type Db = ReturnType<typeof supabase>
const db = (client?: Db): Db => client ?? supabase()

type Me = Pick<WorkerRow, 'id' | 'company_id'>

export interface ChatChannel {
  id: string
  kind: 'site' | 'dm'
  site_id: string | null
  name: string
}

/** A message as the inbox and the threads read it. */
export type ChatMessage = Pick<MessageRow, 'id' | 'channel_id' | 'author_id' | 'kind' | 'body' | 'created_at'> & {
  attachment_path?: string | null
}

/** A message as a thread reads it: with its author's name, as ChatScreen asks for it. */
export type ThreadMessage = ChatMessage & { workers?: { name: string; initials: string } | null }

/** What the unread count needs of a message: who spoke where, not what they said. */
export type CountedMessage = Pick<ChatMessage, 'id' | 'channel_id' | 'author_id' | 'kind' | 'created_at'>

// ------------------------------------------------------------------ the inbox

/** useChannelWaiting's read of the channels. */
export const CHANNEL_COLS = 'id, kind, site_id, name'
/** useChannelWaiting's read of the messages: the newest 400 people wrote, company-wide. */
export const INBOX_COLS = 'id, channel_id, author_id, kind, body, created_at'
export const INBOX_LIMIT = 400
/** The Chat page's inbox: the phone's columns, and whether a message is a photo, so its preview can say so. */
export const PAGE_INBOX_COLS = `${INBOX_COLS}, attachment_path`
/** The rail's count: the same messages, without what they say. */
export const UNREAD_COLS = 'id, channel_id, author_id, kind, created_at'

export interface Inbox<M extends CountedMessage = ChatMessage> {
  /** This person's channels: every job's, and their own direct messages. */
  channels: ChatChannel[]
  /** Newest first, as read, with live ones put on the front. */
  messages: M[]
}

/** Whether a channel is this person's: every job's is, and a direct message named with their id (useChannelWaiting). */
export const isMine = (c: Pick<ChatChannel, 'kind' | 'name'>, meId: string) => c.kind === 'site' || c.name.split(':').includes(meId)

export const mineOnly = <C extends Pick<ChatChannel, 'kind' | 'name'>>(rows: C[], meId: string): C[] => rows.filter((c) => isMine(c, meId))

/**
 * The phone's two inbox reads (useChannelWaiting), with `cols` of the
 * messages: the phone's, the page's (with attachment_path) or the rail's
 * (without the words). Throws when either read fails: a failed read is not
 * "nothing waiting".
 */
export async function readInbox<M extends CountedMessage = ChatMessage>(me: Pick<WorkerRow, 'id'>, cols: string = INBOX_COLS, client?: Db): Promise<Inbox<M>> {
  const c = db(client)
  const [ch, ms] = await Promise.all([
    c.from('channels').select(CHANNEL_COLS).in('kind', ['site', 'dm']),
    c.from('messages').select(cols).eq('kind', 'user').order('created_at', { ascending: false }).limit(INBOX_LIMIT),
  ])
  if (ch.error) throw new Error(ch.error.message)
  if (ms.error) throw new Error(ms.error.message)
  return { channels: mineOnly((ch.data ?? []) as unknown as ChatChannel[], me.id), messages: (ms.data ?? []) as unknown as M[] }
}

/** Each channel's messages, newest first, for the channels in the list only (useChannelWaiting's perChannel). */
export function byChannel<M extends Pick<ChatMessage, 'channel_id'>>(channels: ReadonlyArray<Pick<ChatChannel, 'id'>>, messages: ReadonlyArray<M>): Map<string, M[]> {
  const ids = new Set(channels.map((c) => c.id))
  const map = new Map<string, M[]>()
  for (const m of messages) {
    if (!ids.has(m.channel_id)) continue
    map.set(m.channel_id, [...(map.get(m.channel_id) ?? []), m])
  }
  return map
}

/**
 * How many messages wait on this person in each channel (useChannelWaiting's
 * waiting): newest first, the run of other people's messages since they last
 * spoke there. A channel with no messages in the window is not in the map.
 */
export function waitingOf(perChannel: Map<string, ReadonlyArray<Pick<ChatMessage, 'author_id'>>>, meId: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const [id, list] of perChannel) {
    let n = 0
    for (const m of list) {
      if (m.author_id === meId) break
      n++
    }
    map.set(id, n)
  }
  return map
}

/** How many conversations wait on a reply: the phone's tab bar badge (useUnreadCount). */
export function unreadCount(waiting: Map<string, number>): number {
  let n = 0
  for (const v of waiting.values()) if (v > 0) n++
  return n
}

/** The whole of the phone's count, from its two reads. */
export const countUnread = (inbox: Inbox<CountedMessage>, meId: string) => unreadCount(waitingOf(byChannel(inbox.channels, inbox.messages), meId))

/** A message as it arrives live, on the front of the list unless it is there already (the phone's realtime handler). */
export const withMessage = <M extends { id: string }>(list: M[], row: M): M[] => (list.some((m) => m.id === row.id) ? list : [row, ...list])

/** The filters the phone's realtime subscriptions use: the inbox listens to the company, a thread to its channel. */
export const companyFilter = (companyId: string) => `company_id=eq.${companyId}`
export const channelFilter = (channelId: string) => `channel_id=eq.${channelId}`

// ------------------------------------------------------------------ names and labels (Chat.tsx, WorkerApp.tsx)

/** "Lot 42, Kentish Ave" → "L42"; "Hallett Cove" → "HC": a job's tile (jobInit). */
export const jobInit = (name: string) => {
  const words = name.replace(/,/g, '').split(/\s+/).slice(0, 2)
  return words.map((w) => (/^\d/.test(w) ? w : w[0]?.toUpperCase() ?? '')).join('')
}

/** When a conversation last moved: the time today, "Yesterday", or the day and time (timeLabel). */
export const timeLabel = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  const clock = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  if (d.getTime() >= t0.getTime()) return clock
  if (d.getTime() >= t0.getTime() - 86_400_000) return 'Yesterday'
  return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${clock}`
}

/** A thread's day separator: Today, Yesterday, or "Tue 14 Oct" (chatDayLabel). */
export function dayLabel(d: Date): string {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The time under a message, as the phone's threads print it. */
export const clockLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

/** A direct message's channel name: the two ids sorted, so a pair always finds the same row (dmName). */
export const dmName = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`

/** The other person in a direct message, from its name (otherIdOf). */
export const otherIdOf = (channelName: string, meId: string): string | null => channelName.split(':').find((p) => p !== 'dm' && p !== meId) ?? null

/** A person's colour: one of the avatar greys, hashed from their id (personTone). */
export function personTone(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return avatarGrey(h)
}

// ------------------------------------------------------------------ the list (SimpleChat)

/** A person as the chat names them (crew_v). */
export interface ChatPerson {
  id: string
  name: string
  initials: string
  trade: string | null
  /** False once they have been taken off the team. */
  active?: boolean
}

interface SummaryBase {
  id: string
  title: string
  preview: string
  time: string
  /** The last message's created_at, or '' when there is none. */
  at: string
  waiting: number
}
export type ChatSummary<S> = (SummaryBase & { kind: 'site'; site: S }) | (SummaryBase & { kind: 'dm'; personId: string })

const IMAGE_RE = /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i

/** What a message says in a one-line preview: its words, or what it carries when it is only a photo or a file. */
export const previewBody = (m: Pick<ChatMessage, 'body' | 'attachment_path'>) => m.body || (m.attachment_path ? (IMAGE_RE.test(m.attachment_path) ? 'Photo' : 'File') : '')

/**
 * The phone's conversation list (SimpleChat): a row per job channel whose job
 * is in `siteById` (the phone passes its unarchived jobs) and per direct
 * message, newest first, split into what needs a reply and what does not.
 * The one difference: a message that is only a photo previews as "Photo"
 * where the phone shows nothing after the name.
 */
export function summarise<S extends { id: string; name: string }>({
  channels,
  perChannel,
  waiting,
  people,
  siteById,
  meId,
}: {
  channels: ReadonlyArray<ChatChannel>
  perChannel: Map<string, ReadonlyArray<Pick<ChatMessage, 'author_id' | 'body' | 'created_at' | 'attachment_path'>>>
  waiting: Map<string, number>
  people: Map<string, Pick<ChatPerson, 'name'>>
  siteById: Map<string, S>
  meId: string
}): { needsReply: ChatSummary<S>[]; upToDate: ChatSummary<S>[] } {
  const out: ChatSummary<S>[] = []
  for (const c of channels) {
    const list = perChannel.get(c.id) ?? []
    const w = waiting.get(c.id) ?? 0
    const last = list[0]
    const time = last ? timeLabel(last.created_at) : ''
    const at = last?.created_at ?? ''

    if (c.kind === 'site') {
      const site = c.site_id ? siteById.get(c.site_id) : undefined
      if (!site) continue
      const who = !last ? '' : last.author_id === meId ? 'You' : (last.author_id && people.get(last.author_id)?.name.split(' ')[0]) || 'Crew'
      out.push({ id: c.id, kind: 'site', site, title: site.name, preview: last ? `${who}: ${previewBody(last)}` : 'No messages yet', time, at, waiting: w })
    } else {
      const personId = otherIdOf(c.name, meId)
      if (!personId) continue
      const title = people.get(personId)?.name ?? 'Crew'
      const who = !last ? '' : last.author_id === meId ? 'You' : title.split(' ')[0] || 'Them'
      out.push({ id: c.id, kind: 'dm', personId, title, preview: last ? `${who}: ${previewBody(last)}` : 'No messages yet', time, at, waiting: w })
    }
  }
  out.sort((a, b) => (a.at > b.at ? -1 : 1))
  return {
    needsReply: out.filter((o) => o.waiting > 0),
    upToDate: out.filter((o) => o.waiting === 0),
  }
}

/** The person each of my direct messages is with, to its channel (SimpleChat's dmByPerson). */
export function dmByPerson(channels: ReadonlyArray<ChatChannel>, meId: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of channels) {
    if (c.kind !== 'dm') continue
    const other = otherIdOf(c.name, meId)
    if (other) map.set(other, c.id)
  }
  return map
}

// ------------------------------------------------------------------ a thread (ChatScreen)

/** ChatScreen's read: every column, and the author's name and initials. */
export const THREAD_COLS = '*, workers(name, initials)'
/** ChatScreen reads the newest 50; the website reads 50 more each time Show earlier is pressed. */
export const THREAD_PAGE = 50

/** A job's channel, found the way ChatScreen finds it. Null when the job has none. */
export async function findJobChannel(siteId: string, client?: Db): Promise<ChatChannel | null> {
  const { data, error } = await db(client).from('channels').select('*').eq('site_id', siteId).eq('kind', 'site').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ChatChannel | null) ?? null
}

/**
 * A page of a thread, oldest first: the newest THREAD_PAGE messages, or with
 * `upTo` the THREAD_PAGE written at or before that moment (at, so messages
 * that share it are not skipped; mergeThread drops the one already shown).
 * `more` is whether there may be earlier ones. The first page is ChatScreen's
 * read; a direct message is read the same way (the phone's DM thread reads
 * its oldest 300 instead, which stops showing new messages once there are
 * more).
 */
export async function readThread(channelId: string, { upTo }: { upTo?: string } = {}, client?: Db): Promise<{ messages: ThreadMessage[]; more: boolean }> {
  let q = db(client).from('messages').select(THREAD_COLS).eq('channel_id', channelId)
  if (upTo) q = q.lte('created_at', upTo)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(THREAD_PAGE)
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as unknown as ThreadMessage[]).slice().reverse()
  return { messages: rows, more: rows.length === THREAD_PAGE }
}

const when = (m: Pick<ChatMessage, 'created_at'>) => Date.parse(m.created_at)

/** Two copies of a thread as one, oldest first, each message once (the later copy wins). */
export function mergeThread<M extends Pick<ChatMessage, 'id' | 'created_at'>>(a: ReadonlyArray<M>, b: ReadonlyArray<M>): M[] {
  const byId = new Map<string, M>()
  for (const m of a) byId.set(m.id, m)
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => when(x) - when(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}

export type ThreadItem<M> =
  | { type: 'day'; key: string; label: string }
  | { type: 'system'; key: string; message: M; time: string }
  | {
      type: 'message'
      key: string
      message: M
      mine: boolean
      time: string
      /** The first of a run by one person: where their name goes. A day or a system line ends a run. */
      runStart: boolean
    }

/**
 * A thread as the phone draws it (ChatScreen): a day separator wherever the
 * local date changes, a system message as a line down the middle, and each
 * person's message with its time, mine on the right.
 */
export function threadItems<M extends Pick<ChatMessage, 'id' | 'author_id' | 'kind' | 'created_at'>>(messages: ReadonlyArray<M>, meId: string): ThreadItem<M>[] {
  const out: ThreadItem<M>[] = []
  let lastDay = ''
  let prevAuthor: string | null | undefined
  for (const m of messages) {
    const d = new Date(m.created_at)
    if (d.toDateString() !== lastDay) {
      lastDay = d.toDateString()
      out.push({ type: 'day', key: `day-${lastDay}`, label: dayLabel(d) })
      prevAuthor = undefined
    }
    const time = clockLabel(m.created_at)
    if (m.kind === 'system') {
      out.push({ type: 'system', key: m.id, message: m, time })
      prevAuthor = undefined
      continue
    }
    out.push({ type: 'message', key: m.id, message: m, mine: m.author_id === meId, time, runStart: prevAuthor !== m.author_id })
    prevAuthor = m.author_id
  }
  return out
}

// ------------------------------------------------------------------ sending

/** The row ChatScreen's send() puts in a job's thread, with a photo or without. */
export function jobMessageInsert({ me, channelId, body, attachmentPath }: { me: Me; channelId: string; body: string; attachmentPath?: string }) {
  return {
    company_id: me.company_id,
    channel_id: channelId,
    author_id: me.id,
    kind: 'user' as const,
    body,
    attachment_path: attachmentPath ?? null,
  }
}

/** The row DmThread's send() puts in a direct message: words only. */
export function dmMessageInsert({ me, channelId, body }: { me: Me; channelId: string; body: string }) {
  return {
    company_id: me.company_id,
    channel_id: channelId,
    author_id: me.id,
    kind: 'user' as const,
    body,
  }
}

export type SendResult = { ok: true; row: ThreadMessage } | { ok: false; message: string }

const NOT_IN_DM = "Photos go in a job's chat. A direct message on the phone shows words only."

/**
 * Send what is in the box (trimmed, as the phone trims it), with a photo's
 * path in a job's thread, and read the row back as stored. A refused insert
 * comes back as an error, never as a message that only looks sent.
 */
export async function sendMessage(
  { me, channel, draft, attachmentPath }: { me: Me; channel: Pick<ChatChannel, 'id' | 'kind'>; draft: string; attachmentPath?: string },
  client?: Db,
): Promise<SendResult> {
  const body = draft.trim()
  if (!body && !attachmentPath) return { ok: false, message: 'Type a message first.' }
  if (attachmentPath && channel.kind !== 'site') return { ok: false, message: NOT_IN_DM }
  const row = channel.kind === 'site' ? jobMessageInsert({ me, channelId: channel.id, body, attachmentPath }) : dmMessageInsert({ me, channelId: channel.id, body })
  const { data, error } = await db(client).from('messages').insert(row).select('*').single()
  if (error) return { ok: false, message: error.message }
  const stored = data as ThreadMessage | null
  if (!stored?.id || stored.channel_id !== channel.id || stored.author_id !== me.id || stored.body !== body) {
    return { ok: false, message: 'It did not read back as sent. Reload to see whether it went.' }
  }
  return { ok: true, row: stored }
}

// ------------------------------------------------------------------ photos (ChatScreen's attach)

/** ChatScreen's ceiling, the bucket's own. */
export const CHAT_ATTACHMENT_MAX = 25 * 1024 * 1024
/** What the phone's camera key takes. */
export const CHAT_ACCEPT = 'image/*'
/** The website takes a PDF too: the phone's thread shows any file that is not a photo as a file to open. */
export const CHAT_ACCEPT_DESK = `${CHAT_ACCEPT},application/pdf,.pdf`
/** Which attachments the phone draws as a picture (CHAT_IMAGE_RE); anything else is a file to open. */
export const CHAT_IMAGE_RE = IMAGE_RE

export const isChatImage = (path: string) => CHAT_IMAGE_RE.test(path)

/** An attachment's name as the phone shows it: the stored name without the id in front. */
export const attachmentName = (path: string) => (path.split('/').pop() ?? path).replace(/^[0-9a-f-]{36}-/i, '')

/** Why a file cannot be sent, before anything is uploaded; null when it can. */
export function attachmentRefusal(file: { name: string; size: number; type?: string }): string | null {
  if (file.size > CHAT_ATTACHMENT_MAX) return `${file.name} is over 25 MB. Send a smaller copy.`
  if (file.size === 0) return `${file.name} is empty.`
  const image = (file.type ?? '').startsWith('image/') || isChatImage(file.name)
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!image && !pdf) return `${file.name} is not a photo or a PDF. The crew's phones open those two.`
  return null
}

/**
 * A photo (or a PDF) into a job's thread: uploaded where ChatScreen puts one,
 * <company>/<channel>/<id>-<name> in site-files, then sent with what is in the
 * box. A message that does not save takes its file back out.
 */
export async function sendAttachment(
  { me, channel, draft, file }: { me: Me; channel: Pick<ChatChannel, 'id' | 'kind'>; draft: string; file: File },
  client?: Db,
): Promise<SendResult> {
  if (channel.kind !== 'site') return { ok: false, message: NOT_IN_DM }
  const refusal = attachmentRefusal(file)
  if (refusal) return { ok: false, message: refusal }
  const path = objectPath(me.company_id, channel.id, file.name)
  try {
    await uploadFile(BUCKET_FILES, path, file)
  } catch (e) {
    return { ok: false, message: `${file.name} did not upload: ${e instanceof Error ? e.message : String(e)}` }
  }
  const sent = await sendMessage({ me, channel, draft, attachmentPath: path }, client)
  if (!sent.ok) await removeFile(BUCKET_FILES, path).catch(() => {})
  return sent
}

// ------------------------------------------------------------------ direct messages (ComposeSheet)

/** The channel ComposeSheet makes for a new direct message. */
export function dmChannelInsert(me: Me, personId: string) {
  return { company_id: me.company_id, kind: 'dm' as const, site_id: null, name: dmName(me.id, personId) }
}

/** The two people ComposeSheet puts in it. */
export function dmMemberRows(channelId: string, me: Pick<WorkerRow, 'id'>, personId: string) {
  return [
    { channel_id: channelId, worker_id: me.id },
    { channel_id: channelId, worker_id: personId },
  ]
}

export type StartDmResult = { ok: true; channel: ChatChannel; created: boolean } | { ok: false; message: string }

/**
 * The direct message with a person: the one already listed (`known`, the
 * phone's dmByPerson), else one by that name in the database (so a list
 * that is out of date never makes a second), else a new one made exactly as
 * ComposeSheet makes it, with both people added and read back.
 */
export async function startDm({ me, personId, known }: { me: Me; personId: string; known?: ChatChannel | null }, client?: Db): Promise<StartDmResult> {
  if (personId === me.id) return { ok: false, message: 'Pick someone other than yourself.' }
  if (known) return { ok: true, channel: known, created: false }
  const c = db(client)
  const name = dmName(me.id, personId)
  const found = await c.from('channels').select(CHANNEL_COLS).eq('kind', 'dm').eq('name', name).order('created_at').limit(1)
  if (found.error) return { ok: false, message: found.error.message }
  const existing = ((found.data ?? []) as unknown as ChatChannel[])[0]
  if (existing) return { ok: true, channel: existing, created: false }

  const made = await c.from('channels').insert(dmChannelInsert(me, personId)).select(CHANNEL_COLS).single()
  const channel = made.data as ChatChannel | null
  if (made.error || !channel || channel.name !== name) return { ok: false, message: made.error?.message ?? 'The conversation did not read back as made.' }
  const members = await c.from('channel_members').insert(dmMemberRows(channel.id, me, personId)).select('channel_id, worker_id')
  if (members.error || (members.data ?? []).length !== 2) {
    return { ok: false, message: `The conversation was started, but the two of you could not be added to it: ${members.error?.message ?? 'the write was refused.'} Try again.` }
  }
  return { ok: true, channel, created: true }
}

// ------------------------------------------------------------------ who and where

/** The crew list the phone's chat reads (crew_v), and whether each person is still on the team. */
export const CREW_COLS = 'id, name, initials, trade, active'

export async function readCrew(client?: Db): Promise<ChatPerson[]> {
  const { data, error } = await db(client).from('crew_v').select(CREW_COLS)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ChatPerson[]
}

/** A job as a conversation shows it: its name, tile colour, address and builder, and whether it is archived. */
export interface ChatSite {
  id: string
  name: string
  address: string
  client_name: string | null
  colour: string | null
  status: 'active' | 'starting_soon' | 'archived'
}
export const SITE_COLS = 'id, name, address, client_name, colour, status'

export async function readSites(client?: Db): Promise<ChatSite[]> {
  const { data, error } = await db(client).from('job_sites').select(SITE_COLS)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ChatSite[]
}
