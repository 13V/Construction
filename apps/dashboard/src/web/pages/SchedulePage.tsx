/**
 * Schedule. A STUB from the website's foundation, so the route renders and
 * the rail can be walked; the package that builds this page replaces the
 * whole file and keeps the default export and its props.
 */
import type { PageProps } from '../routes'
import { Page } from '../shell/PageHeader'
import { Empty } from '../ui/Empty'

export default function SchedulePage(_props: PageProps) {
  return (
    <Page
      title="Schedule"
    >
      <Empty data-stub="schedule" title="The schedule is on its way">
        The crew app's own schedule (Quarter, Month, Week and Day) will run here at full width.
      </Empty>
    </Page>
  )
}
