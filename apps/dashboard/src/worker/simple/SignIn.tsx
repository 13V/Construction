/**
 * Sign in / sign up for the phone, in the drawing's own vocabulary: the 56px
 * white fields with the focus ring, the 12px tracked labels, the full-width
 * charcoal CTA. The drawing never drew a login (its prototype starts signed
 * in), so this screen is composed strictly from the parts it did draw — the
 * sign-up form fields and buttons — carrying the same logic the old screen
 * had: sign in, create a company, or claim an invited spot.
 *
 * The mark in the hero is the app icon's own tiles, drawn from the icon's
 * measured geometry (AppIcon-512@2x.png: tiles #fff and #007bff on #1a1d21,
 * which is this theme's ink) so the screen matches what the person just
 * tapped on their home screen. The name under it is BRAND — Proven on the
 * phone, Crewline in a browser — see ../brand.ts for why they differ.
 */
import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { api } from '../../data/api'
import { s, SAFE_BOTTOM, SAFE_TOP } from './stheme'
import { BRAND, WHITE_LABELLED } from '../brand'
import { viewFile } from './FileViewer'

const field = {
  width: '100%',
  height: 56,
  padding: '0 16px',
  boxSizing: 'border-box',
  background: '#fff',
  border: '1px solid #DCE0E6',
  borderRadius: 12,
  font: 'inherit',
  fontSize: 16,
  color: '#1A1D21',
  outline: 'none',
  transition: 'border-color .12s, box-shadow .12s',
} as const

/**
 * The focus ring, and the only stylesheet on this screen. Inline styles
 * cannot express :focus, and a field that does not show it has focus is the
 * one thing a form on a phone in daylight cannot afford.
 */
const FOCUS_RING = `
.si-field:focus { border-color: #1A1D21; box-shadow: 0 0 0 3px rgba(26,29,33,.10); }
.si-field::placeholder { color: #A5ABB2; }
`

/** The app icon's tiles, cropped to their own bounds. See the header comment. */
const Mark = () => (
  <svg width="46" viewBox="195 255 634 514" role="img" aria-label={BRAND} style={{ display: 'block', height: 'auto' }}>
    <rect x="195" y="255" width="301" height="241" rx="28" fill="#fff" />
    <rect x="529" y="255" width="301" height="241" rx="28" fill="#fff" />
    <rect x="195" y="529" width="134" height="241" rx="28" fill="#fff" />
    <rect x="362" y="529" width="301" height="241" rx="28" fill="#007bff" />
    <rect x="696" y="529" width="134" height="241" rx="28" fill="#fff" />
  </svg>
)

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
    return `Could not reach ${BRAND}. Check your signal and try again — sites are good at eating reception.`
  }
  return raw
}

export function SimpleSignIn() {
/**
 * Whether this build may create a company.
 *
 * App Review rejected 1.0 (50) under guideline 3.1.1: an account registration
 * feature for businesses is treated as access to an external mechanism for
 * purchases, even in an app that charges nothing and contains no purchase of
 * any kind. Their instruction was to remove it, and every B2B app on the
 * store has made the same change — you sign into Slack or Xero on a phone,
 * you do not create the organisation there.
 *
 * So a company is created on the web and nowhere else. What stays on the
 * phone is a worker making their own login for a crew their office has
 * already added them to, which is not a business registering anything.
 *
 * VITE_SURFACE=worker is set only by the iOS build (see ios-testflight.yml),
 * so the browser keeps the full sign-up it has always had.
 */
const CAN_CREATE_COMPANY = import.meta.env.VITE_SURFACE !== 'worker'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(!CAN_CREATE_COMPANY)
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={labelText}>{text}</span>
      {input}
    </label>
  )

  // What the form is for, said once above it rather than in the hero, so the
  // hero can stay the same picture whichever way the person is going.
  //
  // CAN_CREATE_COMPANY is written first and inline in every one of these,
  // not hoisted into a tidier boolean: `false && …` folds at the site and
  // the company-signup strings drop out of the phone bundle, which is what
  // the notes filed with App Review say happens. Behind a derived const the
  // minifier kept them. Checked by grepping the built output, both ways.
  const heading =
    mode === 'signin' ? 'Sign in' : CAN_CREATE_COMPANY && !joining ? 'Create a company account' : 'Create your login'
  const lede =
    mode === 'signin'
      ? 'Use the email your office has for you.'
      : CAN_CREATE_COMPANY && !joining
        ? 'You are setting up a new company. Your crew join it afterwards.'
        : 'Your office has already added you to a crew. Sign up with the email they have for you.'

  const linkStyle = { fontFamily: 'inherit', fontSize: 15, background: 'none', border: 0, padding: 0, cursor: 'pointer' } as const
  const footLink = { fontSize: 12.5, fontWeight: 600, color: s.muted, background: 'none', border: 0, padding: '6px 2px', fontFamily: 'inherit', cursor: 'pointer' } as const

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: s.appBg, overflow: 'auto' }}>
      <style>{FOCUS_RING}</style>

      {/* The dark identity block — the drawing's gradient, the icon's mark, the name. */}
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: `calc(60px + ${SAFE_TOP}) 24px 32px`, background: 'linear-gradient(#24282D,#15181C)' }}>
        <Mark />
        <span style={{ marginTop: 18, fontSize: 31, fontWeight: 700, letterSpacing: '-.025em', lineHeight: 1.1, color: '#fff' }}>{BRAND}</span>
        <span style={{ marginTop: 6, fontSize: 15, lineHeight: 1.4, color: s.onDarkMuted }}>Crew hours, sites and safety.</span>
      </div>

      <form onSubmit={submit} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: `26px 20px calc(24px + ${SAFE_BOTTOM})` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.015em', color: s.ink }}>{heading}</span>
          <span style={{ fontSize: 14.5, lineHeight: 1.45, color: s.body }}>{lede}</span>
        </div>

        {CAN_CREATE_COMPANY && mode === 'signup' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: `1px solid ${s.border}`, borderRadius: 12, fontSize: 15, color: s.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={joining} onChange={(e) => setJoining(e.target.checked)} style={{ width: 18, height: 18, margin: 0, accentColor: s.accent }} />
            My office already added me to a crew
          </label>
        )}

        {CAN_CREATE_COMPANY && mode === 'signup' && !joining && (
          <>
            {label('COMPANY NAME', (
              <input className="si-field" style={field} value={company} onChange={(e) => setCompany(e.target.value)} required placeholder="e.g. Proven Tiling Solutions" />
            ))}
            {label('YOUR NAME', (
              <input className="si-field" style={field} value={name} onChange={(e) => setName(e.target.value)} required placeholder="First and last" />
            ))}
          </>
        )}

        {label('EMAIL', (
          <input className="si-field" style={field} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com.au" />
        ))}
        {label('PASSWORD', (
          <input
            className="si-field"
            style={field}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
          />
        ))}

        {error && (
          <span style={{ padding: '12px 14px', borderRadius: 10, background: s.redFill, fontSize: 13.5, lineHeight: 1.45, color: s.red }}>{error}</span>
        )}
        {message && (
          <span style={{ padding: '12px 14px', borderRadius: 10, background: s.greenFill, fontSize: 13.5, lineHeight: 1.45, color: s.green }}>{message}</span>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 56, marginTop: 4, background: busy ? s.charcoal : s.ink, border: 0, borderRadius: 12, color: '#fff', fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, letterSpacing: '.04em', cursor: busy ? 'default' : 'pointer', boxShadow: busy ? 'none' : '0 6px 16px rgba(26,29,33,.18)' }}
        >
          {busy ? 'WORKING…' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </button>

        {/* The other way in: a sentence, then the action, so the action reads
            as a link and not as a second button competing with the first. */}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setMessage(null)
          }}
          style={{ ...linkStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 5, width: '100%', minHeight: 44, color: s.body }}
        >
          {mode === 'signin' ? (
            CAN_CREATE_COMPANY ? (
              <>
                <span>New here?</span>
                <span style={{ fontWeight: 700, color: s.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>Set up a new company</span>
              </>
            ) : (
              <>
                <span>My office added me.</span>
                <span style={{ fontWeight: 700, color: s.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>Create my login</span>
              </>
            )
          ) : (
            <>
              <span>Already have a login?</span>
              <span style={{ fontWeight: 700, color: s.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>Sign in</span>
            </>
          )}
        </button>

        {mode === 'signin' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 4px 0' }}>
              <span style={{ flex: 1, height: 1, background: s.border }} />
              <span style={{ flex: 'none', fontSize: 12, fontWeight: 700, letterSpacing: '.11em', color: s.faint }}>OR</span>
              <span style={{ flex: 1, height: 1, background: s.border }} />
            </div>
            <button
              type="button"
              onClick={() => void openDemo()}
              disabled={demoBusy}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', minHeight: 56, background: '#fff', border: `1px solid ${s.border}`, borderRadius: 12, fontFamily: 'inherit', fontSize: 15.5, fontWeight: 700, letterSpacing: '.04em', color: s.ink, cursor: demoBusy ? 'default' : 'pointer' }}
            >
              {demoBusy ? 'OPENING THE DEMO…' : 'TRY THE DEMO'}
            </button>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: s.muted, textAlign: 'center', padding: '0 12px' }}>
              A fictional tiling company — five jobs, ten crew, the money. Nothing in it is real.
            </span>
          </>
        )}

        {/* The legal lines every sign-in owes, reachable before anyone has an
            account — the same pages App Review opens with none. */}
        <div style={{ marginTop: 'auto', paddingTop: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={() => viewFile({ url: '/privacy', name: 'Privacy policy' })} style={footLink}>Privacy policy</button>
            <span style={{ color: s.ghost, fontSize: 12 }}>·</span>
            <button type="button" onClick={() => viewFile({ url: '/support', name: 'Support' })} style={footLink}>Support</button>
          </span>
          {WHITE_LABELLED && <span style={{ fontSize: 12, color: s.faint, letterSpacing: '.01em' }}>Powered by Crewline</span>}
        </div>
      </form>
    </div>
  )
}
