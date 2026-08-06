import { theme } from '../theme'

const VARS = [
  ['VITE_SUPABASE_URL', 'https://xxxx.supabase.co'],
  ['VITE_SUPABASE_ANON_KEY', 'eyJhbGci…'],
  ['VITE_GOOGLE_MAPS_API_KEY', 'AIza…'],
  ['VITE_GOOGLE_MAPS_MAP_ID', 'DEMO_MAP_ID'],
  ['SUPABASE_URL', 'same as above'],
  ['SUPABASE_ANON_KEY', 'same as above'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'server only — never VITE_'],
] as const

/**
 * Shown when credentials are missing. Deployed and local need different
 * instructions — telling someone looking at a Vercel URL to edit `.env.local`
 * just wastes their time.
 */
export function SetupNotice() {
  const local =
    typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        color: theme.ink,
        padding: 24,
        font: '14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 620,
          background: theme.panel,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          padding: 28,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Finish setting up Crewline
        </div>
        <p style={{ fontSize: 13.5, color: theme.inkSoft, marginTop: 0 }}>
          {local ? (
            <>
              Copy <code>.env.example</code> to <code>.env.local</code> and fill these in,
              then restart the dev server.
            </>
          ) : (
            <>
              Add these in <strong>Vercel → Settings → Environment Variables</strong>, then
              redeploy. Environment variables are baked in at build time, so an existing
              deployment won't pick them up.
            </>
          )}
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '14px 0' }}>
          <tbody>
            {VARS.map(([key, hint]) => (
              <tr key={key}>
                <td
                  style={{
                    padding: '5px 10px 5px 0',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    borderBottom: `1px solid ${theme.border}`,
                  }}
                >
                  {key}
                </td>
                <td
                  style={{
                    padding: '5px 0',
                    fontSize: 12,
                    color: theme.inkFaint,
                    borderBottom: `1px solid ${theme.border}`,
                  }}
                >
                  {hint}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ol style={{ fontSize: 13, color: theme.inkSoft, paddingLeft: 18, margin: 0 }}>
          <li>
            Create a Supabase project and run <code>supabase/schema.sql</code> in its SQL
            editor. URL and <code>anon</code> key are under Settings → API.
          </li>
          <li>
            Turn <strong>off</strong> email confirmation under Authentication → Providers →
            Email for the first run, or signup can't finish creating your company.
          </li>
          <li>
            In Google Cloud Console enable <strong>Maps JavaScript API</strong> and{' '}
            <strong>Geocoding API</strong>, then create an API key.
          </li>
          <li>
            <strong>Enable billing.</strong> Without it Google renders a darkened map
            covered in “For development purposes only”.
          </li>
          <li>Restrict the key to this domain before you ship it anywhere.</li>
        </ol>

        <p style={{ fontSize: 12, color: theme.inkFaint, marginBottom: 0 }}>
          <code>SUPABASE_SERVICE_ROLE_KEY</code> bypasses row-level security. Set it as a
          server variable only — never with a <code>VITE_</code> prefix, or it ends up in
          the browser bundle. See <code>DEPLOY.md</code>.
        </p>
      </div>
    </div>
  )
}
