/**
 * Signed in, but the workers row could not be read (or useSession could not
 * finish setting the account up): useSession().error.
 *
 * Usually a dropped connection rather than anything wrong with the account,
 * so it offers the way out instead of being a dead end with the reason
 * printed on it. "Try again" reloads the page: useSession's own reload() keeps
 * the old error, and a fresh load is also what fixes a half-deployed site.
 */
import { signOutHere } from '../shell/Rail'
import { color, radius, space, text } from '../tokens'
import { Button } from '../ui/Button'
import { AuthHeading, AuthLayout } from './AuthLayout'

export function AccountError({ error }: { error: string }) {
  return (
    <AuthLayout>
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <AuthHeading title="Could not load your account">This is usually the connection rather than your account. Check you are online, then try again.</AuthHeading>
        {error && (
          <p style={{ margin: 0, padding: `${space.xs}px ${space.sm}px`, background: color.redFill, borderRadius: radius.sm, ...text.sm, color: color.red, wordBreak: 'break-word' }}>
            {error}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
        <Button variant="primary" size="lg" block onClick={() => window.location.reload()}>
          Try again
        </Button>
        <Button variant="secondary" block onClick={() => void signOutHere()}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
