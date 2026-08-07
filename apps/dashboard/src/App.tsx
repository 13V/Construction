import { AuthScreen } from './auth/AuthScreen'
import { useSession } from './auth/useSession'
import { FinishSetup } from './auth/FinishSetup'
import { supabase, supabaseConfigured } from './data/supabase'
import { demoMode } from './data/demo'
import { Dashboard } from './Dashboard'
import { SetupNotice } from './ui/SetupNotice'
import { theme } from './theme'

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        color: theme.inkSoft,
        font: '14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 460 }}>{children}</div>
    </div>
  )
}

const retryBase = {
  height: 32,
  padding: '0 15px',
  borderRadius: 3,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
} as const

const retryPrimary = {
  ...retryBase,
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  color: theme.ink,
} as const

const retrySecondary = {
  ...retryBase,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  color: theme.ink,
} as const

export default function App() {
  const { loading, session, me, error, reload } = useSession()

  if (!supabaseConfigured) return <SetupNotice />
  if (loading) return <Centered>Loading…</Centered>
  // In demo mode the sign-in is in flight; showing a login form would be a lie.
  if (!session) return demoMode ? <Centered>Signing in…</Centered> : <AuthScreen />

  // Usually a dropped connection rather than anything wrong with the account,
  // and a builder on site loses signal constantly — so this offers the way out
  // instead of being a dead end with the reason printed on it.
  if (error) {
    return (
      <Centered>
        <strong style={{ color: theme.alert }}>Could not load your account</strong>
        <p>{error}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 }}>
          <button onClick={reload} style={retryPrimary}>
            Try again
          </button>
          <button onClick={() => void supabase().auth.signOut()} style={retrySecondary}>
            Sign out
          </button>
        </div>
      </Centered>
    )
  }

  // Signed in with no workers row. Every RLS policy keys off that row, so the
  // dashboard would be silently empty — this finishes the job instead.
  if (!me) {
    return <FinishSetup session={session} onDone={reload} />
  }

  return <Dashboard me={me} />
}
