/**
 * Messages as they are written.
 *
 * useMessageInserts is the phone's own subscription: Supabase realtime on
 * INSERT into public.messages, filtered to the company (the inbox and the
 * count) or to one channel (a thread). Only messages are in the database's
 * realtime publication, not channels, so a conversation started somewhere
 * else arrives with its first message, and whoever hears a message for a
 * channel it has not read reads its channels again.
 *
 * announceChat is the website's own shortcut: the Chat page and a job's Chat
 * tab tell the rail at once what they just wrote, rather than leaving the
 * count to the realtime echo, which a blocked socket never brings.
 *
 * Eager-safe: the rail imports this, so it reaches the phone only through
 * ../phone.
 */
import { useEffect, useId, useRef } from 'react'
import { supabase } from '../phone'
import type { ChatMessage } from '../data/chat'

export function useMessageInserts(filter: string | null, onInsert: (row: ChatMessage) => void) {
  const latest = useRef(onInsert)
  useEffect(() => {
    latest.current = onInsert
  })
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    if (!filter) return
    const client = supabase()
    const ch = client
      .channel(`wb-chat-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, (payload) => {
        latest.current(payload.new as ChatMessage)
      })
      .subscribe()
    return () => {
      void client.removeChannel(ch)
    }
  }, [filter, uid])
}

const CHAT_EVENT = 'wb:chat'

/** Say that this website just wrote `row` (or changed chat some other way, with no row). */
export function announceChat(row: ChatMessage | null = null) {
  window.dispatchEvent(new CustomEvent<ChatMessage | null>(CHAT_EVENT, { detail: row }))
}

/** Hear what announceChat says. `onHeard` may change every render; the latest is called. */
export function useChatAnnouncements(onHeard: (row: ChatMessage | null) => void) {
  const latest = useRef(onHeard)
  useEffect(() => {
    latest.current = onHeard
  })
  useEffect(() => {
    const heard = (e: Event) => latest.current((e as CustomEvent<ChatMessage | null>).detail ?? null)
    window.addEventListener(CHAT_EVENT, heard)
    return () => window.removeEventListener(CHAT_EVENT, heard)
  }, [])
}
