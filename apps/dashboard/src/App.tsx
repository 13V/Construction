import { AuthScreen } from './auth/AuthScreen'
import { useSession } from './auth/useSession'
import { FinishSetup } from './auth/FinishSetup'
import { supabaseConfigured } from './data/supabase'
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

export default function App() {
  const { loading, session, me, error, reload } = useSession()

  if (!supabaseConfigured) return <SetupNotice />
  if (loading) return <Centered>Loading…</Centered>
  // In demo mode the sign-in is in flight; showing a login form would be a lie.
  if (!session) return demoMode ? <Centered>Signing in…</Centered> : <AuthScreen />

  if (error) {
    return (
      <Centered>
        <strong style={{ color: theme.alert }}>Could not load your account</strong>
        <p>{error}</p>
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
