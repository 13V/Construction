/**
 * Create a company account, at /signup: the only place a business is created
 * (App Review was told so; the phone build has no company sign-up).
 *
 * Company name, your name, email and password. signup.ts does the work: the
 * names ride on the account through the confirmation email, and the company
 * and its owner are made the moment the person first signs in. There is no
 * "my office already added me" box here: crew make their login in the phone
 * app, and the footnote says so.
 */
import { useRef, useState, type FormEvent } from 'react'
import { linkProps, paths } from '../router'
import { color, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { AuthDivider, AuthHeading, AuthLayout, CrewFootnote, EmailSent, type FrontDoorProps } from './AuthLayout'
import { MIN_PASSWORD, signUpCompany, signUpProblems, type CompanySignUp, type SignUpField } from './signup'

export function SignUpPage({ email, onEmail }: FrontDoorProps) {
  const [companyName, setCompanyName] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [problems, setProblems] = useState<Partial<Record<SignUpField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)

  const input: CompanySignUp = { companyName, name, email, password }

  /** A field's onChange: set it, and clear its complaint once the person starts fixing it. */
  const edit = (field: SignUpField, set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    if (problems[field]) setProblems((p) => ({ ...p, [field]: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const found = signUpProblems(input)
    setProblems(found)
    const first = (Object.keys(found) as SignUpField[])[0]
    if (first) {
      // Take the cursor to the first thing to fix, as the browser's own check would.
      form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const out = await signUpCompany(input)
    if (out.kind === 'check-email') {
      setSentTo(out.email)
      setPassword('')
      setBusy(false)
    } else if (out.kind === 'failed') {
      setError(out.message)
      setBusy(false)
    }
    // 'signed-in': useSession already has the session and is creating the
    // company; AuthGate replaces this page. Stay busy until it does.
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <EmailSent
          actions={
            <>
              <Button variant="primary" size="lg" block href={paths.home}>
                Back to sign in
              </Button>
              <Button variant="ghost" block onClick={() => setSentTo(null)}>
                Use a different email
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            We sent a link to <strong style={{ color: color.ink, overflowWrap: 'anywhere' }}>{sentTo}</strong>. Open it to confirm the address, then sign in.
          </p>
          <p style={{ margin: 0, fontWeight: 600, color: color.ink }}>Your company is set up the moment you sign in.</p>
          <p style={{ margin: 0, ...text.sm, color: color.muted }}>Nothing after a few minutes? Look in junk or spam.</p>
        </EmailSent>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout footnote={<CrewFootnote />}>
      <AuthHeading title="Create a company account">You are setting up a new company. Your crew join it afterwards, from the app.</AuthHeading>

      <form ref={form} noValidate onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field
          label="Company name"
          name="companyName"
          autoComplete="organization"
          autoFocus
          placeholder="e.g. Proven Tiling Solutions"
          value={companyName}
          error={problems.companyName}
          onChange={edit('companyName', setCompanyName)}
        />
        <Field label="Your name" name="name" autoComplete="name" placeholder="First and last" value={name} error={problems.name} onChange={edit('name', setName)} />
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@company.com.au"
          value={email}
          error={problems.email}
          onChange={edit('email', onEmail)}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD} characters`}
          value={password}
          error={problems.password}
          onChange={edit('password', setPassword)}
        />
        <Button type="submit" variant="primary" size="lg" block loading={busy} style={{ marginTop: space.xxs }}>
          {busy ? 'Creating your account…' : 'Create company account'}
        </Button>
      </form>

      <AuthDivider />

      <p style={{ margin: 0, ...text.base, color: color.body, textAlign: 'center' }}>
        Already have an account?{' '}
        <a {...linkProps(paths.home)} className="wb-link">
          Sign in
        </a>
      </p>
    </AuthLayout>
  )
}
