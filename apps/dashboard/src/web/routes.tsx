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
import type { WorkerRow } from './phone'
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

/**
 * One page failing must not take the rail with it. The likeliest failure is
 * a deploy that renamed the chunks while this tab was open, which a reload
 * fixes, so that is what it offers.
 */
class PageBoundary extends Component<{ children: ReactNode }, { failed: Error | null }> {
  state: { failed: Error | null } = { failed: null }

  static getDerivedStateFromError(failed: Error) {
    return { failed }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div style={{ padding: space.xl }}>
        <Empty title="This page could not open" action={<Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>}>
          If the website was just updated, a reload fetches the new version. {this.state.failed.message}
        </Empty>
      </div>
    )
  }
}
