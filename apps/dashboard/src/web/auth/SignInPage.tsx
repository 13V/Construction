/**
 * Sign in, at '/' (and at any other address while signed out, so a link to a
 * job opens that job once the person is in).
 *
 * Email and password, "Forgot password?", and the way in for a new business.
 * There is no "Try the demo": the demo is App Review's tenant, and nothing on
 * a desk should be able to touch it.
 *
 * On success there is nothing to do here: useSession hears the new session,
 * AuthGate moves on, and this screen goes away (still busy, so the button
 * cannot be pressed twice on the way).
 */
import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../phone'
import { linkProps, paths } from '../router'
import { color, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { AuthDivider, AuthHeading, AuthLayout, CrewFootnote, type FrontDoorProps } from './AuthLayout'
import { emailProblem, signInError } from './signup'

export function SignInPage({ email, onEmail }: FrontDoorProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<{ email?: string; password?: string }>({})
  const passwordRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const found = { email: emailProblem(email) ?? undefined, password: password ? undefined : 'Enter your password.' }
    setProblems(found)
    if (found.email || found.password) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
      if (err) throw err
    } catch (err) {
      setError(signInError(err))
      setBusy(false)
      // The likeliest fix is the password: put the cursor back in it.
      passwordRef.current?.select()
    }
  }

  return (
    <AuthLayout footnote={<CrewFootnote />}>
      <AuthHeading title="Sign in">Set up jobs and book your crew, from your desk.</AuthHeading>

      <form noValidate onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={!email}
          placeholder="you@company.com.au"
          value={email}
          error={problems.email}
          onChange={(e) => {
            onEmail(e.target.value)
            if (problems.email) setProblems((p) => ({ ...p, email: undefined }))
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
          <Field
            ref={passwordRef}
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus={Boolean(email)}
            placeholder="Your password"
            value={password}
            error={problems.password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (problems.password) setProblems((p) => ({ ...p, password: undefined }))
            }}
          />
          <a {...linkProps(paths.reset)} className="wb-link" style={{ alignSelf: 'flex-end', ...text.sm }}>
            Forgot password?
          </a>
        </div>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <AuthDivider />

      <p style={{ margin: 0, ...text.base, color: color.body, textAlign: 'center' }}>
        New business?{' '}
        <a {...linkProps(paths.signup)} className="wb-link">
          Create a company account
        </a>
      </p>
    </AuthLayout>
  )
}
