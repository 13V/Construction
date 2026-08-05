import { createClient } from '@supabase/supabase-js'
import type { Ping } from '../types'
import type { FeedBatch, PositionFeed } from './feed'

/**
 * Production feed. Swap it in from App.tsx once the phones are reporting:
 *
 *   const feed = useMemo(() => createSupabaseFeed(), [])
 *
 * Expected table (enable Realtime on it in the Supabase dashboard):
 *
 *   create table positions (
 *     id          bigserial primary key,
 *     worker_id   text        not null references workers(id),
 *     at          timestamptz not null default now(),
 *     lat         double precision not null,
 *     lng         double precision not null,
 *     accuracy_m  real
 *   );
 *   create index on positions (worker_id, at desc);
 *   alter publication supabase_realtime add table positions;
 *
 * Row-level security matters here — a worker must only ever be able to insert
 * their own rows, and only the owning company may read them.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

interface PositionRow {
  worker_id: string
  at: string
  lat: number
  lng: number
  accuracy_m: number | null
}

const toPing = (row: PositionRow): Ping => ({
  workerId: row.worker_id,
  at: new Date(row.at).getTime(),
  lat: row.lat,
  lng: row.lng,
  accuracyM: row.accuracy_m ?? 0,
})

export function createSupabaseFeed(): PositionFeed {
  if (!supabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }

  const client = createClient(url!, anonKey!)

  return {
    subscribe(onBatch: (batch: FeedBatch) => void) {
      let cancelled = false

      // Backfill today's trail so the map isn't empty on load, then stream.
      const since = new Date()
      since.setHours(0, 0, 0, 0)

      void client
        .from('positions')
        .select('worker_id, at, lat, lng, accuracy_m')
        .gte('at', since.toISOString())
        .order('at', { ascending: true })
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) {
            console.error('[supabaseFeed] backfill failed', error)
            return
          }
          const pings = (data ?? []).map(toPing)
          if (pings.length) onBatch({ pings, now: Date.now() })
        })

      const channel = client
        .channel('positions-stream')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'positions' },
          (payload) => {
            if (cancelled) return
            onBatch({ pings: [toPing(payload.new as PositionRow)], now: Date.now() })
          },
        )
        .subscribe()

      return () => {
        cancelled = true
        void client.removeChannel(channel)
      }
    },
  }
}
