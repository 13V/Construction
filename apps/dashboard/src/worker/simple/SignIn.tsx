/**
 * Sign in / sign up for the phone, in the drawing's own vocabulary: the 56px
 * white fields with the focus ring, the 12px tracked labels, the full-width
 * charcoal CTA. The drawing never drew a login (its prototype starts signed
 * in), so this screen is composed strictly from the parts it did draw — the
 * sign-up form fields and buttons — carrying the same logic the old screen
 * had: sign in, create a company, or claim an invited spot.
 */
import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { api } from '../../data/api'
import { s } from './stheme'

const field = {
  width: '100%',
  height: 56,
  padding: '0 14px',
  background: '#fff',
  border: '1px solid #DCE0E6',
  borderRadius: 10,
  font: 'inherit',
  fontSize: 16,
  color: '#1A1D21',
  outline: 'none',
} as const

const labelText = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.11em',
  color: '#7B838B',
} as const

export function SimpleSignIn() {
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
      if (!data.session) {
        setMessage('Check your email to confirm the account, then sign in.')
        return
      }
      const res = await fetch(api('/api/bootstrap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
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

  const label = (text: string, input: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={labelText}>{text}</span>
      {input}
    </label>
  )

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: '#F5F6F7', overflow: 'auto' }}>
      {/* The dark identity block — the drawing's gradient, the wordmark. */}
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6, padding: '54px 24px 26px', background: 'linear-gradient(#23272C,#15181C)' }}>
        <span style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', color: '#fff' }}>Crewline</span>
        <span style={{ fontSize: 14.5, lineHeight: 1.4, color: '#98A0A8' }}>
          {mode === 'signin'
            ? 'Sign in to your company.'
            : joining
              ? 'Sign up with the email your office invited.'
              : 'Create a company account.'}
        </span>
      </div>

      <form onSubmit={submit} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '22px 20px 28px' }}>
        {mode === 'signup' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', background: '#fff', border: '1px solid #DCE0E6', borderRadius: 10, fontSize: 14.5, color: '#4A5057', cursor: 'pointer' }}>
            <input type="checkbox" checked={joining} onChange={(e) => setJoining(e.target.checked)} style={{ width: 18, height: 18, accentColor: s.accent }} />
            My office already added me to a crew
          </label>
        )}

        {mode === 'signup' && !joining && (
          <>
            {label('COMPANY NAME', (
              <input style={field} value={company} onChange={(e) => setCompany(e.target.value)} required placeholder="e.g. Proven Tiling Solutions" />
            ))}
            {label('YOUR NAME', (
              <input style={field} value={name} onChange={(e) => setName(e.target.value)} required placeholder="First and last" />
            ))}
          </>
        )}

        {label('EMAIL', (
          <input style={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com.au" />
        ))}
        {label('PASSWORD', (
          <input
            style={field}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        ))}

        {error && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: '#A3282E' }}>{error}</span>}
        {message && <span style={{ fontSize: 13.5, lineHeight: 1.45, color: '#1F7A4D' }}>{message}</span>}

        <button
          type="submit"
          disabled={busy}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 56, marginTop: 4, background: busy ? '#4A5057' : '#1A1D21', border: 0, borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, letterSpacing: '.03em', cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? 'WORKING…' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setMessage(null)
          }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 48, background: 'none', border: 0, fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: s.accent, cursor: 'pointer' }}
        >
          {mode === 'signin' ? 'Set up a new company' : 'I already have an account'}
        </button>
      </form>
    </div>
  )
}
