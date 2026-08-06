import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured, type WorkerRow } from '../data/supabase'
import { DEMO_EMAIL, DEMO_PASSWORD, demoMode } from '../data/demo'

export interface SessionState {
  loading: boolean
  session: Session | null
  /** The workers row linked to this login. Null means signed in but not linked. */
  me: WorkerRow | null
  error: string | null
  reload: () => void
}

/**
 * Supabase auth plus the workers row it maps to. Every RLS policy keys off that
 * row, so a session without one can see nothing — the UI has to say so plainly
 * rather than rendering an empty dashboard.
 */
export function useSession(): SessionState {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<WorkerRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    const client = supabase()
    let cancelled = false

    void client.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      if (data.session || !demoMode) {
        setSession(data.session)
        return
      }
      // No session and demo mode is on — sign the demo account in silently.
      const { error: err } = await client.auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      })
      if (cancelled) return
      if (err) {
        setError(`Demo sign-in failed: ${err.message}`)
        setLoading(false)
      }
      // onAuthStateChange picks the session up on success.
    })

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) return
    if (!session) {
      setMe(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void supabase()
      .from('workers')
      .select('*')
      .eq('auth_user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        setMe((data as WorkerRow) ?? null)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [session, nonce])

  return { loading, session, me, error, reload: () => setNonce((n) => n + 1) }
}
