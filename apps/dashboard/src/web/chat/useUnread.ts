/**
 * The rail's Chat count: how many conversations are waiting on a reply from
 * the person signed in. The phone's tab bar badge (useUnreadCount in
 * worker/simple/Chat.tsx), worked out the same way from the same reads
 * (data/chat.ts readInbox, pinned to the phone by chat.test.ts), so the
 * website and the phone show the same number. A conversation counts while
 * someone else has the last word, however long ago that was: each one's last
 * word comes from chat_last_v, not only from the company's newest 400.
 *
 * The rail is loaded first and stays mounted, as the phone's tab bar does,
 * so this keeps itself fresh: read again whenever `refreshKey` changes (the
 * rail passes the path, so every navigation), when the window comes back,
 * every minute while it is in view, and at once when the website's own chat
 * screens send something; and live from realtime between those. Its read
 * leaves out what messages say: the count only needs who spoke where.
 *
 * Null until the first read lands. A read that fails keeps the last count:
 * a failure is not "nothing waiting".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkerRow } from '../phone'
import { companyFilter, countUnread, readInbox, UNREAD_COLS, withMessage, type CountedMessage, type Inbox } from '../data/chat'
import { useFresh } from '../data/useFresh'
import { useChatAnnouncements, useMessageInserts } from './live'

export function useUnreadCount(me: Pick<WorkerRow, 'id' | 'company_id'>, refreshKey?: unknown): number | null {
  const meId = me.id
  const [inbox, setInbox] = useState<Inbox<CountedMessage> | null>(null)
  const latest = useRef(0)
  /** Live messages since the read in flight began, put back on top of it when it lands. */
  const sinceRead = useRef<CountedMessage[]>([])
  const known = useRef<Set<string>>(new Set())
  const askedAbout = useRef<Set<string>>(new Set())

  const read = useCallback(async () => {
    const mine = ++latest.current
    sinceRead.current = []
    try {
      const next = await readInbox<CountedMessage>({ id: meId }, UNREAD_COLS)
      if (mine !== latest.current) return
      known.current = new Set(next.channels.map((c) => c.id))
      let messages = next.messages
      for (const row of sinceRead.current) messages = withMessage(messages, row)
      setInbox({ channels: next.channels, messages })
    } catch {
      // Keep the last count.
    }
  }, [meId])

  useEffect(() => {
    void read()
  }, [read, refreshKey])
  useFresh(() => void read())

  const hear = useCallback(
    (row: CountedMessage) => {
      if (row.kind !== 'user') return
      if (!known.current.has(row.channel_id)) {
        // A channel this has not read: a direct message started since, or
        // someone else's. Read the channels again, once for each.
        if (!askedAbout.current.has(row.channel_id)) {
          askedAbout.current.add(row.channel_id)
          void read()
        }
        return
      }
      sinceRead.current.push(row)
      setInbox((prev) => (prev ? { ...prev, messages: withMessage(prev.messages, row) } : prev))
    },
    [read],
  )
  useMessageInserts(companyFilter(me.company_id), hear)
  useChatAnnouncements((row) => {
    if (row) hear(row)
    else void read()
  })

  return useMemo(() => (inbox ? countUnread(inbox, meId) : null), [inbox, meId])
}
