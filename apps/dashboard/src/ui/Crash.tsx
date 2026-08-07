import { Component, type ErrorInfo, type ReactNode } from 'react'
import { theme } from '../theme'

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
 */

interface Props {
  children: ReactNode
  /** Names the surface in the message, e.g. "Crewline" or "the worker app". */
  surface: string
}

interface State {
  error: Error | null
}

export class Crash extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error reporting service is wired up, so the console is the only
    // record. Keep the component stack — it is the part that says which screen
    // threw, and it is not in the message.
    console.error('Unhandled error in', this.props.surface, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

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
        <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <strong style={{ fontSize: 17 }}>{this.props.surface} hit a problem</strong>
          <p style={{ margin: 0, color: theme.inkSoft }}>
            Something on this screen failed to load. Nothing you have entered has been lost, and any
            hours already recorded are safe on the server.
          </p>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => this.setState({ error: null })} style={primary}>
              Try again
            </button>
            <button onClick={() => window.location.reload()} style={secondary}>
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
