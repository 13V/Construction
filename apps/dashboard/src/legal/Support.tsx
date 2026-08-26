import type { CSSProperties, ReactNode } from 'react'
import { theme, font } from '../theme'
import { Panel, PanelHead, LABEL } from '../ui/kit'

/**
 * The support page behind the App Store listing's Support URL.
 *
 * Apple requires that URL to reach somewhere a user can actually get help,
 * and checks it during review. Like the privacy policy this has to render
 * with nothing signed in — a reviewer opens it cold, with no account — so it
 * takes no session, makes no data fetch, and lives outside the auth gate.
 *
 * The address is the studio's, not a per-customer one, and it is the address
 * published on the App Store listing as the Support URL's contact. Keep the
 * two the same: a reviewer who finds a support page naming a different
 * address than the listing treats it as a broken support channel.
 */
const CONTACT = 'hello@lumenadl.com'

const shell: CSSProperties = {
  minHeight: '100vh',
  background: theme.appBg,
  color: theme.ink,
  font: `14px ${font}`,
}

const inner: CSSProperties = { maxWidth: 640, margin: '0 auto', padding: '28px 18px 56px' }

const h1Style: CSSProperties = { fontSize: 22, fontWeight: 700, color: theme.ink, margin: '0 0 4px' }

const kickerStyle: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: LABEL,
  margin: '0 0 20px',
}

const introStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: theme.inkMid,
  margin: '0 0 24px',
}

const h2Style: CSSProperties = { fontSize: 15.5, fontWeight: 700, color: theme.ink, margin: '30px 0 10px' }

const pStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.65,
  color: theme.inkMid,
  margin: '0 0 12px',
  textWrap: 'pretty',
}

const linkStyle: CSSProperties = { color: theme.accent, fontWeight: 600 }

function P({ children }: { children: ReactNode }) {
  return <p style={pStyle}>{children}</p>
}

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <section style={{ margin: '0 0 18px' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: theme.ink, margin: '0 0 6px' }}>{q}</h3>
      <div>{children}</div>
    </section>
  )
}

export function Support() {
  return (
    <div style={shell}>
      <div style={inner}>
        <h1 style={h1Style}>Crewline Support</h1>
        <p style={kickerStyle}>Help for crews and office staff</p>

        <p style={introStyle}>
          Crewline records site hours from where your crew actually are, and keeps each job&rsquo;s
          drawings, waterproofing records and safety documents together. If something isn&rsquo;t
          working, or you want a hand setting your company up, write to us.
        </p>

        <Panel style={{ margin: '0 0 8px' }}>
          <PanelHead>Contact</PanelHead>
          <div style={{ padding: '13px 15px' }}>
            <P>
              Email{' '}
              <a href={`mailto:${CONTACT}`} style={linkStyle}>
                {CONTACT}
              </a>
              . We answer within two business days, Australian Central Time.
            </P>
            <P>
              Tell us your company name and, if it&rsquo;s about a particular job or shift, the job
              name and the date. That is usually enough to find it.
            </P>
          </div>
        </Panel>

        <h2 style={h2Style}>Common questions</h2>

        <Q q="My hours didn't record.">
          <P>
            Shifts start and stop from your location, not from a button. Check that location
            permission is set to <strong>Always</strong> in iOS Settings &rsaquo; Crewline, and that
            tracking is switched on in the app. Crewline waits a couple of minutes after you arrive
            before opening a shift, so it does not log you on when you drive past a site.
          </P>
        </Q>

        <Q q="I can't sign in.">
          <P>
            Check the address for a typo first. If you have just signed up, open the confirmation
            email we sent before signing in. If you have tried a few times in quick succession,
            wait an hour — new sign-ups are rate limited — and nothing you entered is lost.
          </P>
        </Q>

        <Q q="How do I add someone to my company?">
          <P>
            Open <strong>Me</strong>, then your company, then <strong>Crew</strong>. Only owners and
            office staff can add people or change what someone is allowed to see.
          </P>
        </Q>

        <Q q="I want my data deleted.">
          <P>
            Email us from the address on the account. Note that if you are a worker, your hours and
            location history form part of your employer&rsquo;s employment records — we will explain
            what can be removed and what your employer controls.
          </P>
        </Q>

        <h2 style={h2Style}>Privacy</h2>
        <P>
          Crewline records precise location while tracking is on, including before you clock on and
          on the way home. What is collected, who can see it and how long it is kept is set out in
          full in the{' '}
          <a href="/privacy" style={linkStyle}>
            privacy policy
          </a>
          .
        </P>
      </div>
    </div>
  )
}
