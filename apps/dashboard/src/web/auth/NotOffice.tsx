/**
 * Signed in as crew (a captain or an employee): the website is for setting
 * jobs up, which only an owner login can do (the RLS policies on job_sites
 * and friends say so, not this screen). One card that says where their jobs
 * are, with the crew app in this browser (/worker) and Sign out.
 */
import type { WorkerRow } from '../phone'
import { WEB_BRAND } from '../marker'
import { paths } from '../router'
import { signOutHere } from '../shell/Rail'
import { color, space, text } from '../tokens'
import { Button } from '../ui/Button'
import { AuthHeading, AuthLayout } from './AuthLayout'

export function NotOffice({ me }: { me: WorkerRow }) {
  return (
    <AuthLayout>
      <AuthHeading title="Setting up jobs is done by the office">Your jobs are in the app.</AuthHeading>
      <p style={{ margin: 0, ...text.base, color: color.body }}>
        You are signed in as <strong style={{ color: color.ink }}>{me.name}</strong>. Open the {WEB_BRAND} app on your phone to see where you are booked and to clock on.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {/* A real page load: /worker is another surface, chosen when the page loads. */}
        <Button variant="primary" size="lg" block href={paths.worker}>
          Open the crew app
        </Button>
        <Button variant="secondary" block onClick={() => void signOutHere()}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
