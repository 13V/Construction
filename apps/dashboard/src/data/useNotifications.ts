import { useCallback, useEffect, useState } from 'react'
import { supabase, type NotificationRow } from './supabase'

/**
 * The notice list for whoever is signed in.
 *
 * RLS decides what "yours" means — your own row, plus anything addressed to
 * the office if you are office — so this deliberately does not filter by
 * worker id. Doing it here as well would be a second, drifting copy of the
 * rule.
 */
export function useNotifications() {
  const [rows, setRows] = useState<NotificationRow[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase()
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40)
    setRows((data ?? []) as NotificationRow[])
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase()
      .channel('live-notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
        void load()
      })
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [load])

  const unread = rows.filter((r) => r.read_at === null).length

  const markAllRead = useCallback(async () => {
    const ids = rows.filter((r) => r.read_at === null).map((r) => r.id)
    if (ids.length === 0) return
    const stamp = new Date().toISOString()
    // Optimistic: the bell should clear on tap, not after a round trip.
    setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: stamp })))
    await supabase().from('notifications').update({ read_at: stamp }).in('id', ids)
  }, [rows])

  return { rows, unread, markAllRead, reload: load }
}
