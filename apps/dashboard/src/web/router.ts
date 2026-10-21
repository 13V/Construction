/**
 * The website's router: the History API and a parser, no dependency.
 *
 * vercel.json already serves index.html for every path that is not /api, and
 * main.tsx claims /privacy, /support and /worker before the website is ever
 * loaded, so everything else arriving here is the website's to interpret.
 *
 * Signed out:  /  /signup  /reset
 * Signed in:   /jobs  /jobs/new  /jobs/:id  /jobs/:id/<tab>  /jobs/:id/edit
 *              /schedule  /chat  /team  /company
 * Signed in, / and anything unknown redirect to /jobs (routes.tsx).
 */
import { useMemo, useSyncExternalStore, type MouseEvent } from 'react'

/** The job page's tabs, in the order they are shown. Overview is the bare /jobs/:id. */
export type JobTab = 'overview' | 'scope' | 'drawings' | 'waterproofing' | 'safety' | 'money' | 'crew' | 'photos' | 'chat'

export const JOB_TABS: ReadonlyArray<{ key: JobTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'scope', label: 'Scope' },
  { key: 'drawings', label: 'Drawings' },
  { key: 'waterproofing', label: 'Waterproofing' },
  { key: 'safety', label: 'Safety' },
  { key: 'money', label: 'Money' },
  { key: 'crew', label: 'Crew' },
  { key: 'photos', label: 'Photos' },
  { key: 'chat', label: 'Chat' },
]

export type Route =
  | { name: 'home' }
  | { name: 'signup' }
  | { name: 'reset' }
  | { name: 'jobs' }
  | { name: 'job-new' }
  | { name: 'job'; id: string; tab: JobTab }
  | { name: 'job-edit'; id: string }
  | { name: 'schedule' }
  | { name: 'chat' }
  | { name: 'team' }
  | { name: 'company' }
  | { name: 'unknown'; path: string }

/**
 * Job ids are uuids. Anything else under /jobs/ is a typo or a stale link,
 * and is treated as unknown here rather than sent to Postgres, which answers
 * a malformed uuid with a 400 instead of "no such job".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TAB_KEYS = new Set<string>(JOB_TABS.map((t) => t.key))

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  const unknown: Route = { name: 'unknown', path }
  if (parts.length === 0) return { name: 'home' }
  const [first, second, third, ...rest] = parts
  if (parts.length === 1) {
    switch (first) {
      case 'signup':
        return { name: 'signup' }
      case 'reset':
        return { name: 'reset' }
      case 'jobs':
        return { name: 'jobs' }
      case 'schedule':
        return { name: 'schedule' }
      case 'chat':
        return { name: 'chat' }
      case 'team':
        return { name: 'team' }
      case 'company':
        return { name: 'company' }
      default:
        return unknown
    }
  }
  if (first !== 'jobs' || rest.length > 0) return unknown
  if (second === 'new') return third === undefined ? { name: 'job-new' } : unknown
  if (!UUID.test(second)) return unknown
  const id = second.toLowerCase()
  if (third === undefined) return { name: 'job', id, tab: 'overview' }
  if (third === 'edit') return { name: 'job-edit', id }
  if (TAB_KEYS.has(third)) return { name: 'job', id, tab: third as JobTab }
  return unknown
}

/** Every path the website links to, built in one place. */
export const paths = {
  home: '/',
  signup: '/signup',
  reset: '/reset',
  jobs: '/jobs',
  jobNew: '/jobs/new',
  job: (id: string, tab: JobTab = 'overview') => (tab === 'overview' ? `/jobs/${id}` : `/jobs/${id}/${tab}`),
  jobEdit: (id: string) => `/jobs/${id}/edit`,
  schedule: '/schedule',
  chat: '/chat',
  team: '/team',
  company: '/company',
  /** The crew app in a browser. Another surface: a full page load, never a push. */
  worker: '/worker',
  privacy: '/privacy',
  support: '/support',
} as const

/**
 * Paths main.tsx routes to a different surface (or the server does). They
 * need a real page load, because the surface is chosen once, at load.
 */
const OTHER_SURFACE = /^\/(worker|privacy|support|api)(\/|$)/

const NAV_EVENT = 'wb:navigate'

/**
 * Go somewhere in the website. `replace` swaps the current history entry,
 * for redirects that Back should skip.
 */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  const url = new URL(to, window.location.href)
  if (url.origin !== window.location.origin || OTHER_SURFACE.test(url.pathname)) {
    if (replace) window.location.replace(url.href)
    else window.location.assign(url.href)
    return
  }
  const next = url.pathname + url.search + url.hash
  const here = window.location.pathname + window.location.search + window.location.hash
  if (next === here) return
  if (replace) window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
  window.dispatchEvent(new Event(NAV_EVENT))
  // A new page starts at its top, as a page load would.
  if (!replace) window.scrollTo(0, 0)
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAV_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAV_EVENT, onChange)
  }
}

/** The current path, re-rendering on every navigation and on Back/Forward. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

/** The current query string, including its '?', or ''. */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search)
}

export function useRoute(): Route {
  const pathname = usePathname()
  return useMemo(() => parseRoute(pathname), [pathname])
}

/**
 * href and onClick for an <a> that navigates inside the website: a real link
 * (Cmd-click and middle-click still open a new tab, the address shows on
 * hover) that does not reload the page when clicked plainly.
 */
export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = (e.currentTarget as HTMLElement).getAttribute('target')
      if (target && target !== '_self') return
      if (OTHER_SURFACE.test(to) || /^[a-z]+:/i.test(to)) return
      e.preventDefault()
      navigate(to)
    },
  }
}

/** Which rail item a route belongs to. */
export function sectionOf(route: Route): 'jobs' | 'schedule' | 'chat' | 'team' | 'company' | null {
  switch (route.name) {
    case 'jobs':
    case 'job':
    case 'job-new':
    case 'job-edit':
      return 'jobs'
    case 'schedule':
    case 'chat':
    case 'team':
    case 'company':
      return route.name
    default:
      return null
  }
}
