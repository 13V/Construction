/**
 * One job, /jobs/:id and /jobs/:id/<tab>.
 *
 * The job is read by id with no status filter (useJob), so an archived job
 * opens too: the board links to archived jobs, and Restore lives here. The
 * same load brings the builder record and the builder's people the way the
 * phone's Project details picks them, and refreshes when the window regains
 * focus, when the tab is shown again and every 60 s, so a change made on a
 * phone shows here without a reload. A refresh that fails keeps the job on
 * screen and says so.
 *
 * Above the tabs: the charcoal header (title, builder, status, dates, fence,
 * and the lifecycle actions) and, after a job was made with something that
 * did not save, the banner that names it and retries it. Each tab is its
 * own chunk, given { me, site, reloadJob } (job/types.ts); Overview is also
 * handed the loaded job and its dates, so it does not load them twice and
 * the header and the Project card cannot disagree.
 *
 * A Retry on that banner can write rows the job row does not carry (a crew
 * booking is assignments, not job_sites), so reloading the job alone would
 * leave the cards that read those rows saying the opposite of the toast
 * until the next focus or minute. `saved` counts the retries that saved
 * something: Overview's People and Ready to start read again when it moves,
 * and the Crew tab, which takes no such prop, is mounted afresh.
 */
import { lazy, Suspense, useCallback, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { useJob } from '../data/useJob'
import { CreateIssuesBanner } from '../job/CreateIssuesBanner'
import { JobHeader, useJobDates } from '../job/JobHeader'
import type { JobTabProps } from '../job/types'
import { PageLoading, type PageProps } from '../routes'
import { JOB_TABS, linkProps, paths, type JobTab } from '../router'
import { Page } from '../shell/PageHeader'
import { color, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { Empty } from '../ui/Empty'
import { Tabs } from '../ui/Tabs'

const OverviewView = lazy(() => import('../job/tabs/OverviewTab'))

const TAB_VIEWS: Record<Exclude<JobTab, 'overview'>, LazyExoticComponent<ComponentType<JobTabProps>>> = {
  scope: lazy(() => import('../job/tabs/ScopeTab')),
  drawings: lazy(() => import('../job/tabs/DrawingsTab')),
  waterproofing: lazy(() => import('../job/tabs/WaterproofingTab')),
  safety: lazy(() => import('../job/tabs/SafetyTab')),
  crew: lazy(() => import('../job/tabs/CrewTab')),
}

export interface JobPageProps extends PageProps {
  id: string
  tab: JobTab
}

export default function JobPage({ me, id, tab }: JobPageProps) {
  const job = useJob(id)
  const dates = useJobDates(job.site)
  const { reload } = job
  const reloadJob = useCallback(() => void reload(), [reload])
  const [saved, setSaved] = useState(0)
  const onIssuesSaved = useCallback(() => {
    setSaved((n) => n + 1)
    void reload()
  }, [reload])

  if (job.state === 'loading') return <PageLoading />
  const site = job.site
  if (job.state === 'missing' || !site) {
    return (
      <Page>
        <div style={{ paddingTop: space.xl }}>
          <Empty
            title={job.state === 'missing' ? 'This job is not here' : 'Could not open this job'}
            action={
              job.state === 'missing' ? (
                <Button variant="primary" href={paths.jobs}>
                  All jobs
                </Button>
              ) : (
                <Button variant="primary" onClick={reloadJob}>
                  Try again
                </Button>
              )
            }
          >
            {job.state === 'missing' ? 'It may have been deleted, or the link is for another company.' : job.error}
          </Empty>
        </div>
      </Page>
    )
  }

  const tabProps: JobTabProps = { me, site, reloadJob }
  const View = tab === 'overview' ? null : TAB_VIEWS[tab]

  return (
    <Page>
      <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', height: 48 }}>
        <a {...linkProps(paths.jobs)} className="wb-link" style={{ ...text.sm, color: color.muted }}>
          ← Jobs
        </a>
      </nav>

      <JobHeader site={site} dates={dates} onChanged={reloadJob} />

      {job.error && (
        <div style={{ marginTop: space.md }}>
          <Banner
            tone="warn"
            title="Showing the job as last loaded"
            action={
              <Button size="sm" onClick={reloadJob}>
                Try again
              </Button>
            }
          >
            {job.error}
          </Banner>
        </div>
      )}

      <CreateIssuesBanner me={me} site={site} onSaved={onIssuesSaved} />

      <div style={{ marginTop: space.sm, borderBottom: `1px solid ${color.border}` }}>
        <Tabs label="Job" panelId="wb-job-panel" value={tab} items={JOB_TABS.map((t) => ({ key: t.key, label: t.label, href: paths.job(site.id, t.key) }))} />
      </div>

      <div id="wb-job-panel" role="tabpanel" aria-label={JOB_TABS.find((t) => t.key === tab)?.label} style={{ paddingTop: space.lg }}>
        <Suspense fallback={<PageLoading />}>
          {View ? <View key={tab === 'crew' ? `crew-${saved}` : tab} {...tabProps} /> : <OverviewView {...tabProps} job={job} dates={dates} refresh={saved} />}
        </Suspense>
      </div>
    </Page>
  )
}
