/**
 * The website's one way in (main.tsx imports it only as '@web/entry', inside
 * officeSurface(), so a phone build never reaches it). For now a placeholder:
 * the new website is previewed at /?web=new while it is built, and the old
 * office dashboard stays at / until it replaces it.
 */
export default function WebEntry() {
  return (
    <div
      data-web-root="crewline-web-surface"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#F5F6F7',
        color: '#1A1D21',
        font: '15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 380 }}>
        <div style={{ fontSize: 21, fontWeight: 600, marginBottom: 8 }}>Proven</div>
        <p style={{ margin: 0, color: '#4A5057' }}>
          The new website is being built. Open <a href="/?web=old">the current dashboard</a> in the meantime.
        </p>
      </div>
    </div>
  )
}
