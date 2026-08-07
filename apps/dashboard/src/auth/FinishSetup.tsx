import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../data/supabase'
import { theme } from '../theme'

/**
 * Signed in, but no `workers` row yet.
 *
 * This is the normal landing spot once email confirmation is on: signup can't
 * finish the setup because it has no session until the link is clicked, and
 * the click often lands in a different browser than the one that signed up.
 * So the details are asked for again here rather than stashed client-side,
 * where they would not survive the hop.
 *
 * Every RLS policy keys off the worker row, so until this is done the account
 * can see nothing at all — which is why this is a step and not a warning.
 */
export function FinishSetup({ session, onDone }: { session: Session; onDone: () => void }) {
  const [joining, setJoining] = useState(false)
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await supabase().auth.getSession()
      const token = data.session?.access_token ?? session.access_token
      const res = await fetch('/api/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(joining ? {} : { companyName: company.trim(), name: name.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Could not finish setting up the account')
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: theme.appBg,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 'min(420px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 24,
          background: theme.panel,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>One more step</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: theme.inkSoft }}>
            Your email is confirmed. Tell us which company this login belongs to and you're in.
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={joining}
            onChange={(e) => setJoining(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            My office already added me to a crew
            <span style={{ display: 'block', fontSize: 12, color: theme.inkFaint }}>
              Your login claims the record they created for {session.user.email}.
            </span>
          </span>
        </label>

        {!joining && (
          <>
            <Field label="Company name">
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
                placeholder="Whitcomb Builders"
                style={input}
              />
            </Field>
            <Field label="Your name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Ray Whitcomb"
                style={input}
              />
            </Field>
          </>
        )}

        {error && (
          <div style={{ padding: '8px 11px', borderRadius: 4, background: theme.alertFill, color: theme.alertInk, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            height: 40,
            border: `1px solid ${theme.ctaBorder}`,
            borderRadius: 3,
            background: theme.cta,
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 700,
            letterSpacing: '.04em',
            color: theme.ink,
            cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'SETTING UP…' : joining ? 'JOIN MY CREW' : 'CREATE THE COMPANY'}
        </button>

        <button
          type="button"
          onClick={() => void supabase().auth.signOut()}
          style={{ border: 'none', background: 'none', font: 'inherit', fontSize: 12.5, color: theme.accent, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: theme.inkSoft }}>
        {label.toUpperCase()}
      </span>
      {children}
    </label>
  )
}

const input = {
  height: 36,
  padding: '0 10px',
  border: `1px solid ${theme.border}`,
  borderRadius: 3,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13.5,
  color: theme.ink,
  outline: 'none',
} as const
