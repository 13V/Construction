/**
 * New job (/jobs/new) and Edit job (/jobs/:id/edit): one page, the form in
 * jobs/form/JobForm.tsx.
 *
 * The website's main use is making jobs, and a job is set up in one place:
 * this page sets everything the crew's phones show about it (the job, the
 * builder and their people, the fence, the dates, the captain and a first
 * crew booking), and Edit job is the same page filled in. It is also the
 * only place in either app where a fence can be moved once a job exists:
 * the phone sets a fence when it makes a job and never again.
 *
 * Editing reads the job once (archived included) and is not refreshed while
 * the page is open: the form holds an edit, and the row it was started from
 * is the one Save works out "what changed" against. A change made on a
 * phone in the meantime is not overwritten, because only the columns
 * changed here are written.
 */
import { useMemo } from 'react'
import { driftOf } from '../data/builders'
import { useJob } from '../data/useJob'
import { JobForm } from '../jobs/form/JobForm'
import type { EditSource } from '../jobs/form/useJobForm'
import { PageLoading, type PageProps } from '../routes'
import { paths } from '../router'
import { Page } from '../shell/PageHeader'
import { Button } from '../ui/Button'
import { Empty } from '../ui/Empty'

export interface JobFormPageProps extends PageProps {
  /** The job being edited; absent for a new job. */
  id?: string
}

export default function JobFormPage({ me, id }: JobFormPageProps) {
  if (!id) return <JobForm me={me} source={null} />
  return <EditJob me={me} id={id} />
}

function EditJob({ me, id }: PageProps & { id: string }) {
  const job = useJob(id, { fresh: false })
  const { site, builder, contacts, allContacts } = job
  // One snapshot of the job for the form, taken when it has loaded.
  const source = useMemo<EditSource | null>(
    () => (site ? { site, builder, contacts, allContacts, drift: driftOf(site, builder) } : null),
    [site, builder, contacts, allContacts],
  )

  if (job.state === 'loading') return <PageLoading />
  if (job.state === 'ready' && source) return <JobForm key={source.site.id} me={me} source={source} />
  const missing = job.state === 'missing'
  return (
    <Page title="Edit job">
      <Empty
        title={missing ? 'This job is not here' : 'This job could not be loaded'}
        action={
          missing ? (
            <Button href={paths.jobs}>Back to jobs</Button>
          ) : (
            <Button variant="primary" onClick={() => void job.reload()}>
              Try again
            </Button>
          )
        }
      >
        {missing ? 'It may have been deleted, or it belongs to another company.' : job.error}
      </Empty>
    </Page>
  )
}
