/**
 * The website's left rail: charcoal, 232 px, always there.
 *
 * Top to bottom: the name on the door (Proven, powered by Crewline), the one
 * thing this website is mostly for (New job), the four places (Jobs with how
 * many are live, Schedule, Team, Company), and at the bottom who is signed in,
 * the crew app, and Sign out.
 *
 * Every item is a real link or button, so Tab walks the rail and each item
 * shows a white focus ring on the charcoal (web.css .wb-rail-item).
 *
 * Sign out asks first. It signs out this browser only: the default Supabase
 * sign-out is global, which would also end the owner's session in the phone
 * app the next time it refreshed, and nobody signing out of a desk expects
 * their phone to follow.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase, type WorkerRow } from '../phone'
import { WEB_BRAND, WEB_POWERED_BY } from '../marker'
import { linkProps, paths, sectionOf, usePathname, type Route } from '../router'
import { color, space, text } from '../tokens'
import { useFresh } from '../data/useFresh'
import { Button, PlusIcon } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { initialsOf } from '../ui/AvatarStack'

/**
 * The app icon's own tiles (AppIcon-512@2x.png, as the phone's sign-in draws
 * them): four white and one blue. On a light surface pass `framed` for the
 * icon's charcoal square behind them, or the white tiles would vanish.
 */
export function BrandMark({ size = 26, framed = false }: { size?: number; framed?: boolean }) {
  const tiles = (
    <svg width={framed ? size * 0.62 : size} viewBox="195 255 634 514" aria-hidden="true" style={{ display: 'block', height: 'auto' }}>
      <rect x="195" y="255" width="301" height="241" rx="28" fill="#fff" />
      <rect x="529" y="255" width="301" height="241" rx="28" fill="#fff" />
      <rect x="195" y="529" width="134" height="241" rx="28" fill="#fff" />
      <rect x="362" y="529" width="301" height="241" rx="28" fill={color.iconBlue} />
      <rect x="696" y="529" width="134" height="241" rx="28" fill="#fff" />
    </svg>
  )
  if (!framed) return tiles
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: size * 0.24, background: color.ink, flex: 'none' }}>
      {tiles}
    </span>
  )
}

/** Mark, name, and the product underneath, as the phone's sign-in shows them. */
export function BrandLockup({ onDark = true }: { onDark?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
      <BrandMark framed={!onDark} size={onDark ? 26 : 30} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 17, lineHeight: '20px', fontWeight: 700, letterSpacing: '-.02em', color: onDark ? color.onDark : color.ink }}>{WEB_BRAND}</span>
        <span style={{ fontSize: 11.5, lineHeight: '15px', letterSpacing: '.01em', color: onDark ? color.onDarkMuted : color.faint }}>{WEB_POWERED_BY}</span>
      </span>
    </span>
  )
}

/**
 * Sign this browser out, and start the website again at its front door.
 *
 * A full page load rather than a route change: whatever the last person had
 * open (a job, its files' signed URLs, cached rows) goes with them, which on
 * a shared office computer is the point. If the server cannot be reached the
 * session is dropped here anyway, because "Sign out" that leaves you signed
 * in is worse than a refresh token left to expire on the server.
 */
export async function signOutHere(): Promise<void> {
  let ok = false
  try {
    const { error } = await supabase().auth.signOut({ scope: 'local' })
    ok = !error
  } catch {
    ok = false
  }
  if (!ok) {
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (/^sb-.+-auth-token(-code-verifier)?$/.test(key)) window.localStorage.removeItem(key)
      }
    } catch {
      // Storage refused; the reload below shows whatever state is left.
    }
  }
  window.location.replace(paths.home)
}

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
    <path d={d} />
  </svg>
)

const ICONS = {
  // A clipboard: the jobs list.
  jobs: icon('M6.5 3.2h-1.7a1.3 1.3 0 0 0-1.3 1.3v10.2a1.3 1.3 0 0 0 1.3 1.3h8.4a1.3 1.3 0 0 0 1.3-1.3V4.5a1.3 1.3 0 0 0-1.3-1.3h-1.7M6.5 2.2h5v2.2h-5zM6.5 9h5M6.5 12h3.5'),
  // A calendar.
  schedule: icon('M3 5.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 15 5.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 13.5zM3 8h12M6.5 2.5v3M11.5 2.5v3'),
  // Two people.
  team: icon('M7 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM2.5 15c0-2.5 2-4.3 4.5-4.3s4.5 1.8 4.5 4.3M12 3.2a2.5 2.5 0 0 1 0 4.8M13.6 10.9c1.2.6 1.9 2 1.9 3.6'),
  // A building.
  company: icon('M3.5 15.5V3.8a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v11.7M11.5 7h2a1 1 0 0 1 1 1v7.5M2.5 15.5h13M6 5.8h2.5M6 8.5h2.5M6 11.2h2.5'),
  // A phone.
  crew: icon('M5.5 2.5h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 13h2'),
  // A door with an arrow out.
  signOut: icon('M7 15.5H4.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H7M11.5 12.5L15 9l-3.5-3.5M15 9H7'),
}

const NAV = [
  { key: 'jobs', label: 'Jobs', href: paths.jobs },
  { key: 'schedule', label: 'Schedule', href: paths.schedule },
  { key: 'team', label: 'Team', href: paths.team },
  { key: 'company', label: 'Company', href: paths.company },
] as const

export function Rail({ me, route }: { me: WorkerRow; route: Route }) {
  const pathname = usePathname()
  const [company, setCompany] = useState<string | null>(null)
  const [live, setLive] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let gone = false
    void supabase()
      .from('companies')
      .select('name')
      .eq('id', me.company_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!gone) setCompany((data as { name: string } | null)?.name ?? null)
      })
    return () => {
      gone = true
    }
  }, [me.company_id])

  // Active plus Future: the jobs a crew can be sent to. A plain select of
  // ids, not a count query, so it is a GET like every other read here.
  const countJobs = useCallback(() => {
    void supabase()
      .from('job_sites')
      .select('id')
      .in('status', ['active', 'starting_soon'])
      .then(({ data, error }) => {
        if (!error) setLive(data?.length ?? 0)
      })
  }, [])
  // Again after every navigation, so a job just created or archived is counted.
  useEffect(countJobs, [countJobs, pathname])
  useFresh(countJobs)

  const here = sectionOf(route)

  return (
    // Layout is in web.css (.wb-rail, .wb-rail-nav, .wb-rail-foot): under
    // 768 px it turns into a bar across the top, which inline styles here
    // would override.
    <aside className="wb-rail">
      <a {...linkProps(paths.jobs)} className="wb-rail-item" aria-label={`${WEB_BRAND} — Jobs`} style={{ height: 'auto', padding: `${space.xxs}px ${space.xs}px`, color: color.onDark }}>
        <BrandLockup />
      </a>

      <Button variant="light" href={paths.jobNew} icon={<PlusIcon />} style={{ justifyContent: 'flex-start', paddingLeft: 14 }}>
        New job
      </Button>

      <nav aria-label="Main">
        <ul className="wb-rail-nav">
          {NAV.map((item) => (
            <li key={item.key}>
              <a {...linkProps(item.href)} className="wb-rail-item" aria-current={here === item.key ? 'page' : undefined}>
                {ICONS[item.key]}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.key === 'jobs' && live !== null && live > 0 && (
                  <span aria-label={`${live} active and future`} style={{ ...text.xs, fontWeight: 600, color: color.onDarkMuted }}>
                    {live}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="wb-rail-foot">
        {/* Who is signed in: hidden on the narrow top bar (web.css), where it does not fit. */}
        <div className="wb-rail-wide-only">
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.sm}px ${space.xs}px`, marginBottom: space.xxs, borderTop: `1px solid ${color.railRule}` }}>
            <span aria-hidden="true" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: color.charcoal, fontSize: 11.5, fontWeight: 700, color: color.onDark }}>
              {initialsOf(me)}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ ...text.sm, fontWeight: 600, color: color.onDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</span>
              {company && <span style={{ ...text.xs, color: color.onDarkMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company}</span>}
            </span>
          </div>
        </div>
        <a href={paths.worker} className="wb-rail-item">
          {ICONS.crew}
          Open the crew app
        </a>
        <button type="button" className="wb-rail-item wb-rail-item--button" onClick={() => setAsking(true)}>
          {ICONS.signOut}
          Sign out
        </button>
      </div>

      <Dialog
        open={asking}
        title={`Sign out of ${WEB_BRAND}?`}
        confirmLabel="Sign out"
        busy={leaving}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setLeaving(true)
          void signOutHere()
        }}
      >
        This signs out this browser only. The app on your phone, and on your crew's, stays signed in.
      </Dialog>
    </aside>
  )
}
