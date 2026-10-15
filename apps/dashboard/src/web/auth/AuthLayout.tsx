/**
 * The website's front door: every screen someone sees before the workspace
 * (sign in, sign up, reset, finish setup, the not-the-office card, the error
 * and set-up notices) sits in this one frame.
 *
 * A split page at a desk: on the left, the charcoal of the phone's sign-in
 * hero with the app icon's tiles, the name on the App Store listing (Proven,
 * powered by Crewline) and what the website is for; on the right, a 400 px
 * white card on the phone's app background, with Privacy and Support under it.
 * Below 900 px the charcoal shrinks to a band across the top, so the form is
 * what a phone-width window shows first.
 *
 * The layout switch is a media query read in JavaScript, because the frame is
 * inline-styled like the rest of the codebase and inline styles cannot hold a
 * media query; web.css belongs to the shell.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { WEB_BRAND, WEB_POWERED_BY } from '../marker'
import { paths } from '../router'
import { BrandMark } from '../shell/Rail'
import { color, radius, shadow, space, text } from '../tokens'

const NARROW = '(max-width: 899px)'

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(NARROW)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True below 900 px: the brand panel becomes a band and the card goes full width. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches, () => false)
}

export interface AuthLayoutProps {
  children: ReactNode
  /** Under the card, centred: "Joining your company's crew? Use the phone app." */
  footnote?: ReactNode
}

export function AuthLayout({ children, footnote }: AuthLayoutProps) {
  const narrow = useNarrow()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: narrow ? 'column' : 'row', background: color.appBg }}>
      <BrandPanel narrow={narrow} />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: narrow ? `${space.lg}px ${space.md}px ${space.md}px` : `${space.xl}px ${space.xl}px ${space.lg}px`,
          boxSizing: 'border-box',
        }}
      >
        {/* Centred in the height that is left, but never pushed off the top
            when a long form (sign-up with its errors) is taller than the window. */}
        <div style={{ flex: 1, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: space.md }}>
          <div
            className="wb-anim-fade"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: space.md + 4,
              padding: narrow ? space.lg : space.xl,
              background: color.panel,
              border: `1px solid ${color.borderSoft}`,
              borderRadius: radius.lg,
              boxShadow: shadow.card,
            }}
          >
            {children}
          </div>
          {footnote && <div style={{ ...text.sm, color: color.muted, textAlign: 'center', padding: `0 ${space.xs}px` }}>{footnote}</div>}
        </div>
        <LegalLinks />
      </main>
    </div>
  )
}

/** The page's title and the sentence under it, at the top of the card. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.xxs + 2 }}>
      <h1 style={{ margin: 0, ...text.title, color: color.ink }}>{title}</h1>
      {children && <p style={{ margin: 0, ...text.base, color: color.body }}>{children}</p>}
    </div>
  )
}

/** The email typed on any front-door page, kept as the person moves between them. */
export interface FrontDoorProps {
  email: string
  onEmail: (email: string) => void
}

/**
 * Under sign-in and sign-up: crew do not sign up here. Their office adds them
 * on the phone (Me, Crew) and they make their login in the app.
 */
export function CrewFootnote() {
  return <>Joining your company’s crew? Use the {WEB_BRAND} app.</>
}

/** A hairline between the form and the other way in. */
export function AuthDivider() {
  return <div role="presentation" style={{ height: 1, background: color.borderSoft, margin: `${space.xxs}px 0` }} />
}

/**
 * The charcoal side. Two tones of the one sentence the website lives by,
 * large: what you do here, and where it goes.
 */
function BrandPanel({ narrow }: { narrow: boolean }) {
  if (narrow) {
    return (
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.md}px ${space.md}px`, background: color.inkDeep }}>
        <BrandMark size={28} />
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 17, lineHeight: '20px', fontWeight: 700, letterSpacing: '-.02em', color: color.onDark }}>{WEB_BRAND}</span>
          <span style={{ fontSize: 11.5, lineHeight: '15px', color: color.onDarkMuted }}>{WEB_POWERED_BY}</span>
        </span>
      </header>
    )
  }
  return (
    <aside
      style={{
        flex: '0 0 42%',
        maxWidth: 600,
        minWidth: 400,
        position: 'sticky',
        top: 0,
        height: '100vh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        padding: `${space.xxl}px ${space.xxl}px ${space.xl}px`,
        // The phone sign-in's hero gradient, run to the page's inkDeep.
        background: `linear-gradient(170deg, #24282D 0%, ${color.inkDeep} 62%)`,
        color: color.onDark,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.md }}>
        <BrandMark size={44} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 28, lineHeight: '32px', fontWeight: 700, letterSpacing: '-.025em' }}>{WEB_BRAND}</span>
          <span style={{ ...text.sm, color: color.onDarkMuted }}>{WEB_POWERED_BY}</span>
        </div>
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: space.lg }}>
        <p style={{ margin: 0, fontSize: 34, lineHeight: '40px', fontWeight: 600, letterSpacing: '-.025em' }}>
          Set jobs up here.
          <br />
          {/* Broken by hand: left to wrap, "phone." ends up alone on a line. */}
          <span style={{ color: color.onDarkMuted }}>
            Your crew run them
            <br />
            on the phone.
          </span>
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: space.xs, ...text.base, color: color.ghost }}>
          {['The address, the fence and the builder', 'Who is on it, and when', 'Scope, drawings and safety'].map((line) => (
            <li key={line} style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none' }}>
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke={color.onDarkMuted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

/**
 * The legal lines every sign-in owes, reachable with no account: the same
 * pages the App Store listing links to. A new tab, so a half-filled sign-up
 * is still there when the person comes back.
 */
function LegalLinks() {
  const link = { ...text.sm, fontWeight: 600, color: color.muted, textDecoration: 'none', padding: `${space.xxs}px ${space.xxs}px` } as const
  return (
    <nav aria-label="Legal" style={{ display: 'flex', alignItems: 'center', gap: space.xxs, paddingTop: space.lg }}>
      <a href={paths.privacy} target="_blank" rel="noopener" className="wb-focus" style={link}>
        Privacy
      </a>
      <span aria-hidden="true" style={{ color: color.ghost }}>
        ·
      </span>
      <a href={paths.support} target="_blank" rel="noopener" className="wb-focus" style={link}>
        Support
      </a>
    </nav>
  )
}

/**
 * The card's content once an email has gone: a big envelope, "Check your
 * email", what to do with it, and the way back. role="status" so a screen
 * reader says it without being asked.
 */
export function EmailSent({ title = 'Check your email', children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: radius.lg, background: color.greenFill, color: color.green }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="M3.8 7l8.2 6 8.2-6" />
        </svg>
      </span>
      <AuthHeading title={title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm, ...text.base, color: color.body }}>{children}</div>
      {actions && <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs, marginTop: space.xxs }}>{actions}</div>}
    </div>
  )
}
