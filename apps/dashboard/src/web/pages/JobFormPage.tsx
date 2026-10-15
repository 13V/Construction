/**
 * New job (/jobs/new) and Edit job (/jobs/:id/edit): one page. A STUB from
 * the website's foundation, so both routes render; the packages that build
 * the form replace the whole file and keep the default export and its props.
 */
import type { PageProps } from '../routes'
import { paths } from '../router'
import { Page } from '../shell/PageHeader'
import { Button } from '../ui/Button'
import { Empty } from '../ui/Empty'

export interface JobFormPageProps extends PageProps {
  /** The job being edited; absent for a new job. */
  id?: string
}

export default function JobFormPage({ id }: JobFormPageProps) {
  const back = id ? paths.job(id) : paths.jobs
  return (
    <Page
      title={id ? 'Edit job' : 'New job'}
      actions={
        <Button variant="secondary" href={back}>
          Cancel
        </Button>
      }
    >
      <Empty data-stub={id ? 'job-edit' : 'job-new'} title={id ? 'Editing a job is on its way' : 'The New job form is on its way'}>
        One page with the job, the builder and their people, the site on a map with its fence, the dates, and who is on it.
      </Empty>
    </Page>
  )
}
