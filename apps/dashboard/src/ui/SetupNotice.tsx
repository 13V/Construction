import { theme } from '../theme'

/**
 * Shown when no Maps key is configured. Better than a grey box: an unbilled or
 * missing key renders Google's "For development purposes only" watermark,
 * which looks broken in front of a client.
 */
export function SetupNotice() {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.appBg,
        color: theme.ink,
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 560,
          background: theme.panel,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          padding: 28,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>
          Add a Google Maps API key
        </div>
        <p style={{ fontSize: 13.5, color: theme.inkSoft, marginTop: 0 }}>
          Copy <code>.env.example</code> to <code>.env.local</code> and set your key:
        </p>
        <pre
          style={{
            background: theme.appBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            padding: 12,
            fontSize: 12,
            overflowX: 'auto',
          }}
        >
{`VITE_GOOGLE_MAPS_API_KEY=your-key-here
VITE_GOOGLE_MAPS_MAP_ID=DEMO_MAP_ID`}
        </pre>
        <ol style={{ fontSize: 13, color: theme.inkSoft, paddingLeft: 18 }}>
          <li>
            Enable <strong>Maps JavaScript API</strong> in Google Cloud Console.
          </li>
          <li>
            <strong>Enable billing.</strong> Without it, Google renders a darkened map
            covered in “For development purposes only”.
          </li>
          <li>
            Restrict the key to <code>http://localhost:*</code> before committing anything.
          </li>
          <li>
            Optional: create a Map ID and apply <code>mapStyle.json</code> to it in the
            console. Advanced Markers need a Map ID, and inline styles are ignored once
            one is set.
          </li>
        </ol>
        <p style={{ fontSize: 12.5, color: theme.inkFaint, marginBottom: 0 }}>
          See <code>MAPS.md</code> at the repo root for the cost model — the free tier is
          10,000 map loads per month, and it is per map load, not per user.
        </p>
      </div>
    </div>
  )
}
