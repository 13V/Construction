import type { Ping } from '../types'

export interface FeedBatch {
  pings: Ping[]
  /** Current simulated (or real) clock, epoch ms. */
  now: number
}

/**
 * Where worker positions come from. The simulated feed drives the demo; the
 * Supabase feed is the production implementation. The dashboard only ever
 * talks to this interface, so switching is a one-line change in App.tsx.
 */
export interface PositionFeed {
  subscribe(onBatch: (batch: FeedBatch) => void): () => void
  /** Playback speed multiplier. Real feeds ignore this. */
  setSpeed?(multiplier: number): void
}
