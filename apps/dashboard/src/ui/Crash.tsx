import { Component, type ErrorInfo, type ReactNode } from 'react'
import { theme } from '../theme'
import { isChunkLoadError, reloadForLatestVersion, type Recovery } from '../data/staleBuild'

/**
 * The last line of defence.
 *
 * React unmounts the whole tree when a render throws, so without this the app
 * becomes a white page — no message, no navigation, no way back. That is a bad
 * outcome anywhere and a worse one on a phone at a job site, where the worker
 * has no idea whether their hours are still being recorded.
 *
 * One bad row of data should cost the screen it is on, not the session. This
 * catches the throw, says what happened in words, and offers the two things
 * that actually recover: try again without losing the session, or reload.
 *
 * A code file that would not load (a lazy screen, or its stylesheet) is
 * different: Try again cannot fix it, because React and the browser both
 * remember a failed import, and the usual cause is a deploy that replaced the
 * file while the page was open. data/staleBuild.ts reloads the page once to
 * get the latest version, unless there is no connection, in which case it
 * reloads once the connection is back. This says which of those is happening.
 */

interface Props {
  children: ReactNode
  /** Names the surface in the message, e.g. "Crewline" or "the worker app". */
  surface: string
}

interface State {
  error: Error | null
  /** For a code file that would not load: what is being done about it ('checking' until it is known). */
  recovery: Recovery | 'checking' | null
}

const RELOADING = {
  title: 'Loading the latest version',
  body: 'Part of the app did not load, usually because it was updated while this page was open. It is reloading to get the latest version. Anything already saved, hours included, is safe on the server.',
}

/** What the screen says while a code file that would not load is dealt with. */
const CHUNK_COPY: Record<Recovery | 'checking', { title: string; body: string }> = {
  checking: RELOADING,
  reloading: RELOADING,
  offline: {
    title: "You're offline",
    body: 'Part of the app could not load without a connection. Anything already saved, hours included, is safe on the server. This page reloads itself once you are back online.',
  },
  stuck: {
    title: 'Part of the app would not load',
    body: 'Check your connection, then reload. Anything already saved, hours included, is safe on the server. If it keeps happening, the message below is what to pass on.',
  },
}

export class Crash extends Component<Props, State> {
  state: State = { error: null, recovery: null }

  private gone = false

  static getDerivedStateFromError(error: Error): State {
    return { error, recovery: isChunkLoadError(error) ? 'checking' : null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error reporting service is wired up, so the console is the only
    // record. Keep the component stack — it is the part that says which screen
    // threw, and it is not in the message.
    console.error('Unhandled error in', this.props.surface, error, info.componentStack)
    if (isChunkLoadError(error)) this.recover()
  }

  componentWillUnmount() {
    this.gone = true
    window.removeEventListener('online', this.handleOnline)
  }

  recover = () => {
    void reloadForLatestVersion().then((recovery) => {
      if (this.gone) return
      this.setState({ recovery })
      // Without this the offline screen sat there after signal returned until
      // somebody tapped Reload. Clearing the error is no use (the failed import
      // is remembered), so the connection coming back reloads the page instead.
      if (recovery === 'offline') window.addEventListener('online', this.handleOnline, { once: true })
    })
  }

  handleOnline = () => {
    this.setState({ recovery: 'checking' })
    this.recover()
  }

  render() {
    const { error, recovery } = this.state
    if (!error) return this.props.children
    const chunk = recovery ? CHUNK_COPY[recovery] : null
    const showMessage = !chunk || recovery === 'stuck'

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: theme.appBg,
          font: '14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: theme.ink,
        }}
      >
        <div data-crash={recovery ?? 'error'} style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <strong style={{ fontSize: 17 }}>{chunk ? chunk.title : `${this.props.surface} hit a problem`}</strong>
          <p style={{ margin: 0, color: theme.inkSoft }}>
            {chunk
              ? chunk.body
              : 'Something on this screen failed to load. Nothing you have entered has been lost, and any hours already recorded are safe on the server.'}
          </p>
          {showMessage && (
            <code
              style={{
                padding: '9px 11px',
                borderRadius: 4,
                background: theme.fill,
                border: `1px solid ${theme.border}`,
                fontSize: 12,
                color: theme.inkSoft,
                wordBreak: 'break-word',
              }}
            >
              {error.message || String(error)}
            </code>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {!chunk && (
              <button onClick={() => this.setState({ error: null, recovery: null })} style={primary}>
                Try again
              </button>
            )}
            <button onClick={() => window.location.reload()} style={chunk ? primary : secondary}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

const base = {
  height: 32,
  padding: '0 15px',
  borderRadius: 3,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
} as const

const primary = {
  ...base,
  background: theme.cta,
  border: `1px solid ${theme.ctaBorder}`,
  color: theme.ink,
} as const

const secondary = {
  ...base,
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  color: theme.ink,
} as const
