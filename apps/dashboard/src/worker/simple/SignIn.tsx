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
import { s, SAFE_BOTTOM, SAFE_TOP } from './stheme'

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

/**
 * Auth errors arrive as the wire's own wording, which is written for whoever
 * built the thing rather than whoever is holding the phone.
 *
 * "email rate limit exceeded" is the one that matters. It is what a project
 * without its own mail sender says once it has spent its allowance for the
 * hour, and it lands on somebody who has done nothing wrong and has never
 * heard of a rate limit. Left as it arrives it reads like the app is broken,
 * and the next move is to give up rather than to wait.
 *
 * Exported so the wording can be tested on its own — a regex typo here would
 * quietly put the raw string back in front of a customer.
 */
export function readableAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/rate limit|too many requests|over_email_send/i.test(raw)) {
    return 'Too many accounts have been set up in the last hour. Wait about an hour and try again — nothing you typed was lost, and the address is still free.'
  }
  if (/invalid login credentials/i.test(raw)) {
    return 'That email and password do not match an account. Check for a typo, or set up a new company below.'
  }
  if (/email not confirmed/i.test(raw)) {
    return 'This account has not been confirmed yet. Open the link in the email we sent, then sign in.'
  }
  if (/already registered|already been registered/i.test(raw)) {
    return 'There is already an account on that email. Sign in with it instead, or use a different address.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return 'Could not reach Crewline. Check your signal and try again — sites are good at eating reception.'
  }
  return raw
}

export function SimpleSignIn() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [busy, setBusy] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * One tap into the demo company. The server mints a one-time token for the
   * demo account (api/demo.ts) and it is exchanged for a session here — no
   * password exists in this bundle to leak.
   */
  async function openDemo() {
    if (demoBusy) return
    setDemoBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await fetch(api('/api/demo'), { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.token_hash) throw new Error(d.error ?? 'The demo is unavailable right now.')
      const { error: err } = await supabase().auth.verifyOtp({ type: 'magiclink', token_hash: d.token_hash })
      if (err) throw err
    } catch (err) {
      setError(readableAuthError(err))
      setDemoBusy(false)
    }
  }

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
      /*
       * The company name rides on the account itself, not just in the
       * bootstrap call below.
       *
       * Email confirmation is on, so signUp() returns no session and the
       * bootstrap request a few lines down cannot be made — it needs a bearer
       * token. That used to end the story: the typed company name lived only
       * in this component's state, the page was closed while the person went
       * to their inbox, and when they came back and signed in they had a
       * login attached to no company at all. The app then told them to "ask
       * your office to add you to the crew list", which for the person
       * founding the company is nobody. The whole "set up a new company" path
       * dead-ended, and only for real accounts — the demo tenant is seeded
       * straight into the database and never walks it.
       *
       * Supabase stores this metadata on the user, so it survives the inbox
       * round trip and a different device, and useSession finishes the job on
       * first sign-in.
       */
      const { data, error: err } = await client.auth.signUp({
        email,
        password,
        options: { data: joining ? {} : { company_name: company.trim(), full_name: name.trim() } },
      })
      if (err) throw err
      if (!data.session) {
        setMessage(
          joining
            ? 'Check your email to confirm the account, then sign in — your crew record is waiting.'
            : 'Check your email to confirm the account, then sign in. Your company is set up the moment you do.',
        )
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
      setError(readableAuthError(err))
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
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6, padding: `calc(54px + ${SAFE_TOP}) 24px 26px`, background: 'linear-gradient(#23272C,#15181C)' }}>
        <span style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', color: '#fff' }}>Crewline</span>
        <span style={{ fontSize: 14.5, lineHeight: 1.4, color: '#98A0A8' }}>
          {mode === 'signin'
            ? 'Sign in to your company.'
            : joining
              ? 'Sign up with the email your office invited.'
              : 'Create a company account.'}
        </span>
      </div>

      <form onSubmit={submit} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: `22px 20px calc(28px + ${SAFE_BOTTOM})` }}>
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

        {mode === 'signin' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 4px' }}>
              <span style={{ flex: 1, height: 1, background: '#DCE0E6' }} />
              <span style={{ flex: 'none', fontSize: 12, fontWeight: 700, letterSpacing: '.11em', color: '#8B9096' }}>OR</span>
              <span style={{ flex: 1, height: 1, background: '#DCE0E6' }} />
            </div>
            <button
              type="button"
              onClick={() => void openDemo()}
              disabled={demoBusy}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: 56, background: '#fff', border: '1px solid #DCE0E6', borderRadius: 10, fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, letterSpacing: '.03em', color: '#1A1D21', cursor: demoBusy ? 'default' : 'pointer' }}
            >
              {demoBusy ? 'OPENING THE DEMO…' : 'TRY THE DEMO'}
            </button>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: '#696D74', textAlign: 'center', padding: '0 8px' }}>
              A fictional tiling company — five jobs, ten crew, the money — to poke
              around in. Nothing here is real.
            </span>
          </>
        )}
      </form>
    </div>
  )
}
