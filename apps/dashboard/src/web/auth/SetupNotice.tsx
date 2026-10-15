/**
 * This copy of the website was built without its database address, so it
 * cannot sign anyone in. Said to whoever deployed it, in the place they would
 * fix it: a dev server reads .env.local, a deployment reads the host's
 * environment at build time (so a running deployment never picks a change up
 * without a redeploy).
 *
 * The server variables are listed too: without them /api/bootstrap cannot
 * create a company, and sign-up would fail one step later.
 */
import { color, radius, space, text } from '../tokens'
import { AuthHeading, AuthLayout } from './AuthLayout'

const VARS = [
  ['VITE_SUPABASE_URL', 'https://<project>.supabase.co'],
  ['VITE_SUPABASE_ANON_KEY', 'the public anon key'],
  ['SUPABASE_URL', 'same as above, for /api'],
  ['SUPABASE_ANON_KEY', 'same as above, for /api'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'server only, never VITE_'],
] as const

export function SetupNotice() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
  return (
    <AuthLayout>
      <AuthHeading title="This website is not connected yet">
        {local
          ? 'Copy .env.example to .env.local, fill these in, then restart the dev server.'
          : 'Add these in Vercel (Settings, Environment Variables), then redeploy. They are read when the site is built, so the running deployment will not pick them up.'}
      </AuthHeading>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: space.md, rowGap: space.xs, padding: space.md, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md }}>
        {VARS.map(([key, hint]) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: '18px', color: color.ink }}>{key}</dt>
            <dd style={{ margin: 0, ...text.sm, color: color.muted }}>{hint}</dd>
          </div>
        ))}
      </dl>
      <p style={{ margin: 0, ...text.sm, color: color.muted }}>
        SUPABASE_SERVICE_ROLE_KEY bypasses row-level security. Set it for the server only; with a VITE_ prefix it would be published in the page.
      </p>
    </AuthLayout>
  )
}
