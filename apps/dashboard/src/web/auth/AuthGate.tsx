/**
 * Who may see the workspace: the website's front door, rebuilt from the old
 * dashboard's App.tsx in the phone's Simple design, on the same useSession
 * the phone uses (which this never changes).
 *
 *   <AuthGate>{({ me, reload }) => <the workspace />}</AuthGate>
 *
 * children is called only for an owner login with a workers row. Before that,
 * in this order:
 *
 *  1. Supabase not configured: SetupNotice.
 *  2. A password-reset link was just opened: NewPasswordPage, before anything
 *     else, whoever the account belongs to.
 *  3. Loading.
 *  4. Signed out: SignUpPage at /signup, ResetPage at /reset, and SignInPage
 *     at '/' and every other address (which stays put, so a link to a job
 *     opens that job once the person is in).
 *  5. The account failed to load: AccountError (Try again, Sign out).
 *  6. No workers row: FinishSetup (create the company, or wait to be added).
 *  7. Not the office: NotOffice (the crew app, Sign out).
 *
 * There is no "Try the demo" here, and there must never be: the demo is App
 * Review's tenant, and nothing on a desk should be able to touch it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase, supabaseConfigured, useSession, type WorkerRow } from '../phone'
import { navigate, paths, useRoute } from '../router'
import { color, space, text } from '../tokens'
import { AccountError } from './AccountError'
import { FinishSetup } from './FinishSetup'
import { NotOffice } from './NotOffice'
import { NewPasswordPage, ResetPage } from './ResetPage'
import { SetupNotice } from './SetupNotice'
import { SignInPage } from './SignInPage'
import { SignUpPage } from './SignUpPage'

/** What the workspace is given once someone is let in. */
export interface SignedIn {
  me: WorkerRow
  /** Read the session's workers row again (after finishing setup, say). */
  reload: () => void
}

/**
 * True when this page was opened from a password-reset link. Read before
 * supabase-js sees the address: it swaps the fragment's tokens for a session
 * and then wipes the fragment. Any path counts, not only /reset: if the
 * project's redirect allow-list lacks <site>/reset, Supabase sends the link
 * to the Site URL instead, and the reset must still work from there.
 */
function openedFromRecoveryLink(): boolean {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return params.get('type') === 'recovery' && Boolean(params.get('access_token'))
  } catch {
    return false
  }
}

export function AuthGate({ children }: { children: (signedIn: SignedIn) => ReactNode }) {
  const { loading, session, me, error, reload } = useSession()
  const route = useRoute()
  const [recovering, setRecovering] = useState(openedFromRecoveryLink)
  // The email typed on sign-in, sign-up or reset, kept between them.
  const [email, setEmail] = useState('')
  // The last answer useSession finished reading, and for which login.
  //
  // Only a read seen to finish counts: loading true, then false, both under
  // the SAME login. useSession reports "signed in, not loading, no row" (what
  // an account with no company looks like) before it has begun reading a
  // session's workers row: for one render after a sign-in, and on every load
  // with a stored session, where getSession() answers from storage in the
  // same tick as useSession's first "signed out, done", so React renders the
  // two together, straight after a loading that belonged to no login. Taking
  // either at its word showed FinishSetup, live and focused, for the whole
  // of the real read on every reload, new tab and opened link, and all
  // through useSession's bootstrap on a founder's first load.
  //
  // It also lets FinishSetup stay up while useSession reads again from it
  // (Check again, or after the company was made) and say it is checking,
  // rather than blinking to Loading and losing what was typed.
  //
  // reading: the login (null for none) whose read was seen under way, or
  // undefined when none is. Any stop clears it, matched or not: if a read
  // ends in the same tick as a sign-out, React renders both at once, and a
  // leftover mark would let that login's next sign-in count as already read.
  //
  // settled: no answer outlives its session. Most sign-outs happen with no
  // read under way, so no read is seen to finish them: the Rail's Sign out
  // in another tab (heard here by broadcast), or this tab's refresh token
  // revoked, which the phone's Me > Sign out does (its scope is global).
  // An answer left standing would be taken as current when the same login
  // signs in again in this tab, for the one render before useSession starts
  // its read ("signed in, not loading, no row": FinishSetup). So whenever
  // there is no session, it is dropped, read or no read.
  const reading = useRef<string | null | undefined>(undefined)
  const [settled, setSettled] = useState<{ user: string; unlinked: boolean } | null>(null)
  useEffect(() => {
    const who = session?.user.id ?? null
    if (!session) setSettled(null)
    if (loading) {
      reading.current = who
      return
    }
    const finished = reading.current === who
    reading.current = undefined
    if (session && finished) setSettled({ user: session.user.id, unlinked: !me && !error })
  }, [loading, session, me, error])

  // Whether supabase-js has a session, heard from it directly. useSession
  // says "signed out, not loading" from its first render until its
  // getSession() resolves (which, with an expired access token, waits for a
  // refresh over the network), so on its word alone every signed-in reload
  // would show the sign-in form first. Every subscriber is told the stored
  // session (INITIAL_SESSION) once supabase-js has read it, so until then,
  // and until useSession has caught up with it, this shows Loading.
  const [heard, setHeard] = useState<'unknown' | 'in' | 'out'>('unknown')

  useEffect(() => {
    if (!supabaseConfigured) return
    const { data } = supabase().auth.onAuthStateChange((event, next) => {
      setHeard(next ? 'in' : 'out')
      // The other way a recovery arrives (a PKCE link, or one opened after
      // the fragment was already consumed): supabase-js says so here.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      // Signed out here or in another tab: there is nobody to set a password for.
      if (event === 'SIGNED_OUT') setRecovering(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) return <SetupNotice />

  if (recovering && session) {
    return (
      <NewPasswordPage
        email={session.user.email ?? null}
        onDone={() => {
          setRecovering(false)
          navigate(paths.jobs, { replace: true })
        }}
      />
    )
  }

  if (session && !me) {
    const current = settled?.user === session.user.id
    if (loading || !current) {
      if (current && settled.unlinked) return <FinishSetup session={session} reload={reload} checking />
      return <Loading />
    }
  }
  if (!session && heard !== 'out') return <Loading />

  if (!session) {
    switch (route.name) {
      case 'signup':
        return <SignUpPage email={email} onEmail={setEmail} />
      case 'reset':
        return <ResetPage email={email} onEmail={setEmail} />
      default:
        return <SignInPage email={email} onEmail={setEmail} />
    }
  }

  if (error) return <AccountError error={error} />
  if (!me) return <FinishSetup session={session} reload={reload} checking={false} />
  if (!me.is_office) return <NotOffice me={me} />
  return <>{children({ me, reload })}</>
}

/**
 * While the session and its workers row are read. Blank for a beat, then a
 * quiet word, so a fast load shows nothing at all.
 */
function Loading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: color.appBg }}>
      <span role="status" className="wb-anim-fade" style={{ padding: space.lg, ...text.sm, color: color.faint, animationDelay: '.3s', animationFillMode: 'backwards' }}>
        Loading…
      </span>
    </div>
  )
}
