/**
 * A forgotten password, both halves.
 *
 * ResetPage, at /reset while signed out: ask for the email and send the link.
 * The link comes back to <this site>/reset, so that address has to be on the
 * Supabase project's list of allowed redirect URLs (Authentication, URL
 * Configuration), an ops step outside the repo. If it is missing, Supabase
 * sends the person to the Site URL instead; AuthGate notices a recovery
 * session wherever it lands, so the reset still works, just from '/'.
 *
 * NewPasswordPage: the link signed the person in with a recovery session,
 * and before anything else they choose a new password (updateUser).
 *
 * The phone app has no reset of its own, so this is also where a crew member
 * who forgot theirs ends up; the new password works in the app straight away.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { readableAuthError, supabase } from '../phone'
import { linkProps, paths } from '../router'
import { color, space, text } from '../tokens'
import { useToast } from '../shell/Toast'
import { signOutHere } from '../shell/Rail'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { AuthDivider, AuthHeading, AuthLayout, EmailSent, type FrontDoorProps } from './AuthLayout'
import { emailProblem, MIN_PASSWORD, passwordProblem } from './signup'

/**
 * Why a reset link failed, when it did. Supabase sends a spent or expired
 * link back with the reason in the fragment (#error=access_denied&
 * error_code=otp_expired&error_description=...) and no session.
 */
function linkFailure(): string | null {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (!params.get('error') && !params.get('error_code')) return null
    if (params.get('error_code') === 'otp_expired') return 'That reset link has expired or has already been used. Send yourself a new one below.'
    const said = params.get('error_description')
    return `That reset link did not work${said ? ` (${said})` : ''}. Send yourself a new one below.`
  } catch {
    return null
  }
}

/**
 * The phone's wording for the email cap talks about accounts being set up,
 * which is not what this person was doing; the rest is right as it is.
 */
function resetError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/rate limit|too many requests|over_email_send/i.test(raw)) {
    return 'Too many emails have gone out in the last hour. Wait about an hour and try again.'
  }
  return readableAuthError(err)
}

export function ResetPage({ email, onEmail }: FrontDoorProps) {
  const [failed] = useState(linkFailure)
  // Read once, then tidied out of the address bar, where it would otherwise
  // sit (and come back on every visit to this tab's history entry).
  useEffect(() => {
    if (failed) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [failed])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const found = emailProblem(email)
    setProblem(found)
    if (found) return
    setBusy(true)
    setError(null)
    const to = email.trim()
    try {
      const { error: err } = await supabase().auth.resetPasswordForEmail(to, { redirectTo: `${window.location.origin}${paths.reset}` })
      if (err) throw err
      setSentTo(to)
    } catch (err) {
      setError(resetError(err))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <EmailSent
          actions={
            <Button variant="primary" size="lg" block href={paths.home}>
              Back to sign in
            </Button>
          }
        >
          <p style={{ margin: 0 }}>
            If there is an account for <strong style={{ color: color.ink, overflowWrap: 'anywhere' }}>{sentTo}</strong>, a link to choose a new password is on its way. Open it, and you can set the new one here.
          </p>
          <p style={{ margin: 0, ...text.sm, color: color.muted }}>Nothing after a few minutes? Look in junk or spam, and check the address is the one you sign in with.</p>
        </EmailSent>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthHeading title="Reset your password">Enter the email you sign in with. We will send you a link to choose a new password.</AuthHeading>
      <form noValidate onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {failed && !error && <Banner tone="warn">{failed}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder="you@company.com.au"
          value={email}
          error={problem ?? undefined}
          onChange={(e) => {
            onEmail(e.target.value)
            if (problem) setProblem(null)
          }}
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <AuthDivider />
      <p style={{ margin: 0, ...text.base, color: color.body, textAlign: 'center' }}>
        Remembered it?{' '}
        <a {...linkProps(paths.home)} className="wb-link">
          Sign in
        </a>
      </p>
    </AuthLayout>
  )
}

/**
 * The recovery session's one job. Two fields, because a password typed once
 * into dots and then forgotten again is the problem being solved.
 */
export function NewPasswordPage({ email, onDone }: { email: string | null; onDone: () => void }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [problems, setProblems] = useState<{ password?: string; again?: string }>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const found = {
      password: passwordProblem(password) ?? undefined,
      again: !passwordProblem(password) && again !== password ? 'The two passwords are different.' : undefined,
    }
    setProblems(found)
    if (found.password || found.again) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase().auth.updateUser({ password })
      if (err) throw err
      toast('Password saved. Use it in the app too.', { tone: 'success' })
      onDone()
    } catch (err) {
      setError(readableAuthError(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading title="Choose a new password">
        {email ? (
          <>
            For <strong style={{ color: color.ink, overflowWrap: 'anywhere' }}>{email}</strong>. It replaces the old one everywhere, the app included.
          </>
        ) : (
          'It replaces the old one everywhere, the app included.'
        )}
      </AuthHeading>
      <form noValidate onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {error && <Banner tone="error">{error}</Banner>}
        {/* For password managers: which account this new password belongs to. */}
        <input type="email" name="email" autoComplete="username" value={email ?? ''} readOnly hidden />
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          error={problems.password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (problems.password) setProblems((p) => ({ ...p, password: undefined }))
          }}
        />
        <Field
          label="New password again"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={again}
          error={problems.again}
          onChange={(e) => {
            setAgain(e.target.value)
            if (problems.again) setProblems((p) => ({ ...p, again: undefined }))
          }}
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
      </form>
      <AuthDivider />
      <p style={{ margin: 0, ...text.sm, color: color.muted, textAlign: 'center' }}>
        Not you, or did not ask for this?{' '}
        <button type="button" className="wb-link wb-link--button" style={{ ...text.sm }} onClick={() => void signOutHere()}>
          Sign out
        </button>
      </p>
    </AuthLayout>
  )
}
