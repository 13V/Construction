import { useState } from 'react'
import { supabase } from '../data/supabase'
import { theme } from '../theme'

const shell = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: theme.appBg,
  color: theme.ink,
  padding: 24,
} as const

const card = {
  width: '100%',
  maxWidth: 400,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  padding: 26,
} as const

const field = {
  width: '100%',
  height: 36,
  padding: '0 11px',
  marginTop: 6,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 14,
  color: theme.ink,
} as const

const label = {
  display: 'block',
  marginTop: 14,
  fontSize: 11.5,
  fontWeight: 600,
  color: theme.inkSoft,
} as const

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)

    try {
      const client = supabase()

      if (mode === 'signin') {
        const { error: err } = await client.auth.signInWithPassword({ email, password })
        if (err) throw err
        return
      }

      const { data, error: err } = await client.auth.signUp({ email, password })
      if (err) throw err

      // Email confirmation is on by default in Supabase; without a session we
      // can't call the bootstrap endpoint yet.
      if (!data.session) {
        setMessage('Check your email to confirm the account, then sign in.')
        return
      }

      // Invited crew claim the row the office already created for their
      // email, so they don't need to supply a company at all.
      const res = await fetch('/api/bootstrap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify(joining ? {} : { companyName: company, name }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not finish setting up the account')
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={shell}>
      <form style={card} onSubmit={submit}>
        <div style={{ fontSize: 19, fontWeight: 600 }}>Crewline</div>
        <div style={{ fontSize: 13, color: theme.inkSoft, marginTop: 4 }}>
          {mode === 'signin'
            ? 'Sign in to your company.'
            : joining
              ? 'Sign up with the email your office invited.'
              : 'Create a company account.'}
        </div>

        {mode === 'signup' && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 16,
              fontSize: 12.5,
              color: theme.inkSoft,
            }}
          >
            <input
              type="checkbox"
              checked={joining}
              onChange={(e) => setJoining(e.target.checked)}
            />
            My office already added me to a crew
          </label>
        )}

        {mode === 'signup' && !joining && (
          <>
            <label style={label}>
              Company name
              <input
                style={field}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
                placeholder="Whitcomb Builders"
              />
            </label>
            <label style={label}>
              Your name
              <input
                style={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Ray Whitcomb"
              />
            </label>
          </>
        )}

        <label style={label}>
          Email
          <input
            style={field}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label style={label}>
          Password
          <input
            style={field}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>

        {error && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: theme.alert }}>{error}</div>
        )}
        {message && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: theme.inkSoft }}>{message}</div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '10px 0',
            borderRadius: 3,
            border: 'none',
            background: busy
              ? theme.border
              : `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
            color: theme.ink,
            font: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setMessage(null)
          }}
          style={{
            width: '100%',
            marginTop: 12,
            border: 'none',
            background: 'none',
            color: theme.accent,
            font: 'inherit',
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          {mode === 'signin'
            ? 'Set up a new company'
            : 'I already have an account'}
        </button>
      </form>
    </div>
  )
}
