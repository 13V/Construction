/**
 * Jobs. A STUB from the website's foundation, so the route renders and
 * the rail can be walked; the package that builds this page replaces the
 * whole file and keeps the default export and its props.
 */
import type { PageProps } from '../routes'
import { Page } from '../shell/PageHeader'
import { Button, PlusIcon } from '../ui/Button'
import { paths } from '../router'
import { Empty } from '../ui/Empty'

export default function JobsPage(_props: PageProps) {
  return (
    <Page
      title="Jobs"
      actions={
        <Button variant="primary" href={paths.jobNew} icon={<PlusIcon />}>
          New job
        </Button>
      }
    >
      <Empty data-stub="jobs" title="The jobs board is on its way">
        Every job, Active, Future and Archived, with who is booked and what needs attention, will be listed here.
      </Empty>
    </Page>
  )
}
