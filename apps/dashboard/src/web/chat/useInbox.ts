/**
 * Everything the Chat page's list needs, kept fresh: this person's channels,
 * the newest 400 messages people wrote and each conversation's last word
 * however old it is (chat_last_v; the phone's inbox, with whether each is a
 * photo), the crew by id (names, initials, trades) and the jobs by id (names,
 * colours, whether archived).
 *
 * Read on opening, again when the window comes back and every minute while
 * it is in view, and live from realtime between those, the way the phone's
 * Chat tab keeps itself (useChannelWaiting). A read that fails keeps what is
 * on screen and says so.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerRow } from '../phone'
import {
  companyFilter,
  PAGE_INBOX_COLS,
  readCrew,
  readInbox,
  readSites,
  withMessage,
  type ChatChannel,
  type ChatMessage,
  type ChatPerson,
  type ChatSite,
} from '../data/chat'
import { useFresh } from '../data/useFresh'
import { announceChat, useMessageInserts } from './live'

export interface InboxData {
  channels: ChatChannel[]
  /** Newest first. */
  messages: ChatMessage[]
  people: Map<string, ChatPerson>
  sites: Map<string, ChatSite>
  /** The first read has landed (or failed). */
  loaded: boolean
  error: string | null
}

const EMPTY: InboxData = { channels: [], messages: [], people: new Map(), sites: new Map(), loaded: false, error: null }

export function useInbox(me: Pick<WorkerRow, 'id' | 'company_id'>) {
  const meId = me.id
  const [data, setData] = useState<InboxData>(EMPTY)
  const latest = useRef(0)
  const sinceRead = useRef<ChatMessage[]>([])
  const askedAbout = useRef<Set<string>>(new Set())
  const known = useRef<Set<string>>(new Set())

  const read = useCallback(async () => {
    const mine = ++latest.current
    sinceRead.current = []
    try {
      const [inbox, crew, sites] = await Promise.all([readInbox<ChatMessage>({ id: meId }, PAGE_INBOX_COLS), readCrew(), readSites()])
      if (mine !== latest.current) return
      known.current = new Set(inbox.channels.map((c) => c.id))
      let messages = inbox.messages
      for (const row of sinceRead.current) messages = withMessage(messages, row)
      setData({
        channels: inbox.channels,
        messages,
        people: new Map(crew.map((p) => [p.id, p])),
        sites: new Map(sites.map((x) => [x.id, x])),
        loaded: true,
        error: null,
      })
    } catch (e) {
      if (mine === latest.current) setData((d) => ({ ...d, loaded: true, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [meId])

  useEffect(() => {
    void read()
  }, [read])
  useFresh(() => void read())

  const hear = useCallback(
    (row: ChatMessage) => {
      if (row.kind !== 'user') return
      if (!known.current.has(row.channel_id)) {
        if (!askedAbout.current.has(row.channel_id)) {
          askedAbout.current.add(row.channel_id)
          void read()
        }
        return
      }
      sinceRead.current.push(row)
      setData((d) => ({ ...d, messages: withMessage(d.messages, row) }))
    },
    [read],
  )
  useMessageInserts(companyFilter(me.company_id), hear)

  /** This page sent `row`: on the list at once, and on the rail's count. */
  const noteSent = useCallback(
    (row: ChatMessage) => {
      hear(row)
      announceChat(row)
    },
    [hear],
  )

  /** A conversation this page just started: listed before its first message. */
  const addChannel = useCallback((c: ChatChannel) => {
    known.current.add(c.id)
    setData((d) => (d.channels.some((x) => x.id === c.id) ? d : { ...d, channels: [...d.channels, c] }))
    announceChat()
  }, [])

  return { ...data, reload: read, noteSent, addChannel }
}
