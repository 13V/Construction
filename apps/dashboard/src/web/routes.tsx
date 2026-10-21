/**
 * Which page each signed-in route shows.
 *
 * Every page is its own lazily loaded chunk. The first download is the
 * shell (rail, kit, sign-in); a page's code, and anything heavy it brings
 * (the map, the phone's feature panels through phone-features.ts), arrives
 * when somebody opens it.
 *
 * '/', '/signup' and '/reset' while signed in, and any path nobody
 * recognises, go to /jobs. (Signed out, AuthGate shows the front door and
 * this file is not reached.)
 */
import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError, reloadForLatestVersion, type Recovery, type WorkerRow } from './phone'
import { navigate, paths, type Route } from './router'
import { color, space, text } from './tokens'
import { Button } from './ui/Button'
import { Empty } from './ui/Empty'

/** What every page is given. */
export interface PageProps {
  me: WorkerRow
}

const JobsPage = lazy(() => import('./pages/JobsPage'))
const JobFormPage = lazy(() => import('./pages/JobFormPage'))
const JobPage = lazy(() => import('./pages/JobPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const TeamPage = lazy(() => import('./pages/TeamPage'))
const CompanyPage = lazy(() => import('./pages/CompanyPage'))

/** Replace the address with `to`, so Back skips the address that redirected. */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

export function RouteView({ route, me }: { route: Route; me: WorkerRow }) {
  let page: ReactNode
  // One key per page (not per tab), so moving between a job's tabs keeps the
  // job page and its loaded row, while moving to another job starts fresh.
  let key: string = route.name
  switch (route.name) {
    case 'jobs':
      page = <JobsPage me={me} />
      break
    case 'job-new':
      page = <JobFormPage me={me} />
      break
    case 'job-edit':
      page = <JobFormPage me={me} id={route.id} />
      key = `job-edit:${route.id}`
      break
    case 'job':
      page = <JobPage me={me} id={route.id} tab={route.tab} />
      key = `job:${route.id}`
      break
    case 'schedule':
      page = <SchedulePage me={me} />
      break
    case 'chat':
      page = <ChatPage me={me} />
      break
    case 'team':
      page = <TeamPage me={me} />
      break
    case 'company':
      page = <CompanyPage me={me} />
      break
    default:
      return <Redirect to={paths.jobs} />
  }
  return (
    <PageBoundary key={key}>
      <Suspense fallback={<PageLoading />}>{page}</Suspense>
    </PageBoundary>
  )
}

/** While a page's chunk downloads. Quiet, and only after a beat, so a fast load shows nothing. */
export function PageLoading() {
  return (
    <div className="wb-anim-fade" style={{ padding: `${space.xxl}px ${space.xl}px`, ...text.sm, color: color.faint, animationDelay: '.25s', animationFillMode: 'backwards' }}>
      Loading…
    </div>
  )
}

interface PageBoundaryState {
  failed: Error | null
  /** For a page's code file that would not load: what is being done about it ('checking' until it is known). */
  recovery: Recovery | 'checking' | null
}

/** What the page says while its code file is dealt with (data/staleBuild.ts, through ../phone). */
const RELOADING = { title: 'Loading the latest version', body: 'This page did not load, usually because the website was updated while it was open. It is reloading to get the latest version.' }
const RECOVERY_COPY: Record<Recovery | 'checking', { title: string; body: string }> = {
  checking: RELOADING,
  reloading: RELOADING,
  offline: { title: "You're offline", body: 'This page needs a connection to open. It reloads itself once you are back online.' },
  stuck: { title: 'This page could not open', body: 'Its code would not load. Check your connection, then reload.' },
}

/**
 * One page failing must not take the rail with it.
 *
 * The likeliest failure is a deploy that renamed the website's code files
 * while this tab was open: the page asks for a file that is gone. Only a
 * reload fixes that (the failed import is remembered), so the page reloads
 * itself once, as main.tsx's preload-error listener has usually already
 * begun to (one shared, guarded attempt: data/staleBuild.ts), and says so.
 * With no connection it says that instead, and reloads when the connection
 * is back. Anything else that breaks a page offers a reload as before.
 */
class PageBoundary extends Component<{ children: ReactNode }, PageBoundaryState> {
  state: PageBoundaryState = { failed: null, recovery: null }

  private gone = false

  static getDerivedStateFromError(failed: Error): PageBoundaryState {
    return { failed, recovery: isChunkLoadError(failed) ? 'checking' : null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed to render', error, info.componentStack)
    if (isChunkLoadError(error)) this.recover()
  }

  componentWillUnmount() {
    this.gone = true
    window.removeEventListener('online', this.onOnline)
  }

  recover = () => {
    void reloadForLatestVersion().then((recovery) => {
      if (this.gone) return
      this.setState({ recovery })
      if (recovery === 'offline') window.addEventListener('online', this.onOnline, { once: true })
    })
  }

  onOnline = () => {
    this.setState({ recovery: 'checking' })
    this.recover()
  }

  render() {
    const { failed, recovery } = this.state
    if (!failed) return this.props.children
    const reload = (
      <Button variant="primary" onClick={() => window.location.reload()}>
        Reload
      </Button>
    )
    if (recovery) {
      const copy = RECOVERY_COPY[recovery]
      return (
        <div style={{ padding: space.xl }}>
          <Empty title={copy.title} action={reload} data-page-recovery={recovery}>
            {copy.body}
            {recovery === 'stuck' ? ` ${failed.message}` : null}
          </Empty>
        </div>
      )
    }
    return (
      <div style={{ padding: space.xl }}>
        <Empty title="This page could not open" action={reload} data-page-recovery="error">
          Something on it failed. A reload usually fixes that. {failed.message}
        </Empty>
      </div>
    )
  }
}
