/**
 * One job, /jobs/:id and /jobs/:id/<tab>. A working SKELETON from the
 * website's foundation: it loads the job, shows a plain header and the tab
 * row, and lazy-loads the open tab. The package that builds the real job
 * page (header, Overview) replaces this file and keeps the tab routing.
 *
 * The job is read by id with no status filter, so an archived job opens
 * too: the board links to archived jobs, and Restore lives on this page.
 * Each tab is its own chunk, given { me, site, reloadJob } (job/types.ts).
 */
import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { useFresh } from '../data/useFresh'
import type { JobTabProps } from '../job/types'
import { addressLine, builderOf, railOf, supabase, type JobSiteRow } from '../phone'
import { PageLoading, type PageProps } from '../routes'
import { JOB_TABS, linkProps, paths, type JobTab } from '../router'
import { Page } from '../shell/PageHeader'
import { color, radius, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Chip, type ChipTone } from '../ui/Chip'
import { Empty } from '../ui/Empty'
import { Tabs } from '../ui/Tabs'

const TAB_VIEWS: Record<JobTab, LazyExoticComponent<ComponentType<JobTabProps>>> = {
  overview: lazy(() => import('../job/tabs/OverviewTab')),
  scope: lazy(() => import('../job/tabs/ScopeTab')),
  drawings: lazy(() => import('../job/tabs/DrawingsTab')),
  waterproofing: lazy(() => import('../job/tabs/WaterproofingTab')),
  safety: lazy(() => import('../job/tabs/SafetyTab')),
  crew: lazy(() => import('../job/tabs/CrewTab')),
}

/** The phone's words for a job's status. Outlined, because a grey fill vanishes on the page's grey. */
const STATUS: Record<JobSiteRow['status'], { label: string; tone: ChipTone }> = {
  active: { label: 'Active', tone: 'green' },
  starting_soon: { label: 'Starting soon', tone: 'outline' },
  archived: { label: 'Archived', tone: 'outline' },
}

export interface JobPageProps extends PageProps {
  id: string
  tab: JobTab
}

export default function JobPage({ me, id, tab }: JobPageProps) {
  const [site, setSite] = useState<JobSiteRow | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase().from('job_sites').select('*').eq('id', id).maybeSingle()
    if (err) {
      // A refresh that fails keeps the job on screen and says so; a first load has nothing to keep.
      setError(err.message)
      setState((s) => (s === 'ready' ? 'ready' : 'failed'))
      return
    }
    setError(null)
    if (!data) {
      setSite(null)
      setState('missing')
      return
    }
    setSite(data as JobSiteRow)
    setState('ready')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])
  useFresh(() => void load())

  const reloadJob = useCallback(() => void load(), [load])

  if (state === 'loading') return <PageLoading />
  if (state === 'missing' || (state === 'failed' && !site)) {
    return (
      <Page>
        <div style={{ paddingTop: space.xl }}>
          <Empty
            title={state === 'missing' ? 'This job is not here' : 'Could not open this job'}
            action={
              state === 'missing' ? (
                <Button variant="primary" href={paths.jobs}>All jobs</Button>
              ) : (
                <Button variant="primary" onClick={reloadJob}>Try again</Button>
              )
            }
          >
            {state === 'missing' ? 'It may have been deleted, or the link is for another company.' : error}
          </Empty>
        </div>
      </Page>
    )
  }
  if (!site) return null

  const View = TAB_VIEWS[tab]
  const title = addressLine(site) || site.name
  const builder = builderOf(site)
  const status = STATUS[site.status] ?? STATUS.starting_soon

  return (
    <Page>
      <header data-job-header="" style={{ display: 'flex', alignItems: 'stretch', gap: space.md, paddingTop: space.lg }}>
        <span aria-hidden="true" style={{ flex: 'none', width: 4, borderRadius: radius.pill, background: railOf(site) }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <a {...linkProps(paths.jobs)} className="wb-link" style={{ alignSelf: 'flex-start', ...text.sm, color: color.muted }}>
            ← Jobs
          </a>
          <h1 data-job-title="" style={{ margin: 0, ...text.title, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.xs, ...text.sm, color: color.muted }}>
            {title !== site.name && <span data-job-name="">{site.name}</span>}
            {builder && <span>{builder}</span>}
            <Chip size="sm" tone={status.tone}>
              {status.label}
            </Chip>
          </div>
        </div>
        <div style={{ flex: 'none', alignSelf: 'center' }}>
          <Button href={paths.jobEdit(site.id)}>Edit job</Button>
        </div>
      </header>

      {error && (
        <div style={{ marginTop: space.md }}>
          <Banner tone="warn" title="Showing the job as last loaded" action={<Button size="sm" onClick={reloadJob}>Try again</Button>}>
            {error}
          </Banner>
        </div>
      )}

      <div style={{ marginTop: space.md, borderBottom: `1px solid ${color.border}` }}>
        <Tabs label="Job" panelId="wb-job-panel" value={tab} items={JOB_TABS.map((t) => ({ key: t.key, label: t.label, href: paths.job(site.id, t.key) }))} />
      </div>

      <div id="wb-job-panel" role="tabpanel" aria-label={JOB_TABS.find((t) => t.key === tab)?.label} style={{ paddingTop: space.lg }}>
        <Suspense fallback={<PageLoading />}>
          <View me={me} site={site} reloadJob={reloadJob} />
        </Suspense>
      </div>
    </Page>
  )
}
