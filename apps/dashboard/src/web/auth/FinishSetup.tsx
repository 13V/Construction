/**
 * Signed in and confirmed, but attached to no company: no workers row, so
 * every RLS policy denies and the workspace would be silently empty.
 *
 * By the time this shows, useSession has already asked /api/bootstrap to
 * finish things on its own (from the names parked at sign-up, or a crew spot
 * the office made for this email) and been told there was nothing to finish.
 * That happens to an account made on the old dashboard's sign-up, which did
 * not park the names; to a founder whose metadata was lost; and to crew who
 * signed up before their office added them. So it asks:
 *
 *  - Setting up a company: company name and your name, POSTed to
 *    /api/bootstrap with this session's token, then the session is read again.
 *  - Joining a crew: the office adds you first. Nothing to submit; "Check
 *    again" re-reads the session, and useSession's own bootstrap claims the
 *    spot once it exists.
 *
 * The phone has no equivalent (it says "Not linked to a company"), so this is
 * the only way out for these accounts.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../phone'
import { WEB_BRAND } from '../marker'
import { signOutHere } from '../shell/Rail'
import { color, radius, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import { AuthHeading, AuthLayout } from './AuthLayout'
import { bootstrapCompany } from './signup'

type Path = 'company' | 'joining'

export interface FinishSetupProps {
  session: Session
  /** Read the workers row again: useSession().reload. */
  reload: () => void
  /** True while that read is under way, so this screen can stay up and say so. */
  checking: boolean
}

export function FinishSetup({ session, reload, checking }: FinishSetupProps) {
  const meta = (session.user.user_metadata ?? {}) as { company_name?: unknown; full_name?: unknown }
  const [path, setPath] = useState<Path>('company')
  const [companyName, setCompanyName] = useState(typeof meta.company_name === 'string' ? meta.company_name : '')
  const [name, setName] = useState(typeof meta.full_name === 'string' ? meta.full_name : '')
  const [problems, setProblems] = useState<{ companyName?: string; name?: string }>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notYet, setNotYet] = useState(false)
  const asked = useRef(false)
  const email = session.user.email ?? null

  // "Check again" finished and this screen is still here: nobody has added
  // this email to a crew yet. Say so, or the button looks like it did nothing.
  useEffect(() => {
    if (!checking && asked.current) {
      asked.current = false
      setNotYet(true)
    }
  }, [checking])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const found = {
      companyName: companyName.trim() ? undefined : 'Enter your company’s name.',
      name: name.trim() ? undefined : 'Enter your name.',
    }
    setProblems(found)
    if (found.companyName || found.name) return
    setBusy(true)
    setError(null)
    // A fresh token: this screen can sit open for longer than one lasts.
    const { data } = await supabase().auth.getSession()
    const out = await bootstrapCompany(data.session?.access_token ?? session.access_token, { companyName, name })
    if (!out.ok) {
      setError(out.message)
      setBusy(false)
      return
    }
    // Made (or claimed): read the workers row again. AuthGate keeps this
    // screen up, still busy, until the workspace is ready.
    reload()
  }

  return (
    <AuthLayout>
      <AuthHeading title="One more step">
        {email ? (
          <>
            You are signed in as <strong style={{ color: color.ink, overflowWrap: 'anywhere' }}>{email}</strong>, but this login is not part of a company yet.
          </>
        ) : (
          'This login is not part of a company yet.'
        )}
      </AuthHeading>

      <Segmented<Path>
        label="What are you here to do?"
        block
        value={path}
        onChange={(p) => {
          setPath(p)
          setError(null)
          setNotYet(false)
        }}
        options={[
          { value: 'company', label: 'Set up my company' },
          { value: 'joining', label: 'I’m joining a crew' },
        ]}
      />

      {path === 'company' ? (
        <form noValidate onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          {error && <Banner tone="error">{error}</Banner>}
          <Field
            label="Company name"
            name="companyName"
            autoComplete="organization"
            autoFocus
            placeholder="e.g. Proven Tiling Solutions"
            value={companyName}
            error={problems.companyName}
            onChange={(e) => {
              setCompanyName(e.target.value)
              if (problems.companyName) setProblems((p) => ({ ...p, companyName: undefined }))
            }}
          />
          <Field
            label="Your name"
            name="name"
            autoComplete="name"
            placeholder="First and last"
            value={name}
            error={problems.name}
            onChange={(e) => {
              setName(e.target.value)
              if (problems.name) setProblems((p) => ({ ...p, name: undefined }))
            }}
          />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {busy ? 'Setting up…' : 'Create the company'}
          </Button>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, padding: space.md, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md, ...text.base, color: color.body }}>
            <p style={{ margin: 0 }}>
              <strong style={{ color: color.ink }}>Your office adds you first.</strong> Ask them to add {email ? <strong style={{ color: color.ink, overflowWrap: 'anywhere' }}>{email}</strong> : 'this email'} to their crew.
            </p>
            <p style={{ margin: 0 }}>Then sign in on your phone, in the {WEB_BRAND} app, with this email and password. Crews do not need this website.</p>
          </div>
          {notYet && !checking && <Banner tone="warn">Not added yet. Once your office has added this email, check again.</Banner>}
          <Button
            variant="primary"
            size="lg"
            block
            loading={checking}
            onClick={() => {
              asked.current = true
              setNotYet(false)
              reload()
            }}
          >
            {checking ? 'Checking…' : 'Check again'}
          </Button>
        </div>
      )}

      <p style={{ margin: 0, ...text.sm, color: color.muted, textAlign: 'center' }}>
        Wrong login?{' '}
        <button type="button" className="wb-link wb-link--button" style={{ ...text.sm }} onClick={() => void signOutHere()}>
          Sign out
        </button>
      </p>
    </AuthLayout>
  )
}
