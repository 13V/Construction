import type { CSSProperties, ReactNode } from 'react'
import { theme, font } from '../theme'
import { Panel, PanelHead, LABEL } from '../ui/kit'
import { apiBase } from '../data/api'

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
 *
 * Every answer describes the apps as they are, by the words on their
 * buttons: the iPhone app is "Proven" (in Settings too), it asks for
 * location While Using the App only, and it has no password reset of its
 * own, so a forgotten password is reset on the website. Change an answer
 * when the screen it describes changes.
 */
const CONTACT = 'hello@lumenadl.com'

/**
 * The website: the phone app's own server (VITE_API_BASE in the iOS build,
 * where this page is opened from the app's bundle), or this page's origin
 * when the website itself serves it.
 */
const WEBSITE = apiBase || (typeof window === 'undefined' ? '' : window.location.origin)
const RESET_URL = `${WEBSITE}/reset`
const RESET_LABEL = RESET_URL.replace(/^https?:\/\//, '')

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
        <h1 style={h1Style}>Proven Support</h1>
        <p style={kickerStyle}>Help for crews and office staff &middot; Powered by Crewline</p>

        <p style={introStyle}>
          Proven records site hours from where your crew actually are, and keeps each job&rsquo;s
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
            Proven only records hours while the app is open and tracking is on. On the clock screen
            (it opens first for crew, or go to <strong>Me</strong> &rsaquo;{' '}
            <strong>Location while working</strong>), tap <strong>START TRACKING</strong> before you
            get to the job. Once you have been inside the job&rsquo;s boundary for two minutes with
            the app open, you are clocked on. You can also tap <strong>Clock in manually</strong> when
            you arrive; it still checks you are inside the boundary.
          </P>
          <P>
            Nothing is recorded while the app is closed or your phone is locked, so open it when you
            get to site. When you leave, tap <strong>CLOCK OUT</strong>, then{' '}
            <strong>END MY SHIFT NOW</strong>. If the app is open as you drive off, it clocks you off
            by itself a few minutes after you leave, timed from when you left.
          </P>
          <P>
            Check the location permission too: in Settings &rsaquo; Proven &rsaquo; Location, choose{' '}
            <strong>While Using the App</strong>, and leave <strong>Precise Location</strong> on. The
            app never asks for Always.
          </P>
          <P>
            If a shift is still missing or wrong, tell your office, and write to us with the job and
            the date. Neither app can change a recorded shift yet.
          </P>
        </Q>

        <Q q="I can't sign in.">
          <P>
            Check the email address for a typo first. If you have forgotten your password, set a new
            one on the website at{' '}
            <a href={RESET_URL} target="_blank" rel="noreferrer" style={linkStyle}>
              {RESET_LABEL}
            </a>{' '}
            (the app has no password reset of its own yet), then sign in to the app with the new one.
          </P>
          <P>
            If your office has added you to the crew, make your login on the app&rsquo;s sign-in
            screen with <strong>My office added me. Create my login</strong>, using the email address
            your office has for you. If you have just made your login, open the confirmation email we
            sent before signing in. If it says too many accounts have been set up in the last hour,
            wait about an hour and try again — nothing you entered is lost.
          </P>
        </Q>

        <Q q="How do I add someone to my company?">
          <P>
            On the website, open <strong>Team</strong> and choose <strong>Add someone</strong>. In the
            app, open <strong>Me</strong>, then <strong>Your crew</strong>, then{' '}
            <strong>Add someone</strong>. Give their name, their role and the email address they will
            sign up with; they then make their login in the app with{' '}
            <strong>My office added me. Create my login</strong>, using that address. Only people with
            an Office login can add or remove people.
          </P>
        </Q>

        <Q q="I want my data deleted.">
          <P>
            In the app, open <strong>Me</strong> &rsaquo; <strong>Account &amp; privacy</strong>{' '}
            &rsaquo; <strong>Delete my account</strong>. It removes your login, your location reports,
            and your profile photo and phone number straight away. Your timesheets stay: they are part
            of your employer&rsquo;s employment records, which the law requires them to keep.
          </P>
          <P>
            If you are the only person with an Office login at your company, deleting your account
            deletes the company as well, with everything in it, for everyone. To keep the company
            running, add someone as Office first (<strong>Me</strong> &rsaquo;{' '}
            <strong>Your crew</strong> &rsaquo; <strong>Add someone</strong>). For anything else,
            email us from the address on the account and we will explain what can be removed and
            what your employer controls.
          </P>
        </Q>

        <h2 style={h2Style}>Privacy</h2>
        <P>
          Proven records your precise location only while tracking is on and the app is open,
          including on the way to a job if it is open then. There is no map of it, and the location
          reports are deleted after 3 days. What is collected, who can see it and how long it is kept
          is set out in full in the{' '}
          <a href="/privacy" style={linkStyle}>
            privacy policy
          </a>
          .
        </P>
      </div>
    </div>
  )
}
