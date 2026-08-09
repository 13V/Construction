import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { theme } from '../theme'
import { ghostStyle, labelStyle, fieldStyle } from '../ui/kit'
import { api } from '../data/api'
import { supabase } from '../data/supabase'
import type { WorkerRow } from '../data/supabase'

/**
 * Account deletion — App Store Guideline 5.1.1(v). Self-contained: mount it
 * behind a "Delete account" action anywhere in the worker app and give it
 * `me` and `onClose`; it owns its own overlay, its own confirmation, and its
 * own call to /api/delete-account.
 *
 * A single tap is deliberately not enough — the CONFIRM step below requires
 * typing DELETE — and a bare "are you sure?" is not enough either, because
 * nobody can consent to something they haven't been told the shape of. What
 * REVIEW says is not a simplification for the sake of a friendlier dialog:
 * it is the actual, load-bearing distinction schema_v23.sql draws between a
 * login and a wage record. Getting the two lists wrong here would make the
 * screen lie about what the button does.
 */

type Step = 'review' | 'confirm' | 'working' | 'done' | 'error'

const CONFIRM_WORD = 'DELETE'

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(26,29,33,.55)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 50,
}

const sheet: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  maxHeight: '88vh',
  overflowY: 'auto',
  background: theme.panel,
  borderRadius: '14px 14px 0 0',
  padding: '22px 20px 28px',
}

const heading: CSSProperties = { fontSize: 18, fontWeight: 700, color: theme.ink, margin: 0 }
const sub: CSSProperties = { fontSize: 13, color: theme.inkSoft, lineHeight: 1.5, marginTop: 6 }

const listTitle = (tone: 'kept' | 'goes'): CSSProperties => ({
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  marginTop: 20,
  marginBottom: 8,
  color: tone === 'kept' ? theme.successInk : theme.alertInk,
})

const listItem: CSSProperties = {
  display: 'flex',
  gap: 8,
  fontSize: 13,
  lineHeight: 1.5,
  color: theme.inkMid,
  padding: '7px 0',
  borderTop: `1px solid ${theme.borderSoft}`,
}

const mark = (tone: 'kept' | 'goes'): CSSProperties => ({
  flex: 'none',
  fontWeight: 700,
  color: tone === 'kept' ? theme.successInk : theme.alertInk,
})

/** The one destructive button in this app. theme.alert exists for exactly this. */
const dangerStyle: CSSProperties = {
  width: '100%',
  padding: '11px 13px',
  borderRadius: 6,
  border: `1px solid ${theme.alert}`,
  background: theme.alert,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
}

const dangerDisabledStyle: CSSProperties = {
  ...dangerStyle,
  background: theme.fill,
  border: `1px solid ${theme.border}`,
  color: theme.inkGhost,
  cursor: 'default',
}

const ghostFull: CSSProperties = { ...ghostStyle, width: '100%', marginTop: 10, textAlign: 'center' }

const noteBox = (tone: 'alert' | 'warn'): CSSProperties => ({
  marginTop: 16,
  padding: '11px 13px',
  borderRadius: 6,
  fontSize: 12.5,
  lineHeight: 1.5,
  background: tone === 'alert' ? theme.alertFill : theme.warnFill,
  color: tone === 'alert' ? theme.alertInk : theme.warnInk,
  border: `1px solid ${tone === 'alert' ? theme.alert : theme.warnBorder}`,
})

export function DeleteAccount({ me, onClose }: { me: WorkerRow; onClose: () => void }) {
  const [step, setStep] = useState<Step>('review')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Whether this owner is the ONLY owner is a fact about the whole company,
  // not about `me` alone, so it needs its own query. workers_read (schema.sql)
  // lets any signed-in worker see the roster of their own company — that is
  // all this needs, and it is only ever asked when `me` is an owner.
  const [soleOwner, setSoleOwner] = useState<'checking' | 'yes' | 'no'>(
    me.role === 'owner' ? 'checking' : 'no',
  )

  useEffect(() => {
    if (me.role !== 'owner') return
    let cancelled = false
    void supabase()
      .from('workers')
      .select('id')
      .eq('company_id', me.company_id)
      .eq('role', 'owner')
      // `deleted_at is null`, matching delete_worker_account() EXACTLY — not
      // `active = true`, which is a different question and was the bug here.
      // Deactivating someone on the Crew screen only sets active = false; their
      // login still works and current_is_office() never consults it, so they are
      // still a real owner as far as the server is concerned. Filtering on
      // `active` counted them as gone, so a company whose second owner had been
      // stood down showed the surviving owner "you're the only owner" and
      // disabled the button — while the server would have allowed the deletion.
      // A client check stricter than the server's is a 5.1.1(v) failure for
      // exactly the people the guard was never meant to catch.
      .is('deleted_at', null)
      .neq('id', me.id)
      .then(({ data }) => {
        if (cancelled) return
        // A failed check must not falsely CLEAR the warning — an owner who
        // is blocked from deleting sees that reflected as "checking" turning
        // into a decision, never as the warning disappearing on its own.
        setSoleOwner((data?.length ?? 0) > 0 ? 'no' : 'yes')
      })
    return () => {
      cancelled = true
    }
  }, [me.id, me.company_id, me.role])

  const blocked = me.role === 'owner' && soleOwner === 'yes'

  // Signing out is what actually clears the local session and flips
  // useSession().session to null, which is what sends the app back to
  // AuthScreen — done as a side effect of reaching this step, not of the
  // button on it, so the copy below ("you've been signed out") is true the
  // instant it's shown rather than only after a second tap.
  useEffect(() => {
    if (step === 'done') void supabase().auth.signOut()
  }, [step])

  async function submit() {
    setStep('working')
    setError(null)
    const {
      data: { session },
    } = await supabase().auth.getSession()
    const token = session?.access_token
    if (!token) {
      setError('Your session has expired. Sign in again before deleting your account.')
      setStep('error')
      return
    }
    try {
      const res = await fetch(api('/api/delete-account'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error || 'Could not delete your account. Try again, or contact support.')
        setStep('error')
        return
      }
      setStep('done')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setStep('error')
    }
  }

  return (
    <div style={backdrop} onClick={step === 'working' ? undefined : onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        {step === 'review' && (
          <>
            <h2 style={heading}>Delete your account</h2>
            <p style={sub}>
              This removes your login from Crewline for good. It doesn't erase your work — here's exactly
              what stays and what goes.
            </p>

            <div style={listTitle('kept')}>This stays</div>
            <div style={listItem}>
              <span style={mark('kept')}>✓</span>
              <span>
                Your timesheets and hours worked. Australian law (the Fair Work Act) requires your employer
                to keep pay records for 7 years — deleting your account can't shorten that.
              </span>
            </div>
            <div style={listItem}>
              <span style={mark('kept')}>✓</span>
              <span>
                Site photos, defects and other job records you added. They're evidence about the job, not
                personal data about you.
              </span>
            </div>

            <div style={listTitle('goes')}>This goes</div>
            <div style={listItem}>
              <span style={mark('goes')}>✕</span>
              <span>Your login. You won't be able to sign back in with this account.</span>
            </div>
            <div style={listItem}>
              <span style={mark('goes')}>✕</span>
              <span>
                Your location history — the GPS trail behind your clock-ins. The hours it produced stay; the
                raw trail doesn't.
              </span>
            </div>
            <div style={listItem}>
              <span style={mark('goes')}>✕</span>
              <span>You come off the active crew list — nobody can roster you again.</span>
            </div>

            {me.role === 'owner' && soleOwner === 'checking' && (
              <div style={noteBox('warn')}>Checking whether another owner can take over…</div>
            )}
            {blocked && (
              <div style={noteBox('alert')}>
                You're the only owner of this company. Deleting your account would leave nobody able to see
                pay rates, invoices or contracts. Make another crew member the owner from Crew settings
                first, then come back here.
              </div>
            )}
            {me.role === 'owner' && soleOwner === 'no' && (
              <div style={noteBox('warn')}>
                As the owner, you'll lose office access — pay rates, invoices, contracts — the moment this
                completes. Make sure whoever is taking this over already has it.
              </div>
            )}

            <button
              style={blocked ? dangerDisabledStyle : { ...dangerStyle, marginTop: 20 }}
              disabled={blocked || soleOwner === 'checking'}
              onClick={() => setStep('confirm')}
            >
              Continue
            </button>
            <button style={ghostFull} onClick={onClose}>
              Cancel
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <h2 style={heading}>Type DELETE to confirm</h2>
            <p style={sub}>
              This can't be undone. Once you delete your account you'll need a new invitation from the
              office to sign back in.
            </p>
            <label style={labelStyle} htmlFor="delete-confirm">
              Type {CONFIRM_WORD} to continue
            </label>
            <input
              id="delete-confirm"
              style={fieldStyle}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={CONFIRM_WORD}
            />
            <button
              style={confirmText.trim().toUpperCase() === CONFIRM_WORD ? { ...dangerStyle, marginTop: 20 } : dangerDisabledStyle}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              onClick={() => void submit()}
            >
              Delete my account
            </button>
            <button style={ghostFull} onClick={() => setStep('review')}>
              Back
            </button>
          </>
        )}

        {step === 'working' && (
          <>
            <h2 style={heading}>Deleting your account…</h2>
            <p style={sub}>Don't close the app — this only takes a moment.</p>
          </>
        )}

        {step === 'error' && (
          <>
            <h2 style={heading}>Something went wrong</h2>
            <div style={noteBox('alert')}>{error}</div>
            <button style={{ ...dangerStyle, marginTop: 20 }} onClick={() => void submit()}>
              Try again
            </button>
            <button style={ghostFull} onClick={onClose}>
              Cancel
            </button>
          </>
        )}

        {step === 'done' && (
          <>
            <h2 style={heading}>Your account is deleted</h2>
            <p style={sub}>
              You've been signed out. Your timesheets stay on file with your employer, as required by law —
              everything tied to you personally, including your location history, is gone.
            </p>
            <button
              style={{ ...dangerStyle, marginTop: 20, background: theme.ink, borderColor: theme.ink }}
              onClick={onClose}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  )
}
