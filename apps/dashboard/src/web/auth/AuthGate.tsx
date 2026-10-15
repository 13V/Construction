/**
 * Who may see the workspace. A STUB: a plain email-and-password sign-in, so
 * the website can be driven before its real front door exists. WP04 replaces
 * this file with the full gate (sign-up, password reset, finish setup) and
 * keeps its contract:
 *
 *   <AuthGate>{({ me, reload }) => <the workspace />}</AuthGate>
 *
 * children is called only for a signed-in owner or office login with a
 * workers row. In order, before that: Supabase not configured, loading,
 * signed out, the account failed to load, no workers row, not the office.
 *
 * There is no "Try the demo" here, and there must never be: the demo is App
 * Review's tenant, and nothing on a desk should be able to touch it.
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { readableAuthError, supabase, supabaseConfigured, useSession, type WorkerRow } from '../phone'
import { paths } from '../router'
import { color, radius, shadow, space, text } from '../tokens'
import { BrandLockup, signOutHere } from '../shell/Rail'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'

/** What the workspace is given once someone is let in. */
export interface SignedIn {
  me: WorkerRow
  /** Read the session's workers row again (after finishing setup, say). */
  reload: () => void
}

export function AuthGate({ children }: { children: (signedIn: SignedIn) => ReactNode }) {
  const { loading, session, me, error, reload } = useSession()

  if (!supabaseConfigured) {
    return (
      <Card title="Not connected">
        This copy of the website was built without its database address (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).
      </Card>
    )
  }
  // useSession reloads the workers row whenever the token refreshes; keep
  // the workspace on screen through that rather than flashing Loading.
  if (loading && !me) return <Card title="Loading…" />
  if (!session) return <StubSignIn />
  if (error) {
    return (
      <Card title="Could not load your account" actions={<><Button variant="primary" onClick={reload}>Try again</Button><Button onClick={() => void signOutHere()}>Sign out</Button></>}>
        {error}
      </Card>
    )
  }
  if (!me) {
    return (
      <Card title="This login is not linked to a company" actions={<Button onClick={() => void signOutHere()}>Sign out</Button>}>
        Ask your office to add you to the crew with this email address.
      </Card>
    )
  }
  if (!me.is_office) {
    return (
      <Card
        title="Setting up jobs is done by the office"
        actions={
          <>
            <Button variant="primary" href={paths.worker}>Open the crew app</Button>
            <Button onClick={() => void signOutHere()}>Sign out</Button>
          </>
        }
      >
        Your jobs are in the app.
      </Card>
    )
  }
  return <>{children({ me, reload })}</>
}

function Card({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space.lg, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: space.md, padding: space.xl - 4, background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, boxShadow: shadow.card }}>
        <BrandLockup onDark={false} />
        <h1 style={{ margin: `${space.xs}px 0 0`, ...text.title, color: color.ink }}>{title}</h1>
        {children && <div style={{ ...text.base, color: color.body }}>{children}</div>}
        {actions && <div style={{ display: 'flex', gap: space.xs }}>{actions}</div>}
      </div>
    </div>
  )
}

function StubSignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
    // On success useSession hears the new session and this screen goes away.
    if (error) {
      setErr(readableAuthError(error))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Card
        title="Sign in"
        actions={
          <Button type="submit" variant="primary" block loading={busy}>
            Sign in
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          <span>Set jobs up here. Your crew run them on the phone.</span>
          {err && <Banner tone="error">{err}</Banner>}
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </Card>
    </form>
  )
}
