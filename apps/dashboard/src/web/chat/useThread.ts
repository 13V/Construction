/**
 * One conversation's messages, oldest first, kept fresh.
 *
 * The newest 50 when it opens (ChatScreen's read), 50 more each time Show
 * earlier is pressed, new ones live from realtime on this channel (the
 * phone's thread subscription), and the newest 50 again when the window
 * comes back and every minute while it is in view, so a message written
 * while the socket was down still turns up. Everything read is put together
 * by id, so nothing shows twice.
 *
 * Mount it again (a React key) for another conversation.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerRow } from '../phone'
import { channelFilter, mergeThread, readThread, sendAttachment, sendMessage, type ChatChannel, type SendResult, type ThreadMessage } from '../data/chat'
import { useFresh } from '../data/useFresh'
import { useMessageInserts } from './live'

export function useThread(me: Pick<WorkerRow, 'id' | 'company_id'>, channel: Pick<ChatChannel, 'id' | 'kind'>) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Whether there may be messages before the oldest shown. */
  const [more, setMore] = useState(false)
  const [earlierBusy, setEarlierBusy] = useState(false)
  const firstDone = useRef(false)
  const latest = useRef(0)
  const channelId = channel.id

  const readNewest = useCallback(async () => {
    const mine = ++latest.current
    try {
      const page = await readThread(channelId)
      if (mine !== latest.current) return
      setMessages((prev) => mergeThread(prev, page.messages))
      // Only the first page says whether there is anything before it; a
      // refresh of the newest 50 says nothing about pages already shown.
      if (!firstDone.current) setMore(page.more)
      firstDone.current = true
      setError(null)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mine === latest.current) setLoaded(true)
    }
  }, [channelId])

  useEffect(() => {
    void readNewest()
  }, [readNewest])
  useFresh(() => void readNewest())

  useMessageInserts(channelFilter(channelId), (row) => {
    if (row.channel_id === channelId) setMessages((prev) => mergeThread(prev, [row]))
  })

  const oldest = messages[0]?.created_at
  const shown = useRef(messages)
  useEffect(() => {
    shown.current = messages
  }, [messages])
  const readEarlier = useCallback(async () => {
    if (!oldest || earlierBusy) return
    setEarlierBusy(true)
    try {
      const page = await readThread(channelId, { upTo: oldest })
      const have = new Set(shown.current.map((m) => m.id))
      const fresh = page.messages.filter((m) => !have.has(m.id)).length
      setMessages((prev) => mergeThread(page.messages, prev))
      // A full page that brought nothing new (more than a page written in one
      // moment) would bring the same again: stop there.
      setMore(page.more && fresh > 0)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEarlierBusy(false)
    }
  }, [channelId, oldest, earlierBusy])

  const kept = useCallback((out: SendResult) => {
    if (out.ok) setMessages((prev) => mergeThread(prev, [out.row]))
    return out
  }, [])

  const send = useCallback(
    async (draft: string) => kept(await sendMessage({ me: { id: me.id, company_id: me.company_id }, channel: { id: channelId, kind: channel.kind }, draft })),
    [kept, me.id, me.company_id, channelId, channel.kind],
  )

  const attach = useCallback(
    async (file: File, draft: string) => kept(await sendAttachment({ me: { id: me.id, company_id: me.company_id }, channel: { id: channelId, kind: channel.kind }, draft, file })),
    [kept, me.id, me.company_id, channelId, channel.kind],
  )

  return { messages, loaded, error, more, earlierBusy, readEarlier, reload: readNewest, send, attach }
}
